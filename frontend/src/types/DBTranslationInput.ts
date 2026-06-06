import type { BindingBoxTree } from "./generated/BindingBoxTree";

export type DBTranslationInput = {
	tree: BindingBoxTree;
	database: "SQLite" | "DuckDB" | "PostgreSQL";
	table_mappings: TableMappings;
};

export type EntityTableSpec = {
	table: string;
	id_column?: string | null;
	time_column?: string | null;
	changed_field_column?: string | null;
	attribute_columns?: Record<string, string>;
	select_body?: string | null;
};

export type TableMappings = {
	event_tables: Record<string, EntityTableSpec>;
	object_tables: Record<string, EntityTableSpec>;
};
