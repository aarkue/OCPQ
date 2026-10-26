import type { OCELEvent, OCELObject } from "@/types/ocel";

export type GraphElement = OCELEvent | OCELObject;
export type GraphLink = { source: string; target: string; qualifier: string };
export type GraphState = {
	nodes: GraphElement[];
	links: GraphLink[];
	/** Ids of nodes whose relations are all in the graph. */
	expanded: string[];
};

export const EMPTY_GRAPH: GraphState = { nodes: [], links: [], expanded: [] };

export function isEvent(el: GraphElement): el is OCELEvent {
	return "time" in el;
}

const linkKey = (l: GraphLink) => `${l.source}\u0000${l.target}\u0000${l.qualifier}`;

/** Every E2O and O2O relation among `nodes`, read from their own relationship lists, so none is
 *  missing however the nodes were fetched. */
export function relationsAmong(nodes: GraphElement[]): GraphLink[] {
	const ids = new Set(nodes.map((n) => n.id));
	return nodes.flatMap((n) =>
		(n.relationships ?? [])
			.filter((r) => ids.has(r.objectId) && r.objectId !== n.id)
			.map((r) => ({ source: n.id, target: r.objectId, qualifier: r.qualifier })),
	);
}

/** Adds the nodes, links and expanded ids of `more` that `base` does not have yet. */
export function mergeGraphs(base: GraphState, more: GraphState): GraphState {
	const nodeIds = new Set(base.nodes.map((n) => n.id));
	const linkKeys = new Set(base.links.map(linkKey));
	return {
		nodes: [...base.nodes, ...more.nodes.filter((n) => !nodeIds.has(n.id))],
		links: [...base.links, ...more.links.filter((l) => !linkKeys.has(linkKey(l)))],
		expanded: [...new Set([...base.expanded, ...more.expanded])],
	};
}

/** The graph without the nodes of `hiddenTypes` and the links touching them. */
export function withoutTypes(graph: GraphState, hiddenTypes: ReadonlySet<string>): GraphState {
	if (hiddenTypes.size === 0) return graph;
	const nodes = graph.nodes.filter((n) => !hiddenTypes.has(n.type));
	const ids = new Set(nodes.map((n) => n.id));
	return {
		nodes,
		links: graph.links.filter((l) => ids.has(l.source) && ids.has(l.target)),
		expanded: graph.expanded,
	};
}

/** Number of nodes per type, objects first, each kind by count. */
export function typeCounts(nodes: GraphElement[]) {
	const counts = new Map<string, { type: string; isEvent: boolean; count: number }>();
	for (const n of nodes) {
		const entry = counts.get(n.type) ?? { type: n.type, isEvent: isEvent(n), count: 0 };
		entry.count += 1;
		counts.set(n.type, entry);
	}
	return [...counts.values()].sort(
		(a, b) => Number(a.isEvent) - Number(b.isEvent) || b.count - a.count,
	);
}

/** The node and everything linked to it. */
export function neighbourhood(links: GraphLink[], id: string): Set<string> {
	const ids = new Set([id]);
	for (const l of links) {
		if (l.source === id) ids.add(l.target);
		if (l.target === id) ids.add(l.source);
	}
	return ids;
}

/** Where the segment from `from` to `to` leaves a box of half-size `hw` x `hh` centered on `to`,
 *  as the fraction of the segment measured back from `to`. */
export function boxExitFraction(dx: number, dy: number, hw: number, hh: number): number {
	const sx = dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx);
	const sy = dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy);
	return Math.min(sx, sy);
}

/** `color` blended toward `other` (both `#rrggbb`), `amount` = share of `color`. */
export function mixHex(color: string, other: string, amount: number): string {
	const parse = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
	const a = parse(color);
	const b = parse(other);
	return `#${a
		.map((v, i) =>
			Math.round(v * amount + b[i] * (1 - amount))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

export function truncateLabel(text: string, max: number) {
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export type FitBox = { x: number; y: number; halfW: number; halfH: number };
export type Insets = { top: number; right: number; bottom: number; left: number };

/** The zoom factor for one wheel event. Trackpad pinches arrive as wheel events with Ctrl held and
 *  a delta of -100 ln(scale step), which the pinch rate inverts so the graph follows the fingers.
 *  A mouse wheel notch is about 100 px, and the cap keeps one notch near 1.15x even with Ctrl
 *  held, where d3's default jumps 4x. */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
	const px = deltaY * (deltaMode === 1 ? 25 : deltaMode === 2 ? 400 : 1);
	const step = Math.max(-0.2, Math.min(0.2, -px * (pinch ? 1 / (100 * Math.LN2) : 0.002)));
	return 2 ** step;
}

/** The center point and zoom that show every box in the part of a `width` x `height` view that
 *  overlays do not cover (`insets`, in px). */
export function fitView(
	boxes: FitBox[],
	width: number,
	height: number,
	insets: Insets,
	maxZoom: number,
): { x: number; y: number; k: number } | undefined {
	if (boxes.length === 0) return undefined;
	let x0 = Number.POSITIVE_INFINITY;
	let y0 = Number.POSITIVE_INFINITY;
	let x1 = Number.NEGATIVE_INFINITY;
	let y1 = Number.NEGATIVE_INFINITY;
	for (const b of boxes) {
		x0 = Math.min(x0, b.x - b.halfW);
		x1 = Math.max(x1, b.x + b.halfW);
		y0 = Math.min(y0, b.y - b.halfH);
		y1 = Math.max(y1, b.y + b.halfH);
	}
	const freeW = Math.max(1, width - insets.left - insets.right);
	const freeH = Math.max(1, height - insets.top - insets.bottom);
	const k = Math.min(maxZoom, freeW / Math.max(1, x1 - x0), freeH / Math.max(1, y1 - y0));
	// The graph is centered on the canvas, so shift it by half the inset difference.
	return {
		x: (x0 + x1) / 2 - (insets.left - insets.right) / 2 / k,
		y: (y0 + y1) / 2 - (insets.top - insets.bottom) / 2 / k,
		k,
	};
}

export type HopRings = {
	/** Hops from the root. Nodes it cannot reach are missing. */
	dist: Map<string, number>;
	/** The neighbour each node was first reached from. */
	parent: Map<string, string>;
	/** Ring radius per hop: at least `gap` apart, and wide enough for `slot` per node. */
	radii: number[];
	/** Reachable nodes, nearest first. */
	order: string[];
};

/** Concentric rings around the root, one per hop, for laying out a neighbourhood. Several roots
 *  share the innermost ring. */
export function hopRings(
	ids: string[],
	links: GraphLink[],
	rootIds: string | readonly string[],
	slot: number,
	gap: number,
): HopRings {
	const known = new Set(ids);
	const adjacent = new Map<string, string[]>();
	for (const l of links) {
		if (!known.has(l.source) || !known.has(l.target)) continue;
		adjacent.set(l.source, [...(adjacent.get(l.source) ?? []), l.target]);
		adjacent.set(l.target, [...(adjacent.get(l.target) ?? []), l.source]);
	}
	const dist = new Map<string, number>();
	const parent = new Map<string, string>();
	const order: string[] = [];
	for (const rootId of typeof rootIds === "string" ? [rootIds] : rootIds) {
		if (!known.has(rootId) || dist.has(rootId)) continue;
		dist.set(rootId, 0);
		order.push(rootId);
	}
	for (let i = 0; i < order.length; i++) {
		const id = order[i];
		for (const next of adjacent.get(id) ?? []) {
			if (dist.has(next)) continue;
			dist.set(next, (dist.get(id) ?? 0) + 1);
			parent.set(next, id);
			order.push(next);
		}
	}
	const perRing: number[] = [];
	for (const d of dist.values()) perRing[d] = (perRing[d] ?? 0) + 1;
	const roots = perRing[0] ?? 0;
	const radii = [roots > 1 ? Math.max(gap / 2, (roots * slot) / (2 * Math.PI)) : 0];
	for (let d = 1; d < perRing.length; d++) {
		radii.push(Math.max(radii[d - 1] + gap, ((perRing[d] ?? 0) * slot) / (2 * Math.PI)));
	}
	return { dist, parent, radii, order };
}
