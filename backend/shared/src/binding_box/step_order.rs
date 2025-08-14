use std::collections::{HashMap, HashSet};

use itertools::Itertools;
use process_mining::ocel::linked_ocel::{IndexLinkedOCEL, LinkedOCELAccess};

use crate::discovery::advanced::EventOrObjectTypeRef;

use super::{
    structs::{BindingBox, BindingStep, Filter, Qualifier, Variable},
    Binding,
};

pub fn get_expected_relation_count(
    bound_by: &Variable,
    bbox: &BindingBox,
    parent_binding_opt: Option<&Binding>,
    ocel: &IndexLinkedOCEL,
) -> Option<usize> {
    let mut bound_by_types = Vec::new();
    // First check if bound_by is already bound by parent
    if let Some(bound_by_index) = parent_binding_opt.and_then(|b| b.get_any_index(bound_by)) {
        let bound_by_type = match bound_by_index {
            process_mining::ocel::linked_ocel::index_linked_ocel::EventOrObjectIndex::Event(
                event_index,
            ) => EventOrObjectTypeRef::Event(ocel.get_ev(&event_index).event_type.as_str()),
            process_mining::ocel::linked_ocel::index_linked_ocel::EventOrObjectIndex::Object(
                object_index,
            ) => EventOrObjectTypeRef::Object(ocel.get_ob(&object_index).object_type.as_str()),
        };
        bound_by_types.push(bound_by_type);
    } else {
        bound_by_types = match bound_by {
            Variable::Event(var_ev) => bbox
                .new_event_vars
                .get(var_ev)
                .unwrap()
                .iter()
                .map(|t| EventOrObjectTypeRef::Event(t.as_str()))
                .collect(),
            Variable::Object(var_ob) => bbox
                .new_object_vars
                .get(var_ob)
                .unwrap()
                .iter()
                .map(|t| EventOrObjectTypeRef::Object(t.as_str()))
                .collect(),
        }
    }
    let res = bound_by_types
        .into_iter()
        .map(|bound_by_type| {
            // Previously this was based on the average relations of an object/event
            // Now it's simply the count (how many exist)
            match bound_by_type {
                EventOrObjectTypeRef::Event(t) => ocel
                    .events_per_type
                    .get(t)
                    .map(|es| es.len())
                    .unwrap_or_default(),
                EventOrObjectTypeRef::Object(t) => ocel
                    .objects_per_type
                    .get(t)
                    .map(|es| es.len())
                    .unwrap_or_default(),
            }
        })
        .sum();
    println!("{res} for {bound_by:?}");
    Some(res)
}
impl BindingStep {
    /// Get a binding order from a binding box
    ///
    /// A binding order has the following properties
    ///
    /// * All object/event variables that the input binding box binds are bound before they are used in a filter
    /// * The order should enable fast construction, i.e., it should create as few unnecessary bindings in between as possible
    ///
    /// For that, it e.g., could make sense to first bind an event variable and then use the bound event to bind object variables
    pub fn get_binding_order(
        bbox: &BindingBox,
        parent_binding_opt: Option<&Binding>,
        ocel: &IndexLinkedOCEL,
    ) -> Vec<Self> {
        let mut ret = Vec::new();

        let mut var_requiring_bindings: HashSet<Variable> = bbox
            .new_event_vars
            .keys()
            .map(|v| Variable::Event(*v))
            .chain(bbox.new_object_vars.keys().map(|v| Variable::Object(*v)))
            .collect();

        let new_vars = var_requiring_bindings.clone();
        let mut bound_vars: HashSet<_> = bbox
            .filters
            .iter()
            .flat_map(|f| f.get_involved_variables())
            .filter(|var| !new_vars.contains(var))
            .collect();
        // Maps a variable A to the set of variable that can be bound based on A
        let mut var_can_bind: HashMap<Variable, HashSet<Variable>> = bound_vars
            .iter()
            .map(|v| (v.clone(), HashSet::new()))
            .collect();
        // Additional info, with a qualifier and the index of a filter constraint
        let mut var_can_bind_with_qualifier: HashMap<
            Variable,
            HashSet<(Variable, Qualifier, usize, bool)>,
        > = bound_vars
            .iter()
            .map(|v| (v.clone(), HashSet::new()))
            .collect();
        for ev_var in bbox.new_event_vars.keys() {
            var_can_bind.insert(Variable::Event(*ev_var), HashSet::new());
            var_can_bind_with_qualifier.insert(Variable::Event(*ev_var), HashSet::new());
        }
        for ob_var in bbox.new_object_vars.keys() {
            var_can_bind.insert(Variable::Object(*ob_var), HashSet::new());
            var_can_bind_with_qualifier.insert(Variable::Object(*ob_var), HashSet::new());
        }
        // Event (corresponding to map key) can be bound based on time restriction regarding reference event (first tuple element in value)
        let time_between_evs: HashMap<_, _> = bbox
            .filters
            .iter()
            .filter_map(|f| match f {
                Filter::TimeBetweenEvents {
                    from_event,
                    to_event,
                    min_seconds,
                    max_seconds,
                } => Some(vec![
                    (to_event, (from_event, *min_seconds, *max_seconds)),
                    (
                        from_event,
                        (to_event, max_seconds.map(|s| -s), min_seconds.map(|s| -s)),
                    ),
                ]),
                _ => None,
            })
            .flatten()
            .collect();

        // First count how many other variables depend on a variable (gather them in a set)
        for (i, f) in bbox.filters.iter().enumerate() {
            match f {
                Filter::O2E {
                    object,
                    event,
                    qualifier,
                    filter_label: _,
                } => {
                    var_can_bind
                        .entry(Variable::Object(*object))
                        .or_default()
                        .insert(Variable::Event(*event));
                    var_can_bind_with_qualifier
                        .entry(Variable::Object(*object))
                        .or_default()
                        .insert((Variable::Event(*event), qualifier.clone(), i, false));

                    var_can_bind
                        .entry(Variable::Event(*event))
                        .or_default()
                        .insert(Variable::Object(*object));
                    var_can_bind_with_qualifier
                        .entry(Variable::Event(*event))
                        .or_default()
                        .insert((Variable::Object(*object), qualifier.clone(), i, true));
                }
                Filter::O2O {
                    object,
                    other_object,
                    qualifier,
                    filter_label: _,
                } => {
                    var_can_bind
                        .entry(Variable::Object(*object))
                        .or_default()
                        .insert(Variable::Object(*other_object));
                    var_can_bind_with_qualifier
                        .entry(Variable::Object(*object))
                        .or_default()
                        .insert((Variable::Object(*other_object), qualifier.clone(), i, false));

                    var_can_bind
                        .entry(Variable::Object(*other_object))
                        .or_default()
                        .insert(Variable::Object(*object));
                    var_can_bind_with_qualifier
                        .entry(Variable::Object(*other_object))
                        .or_default()
                        .insert((Variable::Object(*object), qualifier.clone(), i, true));
                }
                _ => {}
            }
        }
        let mut filter_indices_incoporated = HashSet::new();

        fn add_supported_filters(
            bbox: &BindingBox,
            filter_indices_incoporated: &mut HashSet<usize>,
            var_requiring_bindings: &mut HashSet<Variable>,
            ret: &mut Vec<BindingStep>,
        ) {
            bbox.filters
                .iter()
                .enumerate()
                .filter(|(index, filter_constraint)| {
                    if !filter_indices_incoporated.contains(index) {
                        var_requiring_bindings
                            .intersection(&filter_constraint.get_involved_variables())
                            .count()
                            == 0
                    } else {
                        false
                    }
                })
                .collect_vec()
                .into_iter()
                .for_each(|(index, filter_constraint)| {
                    ret.push(BindingStep::Filter(filter_constraint.clone()));
                    filter_indices_incoporated.insert(index);
                });
        }

        let mut expansion = var_can_bind
            .clone()
            .into_iter()
            .filter(|(v, _vs)| !bound_vars.contains(v))
            // Prefer binding events over objects first
            .sorted_by_key(|(v, vs)| {
                let can_be_bound = bound_vars
                    .iter()
                    .any(|bv| var_can_bind.get(bv).unwrap().contains(v));
                (vs.len() as i32) * 10
                    + if can_be_bound { 100 } else { 0 }
                    + if let Variable::Object(_) = v { 0 } else { 1 }
            })
            .map(|(k, _)| k)
            .collect_vec();
        while !expansion.is_empty() {
            if let Some(var) = expansion.pop() {
                if bound_vars.contains(&var) {
                    continue;
                }
                if let Some((v, (_var, qualifier, filter_index, reversed))) = bound_vars
                    .iter()
                    .flat_map(|v| {
                        var_can_bind_with_qualifier
                            .get(v)
                            .unwrap()
                            .iter()
                            .find(|(x, _q, _filter_index, _reversed)| x == &var)
                            .map(|t| (v, t))
                    })
                    .sorted_by_cached_key(|(bound_by_var, (_v, _q, _filter_index, _reversed))| {
                        get_expected_relation_count(bound_by_var, bbox, parent_binding_opt, ocel)
                            .unwrap_or(10)
                    })
                    .next()
                {
                    // `var` can be bound based on `v`!
                    filter_indices_incoporated.insert(*filter_index);
                    match v {
                        Variable::Event(v_ev) => match var {
                            Variable::Object(var_ob) => ret.push(BindingStep::BindObFromEv(
                                var_ob,
                                *v_ev,
                                qualifier.clone(),
                            )),
                            _ => {
                                eprintln!("Can not bind an event based on another event.")
                            }
                        },
                        Variable::Object(v_ob) => match var {
                            Variable::Event(var_ev) => ret.push(BindingStep::BindEvFromOb(
                                var_ev,
                                *v_ob,
                                qualifier.clone(),
                            )),
                            Variable::Object(var_ob) => ret.push(BindingStep::BindObFromOb(
                                var_ob,
                                *v_ob,
                                qualifier.clone(),
                                *reversed,
                            )),
                        },
                    }
                } else {
                    match var {
                        Variable::Event(var_ev) => {
                            if let Some((ref_ev, min_sec, max_sec)) = time_between_evs.get(&var_ev)
                            {
                                ret.push(BindingStep::BindEv(
                                    var_ev,
                                    Some(vec![(**ref_ev, (*min_sec, *max_sec))]),
                                ));
                            } else {
                                ret.push(BindingStep::BindEv(var_ev, None));
                            }
                        }
                        Variable::Object(var_ob) => ret.push(BindingStep::BindOb(var_ob)),
                    }
                }
                var_requiring_bindings.remove(&var);
                bound_vars.insert(var);
                add_supported_filters(
                    bbox,
                    &mut filter_indices_incoporated,
                    &mut var_requiring_bindings,
                    &mut ret,
                );
            }
            expansion.sort_by_key(|var| {
                let can_be_bound = bound_vars
                    .iter()
                    .any(|bv| var_can_bind.get(bv).unwrap().contains(var));
                if can_be_bound {
                    100
                } else {
                    0
                }
            })
        }

        ret.extend(
            bbox.filters
                .iter()
                .enumerate()
                .filter(|(i, _)| !filter_indices_incoporated.contains(i))
                .map(|(_, f)| BindingStep::Filter(f.clone())),
        );
        // println!("Steps: {ret:?}");
        ret
    }
}
