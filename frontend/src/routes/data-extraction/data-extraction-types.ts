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

export interface DataExtractionBlueprintData {
	sources: DataSource[];
	/** ReactFlow state for the blueprint editor */
	flowState?: {
		nodes: unknown[];
		edges: unknown[];
		viewport: { x: number; y: number; zoom: number };
	};
}
