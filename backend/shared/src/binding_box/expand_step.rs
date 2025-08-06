use process_mining::ocel::linked_ocel::{IndexLinkedOCEL, LinkedOCELAccess};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use super::structs::{Binding, BindingBox, BindingStep};
const MAX_NUM_BINDINGS: usize = 2_000_000;
/// This can slightly reduce memory usage by filtering out unfitting bindings before collecting into a vec
/// However, the filters may be checked multiple times
#[inline(always)]
fn check_next_filters(
    b: Binding,
    next_step: usize,
    steps: &[BindingStep],
    ocel: &IndexLinkedOCEL,
) -> Option<Binding> {
    for step in steps.iter().skip(next_step) {
        if let BindingStep::Filter(f) = &step {
            if f.check_binding(&b, ocel) {
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
    pub fn expand_empty(&self, ocel: &IndexLinkedOCEL) -> (Vec<Binding>, bool) {
        self.expand(Binding::default(), ocel)
    }

    pub fn expand_with_steps_empty(
        &self,
        ocel: &IndexLinkedOCEL,
        steps: &[BindingStep],
    ) -> (Vec<Binding>, bool) {
        self.expand_with_steps(Binding::default(), ocel, steps)
    }

    pub fn expand(&self, parent_binding: Binding, ocel: &IndexLinkedOCEL) -> (Vec<Binding>, bool) {
        let order = BindingStep::get_binding_order(self, Some(&parent_binding), Some(ocel));
        self.expand_with_steps(parent_binding, ocel, &order)
    }

    pub fn expand_with_steps(
        &self,
        parent_binding: Binding,
        ocel: &IndexLinkedOCEL,
        steps: &[BindingStep],
    ) -> (Vec<Binding>, bool) {
        let mut ret = vec![parent_binding];
        let mut bindings_skipped = false;
        // let mut sizes_per_step: Vec<usize> = Vec::with_capacity(steps.len());
        for step_index in 0..steps.len() {
            let step = &steps[step_index];
            match &step {
                BindingStep::BindEv(ev_var, time_constr) => {
                    let ev_types = self.new_event_vars.get(ev_var).unwrap();
                    ret = ret
                        .into_par_iter()
                        .flat_map_iter(|b| {
                            ev_types
                                .iter()
                                .flat_map(|ev_type| ocel.get_evs_of_type(ev_type))
                                .filter_map(move |e_index| {
                                    let e = ocel.get_ev(e_index);
                                    if time_constr.is_none()
                                        || time_constr.as_ref().unwrap().iter().all(
                                            |(ref_ev_var_name, (min_sec, max_sec))| {
                                                let ref_ev =
                                                    b.get_ev(ref_ev_var_name, ocel).unwrap();
                                                let duration_diff = (e.time - ref_ev.time)
                                                    .num_milliseconds()
                                                    as f64
                                                    / 1000.0;
                                                !min_sec
                                                    .is_some_and(|min_sec| duration_diff < min_sec)
                                                    && !max_sec.is_some_and(|max_sec| {
                                                        duration_diff > max_sec
                                                    })
                                            },
                                        )
                                    {
                                        check_next_filters(
                                            b.clone().expand_with_ev(*ev_var, *e_index),
                                            step_index + 1,
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
                    let ob_types = self.new_object_vars.get(ob_var).unwrap();
                    ret = ret
                        .into_par_iter()
                        .flat_map_iter(|b| {
                            ob_types
                                .iter()
                                .flat_map(|ob_type| ocel.get_obs_of_type(ob_type))
                                .filter_map(move |o_index| {
                                    check_next_filters(
                                        b.clone().expand_with_ob(*ob_var, *o_index),
                                        step_index + 1,
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
                        .flat_map_iter(|b| {
                            let e = b.get_ev_index(from_ev_var).unwrap();
                            let obs: Vec<_> = ocel.get_e2o(e).collect();
                            let obj_types = self.new_object_vars.get(ob_var).unwrap();
                            obs.into_iter()
                                .filter(|(q, o)| {
                                    obj_types.contains(&ocel.get_ob(o).object_type)
                                        && qualifier.as_ref().is_none_or(|qual| qual == *q)
                                })
                                .filter_map(move |(_q, o)| {
                                    check_next_filters(
                                        b.clone().expand_with_ob(*ob_var, *o),
                                        step_index + 1,
                                        steps,
                                        ocel,
                                    )
                                })
                        })
                        .take_any(MAX_NUM_BINDINGS + 1)
                        .collect();
                }
                BindingStep::BindObFromOb(ob_var_name, from_ob_var_name, qualifier, reversed) => {
                    ret = ret
                        .into_par_iter()
                        .flat_map_iter(|b| {
                            let ob_index = b.get_ob_index(from_ob_var_name).unwrap();
                            let o2os: Vec<_> = if *reversed {
                                ocel.get_o2o_rev(ob_index).collect()
                            } else {
                                ocel.get_o2o(ob_index).collect()
                            };
                            o2os.into_iter().filter_map(move |(qual, to_ob_index)| {
                                if qualifier.as_ref().is_none_or(|q| q == qual) {
                                    let allowed_types = self.new_object_vars.get(ob_var_name)?;
                                    let o = ocel.get_ob(to_ob_index);
                                    if allowed_types.contains(&o.object_type) {
                                        check_next_filters(
                                            b.clone().expand_with_ob(*ob_var_name, *to_ob_index),
                                            step_index + 1,
                                            steps,
                                            ocel,
                                        )
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                }
                            })
                        })
                        .take_any(MAX_NUM_BINDINGS + 1)
                        .collect()
                }
                BindingStep::BindEvFromOb(ev_var_name, from_ob_var_name, qualifier) => {
                    ret = ret
                        .into_par_iter()
                        .flat_map_iter(|b| {
                            let ob_index = b.get_ob_index(from_ob_var_name).unwrap();
                            // let ob = ocel.ob_by_index(ob_index).unwrap();
                            let ev_types = self.new_event_vars.get(ev_var_name).unwrap();
                            let e2o_rev: Vec<_> = ocel.get_e2o_rev(ob_index).collect();
                            e2o_rev.into_iter().filter_map(move |(q, to_ev_index)| {
                                if qualifier.as_ref().is_none_or(move |qual| qual == q) {
                                    let to_ev = ocel.get_ev(to_ev_index);
                                    if ev_types.contains(&to_ev.event_type) {
                                        check_next_filters(
                                            b.clone().expand_with_ev(*ev_var_name, *to_ev_index),
                                            step_index + 1,
                                            steps,
                                            ocel,
                                        )
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                }
                            })
                        })
                        .take_any(MAX_NUM_BINDINGS + 1)
                        .collect();
                }
                // _ => {}
                BindingStep::Filter(f) => {
                    ret = ret
                        .into_par_iter()
                        .filter(|b| f.check_binding(b, ocel))
                        .collect()
                }
            }
            if ret.len() > MAX_NUM_BINDINGS {
                bindings_skipped = true;
                // Remove extra element (was just used to test if there are more)
                ret.pop();
            }
            // sizes_per_step.push(ret.len());
            // 16_937_065
            // let ret_size = ret.len() * ret.first().map(|b| b.event_map.len() + b.object_map.len() + 10 * b.label_map.len()).unwrap_or(1);
            // println!("ret_size: {}",ret_size);
            // if ret_size > 10_00_000 {
            //     println!("Too large bindings! {} with {}",ret.len(),ret_size);
            //     ret = ret.into_iter().take(100_000).collect();
            // }
        }

        // if bindings_skipped {
        //     println!("Skipped some elements!");
        // }

        // if !steps.is_empty() {
        //     println!("Steps: {:?}", steps);
        // println!("Set sizes: {:?}", sizes_per_step);
        // }
        (ret, bindings_skipped)
    }
}
