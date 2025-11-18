use std::collections::{HashMap, HashSet};

pub use process_mining;
use process_mining::ocel::{
    linked_ocel::{IndexLinkedOCEL, LinkedOCELAccess},
    ocel_struct::{OCELEvent, OCELObject, OCELType},
};
use serde::{Deserialize, Serialize};

pub mod ocel_qualifiers {
    pub mod qualifiers;
}
pub mod binding_box;
pub mod db_translation;
pub mod discovery;
pub mod ocel_graph;
pub mod trad_event_log;
pub mod preprocessing {
    pub mod linked_ocel;
    pub mod preprocess;
    pub mod tests;
}
pub mod cel;
pub mod table_export;
pub mod oc_declare {
    pub mod statistics;
}

pub mod hpc_backend;
#[derive(Debug, Serialize, Deserialize)]
pub struct OCELInfo {
    pub num_objects: usize,
    pub num_events: usize,
    pub object_types: Vec<OCELType>,
    pub event_types: Vec<OCELType>,
    pub object_ids: Vec<String>,
    pub event_ids: Vec<String>,
    pub e2o_types: HashMap<String, HashMap<String, (usize, HashSet<String>)>>,
    pub o2o_types: HashMap<String, HashMap<String, (usize, HashSet<String>)>>,
}

impl From<&IndexLinkedOCEL> for OCELInfo {
    fn from(val: &IndexLinkedOCEL) -> Self {
        let mut e2o_types: HashMap<String, HashMap<String, (usize, HashSet<String>)>> = val
            .get_ev_types()
            .map(|t| {
                (
                    t.to_string(),
                    val.get_ob_types()
                        .map(|ot| (ot.to_string(), (0, HashSet::default())))
                        .collect(),
                )
            })
            .collect();
        let mut o2o_types: HashMap<String, HashMap<String, (usize, HashSet<String>)>> = val
            .get_ob_types()
            .map(|t| {
                (
                    t.to_string(),
                    val.get_ob_types()
                        .map(|ot| (ot.to_string(), (0, HashSet::default())))
                        .collect(),
                )
            })
            .collect();

        for ob in val.get_all_obs_ref() {
            let ob_type = &val.get_ob(ob).object_type;
            for (q, ev) in val.get_e2o_rev(ob) {
                let ev_type = &val.get_ev(ev).event_type;
                let (ref mut count, ref mut qualifiers) = e2o_types
                    .get_mut(ev_type)
                    .unwrap()
                    .get_mut(ob_type)
                    .unwrap();
                *count += 1;
                if !qualifiers.contains(q) {
                    qualifiers.insert(q.to_string());
                }
            }

            for (q, ob2) in val.get_o2o(ob) {
                let ob2_type = &val.get_ob(ob2).object_type;
                let (ref mut count, ref mut qualifiers) = o2o_types
                    .get_mut(ob_type)
                    .unwrap()
                    .get_mut(ob2_type)
                    .unwrap();
                *count += 1;
                if !qualifiers.contains(q) {
                    qualifiers.insert(q.to_string());
                }
            }
        }

        OCELInfo {
            num_objects: val.get_ocel_ref().objects.len(),
            num_events: val.get_ocel_ref().events.len(),
            object_types: val.get_ocel_ref().object_types.clone(),
            event_types: val.get_ocel_ref().event_types.clone(),
            event_ids: val
                .get_ocel_ref()
                .events
                .iter()
                .map(|ev| ev.id.clone())
                .collect(),
            object_ids: val
                .get_ocel_ref()
                .objects
                .iter()
                .map(|ob| ob.id.clone())
                .collect(),
            e2o_types,
            o2o_types,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub enum IndexOrID {
    #[serde(rename = "id")]
    ID(String),
    #[serde(rename = "index")]
    Index(usize),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectWithIndex {
    pub object: OCELObject,
    pub index: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventWithIndex {
    pub event: OCELEvent,
    pub index: usize,
}

pub fn get_event_info(ocel: &IndexLinkedOCEL, req: IndexOrID) -> Option<EventWithIndex> {
    let ev_with_index = match req {
        IndexOrID::ID(id) => {
            let ev_index = ocel.get_ev_index(id)?;
            let ev = ocel.get_ev(&ev_index);
            Some((ev.clone(), ev_index.into_inner()))
        }
        IndexOrID::Index(index) => ocel
            .get_ocel_ref()
            .events
            .get(index)
            .cloned()
            .map(|ev| (ev, index)),
    };
    ev_with_index.map(|(event, index)| EventWithIndex { event, index })
}

pub fn get_object_info(ocel: &IndexLinkedOCEL, req: IndexOrID) -> Option<ObjectWithIndex> {
    let ob_with_index = match req {
        IndexOrID::ID(id) => {
            let ob_index = ocel.get_ob_index(id)?;
            let ev = ocel.get_ob(&ob_index);
            Some((ev.clone(), ob_index.into_inner()))
        }
        IndexOrID::Index(index) => ocel
            .get_ocel_ref()
            .objects
            .get(index)
            .cloned()
            .map(|ev| (ev, index)),
    };
    ob_with_index.map(|(object, index)| ObjectWithIndex { object, index })
}
