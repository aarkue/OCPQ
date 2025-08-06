use process_mining::{
    ocel::{
        linked_ocel::{IndexLinkedOCEL, LinkedOCELAccess},
        ocel_struct::{OCELEvent, OCELObject, OCELType},
    },
    OCEL,
};
use serde::{Deserialize, Serialize};

pub mod ocel_qualifiers {
    pub mod qualifiers;
}
pub mod binding_box;
pub mod constraints_2;
pub mod discovery;
pub mod ocel_graph;
pub mod preprocessing {
    pub mod linked_ocel;
    pub mod preprocess;
    pub mod tests;
}
pub mod cel;
pub mod table_export;

pub mod hpc_backend;

#[derive(Debug, Serialize, Deserialize)]
pub struct OCELInfo {
    pub num_objects: usize,
    pub num_events: usize,
    pub object_types: Vec<OCELType>,
    pub event_types: Vec<OCELType>,
    pub object_ids: Vec<String>,
    pub event_ids: Vec<String>,
}

impl From<&OCEL> for OCELInfo {
    fn from(val: &OCEL) -> Self {
        OCELInfo {
            num_objects: val.objects.len(),
            num_events: val.events.len(),
            object_types: val.object_types.clone(),
            event_types: val.event_types.clone(),
            event_ids: val.events.iter().map(|ev| ev.id.clone()).collect(),
            object_ids: val.objects.iter().map(|ob| ob.id.clone()).collect(),
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
