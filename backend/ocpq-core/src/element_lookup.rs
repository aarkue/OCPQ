//! Search events and objects by id, and list the relations of one of them.
use chrono::{DateTime, FixedOffset};
use process_mining::core::event_data::object_centric::linked_ocel::{
    slim_linked_ocel::ObjectIndex, LinkedOCELAccess, SlimLinkedOCEL,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ElementSearchHit {
    pub id: String,
    pub is_event: bool,
    pub type_name: String,
}

/// Case-insensitive id search over objects and events. Exact matches come first, then prefix
/// matches, then other substring matches. Within each group, objects come before events, both in
/// OCEL order. A blank query finds nothing.
pub fn search_elements(ocel: &SlimLinkedOCEL, query: &str, limit: usize) -> Vec<ElementSearchHit> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() || limit == 0 {
        return Vec::new();
    }
    let mut ranked: [Vec<ElementSearchHit>; 3] = Default::default();
    let mut consider = |id: &str, is_event: bool, type_name: &str| {
        let lower = id.to_lowercase();
        let rank = if lower == needle {
            0
        } else if lower.starts_with(&needle) {
            1
        } else if lower.contains(&needle) {
            2
        } else {
            return;
        };
        if ranked[rank].len() < limit {
            ranked[rank].push(ElementSearchHit {
                id: id.to_string(),
                is_event,
                type_name: type_name.to_string(),
            });
        }
    };
    for ob in ocel.get_all_obs() {
        consider(ocel.get_ob_id(ob), false, ocel.get_ob_type_of(ob));
    }
    for ev in ocel.get_all_evs() {
        consider(ocel.get_ev_id(ev), true, ocel.get_ev_type_of(ev));
    }
    ranked.into_iter().flatten().take(limit).collect()
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct RelatedElement {
    pub id: String,
    pub type_name: String,
    pub qualifier: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct RelatedEvent {
    pub id: String,
    pub type_name: String,
    pub qualifier: String,
    pub time: DateTime<FixedOffset>,
}

/// The relations of one event or object. Each list holds at most `limit` entries. The `num_`
/// fields count all of them.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct ElementRelations {
    /// Objects the element relates to through E2O (for an event) or O2O (for an object), in OCEL
    /// order.
    pub objects: Vec<RelatedElement>,
    pub num_objects: usize,
    /// Objects relating to this object through O2O. Empty for an event.
    pub incoming_objects: Vec<RelatedElement>,
    pub num_incoming_objects: usize,
    /// Events relating to this object through E2O, oldest first. Empty for an event.
    pub events: Vec<RelatedEvent>,
    pub num_events: usize,
}

fn related_objects<'a>(
    ocel: &'a SlimLinkedOCEL,
    rels: impl Iterator<Item = (&'a str, &'a ObjectIndex)>,
    limit: usize,
) -> (Vec<RelatedElement>, usize) {
    let mut listed = Vec::new();
    let mut total = 0;
    for (q, ob) in rels {
        total += 1;
        if listed.len() < limit {
            listed.push(RelatedElement {
                id: ocel.get_ob_id(ob).to_string(),
                type_name: ocel.get_ob_type_of(ob).to_string(),
                qualifier: q.to_string(),
            });
        }
    }
    (listed, total)
}

/// The relations of the event or object with this id, with at most `limit` entries per list.
/// `None` when no element of that kind has this id.
pub fn get_element_relations(
    ocel: &SlimLinkedOCEL,
    is_object: bool,
    id: &str,
    limit: usize,
) -> Option<ElementRelations> {
    if !is_object {
        let ev = ocel.get_ev_by_id(id)?;
        let (objects, num_objects) = related_objects(ocel, ocel.get_e2o(ev), limit);
        return Some(ElementRelations {
            objects,
            num_objects,
            incoming_objects: Vec::new(),
            num_incoming_objects: 0,
            events: Vec::new(),
            num_events: 0,
        });
    }
    let ob = ocel.get_ob_by_id(id)?;
    let (objects, num_objects) = related_objects(ocel, ocel.get_o2o(ob), limit);
    let (incoming_objects, num_incoming_objects) =
        related_objects(ocel, ocel.get_o2o_rev(ob), limit);
    let mut events: Vec<_> = ocel.get_e2o_rev(ob).collect();
    let num_events = events.len();
    events.sort_by_key(|(_, ev)| ocel.get_ev_time(*ev));
    let events = events
        .into_iter()
        .take(limit)
        .map(|(q, ev)| RelatedEvent {
            id: ocel.get_ev_id(ev).to_string(),
            type_name: ocel.get_ev_type_of(ev).to_string(),
            qualifier: q.to_string(),
            time: *ocel.get_ev_time(ev),
        })
        .collect();
    Some(ElementRelations {
        objects,
        num_objects,
        incoming_objects,
        num_incoming_objects,
        events,
        num_events,
    })
}
