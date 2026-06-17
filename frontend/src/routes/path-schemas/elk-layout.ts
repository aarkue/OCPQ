import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

type Point = { x: number; y: number };

export interface LayoutNode {
	id: string;
	width: number;
	height: number;
}

export interface LayoutEdge {
	id: string;
	source: string;
	target: string;
}

export interface LayoutResult {
	nodes: Map<string, { x: number; y: number }>;
	edges: Map<string, { path: string }>;
}

interface ElkSection {
	startPoint: Point;
	bendPoints?: Point[];
	endPoint: Point;
}

function sectionToPoints(section: ElkSection): Point[] {
	return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
}

function pointsToSvgPath(points: Point[]): string {
	if (points.length === 0) return "";
	let d = `M${points[0].x},${points[0].y}`;
	let i = 1;
	while (i < points.length) {
		const remaining = points.length - i;
		if (remaining >= 3) {
			d += ` C${points[i].x},${points[i].y} ${points[i + 1].x},${points[i + 1].y} ${points[i + 2].x},${points[i + 2].y}`;
			i += 3;
		} else if (remaining === 2) {
			d += ` Q${points[i].x},${points[i].y} ${points[i + 1].x},${points[i + 1].y}`;
			i += 2;
		} else {
			d += ` L${points[i].x},${points[i].y}`;
			i += 1;
		}
	}
	return d;
}

function rectBorderPoint(center: Point, halfW: number, halfH: number, towards: Point): Point {
	const dx = towards.x - center.x;
	const dy = towards.y - center.y;
	if (dx === 0 && dy === 0) return { x: center.x + halfW, y: center.y };
	const absDx = Math.abs(dx);
	const absDy = Math.abs(dy);
	if (absDx * halfH > absDy * halfW) {
		const sx = Math.sign(dx);
		return { x: center.x + sx * halfW, y: center.y + (dy / absDx) * halfW };
	}
	const sy = Math.sign(dy);
	return { x: center.x + (dx / absDy) * halfH, y: center.y + sy * halfH };
}

function snapEndpoints(
	points: Point[],
	srcCenter: Point,
	tgtCenter: Point,
	srcHalfW: number,
	srcHalfH: number,
	tgtHalfW: number,
	tgtHalfH: number,
): Point[] {
	if (points.length < 2) return points;
	const result = [...points];
	result[0] = rectBorderPoint(srcCenter, srcHalfW, srcHalfH, points[1]);
	const last = points.length - 1;
	result[last] = rectBorderPoint(tgtCenter, tgtHalfW, tgtHalfH, points[last - 1]);
	return result;
}

export async function layoutTypeGraph(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
): Promise<LayoutResult> {
	const graph: ElkNode = {
		id: "root",
		layoutOptions: {
			"elk.algorithm": "layered",
			"elk.direction": "DOWN",
			"elk.spacing.nodeNode": "28",
			"elk.layered.spacing.nodeNodeBetweenLayers": "70",
			"elk.spacing.edgeNode": "18",
			"elk.spacing.edgeEdge": "12",
			"elk.edgeRouting": "SPLINES",
			"elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
			"elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
			"elk.aspectRatio": "1.7",
		},
		children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
		edges: edges.map((e) => ({
			id: e.id,
			sources: [e.source],
			targets: [e.target],
		})) as ElkExtendedEdge[],
	};

	const laid = await elk.layout(graph);

	const nodeMap = new Map(nodes.map((n) => [n.id, n]));
	const nodePositions = new Map<string, { x: number; y: number }>();
	const nodeSizes = new Map<string, { w: number; h: number }>();
	for (const child of laid.children ?? []) {
		nodePositions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
		const orig = nodeMap.get(child.id);
		nodeSizes.set(child.id, {
			w: orig?.width ?? child.width ?? 100,
			h: orig?.height ?? child.height ?? 32,
		});
	}

	const edgeMap = new Map(edges.map((e) => [e.id, e]));
	const edgeRoutes = new Map<string, { path: string }>();
	for (const elkEdge of laid.edges ?? []) {
		const section = (elkEdge as ElkExtendedEdge).sections?.[0] as ElkSection | undefined;
		if (!section) continue;
		let points = sectionToPoints(section);
		const lookup = edgeMap.get(elkEdge.id);
		if (lookup) {
			const srcPos = nodePositions.get(lookup.source);
			const tgtPos = nodePositions.get(lookup.target);
			const srcSize = nodeSizes.get(lookup.source);
			const tgtSize = nodeSizes.get(lookup.target);
			if (srcPos && tgtPos && srcSize && tgtSize) {
				const srcCenter = { x: srcPos.x + srcSize.w / 2, y: srcPos.y + srcSize.h / 2 };
				const tgtCenter = { x: tgtPos.x + tgtSize.w / 2, y: tgtPos.y + tgtSize.h / 2 };
				points = snapEndpoints(
					points,
					srcCenter,
					tgtCenter,
					srcSize.w / 2,
					srcSize.h / 2,
					tgtSize.w / 2,
					tgtSize.h / 2,
				);
			}
		}
		edgeRoutes.set(elkEdge.id, { path: pointsToSvgPath(points) });
	}

	return { nodes: nodePositions, edges: edgeRoutes };
}
