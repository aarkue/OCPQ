import type { QueryTypes } from "@/routes/visual-editor/outer-visual-editor/query-list";
import type { PersistedFlow } from "./OCDeclareEditor";

/** The activities and object types a saved OC-DECLARE model mentions, sorted. Object types come
 *  from object nodes and from the associations on every arc. */
export function typesOfOCDeclareFlow(flow: PersistedFlow | undefined): QueryTypes {
	const events = new Set<string>();
	const objects = new Set<string>();
	for (const node of flow?.nodes ?? []) {
		const type = node.data?.type;
		if (typeof type !== "string") continue;
		(node.data.isObject === undefined ? events : objects).add(type);
	}
	for (const edge of flow?.edges ?? []) {
		const label = edge.data?.objectTypes;
		for (const assoc of [...(label?.each ?? []), ...(label?.any ?? []), ...(label?.all ?? [])]) {
			if (assoc.type === "Simple") objects.add(assoc.object_type);
			else {
				objects.add(assoc.first);
				objects.add(assoc.second);
			}
		}
	}
	return { events: [...events].sort(), objects: [...objects].sort() };
}
