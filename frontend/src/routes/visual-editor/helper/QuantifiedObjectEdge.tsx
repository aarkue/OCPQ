import {
  BaseEdge,
  Edge,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
  type Node,
} from "@xyflow/react";
import type { EventTypeNodeData, GateNodeData } from "./types";

const STROKE_WIDTH = 4;

export default function QuantifiedObjectEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  target,
  selected,
}: EdgeProps<Edge<Record<string, unknown>>>) {
  const flow = useReactFlow<Node<EventTypeNodeData | GateNodeData>>();

  const targetNode: Node<EventTypeNodeData | GateNodeData> | undefined =
    flow.getNode(target);


  const pathStyle: React.CSSProperties = {
    stroke: selected === true ? "#646464" : "#646464",
    strokeWidth: STROKE_WIDTH,
    marginLeft: "1rem",
    strokeDasharray: selected === true ? "7 3" : undefined,
  };

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY: sourceY - (targetNode?.type === "gate" ? 0 : 5),
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <BaseEdge path={edgePath} markerEnd={markerEnd} style={pathStyle} />
  );
}
