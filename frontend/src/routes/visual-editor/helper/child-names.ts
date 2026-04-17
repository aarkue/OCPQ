import type { Edge } from "@xyflow/react";
import type { EventTypeLinkData } from "./types";

export function getAvailableChildNamesWithEdges(edges: Edge<EventTypeLinkData>[], nodeID: string) {
	return edges
		.filter((e) => e.source === nodeID)
		.map((e) => e.data?.name)
		.filter((e) => e) as string[];
}
