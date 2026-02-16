//! Data extraction blueprint types and execution
//!
//! Converts relational database tables into OCEL 2.0 (Object-Centric Event Logs)
//! using a declarative blueprint that maps tables to objects, events, and relations.
//!

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use chrono::{DateTime, FixedOffset};
use dbcon::{DataSource, NormalizedValue};
use process_mining::core::event_data::object_centric::OCELTypeAttribute;
use process_mining::{
    core::event_data::object_centric::{
        linked_ocel::{slim_linked_ocel::ObjectIndex, LinkedOCELAccess, SlimLinkedOCEL},
        OCELAttributeValue,
    },
    OCEL,
};

use crate::data_extraction::blueprint::{
    build_column_index, AttributeConfig, ColumnIndex, DataExtractionBlueprint, IndexedRow,
    InlineObjectReference, TableExtractionConfig, TableUsageData, TimestampSource, ValueExpression,
};
pub mod blueprint;

pub use blueprint::{ExecuteExtractionRequest, ExecuteExtractionResponse};

// Extraction Engine

/// Tracks counts and errors during extraction
struct ExtractionContext {
    errors: Vec<String>,
    event_count: usize,
    object_count: usize,
    event_types: HashSet<String>,
    object_types: HashSet<String>,
}

impl ExtractionContext {
    fn new() -> Self {
        Self {
            errors: Vec::new(),
            event_count: 0,
            object_count: 0,
            event_types: HashSet::new(),
            object_types: HashSet::new(),
        }
    }

    fn into_response(self) -> ExecuteExtractionResponse {
        ExecuteExtractionResponse {
            success: self.errors.is_empty(),
            total_events: self.event_count,
            total_objects: self.object_count,
            event_types: self.event_types.into_iter().collect(),
            object_types: self.object_types.into_iter().collect(),
            errors: self.errors,
        }
    }

    fn track_event(&mut self, event_type: &str) {
        self.event_count += 1;
        self.event_types.insert(event_type.to_string());
    }

    fn track_object(&mut self, object_type: &str) {
        self.object_count += 1;
        self.object_types.insert(object_type.to_string());
    }
}

/// Ensure an object type is registered (no-op if it already exists)
#[inline]
fn ensure_object_type(locel: &mut SlimLinkedOCEL, name: &str) {
    locel.add_object_type(name, Vec::new());
}

/// Ensure an event type is registered (no-op if it already exists)
#[inline]
fn ensure_event_type(locel: &mut SlimLinkedOCEL, name: &str) {
    locel.add_event_type(name, Vec::new());
}

/// Ensure type exists and add object, returning its index
fn ensure_and_add_object(
    locel: &mut SlimLinkedOCEL,
    obj_type: &str,
    obj_id: String,
) -> Option<ObjectIndex> {
    ensure_object_type(locel, obj_type);
    locel.add_object(obj_type, Some(obj_id), Vec::new(), Vec::new())
}

/// Execute the full extraction pipeline
pub async fn execute_extraction(
    blueprint: &DataExtractionBlueprint,
    data_sources: &HashMap<String, DataSource>,
) -> anyhow::Result<(SlimLinkedOCEL, ExecuteExtractionResponse)> {
    let total_start = Instant::now();
    let mut locel = SlimLinkedOCEL::from_ocel(OCEL {
        events: Vec::new(),
        objects: Vec::new(),
        event_types: Vec::new(),
        object_types: Vec::new(),
    });
    let mut ctx = ExtractionContext::new();

    // Sort tables by processing order: objects -> events -> relations
    // Within objects, process ChangeTableObjectChanges first (they set attributes)
    let mut tables: Vec<&TableExtractionConfig> = blueprint
        .tables
        .iter()
        .filter(|t| !matches!(t.usage, TableUsageData::None))
        .collect();
    tables.sort_by_key(|t| {
        let order: u8 = t.usage.processing_order();
        let sub_order: u8 = if matches!(t.usage, TableUsageData::ChangeTableObjectChanges { .. }) {
            0
        } else {
            1
        };
        (order, sub_order)
    });

    for table in &tables {
        process_table(&mut locel, table, data_sources, &mut ctx).await;
    }

    println!(
        "[Extraction] Done in {:?}: {} events, {} objects, {} errors",
        total_start.elapsed(),
        ctx.event_count,
        ctx.object_count,
        ctx.errors.len()
    );

    let response = ctx.into_response();
    Ok((locel, response))
}

/// Fetch rows for a table and process them according to its usage configuration
async fn process_table(
    locel: &mut SlimLinkedOCEL,
    table: &TableExtractionConfig,
    sources: &HashMap<String, DataSource>,
    ctx: &mut ExtractionContext,
) {
    let source = match sources.get(&table.source_id) {
        Some(s) => s,
        None => {
            ctx.errors
                .push(format!("No data source for id: {}", table.source_id));
            return;
        }
    };

    let required = table.usage.required_columns();
    if required.is_empty() {
        return;
    }

    let col_refs: Vec<&str> = required.iter().map(|s| *s).collect();
    let col_index = build_column_index(&col_refs);

    let fetch_start = Instant::now();
    let rows = match source
        .get_all_records(&table.table_name, &col_refs, false)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            ctx.errors
                .push(format!("Failed to fetch '{}': {}", table.table_name, e));
            return;
        }
    };
    println!(
        "[Extraction] Fetched '{}': {} rows in {:?}",
        table.table_name,
        rows.len(),
        fetch_start.elapsed()
    );

    let process_start = Instant::now();
    process_rows(
        locel,
        &table.usage,
        &rows,
        &col_index,
        &table.table_name,
        ctx,
    );
    println!(
        "[Extraction] Processed '{}' in {:?}",
        table.table_name,
        process_start.elapsed()
    );
}

/// Process all rows for a given table usage
fn process_rows(
    locel: &mut SlimLinkedOCEL,
    usage: &TableUsageData,
    rows: &[Vec<NormalizedValue>],
    col_index: &ColumnIndex,
    table_name: &str,
    ctx: &mut ExtractionContext,
) {
    match usage {
        TableUsageData::None => {}

        TableUsageData::SingleObject { object_type, id } => {
            ensure_object_type(locel, object_type);
            for row_data in rows {
                let row = IndexedRow {
                    values: row_data,
                    index: col_index,
                };
                if let Some(obj_id) = id.evaluate(&row) {
                    if locel
                        .add_object(object_type, Some(obj_id), Vec::new(), Vec::new())
                        .is_some()
                    {
                        ctx.track_object(object_type);
                    }
                }
            }
        }

        TableUsageData::MultiObject { object_type, id } => {
            for row_data in rows {
                let row = IndexedRow {
                    values: row_data,
                    index: col_index,
                };
                if let (Some(obj_type), Some(obj_id)) =
                    (object_type.evaluate(&row), id.evaluate(&row))
                {
                    if ensure_and_add_object(locel, &obj_type, obj_id).is_some() {
                        ctx.track_object(&obj_type);
                    }
                }
            }
        }

        TableUsageData::ChangeTableObjectChanges {
            object_id,
            object_type,
            timestamp,
            attribute_config,
        } => {
            process_change_table_objects(
                locel,
                rows,
                col_index,
                object_id,
                object_type,
                timestamp,
                attribute_config,
                ctx,
            );
        }

        TableUsageData::SingleEvent {
            event_type,
            id,
            timestamp,
            inline_object_references,
        } => {
            ensure_event_type(locel, event_type);
            for row_data in rows {
                let row = IndexedRow {
                    values: row_data,
                    index: col_index,
                };
                if let (Some(event_id), Some(ts)) = (id.evaluate(&row), timestamp.parse(&row)) {
                    let rels = collect_inline_relations(locel, &row, inline_object_references, ctx);
                    locel.add_event(event_type, ts, Some(event_id), Vec::new(), rels);
                    ctx.track_event(event_type);
                }
            }
        }

        TableUsageData::MultiEvent {
            event_type,
            id,
            timestamp,
            inline_object_references,
        } => {
            for row_data in rows {
                let row = IndexedRow {
                    values: row_data,
                    index: col_index,
                };
                if let (Some(ev_type), Some(event_id), Some(ts)) = (
                    event_type.evaluate(&row),
                    id.evaluate(&row),
                    timestamp.parse(&row),
                ) {
                    ensure_event_type(locel, &ev_type);
                    let rels = collect_inline_relations(locel, &row, inline_object_references, ctx);
                    locel.add_event(&ev_type, ts, Some(event_id), Vec::new(), rels);
                    ctx.track_event(&ev_type);
                }
            }
        }

        TableUsageData::ChangeTableEvents {
            timestamp,
            id,
            event_rules,
            inline_object_references,
        } => {
            // Pre-compile all rule conditions
            let prepared_rules: Vec<_> = event_rules
                .iter()
                .filter_map(|rule| match rule.conditions.prepare() {
                    Ok(cond) => Some((&rule.event_type, cond)),
                    Err(e) => {
                        ctx.errors.push(format!(
                            "Invalid regex in rule '{}': {}",
                            rule.event_type, e
                        ));
                        None
                    }
                })
                .collect();

            // Register all event types from rules upfront
            for (event_type, _) in &prepared_rules {
                ensure_event_type(locel, event_type);
            }

            let mut id_counter = 0usize;
            for row_data in rows {
                let row = IndexedRow {
                    values: row_data,
                    index: col_index,
                };
                for (event_type, cond) in &prepared_rules {
                    if cond.evaluate(&row) {
                        if let Some(ts) = timestamp.parse(&row) {
                            let event_id = id
                                .as_ref()
                                .and_then(|e| e.evaluate(&row))
                                .unwrap_or_else(|| {
                                    id_counter += 1;
                                    format!("{}_{}_{}", table_name, event_type, id_counter)
                                });
                            let rels = collect_inline_relations(
                                locel,
                                &row,
                                inline_object_references,
                                ctx,
                            );
                            locel.add_event(event_type, ts, Some(event_id), Vec::new(), rels);
                            ctx.track_event(event_type);
                        }
                        break; // First matching rule wins
                    }
                }
            }
        }

        TableUsageData::E2ORelation {
            source_event,
            target_object,
            qualifier,
        } => {
            for row_data in rows {
                let row = IndexedRow {
                    values: row_data,
                    index: col_index,
                };
                if let (Some(event_id), Some(object_id)) =
                    (source_event.evaluate(&row), target_object.evaluate(&row))
                {
                    if let (Some(ev_idx), Some(obj_idx)) = (
                        locel.get_ev_by_id(&event_id),
                        locel.get_ob_by_id(&object_id),
                    ) {
                        let qual = qualifier
                            .as_ref()
                            .and_then(|q| q.evaluate(&row))
                            .unwrap_or_default();
                        locel.add_e2o(ev_idx, obj_idx, qual);
                    }
                }
            }
        }

        TableUsageData::O2ORelation {
            source_object,
            target_object,
            qualifier,
        } => {
            for row_data in rows {
                let row = IndexedRow {
                    values: row_data,
                    index: col_index,
                };
                if let (Some(src_id), Some(tgt_id)) =
                    (source_object.evaluate(&row), target_object.evaluate(&row))
                {
                    if let (Some(src_idx), Some(tgt_idx)) =
                        (locel.get_ob_by_id(&src_id), locel.get_ob_by_id(&tgt_id))
                    {
                        let qual = qualifier
                            .as_ref()
                            .and_then(|q| q.evaluate(&row))
                            .unwrap_or_default();
                        locel.add_o2o(src_idx, tgt_idx, qual);
                    }
                }
            }
        }
    }
}

/// Process ChangeTableObjectChanges: group rows by object, collect timed attributes
fn process_change_table_objects(
    locel: &mut SlimLinkedOCEL,
    rows: &[Vec<NormalizedValue>],
    col_index: &ColumnIndex,
    object_id: &ValueExpression,
    object_type: &str,
    timestamp: &TimestampSource,
    attribute_config: &AttributeConfig,
    ctx: &mut ExtractionContext,
) {
    // Discover attribute names (for Dynamic config, scan all rows first)
    let attr_names: Vec<String> = match attribute_config {
        AttributeConfig::Static { mappings } => {
            mappings.iter().map(|m| m.attribute_name.clone()).collect()
        }
        AttributeConfig::Dynamic { name_column, .. } => {
            let mut names = Vec::new();
            let mut seen = HashSet::new();
            for row_data in rows {
                let row = IndexedRow {
                    values: row_data,
                    index: col_index,
                };
                if let Some(name) = row.get_string(name_column) {
                    if seen.insert(name.clone()) {
                        names.push(name);
                    }
                }
            }
            names
        }
    };

    // Register type with discovered attributes
    let type_attrs: Vec<OCELTypeAttribute> = attr_names
        .iter()
        .map(|name| OCELTypeAttribute {
            name: name.clone(),
            value_type: "string".to_string(),
        })
        .collect();
    locel.add_object_type(object_type, type_attrs);

    if attr_names.is_empty() {
        // No attributes; just create objects
        for row_data in rows {
            let row = IndexedRow {
                values: row_data,
                index: col_index,
            };
            if let Some(obj_id) = object_id.evaluate(&row) {
                if locel
                    .add_object(object_type, Some(obj_id), Vec::new(), Vec::new())
                    .is_some()
                {
                    ctx.track_object(object_type);
                }
            }
        }
        return;
    }

    // Build attr_name -> positional index map
    let attr_index: HashMap<&str, usize> = attr_names
        .iter()
        .enumerate()
        .map(|(i, name)| (name.as_str(), i))
        .collect();
    let num_attrs = attr_names.len();

    // Group rows by object ID, collecting timed attribute values
    let mut grouped: HashMap<String, Vec<Vec<(DateTime<FixedOffset>, OCELAttributeValue)>>> =
        HashMap::new();

    for row_data in rows {
        let row = IndexedRow {
            values: row_data,
            index: col_index,
        };
        if let (Some(obj_id), Some(ts)) = (object_id.evaluate(&row), timestamp.parse(&row)) {
            let attrs = grouped
                .entry(obj_id)
                .or_insert_with(|| vec![Vec::new(); num_attrs]);

            match attribute_config {
                AttributeConfig::Static { mappings } => {
                    for mapping in mappings {
                        if let Some(&idx) = attr_index.get(mapping.attribute_name.as_str()) {
                            if let Some(v) = row.get_string(&mapping.source_column) {
                                attrs[idx].push((ts, OCELAttributeValue::String(v)));
                            }
                        }
                    }
                }
                AttributeConfig::Dynamic {
                    name_column,
                    value_column,
                } => {
                    if let (Some(name), Some(value)) =
                        (row.get_string(name_column), row.get_string(value_column))
                    {
                        if let Some(&idx) = attr_index.get(name.as_str()) {
                            attrs[idx].push((ts, OCELAttributeValue::String(value)));
                        }
                    }
                }
            }
        }
    }

    // Create objects with their collected attributes
    for (obj_id, attrs) in grouped {
        if locel
            .add_object(object_type, Some(obj_id), attrs, Vec::new())
            .is_some()
        {
            ctx.track_object(object_type);
        }
    }
}

/// Resolve inline object references to (qualifier, ObjectIndex) pairs
fn collect_inline_relations(
    locel: &mut SlimLinkedOCEL,
    row: &IndexedRow<'_>,
    refs: &[InlineObjectReference],
    ctx: &mut ExtractionContext,
) -> Vec<(String, ObjectIndex)> {
    let mut relationships = Vec::new();

    for inline_ref in refs {
        let object_ids = inline_ref.extract_object_ids(row);
        let qualifier = inline_ref
            .qualifier
            .as_ref()
            .and_then(|q| q.evaluate(row))
            .unwrap_or_default();

        for obj_id in object_ids {
            if let Some(obj_index) = locel.get_ob_by_id(&obj_id) {
                // Object already exists
                relationships.push((qualifier.clone(), obj_index));
            } else if let Some(obj_type_spec) = &inline_ref.object_type {
                // Create new object if we have a type
                if let Some(obj_type) = obj_type_spec.evaluate(row) {
                    if let Some(idx) = ensure_and_add_object(locel, &obj_type, obj_id) {
                        relationships.push((qualifier.clone(), idx));
                        ctx.track_object(&obj_type);
                    }
                }
            }
        }
    }

    relationships
}

// Helpers for connecting to data sources

/// Connect to all data sources in a blueprint
pub async fn connect_blueprint_sources(
    blueprint: &DataExtractionBlueprint,
) -> anyhow::Result<HashMap<String, DataSource>> {
    let mut sources = HashMap::new();
    for source in &blueprint.sources {
        let ds = DataSource::new_any(source.name.clone(), source.connection_string.clone()).await?;
        sources.insert(source.id.clone(), ds);
    }
    Ok(sources)
}

/// Execute extraction end-to-end: connect to sources, extract, return OCEL
pub async fn execute_extraction_slim_with_dbcon(
    blueprint: &DataExtractionBlueprint,
) -> anyhow::Result<(SlimLinkedOCEL, ExecuteExtractionResponse)> {
    let providers = connect_blueprint_sources(blueprint).await?;
    execute_extraction(blueprint, &providers).await
}

#[cfg(test)]
mod tests;
