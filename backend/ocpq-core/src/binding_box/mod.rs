pub mod structs;

pub mod step_order;

pub mod expand_step;

use std::collections::{HashMap, HashSet};

// Only the benchmark path writes timings to a file, and that path does not exist on wasm.
#[cfg(not(target_arch = "wasm32"))]
use std::{fs::File, io::BufWriter};

#[cfg(not(target_arch = "wasm32"))]
use chrono::DateTime;

use crate::timing::Timer;
use itertools::Itertools;

use process_mining::{
    core::event_data::object_centric::{
        linked_ocel::{
            slim_linked_ocel::{EventIndex, ObjectIndex},
            LinkedOCELAccess, SlimLinkedOCEL,
        },
        OCELRelationship,
    },
    OCEL,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
pub use structs::{
    Binding, BindingBox, BindingBoxTree, BindingStep, EventVariable, LabelValue, ObjectVariable,
    ViolationReason,
};
use ts_rs::TS;

#[derive(Debug, Default, Clone, Serialize, Deserialize, process_mining::bindings::CustomRegistryEntity)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateBoxTreeResult {
    pub evaluation_results: Vec<EvaluationResultWithCount>,
    pub object_ids: Vec<String>,
    pub event_ids: Vec<String>,
    pub bindings_skipped: bool,
    pub eval_version: u64,
}
#[derive(TS)]
#[ts(export)]
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluationResultWithCount {
    pub situations: Vec<(Binding, Option<ViolationReason>)>,
    pub situation_count: usize,
    pub situation_violated_count: usize,
}

pub fn evaluate_box_tree(
    tree: BindingBoxTree,
    ocel: &SlimLinkedOCEL,
    measure_performance: bool,
) -> Result<EvaluateBoxTreeResult, String> {
    // The benchmark path writes its timings next to the user's downloads; there is no such place
    // on wasm, so there `measure_performance` falls through to a single ordinary evaluation.
    #[cfg(target_arch = "wasm32")]
    let _ = measure_performance;
    #[cfg(not(target_arch = "wasm32"))]
    if measure_performance {
        let n = 10;
        let mut eval_times = Vec::new();
        let st = std::time::SystemTime::now();
        let dt: DateTime<chrono::Utc> = st.into();
        // Replace colons as some operating system (e.g., Windows) have issues with colons in filenames (depending on partition formatting etc.)
        let dt_iso = dt.to_rfc3339().replace(":", "-");
        let mut tree_path = dirs_next::download_dir().unwrap_or_default();
        tree_path.push(format!("{dt_iso}-tree.json"));
        let tree_json_file = File::create(tree_path).unwrap();
        serde_json::to_writer_pretty(BufWriter::new(tree_json_file), &tree).unwrap();
        for _ in 0..n {
            let start = std::time::Instant::now();
            let (evaluation_results_flat, bindings_skipped) = tree.evaluate(ocel)?;
            if bindings_skipped {
                eprintln!("Evaluation skipped bindings! Reported times are inaccurate!");
            }
            // Also gather results in evaluation mode
            // if this should be included in the reported evaluation measurements of course depends...
            let mut evaluation_results = tree
                .nodes
                .iter()
                .map(|_| EvaluationResultWithCount {
                    situations: Vec::new(),
                    situation_count: 0,
                    situation_violated_count: 0,
                })
                .collect_vec();

            for (index, binding, viol) in evaluation_results_flat {
                let r = &mut evaluation_results[index];
                r.situations
                    .push((std::sync::Arc::unwrap_or_clone(binding), viol));
                r.situation_count += 1;
                if viol.is_some() {
                    r.situation_violated_count += 1;
                }
            }

            eval_times.push(start.elapsed().as_secs_f64());
        }
        let mut durations_path = dirs_next::download_dir().unwrap_or_default();
        durations_path.push(format!("{dt_iso}-durations.json"));
        let seconds_json_file = File::create(durations_path).unwrap();
        serde_json::to_writer_pretty(BufWriter::new(seconds_json_file), &eval_times).unwrap();
        println!("Evaluation times: {eval_times:?}");
        println!(
            "Mean: {:.2}ms",
            1000.0 * eval_times.iter().sum::<f64>() / eval_times.len() as f64
        );
    }
    let now = Timer::start();
    let (evaluation_results_flat, bindings_skipped) = tree.evaluate(ocel)?;
    // println!("Tree Evaluated in {:?}", now.elapsed());
    if bindings_skipped {
        println!("[!!!] Query yielded too many results. Some bindings were skipped. Reported counts are inaccurate!");
    }
    let mut evaluation_results = tree
        .nodes
        .iter()
        .map(|_| EvaluationResultWithCount {
            situations: Vec::new(),
            situation_count: 0,
            situation_violated_count: 0,
        })
        .collect_vec();

    for (index, binding, viol) in evaluation_results_flat {
        let r = &mut evaluation_results[index];
        // if r.situations.len() < 1000 {
        r.situations
            .push((std::sync::Arc::unwrap_or_clone(binding), viol));
        // }
        r.situation_count += 1;
        if viol.is_some() {
            r.situation_violated_count += 1;
        }
    }
    if !measure_performance {
        println!(
            "Evaluated in {:?} (Size: {})",
            now.elapsed(),
            evaluation_results.len()
        );
    }
    Ok(EvaluateBoxTreeResult {
        evaluation_results,
        object_ids: ocel
            .get_all_obs()
            .map(|o| ocel.get_ob_id(&o).to_string())
            .collect(),
        event_ids: ocel
            .get_all_evs()
            .map(|e| ocel.get_ev_id(&e).to_string())
            .collect(),
        bindings_skipped,
        eval_version: 0,
    })
}

pub fn filter_ocel_box_tree(tree: BindingBoxTree, ocel: &SlimLinkedOCEL) -> Result<OCEL, String> {
    let now = Timer::start();
    let (evaluation_results_flat, skipped_bindings) = tree.evaluate(ocel)?;
    println!("Tree Evaluated in {:?}", now.elapsed());
    if skipped_bindings {
        println!("Bindings were skipped!");
    }
    let assume_all_included = !tree.nodes.iter().any(|node| {
        let node_as_box = node.as_box().unwrap();
        node_as_box
            .ob_var_labels
            .iter()
            .any(|(_, l)| matches!(l, structs::FilterLabel::INCLUDED))
            || node_as_box
                .ev_var_labels
                .iter()
                .any(|(_, l)| matches!(l, structs::FilterLabel::INCLUDED))
    });
    // Filter/Export
    let filter_now = Timer::start();
    let mut ob_included_indices: HashSet<ObjectIndex> = if assume_all_included {
        ocel.get_all_obs().collect()
    } else {
        HashSet::new()
    };
    let mut ev_included_indices: HashSet<EventIndex> = if assume_all_included {
        ocel.get_all_evs().collect()
    } else {
        HashSet::new()
    };

    let mut ob_excluded_indices: HashSet<ObjectIndex> = HashSet::new();
    let mut ev_excluded_indices: HashSet<EventIndex> = HashSet::new();

    let mut e2o_rels_included: HashSet<(EventIndex, ObjectIndex, Option<String>)> =
        if assume_all_included {
            ocel.get_all_evs()
                .flat_map(move |e| {
                    ocel.get_e2o(e)
                        .map(move |r| (e, *r.1, Some(r.0.to_string())))
                })
                .collect()
        } else {
            HashSet::new()
        };
    let mut e2o_rels_excluded: HashSet<(EventIndex, ObjectIndex, Option<String>)> = HashSet::new();

    let mut o2o_rels_included: HashSet<(ObjectIndex, ObjectIndex, Option<String>)> =
        if assume_all_included {
            ocel.get_all_obs()
                .flat_map(|o| {
                    ocel.get_o2o(o)
                        .map(move |r| (o, *r.1, Some(r.0.to_string())))
                })
                .collect()
        } else {
            HashSet::new()
        };

    let mut o2o_rels_excluded: HashSet<(ObjectIndex, ObjectIndex, Option<String>)> = HashSet::new();

    for (index, binding, _viol) in evaluation_results_flat {
        for (var, label) in tree.nodes[index]
            .as_box()
            .iter()
            .flat_map(|b| &b.ob_var_labels)
        {
            if let Some(ob_index) = binding.get_ob_index(var) {
                match label {
                    structs::FilterLabel::IGNORED => {}
                    structs::FilterLabel::INCLUDED => {
                        ob_included_indices.insert(*ob_index);
                    }
                    structs::FilterLabel::EXCLUDED => {
                        ob_excluded_indices.insert(*ob_index);
                    }
                }
            }
        }
        for (var, label) in tree.nodes[index]
            .as_box()
            .iter()
            .flat_map(|b| &b.ev_var_labels)
        {
            if let Some(ev_index) = binding.get_ev_index(var) {
                match label {
                    structs::FilterLabel::IGNORED => {}
                    structs::FilterLabel::INCLUDED => {
                        ev_included_indices.insert(*ev_index);
                    }
                    structs::FilterLabel::EXCLUDED => {
                        ev_excluded_indices.insert(*ev_index);
                    }
                }
            }
        }

        for f in tree.nodes[index].as_box().iter().flat_map(|b| &b.filters) {
            match f {
                structs::Filter::O2E {
                    object,
                    event,
                    qualifier,
                    filter_label,
                } => match filter_label.unwrap_or_default() {
                    structs::FilterLabel::IGNORED => {}
                    structs::FilterLabel::INCLUDED => {
                        if let Some(ev) = binding.get_ev_index(event) {
                            if let Some(ob) = binding.get_ob_index(object) {
                                e2o_rels_included.insert((*ev, *ob, qualifier.clone()));
                            }
                        }
                    }
                    structs::FilterLabel::EXCLUDED => {
                        if let Some(ev) = binding.get_ev_index(event) {
                            if let Some(ob) = binding.get_ob_index(object) {
                                e2o_rels_excluded.insert((*ev, *ob, qualifier.clone()));
                            }
                        }
                    }
                },
                structs::Filter::O2O {
                    object,
                    other_object,
                    qualifier,
                    filter_label,
                } => match filter_label.unwrap_or_default() {
                    structs::FilterLabel::IGNORED => {}
                    structs::FilterLabel::INCLUDED => {
                        if let Some(ob1) = binding.get_ob_index(object) {
                            if let Some(ob2) = binding.get_ob_index(other_object) {
                                o2o_rels_included.insert((*ob1, *ob2, qualifier.clone()));
                            }
                        }
                    }
                    structs::FilterLabel::EXCLUDED => {
                        if let Some(ob1) = binding.get_ob_index(object) {
                            if let Some(ob2) = binding.get_ob_index(other_object) {
                                o2o_rels_excluded.insert((*ob1, *ob2, qualifier.clone()));
                            }
                        }
                    }
                },
                _ => {
                    // Ignore
                }
            }
        }
    }

    let mut filtered_ocel = OCEL {
        event_types: vec![],
        object_types: vec![],
        events: vec![],
        objects: vec![],
    };
    let final_included_obs: HashSet<&ObjectIndex> = ob_included_indices
        .difference(&ob_excluded_indices)
        .collect();
    let final_included_evs: HashSet<&EventIndex> = ev_included_indices
        .difference(&ev_excluded_indices)
        .collect();
    let check_o2o_inclusion = |o1_index: ObjectIndex, o2_index: ObjectIndex, qualifier: &String| {
        if !final_included_obs.contains(&o1_index) || !final_included_obs.contains(&o2_index) {
            return false;
        }
        let included = o2o_rels_included.contains(&(o1_index, o2_index, None))
            || o2o_rels_included.contains(&(o1_index, o2_index, Some(qualifier.clone())));
        if !included {
            return false;
        }
        let excluded = o2o_rels_excluded.contains(&(o1_index, o2_index, None))
            || o2o_rels_excluded.contains(&(o1_index, o2_index, Some(qualifier.clone())));
        !excluded
    };
    let check_e2o_inclusion = |ev_index: EventIndex, ob_index: ObjectIndex, qualifier: &String| {
        if !final_included_evs.contains(&ev_index) || !final_included_obs.contains(&ob_index) {
            return false;
        }
        let included = e2o_rels_included.contains(&(ev_index, ob_index, None))
            || e2o_rels_included.contains(&(ev_index, ob_index, Some(qualifier.clone())));
        if !included {
            return false;
        }
        let excluded = e2o_rels_excluded.contains(&(ev_index, ob_index, None))
            || e2o_rels_excluded.contains(&(ev_index, ob_index, Some(qualifier.clone())));
        !excluded
    };
    let mut added_ob_types: HashSet<String> = HashSet::new();
    for ob_index in &final_included_obs {
        let ob = ocel.get_full_ob(*ob_index);
        if !added_ob_types.contains(&ob.object_type) {
            if let Some(ot) = ocel.get_ob_type(ob.object_type.clone()) {
                filtered_ocel.object_types.push(ot.clone());
            } else {
                eprintln!("Failed to find object type: {}", ob.object_type);
            }
            added_ob_types.insert(ob.object_type.clone());
        }
        let mut ob = ob.into_owned();
        let o2os = ocel.get_o2o(*ob_index);
        ob.relationships = o2os
            .into_iter()
            .filter(|(q, other_ob)| check_o2o_inclusion(**ob_index, **other_ob, &q.to_string()))
            .map(|(q, other_ob)| OCELRelationship {
                qualifier: q.to_string(),
                object_id: ocel.get_full_ob(other_ob).id.clone(),
            })
            .collect();
        filtered_ocel.objects.push(ob);
    }

    let mut added_ev_types: HashSet<String> = HashSet::new();
    for ev_index in &final_included_evs {
        let ev = ocel.get_full_ev(*ev_index);
        if !added_ev_types.contains(&ev.event_type) {
            if let Some(et) = ocel.get_ev_type(&ev.event_type) {
                filtered_ocel.event_types.push(et.clone());
            } else {
                eprintln!("Failed to find object type: {}", ev.event_type);
            }
            added_ev_types.insert(ev.event_type.clone());
        }
        let mut ev = ev.into_owned();
        let e2os = ocel.get_e2o(*ev_index);
        ev.relationships = e2os
            .into_iter()
            .filter(|(q, o_index)| check_e2o_inclusion(**ev_index, **o_index, &q.to_string()))
            .map(|(q, o_index)| OCELRelationship {
                object_id: ocel.get_full_ob(o_index).id.clone(),
                qualifier: q.to_string(),
            })
            .collect();
        filtered_ocel.events.push(ev);
    }
    println!("Filtering (excl. export) took {:?}", filter_now.elapsed());
    Ok(filtered_ocel)
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateBoxTreeSummary {
    /// One entry per evaluation node, index-aligned with `evaluation_results`.
    pub node_summaries: Vec<NodeSummary>,
    pub bindings_skipped: bool,
    /// Monotonic version counter. Every new evaluation bumps it; page requests
    /// must carry the version they think is current, or the server rejects.
    #[ts(type = "number")]
    pub eval_version: u64,
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NodeSummary {
    pub situation_count: usize,
    pub situation_violated_count: usize,
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvalPageRequest {
    #[ts(type = "number")]
    pub eval_version: u64,
    pub node_index: usize,
    pub offset: usize,
    pub limit: usize,
    /// None = both; Some(true) = only violated; Some(false) = only satisfied.
    pub violated: Option<bool>,
    /// Only the rows that extend this row of the parent box.
    #[serde(default)]
    #[ts(optional)]
    pub parent: Option<ParentRow>,
    /// For each returned row, count the rows of these child nodes that extend it into
    /// [`BindingRow::child_counts`].
    #[serde(default)]
    #[ts(optional)]
    pub child_nodes: Option<Vec<usize>>,
}

/// A row of a parent box, given by the id of the element bound to each variable. A row of a child
/// box extends it when it binds each of these variables to the same element.
#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ParentRow {
    pub objects: Vec<(ObjectVariable, String)>,
    pub events: Vec<(EventVariable, String)>,
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EvalPageResponse {
    pub rows: Vec<BindingRow>,
    /// Total rows after filtering (offset+limit applied AFTER).
    pub filtered_count: usize,
}

#[derive(TS)]
#[ts(export)]
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BindingRow {
    pub objects: Vec<(ObjectVariable, String)>,
    pub events: Vec<(EventVariable, String)>,
    pub labels: Vec<(String, LabelValue)>,
    pub violation: Option<ViolationReason>,
    /// For each node of [`EvalPageRequest::child_nodes`], the number of its rows that extend this
    /// row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub child_counts: Option<Vec<usize>>,
}

/// A registry handle, not a wire value: situations can run to millions of rows, so the frontend pages them instead.
impl process_mining::bindings::CustomRegistryValue for EvaluateBoxTreeResult {
    fn kind_name() -> &'static str {
        "EvaluateBoxTreeResult"
    }

    /// Only the summary. Serializing every situation is exactly what the handle exists to avoid.
    fn to_value(&self) -> Result<serde_json::Value, String> {
        serde_json::to_value(self.summary()).map_err(|e| e.to_string())
    }
}

process_mining::register_custom_registry_kind!(EvaluateBoxTreeResult);

impl EvaluateBoxTreeResult {
    pub fn summary(&self) -> EvaluateBoxTreeSummary {
        EvaluateBoxTreeSummary {
            node_summaries: self
                .evaluation_results
                .iter()
                .map(|r| NodeSummary {
                    situation_count: r.situation_count,
                    situation_violated_count: r.situation_violated_count,
                })
                .collect(),
            bindings_skipped: self.bindings_skipped,
            eval_version: self.eval_version,
        }
    }

    pub fn get_page(&self, req: &EvalPageRequest) -> Result<EvalPageResponse, String> {
        if req.eval_version != self.eval_version {
            return Err(format!(
                "stale eval_version: client has {}, server has {}",
                req.eval_version, self.eval_version
            ));
        }
        let node = self
            .evaluation_results
            .get(req.node_index)
            .ok_or_else(|| format!("node_index {} out of range", req.node_index))?;

        let wanted = |(b, v): &&(Binding, Option<ViolationReason>)| {
            req.violated.is_none_or(|want| v.is_some() == want)
                && req.parent.as_ref().is_none_or(|p| self.extends(b, p))
        };
        let filtered_count = match (&req.parent, req.violated) {
            (Some(_), _) => node.situations.iter().filter(wanted).count(),
            (None, None) => node.situation_count,
            (None, Some(true)) => node.situation_violated_count,
            (None, Some(false)) => node.situation_count - node.situation_violated_count,
        };

        let limit = req.limit.min(1000);
        let page: Vec<_> = node
            .situations
            .iter()
            .filter(wanted)
            .skip(req.offset)
            .take(limit)
            .collect();
        let counts = match &req.child_nodes {
            Some(children) => Some(self.child_counts(&page, children)?),
            None => None,
        };
        let rows = page
            .iter()
            .enumerate()
            .map(|(i, (b, v))| {
                let mut row = self.binding_to_row(b, v);
                row.child_counts = counts
                    .as_ref()
                    .map(|c| c.iter().map(|per_row| per_row[i]).collect());
                row
            })
            .collect();

        Ok(EvalPageResponse {
            rows,
            filtered_count,
        })
    }

    /// Whether `b` binds every variable of `parent` to the element with the same id.
    fn extends(&self, b: &Binding, parent: &ParentRow) -> bool {
        parent.objects.iter().all(|(var, id)| {
            b.get_ob_index(var)
                .is_some_and(|i| self.object_ids[i.into_inner() as usize] == *id)
        }) && parent.events.iter().all(|(var, id)| {
            b.get_ev_index(var)
                .is_some_and(|i| self.event_ids[i.into_inner() as usize] == *id)
        })
    }

    /// For each node in `children`, the number of its rows that extend each row of `page`. All rows
    /// of a node bind the same variables, so the variables of the first page row key every row.
    fn child_counts(
        &self,
        page: &[&(Binding, Option<ViolationReason>)],
        children: &[usize],
    ) -> Result<Vec<Vec<usize>>, String> {
        if let Some(c) = children
            .iter()
            .find(|&&c| c >= self.evaluation_results.len())
        {
            return Err(format!("child node_index {c} out of range"));
        }
        let Some((first, _)) = page.first() else {
            return Ok(children.iter().map(|_| Vec::new()).collect());
        };
        let ob_vars: Vec<_> = first.object_map.iter().map(|(v, _)| *v).collect();
        let ev_vars: Vec<_> = first.event_map.iter().map(|(v, _)| *v).collect();
        let key = |b: &Binding| -> Option<(Vec<u32>, Vec<u32>)> {
            Some((
                ob_vars
                    .iter()
                    .map(|v| b.get_ob_index(v).map(|i| i.into_inner()))
                    .collect::<Option<_>>()?,
                ev_vars
                    .iter()
                    .map(|v| b.get_ev_index(v).map(|i| i.into_inner()))
                    .collect::<Option<_>>()?,
            ))
        };
        let page_keys: Vec<_> = page.iter().map(|(b, _)| key(b)).collect();
        children
            .iter()
            .map(|&c| {
                let child = self
                    .evaluation_results
                    .get(c)
                    .ok_or_else(|| format!("child node_index {c} out of range"))?;
                let mut counts: HashMap<&(Vec<u32>, Vec<u32>), usize> =
                    page_keys.iter().flatten().map(|k| (k, 0)).collect();
                for (b, _) in &child.situations {
                    if let Some(n) = key(b).and_then(|k| counts.get_mut(&k)) {
                        *n += 1;
                    }
                }
                Ok(page_keys
                    .iter()
                    .map(|k| k.as_ref().and_then(|k| counts.get(k)).copied().unwrap_or(0))
                    .collect())
            })
            .collect()
    }

    fn binding_to_row(&self, b: &Binding, v: &Option<ViolationReason>) -> BindingRow {
        BindingRow {
            objects: b
                .object_map
                .iter()
                .map(|(var, idx)| (*var, self.object_ids[(*idx).into_inner() as usize].clone()))
                .collect(),
            events: b
                .event_map
                .iter()
                .map(|(var, idx)| (*var, self.event_ids[(*idx).into_inner() as usize].clone()))
                .collect(),
            labels: b.label_map.clone(),
            violation: *v,
            child_counts: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result_with(violated: usize, total: usize, version: u64) -> EvaluateBoxTreeResult {
        let situations = (0..total)
            .map(|i| {
                let v = (i < violated).then_some(ViolationReason::TooFewMatchingEvents(0));
                (Binding::default(), v)
            })
            .collect();
        EvaluateBoxTreeResult {
            evaluation_results: vec![EvaluationResultWithCount {
                situations,
                situation_count: total,
                situation_violated_count: violated,
            }],
            eval_version: version,
            ..Default::default()
        }
    }

    fn req(violated: Option<bool>, offset: usize, limit: usize) -> EvalPageRequest {
        EvalPageRequest {
            eval_version: 1,
            node_index: 0,
            offset,
            limit,
            violated,
            parent: None,
            child_nodes: None,
        }
    }

    #[test]
    fn stale_version_is_rejected() {
        let err = result_with(1, 3, 5)
            .get_page(&req(None, 0, 10))
            .unwrap_err();
        assert!(err.starts_with("stale eval_version"), "got: {err}");
    }

    #[test]
    fn node_index_out_of_range() {
        let res = result_with(0, 0, 1);
        let mut r = req(None, 0, 10);
        r.node_index = 99;
        assert!(res.get_page(&r).is_err());
    }

    #[test]
    fn pagination_and_filters() {
        // (violated, offset, limit, expected rows, expected filtered_count)
        let cases = [
            (None, 0, 10, 3, 3),
            (None, 1, 1, 1, 3),
            (Some(true), 0, 10, 1, 1),
            (Some(false), 0, 10, 2, 2),
            (None, 10, 10, 0, 3),
        ];
        let res = result_with(1, 3, 1);
        for (violated, offset, limit, rows, total) in cases {
            let p = res.get_page(&req(violated, offset, limit)).unwrap();
            let ctx = format!("{violated:?} offset={offset} limit={limit}");
            assert_eq!(p.rows.len(), rows, "{ctx}");
            assert_eq!(p.filtered_count, total, "{ctx}");
        }
    }
}

/// Evaluation of whole trees against a shared tiny fixture OCEL (see `OCEL_JSON` below).
#[cfg(test)]
mod evaluation_tests {
    use super::structs::{BindingBoxTreeNode, Constraint, Filter, SizeFilter, ValueFilter};
    use super::*;
    use std::collections::HashMap;

    const OCEL_JSON: &str = r#"{
        "objectTypes": [
            { "name": "order", "attributes": [] },
            { "name": "item", "attributes": [] }
        ],
        "eventTypes": [
            { "name": "place", "attributes": [{ "name": "amount", "type": "integer" }] },
            { "name": "pay", "attributes": [] },
            { "name": "ship", "attributes": [] },
            { "name": "cancel", "attributes": [] }
        ],
        "objects": [
            { "id": "o1", "type": "order", "attributes": [],
              "relationships": [{ "objectId": "i1", "qualifier": "contains" }] },
            { "id": "o2", "type": "order", "attributes": [], "relationships": [] },
            { "id": "i1", "type": "item", "attributes": [], "relationships": [] }
        ],
        "events": [
            { "id": "e1", "type": "place", "time": "2024-01-01T00:00:00Z",
              "attributes": [{ "name": "amount", "value": 100 }],
              "relationships": [{ "objectId": "o1", "qualifier": "order" }] },
            { "id": "e2", "type": "place", "time": "2024-01-02T00:00:00Z",
              "attributes": [{ "name": "amount", "value": 5 }],
              "relationships": [{ "objectId": "o2", "qualifier": "order" }] },
            { "id": "e3", "type": "pay", "time": "2024-01-03T00:00:00Z", "attributes": [],
              "relationships": [{ "objectId": "o1", "qualifier": "order" }] },
            { "id": "e4", "type": "ship", "time": "2024-01-04T00:00:00Z", "attributes": [],
              "relationships": [{ "objectId": "o1", "qualifier": "order" },
                                { "objectId": "i1", "qualifier": "item" }] },
            { "id": "e5", "type": "ship", "time": "2024-01-05T00:00:00Z", "attributes": [],
              "relationships": [{ "objectId": "o1", "qualifier": "order" }] },
            { "id": "e6", "type": "cancel", "time": "2024-01-06T00:00:00Z", "attributes": [],
              "relationships": [{ "objectId": "o2", "qualifier": "order" }] }
        ]
    }"#;

    fn ocel() -> SlimLinkedOCEL {
        let ocel: OCEL = serde_json::from_str(OCEL_JSON).expect("fixture OCEL parses");
        SlimLinkedOCEL::from_ocel(ocel)
    }

    fn ob_vars(vars: &[(usize, &str)]) -> structs::NewObjectVariables {
        vars.iter()
            .map(|(i, t)| (ObjectVariable(*i), [t.to_string()].into_iter().collect()))
            .collect()
    }

    fn ev_vars(vars: &[(usize, &str)]) -> structs::NewEventVariables {
        vars.iter()
            .map(|(i, t)| (EventVariable(*i), [t.to_string()].into_iter().collect()))
            .collect()
    }

    fn o2e(object: usize, event: usize, qualifier: Option<&str>) -> Filter {
        Filter::O2E {
            object: ObjectVariable(object),
            event: EventVariable(event),
            qualifier: qualifier.map(str::to_string),
            filter_label: None,
        }
    }

    /// `amount >= min` on event variable `event`.
    fn amount_at_least(event: usize, min: i64) -> Filter {
        Filter::EventAttributeValueFilter {
            event: EventVariable(event),
            attribute_name: "amount".to_string(),
            value_filter: ValueFilter::Integer {
                min: Some(min),
                max: None,
            },
        }
    }

    fn tree(nodes: Vec<BindingBoxTreeNode>, edges: &[((usize, usize), &str)]) -> BindingBoxTree {
        BindingBoxTree {
            nodes,
            edge_names: edges
                .iter()
                .map(|(k, v)| (*k, v.to_string()))
                .collect::<HashMap<_, _>>(),
        }
    }

    fn eval(tree: BindingBoxTree) -> EvaluateBoxTreeResult {
        evaluate_box_tree(tree, &ocel(), false).expect("evaluation succeeds")
    }

    /// The object ids bound to `var` by every situation of node `node_index`, in result order.
    fn bound_object_ids(res: &EvaluateBoxTreeResult, node_index: usize, var: usize) -> Vec<&str> {
        res.evaluation_results[node_index]
            .situations
            .iter()
            .map(|(b, _)| {
                let idx = b.get_ob_index(&ObjectVariable(var)).expect("var bound");
                res.object_ids[(*idx).into_inner() as usize].as_str()
            })
            .collect()
    }

    fn bound_event_ids(res: &EvaluateBoxTreeResult, node_index: usize, var: usize) -> Vec<&str> {
        res.evaluation_results[node_index]
            .situations
            .iter()
            .map(|(b, _)| {
                let idx = b.get_ev_index(&EventVariable(var)).expect("var bound");
                res.event_ids[(*idx).into_inner() as usize].as_str()
            })
            .collect()
    }

    #[test]
    fn one_object_variable_binds_every_object_of_that_type() {
        let res = eval(tree(
            vec![BindingBoxTreeNode::Box(
                BindingBox {
                    new_object_vars: ob_vars(&[(0, "order")]),
                    ..Default::default()
                },
                vec![],
            )],
            &[],
        ));
        let node = &res.evaluation_results[0];
        assert_eq!(node.situation_count, 2, "two objects of type order");
        assert_eq!(
            node.situation_violated_count, 0,
            "no constraints to violate"
        );
        let mut ids = bound_object_ids(&res, 0, 0);
        ids.sort_unstable();
        assert_eq!(ids, vec!["o1", "o2"]);
        // `object_ids` is the index -> id table `binding_to_row` looks bindings up in, so it must
        // cover the whole log and not just the bound objects.
        assert_eq!(res.object_ids.len(), 3);
        assert_eq!(res.event_ids.len(), 6);
    }

    #[test]
    fn event_variable_bound_through_e2o_yields_one_situation_per_relation() {
        // order x ship, joined by E2O: o1 ships twice (e4, e5), o2 never.
        let res = eval(tree(
            vec![BindingBoxTreeNode::Box(
                BindingBox {
                    new_object_vars: ob_vars(&[(0, "order")]),
                    new_event_vars: ev_vars(&[(0, "ship")]),
                    filters: vec![o2e(0, 0, None)],
                    ..Default::default()
                },
                vec![],
            )],
            &[],
        ));
        assert_eq!(res.evaluation_results[0].situation_count, 2);
        assert_eq!(bound_object_ids(&res, 0, 0), vec!["o1", "o1"]);
        let mut evs = bound_event_ids(&res, 0, 0);
        evs.sort();
        assert_eq!(evs, vec!["e4", "e5"]);
    }

    #[test]
    fn e2o_qualifier_restricts_the_binding() {
        // e4 relates to o1 as "order" and to i1 as "item"; asking for an item qualified "order"
        // must bind nothing, while "item" binds exactly (i1, e4).
        for (qualifier, expected) in [("order", 0), ("item", 1)] {
            let res = eval(tree(
                vec![BindingBoxTreeNode::Box(
                    BindingBox {
                        new_object_vars: ob_vars(&[(0, "item")]),
                        new_event_vars: ev_vars(&[(0, "ship")]),
                        filters: vec![o2e(0, 0, Some(qualifier))],
                        ..Default::default()
                    },
                    vec![],
                )],
                &[],
            ));
            assert_eq!(
                res.evaluation_results[0].situation_count, expected,
                "qualifier {qualifier}"
            );
        }
    }

    #[test]
    fn a_predicate_as_a_constraint_reports_a_violation_where_as_a_filter_it_removes_the_binding() {
        // Same predicate, same candidates: as a `filter` the failing binding disappears; as a `constraint` it stays and is reported violated.
        let bbox = |as_constraint: bool| BindingBox {
            new_object_vars: ob_vars(&[(0, "order")]),
            new_event_vars: ev_vars(&[(0, "place")]),
            filters: {
                let mut f = vec![o2e(0, 0, None)];
                if !as_constraint {
                    f.push(amount_at_least(0, 10));
                }
                f
            },
            constraints: if as_constraint {
                vec![Constraint::Filter {
                    filter: amount_at_least(0, 10),
                }]
            } else {
                vec![]
            },
            ..Default::default()
        };

        let filtered = eval(tree(
            vec![BindingBoxTreeNode::Box(bbox(false), vec![])],
            &[],
        ));
        assert_eq!(filtered.evaluation_results[0].situation_count, 1);
        assert_eq!(filtered.evaluation_results[0].situation_violated_count, 0);
        assert_eq!(bound_object_ids(&filtered, 0, 0), vec!["o1"]);

        let constrained = eval(tree(vec![BindingBoxTreeNode::Box(bbox(true), vec![])], &[]));
        let node = &constrained.evaluation_results[0];
        assert_eq!(node.situation_count, 2, "both places are still situations");
        assert_eq!(node.situation_violated_count, 1);
        let violated: Vec<_> = node
            .situations
            .iter()
            .filter(|(_, v)| v.is_some())
            .collect();
        assert!(
            matches!(
                violated[0].1,
                Some(ViolationReason::ConstraintNotSatisfied(0))
            ),
            "got {:?}",
            violated[0].1
        );
        let idx = violated[0].0.get_ob_index(&ObjectVariable(0)).unwrap();
        assert_eq!(
            constrained.object_ids[(*idx).into_inner() as usize],
            "o2",
            "the order whose place event is below the threshold is the violated one"
        );
    }

    #[test]
    fn num_childs_constraint_violates_the_parent_bindings_without_a_matching_child() {
        // Root: every order. Child "A": that order's `pay` events. o1 pays (e3), o2 does not, so
        // the >= 1 constraint marks exactly o2 violated and the child node has a single situation.
        let res = eval(tree(
            vec![
                BindingBoxTreeNode::Box(
                    BindingBox {
                        new_object_vars: ob_vars(&[(0, "order")]),
                        constraints: vec![Constraint::SizeFilter {
                            filter: SizeFilter::NumChilds {
                                child_name: "A".to_string(),
                                min: Some(1),
                                max: None,
                            },
                        }],
                        ..Default::default()
                    },
                    vec![1],
                ),
                BindingBoxTreeNode::Box(
                    BindingBox {
                        new_event_vars: ev_vars(&[(0, "pay")]),
                        filters: vec![o2e(0, 0, None)],
                        ..Default::default()
                    },
                    vec![],
                ),
            ],
            &[((0, 1), "A")],
        ));

        let root = &res.evaluation_results[0];
        assert_eq!(root.situation_count, 2);
        assert_eq!(root.situation_violated_count, 1);
        let violated_ob = root
            .situations
            .iter()
            .find(|(_, v)| v.is_some())
            .map(|(b, _)| *b.get_ob_index(&ObjectVariable(0)).unwrap())
            .unwrap();
        assert_eq!(res.object_ids[violated_ob.into_inner() as usize], "o2");

        let child = &res.evaluation_results[1];
        assert_eq!(child.situation_count, 1, "only o1 has a pay event");
        assert_eq!(child.situation_violated_count, 0);
        assert_eq!(bound_event_ids(&res, 1, 0), vec!["e3"]);
    }

    /// An edge name a `NumChilds` constraint can't match leaves the count unknown, which counts as a violation, not a pass.
    #[test]
    fn num_childs_against_an_unknown_child_name_violates_every_binding() {
        let res = eval(tree(
            vec![
                BindingBoxTreeNode::Box(
                    BindingBox {
                        new_object_vars: ob_vars(&[(0, "order")]),
                        constraints: vec![Constraint::SizeFilter {
                            filter: SizeFilter::NumChilds {
                                child_name: "does-not-exist".to_string(),
                                min: Some(1),
                                max: None,
                            },
                        }],
                        ..Default::default()
                    },
                    vec![1],
                ),
                BindingBoxTreeNode::Box(
                    BindingBox {
                        new_event_vars: ev_vars(&[(0, "pay")]),
                        filters: vec![o2e(0, 0, None)],
                        ..Default::default()
                    },
                    vec![],
                ),
            ],
            &[((0, 1), "A")],
        ));
        let root = &res.evaluation_results[0];
        assert_eq!(root.situation_count, 2);
        assert_eq!(root.situation_violated_count, 2);
    }

    #[test]
    fn evaluation_result_pages_the_situations_it_just_produced() {
        let mut res = eval(tree(
            vec![BindingBoxTreeNode::Box(
                BindingBox {
                    new_object_vars: ob_vars(&[(0, "order")]),
                    new_event_vars: ev_vars(&[(0, "place")]),
                    filters: vec![o2e(0, 0, None)],
                    constraints: vec![Constraint::Filter {
                        filter: amount_at_least(0, 10),
                    }],
                    ..Default::default()
                },
                vec![],
            )],
            &[],
        ));
        res.eval_version = 7;

        let summary = res.summary();
        assert_eq!(summary.node_summaries[0].situation_count, 2);
        assert_eq!(summary.node_summaries[0].situation_violated_count, 1);
        assert_eq!(summary.eval_version, 7);

        let page = res
            .get_page(&EvalPageRequest {
                eval_version: 7,
                node_index: 0,
                offset: 0,
                limit: 10,
                violated: Some(true),
                parent: None,
                child_nodes: None,
            })
            .expect("page");
        assert_eq!(page.filtered_count, 1);
        assert_eq!(page.rows.len(), 1);
        // The row carries ids, not indices: this is where an off-by-one in the index -> id tables
        // would surface as the wrong object being blamed.
        assert_eq!(page.rows[0].objects, vec![(ObjectVariable(0), "o2".into())]);
        assert_eq!(page.rows[0].events, vec![(EventVariable(0), "e2".into())]);
        assert!(page.rows[0].violation.is_some());
    }

    /// Every order, with child "A" binding each `ship` event of that order. o1 ships twice (e4,
    /// e5) and o2 never ships.
    fn orders_and_their_shipments() -> EvaluateBoxTreeResult {
        let mut res = eval(tree(
            vec![
                BindingBoxTreeNode::Box(
                    BindingBox {
                        new_object_vars: ob_vars(&[(0, "order")]),
                        ..Default::default()
                    },
                    vec![1],
                ),
                BindingBoxTreeNode::Box(
                    BindingBox {
                        new_event_vars: ev_vars(&[(0, "ship")]),
                        filters: vec![o2e(0, 0, None)],
                        ..Default::default()
                    },
                    vec![],
                ),
            ],
            &[((0, 1), "A")],
        ));
        res.eval_version = 1;
        res
    }

    fn page_req(node_index: usize) -> EvalPageRequest {
        EvalPageRequest {
            eval_version: 1,
            node_index,
            offset: 0,
            limit: 10,
            violated: None,
            parent: None,
            child_nodes: None,
        }
    }

    #[test]
    fn rows_count_the_child_rows_that_extend_them() {
        let res = orders_and_their_shipments();
        let page = res
            .get_page(&EvalPageRequest {
                child_nodes: Some(vec![1]),
                ..page_req(0)
            })
            .expect("page");
        let counts: HashMap<_, _> = page
            .rows
            .iter()
            .map(|r| (r.objects[0].1.as_str(), r.child_counts.clone()))
            .collect();
        assert_eq!(counts["o1"], Some(vec![2]));
        assert_eq!(counts["o2"], Some(vec![0]));
        let plain = res.get_page(&page_req(0)).expect("page");
        assert!(plain.rows.iter().all(|r| r.child_counts.is_none()));
    }

    #[test]
    fn a_parent_row_narrows_the_page_to_its_child_rows() {
        let res = orders_and_their_shipments();
        let of = |id: &str| EvalPageRequest {
            parent: Some(ParentRow {
                objects: vec![(ObjectVariable(0), id.to_string())],
                events: vec![],
            }),
            ..page_req(1)
        };
        let o1 = res.get_page(&of("o1")).expect("page");
        assert_eq!(o1.filtered_count, 2);
        let mut shipped: Vec<_> = o1.rows.iter().map(|r| r.events[0].1.as_str()).collect();
        shipped.sort_unstable();
        assert_eq!(shipped, vec!["e4", "e5"]);
        let o2 = res.get_page(&of("o2")).expect("page");
        assert_eq!((o2.filtered_count, o2.rows.len()), (0, 0));
    }

    #[test]
    fn child_counts_reject_an_unknown_node() {
        let res = orders_and_their_shipments();
        let err = res
            .get_page(&EvalPageRequest {
                child_nodes: Some(vec![9]),
                ..page_req(0)
            })
            .unwrap_err();
        assert!(err.contains("out of range"), "got: {err}");
    }
}
