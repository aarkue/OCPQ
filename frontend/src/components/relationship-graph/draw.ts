import { typeColor } from "../TypeDot";
import {
	boxExitFraction,
	type GraphElement,
	type GraphLink,
	isEvent,
	mixHex,
	truncateLabel,
} from "./graph-model";

/** A graph element as force-graph holds it, with a position and its measured badge width. */
export type DrawNode = GraphElement & {
	x?: number;
	y?: number;
	vx?: number;
	vy?: number;
	fx?: number;
	fy?: number;
	__w?: number;
	/** Width of the id text, measured once. */
	__idW?: number;
};
export type DrawLink = Omit<GraphLink, "source" | "target"> & {
	source: string | DrawNode;
	target: string | DrawNode;
};

export type NodeLook = {
	root: boolean;
	selected: boolean;
	dimmed: boolean;
	/** Has relations that are not in the graph yet. */
	expandable: boolean;
	/** A short name drawn on top of the badge, e.g., the query variable bound to the node. */
	tag?: string;
};
export type LinkLook = "normal" | "dim" | "hot";

export const BADGE_H = 34;
const PAD_X = 10;
const BULLET = 7;
const BULLET_GAP = 6;
const MAX_ID_CHARS = 24;
const ID_FONT = "600 12px Inter, system-ui, sans-serif";
const TYPE_FONT = "500 10px Inter, system-ui, sans-serif";
/** Zoomed out further than this, the id text would be under 6px, so nodes become plain shapes. */
const MIN_DETAIL_SCALE = 0.5;
const SHAPE_R = 6;

const HEX = /^#[0-9a-f]{6}$/i;
const palettes = new Map<
	string,
	{ base: string; fill: string; border: string; text: string; sub: string }
>();
function paletteOf(el: GraphElement) {
	const key = `${isEvent(el)}:${el.type}`;
	let p = palettes.get(key);
	if (p === undefined) {
		const raw = typeColor(isEvent(el), el.type);
		const base = HEX.test(raw) ? raw : "#64748b";
		p = {
			base,
			fill: mixHex(base, "#ffffff", 0.18),
			border: mixHex(base, "#ffffff", 0.45),
			text: mixHex(base, "#000000", 0.62),
			sub: mixHex(base, "#000000", 0.55),
		};
		palettes.set(key, p);
	}
	return p;
}

export function isDetailed(scale: number) {
	return scale >= MIN_DETAIL_SCALE;
}

function shapeRadius(scale: number, root: boolean) {
	return Math.max(SHAPE_R, 4 / scale) * (root ? 1.5 : 1);
}

function measureBadge(node: DrawNode, ctx: CanvasRenderingContext2D) {
	if (node.__w === undefined || node.__idW === undefined) {
		ctx.font = ID_FONT;
		node.__idW = ctx.measureText(truncateLabel(node.id, MAX_ID_CHARS)).width;
		ctx.font = TYPE_FONT;
		const type = ctx.measureText(node.type).width;
		node.__w = 2 * PAD_X + Math.max(BULLET + BULLET_GAP + node.__idW, type);
	}
	return node.__w;
}

/** Half width and height of what is drawn for a node, for clipping links and hit testing. */
export function nodeExtent(node: DrawNode, scale: number, root: boolean): [number, number] {
	if (!isDetailed(scale)) {
		const r = shapeRadius(scale, root);
		return [r, r];
	}
	return [(node.__w ?? 90) / 2, BADGE_H / 2];
}

/** The plus mark on nodes whose relations are not all in the graph yet. */
function drawPlus(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, scale: number) {
	ctx.beginPath();
	ctx.arc(x, y, r, 0, 2 * Math.PI);
	ctx.fillStyle = "#ffffff";
	ctx.fill();
	ctx.lineWidth = 1 / scale;
	ctx.strokeStyle = "#cbd5e1";
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(x - r * 0.45, y);
	ctx.lineTo(x + r * 0.45, y);
	ctx.moveTo(x, y - r * 0.45);
	ctx.lineTo(x, y + r * 0.45);
	ctx.lineWidth = r * 0.24;
	ctx.lineCap = "round";
	ctx.strokeStyle = "#64748b";
	ctx.stroke();
}

/** A badge tinted in the type's color as in the type graph, with the id on top and the type name
 *  below. */
export function drawNode(
	node: DrawNode,
	ctx: CanvasRenderingContext2D,
	scale: number,
	look: NodeLook,
) {
	const { x, y } = node;
	if (x === undefined || y === undefined) return;
	const ev = isEvent(node);
	const p = paletteOf(node);
	ctx.save();
	ctx.globalAlpha = look.dimmed ? 0.25 : 1;
	// The root keeps its dark ring when selected, and the blue selection ring goes around it.
	const rings: [string, number][] = [];
	if (look.root) rings.push(["#334155", 3.5]);
	if (look.selected) rings.push(["#0284c7", look.root ? 7.5 : 3.5]);

	if (!isDetailed(scale)) {
		const r = shapeRadius(scale, look.root);
		const shape = (rr: number) => {
			ctx.beginPath();
			if (ev) ctx.roundRect(x - rr, y - rr, 2 * rr, 2 * rr, rr / 3);
			else ctx.arc(x, y, rr, 0, 2 * Math.PI);
		};
		for (const [color, offset] of rings) {
			shape(r + (offset * 0.75) / scale);
			ctx.lineWidth = 2 / scale;
			ctx.strokeStyle = color;
			ctx.stroke();
		}
		shape(r);
		ctx.fillStyle = p.base;
		ctx.fill();
		ctx.lineWidth = 1.5 / scale;
		ctx.strokeStyle = "#ffffff";
		ctx.stroke();
		if (look.expandable) drawPlus(ctx, x + r * 0.8, y - r * 0.8, 3 / scale, scale);
		ctx.restore();
		return;
	}

	const w = measureBadge(node, ctx);
	const h = BADGE_H;
	const left = x - w / 2;
	const top = y - h / 2;
	const radius = ev ? 6 : h / 2;
	for (const [color, offset] of rings) {
		ctx.beginPath();
		ctx.roundRect(
			left - offset,
			top - offset,
			w + 2 * offset,
			h + 2 * offset,
			ev ? 6 + offset : (h + 2 * offset) / 2,
		);
		ctx.lineWidth = 2;
		ctx.strokeStyle = color;
		ctx.stroke();
	}
	ctx.beginPath();
	ctx.roundRect(left, top, w, h, radius);
	ctx.fillStyle = p.fill;
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = p.border;
	ctx.stroke();

	// The bullet and id are centered as one group.
	const idLineW = BULLET + BULLET_GAP + (node.__idW ?? 0);
	const bulletX = x - idLineW / 2;
	const idY = y - 6;
	ctx.fillStyle = p.base;
	ctx.beginPath();
	if (ev) ctx.roundRect(bulletX, idY - BULLET / 2, BULLET, BULLET, 1.5);
	else ctx.arc(bulletX + BULLET / 2, idY, BULLET / 2, 0, 2 * Math.PI);
	ctx.fill();

	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	ctx.font = ID_FONT;
	ctx.fillStyle = p.text;
	ctx.fillText(truncateLabel(node.id, MAX_ID_CHARS), bulletX + BULLET + BULLET_GAP, idY);
	ctx.textAlign = "center";
	ctx.font = TYPE_FONT;
	ctx.fillStyle = p.sub;
	ctx.fillText(node.type, x, y + 8);

	if (look.expandable) {
		drawPlus(ctx, ev ? left + w - 2 : left + w - h * 0.28, top + 2, 4.5, scale);
	}
	if (look.tag !== undefined) drawTag(ctx, look.tag, x, top);
	ctx.restore();
}

const TAG_FONT = "700 10.5px Inter, system-ui, sans-serif";

function drawTag(ctx: CanvasRenderingContext2D, tag: string, x: number, top: number) {
	ctx.font = TAG_FONT;
	const w = ctx.measureText(tag).width + 10;
	const h = 15;
	ctx.beginPath();
	ctx.roundRect(x - w / 2, top - h + 4, w, h, h / 2);
	ctx.fillStyle = "#334155";
	ctx.fill();
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = "#ffffff";
	ctx.stroke();
	ctx.fillStyle = "#ffffff";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(tag, x, top - h / 2 + 4.5);
}

export function paintNodeHitArea(
	node: DrawNode,
	color: string,
	ctx: CanvasRenderingContext2D,
	scale: number,
	root: boolean,
) {
	const { x, y } = node;
	if (x === undefined || y === undefined) return;
	const [hw, hh] = nodeExtent(node, scale, root);
	ctx.fillStyle = color;
	ctx.fillRect(x - hw, y - hh, 2 * hw, 2 * hh);
}

const LINK_COLOR: Record<LinkLook, string> = { normal: "#94a3b8", dim: "#e2e8f0", hot: "#334155" };

/** Draws E2O links solid and O2O links dashed, clipped to the node outlines, with an arrow and,
 *  when hot, the qualifier. */
export function drawLink(
	link: DrawLink,
	ctx: CanvasRenderingContext2D,
	scale: number,
	look: LinkLook,
	roots: ReadonlySet<string>,
) {
	const s = link.source;
	const t = link.target;
	if (typeof s !== "object" || typeof t !== "object") return;
	if (s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) return;
	const dx = t.x - s.x;
	const dy = t.y - s.y;
	if (Math.hypot(dx, dy) < 1) return;
	const gap = 2 / scale;
	const [shw, shh] = nodeExtent(s, scale, roots.has(s.id));
	const [thw, thh] = nodeExtent(t, scale, roots.has(t.id));
	const fs = boxExitFraction(dx, dy, shw + gap, shh + gap);
	const ft = boxExitFraction(dx, dy, thw + gap, thh + gap);
	if (fs + ft >= 1) return;
	const x1 = s.x + dx * fs;
	const y1 = s.y + dy * fs;
	const x2 = t.x - dx * ft;
	const y2 = t.y - dy * ft;
	const color = LINK_COLOR[look];
	ctx.save();
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineWidth = (look === "hot" ? 2 : 1.25) / scale;
	ctx.setLineDash(isEvent(s) ? [] : [6 / scale, 3 / scale]);
	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
	ctx.setLineDash([]);

	const len = Math.hypot(x2 - x1, y2 - y1) || 1;
	const ux = (x2 - x1) / len;
	const uy = (y2 - y1) / len;
	const al = 7 / scale;
	const aw = 3.5 / scale;
	ctx.beginPath();
	ctx.moveTo(x2, y2);
	ctx.lineTo(x2 - ux * al - uy * aw, y2 - uy * al + ux * aw);
	ctx.lineTo(x2 - ux * al + uy * aw, y2 - uy * al - ux * aw);
	ctx.closePath();
	ctx.fill();

	if (look === "hot" && link.qualifier !== "") {
		const fontPx = 10.5 / scale;
		ctx.font = `italic 500 ${fontPx}px Inter, system-ui, sans-serif`;
		const tw = ctx.measureText(link.qualifier).width;
		const mx = (x1 + x2) / 2;
		const my = (y1 + y2) / 2;
		const px = 5 / scale;
		const ph = fontPx + 4 / scale;
		ctx.beginPath();
		ctx.roundRect(mx - tw / 2 - px, my - ph / 2, tw + 2 * px, ph, 4 / scale);
		ctx.fillStyle = "#ffffff";
		ctx.fill();
		ctx.lineWidth = 1 / scale;
		ctx.strokeStyle = "#cbd5e1";
		ctx.stroke();
		ctx.fillStyle = "#334155";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(link.qualifier, mx, my);
	}
	ctx.restore();
}

/** Pushes overlapping badges apart along the axis where they overlap least. The pairwise check is
 *  fast enough for the few hundred nodes shown. */
export function collideForce(margin = 10, strength = 0.6) {
	let nodes: DrawNode[] = [];
	const force = () => {
		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i];
			const aw = (a.__w ?? 90) / 2;
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j];
				const dx = (b.x ?? 0) + (b.vx ?? 0) - (a.x ?? 0) - (a.vx ?? 0);
				const dy = (b.y ?? 0) + (b.vy ?? 0) - (a.y ?? 0) - (a.vy ?? 0);
				const ox = aw + (b.__w ?? 90) / 2 + margin - Math.abs(dx);
				const oy = BADGE_H + margin - Math.abs(dy);
				if (ox <= 0 || oy <= 0) continue;
				const sx = dx === 0 ? Math.random() - 0.5 : Math.sign(dx);
				const sy = dy === 0 ? Math.random() - 0.5 : Math.sign(dy);
				if (ox < oy) {
					const push = ox * strength * 0.5 * sx;
					b.vx = (b.vx ?? 0) + push;
					a.vx = (a.vx ?? 0) - push;
				} else {
					const push = oy * strength * 0.5 * sy;
					b.vy = (b.vy ?? 0) + push;
					a.vy = (a.vy ?? 0) - push;
				}
			}
		}
	};
	force.initialize = (ns: DrawNode[]) => {
		nodes = ns;
	};
	return force;
}

/** Pulls each node towards the circle around the origin (where the root is pinned) that
 *  `radiusOf` gives it; nodes without one move freely. */
export function ringForce(radiusOf: (node: DrawNode) => number | undefined, strength = 0.5) {
	let nodes: DrawNode[] = [];
	const force = (alpha: number) => {
		for (const n of nodes) {
			const r = radiusOf(n);
			if (r === undefined || r === 0 || n.x === undefined || n.y === undefined) continue;
			const d = Math.hypot(n.x, n.y) || 1e-3;
			const k = ((r - d) / d) * strength * alpha;
			n.vx = (n.vx ?? 0) + n.x * k;
			n.vy = (n.vy ?? 0) + n.y * k;
		}
	};
	force.initialize = (ns: DrawNode[]) => {
		nodes = ns;
	};
	return force;
}
