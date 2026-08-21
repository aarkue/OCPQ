//! Inspection of the loaded OCEL: type/attribute statistics, single event/object lookup and the
//! neighbourhood graph. Every binding takes the OCEL as a registry handle.
use ocpq_core::{
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
