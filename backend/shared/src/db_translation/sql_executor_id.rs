//! Id-native SQL executor: produces `Vec<(BindingId, Option<ViolationReason>)>`
//! end-to-end against an `IdBackedOcel`, with no host-side `SlimLinkedOCEL`
//! allocation. Each binding carries its per-binding satisfaction status:
//!   - `Some(ViolationReason)`: the binding failed at least one constraint;
//!   - `None`: satisfied all constraints.
//!
//! Three execution paths share normalized-binding output:
//! - `execute_via` (default): reads the SQL-emitted `satisfied` column on each
//!   root row and combines it with host-side labelling / `BasicFilterCEL`.
//! - `execute_via_batched` (root-only AdvancedCEL on DuckDB / PostgreSQL):
//!   `LEFT JOIN LATERAL` attaches per-child rows to each parent row in one
//!   stream; host applies AdvancedCEL over the child binding set.
//! - `execute_via_per_parent` (root-only AdvancedCEL on SQLite, which lacks
//!   `LATERAL`): re-executes the child SQL once per parent binding, literal-
//!   substituting parent ocel_ids.
//! - `execute_via_recursive` (any non-root host-side form, all dialects):
//!   recursive UNION-ALL substitution of parent contexts into child SQL with
//!   `lookup_satisfied` from the SQL-emitted child rows; the dialect-
//!   conditional LATERAL benefit does not apply here.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::binding_box::structs::{
    BindingId, Constraint, EventVariable, Filter, LabelFunction, ObjectVariable, SizeFilter,
    ViolationReason,
};
use crate::cel::{add_cel_label_id, check_cel_predicate_id, get_child_labels_in_cel_program};
use crate::db_translation::id_ocel::IdBackedOcel;
use crate::db_translation::row_context::{
    access_per_type, analyze_var_access, collect_cel_sources, collect_ids_per_var,
    group_ids_by_type, merge_child_ids_per_var, rewrite_aggregate_builtins,
    subtree_has_host_side, VarAccess,
};
use crate::db_translation::row_context_id::build_subset_id_ocel;
use crate::db_translation::sql_executor::{parse_row_id, RowSource};
use crate::db_translation::{
    convert_to_intermediate, translate_to_sql_shared,
    translate_to_sql_shared_with_batched_children, translate_to_sql_shared_with_children,
    translate_to_sql_shared_with_extra_columns, DBTranslationInput, DatabaseType, InterMediateNode,
};
use dbcon::{DataSource, NormalizedValue};
use process_mining::core::event_data::object_centric::{OCELEventAttribute, OCELObjectAttribute};

/// Per-binding result: the ocel_id-keyed binding and an optional
/// `ViolationReason` indicating whether the binding failed any constraint at
/// the root node. Mirrors the in-memory engine's `(Arc<Binding>, Option<ViolationReason>)`
/// shape so normalization and serialisation can treat both backends
/// uniformly.
pub type BindingIdResult = (BindingId, Option<ViolationReason>);

/// Id-native entry point against a `DataSource` (SQLite / PostgreSQL).
/// Returns `Vec<BindingIdResult>`; each entry carries its satisfaction
/// status.
pub async fn execute_translated_query_id(
    input: DBTranslationInput,
    data_source: &DataSource,
) -> anyhow::Result<Vec<BindingIdResult>> {
    execute_via(input, RowSource::Dbcon(data_source)).await
}

/// Id-native entry point against a DuckDB connection.
pub async fn execute_translated_query_id_duckdb(
    input: DBTranslationInput,
    duckdb_conn: &duckdb::Connection,
) -> anyhow::Result<Vec<BindingIdResult>> {
    execute_via(input, RowSource::DuckDb(duckdb_conn)).await
}

async fn execute_via(
    input: DBTranslationInput,
    source: RowSource<'_>,
) -> anyhow::Result<Vec<BindingIdResult>> {
    let DBTranslationInput {
        tree,
        database,
        table_mappings,
    } = input;
    let intermediate = convert_to_intermediate(tree.clone());

    let advanced_cel_filters_raw: Vec<String> = intermediate
        .sizefilter
        .iter()
        .filter_map(|sf| match sf {
            SizeFilter::AdvancedCEL { cel } => Some(cel.clone()),
            _ => None,
        })
        .collect();

    let dialect_supports_lateral = matches!(
        database,
        DatabaseType::DuckDB | DatabaseType::PostgreSQL
    );

    // A LabelFunction at the parent may reference a child-edge label name
    // (e.g. `A.map(b, ...)` for an edge named "A"), in which case the
    // evaluator needs per-parent child bindings just like AdvancedCEL does.
    // Detect this and route through the child-aware path even when no
    // AdvancedCEL size filter is present.
    let child_edge_labels: Vec<String> = intermediate
        .children
        .iter()
        .map(|(_, l)| l.clone())
        .collect();
    let labels_need_child_bindings = !child_edge_labels.is_empty()
        && intermediate.labels.iter().any(|lf| {
            !get_child_labels_in_cel_program(&lf.cel, &child_edge_labels).is_empty()
        });

    // Route through the arbitrary-depth recursive host-side path when any
    // non-root node carries a host-side form (BasicFilterCEL, AdvancedCEL, or
    // LabelFunction). The existing root-only paths (`execute_via_batched`,
    // `execute_via_per_parent`) only handle host-side forms at the root; with
    // non-root CEL the emitter relaxes parent K_C / SizeFilter clauses for
    // CEL-affected children, and the host re-checks them against post-CEL
    // child counts.
    if tree_has_non_root_host_side(&intermediate) {
        return execute_via_recursive(
            tree,
            database,
            table_mappings,
            intermediate,
            source,
        )
        .await;
    }

    if !advanced_cel_filters_raw.is_empty() || labels_need_child_bindings {
        if dialect_supports_lateral {
            return execute_via_batched(
                tree,
                database,
                table_mappings,
                intermediate,
                advanced_cel_filters_raw,
                source,
            )
            .await;
        } else {
            return execute_via_per_parent(
                tree,
                database,
                table_mappings,
                intermediate,
                advanced_cel_filters_raw,
                source,
            )
            .await;
        }
    }

    let prune_cel_raw: Vec<String> = cel_filters_for_pruning(&intermediate);
    let label_cel_raw: Vec<String> = cel_constraints_for_labelling(&intermediate);
    // Union for the analyses that don't care about prune-vs-label semantics
    // (subset OCEL build, aggregate-builtin detection).
    let cel_predicates_raw: Vec<String> = prune_cel_raw
        .iter()
        .chain(label_cel_raw.iter())
        .cloned()
        .collect();
    let label_functions_raw: Vec<LabelFunction> = intermediate.labels.clone();
    let event_vars: Vec<EventVariable> = intermediate.event_vars.keys().cloned().collect();
    let object_vars: Vec<ObjectVariable> = intermediate.object_vars.keys().cloned().collect();

    // CEL access analysis, same logic as the row-context path in
    // sql_executor.rs.
    let cel_sources = collect_cel_sources(&cel_predicates_raw, &[], &label_functions_raw);
    let (ev_access_var, ob_access_var) = analyze_var_access(&cel_sources);

    let extra_event_attrs: Vec<(EventVariable, String)> = ev_access_var
        .iter()
        .filter(|(_, a)| !a.all_attrs && !a.time)
        .filter_map(|(ev, a)| {
            let types = intermediate.event_vars.get(ev)?;
            if types.len() != 1 {
                return None;
            }
            let mut attrs: Vec<(EventVariable, String)> = Vec::new();
            let mut sorted: Vec<&String> = a.attrs.iter().collect();
            sorted.sort();
            for attr in sorted {
                attrs.push((*ev, attr.clone()));
            }
            Some(attrs)
        })
        .flatten()
        .collect();
    let extra_object_attrs: Vec<(ObjectVariable, String)> = ob_access_var
        .iter()
        .filter(|(_, a)| !a.all_attrs && !a.time)
        .filter_map(|(ob, a)| {
            let types = intermediate.object_vars.get(ob)?;
            if types.len() != 1 {
                return None;
            }
            let mut attrs: Vec<(ObjectVariable, String)> = Vec::new();
            let mut sorted: Vec<&String> = a.attrs.iter().collect();
            sorted.sort();
            for attr in sorted {
                attrs.push((*ob, attr.clone()));
            }
            Some(attrs)
        })
        .flatten()
        .collect();

    let inlined_event_vars: HashSet<EventVariable> = ev_access_var
        .iter()
        .filter(|(_, a)| !a.all_attrs && !a.time)
        .filter(|(ev, _)| {
            intermediate
                .event_vars
                .get(ev)
                .map(|t| t.len() == 1)
                .unwrap_or(false)
        })
        .map(|(ev, _)| *ev)
        .collect();
    let inlined_object_vars: HashSet<ObjectVariable> = ob_access_var
        .iter()
        .filter(|(_, a)| !a.all_attrs && !a.time)
        .filter(|(ob, _)| {
            intermediate
                .object_vars
                .get(ob)
                .map(|t| t.len() == 1)
                .unwrap_or(false)
        })
        .map(|(ob, _)| *ob)
        .collect();

    // Emit parent SQL (with optional inline attribute projection).
    let sql = if !extra_event_attrs.is_empty() || !extra_object_attrs.is_empty() {
        translate_to_sql_shared_with_extra_columns(
            DBTranslationInput {
                tree,
                database,
                table_mappings: table_mappings.clone(),
            },
            &extra_event_attrs,
            &extra_object_attrs,
        )
    } else {
        translate_to_sql_shared(DBTranslationInput {
            tree,
            database,
            table_mappings: table_mappings.clone(),
        })
    };

    // Pass 1: buffer parent rows.
    let mut buffered_rows: Vec<Vec<(String, NormalizedValue)>> = Vec::new();
    source
        .for_each_row(&sql, |row| buffered_rows.push(row))
        .await?;

    // Collect per-variable ocel_ids from buffered rows.
    let (ev_ids_per_var, ob_ids_per_var) =
        collect_ids_per_var(&buffered_rows, &event_vars, &object_vars);

    // Harvest inline-projected attribute values (events).
    let mut inlined_event_records: HashMap<(EventVariable, String), Vec<OCELEventAttribute>> =
        HashMap::new();
    for row in &buffered_rows {
        for ev in &event_vars {
            if !inlined_event_vars.contains(ev) {
                continue;
            }
            let id_col = format!("E{}", ev.0 + 1);
            let id = match lookup_column(row, &id_col).and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let entry = inlined_event_records.entry((*ev, id.clone())).or_default();
            if !entry.is_empty() {
                continue;
            }
            for (_var, attr) in extra_event_attrs.iter().filter(|(v, _)| v == ev) {
                let col = format!("E{}__{}", ev.0 + 1, attr);
                if let Some(val) = lookup_column(row, &col) {
                    if let Some(ocel_val) =
                        crate::db_translation::row_context::normalized_to_ocel_attr(val)
                    {
                        entry.push(OCELEventAttribute {
                            name: attr.clone(),
                            value: ocel_val,
                        });
                    }
                }
            }
        }
    }
    let mut inlined_object_records: HashMap<
        (ObjectVariable, String),
        Vec<OCELObjectAttribute>,
    > = HashMap::new();
    for row in &buffered_rows {
        for ob in &object_vars {
            if !inlined_object_vars.contains(ob) {
                continue;
            }
            let id_col = format!("O{}", ob.0 + 1);
            let id = match lookup_column(row, &id_col).and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let entry = inlined_object_records
                .entry((*ob, id.clone()))
                .or_default();
            if !entry.is_empty() {
                continue;
            }
            let epoch = chrono::DateTime::<chrono::Utc>::UNIX_EPOCH.fixed_offset();
            for (_var, attr) in extra_object_attrs.iter().filter(|(v, _)| v == ob) {
                let col = format!("O{}__{}", ob.0 + 1, attr);
                if let Some(val) = lookup_column(row, &col) {
                    if let Some(ocel_val) =
                        crate::db_translation::row_context::normalized_to_ocel_attr(val)
                    {
                        entry.push(OCELObjectAttribute {
                            name: attr.clone(),
                            value: ocel_val,
                            time: epoch,
                        });
                    }
                }
            }
        }
    }

    // Group remaining (non-inlined) id sets by candidate type.
    let mut ev_ids_remaining: HashMap<EventVariable, HashSet<String>> = HashMap::new();
    for (var, ids) in &ev_ids_per_var {
        if inlined_event_vars.contains(var) {
            continue;
        }
        ev_ids_remaining.insert(*var, ids.clone());
    }
    let mut ob_ids_remaining: HashMap<ObjectVariable, HashSet<String>> = HashMap::new();
    for (var, ids) in &ob_ids_per_var {
        if inlined_object_vars.contains(var) {
            continue;
        }
        ob_ids_remaining.insert(*var, ids.clone());
    }
    let (ev_ids_per_type, ob_ids_per_type) =
        group_ids_by_type(ev_ids_remaining, ob_ids_remaining, &intermediate);
    let (ev_access_per_type, ob_access_per_type) =
        access_per_type(&ev_access_var, &ob_access_var, &intermediate);

    // Aggregate-builtin handling: rewrite CEL strings when `numEvents()`
    // / `numObjects()` appear; the subset IdBackedOcel does not hold
    // the full-dataset counts unless we pre-fetch.
    let aggregates_needed = cel_predicates_raw
        .iter()
        .any(|c| c.contains("numEvents") || c.contains("numObjects"))
        || label_functions_raw
            .iter()
            .any(|l| l.cel.contains("numEvents") || l.cel.contains("numObjects"));

    let id_ocel: IdBackedOcel = build_subset_id_ocel(
        &source,
        database,
        &table_mappings,
        ev_ids_per_type,
        ob_ids_per_type,
        &ev_access_per_type,
        &ob_access_per_type,
        &intermediate,
        inlined_event_records,
        inlined_object_records,
        aggregates_needed,
    )
    .await?;

    // CEL string rewrite (literal substitution) so the subset OCEL's
    // limited counts do not fool the evaluator.
    let rewrite = |s: &str| -> String {
        if aggregates_needed {
            rewrite_aggregate_builtins(s, id_ocel.total_events, id_ocel.total_objects)
        } else {
            s.to_string()
        }
    };
    let prune_cel: Vec<String> = prune_cel_raw.iter().map(|s| rewrite(s)).collect();
    let label_cel: Vec<String> = label_cel_raw.iter().map(|s| rewrite(s)).collect();
    let label_functions: Vec<LabelFunction> = label_functions_raw
        .into_iter()
        .map(|mut lf| {
            lf.cel = rewrite(&lf.cel);
            lf
        })
        .collect();

    // Materialize (BindingId, sql_satisfied) from buffered rows. The SQL
    // emitter projects a `satisfied` column iff the root carries any
    // constraints; otherwise we default to satisfied.
    let mut bindings_with_sat: Vec<(BindingId, bool)> = Vec::new();
    for row in buffered_rows.drain(..) {
        let bid = row_to_binding_id(&row, &event_vars, &object_vars)?;
        let sat = lookup_satisfied(&row);
        bindings_with_sat.push((bid, sat));
    }
    drop(buffered_rows);

    let into_result =
        |b: BindingId, sat: bool| -> (BindingId, Option<ViolationReason>) {
            if sat {
                (b, None)
            } else {
                (b, Some(ViolationReason::ConstraintNotSatisfied(0)))
            }
        };

    if prune_cel.is_empty() && label_cel.is_empty() && label_functions.is_empty() {
        // Fast path: no CEL, satisfied flag from SQL is final.
        return Ok(bindings_with_sat
            .into_iter()
            .map(|(b, sat)| into_result(b, sat))
            .collect());
    }

    // CEL post-processing pass. No child bindings in this minimal path
    // (no AdvancedCEL); child_res is always None.
    let mut out: Vec<(BindingId, Option<ViolationReason>)> =
        Vec::with_capacity(bindings_with_sat.len());
    for (mut binding, mut sat) in bindings_with_sat {
        // Pruning CEL (filter slot): failing drops the binding entirely.
        let mut keep = true;
        for cel in &prune_cel {
            match check_cel_predicate_id(
                cel,
                &binding,
                None::<&HashMap<String, Vec<(Arc<BindingId>, Option<ViolationReason>)>>>,
                &id_ocel,
            ) {
                Ok(true) => {}
                Ok(false) => {
                    keep = false;
                    break;
                }
                Err(e) => anyhow::bail!("CEL evaluation failed for `{}`: {}", cel, e),
            }
        }
        if !keep {
            continue;
        }
        // Labelling CEL (constraint slot): failing sets sat=false but the
        // binding is retained (labelled violated).
        if sat {
            for cel in &label_cel {
                match check_cel_predicate_id(
                    cel,
                    &binding,
                    None::<&HashMap<String, Vec<(Arc<BindingId>, Option<ViolationReason>)>>>,
                    &id_ocel,
                ) {
                    Ok(true) => {}
                    Ok(false) => {
                        sat = false;
                        break;
                    }
                    Err(e) => anyhow::bail!("CEL evaluation failed for `{}`: {}", cel, e),
                }
            }
        }
        // Label functions apply to all surviving bindings (sat or not).
        for label_fun in &label_functions {
            if let Err(e) = add_cel_label_id(
                &mut binding,
                None::<&HashMap<String, Vec<(Arc<BindingId>, Option<ViolationReason>)>>>,
                &id_ocel,
                label_fun,
            ) {
                anyhow::bail!(
                    "LabelFunction evaluation failed for `{}`: {}",
                    label_fun.label,
                    e
                );
            }
        }
        out.push(into_result(binding, sat));
    }
    Ok(out)
}

/// CEL strings that PRUNE bindings on failure. These come from
/// `BindingBox.filters` (filter slot) only: per OCPQ semantics, a filter
/// drops bindings that fail it.
fn cel_filters_for_pruning(node: &InterMediateNode) -> Vec<String> {
    node.filter
        .iter()
        .filter_map(|f| match f {
            Filter::BasicFilterCEL { cel } => Some(cel.clone()),
            _ => None,
        })
        .collect()
}

/// CEL strings that LABEL bindings as satisfied/violated on failure (no
/// pruning). These come from `BindingBox.constraints` (constraint slot)
/// wrapping a `Filter::BasicFilterCEL`. Per OCPQ semantics, constraints
/// label rather than prune; the binding is kept either way and the
/// satisfied flag is the AND of the SQL-emitted `satisfied` column with
/// every labelling CEL evaluation.
fn cel_constraints_for_labelling(node: &InterMediateNode) -> Vec<String> {
    node.constraints
        .iter()
        .filter_map(|c| match c {
            Constraint::Filter {
                filter: Filter::BasicFilterCEL { cel },
            } => Some(cel.clone()),
            _ => None,
        })
        .collect()
}

/// Read the SQL-emitted `satisfied` column from a row. The emitter
/// projects `CASE WHEN <root_constr_expr> THEN TRUE ELSE FALSE END AS
/// satisfied` when the root node carries any constraints; absent any
/// root constraint the column is omitted and we default to TRUE.
fn lookup_satisfied(row: &[(String, NormalizedValue)]) -> bool {
    match lookup_column(row, "satisfied") {
        Some(NormalizedValue::Boolean(b)) => *b,
        Some(NormalizedValue::Integer(i)) => *i != 0,
        Some(NormalizedValue::Float(f)) => *f != 0.0,
        Some(NormalizedValue::Text(s)) | Some(NormalizedValue::Unknown(s)) => {
            !matches!(s.as_str(), "0" | "false" | "FALSE" | "False" | "f" | "F")
        }
        _ => true,
    }
}

/// When a parent CEL (filter, AdvancedCEL body, or label) references a
/// child-edge label (e.g. `A.map(b, b['e2'].time())` for an edge named
/// `A`), the lambda walks child bindings via patterns the per-variable
/// access walker (`analyze_var_access`) cannot statically resolve. Mark
/// every event/object type that appears anywhere in the referenced
/// child's subtree as fully accessed (`all_attrs = true`, `time = true`)
/// so the subset OCEL carries the timestamps + attributes the lambda
/// may read at evaluation time. Both `execute_via_batched` and
/// `execute_via_per_parent`, the two paths that materialise child bindings
/// for parent-side CEL, depend on this widening.
fn widen_child_subtree_access_if_referenced(
    intermediate: &InterMediateNode,
    cel_predicates_raw: &[String],
    advanced_cel_filters_raw: &[String],
    label_functions_raw: &[LabelFunction],
    ev_access_per_type: &mut HashMap<String, crate::db_translation::row_context::VarAccess>,
    ob_access_per_type: &mut HashMap<String, crate::db_translation::row_context::VarAccess>,
) {
    let child_edge_labels: Vec<String> = intermediate
        .children
        .iter()
        .map(|(_, l)| l.clone())
        .collect();
    if child_edge_labels.is_empty() {
        return;
    }
    let mut referenced: HashSet<String> = HashSet::new();
    for cel in cel_predicates_raw.iter().chain(advanced_cel_filters_raw.iter()) {
        for l in get_child_labels_in_cel_program(cel, &child_edge_labels) {
            referenced.insert(l);
        }
    }
    for lf in label_functions_raw {
        for l in get_child_labels_in_cel_program(&lf.cel, &child_edge_labels) {
            referenced.insert(l);
        }
    }
    if referenced.is_empty() {
        return;
    }
    fn full_access() -> crate::db_translation::row_context::VarAccess {
        crate::db_translation::row_context::VarAccess {
            time: true,
            all_attrs: true,
            attrs: HashSet::new(),
        }
    }
    fn widen_subtree(
        node: &InterMediateNode,
        ev: &mut HashMap<String, crate::db_translation::row_context::VarAccess>,
        ob: &mut HashMap<String, crate::db_translation::row_context::VarAccess>,
    ) {
        for (_, types) in &node.event_vars {
            for t in types {
                ev.insert(t.clone(), full_access());
            }
        }
        for (_, types) in &node.object_vars {
            for t in types {
                ob.insert(t.clone(), full_access());
            }
        }
        for (child, _) in &node.children {
            widen_subtree(child, ev, ob);
        }
    }
    for (child_node, label) in &intermediate.children {
        if referenced.contains(label) {
            widen_subtree(child_node, ev_access_per_type, ob_access_per_type);
        }
    }
}

fn row_to_binding_id(
    row: &[(String, NormalizedValue)],
    event_vars: &[EventVariable],
    object_vars: &[ObjectVariable],
) -> anyhow::Result<BindingId> {
    let mut binding = BindingId::default();
    for ev in event_vars {
        let col = format!("E{}", ev.0 + 1);
        let id = lookup_column(row, &col)
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing or non-text SELECT column `{col}`"))?
            .to_string();
        binding.event_map.push((*ev, Arc::new(id)));
    }
    for ob in object_vars {
        let col = format!("O{}", ob.0 + 1);
        let id = lookup_column(row, &col)
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing or non-text SELECT column `{col}`"))?
            .to_string();
        binding.object_map.push((*ob, Arc::new(id)));
    }
    binding.event_map.sort_by_key(|x| x.0);
    binding.object_map.sort_by_key(|x| x.0);
    Ok(binding)
}

fn lookup_column<'a>(
    row: &'a [(String, NormalizedValue)],
    name: &str,
) -> Option<&'a NormalizedValue> {
    row.iter().find(|(c, _)| c == name).map(|(_, v)| v)
}

#[allow(dead_code)]
fn _unused_var_access_anchor(v: VarAccess) -> bool {
    v.needs_anything()
}

/// Batched, id-native AdvancedCEL path. Uses `LEFT JOIN LATERAL`
/// (DuckDB / PostgreSQL only); SQLite goes through
/// [`execute_via_per_parent`] instead.
async fn execute_via_batched(
    tree: crate::binding_box::BindingBoxTree,
    database: DatabaseType,
    table_mappings: crate::db_translation::TableMappings,
    intermediate: InterMediateNode,
    advanced_cel_filters_raw: Vec<String>,
    source: RowSource<'_>,
) -> anyhow::Result<Vec<BindingIdResult>> {
    let prune_cel_raw: Vec<String> = cel_filters_for_pruning(&intermediate);
    let label_cel_raw: Vec<String> = cel_constraints_for_labelling(&intermediate);
    let cel_predicates_raw: Vec<String> = prune_cel_raw
        .iter()
        .chain(label_cel_raw.iter())
        .cloned()
        .collect();
    let label_functions_raw: Vec<LabelFunction> = intermediate.labels.clone();
    let event_vars: Vec<EventVariable> = intermediate.event_vars.keys().cloned().collect();
    let object_vars: Vec<ObjectVariable> = intermediate.object_vars.keys().cloned().collect();

    let (parent_only_sql, batched_per_child) =
        translate_to_sql_shared_with_batched_children(DBTranslationInput {
            tree,
            database,
            table_mappings: table_mappings.clone(),
        });

    let candidate_labels: Vec<String> = batched_per_child
        .iter()
        .map(|(label, _)| label.clone())
        .collect();
    let mut needed_labels: HashSet<String> = HashSet::new();
    for cel in &advanced_cel_filters_raw {
        for l in get_child_labels_in_cel_program(cel, &candidate_labels) {
            needed_labels.insert(l);
        }
    }
    for label_fun in &label_functions_raw {
        for l in get_child_labels_in_cel_program(&label_fun.cel, &candidate_labels) {
            needed_labels.insert(l);
        }
    }

    // Buffer parent rows.
    let mut parent_rows: Vec<(i64, Vec<(String, NormalizedValue)>)> = Vec::new();
    let mut row_errors: Vec<String> = Vec::new();
    source
        .for_each_row(&parent_only_sql, |row| {
            let row_id = match parse_row_id(lookup_column(&row, "__parent_row_id__")) {
                Ok(i) => i,
                Err(e) => {
                    row_errors.push(e);
                    return;
                }
            };
            parent_rows.push((row_id, row));
        })
        .await?;
    if !row_errors.is_empty() {
        anyhow::bail!(
            "{} parent row(s) could not be mapped: {}",
            row_errors.len(),
            row_errors.join("; ")
        );
    }

    // Buffer per-label child rows (only for labels the CEL evaluator
    // reads).
    let mut child_rows_by_label: HashMap<String, Vec<Vec<(String, NormalizedValue)>>> =
        HashMap::new();
    for (label, batched_sql) in batched_per_child.iter() {
        if !needed_labels.contains(label) {
            continue;
        }
        let mut rows: Vec<Vec<(String, NormalizedValue)>> = Vec::new();
        source
            .for_each_row(batched_sql, |row| rows.push(row))
            .await?;
        child_rows_by_label.insert(label.clone(), rows);
    }

    // Collect ids from parent + child rows for the subset OCEL.
    let parent_rows_only: Vec<Vec<(String, NormalizedValue)>> =
        parent_rows.iter().map(|(_, r)| r.clone()).collect();
    let (mut ev_ids_per_var, mut ob_ids_per_var) =
        collect_ids_per_var(&parent_rows_only, &event_vars, &object_vars);
    drop(parent_rows_only);
    for (label, rows) in &child_rows_by_label {
        let child_node = intermediate
            .children
            .iter()
            .find_map(|(node, lbl)| if lbl == label { Some(node) } else { None })
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "batched child label `{}` not found in intermediate.children",
                    label
                )
            })?;
        let child_event_vars: Vec<EventVariable> = child_node.event_vars.keys().cloned().collect();
        let child_object_vars: Vec<ObjectVariable> = child_node.object_vars.keys().cloned().collect();
        merge_child_ids_per_var(
            rows,
            &event_vars,
            &object_vars,
            &child_event_vars,
            &child_object_vars,
            &mut ev_ids_per_var,
            &mut ob_ids_per_var,
        );
    }
    let (ev_ids_per_type, ob_ids_per_type) =
        group_ids_by_type(ev_ids_per_var, ob_ids_per_var, &intermediate);

    let cel_sources = collect_cel_sources(
        &cel_predicates_raw,
        &advanced_cel_filters_raw,
        &label_functions_raw,
    );
    let (ev_access_var, ob_access_var) = analyze_var_access(&cel_sources);
    let (mut ev_access_per_type, mut ob_access_per_type) =
        access_per_type(&ev_access_var, &ob_access_var, &intermediate);
    widen_child_subtree_access_if_referenced(
        &intermediate,
        &cel_predicates_raw,
        &advanced_cel_filters_raw,
        &label_functions_raw,
        &mut ev_access_per_type,
        &mut ob_access_per_type,
    );

    let aggregates_needed = cel_predicates_raw
        .iter()
        .chain(advanced_cel_filters_raw.iter())
        .any(|c| c.contains("numEvents") || c.contains("numObjects"))
        || label_functions_raw
            .iter()
            .any(|l| l.cel.contains("numEvents") || l.cel.contains("numObjects"));

    let id_ocel: IdBackedOcel = build_subset_id_ocel(
        &source,
        database,
        &table_mappings,
        ev_ids_per_type,
        ob_ids_per_type,
        &ev_access_per_type,
        &ob_access_per_type,
        &intermediate,
        HashMap::new(),
        HashMap::new(),
        aggregates_needed,
    )
    .await?;

    let rewrite = |s: &str| -> String {
        if aggregates_needed {
            rewrite_aggregate_builtins(s, id_ocel.total_events, id_ocel.total_objects)
        } else {
            s.to_string()
        }
    };
    let prune_cel: Vec<String> = prune_cel_raw.iter().map(|s| rewrite(s)).collect();
    let label_cel: Vec<String> = label_cel_raw.iter().map(|s| rewrite(s)).collect();
    let advanced_cel_filters: Vec<String> =
        advanced_cel_filters_raw.iter().map(|s| rewrite(s)).collect();
    let label_functions: Vec<LabelFunction> = label_functions_raw
        .into_iter()
        .map(|mut lf| {
            lf.cel = rewrite(&lf.cel);
            lf
        })
        .collect();

    // Materialise parent BindingIds + capture SQL-emitted `satisfied`
    // flag (reflects non-CEL root constraints; absent column -> true).
    let mut parent_bindings_by_row_id: HashMap<i64, (BindingId, bool)> = HashMap::new();
    let mut parent_order: Vec<i64> = Vec::with_capacity(parent_rows.len());
    for (row_id, row) in parent_rows.drain(..) {
        let b = row_to_binding_id(&row, &event_vars, &object_vars)?;
        let sat = lookup_satisfied(&row);
        parent_bindings_by_row_id.insert(row_id, (b, sat));
        parent_order.push(row_id);
    }

    // Materialise child BindingIds, grouped per parent row id.
    let mut per_parent_child_res: HashMap<
        i64,
        HashMap<String, Vec<(Arc<BindingId>, Option<ViolationReason>)>>,
    > = HashMap::new();
    for (label, rows) in child_rows_by_label.drain() {
        let child_node = intermediate
            .children
            .iter()
            .find_map(|(node, lbl)| if lbl == &label { Some(node) } else { None })
            .ok_or_else(|| anyhow::anyhow!("child label `{}` not found", label))?;
        let child_event_vars: Vec<EventVariable> = child_node.event_vars.keys().cloned().collect();
        let child_object_vars: Vec<ObjectVariable> =
            child_node.object_vars.keys().cloned().collect();
        let by_row_id =
            build_child_bindings_by_parent_id(&rows, &child_event_vars, &child_object_vars)?;
        for (row_id, group) in by_row_id {
            per_parent_child_res
                .entry(row_id)
                .or_default()
                .insert(label.clone(), group);
        }
    }

    // Walk parent bindings in SQL order, apply CEL.
    // Pruning order: filter-slot CEL -> AdvancedCEL size filter (both drop
    // bindings on failure). Labelling: constraint-slot CEL ANDs into the
    // SQL-emitted `sat` flag without dropping. LabelFunctions run over
    // every surviving binding regardless of sat.
    let mut kept: Vec<(BindingId, bool)> = Vec::with_capacity(parent_order.len());
    for row_id in parent_order {
        let (mut binding, mut sat) = match parent_bindings_by_row_id.remove(&row_id) {
            Some(pair) => pair,
            None => continue,
        };
        let mut keep = true;
        for cel in &prune_cel {
            match check_cel_predicate_id(cel, &binding, None, &id_ocel) {
                Ok(true) => {}
                Ok(false) => {
                    keep = false;
                    break;
                }
                Err(e) => anyhow::bail!("CEL evaluation failed for `{}`: {}", cel, e),
            }
        }
        if !keep {
            continue;
        }
        let child_res = per_parent_child_res.remove(&row_id).unwrap_or_default();
        for cel in &advanced_cel_filters {
            match check_cel_predicate_id(cel, &binding, Some(&child_res), &id_ocel) {
                Ok(true) => {}
                Ok(false) => {
                    keep = false;
                    break;
                }
                Err(e) => anyhow::bail!("AdvancedCEL evaluation failed for `{}`: {}", cel, e),
            }
        }
        if !keep {
            continue;
        }
        if sat {
            for cel in &label_cel {
                match check_cel_predicate_id(cel, &binding, Some(&child_res), &id_ocel) {
                    Ok(true) => {}
                    Ok(false) => {
                        sat = false;
                        break;
                    }
                    Err(e) => anyhow::bail!("CEL evaluation failed for `{}`: {}", cel, e),
                }
            }
        }
        for label_fun in &label_functions {
            if let Err(e) =
                add_cel_label_id(&mut binding, Some(&child_res), &id_ocel, label_fun)
            {
                anyhow::bail!(
                    "LabelFunction evaluation failed for `{}`: {}",
                    label_fun.label,
                    e
                );
            }
        }
        kept.push((binding, sat));
    }
    Ok(kept
        .into_iter()
        .map(|(b, sat)| {
            if sat {
                (b, None)
            } else {
                (b, Some(ViolationReason::ConstraintNotSatisfied(0)))
            }
        })
        .collect())
}

fn build_child_bindings_by_parent_id(
    rows: &[Vec<(String, NormalizedValue)>],
    child_event_vars: &[EventVariable],
    child_object_vars: &[ObjectVariable],
) -> anyhow::Result<HashMap<i64, Vec<(Arc<BindingId>, Option<ViolationReason>)>>> {
    let mut out: HashMap<i64, Vec<(Arc<BindingId>, Option<ViolationReason>)>> = HashMap::new();
    let mut row_errors: Vec<String> = Vec::new();
    for row in rows {
        let row_id = match parse_row_id(lookup_column(row, "__parent_row_id__")) {
            Ok(i) => i,
            Err(e) => {
                row_errors.push(e);
                continue;
            }
        };
        out.entry(row_id).or_default();

        let satisfied = lookup_column(row, "satisfied");
        if matches!(satisfied, Some(NormalizedValue::Null) | None) {
            continue;
        }

        // Reconstruct child binding: parent vars carried as `E<n>` /
        // `O<n>` on every row; child new vars as `key_e<n>` / `key_o<n>`.
        let mut binding = BindingId::default();
        let mut bad = false;
        for (col_name, value) in row.iter() {
            if let Some(stripped) = col_name.strip_prefix('E') {
                if let Ok(n) = stripped.parse::<usize>() {
                    if n >= 1 {
                        match value.as_str() {
                            Some(id) => binding
                                .event_map
                                .push((EventVariable(n - 1), Arc::new(id.to_string()))),
                            None => {
                                row_errors.push(format!(
                                    "parent column `{col_name}` is not text"
                                ));
                                bad = true;
                                break;
                            }
                        }
                    }
                }
            } else if let Some(stripped) = col_name.strip_prefix('O') {
                if let Ok(n) = stripped.parse::<usize>() {
                    if n >= 1 {
                        match value.as_str() {
                            Some(id) => binding
                                .object_map
                                .push((ObjectVariable(n - 1), Arc::new(id.to_string()))),
                            None => {
                                row_errors.push(format!(
                                    "parent column `{col_name}` is not text"
                                ));
                                bad = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
        if bad {
            continue;
        }
        for ev in child_event_vars {
            let col = format!("key_e{}", ev.0 + 1);
            let id = match lookup_column(row, &col).and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => {
                    row_errors.push(format!("missing child column `{col}`"));
                    bad = true;
                    break;
                }
            };
            binding.event_map.push((*ev, Arc::new(id)));
        }
        if bad {
            continue;
        }
        for ob in child_object_vars {
            let col = format!("key_o{}", ob.0 + 1);
            let id = match lookup_column(row, &col).and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => {
                    row_errors.push(format!("missing child column `{col}`"));
                    bad = true;
                    break;
                }
            };
            binding.object_map.push((*ob, Arc::new(id)));
        }
        if bad {
            continue;
        }
        binding.event_map.sort_by_key(|x| x.0);
        binding.object_map.sort_by_key(|x| x.0);
        out.entry(row_id)
            .or_default()
            .push((Arc::new(binding), None));
    }
    if !row_errors.is_empty() {
        anyhow::bail!(
            "AdvancedCEL batched stream: {} row(s) failed: {}",
            row_errors.len(),
            row_errors.join("; ")
        );
    }
    Ok(out)
}

/// Per-parent, id-native path for dialects without LATERAL (SQLite).
/// For each parent binding, the child SQL is substituted with the parent's
/// ocel_ids (Arc<String> from BindingId.event_map, no `locel.get_ev_id`
/// call) and run standalone. No SlimLinkedOCEL needed.
async fn execute_via_per_parent(
    tree: crate::binding_box::BindingBoxTree,
    database: DatabaseType,
    table_mappings: crate::db_translation::TableMappings,
    intermediate: InterMediateNode,
    advanced_cel_filters_raw: Vec<String>,
    source: RowSource<'_>,
) -> anyhow::Result<Vec<BindingIdResult>> {
    let prune_cel_raw: Vec<String> = cel_filters_for_pruning(&intermediate);
    let label_cel_raw: Vec<String> = cel_constraints_for_labelling(&intermediate);
    let cel_predicates_raw: Vec<String> = prune_cel_raw
        .iter()
        .chain(label_cel_raw.iter())
        .cloned()
        .collect();
    let label_functions_raw: Vec<LabelFunction> = intermediate.labels.clone();
    let event_vars: Vec<EventVariable> = intermediate.event_vars.keys().cloned().collect();
    let object_vars: Vec<ObjectVariable> = intermediate.object_vars.keys().cloned().collect();

    let (parent_sql, child_sqls) = translate_to_sql_shared_with_children(DBTranslationInput {
        tree,
        database,
        table_mappings: table_mappings.clone(),
    });

    // Pass 1: buffer parent rows.
    let mut parent_rows: Vec<Vec<(String, NormalizedValue)>> = Vec::new();
    source
        .for_each_row(&parent_sql, |row| parent_rows.push(row))
        .await?;

    // Pass 1b: for each parent binding, run the substituted child SQL
    // and buffer per-(parent index, child label) row sets.
    fn validate_id(id: &str) -> anyhow::Result<String> {
        if id.is_empty() {
            anyhow::bail!("id-native legacy AdvancedCEL: empty ocel_id");
        }
        if id.chars().any(|c| (c as u32) < 0x20) {
            anyhow::bail!(
                "id-native legacy AdvancedCEL: refusing to inline ocel_id with control characters"
            );
        }
        let escaped = id.replace('\'', "''");
        Ok(format!("'{escaped}'"))
    }

    let mut parent_bindings: Vec<BindingId> = Vec::with_capacity(parent_rows.len());
    let mut parent_sat: Vec<bool> = Vec::with_capacity(parent_rows.len());
    for row in &parent_rows {
        parent_bindings.push(row_to_binding_id(row, &event_vars, &object_vars)?);
        parent_sat.push(lookup_satisfied(row));
    }

    // Collect all touched ids across parent + child rows for the
    // subset OCEL. Child rows are collected during the substitution
    // loop, then merged.
    let parent_rows_clone: Vec<Vec<(String, NormalizedValue)>> = parent_rows.clone();
    let (mut ev_ids_per_var, mut ob_ids_per_var) =
        collect_ids_per_var(&parent_rows_clone, &event_vars, &object_vars);
    drop(parent_rows_clone);

    let mut per_parent_child_rows: HashMap<
        usize,
        HashMap<String, Vec<Vec<(String, NormalizedValue)>>>,
    > = HashMap::new();

    // Batched UNION ALL form: for each child label, build one query that
    // unions per-parent substituted child SQLs tagged with the parent
    // index. Cuts N round-trips down to ceil(N / CHUNK) round-trips per
    // child label. Chunked to stay below SQLite's
    // SQLITE_MAX_COMPOUND_SELECT (default 500).
    const UNION_CHUNK: usize = 256;

    // Precompute subs per parent.
    let mut subs_per_parent: Vec<Vec<(String, String)>> = Vec::with_capacity(parent_bindings.len());
    for parent_binding in &parent_bindings {
        let mut subs: Vec<(String, String)> = Vec::new();
        for (ev_var, ocel_id) in &parent_binding.event_map {
            let alias = format!("E{}", ev_var.0 + 1);
            subs.push((format!("{alias}.ocel_id"), validate_id(ocel_id)?));
        }
        for (ob_var, ocel_id) in &parent_binding.object_map {
            let alias = format!("O{}", ob_var.0 + 1);
            subs.push((format!("{alias}.ocel_id"), validate_id(ocel_id)?));
        }
        subs_per_parent.push(subs);
    }

    for ((child_sql_raw, label), (child_node, _l2)) in
        child_sqls.iter().zip(intermediate.children.iter())
    {
        let child_event_vars: Vec<EventVariable> =
            child_node.event_vars.keys().cloned().collect();
        let child_object_vars: Vec<ObjectVariable> =
            child_node.object_vars.keys().cloned().collect();

        for chunk_start in (0..parent_bindings.len()).step_by(UNION_CHUNK) {
            let chunk_end = (chunk_start + UNION_CHUNK).min(parent_bindings.len());
            let mut union_parts: Vec<String> = Vec::with_capacity(chunk_end - chunk_start);
            for idx in chunk_start..chunk_end {
                let mut sql = child_sql_raw.clone();
                for (needle, repl) in &subs_per_parent[idx] {
                    sql = sql.replace(needle.as_str(), repl.as_str());
                }
                union_parts.push(format!(
                    "SELECT CAST({idx} AS TEXT) AS __parent_row_id__, sub.* FROM (\n{sql}\n) sub"
                ));
            }
            let batched_sql = format!(
                "{}\nORDER BY __parent_row_id__",
                union_parts.join("\nUNION ALL\n")
            );

            let mut rows: Vec<Vec<(String, NormalizedValue)>> = Vec::new();
            source
                .for_each_row(&batched_sql, |row| rows.push(row))
                .await?;

            // Partition rows by __parent_row_id__ and accumulate into
            // per_parent_child_rows[idx][label].
            let chunk_rows = rows; // own
            // Bulk merge id pool.
            merge_child_ids_per_var(
                &chunk_rows,
                &event_vars,
                &object_vars,
                &child_event_vars,
                &child_object_vars,
                &mut ev_ids_per_var,
                &mut ob_ids_per_var,
            );
            for row in chunk_rows {
                let row_id_str = match lookup_column(&row, "__parent_row_id__")
                    .and_then(|v| v.as_str())
                {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let idx: usize = match row_id_str.parse() {
                    Ok(i) => i,
                    Err(_) => continue,
                };
                per_parent_child_rows
                    .entry(idx)
                    .or_default()
                    .entry(label.clone())
                    .or_default()
                    .push(row);
            }
        }
    }

    let (ev_ids_per_type, ob_ids_per_type) =
        group_ids_by_type(ev_ids_per_var, ob_ids_per_var, &intermediate);

    let cel_sources = collect_cel_sources(
        &cel_predicates_raw,
        &advanced_cel_filters_raw,
        &label_functions_raw,
    );
    let (ev_access_var, ob_access_var) = analyze_var_access(&cel_sources);
    let (mut ev_access_per_type, mut ob_access_per_type) =
        access_per_type(&ev_access_var, &ob_access_var, &intermediate);
    widen_child_subtree_access_if_referenced(
        &intermediate,
        &cel_predicates_raw,
        &advanced_cel_filters_raw,
        &label_functions_raw,
        &mut ev_access_per_type,
        &mut ob_access_per_type,
    );

    let aggregates_needed = cel_predicates_raw
        .iter()
        .chain(advanced_cel_filters_raw.iter())
        .any(|c| c.contains("numEvents") || c.contains("numObjects"))
        || label_functions_raw
            .iter()
            .any(|l| l.cel.contains("numEvents") || l.cel.contains("numObjects"));

    let id_ocel = build_subset_id_ocel(
        &source,
        database,
        &table_mappings,
        ev_ids_per_type,
        ob_ids_per_type,
        &ev_access_per_type,
        &ob_access_per_type,
        &intermediate,
        HashMap::new(),
        HashMap::new(),
        aggregates_needed,
    )
    .await?;

    let rewrite = |s: &str| -> String {
        if aggregates_needed {
            rewrite_aggregate_builtins(s, id_ocel.total_events, id_ocel.total_objects)
        } else {
            s.to_string()
        }
    };
    let prune_cel: Vec<String> = prune_cel_raw.iter().map(|s| rewrite(s)).collect();
    let label_cel: Vec<String> = label_cel_raw.iter().map(|s| rewrite(s)).collect();
    let advanced_cel_filters: Vec<String> =
        advanced_cel_filters_raw.iter().map(|s| rewrite(s)).collect();
    let label_functions: Vec<LabelFunction> = label_functions_raw
        .into_iter()
        .map(|mut lf| {
            lf.cel = rewrite(&lf.cel);
            lf
        })
        .collect();

    // Walk parent bindings; for each, build child_res from buffered
    // per-parent child rows, apply CEL. Initial `sat` from SQL-emitted
    // `satisfied` column (reflects non-CEL root constraints).
    let mut kept: Vec<(BindingId, bool)> = Vec::with_capacity(parent_bindings.len());
    for (idx, mut binding) in parent_bindings.into_iter().enumerate() {
        let mut sat = parent_sat[idx];
        let mut keep = true;
        for cel in &prune_cel {
            match check_cel_predicate_id(cel, &binding, None, &id_ocel) {
                Ok(true) => {}
                Ok(false) => {
                    keep = false;
                    break;
                }
                Err(e) => anyhow::bail!("CEL evaluation failed for `{}`: {}", cel, e),
            }
        }
        if !keep {
            continue;
        }
        let mut child_res: HashMap<String, Vec<(Arc<BindingId>, Option<ViolationReason>)>> =
            HashMap::new();
        if let Some(per_label) = per_parent_child_rows.remove(&idx) {
            for (label, rows) in per_label {
                let child_node = intermediate
                    .children
                    .iter()
                    .find_map(|(n, l)| if l == &label { Some(n) } else { None })
                    .ok_or_else(|| anyhow::anyhow!("child label `{}` not found", label))?;
                let child_event_vars: Vec<EventVariable> =
                    child_node.event_vars.keys().cloned().collect();
                let child_object_vars: Vec<ObjectVariable> =
                    child_node.object_vars.keys().cloned().collect();
                let mut group: Vec<(Arc<BindingId>, Option<ViolationReason>)> = Vec::new();
                for row in rows {
                    let mut child_binding = binding.clone();
                    // Append child's new vars from key_e<n>/key_o<n>.
                    for ev in &child_event_vars {
                        let col = format!("key_e{}", ev.0 + 1);
                        let id = lookup_column(&row, &col)
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing child column `{col}`"))?
                            .to_string();
                        child_binding.event_map.push((*ev, Arc::new(id)));
                    }
                    for ob in &child_object_vars {
                        let col = format!("key_o{}", ob.0 + 1);
                        let id = lookup_column(&row, &col)
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing child column `{col}`"))?
                            .to_string();
                        child_binding.object_map.push((*ob, Arc::new(id)));
                    }
                    child_binding.event_map.sort_by_key(|x| x.0);
                    child_binding.object_map.sort_by_key(|x| x.0);
                    group.push((Arc::new(child_binding), None));
                }
                child_res.insert(label, group);
            }
        }
        for cel in &advanced_cel_filters {
            match check_cel_predicate_id(cel, &binding, Some(&child_res), &id_ocel) {
                Ok(true) => {}
                Ok(false) => {
                    keep = false;
                    break;
                }
                Err(e) => anyhow::bail!("AdvancedCEL evaluation failed for `{}`: {}", cel, e),
            }
        }
        if !keep {
            continue;
        }
        if sat {
            for cel in &label_cel {
                match check_cel_predicate_id(cel, &binding, Some(&child_res), &id_ocel) {
                    Ok(true) => {}
                    Ok(false) => {
                        sat = false;
                        break;
                    }
                    Err(e) => anyhow::bail!("CEL evaluation failed for `{}`: {}", cel, e),
                }
            }
        }
        for label_fun in &label_functions {
            if let Err(e) = add_cel_label_id(&mut binding, Some(&child_res), &id_ocel, label_fun) {
                anyhow::bail!(
                    "LabelFunction evaluation failed for `{}`: {}",
                    label_fun.label,
                    e
                );
            }
        }
        kept.push((binding, sat));
    }
    Ok(kept
        .into_iter()
        .map(|(b, sat)| {
            if sat {
                (b, None)
            } else {
                (b, Some(ViolationReason::ConstraintNotSatisfied(0)))
            }
        })
        .collect())
}

// Arbitrary-depth recursive host-side path.
//
// Activated when any node in the IR tree carries a host-side form at depth
// >= 1 (BasicFilterCEL / AdvancedCEL / LabelFunction). Root-only cases stay
// on `execute_via_batched` / `execute_via_per_parent` for performance.
//
// Two phases:
//   1. `collect_subtree`: walk the tree top-down, run each node's SQL with
//      ancestor refs substituted to parent-context literals, buffer rows in
//      a `CollectedSubtree` tree. UNION ALL chunked per level so the child
//      SQL runs in batches keyed by `__parent_row_id__`.
//   2. `eval_subtree`: walk the tree bottom-up using the buffered rows,
//      apply host-side filters / labels / AdvancedCEL at each level, and
//      re-check parent K_C / SizeFilter constraints against post-CEL child
//      counts (the over-approximation policy the SQL emitter applies for
//      CEL-affected children).
//
// Materialisation criterion for a child:
//   `subtree_has_host_side(child)`
//     OR  parent's host-side CEL references the child label.
// The second clause handles AdvancedCEL / LabelFunction / BasicFilterCEL at
// the parent walking the child's binding set in CEL (`L.map(...)`); the
// child must be materialised even when its subtree is pure-pushdown.

struct CollectedSubtree {
    rows_per_pc: Vec<Vec<Vec<(String, NormalizedValue)>>>,
    materialized_children: Vec<(String, Box<CollectedSubtree>)>,
}

fn validate_inline_id(id: &str) -> anyhow::Result<String> {
    // OCEL ocel_ids can be arbitrary strings (customer names, GUIDs, free-form
    // text). Use SQL standard escape: wrap in single quotes, double any
    // embedded single quote. Reject control characters (NUL and below): they
    // never appear in real OCEL IDs and are a defensive hardening against
    // odd SQLite/PostgreSQL drivers.
    if id.is_empty() {
        anyhow::bail!("execute_via_recursive: empty ocel_id");
    }
    if id.chars().any(|c| (c as u32) < 0x20) {
        anyhow::bail!("execute_via_recursive: refusing to inline ocel_id with control characters");
    }
    let escaped = id.replace('\'', "''");
    Ok(format!("'{escaped}'"))
}

/// Format a parent row's `ocel_time` value as a dialect-specific SQL literal
/// suitable for substitution into a child's emitted SQL. The per-parent
/// UNION ALL path (`collect_subtree`) uses it to resolve cross-scope `E{n}.ocel_time`
/// references emitted by non-zero-bound TBE clauses (the matching LATERAL path
/// in `mod.rs::translate_to_sql_shared_with_batched_children` substitutes
/// through `parent."E{n}_ocel_time"` instead).
///
/// SQLite stores `ocel_time` as TEXT and `julianday('...')` accepts a string
/// directly; DuckDB and PostgreSQL need an explicit `CAST(... AS TIMESTAMP)`
/// for `EPOCH(...)` / `EXTRACT(EPOCH FROM ...)` to type-check.
fn validate_inline_timestamp(
    value: &NormalizedValue,
    database: DatabaseType,
) -> anyhow::Result<String> {
    // Emit the timestamp as a naive (no-timezone) string so the round-trip
    // through `CAST(... AS TIMESTAMP)` does not depend on the DB session
    // timezone. PG stores `ocel_time` as `timestamp without time zone`; the
    // driver decodes it into a `DateTime<FixedOffset>` with offset 0 by
    // convention (see `sql_executor.rs`), so `to_rfc3339()` would re-attach
    // a UTC tag and PG would then shift the value to its session zone on
    // cast. Reading via `naive_utc()` keeps the wall-clock components.
    let raw: String = match value {
        NormalizedValue::Timestamp(t) => t
            .naive_utc()
            .format("%Y-%m-%dT%H:%M:%S%.f")
            .to_string(),
        NormalizedValue::Text(s) | NormalizedValue::Unknown(s) => s.clone(),
        _ => anyhow::bail!(
            "execute_via_recursive: unsupported ocel_time variant for literal substitution"
        ),
    };
    if raw.is_empty() {
        anyhow::bail!("execute_via_recursive: empty ocel_time");
    }
    if raw.chars().any(|c| (c as u32) < 0x20) {
        anyhow::bail!(
            "execute_via_recursive: refusing to inline ocel_time with control characters"
        );
    }
    let escaped = raw.replace('\'', "''");
    Ok(match database {
        DatabaseType::SQLite => format!("'{escaped}'"),
        DatabaseType::DuckDB | DatabaseType::PostgreSQL => {
            format!("CAST('{escaped}' AS TIMESTAMP)")
        }
    })
}

fn child_label_referenced_in_node_cel(node: &InterMediateNode, child_label: &str) -> bool {
    let child_labels: Vec<String> = node.children.iter().map(|(_, l)| l.clone()).collect();
    if !child_labels.iter().any(|l| l == child_label) {
        return false;
    }
    let needle = child_label.to_string();
    let mentions = |cel: &str| -> bool {
        get_child_labels_in_cel_program(cel, &child_labels).contains(&needle)
    };
    for f in &node.filter {
        if let Filter::BasicFilterCEL { cel } = f {
            if mentions(cel) {
                return true;
            }
        }
    }
    for sf in &node.sizefilter {
        if let SizeFilter::AdvancedCEL { cel } = sf {
            if mentions(cel) {
                return true;
            }
        }
    }
    for c in &node.constraints {
        match c {
            Constraint::Filter {
                filter: Filter::BasicFilterCEL { cel },
            } => {
                if mentions(cel) {
                    return true;
                }
            }
            Constraint::SizeFilter {
                filter: SizeFilter::AdvancedCEL { cel },
            } => {
                if mentions(cel) {
                    return true;
                }
            }
            _ => {}
        }
    }
    for lf in &node.labels {
        if mentions(&lf.cel) {
            return true;
        }
    }
    false
}

fn child_needs_materialization(
    parent: &InterMediateNode,
    child_label: &str,
    child_node: &InterMediateNode,
) -> bool {
    if subtree_has_host_side(child_node) {
        return true;
    }
    child_label_referenced_in_node_cel(parent, child_label)
}

fn collect_subtree<'a, 's>(
    node: &'a InterMediateNode,
    parent_subs_per_pc: &'a [Vec<(String, String)>],
    source: &'a RowSource<'s>,
    database: DatabaseType,
    table_mappings: &'a crate::db_translation::TableMappings,
    ev_pool: &'a mut HashMap<EventVariable, HashSet<String>>,
    ob_pool: &'a mut HashMap<ObjectVariable, HashSet<String>>,
    ancestor_alias_type_map: HashMap<String, String>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<CollectedSubtree>> + 'a>>
where
    's: 'a,
{
    Box::pin(async move {
        let pc_count = parent_subs_per_pc.len();
        let (node_sql, _child_sqls_unused) =
            crate::db_translation::emit_subtree_sql_with_children_and_ancestors(
                node,
                database,
                table_mappings,
                &ancestor_alias_type_map,
            );

        const UNION_CHUNK: usize = 256;
        let mut rows_per_pc: Vec<Vec<Vec<(String, NormalizedValue)>>> =
            (0..pc_count).map(|_| Vec::new()).collect();

        let mut chunk_start = 0usize;
        while chunk_start < pc_count {
            let chunk_end = (chunk_start + UNION_CHUNK).min(pc_count);
            let mut union_parts: Vec<String> = Vec::with_capacity(chunk_end - chunk_start);
            for idx in chunk_start..chunk_end {
                let mut sql = node_sql.clone();
                for (needle, repl) in &parent_subs_per_pc[idx] {
                    sql = sql.replace(needle.as_str(), repl.as_str());
                }
                union_parts.push(format!(
                    "SELECT CAST({idx} AS TEXT) AS __parent_row_id__, sub.* FROM (\n{sql}\n) sub"
                ));
            }
            let batched_sql = format!(
                "{}\nORDER BY __parent_row_id__",
                union_parts.join("\nUNION ALL\n")
            );
            let mut rows: Vec<Vec<(String, NormalizedValue)>> = Vec::new();
            source
                .for_each_row(&batched_sql, |r| rows.push(r))
                .await?;
            for row in rows {
                let row_id_str = match lookup_column(&row, "__parent_row_id__")
                    .and_then(|v| v.as_str())
                {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let idx: usize = match row_id_str.parse() {
                    Ok(i) => i,
                    Err(_) => continue,
                };
                if idx < rows_per_pc.len() {
                    rows_per_pc[idx].push(row);
                }
            }
            chunk_start = chunk_end;
        }

        // Update id pools from this-level rows.
        let event_vars: Vec<EventVariable> = node.event_vars.keys().cloned().collect();
        let object_vars: Vec<ObjectVariable> = node.object_vars.keys().cloned().collect();
        for pc_rows in &rows_per_pc {
            let (ev_p, ob_p) = collect_ids_per_var(pc_rows, &event_vars, &object_vars);
            for (k, v) in ev_p {
                ev_pool.entry(k).or_default().extend(v);
            }
            for (k, v) in ob_p {
                ob_pool.entry(k).or_default().extend(v);
            }
        }

        // Recurse into children that need materialisation.
        let mut materialized_children: Vec<(String, Box<CollectedSubtree>)> = Vec::new();
        for (child_node, child_label) in &node.children {
            if !child_needs_materialization(node, child_label, child_node) {
                continue;
            }
            let mut flat_subs: Vec<Vec<(String, String)>> = Vec::new();
            for (pc_idx, rows) in rows_per_pc.iter().enumerate() {
                let ancestor_subs = &parent_subs_per_pc[pc_idx];
                for row in rows {
                    let mut subs = ancestor_subs.clone();
                    for ev in &event_vars {
                        let n = ev.0 + 1;
                        let id_col = format!("E{n}");
                        if let Some(id_s) =
                            lookup_column(row, &id_col).and_then(|v| v.as_str())
                        {
                            subs.push((
                                format!("E{n}.ocel_id"),
                                validate_inline_id(id_s)?,
                            ));
                        }
                        // Cross-scope non-zero-bound TBE in a descendant
                        // child references this event's ocel_time. The
                        // parent CTE projects it as `E{n}_ocel_time`
                        // (see `construct_select_fields_root`); convert the
                        // row's value to a dialect-specific timestamp
                        // literal and substitute it into the child SQL.
                        let time_col = format!("E{n}_ocel_time");
                        if let Some(time_val) = lookup_column(row, &time_col) {
                            if !matches!(time_val, NormalizedValue::Null) {
                                subs.push((
                                    format!("E{n}.ocel_time"),
                                    validate_inline_timestamp(time_val, database)?,
                                ));
                            }
                        }
                    }
                    for ob in &object_vars {
                        let n = ob.0 + 1;
                        let id_col = format!("O{n}");
                        if let Some(id_s) =
                            lookup_column(row, &id_col).and_then(|v| v.as_str())
                        {
                            subs.push((
                                format!("O{n}.ocel_id"),
                                validate_inline_id(id_s)?,
                            ));
                        }
                    }
                    flat_subs.push(subs);
                }
            }
            // Extend ancestor alias_type_map with this node's vars before
            // recursing: the SQL emitter for the child must resolve types for
            // ancestor refs ($O<n>$, $E<n>$) that the IR's own vars list does
            // not carry. Single-type vars contribute their unique type;
            // multi-type vars are skipped (per-pair junction lookup falls back
            // to default_e2o anyway).
            let mut child_ancestor_map = ancestor_alias_type_map.clone();
            for (var, types) in &node.event_vars {
                if types.len() == 1 {
                    let t = types.iter().next().unwrap().clone();
                    child_ancestor_map.insert(format!("E{}", var.0 + 1), t);
                }
            }
            for (var, types) in &node.object_vars {
                if types.len() == 1 {
                    let t = types.iter().next().unwrap().clone();
                    child_ancestor_map.insert(format!("O{}", var.0 + 1), t);
                }
            }

            let child_collected = collect_subtree(
                child_node,
                &flat_subs,
                source,
                database,
                table_mappings,
                ev_pool,
                ob_pool,
                child_ancestor_map,
            )
            .await?;
            materialized_children.push((child_label.clone(), Box::new(child_collected)));
        }

        Ok(CollectedSubtree {
            rows_per_pc,
            materialized_children,
        })
    })
}

fn eval_subtree(
    node: &InterMediateNode,
    parent_bindings: &[BindingId],
    collected: &CollectedSubtree,
    id_ocel: &IdBackedOcel,
    cel_predicates_per_node: &HashMap<*const InterMediateNode, Vec<String>>,
    label_functions_per_node: &HashMap<*const InterMediateNode, Vec<LabelFunction>>,
    advanced_cel_per_node: &HashMap<*const InterMediateNode, Vec<String>>,
) -> anyhow::Result<Vec<Vec<(Arc<BindingId>, Option<ViolationReason>)>>> {
    let event_vars: Vec<EventVariable> = node.event_vars.keys().cloned().collect();
    let object_vars: Vec<ObjectVariable> = node.object_vars.keys().cloned().collect();
    let pc_count = collected.rows_per_pc.len();

    let mut bindings_per_pc: Vec<Vec<BindingId>> = (0..pc_count).map(|_| Vec::new()).collect();
    for (pc_idx, rows) in collected.rows_per_pc.iter().enumerate() {
        let parent_base = if parent_bindings.is_empty() {
            BindingId::default()
        } else {
            parent_bindings[pc_idx].clone()
        };
        for row in rows {
            let mut binding = parent_base.clone();
            for ev in &event_vars {
                let col = format!("E{}", ev.0 + 1);
                if let Some(s) = lookup_column(row, &col).and_then(|v| v.as_str()) {
                    binding.event_map.push((*ev, Arc::new(s.to_string())));
                }
            }
            for ob in &object_vars {
                let col = format!("O{}", ob.0 + 1);
                if let Some(s) = lookup_column(row, &col).and_then(|v| v.as_str()) {
                    binding.object_map.push((*ob, Arc::new(s.to_string())));
                }
            }
            binding.event_map.sort_by_key(|x| x.0);
            binding.object_map.sort_by_key(|x| x.0);
            bindings_per_pc[pc_idx].push(binding);
        }
    }

    let mut flat: Vec<BindingId> = Vec::new();
    let mut origin_pc: Vec<usize> = Vec::new();
    for (pc_idx, bs) in bindings_per_pc.iter().enumerate() {
        for b in bs {
            flat.push(b.clone());
            origin_pc.push(pc_idx);
        }
    }

    let mut child_results: HashMap<String, Vec<Vec<(Arc<BindingId>, Option<ViolationReason>)>>> =
        HashMap::new();
    for (label, sub_collected) in &collected.materialized_children {
        let child_node = node
            .children
            .iter()
            .find_map(|(n, l)| if l == label { Some(n) } else { None })
            .ok_or_else(|| anyhow::anyhow!("child label `{}` not found in node.children", label))?;
        let child_per_flat = eval_subtree(
            child_node,
            &flat,
            sub_collected,
            id_ocel,
            cel_predicates_per_node,
            label_functions_per_node,
            advanced_cel_per_node,
        )?;
        child_results.insert(label.clone(), child_per_flat);
    }

    let is_cel_affected_label = |label: &str| -> bool {
        node.children
            .iter()
            .any(|(c, l)| l == label && subtree_has_host_side(c))
    };

    let empty_vec_cel: Vec<String> = Vec::new();
    let empty_vec_lf: Vec<LabelFunction> = Vec::new();
    let pruning_cel: &Vec<String> = cel_predicates_per_node
        .get(&(node as *const _))
        .unwrap_or(&empty_vec_cel);
    let label_functions: &Vec<LabelFunction> = label_functions_per_node
        .get(&(node as *const _))
        .unwrap_or(&empty_vec_lf);
    let pruning_advcel: &Vec<String> = advanced_cel_per_node
        .get(&(node as *const _))
        .unwrap_or(&empty_vec_cel);

    let mut survivors: Vec<Vec<(Arc<BindingId>, Option<ViolationReason>)>> =
        (0..pc_count).map(|_| Vec::new()).collect();
    for (flat_idx, mut binding) in flat.into_iter().enumerate() {
        let mut child_res: HashMap<String, Vec<(Arc<BindingId>, Option<ViolationReason>)>> =
            HashMap::new();
        for (label, per_flat) in &child_results {
            let group = per_flat.get(flat_idx).cloned().unwrap_or_default();
            child_res.insert(label.clone(), group);
        }

        let mut keep = true;
        let mut violation: Option<ViolationReason> = None;

        // (1) Compute label functions FIRST so subsequent CEL bodies can read
        // them via the binding's label_map. Labels are computed against the
        // post-CEL child binding sets in `child_res`.
        for lf in label_functions.iter() {
            if let Err(e) = add_cel_label_id(&mut binding, Some(&child_res), id_ocel, lf) {
                anyhow::bail!(
                    "LabelFunction evaluation failed for `{}`: {}",
                    lf.label,
                    e
                );
            }
        }

        // (2) Pruning forms: free-standing filters (BasicFilterCEL in
        // `node.filter`) and free-standing size filters (`AdvancedCEL` in
        // `node.sizefilter` + `NumChilds` / `NumChildsProj` / `BindingSet*`
        // when CEL-affected): false on these *drops* the binding. The
        // in-memory engine treats these as predicate-style pruners that
        // never produce a violation reason.
        for cel in pruning_cel.iter() {
            match check_cel_predicate_id(cel, &binding, None, id_ocel) {
                Ok(true) => {}
                Ok(false) => {
                    keep = false;
                    break;
                }
                Err(e) => anyhow::bail!("CEL filter eval failed for `{}`: {}", cel, e),
            }
        }
        if !keep {
            continue;
        }
        for cel in pruning_advcel.iter() {
            match check_cel_predicate_id(cel, &binding, Some(&child_res), id_ocel) {
                Ok(true) => {}
                Ok(false) => {
                    keep = false;
                    break;
                }
                Err(e) => anyhow::bail!("AdvancedCEL filter eval failed for `{}`: {}", cel, e),
            }
        }
        if !keep {
            continue;
        }
        if !host_recheck_size_filters(node, &child_res, &is_cel_affected_label) {
            // The free-standing size filter re-check (NumChilds etc.) drops
            // the binding when violated, matching the in-memory engine's
            // size-filter semantics.
            continue;
        }

        // (3) Constraints: walk `node.constraints` in order. First failure
        // attaches `ViolationReason::ConstraintNotSatisfied(index)` and the
        // remaining constraints are skipped. The binding is RETAINED with
        // the violation marker (the in-memory engine keeps unsatisfied
        // bindings in the result; only filters / size filters prune).
        for (idx, c) in node.constraints.iter().enumerate() {
            let ok = evaluate_constraint(
                c,
                idx,
                &binding,
                &child_res,
                id_ocel,
                &is_cel_affected_label,
            )?;
            if !ok {
                violation = Some(ViolationReason::ConstraintNotSatisfied(idx));
                break;
            }
        }

        survivors[origin_pc[flat_idx]].push((Arc::new(binding), violation));
    }

    Ok(survivors)
}

// Free-standing size-filter re-check. Only `node.sizefilter` entries are
// considered: these are pruning forms (drop the binding on failure). Constraint-
// mode size filters (`Constraint::SizeFilter`) are handled by
// `evaluate_constraint` so a failure attaches `ConstraintNotSatisfied` instead
// of dropping the binding. Child binding counts are taken over ALL child
// bindings regardless of `vr.is_some()` to match the in-memory `SizeFilter`
// semantics (binding_box/structs.rs uses `c_res.len()` and unfiltered iters).
fn host_recheck_size_filters(
    node: &InterMediateNode,
    child_res: &HashMap<String, Vec<(Arc<BindingId>, Option<ViolationReason>)>>,
    is_cel_affected: &dyn Fn(&str) -> bool,
) -> bool {
    let count_all = |label: &str| -> usize {
        child_res.get(label).map(|v| v.len()).unwrap_or(0)
    };
    let check_min_max = |cnt: usize, min: &Option<usize>, max: &Option<usize>| -> bool {
        if let Some(m) = min {
            if cnt < *m {
                return false;
            }
        }
        if let Some(m) = max {
            if cnt > *m {
                return false;
            }
        }
        true
    };

    for sf in &node.sizefilter {
        match sf {
            SizeFilter::NumChilds {
                child_name,
                min,
                max,
            } => {
                if is_cel_affected(child_name)
                    && !check_min_max(count_all(child_name), min, max)
                {
                    return false;
                }
            }
            SizeFilter::NumChildsProj {
                child_name,
                var_name,
                min,
                max,
            } => {
                if is_cel_affected(child_name) {
                    let cnt = distinct_var_count_in_child_res(child_res, child_name, var_name);
                    if !check_min_max(cnt, min, max) {
                        return false;
                    }
                }
            }
            SizeFilter::BindingSetEqual { child_names } => {
                let any_affected = child_names.iter().any(|n| is_cel_affected(n));
                if any_affected && !binding_sets_equal(child_res, child_names) {
                    return false;
                }
            }
            SizeFilter::BindingSetProjectionEqual {
                child_name_with_var_name,
            } => {
                let any_affected = child_name_with_var_name
                    .iter()
                    .any(|(n, _)| is_cel_affected(n));
                if any_affected
                    && !binding_set_projections_equal(child_res, child_name_with_var_name)
                {
                    return false;
                }
            }
            SizeFilter::AdvancedCEL { .. } => {}
        }
    }
    true
}

/// Set equality on the bindings of the listed children. Matches the in-memory
/// engine's `BindingSetEqual` semantics: each child's binding set (event_map +
/// object_map only, labels excluded) must be identical as sets. ALL bindings
/// participate regardless of `vr.is_some()`; in-mem `SizeFilter::check`
/// compares `c_res.iter().map(|(b,_)| b)` without filtering violations.
fn binding_sets_equal(
    child_res: &HashMap<String, Vec<(Arc<BindingId>, Option<ViolationReason>)>>,
    child_names: &[String],
) -> bool {
    if child_names.len() < 2 {
        return true;
    }
    let signature = |group: &Vec<(Arc<BindingId>, Option<ViolationReason>)>| -> HashSet<String> {
        let mut s: HashSet<String> = HashSet::new();
        for (b, _vr) in group {
            let mut ev: Vec<String> = b
                .event_map
                .iter()
                .map(|(v, id)| format!("E{}={}", v.0, id))
                .collect();
            ev.sort();
            let mut ob: Vec<String> = b
                .object_map
                .iter()
                .map(|(v, id)| format!("O{}={}", v.0, id))
                .collect();
            ob.sort();
            s.insert(format!("{}|{}", ev.join(","), ob.join(",")));
        }
        s
    };
    let first = child_res
        .get(&child_names[0])
        .map(signature)
        .unwrap_or_default();
    for name in child_names.iter().skip(1) {
        let other = child_res.get(name).map(signature).unwrap_or_default();
        if first != other {
            return false;
        }
    }
    true
}

/// `BindingSetProjectionEqual`: each listed `(child_label, projected variable)`
/// pair produces a set of `ocel_id` values across the child's bindings; the
/// sets must be identical across pairs. ALL bindings participate regardless of
/// `vr.is_some()` to match in-mem semantics.
fn binding_set_projections_equal(
    child_res: &HashMap<String, Vec<(Arc<BindingId>, Option<ViolationReason>)>>,
    pairs: &[(String, crate::binding_box::structs::Variable)],
) -> bool {
    use crate::binding_box::structs::Variable;
    if pairs.len() < 2 {
        return true;
    }
    let project = |label: &str, var: &Variable| -> HashSet<String> {
        let group = match child_res.get(label) {
            Some(g) => g,
            None => return HashSet::new(),
        };
        let mut s: HashSet<String> = HashSet::new();
        for (b, _vr) in group {
            match var {
                Variable::Event(ev) => {
                    if let Some(id) = b.get_ev_id(ev) {
                        s.insert(id.as_ref().clone());
                    }
                }
                Variable::Object(ob) => {
                    if let Some(id) = b.get_ob_id(ob) {
                        s.insert(id.as_ref().clone());
                    }
                }
            }
        }
        s
    };
    let (first_label, first_var) = &pairs[0];
    let first_set = project(first_label, first_var);
    for (label, var) in pairs.iter().skip(1) {
        if project(label, var) != first_set {
            return false;
        }
    }
    true
}

fn distinct_var_count_in_child_res(
    child_res: &HashMap<String, Vec<(Arc<BindingId>, Option<ViolationReason>)>>,
    child_name: &str,
    var_name: &crate::binding_box::structs::Variable,
) -> usize {
    use crate::binding_box::structs::Variable;
    let group = match child_res.get(child_name) {
        Some(g) => g,
        None => return 0,
    };
    let mut seen: HashSet<String> = HashSet::new();
    for (b, _vr) in group {
        match var_name {
            Variable::Event(ev) => {
                if let Some(id) = b.get_ev_id(ev) {
                    seen.insert(id.as_ref().clone());
                }
            }
            Variable::Object(ob) => {
                if let Some(id) = b.get_ob_id(ob) {
                    seen.insert(id.as_ref().clone());
                }
            }
        }
    }
    seen.len()
}

/// Populate the per-node CEL / label-function maps used by `eval_subtree`.
/// Only *pruning* forms are collected here:
///   * `Filter::BasicFilterCEL` in `node.filter` (drops binding when false)
///   * `SizeFilter::AdvancedCEL` in `node.sizefilter` (drops binding when false)
/// Constraint-mode CEL (`Constraint::Filter{BasicFilterCEL}`,
/// `Constraint::SizeFilter{AdvancedCEL}`) is evaluated in-order during the
/// constraint pass (`evaluate_constraint`) so its outcome attaches a
/// `ViolationReason` instead of pruning the binding.
fn populate_cel_maps(
    node: &InterMediateNode,
    cel_per_node: &mut HashMap<*const InterMediateNode, Vec<String>>,
    label_per_node: &mut HashMap<*const InterMediateNode, Vec<LabelFunction>>,
    adv_per_node: &mut HashMap<*const InterMediateNode, Vec<String>>,
) {
    let mut prune_cel: Vec<String> = Vec::new();
    for f in &node.filter {
        if let Filter::BasicFilterCEL { cel: body } = f {
            prune_cel.push(body.clone());
        }
    }
    if !prune_cel.is_empty() {
        cel_per_node.insert(node as *const _, prune_cel);
    }

    if !node.labels.is_empty() {
        label_per_node.insert(node as *const _, node.labels.clone());
    }

    let mut prune_advcel: Vec<String> = Vec::new();
    for sf in &node.sizefilter {
        if let SizeFilter::AdvancedCEL { cel } = sf {
            prune_advcel.push(cel.clone());
        }
    }
    if !prune_advcel.is_empty() {
        adv_per_node.insert(node as *const _, prune_advcel);
    }

    for (child, _label) in &node.children {
        populate_cel_maps(child, cel_per_node, label_per_node, adv_per_node);
    }
}

/// Evaluate a single `Constraint` at a node against this binding. Returns
/// `Ok(true)` iff the constraint holds. K_C and SizeFilter constraints are
/// re-checked host-side against post-CEL child counts only when at least one
/// referenced child is CEL-affected; otherwise the SQL emitter has already
/// folded the constraint into the per-binding `satisfied` column (root) or
/// the parent's child-composition clauses (non-root), and the recursive
/// executor consumes that result directly. The `Ok(true)` return is the
/// "trust pushdown" path used when there is nothing CEL-driven to re-check.
fn evaluate_constraint(
    constraint: &Constraint,
    _index: usize,
    binding: &BindingId,
    child_res: &HashMap<String, Vec<(Arc<BindingId>, Option<ViolationReason>)>>,
    id_ocel: &IdBackedOcel,
    is_cel_affected: &dyn Fn(&str) -> bool,
) -> anyhow::Result<bool> {
    // count_sat / count_unsat partition by violation status; used by K_C
    // (SAT/ANY/AND/NOT/OR) which match in-mem's `c_res.iter().any/all(v.is_some())`.
    let count_sat = |label: &str| -> usize {
        child_res
            .get(label)
            .map(|v| v.iter().filter(|(_, vr)| vr.is_none()).count())
            .unwrap_or(0)
    };
    let count_unsat = |label: &str| -> usize {
        child_res
            .get(label)
            .map(|v| v.iter().filter(|(_, vr)| vr.is_some()).count())
            .unwrap_or(0)
    };
    // count_all matches in-mem `SizeFilter::check`: `c_res.len()` (no
    // partition by violation status).
    let count_all = |label: &str| -> usize {
        child_res.get(label).map(|v| v.len()).unwrap_or(0)
    };
    let check_min_max =
        |cnt: usize, min: &Option<usize>, max: &Option<usize>| -> bool {
            if let Some(m) = min {
                if cnt < *m {
                    return false;
                }
            }
            if let Some(m) = max {
                if cnt > *m {
                    return false;
                }
            }
            true
        };

    match constraint {
        Constraint::Filter {
            filter: Filter::BasicFilterCEL { cel },
        } => {
            // Constraint-mode CEL: evaluate against this binding (no child
            // context; matches the parent's pruning shape).
            match check_cel_predicate_id(cel, binding, None, id_ocel) {
                Ok(b) => Ok(b),
                Err(e) => anyhow::bail!("Constraint CEL eval failed for `{}`: {}", cel, e),
            }
        }
        Constraint::Filter { .. } => {
            // Other Filter variants (O2E, O2O, TBE, attribute, NotEqual)
            // are pushdown; SQL already enforced them. Treat as satisfied.
            Ok(true)
        }
        Constraint::SizeFilter {
            filter: SizeFilter::AdvancedCEL { cel },
        } => match check_cel_predicate_id(cel, binding, Some(child_res), id_ocel) {
            Ok(b) => Ok(b),
            Err(e) => anyhow::bail!(
                "Constraint AdvancedCEL eval failed for `{}`: {}",
                cel,
                e
            ),
        },
        Constraint::SizeFilter {
            filter: SizeFilter::NumChilds {
                child_name,
                min,
                max,
            },
        } => {
            if is_cel_affected(child_name) {
                Ok(check_min_max(count_all(child_name), min, max))
            } else {
                Ok(true)
            }
        }
        Constraint::SizeFilter {
            filter:
                SizeFilter::NumChildsProj {
                    child_name,
                    var_name,
                    min,
                    max,
                },
        } => {
            if is_cel_affected(child_name) {
                let cnt = distinct_var_count_in_child_res(child_res, child_name, var_name);
                Ok(check_min_max(cnt, min, max))
            } else {
                Ok(true)
            }
        }
        Constraint::SizeFilter {
            filter: SizeFilter::BindingSetEqual { child_names },
        } => {
            if child_names.iter().any(|n| is_cel_affected(n)) {
                Ok(binding_sets_equal(child_res, child_names))
            } else {
                Ok(true)
            }
        }
        Constraint::SizeFilter {
            filter:
                SizeFilter::BindingSetProjectionEqual {
                    child_name_with_var_name,
                },
        } => {
            if child_name_with_var_name
                .iter()
                .any(|(n, _)| is_cel_affected(n))
            {
                Ok(binding_set_projections_equal(child_res, child_name_with_var_name))
            } else {
                Ok(true)
            }
        }
        Constraint::SAT { child_names } | Constraint::AND { child_names } => {
            // SQL emitted clauses for non-CEL-affected children; re-check the
            // CEL-affected ones host-side. Each listed child must have zero
            // unsatisfied bindings.
            for label in child_names {
                if is_cel_affected(label) && count_unsat(label) > 0 {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        Constraint::ANY { child_names } => {
            if child_names.iter().any(|n| is_cel_affected(n)) {
                for label in child_names {
                    if count_sat(label) < 1 {
                        return Ok(false);
                    }
                }
            }
            Ok(true)
        }
        Constraint::NOT { child_names } => {
            if child_names.iter().any(|n| is_cel_affected(n)) {
                let any_zero = child_names.iter().any(|n| count_sat(n) == 0);
                if !any_zero {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        Constraint::OR { child_names } => {
            if child_names.iter().any(|n| is_cel_affected(n)) {
                let any_no_unsat = child_names.iter().any(|n| count_unsat(n) == 0);
                if !any_no_unsat {
                    return Ok(false);
                }
            }
            Ok(true)
        }
    }
}

fn collect_all_cel_sources(node: &InterMediateNode, out: &mut Vec<String>) {
    for f in &node.filter {
        if let Filter::BasicFilterCEL { cel } = f {
            out.push(cel.clone());
        }
    }
    for sf in &node.sizefilter {
        if let SizeFilter::AdvancedCEL { cel } = sf {
            out.push(cel.clone());
        }
    }
    for c in &node.constraints {
        match c {
            Constraint::Filter {
                filter: Filter::BasicFilterCEL { cel },
            } => out.push(cel.clone()),
            Constraint::SizeFilter {
                filter: SizeFilter::AdvancedCEL { cel },
            } => out.push(cel.clone()),
            _ => {}
        }
    }
    for lf in &node.labels {
        out.push(lf.cel.clone());
    }
    for (child, _label) in &node.children {
        collect_all_cel_sources(child, out);
    }
}

fn tree_has_non_root_host_side(root: &InterMediateNode) -> bool {
    for (child, _label) in &root.children {
        if subtree_has_host_side(child) {
            return true;
        }
    }
    false
}

async fn execute_via_recursive(
    _tree: crate::binding_box::BindingBoxTree,
    database: DatabaseType,
    table_mappings: crate::db_translation::TableMappings,
    intermediate: InterMediateNode,
    source: RowSource<'_>,
) -> anyhow::Result<Vec<BindingIdResult>> {
    // Phase 1: collect rows recursively. Single virtual parent context at
    // the root (one empty substitution list).
    let root_subs: Vec<Vec<(String, String)>> = vec![Vec::new()];
    let mut ev_pool: HashMap<EventVariable, HashSet<String>> = HashMap::new();
    let mut ob_pool: HashMap<ObjectVariable, HashSet<String>> = HashMap::new();
    let collected = collect_subtree(
        &intermediate,
        &root_subs,
        &source,
        database,
        &table_mappings,
        &mut ev_pool,
        &mut ob_pool,
        HashMap::new(),
    )
    .await?;

    // Phase 2: build subset id-OCEL.
    let (ev_ids_per_type, ob_ids_per_type) = group_ids_by_type(ev_pool, ob_pool, &intermediate);
    let mut all_cel_sources: Vec<String> = Vec::new();
    collect_all_cel_sources(&intermediate, &mut all_cel_sources);
    let cel_refs: Vec<&str> = all_cel_sources.iter().map(|s| s.as_str()).collect();
    let (ev_access_var, ob_access_var) = analyze_var_access(&cel_refs);
    let (ev_access_per_type, ob_access_per_type) =
        access_per_type(&ev_access_var, &ob_access_var, &intermediate);

    let aggregates_needed = all_cel_sources
        .iter()
        .any(|s| s.contains("numEvents") || s.contains("numObjects"));

    let id_ocel: IdBackedOcel = build_subset_id_ocel(
        &source,
        database,
        &table_mappings,
        ev_ids_per_type,
        ob_ids_per_type,
        &ev_access_per_type,
        &ob_access_per_type,
        &intermediate,
        HashMap::new(),
        HashMap::new(),
        aggregates_needed,
    )
    .await?;

    // Phase 3: build per-node CEL maps + bottom-up eval.
    let mut cel_per_node: HashMap<*const InterMediateNode, Vec<String>> = HashMap::new();
    let mut label_per_node: HashMap<*const InterMediateNode, Vec<LabelFunction>> = HashMap::new();
    let mut adv_per_node: HashMap<*const InterMediateNode, Vec<String>> = HashMap::new();
    populate_cel_maps(
        &intermediate,
        &mut cel_per_node,
        &mut label_per_node,
        &mut adv_per_node,
    );
    if aggregates_needed {
        let total_e = id_ocel.total_events;
        let total_o = id_ocel.total_objects;
        for v in cel_per_node.values_mut() {
            for s in v.iter_mut() {
                *s = rewrite_aggregate_builtins(s, total_e, total_o);
            }
        }
        for v in adv_per_node.values_mut() {
            for s in v.iter_mut() {
                *s = rewrite_aggregate_builtins(s, total_e, total_o);
            }
        }
        for v in label_per_node.values_mut() {
            for lf in v.iter_mut() {
                lf.cel = rewrite_aggregate_builtins(&lf.cel, total_e, total_o);
            }
        }
    }

    let survivors = eval_subtree(
        &intermediate,
        &[],
        &collected,
        &id_ocel,
        &cel_per_node,
        &label_per_node,
        &adv_per_node,
    )?;

    // Return both satisfied and violator bindings at the root, each tagged
    // with its `ViolationReason` (None = satisfied). Matches the in-memory
    // engine shape; the per-binding satisfaction status is preserved so
    // downstream consumers can filter or label as needed.
    let root_group = survivors.into_iter().next().unwrap_or_default();
    let mut out: Vec<BindingIdResult> = Vec::with_capacity(root_group.len());
    for (b, vr) in root_group {
        out.push(((*b).clone(), vr));
    }
    Ok(out)
}
