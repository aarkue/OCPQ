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
use process_mining::core::event_data::object_centric::{
    linked_ocel::{slim_linked_ocel::ObjectIndex, LinkedOCELAccess, SlimLinkedOCEL},
    OCELAttributeValue,
};

use crate::data_extraction::blueprint::{
    build_column_index, AttributeConfig, ColumnIndex, DataExtractionBlueprint, IndexedRow,
    InlineObjectReference, JoinType, TableExtractionConfig, TableUsageData, TimestampSource,
    TransformOperation, TransformSource, ValueExpression, VirtualTableConfig,
};
pub mod blueprint;

pub use blueprint::{ExecuteExtractionRequest, ExecuteExtractionResponse};

/// Tracks counts and errors during extraction
struct ExtractionContext {
    errors: Vec<String>,
    warnings: Vec<String>,
    event_count: usize,
    object_count: usize,
    event_types: HashSet<String>,
    object_types: HashSet<String>,
    /// Object types that use type-prefixed IDs
    prefixed_types: HashSet<String>,
}

impl ExtractionContext {
    fn new() -> Self {
        Self {
            errors: Vec::new(),
            warnings: Vec::new(),
            event_count: 0,
            object_count: 0,
            event_types: HashSet::new(),
            object_types: HashSet::new(),
            prefixed_types: HashSet::new(),
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
            warnings: self.warnings,
        }
    }

    fn track_event(&mut self, event_type: &str) {
        self.event_count += 1;
        if !self.event_types.contains(event_type) {
            self.event_types.insert(event_type.to_string());
        }
    }

    fn track_object(&mut self, object_type: &str) {
        self.object_count += 1;
        if !self.object_types.contains(object_type) {
            self.object_types.insert(object_type.to_string());
        }
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

/// Prefix an object ID with its type if the type uses prefixing
fn maybe_prefix_id(ctx: &ExtractionContext, obj_type: &str, raw_id: String) -> String {
    if ctx.prefixed_types.contains(obj_type) {
        format!("{}-{}", obj_type, raw_id)
    } else {
        raw_id
    }
}

/// Cached result of a virtual table: column names + rows
type VirtualTableCache = HashMap<String, (Vec<String>, Vec<Vec<NormalizedValue>>)>;

/// Topological sort of virtual tables by dependency. Returns ordered indices or error on cycle.
fn topological_sort_virtual_tables(
    virtual_tables: &[VirtualTableConfig],
) -> Result<Vec<usize>, String> {
    let id_to_idx: HashMap<&str, usize> = virtual_tables
        .iter()
        .enumerate()
        .map(|(i, vt)| (vt.id.as_str(), i))
        .collect();

    fn get_deps(op: &TransformOperation) -> Vec<&str> {
        match op {
            TransformOperation::Filter { source, .. } => source_deps(source),
            TransformOperation::Join { left, right, .. } => {
                let mut deps = source_deps(left);
                deps.extend(source_deps(right));
                deps
            }
            TransformOperation::Union { sources } => sources.iter().flat_map(source_deps).collect(),
        }
    }

    fn source_deps(source: &TransformSource) -> Vec<&str> {
        match source {
            TransformSource::Table { .. } => vec![],
            TransformSource::VirtualTable { virtual_table_id } => {
                vec![virtual_table_id.as_str()]
            }
        }
    }

    // Kahn's algorithm
    let n = virtual_tables.len();
    let mut in_degree = vec![0usize; n];
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];

    for (i, vt) in virtual_tables.iter().enumerate() {
        for dep_id in get_deps(&vt.operation) {
            if let Some(&dep_idx) = id_to_idx.get(dep_id) {
                adj[dep_idx].push(i);
                in_degree[i] += 1;
            }
        }
    }

    let mut queue: Vec<usize> = (0..n).filter(|&i| in_degree[i] == 0).collect();
    let mut order = Vec::with_capacity(n);

    while let Some(idx) = queue.pop() {
        order.push(idx);
        for &next in &adj[idx] {
            in_degree[next] -= 1;
            if in_degree[next] == 0 {
                queue.push(next);
            }
        }
    }

    if order.len() != n {
        Err("Circular dependency detected among virtual tables".to_string())
    } else {
        Ok(order)
    }
}

/// Fetch rows from a TransformSource, only fetching the specified columns.
/// If `needed` is empty, fetches all columns.
async fn fetch_source_rows(
    source: &TransformSource,
    needed: &HashSet<String>,
    data_sources: &HashMap<String, DataSource>,
    cache: &VirtualTableCache,
) -> Result<(Vec<String>, Vec<Vec<NormalizedValue>>), String> {
    match source {
        TransformSource::Table {
            source_id,
            table_name,
        } => {
            let ds = data_sources
                .get(source_id)
                .ok_or_else(|| format!("No data source for id: {}", source_id))?;
            // Fetch needed columns (or all if needed is empty)
            let col_refs: Vec<&str> = needed.iter().map(|s| s.as_str()).collect();
            let rows = ds
                .get_all_records(table_name, &col_refs, false)
                .await
                .map_err(|e| format!("Failed to fetch '{}': {}", table_name, e))?;
            // Column names: use needed set if specified, otherwise derive from first row or table metadata
            let col_names: Vec<String> = if !needed.is_empty() {
                col_refs.iter().map(|s| s.to_string()).collect()
            } else if let Some(table_info) = ds.tables.get(table_name) {
                table_info.columns.keys().cloned().collect()
            } else {
                // Fallback: no metadata available, columns unknown for SELECT *
                Vec::new()
            };
            Ok((col_names, rows))
        }
        TransformSource::VirtualTable { virtual_table_id } => {
            let (vt_cols, vt_rows) = cache.get(virtual_table_id).ok_or_else(|| {
                format!("Virtual table '{}' not found in cache", virtual_table_id)
            })?;
            if needed.is_empty() {
                return Ok((vt_cols.clone(), vt_rows.clone()));
            }
            // Filter to only needed columns
            let vt_col_index: Vec<(usize, &String)> = vt_cols
                .iter()
                .enumerate()
                .filter(|(_, c)| needed.contains(c.as_str()))
                .collect();
            let filtered_cols: Vec<String> =
                vt_col_index.iter().map(|(_, c)| (*c).clone()).collect();
            let filtered_rows: Vec<Vec<NormalizedValue>> = vt_rows
                .iter()
                .map(|row| {
                    vt_col_index
                        .iter()
                        .map(|(i, _)| row.get(*i).cloned().unwrap_or(NormalizedValue::Null))
                        .collect()
                })
                .collect();
            Ok((filtered_cols, filtered_rows))
        }
    }
}

/// Compute the columns a virtual table needs from its sources.
/// This is the union of: transform operation columns + downstream extractor columns.
fn compute_needed_columns(
    vt: &VirtualTableConfig,
    downstream_tables: &[TableExtractionConfig],
) -> HashSet<String> {
    let mut needed = HashSet::new();

    // Columns needed by downstream extractors that reference this virtual table
    for table_cfg in downstream_tables {
        if table_cfg.virtual_table_id.as_deref() == Some(&vt.id) {
            for col in table_cfg.usage.required_columns() {
                needed.insert(col.to_string());
            }
        }
    }

    // Columns needed by the transform operation itself
    match &vt.operation {
        TransformOperation::Filter { condition, .. } => {
            let mut cond_cols = HashSet::new();
            condition.referenced_columns(&mut cond_cols);
            for c in cond_cols {
                needed.insert(c.to_string());
            }
        }
        TransformOperation::Join { on, .. } => {
            for (l, r) in on {
                needed.insert(l.clone());
                needed.insert(r.clone());
            }
        }
        TransformOperation::Union { .. } => {
            // Union passes through all columns; downstream cols are sufficient
        }
    }

    needed
}

/// Resolve all virtual tables in dependency order
async fn resolve_virtual_tables(
    virtual_tables: &[VirtualTableConfig],
    downstream_tables: &[TableExtractionConfig],
    data_sources: &HashMap<String, DataSource>,
    errors: &mut Vec<String>,
) -> VirtualTableCache {
    let mut cache = VirtualTableCache::new();

    if virtual_tables.is_empty() {
        return cache;
    }

    let order = match topological_sort_virtual_tables(virtual_tables) {
        Ok(o) => o,
        Err(e) => {
            errors.push(e);
            return cache;
        }
    };

    for idx in order {
        let vt = &virtual_tables[idx];
        let needed = compute_needed_columns(vt, downstream_tables);
        match apply_transform(&vt.operation, &needed, data_sources, &cache).await {
            Ok((cols, rows)) => {
                let label = if vt.name.is_empty() { &vt.id } else { &vt.name };
                println!(
                    "[Extraction] Resolved virtual table '{}': {} rows, {} cols",
                    label,
                    rows.len(),
                    cols.len()
                );
                cache.insert(vt.id.clone(), (cols, rows));
            }
            Err(e) => {
                errors.push(format!("Virtual table '{}': {}", vt.name, e));
            }
        }
    }

    cache
}

/// Apply a transform operation to produce rows
async fn apply_transform(
    operation: &TransformOperation,
    needed_columns: &HashSet<String>,
    data_sources: &HashMap<String, DataSource>,
    cache: &VirtualTableCache,
) -> Result<(Vec<String>, Vec<Vec<NormalizedValue>>), String> {
    match operation {
        TransformOperation::Filter { source, condition } => {
            let (col_names, rows) =
                fetch_source_rows(source, needed_columns, data_sources, cache).await?;
            let col_refs: Vec<&str> = col_names.iter().map(|s| s.as_str()).collect();
            let col_index = build_column_index(&col_refs);
            let prepared = condition
                .prepare()
                .map_err(|e| format!("Invalid filter condition: {}", e))?;
            let filtered: Vec<Vec<NormalizedValue>> = rows
                .into_iter()
                .filter(|row_data| {
                    let row = IndexedRow {
                        values: row_data,
                        index: &col_index,
                    };
                    prepared.evaluate(&row)
                })
                .collect();
            Ok((col_names, filtered))
        }
        TransformOperation::Join {
            left,
            right,
            join_type,
            on,
        } => {
            if !matches!(join_type, JoinType::Inner) {
                return Err(format!(
                    "Join type {:?} is not yet supported; only Inner join is implemented",
                    join_type
                ));
            }
            let (left_cols, left_rows) =
                fetch_source_rows(left, needed_columns, data_sources, cache).await?;
            let (right_cols, right_rows) =
                fetch_source_rows(right, needed_columns, data_sources, cache).await?;

            let left_refs: Vec<&str> = left_cols.iter().map(|s| s.as_str()).collect();
            let right_refs: Vec<&str> = right_cols.iter().map(|s| s.as_str()).collect();
            let left_index = build_column_index(&left_refs);
            let right_index = build_column_index(&right_refs);

            let right_join_keys: HashSet<&str> = on.iter().map(|(_, r)| r.as_str()).collect();

            let mut out_cols: Vec<String> = left_cols.clone();
            let mut right_col_map: Vec<String> = Vec::new();
            for rc in &right_cols {
                let name = if left_index.contains_key(rc.as_str()) {
                    if right_join_keys.contains(rc.as_str()) {
                        right_col_map.push(rc.clone());
                        continue;
                    }
                    format!("right_{}", rc)
                } else {
                    rc.clone()
                };
                out_cols.push(name.clone());
                right_col_map.push(name);
            }

            // Build hash map from right rows on join columns
            let right_join_col_indices: Vec<usize> = on
                .iter()
                .filter_map(|(_, r)| right_index.get(r.as_str()).copied())
                .collect();
            let left_join_col_indices: Vec<usize> = on
                .iter()
                .filter_map(|(l, _)| left_index.get(l.as_str()).copied())
                .collect();

            let mut right_map: HashMap<Vec<String>, Vec<&Vec<NormalizedValue>>> = HashMap::new();
            for row in &right_rows {
                let key: Vec<String> = right_join_col_indices
                    .iter()
                    .map(|&i| row.get(i).map(|v| v.to_string()).unwrap_or_default())
                    .collect();
                right_map.entry(key).or_default().push(row);
            }

            let mut result_rows = Vec::new();
            for left_row in &left_rows {
                let key: Vec<String> = left_join_col_indices
                    .iter()
                    .map(|&i| left_row.get(i).map(|v| v.to_string()).unwrap_or_default())
                    .collect();
                if let Some(matching) = right_map.get(&key) {
                    for right_row in matching {
                        let mut combined = left_row.clone();
                        for (ri, rc) in right_cols.iter().enumerate() {
                            if right_join_keys.contains(rc.as_str()) {
                                continue;
                            }
                            combined
                                .push(right_row.get(ri).cloned().unwrap_or(NormalizedValue::Null));
                        }
                        result_rows.push(combined);
                    }
                }
            }

            Ok((out_cols, result_rows))
        }
        TransformOperation::Union { sources } => {
            if sources.is_empty() {
                return Ok((Vec::new(), Vec::new()));
            }

            // Fetch all sources
            let mut all_sources = Vec::new();
            for src in sources {
                all_sources
                    .push(fetch_source_rows(src, needed_columns, data_sources, cache).await?);
            }

            // Use first source's columns as base, pad others
            let out_cols = all_sources[0].0.clone();
            let num_cols = out_cols.len();
            let mut result_rows = Vec::new();

            for (cols, rows) in &all_sources {
                let src_index: HashMap<&str, usize> = cols
                    .iter()
                    .enumerate()
                    .map(|(i, c)| (c.as_str(), i))
                    .collect();
                let col_map: Vec<Option<usize>> = out_cols
                    .iter()
                    .map(|oc| src_index.get(oc.as_str()).copied())
                    .collect();

                for row in rows {
                    let mut out_row = vec![NormalizedValue::Null; num_cols];
                    for (out_i, src_i) in col_map.iter().enumerate() {
                        if let Some(si) = src_i {
                            if let Some(v) = row.get(*si) {
                                out_row[out_i] = v.clone();
                            }
                        }
                    }
                    result_rows.push(out_row);
                }
            }

            Ok((out_cols, result_rows))
        }
    }
}

/// Execute the full extraction pipeline
pub async fn execute_extraction(
    blueprint: &DataExtractionBlueprint,
    data_sources: &HashMap<String, DataSource>,
) -> anyhow::Result<(SlimLinkedOCEL, ExecuteExtractionResponse)> {
    let total_start = Instant::now();
    let mut locel = SlimLinkedOCEL::new();
    let mut ctx = ExtractionContext::new();

    // Resolve virtual tables first (if any)
    let virtual_cache = resolve_virtual_tables(
        &blueprint.virtual_tables,
        &blueprint.tables,
        data_sources,
        &mut ctx.errors,
    )
    .await;

    // Sort tables by processing order: objects -> events -> relations
    // Within objects, process those with attribute_config first (they set attributes)
    let mut tables: Vec<&TableExtractionConfig> = blueprint.tables.iter().collect();
    tables.sort_by_key(|t| {
        let order: u8 = t.usage.processing_order();
        let sub_order: u8 = if matches!(
            t.usage,
            TableUsageData::Object {
                attribute_config: Some(_),
                ..
            }
        ) {
            0
        } else {
            1
        };
        (order, sub_order)
    });

    // Precompute: source key for each config, usage counts, and union of required columns
    let source_keys: Vec<SourceKey> = tables
        .iter()
        .map(|t| match &t.virtual_table_id {
            Some(vt_id) => SourceKey::Virtual(vt_id.clone()),
            None => SourceKey::Table(t.source_id.clone(), t.table_name.clone()),
        })
        .collect();

    let mut union_cols: HashMap<SourceKey, HashSet<&str>> = HashMap::new();
    for (i, key) in source_keys.iter().enumerate() {
        union_cols
            .entry(key.clone())
            .or_default()
            .extend(tables[i].usage.required_columns());
    }

    // Row cache: only used for non-streaming paths (virtual tables, change table events)
    let mut row_cache: HashMap<SourceKey, (Vec<String>, Vec<Vec<NormalizedValue>>)> =
        HashMap::new();

    // Group consecutive table configs that share the same source key.
    // Since tables are sorted by processing order, same-key entries at the same level
    // are contiguous and can share a single stream pass.
    let mut i = 0;
    while i < tables.len() {
        let key = &source_keys[i];

        // Collect all consecutive configs with the same source key at the same processing level
        let mut group_end = i + 1;
        while group_end < tables.len()
            && source_keys[group_end] == *key
            && tables[group_end].usage.processing_order() == tables[i].usage.processing_order()
        {
            group_end += 1;
        }
        let group = &tables[i..group_end];
        let all_streaming = group.iter().all(|t| t.usage.is_streaming_eligible());

        // Streaming path: real table, all usages in group are streaming-eligible
        if matches!(key, SourceKey::Table(..)) && all_streaming {
            if let SourceKey::Table(source_id, table_name) = key {
                if let Some(source) = data_sources.get(source_id) {
                    // Union of required columns across all usages in the group
                    let mut all_cols: HashSet<&str> = HashSet::new();
                    for t in group {
                        all_cols.extend(t.usage.required_columns());
                    }
                    let col_refs: Vec<&str> = all_cols.into_iter().collect();
                    let col_index = build_column_index(&col_refs);
                    let process_start = Instant::now();
                    let mut row_count = 0usize;
                    let usages: Vec<&TableUsageData> = group.iter().map(|t| &t.usage).collect();
                    let locel_ref = &mut locel;
                    let ctx_ref = &mut ctx;
                    let tname = table_name.as_str();
                    let cidx = &col_index;

                    let result = source
                        .for_each_record(table_name, &col_refs, None, |row_data| {
                            let row = IndexedRow {
                                values: &row_data,
                                index: cidx,
                            };
                            for usage in &usages {
                                process_single_row(locel_ref, usage, &row, tname, ctx_ref);
                            }
                            row_count += 1;
                        })
                        .await;

                    match result {
                        Ok(()) => println!(
                            "[Extraction] Streamed '{}': {} rows x {} usages in {:?}",
                            table_name,
                            row_count,
                            group.len(),
                            process_start.elapsed(),
                        ),
                        Err(e) => ctx_ref
                            .errors
                            .push(format!("Stream error '{}': {}", table_name, e)),
                    }

                    i = group_end;
                    continue;
                }
            }
        }

        // Materialized path: virtual tables, or groups containing non-streaming usages
        for j in i..group_end {
            let table = tables[j];
            let key = &source_keys[j];

            if !row_cache.contains_key(key) {
                let cols = union_cols.get(key).cloned().unwrap_or_default();
                match fetch_rows_for_key(key, &cols, data_sources, &virtual_cache).await {
                    Ok(result) => {
                        println!(
                            "[Extraction] Fetched '{}': {} rows, {} cols",
                            key.label(),
                            result.1.len(),
                            result.0.len(),
                        );
                        row_cache.insert(key.clone(), result);
                    }
                    Err(e) => {
                        ctx.errors.push(e);
                        continue;
                    }
                }
            }

            if let Some((col_names, rows)) = row_cache.get(key) {
                let col_refs: Vec<&str> = col_names.iter().map(|s| s.as_str()).collect();
                let col_index = build_column_index(&col_refs);
                let process_start = Instant::now();
                process_rows(
                    &mut locel,
                    &table.usage,
                    rows,
                    &col_index,
                    key.label(),
                    &mut ctx,
                );
                println!(
                    "[Extraction] Processed '{}' in {:?}",
                    key.label(),
                    process_start.elapsed(),
                );
            }
        }

        // Evict cached rows for this key if no more usages at later levels
        let remaining_later = tables[group_end..]
            .iter()
            .enumerate()
            .any(|(k, _)| source_keys[group_end + k] == *key);
        if !remaining_later {
            row_cache.remove(key);
        }

        i = group_end;
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

/// Key identifying a row source (real table or virtual table)
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum SourceKey {
    Table(String, String),
    Virtual(String),
}

impl SourceKey {
    fn label(&self) -> &str {
        match self {
            SourceKey::Table(_, name) => name.as_str(),
            SourceKey::Virtual(id) => id.as_str(),
        }
    }
}

/// Fetch rows for a source key with the given columns
async fn fetch_rows_for_key(
    key: &SourceKey,
    required: &HashSet<&str>,
    sources: &HashMap<String, DataSource>,
    virtual_cache: &VirtualTableCache,
) -> Result<(Vec<String>, Vec<Vec<NormalizedValue>>), String> {
    match key {
        SourceKey::Table(source_id, table_name) => {
            let source = sources
                .get(source_id)
                .ok_or_else(|| format!("No data source for id: {}", source_id))?;
            let col_refs: Vec<&str> = required.iter().copied().collect();
            let fetch_start = Instant::now();
            let rows = source
                .get_all_records(table_name, &col_refs, false)
                .await
                .map_err(|e| format!("Failed to fetch '{}': {}", table_name, e))?;
            println!(
                "[Extraction] Fetched '{}': {} rows in {:?}",
                table_name,
                rows.len(),
                fetch_start.elapsed(),
            );
            let col_names = col_refs.iter().map(|s| s.to_string()).collect();
            Ok((col_names, rows))
        }
        SourceKey::Virtual(vt_id) => {
            let (vt_cols, vt_rows) = virtual_cache
                .get(vt_id)
                .ok_or_else(|| format!("Virtual table '{}' not found in cache", vt_id))?;
            let available: Vec<String> = if required.is_empty() {
                vt_cols.clone()
            } else {
                vt_cols
                    .iter()
                    .filter(|c| required.contains(c.as_str()))
                    .cloned()
                    .collect()
            };
            let vt_col_index: HashMap<&str, usize> = vt_cols
                .iter()
                .enumerate()
                .map(|(i, c)| (c.as_str(), i))
                .collect();
            let rows = vt_rows
                .iter()
                .map(|row| {
                    available
                        .iter()
                        .map(|col_name| {
                            vt_col_index
                                .get(col_name.as_str())
                                .and_then(|&i| row.get(i).cloned())
                                .unwrap_or(NormalizedValue::Null)
                        })
                        .collect()
                })
                .collect();
            Ok((available, rows))
        }
    }
}

/// Process a single row for streaming-eligible usage modes
fn process_single_row(
    locel: &mut SlimLinkedOCEL,
    usage: &TableUsageData,
    row: &IndexedRow<'_>,
    _table_name: &str,
    ctx: &mut ExtractionContext,
) {
    match usage {
        TableUsageData::Event {
            event_type,
            id,
            timestamp,
            inline_object_references,
        } => {
            if let (Some(ev_type), Some(ts)) = (event_type.evaluate(row), timestamp.parse(row)) {
                let event_id = id.as_ref().and_then(|e| e.evaluate(row));
                ensure_event_type(locel, &ev_type);
                let rels = collect_inline_relations(locel, row, inline_object_references, ctx);
                locel.add_event(&ev_type, ts, event_id, Vec::new(), rels);
                ctx.track_event(&ev_type);
            }
        }
        TableUsageData::Object {
            object_type,
            id,
            prefix_id_with_type,
            attribute_config: Some(attribute_config),
            timestamp: Some(timestamp),
        } => {
            // Object with change tracking (attribute values over time)
            if let Some(obj_type) = object_type.evaluate(row) {
                if *prefix_id_with_type {
                    ctx.prefixed_types.insert(obj_type.clone());
                }
                if let (Some(raw_id), Some(ts)) = (id.evaluate(row), timestamp.parse(row)) {
                    let obj_id = maybe_prefix_id(ctx, &obj_type, raw_id);

                    // Create object on first encounter
                    let obj_idx = if let Some(idx) = locel.get_ob_by_id(&obj_id) {
                        idx
                    } else {
                        let attr_names: Vec<String> = match attribute_config {
                            AttributeConfig::Static { mappings } => {
                                mappings.iter().map(|m| m.attribute_name.clone()).collect()
                            }
                            AttributeConfig::Dynamic { .. } => Vec::new(),
                        };
                        let type_attrs: Vec<OCELTypeAttribute> = attr_names
                            .iter()
                            .map(|name| OCELTypeAttribute {
                                name: name.clone(),
                                value_type: "string".to_string(),
                            })
                            .collect();
                        locel.add_object_type(&obj_type, type_attrs);
                        let num_attrs = attr_names.len();
                        match locel.add_object(
                            &obj_type,
                            Some(obj_id),
                            vec![Vec::new(); num_attrs],
                            Vec::new(),
                        ) {
                            Some(idx) => {
                                ctx.track_object(&obj_type);
                                idx
                            }
                            None => return,
                        }
                    };

                    // Append attribute values
                    match attribute_config {
                        AttributeConfig::Static { mappings } => {
                            for mapping in mappings {
                                if let Some(v) = row.get_string(&mapping.source_column) {
                                    if let Some(attr_vals) = obj_idx
                                        .get_attribute_value_mut(&mapping.attribute_name, locel)
                                    {
                                        attr_vals.push((ts, OCELAttributeValue::String(v)));
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
                                if let Some(attr_vals) =
                                    obj_idx.get_attribute_value_mut(&name, locel)
                                {
                                    attr_vals.push((ts, OCELAttributeValue::String(value)));
                                }
                            }
                        }
                    }
                }
            }
        }
        TableUsageData::Object {
            object_type,
            id,
            prefix_id_with_type,
            ..
        } => {
            // Pure object (no change tracking)
            if let (Some(obj_type), Some(raw_id)) = (object_type.evaluate(row), id.evaluate(row)) {
                if *prefix_id_with_type {
                    ctx.prefixed_types.insert(obj_type.clone());
                }
                let obj_id = maybe_prefix_id(ctx, &obj_type, raw_id);
                if ensure_and_add_object(locel, &obj_type, obj_id).is_some() {
                    ctx.track_object(&obj_type);
                }
            }
        }
        TableUsageData::E2ORelation {
            source_event,
            target_object,
            qualifier,
            target_object_type,
            target_object_multi,
        } => {
            if let (Some(event_id), Some(raw_obj_id)) =
                (source_event.evaluate(row), target_object.evaluate(row))
            {
                let Some(ev_idx) = locel.get_ev_by_id(&event_id) else {
                    return;
                };
                let obj_type = target_object_type.as_ref().and_then(|t| t.evaluate(row));
                let qual = qualifier
                    .as_ref()
                    .and_then(|q| q.evaluate(row))
                    .unwrap_or_default();
                let raw_ids = crate::data_extraction::blueprint::split_value(
                    raw_obj_id,
                    target_object_multi.as_ref(),
                );
                for raw_id in raw_ids {
                    let object_id = match &obj_type {
                        Some(t) => maybe_prefix_id(ctx, t, raw_id),
                        None => raw_id,
                    };
                    if let Some(obj_idx) = locel.get_ob_by_id(&object_id) {
                        locel.add_e2o(ev_idx, obj_idx, qual.clone());
                    }
                }
            }
        }
        TableUsageData::O2ORelation {
            source_object,
            target_object,
            qualifier,
            source_object_type,
            target_object_type,
            source_object_multi,
            target_object_multi,
        } => {
            if let (Some(raw_src_id), Some(raw_tgt_id)) =
                (source_object.evaluate(row), target_object.evaluate(row))
            {
                let src_type = source_object_type.as_ref().and_then(|t| t.evaluate(row));
                let tgt_type = target_object_type.as_ref().and_then(|t| t.evaluate(row));
                let qual = qualifier
                    .as_ref()
                    .and_then(|q| q.evaluate(row))
                    .unwrap_or_default();
                let raw_src_ids = crate::data_extraction::blueprint::split_value(
                    raw_src_id,
                    source_object_multi.as_ref(),
                );
                let raw_tgt_ids = crate::data_extraction::blueprint::split_value(
                    raw_tgt_id,
                    target_object_multi.as_ref(),
                );
                for raw_src in &raw_src_ids {
                    let src_id = match &src_type {
                        Some(t) => maybe_prefix_id(ctx, t, raw_src.clone()),
                        None => raw_src.clone(),
                    };
                    let Some(src_idx) = locel.get_ob_by_id(&src_id) else {
                        continue;
                    };
                    for raw_tgt in &raw_tgt_ids {
                        let tgt_id = match &tgt_type {
                            Some(t) => maybe_prefix_id(ctx, t, raw_tgt.clone()),
                            None => raw_tgt.clone(),
                        };
                        if let Some(tgt_idx) = locel.get_ob_by_id(&tgt_id) {
                            locel.add_o2o(src_idx, tgt_idx, qual.clone());
                        }
                    }
                }
            }
        }
        // ChangeTableEvents not handled here (needs pre-compiled rules, uses materialized path)
        _ => {}
    }
}

/// Process all rows for a given table usage.
/// For streaming-eligible modes, delegates to `process_single_row` per row.
/// For modes that need multi-pass (ChangeTableEvents, Object with attribute tracking),
/// uses specialized batch processing.
fn process_rows(
    locel: &mut SlimLinkedOCEL,
    usage: &TableUsageData,
    rows: &[Vec<NormalizedValue>],
    col_index: &ColumnIndex,
    table_name: &str,
    ctx: &mut ExtractionContext,
) {
    match usage {
        // Object with change tracking needs grouped processing (multi-pass)
        TableUsageData::Object {
            object_type,
            id,
            prefix_id_with_type,
            attribute_config: Some(attr_cfg),
            timestamp: Some(ts_source),
        } => {
            process_change_table_objects(
                locel,
                rows,
                col_index,
                id,
                object_type,
                ts_source,
                attr_cfg,
                *prefix_id_with_type,
                ctx,
            );
        }

        // ChangeTableEvents needs pre-compiled rules (multi-pass)
        TableUsageData::ChangeTableEvents {
            timestamp,
            id,
            event_rules,
            inline_object_references,
        } => {
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
                        break;
                    }
                }
            }
        }

        // All other modes: delegate to process_single_row per row (no duplication)
        _ => {
            for row_data in rows {
                let row = IndexedRow {
                    values: row_data,
                    index: col_index,
                };
                process_single_row(locel, usage, &row, table_name, ctx);
            }
        }
    }
}

/// Process object change tracking: group rows by (type, id), collect timed attributes
fn process_change_table_objects(
    locel: &mut SlimLinkedOCEL,
    rows: &[Vec<NormalizedValue>],
    col_index: &ColumnIndex,
    object_id: &ValueExpression,
    object_type: &ValueExpression,
    timestamp: &TimestampSource,
    attribute_config: &AttributeConfig,
    prefix_id_with_type: bool,
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

    // Build attr_name -> positional index map
    let attr_index: HashMap<&str, usize> = attr_names
        .iter()
        .enumerate()
        .map(|(i, name)| (name.as_str(), i))
        .collect();
    let num_attrs = attr_names.len();

    let type_attrs: Vec<OCELTypeAttribute> = attr_names
        .iter()
        .map(|name| OCELTypeAttribute {
            name: name.clone(),
            value_type: "string".to_string(),
        })
        .collect();

    // Group rows by (object_type, object_id), collecting timed attribute values
    // Key: (obj_type, obj_id)
    let mut grouped: HashMap<
        (String, String),
        Vec<Vec<(DateTime<FixedOffset>, OCELAttributeValue)>>,
    > = HashMap::new();

    for row_data in rows {
        let row = IndexedRow {
            values: row_data,
            index: col_index,
        };
        let obj_type = match object_type.evaluate(&row) {
            Some(t) => t,
            None => continue,
        };
        if let (Some(raw_id), Some(ts)) = (object_id.evaluate(&row), timestamp.parse(&row)) {
            if prefix_id_with_type {
                ctx.prefixed_types.insert(obj_type.clone());
            }
            let obj_id = maybe_prefix_id(ctx, &obj_type, raw_id);
            let attrs = grouped
                .entry((obj_type, obj_id))
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

    let mut registered_types: HashSet<String> = HashSet::new();
    for ((obj_type, obj_id), attrs) in grouped {
        if registered_types.insert(obj_type.clone()) {
            locel.add_object_type(&obj_type, type_attrs.clone());
        }
        if locel
            .add_object(&obj_type, Some(obj_id), attrs, Vec::new())
            .is_some()
        {
            ctx.track_object(&obj_type);
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
        let raw_ids = inline_ref.extract_object_ids(row);
        let qualifier = inline_ref
            .qualifier
            .as_ref()
            .and_then(|q| q.evaluate(row))
            .unwrap_or_default();

        // Evaluate the object type once (used for prefix and auto-creation)
        let obj_type = inline_ref
            .object_type
            .as_ref()
            .and_then(|t| t.evaluate(row));

        for raw_id in raw_ids {
            // Apply type prefix if the type is known and uses prefixing
            let obj_id = match &obj_type {
                Some(t) => maybe_prefix_id(ctx, t, raw_id),
                None => raw_id,
            };

            if let Some(obj_index) = locel.get_ob_by_id(&obj_id) {
                // Object already exists
                relationships.push((qualifier.clone(), obj_index));
            } else if let Some(obj_type) = &obj_type {
                // Create new object if we have a type
                if let Some(idx) = ensure_and_add_object(locel, obj_type, obj_id) {
                    relationships.push((qualifier.clone(), idx));
                    ctx.track_object(obj_type);
                }
            }
        }
    }

    relationships
}

/// Connect to all data sources in a blueprint (skips schema discovery for speed)
pub async fn connect_blueprint_sources(
    blueprint: &DataExtractionBlueprint,
) -> anyhow::Result<HashMap<String, DataSource>> {
    let connected = futures::future::try_join_all(blueprint.sources.iter().map(|source| async {
        let ds = DataSource::new_any_without_discovery(
            source.name.clone(),
            source.connection_string.clone(),
        )
        .await?;
        Ok::<_, anyhow::Error>((source.id.clone(), ds))
    }))
    .await?;
    Ok(connected.into_iter().collect())
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
