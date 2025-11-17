import { createContext } from "react";
import type { Edge, Node, ReactFlowInstance, Viewport } from "@xyflow/react";
import type {
  EvaluationResPerNodes,
  EventTypeLinkData,
  EventTypeNodeData,
  GateNodeData,
} from "./types";

type TypedFlowInstance = 
ReactFlowInstance<Node<EventTypeNodeData | GateNodeData>,Edge<EventTypeLinkData>>;

export const FlowContext = createContext<{

  instance:  TypedFlowInstance | undefined;
  registerOtherDataGetter: (
    getter: () =>
      | {
          violations?: EvaluationResPerNodes;
        }
      | undefined,
  ) => unknown;
  setInstance: (i: TypedFlowInstance | undefined) => unknown;
  otherData:
    | {
        violations?: EvaluationResPerNodes;
        nodes?: Node<EventTypeNodeData | GateNodeData>[];
        edges?: Edge<EventTypeLinkData>[];
        viewport?: Viewport;
      }
    | undefined;
  flushData: (
    data:
      | {
          violations?: EvaluationResPerNodes;
        }
      | undefined,
  ) => unknown;
}>({
  instance: undefined,
  registerOtherDataGetter: () => () => undefined,
  setInstance: () => {},
  otherData: undefined,
  flushData: () => {},
});
