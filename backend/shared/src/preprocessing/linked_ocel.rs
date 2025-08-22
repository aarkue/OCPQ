use process_mining::{
    event_log::ocel::ocel_struct::{OCELEvent, OCELObject},
    ocel::linked_ocel::{index_linked_ocel::EventOrObjectIndex, IndexLinkedOCEL, LinkedOCELAccess},
};
use serde::{Deserialize, Serialize};
pub fn event_or_object_from_index<'a>(
    index: EventOrObjectIndex,
    locel: &'a IndexLinkedOCEL,
) -> OCELNodeRef<'a> {
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
