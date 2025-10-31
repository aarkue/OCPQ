use std::collections::{HashMap, HashSet};

use process_mining::{
    object_centric::oc_declare::{
        perf::{get_evs_with_objs_perf, get_for_ev_perf},
        OCDeclareArc, OCDeclareArcType,
    },
    ocel::linked_ocel::{IndexLinkedOCEL, LinkedOCELAccess},
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
pub struct ActivityStatistics {
    pub num_evs_per_ot_type: HashMap<String, Vec<usize>>,
    pub num_obs_of_ot_per_ev: HashMap<String, Vec<usize>>,
}

pub fn get_activity_statistics(locel: &IndexLinkedOCEL, activity: &str) -> ActivityStatistics {
    // Number of activity events per object (of a type)
    let mut num_evs_per_type: HashMap<String, Vec<usize>> = HashMap::new();
    let mut relevant_object_types = HashSet::new();
    // Number of objects (of a type) per activity
    let mut num_objects_per_type: HashMap<&String, Vec<usize>> = HashMap::new();

    for ev in locel.get_evs_of_type(activity) {
        let mut num_obs_of_type_for_ev = HashMap::new();
        for (_q, ob) in locel.get_e2o(ev) {
            let ot = &locel[ob].object_type;
            *num_obs_of_type_for_ev.entry(ot).or_default() += 1
        }
        for (a, b) in num_obs_of_type_for_ev {
            relevant_object_types.insert(a);
            num_objects_per_type.entry(a).or_default().push(b);
        }
    }

    for ot in relevant_object_types {
        num_evs_per_type.insert(
            ot.to_string(),
            locel
                .get_obs_of_type(&ot)
                .into_iter()
                .map(|o| {
                    locel
                        .get_e2o_rev(o)
                        .filter(|(_q, e)| locel[*e].event_type == activity)
                        .count()
                })
                .collect(),
        );
    }
    ActivityStatistics {
        num_obs_of_ot_per_ev: num_objects_per_type
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
        num_evs_per_ot_type: num_evs_per_type,
    }
}

pub fn get_edge_stats(locel: &IndexLinkedOCEL, arc: &OCDeclareArc) -> Vec<i64> {
    locel
        .get_evs_of_type(arc.from.as_str())
        .flat_map(|ev_index| {
            let ev_time = locel[ev_index].time;
            arc.label
                .get_bindings(ev_index, locel)
                .flat_map(move |binding| {
                    let mut target_ev_iterator =
                        get_evs_with_objs_perf(&binding, locel, arc.to.as_str()).filter(|ev2| {
                            match arc.arc_type {
                                OCDeclareArcType::EF | OCDeclareArcType::DF => ev_index < ev2,
                                OCDeclareArcType::EP | OCDeclareArcType::DP => ev_index > ev2,
                                OCDeclareArcType::AS => true,
                            }
                        });
                    target_ev_iterator
                        .next()
                        .map(|ev2| (locel[ev2].time - ev_time).num_milliseconds())
                })
        })
        .collect()
}
