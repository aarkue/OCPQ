//! OCED path-schema analysis. Wraps `ocpq-core`'s bindings, not upstream's: these carry per-type
//! entity/equivalence-class counts and the `schema_detail` view the viewer needs, which upstream lacks.
use ocpq_core::path_schemas::{
    discover_path_schemas, enumerate_path_schemas, path_type_graph, schema_detail,
    PathEnumerateOptions, PathSchemaDetail, PathSchemaDetailOptions, PathSchemaInfo,
    PathSchemaOptions, PathSchemaResult, PathTypeGraph,
};
use process_mining::bindings::register_binding;
use process_mining::core::event_data::object_centric::linked_ocel::SlimLinkedOCEL;

/// The OCEL type graph with per-type entity counts.
#[register_binding]
pub fn ocpq_path_schema_type_graph(ocel: &SlimLinkedOCEL) -> PathTypeGraph {
    path_type_graph(ocel)
}

/// Type-level enumeration of path schemas, without instance traversal.
#[register_binding]
pub fn ocpq_path_schema_enumerate(
    ocel: &SlimLinkedOCEL,
    options: PathEnumerateOptions,
) -> Vec<PathSchemaInfo> {
    enumerate_path_schemas(ocel, options)
}

/// Enumerate path schemas and compute their instance-level metrics.
#[register_binding]
pub fn ocpq_path_schema_discover(
    ocel: &SlimLinkedOCEL,
    options: PathSchemaOptions,
) -> PathSchemaResult {
    discover_path_schemas(ocel, options)
}

/// Connections, metrics, throughput and durations of a single schema under the given temporal
/// and event-selection options.
#[register_binding]
pub fn ocpq_path_schema_detail(
    ocel: &SlimLinkedOCEL,
    options: PathSchemaDetailOptions,
) -> Option<PathSchemaDetail> {
    schema_detail(ocel, options)
}
