use std::{collections::HashSet, sync::Mutex};

use itertools::Itertools;
use rayon::iter::{IntoParallelIterator, IntoParallelRefIterator, ParallelIterator};

use crate::{
    constraints::EventType,
    preprocessing::preprocess::{get_events_of_type_associated_with_objects, LinkedOCEL},
};

use super::{EventuallyFollowsConstraints, SimpleDiscoveredCountConstraints};

///
/// Get fraction of object IDs that support the given count constraints
///
/// Only evaluates the passed object IDs
///
pub fn get_count_constraint_fraction(
    linked_ocel: &LinkedOCEL,
    c: &SimpleDiscoveredCountConstraints,
    object_ids: &HashSet<String>,
    return_supporting_objs: bool,
) -> (f32, Option<HashSet<String>>) {
    let counts: Vec<_> = object_ids
        .par_iter()
        .map(|obj_id| {
            let count = get_events_of_type_associated_with_objects(
                &linked_ocel,
                &c.event_type,
                vec![obj_id.clone()],
            )
            .len();
            (count, obj_id)
        })
        .collect();
    let counts_len = counts.len();
    let supporting_obj_ids_ref: Vec<_> = counts
        .into_par_iter()
        .filter(|(count, obj_id)| {
            c.count_constraint.max >= *count && c.count_constraint.min <= *count
        })
        .map(|(c, obj_id)| obj_id)
        .collect();
    let num_supporting_objs = supporting_obj_ids_ref.len();
    let supporting_obj_ids: Option<HashSet<String>> = match return_supporting_objs {
        true => Some(
            supporting_obj_ids_ref
                .into_iter()
                .cloned()
                // .map(| obj_id)| obj_id.clone())
                .collect(),
        ),
        false => None,
    };
    let cover_frac_orig = num_supporting_objs as f32 / counts_len as f32;
    (cover_frac_orig, supporting_obj_ids)
}

///
/// Get fraction of object IDs that support the given eventuall-follows constraints
///
/// Only evaluates the passed object IDs
///
/// Also returns supporting object IDs (i.e. objects for which  _ALL_ from even types have an appropriate "to" event )
///
pub fn get_ef_constraint_fraction(
    linked_ocel: &LinkedOCEL,
    c: &EventuallyFollowsConstraints,
    object_ids: &HashSet<String>,
    return_supporting_objs: bool,
) -> (f32, Option<HashSet<String>>) {
    let from_ev_type = EventType::Exactly {
        value: c.from_event_type.clone(),
    };
    let to_ev_type = EventType::Exactly {
        value: c.to_event_type.clone(),
    };
    let supporting_obj_ids: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
    let (total_from_ev_count, total_sat_from_ev_count) = object_ids
        .par_iter()
        .map(|obj_id| {
            let from_evs = get_events_of_type_associated_with_objects(
                &linked_ocel,
                &from_ev_type,
                vec![obj_id.clone()],
            );
            let to_evs = get_events_of_type_associated_with_objects(
                &linked_ocel,
                &to_ev_type,
                vec![obj_id.clone()],
            );
            let num_from_evs = from_evs.len();
            let num_sat_from_evs = from_evs
                .iter()
                .filter(|from_ev| {
                    to_evs.iter().any(|e| {
                        let diff = (e.time - from_ev.time).num_seconds() as f64;
                        diff >= c.seconds_range.min_seconds && diff <= c.seconds_range.max_seconds
                    })
                })
                .count();
            if return_supporting_objs && num_sat_from_evs == num_from_evs {
                supporting_obj_ids.lock().unwrap().insert(obj_id.clone());
            }
            (num_from_evs, num_sat_from_evs)
        })
        .reduce(
            || (0, 0),
            |(total_num, total_num_sat), (o_num, o_num_sat)| {
                (total_num + o_num, total_num_sat + o_num_sat)
            },
        );
    // .reduce(|(total_num, total_num_sat), (o_num, o_num_sat)| {
    //     (total_num + o_num, total_num_sat + o_num_sat)
    // })
    // .unwrap_or_default();
    // if  c.from_event_type == "place order" && c.to_event_type == "pay order"  && c.object_types[0]  == "orders" {
    //   println!("Total sat: {} (objs: {}) / Total: {}\nFirst obj: {:?}\n{:?}\n\n",total_sat_from_ev_count, supporting_obj_ids.len(), total_from_ev_count, object_ids.iter().next().unwrap(), c);
    // }
    (
        total_sat_from_ev_count as f32 / total_from_ev_count as f32,
        if return_supporting_objs {
            Some(supporting_obj_ids.into_inner().unwrap())
        } else {
            None
        },
    )
}
