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

use crate::binding_box::structs::EventVariable;
use crate::binding_box::structs::NewEventVariables;
use crate::binding_box::structs::NewObjectVariables;
use crate::binding_box::structs::ObjectVariable;
use crate::binding_box::structs::Qualifier;
use crate::binding_box::{
    structs::{Constraint, Filter, ObjectValueFilterTimepoint, SizeFilter, ValueFilter},
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, schemars::JsonSchema)]
pub enum DatabaseType {
    SQLite,

    DuckDB,
}

#[derive(Clone)]
pub struct SqlParts<'a> {
    node: InterMediateNode,
    select_fields: Vec<String>,
    base_from: Vec<String>,
    join_clauses: Vec<String>,
    where_clauses: Vec<String>,
    child_sql: Vec<(String, String)>,
    table_mappings: &'a TableMappings,
    used_keys: HashSet<String>,
    database_type: DatabaseType,
    alias_type_map: HashMap<String, String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(default)]
pub struct TableMappings {
    pub event_tables: HashMap<String, String>,
    pub object_tables: HashMap<String, String>,
    /// E2O junction table. Defaults to `event_object` to match the OCEL SQL
    /// schema produced by `process_mining`'s exporter.
    pub e2o_table: String,
    /// O2O junction table. Defaults to `object_object` (same exporter).
    pub o2o_table: String,
}

impl Default for TableMappings {
    fn default() -> Self {
        Self {
            event_tables: HashMap::new(),
            object_tables: HashMap::new(),
            e2o_table: "event_object".to_string(),
            o2o_table: "object_object".to_string(),
        }
    }
}

impl TableMappings {
    pub fn event_table<'a, 'b: 'a>(&'b self, ev_type: &'a str) -> &'a str {
        self.event_tables
            .get(ev_type)
            .map(|table_name| table_name.as_str())
            .unwrap_or(ev_type)
    }
    pub fn object_table<'a, 'b: 'a>(&'b self, ob_type: &'a str) -> &'a str {
        self.object_tables
            .get(ob_type)
            .map(|table_name| table_name.as_str())
            .unwrap_or(ob_type)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct DBTranslationInput {
    pub tree: BindingBoxTree,
    pub database: DatabaseType,
    pub table_mappings: TableMappings,
}

// Implementation of the General translate to SQL function
pub fn translate_to_sql_shared(input: DBTranslationInput) -> String {
    //Step 1:  Extract Intermediate Representation
    let inter = convert_to_intermediate(input.tree);

    // Create SQL Struct

    let sql_parts = SqlParts {
        node: inter,
        select_fields: vec![],
        base_from: vec![],
        join_clauses: vec![],
        where_clauses: vec![],
        child_sql: vec![],
        table_mappings: &input.table_mappings,
        used_keys: HashSet::new(),
        database_type: input.database,
        alias_type_map: HashMap::new(),
    };

    // Step 2: Translate the Intermediate Representation to SQL

    translate_to_sql_from_intermediate(sql_parts)
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

    let (binding_box, child_indices) = node.to_box(index, tree);

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

        // Must match the gate-constraint child_names produced by `to_box`.
        let edge_name = tree.edge_name(index, *child_index);

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
    }
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

// Extract other meaningful filters (maybe these in relations are enough, but CEL could be considered)
pub fn extract_filters(
    filters: Vec<Filter>,
    size_filters: Vec<SizeFilter>,
) -> (Vec<Filter>, Vec<SizeFilter>) {
    let mut result = Vec::new();
    let result_size: Vec<SizeFilter> = size_filters.to_vec();

    for filter in &filters {
        match filter {
            Filter::ObjectAttributeValueFilter {
                object: _,
                attribute_name: _,
                at_time: _,
                value_filter: _,
            } => {
                result.push(filter.clone());
            }

            Filter::EventAttributeValueFilter {
                event: _,
                attribute_name: _,
                value_filter: _,
            } => {
                result.push(filter.clone());
            }

            _ => {}
        }
    }

    (result, result_size)
}

// End of Intermediate

// Start of SQL Translation

// Function which translates Intermediate to SQL
pub fn translate_to_sql_from_intermediate(mut sql_parts: SqlParts) -> String {
    sql_parts.select_fields = construct_select_fields_root(&sql_parts);

    sql_parts.base_from = construct_from_clauses(&mut sql_parts);

    (sql_parts.join_clauses, sql_parts.where_clauses) = construct_basic_operations(&mut sql_parts);

    let childs = construct_childstrings(&sql_parts);
    sql_parts.child_sql = childs;

    let filter_clauses = construct_filter_non_basic(&mut sql_parts);
    sql_parts.where_clauses.extend(filter_clauses);

    let canonical_row_clauses: Vec<String> = sorted_object_vars(&sql_parts.node.object_vars)
        .into_iter()
        .map(|(obj_var, _)| format!("O{}.ocel_changed_field IS NULL", o_alias(obj_var.0)))
        .collect();
    sql_parts.where_clauses.extend(canonical_row_clauses);

    construct_result(&mut sql_parts)
}

// Construct the resulting SQL query with tools given

pub fn construct_result(sql_parts: &mut SqlParts) -> String {
    let mut result = String::new();

    // SELECT result
    result.push_str("SELECT ");

    result.push_str(&sql_parts.select_fields.join(", "));

    if !sql_parts.node.constraints.is_empty() {
        let child_constraint_string = construct_child_constraints(sql_parts);
        result.push_str(&format!(
            ",\nCASE WHEN {} THEN 1 ELSE 0 END AS satisfied",
            child_constraint_string
        ));
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

/// `NewObjectVariables` is a `HashMap`, and `std`'s hasher is seeded per map instance, so walking
/// it directly makes the same tree emit a differently ordered query on every run. Every walk whose
/// order reaches the SQL text goes through this.
fn sorted_object_vars(vars: &NewObjectVariables) -> Vec<(&ObjectVariable, &HashSet<String>)> {
    let mut vars: Vec<_> = vars.iter().collect();
    vars.sort_by_key(|(var, _)| var.0);
    vars
}

/// See [`sorted_object_vars`].
fn sorted_event_vars(vars: &NewEventVariables) -> Vec<(&EventVariable, &HashSet<String>)> {
    let mut vars: Vec<_> = vars.iter().collect();
    vars.sort_by_key(|(var, _)| var.0);
    vars
}

/// Sorting the variable maps is not enough on its own: each variable's *types* are a `HashSet` as
/// well, so a variable declared over more than one object or event type picked a different one --
/// and pushed its FROM entries in a different order -- on every run. `alias_type_map` inserts
/// last-wins under one alias per variable, which is what turns that into a different table in the
/// emitted query rather than only a different ordering.
///
/// No fixture in the determinism test gives a variable two types, which is why sorting the maps
/// alone looked sufficient.
fn sorted_types(types: &HashSet<String>) -> Vec<&String> {
    let mut sorted: Vec<&String> = types.iter().collect();
    sorted.sort();
    sorted
}

/// The type a variable resolves to when only one is needed. `sorted_types`' first entry, so it is
/// the same type on every run.
fn first_type(types: &HashSet<String>) -> Option<&String> {
    types.iter().min()
}

pub fn construct_select_fields_root(sql_parts: &SqlParts) -> Vec<String> {
    let mut select_fields = Vec::new();

    for (obj_var, _) in sorted_object_vars(&sql_parts.node.object_vars) {
        select_fields.push(format!(
            "O{}.ocel_id AS \"O{}\"",
            o_alias(obj_var.0),
            o_alias(obj_var.0)
        ));
    }

    for (event_var, _) in sorted_event_vars(&sql_parts.node.event_vars) {
        select_fields.push(format!(
            "E{}.ocel_id AS \"E{}\"",
            e_alias(event_var.0),
            e_alias(event_var.0)
        ));
    }

    select_fields
}

/// The list of (expression, alias) pairs that uniquely identify a binding
/// of `node` -- one entry per object/event variable. The aliases are stable
/// (a function of the variable index alone), so callers that produce the
/// child SELECT and callers that consume it can derive the same names
/// without sharing additional state.
pub fn child_key_columns(node: &InterMediateNode) -> Vec<(String, String)> {
    let mut cols = Vec::new();
    for (obj_var, _) in sorted_object_vars(&node.object_vars) {
        let n = o_alias(obj_var.0);
        cols.push((format!("O{n}.ocel_id"), format!("key_o{n}")));
    }
    for (event_var, _) in sorted_event_vars(&node.event_vars) {
        let n = e_alias(event_var.0);
        cols.push((format!("E{n}.ocel_id"), format!("key_e{n}")));
    }
    cols
}

/// SQL fragment that counts the distinct child bindings of `child_node`,
/// used by `SizeFilter::NumChilds`.
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
        "COALESCE((SELECT COUNT(*) FROM (SELECT DISTINCT {distinct_list} FROM ({child_sql}) AS child_{i}_{j}_{label}) AS child_{i}_{j}_{label}_d), 0)"
    )
}

pub fn get_object_type(node: InterMediateNode, index: usize) -> String {
    for (obj_var, types) in sorted_object_vars(&node.object_vars) {
        if obj_var.0 == index {
            // `into_iter().next()` off a `HashSet` returned an arbitrary type per run.
            if let Some(object_type) = first_type(types) {
                return object_type.to_string();
            }
        }
    }
    "no type found object".to_string()
}

pub fn get_event_type(node: InterMediateNode, index: usize) -> String {
    for (ev_var, types) in sorted_event_vars(&node.event_vars) {
        if ev_var.0 == index {
            // See `get_object_type`.
            if let Some(event_type) = first_type(types) {
                return event_type.to_string();
            }
        }
    }

    "no type found event".to_string()
}

pub fn construct_from_clauses(sql_parts: &mut SqlParts) -> Vec<String> {
    let mut from_clauses = Vec::new();
    let mut is_first_join = true;

    // Snapshot the junction-table names as quoted SQL identifiers so the
    // format! calls below can refer to them while `sql_parts` is mutably
    // borrowed via `next_alias`.
    let e2o_tbl = format!("\"{}\"", sql_parts.table_mappings.e2o_table);
    let o2o_tbl = format!("\"{}\"", sql_parts.table_mappings.o2o_table);

    // Clone the relation list so we can mutably borrow `sql_parts` inside the
    // loop body (e.g. via `next_alias`).
    let relations = sql_parts.node.relations.clone();
    for relation in &relations {
        match relation {
            Relation::E2O {
                event,
                object,
                qualifier: _,
            } => {
                let event_alias = format!("E{}", e_alias(event.0));
                let object_alias = format!("O{}", o_alias(object.0));
                let event_object_alias = sql_parts.next_alias("ER");

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
                                map_objecttables(
                                    sql_parts,
                                    &get_object_type(sql_parts.node.clone(), object.0)
                                ),
                                object_alias
                            ));
                            from_clauses.push(format!(
                                "INNER JOIN {e2o_tbl} AS {} ON {}.ocel_object_id = {}.ocel_id AND {}.ocel_event_id = {}.ocel_id",
                                event_object_alias, event_object_alias, object_alias, event_object_alias, event_alias
                            ));
                            sql_parts.alias_type_map.insert(
                                object_alias.clone(),
                                get_object_type(sql_parts.node.clone(), object.0),
                            );
                            sql_parts.used_keys.insert(object_alias.clone());
                        }
                    } else if sql_parts.used_keys.contains(&object_alias) {
                        // object table exists, event not
                        from_clauses.push(format!(
                            "{} AS {}",
                            map_eventttables(
                                sql_parts,
                                &get_event_type(sql_parts.node.clone(), event.0)
                            ),
                            event_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {e2o_tbl} AS {} ON {}.ocel_object_id = {}.ocel_id AND {}.ocel_event_id = {}.ocel_id",
                            event_object_alias, event_object_alias, object_alias, event_object_alias, event_alias
                        ));

                        sql_parts.alias_type_map.insert(
                            event_alias.clone(),
                            get_event_type(sql_parts.node.clone(), event.0),
                        );
                        sql_parts.used_keys.insert(event_alias.clone());
                    } else {
                        // both not existing
                        from_clauses.push(format!(
                            "{} AS {}",
                            map_eventttables(
                                sql_parts,
                                &get_event_type(sql_parts.node.clone(), event.0)
                            ),
                            event_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {e2o_tbl} AS {} ON {}.ocel_event_id = {}.ocel_id",
                            event_object_alias, event_object_alias, event_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {} AS {} ON {}.ocel_object_id = {}.ocel_id",
                            map_objecttables(
                                sql_parts,
                                &get_object_type(sql_parts.node.clone(), object.0)
                            ),
                            object_alias,
                            event_object_alias,
                            object_alias
                        ));
                        sql_parts.alias_type_map.insert(
                            object_alias.clone(),
                            get_object_type(sql_parts.node.clone(), object.0),
                        );
                        sql_parts.alias_type_map.insert(
                            event_alias.clone(),
                            get_event_type(sql_parts.node.clone(), event.0),
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
                            map_objecttables(
                                sql_parts,
                                &get_object_type(sql_parts.node.clone(), object.0)
                            ),
                            object_alias,
                            event_object_alias,
                            object_alias
                        ));
                        sql_parts.alias_type_map.insert(
                            object_alias.clone(),
                            get_object_type(sql_parts.node.clone(), object.0),
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
                        map_eventttables(
                            sql_parts,
                            &get_event_type(sql_parts.node.clone(), event.0)
                        ),
                        event_alias,
                        event_object_alias,
                        event_alias
                    ));
                    sql_parts.alias_type_map.insert(
                        event_alias.clone(),
                        get_event_type(sql_parts.node.clone(), event.0),
                    );
                    sql_parts.used_keys.insert(event_alias.clone());
                } else {
                    // both missing
                    from_clauses.push(format!(
                        "CROSS JOIN {} AS {}",
                        map_eventttables(
                            sql_parts,
                            &get_event_type(sql_parts.node.clone(), event.0)
                        ),
                        event_alias
                    ));
                    from_clauses.push(format!(
                        "INNER JOIN {e2o_tbl} AS {} ON {}.ocel_event_id = {}.ocel_id",
                        event_object_alias, event_object_alias, event_alias
                    ));
                    from_clauses.push(format!(
                        "INNER JOIN {} AS {} ON {}.ocel_object_id = {}.ocel_id",
                        map_objecttables(
                            sql_parts,
                            &get_object_type(sql_parts.node.clone(), object.0)
                        ),
                        object_alias,
                        event_object_alias,
                        object_alias
                    ));
                    sql_parts.alias_type_map.insert(
                        object_alias.clone(),
                        get_object_type(sql_parts.node.clone(), object.0),
                    );
                    sql_parts.alias_type_map.insert(
                        event_alias.clone(),
                        get_event_type(sql_parts.node.clone(), event.0),
                    );
                    sql_parts.used_keys.insert(object_alias.clone());
                    sql_parts.used_keys.insert(event_alias.clone());
                }
            }

            Relation::O2O {
                object_1,
                object_2,
                qualifier: _,
            } => {
                let object1_alias = format!("O{}", o_alias(object_1.0));
                let object2_alias = format!("O{}", o_alias(object_2.0));
                let object_object_alias = sql_parts.next_alias("OR");

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
                                map_objecttables(
                                    sql_parts,
                                    &get_object_type(sql_parts.node.clone(), object_2.0)
                                ),
                                object2_alias
                            ));
                            from_clauses.push(format!(
                                "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_source_id = {}.ocel_id AND {}.ocel_target_id = {}.ocel_id",
                                object_object_alias, object_object_alias, object1_alias, object_object_alias, object2_alias
                            ));
                            sql_parts.alias_type_map.insert(
                                object2_alias.clone(),
                                get_object_type(sql_parts.node.clone(), object_2.0),
                            );
                            sql_parts.used_keys.insert(object2_alias.clone());
                        }
                    } else if sql_parts.used_keys.contains(&object2_alias) {
                        from_clauses.push(format!(
                            "{} AS {}",
                            map_objecttables(
                                sql_parts,
                                &get_object_type(sql_parts.node.clone(), object_1.0)
                            ),
                            object1_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_source_id = {}.ocel_id AND {}.ocel_target_id = {}.ocel_id",
                            object_object_alias, object_object_alias, object1_alias, object_object_alias, object2_alias
                        ));
                        sql_parts.alias_type_map.insert(
                            object1_alias.clone(),
                            get_object_type(sql_parts.node.clone(), object_1.0),
                        );
                        sql_parts.used_keys.insert(object1_alias.clone());
                    } else {
                        from_clauses.push(format!(
                            "{} AS {}",
                            map_objecttables(
                                sql_parts,
                                &get_object_type(sql_parts.node.clone(), object_1.0)
                            ),
                            object1_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_source_id = {}.ocel_id",
                            object_object_alias, object_object_alias, object1_alias
                        ));
                        from_clauses.push(format!(
                            "INNER JOIN {} AS {} ON {}.ocel_target_id = {}.ocel_id",
                            map_objecttables(
                                sql_parts,
                                &get_object_type(sql_parts.node.clone(), object_2.0)
                            ),
                            object2_alias,
                            object_object_alias,
                            object2_alias
                        ));
                        sql_parts.alias_type_map.insert(
                            object1_alias.clone(),
                            get_object_type(sql_parts.node.clone(), object_1.0),
                        );
                        sql_parts.alias_type_map.insert(
                            object2_alias.clone(),
                            get_object_type(sql_parts.node.clone(), object_2.0),
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
                            map_objecttables(
                                sql_parts,
                                &get_object_type(sql_parts.node.clone(), object_2.0)
                            ),
                            object2_alias,
                            object_object_alias,
                            object2_alias
                        ));
                        sql_parts.used_keys.insert(object2_alias.clone());
                        sql_parts.alias_type_map.insert(
                            object2_alias.clone(),
                            get_object_type(sql_parts.node.clone(), object_2.0),
                        );
                    }
                } else if sql_parts.used_keys.contains(&object2_alias) {
                    from_clauses.push(format!(
                        "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_target_id = {}.ocel_id",
                        object_object_alias, object_object_alias, object2_alias
                    ));
                    from_clauses.push(format!(
                        "INNER JOIN {} AS {} ON {}.ocel_source_id = {}.ocel_id",
                        map_objecttables(
                            sql_parts,
                            &get_object_type(sql_parts.node.clone(), object_1.0)
                        ),
                        object1_alias,
                        object_object_alias,
                        object1_alias
                    ));
                    sql_parts.alias_type_map.insert(
                        object1_alias.clone(),
                        get_object_type(sql_parts.node.clone(), object_1.0),
                    );
                    sql_parts.used_keys.insert(object1_alias.clone());
                } else {
                    from_clauses.push(format!(
                        "CROSS JOIN {} AS {}",
                        map_objecttables(
                            sql_parts,
                            &get_object_type(sql_parts.node.clone(), object_1.0)
                        ),
                        object1_alias
                    ));
                    from_clauses.push(format!(
                        "INNER JOIN {o2o_tbl} AS {} ON {}.ocel_source_id = {}.ocel_id",
                        object_object_alias, object_object_alias, object1_alias
                    ));
                    from_clauses.push(format!(
                        "INNER JOIN {} AS {} ON {}.ocel_target_id = {}.ocel_id",
                        map_objecttables(
                            sql_parts,
                            &get_object_type(sql_parts.node.clone(), object_2.0)
                        ),
                        object2_alias,
                        object_object_alias,
                        object2_alias
                    ));
                    sql_parts.alias_type_map.insert(
                        object1_alias.clone(),
                        get_object_type(sql_parts.node.clone(), object_1.0),
                    );
                    sql_parts.alias_type_map.insert(
                        object2_alias.clone(),
                        get_object_type(sql_parts.node.clone(), object_2.0),
                    );
                    sql_parts.used_keys.insert(object2_alias.clone());
                    sql_parts.used_keys.insert(object1_alias.clone());
                }
            }

            _ => {}
        }
    }

    if is_first_join {
        // Does not contain E2O or O2O
        for (obj_var, types) in sorted_object_vars(&sql_parts.node.object_vars) {
            for object_type in sorted_types(types) {
                let key = format!("O{}", o_alias(obj_var.0));
                sql_parts.used_keys.insert(key.clone());
                sql_parts
                    .alias_type_map
                    .insert(key.clone(), object_type.to_string());
                from_clauses.push(format!(
                    "{} AS {}",
                    map_objecttables(sql_parts, object_type),
                    key
                ));
            }
        }

        for (event_var, types) in sorted_event_vars(&sql_parts.node.event_vars) {
            for event_type in sorted_types(types) {
                let key = format!("E{}", e_alias(event_var.0));
                sql_parts.used_keys.insert(key.clone());
                sql_parts
                    .alias_type_map
                    .insert(key.clone(), event_type.to_string());
                from_clauses.push(format!(
                    "{} AS {}",
                    map_eventttables(sql_parts, event_type),
                    key
                ));
            }
        }
    } else {
        // there might be relations, but there might be object tables which are not created

        for (obj_var, types) in sorted_object_vars(&sql_parts.node.object_vars) {
            for object_type in sorted_types(types) {
                let key = format!("O{}", o_alias(obj_var.0));
                if !sql_parts.used_keys.contains(&key) {
                    from_clauses.push(format!(
                        " CROSS JOIN {} AS {}",
                        map_objecttables(sql_parts, object_type),
                        key
                    ));
                    sql_parts.used_keys.insert(key.clone());
                    sql_parts
                        .alias_type_map
                        .insert(key.clone(), object_type.to_string());
                }
            }
        }

        for (event_var, types) in sorted_event_vars(&sql_parts.node.event_vars) {
            for event_type in sorted_types(types) {
                let key = format!("E{}", e_alias(event_var.0));
                if !sql_parts.used_keys.contains(&key) {
                    from_clauses.push(format!(
                        " CROSS JOIN {} AS {}",
                        map_eventttables(sql_parts, event_type),
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

pub fn construct_basic_operations(sql_parts: &mut SqlParts) -> (Vec<String>, Vec<String>) {
    let join_clauses = Vec::new();
    let mut where_clauses = sql_parts.where_clauses.clone();

    for relation in &sql_parts.node.relations {
        if let Relation::TimeBetweenEvents {
            from_event,
            to_event,
            min_seconds,
            max_seconds,
        } = relation
        {
            if let Some(min) = min_seconds {
                where_clauses.push(format!(
                    "{time_left} - {time_right} >= {min}",
                    time_left = map_timestamp_event(sql_parts, to_event.0),
                    time_right = map_timestamp_event(sql_parts, from_event.0)
                ));
            }
            if let Some(max) = max_seconds {
                where_clauses.push(format!(
                    "{time_left} - {time_right} <= {max}",
                    time_left = map_timestamp_event(sql_parts, to_event.0),
                    time_right = map_timestamp_event(sql_parts, from_event.0)
                ));
            }
        }
    }

    (join_clauses, where_clauses)
}

pub fn construct_childstrings(sql_parts: &SqlParts) -> Vec<(String, String)> {
    let mut result = Vec::new();

    for (inter_node, node_label) in &sql_parts.node.children {
        let mut child_sql_parts = SqlParts {
            node: inter_node.clone(),
            select_fields: vec![],
            base_from: vec![],
            join_clauses: vec![],
            where_clauses: vec![],
            child_sql: vec![],
            table_mappings: sql_parts.table_mappings,
            used_keys: sql_parts.used_keys.clone(),
            database_type: sql_parts.database_type,
            alias_type_map: sql_parts.alias_type_map.clone(),
        };

        let child_sql = translate_to_sql_from_child(&mut child_sql_parts);
        result.push((child_sql, node_label.clone()));
    }

    result
}

pub fn construct_child_constraints(sql_parts: &mut SqlParts) -> String {
    let mut result_string = Vec::new();

    let e2o_tbl = format!("\"{}\"", sql_parts.table_mappings.e2o_table);
    let o2o_tbl = format!("\"{}\"", sql_parts.table_mappings.o2o_table);

    // Clone the constraint list so the loop body can mutably borrow `sql_parts`
    // (e.g. via `next_alias`).
    let constraints = sql_parts.node.constraints.clone();
    for (i, constraint) in constraints.iter().enumerate() {
        match constraint {
            Constraint::ANY { child_names } => {
                let mut parts = Vec::new();
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_names.contains(child_label) {
                        parts.push(format!(
                            "COALESCE((SELECT COUNT(*) FROM ({}) AS child_{i}_{j}_{label} WHERE child_{i}_{j}_{label}.satisfied = 1), 0) >= 1",
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

            // Constraint AND ALL
            Constraint::AND { child_names } => {
                let mut parts = Vec::new();
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_names.contains(child_label) {
                        parts.push(format!(
                            "NOT EXISTS (SELECT 1 FROM ({}) AS child_{iterator1}_{iterator2}_{label} WHERE child_{iterator1}_{iterator2}_{label}.satisfied = 0)",
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
                let mut parts = Vec::new();
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_names.contains(child_label) {
                        parts.push(format!(
                            "NOT EXISTS (SELECT 1 FROM ({}) AS child_{iterator1}_{iterator2}_{label} WHERE child_{iterator1}_{iterator2}_{label}.satisfied = 1)",
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

            Constraint::SAT { child_names } => {
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_names.contains(child_label) {
                        result_string.push(format!(
                            "NOT EXISTS (SELECT 1 FROM ({}) AS child_{iterator1}_{iterator2}_{label} WHERE child_{iterator1}_{iterator2}_{label}.satisfied = 0)",
                            child_sql,
                            iterator1 = i,
                            iterator2 = j,
                            label = child_label.trim()
                        ));
                    }
                }
            }

            // Analog to AND ALl but now connect with OR
            Constraint::OR { child_names } => {
                let mut parts = Vec::new();
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_names.contains(child_label) {
                        parts.push(format!(
                            "NOT EXISTS (SELECT 1 FROM ({}) AS child_{iterator1}_{iterator2}_{label} WHERE child_{iterator1}_{iterator2}_{label}.satisfied = 0)",
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

            Constraint::SizeFilter { filter } => {
                if let SizeFilter::NumChilds {
                    child_name,
                    min,
                    max,
                } = filter
                {
                    for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                        if child_label == child_name {
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
                            result_string.push(clause);
                        }
                    }
                }
            }

            Constraint::Filter { filter } => match filter {
                Filter::O2E { object, event, .. } => {
                    let alias = sql_parts.next_alias("ER");
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

                _ => {}
            },
        }
    }

    result_string.join(" AND ")
}

// Handling of Childs

pub fn translate_to_sql_from_child(sql_parts: &mut SqlParts) -> String {
    sql_parts.base_from = construct_from_clauses(sql_parts);
    (sql_parts.join_clauses, sql_parts.where_clauses) = construct_basic_operations(sql_parts);

    // Same canonical-row filter the root applies (see
    // `translate_to_sql_from_intermediate`): the OCEL `object_<type>` schema
    // stores attribute history as additional rows keyed by
    // `ocel_changed_field`, and joining them blindly multiplies child
    // bindings by the per-object snapshot count.
    let canonical_row_clauses: Vec<String> = sorted_object_vars(&sql_parts.node.object_vars)
        .into_iter()
        .map(|(obj_var, _)| format!("O{}.ocel_changed_field IS NULL", o_alias(obj_var.0)))
        .collect();
    sql_parts.where_clauses.extend(canonical_row_clauses);

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
        fields.push(format!(
            "CASE WHEN {} THEN 1 ELSE 0 END AS satisfied",
            sub_condition
        ));
        // Expose the key columns under stable aliases; the size-filter
        // consumer derives the same alias list to compute COUNT(DISTINCT ...).
        for (expr, alias) in child_key_columns(&sql_parts.node) {
            fields.push(format!("{expr} AS {alias}"));
        }
        fields
    };

    construct_result_child(sql_parts)
}

pub fn construct_result_child(sql_parts: &SqlParts) -> String {
    let mut result = String::new();

    result.push_str("SELECT ");
    result.push_str(&sql_parts.select_fields.join(",\n"));
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

    for (i, sizefilter) in sql_parts.node.sizefilter.iter().enumerate() {
        if let SizeFilter::NumChilds {
            child_name,
            min,
            max,
        } = sizefilter
        {
            for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                if child_label == child_name {
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
            parts.join(" AND ")
        }
        ValueFilter::Float { min, max } => {
            let mut parts = vec![];
            if let Some(min) = min {
                parts.push(format!("{} >= {}", col, min));
            }
            if let Some(max) = max {
                parts.push(format!("{} <= {}", col, max));
            }
            parts.join(" AND ")
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
            parts.join(" AND ")
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
            format!("{}.{} IN ({})", temp_alias, attr, values)
        }
        ValueFilter::Boolean { is_true } => {
            format!("{}.{} = {}", temp_alias, attr, is_true)
        }
        ValueFilter::Integer { min, max } => {
            let mut parts = vec![];
            if let Some(min) = min {
                parts.push(format!("{}.{} >= {}", temp_alias, attr, min));
            }
            if let Some(max) = max {
                parts.push(format!("{}.{} <= {}", temp_alias, attr, max));
            }
            parts.join(" AND ")
        }
        ValueFilter::Float { min, max } => {
            let mut parts = vec![];
            if let Some(min) = min {
                parts.push(format!("{}.{} >= {}", temp_alias, attr, min));
            }
            if let Some(max) = max {
                parts.push(format!("{}.{} <= {}", temp_alias, attr, max));
            }
            parts.join(" AND ")
        }
        ValueFilter::Time { from, to } => {
            let mut parts = vec![];
            let ts = map_timestamp(sql_parts, format!("{}.{}", temp_alias, attr));
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
            parts.join(" AND ")
        }
    };

    // First match, over sorted vars and sorted types: this used to walk two `HashSet`-backed
    // collections and keep whichever type came last, so the filter named a different table per run.
    let mut object_type = "";
    for (obj_var, types) in sorted_object_vars(&sql_parts.node.object_vars) {
        if obj_var.0 == object.0 {
            if let Some(t) = first_type(types) {
                object_type = t;
            }
            break;
        }
    }
    if object_type.is_empty() {
        // alias_type_map is keyed by `o_alias`-formatted aliases ("O{n+1}").
        object_type = &sql_parts.alias_type_map[&object_alias];
    }
    let otype = map_objecttables(sql_parts, object_type);
    let oid = format!("{}.ocel_id", object_alias);

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

pub fn map_objecttables(sql_parts: &SqlParts, object_type: &str) -> String {
    match sql_parts.database_type {
        // Case SQLLite
        DatabaseType::SQLite => {
            format!(
                "\"object_{}\"",
                sql_parts.table_mappings.object_table(object_type)
            )
        }

        //Case DuckDB
        DatabaseType::DuckDB => {
            format!(
                "\"object_{}\"",
                sql_parts.table_mappings.object_table(object_type)
            )
        }
    }
}

pub fn map_eventttables(sql_parts: &SqlParts, event_type: &str) -> String {
    match sql_parts.database_type {
        // Case SQLLite
        DatabaseType::SQLite => {
            format!(
                "\"event_{}\"",
                sql_parts.table_mappings.event_table(event_type)
            )
        }

        //Case DuckDB
        DatabaseType::DuckDB => {
            format!(
                "\"event_{}\"",
                sql_parts.table_mappings.event_table(event_type)
            )
        }
    }
}

pub fn map_timestamp_event(sql_parts: &SqlParts, event_count: usize) -> String {
    match sql_parts.database_type {
        DatabaseType::SQLite => {
            format!("strftime('%s', E{}.ocel_time)", e_alias(event_count))
        }

        DatabaseType::DuckDB => {
            format!("EPOCH(E{}.ocel_time)", e_alias(event_count))
        }
    }
}

pub fn map_timestamp(sql_parts: &SqlParts, alias: String) -> String {
    match sql_parts.database_type {
        DatabaseType::SQLite => format!("strftime('%s', {})", alias),

        DatabaseType::DuckDB => {
            format!("EPOCH({})", alias)
        }
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

    if !cypher_parts.node.sizefilter.is_empty() || cypher_parts.node.filter.is_empty() {
        construct_childstrings_cypher(cypher_parts);

        construct_filter_clauses(cypher_parts);
    }

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
                    .event_table(&event_type)
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
                    .object_table(&object_type)
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
                    .object_table(&object1_type)
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
                    .object_table(&object2_type)
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

    for (obj_var, types) in sorted_object_vars(&cypher_parts.node.object_vars) {
        for object_type in sorted_types(types) {
            let key = format!("o{}", o_alias(obj_var.0));
            if !cypher_parts.used_alias.contains(&key) {
                let mapped = cypher_parts
                    .table_mappings
                    .object_table(object_type)
                    .to_string();
                cypher_parts
                    .match_clauses
                    .push(format!("({}:{})", key, mapped));
                cypher_parts.used_alias.insert(key.clone());
                cypher_parts.alias_type.insert(key, mapped);
            }
        }
    }

    for (event_var, types) in sorted_event_vars(&cypher_parts.node.event_vars) {
        for event_type in sorted_types(types) {
            let key = format!("e{}", e_alias(event_var.0));
            if !cypher_parts.used_alias.contains(&key) {
                let mapped = cypher_parts
                    .table_mappings
                    .event_table(event_type)
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

    if !cypher_parts.node.sizefilter.is_empty() || cypher_parts.node.filter.is_empty() {
        construct_childstrings_cypher(cypher_parts);
        construct_filter_clauses(cypher_parts);
    }

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
mod tests {
    use super::*;
    use crate::binding_box::structs::{ObjectValueFilterTimepoint, Variable};
    use std::collections::BTreeMap;

    /// The seven BPIC2017 query trees that `backend/test/Q*/ocpq-tree.json` holds.
    ///
    /// Inlined rather than read from those paths because `backend/.gitignore` ignores `*.json`:
    /// the files are not in a checkout, so a test that read them would pass here and fail on CI.
    const FIXTURES: &[(&str, &str)] = &[
        // Q1: every Application has exactly one A_Submitted event (NumChilds 1..1 over an E2O child).
        (
            "Q1",
            r#"{"nodes":[{"Box":[{"newEventVars":{},"newObjectVars":{"0":["Application"]},"filters":[],"sizeFilters":[],"constraints":[{"type":"SizeFilter","filter":{"type":"NumChilds","child_name":"A","min":1,"max":1}}],"evVarLabels":{},"obVarLabels":{},"labels":[]},[1]]},{"Box":[{"newEventVars":{"0":["A_Submitted"]},"newObjectVars":{},"filters":[{"type":"O2E","object":0,"event":0,"qualifier":null,"filterLabel":null}],"sizeFilters":[],"constraints":[],"evVarLabels":{},"obVarLabels":{},"labels":[]},[]]}],"edgeNames":[[[0,1],"A"]]}"#,
        ),
        // Q2: every O_Created of an Offer is eventually followed by an O_Returned of the same Offer
        // (NumChilds >= 1 over a child with an E2O and a TimeBetweenEvents filter).
        (
            "Q2",
            r#"{"nodes":[{"Box":[{"newEventVars":{"0":["O_Created"]},"newObjectVars":{"0":["Offer"]},"filters":[{"type":"O2E","object":0,"event":0,"qualifier":null,"filterLabel":null}],"sizeFilters":[],"constraints":[{"type":"SizeFilter","filter":{"type":"NumChilds","child_name":"A","min":1,"max":null}}],"evVarLabels":{},"obVarLabels":{},"labels":[]},[1]]},{"Box":[{"newEventVars":{"1":["O_Returned"]},"newObjectVars":{},"filters":[{"type":"O2E","object":0,"event":1,"qualifier":null,"filterLabel":null},{"type":"TimeBetweenEvents","from_event":0,"to_event":1,"min_seconds":0.0,"max_seconds":null}],"sizeFilters":[],"constraints":[],"evVarLabels":{},"obVarLabels":{},"labels":[]},[]]}],"edgeNames":[[[0,1],"A"]]}"#,
        ),
        // Q3: every O_Returned event touches exactly one Offer (the object variable is introduced in
        // the child, so the child owns the object table).
        (
            "Q3",
            r#"{"nodes":[{"Box":[{"newEventVars":{"0":["O_Returned"]},"newObjectVars":{},"filters":[],"sizeFilters":[],"constraints":[{"type":"SizeFilter","filter":{"type":"NumChilds","child_name":"A","min":1,"max":1}}],"evVarLabels":{},"obVarLabels":{},"labels":[]},[1]]},{"Box":[{"newEventVars":{},"newObjectVars":{"1":["Offer"]},"filters":[{"type":"O2E","object":1,"event":0,"qualifier":null,"filterLabel":null}],"sizeFilters":[],"constraints":[],"evVarLabels":{},"obVarLabels":{},"labels":[]},[]]}],"edgeNames":[[[0,1],"A"]]}"#,
        ),
        // Q4: after A_Accepted, each of the Application's Offers has a later O_Accepted (O2O and E2O
        // together in one child).
        (
            "Q4",
            r#"{"nodes":[{"Box":[{"newEventVars":{"0":["A_Accepted"]},"newObjectVars":{"0":["Application"]},"filters":[{"type":"O2E","object":0,"event":0,"qualifier":null,"filterLabel":null}],"sizeFilters":[],"constraints":[{"type":"SizeFilter","filter":{"type":"NumChilds","child_name":"A","min":1,"max":null}}],"evVarLabels":{},"obVarLabels":{},"labels":[]},[1]]},{"Box":[{"newEventVars":{"1":["O_Accepted"]},"newObjectVars":{"1":["Offer"]},"filters":[{"type":"O2O","object":0,"other_object":1,"qualifier":null,"filterLabel":null},{"type":"O2E","object":1,"event":1,"qualifier":null,"filterLabel":null},{"type":"TimeBetweenEvents","from_event":0,"to_event":1,"min_seconds":0.0,"max_seconds":null}],"sizeFilters":[],"constraints":[],"evVarLabels":{},"obVarLabels":{},"labels":[]},[]]}],"edgeNames":[[[0,1],"A"]]}"#,
        ),
        // Q5: SAT gate -- for every (Application, Case_R, A_Accepted), each Offer's O_Created must also
        // relate to that Case_R (an O2E used as a constraint rather than as a filter).
        (
            "Q5",
            r#"{"nodes":[{"Box":[{"newEventVars":{"0":["A_Accepted"]},"newObjectVars":{"0":["Application"],"1":["Case_R"]},"filters":[{"type":"O2E","object":0,"event":0,"qualifier":null,"filterLabel":null},{"type":"O2E","object":1,"event":0,"qualifier":null,"filterLabel":null}],"sizeFilters":[],"constraints":[{"type":"SAT","child_names":["A"]}],"evVarLabels":{},"obVarLabels":{},"labels":[]},[1]]},{"Box":[{"newEventVars":{"1":["O_Created"]},"newObjectVars":{"2":["Offer"]},"filters":[{"type":"O2O","object":0,"other_object":2,"qualifier":null,"filterLabel":null},{"type":"O2E","object":2,"event":1,"qualifier":null,"filterLabel":null}],"sizeFilters":[],"constraints":[{"type":"Filter","filter":{"type":"O2E","object":1,"event":1,"qualifier":null,"filterLabel":null}}],"evVarLabels":{},"obVarLabels":{},"labels":[]},[]]}],"edgeNames":[[[0,1],"A"]]}"#,
        ),
        // Q6: a root box with no variables at all, carrying only a CEL label over its child.
        (
            "Q6",
            r#"{"nodes":[{"Box":[{"newEventVars":{},"newObjectVars":{},"filters":[],"sizeFilters":[],"constraints":[],"evVarLabels":{},"obVarLabels":{},"labels":[{"label":"max_dur","cel":"string(max(A.map(b,b['e2'].time() - b['e1'].time())))"}]},[1]]},{"Box":[{"newEventVars":{"1":["O_Accepted"],"0":["O_Created"]},"newObjectVars":{"0":["Offer"]},"filters":[{"type":"O2E","object":0,"event":0,"qualifier":null,"filterLabel":null},{"type":"O2E","object":0,"event":1,"qualifier":null,"filterLabel":null}],"sizeFilters":[],"constraints":[],"evVarLabels":{},"obVarLabels":{},"labels":[]},[]]}],"edgeNames":[[[0,1],"A"]]}"#,
        ),
        // Q7: two Offers of one Application, each with its own O_Created; the only child-free tree.
        (
            "Q7",
            r#"{"nodes":[{"Box":[{"newEventVars":{"1":["O_Created"],"2":["O_Created"]},"newObjectVars":{"1":["Offer"],"2":["Offer"],"0":["Application"]},"filters":[{"type":"O2O","object":0,"other_object":1,"qualifier":null,"filterLabel":null},{"type":"O2O","object":0,"other_object":2,"qualifier":null,"filterLabel":null},{"type":"O2E","object":1,"event":1,"qualifier":null,"filterLabel":null},{"type":"O2E","object":2,"event":2,"qualifier":null,"filterLabel":null}],"sizeFilters":[],"constraints":[],"evVarLabels":{},"obVarLabels":{},"labels":[]},[]]}],"edgeNames":[]}"#,
        ),
    ];

    const DATABASES: [DatabaseType; 2] = [DatabaseType::SQLite, DatabaseType::DuckDB];

    fn parse(tree_json: &str) -> BindingBoxTree {
        serde_json::from_str(tree_json).expect("fixture tree parses")
    }

    fn translate(tree_json: &str, database: DatabaseType) -> String {
        translate_to_sql_shared(DBTranslationInput {
            tree: parse(tree_json),
            database,
            table_mappings: TableMappings::default(),
        })
    }

    fn is_ident_char(c: u8) -> bool {
        c.is_ascii_alphanumeric() || c == b'_'
    }

    /// Every identifier used as the qualifier of a column reference (`X` in `X.col`).
    fn referenced_aliases(sql: &str) -> BTreeMap<String, usize> {
        let bytes = sql.as_bytes();
        let mut found: BTreeMap<String, usize> = BTreeMap::new();
        for (dot, c) in sql.char_indices() {
            if c != '.' {
                continue;
            }
            let mut start = dot;
            while start > 0 && is_ident_char(bytes[start - 1]) {
                start -= 1;
            }
            let ident = &sql[start..dot];
            // Skips the fractional part of a numeric literal, which is not an alias.
            if ident.is_empty() || ident.starts_with(|c: char| c.is_ascii_digit()) {
                continue;
            }
            *found.entry(ident.to_string()).or_default() += 1;
        }
        found
    }

    /// Every identifier introduced by an unquoted `AS` binder, with how often it is bound.
    ///
    /// A quoted binder (`O1.ocel_id AS "O1"`) names an output column of the result set, not a
    /// table alias, and shares the variable's name on purpose; it is skipped here so it does not
    /// read as a second binding of that alias.
    fn bound_aliases(sql: &str) -> BTreeMap<String, usize> {
        let lower = sql.to_ascii_lowercase();
        let mut found: BTreeMap<String, usize> = BTreeMap::new();
        let mut from = 0;
        while let Some(hit) = lower[from..].find(" as ") {
            let after = from + hit + " as ".len();
            from = after;
            let rest = sql[after..].trim_start();
            if rest.starts_with('"') {
                continue;
            }
            let name: String = rest
                .chars()
                .take_while(|c| is_ident_char(*c as u8))
                .collect();
            if !name.is_empty() {
                *found.entry(name).or_default() += 1;
            }
        }
        found
    }

    /// Whether `alias` is one of the table aliases the translator hands out: `O1`, `E2`, the
    /// junction aliases `ER1` / `OR1` and the attribute-subquery aliases `OA1` / `OA21`.
    fn is_table_alias(alias: &str) -> bool {
        let rest = alias
            .strip_prefix("ER")
            .or_else(|| alias.strip_prefix("OR"))
            .or_else(|| alias.strip_prefix("OA"))
            .or_else(|| alias.strip_prefix('O'))
            .or_else(|| alias.strip_prefix('E'));
        rest.is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
    }

    /// The root box of a fixture tree, with its object and event variables in index order.
    fn root_vars(tree: &BindingBoxTree) -> (Vec<usize>, Vec<usize>) {
        let (bbox, _children) = tree.nodes[0].to_box(0, tree);
        let mut obs: Vec<usize> = bbox.new_object_vars.keys().map(|v| v.0).collect();
        let mut evs: Vec<usize> = bbox.new_event_vars.keys().map(|v| v.0).collect();
        obs.sort_unstable();
        evs.sort_unstable();
        (obs, evs)
    }

    /// A variable declared over more than one type, which no `FIXTURES` entry has.
    ///
    /// The per-variable type sets are `HashSet`s, so this is the shape that stays nondeterministic
    /// after the variable *maps* are sorted: the FROM builder walks the set and `alias_type_map`
    /// keeps whichever type came last under the variable's single alias, so the query named a
    /// different table between runs. Two object variables and two event variables, each over two
    /// types, so a single arbitrary choice shows up rather than cancelling out.
    const MULTI_TYPE_FIXTURE: &str = r#"{"nodes":[{"Box":[{"newEventVars":{"0":["A_Submitted","O_Created"]},"newObjectVars":{"0":["Application","Offer"]},"filters":[{"type":"O2E","object":0,"event":0,"qualifier":null,"filterLabel":null}],"sizeFilters":[],"constraints":[],"evVarLabels":{},"obVarLabels":{},"labels":[]},[]]}],"edgeNames":[]}"#;

    /// Translating the same tree twice must give the same bytes. The variable maps are `HashMap`s
    /// and `std`'s hasher is seeded per map, so anything that iterates them straight into the
    /// output makes the emitted query depend on the run: the SELECT list, the WHERE list and the
    /// key columns a size filter counts all did, and a cached or diffed query string then changes
    /// under a caller that did nothing.
    #[test]
    fn translation_is_deterministic_across_runs() {
        let cases = FIXTURES
            .iter()
            .copied()
            .chain([("multi-type", MULTI_TYPE_FIXTURE)]);
        for (name, tree_json) in cases {
            for database in DATABASES {
                let first = translate(tree_json, database);
                for run in 1..8 {
                    assert_eq!(
                        first,
                        translate(tree_json, database),
                        "{name} on {database:?} differs on run {run}"
                    );
                }
            }
        }
    }

    /// The hasher is seeded per map *instance*, so eight runs inside one process can agree by luck.
    /// Rebuilding the tree from JSON each time gives fresh maps, which is what actually varies the
    /// iteration order, and 64 rounds makes an arbitrary pick over a two-element set overwhelmingly
    /// likely to show itself.
    #[test]
    fn a_variable_over_several_types_translates_the_same_every_time() {
        for database in DATABASES {
            let first = translate(MULTI_TYPE_FIXTURE, database);
            for run in 1..64 {
                assert_eq!(
                    first,
                    translate(MULTI_TYPE_FIXTURE, database),
                    "multi-type fixture on {database:?} differs on run {run}"
                );
            }
        }
    }

    /// A query that mentions `O3.ocel_id` without ever binding `O3` is rejected by the database at
    /// run time, which is where the user meets it. The alias vocabulary is spread over the FROM
    /// builder, the junction-alias allocator and the child/constraint builders, so this is the
    /// cheapest way to notice one of them drifting.
    #[test]
    fn every_referenced_alias_is_bound() {
        for (name, tree_json) in FIXTURES {
            for database in DATABASES {
                let sql = translate(tree_json, database);
                let bound = bound_aliases(&sql);
                for alias in referenced_aliases(&sql).keys() {
                    assert!(
                        bound.contains_key(alias),
                        "{name} on {database:?} references {alias} but never binds it:\n{sql}"
                    );
                }
            }
        }
    }

    /// Every fixture is a chain (each box has at most one child), so a child query is always
    /// nested inside its parent's scope. Binding an alias a second time would therefore shadow the
    /// outer one and silently decorrelate the subquery -- which is exactly what the inherited
    /// `used_keys` set exists to prevent.
    #[test]
    fn no_alias_is_bound_twice() {
        for (name, tree_json) in FIXTURES {
            let tree = parse(tree_json);
            for (i, node) in tree.nodes.iter().enumerate() {
                let (_, children) = node.to_box(i, &tree);
                assert!(children.len() <= 1, "{name} node {i} is not a chain");
            }
            for database in DATABASES {
                let sql = translate(tree_json, database);
                for (alias, count) in bound_aliases(&sql) {
                    if !is_table_alias(&alias) {
                        continue;
                    }
                    assert_eq!(
                        count, 1,
                        "{name} on {database:?} binds table alias {alias} {count} times:\n{sql}"
                    );
                }
            }
        }
    }

    #[test]
    fn parentheses_and_quotes_are_balanced() {
        for (name, tree_json) in FIXTURES {
            for database in DATABASES {
                let sql = translate(tree_json, database);
                let mut depth = 0i32;
                for c in sql.chars() {
                    match c {
                        '(' => depth += 1,
                        ')' => depth -= 1,
                        _ => {}
                    }
                    assert!(
                        depth >= 0,
                        "{name} on {database:?} closes too many parens:\n{sql}"
                    );
                }
                assert_eq!(
                    depth, 0,
                    "{name} on {database:?} leaves parens open:\n{sql}"
                );
                assert_eq!(
                    sql.matches('"').count() % 2,
                    0,
                    "{name} on {database:?} has an unterminated quoted identifier:\n{sql}"
                );
                assert_eq!(
                    sql.matches('\'').count() % 2,
                    0,
                    "{name} on {database:?} has an unterminated string literal:\n{sql}"
                );
            }
        }
    }

    /// The root SELECT is the query's contract with its caller: one column per variable of the
    /// root box, named after the variable, in variable-index order.
    #[test]
    fn root_select_list_mirrors_the_root_box_variables() {
        for (name, tree_json) in FIXTURES {
            let (obs, evs) = root_vars(&parse(tree_json));
            let expected: Vec<String> = obs
                .iter()
                .map(|n| format!("O{n}.ocel_id AS \"O{n}\"", n = n + 1))
                .chain(
                    evs.iter()
                        .map(|n| format!("E{n}.ocel_id AS \"E{n}\"", n = n + 1)),
                )
                .collect();
            for database in DATABASES {
                let sql = translate(tree_json, database);
                let head = format!("SELECT {}", expected.join(", "));
                assert!(
                    sql.starts_with(&head),
                    "{name} on {database:?} should start with\n{head}\nbut is\n{sql}"
                );
            }
        }
    }

    /// `SizeFilter::NumChilds` counts `SELECT DISTINCT <key columns>` over the child query, and the
    /// key aliases are derived twice: once when the child SELECT exposes them and once when the
    /// parent counts them. A name that only one side knows counts the wrong thing (or nothing).
    #[test]
    fn counted_key_columns_are_exposed_by_the_child_query() {
        let mut fixtures_with_keys = 0;
        for (name, tree_json) in FIXTURES {
            for database in DATABASES {
                let sql = translate(tree_json, database);
                let bound = bound_aliases(&sql);
                let counted: Vec<&str> = sql
                    .split_whitespace()
                    .flat_map(|w| w.split(','))
                    .filter(|w| w.starts_with("key_o") || w.starts_with("key_e"))
                    .collect();
                if !counted.is_empty() {
                    fixtures_with_keys += 1;
                }
                for key in counted {
                    assert!(
                        bound.contains_key(key),
                        "{name} on {database:?} counts {key}, which no child SELECT exposes:\n{sql}"
                    );
                }
            }
        }
        assert!(fixtures_with_keys > 0, "no fixture exercised NumChilds");
    }

    /// The two dialects are meant to differ in exactly one thing: how a timestamp column becomes
    /// seconds. Rewriting the SQLite form into the DuckDB form has to reproduce the DuckDB query
    /// byte for byte, so a dialect-specific construct added on only one side shows up here.
    #[test]
    fn sqlite_and_duckdb_differ_only_in_the_timestamp_function() {
        let strftime = regex::Regex::new(r"strftime\('%s', ([^)]*)\)").unwrap();
        let mut fixtures_with_timestamps = 0;
        for (name, tree_json) in FIXTURES {
            let sqlite = translate(tree_json, DatabaseType::SQLite);
            let duckdb = translate(tree_json, DatabaseType::DuckDB);
            if sqlite.contains("strftime") {
                fixtures_with_timestamps += 1;
            }
            assert!(
                !sqlite.contains("EPOCH("),
                "{name} emits EPOCH on SQLite:\n{sqlite}"
            );
            assert!(
                !duckdb.contains("strftime"),
                "{name} emits strftime on DuckDB:\n{duckdb}"
            );
            assert_eq!(
                strftime.replace_all(&sqlite, "EPOCH($1)"),
                duckdb,
                "{name} differs between the dialects beyond the timestamp function"
            );
        }
        assert!(
            fixtures_with_timestamps > 0,
            "no fixture exercised a timestamp comparison"
        );
    }

    /// `TableMappings` renames *types*, not tables: the `object_` / `event_` prefix is added
    /// afterwards. The junction entries are whole table names. Getting that backwards produces a
    /// query against a table that does not exist, which only fails once it is run.
    #[test]
    fn table_mappings_rename_types_and_junction_tables() {
        let sql = translate_to_sql_shared(DBTranslationInput {
            tree: parse(FIXTURES[3].1),
            database: DatabaseType::SQLite,
            table_mappings: TableMappings {
                object_tables: [("Application".to_string(), "app".to_string())]
                    .into_iter()
                    .collect(),
                event_tables: [("A_Accepted".to_string(), "acc".to_string())]
                    .into_iter()
                    .collect(),
                e2o_table: "my_e2o".to_string(),
                o2o_table: "my_o2o".to_string(),
            },
        });
        assert!(sql.contains("\"object_app\""), "{sql}");
        assert!(sql.contains("\"event_acc\""), "{sql}");
        assert!(sql.contains("\"my_e2o\""), "{sql}");
        assert!(sql.contains("\"my_o2o\""), "{sql}");
        // Unmapped types keep their own name, and the defaults are gone.
        assert!(sql.contains("\"object_Offer\""), "{sql}");
        assert!(!sql.contains("\"object_Application\""), "{sql}");
        assert!(!sql.contains("\"event_object\""), "{sql}");
        assert!(!sql.contains("\"object_object\""), "{sql}");
    }

    /// The edge name is what joins a parent constraint to a child result, and it also becomes the
    /// identifier the child subquery is wrapped in. Both derive it through `BindingBoxTree::
    /// edge_name`, so they agree by construction; this pins that the identifier is actually built
    /// from the name and not from the child index.
    #[test]
    fn the_edge_name_becomes_the_child_subquery_identifier() {
        let sql = translate(FIXTURES[0].1, DatabaseType::SQLite);
        assert!(sql.contains("AS child_0_0_A)"), "{sql}");
        assert!(sql.contains("AS child_0_0_A_d)"), "{sql}");

        let renamed = FIXTURES[0].1.replace(r#""A""#, r#""Submitted""#);
        let sql = translate(&renamed, DatabaseType::SQLite);
        assert!(sql.contains("AS child_0_0_Submitted)"), "{sql}");
        assert!(!sql.contains("child_0_0_A)"), "{sql}");
    }

    #[test]
    fn extract_basic_relations_keeps_only_the_relational_filters() {
        let relations = extract_basic_relations(vec![
            Filter::O2E {
                object: ObjectVariable(0),
                event: EventVariable(1),
                qualifier: Some("q".to_string()),
                filter_label: None,
            },
            Filter::NotEqual {
                var_1: Variable::Object(ObjectVariable(0)),
                var_2: Variable::Object(ObjectVariable(1)),
            },
            Filter::O2O {
                object: ObjectVariable(0),
                other_object: ObjectVariable(1),
                qualifier: None,
                filter_label: None,
            },
            Filter::BasicFilterCEL {
                cel: "true".to_string(),
            },
            Filter::TimeBetweenEvents {
                from_event: EventVariable(0),
                to_event: EventVariable(1),
                min_seconds: Some(1.0),
                max_seconds: None,
            },
        ]);
        assert_eq!(
            relations.len(),
            3,
            "the three non-relational ones are dropped"
        );
        assert!(matches!(
            relations[0],
            Relation::E2O {
                event: EventVariable(1),
                object: ObjectVariable(0),
                qualifier: Some(ref q),
            } if q == "q"
        ));
        assert!(matches!(
            relations[1],
            Relation::O2O {
                object_1: ObjectVariable(0),
                object_2: ObjectVariable(1),
                qualifier: None,
            }
        ));
        assert!(matches!(
            relations[2],
            Relation::TimeBetweenEvents {
                min_seconds: Some(1.0),
                max_seconds: None,
                ..
            }
        ));
    }

    /// The complement of the above: what `extract_basic_relations` leaves behind is what the WHERE
    /// builder gets, and only the two attribute filters are translatable there.
    #[test]
    fn extract_filters_keeps_only_the_attribute_filters() {
        let (filters, size_filters) = extract_filters(
            vec![
                Filter::O2E {
                    object: ObjectVariable(0),
                    event: EventVariable(0),
                    qualifier: None,
                    filter_label: None,
                },
                Filter::EventAttributeValueFilter {
                    event: EventVariable(0),
                    attribute_name: "amount".to_string(),
                    value_filter: ValueFilter::Integer {
                        min: Some(1),
                        max: None,
                    },
                },
                Filter::ObjectAttributeValueFilter {
                    object: ObjectVariable(0),
                    attribute_name: "state".to_string(),
                    at_time: ObjectValueFilterTimepoint::Sometime,
                    value_filter: ValueFilter::String {
                        is_in: vec!["ok".to_string()],
                    },
                },
                Filter::BasicFilterCEL {
                    cel: "true".to_string(),
                },
            ],
            vec![SizeFilter::NumChilds {
                child_name: "A".to_string(),
                min: Some(1),
                max: None,
            }],
        );
        assert_eq!(filters.len(), 2);
        assert!(matches!(
            filters[0],
            Filter::EventAttributeValueFilter { .. }
        ));
        assert!(matches!(
            filters[1],
            Filter::ObjectAttributeValueFilter { .. }
        ));
        assert_eq!(size_filters.len(), 1, "size filters pass through untouched");
    }

    /// A box with no relations at all still has to name its tables, and the child inherits the
    /// aliases the parent already used, so the child's own object table is a CROSS JOIN rather
    /// than a second binding of `O1`.
    #[test]
    fn a_child_that_introduces_its_own_object_gets_its_own_alias() {
        let sql = translate(FIXTURES[2].1, DatabaseType::SQLite);
        assert!(sql.contains("\"event_O_Returned\" AS E1"), "{sql}");
        assert!(sql.contains("\"object_Offer\" AS O2"), "{sql}");
        assert!(
            !sql.contains("AS O1"),
            "the root has no object variable:\n{sql}"
        );
    }
}
