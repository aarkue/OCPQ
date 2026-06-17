import type { PathTypeEdge } from "@/types/generated/PathTypeEdge";
import type { PathTypeNode } from "@/types/generated/PathTypeNode";
import type { PathTypeRef } from "@/types/generated/PathTypeRef";

/** Deterministic hash of a string to a positive integer. */
export function hashString(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) - h + s.charCodeAt(i)) | 0;
	}
	return Math.abs(h);
}

/** Hue for a type name. Events use cool hues (200-280), objects warm (0-50, 90-180). */
export function typeHue(name: string, kind: "event" | "object"): number {
	const h = hashString(name);
	if (kind === "event") {
		return 200 + (h % 80);
	}
	const deg = h % 140;
	return deg < 50 ? deg : 90 + (deg - 50);
}

export function typeColor(name: string, kind: "event" | "object") {
	const hue = typeHue(name, kind);
	return {
		hue,
		border: `hsl(${hue}, 55%, 42%)`,
		bg: `hsl(${hue}, 40%, 88%)`,
		text: `hsl(${hue}, 55%, 30%)`,
	};
}

/** Stable composite key for a typed reference. Event and object type names are not
 *  disjoint in OCEL, so identity must include the kind. */
export function typeKey(t: PathTypeRef): string {
	return `${t.is_event ? "e" : "o"}:${t.name}`;
}

/** Equality of two (optional) typed references. */
export function typeRefEq(
	a: PathTypeRef | null | undefined,
	b: PathTypeRef | null | undefined,
): boolean {
	return !!a && !!b && a.is_event === b.is_event && a.name === b.name;
}

/** Logs with at most this many total types show every type by default; larger logs fall
 *  back to a connected top-k auto scope so the graph and enumeration stay tractable. */
export const SMALL_LOG_TYPE_LIMIT = 30;
/** Default scope size for large logs. */
export const DEFAULT_AUTO_K = 15;
/** Upper bound enforced by the bounded bulk actions (grow neighbors, select all), so the
 *  graph and enumeration stay responsive on logs with hundreds of types. */
export const MAX_SCOPE_TYPES = 50;
/** When growing the scope, a single scope type that would pull in more than this many new
 *  neighbors is treated as a hub and skipped, so one densely-connected type cannot blow up
 *  the whole scope. */
export const DEFAULT_EXPANSION_PER_TYPE = 10;

const nodeRef = (n: PathTypeNode): PathTypeRef => ({ name: n.name, is_event: n.is_event });

/** Undirected adjacency over the type graph, keyed by typeKey. */
function buildAdjacency(edges: PathTypeEdge[]): Map<string, Set<string>> {
	const adj = new Map<string, Set<string>>();
	const link = (a: string, b: string) => {
		const s = adj.get(a);
		if (s) s.add(b);
		else adj.set(a, new Set([b]));
	};
	for (const e of edges) {
		const a = typeKey(e.source);
		const b = typeKey(e.target);
		link(a, b);
		link(b, a);
	}
	return adj;
}

/** Default ("auto") scope for the type picker. Returns every type when the log is small,
 *  else a connected top-k: greedily take the most frequent types, preferring ones adjacent
 *  to the current scope, so the induced subgraph stays connected (never blank/disconnected). */
export function connectedTopK(
	nodes: PathTypeNode[],
	edges: PathTypeEdge[],
	k = DEFAULT_AUTO_K,
	threshold = SMALL_LOG_TYPE_LIMIT,
): PathTypeRef[] {
	if (nodes.length <= threshold) return nodes.map(nodeRef);
	const byCount = [...nodes].sort((a, b) => b.count - a.count);
	if (byCount.length === 0) return [];
	const adj = buildAdjacency(edges);
	const target = Math.min(k, byCount.length);
	const scope = new Set<string>();
	const picked: PathTypeRef[] = [];
	const add = (n: PathTypeNode) => {
		scope.add(typeKey(n));
		picked.push(nodeRef(n));
	};
	const adjacentToScope = (key: string): boolean => {
		const nbrs = adj.get(key);
		if (!nbrs) return false;
		for (const x of nbrs) if (scope.has(x)) return true;
		return false;
	};
	add(byCount[0]);
	while (picked.length < target) {
		// Highest-count type adjacent to the current scope keeps the subgraph connected.
		let next = byCount.find((n) => !scope.has(typeKey(n)) && adjacentToScope(typeKey(n)));
		// Disconnected remainder: start a new component from the next most frequent type.
		if (!next) next = byCount.find((n) => !scope.has(typeKey(n)));
		if (!next) break;
		add(next);
	}
	return picked;
}

export interface ScopeExpansion {
	scope: PathTypeRef[];
	/** Names of scope types skipped because expanding them would add too many neighbors. */
	skippedHubs: string[];
	/** Whether the hard scope cap was reached before all neighbors could be added. */
	hitCap: boolean;
}

/** Grow the scope by one hop: add types directly connected to the current scope, but skip
 *  any single scope type that would pull in more than `perTypeLimit` new neighbors (a hub),
 *  and never exceed `maxScope` total. Higher-frequency scope types expand first so the cap
 *  favours the more relevant neighbors. */
export function expandScope(
	shown: PathTypeRef[],
	nodes: PathTypeNode[],
	edges: PathTypeEdge[],
	perTypeLimit = DEFAULT_EXPANSION_PER_TYPE,
	maxScope = MAX_SCOPE_TYPES,
): ScopeExpansion {
	const adj = buildAdjacency(edges);
	const countByKey = new Map(nodes.map((n) => [typeKey(n), n.count]));
	const nameByKey = new Map(nodes.map((n) => [typeKey(n), n.name]));
	const inScope = new Set(shown.map(typeKey));
	const skippedHubs: string[] = [];
	let hitCap = false;

	const byCountDesc = (a: string, b: string) => (countByKey.get(b) ?? 0) - (countByKey.get(a) ?? 0);
	// Snapshot the seeds (only the original scope expands; new neighbors are not re-expanded).
	const seeds = [...inScope].sort(byCountDesc);
	for (const seedKey of seeds) {
		if (inScope.size >= maxScope) {
			hitCap = true;
			break;
		}
		const nbrs = adj.get(seedKey);
		if (!nbrs) continue;
		const fresh = [...nbrs].filter((n) => !inScope.has(n));
		if (fresh.length === 0) continue;
		if (fresh.length > perTypeLimit) {
			skippedHubs.push(nameByKey.get(seedKey) ?? seedKey);
			continue;
		}
		fresh.sort(byCountDesc);
		for (const k of fresh) {
			if (inScope.size >= maxScope) {
				hitCap = true;
				break;
			}
			inScope.add(k);
		}
	}
	return {
		scope: nodes.filter((n) => inScope.has(typeKey(n))).map(nodeRef),
		skippedHubs,
		hitCap,
	};
}

/** Human-readable duration from a number of seconds. */
export function formatDuration(seconds: number): string {
	const abs = Math.abs(seconds);
	const sign = seconds < 0 ? "-" : "";
	if (abs < 0.1) return `${sign}${(abs * 1000).toFixed(0)}ms`;
	if (abs < 60) return `${sign}${abs.toFixed(1)}s`;
	if (abs < 3600) {
		const m = Math.floor(abs / 60);
		const s = Math.round(abs % 60);
		return s > 0 ? `${sign}${m}m ${s}s` : `${sign}${m}m`;
	}
	if (abs < 86400) {
		const h = Math.floor(abs / 3600);
		const m = Math.round((abs % 3600) / 60);
		return m > 0 ? `${sign}${h}h ${m}m` : `${sign}${h}h`;
	}
	if (abs < 2592000) {
		const d = Math.floor(abs / 86400);
		const h = Math.round((abs % 86400) / 3600);
		return h > 0 ? `${sign}${d}d ${h}h` : `${sign}${d}d`;
	}
	if (abs < 31536000) {
		const months = abs / 2592000;
		return months >= 2
			? `${sign}${months.toFixed(1)} months`
			: `${sign}${(abs / 86400).toFixed(0)} days`;
	}
	return `${sign}${(abs / 31536000).toFixed(1)} years`;
}

/** Equivalence-class index to a letter label (0 -> A, 25 -> Z, 26 -> AA). */
export function eqLabel(n: number): string {
	let s = "";
	let x = n;
	do {
		s = String.fromCharCode(65 + (x % 26)) + s;
		x = Math.floor(x / 26) - 1;
	} while (x >= 0);
	return s;
}

/** Background color for a 0..1 heatmap cell (white -> green). */
export function heatStyle(v: number) {
	const a = Math.max(0, Math.min(1, v));
	return { backgroundColor: `rgba(34,197,94,${(a * 0.75).toFixed(3)})` };
}

/** Palette used consistently for selected schemas across graph, radar and chips. */
export const SCHEMA_COLORS = [
	"#6366f1",
	"#ef4444",
	"#10b981",
	"#f59e0b",
	"#8b5cf6",
	"#ec4899",
	"#14b8a6",
	"#f97316",
	"#0ea5e9",
	"#84cc16",
];

/** Color for the i-th selected schema. */
export function schemaColorAt(i: number): string {
	return SCHEMA_COLORS[i % SCHEMA_COLORS.length];
}

/** Log-scaled normalization of a value into 0..1 over a range. */
export function normalizeLog(v: number, min: number, max: number): number {
	const lo = Math.log1p(min);
	const hi = Math.log1p(max);
	if (hi === lo) return 0.5;
	return (Math.log1p(v) - lo) / (hi - lo);
}

/** Linear interpolation between two RGB colors, returned as an rgba() string. */
export function lerpRgba(
	c0: [number, number, number],
	c1: [number, number, number],
	t: number,
	a: number,
): string {
	const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
	const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
	const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
	return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Average several 6-digit hex colors (#rrggbb) into one. */
export function blendHexColors(colors: string[]): string {
	if (colors.length === 1) return colors[0];
	let r = 0;
	let g = 0;
	let b = 0;
	for (const hex of colors) {
		const c = hex.replace("#", "");
		r += parseInt(c.slice(0, 2), 16);
		g += parseInt(c.slice(2, 4), 16);
		b += parseInt(c.slice(4, 6), 16);
	}
	const n = colors.length;
	const toHex = (v: number) =>
		Math.round(v / n)
			.toString(16)
			.padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export interface Bins {
	centers: number[];
	heights: number[];
	binWidth: number;
}

const DISCRETE_BIN_LIMIT = 40;

/** Histogram bins. With `discrete`, one bin per integer when the range is small
 *  (<= DISCRETE_BIN_LIMIT); otherwise Sturges' rule. */
export function binValues(values: number[], discrete = false): Bins {
	if (values.length === 0) return { centers: [], heights: [], binWidth: 1 };
	const min = Math.min(...values);
	const max = Math.max(...values);
	if (min === max) return { centers: [min], heights: [values.length], binWidth: 1 };
	if (discrete && max - min <= DISCRETE_BIN_LIMIT) {
		const n = max - min + 1;
		const heights = new Array(n).fill(0);
		for (const v of values) heights[v - min]++;
		return { centers: Array.from({ length: n }, (_, i) => min + i), heights, binWidth: 1 };
	}
	const n = Math.max(3, Math.ceil(Math.log2(values.length) + 1));
	const binWidth = (max - min) / n;
	const heights = new Array(n).fill(0);
	for (const v of values) {
		let idx = Math.floor((v - min) / binWidth);
		if (idx >= n) idx = n - 1;
		heights[idx]++;
	}
	const centers = Array.from({ length: n }, (_, i) => min + (i + 0.5) * binWidth);
	return { centers, heights, binWidth };
}
