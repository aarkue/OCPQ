import type { Edge, Node, ReactFlowJsonObject } from "@xyflow/react";
import type {
	EvaluationResPerNodes,
	EventTypeLinkData,
	EventTypeNodeData,
	GateNodeData,
} from "@/routes/visual-editor/helper/types";

export type FlowAndViolationData = {
	flowJson: ReactFlowJsonObject<Node<EventTypeNodeData | GateNodeData>, Edge<EventTypeLinkData>>;
	violations?: EvaluationResPerNodes;
};
