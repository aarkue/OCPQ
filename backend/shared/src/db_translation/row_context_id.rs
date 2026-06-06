//! Id-native subset-OCEL builder. Produces an [`IdBackedOcel`] keyed by
//! ocel_id, fetching only the rows whose ids the parent query surfaced.
//!
//! Shares the per-type `WHERE ocel_id IN (...)` fetch logic, the
//! row-decoder, and the inline-projection harvest helpers with
//! `row_context.rs`. Public functions return `IdBackedOcel`
//! ready to plug into the id-native CEL evaluator.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, FixedOffset};
use dbcon::NormalizedValue;
use process_mining::core::event_data::object_centric::{
    OCELAttributeValue, OCELEvent, OCELEventAttribute, OCELObject, OCELObjectAttribute,
};

use crate::binding_box::structs::{EventVariable, ObjectVariable};
use crate::db_translation::id_ocel::IdBackedOcel;
use crate::db_translation::mapping::OcelTableMappings;
use crate::db_translation::row_context::{
    self, VarAccess,
};
use crate::db_translation::sql_executor::RowSource;
use crate::db_translation::{DatabaseType, InterMediateNode};

const RESERVED_COLS: &[&str] = &["ocel_id", "ocel_time", "ocel_changed_field", "ocel_type"];

fn lookup_column<'a>(
    row: &'a [(String, NormalizedValue)],
    name: &str,
) -> Option<&'a NormalizedValue> {
    row.iter().find(|(c, _)| c == name).map(|(_, v)| v)
}

fn escape_ocel_id(id: &str) -> anyhow::Result<String> {
    if id.is_empty() {
        anyhow::bail!("row_context_id: empty ocel_id");
    }
    if id.chars().any(|c| (c as u32) < 0x20) {
        anyhow::bail!("row_context_id: refusing to inline ocel_id with control characters");
    }
    let escaped = id.replace('\'', "''");
    Ok(format!("'{escaped}'"))
}

fn build_in_clause<'a, I: IntoIterator<Item = &'a String>>(ids: I) -> anyhow::Result<String> {
    let mut parts = Vec::new();
    for id in ids {
        parts.push(escape_ocel_id(id)?);
    }
    Ok(parts.join(","))
}

fn parse_ocel_time(v: &NormalizedValue) -> anyhow::Result<DateTime<FixedOffset>> {
    if let Some(t) = v.as_timestamp() {
        return Ok(*t);
    }
    if let Some(s) = v.as_str() {
        if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
            return Ok(dt);
        }
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%FT%T%.f") {
            return Ok(dt.and_utc().into());
        }
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%F %T%.f") {
            return Ok(dt.and_utc().into());
        }
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%F %T") {
            return Ok(dt.and_utc().into());
        }
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%F %T UTC") {
            return Ok(dt.and_utc().into());
        }
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%FT%T") {
            return Ok(dt.and_utc().into());
        }
    }
    anyhow::bail!("row_context_id: cannot decode ocel_time: {v:?}")
}

fn normalized_to_ocel_attr(v: &NormalizedValue) -> Option<OCELAttributeValue> {
    row_context::normalized_to_ocel_attr(v)
}

fn decode_event_row(
    event_type: &str,
    row: &[(String, NormalizedValue)],
) -> anyhow::Result<OCELEvent> {
    let id = lookup_column(row, "ocel_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("missing ocel_id in event_{event_type}"))?
        .to_string();
    let time = match lookup_column(row, "ocel_time") {
        Some(v) => parse_ocel_time(v)?,
        None => chrono::DateTime::<chrono::Utc>::UNIX_EPOCH.fixed_offset(),
    };
    let mut attributes: Vec<OCELEventAttribute> = Vec::new();
    for (col, val) in row.iter() {
        if RESERVED_COLS.iter().any(|r| r == col) {
            continue;
        }
        if let Some(v) = normalized_to_ocel_attr(val) {
            attributes.push(OCELEventAttribute {
                name: col.clone(),
                value: v,
            });
        }
    }
    Ok(OCELEvent {
        id,
        event_type: event_type.to_string(),
        time,
        attributes,
        relationships: Vec::new(),
    })
}

fn merge_object_row(
    object_type: &str,
    row: &[(String, NormalizedValue)],
    out: &mut HashMap<String, OCELObject>,
) -> anyhow::Result<()> {
    let id = lookup_column(row, "ocel_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("missing ocel_id in object_{object_type}"))?
        .to_string();
    let time = match lookup_column(row, "ocel_time") {
        Some(v) => parse_ocel_time(v)?,
        None => chrono::DateTime::<chrono::Utc>::UNIX_EPOCH.fixed_offset(),
    };
    let changed_field = lookup_column(row, "ocel_changed_field")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let entry = out.entry(id.clone()).or_insert_with(|| OCELObject {
        id: id.clone(),
        object_type: object_type.to_string(),
        attributes: Vec::new(),
        relationships: Vec::new(),
    });

    match changed_field {
        None => {
            for (col, val) in row.iter() {
                if RESERVED_COLS.iter().any(|r| r == col) {
                    continue;
                }
                if let Some(v) = normalized_to_ocel_attr(val) {
                    entry.attributes.push(OCELObjectAttribute {
                        name: col.clone(),
                        value: v,
                        time,
                    });
                }
            }
        }
        Some(field) => {
            if let Some(val) = lookup_column(row, &field) {
                if let Some(v) = normalized_to_ocel_attr(val) {
                    entry.attributes.push(OCELObjectAttribute {
                        name: field,
                        value: v,
                        time,
                    });
                }
            }
        }
    }
    Ok(())
}

fn select_clause(access: &VarAccess, is_object: bool) -> String {
    if access.all_attrs {
        return "*".to_string();
    }
    let mut cols: Vec<String> = vec!["ocel_id".to_string()];
    if access.time {
        cols.push("ocel_time".to_string());
    }
    if is_object {
        cols.push("ocel_changed_field".to_string());
    }
    for a in access.attrs.iter() {
        cols.push(a.clone());
    }
    cols.into_iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

async fn fetch_events_for_type<'a>(
    source: &RowSource<'a>,
    mappings: &OcelTableMappings,
    event_type: &str,
    ids: &HashSet<String>,
    access: &VarAccess,
) -> anyhow::Result<Vec<OCELEvent>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let from_source = mappings.event_spec(event_type).source_sql(false);
    let select_cols = select_clause(access, false);
    let mut events = Vec::new();
    let mut ids_vec: Vec<&String> = ids.iter().collect();
    ids_vec.sort();
    for chunk in ids_vec.chunks(50_000) {
        let in_clause = build_in_clause(chunk.iter().copied())?;
        let sql = format!(
            "SELECT {} FROM {} AS t WHERE ocel_id IN ({})",
            select_cols, from_source, in_clause
        );
        let mut row_errs: Vec<String> = Vec::new();
        source
            .for_each_row(&sql, |row| match decode_event_row(event_type, &row) {
                Ok(ev) => events.push(ev),
                Err(e) => row_errs.push(e.to_string()),
            })
            .await?;
        if !row_errs.is_empty() {
            anyhow::bail!("row_context_id: event decoding: {}", row_errs.join("; "));
        }
    }
    Ok(events)
}

async fn fetch_objects_for_type<'a>(
    source: &RowSource<'a>,
    mappings: &OcelTableMappings,
    object_type: &str,
    ids: &HashSet<String>,
    access: &VarAccess,
) -> anyhow::Result<Vec<OCELObject>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    if !access.needs_anything() {
        // Caller doesn't need attributes for this object; register
        // empty stubs by ocel_id.
        return Ok(ids
            .iter()
            .map(|id| OCELObject {
                id: id.clone(),
                object_type: object_type.to_string(),
                attributes: Vec::new(),
                relationships: Vec::new(),
            })
            .collect());
    }
    let from_source = mappings.object_spec(object_type).source_sql(true);
    let select_cols = select_clause(access, true);
    let mut by_id: HashMap<String, OCELObject> = HashMap::new();
    let mut ids_vec: Vec<&String> = ids.iter().collect();
    ids_vec.sort();
    for chunk in ids_vec.chunks(50_000) {
        let in_clause = build_in_clause(chunk.iter().copied())?;
        let sql = format!(
            "SELECT {} FROM {} AS t WHERE ocel_id IN ({})",
            select_cols, from_source, in_clause
        );
        let mut row_errs: Vec<String> = Vec::new();
        source
            .for_each_row(&sql, |row| {
                if let Err(e) = merge_object_row(object_type, &row, &mut by_id) {
                    row_errs.push(e.to_string());
                }
            })
            .await?;
        if !row_errs.is_empty() {
            anyhow::bail!("row_context_id: object decoding: {}", row_errs.join("; "));
        }
    }
    Ok(by_id.into_values().collect())
}

/// Sum COUNT(*) over the entity tables the mapping knows about. Used to
/// populate the literals `numEvents()` / `numObjects()` substitutes into
/// CEL strings. When no per-type tables are registered, falls back to the
/// OCEL 2.0 default global tables `event` / `object` produced by
/// `process_mining`'s OCEL SQL exporter.
async fn fetch_aggregate_counts<'a>(
    source: &RowSource<'a>,
    mappings: &OcelTableMappings,
) -> anyhow::Result<(u64, u64)> {
    async fn count_from<'a>(source: &RowSource<'a>, from_sql: &str) -> anyhow::Result<u64> {
        let sql = format!("SELECT COUNT(*) AS c FROM {} AS t", from_sql);
        let mut out: Option<u64> = None;
        source
            .for_each_row(&sql, |row| {
                if let Some((_, v)) = row.first() {
                    let n = match v {
                        NormalizedValue::Integer(i) => Some(*i as u64),
                        NormalizedValue::Float(f) => Some(*f as u64),
                        NormalizedValue::Text(s) => s.parse::<u64>().ok(),
                        _ => None,
                    };
                    if let Some(n) = n {
                        out = Some(n);
                    }
                }
            })
            .await?;
        out.ok_or_else(|| anyhow::anyhow!("COUNT(*) on `{from_sql}` no rows"))
    }
    let mut n_e: u64 = 0;
    if mappings.event_tables.is_empty() {
        n_e += count_from(source, "\"event\"").await?;
    } else {
        for spec in mappings.event_tables.values() {
            n_e += count_from(source, &spec.source_sql(false)).await?;
        }
    }
    let mut n_o: u64 = 0;
    if mappings.object_tables.is_empty() {
        n_o += count_from(source, "\"object\"").await?;
    } else {
        for spec in mappings.object_tables.values() {
            n_o += count_from(source, &spec.source_sql(true)).await?;
        }
    }
    Ok((n_e, n_o))
}

/// Build an [`IdBackedOcel`] containing exactly the events/objects whose
/// ocel_ids appear in `ev_ids_per_type` / `ob_ids_per_type`. Inline-
/// projected event/object records (from a widened parent SELECT) are
/// merged on top. Aggregate counts (`numEvents()` / `numObjects()`)
/// come from one full-dataset `COUNT(*)` per table when the CEL needs
/// them; otherwise default to 0 (rewriter would have substituted).
#[allow(clippy::too_many_arguments)]
pub async fn build_subset_id_ocel<'a>(
    source: &RowSource<'a>,
    _database: DatabaseType,
    mappings: &OcelTableMappings,
    ev_ids_per_type: HashMap<String, HashSet<String>>,
    ob_ids_per_type: HashMap<String, HashSet<String>>,
    ev_access_per_type: &HashMap<String, VarAccess>,
    ob_access_per_type: &HashMap<String, VarAccess>,
    intermediate: &InterMediateNode,
    inlined_events: HashMap<(EventVariable, String), Vec<OCELEventAttribute>>,
    inlined_objects: HashMap<(ObjectVariable, String), Vec<OCELObjectAttribute>>,
    aggregates_needed: bool,
) -> anyhow::Result<IdBackedOcel> {
    let mut ocel = IdBackedOcel::new();
    let default_access = VarAccess::default();
    for (event_type, ids) in &ev_ids_per_type {
        let access = ev_access_per_type.get(event_type).unwrap_or(&default_access);
        if !access.needs_anything() {
            // Register id-only stubs (CEL touches no event-side state).
            for id in ids {
                ocel.insert_event(OCELEvent {
                    id: id.clone(),
                    event_type: event_type.clone(),
                    time: chrono::DateTime::<chrono::Utc>::UNIX_EPOCH.fixed_offset(),
                    attributes: Vec::new(),
                    relationships: Vec::new(),
                });
            }
            continue;
        }
        for ev in
            fetch_events_for_type(source, mappings, event_type, ids, access).await?
        {
            ocel.insert_event(ev);
        }
    }
    for (object_type, ids) in &ob_ids_per_type {
        let access = ob_access_per_type.get(object_type).unwrap_or(&default_access);
        for ob in
            fetch_objects_for_type(source, mappings, object_type, ids, access).await?
        {
            ocel.insert_object(ob);
        }
    }

    // Merge inline-projected records on top. For an event_var whose CEL
    // attribute access was narrow (single-type + only `.attr("X")`),
    // the parent SELECT widened to project the attribute columns and
    // the executor harvested per-(var, id) attribute lists; insert
    // those directly without an IN-clause fetch.
    for ((ev_var, id), attrs) in inlined_events {
        let event_type = intermediate
            .event_vars
            .get(&ev_var)
            .and_then(|types| types.iter().next().cloned())
            .unwrap_or_else(|| "<unknown>".to_string());
        ocel.insert_event(OCELEvent {
            id,
            event_type,
            time: chrono::DateTime::<chrono::Utc>::UNIX_EPOCH.fixed_offset(),
            attributes: attrs,
            relationships: Vec::new(),
        });
    }
    for ((ob_var, id), attrs) in inlined_objects {
        let object_type = intermediate
            .object_vars
            .get(&ob_var)
            .and_then(|types| types.iter().next().cloned())
            .unwrap_or_else(|| "<unknown>".to_string());
        ocel.insert_object(OCELObject {
            id,
            object_type,
            attributes: attrs,
            relationships: Vec::new(),
        });
    }

    if aggregates_needed {
        let (n_e, n_o) = fetch_aggregate_counts(source, mappings).await?;
        ocel.total_events = n_e;
        ocel.total_objects = n_o;
    } else {
        ocel.total_events = ocel.events.len() as u64;
        ocel.total_objects = ocel.objects.len() as u64;
    }

    Ok(ocel)
}
