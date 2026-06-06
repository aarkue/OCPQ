//! Row-context analysis helpers shared by the id-native SQL execution
//! path ([`super::sql_executor_id`] + [`super::row_context_id`]).
//!
//! The SQL emitter aliases each event variable as `E<n>` and each object
//! variable as `O<n>` in the outer SELECT (one-indexed). This module
//! provides the analysis primitives that consume those rows downstream:
//!
//! * [`analyze_var_access`]: parse each root-level CEL source and walk
//!   the AST to record which OCEL fields each `e<n>` / `o<n>` variable
//!   touches; consumers narrow per-type attribute projection accordingly.
//! * [`collect_cel_sources`]: gather every CEL string contributed by
//!   filters, AdvancedCEL bodies, and label functions in one pass.
//! * [`collect_ids_per_var`] / [`merge_child_ids_per_var`]: harvest
//!   the distinct `ocel_id` strings each variable surfaced in the row
//!   stream (parent + child variants of the column aliases).
//! * [`group_ids_by_type`] / [`access_per_type`]: project the per-
//!   variable views onto the candidate type pools the IR records, walking
//!   root + every child node so subset-OCEL builders cover the entire IR.
//! * [`normalized_to_ocel_attr`]: convert a decoded SQL value into the
//!   OCEL attribute value space.
//! * [`rewrite_aggregate_builtins`]: pre-fetch `numEvents()` /
//!   `numObjects()` and inline as integer literals before CEL compilation;
//!   the full-set CEL builtins `events()` / `objects()` are rejected
//!   upstream (`db_translation::validate_translatable`).

use std::collections::{HashMap, HashSet};

use dbcon::NormalizedValue;
use process_mining::core::event_data::object_centric::OCELAttributeValue;

use crate::binding_box::structs::{EventVariable, LabelFunction, ObjectVariable};
use crate::db_translation::InterMediateNode;

/// Per-variable record of which OCEL fields the CEL evaluator will read.
/// Used to narrow per-type attribute projection on the subset-OCEL fetch
/// path: `all_attrs = false` and `attrs = ∅` means the type only needs
/// `ocel_id` (plus `ocel_time` when `time = true`).
#[derive(Default, Debug, Clone)]
pub struct VarAccess {
    pub time: bool,
    pub all_attrs: bool,
    pub attrs: HashSet<String>,
}

impl VarAccess {
    pub fn needs_anything(&self) -> bool {
        self.time || self.all_attrs || !self.attrs.is_empty()
    }
}

/// Parse each CEL source string and walk the resulting AST for per-
/// variable surface accesses. Conservative: an access the walker cannot
/// narrow (`attrAt`, `attrs`, dynamic `attr` argument, unknown method)
/// flags `all_attrs = true`, so the resulting projection never drops a
/// column the CEL evaluator later reads.
pub fn analyze_var_access(
    cels: &[&str],
) -> (HashMap<EventVariable, VarAccess>, HashMap<ObjectVariable, VarAccess>) {
    let mut ev: HashMap<EventVariable, VarAccess> = HashMap::new();
    let mut ob: HashMap<ObjectVariable, VarAccess> = HashMap::new();
    for cel in cels {
        if let Ok(expr) = cel_parser::parse(cel) {
            walk_expr(&expr, &mut ev, &mut ob);
        }
    }
    (ev, ob)
}

fn walk_expr(
    expr: &cel_parser::Expression,
    ev: &mut HashMap<EventVariable, VarAccess>,
    ob: &mut HashMap<ObjectVariable, VarAccess>,
) {
    use cel_parser::Expression as E;
    match expr {
        E::Arithmetic(a, _, b) | E::Relation(a, _, b) | E::Or(a, b) | E::And(a, b) => {
            walk_expr(a, ev, ob);
            walk_expr(b, ev, ob);
        }
        E::Ternary(a, b, c) => {
            walk_expr(a, ev, ob);
            walk_expr(b, ev, ob);
            walk_expr(c, ev, ob);
        }
        E::Unary(_, a) => walk_expr(a, ev, ob),
        E::Member(target, _) => walk_expr(target, ev, ob),
        E::FunctionCall(name_expr, target, args) => {
            if let (Some(target_expr), E::Ident(method_arc)) = (target.as_deref(), name_expr.as_ref()) {
                if let Some(var) = parse_var_ident(target_expr) {
                    apply_method(method_arc.as_str(), args, var, ev, ob);
                }
                walk_expr(target_expr, ev, ob);
            } else if let Some(target_expr) = target.as_deref() {
                walk_expr(target_expr, ev, ob);
            }
            for a in args {
                walk_expr(a, ev, ob);
            }
            walk_expr(name_expr, ev, ob);
        }
        E::List(xs) => {
            for x in xs {
                walk_expr(x, ev, ob);
            }
        }
        E::Map(pairs) => {
            for (k, v) in pairs {
                walk_expr(k, ev, ob);
                walk_expr(v, ev, ob);
            }
        }
        E::Atom(_) | E::Ident(_) => {}
    }
}

fn parse_var_ident(expr: &cel_parser::Expression) -> Option<(bool, usize)> {
    if let cel_parser::Expression::Ident(name) = expr {
        let s = name.as_str();
        if s.len() < 2 {
            return None;
        }
        let kind = s.as_bytes()[0];
        if kind != b'e' && kind != b'o' {
            return None;
        }
        let n: usize = s[1..].parse().ok()?;
        if n == 0 {
            return None;
        }
        return Some((kind == b'e', n - 1));
    }
    None
}

fn apply_method(
    method: &str,
    args: &[cel_parser::Expression],
    (is_event, idx): (bool, usize),
    ev: &mut HashMap<EventVariable, VarAccess>,
    ob: &mut HashMap<ObjectVariable, VarAccess>,
) {
    let access = if is_event {
        ev.entry(EventVariable(idx)).or_default()
    } else {
        ob.entry(ObjectVariable(idx)).or_default()
    };
    match method {
        "attr" => match args.first() {
            Some(cel_parser::Expression::Atom(cel_parser::Atom::String(name))) => {
                access.attrs.insert(name.as_str().to_string());
            }
            _ => access.all_attrs = true,
        },
        "attrAt" | "attrs" => access.all_attrs = true,
        "time" => access.time = true,
        "id" | "type" => {}
        _ => access.all_attrs = true,
    }
}

/// Project per-variable access onto each candidate type in the IR.
/// Walks the root node and every child node so that any new event /
/// object variable a child introduces contributes its access hints to
/// the per-type aggregate (mirroring [`group_ids_by_type`]).
pub fn access_per_type(
    ev_access: &HashMap<EventVariable, VarAccess>,
    ob_access: &HashMap<ObjectVariable, VarAccess>,
    intermediate: &InterMediateNode,
) -> (HashMap<String, VarAccess>, HashMap<String, VarAccess>) {
    let mut ev: HashMap<String, VarAccess> = HashMap::new();
    let mut ob: HashMap<String, VarAccess> = HashMap::new();
    let merge = |entry: &mut VarAccess, a: &VarAccess| {
        entry.time |= a.time;
        entry.all_attrs |= a.all_attrs;
        entry.attrs.extend(a.attrs.iter().cloned());
    };
    let mut visit = |node: &InterMediateNode| {
        for (var, types) in &node.event_vars {
            if let Some(a) = ev_access.get(var) {
                for t in types {
                    merge(ev.entry(t.clone()).or_default(), a);
                }
            }
        }
        for (var, types) in &node.object_vars {
            if let Some(a) = ob_access.get(var) {
                for t in types {
                    merge(ob.entry(t.clone()).or_default(), a);
                }
            }
        }
    };
    walk_nodes(intermediate, &mut visit);
    (ev, ob)
}

/// Gather every root-level CEL source string for one pass of
/// [`analyze_var_access`].
pub fn collect_cel_sources<'a>(
    cel_predicates: &'a [String],
    advanced_cel: &'a [String],
    labels: &'a [LabelFunction],
) -> Vec<&'a str> {
    cel_predicates
        .iter()
        .chain(advanced_cel.iter())
        .map(|s| s.as_str())
        .chain(labels.iter().map(|l| l.cel.as_str()))
        .collect()
}

fn lookup_column<'a>(
    row: &'a [(String, NormalizedValue)],
    name: &str,
) -> Option<&'a NormalizedValue> {
    row.iter().find(|(c, _)| c == name).map(|(_, v)| v)
}

/// Convert a `NormalizedValue` decoded from a per-type attribute column to
/// the OCEL attribute value space. `Timestamp` becomes `OCELAttributeValue::Time`.
/// `Json`/`Unknown` are stringified.
pub fn normalized_to_ocel_attr(v: &NormalizedValue) -> Option<OCELAttributeValue> {
    match v {
        NormalizedValue::Null => None,
        NormalizedValue::Text(s) => Some(OCELAttributeValue::String(s.clone())),
        NormalizedValue::Integer(i) => Some(OCELAttributeValue::Integer(*i)),
        NormalizedValue::Float(f) => Some(OCELAttributeValue::Float(*f)),
        NormalizedValue::Boolean(b) => Some(OCELAttributeValue::Boolean(*b)),
        NormalizedValue::Timestamp(t) => Some(OCELAttributeValue::Time(*t)),
        NormalizedValue::Json(j) => Some(OCELAttributeValue::String(j.to_string())),
        NormalizedValue::Unknown(s) => Some(OCELAttributeValue::String(s.clone())),
    }
}

/// Walk the streamed row buffer once and collect, per binding-box variable,
/// the set of distinct `ocel_id` strings the rows projected. The SQL
/// emitter aliases each event variable `E<n>` and each object variable
/// `O<n>` in the outer SELECT (`E1`, `O1`, ...), one-indexed.
pub fn collect_ids_per_var(
    rows: &[Vec<(String, NormalizedValue)>],
    event_vars: &[EventVariable],
    object_vars: &[ObjectVariable],
) -> (
    HashMap<EventVariable, HashSet<String>>,
    HashMap<ObjectVariable, HashSet<String>>,
) {
    let mut ev: HashMap<EventVariable, HashSet<String>> = HashMap::new();
    let mut ob: HashMap<ObjectVariable, HashSet<String>> = HashMap::new();
    accumulate_ids_per_var(rows, event_vars, object_vars, "E", "O", &mut ev, &mut ob);
    (ev, ob)
}

/// Merge ids harvested from a child-binding row stream into the existing
/// per-variable maps. Child rows aliased the *new* event/object variables
/// as `key_e<n>` / `key_o<n>` (per `child_key_columns` in the SQL
/// emitter); parent variables appear unchanged as `E<n>` / `O<n>` because
/// the LATERAL outer SELECT projects them through.
pub fn merge_child_ids_per_var(
    rows: &[Vec<(String, NormalizedValue)>],
    parent_event_vars: &[EventVariable],
    parent_object_vars: &[ObjectVariable],
    child_event_vars: &[EventVariable],
    child_object_vars: &[ObjectVariable],
    ev: &mut HashMap<EventVariable, HashSet<String>>,
    ob: &mut HashMap<ObjectVariable, HashSet<String>>,
) {
    accumulate_ids_per_var(rows, parent_event_vars, parent_object_vars, "E", "O", ev, ob);
    accumulate_ids_per_var(
        rows,
        child_event_vars,
        child_object_vars,
        "key_e",
        "key_o",
        ev,
        ob,
    );
}

fn accumulate_ids_per_var(
    rows: &[Vec<(String, NormalizedValue)>],
    event_vars: &[EventVariable],
    object_vars: &[ObjectVariable],
    event_prefix: &str,
    object_prefix: &str,
    ev: &mut HashMap<EventVariable, HashSet<String>>,
    ob: &mut HashMap<ObjectVariable, HashSet<String>>,
) {
    for row in rows {
        for v in event_vars {
            let col = format!("{}{}", event_prefix, v.0 + 1);
            if let Some(val) = lookup_column(row, &col) {
                if let Some(id) = val.as_str() {
                    ev.entry(*v).or_default().insert(id.to_string());
                }
            }
        }
        for v in object_vars {
            let col = format!("{}{}", object_prefix, v.0 + 1);
            if let Some(val) = lookup_column(row, &col) {
                if let Some(id) = val.as_str() {
                    ob.entry(*v).or_default().insert(id.to_string());
                }
            }
        }
    }
}

/// Group a per-variable id collection by the candidate type pool the IR
/// records for that variable (`NewEventVariables[var]` / `NewObjectVariables[var]`).
/// A variable bound to multiple candidate types yields the same id set
/// under each candidate; downstream subset-fetches resolve which type the
/// id actually belongs to by issuing one `WHERE ocel_id IN (...)` per
/// (type, id-set) pair and keeping only rows that match.
pub fn group_ids_by_type(
    ev_ids_per_var: HashMap<EventVariable, HashSet<String>>,
    ob_ids_per_var: HashMap<ObjectVariable, HashSet<String>>,
    intermediate: &InterMediateNode,
) -> (HashMap<String, HashSet<String>>, HashMap<String, HashSet<String>>) {
    let mut ev_ids_per_type: HashMap<String, HashSet<String>> = HashMap::new();
    let mut ob_ids_per_type: HashMap<String, HashSet<String>> = HashMap::new();
    let mut visit = |node: &InterMediateNode| {
        for (var, ids) in &ev_ids_per_var {
            if let Some(types) = node.event_vars.get(var) {
                for t in types {
                    ev_ids_per_type
                        .entry(t.clone())
                        .or_default()
                        .extend(ids.iter().cloned());
                }
            }
        }
        for (var, ids) in &ob_ids_per_var {
            if let Some(types) = node.object_vars.get(var) {
                for t in types {
                    ob_ids_per_type
                        .entry(t.clone())
                        .or_default()
                        .extend(ids.iter().cloned());
                }
            }
        }
    };
    walk_nodes(intermediate, &mut visit);
    (ev_ids_per_type, ob_ids_per_type)
}

fn walk_nodes<F: FnMut(&InterMediateNode)>(node: &InterMediateNode, f: &mut F) {
    f(node);
    for (child, _label) in &node.children {
        walk_nodes(child, f);
    }
}

/// Return `true` if `node` or any descendant carries a *host-side* form whose
/// evaluation does not push down into SQL: a CEL filter (`Filter::BasicFilterCEL`
/// or `Constraint::Filter{BasicFilterCEL}`), an `AdvancedCEL` size-filter
/// (free-standing or via `Constraint::SizeFilter`), or a `LabelFunction`.
///
/// Drives the over-approximation policy: a parent's `Constraint::SAT/ANY/
/// NOT/OR/AND` or `SizeFilter::NumChilds*/BindingSet*Equal` referencing a
/// child whose subtree is host-side-affected can no longer rely on the
/// pushdown child SQL for an exact answer; the emitter relaxes (omits or
/// keeps only over-estimate-safe clauses) and the recursive host-side
/// executor re-checks against post-CEL child bindings.
pub fn subtree_has_host_side(node: &crate::db_translation::InterMediateNode) -> bool {
    use crate::binding_box::structs::{Constraint, Filter, SizeFilter};

    let mut found = false;
    let mut visit = |n: &crate::db_translation::InterMediateNode| {
        if found {
            return;
        }
        if !n.labels.is_empty() {
            found = true;
            return;
        }
        for f in &n.filter {
            if matches!(f, Filter::BasicFilterCEL { .. }) {
                found = true;
                return;
            }
        }
        for sf in &n.sizefilter {
            if matches!(sf, SizeFilter::AdvancedCEL { .. }) {
                found = true;
                return;
            }
        }
        for c in &n.constraints {
            match c {
                Constraint::Filter {
                    filter: Filter::BasicFilterCEL { .. },
                } => {
                    found = true;
                    return;
                }
                Constraint::SizeFilter {
                    filter: SizeFilter::AdvancedCEL { .. },
                } => {
                    found = true;
                    return;
                }
                _ => {}
            }
        }
    };
    walk_nodes(node, &mut visit);
    found
}

/// Substitute `numEvents()` / `numObjects()` builtins with their full-
/// dataset integer literals before CEL compilation. Pre-fetched once per
/// query via one `COUNT(*)` per surface table (events / objects).
/// The full-set CEL builtins `events()` and `objects()` are NOT rewritten:
/// they enumerate the entire id set and are rejected at translation time by
/// `validate_translatable`.
pub fn rewrite_aggregate_builtins(cel: &str, num_events: u64, num_objects: u64) -> String {
    let mut out = cel.to_string();
    out = replace_call(&out, "numEvents", &num_events.to_string());
    out = replace_call(&out, "numObjects", &num_objects.to_string());
    out
}

fn replace_call(src: &str, name: &str, repl: &str) -> String {
    let needle = format!("{}()", name);
    let mut out = String::with_capacity(src.len());
    let mut rest = src;
    while let Some(pos) = rest.find(&needle) {
        // Skip a match that is the tail of a longer identifier (e.g.
        // `mynumEvents()`); the in-memory engine treats it as a user symbol.
        let prev_is_word = rest[..pos]
            .chars()
            .next_back()
            .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
        out.push_str(&rest[..pos]);
        out.push_str(if prev_is_word { &needle } else { repl });
        rest = &rest[pos + needle.len()..];
    }
    out.push_str(rest);
    out
}
