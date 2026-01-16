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
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableMappings {
    pub event_tables: HashMap<String, String>,
    pub object_tables: HashMap<String, String>,
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
    tree: BindingBoxTree,
    database: DatabaseType,
    table_mappings: TableMappings,
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

    let constraints = extract_constraints(binding_box.constraints.clone());

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

// Extract Constraints we want to translate
pub fn extract_constraints(mut constraints: Vec<Constraint>) -> Vec<Constraint> {

    constraints.retain(|c| match c {
        Constraint::Filter { filter: _ } => false,
        Constraint::SizeFilter { filter: _ } => true,
        Constraint::SAT { child_names: _ } => true,
        Constraint::ANY { child_names: _ } => true,
        Constraint::NOT { child_names: _ } => true,
        Constraint::OR { child_names: _ } => true,
        Constraint::AND { child_names: _ } => true,
    });
    constraints

}

// Extract other meaningful filters (maybe these in relations are enough, but CEL could be considered)
pub fn extract_filters(
    filters: Vec<Filter>,
    size_filters: Vec<SizeFilter>,
) -> (Vec<Filter>, Vec<SizeFilter>) {
    let mut result = Vec::new();

    let mut result_size = Vec::new();

    for size_filter in &size_filters {
        match size_filter {
            SizeFilter::NumChilds {
                child_name: _,
                min: _,
                max: _,
            } => {
                result_size.push(size_filter.clone());
            }

            _ => {
                result_size.push(size_filter.clone()); // Take all for now
            }
        }
    }

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

    result.push_str(&sql_parts.select_fields.join(","));

    result.push('\n');

    // Handle Constraints and Childs here

    if !sql_parts.node.constraints.is_empty() {
        let child_constraint_string = construct_child_constraints(sql_parts);
        result.push_str(&format!(
            ",\nCASE WHEN {} THEN 1 ELSE 0 END AS satisfied \n",
            child_constraint_string
        ));
    }

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

pub fn construct_select_fields(sql_parts: &SqlParts) -> Vec<String> {
    let mut select_fields = Vec::new();

    for obj_var in sql_parts.node.object_vars.keys() {
        select_fields.push(format!("O{}.ocel_id", o_alias(obj_var.0)));
    }

    for event_var in sql_parts.node.event_vars.keys() {
        select_fields.push(format!("E{}.ocel_id", e_alias(event_var.0)));
    }

    select_fields
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
    let mut counter = 0;

    for relation in &sql_parts.node.relations {
        match relation {
            Relation::E2O {
                event,
                object,
                qualifier: _,
            } => {
                let event_alias = format!("E{}", e_alias(event.0));
                let object_alias = format!("O{}", o_alias(object.0));
                let mut event_object_alias = format!("E2O{}", counter);

                while sql_parts.used_keys.contains(&event_object_alias) {
                    counter += 1;
                    event_object_alias = format!("E2O{}", counter);
                }
                sql_parts.used_keys.insert(event_object_alias.clone());

                if is_first_join {
                    // first join to distinct if we have to use INNER JOIN first
                    if sql_parts.used_keys.contains(&event_alias) {
                        if sql_parts.used_keys.contains(&object_alias) {
                            from_clauses.push(format!("event_object AS {}", event_object_alias));
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
                                "INNER JOIN event_object AS {} ON {}.ocel_object_id = {}.ocel_id AND {}.ocel_event_id = {}.ocel_id",
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
                            "INNER JOIN event_object AS {} ON {}.ocel_object_id = {}.ocel_id AND {}.ocel_event_id = {}.ocel_id",
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
                            "INNER JOIN event_object AS {} ON {}.ocel_event_id = {}.ocel_id",
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
                            "INNER JOIN event_object AS {} ON {}.ocel_object_id = {}.ocel_id AND {}.ocel_event_id = {}.ocel_id",
                            event_object_alias, event_object_alias, object_alias, event_object_alias, event_alias
                        ));
                    } else {
                        // only event table
                        from_clauses.push(format!(
                            "INNER JOIN event_object AS {} ON {}.ocel_event_id = {}.ocel_id",
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
                        "INNER JOIN event_object AS {} ON {}.ocel_object_id = {}.ocel_id",
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
                        "INNER JOIN event_object AS {} ON {}.ocel_event_id = {}.ocel_id",
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
                let mut object_object_alias = format!("O2O{}", counter);

                while sql_parts.used_keys.contains(&object_object_alias) {
                    counter += 1;
                    object_object_alias = format!("O2O{}", counter);
                }
                sql_parts.used_keys.insert(object_object_alias.clone());

                if is_first_join {
                    if sql_parts.used_keys.contains(&object1_alias) {
                        if sql_parts.used_keys.contains(&object2_alias) {
                            from_clauses.push(format!("object_object AS {}", object_object_alias));
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
                                "INNER JOIN object_object AS {} ON {}.ocel_source_id = {}.ocel_id AND {}.ocel_target_id = {}.ocel_id",
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
                            "INNER JOIN object_object AS {} ON {}.ocel_source_id = {}.ocel_id AND {}.ocel_target_id = {}.ocel_id",
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
                            "INNER JOIN object_object AS {} ON {}.ocel_source_id = {}.ocel_id",
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
                            "INNER JOIN object_object AS {} ON {}.ocel_source_id = {}.ocel_id AND {}.ocel_target_id = {}.ocel_id",
                            object_object_alias, object_object_alias, object1_alias, object_object_alias, object2_alias
                        ));
                    } else {
                        from_clauses.push(format!(
                            "INNER JOIN object_object AS {} ON {}.ocel_source_id = {}.ocel_id",
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
                        "INNER JOIN object_object AS {} ON {}.ocel_target_id = {}.ocel_id",
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
                        "INNER JOIN object_object AS {} ON {}.ocel_source_id = {}.ocel_id",
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
                        "CROSS JOIN{} AS {}",
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
            } = relation {
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

    for (i, constraint) in sql_parts.node.constraints.iter().enumerate() {
        match constraint {
            Constraint::ANY { child_names } => {
                let mut parts = Vec::new();
                for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                    if child_names.contains(child_label) {
                        parts.push(format!(
                            "COALESCE((SELECT COUNT(*) FROM ({}) AS subqC_{i}_{j}_{label} WHERE subqC_{i}_{j}_{label}.satisfied = 1), 0) >= 1",
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
                            "NOT EXISTS (SELECT 1 FROM ({}) AS subqC_{iterator1}_{iterator2}_{label} WHERE subqC_{iterator1}_{iterator2}_{label}.satisfied = 0)",
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
                            "NOT EXISTS (SELECT 1 FROM ({}) AS subqC_{iterator1}_{iterator2}_{label} WHERE subqC_{iterator1}_{iterator2}_{label}.satisfied = 1)",
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
                            "NOT EXISTS (SELECT 1 FROM ({}) AS subqC_{iterator1}_{iterator2}_{label} WHERE subqC_{iterator1}_{iterator2}_{label}.satisfied = 0)",
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
                            "NOT EXISTS (SELECT 1 FROM ({}) AS subqC_{iterator1}_{iterator2}_{label} WHERE subqC_{iterator1}_{iterator2}_{label}.satisfied = 0)",
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
                            let count_expr = format!(
                            "COALESCE((SELECT COUNT(DISTINCT subqC_{i}_{j}_{label}.cnt_key) FROM ({}) AS subqC_{i}_{j}_{label}), 0)",
                            child_sql,
                            i = i,
                            j = j,
                            label = child_label.trim()
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
                    let base_alias = format!("E2O{}{}", event.0, object.0);
                    let mut alias = base_alias.clone();
                    let mut counter = 1;

                    while sql_parts.used_keys.contains(&alias) {
                        alias = format!("{}_{}", base_alias, counter);
                        counter += 1;
                    }

                    sql_parts.used_keys.insert(alias.clone());
                    result_string.push(format!(
                            "EXISTS (SELECT 1 FROM {} AS {} WHERE {}.ocel_event_id = E{}.ocel_id AND {}.ocel_object_id = O{}.ocel_id)",
                            map_eventttables(sql_parts, "object")
                            ,alias, alias, e_alias(event.0), alias, o_alias(object.0)
                        ));
                }

                Filter::O2O {
                    object,
                    other_object,
                    ..
                } => {
                    let base_alias = format!("O2O{}{}", object.0, other_object.0);
                    let mut alias = base_alias.clone();
                    let mut counter = 1;

                    while sql_parts.used_keys.contains(&alias) {
                        alias = format!("{}_{}", base_alias, counter);
                        counter += 1;
                    }

                    sql_parts.used_keys.insert(alias.clone());

                    result_string.push(format!(
                            "EXISTS (SELECT 1 FROM {} AS {} WHERE {}.ocel_source_id = O{}.ocel_id AND {}.ocel_target_id = O{}.ocel_id)",
                            map_objecttables(sql_parts, "object")
                            ,alias, alias, o_alias(object.0), alias, o_alias(other_object.0)
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
        let mut _tmp = Vec::new();

        _tmp.push(format!(
            "CASE WHEN {} THEN 1 ELSE 0 END AS satisfied",
            sub_condition
        ));

        let key_parts = construct_select_fields(sql_parts);

        match key_parts.len() {
            0 => {
                _tmp.push("1 AS cnt_key".to_string());
            }
            1 => {
                _tmp.push(format!("{} AS cnt_key", key_parts[0]));
            }
            _ => {
                let delim = "'|'";
                let concat = key_parts.join(&format!(" || {} || ", delim));
                _tmp.push(format!("({}) AS cnt_key", concat));
            }
        }

        _tmp
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
            } = sizefilter {
            for (j, (child_sql, child_label)) in sql_parts.child_sql.iter().enumerate() {
                if child_label == child_name {
                    let clause = match (min, max) {
                        (Some(min), Some(max)) =>
                            format!(
                                "COALESCE((SELECT COUNT(DISTINCT subqC_{i}_{j}_{label}.cnt_key) FROM ({}) AS subqC_{i}_{j}_{label}), 0) BETWEEN {} AND {}",
                                child_sql, min, max,
                                i = i,
                                j = j,
                                label = child_label.trim()
                            ),
                        (Some(min), None) =>
                            format!(
                                "COALESCE((SELECT COUNT(DISTINCT subqC_{i}_{j}_{label}.cnt_key) FROM ({}) AS subqC_{i}_{j}_{label}), 0) >= {}",
                                child_sql, min,
                                i = i,
                                j = j,
                                label = child_label.trim()
                            ),
                        (None, Some(max)) =>
                            format!(
                                "COALESCE((SELECT COUNT(DISTINCT subqC_{i}_{j}_{label}.cnt_key) FROM ({}) AS subqC_{i}_{j}_{label}), 0) <= {}",
                                child_sql, max,
                                i = i,
                                j = j,
                                label = child_label.trim()
                            ),
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
                let col = format!("E{}.\"{}\"", e_alias(event.0), attribute_name);

                let clause = match value_filter {
                    ValueFilter::String { is_in } => {
                        let values = is_in
                            .iter()
                            .map(|v| format!("'{}'", v.replace('\'', "''")))
                            .collect::<Vec<_>>()
                            .join(", ");
                        format!("{} IN ({})", col, values)
                    }

                    ValueFilter::Boolean { is_true } => {
                        format!("{} = {}", col, is_true)
                    }

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
                        if let Some(from) = from {
                            parts.push(format!(
                                "{time} >= '{from}'",
                                time = map_timestamp(sql_parts, col.clone())
                            ));
                        }
                        if let Some(to) = to {
                            parts.push(format!(
                                "{time2} <= '{to}'",
                                time2 = map_timestamp(sql_parts, col.clone())
                            ));
                        }
                        parts.join(" AND ")
                    }
                };

                result.push(clause);
            }

            Filter::ObjectAttributeValueFilter {
                object,
                attribute_name,
                at_time,
                value_filter,
            } => {
                let object_alias = format!("O{}", o_alias(object.0));
                let attr = attribute_name;
                let temp_alias = format!("OA{}", i);
                let value_sql = match value_filter {
                    ValueFilter::String { is_in } => {
                        let values = is_in
                            .iter()
                            .map(|v| format!("'{}'", v.replace('\'', "''")))
                            .collect::<Vec<_>>()
                            .join(", ");
                        format!("{}.{} IN ({})", object_alias, attr, values)
                    }
                    ValueFilter::Boolean { is_true } => {
                        format!("{}.{} = {}", object_alias, attr, is_true)
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
                        if let Some(from) = from {
                            parts.push(format!(
                                "{time_left} >= {time_right}",
                                time_left =
                                    map_timestamp(sql_parts, format!("{}.{}", object_alias, attr)),
                                time_right = map_timestamp(sql_parts, from.to_string())
                            ));
                        }
                        if let Some(to) = to {
                            parts.push(format!(
                                "{time_left} <= {time_right}",
                                time_left =
                                    map_timestamp(sql_parts, format!("{}.{}", object_alias, attr)),
                                time_right = map_timestamp(sql_parts, to.to_string())
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
                    let alias = format! {"O{}", object.0};
                    object_type = &sql_parts.alias_type_map[&alias];
                }

                let clause = match at_time {
                    ObjectValueFilterTimepoint::Sometime => {
                        let condition = value_sql;
                        format!(
                            "EXISTS (SELECT 1\n FROM {otype} AS OA{iterator}\n WHERE OA{iterator}.ocel_id = {oid} AND {cond})",
                            iterator = i,
                            otype = map_objecttables(sql_parts, object_type),
                            oid = format!("{}.ocel_id", object_alias),
                            cond = condition
                        )
                    }

                    ObjectValueFilterTimepoint::Always => {
                        let condition = value_sql;
                        format!(
                            "NOT EXISTS (SELECT 1\n FROM {otype} AS OA{iterator}\n WHERE OA{iterator}.ocel_id = {oid} AND NOT ({cond})
                            )",
                            iterator = i,
                            otype = map_objecttables(sql_parts, object_type),
                            oid = format!("{}.ocel_id", object_alias),
                            cond = condition
                        )
                    }

                    ObjectValueFilterTimepoint::AtEvent { event } => {
                        let event_time = format!("E{}.ocel_time", e_alias(event.0));
                        let condition = value_sql;
                        format!(
                            "EXISTS (SELECT 1\n FROM {otype} AS OA{iterator}
                            WHERE OA{iterator}.ocel_id = {oid} AND OA{iterator}.ocel_time = (SELECT MAX(OA2{iterator2}.ocel_time)
                            FROM {otype} AS OA2{iterator2}\n WHERE OA2{iterator2}.ocel_id = {oid} AND {time_left} <= {time_right}) AND {cond})",
                            iterator = i,
                            iterator2 = i*3,
                            time_left = map_timestamp(sql_parts, format!("OA2{}.ocel_time", i*3)),
                            time_right = map_timestamp(sql_parts, event_time ),
                            otype = map_objecttables(sql_parts, object_type),
                            oid = format!("{}.ocel_id", object_alias),
                            cond = condition
                        )
                    }
                };

                result.push(clause);
            }

            _ => {}
        }
    }

    result
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

pub struct CypherParts {
    node: InterMediateNode,
    match_clauses: Vec<String>,
    child_queries: Vec<(String, String)>,
    where_clauses: Vec<String>,
    return_clauses: Vec<String>,
    used_alias: HashSet<String>,
    event_tables: HashMap<String, String>,
    object_tables: HashMap<String, String>,
    alias_type: HashMap<String, String>,
}

pub fn translate_to_cypher_shared(tree: BindingBoxTree) -> String {
    // Convert to Intermediate

    let inter = convert_to_intermediate(tree);

    let mut cypher_parts = CypherParts {
        node: inter,
        match_clauses: vec![],
        child_queries: vec![],
        where_clauses: vec![],
        return_clauses: vec![],
        used_alias: HashSet::new(),
        event_tables: HashMap::new(),
        object_tables: HashMap::new(),
        alias_type: HashMap::new(),
    };

    get_event_table_cypher(&mut cypher_parts);

    get_object_table_cypher(&mut cypher_parts);

    

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

                let mut mapped_event_type = cypher_parts
                    .event_tables
                    .get(&event_type)
                    .cloned()
                    .unwrap_or_else(|| "no type found event".to_string());

                let mut mapped_object_type = cypher_parts
                    .object_tables
                    .get(&object_type)
                    .cloned()
                    .unwrap_or_else(|| "no type found object".to_string());

                if mapped_event_type == "no type found event"
                    && mapped_event_type == "no type found event" {
                        mapped_event_type = cypher_parts
                            .alias_type
                            .get(&event_alias)
                            .cloned()
                            .unwrap_or_else(|| "unknown".to_string());
                    }

                if mapped_object_type == "no type found object" {
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
                    .object_tables
                    .get(&object1_type)
                    .cloned()
                    .unwrap_or_else(|| "no type found object".to_string());

                let mut mapped_object2_type = cypher_parts
                    .object_tables
                    .get(&object2_type)
                    .cloned()
                    .unwrap_or_else(|| "no type found object".to_string());

                if mapped_object1_type == "no type found object" {
                    mapped_object1_type = cypher_parts
                        .alias_type
                        .get(&object1_alias)
                        .cloned()
                        .unwrap_or_else(|| "unknown".to_string());
                }

                if mapped_object2_type == "no type found object" {
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
                let type1 = &cypher_parts.object_tables[&object_type.clone()];
                cypher_parts.match_clauses.push(format!(
                    "({}:{})",
                    key,
                    &cypher_parts.object_tables[&object_type.clone()]
                ));
                cypher_parts.used_alias.insert(key.clone());
                cypher_parts.alias_type.insert(key, type1.to_string());
            }
        }
    }

    for (event_var, types) in &cypher_parts.node.event_vars {
        for event_type in types {
            let key = format!("e{}", e_alias(event_var.0));
            if !cypher_parts.used_alias.contains(&key) {
                let type1 = &cypher_parts.event_tables[&event_type.clone()];
                cypher_parts.match_clauses.push(format!(
                    "({}:{})",
                    key,
                    &cypher_parts.event_tables[&event_type.clone()]
                ));
                cypher_parts.used_alias.insert(key.clone());
                cypher_parts.alias_type.insert(key, type1.to_string());
            }
        }
    }
}

pub fn get_event_table_cypher(cypher_parts: &mut CypherParts) {
    // Order Management
    cypher_parts
        .event_tables
        .insert("confirm order".to_string(), "confirmorder".to_string());
    cypher_parts
        .event_tables
        .insert("create package".to_string(), "createpackage".to_string());
    cypher_parts
        .event_tables
        .insert("failed delivery".to_string(), "faileddelivery".to_string());
    cypher_parts.event_tables.insert(
        "item out of stock".to_string(),
        "itemoutofstock".to_string(),
    );
    cypher_parts.event_tables.insert(
        "package delivered".to_string(),
        "packagedelivered".to_string(),
    );
    cypher_parts
        .event_tables
        .insert("pay order".to_string(), "payorder".to_string());
    cypher_parts.event_tables.insert(
        "payment reminder".to_string(),
        "paymentreminder".to_string(),
    );
    cypher_parts
        .event_tables
        .insert("pick item".to_string(), "pickitem".to_string());
    cypher_parts
        .event_tables
        .insert("place order".to_string(), "placeorder".to_string());
    cypher_parts
        .event_tables
        .insert("reorder item".to_string(), "reorderitem".to_string());
    cypher_parts
        .event_tables
        .insert("send package".to_string(), "sendpackage".to_string());

    // Bpic
    cypher_parts
        .event_tables
        .insert("A_Accepted".to_string(), "A_Accepted".to_string());
    cypher_parts
        .event_tables
        .insert("A_Cancelled".to_string(), "A_Cancelled".to_string());
    cypher_parts
        .event_tables
        .insert("A_Complete".to_string(), "A_Complete".to_string());
    cypher_parts
        .event_tables
        .insert("A_Concept".to_string(), "A_Concept".to_string());
    cypher_parts.event_tables.insert(
        "A_Create Application".to_string(),
        "A_CreateApplication".to_string(),
    );
    cypher_parts
        .event_tables
        .insert("A_Denied".to_string(), "A_Denied".to_string());
    cypher_parts
        .event_tables
        .insert("A_Incomplete".to_string(), "A_Incomplete".to_string());
    cypher_parts
        .event_tables
        .insert("A_Pending".to_string(), "A_Pending".to_string());
    cypher_parts
        .event_tables
        .insert("A_Submitted".to_string(), "A_Submitted".to_string());
    cypher_parts
        .event_tables
        .insert("A_Validating".to_string(), "A_Validating".to_string());

    cypher_parts
        .event_tables
        .insert("O_Accepted".to_string(), "O_Accepted".to_string());
    cypher_parts
        .event_tables
        .insert("O_Cancelled".to_string(), "O_Cancelled".to_string());
    cypher_parts
        .event_tables
        .insert("O_Create Offer".to_string(), "O_CreateOffer".to_string());
    cypher_parts
        .event_tables
        .insert("O_Created".to_string(), "o_Created".to_string());
    cypher_parts
        .event_tables
        .insert("O_Refused".to_string(), "O_Refused".to_string());
    cypher_parts
        .event_tables
        .insert("O_Returned".to_string(), "O_Returned".to_string());
    cypher_parts.event_tables.insert(
        "O_Sent (mail and online)".to_string(),
        "O_Sent(mailandonline)".to_string(),
    );
    cypher_parts.event_tables.insert(
        "O_Sent (online only)".to_string(),
        "O_Sent (online only)".to_string(),
    );

    cypher_parts.event_tables.insert(
        "W_Assess potential fraud".to_string(),
        "W_Assesspotentialfraud".to_string(),
    );
    cypher_parts.event_tables.insert(
        "W_Call after offers".to_string(),
        "W_Callafteroffers".to_string(),
    );
    cypher_parts.event_tables.insert(
        "W_Call incomplete files".to_string(),
        "W_Callincompletefiles".to_string(),
    );
    cypher_parts.event_tables.insert(
        "W_Complete application".to_string(),
        "W_Completeapplication".to_string(),
    );
    cypher_parts
        .event_tables
        .insert("W_Handle leads".to_string(), "W_Handle leads".to_string());
    cypher_parts.event_tables.insert(
        "W_Personal Loan collection".to_string(),
        "W_PersonalLoancollection".to_string(),
    );
    cypher_parts.event_tables.insert(
        "W_Shorten completion".to_string(),
        "W_Shortencompletion".to_string(),
    );
    cypher_parts.event_tables.insert(
        "W_Validate application".to_string(),
        "W_Validateapplication".to_string(),
    );

    //Container
    cypher_parts.event_tables.insert(
        "Register Customer Order".to_string(),
        "RegisterCustomerOrder".to_string(),
    );
    cypher_parts.event_tables.insert(
        "Create Transport Document".to_string(),
        "CreateTransportDocument".to_string(),
    );
    cypher_parts
        .event_tables
        .insert("Book Vehicles".to_string(), "BookVehicles".to_string());
    cypher_parts.event_tables.insert(
        "Order Empty Containers".to_string(),
        "OrderEmptyContainers".to_string(),
    );
    cypher_parts.event_tables.insert(
        "Pick Up Empty Container".to_string(),
        "PickUpEmptyContainer".to_string(),
    );
    cypher_parts
        .event_tables
        .insert("Collect Goods".to_string(), "CollectGoods".to_string());
    cypher_parts
        .event_tables
        .insert("Load Truck".to_string(), "LoadTruck".to_string());
    cypher_parts.event_tables.insert(
        "Drive to Terminal".to_string(),
        "DrivetoTerminal".to_string(),
    );
    cypher_parts
        .event_tables
        .insert("Weigh".to_string(), "Weigh".to_string());
    cypher_parts
        .event_tables
        .insert("Place in Stock".to_string(), "PlaceinStock".to_string());
    cypher_parts.event_tables.insert(
        "Bring to Loading Bay".to_string(),
        "BringtoLoadingBay".to_string(),
    );
    cypher_parts
        .event_tables
        .insert("Load to Vehicle".to_string(), "LoadtoVehicle".to_string());
    cypher_parts.event_tables.insert(
        "Reschedule Container".to_string(),
        "RescheduleContainer".to_string(),
    );
    cypher_parts
        .event_tables
        .insert("Depart".to_string(), "Depart".to_string());
}

pub fn get_object_table_cypher(cypher_parts: &mut CypherParts) {
    // Order Management
    cypher_parts
        .object_tables
        .insert("customers".to_string(), "customers".to_string());
    cypher_parts
        .object_tables
        .insert("employees".to_string(), "employees".to_string());
    cypher_parts
        .object_tables
        .insert("items".to_string(), "items".to_string());
    cypher_parts
        .object_tables
        .insert("orders".to_string(), "orders".to_string());
    cypher_parts
        .object_tables
        .insert("packages".to_string(), "packages".to_string());
    cypher_parts
        .object_tables
        .insert("products".to_string(), "products".to_string());

    // Bpic
    cypher_parts
        .object_tables
        .insert("Application".to_string(), "application".to_string());
    cypher_parts
        .object_tables
        .insert("Case_R".to_string(), "Case_R".to_string());
    cypher_parts
        .object_tables
        .insert("Offer".to_string(), "Offer".to_string());
    cypher_parts
        .object_tables
        .insert("Workflow".to_string(), "Workflow".to_string());

    // Order Management
    cypher_parts
        .object_tables
        .insert("Customer Order".to_string(), "CustomerOrder".to_string());
    cypher_parts.object_tables.insert(
        "Transport Document".to_string(),
        "TransportDocument".to_string(),
    );
    cypher_parts
        .object_tables
        .insert("Container".to_string(), "Container".to_string());
    cypher_parts
        .object_tables
        .insert("Truck".to_string(), "Truck".to_string());
    cypher_parts
        .object_tables
        .insert("Handling Unit".to_string(), "HandlingUnit".to_string());
    cypher_parts
        .object_tables
        .insert("Forklift".to_string(), "Forklift".to_string());
    cypher_parts
        .object_tables
        .insert("Vehicle".to_string(), "Vehicle".to_string());
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
            } = sizefilter {
            for (child_cypher, child_label) in
                cypher_parts.child_queries.iter()
            {
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
            } = filter {
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
        let mut child_cypheer_parts = CypherParts {
            node: inter_node.clone(),
            match_clauses: vec![],
            child_queries: vec![],
            return_clauses: vec![],
            where_clauses: vec![],
            event_tables: cypher_parts.event_tables.clone(),
            object_tables: cypher_parts.object_tables.clone(),
            used_alias: cypher_parts.used_alias.clone(),
            alias_type: cypher_parts.alias_type.clone(),
        };

        let child_cypher = translate_to_cypher_from_child(&mut child_cypheer_parts);
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
