import type { BindingBox } from "@/types/generated/BindingBox";
import type { BindingBoxTree } from "@/types/generated/BindingBoxTree";
import type { Filter } from "@/types/generated/Filter";
import type { PathSchemaInfo } from "@/types/generated/PathSchemaInfo";
import type { PathTypeRef } from "@/types/generated/PathTypeRef";
import type { TemporalMode } from "@/types/generated/TemporalMode";

/** Pure BindingBoxTree builders for the path-schemas "Open as OCPQ query" action.
 *  Kept free of any UI/storage/layout dependencies so they stay cheaply unit-testable. */

interface NodeVar {
	type: string;
	isEvent: boolean;
	id: number;
}

/** Build a single-box OCPQ query (BindingBoxTree) from a path schema: one variable per hop type,
 *  E2O/O2O steps become O2E/O2O filters, temporal mode adds TimeBetweenEvents filters. */
export function schemaToBindingBoxTree(
	info: PathSchemaInfo,
	temporal: TemporalMode,
	boundedSeconds: number,
): BindingBoxTree {
	// 1. Reconstruct the node (type) sequence with event/object kind.
	const nodeKinds: { type: string; isEvent: boolean }[] = [
		{ type: info.source.name, isEvent: info.source.is_event },
	];
	for (const s of info.steps) {
		const reached = s.reverse ? s.source : s.target;
		nodeKinds.push({ type: reached.name, isEvent: reached.is_event });
	}

	// 2. Assign a variable per node (separate event/object id spaces).
	let evCounter = 0;
	let obCounter = 0;
	const newEventVars: { [k: number]: string[] } = {};
	const newObjectVars: { [k: number]: string[] } = {};
	const nodeVars: NodeVar[] = nodeKinds.map((n) => {
		if (n.isEvent) {
			const id = evCounter++;
			newEventVars[id] = [n.type];
			return { type: n.type, isEvent: true, id };
		}
		const id = obCounter++;
		newObjectVars[id] = [n.type];
		return { type: n.type, isEvent: false, id };
	});

	// 3. One relation filter per step.
	const filters: Filter[] = [];
	info.steps.forEach((s, i) => {
		const a = nodeVars[i];
		const b = nodeVars[i + 1];
		// The directed edge is edge.source --qualifier--> edge.target. Find which
		// path node carries the edge source vs the edge target.
		const srcNode = s.reverse ? b : a;
		const tgtNode = s.reverse ? a : b;
		if (s.source.is_event !== s.target.is_event) {
			// E2O edge -> O2E filter (object associated with event).
			const objNode = s.source.is_event ? tgtNode : srcNode;
			const evNode = s.source.is_event ? srcNode : tgtNode;
			filters.push({ type: "O2E", object: objNode.id, event: evNode.id, qualifier: s.qualifier });
		} else {
			// O2O edge -> O2O filter (directed source -> target).
			filters.push({
				type: "O2O",
				object: srcNode.id,
				other_object: tgtNode.id,
				qualifier: s.qualifier,
			});
		}
	});

	// 4. Temporal: chain consecutive event variables in path order.
	if (temporal !== "None") {
		const eventIds = nodeVars.filter((n) => n.isEvent).map((n) => n.id);
		const max = temporal === "Bounded" ? boundedSeconds : null;
		for (let i = 1; i < eventIds.length; i++) {
			filters.push({
				type: "TimeBetweenEvents",
				from_event: eventIds[i - 1],
				to_event: eventIds[i],
				min_seconds: 0,
				max_seconds: max,
			});
		}
	}

	const box: BindingBox = {
		newEventVars,
		newObjectVars,
		filters,
		sizeFilters: [],
		constraints: [],
	};
	return { nodes: [{ Box: [box, []] }], edgeNames: [] };
}

/** Build a single-box OCPQ query several selected path schemas (sharing source/target types) must
 *  satisfy together, merging identical step prefixes across paths. */
export function schemasToBindingBoxTree(
	infos: PathSchemaInfo[],
	temporal: TemporalMode,
	boundedSeconds: number,
): BindingBoxTree {
	if (infos.length === 0) throw new Error("No path schemas selected");
	const sourceRef = infos[0].source;
	const targetRef = infos[0].target;
	const sameRef = (a: PathTypeRef, b: PathTypeRef) =>
		a.name === b.name && a.is_event === b.is_event;
	for (const info of infos) {
		if (!sameRef(info.source, sourceRef) || !sameRef(info.target, targetRef)) {
			throw new Error("Selected path schemas must share the same source and target types");
		}
		if (info.steps.length === 0) {
			throw new Error("A selected path schema has no steps");
		}
	}

	let evCounter = 0;
	let obCounter = 0;
	const newEventVars: { [k: number]: string[] } = {};
	const newObjectVars: { [k: number]: string[] } = {};
	const filters: Filter[] = [];

	function makeVar(type: string, isEvent: boolean): NodeVar {
		if (isEvent) {
			const id = evCounter++;
			newEventVars[id] = [type];
			return { type, isEvent: true, id };
		}
		const id = obCounter++;
		newObjectVars[id] = [type];
		return { type, isEvent: false, id };
	}

	// The shared endpoints, allocated before any intermediate so they get the first ids.
	const sourceVar = makeVar(sourceRef.name, sourceRef.is_event);
	const targetVar = makeVar(targetRef.name, targetRef.is_event);

	// Same edge-direction resolution as the single-schema builder, deduplicated: paths
	// sharing their first or last step must not add the same filter twice.
	const seenFilters = new Set<string>();
	function pushStepFilter(s: PathSchemaInfo["steps"][number], a: NodeVar, b: NodeVar) {
		const dedupe = `${a.id}|${a.isEvent}|${s.qualifier}|${s.reverse}|${b.id}|${b.isEvent}`;
		if (seenFilters.has(dedupe)) return;
		seenFilters.add(dedupe);
		const srcNode = s.reverse ? b : a;
		const tgtNode = s.reverse ? a : b;
		if (s.source.is_event !== s.target.is_event) {
			const objNode = s.source.is_event ? tgtNode : srcNode;
			const evNode = s.source.is_event ? srcNode : tgtNode;
			filters.push({ type: "O2E", object: objNode.id, event: evNode.id, qualifier: s.qualifier });
		} else {
			filters.push({
				type: "O2O",
				object: srcNode.id,
				other_object: tgtNode.id,
				qualifier: s.qualifier,
			});
		}
	}

	interface TrieNode {
		v: NodeVar;
		children: Map<string, TrieNode>;
	}
	const root: TrieNode = { v: sourceVar, children: new Map() };

	// Per-schema chain of event-variable ids in path order, for temporal filters.
	const eventChains: number[][] = [];

	for (const info of infos) {
		let cur = root;
		const eventChain: number[] = cur.v.isEvent ? [cur.v.id] : [];
		info.steps.forEach((s, i) => {
			if (i === info.steps.length - 1) {
				// The last step always lands on the shared target variable.
				pushStepFilter(s, cur.v, targetVar);
				if (targetVar.isEvent) eventChain.push(targetVar.id);
				return;
			}
			const key = `${s.qualifier}|${s.reverse}|${s.source.name}|${s.source.is_event}|${s.target.name}|${s.target.is_event}`;
			let child = cur.children.get(key);
			if (!child) {
				const reached = s.reverse ? s.source : s.target;
				child = { v: makeVar(reached.name, reached.is_event), children: new Map() };
				cur.children.set(key, child);
			}
			pushStepFilter(s, cur.v, child.v);
			cur = child;
			if (cur.v.isEvent) eventChain.push(cur.v.id);
		});
		eventChains.push(eventChain);
	}

	if (temporal !== "None") {
		const max = temporal === "Bounded" ? boundedSeconds : null;
		const seen = new Set<string>();
		for (const chain of eventChains) {
			for (let i = 1; i < chain.length; i++) {
				const key = `${chain[i - 1]}|${chain[i]}`;
				if (seen.has(key)) continue;
				seen.add(key);
				filters.push({
					type: "TimeBetweenEvents",
					from_event: chain[i - 1],
					to_event: chain[i],
					min_seconds: 0,
					max_seconds: max,
				});
			}
		}
	}

	const box: BindingBox = {
		newEventVars,
		newObjectVars,
		filters,
		sizeFilters: [],
		constraints: [],
	};
	return { nodes: [{ Box: [box, []] }], edgeNames: [] };
}
