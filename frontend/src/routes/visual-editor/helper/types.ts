import type { BindingBox } from "@/types/generated/BindingBox";
import type { BindingBoxTree } from "@/types/generated/BindingBoxTree";
import type { BindingBoxTreeNode } from "@/types/generated/BindingBoxTreeNode";
import type { EvaluationResultWithCount } from "@/types/generated/EvaluationResultWithCount";

export type EvaluationResPerNodes = {
  evalRes: Record<string, EvaluationRes>;
  objectIds: string[];
  eventIds: string[];
  evalNodes: Record<string, BindingBoxTreeNode>;
  nodeIdtoIndex: Record<string, number>;
};
export type EvaluationRes = EvaluationResultWithCount;

export type CountConstraint = { min: number; max: number };

export type EventTypeNodeData = {
  hideViolations?: boolean;
  box: BindingBox;
};

export const ALL_GATE_TYPES = ["not", "or", "and"];
export type GateNodeData = { type: "not" | "or" | "and" };

export type TimeConstraint = { minSeconds: number; maxSeconds: number };
export type EventTypeLinkData = {
  color: string;
  minCount: number | null;
  maxCount: number | null;
  name?: string;
};

export type DiscoverConstraintsRequest = {
  countConstraints?: {
    objectTypes: string[];
    eventTypes: string[];
    coverFraction: number;
  };
  eventuallyFollowsConstraints?: {
    objectTypes: string[];
    coverFraction: number;
  };
  orConstraints?: {
    objectTypes: string[];
    eventTypes: string[];
    coverFraction: number;
  };
};

export type DiscoverConstraintsRequestWrapper = DiscoverConstraintsRequest & {
  countConstraints: { enabled: boolean };
  eventuallyFollowsConstraints: { enabled: boolean };
  orConstraints: { enabled: boolean };
};

export type DiscoverConstraintsResponse = {
  constraints: [string, BindingBoxTree][];
};

export type ConstraintInfo = { name: string; description: string };
