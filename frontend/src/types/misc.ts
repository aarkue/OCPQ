import type {
  EvaluationResPerNodes,
  EventTypeLinkData,
  EventTypeNodeData,
  GateNodeData,
} from "@/routes/visual-editor/helper/types";
import type { ReactFlowJsonObject, Node, Edge, } from "@xyflow/react";

export type FlowAndViolationData = {
  flowJson: ReactFlowJsonObject<
    Node<EventTypeNodeData | GateNodeData>,
    Edge<EventTypeLinkData>
  >;
  violations?: EvaluationResPerNodes;
};
