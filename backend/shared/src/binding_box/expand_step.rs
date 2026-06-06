use std::sync::atomic::{AtomicUsize, Ordering};

use itertools::Itertools;
use process_mining::core::event_data::object_centric::linked_ocel::{
    slim_linked_ocel::ObjectIndex,
    LinkedOCELAccess, SlimLinkedOCEL,
};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use super::structs::{Binding, BindingBox, BindingStep};
const MAX_NUM_BINDINGS: usize = 10_000_000;

#[inline]
fn passes_next_filters(
    b: &Binding,
    last_considered_index: usize,
    steps: &[BindingStep],
    ocel: &SlimLinkedOCEL,
) -> bool {
    for step in steps.iter().skip(last_considered_index + 1) {
        if let BindingStep::Filter(f) = step {
            match f.check_binding(b, ocel) {
                Ok(true) => continue,
                _ => return false,
            }
        } else {
            break;
        }
    }
    true
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
        mut parent_binding: Binding,
        ocel: &SlimLinkedOCEL,
        steps: &[BindingStep],
    ) -> Result<(Vec<Binding>, bool), String> {
        self.expand_with_steps_in_place(&mut parent_binding, ocel, steps)
    }

    pub(crate) fn expand_with_steps_in_place(
        &self,
        parent_binding: &mut Binding,
        ocel: &SlimLinkedOCEL,
        steps: &[BindingStep],
    ) -> Result<(Vec<Binding>, bool), String> {
        if steps.is_empty() {
            return Ok((vec![parent_binding.clone()], false));
        }

        let mut bootstrap = Vec::new();
        let bootstrap_counter = AtomicUsize::new(0);
        self.apply_step_recursive(
            parent_binding,
            &mut bootstrap,
            &bootstrap_counter,
            ocel,
            &steps[0..1],
            0,
        )?;

        if steps.len() == 1 {
            let bindings_skipped = bootstrap_counter.load(Ordering::Relaxed) > MAX_NUM_BINDINGS;
            if bootstrap.len() > MAX_NUM_BINDINGS {
                bootstrap.truncate(MAX_NUM_BINDINGS);
            }
            return Ok((bootstrap, bindings_skipped));
        }

        let pipeline_counter = AtomicUsize::new(0);
        let mut final_results: Vec<Binding> = bootstrap
            .into_par_iter()
            .try_fold(
                Vec::new,
                |mut local_out, mut b| -> Result<Vec<Binding>, String> {
                    self.apply_step_recursive(
                        &mut b,
                        &mut local_out,
                        &pipeline_counter,
                        ocel,
                        steps,
                        1,
                    )?;
                    Ok(local_out)
                },
            )
            .try_reduce(Vec::new, |mut a, b| {
                a.extend(b);
                Ok(a)
            })?;

        let bindings_skipped = pipeline_counter.load(Ordering::Relaxed) > MAX_NUM_BINDINGS;
        if final_results.len() > MAX_NUM_BINDINGS {
            final_results.truncate(MAX_NUM_BINDINGS);
        }
        Ok((final_results, bindings_skipped))
    }

    pub(crate) fn count_with_steps_in_place(
        &self,
        parent_binding: &mut Binding,
        ocel: &SlimLinkedOCEL,
        steps: &[BindingStep],
        limit: usize,
    ) -> Result<(usize, bool), String> {
        if limit == 0 {
            return Ok((0, false));
        }

        let counter = AtomicUsize::new(0);
        let max_bindings = limit.min(MAX_NUM_BINDINGS);
        let mut emit = |_b: &Binding| Ok(());
        self.apply_step_recursive_emit(
            parent_binding,
            &counter,
            ocel,
            steps,
            0,
            max_bindings,
            &mut emit,
        )?;
        let count = counter.load(Ordering::Relaxed).min(max_bindings);
        Ok((count, limit > MAX_NUM_BINDINGS && count >= MAX_NUM_BINDINGS))
    }

    fn apply_step_recursive(
        &self,
        b: &mut Binding,
        out: &mut Vec<Binding>,
        counter: &AtomicUsize,
        ocel: &SlimLinkedOCEL,
        steps: &[BindingStep],
        idx: usize,
    ) -> Result<(), String> {
        let mut emit = |b: &Binding| {
            out.push(b.clone());
            Ok(())
        };
        self.apply_step_recursive_emit(b, counter, ocel, steps, idx, MAX_NUM_BINDINGS, &mut emit)
    }

    fn apply_step_recursive_emit<F>(
        &self,
        b: &mut Binding,
        counter: &AtomicUsize,
        ocel: &SlimLinkedOCEL,
        steps: &[BindingStep],
        idx: usize,
        max_bindings: usize,
        emit: &mut F,
    ) -> Result<(), String>
    where
        F: FnMut(&Binding) -> Result<(), String>,
    {
        if counter.load(Ordering::Relaxed) >= max_bindings {
            return Ok(());
        }
        if idx >= steps.len() {
            let prev = counter.fetch_add(1, Ordering::Relaxed);
            if prev < max_bindings {
                emit(b)?;
            }
            return Ok(());
        }
        let step = &steps[idx];
        match step {
            BindingStep::BindEv(ev_var, time_constr) => {
                let ev_types = self
                    .new_event_vars
                    .get(ev_var)
                    .ok_or_else(|| format!("Could not get {ev_var}"))?;
                for e_index in ev_types
                    .iter()
                    .flat_map(|ev_type| ocel.get_evs_of_type(ev_type))
                {
                    let time_ok = time_constr.is_none()
                        || time_constr.as_ref().unwrap().iter().all(
                            |(ref_ev_var_name, (min_sec, max_sec))| {
                                let ref_ev = b.get_ev_index(ref_ev_var_name);
                                if let Some(ref_ev) = ref_ev {
                                    let ref_ev_time = ocel.get_ev_time(ref_ev);
                                    let e_time = ocel.get_ev_time(e_index);
                                    let duration_diff =
                                        (*e_time - ref_ev_time).num_milliseconds() as f64 / 1000.0;
                                    !min_sec.is_some_and(|m| duration_diff < m)
                                        && !max_sec.is_some_and(|m| duration_diff > m)
                                } else {
                                    true
                                }
                            },
                        );
                    if !time_ok {
                        continue;
                    }
                    let ins = b.extend_with_ev_in_place(*ev_var, *e_index);
                    if passes_next_filters(b, idx, steps, ocel) {
                        self.apply_step_recursive_emit(
                            b,
                            counter,
                            ocel,
                            steps,
                            idx + 1,
                            max_bindings,
                            emit,
                        )?;
                    }
                    b.revert_ev(ins, *ev_var);
                    if counter.load(Ordering::Relaxed) >= max_bindings {
                        return Ok(());
                    }
                }
            }
            BindingStep::BindOb(ob_var) => {
                let ob_types = self
                    .new_object_vars
                    .get(ob_var)
                    .ok_or_else(|| format!("Could not get {ob_var}"))?;
                for o_index in ob_types
                    .iter()
                    .flat_map(|ob_type| ocel.get_obs_of_type(ob_type))
                {
                    let ins = b.extend_with_ob_in_place(*ob_var, *o_index);
                    if passes_next_filters(b, idx, steps, ocel) {
                        self.apply_step_recursive_emit(
                            b,
                            counter,
                            ocel,
                            steps,
                            idx + 1,
                            max_bindings,
                            emit,
                        )?;
                    }
                    b.revert_ob(ins, *ob_var);
                    if counter.load(Ordering::Relaxed) >= max_bindings {
                        return Ok(());
                    }
                }
            }
            BindingStep::BindObFromEv(ob_var, from_ev_var, qualifier) => {
                let e = *b
                    .get_ev_index(from_ev_var)
                    .ok_or_else(|| format!("Could not get {ob_var}"))?;
                let obj_types = self
                    .new_object_vars
                    .get(ob_var)
                    .ok_or_else(|| format!("Could not get {ob_var}"))?;
                for o in obj_types
                    .iter()
                    .map(|ot| {
                        ocel.get_e2o_of_type(e, ot)
                            .filter(|(q, _o)| qualifier.as_ref().is_none_or(|qual| qual == *q))
                            .map(|(_q, o)| o)
                    })
                    .kmerge()
                    .dedup()
                {
                    let ins = b.extend_with_ob_in_place(*ob_var, *o);
                    if passes_next_filters(b, idx, steps, ocel) {
                        self.apply_step_recursive_emit(
                            b,
                            counter,
                            ocel,
                            steps,
                            idx + 1,
                            max_bindings,
                            emit,
                        )?;
                    }
                    b.revert_ob(ins, *ob_var);
                    if counter.load(Ordering::Relaxed) >= max_bindings {
                        return Ok(());
                    }
                }
            }
            BindingStep::BindObFromOb(ob_var_name, from_ob_var_name, qualifier, reversed) => {
                let ob_index = *b
                    .get_ob_index(from_ob_var_name)
                    .ok_or_else(|| format!("Could not get {from_ob_var_name}"))?;
                let obj_types = self
                    .new_object_vars
                    .get(ob_var_name)
                    .ok_or_else(|| format!("Could not get {ob_var_name}"))?;
                let o2os: Box<dyn Iterator<Item = &ObjectIndex>> = if *reversed {
                    Box::new(
                        obj_types
                            .iter()
                            .flat_map(|ot| ob_index.get_o2o_rev_obs_of_obtype(ocel, ot, qualifier.as_deref())),
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
                for to_ob_index in o2os {
                    let ins = b.extend_with_ob_in_place(*ob_var_name, *to_ob_index);
                    if passes_next_filters(b, idx, steps, ocel) {
                        self.apply_step_recursive_emit(
                            b,
                            counter,
                            ocel,
                            steps,
                            idx + 1,
                            max_bindings,
                            emit,
                        )?;
                    }
                    b.revert_ob(ins, *ob_var_name);
                    if counter.load(Ordering::Relaxed) >= max_bindings {
                        return Ok(());
                    }
                }
            }
            BindingStep::BindEvFromOb(ev_var_name, from_ob_var_name, qualifier) => {
                let ob_index = *b
                    .get_ob_index(from_ob_var_name)
                    .ok_or_else(|| format!("Could not get {from_ob_var_name}"))?;
                let ev_types = self
                    .new_event_vars
                    .get(ev_var_name)
                    .ok_or_else(|| format!("Could not get {ev_var_name}"))?;
                for to_ev_index in ev_types
                    .iter()
                    .flat_map(|ev_type| ob_index.get_e2o_rev_evs_of_evtype(ocel, ev_type, qualifier.as_deref()))
                {
                    let ins = b.extend_with_ev_in_place(*ev_var_name, *to_ev_index);
                    if passes_next_filters(b, idx, steps, ocel) {
                        self.apply_step_recursive_emit(
                            b,
                            counter,
                            ocel,
                            steps,
                            idx + 1,
                            max_bindings,
                            emit,
                        )?;
                    }
                    b.revert_ev(ins, *ev_var_name);
                    if counter.load(Ordering::Relaxed) >= max_bindings {
                        return Ok(());
                    }
                }
            }
            BindingStep::Filter(f) => {
                if f.check_binding(b, ocel)? {
                    self.apply_step_recursive_emit(
                        b,
                        counter,
                        ocel,
                        steps,
                        idx + 1,
                        max_bindings,
                        emit,
                    )?;
                }
            }
        }
        Ok(())
    }
}
