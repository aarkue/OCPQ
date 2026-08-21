//! Binding-box queries: evaluation, constraint discovery, OCEL filtering and the SQL translation.
//! The bindings-table byte export lives in `backend_shared::export_bindings_table_file` instead.
use std::sync::atomic::{AtomicU64, Ordering};

use ocpq_core::{
    binding_box::{
        evaluate_box_tree, filter_ocel_box_tree, BindingBoxTree, EvalPageRequest, EvalPageResponse,
        EvaluateBoxTreeResult, EvaluateBoxTreeSummary,
    },
    db_translation::{translate_to_sql_shared, DBTranslationInput},
    discovery::{
        auto_discover_constraints_with_options, AutoDiscoverConstraintsRequest,
        AutoDiscoverConstraintsResponse,
    },
};
use process_mining::bindings::register_binding;
use process_mining::core::event_data::object_centric::linked_ocel::{LinkedOCELAccess, SlimLinkedOCEL};

/// Monotonic across one process, so a client paging an evaluation it no longer holds gets a clear
/// "stale eval_version" rather than rows from a different run that happens to reuse the handle id.
static EVAL_VERSION: AtomicU64 = AtomicU64::new(0);

/// Evaluate `tree` and store the result, returning a handle: a large tree's situations run to
/// millions of rows, so the frontend pages through [`eval_results_page`] instead of getting them all.
#[register_binding(stringify_error, returns_handle)]
pub fn check_constraints_box(
    ocel: &SlimLinkedOCEL,
    tree: BindingBoxTree,
    #[bind(default = false)] measure_performance: bool,
) -> Result<EvaluateBoxTreeResult, String> {
    let mut res = evaluate_box_tree(tree, ocel, measure_performance)?;
    res.eval_version = EVAL_VERSION.fetch_add(1, Ordering::SeqCst) + 1;
    Ok(res)
}

/// Whether `eval` was produced from `ocel`, checked by element counts since an evaluation carries no
/// reference to its source. An evaluation's indices are only meaningful for the log they came from.
fn same_ocel(eval: &EvaluateBoxTreeResult, ocel: &SlimLinkedOCEL) -> Result<(), String> {
    if eval.event_ids.len() != ocel.get_num_evs() || eval.object_ids.len() != ocel.get_num_obs() {
        return Err(
            "evaluation was produced from a different OCEL than the one given; re-run it"
                .to_string(),
        );
    }
    Ok(())
}

/// Per-node situation and violation counts of a stored evaluation, plus its `eval_version`. Takes
/// the OCEL only to refuse an evaluation of a different one.
#[register_binding(stringify_error)]
pub fn eval_summary(
    ocel: &SlimLinkedOCEL,
    #[bind(handle)] eval: &EvaluateBoxTreeResult,
) -> Result<EvaluateBoxTreeSummary, String> {
    same_ocel(eval, ocel)?;
    Ok(eval.summary())
}

/// One page of a stored evaluation's situations.
#[register_binding(stringify_error)]
pub fn eval_results_page(
    ocel: &SlimLinkedOCEL,
    #[bind(handle)] eval: &EvaluateBoxTreeResult,
    request: EvalPageRequest,
) -> Result<EvalPageResponse, String> {
    same_ocel(eval, ocel)?;
    eval.get_page(&request)
}

/// Discover count, eventually-follows and OR constraints, each as a named binding-box tree.
#[register_binding]
pub fn discover_constraints(
    ocel: &SlimLinkedOCEL,
    options: AutoDiscoverConstraintsRequest,
) -> AutoDiscoverConstraintsResponse {
    auto_discover_constraints_with_options(ocel, options)
}

/// Filter the OCEL down to what the tree's INCLUDED/EXCLUDED labels select, returned as a
/// `SlimLinkedOCEL` so the caller can keep using it without a follow-up link step.
#[register_binding(stringify_error)]
pub fn export_filter_box(
    ocel: &SlimLinkedOCEL,
    tree: BindingBoxTree,
) -> Result<SlimLinkedOCEL, String> {
    filter_ocel_box_tree(tree, ocel).map(SlimLinkedOCEL::from_ocel)
}

/// Translate a binding-box tree into a SQL query against the named tables.
#[register_binding]
pub fn create_db_query(input: DBTranslationInput) -> String {
    translate_to_sql_shared(input)
}

/// Tests the evaluation-handle wiring (argument names, handle storage, `#[bind(handle)]`
/// resolution) through the real registry, not `ocpq_core` itself.
#[cfg(test)]
mod tests {
    use process_mining::bindings::{call, get_fn_binding, AppState};
    use process_mining::core::event_data::object_centric::linked_ocel::SlimLinkedOCEL;
    use process_mining::OCEL;
    use serde_json::{json, Value};

    /// Two orders, each with one `place` event; only o1's is above the threshold the tree
    /// constrains, so every evaluation below has 2 situations of which 1 is violated.
    const OCEL_JSON: &str = r#"{
        "objectTypes": [{ "name": "order", "attributes": [
            { "name": "total", "type": "float" },
            { "name": "rush", "type": "boolean" },
            { "name": "due", "type": "time" },
            { "name": "region", "type": "string" }
        ] }],
        "eventTypes": [
            { "name": "place", "attributes": [{ "name": "amount", "type": "integer" }] }
        ],
        "objects": [
            { "id": "o1", "type": "order", "relationships": [], "attributes": [
                { "name": "total", "value": 12.5, "time": "1970-01-01T00:00:00Z" },
                { "name": "rush", "value": true, "time": "1970-01-01T00:00:00Z" },
                { "name": "due", "value": "2024-03-04T05:06:07Z", "time": "1970-01-01T00:00:00Z" },
                { "name": "region", "value": "eu", "time": "1970-01-01T00:00:00Z" }
            ] },
            { "id": "o2", "type": "order", "relationships": [], "attributes": [
                { "name": "total", "value": 3.0, "time": "1970-01-01T00:00:00Z" },
                { "name": "rush", "value": false, "time": "1970-01-01T00:00:00Z" },
                { "name": "due", "value": "2024-05-06T07:08:09Z", "time": "1970-01-01T00:00:00Z" }
            ] }
        ],
        "events": [
            { "id": "e1", "type": "place", "time": "2024-01-01T00:00:00Z",
              "attributes": [{ "name": "amount", "value": 100 }],
              "relationships": [{ "objectId": "o1", "qualifier": "order" }] },
            { "id": "e2", "type": "place", "time": "2024-01-02T00:00:00Z",
              "attributes": [{ "name": "amount", "value": 5 }],
              "relationships": [{ "objectId": "o2", "qualifier": "order" }] }
        ]
    }"#;

    /// The wire form of the tree: one box binding an order and its `place` event, constrained to
    /// `amount >= 10` so the failing binding is reported rather than dropped.
    fn tree() -> Value {
        json!({
            "nodes": [{ "Box": [{
                "newEventVars": { "0": ["place"] },
                "newObjectVars": { "0": ["order"] },
                "filters": [
                    { "type": "O2E", "object": 0, "event": 0, "qualifier": null,
                      "filterLabel": null }
                ],
                "sizeFilters": [],
                "constraints": [{ "type": "Filter", "filter": {
                    "type": "EventAttributeValueFilter",
                    "event": 0,
                    "attribute_name": "amount",
                    "value_filter": { "type": "Integer", "min": 10, "max": null }
                }}],
                "evVarLabels": {},
                "obVarLabels": {},
                "labels": []
            }, []]}],
            "edgeNames": []
        })
    }

    fn state() -> AppState {
        let state = AppState::default();
        let ocel: OCEL = serde_json::from_str(OCEL_JSON).expect("fixture OCEL parses");
        state.add("ocel", SlimLinkedOCEL::from_ocel(ocel));
        state
    }

    fn invoke(state: &AppState, id: &str, args: Value) -> Result<Value, String> {
        let binding = get_fn_binding(id).unwrap_or_else(|| panic!("{id} is not registered"));
        let bytes = call(binding, &args, state)?;
        Ok(serde_json::from_slice(&bytes).expect("binding output is JSON"))
    }

    fn evaluate(state: &AppState) -> String {
        invoke(
            state,
            "app_bindings::query::check_constraints_box",
            json!({ "ocel": "ocel", "tree": tree() }),
        )
        .expect("evaluation succeeds")
        .as_str()
        .expect("a handle id")
        .to_string()
    }

    fn page(
        state: &AppState,
        handle: &str,
        version: u64,
        violated: Option<bool>,
    ) -> Result<Value, String> {
        invoke(
            state,
            "app_bindings::query::eval_results_page",
            json!({
                "ocel": "ocel",
                "eval": handle,
                "request": {
                    "evalVersion": version,
                    "nodeIndex": 0,
                    "offset": 0,
                    "limit": 10,
                    "violated": violated,
                }
            }),
        )
    }

    #[test]
    fn evaluating_stores_a_handle_the_reader_bindings_can_take_back() {
        let state = state();
        let before = state.items.read().unwrap().len();
        let handle = evaluate(&state);

        assert!(handle.starts_with("res_"), "got {handle}");
        assert!(state.contains_key(&handle));
        assert_eq!(
            state.items.read().unwrap().len(),
            before + 1,
            "exactly one new item: the evaluation, not a copy of the OCEL"
        );

        let summary = invoke(
            &state,
            "app_bindings::query::eval_summary",
            json!({ "ocel": "ocel", "eval": handle }),
        )
        .expect("summary");
        assert_eq!(summary["nodeSummaries"][0]["situationCount"], 2);
        assert_eq!(summary["nodeSummaries"][0]["situationViolatedCount"], 1);
        assert_eq!(summary["bindingsSkipped"], false);

        // The version is a process-wide counter, so its value is not fixed; what matters is that
        // it is the one a page request has to carry.
        let version = summary["evalVersion"].as_u64().expect("a version");
        assert!(version > 0, "the stored result must be versioned");

        let all = page(&state, &handle, version, None).expect("page");
        assert_eq!(all["filteredCount"], 2);
        assert_eq!(all["rows"].as_array().unwrap().len(), 2);

        let violated = page(&state, &handle, version, Some(true)).expect("violated page");
        assert_eq!(violated["filteredCount"], 1);
        let row = &violated["rows"][0];
        assert_eq!(row["objects"][0][1], "o2");
        assert_eq!(row["events"][0][1], "e2");
        assert!(!row["violation"].is_null());
    }

    #[test]
    fn a_page_request_carrying_another_evaluations_version_is_rejected() {
        // What the version exists for: a client that kept paging while a second evaluation ran
        // must be told its view is stale instead of being served rows from the wrong run.
        let state = state();
        let first = evaluate(&state);
        let second = evaluate(&state);
        assert_ne!(first, second, "each evaluation gets its own handle");

        let version_of = |handle: &str| {
            invoke(
                &state,
                "app_bindings::query::eval_summary",
                json!({ "ocel": "ocel", "eval": handle }),
            )
            .expect("summary")["evalVersion"]
                .as_u64()
                .expect("a version")
        };
        let (v1, v2) = (version_of(&first), version_of(&second));
        assert!(v2 > v1, "a new evaluation bumps the version ({v1} -> {v2})");

        let err = page(&state, &second, v1, None).expect_err("stale version must be rejected");
        assert!(err.contains("stale eval_version"), "got: {err}");
        // The handle itself is still usable with its own version.
        assert!(page(&state, &second, v2, None).is_ok());
    }

    #[test]
    fn reading_a_handle_that_does_not_exist_fails_instead_of_panicking() {
        let state = state();
        let err = invoke(
            &state,
            "app_bindings::query::eval_summary",
            json!({ "eval": "res_nope" }),
        )
        .expect_err("unknown handle");
        assert!(!err.is_empty());
    }
}
