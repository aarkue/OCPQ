use std::collections::HashMap;

use process_mining::OCEL;
use rayon::{iter::IntoParallelRefIterator, prelude::ParallelIterator};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct QualifiersForEventType {
    pub qualifier: String,
    pub multiple: bool,
    pub object_types: Vec<String>,
    // pub counts: Vec<i32>,
}
pub type QualifierAndObjectType = (String, String);

pub fn get_qualifiers_for_event_types(
    ocel: &OCEL,
) -> HashMap<String, HashMap<String, QualifiersForEventType>> {
    let qualifiers_per_event_type: Vec<(String, HashMap<QualifierAndObjectType, Vec<i32>>)> = ocel
        .event_types
        .par_iter()
        .map(|et| {
            (
                et.name.clone(),
                ocel.events
                    .iter()
                    .filter(|ev| ev.event_type == et.name)
                    .map(|ev| {
                        ev.relationships
                            .iter()
                            .filter_map(|r| {
                                let obj = ocel.objects.iter().find(|o| o.id == r.object_id);
                                obj.map(|obj| (r.qualifier.clone(), obj.object_type.clone()))
                            })
                            .fold(HashMap::new(), |mut acc, c| {
                                *acc.entry(c).or_insert(0) += 1;
                                acc
                            })
                    })
                    .fold(HashMap::new(), |mut acc, c| {
                        c.into_iter().for_each(|(a, b)| {
                            let entry: &mut Vec<i32> = acc.entry(a).or_default();
                            entry.push(b);
                        });
                        acc
                    }),
            )
        })
        .collect();
    qualifiers_per_event_type
        .into_iter()
        .map(|(event_type, quals)| {
            let mut ret: HashMap<String, QualifiersForEventType> = HashMap::new();
            quals.iter().for_each(
                |((qualifier, obj_type), counts)| match ret.get_mut(qualifier) {
                    Some(pre_val) => {
                        if !pre_val.object_types.contains(obj_type) {
                            pre_val.object_types.push(obj_type.clone());
                        }
                        for c in counts {
                            if *c > 0 {
                                pre_val.multiple = true;
                            }
                            // pre_val.counts.push(*c);
                        }
                    }
                    None => {
                        ret.insert(
                            qualifier.clone(),
                            QualifiersForEventType {
                                qualifier: qualifier.clone(),
                                multiple: counts.iter().any(|c| *c > 1),
                                object_types: vec![obj_type.clone()],
                                // counts: counts.clone(),
                            },
                        );
                    }
                },
            );

            (event_type, ret)
        })
        .collect()
}
