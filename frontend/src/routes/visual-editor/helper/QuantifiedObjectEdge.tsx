import {
	BaseEdge,
	type Edge,
	type EdgeProps,
	getBezierPath,
	type Node,
	Position,
	useReactFlow,
} from "@xyflow/react";
import type { EventTypeNodeData, GateNodeData } from "./types";

const STROKE_WIDTH = 4;
const ARROW_LENGTH = 14;
const ARROW_HALF_WIDTH = ARROW_LENGTH / 1.5;
const ARROW_ANGLE_REF_DISTANCE = ARROW_LENGTH / 8;

// Mirrors the control point math of @xyflow/system getBezierPath (default curvature)
function getControlPoint(pos: Position, x1: number, y1: number, x2: number, y2: number) {
	const curvature = 0.25;
	const offset = (distance: number) =>
		distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance);
	switch (pos) {
		case Position.Left:
			return { x: x1 - offset(x1 - x2), y: y1 };
		case Position.Right:
			return { x: x1 + offset(x2 - x1), y: y1 };
		case Position.Top:
			return { x: x1, y: y1 - offset(y1 - y2) };
		case Position.Bottom:
			return { x: x1, y: y1 + offset(y2 - y1) };
	}
}

export default function QuantifiedObjectEdge({
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	target,
	selected,
}: EdgeProps<Edge<Record<string, unknown>>>) {
	const flow = useReactFlow<Node<EventTypeNodeData | GateNodeData>>();

	const targetNode: Node<EventTypeNodeData | GateNodeData> | undefined = flow.getNode(target);

	const pathStyle: React.CSSProperties = {
		stroke: "#646464",
		strokeWidth: STROKE_WIDTH,
		strokeDasharray: selected === true ? "7 3" : undefined,
	};

	const shiftedSourceY = sourceY - (targetNode?.type === "gate" ? 0 : 5);

	// Orient the arrowhead along the visible curve near its end (secant), not the
	// analytic end tangent: the tangent is always perpendicular to the handle side,
	// which visibly mismatches the arc for short or strongly-curved edges.
	const p0 = { x: sourceX, y: shiftedSourceY };
	const p3 = { x: targetX, y: targetY };
	const c1 = getControlPoint(sourcePosition, sourceX, shiftedSourceY, targetX, targetY);
	const c2 = getControlPoint(targetPosition, targetX, targetY, sourceX, shiftedSourceY);
	const bezierPoint = (t: number) => {
		const u = 1 - t;
		return {
			x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
			y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
		};
	};
	let refPoint = bezierPoint(0.8);
	let walked = 0;
	let prev = p3;
	const SAMPLES = 32;
	for (let i = 1; i <= SAMPLES; i++) {
		const p = bezierPoint(1 - (0.2 * i) / SAMPLES);
		walked += Math.hypot(prev.x - p.x, prev.y - p.y);
		prev = p;
		if (walked >= ARROW_ANGLE_REF_DISTANCE) {
			refPoint = p;
			break;
		}
	}
	const arrowRad = Math.atan2(targetY - refPoint.y, targetX - refPoint.x);
	const arrowAngle = (arrowRad * 180) / Math.PI;

	// End the drawn line at the arrow base: near the tip the triangle is narrower
	// than the stroke, so a line reaching the tip pokes out beside the arrowhead.
	const pathEndX = targetX - Math.cos(arrowRad) * (ARROW_LENGTH - 2);
	const pathEndY = targetY - Math.sin(arrowRad) * (ARROW_LENGTH - 2);
	const [edgePath] = getBezierPath({
		sourceX,
		sourceY: shiftedSourceY,
		sourcePosition,
		targetX: pathEndX,
		targetY: pathEndY,
		targetPosition,
	});

	return (
		<>
			<BaseEdge path={edgePath} style={pathStyle} />
			<polygon
				points={`0,0 ${-ARROW_LENGTH},${-ARROW_HALF_WIDTH} ${-ARROW_LENGTH},${ARROW_HALF_WIDTH}`}
				fill="#646464"
				transform={`translate(${targetX},${targetY}) rotate(${Math.round(100 * arrowAngle) / 100})`}
			/>
		</>
	);
}
