//! Inspection of the loaded OCEL: type/attribute statistics, single event/object lookup and the
//! neighbourhood graph. Every binding takes the OCEL as a registry handle.
use ocpq_core::{
    element_lookup::{get_element_relations, search_elements, ElementRelations, ElementSearchHit},
    get_event_info, get_object_info, get_sample_ids,
    ocel_graph::{get_ocel_graph, OCELGraph, OCELGraphOptions},
    ocel_stats::{get_ocel_attribute_stats, AttrScope, OcelAttributeStats},
    EventWithIndex, IndexOrID, OCELInfo, OCELTypeStats, ObjectWithIndex, SampleIds,
};
use process_mining::bindings::register_binding;
use process_mining::core::event_data::object_centric::linked_ocel::SlimLinkedOCEL;

/// Type schemas, counts and the E2O/O2O qualifier structure of the OCEL.
#[register_binding]
pub fn ocel_info(ocel: &SlimLinkedOCEL) -> OCELInfo {
    ocel.into()
}

/// Number of events per event type and objects per object type.
#[register_binding]
pub fn ocel_stats(ocel: &SlimLinkedOCEL) -> OCELTypeStats {
    ocel.into()
}

/// Value distribution of one attribute, binned or top-k depending on its declared value type.
#[register_binding]
pub fn ocel_attribute_stats(
    ocel: &SlimLinkedOCEL,
    scope: AttrScope,
    type_name: String,
    attribute: String,
) -> OcelAttributeStats {
    get_ocel_attribute_stats(ocel, scope, &type_name, &attribute)
}

/// The first `limit` object and event ids, for id autocompletion. Capped at 1000.
#[register_binding]
pub fn ocel_sample_ids(ocel: &SlimLinkedOCEL, limit: usize) -> SampleIds {
    get_sample_ids(ocel, limit)
}

/// Events and objects whose id contains `query`, ignoring case. Exact and prefix matches come
/// first. Returns at most `min(limit, 1000)` hits.
#[register_binding]
pub fn ocel_search_elements(
    ocel: &SlimLinkedOCEL,
    query: String,
    limit: usize,
) -> Vec<ElementSearchHit> {
    search_elements(ocel, &query, limit.min(1000))
}

/// The objects an event or object relates to, and for an object also the objects and events
/// (oldest first) relating to it. Each list holds at most `min(limit, 1000)` entries and comes
/// with its full count. `None` when no element of that kind has this id.
#[register_binding]
pub fn ocel_element_relations(
    ocel: &SlimLinkedOCEL,
    is_object: bool,
    id: String,
    limit: usize,
) -> Option<ElementRelations> {
    get_element_relations(ocel, is_object, &id, limit.min(1000))
}

/// One object by id or by index, with the index it is stored under.
#[register_binding]
pub fn ocel_get_object(ocel: &SlimLinkedOCEL, specifier: IndexOrID) -> Option<ObjectWithIndex> {
    get_object_info(ocel, specifier)
}

/// One event by id or by index, with the index it is stored under.
#[register_binding]
pub fn ocel_get_event(ocel: &SlimLinkedOCEL, specifier: IndexOrID) -> Option<EventWithIndex> {
    get_event_info(ocel, specifier)
}

/// Breadth-first neighbourhood of one event or object, as nodes plus qualified links.
///
/// `None` when the root id names nothing in the OCEL.
#[register_binding]
pub fn ocel_graph(ocel: &SlimLinkedOCEL, options: OCELGraphOptions) -> Option<OCELGraph> {
    get_ocel_graph(ocel, options)
}
