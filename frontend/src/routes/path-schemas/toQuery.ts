import { v4 } from "uuid";
import {
	parseLocalStorageValue,
	QUERY_LOCALSTORAGE_OPEN_INDEX,
	QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META,
	QUERY_LOCALSTORAGE_SAVE_KEY_DATA,
} from "@/lib/local-storage";
import { bindingBoxTreeToNodes } from "@/routes/visual-editor/helper/constructNodes";
import { applyLayoutToNodes } from "@/routes/visual-editor/helper/LayoutFlow";
import type { ConstraintInfo } from "@/routes/visual-editor/helper/types";
import type { BindingBox } from "@/types/generated/BindingBox";
import type { BindingBoxTree } from "@/types/generated/BindingBoxTree";
import type { Filter } from "@/types/generated/Filter";
import type { PathSchemaInfo } from "@/types/generated/PathSchemaInfo";
import type { TemporalMode } from "@/types/generated/TemporalMode";
import type { FlowAndViolationData } from "@/types/misc";

interface NodeVar {
	type: string;
	isEvent: boolean;
	id: number;
}

/** Build a single-box OCPQ query (BindingBoxTree) from a path schema.
 *  One variable per hop type; E2O steps -> O2E filters, O2O steps -> O2O filters
 *  (directed by the real edge), forward/bounded temporal -> TimeBetweenEvents. */
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

/** Build the query, append it to the constraints editor's storage, and return its index.
 *  Navigate to /constraints afterwards to open it. */
export async function openSchemaAsQuery(
	info: PathSchemaInfo,
	temporal: TemporalMode,
	boundedSeconds: number,
): Promise<number> {
	const tree = schemaToBindingBoxTree(info, temporal, boundedSeconds);
	const [nodes, edges] = bindingBoxTreeToNodes(tree, 0, 0, 0, v4());
	await applyLayoutToNodes(nodes, edges);

	const meta = parseLocalStorageValue<ConstraintInfo[]>(
		localStorage.getItem(QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META) ?? "[]",
	);
	const data = parseLocalStorageValue<FlowAndViolationData[]>(
		localStorage.getItem(QUERY_LOCALSTORAGE_SAVE_KEY_DATA) ?? "[]",
	);

	const index = meta.length;
	meta.push({
		name: `Path: ${info.source.name} -> ${info.target.name}`,
		description: "Generated from a path schema",
	});
	data[index] = { flowJson: { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } } };

	localStorage.setItem(QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META, JSON.stringify(meta));
	localStorage.setItem(QUERY_LOCALSTORAGE_SAVE_KEY_DATA, JSON.stringify(data));
	localStorage.setItem(QUERY_LOCALSTORAGE_OPEN_INDEX, String(index));
	return index;
}
