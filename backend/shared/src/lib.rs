use std::collections::{HashMap, HashSet};

pub use process_mining;
use process_mining::core::event_data::object_centric::{
    linked_ocel::{LinkedOCELAccess, SlimLinkedOCEL},
    OCELEvent, OCELObject, OCELType,
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
}
pub mod cel;
pub mod table_export;
pub mod oc_declare {
    pub mod statistics;
}

pub mod data_extraction;
pub mod data_source;
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

impl From<&SlimLinkedOCEL> for OCELInfo {
    fn from(val: &SlimLinkedOCEL) -> Self {
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

        for ob in val.get_all_obs() {
            let ob_type = val.get_ob_type_of(&ob);
            for (q, ev) in val.get_e2o_rev(&ob) {
                let ev_type = val.get_ev_type_of(ev);
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

            for (q, ob2) in val.get_o2o(&ob) {
                let ob2_type = val.get_ob_type_of(ob2);
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
            num_objects: val.get_num_obs(),
            num_events: val.get_num_evs(),
            object_types: val
                .get_ob_types()
                .flat_map(|ot| val.get_ob_type(ot).cloned())
                .collect(),
            event_types: val
                .get_ev_types()
                .flat_map(|ot| val.get_ev_type(ot).cloned())
                .collect(),
            event_ids: val
                .get_all_evs()
                .map(|ev| val.get_ev_id(&ev).to_string())
                .collect(),
            object_ids: val
                .get_all_obs()
                .map(|ob| val.get_ob_id(&ob).to_string())
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

pub fn get_event_info(ocel: &SlimLinkedOCEL, req: IndexOrID) -> Option<EventWithIndex> {
    let ev_with_index = match req {
        IndexOrID::ID(id) => {
            let ev_index = ocel.get_ev_by_id(id)?;
            let ev = ocel.get_full_ev(&ev_index);
            Some((ev.into_owned(), ev_index.into_inner()))
        }
        IndexOrID::Index(index) => Some((ocel.get_full_ev(&index.into()).into_owned(), index)),
    };
    ev_with_index.map(|(event, index)| EventWithIndex { event, index })
}

pub fn get_object_info(ocel: &SlimLinkedOCEL, req: IndexOrID) -> Option<ObjectWithIndex> {
    let ob_with_index = match req {
        IndexOrID::ID(id) => {
            let ob_index = ocel.get_ob_by_id(id)?;
            let ev = ocel.get_full_ob(&ob_index);
            Some((ev.into_owned(), ob_index.into_inner()))
        }
        IndexOrID::Index(index) => Some((ocel.get_full_ob(&index.into()).into_owned(), index)),
    };
    ob_with_index.map(|(object, index)| ObjectWithIndex { object, index })
}
