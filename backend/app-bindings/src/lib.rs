//! Every OCPQ function the frontend can reach, as `#[register_binding]` wrappers over `ocpq-core`.
use process_mining::bindings::register_binding;

pub mod oc_declare;
pub mod ocel;
pub mod path_schemas;
pub mod query;

/// Health-check binding.
#[register_binding]
pub fn app_ping() -> String {
    "pong".to_string()
}

#[cfg(test)]
mod tests {
    use process_mining::bindings::list_functions_meta;

    #[test]
    fn ocpq_bindings_are_registered() {
        let ids: Vec<String> = list_functions_meta().into_iter().map(|m| m.id).collect();
        for expected in [
            "app_bindings::app_ping",
            "app_bindings::ocel::ocel_info",
            "app_bindings::ocel::ocel_stats",
            "app_bindings::ocel::ocel_attribute_stats",
            "app_bindings::ocel::ocel_sample_ids",
            "app_bindings::ocel::ocel_get_object",
            "app_bindings::ocel::ocel_get_event",
            "app_bindings::ocel::ocel_graph",
            "app_bindings::query::check_constraints_box",
            "app_bindings::query::discover_constraints",
            "app_bindings::query::export_filter_box",
            "app_bindings::query::create_db_query",
            "app_bindings::oc_declare::oc_declare_discover",
            "app_bindings::oc_declare::oc_declare_evaluate_arcs",
            "app_bindings::oc_declare::oc_declare_project_arcs",
            "app_bindings::oc_declare::oc_declare_template_string",
            "app_bindings::oc_declare::oc_declare_activity_statistics",
            "app_bindings::oc_declare::oc_declare_edge_statistics",
        ] {
            assert!(
                ids.iter().any(|id| id == expected),
                "binding {expected} must be registered"
            );
        }
    }
}
