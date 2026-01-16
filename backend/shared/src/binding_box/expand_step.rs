use itertools::Itertools;
use process_mining::core::event_data::object_centric::linked_ocel::{
    slim_linked_ocel::ObjectIndex, LinkedOCELAccess, SlimLinkedOCEL,
};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use super::structs::{Binding, BindingBox, BindingStep};
const MAX_NUM_BINDINGS: usize = 10_000_000;
/// This can slightly reduce memory usage by filtering out unfitting bindings before collecting into a vec
/// However, the filters may be checked multiple times
// #[inline(always)]
fn check_next_filters(
    b: Binding,
    last_considered_index: usize,
    steps: &[BindingStep],
    ocel: &SlimLinkedOCEL,
) -> Option<Binding> {
    for step in steps.iter().skip(last_considered_index + 1) {
        if let BindingStep::Filter(f) = &step {
            if f.check_binding(&b, ocel).ok()? {
                continue;
            } else {
                return None;
            }
        } else {
            break;
        }
    }
    Some(b)
}

impl BindingBox {
    pub fn expand_empty(&self, ocel: &SlimLinkedOCEL) -> Result<(Vec<Binding>, bool), String> {
        self.expand(Binding::default(), ocel)
    }

    pub fn expand_with_steps_empty(
        &self,
        ocel: &SlimLinkedOCEL,
        steps: &[BindingStep],
    ) -> Result<(Vec<Binding>, bool), String> {
        self.expand_with_steps(Binding::default(), ocel, steps)
    }

    pub fn expand(
        &self,
        parent_binding: Binding,
        ocel: &SlimLinkedOCEL,
    ) -> Result<(Vec<Binding>, bool), String> {
        let order = BindingStep::get_binding_order(self, Some(&parent_binding), ocel);
        self.expand_with_steps(parent_binding, ocel, &order)
    }

    pub fn expand_with_steps(
        &self,
        parent_binding: Binding,
        ocel: &SlimLinkedOCEL,
        steps: &[BindingStep],
    ) -> Result<(Vec<Binding>, bool), String> {
        // println!("Steps: {:?}", steps);
        let mut ret = vec![parent_binding];
        let mut bindings_skipped = false;
        for step_index in 0..steps.len() {
            let step = &steps[step_index];
            if step_index > 0 && matches!(step, BindingStep::Filter(_)) {
                continue;
            }
            match &step {
                BindingStep::BindEv(ev_var, time_constr) => {
                    let ev_types = self
                        .new_event_vars
                        .get(ev_var)
                        .ok_or_else(|| format!("Could not get {ev_var}"))?;
                    ret = ret
                        .into_par_iter()
                        .flat_map_iter(|b| {
                            ev_types
                                .iter()
                                .flat_map(|ev_type| ocel.get_evs_of_type(ev_type))
                                .filter_map(move |e_index| {
                                    if time_constr.is_none()
                                        || time_constr.as_ref().unwrap().iter().all(
                                            |(ref_ev_var_name, (min_sec, max_sec))| {
                                                let ref_ev = b.get_ev_index(ref_ev_var_name);
                                                if let Some(ref_ev) = ref_ev {
                                                    let ref_ev_time = ocel.get_ev_time(ref_ev);
                                                    let e_time = ocel.get_ev_time(e_index);
                                                    let duration_diff = (*e_time - ref_ev_time)
                                                        .num_milliseconds()
                                                        as f64
                                                        / 1000.0;
                                                    !min_sec.is_some_and(|min_sec| {
                                                        duration_diff < min_sec
                                                    }) && !max_sec.is_some_and(|max_sec| {
                                                        duration_diff > max_sec
                                                    })
                                                } else {
                                                    true
                                                }
                                            },
                                        )
                                    {
                                        check_next_filters(
                                            b.clone().expand_with_ev(*ev_var, *e_index),
                                            step_index,
                                            steps,
                                            ocel,
                                        )
                                    } else {
                                        None
                                    }
                                })
                        })
                        .take_any(MAX_NUM_BINDINGS + 1)
                        .collect();
                }
                BindingStep::BindOb(ob_var) => {
                    let ob_types = self
                        .new_object_vars
                        .get(ob_var)
                        .ok_or_else(|| format!("Could not get {ob_var}"))?;
                    ret = ret
                        .into_par_iter()
                        .flat_map_iter(|b| {
                            ob_types
                                .iter()
                                .flat_map(|ob_type| ocel.get_obs_of_type(ob_type))
                                .filter_map(move |o_index| {
                                    check_next_filters(
                                        b.clone().expand_with_ob(*ob_var, *o_index),
                                        step_index,
                                        steps,
                                        ocel,
                                    )
                                })
                        })
                        .take_any(MAX_NUM_BINDINGS + 1)
                        .collect();
                }
                BindingStep::BindObFromEv(ob_var, from_ev_var, qualifier) => {
                    ret = ret
                        .into_par_iter()
                        .map(|b| {
                            let e = b
                                .get_ev_index(from_ev_var)
                                .ok_or_else(|| format!("Could not get {ob_var}"))?;
                            let obj_types = self
                                .new_object_vars
                                .get(ob_var)
                                .ok_or_else(|| format!("Could not get {ob_var}"))?;
                            let re = Ok(obj_types
                                .iter()
                                .map(|ot| {
                                    ocel.get_e2o_of_type(e, ot)
                                        .filter(|(q, _o)| {
                                            qualifier.as_ref().is_none_or(|qual| qual == *q)
                                        })
                                        .map(|(_q, o)| o)
                                })
                                .kmerge()
                                .dedup()
                                .filter_map(|o| {
                                    check_next_filters(
                                        b.clone().expand_with_ob(*ob_var, *o),
                                        step_index,
                                        steps,
                                        ocel,
                                    )
                                })
                                .collect_vec());
                            re
                        })
                        .take_any(MAX_NUM_BINDINGS + 1)
                        .collect::<Result<Vec<_>, String>>()?
                        .into_iter()
                        .flatten()
                        .collect();
                }
                BindingStep::BindObFromOb(ob_var_name, from_ob_var_name, qualifier, reversed) => {
                    ret = ret
                        .into_par_iter()
                        .map(|b| {
                            let ob_index = b
                                .get_ob_index(from_ob_var_name)
                                .ok_or_else(|| format!("Could not get {from_ob_var_name}"))?;
                            let obj_types = self
                                .new_object_vars
                                .get(ob_var_name)
                                .ok_or_else(|| format!("Could not get {ob_var_name}"))?;
                            let o2os: Box<dyn Iterator<Item = &ObjectIndex>> = if *reversed {
                                Box::new(
                                    ocel.get_o2o_rev(ob_index)
                                        .filter(|(q, to_obj_index)| {
                                            let to_ob_type = ocel.get_ob_type_of(*to_obj_index);
                                            obj_types.contains(to_ob_type)
                                                && qualifier.as_ref().is_none_or(|qual| q == qual)
                                        })
                                        .map(|(_q, o)| o),
                                )
                            } else {
                                Box::new(
                                    obj_types
                                        .iter()
                                        .map(|ot| {
                                            ocel.get_o2o_of_type(ob_index, ot)
                                                .filter(|(q, _to_obj_index)| {
                                                    qualifier.as_ref().is_none_or(|qual| q == qual)
                                                })
                                                .map(|(_q, o)| o)
                                        })
                                        .kmerge()
                                        .dedup(),
                                )
                            };
                            let vec = o2os
                                .filter_map(|to_ob_index| {
                                    check_next_filters(
                                        b.clone().expand_with_ob(*ob_var_name, *to_ob_index),
                                        step_index,
                                        steps,
                                        ocel,
                                    )
                                })
                                .collect_vec();

                            Ok(vec)
                        })
                        .take_any(MAX_NUM_BINDINGS + 1)
                        .collect::<Result<Vec<_>, String>>()?
                        .into_iter()
                        .flatten()
                        .collect();
                }
                BindingStep::BindEvFromOb(ev_var_name, from_ob_var_name, qualifier) => {
                    ret = ret
                        .into_par_iter()
                        .map(|b| {
                            let ob_index = b
                                .get_ob_index(from_ob_var_name)
                                .ok_or_else(|| format!("Could not get {from_ob_var_name}"))?;
                            let ev_types = self
                                .new_event_vars
                                .get(ev_var_name)
                                .ok_or_else(|| format!("Could not get {ev_var_name}"))?;
                            let e2o_rev = ocel
                                .get_e2o_rev(ob_index)
                                .filter(|(_q, ev)| ev_types.contains(ocel.get_ev_type_of(*ev)));
                            let vec = e2o_rev
                                .into_iter()
                                .filter_map(|(q, to_ev_index)| {
                                    if qualifier.as_ref().is_none_or(move |qual| qual == q) {
                                        check_next_filters(
                                            b.clone().expand_with_ev(*ev_var_name, *to_ev_index),
                                            step_index,
                                            steps,
                                            ocel,
                                        )
                                    } else {
                                        None
                                    }
                                })
                                .collect_vec();
                            Ok(vec)
                        })
                        .take_any(MAX_NUM_BINDINGS + 1)
                        .collect::<Result<Vec<_>, String>>()?
                        .into_iter()
                        .flatten()
                        .collect();
                }
                BindingStep::Filter(f) => {
                    ret = ret
                        .into_par_iter()
                        .map(|b| f.check_binding(&b, ocel).map(|ok| (b, ok)))
                        .collect::<Result<Vec<_>, _>>()?
                        .into_iter()
                        .filter_map(|(b, ok)| if ok { Some(b) } else { None })
                        .collect()
                }
            }
            if ret.len() > MAX_NUM_BINDINGS {
                bindings_skipped = true;
                // Remove extra element (was just used to test if there are more)
                ret.pop();
            }
        }

        Ok((ret, bindings_skipped))
    }
}
