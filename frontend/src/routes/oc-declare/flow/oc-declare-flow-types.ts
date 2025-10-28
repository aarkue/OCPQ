
import { Edge, Node } from "@xyflow/react";
import { OCDeclareArcLabel } from "../types/OCDeclareArcLabel";

export type ActivityNodeData = { type: string, isObject?: "init" | "exit" };
export type ActivityNodeType = Node<ActivityNodeData, 'activity'>;
export const ALL_EDGE_TYPES = [
    // "ass",
    "ef",
    "ef-rev",
    "nef",
    "nef-rev",
    "df",
    "df-rev",
    "ndf",
    "ndf-rev",
    "as"] as const;
export type EdgeType = typeof ALL_EDGE_TYPES[number];
export type CustomEdgeData = { type: EdgeType, objectTypes: OCDeclareArcLabel, cardinality?: [number | null, number | null], violationInfo?: { violationPercentage: number } };
export type CustomEdgeType = Edge<CustomEdgeData>;
export type AppNode = ActivityNodeType;
