use std::{
    collections::{HashMap, HashSet},
    fs::File,
};

pub use process_mining;
use process_mining::{
    core::event_data::object_centric::{
        linked_ocel::{index_linked_ocel::EventIndex, LinkedOCELAccess, SlimLinkedOCEL},
        OCELEvent, OCELObject, OCELType,
    },
    Importable, OCEL,
};
use serde::{Deserialize, Serialize};

use crate::binding_box::evaluate_box_tree;

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
            num_objects: val.get_all_obs_ref().count(),
            num_events: val.get_all_evs_ref().count(),
            object_types: val
                .get_ob_types()
                .map(|ot| val.get_ob_type(ot).clone())
                .collect(),
            event_types: val
                .get_ev_types()
                .map(|ot| val.get_ev_type(ot).clone())
                .collect(),
            event_ids: val
                .get_all_evs_ref()
                .map(|ev| val.get_ev_id(ev).to_string())
                .collect(),
            object_ids: val
                .get_all_obs_ref()
                .map(|ob| val.get_ob_id(ob).to_string())
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
            let ev = ocel.get_ev(&ev_index);
            Some((ev.into_owned(), ev_index.into_inner()))
        }
        IndexOrID::Index(index) => Some((ocel.get_ev(&index.into()).into_owned(), index)),
    };
    ev_with_index.map(|(event, index)| EventWithIndex { event, index })
}

pub fn get_object_info(ocel: &SlimLinkedOCEL, req: IndexOrID) -> Option<ObjectWithIndex> {
    let ob_with_index = match req {
        IndexOrID::ID(id) => {
            let ob_index = ocel.get_ob_by_id(id)?;
            let ev = ocel.get_ob(&ob_index);
            Some((ev.into_owned(), ob_index.into_inner()))
        }
        IndexOrID::Index(index) => Some((ocel.get_ob(&index.into()).into_owned(), index)),
    };
    ob_with_index.map(|(object, index)| ObjectWithIndex { object, index })
}

#[test]
fn test_perf() {
    let ocel =
        OCEL::import_from_path("/home/aarkue/dow/ocpq-refactor/order-management.json").unwrap();
    let locel = SlimLinkedOCEL::from_ocel(ocel);
    let tree =
        serde_json::from_reader(File::open("/home/aarkue/dow/ocpq-refactor/tree.json").unwrap())
            .unwrap();

    let res = evaluate_box_tree(tree, &locel, true);
    println!("DONE");
}
