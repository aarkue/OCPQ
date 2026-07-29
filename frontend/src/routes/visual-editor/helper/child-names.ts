import type { Edge } from "@xyflow/react";
import type { EventTypeLinkData } from "./types";

export function getAvailableChildNamesWithEdges(edges: Edge<EventTypeLinkData>[], nodeID: string) {
	return edges
		.filter((e) => e.source === nodeID)
		.map((e) => e.data?.name)
		.filter((e) => e) as string[];
}

export function getNamesInConnectedTreeWithEdges(edges: Edge<EventTypeLinkData>[], nodeID: string) {
	const visited = new Set<string>([nodeID]);
	const queue = [nodeID];
	const names = new Set<string>();
	for (let i = 0; i < queue.length; i++) {
		const current = queue[i];
		for (const e of edges) {
			if (e.source !== current && e.target !== current) {
				continue;
			}
			if (e.data?.name !== undefined) {
				names.add(e.data.name);
			}
			const other = e.source === current ? e.target : e.source;
			if (!visited.has(other)) {
				visited.add(other);
				queue.push(other);
			}
		}
	}
	return [...names];
}
