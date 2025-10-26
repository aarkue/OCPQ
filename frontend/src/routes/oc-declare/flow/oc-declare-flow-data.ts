import type { ReactFlowJsonObject } from "@xyflow/react";
import { ActivityNodeType, CustomEdgeType } from "./oc-declare-flow-types";

export type OCDeclareFlowData = {
  flowJson: ReactFlowJsonObject<
   ActivityNodeType,
   CustomEdgeType
  >;
};
