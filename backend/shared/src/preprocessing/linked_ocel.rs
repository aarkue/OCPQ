use process_mining::core::event_data::object_centric::{
    linked_ocel::{slim_linked_ocel::EventOrObjectIndex, LinkedOCELAccess, SlimLinkedOCEL},
    OCELEvent, OCELObject,
};
use serde::{Deserialize, Serialize};
pub fn event_or_object_from_index(
    index: EventOrObjectIndex,
    locel: &SlimLinkedOCEL,
) -> OCELNode {
    let ret = match index {
        EventOrObjectIndex::Event(event_index) => {
            OCELNode::Event(locel.get_full_ev(&event_index).into_owned())
        }
        EventOrObjectIndex::Object(object_index) => {
            OCELNode::Object(locel.get_full_ob(&object_index).into_owned())
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
