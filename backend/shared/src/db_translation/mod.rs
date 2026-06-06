// Parts of this code originated from the Bachelor's thesis of Jusin Graß
// Thanks to Justin for his contribution!

// Copyright (c) 2025 Justin Graß

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included
// in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOTLIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE
// SOFTWARE.

pub mod sql_executor;
pub mod sql_executor_id;
pub mod corpus;
pub mod mapping;
pub mod row_context;
pub mod row_context_id;
pub mod id_ocel;

pub use mapping::{
    EntityTableSpec, JunctionKind, JunctionTableSpec, OcelTableMappings,
};
/// Backwards-compatible alias for the public mapping type.
pub type TableMappings = OcelTableMappings;

use crate::binding_box::structs::EventVariable;
use crate::binding_box::structs::NewEventVariables;
use crate::binding_box::structs::NewObjectVariables;
use crate::binding_box::structs::ObjectVariable;
use crate::binding_box::structs::Qualifier;
use crate::binding_box::structs::Variable;
use crate::binding_box::{
    structs::{Constraint, Filter, LabelFunction, ObjectValueFilterTimepoint, SizeFilter, ValueFilter},
    BindingBoxTree,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use ts_rs::TS;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationToSQL {
    pub tree: BindingBoxTree,
    pub database_type: DatabaseType,
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DatabaseType {
    SQLite,

    DuckDB,

    PostgreSQL,
}

#[derive(Clone)]
pub struct SqlParts<'a> {
    node: InterMediateNode,
    select_fields: Vec<String>,
    base_from: Vec<String>,
    where_clauses: Vec<String>,
    child_sql: Vec<(String, String)>,
    table_mappings: &'a TableMappings,
    used_keys: HashSet<String>,
    database_type: DatabaseType,
    alias_type_map: HashMap<String, String>,
    /// Whether this node's emitted SQL must project a `satisfied` column.
    /// Roots and batched / recursive-executor children always require it;
    /// inline children consumed only by EXISTS / COUNT shortcut clauses can
    /// skip it. Set by the parent when emitting child SQL.
    emit_satisfied: bool,
    /// Whether this node's emitted SQL must project per-variable key
    /// columns (`key_e<n>` / `key_o<n>`). Required by batched / recursive
    /// paths and by NumChilds-COUNT / NumChildsProj / BindingSetEqual /
    /// BindingSetProjectionEqual constraints; not required by the EXISTS /
    /// NOT EXISTS NumChilds shortcuts.
    emit_keys: bool,
}

impl<'a> SqlParts<'a> {
    /// Pick the next free alias of the form `<prefix>{N}` (1-indexed) and
    /// reserve it in `used_keys`. Used for E2O (`ER1`, `ER2`, ...) and O2O
    /// (`OR1`, `OR2`, ...) junction-table aliases.
    fn next_alias(&mut self, prefix: &str) -> String {
        let mut n = 1;
        loop {
            let candidate = format!("{}{}", prefix, n);
            if !self.used_keys.contains(&candidate) {
                self.used_keys.insert(candidate.clone());
                return candidate;
            }
            n += 1;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DBTranslationInput {
    pub tree: BindingBoxTree,
    pub database: DatabaseType,
    pub table_mappings: TableMappings,
}

/// Like [`translate_to_sql_shared`] but also returns the per-child SQL
/// fragments the root node's children emit (label + correlated SQL string).
/// The AdvancedCEL post-processing pass re-executes each child SQL per parent
/// binding after substituting the parent's outer aliases (`E<n>.ocel_id` /
/// `O<n>.ocel_id`) with the binding's literal ocel_id values; see
/// [`sql_executor`].
pub fn translate_to_sql_shared_with_children(
    input: DBTranslationInput,
) -> (String, Vec<(String, String)>) {
    let inter = convert_to_intermediate(input.tree);
    emit_subtree_sql_with_children(&inter, input.database, &input.table_mappings)
}

/// Emit standalone SQL for an `InterMediateNode` treating it as a root.
/// Returns `(node_sql, per_child_sql)` where `node_sql` is a complete
/// query against the OCEL tables (with the node's pruning predicates,
/// its constraints' `satisfied` expression, and child-constraint
/// subqueries) and `per_child_sql` is one subquery per direct child of
/// the node (the same shape `construct_childstrings` emits internally).
///
/// References to inherited ancestor variables (`E<n>.ocel_id` /
/// `O<n>.ocel_id` for `n` outside this node's `event_vars`/
/// `object_vars`) remain in the SQL as dangling references; the caller
/// is expected to substitute them with literal ocel_id values before
/// executing (the recursive host-side executor does this for non-root
/// CEL/AdvancedCEL).
pub fn emit_subtree_sql_with_children(
    node: &InterMediateNode,
    database: DatabaseType,
    table_mappings: &TableMappings,
) -> (String, Vec<(String, String)>) {
    emit_subtree_sql_with_children_and_ancestors(
        node,
        database,
        table_mappings,
        &HashMap::new(),
    )
}

/// Same as [`emit_subtree_sql_with_children`] but seeds `alias_type_map` with
/// the supplied ancestor types, for the arbitrary-depth recursive
/// executor: a non-root node's filters / O2O / E2O may reference ancestor
/// event / object variables whose type is not in this node's own
/// `event_vars` / `object_vars`. Passing the type map fed by the descent
/// chain lets `type_of_event_var` / `type_of_object_var` resolve the
/// junction tables correctly.
pub fn emit_subtree_sql_with_children_and_ancestors(
    node: &InterMediateNode,
    database: DatabaseType,
    table_mappings: &TableMappings,
    ancestor_alias_type_map: &HashMap<String, String>,
) -> (String, Vec<(String, String)>) {
    // Seed `used_keys` from the ancestor type map: aliases listed there are
    // already in outer scope, so `construct_from_clauses` must NOT re-add
    // their tables to this subtree's FROM (the recursive host-side executor
    // substitutes ancestor refs with literal ocel_ids inline). Without this
    // seed `construct_from_clauses` would CROSS JOIN the ancestor table
    // into the child query and multiply row counts by |ancestor table|.
    let seeded_used_keys: HashSet<String> = ancestor_alias_type_map.keys().cloned().collect();
    let mut sql_parts = SqlParts {
        node: node.clone(),
        select_fields: vec![],
        base_from: vec![],
        where_clauses: vec![],
        child_sql: vec![],
        table_mappings,
        used_keys: seeded_used_keys,
        database_type: database,
        alias_type_map: ancestor_alias_type_map.clone(),
        emit_satisfied: true,
        emit_keys: true,
    };
    sql_parts.select_fields = construct_select_fields_root(&sql_parts);
    sql_parts.base_from = construct_from_clauses(&mut sql_parts);
    sql_parts.where_clauses = construct_basic_operations(&mut sql_parts);
    let childs = construct_childstrings_force_full(&sql_parts);
    sql_parts.child_sql = childs.clone();
    let filter_clauses = construct_filter_non_basic(&mut sql_parts);
    sql_parts.where_clauses.extend(filter_clauses);
    for obj_var in sql_parts.node.object_vars.keys() {
        sql_parts.where_clauses.push(format!(
            "O{}.ocel_changed_field IS NULL",
            o_alias(obj_var.0)
        ));
    }
    let sql = construct_result(&mut sql_parts);
    (sql, childs)
}

/// One AdvancedCEL site at the root binding box. Records the child label the
/// CEL string references plus the CEL body itself. The batched executor uses
/// `child_label` to look up the per-site batched SQL, and `cel` to evaluate
/// the predicate once per parent binding using that site's pre-streamed
/// child_res.
#[derive(Debug, Clone)]
pub struct AdvancedCELSite {
    pub child_label: String,
    pub cel: String,
}

/// Like [`translate_to_sql_shared_with_children`], but returns the parent SQL
/// extended with a `__parent_row_id__` column plus, for every child label of
/// the root, a batched `LEFT JOIN LATERAL` SQL that streams parent and child
/// rows together. The host-side executor uses the row-id column to group child
/// rows by their parent binding without re-executing the child SQL per parent.
///
/// Specifically:
/// - The first returned `String` is `<parent_sql with __parent_row_id__>` as a
///   standalone query, used to materialise the parent binding set keyed by
///   `__parent_row_id__`.
/// - The returned `Vec<(child_label, batched_sql)>` contains one entry per
///   unique child label of the root. Each batched SQL is shaped as
///   ```text
///   WITH parent AS (<parent_sql with __parent_row_id__>)
///   SELECT parent.__parent_row_id__, parent."O<n>"..., parent."E<n>"...,
///          child.satisfied, child.key_e<n>, child.key_o<n>, ...
///   FROM parent LEFT JOIN LATERAL (<child_sql>) AS child ON TRUE
///   ORDER BY parent.__parent_row_id__
///   ```
/// where `<child_sql>` is rewritten to reference `parent."E<n>" / parent."O<n>"`
/// in place of the dangling `E<n>.ocel_id / O<n>.ocel_id` references inherited
/// from the parent scope.
pub fn translate_to_sql_shared_with_batched_children(
    input: DBTranslationInput,
) -> (String, Vec<(String, String)>) {
    let DBTranslationInput {
        tree,
        database,
        table_mappings,
    } = input;

    let inter = convert_to_intermediate(tree);
    let mut sql_parts = SqlParts {
        node: inter,
        select_fields: vec![],
        base_from: vec![],
        where_clauses: vec![],
        child_sql: vec![],
        table_mappings: &table_mappings,
        used_keys: HashSet::new(),
        emit_satisfied: true,
        emit_keys: true,
        database_type: database,
        alias_type_map: HashMap::new(),
    };
    sql_parts.select_fields = construct_select_fields_root(&sql_parts);
    sql_parts.base_from = construct_from_clauses(&mut sql_parts);
    sql_parts.where_clauses = construct_basic_operations(&mut sql_parts);
    let childs = construct_childstrings_force_full(&sql_parts);
    sql_parts.child_sql = childs.clone();
    let filter_clauses = construct_filter_non_basic(&mut sql_parts);
    sql_parts.where_clauses.extend(filter_clauses);
    for obj_var in sql_parts.node.object_vars.keys() {
        sql_parts.where_clauses.push(format!(
            "O{}.ocel_changed_field IS NULL",
            o_alias(obj_var.0)
        ));
    }

    // Append __parent_row_id__ as the last column. ROW_NUMBER must
    // assign the SAME id to the same logical binding across two
    // *separate* queries: (a) `parent_only_sql` (fetched standalone
    // to materialise parent BindingIds) and (b) the parent CTE
    // re-executed *inside* `batched_sql`'s LATERAL wrapper (used to
    // attribute child rows to parent rows). Without an explicit
    // window-ORDER-BY the planner may stream the same logical rows
    // in different orders between the two queries on PostgreSQL --
    // the host then groups children under the wrong parent and the
    // normalized binding set diverges from in-memory + DuckDB while
    // cardinality coincides (Bug 2 in the May-2026 corpus triage).
    // The ORDER BY uses all (O*, E*) key columns lexicographically;
    // tied bindings cannot exist because each variable already
    // resolves to a unique ocel_id per logical binding.
    //
    // Emit as TEXT so dbcon's column-type decoder takes the text
    // path uniformly across SQLite / DuckDB / PostgreSQL. The
    // row-id is small (one per parent row); the host-side decoder
    // re-parses to i64. Window-function columns with no explicit
    // type info would otherwise fall through dbcon's SQLite decoder
    // and surface as `Null`.
    let mut row_id_order_keys: Vec<String> = Vec::new();
    for obj_var in sql_parts.node.object_vars.keys() {
        row_id_order_keys.push(format!("O{}.ocel_id", o_alias(obj_var.0)));
    }
    for event_var in sql_parts.node.event_vars.keys() {
        row_id_order_keys.push(format!("E{}.ocel_id", e_alias(event_var.0)));
    }
    let row_id_window_spec = if row_id_order_keys.is_empty() {
        String::new()
    } else {
        format!("ORDER BY {}", row_id_order_keys.join(", "))
    };
    sql_parts.select_fields.push(format!(
        "CAST(ROW_NUMBER() OVER ({}) AS TEXT) AS __parent_row_id__",
        row_id_window_spec
    ));

    let parent_sql = construct_result(&mut sql_parts);

    // Snapshot the parent's variable column names for the outer SELECT in the
    // batched query. These come from `construct_select_fields_root` and are
    // exposed as "O<n>" / "E<n>" by the CTE.
    let mut parent_var_cols: Vec<String> = Vec::new();
    for obj_var in sql_parts.node.object_vars.keys() {
        parent_var_cols.push(format!("\"O{}\"", o_alias(obj_var.0)));
    }
    for event_var in sql_parts.node.event_vars.keys() {
        parent_var_cols.push(format!("\"E{}\"", e_alias(event_var.0)));
    }

    // Collect the set of parent-alias-> CTE-column substitutions the child SQL
    // needs. These rewrite the dangling `E<n>.ocel_id` / `O<n>.ocel_id`
    // references in the child's WHERE/JOIN/SELECT clauses to instead reference
    // the corresponding columns on the parent CTE. The `E<n>.ocel_time`
    // mapping handles cross-scope non-zero-bound TBE references emitted in
    // child SQL (see `construct_select_fields_root` for the matching parent
    // projection).
    let mut subs: Vec<(String, String)> = Vec::new();
    for obj_var in sql_parts.node.object_vars.keys() {
        let n = o_alias(obj_var.0);
        subs.push((format!("O{n}.ocel_id"), format!("parent.\"O{n}\"")));
    }
    for event_var in sql_parts.node.event_vars.keys() {
        let n = e_alias(event_var.0);
        subs.push((format!("E{n}.ocel_id"), format!("parent.\"E{n}\"")));
        subs.push((
            format!("E{n}.ocel_time"),
            format!("parent.\"E{n}_ocel_time\""),
        ));
    }

    // Build one batched SQL per unique child label. The LATERAL shape is
    // currently DuckDB / PostgreSQL only; SQLite's batched-AdvancedCEL
    // path falls through to per-parent re-execution because the child SQL
    // references inherited parent variables `E<n>.ocel_id` that need a
    // parent CTE in scope. LATERAL provides that on DuckDB/Postgres; SQLite
    // has no equivalent.
    let mut seen_labels: HashSet<String> = HashSet::new();
    let mut batched: Vec<(String, String)> = Vec::new();
    for ((child_sql, label), (child_node, _l2)) in
        childs.iter().zip(sql_parts.node.children.iter())
    {
        if !seen_labels.insert(label.clone()) {
            continue;
        }
        // Rewrite parent-alias references inside the child SQL.
        let mut rewritten = child_sql.clone();
        for (needle, repl) in &subs {
            rewritten = rewritten.replace(needle.as_str(), repl.as_str());
        }

        // Collect the child's NEW variable key columns. These appear on the
        // child SQL as `... AS key_e<n>` / `... AS key_o<n>`.
        let child_key_cols: Vec<String> = child_key_columns(child_node)
            .into_iter()
            .map(|(_, alias)| alias)
            .collect();

        let mut outer_select_parts: Vec<String> = Vec::new();
        outer_select_parts.push("parent.__parent_row_id__".to_string());
        for c in &parent_var_cols {
            outer_select_parts.push(format!("parent.{c}"));
        }
        outer_select_parts.push("child.satisfied".to_string());
        for k in &child_key_cols {
            outer_select_parts.push(format!("child.{k}"));
        }

        let batched_sql = format!(
            "WITH parent AS (\n{parent_sql}\n)\nSELECT {select}\nFROM parent\nLEFT JOIN LATERAL (\n{rewritten}\n) AS child ON TRUE\nORDER BY parent.__parent_row_id__",
            parent_sql = parent_sql,
            select = outer_select_parts.join(", "),
            rewritten = rewritten,
        );

        batched.push((label.clone(), batched_sql));
    }

    (parent_sql, batched)
}

pub fn translate_to_sql_shared(input: DBTranslationInput) -> String {
    //Step 1:  Extract Intermediate Representation
    let inter = convert_to_intermediate(input.tree);

    // Create SQL Struct

    let sql_parts = SqlParts {
        node: inter,
        select_fields: vec![],
        base_from: vec![],
        where_clauses: vec![],
        child_sql: vec![],
        table_mappings: &input.table_mappings,
        used_keys: HashSet::new(),
        database_type: input.database,
        alias_type_map: HashMap::new(),
        emit_satisfied: true,
        emit_keys: true,
    };

    // Step 2: Translate the Intermediate Representation to SQL

    translate_to_sql_from_intermediate(sql_parts)
}

/// Like [`translate_to_sql_shared`] but with extra columns projecting
/// per-(event-var, attribute) and per-(object-var, attribute) values
/// inline on the parent SELECT. The row-context evaluator reads these
/// directly to populate the subset OCEL without a separate
/// `WHERE ocel_id IN (...)` round-trip.
///
/// Column aliases are `"E<n>__<attr>"` for events and `"O<n>__<attr>"`
/// for objects (one-indexed `<n>`). The caller is responsible for
/// passing `<attr>` values that exist as columns on the per-type table.
pub fn translate_to_sql_shared_with_extra_columns(
    input: DBTranslationInput,
    extra_event_attrs: &[(EventVariable, String)],
    extra_object_attrs: &[(ObjectVariable, String)],
) -> String {
    let inter = convert_to_intermediate(input.tree);
    let sql_parts = SqlParts {
        node: inter,
        select_fields: vec![],
        base_from: vec![],
        where_clauses: vec![],
        child_sql: vec![],
        table_mappings: &input.table_mappings,
        used_keys: HashSet::new(),
        database_type: input.database,
        alias_type_map: HashMap::new(),
        emit_satisfied: true,
        emit_keys: true,
    };

    translate_to_sql_from_intermediate_with_extras(
        sql_parts,
        extra_event_attrs,
        extra_object_attrs,
    )
}

pub fn convert_to_intermediate(tree: BindingBoxTree) -> InterMediateNode {
    // Recursive approach for each binding box, start with the root node

    bindingbox_to_intermediate(&tree, 0)
}

#[derive(Clone)]
pub struct InterMediateNode {
    pub event_vars: NewEventVariables,
    pub object_vars: NewObjectVariables,
    pub relations: Vec<Relation>, // O2O, E2O, TBE Basics have to be included
    pub constraints: Vec<Constraint>,
    pub children: Vec<(InterMediateNode, String)>,
    pub filter: Vec<Filter>,
    pub sizefilter: Vec<SizeFilter>,
    /// LabelFunctions carried unchanged from the source BindingBox. The SQL
    /// executor evaluates these host-side per surviving binding via
    /// `crate::cel::add_cel_label`; the emitter ignores them (no SQL form).
    pub labels: Vec<LabelFunction>,
}

#[derive(Clone)]
pub enum Relation {
    E2O {
        event: EventVariable,
        object: ObjectVariable,
        qualifier: Qualifier,
    },
    O2O {
        object_1: ObjectVariable,
        object_2: ObjectVariable,
        qualifier: Qualifier,
    },
    TimeBetweenEvents {
        from_event: EventVariable,
        to_event: EventVariable,
        min_seconds: Option<f64>,
        max_seconds: Option<f64>,
    },
}

pub fn bindingbox_to_intermediate(tree: &BindingBoxTree, index: usize) -> InterMediateNode {
    let node = &tree.nodes[index];

    let (binding_box, child_indices) = node.to_box();

    let event_vars = binding_box.new_event_vars.clone();
    let object_vars = binding_box.new_object_vars.clone();

    // Extract the relations we HAVE to translate to query language (O2O, E2O, TBE)
    let relations = extract_basic_relations(binding_box.filters.clone());

    let constraints = binding_box.constraints.clone();

    // Handle childs recursively with box to inter function
    let mut children = Vec::new();

    let (filter, sizefilter) = extract_filters(
        binding_box.filters.clone(),
        binding_box.size_filters.clone(),
    );

    // Iterate over all BindingBoxes in tree
    for child_index in child_indices.as_ref() {
        let child_node = bindingbox_to_intermediate(tree, *child_index);

        // Extract label names from edge_names
        let edge_name = tree
            .edge_names
            .get(&(index, *child_index))
            .cloned()
            .unwrap_or_else(|| format!("unnamed_edge_{}_{}", index, child_index)); // Edge not there

        children.push((child_node, edge_name));
    }

    InterMediateNode {
        event_vars,
        object_vars,
        relations,
        filter,
        sizefilter,
        constraints,
        children,
        labels: binding_box.labels.clone(),
    }
}

/// Reason a `BindingBoxTree` cannot be translated to SQL by the current emitter.
/// Returned by [`validate_translatable`] so callers can fail fast with a precise
/// message instead of silently dropping predicates during IR construction.
#[derive(Debug, Clone)]
pub enum TranslationError {
    UnsupportedFilter { node_index: usize, variant: &'static str },
    UnsupportedSizeFilter { node_index: usize, variant: &'static str },
    /// A CEL string in the IR (filter body, AdvancedCEL size-filter body, or
    /// LabelFunction body) calls the `events()` or `objects()` builtin. These
    /// builtins enumerate the full OCEL event/object set inside CEL, which has
    /// no row-context analogue against the SQL backend. Reject conservatively
    /// at translation time rather than silently dropping or misinterpreting
    /// them.
    UnsupportedCelBuiltin {
        node_index: usize,
        builtin: &'static str,
        location: &'static str,
    },
    /// Deprecated. Retained for ABI compat with callers that still
    /// pattern-match on the variant; the arbitrary-depth recursive
    /// executor no longer emits it. Host-side forms at any depth are
    /// accepted by the validator now.
    NonRootHostSideForm {
        node_index: usize,
        form_name: &'static str,
        location: &'static str,
    },
}

impl std::fmt::Display for TranslationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TranslationError::UnsupportedFilter { node_index, variant } => write!(
                f,
                "node {node_index}: filter variant `{variant}` has no SQL translation in the current emitter"
            ),
            TranslationError::UnsupportedSizeFilter { node_index, variant } => write!(
                f,
                "node {node_index}: size-filter variant `{variant}` has no SQL translation in the current emitter"
            ),
            TranslationError::UnsupportedCelBuiltin {
                node_index,
                builtin,
                location,
            } => write!(
                f,
                "node {node_index}: CEL builtin `{builtin}` in {location} cannot be evaluated row-context against the SQL backend; load via in-memory engine or rewrite"
            ),
            TranslationError::NonRootHostSideForm {
                node_index,
                form_name,
                location,
            } => write!(
                f,
                "{form_name} at node {node_index} (depth >= 1) is not supported: host-side post-processing currently applies only at the root binding box ({location}). Tree-walk via in-memory engine or restructure to root."
            ),
        }
    }
}

impl std::error::Error for TranslationError {}

/// Walk a `BindingBoxTree` and return every predicate or size-filter form whose
/// SQL translation is not yet supported. The translation layer now accepts
/// host-side forms (BasicFilterCEL, AdvancedCEL size-filter, LabelFunction,
/// EventAttributeValueFilter, ObjectAttributeValueFilter) at any depth: the
/// recursive executor evaluates them bottom-up, and the emitter relaxes
/// parent-side `K_C` / `SizeFilter` references over CEL-affected children so
/// the parent SQL stays an *over-approximation* of the parent binding set,
/// with the host tightening it post-evaluation.
///
/// What still gets rejected here: CEL builtins (`events()` / `objects()`)
/// inside any CEL body. They enumerate the full OCEL set with no
/// row-context analogue, so we refuse rather than silently mis-translate.
pub fn validate_translatable(tree: &BindingBoxTree) -> Result<(), Vec<TranslationError>> {
    let mut errors = Vec::new();
    for (i, node) in tree.nodes.iter().enumerate() {
        let (bbox, _children) = node.to_box();
        for filter in bbox.filters.iter() {
            match filter {
                Filter::O2E { .. }
                | Filter::O2O { .. }
                | Filter::TimeBetweenEvents { .. }
                | Filter::EventAttributeValueFilter { .. }
                | Filter::ObjectAttributeValueFilter { .. }
                | Filter::NotEqual { .. } => {}
                Filter::BasicFilterCEL { cel } => {
                    scan_cel_builtins(cel, i, "BasicFilterCEL", &mut errors);
                }
            }
        }
        for size_filter in bbox.size_filters.iter() {
            match size_filter {
                SizeFilter::NumChilds { .. }
                | SizeFilter::BindingSetEqual { .. }
                | SizeFilter::BindingSetProjectionEqual { .. }
                | SizeFilter::NumChildsProj { .. } => {}
                SizeFilter::AdvancedCEL { cel } => {
                    scan_cel_builtins(cel, i, "AdvancedCEL size-filter", &mut errors);
                }
            }
        }
        for label_fun in bbox.labels.iter() {
            scan_cel_builtins(&label_fun.cel, i, "LabelFunction body", &mut errors);
        }
        for constraint in bbox.constraints.iter() {
            match constraint {
                Constraint::Filter {
                    filter: Filter::BasicFilterCEL { cel },
                } => {
                    scan_cel_builtins(cel, i, "Constraint::Filter{BasicFilterCEL}", &mut errors);
                }
                Constraint::SizeFilter {
                    filter: SizeFilter::AdvancedCEL { cel },
                } => {
                    scan_cel_builtins(
                        cel,
                        i,
                        "Constraint::SizeFilter{AdvancedCEL}",
                        &mut errors,
                    );
                }
                _ => {}
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Whole-token search for the CEL builtins `events()` and `objects()` inside a
/// CEL source string. Whole-token means the matched character before the name
/// must not be an alphanumeric / underscore, so `numEvents()` and
/// `numObjects()` do NOT match. Each distinct builtin produces at most one
/// error per (node, location).
fn scan_cel_builtins(
    cel: &str,
    node_index: usize,
    location: &'static str,
    errors: &mut Vec<TranslationError>,
) {
    for builtin in ["events", "objects"] {
        if has_unsupported_cel_builtin(cel, builtin) {
            // builtin is a static &str from a static array, so we re-tag the
            // lifetime as 'static via a match to keep the error variant
            // 'static-clean.
            let tag: &'static str = match builtin {
                "events" => "events()",
                "objects" => "objects()",
                _ => unreachable!(),
            };
            errors.push(TranslationError::UnsupportedCelBuiltin {
                node_index,
                builtin: tag,
                location,
            });
        }
    }
}

/// Returns true iff `cel` contains a whole-token call to `name()` (e.g.
/// `events()`), not as a suffix of a longer identifier (`numEvents()`).
/// It still matches inside string literals; we reject rather than risk a
/// silent translation gap.
fn has_unsupported_cel_builtin(cel: &str, name: &str) -> bool {
    let bytes = cel.as_bytes();
    let name_bytes = name.as_bytes();
    let n = name_bytes.len();
    let mut i = 0;
    while i + n + 2 <= bytes.len() {
        if &bytes[i..i + n] == name_bytes {
            // Check char before is not an identifier-continuation byte (ASCII).
            let prev_ok = i == 0 || {
                let p = bytes[i - 1];
                !(p.is_ascii_alphanumeric() || p == b'_')
            };
            // Skip optional whitespace between name and `(`. CEL grammar
            // doesn't actually permit whitespace before `(` for function
            // calls, but tolerating it here keeps the check robust.
            let mut j = i + n;
            while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
                j += 1;
            }
            // Need `(` then optional whitespace then `)`.
            if prev_ok && j < bytes.len() && bytes[j] == b'(' {
                let mut k = j + 1;
                while k < bytes.len() && (bytes[k] == b' ' || bytes[k] == b'\t') {
                    k += 1;
                }
                if k < bytes.len() && bytes[k] == b')' {
                    return true;
                }
            }
        }
        i += 1;
    }
    false
}

// Function to extract BASIC operations (E20,O2O,TBE)
pub fn extract_basic_relations(filters: Vec<Filter>) -> Vec<Relation> {
    let mut result = Vec::new();

    // Iterate over all filters and extract the ones we want to take into Intermediate Representation
    for filter in filters {
        //Here Filters we extract
        match filter {
            Filter::O2E {
                event,
                object,
                qualifier,
                ..
            } => {
                result.push(Relation::E2O {
                    event,
                    object,
                    qualifier,
                });
            }
            Filter::O2O {
                object,
                other_object,
                qualifier,
                ..
            } => {
                result.push(Relation::O2O {
                    object_1: object,
                    object_2: other_object,
                    qualifier,
                });
            }
            Filter::TimeBetweenEvents {
                from_event,
                to_event,
                min_seconds,
                max_seconds,
            } => {
                result.push(Relation::TimeBetweenEvents {
                    from_event,
                    to_event,
                    min_seconds,
                    max_seconds,
                });
            }
            _ => {
                // Ignore the other filters
            }
        }
    }

    result
}

// Keep filters that the SQL emitter will translate to WHERE clauses (attribute
// filters) plus filters with no SQL counterpart (CEL filters). The latter are
// preserved here so the IR carries them through to the post-processing pass;
// the SQL emitter (`construct_filter_non_basic`) ignores them by design.
pub fn extract_filters(
    filters: Vec<Filter>,
    size_filters: Vec<SizeFilter>,
) -> (Vec<Filter>, Vec<SizeFilter>) {
    let mut result = Vec::new();
    let result_size: Vec<SizeFilter> = size_filters.iter().cloned().collect();

    for filter in &filters {
        match filter {
            Filter::ObjectAttributeValueFilter { .. }
            | Filter::EventAttributeValueFilter { .. }
            | Filter::BasicFilterCEL { .. }
            | Filter::NotEqual { .. } => {
                result.push(filter.clone());
            }

            _ => {}
        }
    }

    (result, result_size)
}

/// Return the CEL filter expressions attached to an intermediate node, in the
/// order they appear in the IR's `filter` slot. These have no SQL counterpart
/// and are applied host-side over the rows returned by the emitted SQL using
/// `crate::cel::check_cel_predicate`. Returning the raw expressions is the
/// integration point for the query executor: it produces SQL rows, the
/// executor converts each row into a `Binding`, and then evaluates each CEL
/// expression against that `Binding`.
pub fn cel_filters_for_post_processing(node: &InterMediateNode) -> Vec<&str> {
    node.filter
        .iter()
        .filter_map(|f| match f {
            Filter::BasicFilterCEL { cel } => Some(cel.as_str()),
            _ => None,
        })
        .collect()
}

/// Return the CEL expressions attached as `Constraint::Filter{Filter::BasicFilterCEL}`
/// on the node. Per OCPQ constraint semantics these LABEL bindings as
/// satisfied/violated (they do not drop them); the executor evaluates them
/// host-side and ANDs the result into the per-binding `satisfied` flag.
/// Non-root constraint-mode CEL is rejected by `validate_translatable`.
pub fn constraint_cel_filters_for_post_processing(node: &InterMediateNode) -> Vec<&str> {
    node.constraints
        .iter()
        .filter_map(|c| match c {
            Constraint::Filter { filter } => match filter {
                Filter::BasicFilterCEL { cel } => Some(cel.as_str()),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

// End of Intermediate

// Start of SQL Translation

// Function which translates Intermediate to SQL
pub fn translate_to_sql_from_intermediate(mut sql_parts: SqlParts) -> String {
    sql_parts.select_fields = construct_select_fields_root(&sql_parts);

    sql_parts.base_from = construct_from_clauses(&mut sql_parts);

    sql_parts.where_clauses = construct_basic_operations(&mut sql_parts);

    let childs = construct_childstrings(&sql_parts);
    sql_parts.child_sql = childs;

    let filter_clauses = construct_filter_non_basic(&mut sql_parts);
    sql_parts.where_clauses.extend(filter_clauses);

    for obj_var in sql_parts.node.object_vars.keys() {
        sql_parts.where_clauses.push(format!(
            "O{}.ocel_changed_field IS NULL",
            o_alias(obj_var.0)
        ));
    }

    construct_result(&mut sql_parts)
}

/// Variant of [`translate_to_sql_from_intermediate`] that also projects
/// per-variable attribute columns, letting the row-context CEL evaluator
/// read CEL-referenced attributes inline on the parent SELECT and avoid the
/// separate `WHERE ocel_id IN (...)` round-trip.
fn translate_to_sql_from_intermediate_with_extras(
    mut sql_parts: SqlParts,
    extra_event_attrs: &[(EventVariable, String)],
    extra_object_attrs: &[(ObjectVariable, String)],
) -> String {
    // The single-type and non-reserved-column guards live in the caller
    // (`sql_executor::execute_translated_query_via`); reproduce them as
    // a debug-time invariant so a future caller cannot accidentally
    // hand us a multi-type variable (which would yield an ambiguous
    // `E{n}."<attr>"` reference against a `FROM event_<T1> AS E{n},
    // event_<T2> AS E{n}` clause).
    debug_assert!(
        extra_event_attrs.iter().all(|(ev, _)| sql_parts
            .node
            .event_vars
            .get(ev)
            .map(|t| t.len() == 1)
            .unwrap_or(false)),
        "extra_event_attrs must only contain single-type event variables"
    );
    debug_assert!(
        extra_object_attrs.iter().all(|(ob, _)| sql_parts
            .node
            .object_vars
            .get(ob)
            .map(|t| t.len() == 1)
            .unwrap_or(false)),
        "extra_object_attrs must only contain single-type object variables"
    );
    sql_parts.select_fields = construct_select_fields_root(&sql_parts);
    // Append the extra attribute projections. Aliases are unique across
    // the projection (one per (var, attr) pair).
    for (ev, attr) in extra_event_attrs {
        let n = e_alias(ev.0);
        sql_parts.select_fields.push(format!(
            "E{n}.\"{attr}\" AS \"E{n}__{attr}\""
        ));
    }
    for (ob, attr) in extra_object_attrs {
        let n = o_alias(ob.0);
        sql_parts.select_fields.push(format!(
            "O{n}.\"{attr}\" AS \"O{n}__{attr}\""
        ));
    }

    sql_parts.base_from = construct_from_clauses(&mut sql_parts);

    sql_parts.where_clauses = construct_basic_operations(&mut sql_parts);

    let childs = construct_childstrings(&sql_parts);
    sql_parts.child_sql = childs;

    let filter_clauses = construct_filter_non_basic(&mut sql_parts);
    sql_parts.where_clauses.extend(filter_clauses);

    for obj_var in sql_parts.node.object_vars.keys() {
        sql_parts.where_clauses.push(format!(
            "O{}.ocel_changed_field IS NULL",
            o_alias(obj_var.0)
        ));
    }

    construct_result(&mut sql_parts)
}

// Construct the resulting SQL query with tools given

pub fn construct_result(sql_parts: &mut SqlParts) -> String {
    let mut result = String::new();

    // Root constraints label via a `satisfied` CASE column; they do not
    // drop bindings.
    if !sql_parts.node.constraints.is_empty() {
        let constr_expr = construct_child_constraints(sql_parts);
        let trimmed = constr_expr.trim();
        let field = if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("true") {
            "TRUE AS satisfied".to_string()
        } else {
            // SQL booleans (DuckDB / PostgreSQL) and SQLite 0/1 are both
            // accepted by `lookup_satisfied`; no need to wrap in CASE.
            format!("({constr_expr}) AS satisfied")
        };
        sql_parts.select_fields.push(field);
    }

    // SELECT result. Empty projection happens for the trivial (0,0) shape
    // (no variables); emit a placeholder column so the SQL parser accepts the
    // statement. The host-side executor ignores extra columns it does not
    // recognise as ocel_id projections.
    result.push_str("SELECT ");
    if sql_parts.select_fields.is_empty() {
        result.push_str("1 AS __trivial__");
    } else {
        result.push_str(&sql_parts.select_fields.join(", "));
    }
    result.push('\n');

    let mut contains_relation = false;

    for filter in &sql_parts.node.relations {
        match filter {
            Relation::E2O {
                event: _,
                object: _,
                qualifier: _,
            } => {
                contains_relation = true;
                break;
            }

            Relation::O2O {
                object_1: _,
                object_2: _,
                qualifier: _,
            } => {
                contains_relation = true;
                break;
            }

            _ => {}
        }
    }

    // FROM result generate dummy if basefrom empty

    if sql_parts.base_from.is_empty() {
        result.push_str("FROM (SELECT 1) as dummy ");
    } else if contains_relation {
        result.push_str(&format!("FROM {}\n", sql_parts.base_from.join("\n")));
    } else {
        result.push_str(&format!("FROM {}\n", sql_parts.base_from.join(",\n")))
    }

    // WHERE result

    if !sql_parts.where_clauses.is_empty() {
        result.push_str(&format!(
            "WHERE {}\n",
            sql_parts.where_clauses.join("\nAND ")
        ));
    }

    result
}

fn o_alias(n: usize) -> String {
    format!("{}", n + 1)
}

fn e_alias(n: usize) -> String {
    format!("{}", n + 1)
}

/// SQL reference to the `ocel_id` column of a variable's outer alias.
fn var_ocel_id_ref(v: &Variable) -> String {
    match v {
        Variable::Event(ev) => format!("E{}.ocel_id", e_alias(ev.0)),
        Variable::Object(ob) => format!("O{}.ocel_id", o_alias(ob.0)),
    }
}

/// Key-column name a child's emitted SQL exposes for a given child variable
/// (see `child_key_columns`).
fn var_key_col(v: &Variable) -> String {
    match v {
        Variable::Event(ev) => format!("key_e{}", e_alias(ev.0)),
        Variable::Object(ob) => format!("key_o{}", o_alias(ob.0)),
    }
}

pub fn construct_select_fields_root(sql_parts: &SqlParts) -> Vec<String> {
    let mut select_fields = Vec::new();

    for obj_var in sql_parts.node.object_vars.keys() {
        let n = o_alias(obj_var.0);
        select_fields.push(format!("O{n}.ocel_id AS \"O{n}\""));
    }

    for event_var in sql_parts.node.event_vars.keys() {
        let n = e_alias(event_var.0);
        select_fields.push(format!("E{n}.ocel_id AS \"E{n}\""));
        // Also expose ocel_time so descendants emitted through the
        // per-parent substitution path (sql_executor_id::collect_subtree,
        // and the LATERAL batched-children path below) can resolve
        // cross-scope `E{n}.ocel_time` references in non-zero-bound TBE
        // clauses. Without this projection the dangling alias breaks the
        // DB binder at depth >=1 / on SQLite. Negligible cost (one extra
        // column per event variable in the parent CTE/SELECT).
        select_fields.push(format!("E{n}.ocel_time AS \"E{n}_ocel_time\""));
    }

    select_fields
}

/// The list of (expression, alias) pairs that uniquely identify a binding
/// of `node`, one entry per object/event variable. The aliases are stable
/// (a function of the variable index alone), so callers that produce the
/// child SELECT and callers that consume it can derive the same names
/// without sharing additional state.
pub fn child_key_columns(node: &InterMediateNode) -> Vec<(String, String)> {
    let mut cols = Vec::new();
    for obj_var in node.object_vars.keys() {
        let n = o_alias(obj_var.0);
        cols.push((format!("O{n}.ocel_id"), format!("key_o{n}")));
    }
    for event_var in node.event_vars.keys() {
        let n = e_alias(event_var.0);
        cols.push((format!("E{n}.ocel_id"), format!("key_e{n}")));
    }
    cols
}

/// SQL fragment for `SizeFilter::BindingSetEqual { child_names }`.
/// Pairwise compares the first listed child's binding set with every other
/// listed child via two `EXCEPT` subqueries on the children's key columns.
/// Returns `Some("FALSE")` if a later child has a different variable set
/// (its binding space cannot coincide with the first's); returns `None` for
/// vacuous cases (empty or singleton list).
fn emit_binding_set_equal(
    sql_parts: &SqlParts,
    child_names: &[String],
    outer_idx: usize,
) -> Option<String> {
    if child_names.is_empty() {
        return None;
    }
    let resolve = |name: &str| -> Option<(usize, String, Vec<String>)> {
        for (j, (sql, label)) in sql_parts.child_sql.iter().enumerate() {
            if label == name {
                let cols: Vec<String> = child_key_columns(&sql_parts.node.children[j].0)
                    .into_iter()
                    .map(|(_, a)| a)
                    .collect();
                return Some((j, sql.clone(), cols));
            }
        }
        None
    };
    let (j0, first_sql, first_cols) = match resolve(&child_names[0]) {
        Some(v) => v,
        None => return Some("FALSE".to_string()),
    };
    let first_set: std::collections::HashSet<&String> = first_cols.iter().collect();
    let cols = first_cols.join(", ");
    let mut parts: Vec<String> = Vec::new();
    for (k, name) in child_names.iter().enumerate().skip(1) {
        let (jk, other_sql, other_cols) = match resolve(name) {
            Some(v) => v,
            None => return Some("FALSE".to_string()),
        };
        let other_set: std::collections::HashSet<&String> = other_cols.iter().collect();
        let tag = format!("bse_{outer_idx}_{j0}_{jk}_{k}");
        if first_set != other_set {
            // Distinct variable spaces: bindings can never coincide as
            // tuples, so the only way the multisets agree is if BOTH are
            // empty. Emit `NOT EXISTS (a) AND NOT EXISTS (b)`, matching the
            // in-memory engine's HashSet-based check which returns equal for
            // two empty sets regardless of schema.
            parts.push(format!(
                "(NOT EXISTS (SELECT 1 FROM ({first_sql}) AS {tag}_a)) AND (NOT EXISTS (SELECT 1 FROM ({other_sql}) AS {tag}_b))"
            ));
            continue;
        }
        parts.push(format!(
            "(NOT EXISTS (SELECT {cols} FROM ({first_sql}) AS {tag}_a EXCEPT SELECT {cols} FROM ({other_sql}) AS {tag}_b)) AND (NOT EXISTS (SELECT {cols} FROM ({other_sql}) AS {tag}_c EXCEPT SELECT {cols} FROM ({first_sql}) AS {tag}_d))"
        ));
    }
    if parts.is_empty() {
        return None;
    }
    Some(format!("({})", parts.join(" AND ")))
}

/// SQL fragment for `SizeFilter::BindingSetProjectionEqual`. Pairwise compares
/// the first child's projection onto its specified variable with every other
/// listed (child, var) pair's projection via `EXCEPT`.
fn emit_binding_set_projection_equal(
    sql_parts: &SqlParts,
    pairs: &[(String, Variable)],
    outer_idx: usize,
) -> Option<String> {
    if pairs.is_empty() {
        return None;
    }
    let resolve = |name: &str| -> Option<(usize, String)> {
        for (j, (sql, label)) in sql_parts.child_sql.iter().enumerate() {
            if label == name {
                return Some((j, sql.clone()));
            }
        }
        None
    };
    let (j0, first_sql) = match resolve(&pairs[0].0) {
        Some(v) => v,
        None => return Some("FALSE".to_string()),
    };
    let first_proj = var_key_col(&pairs[0].1);
    let mut parts: Vec<String> = Vec::new();
    for (k, (name, var)) in pairs.iter().enumerate().skip(1) {
        let (jk, other_sql) = match resolve(name) {
            Some(v) => v,
            None => return Some("FALSE".to_string()),
        };
        let other_proj = var_key_col(var);
        let tag = format!("bsp_{outer_idx}_{j0}_{jk}_{k}");
        parts.push(format!(
            "(NOT EXISTS (SELECT {first_proj} FROM ({first_sql}) AS {tag}_a EXCEPT SELECT {other_proj} FROM ({other_sql}) AS {tag}_b)) AND (NOT EXISTS (SELECT {other_proj} FROM ({other_sql}) AS {tag}_c EXCEPT SELECT {first_proj} FROM ({first_sql}) AS {tag}_d))"
        ));
    }
    if parts.is_empty() {
        return None;
    }
    Some(format!("({})", parts.join(" AND ")))
}

/// SQL fragment that counts the distinct child bindings of `child_node`.
fn num_childs_count_expr(
    child_sql: &str,
    child_label: &str,
    child_node: &InterMediateNode,
    i: usize,
    j: usize,
) -> String {
    let label = child_label.trim();
    let key_aliases: Vec<String> = child_key_columns(child_node)
        .into_iter()
        .map(|(_, alias)| alias)
        .collect();
    // For a child without any new variables every passing parent binding
    // produces the same singleton; `SELECT DISTINCT 1 ...` evaluates to 0
    // or 1 row, which matches the in-memory evaluator's `c_res.len()`.
    let distinct_list = if key_aliases.is_empty() {
        "1".to_string()
    } else {
        key_aliases.join(", ")
    };
    format!(
        "(SELECT COUNT(*) FROM (SELECT DISTINCT {distinct_list} FROM ({child_sql}) AS child_{i}_{j}_{label}) AS child_{i}_{j}_{label}_d)"
    )
}

/// Resolve the OCEL event type for variable index `idx` in the current
/// emitter context. Checks the node's local `event_vars` first; falls back
/// to `alias_type_map` (which the parent populated when the variable was
/// inherited from outer scope). Returns the empty string when neither has
/// a type recorded, which causes the per-pair junction lookup to fall back
/// to `default_e2o`.
fn type_of_event_var(sql_parts: &SqlParts, idx: usize) -> String {
    let t = get_event_type(sql_parts.node.clone(), idx);
    if t == "no type found event" {
        let key = format!("E{}", e_alias(idx));
        return sql_parts
            .alias_type_map
            .get(&key)
            .cloned()
            .unwrap_or_default();
    }
    t
}

/// As [`type_of_event_var`] for object variables.
fn type_of_object_var(sql_parts: &SqlParts, idx: usize) -> String {
    let t = get_object_type(sql_parts.node.clone(), idx);
    if t == "no type found object" {
        let key = format!("O{}", o_alias(idx));
        return sql_parts
            .alias_type_map
            .get(&key)
            .cloned()
            .unwrap_or_default();
    }
    t
}

pub fn get_object_type(node: InterMediateNode, index: usize) -> String {
    for (obj_var, types) in node.object_vars {
        if obj_var.0 == index {
            if let Some(object_type) = types.into_iter().next() {
                return object_type.to_string();
            }
        }
    }
    "no type found object".to_string()
}

pub fn get_event_type(node: InterMediateNode, index: usize) -> String {
    for (ev_var, types) in node.event_vars {
        if ev_var.0 == index {
            if let Some(event_type) = types.into_iter().next() {
                return event_type.to_string();
            }
        }
    }

    "no type found event".to_string()
}

pub fn construct_from_clauses(sql_parts: &mut SqlParts) -> Vec<String> {
    let mut from_clauses = Vec::new();
    let mut is_first_join = true;

    // Clone the relation list so we can mutably borrow `sql_parts` inside the
    // loop body (e.g. via `next_alias`).
    let relations = sql_parts.node.relations.clone();
    for relation in &relations {
        match relation {
            Relation::E2O {
                event,
                object,
                qualifier,
            } => {
                let event_alias = format!("E{}", e_alias(event.0));
                let object_alias = format!("O{}", o_alias(object.0));
                let event_object_alias = sql_parts.next_alias("ER");
                let qualifier_clone = qualifier.clone();
                // Use the alias-aware accessors so ancestor variables resolve
                // through `alias_type_map` (seeded by the recursive host-side
                // executor for non-root subtrees). Direct `get_event_type` /
                // `get_object_type` would return the literal "no type found"
                // placeholder for ancestor refs and the junction-table lookup
                // would produce an invalid SQL identifier.
                let e_type = type_of_event_var(sql_parts, event.0);
                let o_type = type_of_object_var(sql_parts, object.0);
                let e2o_tbl = e2o_table_sql(sql_parts, &e_type, &o_type);

                if is_first_join {
                    // first join to distinct if we have to use INNER JOIN first
                    if sql_parts.used_keys.contains(&event_alias) {
                        if sql_parts.used_keys.contains(&object_alias) {
                            from_clauses.push(format!("{e2o_tbl} AS {}", event_object_alias));
                            sql_parts.where_clauses.push(format!(
                                "{}.ocel_event_id = {}.ocel_id",
                                event_object_alias, event_alias
                            ));
                            sql_parts.where_clauses.push(format!(
                                "{}.ocel_object_id = {}.ocel_id",
                                event_object_alias, object_alias
                            ));
                        } else {
                            // event exists, object does not
                            from_clauses.push(format!(
                                "{} AS {}",
                                object_table_sql(
                                    sql_parts,
                                    &type_of_object_var(sql_parts, object.0)
                                ),
                                object_alias
                            ));
                            from_clauses.push(format!(
                                "INNER JOIN {e2o_tbl} AS {} ON {}.ocel_object_id = {}.ocel_id AND {}.ocel_event_id = {}.ocel_id",
                                event_object_alias, event_object_alias, object_alias, event_object_alias, event_alias
                            ));
                            sql_parts.alias_type_map.insert(
                                object_alias.clone(),
                                type_of_object_var(sql_parts, object.0),
                            );
                            sql_parts.used_keys.insert(object_alias.clone());
                        }
                    } else if sql_parts.used_keys.contains(&object_alias) {
                        // object table exists, event not
                        from_clauses.push(format!(
                            "{} AS {}",
                            event_table_sql(
                                sql_parts,
                                &type_of_event_var(sql_parts, event.0)
                            ),
                            event_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {e2o_tbl} AS {} ON {}.ocel_object_id = {}.ocel_id AND {}.ocel_event_id = {}.ocel_id",
                            event_object_alias, event_object_alias, object_alias, event_object_alias, event_alias
                        ));

                        sql_parts.alias_type_map.insert(
                            event_alias.clone(),
                            type_of_event_var(sql_parts, event.0),
                        );
                        sql_parts.used_keys.insert(event_alias.clone());
                    } else {
                        // both not existing
                        from_clauses.push(format!(
                            "{} AS {}",
                            event_table_sql(
                                sql_parts,
                                &type_of_event_var(sql_parts, event.0)
                            ),
                            event_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {e2o_tbl} AS {} ON {}.ocel_event_id = {}.ocel_id",
                            event_object_alias, event_object_alias, event_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {} AS {} ON {}.ocel_object_id = {}.ocel_id",
                            object_table_sql(
                                sql_parts,
                                &type_of_object_var(sql_parts, object.0)
                            ),
                            object_alias,
                            event_object_alias,
                            object_alias
                        ));
                        sql_parts.alias_type_map.insert(
                            object_alias.clone(),
                            type_of_object_var(sql_parts, object.0),
                        );
                        sql_parts.alias_type_map.insert(
                            event_alias.clone(),
                            type_of_event_var(sql_parts, event.0),
                        );
                        sql_parts.used_keys.insert(object_alias.clone());
                        sql_parts.used_keys.insert(event_alias.clone());
                    }

                    is_first_join = false;
                } else if sql_parts.used_keys.contains(&event_alias) {
                    if sql_parts.used_keys.contains(&object_alias) {
                        // both table created
                        from_clauses.push(format!(
                            "INNER JOIN {e2o_tbl} AS {} ON {}.ocel_object_id = {}.ocel_id AND {}.ocel_event_id = {}.ocel_id",
                            event_object_alias, event_object_alias, object_alias, event_object_alias, event_alias
                        ));
                    } else {
                        // only event table
                        from_clauses.push(format!(
                            "INNER JOIN {e2o_tbl} AS {} ON {}.ocel_event_id = {}.ocel_id",
                            event_object_alias, event_object_alias, event_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {} AS {} ON {}.ocel_object_id = {}.ocel_id",
                            object_table_sql(
                                sql_parts,
                                &type_of_object_var(sql_parts, object.0)
                            ),
                            object_alias,
                            event_object_alias,
                            object_alias
                        ));
                        sql_parts.alias_type_map.insert(
                            object_alias.clone(),
                            type_of_object_var(sql_parts, object.0),
                        );
                        sql_parts.used_keys.insert(object_alias.clone());
                    }
                } else if sql_parts.used_keys.contains(&object_alias) {
                    // only object table created
                    from_clauses.push(format!(
                        "INNER JOIN {e2o_tbl} AS {} ON {}.ocel_object_id = {}.ocel_id",
                        event_object_alias, event_object_alias, object_alias
                    ));
                    from_clauses.push(format!(
                        "INNER JOIN {} AS {} ON {}.ocel_event_id = {}.ocel_id",
                        event_table_sql(
                            sql_parts,
                            &type_of_event_var(sql_parts, event.0)
                        ),
                        event_alias,
                        event_object_alias,
                        event_alias
                    ));
                    sql_parts.alias_type_map.insert(
                        event_alias.clone(),
                        type_of_event_var(sql_parts, event.0),
                    );
                    sql_parts.used_keys.insert(event_alias.clone());
                } else {
                    // both missing
                    from_clauses.push(format!(
                        "CROSS JOIN {} AS {}",
                        event_table_sql(
                            sql_parts,
                            &type_of_event_var(sql_parts, event.0)
                        ),
                        event_alias
                    ));
                    from_clauses.push(format!(
                        "INNER JOIN {e2o_tbl} AS {} ON {}.ocel_event_id = {}.ocel_id",
                        event_object_alias, event_object_alias, event_alias
                    ));
                    from_clauses.push(format!(
                        "INNER JOIN {} AS {} ON {}.ocel_object_id = {}.ocel_id",
                        object_table_sql(
                            sql_parts,
                            &type_of_object_var(sql_parts, object.0)
                        ),
                        object_alias,
                        event_object_alias,
                        object_alias
                    ));
                    sql_parts.alias_type_map.insert(
                        object_alias.clone(),
                        type_of_object_var(sql_parts, object.0),
                    );
                    sql_parts.alias_type_map.insert(
                        event_alias.clone(),
                        type_of_event_var(sql_parts, event.0),
                    );
                    sql_parts.used_keys.insert(object_alias.clone());
                    sql_parts.used_keys.insert(event_alias.clone());
                }

                if let Some(q) = qualifier_clone {
                    sql_parts.where_clauses.push(format!(
                        "{}.{} = '{}'",
                        event_object_alias,
                        mapping::columns::OCEL_QUALIFIER,
                        q.replace('\'', "''")
                    ));
                }
            }

            Relation::O2O {
                object_1,
                object_2,
                qualifier,
            } => {
                let object1_alias = format!("O{}", o_alias(object_1.0));
                let object2_alias = format!("O{}", o_alias(object_2.0));
                let object_object_alias = sql_parts.next_alias("OR");
                let qualifier_clone = qualifier.clone();
                let o1_type = type_of_object_var(sql_parts, object_1.0);
                let o2_type = type_of_object_var(sql_parts, object_2.0);
                let o2o_tbl = o2o_table_sql(sql_parts, &o1_type, &o2_type);

                if is_first_join {
                    if sql_parts.used_keys.contains(&object1_alias) {
                        if sql_parts.used_keys.contains(&object2_alias) {
                            from_clauses.push(format!("{o2o_tbl} AS {}", object_object_alias));
                            sql_parts.where_clauses.push(format!(
                                "{}.ocel_source_id = {}.ocel_id",
                                object_object_alias, object1_alias
                            ));
                            sql_parts.where_clauses.push(format!(
                                "{}.ocel_target_id = {}.ocel_id",
                                object_object_alias, object2_alias
                            ));
                        } else {
                            from_clauses.push(format!(
                                "{} AS {}",
                                object_table_sql(
                                    sql_parts,
                                    &type_of_object_var(sql_parts, object_2.0)
                                ),
                                object2_alias
                            ));
                            from_clauses.push(format!(
                                "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_source_id = {}.ocel_id AND {}.ocel_target_id = {}.ocel_id",
                                object_object_alias, object_object_alias, object1_alias, object_object_alias, object2_alias
                            ));
                            sql_parts.alias_type_map.insert(
                                object2_alias.clone(),
                                type_of_object_var(sql_parts, object_2.0),
                            );
                            sql_parts.used_keys.insert(object2_alias.clone());
                        }
                    } else if sql_parts.used_keys.contains(&object2_alias) {
                        from_clauses.push(format!(
                            "{} AS {}",
                            object_table_sql(
                                sql_parts,
                                &type_of_object_var(sql_parts, object_1.0)
                            ),
                            object1_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_source_id = {}.ocel_id AND {}.ocel_target_id = {}.ocel_id",
                            object_object_alias, object_object_alias, object1_alias, object_object_alias, object2_alias
                        ));
                        sql_parts.alias_type_map.insert(
                            object1_alias.clone(),
                            type_of_object_var(sql_parts, object_1.0),
                        );
                        sql_parts.used_keys.insert(object1_alias.clone());
                    } else {
                        from_clauses.push(format!(
                            "{} AS {}",
                            object_table_sql(
                                sql_parts,
                                &type_of_object_var(sql_parts, object_1.0)
                            ),
                            object1_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_source_id = {}.ocel_id",
                            object_object_alias, object_object_alias, object1_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {} AS {} ON {}.ocel_target_id = {}.ocel_id",
                            object_table_sql(
                                sql_parts,
                                &type_of_object_var(sql_parts, object_2.0)
                            ),
                            object2_alias,
                            object_object_alias,
                            object2_alias
                        ));
                        sql_parts.alias_type_map.insert(
                            object1_alias.clone(),
                            type_of_object_var(sql_parts, object_1.0),
                        );
                        sql_parts.alias_type_map.insert(
                            object2_alias.clone(),
                            type_of_object_var(sql_parts, object_2.0),
                        );
                        sql_parts.used_keys.insert(object1_alias.clone());
                        sql_parts.used_keys.insert(object2_alias.clone());
                    }

                    is_first_join = false;
                } else if sql_parts.used_keys.contains(&object1_alias) {
                    if sql_parts.used_keys.contains(&object2_alias) {
                        from_clauses.push(format!(
                            "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_source_id = {}.ocel_id AND {}.ocel_target_id = {}.ocel_id",
                            object_object_alias, object_object_alias, object1_alias, object_object_alias, object2_alias
                        ));
                    } else {
                        from_clauses.push(format!(
                            "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_source_id = {}.ocel_id",
                            object_object_alias, object_object_alias, object1_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {} AS {} ON {}.ocel_target_id = {}.ocel_id",
                            object_table_sql(
                                sql_parts,
                                &type_of_object_var(sql_parts, object_2.0)
                            ),
                            object2_alias,
                            object_object_alias,
                            object2_alias
                        ));
                        sql_parts.used_keys.insert(object2_alias.clone());
                        sql_parts.alias_type_map.insert(
                            object2_alias.clone(),
                            type_of_object_var(sql_parts, object_2.0),
                        );
                    }
                } else if sql_parts.used_keys.contains(&object2_alias) {
                    from_clauses.push(format!(
                        "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_target_id = {}.ocel_id",
                        object_object_alias, object_object_alias, object2_alias
                    ));
                    from_clauses.push(format!(
                        "INNER JOIN {} AS {} ON {}.ocel_source_id = {}.ocel_id",
                        object_table_sql(
                            sql_parts,
                            &type_of_object_var(sql_parts, object_1.0)
                        ),
                        object1_alias,
                        object_object_alias,
                        object1_alias
                    ));
                    sql_parts.alias_type_map.insert(
                        object1_alias.clone(),
                        type_of_object_var(sql_parts, object_1.0),
                    );
                    sql_parts.used_keys.insert(object1_alias.clone());
                } else {
                    from_clauses.push(format!(
                        "CROSS JOIN {} AS {}",
                        object_table_sql(
                            sql_parts,
                            &type_of_object_var(sql_parts, object_1.0)
                        ),
                        object1_alias
                    ));
                    from_clauses.push(format!(
                        "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_source_id = {}.ocel_id",
                        object_object_alias, object_object_alias, object1_alias
                    ));
                    from_clauses.push(format!(
                        "INNER JOIN {} AS {} ON {}.ocel_target_id = {}.ocel_id",
                        object_table_sql(
                            sql_parts,
                            &type_of_object_var(sql_parts, object_2.0)
                        ),
                        object2_alias,
                        object_object_alias,
                        object2_alias
                    ));
                    sql_parts.alias_type_map.insert(
                        object1_alias.clone(),
                        type_of_object_var(sql_parts, object_1.0),
                    );
                    sql_parts.alias_type_map.insert(
                        object2_alias.clone(),
                        type_of_object_var(sql_parts, object_2.0),
                    );
                    sql_parts.used_keys.insert(object2_alias.clone());
                    sql_parts.used_keys.insert(object1_alias.clone());
                }

                if let Some(q) = qualifier_clone {
                    sql_parts.where_clauses.push(format!(
                        "{}.{} = '{}'",
                        object_object_alias,
                        mapping::columns::OCEL_QUALIFIER,
                        q.replace('\'', "''")
                    ));
                }
            }

            _ => {}
        }
    }

    if is_first_join {
        // Does not contain E2O or O2O
        for (obj_var, types) in &sql_parts.node.object_vars {
            for object_type in types {
                let key = format!("O{}", o_alias(obj_var.0));
                sql_parts.used_keys.insert(key.clone());
                sql_parts
                    .alias_type_map
                    .insert(key.clone(), object_type.to_string());
                from_clauses.push(format!(
                    "{} AS {}",
                    object_table_sql(sql_parts, object_type),
                    key
                ));
            }
        }

        for (event_var, types) in &sql_parts.node.event_vars {
            for event_type in types {
                let key = format!("E{}", e_alias(event_var.0));
                sql_parts.used_keys.insert(key.clone());
                sql_parts
                    .alias_type_map
                    .insert(key.clone(), event_type.to_string());
                from_clauses.push(format!(
                    "{} AS {}",
                    event_table_sql(sql_parts, event_type),
                    key
                ));
            }
        }
    } else {
        // there might be relations, but there might be object tables which are not created

        for (obj_var, types) in &sql_parts.node.object_vars {
            for object_type in types {
                let key = format!("O{}", o_alias(obj_var.0));
                if !sql_parts.used_keys.contains(&key) {
                    from_clauses.push(format!(
                        " CROSS JOIN {} AS {}",
                        object_table_sql(sql_parts, object_type),
                        key
                    ));
                    sql_parts.used_keys.insert(key.clone());
                    sql_parts
                        .alias_type_map
                        .insert(key.clone(), object_type.to_string());
                }
            }
        }

        for (event_var, types) in &sql_parts.node.event_vars {
            for event_type in types {
                let key = format!("E{}", e_alias(event_var.0));
                if !sql_parts.used_keys.contains(&key) {
                    from_clauses.push(format!(
                        " CROSS JOIN {} AS {}",
                        event_table_sql(sql_parts, event_type),
                        key
                    ));
                    sql_parts
                        .alias_type_map
                        .insert(key.clone(), event_type.to_string());
                    sql_parts.used_keys.insert(key.clone());
                }
            }
        }
    }

    from_clauses
}

/// Append TBE WHERE clauses (the only basic operation the SQL emitter
/// currently materialises in addition to the FROM-clause joins assembled
/// in [`construct_from_clauses`]). Returns the updated where-clause list;
/// the JOIN side is always empty so it is no longer returned.
pub fn construct_basic_operations(sql_parts: &mut SqlParts) -> Vec<String> {
    let mut where_clauses = sql_parts.where_clauses.clone();

    for relation in &sql_parts.node.relations {
        if let Relation::TimeBetweenEvents {
            from_event,
            to_event,
            min_seconds,
            max_seconds,
        } = relation
        {
            // For zero bounds, emit native timestamp comparison instead of
            // epoch arithmetic: index-friendly and dialect-agnostic.
            if let Some(min) = min_seconds {
                if *min == 0.0 {
                    where_clauses.push(format!(
                        "E{}.ocel_time >= E{}.ocel_time",
                        e_alias(to_event.0),
                        e_alias(from_event.0)
                    ));
                } else {
                    where_clauses.push(format!(
                        "{time_left} - {time_right} >= {min}",
                        time_left = map_timestamp_event(sql_parts, to_event.0),
                        time_right = map_timestamp_event(sql_parts, from_event.0)
                    ));
                }
            }
            if let Some(max) = max_seconds {
                if *max == 0.0 {
                    where_clauses.push(format!(
                        "E{}.ocel_time <= E{}.ocel_time",
                        e_alias(to_event.0),
                        e_alias(from_event.0)
                    ));
                } else {
                    where_clauses.push(format!(
                        "{time_left} - {time_right} <= {max}",
                        time_left = map_timestamp_event(sql_parts, to_event.0),
                        time_right = map_timestamp_event(sql_parts, from_event.0)
                    ));
                }
            }
        }
    }

    where_clauses
}

pub fn construct_childstrings(sql_parts: &SqlParts) -> Vec<(String, String)> {
    construct_childstrings_with_force(sql_parts, false)
}

/// Variant for callers (batched LATERAL, recursive subtree collection) that
/// must consume `child.satisfied` directly from the child SELECT regardless
/// of whether the parent's constraint expression references it. Forces
/// `emit_satisfied = true` on every child.
pub fn construct_childstrings_force_full(sql_parts: &SqlParts) -> Vec<(String, String)> {
    construct_childstrings_with_force(sql_parts, true)
}

fn construct_childstrings_with_force(
    sql_parts: &SqlParts,
    force_full: bool,
) -> Vec<(String, String)> {
    let mut result = Vec::new();

    for (inter_node, node_label) in &sql_parts.node.children {
        // Inline children only need to project `satisfied` / key columns when
        // a parent constraint reads them. Size-filter shortcuts (EXISTS /
        // NOT EXISTS) bypass both; COUNT / DISTINCT paths need keys but not
        // satisfied; ANY / AND / OR / NOT / SAT need satisfied but not keys.
        let needs_sat =
            force_full || parent_consumes_child_satisfied(&sql_parts.node, node_label);
        let needs_keys = force_full || parent_consumes_child_keys(&sql_parts.node, node_label);

        let mut child_sql_parts = SqlParts {
            node: inter_node.clone(),
            select_fields: vec![],
            base_from: vec![],
            where_clauses: vec![],
            child_sql: vec![],
            table_mappings: sql_parts.table_mappings,
            used_keys: sql_parts.used_keys.clone(),
            database_type: sql_parts.database_type,
            alias_type_map: sql_parts.alias_type_map.clone(),
            emit_satisfied: needs_sat,
            emit_keys: needs_keys,
        };

        let child_sql = translate_to_sql_from_child(&mut child_sql_parts);
        result.push((child_sql, node_label.clone()));
    }

    result
}

/// True iff `parent_node` carries a constraint that references
/// `child_label`'s `satisfied` column in the emitted SQL. The set of
/// satisfied-referencing constraint kinds is ANY / AND / NOT / SAT / OR.
/// Size filter constraints (NumChilds, NumChildsProj, BindingSetEqual,
/// BindingSetProjectionEqual) do not reference satisfied.
fn parent_consumes_child_satisfied(parent_node: &InterMediateNode, child_label: &str) -> bool {
    for constraint in &parent_node.constraints {
        match constraint {
            Constraint::ANY { child_names }
            | Constraint::AND { child_names }
            | Constraint::NOT { child_names }
            | Constraint::SAT { child_names }
            | Constraint::OR { child_names } => {
                if child_names.iter().any(|n| n == child_label) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

/// True iff `parent_node` carries a constraint or sizefilter that reads
/// `child_label`'s `key_e<n>` / `key_o<n>` columns. EXISTS / NOT EXISTS
/// NumChilds shortcuts ignore them; COUNT-DISTINCT / NumChildsProj /
/// BindingSetEqual / BindingSetProjectionEqual / AdvancedCEL all consume
/// them.
fn parent_consumes_child_keys(parent_node: &InterMediateNode, child_label: &str) -> bool {
    let numchilds_is_shortcut = |min: &Option<usize>, max: &Option<usize>| -> bool {
        let is_max0 = max.map_or(false, |m| m == 0) && min.map_or(true, |n| n == 0);
        let is_min1 = min.map_or(false, |n| n == 1) && max.is_none();
        is_max0 || is_min1
    };
    let sizefilter_needs_keys = |filter: &SizeFilter| -> bool {
        match filter {
            SizeFilter::NumChilds { child_name, min, max } => {
                child_name == child_label && !numchilds_is_shortcut(min, max)
            }
            SizeFilter::NumChildsProj { child_name, .. } => child_name == child_label,
            SizeFilter::BindingSetEqual { child_names } => {
                child_names.iter().any(|n| n == child_label)
            }
            SizeFilter::BindingSetProjectionEqual { child_name_with_var_name } => {
                child_name_with_var_name.iter().any(|(n, _)| n == child_label)
            }
            SizeFilter::AdvancedCEL { .. } => true,
        }
    };
    for constraint in &parent_node.constraints {
        if let Constraint::SizeFilter { filter } = constraint {
            if sizefilter_needs_keys(filter) {
                return true;
            }
        }
    }
    for filter in &parent_node.sizefilter {
        if sizefilter_needs_keys(filter) {
            return true;
        }
    }
    false
}

pub fn construct_child_constraints(sql_parts: &mut SqlParts) -> String {
    let mut result_string = Vec::new();

    // Over-approximation policy for parent-side K_C and SizeFilter constraints
    // whose referenced children's subtrees carry host-side forms (CEL / labels
    // / AdvancedCEL): the parent SQL must NOT under-estimate the parent binding
    // set, because the recursive executor only *tightens* the set host-side:
    // it cannot recover bindings the SQL already filtered out.
    //
    // Direction analysis (`+` = SQL admits more / over-estimate, safe to keep
    // or partial-drop; `-` = SQL admits fewer / under-estimate, must drop the
    // referencing clause entirely):
    //   SAT: per-child `NOT EXISTS satisfied=FALSE` joined by AND. Dropping
    //        a per-child clause is `+`. Partial-drop safe.
    //   AND: same shape as SAT. Partial-drop safe.
    //   ANY: per-child `COUNT(satisfied=TRUE) >= 1` joined by AND of OR-
    //        equivalents (each per-child clause is its own AND term wrapped
    //        in `(...AND...)`). Pushdown count >= post-CEL count, so the
    //        SQL admits the parent more readily than the in-memory engine
    //        would; KEEP all in SQL and let the host tighten.
    //   NOT: per-child `NOT EXISTS satisfied=TRUE` joined by OR. Pushdown
    //        may have satisfied rows that CEL would later drop, so each OR
    //        term is FALSE under SQL but should be TRUE post-CEL; SQL
    //        under-estimates. DROP entire if any referenced child is
    //        CEL-affected.
    //   OR:  per-child `NOT EXISTS satisfied=FALSE` joined by OR. Pushdown
    //        may have unsatisfied rows that CEL would later drop, so each
    //        OR term is FALSE under SQL but should be TRUE post-CEL; SQL
    //        under-estimates. DROP entire if any referenced child is
    //        CEL-affected.
    //
    // The host-side recursive executor re-evaluates the dropped / partially-
    // dropped constraints against post-CEL child binding sets.
    let cel_affected_child_labels: std::collections::HashSet<String> = sql_parts
        .node
        .children
        .iter()
        .filter_map(|(c, l)| {
            if crate::db_translation::row_context::subtree_has_host_side(c) {
                Some(l.clone())
            } else {
                None
            }
        })
        .collect();
    let is_cel_affected = |label: &str| -> bool { cel_affected_child_labels.contains(label) };

    // Clone the constraint list so the loop body can mutably borrow `sql_parts`
    // (e.g. via `next_alias`).
    let constraints = sql_parts.node.constraints.clone();
    for (i, constraint) in constraints.iter().enumerate() {
        match constraint {
            Constraint::ANY { child_names } => {
                // SQL is over-estimate; keep all clauses (including CEL-
                // affected references). The host re-checks ANY against
                // post-CEL counts.
                let mut parts = Vec::new();
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_names.contains(child_label) {
                        parts.push(format!(
                            "(SELECT COUNT(*) FROM ({}) AS child_{i}_{j}_{label} WHERE child_{i}_{j}_{label}.satisfied = TRUE) >= 1",
                            child_sql,
                            i = i,
                            j = j,
                            label = child_label.trim()
                        ));
                    }
                }
                if !parts.is_empty() {
                    result_string.push(format!("({})", parts.join(" AND ")));
                }
            }

            // Constraint AND ALL: partial-drop per CEL-affected child.
            Constraint::AND { child_names } => {
                let mut parts = Vec::new();
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_names.contains(child_label) && !is_cel_affected(child_label) {
                        parts.push(format!(
                            "NOT EXISTS (SELECT 1 FROM ({}) AS child_{iterator1}_{iterator2}_{label} WHERE child_{iterator1}_{iterator2}_{label}.satisfied = FALSE)",
                            child_sql,
                            iterator1 = i,
                            iterator2 = j,
                            label = child_label.trim()
                        ));
                    }
                }
                if !parts.is_empty() {
                    result_string.push(format!("({})", parts.join(" AND ")));
                }
            }
            Constraint::NOT { child_names } => {
                // In-mem semantics (structs.rs): NOT is violated when EVERY
                // listed child has at least one satisfied binding; i.e. NOT
                // holds when at least one listed child has no satisfied
                // binding. Hence the per-child clauses are joined with OR,
                // not AND. Drop entire if any referenced child is CEL-affected
                // (per-child clause is OR-joined under-estimate).
                let any_cel = child_names.iter().any(|n| is_cel_affected(n));
                if any_cel {
                    continue;
                }
                let mut parts = Vec::new();
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_names.contains(child_label) {
                        parts.push(format!(
                            "NOT EXISTS (SELECT 1 FROM ({}) AS child_{iterator1}_{iterator2}_{label} WHERE child_{iterator1}_{iterator2}_{label}.satisfied = TRUE)",
                            child_sql,
                            iterator1 = i,
                            iterator2 = j,
                            label = child_label.trim()
                        ));
                    }
                }
                if !parts.is_empty() {
                    result_string.push(format!("({})", parts.join(" OR ")));
                }
            }

            Constraint::SAT { child_names } => {
                // Partial-drop per CEL-affected child.
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_names.contains(child_label) && !is_cel_affected(child_label) {
                        result_string.push(format!(
                            "NOT EXISTS (SELECT 1 FROM ({}) AS child_{iterator1}_{iterator2}_{label} WHERE child_{iterator1}_{iterator2}_{label}.satisfied = FALSE)",
                            child_sql,
                            iterator1 = i,
                            iterator2 = j,
                            label = child_label.trim()
                        ));
                    }
                }
            }

            // Analog to AND ALl but now connect with OR. Drop entire if any
            // CEL-affected (OR-join under-estimate, same as NOT).
            Constraint::OR { child_names } => {
                let any_cel = child_names.iter().any(|n| is_cel_affected(n));
                if any_cel {
                    continue;
                }
                let mut parts = Vec::new();
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_names.contains(child_label) {
                        parts.push(format!(
                            "NOT EXISTS (SELECT 1 FROM ({}) AS child_{iterator1}_{iterator2}_{label} WHERE child_{iterator1}_{iterator2}_{label}.satisfied = FALSE)",
                            child_sql,
                            iterator1 = i,
                            iterator2 = j,
                            label = child_label.trim()
                        ));
                    }
                }
                if !parts.is_empty() {
                    result_string.push(format!("({})", parts.join(" OR ")));
                }
            }

            Constraint::SizeFilter { filter } => match filter {
                SizeFilter::NumChilds {
                    child_name,
                    min,
                    max,
                } => {
                    // CEL-affected child + max bound: SQL count is an
                    // over-count, so a strict `<= max` clause would
                    // under-permissively cull bindings the host re-check
                    // cannot recover. Drop the SQL clause; the host pass
                    // `evaluate_constraint` enforces the strict bound and
                    // labels via `ConstraintNotSatisfied`. Mirrors the
                    // free-standing relaxation in `construct_filter_non_basic`.
                    if is_cel_affected(child_name) && max.is_some() {
                        continue;
                    }
                    for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                        if child_label == child_name {
                            if max.map_or(false, |m| m == 0)
                                && min.map_or(true, |n| n == 0)
                            {
                                let _ = child_label;
                                result_string.push(format!(
                                    "NOT EXISTS ({child_sql})",
                                ));
                                continue;
                            }
                            if min.map_or(false, |n| n == 1) && max.is_none() {
                                let _ = child_label;
                                result_string.push(format!(
                                    "EXISTS ({child_sql})",
                                ));
                                continue;
                            }
                            let count_expr = num_childs_count_expr(
                                child_sql,
                                child_label,
                                &sql_parts.node.children[j].0,
                                i,
                                j,
                            );
                            let clause = match (min, max) {
                                (None, None) => continue,
                                (Some(min), Some(max)) if min == max => {
                                    format!("{count_expr} = {min}")
                                }
                                (Some(min), Some(max)) if *min == 0 => {
                                    format!("{count_expr} <= {max}")
                                }
                                (Some(min), Some(max)) => {
                                    format!("{count_expr} BETWEEN {min} AND {max}")
                                }
                                (Some(min), None) if *min == 0 => continue,
                                (Some(min), None) => format!("{count_expr} >= {min}"),
                                (None, Some(max)) => format!("{count_expr} <= {max}"),
                            };
                            result_string.push(clause);
                        }
                    }
                }
                SizeFilter::NumChildsProj {
                    child_name,
                    var_name,
                    min,
                    max,
                } => {
                    if is_cel_affected(child_name) && max.is_some() {
                        continue;
                    }
                    for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                        if child_label == child_name {
                            let label = child_label.trim();
                            let proj = var_key_col(var_name);
                            let count_expr = format!(
                                "(SELECT COUNT(DISTINCT {proj}) FROM ({child_sql}) AS childproj_{i}_{j}_{label})"
                            );
                            let clause = match (min, max) {
                                (Some(min), Some(max)) if min == max => {
                                    format!("{count_expr} = {min}")
                                }
                                (Some(min), Some(max)) => {
                                    format!("{count_expr} BETWEEN {min} AND {max}")
                                }
                                (Some(min), None) => format!("{count_expr} >= {min}"),
                                (None, Some(max)) => format!("{count_expr} <= {max}"),
                                (None, None) => continue,
                            };
                            result_string.push(clause);
                        }
                    }
                }
                SizeFilter::BindingSetEqual { child_names } => {
                    if child_names.iter().any(|n| is_cel_affected(n)) {
                        continue;
                    }
                    if let Some(clause) = emit_binding_set_equal(sql_parts, child_names, i) {
                        result_string.push(clause);
                    }
                }
                SizeFilter::BindingSetProjectionEqual {
                    child_name_with_var_name,
                } => {
                    if child_name_with_var_name
                        .iter()
                        .any(|(n, _)| is_cel_affected(n))
                    {
                        continue;
                    }
                    if let Some(clause) = emit_binding_set_projection_equal(
                        sql_parts,
                        child_name_with_var_name,
                        i,
                    ) {
                        result_string.push(clause);
                    }
                }
                SizeFilter::AdvancedCEL { .. } => {
                    // Post-processing only.
                }
            },

            Constraint::Filter { filter } => match filter {
                Filter::O2E { object, event, .. } => {
                    let alias = sql_parts.next_alias("ER");
                    let e_type = type_of_event_var(sql_parts, event.0);
                    let o_type = type_of_object_var(sql_parts, object.0);
                    let e2o_tbl = e2o_table_sql(sql_parts, &e_type, &o_type);
                    result_string.push(format!(
                            "EXISTS (SELECT 1 FROM {e2o_tbl} AS {} WHERE {}.ocel_event_id = E{}.ocel_id AND {}.ocel_object_id = O{}.ocel_id)",
                            alias, alias, e_alias(event.0), alias, o_alias(object.0)
                        ));
                }

                Filter::O2O {
                    object,
                    other_object,
                    ..
                } => {
                    let alias = sql_parts.next_alias("OR");
                    let o1_type = type_of_object_var(sql_parts, object.0);
                    let o2_type = type_of_object_var(sql_parts, other_object.0);
                    let o2o_tbl = o2o_table_sql(sql_parts, &o1_type, &o2_type);
                    result_string.push(format!(
                            "EXISTS (SELECT 1 FROM {o2o_tbl} AS {} WHERE {}.ocel_source_id = O{}.ocel_id AND {}.ocel_target_id = O{}.ocel_id)",
                            alias, alias, o_alias(object.0), alias, o_alias(other_object.0)
                        ));
                }

                Filter::TimeBetweenEvents {
                    from_event,
                    to_event,
                    min_seconds,
                    max_seconds,
                } => {
                    if let Some(min) = min_seconds {
                        result_string.push(format!(
                            "{time_left} - {time_right} >= {min}",
                            time_left = map_timestamp_event(sql_parts, to_event.0),
                            time_right = map_timestamp_event(sql_parts, from_event.0)
                        ));
                    }
                    if let Some(max) = max_seconds {
                        result_string.push(format!(
                            "{time_left} - {time_right} <= {max}",
                            time_left = map_timestamp_event(sql_parts, to_event.0),
                            time_right = map_timestamp_event(sql_parts, from_event.0)
                        ));
                    }
                }

                Filter::EventAttributeValueFilter {
                    event,
                    attribute_name,
                    value_filter,
                } => {
                    result_string.push(event_attr_value_filter_clause(
                        sql_parts,
                        event,
                        attribute_name,
                        value_filter,
                    ));
                }

                Filter::ObjectAttributeValueFilter {
                    object,
                    attribute_name,
                    at_time,
                    value_filter,
                } => {
                    result_string.push(object_attr_value_filter_clause(
                        sql_parts,
                        object,
                        attribute_name,
                        at_time,
                        value_filter,
                        i,
                    ));
                }

                Filter::NotEqual { var_1, var_2 } => {
                    result_string.push(format!(
                        "{} <> {}",
                        var_ocel_id_ref(var_1),
                        var_ocel_id_ref(var_2)
                    ));
                }

                Filter::BasicFilterCEL { .. } => {
                    // Host-side: constraint-mode CEL is evaluated by the
                    // executor over returned rows and ANDed into the
                    // per-binding satisfied label. See
                    // `constraint_cel_filters_for_post_processing` and
                    // `cel_constraints_for_labelling` in sql_executor_id.
                }
            },
        }
    }

    result_string.join(" AND ")
}

// Handling of Childs

pub fn translate_to_sql_from_child(sql_parts: &mut SqlParts) -> String {
    sql_parts.base_from = construct_from_clauses(sql_parts);
    sql_parts.where_clauses = construct_basic_operations(sql_parts);

    // Same normalized-row filter the root applies (see
    // `translate_to_sql_from_intermediate`): the OCEL `object_<type>` schema
    // stores attribute history as additional rows keyed by
    // `ocel_changed_field`, and joining them blindly multiplies child
    // bindings by the per-object snapshot count.
    for obj_var in sql_parts.node.object_vars.keys() {
        sql_parts.where_clauses.push(format!(
            "O{}.ocel_changed_field IS NULL",
            o_alias(obj_var.0)
        ));
    }

    let childs = construct_childstrings(sql_parts);
    sql_parts.child_sql = childs;

    let constraint_expr = construct_child_constraints(sql_parts);

    let filter_clauses = construct_filter_non_basic(sql_parts);
    sql_parts.where_clauses.extend(filter_clauses);

    let sub_condition = if constraint_expr.trim().is_empty() {
        "True".to_string()
    } else {
        constraint_expr
    };

    sql_parts.select_fields = {
        let mut fields = Vec::new();
        if sql_parts.emit_satisfied {
            let trimmed = sub_condition.trim();
            let sat_field = if trimmed.eq_ignore_ascii_case("true") {
                "TRUE AS satisfied".to_string()
            } else {
                format!("({sub_condition}) AS satisfied")
            };
            fields.push(sat_field);
        }
        // Expose the key columns under stable aliases; the size-filter
        // consumer derives the same alias list to compute COUNT(DISTINCT ...).
        if sql_parts.emit_keys {
            for (expr, alias) in child_key_columns(&sql_parts.node) {
                fields.push(format!("{expr} AS {alias}"));
            }
        }
        fields
    };

    construct_result_child(sql_parts)
}

pub fn construct_result_child(sql_parts: &SqlParts) -> String {
    let mut result = String::new();

    result.push_str("SELECT ");
    if sql_parts.select_fields.is_empty() {
        // Child skipped satisfied AND has no new variables: emit a
        // placeholder so the subquery is syntactically valid. Only EXISTS /
        // NOT EXISTS shortcut wraps reach this code path.
        result.push_str("1");
    } else {
        result.push_str(&sql_parts.select_fields.join(",\n"));
    }
    result.push('\n');

    if sql_parts.base_from.is_empty() {
        result.push_str("FROM (SELECT 1) as dummy ");
    } else {
        result.push_str(&format!("FROM {}\n", sql_parts.base_from.join("\n")));
    }

    if !sql_parts.where_clauses.is_empty() {
        result.push_str(&format!(
            "WHERE {}\n",
            sql_parts.where_clauses.join("\nAND ")
        ));
    }

    result
}

pub fn construct_filter_non_basic(sql_parts: &mut SqlParts) -> Vec<String> {
    let mut result = Vec::new();

    // Over-approximation policy for free-standing SizeFilter forms referencing
    // CEL-affected children (parallels `construct_child_constraints`):
    //   NumChilds / NumChildsProj: keep iff `max` is `None` (count >= min
    //       is over-estimate-safe). Drop entirely when `max` is set: post-CEL
    //       count may fall into [min, max] even though pre-CEL exceeded `max`,
    //       so the SQL would under-estimate.
    //   BindingSetEqual / BindingSetProjectionEqual: drop entirely; equality
    //       can change either way under CEL.
    let is_cel_affected_label = |label: &str| -> bool {
        sql_parts.node.children.iter().any(|(c, l)| {
            l == label && crate::db_translation::row_context::subtree_has_host_side(c)
        })
    };

    for (i, sizefilter) in sql_parts.node.sizefilter.iter().enumerate() {
        match sizefilter {
            SizeFilter::NumChilds {
                child_name,
                min,
                max,
            } => {
                if is_cel_affected_label(child_name) && max.is_some() {
                    continue;
                }
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_label == child_name {
                        let _ = (i, j);
                        if max.map_or(false, |m| m == 0) && min.map_or(true, |n| n == 0) {
                            result.push(format!("NOT EXISTS ({child_sql})"));
                            continue;
                        }
                        if min.map_or(false, |n| n == 1) && max.is_none() {
                            result.push(format!("EXISTS ({child_sql})"));
                            continue;
                        }
                        let count_expr = num_childs_count_expr(
                            child_sql,
                            child_label,
                            &sql_parts.node.children[j].0,
                            i,
                            j,
                        );
                        let clause = match (min, max) {
                            (Some(min), Some(max)) => {
                                format!("{count_expr} BETWEEN {min} AND {max}")
                            }
                            (Some(min), None) => format!("{count_expr} >= {min}"),
                            (None, Some(max)) => format!("{count_expr} <= {max}"),
                            (None, None) => continue,
                        };
                        result.push(clause);
                    }
                }
            }
            SizeFilter::NumChildsProj {
                child_name,
                var_name,
                min,
                max,
            } => {
                if is_cel_affected_label(child_name) && max.is_some() {
                    continue;
                }
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_label == child_name {
                        let label = child_label.trim();
                        let proj = var_key_col(var_name);
                        let count_expr = format!(
                            "(SELECT COUNT(DISTINCT {proj}) FROM ({child_sql}) AS childproj_{i}_{j}_{label})"
                        );
                        let clause = match (min, max) {
                            (Some(min), Some(max)) => {
                                format!("{count_expr} BETWEEN {min} AND {max}")
                            }
                            (Some(min), None) => format!("{count_expr} >= {min}"),
                            (None, Some(max)) => format!("{count_expr} <= {max}"),
                            (None, None) => continue,
                        };
                        result.push(clause);
                    }
                }
            }
            SizeFilter::BindingSetEqual { child_names } => {
                if child_names.iter().any(|n| is_cel_affected_label(n)) {
                    continue;
                }
                if let Some(clause) = emit_binding_set_equal(sql_parts, child_names, i) {
                    result.push(clause);
                }
            }
            SizeFilter::BindingSetProjectionEqual {
                child_name_with_var_name,
            } => {
                if child_name_with_var_name
                    .iter()
                    .any(|(n, _)| is_cel_affected_label(n))
                {
                    continue;
                }
                if let Some(clause) =
                    emit_binding_set_projection_equal(sql_parts, child_name_with_var_name, i)
                {
                    result.push(clause);
                }
            }
            SizeFilter::AdvancedCEL { .. } => {
                // Post-processing only. Skipped by the SQL emitter and applied
                // host-side by the two-phase executor (see sql_executor).
            }
        }
    }

    for (i, filter) in sql_parts.node.filter.iter().enumerate() {
        match filter {
            Filter::EventAttributeValueFilter {
                event,
                attribute_name,
                value_filter,
            } => {
                result.push(event_attr_value_filter_clause(
                    sql_parts,
                    event,
                    attribute_name,
                    value_filter,
                ));
            }

            Filter::ObjectAttributeValueFilter {
                object,
                attribute_name,
                at_time,
                value_filter,
            } => {
                result.push(object_attr_value_filter_clause(
                    sql_parts,
                    object,
                    attribute_name,
                    at_time,
                    value_filter,
                    i,
                ));
            }

            Filter::NotEqual { var_1, var_2 } => {
                result.push(format!(
                    "{} <> {}",
                    var_ocel_id_ref(var_1),
                    var_ocel_id_ref(var_2)
                ));
            }

            _ => {}
        }
    }

    result
}

/// Build the SQL boolean clause for an `EventAttributeValueFilter`.
///
/// The result references the outer event alias `E{n}` directly; it does not
/// wrap the predicate in an EXISTS subquery because event attribute history
/// is not represented in the OCEL SQLite/DuckDB schema (events are immutable).
fn event_attr_value_filter_clause(
    sql_parts: &SqlParts,
    event: &EventVariable,
    attribute_name: &str,
    value_filter: &ValueFilter,
) -> String {
    let col = format!("E{}.\"{}\"", e_alias(event.0), attribute_name);
    match value_filter {
        ValueFilter::String { is_in } => {
            let values = is_in
                .iter()
                .map(|v| format!("'{}'", v.replace('\'', "''")))
                .collect::<Vec<_>>()
                .join(", ");
            format!("{} IN ({})", col, values)
        }
        ValueFilter::Boolean { is_true } => format!("{} = {}", col, is_true),
        ValueFilter::Integer { min, max } => {
            let mut parts = vec![];
            if let Some(min) = min {
                parts.push(format!("{} >= {}", col, min));
            }
            if let Some(max) = max {
                parts.push(format!("{} <= {}", col, max));
            }
            if parts.is_empty() { "TRUE".to_string() } else { parts.join(" AND ") }
        }
        ValueFilter::Float { min, max } => {
            let mut parts = vec![];
            if let Some(min) = min {
                parts.push(format!("{} >= {}", col, min));
            }
            if let Some(max) = max {
                parts.push(format!("{} <= {}", col, max));
            }
            if parts.is_empty() { "TRUE".to_string() } else { parts.join(" AND ") }
        }
        ValueFilter::Time { from, to } => {
            let mut parts = vec![];
            let ts = map_timestamp(sql_parts, col.clone());
            if let Some(from) = from {
                parts.push(format!("{ts} >= '{from}'"));
            }
            if let Some(to) = to {
                parts.push(format!("{ts} <= '{to}'"));
            }
            if parts.is_empty() { "TRUE".to_string() } else { parts.join(" AND ") }
        }
    }
}

/// Build the SQL boolean clause for an `ObjectAttributeValueFilter`.
///
/// `iter_id` must be unique per call within the enclosing `SqlParts` so the
/// per-filter `OA{n}` and `OA2{n}` subquery aliases don't collide. Object
/// attributes change over time in the OCEL schema (one row per snapshot in
/// `object_<type>`), so the predicate is wrapped in an EXISTS/NOT EXISTS
/// subquery according to `at_time`.
fn object_attr_value_filter_clause(
    sql_parts: &SqlParts,
    object: &ObjectVariable,
    attribute_name: &str,
    at_time: &ObjectValueFilterTimepoint,
    value_filter: &ValueFilter,
    iter_id: usize,
) -> String {
    let object_alias = format!("O{}", o_alias(object.0));
    let attr = attribute_name;
    let temp_alias = format!("OA{}", iter_id);
    // The condition refers to the EXISTS subquery alias `OA{iter_id}` so it
    // checks every snapshot of the object for `Sometime`/`Always` semantics
    // (and the latest snapshot before the event for `AtEvent`).
    let value_sql = match value_filter {
        ValueFilter::String { is_in } => {
            let values = is_in
                .iter()
                .map(|v| format!("'{}'", v.replace('\'', "''")))
                .collect::<Vec<_>>()
                .join(", ");
            format!("{}.\"{}\" IN ({})", temp_alias, attr, values)
        }
        ValueFilter::Boolean { is_true } => {
            format!("{}.\"{}\" = {}", temp_alias, attr, is_true)
        }
        ValueFilter::Integer { min, max } => {
            let mut parts = vec![];
            if let Some(min) = min {
                parts.push(format!("{}.\"{}\" >= {}", temp_alias, attr, min));
            }
            if let Some(max) = max {
                parts.push(format!("{}.\"{}\" <= {}", temp_alias, attr, max));
            }
            if parts.is_empty() { "TRUE".to_string() } else { parts.join(" AND ") }
        }
        ValueFilter::Float { min, max } => {
            let mut parts = vec![];
            if let Some(min) = min {
                parts.push(format!("{}.\"{}\" >= {}", temp_alias, attr, min));
            }
            if let Some(max) = max {
                parts.push(format!("{}.\"{}\" <= {}", temp_alias, attr, max));
            }
            if parts.is_empty() { "TRUE".to_string() } else { parts.join(" AND ") }
        }
        ValueFilter::Time { from, to } => {
            let mut parts = vec![];
            let ts = map_timestamp(sql_parts, format!("{}.\"{}\"", temp_alias, attr));
            if let Some(from) = from {
                parts.push(format!(
                    "{ts} >= {time_right}",
                    time_right = map_timestamp(sql_parts, format!("'{from}'")),
                ));
            }
            if let Some(to) = to {
                parts.push(format!(
                    "{ts} <= {time_right}",
                    time_right = map_timestamp(sql_parts, format!("'{to}'")),
                ));
            }
            if parts.is_empty() { "TRUE".to_string() } else { parts.join(" AND ") }
        }
    };

    let mut object_type = "";
    for (obj_var, types) in &sql_parts.node.object_vars {
        for object_typer in types {
            if obj_var.0 == object.0 {
                object_type = object_typer;
            }
        }
    }
    if object_type.is_empty() {
        // alias_type_map is keyed by `o_alias`-formatted aliases ("O{n+1}").
        object_type = &sql_parts.alias_type_map[&object_alias];
    }
    let otype = object_table_sql(sql_parts, object_type);
    let oid = format!("{}.ocel_id", object_alias);

    // NULL attribute values are not permitted by the OCEL 2.0 spec; SQL
    // three-valued logic on NULL columns is therefore not normalized here.
    match at_time {
        ObjectValueFilterTimepoint::Sometime => format!(
            "EXISTS (SELECT 1 FROM {otype} AS OA{iter_id} WHERE OA{iter_id}.ocel_id = {oid} AND {value_sql})",
        ),
        ObjectValueFilterTimepoint::Always => format!(
            "NOT EXISTS (SELECT 1 FROM {otype} AS OA{iter_id} WHERE OA{iter_id}.ocel_id = {oid} AND NOT ({value_sql}))",
        ),
        ObjectValueFilterTimepoint::AtEvent { event } => {
            let event_time = format!("E{}.ocel_time", e_alias(event.0));
            let time_left = map_timestamp(sql_parts, format!("OA2{iter_id}.ocel_time"));
            let time_right = map_timestamp(sql_parts, event_time);
            format!(
                "EXISTS (SELECT 1 FROM {otype} AS OA{iter_id} WHERE OA{iter_id}.ocel_id = {oid} AND OA{iter_id}.ocel_time = (SELECT MAX(OA2{iter_id}.ocel_time) FROM {otype} AS OA2{iter_id} WHERE OA2{iter_id}.ocel_id = {oid} AND {time_left} <= {time_right}) AND {value_sql})",
            )
        }
    }
}

/// Build the FROM-clause source for an OCEL object type (no alias).
/// Consults the per-type spec in `table_mappings`; if the spec is at the
/// OCEL passthrough default, the result is the bare quoted table name,
/// otherwise it's a parenthesized subquery that renames source columns to
/// the OCEL-standard names the rest of the emitter references.
pub fn object_table_sql(sql_parts: &SqlParts, object_type: &str) -> String {
    sql_parts
        .table_mappings
        .object_spec(object_type)
        .source_sql(true)
}

/// Same as [`object_table_sql`] for OCEL event types.
pub fn event_table_sql(sql_parts: &SqlParts, event_type: &str) -> String {
    sql_parts
        .table_mappings
        .event_spec(event_type)
        .source_sql(false)
}

/// FROM-clause source for the E2O junction connecting a given
/// (event_type, object_type) pair.
pub fn e2o_table_sql(sql_parts: &SqlParts, event_type: &str, object_type: &str) -> String {
    sql_parts
        .table_mappings
        .e2o_spec(event_type, object_type)
        .source_sql(JunctionKind::E2O)
}

/// FROM-clause source for the O2O junction connecting a given
/// (object_type, object_type) pair.
pub fn o2o_table_sql(
    sql_parts: &SqlParts,
    object_type_1: &str,
    object_type_2: &str,
) -> String {
    sql_parts
        .table_mappings
        .o2o_spec(object_type_1, object_type_2)
        .source_sql(JunctionKind::O2O)
}

pub fn map_timestamp_event(sql_parts: &SqlParts, event_count: usize) -> String {
    match sql_parts.database_type {
        // (julianday - 2440587.5) * 86400 yields fractional epoch seconds;
        // strftime('%s', ...) truncates to integer seconds and diverges from
        // DuckDB EPOCH / PG EXTRACT(EPOCH) on sub-second timestamps.
        DatabaseType::SQLite => {
            format!(
                "(julianday(E{0}.ocel_time) - 2440587.5) * 86400",
                e_alias(event_count)
            )
        }
        DatabaseType::DuckDB => {
            format!("EPOCH(E{}.ocel_time)", e_alias(event_count))
        }
        DatabaseType::PostgreSQL => {
            format!("EXTRACT(EPOCH FROM E{}.ocel_time)", e_alias(event_count))
        }
    }
}

pub fn map_timestamp(sql_parts: &SqlParts, alias: String) -> String {
    match sql_parts.database_type {
        DatabaseType::SQLite => format!("(julianday({}) - 2440587.5) * 86400", alias),
        DatabaseType::DuckDB => format!("EPOCH({})", alias),
        DatabaseType::PostgreSQL => format!("EXTRACT(EPOCH FROM {})", alias),
    }
}

// Cypher Translation

pub struct CypherParts<'a> {
    node: InterMediateNode,
    match_clauses: Vec<String>,
    child_queries: Vec<(String, String)>,
    where_clauses: Vec<String>,
    return_clauses: Vec<String>,
    used_alias: HashSet<String>,
    table_mappings: &'a TableMappings,
    alias_type: HashMap<String, String>,
}

/// Translate a `BindingBoxTree` to a Cypher query.
///
/// `table_mappings` is used to map OCEL event/object type names to the labels
/// used in the target graph database. For types absent from the mappings the
/// raw type name is used unchanged.
pub fn translate_to_cypher_shared(tree: BindingBoxTree, table_mappings: &TableMappings) -> String {
    let inter = convert_to_intermediate(tree);

    let mut cypher_parts = CypherParts {
        node: inter,
        match_clauses: vec![],
        child_queries: vec![],
        where_clauses: vec![],
        return_clauses: vec![],
        used_alias: HashSet::new(),
        table_mappings,
        alias_type: HashMap::new(),
    };

    convert_to_cypher_from_inter(&mut cypher_parts)
}

// For root node in particular
pub fn convert_to_cypher_from_inter(cypher_parts: &mut CypherParts) -> String {
    construct_match_clauses(cypher_parts);
    construct_childstrings_cypher(cypher_parts);
    construct_filter_clauses(cypher_parts);
    construct_return_clauses(cypher_parts);
    construct_result_cypher(cypher_parts)
}

// Start with E2O and O2O
pub fn construct_match_clauses(cypher_parts: &mut CypherParts) {
    for relation in &cypher_parts.node.relations {
        match relation {
            Relation::E2O {
                event,
                object,
                qualifier: _,
            } => {
                let event_alias = format!("e{}", e_alias(event.0));
                let object_alias = format!("o{}", o_alias(object.0));

                let event_object_alias = "E2O".to_string();

                let event_type = get_event_type(cypher_parts.node.clone(), event.0);
                let object_type = get_object_type(cypher_parts.node.clone(), object.0);

                // Resolve labels via the user-supplied TableMappings; fall back to
                // the alias_type recorded by an earlier match clause when the type
                // cannot be derived from the local node (variable inherited from
                // outer scope).
                let mut mapped_event_type = cypher_parts
                    .table_mappings
                    .event_label(&event_type)
                    .to_string();
                if mapped_event_type == event_type && event_type == "no type found event" {
                    mapped_event_type = cypher_parts
                        .alias_type
                        .get(&event_alias)
                        .cloned()
                        .unwrap_or_else(|| "unknown".to_string());
                }

                let mut mapped_object_type = cypher_parts
                    .table_mappings
                    .object_label(&object_type)
                    .to_string();
                if mapped_object_type == object_type && object_type == "no type found object" {
                    mapped_object_type = cypher_parts
                        .alias_type
                        .get(&object_alias)
                        .cloned()
                        .unwrap_or_else(|| "unknown".to_string());
                }

                cypher_parts.used_alias.insert(event_alias.clone());
                cypher_parts.used_alias.insert(object_alias.clone());

                cypher_parts
                    .alias_type
                    .insert(event_alias.clone(), mapped_event_type.to_string());
                cypher_parts
                    .alias_type
                    .insert(object_alias.clone(), mapped_object_type.to_string());

                cypher_parts.match_clauses.push(format!("({event_alias}:{mapped_event_type})-[:{event_object_alias}]->({object_alias}:{mapped_object_type})", 
            ));
            }

            Relation::O2O {
                object_1,
                object_2,
                qualifier: _,
            } => {
                let object1_alias = format!("o{}", o_alias(object_1.0));
                let object2_alias = format!("o{}", o_alias(object_2.0));

                let object_object_alias = "O2O".to_string();

                let object1_type = get_object_type(cypher_parts.node.clone(), object_1.0);
                let object2_type = get_object_type(cypher_parts.node.clone(), object_2.0);

                let mut mapped_object1_type = cypher_parts
                    .table_mappings
                    .object_label(&object1_type)
                    .to_string();
                if mapped_object1_type == object1_type && object1_type == "no type found object" {
                    mapped_object1_type = cypher_parts
                        .alias_type
                        .get(&object1_alias)
                        .cloned()
                        .unwrap_or_else(|| "unknown".to_string());
                }

                let mut mapped_object2_type = cypher_parts
                    .table_mappings
                    .object_label(&object2_type)
                    .to_string();
                if mapped_object2_type == object2_type && object2_type == "no type found object" {
                    mapped_object2_type = cypher_parts
                        .alias_type
                        .get(&object2_alias)
                        .cloned()
                        .unwrap_or_else(|| "unknown".to_string());
                }

                cypher_parts.used_alias.insert(object1_alias.clone());
                cypher_parts.used_alias.insert(object2_alias.clone());

                cypher_parts
                    .alias_type
                    .insert(object1_alias.clone(), mapped_object1_type.clone());
                cypher_parts
                    .alias_type
                    .insert(object2_alias.clone(), mapped_object2_type.clone());

                cypher_parts.match_clauses.push(format!(
                    "({object1_alias}:{mapped_object1_type})-[:{object_object_alias}]->({object2_alias}:{mapped_object2_type})"
                ));
            }

            _ => {}
        }
    }

    // Check for Variables which are not included in a Relation

    for (obj_var, types) in &cypher_parts.node.object_vars {
        for object_type in types {
            let key = format!("o{}", o_alias(obj_var.0));
            if !cypher_parts.used_alias.contains(&key) {
                let mapped = cypher_parts
                    .table_mappings
                    .object_label(object_type)
                    .to_string();
                cypher_parts
                    .match_clauses
                    .push(format!("({}:{})", key, mapped));
                cypher_parts.used_alias.insert(key.clone());
                cypher_parts.alias_type.insert(key, mapped);
            }
        }
    }

    for (event_var, types) in &cypher_parts.node.event_vars {
        for event_type in types {
            let key = format!("e{}", e_alias(event_var.0));
            if !cypher_parts.used_alias.contains(&key) {
                let mapped = cypher_parts
                    .table_mappings
                    .event_label(event_type)
                    .to_string();
                cypher_parts
                    .match_clauses
                    .push(format!("({}:{})", key, mapped));
                cypher_parts.used_alias.insert(key.clone());
                cypher_parts.alias_type.insert(key, mapped);
            }
        }
    }
}

// Construct return clauses
pub fn construct_return_clauses(cypher_parts: &mut CypherParts) {
    for obj_var in cypher_parts.node.object_vars.keys() {
        cypher_parts
            .return_clauses
            .push(format!("o{}.id", o_alias(obj_var.0)));
    }

    for event_var in cypher_parts.node.event_vars.keys() {
        cypher_parts
            .return_clauses
            .push(format!("e{}.id", e_alias(event_var.0)));
    }
}

pub fn construct_result_cypher(cypher_parts: &mut CypherParts) -> String {
    let mut result = String::new();

    //  MATCH
    if !cypher_parts.match_clauses.is_empty() {
        result.push_str("MATCH ");
        result.push_str(&cypher_parts.match_clauses.join(", "));
        result.push('\n');
    }
    //  WHERE
    if !cypher_parts.where_clauses.is_empty() {
        result.push_str(&format!(
            "WHERE {}\n",
            cypher_parts.where_clauses.join(" AND ")
        ));
    }

    //  RETURN
    result.push_str(&format!("RETURN {}", cypher_parts.return_clauses.join(",")));
    result
}

pub fn construct_filter_clauses(cypher_parts: &mut CypherParts) {
    for sizefilter in cypher_parts.node.sizefilter.iter() {
        if let SizeFilter::NumChilds {
            child_name,
            min,
            max,
        } = sizefilter
        {
            for (child_cypher, child_label) in cypher_parts.child_queries.iter() {
                if child_label == child_name {
                    let clause = match (min, max) {
                        (Some(min), Some(max)) => format!("BETWEEN {min} AND {max}"),
                        (Some(min), None) => format!(">= {min}"),
                        (None, Some(max)) => format!("<= {max}"),
                        (None, None) => continue,
                    };

                    cypher_parts
                        .where_clauses
                        .push(format!("COUNT {{{child_cypher}}} {clause}"));
                }
            }
        }
    }

    for filter in &cypher_parts.node.relations {
        if let Relation::TimeBetweenEvents {
            from_event,
            to_event,
            min_seconds,
            max_seconds,
        } = filter
        {
            let alias_eventto = format!("e{}", e_alias(to_event.0));
            let alias_eventfrom = format!("e{}", e_alias(from_event.0));

            if let Some(min) = min_seconds {
                cypher_parts.where_clauses.push(format!(
                    "{alias_eventto}.time >= {alias_eventfrom}.time + INTERVAL('{min} SECONDS')",
                ));
            }

            if let Some(max) = max_seconds {
                cypher_parts.where_clauses.push(format!(
                    "{alias_eventto}.time <= {alias_eventfrom}.time + INTERVAL('{max} SECONDS')"
                ));
            }
        }
    }
}

pub fn construct_childstrings_cypher(cypher_parts: &mut CypherParts) {
    for (inter_node, node_label) in &cypher_parts.node.children {
        let mut child_cypher_parts = CypherParts {
            node: inter_node.clone(),
            match_clauses: vec![],
            child_queries: vec![],
            return_clauses: vec![],
            where_clauses: vec![],
            table_mappings: cypher_parts.table_mappings,
            used_alias: cypher_parts.used_alias.clone(),
            alias_type: cypher_parts.alias_type.clone(),
        };

        let child_cypher = translate_to_cypher_from_child(&mut child_cypher_parts);
        cypher_parts
            .child_queries
            .push((child_cypher, node_label.clone()));
    }
}

pub fn translate_to_cypher_from_child(cypher_parts: &mut CypherParts) -> String {
    construct_match_clauses(cypher_parts);
    construct_childstrings_cypher(cypher_parts);
    construct_filter_clauses(cypher_parts);
    construct_result_child_cypher(cypher_parts)
}

pub fn construct_result_child_cypher(cypher_parts: &mut CypherParts) -> String {
    let mut result = String::new();

    //  MATCH
    if !cypher_parts.match_clauses.is_empty() {
        result.push_str("MATCH ");
        result.push_str(&cypher_parts.match_clauses.join(", "));
        result.push('\n');
    }

    //  WHERE
    if !cypher_parts.where_clauses.is_empty() {
        result.push_str(&format!(
            "WHERE {}\n",
            cypher_parts.where_clauses.join(" AND ")
        ));
    }

    //  RETURN

    if !cypher_parts.return_clauses.is_empty() {
        result.push_str(&format!("RETURN {}", cypher_parts.return_clauses.join(",")));
    }

    result
}

#[cfg(test)]
mod cel_gate_tests {
    use super::*;
    use crate::binding_box::structs::{BindingBox, BindingBoxTreeNode, LabelFunction};
    use std::collections::HashMap;

    fn tree_with_filter(filter: Filter) -> BindingBoxTree {
        BindingBoxTree {
            nodes: vec![BindingBoxTreeNode::Box(
                BindingBox {
                    filters: vec![filter],
                    ..Default::default()
                },
                vec![],
            )],
            edge_names: HashMap::default(),
        }
    }

    fn tree_with_size_filter(sf: SizeFilter) -> BindingBoxTree {
        BindingBoxTree {
            nodes: vec![BindingBoxTreeNode::Box(
                BindingBox {
                    size_filters: vec![sf],
                    ..Default::default()
                },
                vec![],
            )],
            edge_names: HashMap::default(),
        }
    }

    fn tree_with_label(label_fun: LabelFunction) -> BindingBoxTree {
        BindingBoxTree {
            nodes: vec![BindingBoxTreeNode::Box(
                BindingBox {
                    labels: vec![label_fun],
                    ..Default::default()
                },
                vec![],
            )],
            edge_names: HashMap::default(),
        }
    }

    #[test]
    fn rejects_events_builtin_in_basic_filter_cel() {
        let tree = tree_with_filter(Filter::BasicFilterCEL {
            cel: "size(events()) > 0".to_string(),
        });
        let errs = validate_translatable(&tree).unwrap_err();
        assert!(matches!(
            errs[0],
            TranslationError::UnsupportedCelBuiltin { builtin: "events()", .. }
        ));
    }

    #[test]
    fn rejects_objects_builtin_in_basic_filter_cel() {
        let tree = tree_with_filter(Filter::BasicFilterCEL {
            cel: "size(objects()) > 0".to_string(),
        });
        let errs = validate_translatable(&tree).unwrap_err();
        assert!(matches!(
            errs[0],
            TranslationError::UnsupportedCelBuiltin { builtin: "objects()", .. }
        ));
    }

    #[test]
    fn rejects_events_builtin_in_advanced_cel_size_filter() {
        let tree = tree_with_size_filter(SizeFilter::AdvancedCEL {
            cel: "events().size() == 0".to_string(),
        });
        let errs = validate_translatable(&tree).unwrap_err();
        assert_eq!(errs.len(), 1);
        match &errs[0] {
            TranslationError::UnsupportedCelBuiltin {
                builtin,
                location,
                ..
            } => {
                assert_eq!(*builtin, "events()");
                assert_eq!(*location, "AdvancedCEL size-filter");
            }
            other => panic!("unexpected error variant: {other:?}"),
        }
    }

    #[test]
    fn rejects_objects_builtin_in_label_function() {
        let tree = tree_with_label(LabelFunction {
            label: "count_obj".to_string(),
            cel: "size(objects())".to_string(),
        });
        let errs = validate_translatable(&tree).unwrap_err();
        match &errs[0] {
            TranslationError::UnsupportedCelBuiltin {
                builtin,
                location,
                ..
            } => {
                assert_eq!(*builtin, "objects()");
                assert_eq!(*location, "LabelFunction body");
            }
            other => panic!("unexpected error variant: {other:?}"),
        }
    }

    #[test]
    fn accepts_num_events_and_num_objects_builtins() {
        // The gate must not reject `numEvents()` / `numObjects()`: the dot-method
        // forms are part of the supported row-context surface (they reduce to
        // counts the SQL backend can already populate via SizeFilter rewrites).
        let tree = tree_with_filter(Filter::BasicFilterCEL {
            cel: "numEvents() > 0 && numObjects() < 5".to_string(),
        });
        assert!(validate_translatable(&tree).is_ok());
    }

    #[test]
    fn accepts_cel_without_unsupported_builtins() {
        let tree = tree_with_filter(Filter::BasicFilterCEL {
            cel: "e1.attr(\"amount\") > 100".to_string(),
        });
        assert!(validate_translatable(&tree).is_ok());
    }

    #[test]
    fn whole_token_matcher_rejects_events_with_whitespace_before_paren() {
        // `events ()` is not valid CEL syntactically but our matcher tolerates
        // whitespace defensively; ensure that path still triggers a reject.
        let tree = tree_with_filter(Filter::BasicFilterCEL {
            cel: "events () != 0".to_string(),
        });
        let errs = validate_translatable(&tree).unwrap_err();
        assert!(matches!(
            errs[0],
            TranslationError::UnsupportedCelBuiltin { builtin: "events()", .. }
        ));
    }

    #[test]
    fn intermediate_node_carries_label_functions() {
        // Sanity: a BindingBox with a LabelFunction should propagate to
        // `InterMediateNode.labels` so the sql_executor can pick it up.
        let lf = LabelFunction {
            label: "L".to_string(),
            cel: "1 + 1".to_string(),
        };
        let tree = tree_with_label(lf.clone());
        let inter = convert_to_intermediate(tree);
        assert_eq!(inter.labels.len(), 1);
        assert_eq!(inter.labels[0].label, "L");
        assert_eq!(inter.labels[0].cel, "1 + 1");
    }

    /// Build a 2-node tree where node 0 is the root and node 1 is its child.
    /// The child's BindingBox carries the supplied predicates.
    fn parent_child_tree(child: BindingBox) -> BindingBoxTree {
        let root = BindingBox::default();
        let mut edges = HashMap::default();
        edges.insert((0usize, 1usize), "c".to_string());
        BindingBoxTree {
            nodes: vec![
                BindingBoxTreeNode::Box(root, vec![1]),
                BindingBoxTreeNode::Box(child, vec![]),
            ],
            edge_names: edges,
        }
    }

    #[test]
    fn accepts_non_root_basic_filter_cel() {
        // The recursive host-side executor evaluates BasicFilterCEL at any
        // depth; the validator must let it through.
        let child = BindingBox {
            filters: vec![Filter::BasicFilterCEL {
                cel: "e1.attr(\"amount\") > 100".to_string(),
            }],
            ..Default::default()
        };
        let tree = parent_child_tree(child);
        assert!(validate_translatable(&tree).is_ok());
    }

    #[test]
    fn accepts_non_root_advanced_cel() {
        let child = BindingBox {
            size_filters: vec![SizeFilter::AdvancedCEL {
                cel: "true".to_string(),
            }],
            ..Default::default()
        };
        let tree = parent_child_tree(child);
        assert!(validate_translatable(&tree).is_ok());
    }

    #[test]
    fn accepts_non_root_event_attribute_value_filter() {
        // EventAttributeValueFilter is pushdown in `construct_filter_non_basic`,
        // so it works at any depth without recursion.
        use crate::binding_box::structs::ValueFilter;
        let child = BindingBox {
            filters: vec![Filter::EventAttributeValueFilter {
                event: EventVariable(0),
                attribute_name: "amount".to_string(),
                value_filter: ValueFilter::Boolean { is_true: true },
            }],
            ..Default::default()
        };
        let tree = parent_child_tree(child);
        assert!(validate_translatable(&tree).is_ok());
    }

    #[test]
    fn accepts_non_root_object_attribute_value_filter() {
        use crate::binding_box::structs::{ObjectValueFilterTimepoint, ValueFilter};
        let child = BindingBox {
            filters: vec![Filter::ObjectAttributeValueFilter {
                object: ObjectVariable(0),
                attribute_name: "status".to_string(),
                at_time: ObjectValueFilterTimepoint::Sometime,
                value_filter: ValueFilter::Boolean { is_true: true },
            }],
            ..Default::default()
        };
        let tree = parent_child_tree(child);
        assert!(validate_translatable(&tree).is_ok());
    }

    #[test]
    fn accepts_non_root_label_function() {
        let child = BindingBox {
            labels: vec![LabelFunction {
                label: "L".to_string(),
                cel: "1 + 1".to_string(),
            }],
            ..Default::default()
        };
        let tree = parent_child_tree(child);
        assert!(validate_translatable(&tree).is_ok());
    }

    #[test]
    fn accepts_two_level_basic_filter_cel() {
        // root -> A -> B, both A and B carry BasicFilterCEL. The recursive
        // executor evaluates B first, then uses B's post-CEL survivors to
        // re-check A, then root. Validator must accept.
        let mut edges: HashMap<(usize, usize), String> = HashMap::default();
        edges.insert((0, 1), "A".to_string());
        edges.insert((1, 2), "B".to_string());
        let a = BindingBox {
            filters: vec![Filter::BasicFilterCEL {
                cel: "true".to_string(),
            }],
            ..Default::default()
        };
        let b = BindingBox {
            filters: vec![Filter::BasicFilterCEL {
                cel: "true".to_string(),
            }],
            ..Default::default()
        };
        let tree = BindingBoxTree {
            nodes: vec![
                BindingBoxTreeNode::Box(BindingBox::default(), vec![1]),
                BindingBoxTreeNode::Box(a, vec![2]),
                BindingBoxTreeNode::Box(b, vec![]),
            ],
            edge_names: edges,
        };
        assert!(validate_translatable(&tree).is_ok());
    }

    #[test]
    fn accepts_root_only_host_side_forms() {
        // Root-level BasicFilterCEL + AdvancedCEL + LabelFunction must still
        // pass; only non-root placements are rejected.
        let mut edges = HashMap::default();
        edges.insert((0usize, 1usize), "c".to_string());
        let root = BindingBox {
            filters: vec![Filter::BasicFilterCEL {
                cel: "true".to_string(),
            }],
            size_filters: vec![SizeFilter::AdvancedCEL {
                cel: "true".to_string(),
            }],
            labels: vec![LabelFunction {
                label: "L".to_string(),
                cel: "1".to_string(),
            }],
            ..Default::default()
        };
        let tree = BindingBoxTree {
            nodes: vec![
                BindingBoxTreeNode::Box(root, vec![1]),
                BindingBoxTreeNode::Box(BindingBox::default(), vec![]),
            ],
            edge_names: edges,
        };
        assert!(validate_translatable(&tree).is_ok());
    }

    #[test]
    fn batched_emitter_produces_lateral_shape() {
        // Build a minimal tree:
        //   root: event var E1 of type "E1_type"
        //   child "c": event var E2 of type "E2_type"
        // Root carries AdvancedCEL referencing child label "c".
        let mut root_ev: NewEventVariables = HashMap::default();
        let mut hs1: HashSet<String> = HashSet::new();
        hs1.insert("E1_type".to_string());
        root_ev.insert(EventVariable(0), hs1);

        let mut child_ev: NewEventVariables = HashMap::default();
        let mut hs2: HashSet<String> = HashSet::new();
        hs2.insert("E2_type".to_string());
        child_ev.insert(EventVariable(1), hs2);

        let root_bb = BindingBox {
            new_event_vars: root_ev,
            size_filters: vec![SizeFilter::AdvancedCEL {
                cel: "size(c) > 0".to_string(),
            }],
            ..Default::default()
        };
        let child_bb = BindingBox {
            new_event_vars: child_ev,
            ..Default::default()
        };
        let mut edges: HashMap<(usize, usize), String> = HashMap::default();
        edges.insert((0, 1), "c".to_string());

        let tree = BindingBoxTree {
            nodes: vec![
                BindingBoxTreeNode::Box(root_bb, vec![1]),
                BindingBoxTreeNode::Box(child_bb, vec![]),
            ],
            edge_names: edges,
        };

        let input = DBTranslationInput {
            tree,
            database: DatabaseType::DuckDB,
            table_mappings: TableMappings::default(),
        };

        let (parent_only_sql, batched) = translate_to_sql_shared_with_batched_children(input);

        // Parent SQL contains __parent_row_id__.
        assert!(
            parent_only_sql.contains("__parent_row_id__"),
            "parent_only_sql missing __parent_row_id__: {parent_only_sql}"
        );
        assert!(
            parent_only_sql.contains("ROW_NUMBER() OVER ("),
            "parent_only_sql missing ROW_NUMBER OVER (...): {parent_only_sql}"
        );

        // One entry for child label "c".
        assert_eq!(batched.len(), 1);
        let (label, batched_sql) = &batched[0];
        assert_eq!(label, "c");

        // The batched SQL contains the LATERAL shape we expect.
        assert!(batched_sql.contains("WITH parent AS"));
        assert!(batched_sql.contains("LEFT JOIN LATERAL"));
        assert!(batched_sql.contains("ON TRUE"));
        assert!(batched_sql.contains("ORDER BY parent.__parent_row_id__"));
        // Outer SELECT pulls satisfied + key_e2 (child's NEW event var).
        assert!(batched_sql.contains("child.satisfied"));
        assert!(batched_sql.contains("child.key_e2"));
        // Outer SELECT exposes parent's "E1" column.
        assert!(batched_sql.contains("parent.\"E1\""));
    }

    /// Print the emitted parent + batched SQL for a small AdvancedCEL tree.
    /// Run with `cargo test -p ocpq-shared --release --
    /// db_translation::cel_gate_tests::dump_batched_sql_sample --nocapture`
    /// to inspect the SQL shape.
    #[test]
    fn dump_batched_sql_sample() {
        // root: event var E1 ("E1_type"), object var O1 ("O1_type"),
        //       R: E2O(E1,O1), S: AdvancedCEL "size(c) > 0"
        // child "c": event var E2 ("E2_type"), R: E2O(E2,O1)
        let mut root_ev: NewEventVariables = HashMap::default();
        let mut hs_e1: HashSet<String> = HashSet::new();
        hs_e1.insert("E1_type".to_string());
        root_ev.insert(EventVariable(0), hs_e1);
        let mut root_ob: NewObjectVariables = HashMap::default();
        let mut hs_o1: HashSet<String> = HashSet::new();
        hs_o1.insert("O1_type".to_string());
        root_ob.insert(ObjectVariable(0), hs_o1);

        let mut child_ev: NewEventVariables = HashMap::default();
        let mut hs_e2: HashSet<String> = HashSet::new();
        hs_e2.insert("E2_type".to_string());
        child_ev.insert(EventVariable(1), hs_e2);

        let root_bb = BindingBox {
            new_event_vars: root_ev,
            new_object_vars: root_ob,
            filters: vec![Filter::O2E {
                object: ObjectVariable(0),
                event: EventVariable(0),
                qualifier: None,
                filter_label: None,
            }],
            size_filters: vec![SizeFilter::AdvancedCEL {
                cel: "size(c) > 0".to_string(),
            }],
            ..Default::default()
        };
        let child_bb = BindingBox {
            new_event_vars: child_ev,
            filters: vec![Filter::O2E {
                object: ObjectVariable(0),
                event: EventVariable(1),
                qualifier: None,
                filter_label: None,
            }],
            ..Default::default()
        };
        let mut edges: HashMap<(usize, usize), String> = HashMap::default();
        edges.insert((0, 1), "c".to_string());
        let tree = BindingBoxTree {
            nodes: vec![
                BindingBoxTreeNode::Box(root_bb, vec![1]),
                BindingBoxTreeNode::Box(child_bb, vec![]),
            ],
            edge_names: edges,
        };
        let input = DBTranslationInput {
            tree,
            database: DatabaseType::DuckDB,
            table_mappings: TableMappings::default(),
        };
        let (parent_sql, batched) = translate_to_sql_shared_with_batched_children(input);

        eprintln!("===== PARENT_ONLY_SQL =====\n{parent_sql}\n");
        for (label, sql) in &batched {
            eprintln!("===== BATCHED SQL for child label `{label}` =====\n{sql}\n");
        }
    }

    /// `Constraint::Filter{Filter::NotEqual}` previously fell through the
    /// `_ => {}` catch-all and was silently dropped. Confirm the constraint
    /// expression now contains the `<>` clause.
    #[test]
    fn constraint_filter_not_equal_emits_inequality() {
        let mut ev: NewEventVariables = HashMap::default();
        let mut hs_a: HashSet<String> = HashSet::new();
        hs_a.insert("Etype".to_string());
        ev.insert(EventVariable(0), hs_a.clone());
        ev.insert(EventVariable(1), hs_a);
        let bbox = BindingBox {
            new_event_vars: ev,
            constraints: vec![Constraint::Filter {
                filter: Filter::NotEqual {
                    var_1: crate::binding_box::structs::Variable::Event(EventVariable(0)),
                    var_2: crate::binding_box::structs::Variable::Event(EventVariable(1)),
                },
            }],
            ..Default::default()
        };
        let tree = BindingBoxTree {
            nodes: vec![BindingBoxTreeNode::Box(bbox, vec![])],
            edge_names: HashMap::default(),
        };
        let sql = translate_to_sql_shared(DBTranslationInput {
            tree,
            database: DatabaseType::DuckDB,
            table_mappings: TableMappings::default(),
        });
        assert!(
            sql.contains("E1.ocel_id <> E2.ocel_id"),
            "expected NotEqual constraint to emit `<>` clause; got SQL:\n{sql}"
        );
    }

    /// `Constraint::Filter{Filter::BasicFilterCEL}` at the root must
    /// reach the host-side CEL pruning pass; `constraint_cel_filters_for_post_processing`
    /// returns its body.
    #[test]
    fn constraint_filter_cel_picked_up_at_root() {
        let bbox = BindingBox {
            constraints: vec![Constraint::Filter {
                filter: Filter::BasicFilterCEL {
                    cel: "e1.attr(\"amount\") > 10".to_string(),
                },
            }],
            ..Default::default()
        };
        let tree = BindingBoxTree {
            nodes: vec![BindingBoxTreeNode::Box(bbox, vec![])],
            edge_names: HashMap::default(),
        };
        assert!(validate_translatable(&tree).is_ok());
        let inter = convert_to_intermediate(tree);
        let cel = constraint_cel_filters_for_post_processing(&inter);
        assert_eq!(cel, vec!["e1.attr(\"amount\") > 10"]);
    }

    /// `Constraint::Filter{Filter::BasicFilterCEL}` at a non-root node is now
    /// accepted: the recursive host-side executor evaluates the CEL body
    /// against the node's post-SQL bindings.
    #[test]
    fn accepts_non_root_constraint_filter_cel() {
        let child = BindingBox {
            constraints: vec![Constraint::Filter {
                filter: Filter::BasicFilterCEL {
                    cel: "1 == 1".to_string(),
                },
            }],
            ..Default::default()
        };
        let tree = parent_child_tree(child);
        assert!(validate_translatable(&tree).is_ok());
    }
}
