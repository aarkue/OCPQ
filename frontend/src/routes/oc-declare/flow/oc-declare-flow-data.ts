import type { ReactFlowJsonObject } from "@xyflow/react";
import type { ActivityNodeType, CustomEdgeType } from "./oc-declare-flow-types";

export type OCDeclareFlowData = {
	flowJson: ReactFlowJsonObject<ActivityNodeType, CustomEdgeType>;
};

export type OCDeclareMetaData = { name: string; id: string; description?: string };
