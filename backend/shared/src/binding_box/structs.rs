use std::{
    borrow::Cow,
    collections::{BTreeMap, HashMap, HashSet},
    fmt::Display,
    hash::Hash,
};

use itertools::Itertools;
use ordered_float::OrderedFloat;
use process_mining::core::event_data::object_centric::{
    linked_ocel::{
        slim_linked_ocel::{EventIndex, EventOrObjectIndex, ObjectIndex},
        LinkedOCELAccess, SlimLinkedOCEL,
    },
    OCELAttributeValue, OCELEvent, OCELObject,
};
use serde::{Deserialize, Serialize};
use serde_with::serde_as;
use ts_rs::TS;

use crate::cel::{add_cel_label, check_cel_predicate, get_vars_in_cel_program};
#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Hash, PartialEq, Eq, Serialize, Deserialize)]
pub enum Variable {
    Event(EventVariable),
    Object(ObjectVariable),
}

impl Variable {
    pub fn to_inner(&self) -> usize {
        match self {
            Variable::Event(ev) => ev.0,
            Variable::Object(ov) => ov.0,
        }
    }
}

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord)]
pub struct EventVariable(pub usize);
impl From<usize> for EventVariable {
    fn from(value: usize) -> Self {
        Self(value)
    }
}
#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord)]
pub struct ObjectVariable(pub usize);
impl From<usize> for ObjectVariable {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

pub type Qualifier = Option<String>;

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    // #[ts(as = "BTreeMap<EventVariable, usize>")]
    // pub event_map: FxHashMap<EventVariable, EventIndex>,
    #[ts(as = "BTreeMap<EventVariable, usize>")]
    pub event_map: Vec<(EventVariable, EventIndex)>,
    // #[ts(as = "BTreeMap<ObjectVariable, usize>")]
    // pub object_map: FxHashMap<ObjectVariable, ObjectIndex>,
    #[ts(as = "BTreeMap<ObjectVariable, usize>")]
    pub object_map: Vec<(ObjectVariable, ObjectIndex)>,
    // pub label_map: FxHashMap<String, LabelValue>,
    pub label_map: Vec<(String, LabelValue)>,
}

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type", content = "value")]
pub enum LabelValue {
    String(std::sync::Arc<String>),
    Int(i64),
    Float(#[ts(as = "f64")] OrderedFloat<f64>),
    Bool(bool),
    Null,
}

impl LabelValue {
    pub fn to_string(&self) -> String {
        match self {
            LabelValue::String(arc) => arc.to_string(),
            LabelValue::Int(i) => i.to_string(),
            LabelValue::Float(f) => f.to_string(),
            LabelValue::Bool(b) => b.to_string(),
            LabelValue::Null => "null".to_string(),
        }
    }
}

impl Binding {
    pub fn expand_with_ev(mut self, ev_var: EventVariable, ev_index: EventIndex) -> Self {
        match self.event_map.binary_search_by_key(&ev_var, |x| x.0) {
            Ok(i) => self.event_map[i] = (ev_var, ev_index),
            Err(i) => self.event_map.insert(i, (ev_var, ev_index)),
        }
        // self.event_map.insert(ev_var, ev_index);
        self
    }
    pub fn expand_with_ob(mut self, ob_var: ObjectVariable, ob_index: ObjectIndex) -> Self {
        match self.object_map.binary_search_by_key(&ob_var, |x| x.0) {
            Ok(i) => self.object_map[i] = (ob_var, ob_index),
            Err(i) => self.object_map.insert(i, (ob_var, ob_index)),
        }
        // self.object_map.insert(ev_var, ob_index);
        self
    }
    pub fn add_label(&mut self, label: String, value: LabelValue) {
        match self.label_map.binary_search_by_key(&&label, |x| &x.0) {
            Ok(i) => self.label_map[i] = (label, value),
            Err(i) => self.label_map.insert(i, (label, value)),
        }
    }

    /// get all object variables in this binding
    /// guarantees that result is sorted
    pub fn get_all_ob_vars(&self) -> impl Iterator<Item = &ObjectVariable> {
        self.object_map.iter().map(|x| &x.0)
    }
    /// get all event variables in this binding
    /// guarantees that result is sorted
    pub fn get_all_ev_vars(&self) -> impl Iterator<Item = &EventVariable> {
        self.event_map.iter().map(|x| &x.0)
    }

    pub fn get_label_value(&self, label: impl AsRef<str>) -> Option<&LabelValue> {
        match self
            .label_map
            .binary_search_by_key(&label.as_ref(), |x| &x.0)
        {
            Ok(i) => Some(&self.label_map[i].1),
            Err(_) => None,
        }
    }
    pub fn get_ev<'a>(
        &self,
        ev_var: &EventVariable,
        ocel: &'a SlimLinkedOCEL,
    ) -> Option<Cow<'a, OCELEvent>> {
        let ev_index = self.get_ev_index(ev_var)?;
        Some(ocel.get_full_ev(ev_index))
    }
    pub fn get_ob<'a>(
        &self,
        ob_var: &ObjectVariable,
        ocel: &'a SlimLinkedOCEL,
    ) -> Option<Cow<'a, OCELObject>> {
        let ob_index = self.get_ob_index(ob_var)?;
        Some(ocel.get_full_ob(ob_index))
    }

    pub fn to_id_string<'a>(&self, ocel: &'a SlimLinkedOCEL) -> String {
        let mut ret = String::new();
        for (_ev_var, ev_val) in &self.event_map {
            ret.push_str(ocel.get_ev_id(ev_val));
            ret.push_str(", ");
        }
        for (_ob_var, ob_val) in &self.object_map {
            ret.push_str(ocel.get_ob_id(ob_val));
            ret.push_str(", ");
        }

        ret
    }

    #[inline]
    pub fn get_ev_index(&self, ev_var: &EventVariable) -> Option<&EventIndex> {
        if let Ok(index) = self.event_map.binary_search_by_key(ev_var, |x| x.0) {
            return Some(&self.event_map[index].1);
        }
        None
        // self.event_map.get(ev_var)
    }
    #[inline]
    pub fn get_ob_index(&self, ob_var: &ObjectVariable) -> Option<&ObjectIndex> {
        if let Ok(index) = self.object_map.binary_search_by_key(ob_var, |x| x.0) {
            return Some(&self.object_map[index].1);
        }
        None
        // self.object_map.get(ob_var)
    }

    pub fn get_any_index(&self, var: &Variable) -> Option<EventOrObjectIndex> {
        match var {
            Variable::Event(ev) => self.get_ev_index(ev).map(|r| EventOrObjectIndex::Event(*r)),
            Variable::Object(ov) => self
                .get_ob_index(ov)
                .map(|r: &ObjectIndex| EventOrObjectIndex::Object(*r)),
        }
    }
}

/// Maps a variable name to a set of object/event types
///
/// The value set indicates the types of the value the object/event variable should be bound to
pub type NewObjectVariables = HashMap<ObjectVariable, HashSet<String>>;
pub type NewEventVariables = HashMap<EventVariable, HashSet<String>>;

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BindingBox {
    pub new_event_vars: NewEventVariables,
    pub new_object_vars: NewObjectVariables,
    pub filters: Vec<Filter>,
    pub size_filters: Vec<SizeFilter>,
    pub constraints: Vec<Constraint>,
    #[serde(default)]
    #[ts(optional)]
    #[ts(as = "Option<HashMap<EventVariable,FilterLabel>>")]
    pub ev_var_labels: HashMap<EventVariable, FilterLabel>,
    #[serde(default)]
    #[ts(optional)]
    #[ts(as = "Option<HashMap<EventVariable,FilterLabel>>")]
    pub ob_var_labels: HashMap<ObjectVariable, FilterLabel>,
    #[serde(default)]
    #[ts(optional)]
    #[ts(as = "Option<Vec<LabelFunction>>")]
    pub labels: Vec<LabelFunction>,
}

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub enum FilterLabel {
    #[default]
    IGNORED,
    INCLUDED,
    EXCLUDED,
}

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LabelFunction {
    pub label: String,
    pub cel: String,
}

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingBoxTree {
    pub nodes: Vec<BindingBoxTreeNode>,
    #[serde_as(as = "Vec<(_, _)>")]
    #[ts(as = "Vec<((usize, usize), String)>")]
    pub edge_names: HashMap<(usize, usize), String>, // #[serde_as(as = "Vec<(_, _)>")]
                                                     // #[ts(as = "Vec<((usize, usize), (Option<usize>, Option<usize>))>")]
                                                     // pub size_constraints: HashMap<(usize, usize), (Option<usize>, Option<usize>)>,
}

impl BindingBoxTree {
    pub fn evaluate(&self, ocel: &SlimLinkedOCEL) -> Result<(EvaluationResults, bool), String> {
        if let Some(root) = self.nodes.first() {
            let ((ret, _violation), skipped) = root.evaluate(0, Binding::default(), self, ocel)?;
            // ret.push((0, Binding::default(), violation));
            Ok((ret, skipped))
        } else {
            Ok((vec![], false))
        }
    }

    pub fn get_ev_vars(&self) -> HashSet<EventVariable> {
        self.nodes
            .iter()
            .filter_map(|n| match n {
                BindingBoxTreeNode::Box(b, _) => Some(b.new_event_vars.keys()),
                _ => None,
            })
            .flatten()
            .copied()
            .collect()
    }

    pub fn get_ob_vars(&self) -> HashSet<ObjectVariable> {
        self.nodes
            .iter()
            .filter_map(|n| match n {
                BindingBoxTreeNode::Box(b, _) => Some(b.new_object_vars.keys()),
                _ => None,
            })
            .flatten()
            .copied()
            .collect()
    }
}
#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BindingBoxTreeNode {
    Box(BindingBox, Vec<usize>),
    OR(usize, usize),
    AND(usize, usize),
    NOT(usize),
}
const UNNAMED: &str = "UNNAMED - ";
impl BindingBoxTreeNode {
    pub fn to_box(&self) -> (Cow<'_, BindingBox>, Cow<'_, Vec<usize>>) {
        match self {
            BindingBoxTreeNode::Box(b, children) => (Cow::Borrowed(b), Cow::Borrowed(children)),
            BindingBoxTreeNode::OR(c1, c2) => (
                Cow::Owned(BindingBox {
                    constraints: vec![Constraint::OR {
                        child_names: vec![
                            format!("{}{}", UNNAMED, c1),
                            format!("{}{}", UNNAMED, c2),
                        ],
                    }],
                    ..Default::default()
                }),
                Cow::Owned(vec![*c1, *c2]),
            ),
            BindingBoxTreeNode::AND(c1, c2) => (
                Cow::Owned(BindingBox {
                    constraints: vec![Constraint::AND {
                        child_names: vec![
                            format!("{}{}", UNNAMED, c1),
                            format!("{}{}", UNNAMED, c2),
                        ],
                    }],
                    ..Default::default()
                }),
                Cow::Owned(vec![*c1, *c2]),
            ),
            BindingBoxTreeNode::NOT(c1) => (
                Cow::Owned(BindingBox {
                    constraints: vec![Constraint::NOT {
                        child_names: vec![format!("{}{}", UNNAMED, c1)],
                    }],
                    ..Default::default()
                }),
                Cow::Owned(vec![*c1]),
            ),
        }
    }

    pub fn as_box(&self) -> Option<&BindingBox> {
        match self {
            BindingBoxTreeNode::Box(b, _children) => Some(b),
            _ => None,
        }
    }
}

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ViolationReason {
    TooFewMatchingEvents(usize),
    TooManyMatchingEvents(usize),
    NoChildrenOfORSatisfied,
    LeftChildOfANDUnsatisfied,
    RightChildOfANDUnsatisfied,
    BothChildrenOfANDUnsatisfied,
    ChildrenOfNOTSatisfied,
    ChildNotSatisfied,

    ConstraintNotSatisfied(usize),
    UnknownChildSet,
}

pub type EvaluationResult = (usize, Binding, Option<ViolationReason>);
pub type EvaluationResults = Vec<EvaluationResult>;
use rayon::prelude::*;

impl BindingBoxTreeNode {
    pub fn evaluate(
        &self,
        own_index: usize,
        parent_binding: Binding,
        tree: &BindingBoxTree,
        ocel: &SlimLinkedOCEL,
    ) -> Result<
        (
            (EvaluationResults, Vec<(Binding, Option<ViolationReason>)>),
            bool,
        ),
        String,
    > {
        let (bbox, children) = self.to_box();
        let (expanded, expanding_skipped_bindings): (Vec<Binding>, bool) =
            bbox.expand(parent_binding, ocel)?;
        enum BindingResult {
            FilteredOutBySizeFilter(Binding, EvaluationResults),
            Sat(Binding, EvaluationResults),
            Viol(Binding, ViolationReason, EvaluationResults),
        }
        let expanded_len = expanded.len();
        let it = rayon_cancel::CancelAdapter::new(expanded.into_par_iter());
        let x = it.canceller();
        let re: Vec<BindingResult> = it
            .map(|mut b| {
                let mut all_res = Vec::new();
                let mut child_res = HashMap::with_capacity(children.len());
                for c in children.as_ref() {
                    let c_name = tree
                        .edge_names
                        .get(&(own_index, *c))
                        .cloned()
                        .unwrap_or(format!("{UNNAMED}{c}"));
                    // c_name_map.insert(c_name.clone(), c);
                    let ((c_res, violations), _c_skipped) =
                        // Evaluate Child
                            tree.nodes[*c].evaluate(*c, b.clone(), tree, ocel)?;
                    child_res.insert(c_name, violations);
                    if children.len() * c_res.len() * expanded_len > 25_000_000 {
                        x.cancel();
                        println!(
                            "Too much too handle! {}*{}*{}={}",
                            child_res.len(),
                            c_res.len(),
                            expanded_len,
                            children.len() * c_res.len() * expanded_len
                        );
                    }

                    all_res.extend(c_res);
                }
                for label_fun in &bbox.labels {
                    add_cel_label(&mut b, Some(&child_res), ocel, label_fun)?;
                }
                for sf in &bbox.size_filters {
                    if !sf.check(&b, &child_res, ocel)? {
                        // Vec::default to NOT include child results if a size filter filters the parent binding out
                        // Otherwise, pass all_res
                        return Ok::<BindingResult, String>(
                            BindingResult::FilteredOutBySizeFilter(b.clone(), Vec::default()),
                        );
                    }
                }

                for (constr_index, constr) in bbox.constraints.iter().enumerate() {
                    let viol = match constr {
                        Constraint::Filter { filter } => {
                            if filter.check_binding(&b, ocel)? {
                                None
                            } else {
                                Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                            }
                        }
                        Constraint::SizeFilter { filter } => {
                            if filter.check(&b, &child_res, ocel)? {
                                None
                            } else {
                                Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                            }
                        }
                        // For-all semantics!
                        Constraint::SAT { child_names } => {
                            let violated = child_names.iter().any(|child_name| {
                                if let Some(c_res) = child_res.get(child_name) {
                                    c_res.iter().any(|(_b, v)| v.is_some())
                                } else {
                                    true
                                }
                            });
                            if violated {
                                Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                            } else {
                                None
                            }
                        }
                        // SAT with any (exists) semantics
                        Constraint::ANY { child_names } => {
                            let violated = child_names.iter().any(|child_name| {
                                if let Some(c_res) = child_res.get(child_name) {
                                    c_res.iter().all(|(_b, v)| v.is_some())
                                } else {
                                    true
                                }
                            });
                            if violated {
                                Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                            } else {
                                None
                            }
                        }
                        Constraint::NOT { child_names } => {
                            let violated = child_names.iter().all(|child_name| {
                                if let Some(c_res) = child_res.get(child_name) {
                                    c_res.iter().any(|(_b, v)| v.is_none())
                                } else {
                                    true
                                }
                            });
                            if violated {
                                Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                            } else {
                                None
                            }
                        }
                        Constraint::OR { child_names } => {
                            // println!("Child indices: {:?}, Children: {:?}", child_names, children);
                            let any_sat = child_names.iter().any(|child_name| {
                                if let Some(c_res) = child_res.get(child_name) {
                                    c_res.iter().all(|(_b, v)| v.is_none())
                                } else {
                                    true
                                }
                            });
                            if any_sat {
                                None
                            } else {
                                Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                            }
                        }
                        Constraint::AND { child_names } => {
                            // println!("Child indices: {:?}, Children: {:?}", child_names, children);
                            let any_sat = child_names.iter().all(|child_name| {
                                if let Some(c_res) = child_res.get(child_name) {
                                    c_res.iter().all(|(_b, v)| v.is_none())
                                } else {
                                    true
                                }
                            });
                            if any_sat {
                                None
                            } else {
                                Some(ViolationReason::ConstraintNotSatisfied(constr_index))
                            }
                        }
                    };
                    if let Some(vr) = viol {
                        all_res.push((own_index, b.clone(), Some(vr)));
                        return Ok(BindingResult::Viol(b, vr, all_res));
                    }
                }
                all_res.push((own_index, b.clone(), None));
                Ok(BindingResult::Sat(b, all_res))
            })
            .collect::<Result<_, _>>()?;
        // .collect();
        let recursive_calls_cancelled = x.is_cancelled();
        Ok((
            re.into_par_iter()
                .fold(
                    || (EvaluationResults::new(), Vec::new()),
                    |(mut a, mut b), x| match x {
                        BindingResult::FilteredOutBySizeFilter(_binding, r) => {
                            a.extend(r);
                            (a, b)
                        }
                        BindingResult::Sat(binding, r) => {
                            a.extend(r);
                            b.push((binding, None));
                            (a, b)
                        }
                        BindingResult::Viol(binding, v, r) => {
                            a.extend(r);
                            b.push((binding, Some(v)));
                            (a, b)
                        }
                    },
                )
                .reduce(
                    || (EvaluationResults::new(), Vec::new()),
                    |(mut a, mut b), (x, y)| {
                        a.extend(x);
                        b.extend(y);
                        (a, b)
                    },
                ),
            expanding_skipped_bindings || recursive_calls_cancelled,
        ))

        // let (passed_size_filter, sat, ret) = expanded
        //     .into_par_iter()
        //     .flat_map_iter(|b| {
        //         let mut passed_size_filter = true;
        //         children.iter().map(move |c| {
        //             let (mut c_res, violation) =
        //                 tree.nodes[*c].evaluate(*c, own_index, b.clone(), tree, ocel);
        //             c_res.push((*c, b.clone(), violation));
        //             passed_size_filter = if let Some(_x) = violation {
        //                 (true, c_res)
        //             } else {
        //                 (false, c_res)
        //             }
        //         })
        //     })
        //     .reduce(
        //         || (false, vec![]),
        //         |(violated1, res1), (violated2, res2)| {
        //             (
        //                 violated1 || violated2,
        //                 res1.iter().chain(res2.iter()).cloned().collect(),
        //             )
        //         },
        //     );

        // if vio.is_none() && sat {
        //     vio = Some(ViolationReason::ChildNotSatisfied)
        // }
        // (ret, vio)
    }
    // BindingBoxTreeNode::OR(i1, i2) => {
    //     let node1 = &tree.nodes[*i1];
    //     let node2 = &tree.nodes[*i2];

    //     let mut ret = vec![];

    //     let (res_1, violation_1) =
    //         node1.evaluate(*i1, own_index, parent_binding.clone(), tree, ocel);

    //     ret.extend(res_1);
    //     ret.push((*i1, parent_binding.clone(), violation_1));

    //     let (res_2, violation_2) =
    //         node2.evaluate(*i2, own_index, parent_binding.clone(), tree, ocel);

    //     ret.extend(res_2);
    //     ret.push((*i2, parent_binding.clone(), violation_2));

    //     if violation_1.is_some() && violation_2.is_some() {
    //         return (ret, Some(ViolationReason::NoChildrenOfORSatisfied));
    //     }
    //     (ret, None)
    // }
    // BindingBoxTreeNode::AND(i1, i2) => {
    //     let node1 = &tree.nodes[*i1];
    //     let node2 = &tree.nodes[*i2];

    //     let mut ret = vec![];

    //     let (res_1, violation_1) =
    //         node1.evaluate(*i1, own_index, parent_binding.clone(), tree, ocel);

    //     ret.push((*i1, parent_binding.clone(), violation_1));
    //     ret.extend(res_1);
    //     let (res_2, violation_2) =
    //         node2.evaluate(*i2, own_index, parent_binding.clone(), tree, ocel);
    //     ret.push((*i2, parent_binding.clone(), violation_2));
    //     ret.extend(res_2);

    //     if violation_1.is_some() {
    //         return (ret, Some(ViolationReason::LeftChildOfANDUnsatisfied));
    //     } else if violation_2.is_some() {
    //         return (ret, Some(ViolationReason::RightChildOfANDUnsatisfied));
    //     }
    //     (ret, None)
    // }
    // BindingBoxTreeNode::NOT(i) => {
    //     let mut ret = vec![];
    //     let node = &tree.nodes[*i];

    //     let (res_c, violation_c) =
    //         node.evaluate(*i, own_index, parent_binding.clone(), tree, ocel);
    //     ret.extend(res_c);
    //     ret.push((*i, parent_binding.clone(), violation_c));
    //     if violation_c.is_some() {
    //         // NOT satisfied
    //         (ret, None)
    //     } else {
    //         (ret, Some(ViolationReason::ChildrenOfNOTSatisfied))
    //     }
    // }
    //     _ => todo!(),
    // }
    // }
}

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Filter {
    /// Object is associated with event (optionally through a qualifier)
    O2E {
        object: ObjectVariable,
        event: EventVariable,
        qualifier: Qualifier,
        #[serde(default)]
        #[ts(optional)]
        #[serde(rename = "filterLabel")]
        filter_label: Option<FilterLabel>,
    },
    /// Object1 is associated with object2 (optionally through a qualifier)
    O2O {
        object: ObjectVariable,
        other_object: ObjectVariable,
        qualifier: Qualifier,
        #[serde(default)]
        #[ts(optional)]
        #[serde(rename = "filterLabel")]
        filter_label: Option<FilterLabel>,
    },
    /// Time duration betweeen event1 and event2 is in the specified interval (min,max) (given in Some(seconds); where None represents no restriction)
    TimeBetweenEvents {
        from_event: EventVariable,
        to_event: EventVariable,
        min_seconds: Option<f64>,
        max_seconds: Option<f64>,
    },
    NotEqual {
        var_1: Variable,
        var_2: Variable,
    },
    EventAttributeValueFilter {
        event: EventVariable,
        attribute_name: String,
        value_filter: ValueFilter,
    },
    ObjectAttributeValueFilter {
        object: ObjectVariable,
        attribute_name: String,
        at_time: ObjectValueFilterTimepoint,
        value_filter: ValueFilter,
    },
    BasicFilterCEL {
        cel: String,
    },
}

impl Filter {
    pub fn check_binding(&self, b: &Binding, ocel: &SlimLinkedOCEL) -> Result<bool, String> {
        match self {
            Filter::O2E {
                object,
                event,
                qualifier,
                filter_label: _,
            } => {
                let ob_index = b
                    .get_ob_index(object)
                    .ok_or_else(|| format!("Object Variable {object} without value."))?;
                let ev_index = b
                    .get_ev_index(event)
                    .ok_or_else(|| format!("Event Variable {event} without value."))?;
                let ob_type = ocel.get_ob_type_of(ob_index);
                Ok(ocel
                    .get_e2o_of_type(ev_index, ob_type)
                    .any(|(q, o)| o == ob_index && qualifier.as_ref().is_none_or(|qual| q == qual)))
            }
            Filter::O2O {
                object,
                other_object,
                qualifier,
                filter_label: _,
            } => {
                let ob1 = b
                    .get_ob_index(object)
                    .ok_or_else(|| format!("Object Variable {object} without value"))?;
                let ob2 = b
                    .get_ob_index(other_object)
                    .ok_or_else(|| format!("Object Variable {other_object} without value"))?;
                let ob2_type = ocel.get_ob_type_of(ob2);
                Ok(ocel
                    .get_o2o_of_type(ob1, ob2_type)
                    .any(|(q, o)| o == ob2 && qualifier.as_ref().is_none_or(|qual| q == qual)))
            }
            Filter::TimeBetweenEvents {
                from_event: ev_var_1,
                to_event: ev_var_2,
                min_seconds: min_sec,
                max_seconds: max_sec,
            } => {
                let e1 = b
                    .get_ev_index(ev_var_1)
                    .ok_or_else(|| format!("Event Variable {ev_var_1} without value"))?;
                let e2 = b
                    .get_ev_index(ev_var_2)
                    .ok_or_else(|| format!("Event Variable {ev_var_2} without value"))?;
                let e1_time = e1.get_time(ocel);
                let e2_time = e2.get_time(ocel);
                let duration_diff = (*e2_time - e1_time).num_milliseconds() as f64 / 1000.0;
                Ok(!min_sec.is_some_and(|min_sec| duration_diff < min_sec)
                    && !max_sec.is_some_and(|max_sec| duration_diff > max_sec))
            }
            Filter::NotEqual { var_1, var_2 } => {
                let val_1 = b.get_any_index(var_1);
                let val_2 = b.get_any_index(var_2);
                Ok(!(val_1.is_none() || val_2.is_none() || val_1 == val_2))
            }
            Filter::EventAttributeValueFilter {
                event,
                attribute_name,
                value_filter,
            } => {
                let e_opt = b.get_ev(event, ocel);
                if let Some(e) = e_opt {
                    if attribute_name == "ocel:id" {
                        if let ValueFilter::String { is_in } = value_filter {
                            return Ok(is_in.contains(&e.id));
                        }
                        return Ok(false);
                    }
                    if attribute_name == "ocel:time" {
                        return Ok(value_filter.check_value(&OCELAttributeValue::Time(e.time)));
                    }
                    if let Some(attr) = e.attributes.iter().find(|at| &at.name == attribute_name) {
                        Ok(value_filter.check_value(&attr.value))
                    } else {
                        Ok(false)
                    }
                } else {
                    Ok(false)
                }
            }
            Filter::ObjectAttributeValueFilter {
                object,
                attribute_name,
                at_time,
                value_filter,
            } => {
                let o_opt = b.get_ob(object, ocel);
                if let Some(o) = o_opt {
                    if attribute_name == "ocel:id" {
                        if let ValueFilter::String { is_in } = value_filter {
                            return Ok(is_in.contains(&o.id));
                        }
                        return Ok(false);
                    }
                    match at_time {
                        ObjectValueFilterTimepoint::Always => Ok(o
                            .attributes
                            .iter()
                            .filter(|at| &at.name == attribute_name)
                            .all(|at| value_filter.check_value(&at.value))),
                        ObjectValueFilterTimepoint::Sometime => Ok(o
                            .attributes
                            .iter()
                            .filter(|at| &at.name == attribute_name)
                            .any(|at| value_filter.check_value(&at.value))),
                        ObjectValueFilterTimepoint::AtEvent { event } => {
                            if let Some(ev) = b.get_ev_index(event) {
                                let ev_time = ocel.get_ev_time(ev);
                                // Find last attribute value update _before_ the event occured (or at the same time)
                                if let Some(last_val_before) = o
                                    .attributes
                                    .iter()
                                    .filter(|at| &at.name == attribute_name && &at.time <= ev_time)
                                    .sorted_by_key(|x| x.time)
                                    .last()
                                {
                                    Ok(value_filter.check_value(&last_val_before.value))
                                } else {
                                    Ok(false)
                                }
                            } else {
                                Ok(false)
                            }
                        }
                    }
                } else {
                    Ok(false)
                }
            }
            Filter::BasicFilterCEL { cel } => {
                // let now = Instant::now();

                // println!("Took {:?}",now.elapsed());
                Ok(check_cel_predicate(cel, b, None, ocel)?)
            }
        }
    }
}

#[derive(TS, Debug, Clone, Serialize, Deserialize)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[serde(tag = "type")]

pub enum ValueFilter {
    Float {
        min: Option<f64>,
        max: Option<f64>,
    },
    Integer {
        // Prevent BigInt as TS/JS type
        // We do not really care about such large values + it messes with JSON
        #[ts(as = "Option<i32>")]
        min: Option<i64>,
        #[ts(as = "Option<i32>")]
        max: Option<i64>,
    },
    Boolean {
        is_true: bool,
    },
    String {
        is_in: Vec<String>,
    },
    Time {
        from: Option<chrono::DateTime<chrono::Utc>>,
        to: Option<chrono::DateTime<chrono::Utc>>,
    },
}

impl ValueFilter {
    pub fn check_value(&self, val: &OCELAttributeValue) -> bool {
        match self {
            ValueFilter::Float { min, max } => match val {
                OCELAttributeValue::Float(v) => {
                    !min.is_some_and(|min_v| v < &min_v) && !max.is_some_and(|max_v| v > &max_v)
                }
                OCELAttributeValue::Integer(v) => {
                    !min.is_some_and(|min_v| (*v as f64) < min_v)
                        && !max.is_some_and(|max_v| (*v as f64) > max_v)
                }
                _ => false,
            },
            ValueFilter::Integer { min, max } => match val {
                OCELAttributeValue::Integer(v) => {
                    !min.is_some_and(|min_v| v < &min_v) && !max.is_some_and(|max_v| v > &max_v)
                }
                OCELAttributeValue::Float(v) => {
                    !min.is_some_and(|min_v| *v < (min_v as f64))
                        && !max.is_some_and(|max_v| *v > (max_v as f64))
                }
                _ => false,
            },
            ValueFilter::Boolean { is_true } => match val {
                OCELAttributeValue::Boolean(b) => is_true == b,
                _ => false,
            },
            ValueFilter::String { is_in } => match val {
                OCELAttributeValue::String(s) => is_in.contains(s),
                _ => false,
            },
            ValueFilter::Time { from, to } => match val {
                OCELAttributeValue::Time(v) => {
                    !from.is_some_and(|min_v| v < &min_v) && !to.is_some_and(|max_v| v > &max_v)
                }
                _ => false,
            },
        }
    }
}

#[derive(TS, Debug, Clone, Serialize, Deserialize)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[serde(tag = "type")]
pub enum ObjectValueFilterTimepoint {
    Always,
    Sometime,
    AtEvent { event: EventVariable },
}

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SizeFilter {
    // The nth child should be between (min,max) interval, where None represent no bound
    NumChilds {
        child_name: NodeEdgeName,
        min: Option<usize>,
        max: Option<usize>,
    },
    BindingSetEqual {
        child_names: Vec<NodeEdgeName>,
    },
    BindingSetProjectionEqual {
        child_name_with_var_name: Vec<(NodeEdgeName, Variable)>,
    },
    NumChildsProj {
        child_name: NodeEdgeName,
        var_name: Variable,
        min: Option<usize>,
        max: Option<usize>,
    },
    AdvancedCEL {
        cel: String,
    },
}

impl SizeFilter {
    pub fn check(
        &self,
        binding: &Binding,
        child_res: &HashMap<String, Vec<(Binding, Option<ViolationReason>)>>,
        ocel: &SlimLinkedOCEL,
    ) -> Result<bool, String> {
        match self {
            SizeFilter::NumChilds {
                child_name,
                min,
                max,
            } => {
                // println!("{child_index} {c} Min: {:?} Max: {:?} Len: {}",min,max,violations.len());
                if let Some(c_res) = child_res.get(child_name) {
                    if min.is_some_and(|min| c_res.len() < min) {
                        Ok(false)
                    } else {
                        Ok(!max.is_some_and(|max| c_res.len() > max))
                    }
                } else {
                    Ok(false)
                }
            }
            SizeFilter::NumChildsProj {
                child_name,
                var_name,
                min,
                max,
            } => {
                if let Some(c_res) = child_res.get(child_name) {
                    let set: HashSet<_> = c_res
                        .iter()
                        .flat_map(|(b, _)| b.get_any_index(var_name))
                        .collect();
                    if min.is_some_and(|min| set.len() < min) {
                        Ok(false)
                    } else {
                        Ok(!max.is_some_and(|max| set.len() > max))
                    }
                } else {
                    Ok(false)
                }
            }
            SizeFilter::BindingSetEqual { child_names } => {
                if child_names.is_empty() {
                    Ok(true)
                } else if let Some(c_res) = child_res.get(&child_names[0]) {
                    let set1: HashSet<_> = c_res.iter().map(|(binding, _)| binding).collect();
                    for other_c in child_names.iter().skip(1) {
                        if let Some(c2_res) = child_res.get(other_c) {
                            let set2: HashSet<_> =
                                c2_res.iter().map(|(binding, _)| binding).collect();
                            if set1 != set2 {
                                return Ok(false);
                            }
                        } else {
                            return Ok(false);
                        }
                    }
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
            SizeFilter::BindingSetProjectionEqual {
                child_name_with_var_name,
            } => {
                if child_name_with_var_name.is_empty() {
                    Ok(true)
                } else if let Some(c_res) = child_res.get(&child_name_with_var_name[0].0) {
                    let set: HashSet<_> = c_res
                        .iter()
                        .map(|(binding, _)| match child_name_with_var_name[0].1 {
                            Variable::Event(e_var) => binding
                                .get_ev_index(&e_var)
                                .map(|e| EventOrObjectIndex::from(*e)),
                            Variable::Object(o_var) => binding
                                .get_ob_index(&o_var)
                                .map(|o| EventOrObjectIndex::from(*o)),
                        })
                        .collect();
                    for (other_c, var) in child_name_with_var_name.iter().skip(1) {
                        if let Some(c2_res) = child_res.get(other_c) {
                            let set2: HashSet<_> = c2_res
                                .iter()
                                .map(|(binding, _)| match var {
                                    Variable::Event(e_var) => binding
                                        .get_ev_index(e_var)
                                        .map(|e| EventOrObjectIndex::from(*e)),
                                    Variable::Object(o_var) => binding
                                        .get_ob_index(o_var)
                                        .map(|o| EventOrObjectIndex::from(*o)),
                                })
                                .collect();
                            if set != set2 {
                                return Ok(false);
                            }
                        } else {
                            return Ok(false);
                        }
                    }
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
            SizeFilter::AdvancedCEL { cel } => {
                Ok(check_cel_predicate(cel, binding, Some(child_res), ocel)?)
            }
        }
    }
}

type NodeEdgeName = String;

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Constraint {
    Filter { filter: Filter },
    SizeFilter { filter: SizeFilter },
    SAT { child_names: Vec<NodeEdgeName> },
    ANY { child_names: Vec<NodeEdgeName> },
    NOT { child_names: Vec<NodeEdgeName> },
    OR { child_names: Vec<NodeEdgeName> },
    AND { child_names: Vec<NodeEdgeName> },
}

impl Filter {
    pub fn get_involved_variables(&self) -> HashSet<Variable> {
        match self {
            Filter::O2E {
                object,
                event,
                qualifier: _,
                filter_label: _,
            } => vec![Variable::Object(*object), Variable::Event(*event)]
                .into_iter()
                .collect(),
            Filter::O2O {
                object,
                other_object,
                qualifier: _,
                filter_label: _,
            } => vec![Variable::Object(*object), Variable::Object(*other_object)]
                .into_iter()
                .collect(),
            Filter::TimeBetweenEvents {
                from_event,
                to_event,
                min_seconds: _,
                max_seconds: _,
            } => vec![Variable::Event(*from_event), Variable::Event(*to_event)]
                .into_iter()
                .collect(),
            Filter::NotEqual { var_1, var_2 } => {
                vec![var_1.clone(), var_2.clone()].into_iter().collect()
            }
            Filter::EventAttributeValueFilter {
                event,
                attribute_name: _,
                value_filter: _,
            } => vec![Variable::Event(*event)].into_iter().collect(),
            Filter::ObjectAttributeValueFilter {
                object,
                attribute_name: _,
                at_time,
                value_filter: _,
            } => {
                let mut ret: HashSet<_> = vec![Variable::Object(*object)].into_iter().collect();
                if let ObjectValueFilterTimepoint::AtEvent { event } = at_time {
                    ret.insert(Variable::Event(*event));
                }
                ret
            }
            Filter::BasicFilterCEL { cel } => get_vars_in_cel_program(cel),
        }
    }
}

type DurationIntervalSeconds = (Option<f64>, Option<f64>);

#[derive(Debug, Clone)]
pub enum BindingStep {
    BindEv(
        EventVariable,
        Option<Vec<(EventVariable, DurationIntervalSeconds)>>,
    ),
    BindOb(ObjectVariable),
    /// Bind ob
    BindObFromEv(ObjectVariable, EventVariable, Qualifier),
    // bool: reversed?
    BindObFromOb(ObjectVariable, ObjectVariable, Qualifier, bool),
    BindEvFromOb(EventVariable, ObjectVariable, Qualifier),
    Filter(Filter),
}

//
// Display Implementations
//

impl Display for Binding {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "Binding [")?;
        write!(f, "\tEvents: {{ ")?;
        for (i, (ev_var, ev_index)) in self.event_map.iter().enumerate() {
            write!(f, "{ev_var} => {ev_index:?}")?;
            if i < self.event_map.len() - 1 {
                write!(f, ", ")?;
            }
        }
        write!(f, " }}\n\tObjects: {{ ")?;
        for (i, (ob_var, ob_index)) in self.object_map.iter().enumerate() {
            write!(f, "{ob_var} => {ob_index:?}")?;
            if i < self.object_map.len() - 1 {
                write!(f, ", ")?;
            }
        }
        write!(f, " }}")?;
        write!(f, "\n]")?;
        Ok(())
    }
}

impl Display for ObjectVariable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "o{}", self.0 + 1)
    }
}

impl Display for EventVariable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "e{}", self.0 + 1)
    }
}
