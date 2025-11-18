import { BindingBoxTree } from "./generated/BindingBoxTree";

export type DBTranslationInput = {
   tree: BindingBoxTree,
    database: 'SQLite' | 'DuckDB',
    table_mappings: TableMappings
};

export type TableMappings = {
    event_tables: Record<string, string>,
    object_tables: Record<string, string>
}