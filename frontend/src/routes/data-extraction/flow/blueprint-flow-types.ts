import type { Edge, Node } from "@xyflow/react";
import type { DataSourceTableInfo } from "@/types/generated/DataSourceTableInfo";
import type { DataSource } from "../data-extraction-types";

export type { AttributeConfig } from "@/types/generated/AttributeConfig";
export type { AttributeMapping } from "@/types/generated/AttributeMapping";
export type { ChangeTableCondition } from "@/types/generated/ChangeTableCondition";
export type { ChangeTableEventRule } from "@/types/generated/ChangeTableEventRule";
export type { DataExtractionBlueprint } from "@/types/generated/DataExtractionBlueprint";
export type { DataSourceConfig } from "@/types/generated/DataSourceConfig";
export type { InlineObjectReference } from "@/types/generated/InlineObjectReference";
export type { MultiValueConfig } from "@/types/generated/MultiValueConfig";
export type { ObjectTypeSpec } from "@/types/generated/ObjectTypeSpec";
export type { TableExtractionConfig } from "@/types/generated/TableExtractionConfig";
export type { TableUsageData } from "@/types/generated/TableUsageData";
export type { TimestampFormat } from "@/types/generated/TimestampFormat";
export type { TimestampSource } from "@/types/generated/TimestampSource";
// ---- Re-export generated types (single source of truth) ----
export type { ValueExpression } from "@/types/generated/ValueExpression";

// ---- Local imports for use in this file ----
import type { ChangeTableCondition } from "@/types/generated/ChangeTableCondition";
import type { DataExtractionBlueprint } from "@/types/generated/DataExtractionBlueprint";
import type { DataSourceConfig } from "@/types/generated/DataSourceConfig";
import type { TableExtractionConfig } from "@/types/generated/TableExtractionConfig";
import type { TableUsageData } from "@/types/generated/TableUsageData";
import type { TimestampSource } from "@/types/generated/TimestampSource";
import type { ValueExpression } from "@/types/generated/ValueExpression";

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

export const ALL_TABLE_USAGE_MODES: TableUsageType[] = [
	"none",
	"single-object",
	"multi-object",
	"single-event",
	"multi-event",
	"e2o-relation",
	"o2o-relation",
	"change-table-events",
	"change-table-object-changes",
];

export const TABLE_USAGE_MODE_LABELS: Record<TableUsageType, string> = {
	none: "Unused",
	"single-object": "Object Single Type",
	"multi-object": "Object Multi Type",
	"single-event": "Event Single Type",
	"multi-event": "Event Multi Type",
	"e2o-relation": "E2O Relation",
	"o2o-relation": "O2O Relation",
	"change-table-events": "Events (Change Table)",
	"change-table-object-changes": "Object Changes",
};

export function getDefaultUsageDataForMode(mode: TableUsageType): TableUsageData {
	switch (mode) {
		case "none":
			return { mode };
		case "single-object":
			return { mode, id: { ...DEFAULT_VALUE_EXPR }, object_type: "" };
		case "multi-object":
			return {
				mode,
				id: { ...DEFAULT_VALUE_EXPR },
				object_type: { ...DEFAULT_VALUE_EXPR },
			};
		case "single-event":
			return {
				mode,
				id: { ...DEFAULT_VALUE_EXPR },
				timestamp: { ...DEFAULT_TIMESTAMP_SOURCE },
				event_type: "",
				inline_object_references: [],
			};
		case "multi-event":
			return {
				mode,
				id: { ...DEFAULT_VALUE_EXPR },
				timestamp: { ...DEFAULT_TIMESTAMP_SOURCE },
				event_type: { ...DEFAULT_VALUE_EXPR },
				inline_object_references: [],
			};
		case "e2o-relation":
			return {
				mode,
				source_event: { ...DEFAULT_VALUE_EXPR },
				target_object: { ...DEFAULT_VALUE_EXPR },
				qualifier: null,
			};
		case "o2o-relation":
			return {
				mode,
				source_object: { ...DEFAULT_VALUE_EXPR },
				target_object: { ...DEFAULT_VALUE_EXPR },
				qualifier: null,
			};
		case "change-table-events":
			return {
				mode,
				timestamp: { ...DEFAULT_TIMESTAMP_SOURCE },
				id: null,
				event_rules: [],
				inline_object_references: [],
			};
		case "change-table-object-changes":
			return {
				mode,
				object_id: { ...DEFAULT_VALUE_EXPR },
				object_type: "",
				timestamp: { ...DEFAULT_TIMESTAMP_SOURCE },
				attribute_config: { mode: "static", mappings: [] },
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
	if (!usage || usage.mode === "none") return "Unused";

	switch (usage.mode) {
		case "single-object": {
			const name = usage.object_type || "?";
			return `${name} objects`;
		}
		case "multi-object": {
			const preview = getExprPreview(usage.object_type, previewData);
			return preview ? `${preview} objects` : "Multi-type objects";
		}
		case "single-event": {
			const name = usage.event_type || "?";
			return `${name} events`;
		}
		case "multi-event": {
			const preview = getExprPreview(usage.event_type, previewData);
			return preview ? `${preview} events` : "Multi-type events";
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
		case "change-table-object-changes": {
			const name = usage.object_type || "?";
			return `${name} changes`;
		}
	}
}

// ---- Flow Node/Edge Types ----
export interface TableNodeData {
	sourceId: string;
	sourceName: string;
	tableName: string;
	tableInfo: DataSourceTableInfo;
	previewData?: Array<Record<string, string>>;
	showPreview?: boolean;
	usage?: TableUsageData;
	[key: string]: unknown;
}

export type TableNodeType = Node<TableNodeData, "table">;
export type BlueprintEdgeType = Edge<{ label?: string }>;

export interface BlueprintFlowState {
	nodes: TableNodeType[];
	edges: BlueprintEdgeType[];
	viewport: { x: number; y: number; zoom: number };
}

// ---- Backend Transformation ----

/**
 * Helper to build a connection string from a DataSource's config.
 * Falls back to connectionString if present, otherwise builds from structured config.
 */
function getConnectionString(source: DataSource): string {
	if (source.configMode === "connection-string" && source.connectionString) {
		return source.connectionString;
	}
	// Build from structured config
	const { type, config } = source;
	if (type === "csv" || type === "sqlite") {
		const path = config.path ?? "";
		const prefix = type === "csv" ? "csv://" : "sqlite://";
		return path.startsWith(prefix) ? path : `${prefix}${path}`;
	}
	const scheme = type === "postgresql" ? "postgres" : "mysql";
	const { user = "", password = "", host = "localhost", port = "", database = "" } = config;
	const auth = user ? (password ? `${user}:${password}@` : `${user}@`) : "";
	const portPart = port ? `:${port}` : "";
	return `${scheme}://${auth}${host}${portPart}/${database}`;
}

/**
 * Transform frontend flow state and data sources into backend-compatible blueprint.
 * Strips ReactFlow-specific data (positions, viewport) and only includes configured tables.
 */
export function toBackendBlueprint(
	sources: DataSource[],
	flowState: BlueprintFlowState | undefined,
): DataExtractionBlueprint {
	// Transform data sources (strip UI-specific fields)
	const backendSources: DataSourceConfig[] = sources
		.filter((s) => s.cachedMetadata) // Only include connected sources
		.map((s) => ({
			id: s.id,
			type: s.type,
			name: s.name,
			connection_string: getConnectionString(s),
		}));

	// Transform table nodes (strip ReactFlow position/UI state, only include those with usage)
	const backendTables: TableExtractionConfig[] = (flowState?.nodes ?? [])
		.filter((node) => node.data.usage && node.data.usage.mode !== "none")
		.map(
			(node) =>
				({
					source_id: node.data.sourceId,
					table_name: node.data.tableName,
					table_info: node.data.tableInfo,
					// biome-ignore lint/style/noNonNullAssertion: Filtered before
					usage: node.data.usage!,
				}) satisfies TableExtractionConfig,
		);

	return {
		sources: backendSources,
		tables: backendTables,
	};
}
