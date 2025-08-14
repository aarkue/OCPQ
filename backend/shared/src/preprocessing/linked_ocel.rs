use process_mining::{
    event_log::ocel::ocel_struct::{OCELEvent, OCELObject},
    ocel::linked_ocel::{index_linked_ocel::EventOrObjectIndex, IndexLinkedOCEL, LinkedOCELAccess},
};
use serde::{Deserialize, Serialize};

// pub fn get_object_events_map(
//     ocel: &OCEL,
//     object_map: &HashMap<String, ObjectIndex>,
// ) -> HashMap<ObjectIndex, Vec<EventIndex>> {
//     let mut object_events_map: HashMap<ObjectIndex, Vec<EventIndex>> = ocel
//         .objects
//         .iter()
//         .enumerate()
//         .map(|(index, _)| (ObjectIndex(index), Vec::new()))
//         .collect();

//     for (e_index, e) in ocel.events.iter().enumerate() {
//         let rels = get_event_relationships(e);
//         for r in rels {
//             match object_map
//                 .get(&r.object_id)
//                 .and_then(|ob_index| object_events_map.get_mut(ob_index))
//             {
//                 Some(o_evs) => o_evs.push(EventIndex(e_index)),
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
//     event_types: &HashSet<std::string::String>,
//     object_indices: &[ObjectIndex],
// ) -> Vec<EventIndex> {
//     if object_indices.is_empty() {
//         return linked_ocel
//             .ocel
//             .events
//             .iter()
//             .enumerate()
//             .filter(|(_e_index, e)| event_types.contains(&e.event_type))
//             .map(|(e_index, _)| EventIndex(e_index))
//             .collect();
//     }
//     let mut sorted_object_ids_iter = object_indices.iter().sorted_by(|a, b| {
//         linked_ocel
//             .object_events_map
//             .get(*a)
//             .unwrap()
//             .len()
//             .cmp(&linked_ocel.object_events_map.get(*b).unwrap().len())
//     });

//     let mut intersection: HashSet<EventIndex> = linked_ocel
//         .object_events_map
//         .get(sorted_object_ids_iter.next().unwrap())
//         .unwrap()
//         .iter()
//         .filter(|e_index| {
//             event_types.contains(&linked_ocel.ev_by_index(e_index).unwrap().event_type)
//         })
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

// pub fn get_object_relationships(obj: &OCELObject) -> Vec<OCELRelationship> {
//     obj.relationships.clone()
// }

// ///
// /// Computes [HashMap] linking an object type to the [HashSet] of [QualifierAndObjectType] that objects of that type are linked to (through O2O Relationships)
// pub fn get_object_rels_per_type(
//     ocel: &OCEL,
//     object_map: &HashMap<String, &OCELObject>,
// ) -> HashMap<String, HashSet<QualifierAndObjectType>> {
//     let mut object_to_object_rels_per_type: HashMap<String, HashSet<QualifierAndObjectType>> = ocel
//         .object_types
//         .iter()
//         .map(|t| (t.name.clone(), HashSet::new()))
//         .collect();
//     for o in &ocel.objects {
//         if let Some(rels_for_type) = object_to_object_rels_per_type.get_mut(&o.object_type) {
//             for rels in get_object_relationships(o) {
//                 match object_map.get(&rels.object_id) {
//                     Some(rel_obj) => {
//                         rels_for_type.insert((rels.qualifier, rel_obj.object_type.clone()));
//                     }
//                     None => {
//                         eprintln!("Malformed OCEL: Object {} has relationship to object ID {}, which does not belong to any object",o.id, rels.object_id);
//                     }
//                 }
//             }
//         }
//     }
//     object_to_object_rels_per_type
// }

// #[derive(TS)]
// #[ts(export, export_to = "../../../frontend/src/types/generated/")]
// #[derive(Debug, Clone, Copy, Hash, Serialize, Deserialize, PartialEq, Eq)]
// pub struct EventIndex(pub usize);

// impl Display for EventIndex {
//     fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
//         write!(f, "Ev:{}", self.0)
//     }
// }

// #[derive(TS)]
// #[ts(export, export_to = "../../../frontend/src/types/generated/")]
// #[derive(Debug, Clone, Copy, Hash, Serialize, Deserialize, PartialEq, Eq)]
// pub struct ObjectIndex(pub usize);
// impl Display for ObjectIndex {
//     fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
//         write!(f, "Ob:{}", self.0)
//     }
// }

// #[derive(Debug, Hash, PartialEq, Eq, Clone, Copy, Serialize, Deserialize)]
// pub enum EventOrObjectIndex {
//     Object(ObjectIndex),
//     Event(EventIndex),
// }
//
pub fn event_or_object_from_index(
    index: EventOrObjectIndex,
    locel: &IndexLinkedOCEL,
) -> OCELNodeRef {
    let ret = match index {
        EventOrObjectIndex::Event(event_index) => OCELNodeRef::Event(locel.get_ev(&event_index)),
        EventOrObjectIndex::Object(object_index) => {
            OCELNodeRef::Object(locel.get_ob(&object_index))
        }
    };
    ret
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
pub enum OCELNode {
    Event(OCELEvent),
    Object(OCELObject),
}

impl OCELNode {
    pub fn get_id(&self) -> &String {
        match &self {
            OCELNode::Event(ev) => &ev.id,
            OCELNode::Object(ob) => &ob.id,
        }
    }
}

#[derive(Debug)]
pub enum OCELNodeRef<'a> {
    Event(&'a OCELEvent),
    Object(&'a OCELObject),
}
impl OCELNodeRef<'_> {
    pub fn cloned(self) -> OCELNode {
        match self {
            OCELNodeRef::Event(ev) => OCELNode::Event(ev.clone()),
            OCELNodeRef::Object(ob) => OCELNode::Object(ob.clone()),
        }
    }
}

// #[derive(Debug, Clone)]
// pub struct LegacyIndexLinkedOCEL {
//     pub object_events_map: HashMap<ObjectIndex, Vec<EventIndex>>,
//     pub object_rels_per_type: HashMap<String, HashSet<QualifierAndObjectType>>,

//     pub events_of_type: HashMap<String, Vec<EventIndex>>,
//     pub objects_of_type: HashMap<String, Vec<ObjectIndex>>,
//     pub ocel: OCEL,
//     pub event_index_map: HashMap<String, EventIndex>,
//     pub object_index_map: HashMap<String, ObjectIndex>,

//     // Relations between Objects and Objects/Events; Not symmetric!
//     // String represents relation qualifier
//     pub rels: HashMap<EventOrObjectIndex, Vec<(ObjectIndex, String)>>,
//     // Symmetric relations: Object/Event Index maps to set of associated Object/Event index; boolean flag is true if the relation is reversed and a String for the qualifier
//     pub symmetric_rels: HashMap<EventOrObjectIndex, HashSet<(EventOrObjectIndex, bool, String)>>,

//     pub avg_rels_of_type_per_type: HashMap<EventOrObjectType, f32>,
// }

// impl LegacyIndexLinkedOCEL {
//     pub fn new(ocel: OCEL) -> Self {
//         link_ocel_info(ocel)
//     }
//     pub fn ev_by_index<'a>(&'a self, index: &EventIndex) -> Option<&'a OCELEvent> {
//         self.ocel.events.get(index.0)
//     }
//     pub fn ob_by_index<'a>(&'a self, index: &ObjectIndex) -> Option<&'a OCELObject> {
//         self.ocel.objects.get(index.0)
//     }

//     pub fn index_of_ob<'a>(&'a self, ob_id: &String) -> Option<&'a ObjectIndex> {
//         self.object_index_map.get(ob_id)
//     }

//     pub fn ob_by_id<'a>(&'a self, ob_id: &String) -> Option<&'a OCELObject> {
//         self.index_of_ob(ob_id)
//             .and_then(|ob_index| self.ob_by_index(ob_index))
//     }

//     pub fn ev_by_id<'a>(&'a self, ev_id: &String) -> Option<&'a OCELEvent> {
//         self.index_of_ev(ev_id)
//             .and_then(|ev_index| self.ev_by_index(ev_index))
//     }

//     pub fn index_of_ev<'a>(&'a self, ev_id: &String) -> Option<&'a EventIndex> {
//         self.event_index_map.get(ev_id)
//     }

//     pub fn ob_or_ev_by_index(&self, index: EventOrObjectIndex) -> Option<OCELNodeRef> {
//         match index {
//             EventOrObjectIndex::Object(ob_index) => {
//                 self.ob_by_index(&ob_index).map(OCELNodeRef::Object)
//             }
//             EventOrObjectIndex::Event(ev_index) => {
//                 self.ev_by_index(&ev_index).map(OCELNodeRef::Event)
//             }
//         }
//     }
//     pub fn get_symmetric_rels_ob(
//         &self,
//         index: &ObjectIndex,
//     ) -> Option<&HashSet<(EventOrObjectIndex, bool, String)>> {
//         self.symmetric_rels.get(&EventOrObjectIndex::Object(*index))
//     }
//     pub fn get_symmetric_rels_ev(
//         &self,
//         index: &EventIndex,
//     ) -> Option<&HashSet<(EventOrObjectIndex, bool, String)>> {
//         self.symmetric_rels.get(&EventOrObjectIndex::Event(*index))
//     }

//     pub fn get_type_of(&self, index: EventOrObjectIndex) -> Option<EventOrObjectType> {
//         if let Some(x) = self.ob_or_ev_by_index(index) {
//             let res = match x {
//                 OCELNodeRef::Event(ev) => EventOrObjectType::Event(ev.event_type.clone()),
//                 OCELNodeRef::Object(ob) => EventOrObjectType::Object(ob.object_type.clone()),
//             };
//             Some(res)
//         } else {
//             None
//         }
//         // match self.e {
//         //     EventOrObjectIndex::Object(o_index) => self.get,
//         //     EventOrObjectIndex::Event(_) => todo!(),
//         // }
//     }

//     // pub fn get_ocel_type_of_index(&self, index: &EventOrObjectIndex) -> Option<EventOrObjectType> {
//     //     match index {
//     //         EventOrObjectIndex::Object(obi) => {
//     //             if let Some(ob) = self.ob_by_index(obi) {
//     //                 Some(EventOrObjectType::Object(ob.object_type.clone()))
//     //             }else {
//     //                 None
//     //             }
//     //         },
//     //         EventOrObjectIndex::Event(evi) => {
//     //             if let Some(ob) = self.ev_by_index(evi) {
//     //                 Some(EventOrObjectType::Object(ob.event_type.clone()))
//     //             }else {
//     //                 None
//     //             }
//     //         },
//     //     }
//     // }
// }

// pub fn link_ocel_info(ocel: OCEL) -> LegacyIndexLinkedOCEL {
//     let now = Instant::now();
//     let object_map: HashMap<String, &OCELObject> = ocel
//         .objects
//         .iter()
//         .map(|obj| (obj.id.clone(), obj))
//         .collect();

//     let events_of_type: HashMap<String, Vec<EventIndex>> = ocel
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

//     let objects_of_type: HashMap<String, Vec<ObjectIndex>> = ocel
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

//     let event_index_map = ocel
//         .events
//         .iter()
//         .enumerate()
//         .map(|(i, e)| (e.id.clone(), EventIndex(i)))
//         .collect();
//     let object_index_map = ocel
//         .objects
//         .iter()
//         .enumerate()
//         .map(|(i, o)| (o.id.clone(), ObjectIndex(i)))
//         .collect();
//     let object_events_map = get_object_events_map(&ocel, &object_index_map);
//     let object_rels_per_type = get_object_rels_per_type(&ocel, &object_map);
//     let mut rels: HashMap<EventOrObjectIndex, Vec<(ObjectIndex, String)>> = HashMap::new();
//     let mut symmetric_rels: HashMap<
//         EventOrObjectIndex,
//         HashSet<(EventOrObjectIndex, bool, String)>,
//     > = HashMap::new();
//     let mut types_rel_counts: HashMap<EventOrObjectType, usize> = HashMap::new();
//     for (e_index_usize, e) in ocel.events.iter().enumerate() {
//         let e_index = EventOrObjectIndex::Event(EventIndex(e_index_usize));
//         for r in e.relationships.iter() {
//             if let Some(object_index) = object_index_map.get(&r.object_id) {
//                 let o2_index = EventOrObjectIndex::Object(*object_index);
//                 symmetric_rels.entry(e_index).or_default().insert((
//                     o2_index,
//                     false,
//                     r.qualifier.clone(),
//                 ));
//                 symmetric_rels.entry(o2_index).or_default().insert((
//                     e_index,
//                     true,
//                     r.qualifier.clone(),
//                 ));
//                 rels.entry(e_index)
//                     .or_default()
//                     .push((*object_index, r.qualifier.clone()));
//                 *types_rel_counts
//                     .entry(EventOrObjectType::Event(e.event_type.clone()))
//                     .or_default() += 1;
//                 *types_rel_counts
//                     .entry(EventOrObjectType::Object(
//                         ocel.objects[object_index.0].object_type.clone(),
//                     ))
//                     .or_default() += 1;
//             }
//         }
//     }
//     for (o_index_usize, o) in ocel.objects.iter().enumerate() {
//         let o_index = EventOrObjectIndex::Object(ObjectIndex(o_index_usize));
//         for r in o.relationships.iter() {
//             if let Some(object_index) = object_index_map.get(&r.object_id) {
//                 let o2_index = EventOrObjectIndex::Object(*object_index);
//                 symmetric_rels.entry(o_index).or_default().insert((
//                     o2_index,
//                     false,
//                     r.qualifier.clone(),
//                 ));
//                 symmetric_rels.entry(o2_index).or_default().insert((
//                     o_index,
//                     true,
//                     r.qualifier.clone(),
//                 ));
//                 rels.entry(o_index)
//                     .or_default()
//                     .push((*object_index, r.qualifier.clone()));
//                 *types_rel_counts
//                     .entry(EventOrObjectType::Object(o.object_type.clone()))
//                     .or_default() += 1;
//                 *types_rel_counts
//                     .entry(EventOrObjectType::Object(
//                         ocel.objects[object_index.0].object_type.clone(),
//                     ))
//                     .or_default() += 1;
//             }
//         }
//     }
//     let avg_rels_of_type_per_type = types_rel_counts
//         .into_iter()
//         .map(|(t, count)| {
//             let n = match &t {
//                 EventOrObjectType::Event(et1) => {
//                     events_of_type.get(et1).map(|e| e.len()).unwrap_or_default()
//                 }
//                 EventOrObjectType::Object(ot1) => objects_of_type
//                     .get(ot1)
//                     .map(|o| o.len())
//                     .unwrap_or_default(),
//             };

//             (t, count as f32 / n as f32)
//         })
//         .collect();
//     println!("Linking OCEL took {:?}", now.elapsed());
//     LegacyIndexLinkedOCEL {
//         events_of_type,
//         objects_of_type,
//         object_events_map,
//         object_rels_per_type,
//         ocel,
//         event_index_map,
//         object_index_map,
//         rels,
//         symmetric_rels,
//         avg_rels_of_type_per_type,
//     }
// }
