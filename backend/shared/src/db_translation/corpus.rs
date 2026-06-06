//! Bounded enumeration of OCPQ `BindingBoxTree` instances for differential
//! evaluation between the in-memory engine and a SQL backend.
//!
//! The generator is deterministic: same
//! `(CorpusSchema, CorpusBounds, OCELInfo)` -> same `Vec<CorpusEntry>` in
//! the same order.
//!
//! Per-node bounds: `|V_E^N| <= 2`, `|V_O^N| <= 2`, `|R^N|` unbounded. Per-tree:
//! `depth <= 2`, children per parent `<= 2`. Connectedness enforced recursively:
//! the root's E2O/O2O graph is a single connected component; descendants must
//! reach an ancestor variable through their own E2O/O2O edges. `TBE` does not
//! participate in connectedness.
//!
//! Templates (CEL, attribute-value, advanced CEL, label) are supplied per
//! dataset. Templates that reference variable kinds absent from a shape are
//! skipped at instantiation time, so e.g. a CEL template over `e_1` is never
//! emitted for a shape with no event variables.

use crate::binding_box::structs::{
    BindingBox, BindingBoxTreeNode, Constraint, EventVariable, Filter, LabelFunction,
    NewEventVariables, NewObjectVariables, ObjectValueFilterTimepoint, ObjectVariable, SizeFilter,
    ValueFilter, Variable,
};
use crate::binding_box::BindingBoxTree;
use crate::OCELInfo;
use process_mining::core::event_data::object_centric::linked_ocel::{
    LinkedOCELAccess, SlimLinkedOCEL,
};
use std::collections::{HashMap, HashSet};

/// Dataset-specific inputs to the generator: type pool and template pools.
#[derive(Debug, Clone)]
pub struct CorpusSchema {
    pub dataset_name: String,
    pub event_types: Vec<String>,
    pub object_types: Vec<String>,

    /// CEL-expression templates referencing variables symbolically (e.g.
    /// `e1.attr("Foo") == "X"`). Instantiated per shape; templates are
    /// gated against the lex-first event/object variable's actual OCEL type.
    pub cel_templates: Vec<CelTemplate>,

    /// Structured attribute-value filter templates. Instantiated by binding to
    /// the lex-first variable of matching kind+type in the shape.
    pub attribute_filter_templates: Vec<AttrFilterTemplate>,

    /// Advanced-CEL templates referencing `<child_label>`; used for the
    /// depth-1 `AdvancedCEL` size-filter slot.
    pub adv_cel_templates: Vec<String>,

    /// Label-function templates referencing variables symbolically. Templates
    /// are gated against the lex-first event/object variable's actual OCEL
    /// type (per `applicable_event_types` / `applicable_object_types`).
    pub label_templates: Vec<LabelTemplate>,
}

#[derive(Debug, Clone)]
pub struct AttrFilterTemplate {
    pub var_kind: VarKind,
    /// Restrict to a specific OCEL type name. `None` matches any type.
    pub var_type: Option<String>,
    pub attribute_name: String,
    pub value_filter: ValueFilter,
}

#[derive(Debug, Clone)]
pub struct CelTemplate {
    pub cel: String,
    /// If the CEL references `e1`, the template is only emitted when the
    /// lex-first event variable's OCEL type is in this list. Empty = no
    /// event-type restriction (kind gating still applies).
    pub applicable_event_types: Vec<String>,
    /// Same for `o1` against the lex-first object variable.
    pub applicable_object_types: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct LabelTemplate {
    pub label_name: String,
    pub cel: String,
    pub applicable_event_types: Vec<String>,
    pub applicable_object_types: Vec<String>,
}

/// Structural budget. `|V_E^N| <= max_events` and `|V_O^N| <= max_objects`
/// per node. `R` is unbounded (within feasibility).
#[derive(Debug, Clone)]
pub struct CorpusBounds {
    pub max_events: usize,
    pub max_objects: usize,
    pub max_depth: usize,
    pub max_children: usize,
    /// Optional cap on `|V_E^N| + |V_O^N|` per node. When `Some(s)`, shapes
    /// with more total fresh variables are skipped. `None` = no extra cap
    /// (defer to `max_events` / `max_objects`).
    pub max_var_sum: Option<usize>,
}

impl Default for CorpusBounds {
    fn default() -> Self {
        CorpusBounds {
            max_events: 2,
            max_objects: 2,
            max_depth: 2,
            max_children: 2,
            max_var_sum: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
#[repr(u8)]
pub enum VarKind {
    Event = 0,
    Object = 1,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CorpusTreeTag {
    pub n_events: usize,
    pub n_objects: usize,
    pub has_o2o: bool,
    pub has_tbe: bool,
    pub has_cel: bool,
    pub has_not_equal: bool,
    pub has_num_childs_proj: bool,
    pub has_adv_cel: bool,
    pub has_binding_set_eq: bool,
    pub has_binding_set_proj_eq: bool,
    pub has_attribute_filter: bool,
    pub has_label: bool,
    /// Constraint variant if a C-slot composition rule is present:
    /// "ANY" | "SAT" | "AND" | "OR" | "NOT".
    pub composition: Option<String>,
    /// Form name of a `Constraint::Filter{F}` companion layered on one
    /// bbox of the tree: `"NotEqual"`, `"TBE"`, `"O2E"`, `"O2O"`,
    /// `"EventAttr"`, `"ObjectAttr"`, or `"BasicFilterCEL"`. `None` if no
    /// constraint-mode wrap is layered.
    pub has_constraint_layered: Option<String>,
    /// Bbox position the layered constraint targets: `"root"`, `"child"`,
    /// or `"grandchild"`.
    pub constraint_layered_at: Option<String>,
    pub depth: usize,
    pub n_children: usize,
    pub event_types: Vec<String>,
    pub object_types: Vec<String>,
}

impl Default for CorpusTreeTag {
    fn default() -> Self {
        CorpusTreeTag {
            n_events: 0,
            n_objects: 0,
            has_o2o: false,
            has_tbe: false,
            has_cel: false,
            has_not_equal: false,
            has_num_childs_proj: false,
            has_adv_cel: false,
            has_binding_set_eq: false,
            has_binding_set_proj_eq: false,
            has_attribute_filter: false,
            has_label: false,
            composition: None,
            has_constraint_layered: None,
            constraint_layered_at: None,
            depth: 0,
            n_children: 0,
            event_types: Vec::new(),
            object_types: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub struct CorpusEntry {
    pub tag: CorpusTreeTag,
    pub tree: BindingBoxTree,
}

// Shape primitives

/// Basic relation edge over variable indices local to the shape's node. Indices
/// are global within the tree (root introduces 0..n, child introduces n..n+k,
/// etc.).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Edge {
    /// `E2O(e_i, o_j)`.
    E2O(usize, usize),
    /// `O2O(o_a, o_b)`, ordered, `a != b`.
    O2O(usize, usize),
    /// `TimeBetweenEvents(e_i, e_j)`, ordered, `i != j`. Excluded from
    /// connectedness graph.
    TBE(usize, usize),
}

impl Edge {
    fn is_connectivity(&self) -> bool {
        !matches!(self, Edge::TBE(_, _))
    }
}

/// Enumerate possible edges over given event/object var-index ranges.
/// Order: E2O lex-first, then O2O, then TBE.
fn enumerate_edges(
    ev_indices: &[usize],
    ob_indices: &[usize],
) -> Vec<Edge> {
    let mut out = Vec::new();
    for &i in ev_indices {
        for &j in ob_indices {
            out.push(Edge::E2O(i, j));
        }
    }
    for &j in ob_indices {
        for &k in ob_indices {
            if j != k {
                out.push(Edge::O2O(j, k));
            }
        }
    }
    for &i in ev_indices {
        for &j in ev_indices {
            if i != j {
                out.push(Edge::TBE(i, j));
            }
        }
    }
    out
}

/// Union-find used by the connectedness check.
struct UnionFind {
    parent: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        UnionFind { parent: (0..n).collect() }
    }
    fn find(&mut self, x: usize) -> usize {
        let mut r = x;
        while self.parent[r] != r {
            r = self.parent[r];
        }
        let mut cur = x;
        while self.parent[cur] != r {
            let next = self.parent[cur];
            self.parent[cur] = r;
            cur = next;
        }
        r
    }
    fn union(&mut self, a: usize, b: usize) {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra != rb {
            self.parent[ra] = rb;
        }
    }
}

/// Map a (kind, var_index) pair into a stable union-find slot. The caller
/// supplies an `(kind, idx) -> slot` lookup built from the sorted node-local
/// variable list.
fn slot_of(
    pairs: &[(VarKind, usize)],
    kind: VarKind,
    idx: usize,
) -> Option<usize> {
    pairs.iter().position(|&(k, i)| k == kind && i == idx)
}

/// Build the slot-index map for all variables that connectedness must cover.
fn build_var_slots(
    ancestor_evs: &[usize],
    ancestor_obs: &[usize],
    fresh_evs: &[usize],
    fresh_obs: &[usize],
) -> Vec<(VarKind, usize)> {
    let mut out = Vec::with_capacity(
        ancestor_evs.len() + ancestor_obs.len() + fresh_evs.len() + fresh_obs.len(),
    );
    for &i in ancestor_evs {
        out.push((VarKind::Event, i));
    }
    for &j in ancestor_obs {
        out.push((VarKind::Object, j));
    }
    for &i in fresh_evs {
        out.push((VarKind::Event, i));
    }
    for &j in fresh_obs {
        out.push((VarKind::Object, j));
    }
    out
}

/// Root connectedness: every variable in `V_E ∪ V_O` lies in a single
/// connected component induced by E2O/O2O edges.
fn is_root_connected(edges: &[Edge], n_e: usize, n_o: usize) -> bool {
    if n_e == 0 && n_o == 0 {
        return false;
    }
    let mut slots = Vec::with_capacity(n_e + n_o);
    for i in 0..n_e {
        slots.push((VarKind::Event, i));
    }
    for j in 0..n_o {
        slots.push((VarKind::Object, j));
    }
    let mut uf = UnionFind::new(slots.len());
    for e in edges {
        if !e.is_connectivity() {
            continue;
        }
        match e {
            Edge::E2O(i, j) => {
                let a = slot_of(&slots, VarKind::Event, *i).unwrap();
                let b = slot_of(&slots, VarKind::Object, *j).unwrap();
                uf.union(a, b);
            }
            Edge::O2O(j, k) => {
                let a = slot_of(&slots, VarKind::Object, *j).unwrap();
                let b = slot_of(&slots, VarKind::Object, *k).unwrap();
                uf.union(a, b);
            }
            Edge::TBE(_, _) => {}
        }
    }
    // Every variable must be incident to >=1 edge and all in one component.
    let mut covered = vec![false; slots.len()];
    for e in edges {
        if !e.is_connectivity() {
            continue;
        }
        match e {
            Edge::E2O(i, j) => {
                covered[slot_of(&slots, VarKind::Event, *i).unwrap()] = true;
                covered[slot_of(&slots, VarKind::Object, *j).unwrap()] = true;
            }
            Edge::O2O(j, k) => {
                covered[slot_of(&slots, VarKind::Object, *j).unwrap()] = true;
                covered[slot_of(&slots, VarKind::Object, *k).unwrap()] = true;
            }
            Edge::TBE(_, _) => {}
        }
    }
    if !covered.iter().all(|b| *b) {
        return false;
    }
    let root = uf.find(0);
    (0..slots.len()).all(|s| uf.find(s) == root)
}

/// Non-root connectedness: every fresh variable shares a connected component
/// (under this node's E2O/O2O edges + ancestor anchors implicit in the edges)
/// with at least one ancestor variable.
///
/// `ancestor_evs`, `ancestor_obs`: variable indices contributed by ancestors.
/// `fresh_evs`, `fresh_obs`: variables introduced fresh at this node.
/// The edges may reference any of these.
fn is_descendant_connected(
    edges: &[Edge],
    ancestor_evs: &[usize],
    ancestor_obs: &[usize],
    fresh_evs: &[usize],
    fresh_obs: &[usize],
) -> bool {
    if fresh_evs.is_empty() && fresh_obs.is_empty() {
        return true;
    }
    let slots = build_var_slots(ancestor_evs, ancestor_obs, fresh_evs, fresh_obs);
    let mut uf = UnionFind::new(slots.len());
    for e in edges {
        if !e.is_connectivity() {
            continue;
        }
        match e {
            Edge::E2O(i, j) => {
                if let (Some(a), Some(b)) = (
                    slot_of(&slots, VarKind::Event, *i),
                    slot_of(&slots, VarKind::Object, *j),
                ) {
                    uf.union(a, b);
                }
            }
            Edge::O2O(j, k) => {
                if let (Some(a), Some(b)) = (
                    slot_of(&slots, VarKind::Object, *j),
                    slot_of(&slots, VarKind::Object, *k),
                ) {
                    uf.union(a, b);
                }
            }
            Edge::TBE(_, _) => {}
        }
    }
    // For every fresh variable, its component must contain at least one
    // ancestor variable.
    let ancestor_count = ancestor_evs.len() + ancestor_obs.len();
    if ancestor_count == 0 {
        // No ancestors to anchor to: treat like a root component check
        // (single component covering all fresh variables).
        let mut covered = vec![false; slots.len()];
        for e in edges {
            if !e.is_connectivity() {
                continue;
            }
            match e {
                Edge::E2O(i, j) => {
                    if let Some(a) = slot_of(&slots, VarKind::Event, *i) {
                        covered[a] = true;
                    }
                    if let Some(b) = slot_of(&slots, VarKind::Object, *j) {
                        covered[b] = true;
                    }
                }
                Edge::O2O(j, k) => {
                    if let Some(a) = slot_of(&slots, VarKind::Object, *j) {
                        covered[a] = true;
                    }
                    if let Some(b) = slot_of(&slots, VarKind::Object, *k) {
                        covered[b] = true;
                    }
                }
                Edge::TBE(_, _) => {}
            }
        }
        if !covered.iter().all(|b| *b) {
            return false;
        }
        let root = uf.find(0);
        return (0..slots.len()).all(|s| uf.find(s) == root);
    }
    let ancestor_slots: Vec<usize> = (0..ancestor_count).collect();
    let ancestor_roots: HashSet<usize> =
        ancestor_slots.iter().map(|&s| uf.find(s)).collect();
    for s in ancestor_count..slots.len() {
        if !ancestor_roots.contains(&uf.find(s)) {
            return false;
        }
    }
    true
}

// Type assignment

fn support_e2o(info: &OCELInfo, ev_type: &str, ob_type: &str) -> usize {
    info.e2o_types
        .get(ev_type)
        .and_then(|m| m.get(ob_type))
        .map(|(c, _)| *c)
        .unwrap_or(0)
}

fn support_o2o(info: &OCELInfo, src: &str, dst: &str) -> usize {
    info.o2o_types
        .get(src)
        .and_then(|m| m.get(dst))
        .map(|(c, _)| *c)
        .unwrap_or(0)
}

/// Lex-first type assignment for the variables introduced *at this node only*
/// that satisfies every edge's data-support constraint. The shape's edges may
/// also reference ancestor variable indices; in that case the caller passes
/// the already-fixed ancestor type assignment via `fixed_evs` / `fixed_obs`.
///
/// Returns `Some((fresh_ev_types, fresh_ob_types))`.
fn assign_fresh_types(
    fresh_ev_indices: &[usize],
    fresh_ob_indices: &[usize],
    fixed_evs: &HashMap<usize, String>,
    fixed_obs: &HashMap<usize, String>,
    edges: &[Edge],
    schema: &CorpusSchema,
    info: &OCELInfo,
) -> Option<(HashMap<usize, String>, HashMap<usize, String>)> {
    let n_ev_pool = schema.event_types.len().max(1);
    let n_ob_pool = schema.object_types.len().max(1);
    if !fresh_ev_indices.is_empty() && schema.event_types.is_empty() {
        return None;
    }
    if !fresh_ob_indices.is_empty() && schema.object_types.is_empty() {
        return None;
    }
    let total: u128 =
        (n_ev_pool as u128).pow(fresh_ev_indices.len() as u32)
            * (n_ob_pool as u128).pow(fresh_ob_indices.len() as u32);
    for tup_idx in 0..total {
        let mut rem = tup_idx;
        let mut ev_pool_idx: Vec<usize> = vec![0; fresh_ev_indices.len()];
        let mut ob_pool_idx: Vec<usize> = vec![0; fresh_ob_indices.len()];
        for k in (0..fresh_ob_indices.len()).rev() {
            ob_pool_idx[k] = (rem % n_ob_pool as u128) as usize;
            rem /= n_ob_pool as u128;
        }
        for k in (0..fresh_ev_indices.len()).rev() {
            ev_pool_idx[k] = (rem % n_ev_pool as u128) as usize;
            rem /= n_ev_pool as u128;
        }
        let mut fresh_evs: HashMap<usize, String> = HashMap::default();
        for (slot, &var_idx) in fresh_ev_indices.iter().enumerate() {
            fresh_evs.insert(var_idx, schema.event_types[ev_pool_idx[slot]].clone());
        }
        let mut fresh_obs: HashMap<usize, String> = HashMap::default();
        for (slot, &var_idx) in fresh_ob_indices.iter().enumerate() {
            fresh_obs.insert(var_idx, schema.object_types[ob_pool_idx[slot]].clone());
        }

        let resolve_ev = |idx: usize| -> Option<&str> {
            fixed_evs
                .get(&idx)
                .map(|s| s.as_str())
                .or_else(|| fresh_evs.get(&idx).map(|s| s.as_str()))
        };
        let resolve_ob = |idx: usize| -> Option<&str> {
            fixed_obs
                .get(&idx)
                .map(|s| s.as_str())
                .or_else(|| fresh_obs.get(&idx).map(|s| s.as_str()))
        };
        let mut ok = true;
        for e in edges {
            match e {
                Edge::E2O(i, j) => match (resolve_ev(*i), resolve_ob(*j)) {
                    (Some(et), Some(ot)) => {
                        if support_e2o(info, et, ot) == 0 {
                            ok = false;
                            break;
                        }
                    }
                    _ => {
                        ok = false;
                        break;
                    }
                },
                Edge::O2O(a, b) => match (resolve_ob(*a), resolve_ob(*b)) {
                    (Some(at), Some(bt)) => {
                        if support_o2o(info, at, bt) == 0 {
                            ok = false;
                            break;
                        }
                    }
                    _ => {
                        ok = false;
                        break;
                    }
                },
                Edge::TBE(_, _) => {}
            }
        }
        if ok {
            return Some((fresh_evs, fresh_obs));
        }
    }
    None
}

// Edge subset enumeration

/// Enumerate every non-empty subset of `pool`. Order: bitmask ascending so
/// shapes appear lex-first by inclusion.
fn nonempty_subsets(pool: &[Edge]) -> Vec<Vec<Edge>> {
    let n = pool.len();
    if n == 0 || n > 24 {
        return Vec::new();
    }
    let total: u64 = 1u64 << n;
    let mut out: Vec<Vec<Edge>> = Vec::with_capacity(total as usize - 1);
    for mask in 1..total {
        let mut subset: Vec<Edge> = Vec::with_capacity(mask.count_ones() as usize);
        for (i, e) in pool.iter().enumerate() {
            if (mask >> i) & 1 == 1 {
                subset.push(*e);
            }
        }
        out.push(subset);
    }
    out
}

// BindingBox construction helpers

fn fresh_bbox(
    fresh_ev_types: &HashMap<usize, String>,
    fresh_ob_types: &HashMap<usize, String>,
    edges: &[Edge],
) -> BindingBox {
    let mut new_event_vars: NewEventVariables = HashMap::default();
    let mut new_object_vars: NewObjectVariables = HashMap::default();
    let mut filters: Vec<Filter> = Vec::new();
    for (idx, t) in fresh_ev_types {
        let mut hs: HashSet<String> = HashSet::new();
        hs.insert(t.clone());
        new_event_vars.insert(EventVariable(*idx), hs);
    }
    for (idx, t) in fresh_ob_types {
        let mut hs: HashSet<String> = HashSet::new();
        hs.insert(t.clone());
        new_object_vars.insert(ObjectVariable(*idx), hs);
    }
    for edge in edges {
        match edge {
            Edge::E2O(i, j) => filters.push(Filter::O2E {
                object: ObjectVariable(*j),
                event: EventVariable(*i),
                qualifier: None,
                filter_label: None,
            }),
            Edge::O2O(a, b) => filters.push(Filter::O2O {
                object: ObjectVariable(*a),
                other_object: ObjectVariable(*b),
                qualifier: None,
                filter_label: None,
            }),
            Edge::TBE(i, j) => filters.push(Filter::TimeBetweenEvents {
                from_event: EventVariable(*i),
                to_event: EventVariable(*j),
                min_seconds: Some(0.0),
                max_seconds: None,
            }),
        }
    }
    BindingBox {
        new_event_vars,
        new_object_vars,
        filters,
        size_filters: Vec::new(),
        constraints: Vec::new(),
        ev_var_labels: HashMap::default(),
        ob_var_labels: HashMap::default(),
        labels: Vec::new(),
    }
}

// Tag emission helpers

fn collect_var_types(
    ev_types: &HashMap<usize, String>,
    ob_types: &HashMap<usize, String>,
) -> (Vec<String>, Vec<String>) {
    let mut e: Vec<(usize, String)> = ev_types.iter().map(|(k, v)| (*k, v.clone())).collect();
    e.sort_by_key(|x| x.0);
    let mut o: Vec<(usize, String)> = ob_types.iter().map(|(k, v)| (*k, v.clone())).collect();
    o.sort_by_key(|x| x.0);
    (
        e.into_iter().map(|x| x.1).collect(),
        o.into_iter().map(|x| x.1).collect(),
    )
}

fn root_tag(
    root_ev_types: &HashMap<usize, String>,
    root_ob_types: &HashMap<usize, String>,
    root_edges: &[Edge],
) -> CorpusTreeTag {
    let (evt, obt) = collect_var_types(root_ev_types, root_ob_types);
    CorpusTreeTag {
        n_events: root_ev_types.len(),
        n_objects: root_ob_types.len(),
        has_o2o: root_edges.iter().any(|e| matches!(e, Edge::O2O(_, _))),
        has_tbe: root_edges.iter().any(|e| matches!(e, Edge::TBE(_, _))),
        event_types: evt,
        object_types: obt,
        ..CorpusTreeTag::default()
    }
}

// Child / grandchild shape enumeration

/// Normalized child shapes per spec section 7.2.
#[derive(Debug, Clone, Copy)]
enum ChildShape {
    /// α: 1 fresh event var, E2O to parent object var.
    Alpha,
    /// β: 1 fresh object var, O2O from parent object var.
    Beta,
    /// γ: 1 fresh event var + 1 fresh object var, E2O(fresh_e, fresh_o) + O2O(parent_o, fresh_o).
    Gamma,
}

/// Concrete instantiation of a child shape: fresh variable indices, fresh-
/// variable types, and the edge set.
struct InstantiatedChild {
    fresh_ev_indices: Vec<usize>,
    fresh_ob_indices: Vec<usize>,
    fresh_ev_types: HashMap<usize, String>,
    fresh_ob_types: HashMap<usize, String>,
    edges: Vec<Edge>,
}

impl InstantiatedChild {
    fn has_o2o(&self) -> bool {
        self.edges.iter().any(|e| matches!(e, Edge::O2O(_, _)))
    }
}

/// Try to instantiate a child shape anchored to `anchor_o` (an object variable
/// from `ancestor_obs`) with fresh indices starting at `next_ev`/`next_ob`.
fn try_build_child(
    shape: ChildShape,
    anchor_o: usize,
    next_ev: usize,
    next_ob: usize,
    ancestor_evs: &[usize],
    ancestor_obs: &[usize],
    fixed_ev_types: &HashMap<usize, String>,
    fixed_ob_types: &HashMap<usize, String>,
    schema: &CorpusSchema,
    info: &OCELInfo,
) -> Option<InstantiatedChild> {
    if !ancestor_obs.contains(&anchor_o) {
        return None;
    }
    let (fresh_evs, fresh_obs, edges) = match shape {
        ChildShape::Alpha => {
            let e_idx = next_ev;
            (
                vec![e_idx],
                Vec::new(),
                vec![Edge::E2O(e_idx, anchor_o)],
            )
        }
        ChildShape::Beta => {
            let o_idx = next_ob;
            (
                Vec::new(),
                vec![o_idx],
                vec![Edge::O2O(anchor_o, o_idx)],
            )
        }
        ChildShape::Gamma => {
            let e_idx = next_ev;
            let o_idx = next_ob;
            (
                vec![e_idx],
                vec![o_idx],
                vec![
                    Edge::E2O(e_idx, o_idx),
                    Edge::O2O(anchor_o, o_idx),
                ],
            )
        }
    };
    // Connectedness with ancestor anchor.
    if !is_descendant_connected(&edges, ancestor_evs, ancestor_obs, &fresh_evs, &fresh_obs) {
        return None;
    }
    let (fresh_ev_types, fresh_ob_types) = assign_fresh_types(
        &fresh_evs,
        &fresh_obs,
        fixed_ev_types,
        fixed_ob_types,
        &edges,
        schema,
        info,
    )?;
    Some(InstantiatedChild {
        fresh_ev_indices: fresh_evs,
        fresh_ob_indices: fresh_obs,
        fresh_ev_types,
        fresh_ob_types,
        edges,
    })
}

// Template resolution

/// Detect which variable kinds a CEL template references by looking at
/// substring patterns `e1`, `e2`, ..., `o1`, `o2`, ... Determines whether the
/// template can be instantiated on a shape with the given counts.
fn cel_refs_kinds(cel: &str) -> (bool, bool) {
    let mut refs_event = false;
    let mut refs_object = false;
    let bytes = cel.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let prev_alpha =
            i > 0 && (bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_');
        if !prev_alpha
            && (c == b'e' || c == b'o')
            && i + 1 < bytes.len()
            && bytes[i + 1].is_ascii_digit()
        {
            if c == b'e' {
                refs_event = true;
            } else {
                refs_object = true;
            }
        }
        i += 1;
    }
    (refs_event, refs_object)
}

/// Replace `<child_label>` with `child_name` in advanced-CEL templates.
fn instantiate_adv_cel(template: &str, child_name: &str) -> String {
    template.replace("<child_label>", child_name)
}

/// Lex-first type by variable index. Returns `None` if the map is empty.
fn lex_first_type(var_types: &HashMap<usize, String>) -> Option<&str> {
    var_types.iter().min_by_key(|(k, _)| *k).map(|(_, v)| v.as_str())
}

/// Does the CEL template apply against the root shape's variables?
///
/// Kind gate: if the CEL references `e<n>` and the shape has no event variables
/// (or `o<n>` and no object variables), the template is rejected.
///
/// Type gate: if `applicable_event_types` is non-empty and the CEL references
/// `e<n>`, the lex-first event variable's type must be in the list. Same for
/// `applicable_object_types`. Empty list = no type restriction (kind gate only).
fn cel_template_applies(
    cel: &str,
    applicable_event_types: &[String],
    applicable_object_types: &[String],
    root_ev_types: &HashMap<usize, String>,
    root_ob_types: &HashMap<usize, String>,
) -> bool {
    let (refs_e, refs_o) = cel_refs_kinds(cel);
    if refs_e {
        if root_ev_types.is_empty() {
            return false;
        }
        if !applicable_event_types.is_empty() {
            let t = lex_first_type(root_ev_types).expect("non-empty");
            if !applicable_event_types.iter().any(|a| a == t) {
                return false;
            }
        }
    }
    if refs_o {
        if root_ob_types.is_empty() {
            return false;
        }
        if !applicable_object_types.is_empty() {
            let t = lex_first_type(root_ob_types).expect("non-empty");
            if !applicable_object_types.iter().any(|a| a == t) {
                return false;
            }
        }
    }
    true
}

/// Find indices of variables of `kind`+`var_type` in the root shape.
fn vars_of_kind_type(
    kind: VarKind,
    target_type: Option<&str>,
    ev_types: &HashMap<usize, String>,
    ob_types: &HashMap<usize, String>,
) -> Vec<usize> {
    match kind {
        VarKind::Event => {
            let mut out: Vec<usize> = ev_types
                .iter()
                .filter(|(_, t)| target_type.is_none_or(|tt| t.as_str() == tt))
                .map(|(k, _)| *k)
                .collect();
            out.sort();
            out
        }
        VarKind::Object => {
            let mut out: Vec<usize> = ob_types
                .iter()
                .filter(|(_, t)| target_type.is_none_or(|tt| t.as_str() == tt))
                .map(|(k, _)| *k)
                .collect();
            out.sort();
            out
        }
    }
}

// NotEqual candidates (root same-kind same-type pairs)

fn not_equal_candidates_typed(
    ev_types: &HashMap<usize, String>,
    ob_types: &HashMap<usize, String>,
) -> Vec<(Variable, Variable)> {
    let mut out: Vec<(Variable, Variable)> = Vec::new();
    let mut ev_pairs: Vec<(usize, String)> =
        ev_types.iter().map(|(k, v)| (*k, v.clone())).collect();
    ev_pairs.sort_by_key(|x| x.0);
    for i in 0..ev_pairs.len() {
        for j in (i + 1)..ev_pairs.len() {
            if ev_pairs[i].1 == ev_pairs[j].1 {
                out.push((
                    Variable::Event(EventVariable(ev_pairs[i].0)),
                    Variable::Event(EventVariable(ev_pairs[j].0)),
                ));
            }
        }
    }
    let mut ob_pairs: Vec<(usize, String)> =
        ob_types.iter().map(|(k, v)| (*k, v.clone())).collect();
    ob_pairs.sort_by_key(|x| x.0);
    for i in 0..ob_pairs.len() {
        for j in (i + 1)..ob_pairs.len() {
            if ob_pairs[i].1 == ob_pairs[j].1 {
                out.push((
                    Variable::Object(ObjectVariable(ob_pairs[i].0)),
                    Variable::Object(ObjectVariable(ob_pairs[j].0)),
                ));
            }
        }
    }
    out
}

// Composition operator helper

#[derive(Debug, Clone, Copy)]
enum CompOp {
    Any,
    Sat,
    And,
    Or,
    Not,
}

impl CompOp {
    fn as_str(&self) -> &'static str {
        match self {
            CompOp::Any => "ANY",
            CompOp::Sat => "SAT",
            CompOp::And => "AND",
            CompOp::Or => "OR",
            CompOp::Not => "NOT",
        }
    }
    fn build(&self, child_names: Vec<String>) -> Constraint {
        match self {
            CompOp::Any => Constraint::ANY { child_names },
            CompOp::Sat => Constraint::SAT { child_names },
            CompOp::And => Constraint::AND { child_names },
            CompOp::Or => Constraint::OR { child_names },
            CompOp::Not => Constraint::NOT { child_names },
        }
    }
}

// Main driver

/// Generate the corpus.
pub fn generate_corpus(
    schema: &CorpusSchema,
    bounds: &CorpusBounds,
    info: &OCELInfo,
) -> Vec<CorpusEntry> {
    let mut out: Vec<CorpusEntry> = Vec::new();

    for n_e in 0..=bounds.max_events {
        for n_o in 0..=bounds.max_objects {
            if let Some(s) = bounds.max_var_sum {
                if n_e + n_o > s {
                    continue;
                }
            }
            // Trivial shapes (0 or 1 variable) are vacuously connected with an
            // empty `R`. The shape carries no relation edges; emit the base
            // tree (plus the standard layered features applied by `emit_layers`).
            if n_e + n_o <= 1 {
                // Single variable: check type-pool non-empty for the kind.
                if n_e == 1 && schema.event_types.is_empty() {
                    continue;
                }
                if n_o == 1 && schema.object_types.is_empty() {
                    continue;
                }
                let ev_indices: Vec<usize> = (0..n_e).collect();
                let ob_indices: Vec<usize> = (0..n_o).collect();
                let fixed_evs: HashMap<usize, String> = HashMap::default();
                let fixed_obs: HashMap<usize, String> = HashMap::default();
                let edges: Vec<Edge> = Vec::new();
                if let Some((ev_types, ob_types)) = assign_fresh_types(
                    &ev_indices,
                    &ob_indices,
                    &fixed_evs,
                    &fixed_obs,
                    &edges,
                    schema,
                    info,
                ) {
                    emit_layers(&edges, &ev_types, &ob_types, schema, bounds, info, &mut out);
                } else if n_e == 0 && n_o == 0 {
                    // assign_fresh_types may bail on no variables; emit the
                    // trivially empty-bbox tree directly.
                    let ev_types: HashMap<usize, String> = HashMap::default();
                    let ob_types: HashMap<usize, String> = HashMap::default();
                    emit_layers(&edges, &ev_types, &ob_types, schema, bounds, info, &mut out);
                }
                continue;
            }
            // Root-level edge pool over indices 0..n_e (events) and 0..n_o (objects).
            let ev_indices: Vec<usize> = (0..n_e).collect();
            let ob_indices: Vec<usize> = (0..n_o).collect();
            let pool = enumerate_edges(&ev_indices, &ob_indices);

            for edges in nonempty_subsets(&pool) {
                if !is_root_connected(&edges, n_e, n_o) {
                    continue;
                }
                // Type assignment for the root variables.
                let fixed_evs: HashMap<usize, String> = HashMap::default();
                let fixed_obs: HashMap<usize, String> = HashMap::default();
                let (ev_types, ob_types) = match assign_fresh_types(
                    &ev_indices,
                    &ob_indices,
                    &fixed_evs,
                    &fixed_obs,
                    &edges,
                    schema,
                    info,
                ) {
                    Some(v) => v,
                    None => continue,
                };
                emit_layers(&edges, &ev_types, &ob_types, schema, bounds, info, &mut out);
            }
        }
    }
    out
}

// Constraint-mode companion enumeration

/// Does `existing` already contain a Filter structurally equivalent to `cand`?
/// Variable disequality and the basic relations (E2O/O2O/TBE) are matched
/// by their unordered variable set; attribute filters are matched by
/// (var, attribute_name); CEL by its body string.
fn filter_already_present(existing: &[Filter], cand: &Filter) -> bool {
    for f in existing {
        if filter_eq(f, cand) {
            return true;
        }
    }
    false
}

fn filter_eq(a: &Filter, b: &Filter) -> bool {
    match (a, b) {
        (
            Filter::NotEqual { var_1: a1, var_2: a2 },
            Filter::NotEqual { var_1: b1, var_2: b2 },
        ) => (a1 == b1 && a2 == b2) || (a1 == b2 && a2 == b1),
        (
            Filter::O2E { object: oa, event: ea, .. },
            Filter::O2E { object: ob, event: eb, .. },
        ) => oa == ob && ea == eb,
        (
            Filter::O2O { object: oa, other_object: oa2, .. },
            Filter::O2O { object: ob, other_object: ob2, .. },
        ) => (oa == ob && oa2 == ob2) || (oa == ob2 && oa2 == ob),
        (
            Filter::TimeBetweenEvents { from_event: fa, to_event: ta, .. },
            Filter::TimeBetweenEvents { from_event: fb, to_event: tb, .. },
        ) => (fa == fb && ta == tb) || (fa == tb && ta == fb),
        (
            Filter::EventAttributeValueFilter { event: ea, attribute_name: na, .. },
            Filter::EventAttributeValueFilter { event: eb, attribute_name: nb, .. },
        ) => ea == eb && na == nb,
        (
            Filter::ObjectAttributeValueFilter { object: oa, attribute_name: na, .. },
            Filter::ObjectAttributeValueFilter { object: ob, attribute_name: nb, .. },
        ) => oa == ob && na == nb,
        (Filter::BasicFilterCEL { cel: ca }, Filter::BasicFilterCEL { cel: cb }) => ca == cb,
        _ => false,
    }
}

/// Enumerate every `(Constraint::Filter{F}, form_name)` candidate for a
/// bbox with the given variable scope and existing filters. Deterministic
/// ordering: schema templates first (EventAttr, ObjectAttr, BasicFilterCEL
/// [root only]), then structural fallback NotEqual, TBE, O2E, O2O.
fn eligible_constraint_filters(
    scope_ev_types: &HashMap<usize, String>,
    scope_ob_types: &HashMap<usize, String>,
    existing_filters: &[Filter],
    is_root: bool,
    schema: &CorpusSchema,
) -> Vec<(Constraint, &'static str)> {
    let mut out: Vec<(Constraint, &'static str)> = Vec::new();

    // EventAttr / ObjectAttr: mirror existing attribute_filter_templates.
    for tmpl in &schema.attribute_filter_templates {
        let candidates = vars_of_kind_type(
            tmpl.var_kind,
            tmpl.var_type.as_deref(),
            scope_ev_types,
            scope_ob_types,
        );
        if let Some(&v_idx) = candidates.first() {
            let f = match tmpl.var_kind {
                VarKind::Event => Filter::EventAttributeValueFilter {
                    event: EventVariable(v_idx),
                    attribute_name: tmpl.attribute_name.clone(),
                    value_filter: tmpl.value_filter.clone(),
                },
                VarKind::Object => Filter::ObjectAttributeValueFilter {
                    object: ObjectVariable(v_idx),
                    attribute_name: tmpl.attribute_name.clone(),
                    at_time: ObjectValueFilterTimepoint::Sometime,
                    value_filter: tmpl.value_filter.clone(),
                },
            };
            if filter_already_present(existing_filters, &f) {
                continue;
            }
            let name = match tmpl.var_kind {
                VarKind::Event => "EventAttr",
                VarKind::Object => "ObjectAttr",
            };
            out.push((Constraint::Filter { filter: f }, name));
        }
    }

    // BasicFilterCEL: root only; mirror schema.cel_templates with the
    // same gating as the existing depth-0 filter-mode emission.
    if is_root {
        for tmpl in &schema.cel_templates {
            if !cel_template_applies(
                &tmpl.cel,
                &tmpl.applicable_event_types,
                &tmpl.applicable_object_types,
                scope_ev_types,
                scope_ob_types,
            ) {
                continue;
            }
            let f = Filter::BasicFilterCEL { cel: tmpl.cel.clone() };
            if filter_already_present(existing_filters, &f) {
                continue;
            }
            out.push((Constraint::Filter { filter: f }, "BasicFilterCEL"));
        }
    }

    // NotEqual: every same-typed pair.
    for (v1, v2) in not_equal_candidates_typed(scope_ev_types, scope_ob_types) {
        let f = Filter::NotEqual { var_1: v1, var_2: v2 };
        if filter_already_present(existing_filters, &f) {
            continue;
        }
        out.push((Constraint::Filter { filter: f }, "NotEqual"));
    }

    // TBE: every ordered event pair (i, j) with i != j.
    let mut ev_indices: Vec<usize> = scope_ev_types.keys().copied().collect();
    ev_indices.sort();
    for &i in &ev_indices {
        for &j in &ev_indices {
            if i == j {
                continue;
            }
            let f = Filter::TimeBetweenEvents {
                from_event: EventVariable(i),
                to_event: EventVariable(j),
                min_seconds: Some(0.0),
                max_seconds: None,
            };
            if filter_already_present(existing_filters, &f) {
                continue;
            }
            out.push((Constraint::Filter { filter: f }, "TBE"));
        }
    }

    // O2E: every (event, object) pair.
    let mut ob_indices: Vec<usize> = scope_ob_types.keys().copied().collect();
    ob_indices.sort();
    for &e in &ev_indices {
        for &o in &ob_indices {
            let f = Filter::O2E {
                object: ObjectVariable(o),
                event: EventVariable(e),
                qualifier: None,
                filter_label: None,
            };
            if filter_already_present(existing_filters, &f) {
                continue;
            }
            out.push((Constraint::Filter { filter: f }, "O2E"));
        }
    }

    // O2O: every ordered object pair (a, b) with a != b.
    for &a in &ob_indices {
        for &b in &ob_indices {
            if a == b {
                continue;
            }
            let f = Filter::O2O {
                object: ObjectVariable(a),
                other_object: ObjectVariable(b),
                qualifier: None,
                filter_label: None,
            };
            if filter_already_present(existing_filters, &f) {
                continue;
            }
            out.push((Constraint::Filter { filter: f }, "O2O"));
        }
    }

    out
}

/// Build child0's variable scope (root ancestors + child.fresh).
fn child0_scope(
    root_ev: &HashMap<usize, String>,
    root_ob: &HashMap<usize, String>,
    child_ev: &HashMap<usize, String>,
    child_ob: &HashMap<usize, String>,
) -> (HashMap<usize, String>, HashMap<usize, String>) {
    let mut ev = root_ev.clone();
    let mut ob = root_ob.clone();
    for (k, v) in child_ev {
        ev.insert(*k, v.clone());
    }
    for (k, v) in child_ob {
        ob.insert(*k, v.clone());
    }
    (ev, ob)
}

/// Pick the first eligible `Constraint::Filter{F}` companion for a child
/// bbox of a composition tree. Returns the chosen constraint and the form
/// name to tag with, or `None` if no candidate fits.
fn pick_composition_child_constraint(
    root_ev: &HashMap<usize, String>,
    root_ob: &HashMap<usize, String>,
    child_ev: &HashMap<usize, String>,
    child_ob: &HashMap<usize, String>,
    child_filters: &[Filter],
    schema: &CorpusSchema,
) -> Option<(Constraint, &'static str)> {
    let (scope_ev, scope_ob) =
        child0_scope(root_ev, root_ob, child_ev, child_ob);
    let mut candidates = eligible_constraint_filters(
        &scope_ev,
        &scope_ob,
        child_filters,
        false, /* is_root */
        schema,
    );
    if candidates.is_empty() {
        None
    } else {
        Some(candidates.remove(0))
    }
}

/// Emit all depth-0/1/2 layered variants for one connected typed root shape.
fn emit_layers(
    root_edges: &[Edge],
    root_ev_types: &HashMap<usize, String>,
    root_ob_types: &HashMap<usize, String>,
    schema: &CorpusSchema,
    bounds: &CorpusBounds,
    info: &OCELInfo,
    out: &mut Vec<CorpusEntry>,
) {
    let base_tag = root_tag(root_ev_types, root_ob_types, root_edges);

    // Depth 0: base tree (R only).
    {
        let bbox = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        out.push(CorpusEntry {
            tag: base_tag.clone(),
            tree: BindingBoxTree {
                nodes: vec![BindingBoxTreeNode::Box(bbox, Vec::new())],
                edge_names: HashMap::default(),
            },
        });
    }

    // Depth 0 + NotEqual.
    for (v1, v2) in not_equal_candidates_typed(root_ev_types, root_ob_types) {
        let mut bbox = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        bbox.filters.push(Filter::NotEqual { var_1: v1, var_2: v2 });
        let mut tag = base_tag.clone();
        tag.has_not_equal = true;
        out.push(CorpusEntry {
            tag,
            tree: BindingBoxTree {
                nodes: vec![BindingBoxTreeNode::Box(bbox, Vec::new())],
                edge_names: HashMap::default(),
            },
        });
    }

    // Depth 0 + CEL filter.
    for tmpl in &schema.cel_templates {
        if !cel_template_applies(
            &tmpl.cel,
            &tmpl.applicable_event_types,
            &tmpl.applicable_object_types,
            root_ev_types,
            root_ob_types,
        ) {
            continue;
        }
        let mut bbox = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        bbox.filters
            .push(Filter::BasicFilterCEL { cel: tmpl.cel.clone() });
        let mut tag = base_tag.clone();
        tag.has_cel = true;
        out.push(CorpusEntry {
            tag,
            tree: BindingBoxTree {
                nodes: vec![BindingBoxTreeNode::Box(bbox, Vec::new())],
                edge_names: HashMap::default(),
            },
        });
    }

    // Depth 0 + attribute-value filter.
    for tmpl in &schema.attribute_filter_templates {
        let candidates = vars_of_kind_type(
            tmpl.var_kind,
            tmpl.var_type.as_deref(),
            root_ev_types,
            root_ob_types,
        );
        if let Some(&v_idx) = candidates.first() {
            let mut bbox = fresh_bbox(root_ev_types, root_ob_types, root_edges);
            let f = match tmpl.var_kind {
                VarKind::Event => Filter::EventAttributeValueFilter {
                    event: EventVariable(v_idx),
                    attribute_name: tmpl.attribute_name.clone(),
                    value_filter: tmpl.value_filter.clone(),
                },
                VarKind::Object => Filter::ObjectAttributeValueFilter {
                    object: ObjectVariable(v_idx),
                    attribute_name: tmpl.attribute_name.clone(),
                    at_time: ObjectValueFilterTimepoint::Sometime,
                    value_filter: tmpl.value_filter.clone(),
                },
            };
            bbox.filters.push(f);
            let mut tag = base_tag.clone();
            tag.has_attribute_filter = true;
            out.push(CorpusEntry {
                tag,
                tree: BindingBoxTree {
                    nodes: vec![BindingBoxTreeNode::Box(bbox, Vec::new())],
                    edge_names: HashMap::default(),
                },
            });
        }
    }

    // Depth 0 + Label function.
    for tmpl in &schema.label_templates {
        if !cel_template_applies(
            &tmpl.cel,
            &tmpl.applicable_event_types,
            &tmpl.applicable_object_types,
            root_ev_types,
            root_ob_types,
        ) {
            continue;
        }
        let mut bbox = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        bbox.labels.push(LabelFunction {
            label: tmpl.label_name.clone(),
            cel: tmpl.cel.clone(),
        });
        let mut tag = base_tag.clone();
        tag.has_label = true;
        out.push(CorpusEntry {
            tag,
            tree: BindingBoxTree {
                nodes: vec![BindingBoxTreeNode::Box(bbox, Vec::new())],
                edge_names: HashMap::default(),
            },
        });
    }

    // Depth 1 layers.
    if bounds.max_depth < 1 || bounds.max_children < 1 {
        return;
    }
    let ancestor_evs: Vec<usize> = {
        let mut v: Vec<usize> = root_ev_types.keys().copied().collect();
        v.sort();
        v
    };
    let ancestor_obs: Vec<usize> = {
        let mut v: Vec<usize> = root_ob_types.keys().copied().collect();
        v.sort();
        v
    };
    let next_ev = ancestor_evs.iter().copied().max().map(|m| m + 1).unwrap_or(0);
    let next_ob = ancestor_obs.iter().copied().max().map(|m| m + 1).unwrap_or(0);

    if ancestor_obs.is_empty() {
        // All three child shapes require an anchor object variable. Without
        // any parent object var, no depth-1 layer is reachable.
        return;
    }

    for shape in &[ChildShape::Alpha, ChildShape::Beta, ChildShape::Gamma] {
        for &anchor_o in &ancestor_obs {
            let child = match try_build_child(
                *shape,
                anchor_o,
                next_ev,
                next_ob,
                &ancestor_evs,
                &ancestor_obs,
                root_ev_types,
                root_ob_types,
                schema,
                info,
            ) {
                Some(c) => c,
                None => continue,
            };
            emit_depth1_for_child(
                &child,
                root_edges,
                root_ev_types,
                root_ob_types,
                &base_tag,
                schema,
                bounds,
                info,
                out,
            );
        }
    }
}

fn emit_depth1_for_child(
    child: &InstantiatedChild,
    root_edges: &[Edge],
    root_ev_types: &HashMap<usize, String>,
    root_ob_types: &HashMap<usize, String>,
    base_tag: &CorpusTreeTag,
    schema: &CorpusSchema,
    bounds: &CorpusBounds,
    info: &OCELInfo,
    out: &mut Vec<CorpusEntry>,
) {
    let child_name = "child0";

    let child_bbox = fresh_bbox(&child.fresh_ev_types, &child.fresh_ob_types, &child.edges);

    let make_tree =
        |parent: BindingBox, child: BindingBox, child_name: &str| -> BindingBoxTree {
            let mut edge_names: HashMap<(usize, usize), String> = HashMap::default();
            edge_names.insert((0, 1), child_name.to_string());
            BindingBoxTree {
                nodes: vec![
                    BindingBoxTreeNode::Box(parent, vec![1]),
                    BindingBoxTreeNode::Box(child, Vec::new()),
                ],
                edge_names,
            }
        };

    let tag_with_depth1 = |out_o2o_extra: bool| -> CorpusTreeTag {
        let mut t = base_tag.clone();
        t.depth = 1;
        t.n_children = 1;
        if out_o2o_extra && child.has_o2o() {
            t.has_o2o = true;
        }
        t
    };

    // NumChilds[>=1]
    {
        let mut parent = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        parent.size_filters.push(SizeFilter::NumChilds {
            child_name: child_name.to_string(),
            min: Some(1),
            max: None,
        });
        let tag = tag_with_depth1(true);
        out.push(CorpusEntry {
            tag,
            tree: make_tree(parent, child_bbox.clone(), child_name),
        });
    }
    // NumChilds[=0]
    {
        let mut parent = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        parent.size_filters.push(SizeFilter::NumChilds {
            child_name: child_name.to_string(),
            min: None,
            max: Some(0),
        });
        let tag = tag_with_depth1(true);
        out.push(CorpusEntry {
            tag,
            tree: make_tree(parent, child_bbox.clone(), child_name),
        });
    }
    // NumChildsProj per fresh variable in the child.
    for &fresh_e_idx in &child.fresh_ev_indices {
        let mut parent = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        parent.size_filters.push(SizeFilter::NumChildsProj {
            child_name: child_name.to_string(),
            var_name: Variable::Event(EventVariable(fresh_e_idx)),
            min: Some(1),
            max: None,
        });
        let mut tag = tag_with_depth1(true);
        tag.has_num_childs_proj = true;
        out.push(CorpusEntry {
            tag,
            tree: make_tree(parent, child_bbox.clone(), child_name),
        });
    }
    for &fresh_o_idx in &child.fresh_ob_indices {
        let mut parent = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        parent.size_filters.push(SizeFilter::NumChildsProj {
            child_name: child_name.to_string(),
            var_name: Variable::Object(ObjectVariable(fresh_o_idx)),
            min: Some(1),
            max: None,
        });
        let mut tag = tag_with_depth1(true);
        tag.has_num_childs_proj = true;
        out.push(CorpusEntry {
            tag,
            tree: make_tree(parent, child_bbox.clone(), child_name),
        });
    }
    // AdvancedCEL per template.
    for tmpl in &schema.adv_cel_templates {
        let mut parent = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        parent.size_filters.push(SizeFilter::AdvancedCEL {
            cel: instantiate_adv_cel(tmpl, child_name),
        });
        let mut tag = tag_with_depth1(true);
        tag.has_adv_cel = true;
        out.push(CorpusEntry {
            tag,
            tree: make_tree(parent, child_bbox.clone(), child_name),
        });
    }

    // Two-child variants.
    if bounds.max_children < 2 {
        return;
    }

    // Same shape + same type assignment + same anchor: rebuild child_b with
    // offset indices.
    let child0_name = "child0";
    let child1_name = "child1";
    let n_fresh_ev = child.fresh_ev_indices.len();
    let n_fresh_ob = child.fresh_ob_indices.len();

    let mut child_b_fresh_ev_types: HashMap<usize, String> = HashMap::default();
    let mut child_b_fresh_ev_indices: Vec<usize> = Vec::new();
    for &i in &child.fresh_ev_indices {
        let j = i + n_fresh_ev;
        child_b_fresh_ev_indices.push(j);
        child_b_fresh_ev_types.insert(j, child.fresh_ev_types.get(&i).unwrap().clone());
    }
    let mut child_b_fresh_ob_types: HashMap<usize, String> = HashMap::default();
    let mut child_b_fresh_ob_indices: Vec<usize> = Vec::new();
    for &i in &child.fresh_ob_indices {
        let j = i + n_fresh_ob;
        child_b_fresh_ob_indices.push(j);
        child_b_fresh_ob_types.insert(j, child.fresh_ob_types.get(&i).unwrap().clone());
    }
    let child_b_edges: Vec<Edge> = child
        .edges
        .iter()
        .map(|e| match e {
            Edge::E2O(i, j) => {
                // anchor j may be ancestor (unchanged) or fresh-from-child (shift).
                let new_i = if child.fresh_ev_indices.contains(i) {
                    *i + n_fresh_ev
                } else {
                    *i
                };
                let new_j = if child.fresh_ob_indices.contains(j) {
                    *j + n_fresh_ob
                } else {
                    *j
                };
                Edge::E2O(new_i, new_j)
            }
            Edge::O2O(a, b) => {
                let new_a = if child.fresh_ob_indices.contains(a) {
                    *a + n_fresh_ob
                } else {
                    *a
                };
                let new_b = if child.fresh_ob_indices.contains(b) {
                    *b + n_fresh_ob
                } else {
                    *b
                };
                Edge::O2O(new_a, new_b)
            }
            Edge::TBE(i, j) => {
                let new_i = if child.fresh_ev_indices.contains(i) {
                    *i + n_fresh_ev
                } else {
                    *i
                };
                let new_j = if child.fresh_ev_indices.contains(j) {
                    *j + n_fresh_ev
                } else {
                    *j
                };
                Edge::TBE(new_i, new_j)
            }
        })
        .collect();
    let child_b_bbox = fresh_bbox(
        &child_b_fresh_ev_types,
        &child_b_fresh_ob_types,
        &child_b_edges,
    );

    let make_tree_2 = |parent: BindingBox,
                       a: BindingBox,
                       b: BindingBox,
                       child0_name: &str,
                       child1_name: &str|
     -> BindingBoxTree {
        let mut edge_names: HashMap<(usize, usize), String> = HashMap::default();
        edge_names.insert((0, 1), child0_name.to_string());
        edge_names.insert((0, 2), child1_name.to_string());
        BindingBoxTree {
            nodes: vec![
                BindingBoxTreeNode::Box(parent, vec![1, 2]),
                BindingBoxTreeNode::Box(a, Vec::new()),
                BindingBoxTreeNode::Box(b, Vec::new()),
            ],
            edge_names,
        }
    };

    let tag_two = |t_base: &CorpusTreeTag| -> CorpusTreeTag {
        let mut t = t_base.clone();
        t.depth = 1;
        t.n_children = 2;
        if child.has_o2o() {
            t.has_o2o = true;
        }
        t
    };

    // BindingSetEqual: both children identical shape, directly comparable.
    {
        let mut parent = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        parent.size_filters.push(SizeFilter::BindingSetEqual {
            child_names: vec![child0_name.to_string(), child1_name.to_string()],
        });
        let mut tag = tag_two(base_tag);
        tag.has_binding_set_eq = true;
        out.push(CorpusEntry {
            tag,
            tree: make_tree_2(
                parent,
                child_bbox.clone(),
                child_b_bbox.clone(),
                child0_name,
                child1_name,
            ),
        });
    }

    // BindingSetProjectionEqual: project both children onto matching fresh
    // variable positions (same kind+type since both children share shape).
    let mut proj_pairs: Vec<(Variable, Variable)> = Vec::new();
    for (idx_a, idx_b) in child
        .fresh_ev_indices
        .iter()
        .zip(child_b_fresh_ev_indices.iter())
    {
        proj_pairs.push((
            Variable::Event(EventVariable(*idx_a)),
            Variable::Event(EventVariable(*idx_b)),
        ));
    }
    for (idx_a, idx_b) in child
        .fresh_ob_indices
        .iter()
        .zip(child_b_fresh_ob_indices.iter())
    {
        proj_pairs.push((
            Variable::Object(ObjectVariable(*idx_a)),
            Variable::Object(ObjectVariable(*idx_b)),
        ));
    }
    for (va, vb) in &proj_pairs {
        let mut parent = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        parent
            .size_filters
            .push(SizeFilter::BindingSetProjectionEqual {
                child_name_with_var_name: vec![
                    (child0_name.to_string(), va.clone()),
                    (child1_name.to_string(), vb.clone()),
                ],
            });
        let mut tag = tag_two(base_tag);
        tag.has_binding_set_proj_eq = true;
        out.push(CorpusEntry {
            tag,
            tree: make_tree_2(
                parent,
                child_bbox.clone(),
                child_b_bbox.clone(),
                child0_name,
                child1_name,
            ),
        });
    }

    // Compositions: AND / OR / NOT / SAT / ANY.
    for op in &[
        CompOp::And,
        CompOp::Or,
        CompOp::Not,
        CompOp::Sat,
        CompOp::Any,
    ] {
        let mut parent = fresh_bbox(root_ev_types, root_ob_types, root_edges);
        parent.constraints.push(
            op.build(vec![child0_name.to_string(), child1_name.to_string()]),
        );
        let mut tag = tag_two(base_tag);
        tag.composition = Some(op.as_str().to_string());
        out.push(CorpusEntry {
            tag,
            tree: make_tree_2(
                parent.clone(),
                child_bbox.clone(),
                child_b_bbox.clone(),
                child0_name,
                child1_name,
            ),
        });
        // Constraint-mode companion: layer one Constraint::Filter on child0
        // so the composition has at least one binding with a non-vacuous
        // satisfied label. Without this, every child is vacuously satisfied
        // and SAT/ANY/AND/OR/NOT collapse to the same truth.
        if let Some((constr, form_name)) = pick_composition_child_constraint(
            root_ev_types,
            root_ob_types,
            &child.fresh_ev_types,
            &child.fresh_ob_types,
            &child_bbox.filters,
            schema,
        ) {
            let mut child0_with_constr = child_bbox.clone();
            child0_with_constr.constraints.push(constr);
            let mut tag = tag_two(base_tag);
            tag.composition = Some(op.as_str().to_string());
            tag.has_constraint_layered = Some(form_name.to_string());
            tag.constraint_layered_at = Some("child".to_string());
            out.push(CorpusEntry {
                tag,
                tree: make_tree_2(
                    parent,
                    child0_with_constr,
                    child_b_bbox.clone(),
                    child0_name,
                    child1_name,
                ),
            });
        }
    }

    // Depth 2 layers.
    if bounds.max_depth < 2 {
        return;
    }
    emit_depth2(
        child,
        root_edges,
        root_ev_types,
        root_ob_types,
        base_tag,
        schema,
        bounds,
        info,
        out,
    );
}

fn emit_depth2(
    child: &InstantiatedChild,
    root_edges: &[Edge],
    root_ev_types: &HashMap<usize, String>,
    root_ob_types: &HashMap<usize, String>,
    base_tag: &CorpusTreeTag,
    schema: &CorpusSchema,
    bounds: &CorpusBounds,
    info: &OCELInfo,
    out: &mut Vec<CorpusEntry>,
) {
    // Build the cumulative type / index environment available at child:
    // root + child's fresh variables.
    let mut env_evs: HashMap<usize, String> = root_ev_types.clone();
    let mut env_obs: HashMap<usize, String> = root_ob_types.clone();
    for &i in &child.fresh_ev_indices {
        env_evs.insert(i, child.fresh_ev_types.get(&i).unwrap().clone());
    }
    for &j in &child.fresh_ob_indices {
        env_obs.insert(j, child.fresh_ob_types.get(&j).unwrap().clone());
    }
    let ancestor_evs: Vec<usize> = {
        let mut v: Vec<usize> = env_evs.keys().copied().collect();
        v.sort();
        v
    };
    let ancestor_obs: Vec<usize> = {
        let mut v: Vec<usize> = env_obs.keys().copied().collect();
        v.sort();
        v
    };
    if ancestor_obs.is_empty() {
        return;
    }
    let next_ev = ancestor_evs.iter().copied().max().map(|m| m + 1).unwrap_or(0);
    let next_ob = ancestor_obs.iter().copied().max().map(|m| m + 1).unwrap_or(0);

    let child_name = "child0"; // parent->child edge name
    let grand_name = "grand0"; // child->grandchild edge name

    // For each grandchild shape + anchor:
    for shape in &[ChildShape::Alpha, ChildShape::Beta, ChildShape::Gamma] {
        for &anchor_o in &ancestor_obs {
            let grand = match try_build_child(
                *shape,
                anchor_o,
                next_ev,
                next_ob,
                &ancestor_evs,
                &ancestor_obs,
                &env_evs,
                &env_obs,
                schema,
                info,
            ) {
                Some(c) => c,
                None => continue,
            };

            // Build the child's bbox with grand-child size filters.
            let make_depth2_tree = |child_size_filter: SizeFilter,
                                    constraint_in_child: Option<Constraint>|
             -> (BindingBoxTree, bool, bool) {
                let parent_bbox = fresh_bbox(root_ev_types, root_ob_types, root_edges);
                let mut child_inner =
                    fresh_bbox(&child.fresh_ev_types, &child.fresh_ob_types, &child.edges);
                child_inner.size_filters.push(child_size_filter);
                if let Some(c) = constraint_in_child {
                    child_inner.constraints.push(c);
                }
                let grand_bbox =
                    fresh_bbox(&grand.fresh_ev_types, &grand.fresh_ob_types, &grand.edges);
                let mut edge_names: HashMap<(usize, usize), String> = HashMap::default();
                edge_names.insert((0, 1), child_name.to_string());
                edge_names.insert((1, 2), grand_name.to_string());
                // Parent must hold a child-anchor predicate (NumChilds >= 1 on
                // child) so the grandchild is actually evaluated. Add it now.
                let mut parent_anchor = parent_bbox;
                parent_anchor.size_filters.push(SizeFilter::NumChilds {
                    child_name: child_name.to_string(),
                    min: Some(1),
                    max: None,
                });
                let tree = BindingBoxTree {
                    nodes: vec![
                        BindingBoxTreeNode::Box(parent_anchor, vec![1]),
                        BindingBoxTreeNode::Box(child_inner, vec![2]),
                        BindingBoxTreeNode::Box(grand_bbox, Vec::new()),
                    ],
                    edge_names,
                };
                let extra_o2o = child.has_o2o() || grand.has_o2o();
                let extra_tbe = false;
                (tree, extra_o2o, extra_tbe)
            };

            // grand NumChilds[>=1]
            {
                let (tree, o2o_extra, tbe_extra) = make_depth2_tree(
                    SizeFilter::NumChilds {
                        child_name: grand_name.to_string(),
                        min: Some(1),
                        max: None,
                    },
                    None,
                );
                let mut tag = base_tag.clone();
                tag.depth = 2;
                tag.n_children = 1;
                if o2o_extra {
                    tag.has_o2o = true;
                }
                if tbe_extra {
                    tag.has_tbe = true;
                }
                out.push(CorpusEntry { tag, tree });
            }
            // grand NumChilds[=0]
            {
                let (tree, o2o_extra, tbe_extra) = make_depth2_tree(
                    SizeFilter::NumChilds {
                        child_name: grand_name.to_string(),
                        min: None,
                        max: Some(0),
                    },
                    None,
                );
                let mut tag = base_tag.clone();
                tag.depth = 2;
                tag.n_children = 1;
                if o2o_extra {
                    tag.has_o2o = true;
                }
                if tbe_extra {
                    tag.has_tbe = true;
                }
                out.push(CorpusEntry { tag, tree });
            }

            // Compositions of two parent children (depth-2 in one child).
            // Build a sibling child of the same shape (no grandchild) and
            // compose with the grandchild-bearing child.
            if bounds.max_children >= 2 {
                let n_fresh_ev = child.fresh_ev_indices.len();
                let n_fresh_ob = child.fresh_ob_indices.len();
                let mut sibling_ev_types: HashMap<usize, String> = HashMap::default();
                let mut sibling_ev_indices: Vec<usize> = Vec::new();
                for &i in &child.fresh_ev_indices {
                    let j = i + n_fresh_ev;
                    sibling_ev_indices.push(j);
                    sibling_ev_types.insert(j, child.fresh_ev_types.get(&i).unwrap().clone());
                }
                let mut sibling_ob_types: HashMap<usize, String> = HashMap::default();
                let mut sibling_ob_indices: Vec<usize> = Vec::new();
                for &i in &child.fresh_ob_indices {
                    let j = i + n_fresh_ob;
                    sibling_ob_indices.push(j);
                    sibling_ob_types.insert(j, child.fresh_ob_types.get(&i).unwrap().clone());
                }
                let sibling_edges: Vec<Edge> = child
                    .edges
                    .iter()
                    .map(|e| match e {
                        Edge::E2O(i, j) => {
                            let ni = if child.fresh_ev_indices.contains(i) {
                                *i + n_fresh_ev
                            } else {
                                *i
                            };
                            let nj = if child.fresh_ob_indices.contains(j) {
                                *j + n_fresh_ob
                            } else {
                                *j
                            };
                            Edge::E2O(ni, nj)
                        }
                        Edge::O2O(a, b) => {
                            let na = if child.fresh_ob_indices.contains(a) {
                                *a + n_fresh_ob
                            } else {
                                *a
                            };
                            let nb = if child.fresh_ob_indices.contains(b) {
                                *b + n_fresh_ob
                            } else {
                                *b
                            };
                            Edge::O2O(na, nb)
                        }
                        Edge::TBE(i, j) => {
                            let ni = if child.fresh_ev_indices.contains(i) {
                                *i + n_fresh_ev
                            } else {
                                *i
                            };
                            let nj = if child.fresh_ev_indices.contains(j) {
                                *j + n_fresh_ev
                            } else {
                                *j
                            };
                            Edge::TBE(ni, nj)
                        }
                    })
                    .collect();
                let sibling_bbox =
                    fresh_bbox(&sibling_ev_types, &sibling_ob_types, &sibling_edges);

                let child0_name = "child0";
                let child1_name = "child1";

                for op in &[CompOp::And, CompOp::Or, CompOp::Not, CompOp::Sat, CompOp::Any] {
                    let parent_template = {
                        let mut p = fresh_bbox(root_ev_types, root_ob_types, root_edges);
                        p.constraints.push(
                            op.build(vec![child0_name.to_string(), child1_name.to_string()]),
                        );
                        p
                    };
                    let child_inner_template = {
                        let mut c = fresh_bbox(
                            &child.fresh_ev_types,
                            &child.fresh_ob_types,
                            &child.edges,
                        );
                        c.size_filters.push(SizeFilter::NumChilds {
                            child_name: grand_name.to_string(),
                            min: Some(1),
                            max: None,
                        });
                        c
                    };
                    let grand_bbox = fresh_bbox(
                        &grand.fresh_ev_types,
                        &grand.fresh_ob_types,
                        &grand.edges,
                    );
                    let mut edge_names: HashMap<(usize, usize), String> = HashMap::default();
                    edge_names.insert((0, 1), child0_name.to_string());
                    edge_names.insert((0, 2), child1_name.to_string());
                    edge_names.insert((1, 3), grand_name.to_string());
                    let tree = BindingBoxTree {
                        nodes: vec![
                            BindingBoxTreeNode::Box(parent_template.clone(), vec![1, 2]),
                            BindingBoxTreeNode::Box(child_inner_template.clone(), vec![3]),
                            BindingBoxTreeNode::Box(sibling_bbox.clone(), Vec::new()),
                            BindingBoxTreeNode::Box(grand_bbox.clone(), Vec::new()),
                        ],
                        edge_names: edge_names.clone(),
                    };
                    let mut tag = base_tag.clone();
                    tag.depth = 2;
                    tag.n_children = 2;
                    tag.composition = Some(op.as_str().to_string());
                    if child.has_o2o() || grand.has_o2o() {
                        tag.has_o2o = true;
                    }
                    out.push(CorpusEntry { tag, tree });
                    // Constraint-mode companion on child0 (the inner child).
                    if let Some((constr, form_name)) = pick_composition_child_constraint(
                        root_ev_types,
                        root_ob_types,
                        &child.fresh_ev_types,
                        &child.fresh_ob_types,
                        &child_inner_template.filters,
                        schema,
                    ) {
                        let mut child0_with_constr = child_inner_template.clone();
                        child0_with_constr.constraints.push(constr);
                        let tree2 = BindingBoxTree {
                            nodes: vec![
                                BindingBoxTreeNode::Box(parent_template, vec![1, 2]),
                                BindingBoxTreeNode::Box(child0_with_constr, vec![3]),
                                BindingBoxTreeNode::Box(sibling_bbox.clone(), Vec::new()),
                                BindingBoxTreeNode::Box(grand_bbox, Vec::new()),
                            ],
                            edge_names,
                        };
                        let mut tag2 = base_tag.clone();
                        tag2.depth = 2;
                        tag2.n_children = 2;
                        tag2.composition = Some(op.as_str().to_string());
                        tag2.has_constraint_layered = Some(form_name.to_string());
                        tag2.constraint_layered_at = Some("child".to_string());
                        if child.has_o2o() || grand.has_o2o() {
                            tag2.has_o2o = true;
                        }
                        out.push(CorpusEntry { tag: tag2, tree: tree2 });
                    }
                }
            }
        }
    }
}

// Equality oracle: sorted-vec byte compare

/// Normalized-form of one binding: sorted variable assignments + sorted
/// label values. Both sides are byte-comparable via `PartialEq`. Label
/// values are JSON-serialised (stable representation independent of the
/// concrete `LabelValue` variant) so the equality oracle catches
/// label-value divergence between engines (e.g. SQL-path time arithmetic
/// returning `0s` while the in-memory engine returns the real duration).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize)]
pub struct NormalizedBinding {
    /// True if this binding satisfied all constraints attached to its node.
    /// Both engines populate this from the per-binding satisfaction status:
    /// the in-memory engine maps `ViolationReason` (Some -> false), and the
    /// SQL execution path reads the emitter-projected `satisfied` column on
    /// each row (None -> true; ConstraintNotSatisfied -> false). Set-equality
    /// comparisons MUST compare the full normalized set (including violators)
    /// and the satisfied flag is part of the equality.
    pub satisfied: bool,
    pub vars: Vec<(VarKind, usize, String)>,
    pub labels: Vec<(String, String)>,
}

fn normalize_labels(
    labels: &[(String, crate::binding_box::structs::LabelValue)],
) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = labels
        .iter()
        .map(|(k, v)| {
            let json = serde_json::to_string(v).unwrap_or_else(|_| String::from("null"));
            (k.clone(), json)
        })
        .collect();
    out.sort();
    out
}

/// Normalizedise one `Binding` for sorted-vec byte comparison.
/// `viol` carries the in-memory engine's per-binding violation reason;
/// `None` means the binding satisfied all constraints at its node.
pub fn normalize_binding(
    b: &crate::binding_box::structs::Binding,
    viol: Option<&crate::binding_box::structs::ViolationReason>,
    locel: &SlimLinkedOCEL,
) -> NormalizedBinding {
    let mut vars: Vec<(VarKind, usize, String)> =
        Vec::with_capacity(b.event_map.len() + b.object_map.len());
    for (v, idx) in &b.event_map {
        vars.push((VarKind::Event, v.0, locel.get_ev_id(idx).to_string()));
    }
    for (v, idx) in &b.object_map {
        vars.push((VarKind::Object, v.0, locel.get_ob_id(idx).to_string()));
    }
    vars.sort();
    NormalizedBinding {
        satisfied: viol.is_none(),
        vars,
        labels: normalize_labels(&b.label_map),
    }
}

/// Build a normalized set: each binding normalized; outer vec sorted lex.
/// The iterator yields `(&Binding, Option<&ViolationReason>)` so the
/// `satisfied` flag is populated from the engine's per-binding violation
/// reason. Callers MUST pass ALL root bindings (including violators);
/// constraint semantics keep violators in the result set with
/// `satisfied=false`, and downstream comparison includes the satisfied
/// flag in the equality.
pub fn normalized_binding_set<'a, I>(bindings: I, locel: &SlimLinkedOCEL) -> Vec<NormalizedBinding>
where
    I: IntoIterator<Item = (
        &'a crate::binding_box::structs::Binding,
        Option<&'a crate::binding_box::structs::ViolationReason>,
    )>,
{
    let mut out: Vec<NormalizedBinding> = bindings
        .into_iter()
        .map(|(b, v)| normalize_binding(b, v, locel))
        .collect();
    out.sort();
    out
}

/// Id-native normalized form for `BindingId`. No `SlimLinkedOCEL`
/// indirection: ocel_ids are already in the binding. Compatible
/// with [`normalized_binding_set`] output for cross-path set-equality
/// probes (the in-memory normalization routes through
/// `locel.get_ev_id` to produce the same ocel_id strings the SQL
/// path stores directly).
///
/// `viol` carries the per-binding satisfaction status the SQL executor
/// emits. `None` means the binding satisfied all constraints; `Some(...)`
/// means a constraint was violated. The flag is propagated into
/// `NormalizedBinding::satisfied` so set-equality comparisons across
/// engines can include the satisfaction status.
pub fn normalize_binding_id(
    b: &crate::binding_box::structs::BindingId,
    viol: Option<&crate::binding_box::structs::ViolationReason>,
) -> NormalizedBinding {
    let mut vars: Vec<(VarKind, usize, String)> =
        Vec::with_capacity(b.event_map.len() + b.object_map.len());
    for (v, id) in &b.event_map {
        vars.push((VarKind::Event, v.0, id.as_str().to_string()));
    }
    for (v, id) in &b.object_map {
        vars.push((VarKind::Object, v.0, id.as_str().to_string()));
    }
    vars.sort();
    NormalizedBinding {
        satisfied: viol.is_none(),
        vars,
        labels: normalize_labels(&b.label_map),
    }
}

pub fn normalized_binding_set_id<'a, I>(bindings: I) -> Vec<NormalizedBinding>
where
    I: IntoIterator<
        Item = (
            &'a crate::binding_box::structs::BindingId,
            Option<&'a crate::binding_box::structs::ViolationReason>,
        ),
    >,
{
    let mut out: Vec<NormalizedBinding> = bindings
        .into_iter()
        .map(|(b, v)| normalize_binding_id(b, v))
        .collect();
    out.sort();
    out
}

/// Exact set equality via sorted-vec byte compare.
/// Compare two normalized binding sets for equality. Strict (byte-exact) on
/// the `satisfied` flag and the variable bindings; for `Float`-typed labels,
/// allows an IEEE 754 epsilon tolerance to absorb sub-ULP sum-order noise
/// across SQL backends (DuckDB/PostgreSQL/SQLite may return child rows in
/// different orders, and `.sum()` over those rows is not IEEE 754
/// associative). The thresholds (`1e-9` absolute, `1e-12` relative) are
/// tight enough to flag any real off-by-one or unit-scale divergence
/// (verified against the OM-Q1 int-rounded case where bindings differed by
/// 1 unit, flagged), and loose enough to absorb the observed worst-case
/// `~1.8e-12` delta on raw-float labels.
///
/// Non-float labels (Int, String, Bool, Null) compare bit-exact via their
/// serialised JSON form, matching the prior `a == b` semantics.
pub fn compare_binding_sets_exact(
    a: &[NormalizedBinding],
    b: &[NormalizedBinding],
) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).all(normalized_bindings_equal)
}

fn normalized_bindings_equal(p: (&NormalizedBinding, &NormalizedBinding)) -> bool {
    let (a, b) = p;
    if a.satisfied != b.satisfied {
        return false;
    }
    if a.vars != b.vars {
        return false;
    }
    if a.labels.len() != b.labels.len() {
        return false;
    }
    a.labels
        .iter()
        .zip(b.labels.iter())
        .all(|((ka, va), (kb, vb))| ka == kb && label_value_json_equal_with_tolerance(va, vb))
}

/// Equality on a label value's normalized JSON string with a tight IEEE 754
/// tolerance for `Float`-typed payloads. Returns `true` iff the JSON strings
/// are bit-equal, or both are `{"type":"float","value":<f64>}` payloads whose
/// values are within `1e-9` absolute OR `1e-12` relative.
fn label_value_json_equal_with_tolerance(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    let pa: serde_json::Value = match serde_json::from_str(a) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let pb: serde_json::Value = match serde_json::from_str(b) {
        Ok(v) => v,
        Err(_) => return false,
    };
    if pa.get("type").and_then(|v| v.as_str()) != Some("float")
        || pb.get("type").and_then(|v| v.as_str()) != Some("float")
    {
        return false;
    }
    let fa = pa.get("value").and_then(|v| v.as_f64());
    let fb = pb.get("value").and_then(|v| v.as_f64());
    match (fa, fb) {
        (Some(x), Some(y)) => floats_within_tolerance(x, y),
        _ => false,
    }
}

fn floats_within_tolerance(a: f64, b: f64) -> bool {
    // NaN sentinel: equal iff both NaN. Inf: equal iff same sign.
    if a.is_nan() || b.is_nan() {
        return a.is_nan() && b.is_nan();
    }
    if a.is_infinite() || b.is_infinite() {
        return a == b;
    }
    let diff = (a - b).abs();
    if diff <= 1e-9 {
        return true;
    }
    let scale = a.abs().max(b.abs());
    diff <= 1e-12 * scale
}

// Built-in schemas

pub fn builtin_schemas() -> Vec<CorpusSchema> {
    vec![
        // BPIC 2017.
        // Object types in the OCEL: Application, Offer.
        // Event attributes: ApplicationType (Application-creation events),
        // LoanGoal (Application-creation events).
        CorpusSchema {
            dataset_name: "bpic2017".to_string(),
            event_types: vec![
                "A_Accepted".to_string(),
                "A_Submitted".to_string(),
                "A_Cancelled".to_string(),
                "O_Accepted".to_string(),
                "O_Cancelled".to_string(),
            ],
            object_types: vec!["Application".to_string(), "Offer".to_string()],
            cel_templates: vec![
                // Application-event ApplicationType: only A_* event types
                // carry this attribute.
                CelTemplate {
                    cel: "e1.attr(\"ApplicationType\") == \"New credit\"".to_string(),
                    applicable_event_types: vec![
                        "A_Accepted".to_string(),
                        "A_Submitted".to_string(),
                        "A_Cancelled".to_string(),
                    ],
                    applicable_object_types: vec![],
                },
                CelTemplate {
                    cel: "e1.attr(\"LoanGoal\") == \"Existing loan takeover\"".to_string(),
                    applicable_event_types: vec![
                        "A_Accepted".to_string(),
                        "A_Submitted".to_string(),
                        "A_Cancelled".to_string(),
                    ],
                    applicable_object_types: vec![],
                },
                // RequestedAmount: stored as an *event* attribute on A_* event
                // types in BPIC 2017 (the Application object-type carries no
                // declared attributes in the XML schema), so we anchor the
                // template on `e1`, not `o1`.
                CelTemplate {
                    cel: "e1.attr(\"RequestedAmount\") > 10000.0".to_string(),
                    applicable_event_types: vec![
                        "A_Accepted".to_string(),
                        "A_Submitted".to_string(),
                        "A_Cancelled".to_string(),
                    ],
                    applicable_object_types: vec![],
                },
            ],
            attribute_filter_templates: vec![
                AttrFilterTemplate {
                    var_kind: VarKind::Event,
                    var_type: Some("A_Accepted".to_string()),
                    attribute_name: "ApplicationType".to_string(),
                    value_filter: ValueFilter::String {
                        is_in: vec!["New credit".to_string()],
                    },
                },
                AttrFilterTemplate {
                    var_kind: VarKind::Event,
                    var_type: Some("A_Submitted".to_string()),
                    attribute_name: "LoanGoal".to_string(),
                    value_filter: ValueFilter::String {
                        is_in: vec!["Existing loan takeover".to_string()],
                    },
                },
            ],
            adv_cel_templates: vec!["size(<child_label>) >= 1".to_string()],
            label_templates: vec![
                LabelTemplate {
                    label_name: "acc_type".to_string(),
                    cel: "e1.attr(\"ApplicationType\")".to_string(),
                    applicable_event_types: vec![
                        "A_Accepted".to_string(),
                        "A_Submitted".to_string(),
                        "A_Cancelled".to_string(),
                    ],
                    applicable_object_types: vec![],
                },
                LabelTemplate {
                    label_name: "loan_goal".to_string(),
                    cel: "e1.attr(\"LoanGoal\")".to_string(),
                    applicable_event_types: vec![
                        "A_Accepted".to_string(),
                        "A_Submitted".to_string(),
                        "A_Cancelled".to_string(),
                    ],
                    applicable_object_types: vec![],
                },
                // Universal: any event has a timestamp.
                LabelTemplate {
                    label_name: "event_time".to_string(),
                    cel: "e1.time()".to_string(),
                    applicable_event_types: vec![],
                    applicable_object_types: vec![],
                },
                // RequestedAmount label. Stored as an *event* attribute on A_*
                // event types in BPIC 2017 (Application object-type carries no
                // declared attributes in the XML schema).
                LabelTemplate {
                    label_name: "requested_amount".to_string(),
                    cel: "e1.attr(\"RequestedAmount\")".to_string(),
                    applicable_event_types: vec![
                        "A_Accepted".to_string(),
                        "A_Submitted".to_string(),
                        "A_Cancelled".to_string(),
                    ],
                    applicable_object_types: vec![],
                },
            ],
        },
        // Order management.
        // Object types: orders (attr `price:float`), items (`weight`, `price`).
        // Events have no per-event attributes, only `ocel:id`/`ocel:time`.
        CorpusSchema {
            dataset_name: "order-management".to_string(),
            event_types: vec![
                "place order".to_string(),
                "confirm order".to_string(),
                "pay order".to_string(),
                "package delivered".to_string(),
                "pick item".to_string(),
            ],
            object_types: vec!["orders".to_string(), "items".to_string()],
            cel_templates: vec![
                // orders carry `price:float`.
                CelTemplate {
                    cel: "o1.attr(\"price\") > 100.0".to_string(),
                    applicable_event_types: vec![],
                    applicable_object_types: vec!["orders".to_string()],
                },
                // items carry `weight:float`.
                CelTemplate {
                    cel: "o1.attr(\"weight\") > 0.5".to_string(),
                    applicable_event_types: vec![],
                    applicable_object_types: vec!["items".to_string()],
                },
            ],
            attribute_filter_templates: vec![
                AttrFilterTemplate {
                    var_kind: VarKind::Object,
                    var_type: Some("orders".to_string()),
                    attribute_name: "price".to_string(),
                    value_filter: ValueFilter::Float {
                        min: Some(100.0),
                        max: None,
                    },
                },
                AttrFilterTemplate {
                    var_kind: VarKind::Object,
                    var_type: Some("items".to_string()),
                    attribute_name: "weight".to_string(),
                    value_filter: ValueFilter::Float {
                        min: Some(0.5),
                        max: None,
                    },
                },
            ],
            adv_cel_templates: vec!["size(<child_label>) >= 1".to_string()],
            label_templates: vec![
                // Universal event timestamp.
                LabelTemplate {
                    label_name: "event_time".to_string(),
                    cel: "e1.time()".to_string(),
                    applicable_event_types: vec![],
                    applicable_object_types: vec![],
                },
                // orders price.
                LabelTemplate {
                    label_name: "order_price".to_string(),
                    cel: "o1.attr(\"price\")".to_string(),
                    applicable_event_types: vec![],
                    applicable_object_types: vec!["orders".to_string()],
                },
                // items weight.
                LabelTemplate {
                    label_name: "item_weight".to_string(),
                    cel: "o1.attr(\"weight\")".to_string(),
                    applicable_event_types: vec![],
                    applicable_object_types: vec!["items".to_string()],
                },
            ],
        },
        // Container logistics.
        // Object types from the original probe: Truck, Container. Container
        // carries `Weight:float` and `Status:string`. Truck has no
        // attributes in this OCEL.
        CorpusSchema {
            dataset_name: "container-logistics".to_string(),
            event_types: vec![
                "Book Vehicles".to_string(),
                "Bring to Loading Bay".to_string(),
                "Collect Goods".to_string(),
                "Create Transport Document".to_string(),
                "Depart".to_string(),
                "Drive to Terminal".to_string(),
                "Load Truck".to_string(),
                "Load to Vehicle".to_string(),
                "Order Empty Containers".to_string(),
                "Pick Up Empty Container".to_string(),
                "Place in Stock".to_string(),
                "Register Customer Order".to_string(),
                "Reschedule Container".to_string(),
                "Weigh".to_string(),
            ],
            object_types: vec!["Truck".to_string(), "Container".to_string()],
            cel_templates: vec![
                // Container Weight: only Container objects carry this.
                CelTemplate {
                    cel: "o1.attr(\"Weight\") > 0.0".to_string(),
                    applicable_event_types: vec![],
                    applicable_object_types: vec!["Container".to_string()],
                },
            ],
            attribute_filter_templates: vec![AttrFilterTemplate {
                var_kind: VarKind::Object,
                var_type: Some("Container".to_string()),
                attribute_name: "Weight".to_string(),
                value_filter: ValueFilter::Float {
                    min: Some(0.0),
                    max: None,
                },
            }],
            adv_cel_templates: vec!["size(<child_label>) >= 1".to_string()],
            label_templates: vec![
                // Universal event timestamp.
                LabelTemplate {
                    label_name: "event_time".to_string(),
                    cel: "e1.time()".to_string(),
                    applicable_event_types: vec![],
                    applicable_object_types: vec![],
                },
                // Container Weight label.
                LabelTemplate {
                    label_name: "container_weight".to_string(),
                    cel: "o1.attr(\"Weight\")".to_string(),
                    applicable_event_types: vec![],
                    applicable_object_types: vec!["Container".to_string()],
                },
            ],
        },
    ]
}

// Tests

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_info() -> OCELInfo {
        let mut e2o: HashMap<String, HashMap<String, (usize, HashSet<String>)>> =
            HashMap::default();
        let mut e_inner: HashMap<String, (usize, HashSet<String>)> = HashMap::default();
        e_inner.insert("O".to_string(), (1, HashSet::default()));
        e2o.insert("E".to_string(), e_inner);
        let o2o: HashMap<String, HashMap<String, (usize, HashSet<String>)>> = HashMap::default();
        OCELInfo {
            num_objects: 1,
            num_events: 1,
            object_types: vec![],
            event_types: vec![],
            e2o_types: e2o,
            o2o_types: o2o,
        }
    }

    fn tiny_schema() -> CorpusSchema {
        CorpusSchema {
            dataset_name: "tiny".to_string(),
            event_types: vec!["E".to_string()],
            object_types: vec!["O".to_string()],
            cel_templates: vec![],
            attribute_filter_templates: vec![],
            adv_cel_templates: vec![],
            label_templates: vec![],
        }
    }

    /// Helper: produce a stable structural fingerprint of a tree. HashMaps in
    /// the tree serialize in non-deterministic order, so we walk the tree and
    /// emit a sorted, normalized representation.
    fn tree_fingerprint(t: &BindingBoxTree) -> String {
        let mut s = String::new();
        for (i, node) in t.nodes.iter().enumerate() {
            s.push_str(&format!("node[{i}]:"));
            match node {
                BindingBoxTreeNode::Box(b, children) => {
                    s.push_str("Box{");
                    let mut evs: Vec<(usize, Vec<String>)> = b
                        .new_event_vars
                        .iter()
                        .map(|(k, v)| {
                            let mut types: Vec<String> = v.iter().cloned().collect();
                            types.sort();
                            (k.0, types)
                        })
                        .collect();
                    evs.sort();
                    s.push_str(&format!("ev_vars={evs:?},"));
                    let mut obs: Vec<(usize, Vec<String>)> = b
                        .new_object_vars
                        .iter()
                        .map(|(k, v)| {
                            let mut types: Vec<String> = v.iter().cloned().collect();
                            types.sort();
                            (k.0, types)
                        })
                        .collect();
                    obs.sort();
                    s.push_str(&format!("ob_vars={obs:?},"));
                    s.push_str(&format!("filters={:?},", b.filters));
                    s.push_str(&format!("size_filters={:?},", b.size_filters));
                    s.push_str(&format!("constraints={:?},", b.constraints));
                    s.push_str(&format!("labels={:?},", b.labels));
                    s.push_str(&format!("children={children:?}"));
                    s.push('}');
                }
                other => s.push_str(&format!("{other:?}")),
            }
            s.push('\n');
        }
        let mut edge_names: Vec<((usize, usize), String)> =
            t.edge_names.iter().map(|(k, v)| (*k, v.clone())).collect();
        edge_names.sort();
        s.push_str(&format!("edges={edge_names:?}"));
        s
    }

    #[test]
    fn generator_is_deterministic() {
        let schema = tiny_schema();
        let info = tiny_info();
        let bounds = CorpusBounds::default();
        let a = generate_corpus(&schema, &bounds, &info);
        let b = generate_corpus(&schema, &bounds, &info);
        assert_eq!(a.len(), b.len(), "lengths differ");
        for (i, (ea, eb)) in a.iter().zip(b.iter()).enumerate() {
            assert_eq!(
                tree_fingerprint(&ea.tree),
                tree_fingerprint(&eb.tree),
                "tree mismatch at index {i}"
            );
        }
    }

    #[test]
    fn tiny_bounds_produce_nonempty_corpus() {
        let schema = tiny_schema();
        let info = tiny_info();
        let bounds = CorpusBounds {
            max_events: 2,
            max_objects: 2,
            max_depth: 1,
            max_children: 2,
            max_var_sum: None,
        };
        let corpus = generate_corpus(&schema, &bounds, &info);
        assert!(!corpus.is_empty(), "tiny corpus must not be empty");
        for entry in &corpus {
            assert!(entry.tag.depth <= bounds.max_depth);
        }
    }

    #[test]
    fn pure_tbe_shape_rejected() {
        // n_e=2, n_o=0: only TBE edges possible, connectedness must reject.
        let schema = CorpusSchema {
            dataset_name: "tiny".to_string(),
            event_types: vec!["E".to_string()],
            object_types: vec![],
            cel_templates: vec![],
            attribute_filter_templates: vec![],
            adv_cel_templates: vec![],
            label_templates: vec![],
        };
        let info = OCELInfo {
            num_objects: 0,
            num_events: 0,
            object_types: vec![],
            event_types: vec![],
            e2o_types: HashMap::default(),
            o2o_types: HashMap::default(),
        };
        let bounds = CorpusBounds {
            max_events: 2,
            max_objects: 0,
            max_depth: 0,
            max_children: 0,
            max_var_sum: None,
        };
        let corpus = generate_corpus(&schema, &bounds, &info);
        // With no objects, the only possible 2-event relation is TBE, which
        // is excluded from connectedness. So no shape with n_events==2 and
        // n_objects==0 should appear. Smaller shapes (single event, empty
        // bbox) are vacuously connected and allowed.
        for entry in &corpus {
            assert!(
                !(entry.tag.n_events == 2 && entry.tag.n_objects == 0),
                "pure-TBE 2-event shape should be rejected by root connectedness: {:?}",
                entry.tag
            );
        }
    }

    #[test]
    fn builtin_schemas_present() {
        let s = builtin_schemas();
        assert!(s.iter().any(|x| x.dataset_name == "bpic2017"));
        assert!(s.iter().any(|x| x.dataset_name == "order-management"));
        assert!(s.iter().any(|x| x.dataset_name == "container-logistics"));
    }

    #[test]
    fn corpus_trees_are_translatable() {
        use crate::db_translation::validate_translatable;
        let schema = tiny_schema();
        let info = tiny_info();
        let bounds = CorpusBounds::default();
        let corpus = generate_corpus(&schema, &bounds, &info);
        let mut bad = 0usize;
        for (i, entry) in corpus.iter().enumerate() {
            if validate_translatable(&entry.tree).is_err() {
                bad += 1;
                if bad <= 3 {
                    println!("non-translatable @ {i}: {:?}", entry.tag);
                }
            }
        }
        assert_eq!(
            bad, 0,
            "{bad}/{} trees failed validate_translatable",
            corpus.len()
        );
    }

    /// Smoke benchmark: time the normalized-set build + byte compare against a
    /// real OCEL + tree. Skipped by default (`#[ignore]`); run with
    /// `cargo test --release -p ocpq-shared oracle_q4_smoke -- --ignored
    /// --nocapture` to print wall-clock for the equality oracle.
    #[test]
    #[ignore]
    fn oracle_q4_smoke() {
        use crate::binding_box::Binding;
        use crate::binding_box::BindingBoxTree;
        use process_mining::core::event_data::object_centric::linked_ocel::SlimLinkedOCEL;
        use process_mining::{Importable, OCEL};
        use std::time::Instant;

        let (tree_path, ocel_path) =
            match (std::env::var("OCPQ_SMOKE_TREE"), std::env::var("OCPQ_SMOKE_OCEL")) {
                (Ok(t), Ok(o)) => (t, o),
                _ => {
                    eprintln!("set OCPQ_SMOKE_TREE and OCPQ_SMOKE_OCEL to run this benchmark");
                    return;
                }
            };

        let tree_content = std::fs::read_to_string(&tree_path).unwrap();
        let tree: BindingBoxTree = serde_json::from_str(&tree_content).unwrap();

        let ocel = OCEL::import_from_path(ocel_path).unwrap();
        let locel = SlimLinkedOCEL::from_ocel(ocel);

        let t_eval = Instant::now();
        let (results, _) = tree.evaluate(&locel).unwrap();
        let eval_ms = t_eval.elapsed().as_secs_f64() * 1000.0;
        let roots: Vec<&std::sync::Arc<Binding>> = results
            .iter()
            .filter(|(node_idx, _, viol)| *node_idx == 0 && viol.is_none())
            .map(|(_, b, _)| b)
            .collect();
        let n = roots.len();
        println!("[oracle_q4_smoke] inmem bindings = {n}, eval_ms = {eval_ms:.1}");

        let refs: Vec<&Binding> = roots.iter().map(|a| a.as_ref()).collect();

        let t1 = Instant::now();
        let set_a = normalized_binding_set(refs.iter().copied().map(|b| (b, None)), &locel);
        let t1_ms = t1.elapsed().as_secs_f64() * 1000.0;

        let t2 = Instant::now();
        let set_b = normalized_binding_set(refs.iter().copied().map(|b| (b, None)), &locel);
        let t2_ms = t2.elapsed().as_secs_f64() * 1000.0;

        let t3 = Instant::now();
        let eq = compare_binding_sets_exact(&set_a, &set_b);
        let t3_ms = t3.elapsed().as_secs_f64() * 1000.0;

        println!(
            "[oracle_q4_smoke] canon_a = {:.1} ms, canon_b = {:.1} ms, compare = {:.3} ms (eq={eq}); total oracle = {:.1} ms",
            t1_ms, t2_ms, t3_ms, t1_ms + t2_ms + t3_ms
        );
        assert!(eq);
        assert!(t1_ms + t2_ms + t3_ms < 5000.0, "oracle should run in seconds, not 18s");
    }
}
