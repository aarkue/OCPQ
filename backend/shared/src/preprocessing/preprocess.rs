// use std::collections::{HashMap, HashSet};

// use itertools::Itertools;
// use process_mining::{
//     event_log::ocel::ocel_struct::{OCELEvent, OCELObject, OCELRelationship},
//     OCEL,
// };

// use crate::ocel_qualifiers::qualifiers::QualifierAndObjectType;

// pub fn get_object_events_map(ocel: &OCEL) -> HashMap<String, Vec<String>> {
//     let mut object_events_map: HashMap<String, Vec<String>> = ocel
//         .objects
//         .iter()
//         .map(|o| (o.id.clone(), Vec::new()))
//         .collect();

//     for e in &ocel.events {
//         let rels = get_event_relationships(e);
//         for r in rels {
//             match object_events_map.get_mut(&r.object_id) {
//                 Some(o_evs) => o_evs.push(e.id.clone()),
//                 None => {
//                     eprintln!("Malformed OCEL: Event {} relates to object ID {}, which does not belong to any object.",e.id,r.object_id)
//                 }
//             }
//         }
//     }
//     object_events_map
// }

// pub fn get_events_of_type_associated_with_objects(
//     linked_ocel: &LegacyIndexLinkedOCEL,
//     event_types: &[&String],
//     object_ids: &[ObjectIndex],
// ) -> Vec<EventIndex> {
//     if object_ids.is_empty() {
//         return event_types
//             .iter()
//             .flat_map(|et| linked_ocel.events_of_type.get(*et).unwrap())
//             .copied()
//             .collect();
//     }
//     // let mut sorted_object_ids = object_ids.clone();
//     let mut sorted_object_ids_iter = object_ids.iter().sorted_by(|a, b| {
//         linked_ocel
//             .object_events_map
//             .get(a)
//             .unwrap()
//             .len()
//             .cmp(&linked_ocel.object_events_map.get(b).unwrap().len())
//     });
//     // sorted_object_ids.sort_by(|a, b| {
//     //     linked_ocel
//     //         .object_events_map
//     //         .get(a)
//     //         .unwrap()
//     //         .len()
//     //         .cmp(&linked_ocel.object_events_map.get(b).unwrap().len())
//     // });
//     let mut intersection: HashSet<EventIndex> = linked_ocel
//         .object_events_map
//         .get(sorted_object_ids_iter.next().unwrap())
//         .unwrap()
//         .iter()
//         .filter(|ev_id| event_types.contains(&&linked_ocel.ev_by_index(ev_id).unwrap().event_type))
//         .copied()
//         .collect();
//     for other in sorted_object_ids_iter {
//         let other_map: HashSet<EventIndex> = linked_ocel
//             .object_events_map
//             .get(other)
//             .unwrap()
//             .iter()
//             .copied()
//             .collect();
//         intersection.retain(|ev| other_map.contains(ev))
//     }
//     intersection.into_iter().collect()
// }

// pub fn get_event_relationships(ev: &OCELEvent) -> Vec<OCELRelationship> {
//     ev.relationships.clone()
// }

pub fn get_object_relationships(obj: &OCELObject) -> Vec<OCELRelationship> {
    obj.relationships.clone()
}

use std::collections::{HashMap, HashSet};

use process_mining::{
    ocel::ocel_struct::{OCELObject, OCELRelationship},
    OCEL,
};

use crate::ocel_qualifiers::qualifiers::QualifierAndObjectType;

///
/// Computes [HashMap] linking an object type to the [HashSet] of [QualifierAndObjectType] that objects of that type are linked to (through O2O Relationships)
pub fn get_object_rels_per_type(
    ocel: &OCEL,
    object_map: &HashMap<&str, &OCELObject>,
) -> HashMap<String, HashSet<QualifierAndObjectType>> {
    let mut object_to_object_rels_per_type: HashMap<String, HashSet<QualifierAndObjectType>> = ocel
        .object_types
        .iter()
        .map(|t| (t.name.clone(), HashSet::new()))
        .collect();
    for o in &ocel.objects {
        let rels_for_type = object_to_object_rels_per_type
            .get_mut(&o.object_type)
            .unwrap();
        for rels in get_object_relationships(o) {
            match object_map.get(rels.object_id.as_str()) {
                Some(rel_obj) => {
                    rels_for_type.insert((rels.qualifier, rel_obj.object_type.clone()));
                }
                None => {
                    eprintln!("Malformed OCEL: Object {} has relationship to object ID {}, which does not belong to any object",o.id, rels.object_id);
                }
            }
        }
    }
    object_to_object_rels_per_type
}

// #[derive(Debug, Clone)]
// pub struct LinkedOCEL<'a> {
//     pub event_map: HashMap<String, &'a OCELEvent>,
//     pub object_map: HashMap<String, &'a OCELObject>,
//     pub events_of_type: HashMap<String, Vec<&'a OCELEvent>>,
//     pub objects_of_type: HashMap<String, Vec<&'a OCELObject>>,
//     pub object_events_map: HashMap<String, Vec<String>>,
//     pub object_rels_per_type: HashMap<String, HashSet<QualifierAndObjectType>>,

//     pub events_of_type_index: HashMap<String, Vec<EventIndex>>,
//     pub objects_of_type_index: HashMap<String, Vec<ObjectIndex>>,

//     pub events_index: Vec<&'a OCELEvent>,
//     pub object_index: Vec<&'a OCELObject>,
//     pub event_index_map: HashMap<&'a String, EventIndex>,
//     pub object_index_map: HashMap<&'a String, ObjectIndex>,
// }

// impl<'a> LinkedOCEL<'a> {
//     pub fn ev_by_index(&self, index: &EventIndex) -> Option<&'a OCELEvent> {
//         self.events_index.get(index.0).copied()
//     }
//     pub fn ob_by_index(&self, index: &ObjectIndex) -> Option<&'a OCELObject> {
//         self.object_index.get(index.0).copied()
//     }
// }

// pub fn link_ocel_info(ocel: &OCEL) -> LinkedOCEL {
//     let event_map: HashMap<String, &OCELEvent> =
//         ocel.events.iter().map(|ev| (ev.id.clone(), ev)).collect();
//     let object_map: HashMap<String, &OCELObject> = ocel
//         .objects
//         .iter()
//         .map(|obj| (obj.id.clone(), obj))
//         .collect();

//     let events_of_type: HashMap<String, Vec<&OCELEvent>> = ocel
//         .event_types
//         .iter()
//         .map(|ev_type| {
//             (
//                 ev_type.name.clone(),
//                 ocel.events
//                     .iter()
//                     .filter(|ev| ev.event_type == ev_type.name)
//                     .collect(),
//             )
//         })
//         .collect();

//     let objects_of_type: HashMap<String, Vec<&OCELObject>> = ocel
//         .object_types
//         .iter()
//         .map(|obj_type| {
//             (
//                 obj_type.name.clone(),
//                 ocel.objects
//                     .iter()
//                     .filter(|ev| ev.object_type == obj_type.name)
//                     .collect(),
//             )
//         })
//         .collect();

//     let events_of_type_index = ocel
//         .event_types
//         .iter()
//         .map(|ev_type| {
//             (
//                 ev_type.name.clone(),
//                 ocel.events
//                     .iter()
//                     .enumerate()
//                     .filter(|(_index, ev)| ev.event_type == ev_type.name)
//                     .map(|(index, _)| EventIndex(index))
//                     .collect(),
//             )
//         })
//         .collect();

//     let objects_of_type_index = ocel
//         .object_types
//         .iter()
//         .map(|obj_type| {
//             (
//                 obj_type.name.clone(),
//                 ocel.objects
//                     .iter()
//                     .enumerate()
//                     .filter(|(_index, ob)| ob.object_type == obj_type.name)
//                     .map(|(index, _)| ObjectIndex(index))
//                     .collect(),
//             )
//         })
//         .collect();

//     let object_events_map = get_object_events_map(ocel);
//     let object_rels_per_type = get_object_rels_per_type(ocel, &object_map);
//     LinkedOCEL {
//         event_map,
//         object_map,
//         events_of_type,
//         objects_of_type,
//         object_events_map,
//         object_rels_per_type,
//         events_index: ocel.events.iter().collect_vec(),
//         object_index: ocel.objects.iter().collect_vec(),
//         event_index_map: ocel
//             .events
//             .iter()
//             .enumerate()
//             .map(|(i, e)| (&e.id, EventIndex(i)))
//             .collect(),
//         object_index_map: ocel
//             .objects
//             .iter()
//             .enumerate()
//             .map(|(i, o)| (&o.id, ObjectIndex(i)))
//             .collect(),
//         events_of_type_index,
//         objects_of_type_index,
//     }
// }
