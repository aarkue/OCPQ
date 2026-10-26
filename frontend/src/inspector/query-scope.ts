import type { OcelTypeGraphEdge } from "@r4pm/components";
import { variableDisplay } from "@/routes/visual-editor/helper/colors";
import type { QueryContext, QueryNode } from "./query-context";

export type ScopeVariable = { kind: "object" | "event"; variable: number; types: string[] };
export type QueryScope = {
	/** The selected box, or every box of the query. */
	focus: "box" | "query";
	variables: ScopeVariable[];
	/** Type graph edge ids that a filter in scope covers. */
	filteredEdges: Set<string>;
	/** Where a type picked in the graph gets added: the selected box, else the root box. */
	targetNodeId: string | undefined;
	boxCount: number;
};

const typeId = (isEvent: boolean, name: string) => `${isEvent ? "e" : "o"}:${name}`;

/** The types of `variable` in `nodeId`, declared there or in the nearest ancestor box. */
function typesOf(
	byId: Map<string, QueryNode>,
	nodeId: string,
	kind: "object" | "event",
	variable: number,
): string[] {
	for (let n = byId.get(nodeId); n !== undefined; n = byId.get(n.parentId ?? "")) {
		const declared = (kind === "object" ? n.box?.newObjectVars : n.box?.newEventVars)?.[variable];
		if (declared !== undefined) return declared;
	}
	return [];
}

function ancestorsAndSelf(byId: Map<string, QueryNode>, nodeId: string): QueryNode[] {
	const chain: QueryNode[] = [];
	for (let n = byId.get(nodeId); n !== undefined; n = byId.get(n.parentId ?? "")) {
		chain.push(n);
	}
	return chain;
}

export function scopeOfQuery(ctx: QueryContext): QueryScope {
	const byId = new Map(ctx.nodes.map((n) => [n.id, n]));
	const selected = ctx.selectedId !== undefined ? byId.get(ctx.selectedId) : undefined;
	const nodes = selected?.box !== undefined ? ancestorsAndSelf(byId, selected.id) : ctx.nodes;
	const root = ctx.nodes.find((n) => n.box !== undefined && n.parentId === undefined);

	const variables: ScopeVariable[] = [];
	const filteredEdges = new Set<string>();
	for (const n of nodes) {
		if (n.box === undefined) continue;
		for (const [kind, vars] of [
			["object", n.box.newObjectVars],
			["event", n.box.newEventVars],
		] as const) {
			for (const [v, types] of Object.entries(vars)) {
				variables.push({ kind, variable: Number(v), types });
			}
		}
		for (const f of n.box.filters) {
			if (f.type === "O2E") {
				for (const et of typesOf(byId, n.id, "event", f.event)) {
					for (const ot of typesOf(byId, n.id, "object", f.object)) {
						filteredEdges.add(`${typeId(true, et)}->${typeId(false, ot)}`);
					}
				}
			} else if (f.type === "O2O") {
				for (const from of typesOf(byId, n.id, "object", f.object)) {
					for (const to of typesOf(byId, n.id, "object", f.other_object)) {
						filteredEdges.add(`${typeId(false, from)}->${typeId(false, to)}`);
					}
				}
			}
		}
	}
	return {
		focus: selected?.box !== undefined ? "box" : "query",
		variables,
		filteredEdges,
		targetNodeId: selected?.box !== undefined ? selected.id : root?.id,
		boxCount: ctx.nodes.filter((n) => n.box !== undefined).length,
	};
}

export type EdgeLook = "filter" | "possible" | "faint";
export type TypeGraphFocus = {
	/** Variable names per bound type id, e.g., `o:orders` -> ["o1", "o3"]. */
	bound: Map<string, string[]>;
	visible: Set<string>;
	edgeLook: Map<string, EdgeLook>;
	/** Related types left out to keep the graph readable. */
	hiddenNeighbours: number;
};

/** The bound types of `scope` and the neighbours with the most relations to them. An edge between
 *  two bound types is `filter` when a filter in scope covers it and `possible` otherwise. Edges to
 *  neighbours are `faint`. */
export function focusTypeGraph(
	scope: QueryScope,
	edges: OcelTypeGraphEdge[],
	relations: (edgeId: string) => number,
	maxNeighbours: number,
): TypeGraphFocus {
	const bound = new Map<string, string[]>();
	for (const v of scope.variables) {
		const name = variableDisplay(v.variable, v.kind).name;
		for (const t of v.types) {
			const id = typeId(v.kind === "event", t);
			const names = bound.get(id) ?? [];
			if (!names.includes(name)) names.push(name);
			bound.set(id, names);
		}
	}
	const weight = new Map<string, number>();
	for (const e of edges) {
		const s = bound.has(e.source);
		const t = bound.has(e.target);
		if (s === t) continue;
		const other = s ? e.target : e.source;
		weight.set(other, (weight.get(other) ?? 0) + relations(e.id));
	}
	const neighbours = [...weight.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, maxNeighbours)
		.map(([id]) => id);
	const visible = new Set([...bound.keys(), ...neighbours]);
	const edgeLook = new Map<string, EdgeLook>();
	for (const e of edges) {
		if (!visible.has(e.source) || !visible.has(e.target)) continue;
		const s = bound.has(e.source);
		const t = bound.has(e.target);
		if (!s && !t) continue;
		edgeLook.set(e.id, s && t ? (scope.filteredEdges.has(e.id) ? "filter" : "possible") : "faint");
	}
	return { bound, visible, edgeLook, hiddenNeighbours: weight.size - neighbours.length };
}
