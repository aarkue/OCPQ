import type { Edge, Node } from "@xyflow/react";
import type { IconType } from "react-icons";
import { LuBox } from "react-icons/lu";
import { MdEvent, MdTableChart } from "react-icons/md";
import { TbArrowsJoin, TbFilter, TbRelationManyToMany, TbStack2 } from "react-icons/tb";
import type { DataSourceColumnInfo } from "@/types/generated/DataSourceColumnInfo";
import type { DataSourceTableInfo } from "@/types/generated/DataSourceTableInfo";
import type { DataSource } from "../data-extraction-types";

export type { AttributeConfig } from "@/types/generated/AttributeConfig";
export type { AttributeMapping } from "@/types/generated/AttributeMapping";
export type { ChangeTableCondition } from "@/types/generated/ChangeTableCondition";
export type { ChangeTableEventRule } from "@/types/generated/ChangeTableEventRule";
export type { DataExtractionBlueprint } from "@/types/generated/DataExtractionBlueprint";
export type { DataSourceConfig } from "@/types/generated/DataSourceConfig";
export type { InlineObjectReference } from "@/types/generated/InlineObjectReference";
export type { JoinType } from "@/types/generated/JoinType";
export type { MultiValueConfig } from "@/types/generated/MultiValueConfig";
export type { ObjectTypeSpec } from "@/types/generated/ObjectTypeSpec";
export type { TableExtractionConfig } from "@/types/generated/TableExtractionConfig";
export type { TableUsageData } from "@/types/generated/TableUsageData";
export type { TimestampFormat } from "@/types/generated/TimestampFormat";
export type { TimestampSource } from "@/types/generated/TimestampSource";
export type { TransformOperation } from "@/types/generated/TransformOperation";
export type { TransformSource } from "@/types/generated/TransformSource";
// ---- Re-export generated types (single source of truth) ----
export type { ValueExpression } from "@/types/generated/ValueExpression";
export type { VirtualTableConfig } from "@/types/generated/VirtualTableConfig";

// ---- Local imports for use in this file ----
import type { ChangeTableCondition } from "@/types/generated/ChangeTableCondition";
import type { DataExtractionBlueprint } from "@/types/generated/DataExtractionBlueprint";
import type { DataSourceConfig } from "@/types/generated/DataSourceConfig";
import type { TableExtractionConfig } from "@/types/generated/TableExtractionConfig";
import type { TableUsageData } from "@/types/generated/TableUsageData";
import type { TimestampSource } from "@/types/generated/TimestampSource";
import type { TransformOperation } from "@/types/generated/TransformOperation";
import type { TransformSource } from "@/types/generated/TransformSource";
import type { ValueExpression } from "@/types/generated/ValueExpression";
import type { VirtualTableConfig } from "@/types/generated/VirtualTableConfig";

// ---- Derived convenience type ----
export type BaseChangeTableCondition = Exclude<
	ChangeTableCondition,
	{ type: "OR" } | { type: "AND" }
>;

// ---- Constants ----

export const DEFAULT_VALUE_EXPR: ValueExpression = {
	type: "column",
	column: "",
};

export const DEFAULT_TIMESTAMP_SOURCE: TimestampSource = {
	type: "column",
	column: "",
	format: { type: "auto" },
};

// ---- Helper functions ----

/** Extract all column names referenced by a ValueExpression */
export function getColumnsFromExpr(expr: ValueExpression | null | undefined): string[] {
	if (!expr) return [];
	switch (expr.type) {
		case "column":
			return expr.column ? [expr.column] : [];
		case "constant":
			return [];
		case "template": {
			const matches = expr.template.matchAll(/\{([^}]+)\}/g);
			return [...matches].map((m) => m[1]);
		}
	}
}

/** Extract all column names referenced by a TimestampSource */
export function getColumnsFromTimestamp(ts: TimestampSource | null | undefined): string[] {
	if (!ts) return [];
	if (ts.type === "column") return ts.column ? [ts.column] : [];
	if (ts.type === "constant") return [];
	const cols: string[] = [];
	if (ts.date_column) cols.push(ts.date_column);
	if (ts.time_column) cols.push(ts.time_column);
	return cols;
}

/** Recursively collect all column names referenced by a ChangeTableCondition tree */
export function getColumnsFromCondition(cond: ChangeTableCondition): string[] {
	if (cond.type === "AND" || cond.type === "OR") {
		return cond.conditions.flatMap(getColumnsFromCondition);
	}
	return cond.column ? [cond.column] : [];
}

// ---- Table Usage ----

export type TableUsageType = TableUsageData["mode"];

/** Central registry for all extraction modes. Single source of truth for labels, icons, etc. */
export const MODE_REGISTRY: Record<
	TableUsageType,
	{
		label: string;
		description: string;
		icon: IconType;
		iconColor: string;
		category: ExtractorCategory;
	}
> = {
	event: {
		label: "Event",
		description: "Each row produces one event",
		icon: MdEvent,
		iconColor: "text-pink-500",
		category: "event",
	},
	object: {
		label: "Object",
		description: "Each row produces one object",
		icon: LuBox,
		iconColor: "text-blue-500",
		category: "object",
	},
	"e2o-relation": {
		label: "E2O Relation",
		description: "Event → Object links",
		icon: TbRelationManyToMany,
		iconColor: "text-purple-500",
		category: "relation",
	},
	"o2o-relation": {
		label: "O2O Relation",
		description: "Object → Object links",
		icon: TbRelationManyToMany,
		iconColor: "text-indigo-500",
		category: "relation",
	},
	"change-table-events": {
		label: "Events (Change Table)",
		description: "Rule-based event derivation",
		icon: MdTableChart,
		iconColor: "text-orange-500",
		category: "event",
	},
};

export const ALL_TABLE_USAGE_MODES = Object.keys(MODE_REGISTRY) as TableUsageType[];

export const TABLE_USAGE_MODE_LABELS: Record<TableUsageType, string> = Object.fromEntries(
	ALL_TABLE_USAGE_MODES.map((m) => [m, MODE_REGISTRY[m].label]),
) as Record<TableUsageType, string>;

export function getDefaultUsageDataForMode(mode: TableUsageType): TableUsageData {
	switch (mode) {
		case "event":
			return {
				mode,
				event_type: { type: "constant", value: "" },
				id: null,
				timestamp: { ...DEFAULT_TIMESTAMP_SOURCE },
				inline_object_references: [],
			};
		case "object":
			return {
				mode,
				object_type: { type: "constant", value: "" },
				id: { ...DEFAULT_VALUE_EXPR },
				prefix_id_with_type: false,
				timestamp: null,
				attribute_config: null,
			};
		case "e2o-relation":
			return {
				mode,
				source_event: { ...DEFAULT_VALUE_EXPR },
				target_object: { ...DEFAULT_VALUE_EXPR },
				qualifier: null,
				target_object_type: null,
				target_object_multi: null,
			};
		case "o2o-relation":
			return {
				mode,
				source_object: { ...DEFAULT_VALUE_EXPR },
				target_object: { ...DEFAULT_VALUE_EXPR },
				qualifier: null,
				source_object_type: null,
				target_object_type: null,
				source_object_multi: null,
				target_object_multi: null,
			};
		case "change-table-events":
			return {
				mode,
				timestamp: { ...DEFAULT_TIMESTAMP_SOURCE },
				id: null,
				event_rules: [],
				inline_object_references: [],
			};
	}
}

/** Get a short human-readable preview of a ValueExpression using sample data */
export function getExprPreview(
	expr: ValueExpression | null | undefined,
	previewData?: Array<Record<string, string>>,
	maxSamples = 2,
): string | undefined {
	if (!expr) return undefined;
	switch (expr.type) {
		case "constant":
			return expr.value || undefined;
		case "column": {
			if (!expr.column) return undefined;
			if (!previewData || previewData.length === 0) return expr.column;
			const unique = [
				...new Set(previewData.map((r) => r[expr.column]).filter((v) => v != null && v !== "")),
			];
			if (unique.length === 0) return expr.column;
			const shown = unique.slice(0, maxSamples).join(", ");
			return unique.length > maxSamples ? `${shown}, ...` : shown;
		}
		case "template":
			return expr.template || undefined;
	}
}

/** Build a short summary label for a table usage configuration */
export function getUsageSummaryLabel(
	usage: TableUsageData | undefined,
	previewData?: Array<Record<string, string>>,
): string {
	if (!usage) return "Unused";

	switch (usage.mode) {
		case "event": {
			const preview = getExprPreview(usage.event_type, previewData);
			return preview ? `${preview} events` : "Events";
		}
		case "object": {
			const preview = getExprPreview(usage.object_type, previewData);
			const suffix = usage.attribute_config ? " (changes)" : "";
			return preview ? `${preview} objects${suffix}` : `Objects${suffix}`;
		}
		case "e2o-relation":
			return "E2O Relation";
		case "o2o-relation":
			return "O2O Relation";
		case "change-table-events": {
			const names = usage.event_rules.map((r) => r.event_type).filter((t) => t);
			if (names.length === 0) return "Change table events";
			const shown = names.slice(0, 2).join(", ");
			return names.length > 2 ? `${shown}, ... events` : `${shown} events`;
		}
	}
}

// ---- Extractor Node Types ----

/** Category of extractor node for visual styling */
export type ExtractorCategory = "event" | "object" | "relation";

/** Map usage mode to its visual category */
export function getExtractorCategory(mode: TableUsageType): ExtractorCategory {
	return MODE_REGISTRY[mode].category;
}

/** Extractor menu items derived from the registry */
export const EXTRACTOR_MENU_ITEMS = ALL_TABLE_USAGE_MODES.map((mode) => ({
	mode,
	...MODE_REGISTRY[mode],
}));

// ---- Transform Types ----

export type TransformType = TransformOperation["type"];

export const TRANSFORM_MENU_ITEMS: Array<{
	type: TransformType;
	label: string;
	description: string;
	icon: IconType;
}> = [
	{
		type: "filter",
		label: "Filter",
		description: "Keep rows matching condition",
		icon: TbFilter,
	},
	{
		type: "join",
		label: "Join",
		description: "Merge with another table",
		icon: TbArrowsJoin,
	},
	{
		type: "union",
		label: "Union",
		description: "Combine rows from multiple tables",
		icon: TbStack2,
	},
];

// ---- Flow Node/Edge Types ----

/** Table node: pure data source, no extraction config */
export interface TableNodeData {
	sourceId: string;
	sourceName: string;
	tableName: string;
	tableInfo: DataSourceTableInfo;
	previewData?: Array<Record<string, string>>;
	showPreview?: boolean;
	[key: string]: unknown;
}

/** Extractor node: consumes rows from a source, produces OCEL elements */
export interface ExtractorNodeData {
	/** User-provided label for this extractor */
	label: string;
	/** The extraction mode (fixed at creation) */
	extractorMode: TableUsageType;
	/** The extraction configuration (same as TableUsageData) */
	usage: TableUsageData;
	[key: string]: unknown;
}

/** Transform node: derives rows from one or more sources */
export interface TransformNodeData {
	/** User-provided label */
	label: string;
	/** The transform operation type (fixed at creation) */
	transformType: TransformType;
	/** Operation-specific config (e.g., condition for filter, join columns for join) */
	config: TransformOperationConfig;
	[key: string]: unknown;
}

/** Simplified transform config stored on the node (sources resolved from edges) */
export type TransformOperationConfig =
	| {
			type: "filter";
			condition: import("@/types/generated/ChangeTableCondition").ChangeTableCondition;
	  }
	| {
			type: "join";
			join_type: import("@/types/generated/JoinType").JoinType;
			on: Array<[string, string]>;
	  }
	| { type: "union" };

export type TableNodeType = Node<TableNodeData, "table">;
export type ExtractorNodeType = Node<ExtractorNodeData, "extractor">;
export type TransformNodeType = Node<TransformNodeData, "transform">;
export type AnyNodeType = TableNodeType | ExtractorNodeType | TransformNodeType;
export type BlueprintEdgeType = Edge<{ label?: string }>;

export interface BlueprintFlowState {
	nodes: AnyNodeType[];
	edges: BlueprintEdgeType[];
	viewport: { x: number; y: number; zoom: number };
}

// ---- Helpers for resolving columns from connected sources ----

/** Given an extractor or transform node, find the source node connected via edges */
export function findSourceNode(
	nodeId: string,
	nodes: AnyNodeType[],
	edges: BlueprintEdgeType[],
): TableNodeType | TransformNodeType | undefined {
	const incomingEdge = edges.find((e) => e.target === nodeId);
	if (!incomingEdge) return undefined;
	return nodes.find(
		(n) => n.id === incomingEdge.source && (n.type === "table" || n.type === "transform"),
	) as TableNodeType | TransformNodeType | undefined;
}

export function getColumnsForNode(
	nodeId: string,
	nodes: AnyNodeType[],
	edges: BlueprintEdgeType[],
	visited: Set<string> = new Set(),
): Record<string, DataSourceColumnInfo> {
	if (visited.has(nodeId)) return {};
	visited.add(nodeId);
	const node = nodes.find((n) => n.id === nodeId);

	if (node?.type === "table") {
		// tableInfo may be undefined if the source/table metadata couldn't be
		// re-hydrated (e.g., source deleted after load). Treat as no columns
		// rather than crashing downstream code.
		return (node as TableNodeType).data.tableInfo?.columns ?? {};
	}

	if (node?.type === "transform") {
		const transformData = (node as TransformNodeType).data;
		const incomingEdges = edges.filter((e) => e.target === nodeId);

		if (transformData.transformType === "join" && incomingEdges.length >= 2) {
			const leftCols = getColumnsForNode(incomingEdges[0].source, nodes, edges, visited);
			const rightCols = getColumnsForNode(incomingEdges[1].source, nodes, edges, visited);
			const merged: Record<string, DataSourceColumnInfo> = { ...leftCols };
			for (const [name, info] of Object.entries(rightCols)) {
				if (
					transformData.config.type === "join" &&
					transformData.config.on.some(([, r]) => r === name)
				) {
					continue;
				}
				const outName = name in merged ? `right_${name}` : name;
				merged[outName] = info;
			}
			return merged;
		}

		if (incomingEdges.length > 0) {
			return getColumnsForNode(incomingEdges[0].source, nodes, edges, visited);
		}
		return {};
	}

	const source = findSourceNode(nodeId, nodes, edges);
	if (!source) return {};
	return getColumnsForNode(source.id, nodes, edges, visited);
}

export function getPreviewDataForNode(
	nodeId: string,
	nodes: AnyNodeType[],
	edges: BlueprintEdgeType[],
	visited: Set<string> = new Set(),
): Array<Record<string, string>> | undefined {
	if (visited.has(nodeId)) return undefined;
	visited.add(nodeId);
	const source = findSourceNode(nodeId, nodes, edges);
	if (!source) return undefined;
	if (source.type === "table") {
		return source.data.previewData;
	}
	return getPreviewDataForNode(source.id, nodes, edges, visited);
}

// ---- Backend Transformation ----

/**
 * Helper to build a connection string from a DataSource's config.
 */
function getConnectionString(source: DataSource): string {
	if (source.configMode === "connection-string" && source.connectionString) {
		return source.connectionString;
	}
	const { type, config } = source;
	if (type === "csv") {
		const rawPath = config.path ?? "";
		const path = rawPath.startsWith("csv://") ? rawPath : `csv://${rawPath}`;
		const delim = config.delimiter ?? "";
		return delim !== "" ? `${path}?delimiter=${encodeURIComponent(delim)}` : path;
	}
	if (type === "sqlite") {
		const path = config.path ?? "";
		return path.startsWith("sqlite://") ? path : `sqlite://${path}`;
	}
	const scheme = type === "postgresql" ? "postgres" : "mysql";
	const { user = "", password = "", host = "localhost", port = "", database = "" } = config;
	const auth = user ? (password ? `${user}:${password}@` : `${user}@`) : "";
	const portPart = port ? `:${port}` : "";
	return `${scheme}://${auth}${host}${portPart}/${database}`;
}

/**
 * Transform frontend flow state and data sources into backend-compatible blueprint.
 * Resolves edges to determine source→extractor connections.
 */
export function toBackendBlueprint(
	sources: DataSource[],
	flowState: BlueprintFlowState | undefined,
): DataExtractionBlueprint {
	const backendSources: DataSourceConfig[] = sources
		.filter((s) => s.cachedMetadata)
		.map((s) => ({
			id: s.id,
			type: s.type,
			name: s.name,
			connection_string: getConnectionString(s),
		}));

	const nodes = flowState?.nodes ?? [];
	const edges = flowState?.edges ?? [];

	// Build table extraction configs from extractor nodes
	const backendTables: TableExtractionConfig[] = [];

	const findRootTable = (
		nodeId: string,
		visited: Set<string> = new Set(),
	): TableNodeType | undefined => {
		if (visited.has(nodeId)) return undefined;
		visited.add(nodeId);
		const node = nodes.find((n) => n.id === nodeId);
		if (!node) return undefined;
		if (node.type === "table") return node as TableNodeType;
		const incoming = edges.find((e) => e.target === nodeId);
		if (incoming) return findRootTable(incoming.source, visited);
		return undefined;
	};

	for (const node of nodes) {
		if (node.type !== "extractor") continue;
		const extractorNode = node as ExtractorNodeType;
		const { usage } = extractorNode.data;
		if (!usage) continue;

		const sourceNode = findSourceNode(extractorNode.id, nodes, edges);
		if (!sourceNode) continue;

		if (sourceNode.type === "table") {
			// Direct table → extractor connection
			const tableNode = sourceNode as TableNodeType;
			backendTables.push({
				source_id: tableNode.data.sourceId,
				table_name: tableNode.data.tableName,
				table_info: tableNode.data.tableInfo,
				usage,
				virtual_table_id: null,
			});
		} else if (sourceNode.type === "transform") {
			// Transform → extractor: use virtual_table_id, trace back to root table for source_id
			const rootTable = findRootTable(sourceNode.id);
			backendTables.push({
				source_id: rootTable?.data.sourceId ?? "",
				table_name: rootTable?.data.tableName ?? "",
				table_info: rootTable?.data.tableInfo ?? {
					name: "",
					columns: {},
					primaryKeys: [],
					foreignKeys: [],
				},
				usage,
				virtual_table_id: sourceNode.id,
			});
		}
	}

	// Build virtual table configs from transform nodes
	const virtualTables: VirtualTableConfig[] = [];

	for (const node of nodes) {
		if (node.type !== "transform") continue;
		const transformNode = node as TransformNodeType;

		const resolveSource = (edgeSourceId: string): TransformSource | null => {
			const srcNode = nodes.find((n) => n.id === edgeSourceId);
			if (!srcNode) return null;
			if (srcNode.type === "table") {
				const tn = srcNode as TableNodeType;
				return { type: "table", source_id: tn.data.sourceId, table_name: tn.data.tableName };
			}
			if (srcNode.type === "transform") {
				return { type: "virtual-table", virtual_table_id: srcNode.id };
			}
			return null;
		};

		// Find incoming edges to this transform
		const incomingEdges = edges.filter((e) => e.target === transformNode.id);

		let operation: TransformOperation | null = null;
		const { config } = transformNode.data;

		if (config.type === "filter") {
			const src = incomingEdges[0] ? resolveSource(incomingEdges[0].source) : null;
			if (src) {
				operation = { type: "filter", source: src, condition: config.condition };
			}
		} else if (config.type === "join") {
			// Use targetHandle to distinguish left/right
			const leftEdge = incomingEdges.find((e) => e.targetHandle === "left") ?? incomingEdges[0];
			const rightEdge = incomingEdges.find((e) => e.targetHandle === "right") ?? incomingEdges[1];
			const left = leftEdge ? resolveSource(leftEdge.source) : null;
			const right = rightEdge ? resolveSource(rightEdge.source) : null;
			if (left && right) {
				operation = {
					type: "join",
					left,
					right,
					join_type: config.join_type,
					on: config.on,
				};
			}
		} else if (config.type === "union") {
			const srcs = incomingEdges
				.map((e) => resolveSource(e.source))
				.filter((s): s is TransformSource => s !== null);
			if (srcs.length > 0) {
				operation = { type: "union", sources: srcs };
			}
		}

		if (operation) {
			virtualTables.push({
				id: transformNode.id,
				name: transformNode.data.label,
				operation,
			});
		}
	}

	return {
		sources: backendSources,
		tables: backendTables,
		virtual_tables: virtualTables,
	};
}
