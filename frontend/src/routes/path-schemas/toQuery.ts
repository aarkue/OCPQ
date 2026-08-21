import { v4 } from "uuid";
import {
	parseLocalStorageValue,
	QUERY_LOCALSTORAGE_OPEN_INDEX,
	QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META,
	QUERY_LOCALSTORAGE_SAVE_KEY_DATA,
} from "@/lib/local-storage";
import { bindingBoxTreeToNodes } from "@/routes/visual-editor/helper/constructNodes";
import { applyLayoutToNodes } from "@/routes/visual-editor/helper/LayoutFlow";
import type { ConstraintInfo } from "@/routes/visual-editor/helper/types";
import type { BindingBoxTree } from "@/types/generated/BindingBoxTree";
import type { PathSchemaInfo } from "@/types/generated/PathSchemaInfo";
import type { TemporalMode } from "@/types/generated/TemporalMode";
import type { FlowAndViolationData } from "@/types/misc";
import { schemasToBindingBoxTree, schemaToBindingBoxTree } from "./pathSchemaQueryBuilder";

export { schemasToBindingBoxTree, schemaToBindingBoxTree };

async function saveQuery(tree: BindingBoxTree, name: string, description: string): Promise<number> {
	const [nodes, edges] = bindingBoxTreeToNodes(tree, 0, 0, 0, v4());
	await applyLayoutToNodes(nodes, edges);

	const meta = parseLocalStorageValue<ConstraintInfo[]>(
		localStorage.getItem(QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META) ?? "[]",
	);
	const data = parseLocalStorageValue<FlowAndViolationData[]>(
		localStorage.getItem(QUERY_LOCALSTORAGE_SAVE_KEY_DATA) ?? "[]",
	);

	const index = meta.length;
	meta.push({ name, description });
	data[index] = { flowJson: { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } } };

	localStorage.setItem(QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META, JSON.stringify(meta));
	localStorage.setItem(QUERY_LOCALSTORAGE_SAVE_KEY_DATA, JSON.stringify(data));
	localStorage.setItem(QUERY_LOCALSTORAGE_OPEN_INDEX, String(index));
	return index;
}

/** Build the query, append it to the constraints editor's storage, and return its index.
 *  Navigate to /constraints afterwards to open it. */
export async function openSchemaAsQuery(
	info: PathSchemaInfo,
	temporal: TemporalMode,
	boundedSeconds: number,
): Promise<number> {
	const tree = schemaToBindingBoxTree(info, temporal, boundedSeconds);
	return saveQuery(
		tree,
		`Path: ${info.source.name} -> ${info.target.name}`,
		"Generated from a path schema",
	);
}

/** Build one query all selected path schemas must satisfy together, append it, and return
 *  its index. Navigate to /constraints afterwards to open it. Throws if the schemas don't
 *  share source and target types (see `schemasToBindingBoxTree`). */
export async function openSchemasAsCombinedQuery(
	infos: PathSchemaInfo[],
	temporal: TemporalMode,
	boundedSeconds: number,
): Promise<number> {
	const tree = schemasToBindingBoxTree(infos, temporal, boundedSeconds);
	const name = `Paths (${infos.length}): ${infos[0].source.name} -> ${infos[0].target.name}`;
	return saveQuery(tree, name, `Generated from ${infos.length} selected path schemas`);
}
