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
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    let result_size: Vec<SizeFilter> = size_filters.iter().cloned().collect();

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

pub fn construct_select_fields_root(sql_parts: &SqlParts) -> Vec<String> {
    let mut select_fields = Vec::new();

    for obj_var in sql_parts.node.object_vars.keys() {
        select_fields.push(format!(
            "O{}.ocel_id AS \"O{}\"",
            o_alias(obj_var.0),
            o_alias(obj_var.0)
        ));
    }

    for event_var in sql_parts.node.event_vars.keys() {
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
        for (obj_var, types) in &sql_parts.node.object_vars {
            for object_type in types {
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

        for (event_var, types) in &sql_parts.node.event_vars {
            for event_type in types {
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

        for (obj_var, types) in &sql_parts.node.object_vars {
            for object_type in types {
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

        for (event_var, types) in &sql_parts.node.event_vars {
            for event_type in types {
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
                let mut mapped_event_type =
                    cypher_parts.table_mappings.event_table(&event_type).to_string();
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

    for (obj_var, types) in &cypher_parts.node.object_vars {
        for object_type in types {
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

    for (event_var, types) in &cypher_parts.node.event_vars {
        for event_type in types {
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
