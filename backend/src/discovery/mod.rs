use core::f32;
use std::collections::{HashMap, HashSet};

use axum::{extract::State, Json};
use itertools::Itertools;
use process_mining::{ocel::ocel_struct::OCELEvent, OCEL};
use serde::{Deserialize, Serialize};

use crate::{
    constraints::{CountConstraint, EventType, SecondsRange},
    ocel_qualifiers::qualifiers::get_qualifiers_for_event_types,
    preprocessing::preprocess::{link_ocel_info, LinkedOCEL},
    with_ocel_from_state, AppState,
};
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EventuallyFollowsConstraints {
    pub seconds_range: SecondsRange,
    pub object_types: Vec<String>,
    pub from_event_type: String,
    pub to_event_type: String,
}

#[derive(Debug)]
pub struct EFConstraintInfo {
    pub constraint: EventuallyFollowsConstraints,
    pub supporting_object_ids: HashSet<String>,
    pub cover_fraction: f32,
}

pub fn auto_discover_eventually_follows(
    linked_ocel: &LinkedOCEL,
    object_ids: Option<HashSet<String>>,
    options: EventuallyFollowsConstraintOptions,
) -> Vec<EFConstraintInfo> {
    let object_ids = object_ids.as_ref();
    // Prev. Event Type, Event Type, Object Type -> Object ID numSeconds delay
    let mut map: HashMap<(&String, &String, &String), Vec<(String, i64)>> = HashMap::new();
    // Same as above but -> (Prev. Event ID, Event ID)
    let mut ev_map: HashMap<(&String, &String, &String), HashSet<(&String, &String)>> =
        HashMap::new();
    // Event Type, Object Type -> #Encountered occurences
    let mut event_type_count_per_obj_type: HashMap<(&String, &String), usize> = HashMap::new();
    for ot in &options.object_types {
        for o in linked_ocel.objects_of_type.get(ot).unwrap_or(&vec![]) {
            if object_ids.is_none() || object_ids.unwrap().contains(&o.id) {
                if let Some(ev_ids) = linked_ocel.object_events_map.get(&o.id) {
                    let ordered_events = ev_ids
                        .iter()
                        .map(|ev_id| linked_ocel.event_map.get(ev_id).unwrap())
                        .sorted_by_key(|ev| ev.time)
                        .collect_vec();
                    for i in 0..ordered_events.len() {
                        let prev_ev = ordered_events[i];
                        *event_type_count_per_obj_type
                            .entry((&prev_ev.event_type, &o.object_type))
                            .or_default() += 1;
                        for j in i + 1..ordered_events.len() {
                            let next_ev = ordered_events[j];
                            if ordered_events
                                .iter()
                                .skip(i)
                                .take(j - i)
                                .any(|ev| ev.event_type == next_ev.event_type)
                            {
                                continue;
                            }
                            if next_ev.event_type == prev_ev.event_type {
                                break;
                            }
                            map.entry((&prev_ev.event_type, &next_ev.event_type, &o.object_type))
                                .or_default()
                                .push((
                                    o.id.clone(),
                                    ((next_ev.time - prev_ev.time).num_seconds()),
                                ));

                            ev_map
                                .entry((&prev_ev.event_type, &next_ev.event_type, &o.object_type))
                                .or_default()
                                .insert((&prev_ev.id, &next_ev.id));
                        }
                    }
                }
            }
        }
    }

    let mut ret: Vec<EFConstraintInfo> = Vec::new();
    for prev_et in linked_ocel.events_of_type.keys() {
        for next_et in linked_ocel.events_of_type.keys() {
            let common_obj_types: HashSet<Vec<_>> = options
                .object_types
                .iter()
                .filter_map(|obj_type| {
                    let evs = ev_map.get(&(prev_et, next_et, obj_type));
                    match evs {
                        Some(evs) => {
                            // let mut other_obj_types_with_same_evs: HashSet<&String> = options
                            //     .object_types
                            //     .iter()
                            //     .filter(|obj_type2| {
                            //         ev_map
                            //             .get(&(prev_et, next_et, obj_type2))
                            //             .and_then(|evs2| Some(evs2.is_superset(evs)))
                            //             .is_some_and(|b| b)
                            //     })
                            //     .collect();
                            // ↓ Disables merging of object types
                            let mut other_obj_types_with_same_evs = HashSet::new(); 
                            other_obj_types_with_same_evs.insert(obj_type);
                            Some(
                                other_obj_types_with_same_evs
                                    .into_iter()
                                    .sorted()
                                    .collect_vec(),
                            )
                        }
                        None => None,
                    }
                })
                .collect();
            // if common_obj_types.len() > 0 {
            //     println!("{prev_et} -> {next_et}: {:?}", common_obj_types);
            // }
            //     let mut ev_sets: Vec<_> = options.object_types.iter().flat_map(|obj_type| match ev_map.get(&(prev_et,next_et,obj_type)) {
            //         Some(evts) => evts.into_iter().map(|evs| (obj_type,evs)).collect(),
            //         None => vec![],
            //     }

            // ).collect();
            // ev_sets.iter().map(|(obj_type,(prev_ev,next_ev)))

            // for ev_set in ev_sets.iter_mut() {
            //     if
            // }
            for obj_types in common_obj_types {
                if obj_types.len() == 0 {
                    eprintln!("obj_types of length 0");
                    continue;
                }
                let obj_type = obj_types[0];
                let count = *event_type_count_per_obj_type
                    .get(&(prev_et, obj_type))
                    .unwrap_or(&0);
                if count > 0 {
                    if let Some(delay_seconds) = map.get(&(prev_et, next_et, obj_type)) {
                        let fraction = delay_seconds.len() as f32 / count as f32;
                        if fraction >= options.cover_fraction {
                            let mean_delay_seconds =
                                delay_seconds.iter().map(|(_, c)| c).sum::<i64>() as f32
                                    / delay_seconds.len() as f32;
                            let delay_seconds_std_deviation = delay_seconds
                                .iter()
                                .map(|(_, c)| {
                                    let diff = mean_delay_seconds - *c as f32;
                                    diff * diff
                                })
                                .sum::<f32>()
                                .sqrt();
                            let mut std_dev_factor: f32 = 0.001;
                            while (delay_seconds
                                .iter()
                                .filter(|(_, c)| {
                                    (mean_delay_seconds
                                        - std_dev_factor * delay_seconds_std_deviation)
                                        <= *c as f32
                                        && *c as f32
                                            <= (mean_delay_seconds
                                                + std_dev_factor * delay_seconds_std_deviation)
                                })
                                .count() as f32)
                                / (delay_seconds.len() as f32)
                                < options.cover_fraction
                            {
                                std_dev_factor += 0.001;
                            }
                            let min: f32 = 0.0; //TODO: CHANGE BACK
                                // mean_delay_seconds - std_dev_factor * delay_seconds_std_deviation;
                            let max =
                                mean_delay_seconds + std_dev_factor * delay_seconds_std_deviation;
                            let supporting = delay_seconds
                                .iter()
                                .filter(|(_obj_id, c)| {
                                    (mean_delay_seconds
                                        - std_dev_factor * delay_seconds_std_deviation)
                                        <= *c as f32
                                        && *c as f32
                                            <= (mean_delay_seconds
                                                + std_dev_factor * delay_seconds_std_deviation)
                                })
                                .collect_vec();

                            ret.push(EFConstraintInfo {
                                constraint: EventuallyFollowsConstraints {
                                    seconds_range: SecondsRange {
                                        min_seconds: min.max(0.0) as f64,
                                        max_seconds: max as f64,
                                    },
                                    object_types: obj_types.into_iter().cloned().collect_vec(),
                                    from_event_type: prev_et.clone(),
                                    to_event_type: next_et.clone(),
                                },
                                supporting_object_ids: supporting
                                    .iter()
                                    .map(|(obj_id, _c)| obj_id.clone())
                                    .collect(),
                                cover_fraction: supporting.len() as f32
                                    / delay_seconds.len() as f32,
                            });
                            // println!(
                            //     "{:.2} {} -> {} for ot {} mean: {:.2} ; {:.2}-{:.2} ",
                            //     fraction,
                            //     prev_et,
                            //     next_et,
                            //     obj_type,
                            //     mean_delay_seconds,
                            //     min / (60.0 * 60.0),
                            //     max / (60.0 * 60.0),
                            // );
                        }
                    }
                }
            }
        }
    }
    ret
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SimpleDiscoveredCountConstraints {
    pub count_constraint: CountConstraint,
    pub object_type: String,
    pub event_type: EventType,
}
// We might want to also return a set of "supporting objects" for each discovered constraints
// These are the objects for which the count constraint is satisfied
// This would allows us to build constraints specifically for the _same_ or the _other_ (i.e., set of objects of same type not supported)
// Would be useful for constructing/discovering targeted OR (or XOR) constraints

// Similiarly, it would be nice to have some sort of input object_ids (only those should be considered)

#[derive(Debug)]
pub struct CountConstraintInfo {
    pub constraint: SimpleDiscoveredCountConstraints,
    pub supporting_object_ids: HashSet<String>,
    pub cover_fraction: f32,
}
pub fn auto_discover_count_constraints(
    ocel: &OCEL,
    linked_ocel: &LinkedOCEL,
    object_ids: Option<HashSet<String>>,
    options: CountConstraintOptions,
    // Constraint + Supporting objects
) -> Vec<CountConstraintInfo> {
    let mut num_evs_per_obj_and_ev_type: HashMap<(String, String), Vec<(f32, String)>> =
        HashMap::new();
    let qual_per_event_type = get_qualifiers_for_event_types(ocel);
    let object_ids = object_ids.as_ref();
    let obj_types_per_ev_type: HashMap<String, HashSet<String>> = ocel
        .event_types
        .iter()
        .map(|et| {
            let set: HashSet<String> = match qual_per_event_type.get(&et.name) {
                Some(hs) => hs.values().flat_map(|v| v.object_types.clone()).collect(),
                None => HashSet::new(),
            };
            (et.name.clone(), set)
        })
        .collect();
    let event_types_per_obj_type: HashMap<String, Vec<&String>> = options
        .object_types
        .iter()
        .map(|ot| {
            (
                ot.clone(),
                ocel.event_types
                    .iter()
                    .map(|et| &et.name)
                    .filter(|et| obj_types_per_ev_type.get(*et).unwrap().contains(ot))
                    .collect_vec(),
            )
        })
        .collect();
    // event type, object id
    let mut map: HashMap<(&String, &String), usize> = HashMap::new();
    for object_type in &options.object_types {
        for object in linked_ocel
            .objects_of_type
            .get(object_type)
            .unwrap_or(&Vec::new())
        {
            if object_ids.is_none() || object_ids.unwrap().contains(&object.id) {
                for ev_type in event_types_per_obj_type.get(&object.object_type).unwrap() {
                    map.insert((ev_type, &object.id), 0);
                }
            }
        }
    }
    for ev in &ocel.events {
        for obj_id in ev
            .relationships
            .iter()
            .flatten()
            .map(|e| &e.object_id)
            .filter(|o_id| {
                if object_ids.is_none() || object_ids.unwrap().contains(&o_id.to_string()) {
                    match linked_ocel.object_map.get(*o_id) {
                        Some(o) => options.object_types.contains(&o.object_type),
                        None => false,
                    }
                } else {
                    false
                }
            })
            .sorted()
            .dedup()
        {
            *map.entry((&ev.event_type, obj_id)).or_default() += 1;
        }
    }
    for obj_type in &options.object_types {
        let evt_types = event_types_per_obj_type.get(obj_type).unwrap();
        for evt_type in evt_types {
            let mut counts: Vec<(f32, String)> = Vec::new();
            for obj in linked_ocel.objects_of_type.get(obj_type).unwrap() {
                if object_ids.is_none() || object_ids.unwrap().contains(&obj.id) {
                    counts.push((
                        *map.get(&(evt_type, &obj.id)).unwrap() as f32,
                        obj.id.clone(),
                    ));
                }
            }
            num_evs_per_obj_and_ev_type.insert((obj_type.clone(), (*evt_type).clone()), counts);
        }
    }

    let mut ret: Vec<CountConstraintInfo> = Vec::new();
    for ((object_type, event_type), counts) in num_evs_per_obj_and_ev_type {
        let mean = counts.iter().map(|(c, _)| c).sum::<f32>() / counts.len() as f32;
        let std_deviation = counts
            .iter()
            .map(|(c, _)| {
                let diff = mean - *c;
                diff * diff
            })
            .sum::<f32>()
            .sqrt();
        let mut std_dev_factor = 0.001;
        while (counts
            .iter()
            .filter(|(c, _)| {
                (mean - std_dev_factor * std_deviation).round() <= *c
                    && *c <= (mean + std_dev_factor * std_deviation).round()
            })
            .count() as f32)
            / (counts.len() as f32)
            < options.cover_fraction
        {
            std_dev_factor += 0.001;
        }
        let min = (mean - std_dev_factor * std_deviation).round() as usize;
        let max = (mean + std_dev_factor * std_deviation).round() as usize;

        // For now, do not discover constraints with huge range; Those are most of the time not desired
        if max - min > 25 || max > 100 {
            continue;
        } else {
            let new_simple_count_constr = SimpleDiscoveredCountConstraints {
                count_constraint: CountConstraint { min, max },
                object_type,
                event_type: EventType::Exactly { value: event_type },
            };
            let counts_len = counts.len() as f32;
            let filtered = counts
                .into_iter()
                .filter(|(c, _obj_id)| {
                    (mean - std_dev_factor * std_deviation).round() <= *c
                        && *c <= (mean + std_dev_factor * std_deviation).round()
                })
                .collect_vec();
            let fraction = filtered.iter().count() as f32 / counts_len;
            let supporting_object_ids: HashSet<String> =
                filtered.into_iter().map(|(_, obj_id)| obj_id).collect();
            ret.push(CountConstraintInfo {
                constraint: new_simple_count_constr,
                supporting_object_ids,
                cover_fraction: fraction,
            })
        }
    }
    ret
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CountConstraintOptions {
    pub object_types: Vec<String>,
    pub cover_fraction: f32,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EventuallyFollowsConstraintOptions {
    pub object_types: Vec<String>,
    pub cover_fraction: f32,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AutoDiscoverConstraintsRequest {
    pub count_constraints: Option<CountConstraintOptions>,
    pub eventually_follows_constraints: Option<EventuallyFollowsConstraintOptions>,
}
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AutoDiscoverConstraintsResponse {
    pub count_constraints: Vec<SimpleDiscoveredCountConstraints>,
    pub eventually_follows_constraints: Vec<EventuallyFollowsConstraints>,
}

pub async fn auto_discover_constraints_handler(
    state: State<AppState>,
    Json(req): Json<AutoDiscoverConstraintsRequest>,
) -> Json<Option<AutoDiscoverConstraintsResponse>> {
    Json(with_ocel_from_state(&state, |ocel| {
        let linked_ocel = link_ocel_info(ocel);
        let count_constraints = match req.count_constraints {
            Some(count_options) => {
                auto_discover_count_constraints(ocel, &linked_ocel, None, count_options)
            }
            None => Vec::new(),
        };
        let eventually_follows_constraints = match req.eventually_follows_constraints {
            Some(eventually_follows_options) => {
                auto_discover_eventually_follows(&linked_ocel, None, eventually_follows_options)
            }
            None => Vec::new(),
        };
        AutoDiscoverConstraintsResponse {
            count_constraints: count_constraints
                .into_iter()
                .map(|c| c.constraint)
                .collect(),
            eventually_follows_constraints: eventually_follows_constraints
                .into_iter()
                .map(|efc| efc.constraint)
                .collect(),
        }
    }))
}
