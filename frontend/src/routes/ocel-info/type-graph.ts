import type { OcelTypeGraphEdge, OcelTypeGraphNode } from "@r4pm/components";
import { connectedTopK, typeKey } from "@/routes/path-schemas/lib";
import type { OCELTypeStats } from "@/types/generated/OCELTypeStats";
import type { PathTypeEdge } from "@/types/generated/PathTypeEdge";
import type { PathTypeNode } from "@/types/generated/PathTypeNode";
import type { OCELInfo } from "@/types/ocel";

/** One unlabeled edge per related type pair. A log can have millions of distinct qualifiers, and an
 *  arc for each would stall the layout. */
export function buildTypeGraph(ocelInfo: OCELInfo, stats: OCELTypeStats | undefined) {
	const typeNodes: PathTypeNode[] = [
		...ocelInfo.event_types.map((t) => ({
			name: t.name,
			is_event: true,
			count: stats?.event_type_counts[t.name] ?? 0,
		})),
		...ocelInfo.object_types.map((t) => ({
			name: t.name,
			is_event: false,
			count: stats?.object_type_counts[t.name] ?? 0,
		})),
	];
	const typeEdges: PathTypeEdge[] = [];
	const relationCounts = new Map<string, number>();
	const edgeId = (e: PathTypeEdge) => `${typeKey(e.source)}->${typeKey(e.target)}`;
	const addEdges = (rels: OCELInfo["e2o_types"], isE2O: boolean) => {
		for (const [from, perType] of Object.entries(rels)) {
			for (const [to, [count]] of Object.entries(perType)) {
				// The backend lists every type pair, unrelated ones with a count of 0.
				if (count === 0) continue;
				const edge = {
					source: { name: from, is_event: isE2O },
					target: { name: to, is_event: false },
					qualifier: "",
				};
				typeEdges.push(edge);
				relationCounts.set(edgeId(edge), count);
			}
		}
	};
	addEdges(ocelInfo.e2o_types, true);
	addEdges(ocelInfo.o2o_types, false);

	const nodes: OcelTypeGraphNode[] = typeNodes.map((n) => ({
		id: typeKey(n),
		label: n.name,
		kind: n.is_event ? "event" : "object",
		count: n.count,
	}));
	const edges: OcelTypeGraphEdge[] = typeEdges.map((e) => ({
		id: edgeId(e),
		source: typeKey(e.source),
		target: typeKey(e.target),
		kind: e.source.is_event ? "e2o" : "o2o",
	}));
	const autoScope = new Set(connectedTopK(typeNodes, typeEdges).map(typeKey));
	return { nodes, edges, relationCounts, autoScope };
}

/** Inverse of `typeKey`, for ids handed back by the graph. */
export function parseTypeKey(id: string): { isEvent: boolean; name: string } {
	return { isEvent: id.startsWith("e:"), name: id.slice(2) };
}

export type RelatedType = { isEvent: boolean; name: string; count: number; via: string };

/** Types with at least one relation to the given type, most relations first. */
export function relatedTypes(ocelInfo: OCELInfo, isEvent: boolean, name: string): RelatedType[] {
	const related: RelatedType[] = [];
	const count = (pair: [number, unknown] | undefined) => pair?.[0] ?? 0;
	if (isEvent) {
		for (const [ot, pair] of Object.entries(ocelInfo.e2o_types[name] ?? {})) {
			if (count(pair) > 0)
				related.push({ isEvent: false, name: ot, count: count(pair), via: "E2O" });
		}
	} else {
		for (const [ev, perType] of Object.entries(ocelInfo.e2o_types)) {
			const c = count(perType[name]);
			if (c > 0) related.push({ isEvent: true, name: ev, count: c, via: "E2O" });
		}
		for (const [ot, pair] of Object.entries(ocelInfo.o2o_types[name] ?? {})) {
			if (count(pair) > 0)
				related.push({ isEvent: false, name: ot, count: count(pair), via: "O2O →" });
		}
		for (const [ot, perType] of Object.entries(ocelInfo.o2o_types)) {
			const c = count(perType[name]);
			if (c > 0 && ot !== name) related.push({ isEvent: false, name: ot, count: c, via: "O2O ←" });
		}
	}
	return related.sort((a, b) => b.count - a.count);
}
