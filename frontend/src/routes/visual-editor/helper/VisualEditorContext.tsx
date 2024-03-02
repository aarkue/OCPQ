import { createContext } from "react";
import type {
  EventTypeLinkData,
  EventTypeNodeData,
  ViolationsPerNode,
  ViolationsPerNodes,
} from "./types";
import type { OCELInfo } from "@/types/ocel";

export type VisualEditorContextValue = {
  violationsPerNode?: ViolationsPerNodes;
  showViolationsFor?: (data: ViolationsPerNode) => unknown;
  onNodeDataChange: (
    id: string,
    newData: Partial<EventTypeNodeData> | undefined,
  ) => unknown;
  onEdgeDataChange: (
    id: string,
    newData: Partial<EventTypeLinkData> | undefined,
  ) => unknown;
  ocelInfo?: OCELInfo;
};

export const VisualEditorContext = createContext<VisualEditorContextValue>({
  onNodeDataChange: () => {},
  onEdgeDataChange: () => {},
});