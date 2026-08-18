//! OC-DECLARE: discovery, conformance and the statistics the editor shows next to an arc.
use ocpq_core::oc_declare::statistics::{
    get_activity_statistics, get_edge_stats, ActivityStatistics, BinnedEdgeDurationStats,
};
use process_mining::bindings::register_binding;
use process_mining::core::event_data::object_centric::linked_ocel::SlimLinkedOCEL;
use process_mining::core::process_models::object_centric::oc_declare::OCDeclareArc;
use process_mining::discovery::object_centric::oc_declare::{
    discover_behavior_constraints, project_oc_arcs, OCDeclareDiscoveryOptions,
    OCDeclareReductionMode,
};
use std::collections::HashSet;

/// Discover OC-DECLARE constraint arcs from the OCEL.
#[register_binding]
pub fn oc_declare_discover(
    ocel: &SlimLinkedOCEL,
    #[bind(default)] options: OCDeclareDiscoveryOptions,
) -> Vec<OCDeclareArc> {
    discover_behavior_constraints(ocel, options)
}

/// Violated fraction of each arc, from 0.0 (every source event satisfies it) to 1.0 (none does).
///
/// The violated fraction, not conformance: the editor renders this value directly as an arc's
/// violation percentage and colours it against violation thresholds. Upstream's
/// `oc_declare_conformance` is `1.0 - violation_fraction`, so returning that inverts every badge.
#[register_binding]
pub fn oc_declare_evaluate_arcs(ocel: &SlimLinkedOCEL, arcs: Vec<OCDeclareArc>) -> Vec<f64> {
    arcs.iter().map(|arc| arc.violation_fraction(ocel)).collect()
}

/// Project arcs onto a subset of activities, folding constraints that reach a survivor through
/// removed activities into the survivor.
#[register_binding]
pub fn oc_declare_project_arcs(
    arcs: Vec<OCDeclareArc>,
    activities: Vec<String>,
    #[bind(default = OCDeclareReductionMode::Lossless)] reduction: OCDeclareReductionMode,
) -> Vec<OCDeclareArc> {
    let activities: HashSet<String> = activities.into_iter().collect();
    project_oc_arcs(arcs, &activities, reduction)
}

/// The arcs in OC-DECLARE template notation, one per line.
#[register_binding]
pub fn oc_declare_template_string(arcs: Vec<OCDeclareArc>) -> String {
    arcs.iter()
        .map(|arc| arc.as_template_string())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Per object type: events of `activity` per object, and objects per event of `activity`.
#[register_binding]
pub fn oc_declare_activity_statistics(
    ocel: &SlimLinkedOCEL,
    activity: String,
) -> ActivityStatistics {
    get_activity_statistics(ocel, &activity)
}

/// Binned durations between the source and target events of one arc.
#[register_binding]
pub fn oc_declare_edge_statistics(
    ocel: &SlimLinkedOCEL,
    arc: OCDeclareArc,
) -> BinnedEdgeDurationStats {
    get_edge_stats(ocel, &arc)
}
