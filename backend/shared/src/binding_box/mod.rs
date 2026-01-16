pub mod structs;

pub mod step_order;

pub mod expand_step;

#[cfg(test)]
pub mod test;

use std::{collections::HashSet, fs::File, io::BufWriter, time::Instant};

use chrono::DateTime;
use itertools::Itertools;

use process_mining::{
    core::event_data::object_centric::{
        linked_ocel::{
            slim_linked_ocel::{EventIndex, ObjectIndex},
            LinkedOCELAccess, SlimLinkedOCEL,
        },
        OCELRelationship,
    },
    Exportable, OCEL,
};
use serde::{Deserialize, Serialize};
pub use structs::{Binding, BindingBox, BindingBoxTree, BindingStep, ViolationReason};
use ts_rs::TS;

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateBoxTreeResult {
    pub evaluation_results: Vec<EvaluationResultWithCount>,
    pub object_ids: Vec<String>,
    pub event_ids: Vec<String>,
    pub bindings_skipped: bool,
}

impl EvaluateBoxTreeResult {
    pub fn clone_first_few(&self) -> Self {
        Self {
            evaluation_results: self
                .evaluation_results
                .iter()
                .map(|res_with_count| EvaluationResultWithCount {
                    situations: res_with_count
                        .situations
                        .iter()
                        .take(10_000)
                        .cloned()
                        .collect(),
                    situation_count: res_with_count.situation_count,
                    situation_violated_count: res_with_count.situation_violated_count,
                })
                .collect(),
            object_ids: self.object_ids.clone(),
            event_ids: self.event_ids.clone(),
            bindings_skipped: self.bindings_skipped,
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]

pub struct CheckWithBoxTreeRequest {
    pub tree: BindingBoxTree,
    pub measure_performance: Option<bool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]

pub struct FilterExportWithBoxTreeRequest {
    pub tree: BindingBoxTree,
    pub export_format: ExportFormat,
}

#[derive(Serialize, Deserialize, Debug)]
pub enum ExportFormat {
    XML,
    JSON,
    SQLITE,
}

impl ExportFormat {
    pub fn to_extension(&self) -> &'static str {
        match self {
            ExportFormat::XML => "xml",
            ExportFormat::JSON => "json",
            ExportFormat::SQLITE => "sqlite",
        }
    }
}

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
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
            let start = Instant::now();
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
                r.situations.push((binding, viol));
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
    let now = Instant::now();
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
        r.situations.push((binding, viol));
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
    })
}

pub fn filter_ocel_box_tree(tree: BindingBoxTree, ocel: &SlimLinkedOCEL) -> Result<OCEL, String> {
    let now = Instant::now();
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
    let filter_now = Instant::now();
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
