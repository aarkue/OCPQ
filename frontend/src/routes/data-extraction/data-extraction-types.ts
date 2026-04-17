import type { DataSourceMetadata } from "@/types/generated/DataSourceMetadata";

export interface DataExtractionBlueprintMeta {
	id: string;
	name: string;
	description?: string;
	createdAt: string;
}

export type DataSourceType = "sqlite" | "csv" | "mysql" | "postgresql";

export type DataSourceConnectionStatus =
	| { status: "idle" }
	| { status: "connecting" }
	| { status: "connected"; lastConnected: string }
	| { status: "error"; error: string; lastAttempt: string };

export interface DataSource {
	id: string;
	type: DataSourceType;
	name: string;
	configMode: "connection-string" | "structured";
	connectionString?: string; // e.g., "/path/to/file.csv", "postgres://user:pw@localhost/db"
	config: Record<string, string>; // structured config with individual fields
	/** Cached metadata from last successful connection */
	cachedMetadata?: DataSourceMetadata;
	/** Connection status tracking */
	connectionStatus?: DataSourceConnectionStatus;
}

/** Current blueprint data version. Increment when the shape changes. */
export const BLUEPRINT_DATA_VERSION = 1;

export interface DataExtractionBlueprintData {
	/** Schema version for migration support */
	version?: number;
	sources: DataSource[];
	/** ReactFlow state for the blueprint editor */
	flowState?: {
		nodes: unknown[];
		edges: unknown[];
		viewport: { x: number; y: number; zoom: number };
	};
}

/** Migrate old blueprint data to the current version. Returns a new object if migrated. */
export function migrateBlueprintData(
	data: DataExtractionBlueprintData,
): DataExtractionBlueprintData {
	const v = data.version ?? 0;
	if (v >= BLUEPRINT_DATA_VERSION) return data;

	let migrated = { ...data };

	// v0 → v1: TableUsageData variants merged (single/multi → event/object, None removed)
	if (v < 1) {
		if (migrated.flowState?.nodes) {
			migrated = {
				...migrated,
				flowState: {
					...migrated.flowState,
					edges: migrated.flowState.edges,
					viewport: migrated.flowState.viewport,
					nodes: migrated.flowState.nodes
						.map((node: any) => {
							if (node.type !== "extractor") return node;
							const usage = node.data?.usage;
							if (!usage) return node;

							// Migrate old mode names
							if (usage.mode === "single-event" || usage.mode === "multi-event") {
								const eventType =
									typeof usage.event_type === "string"
										? { type: "constant", value: usage.event_type }
										: (usage.event_type ?? { type: "constant", value: "" });
								return {
									...node,
									data: {
										...node.data,
										extractorMode: "event",
										usage: {
											mode: "event",
											event_type: eventType,
											id: usage.id ?? null,
											timestamp: usage.timestamp,
											inline_object_references: usage.inline_object_references ?? [],
										},
									},
								};
							}
							if (usage.mode === "single-object" || usage.mode === "multi-object") {
								const objectType =
									typeof usage.object_type === "string"
										? { type: "constant", value: usage.object_type }
										: (usage.object_type ?? { type: "constant", value: "" });
								return {
									...node,
									data: {
										...node.data,
										extractorMode: "object",
										usage: {
											mode: "object",
											object_type: objectType,
											id: usage.id ?? { type: "column", column: "" },
											prefix_id_with_type: usage.prefix_id_with_type ?? false,
											timestamp: null,
											attribute_config: null,
										},
									},
								};
							}
							if (usage.mode === "change-table-object-changes") {
								const objectType =
									typeof usage.object_type === "string"
										? { type: "constant", value: usage.object_type }
										: (usage.object_type ?? { type: "constant", value: "" });
								return {
									...node,
									data: {
										...node.data,
										extractorMode: "object",
										usage: {
											mode: "object",
											object_type: objectType,
											id: usage.object_id ?? usage.id ?? { type: "column", column: "" },
											prefix_id_with_type: usage.prefix_id_with_type ?? false,
											timestamp: usage.timestamp ?? null,
											attribute_config: usage.attribute_config ?? null,
										},
									},
								};
							}
							if (usage.mode === "none") {
								// Remove nodes with mode "none"
								return null;
							}
							return node;
						})
						.filter(Boolean),
				},
			};
		}
	}

	migrated.version = BLUEPRINT_DATA_VERSION;
	return migrated;
}
