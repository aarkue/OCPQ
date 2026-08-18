//! Binding-box queries: evaluation, constraint discovery, the bindings table, OCEL filtering and
//! the SQL translation.
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
    table_export::{
        export_bindings_to_table_writer, CellContent, CellType, TableExportOptions, TableWriter,
    },
};
use process_mining::bindings::register_binding;
use process_mining::core::event_data::object_centric::linked_ocel::{LinkedOCELAccess, SlimLinkedOCEL};
use process_mining::core::event_data::object_centric::{OCELAttributeType, OCELAttributeValue};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Monotonic across one process, so a client paging an evaluation it no longer holds gets a clear
/// "stale eval_version" rather than rows from a different run that happens to reuse the handle id.
static EVAL_VERSION: AtomicU64 = AtomicU64::new(0);

/// Evaluate `tree` and keep the result, returning it as a registry handle.
///
/// A handle rather than a value: the situations of a large tree run to millions of rows and the
/// frontend reads one page at a time. Ask [`eval_summary`] for the counts and [`eval_results_page`]
/// for the rows.
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

/// Whether `eval` was produced from `ocel`.
///
/// A binding holds indices that are only meaningful for the log they were produced from, so reading
/// them against a different one returns the wrong rows or panics. The two handles are resolved
/// independently and replacing the OCEL no longer drops the stored evaluation the way the
/// pre-binding server's `clear_eval_res` did, so every reader has to check for itself.
///
/// Element counts, not a recorded log identity: an evaluation carries no reference to its source,
/// and this is the same test the export has always applied.
fn same_ocel(eval: &EvaluateBoxTreeResult, ocel: &SlimLinkedOCEL) -> Result<(), String> {
    if eval.event_ids.len() != ocel.get_num_evs() || eval.object_ids.len() != ocel.get_num_obs() {
        return Err(
            "evaluation was produced from a different OCEL than the one given; re-run it"
                .to_string(),
        );
    }
    Ok(())
}

/// Per-node situation and violation counts of a stored evaluation, plus its `eval_version`.
///
/// Takes the OCEL only to refuse an evaluation of a different one: counts that belong to a log no
/// longer loaded are worse than an error, because the UI presents them as this log's.
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

/// One cell of an exported table, carrying the type the caller needs to write a typed spreadsheet
/// cell instead of guessing one back out of the text.
///
/// Untagged, so the common case -- ids, headers, empty cells, string attributes -- stays a bare JSON
/// string instead of growing a wrapper object per cell. The number and timestamp payloads are the
/// exact text the CSV export has always written, which both keeps that output unchanged and avoids a
/// lossy round trip: an `i64` past 2^53 does not survive being read back as a JSON number.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum TableCell {
    /// Written verbatim: anything with no numeric, boolean or temporal type.
    Text(String),
    /// A number, as its decimal text.
    Num { n: String },
    Bool { b: bool },
    /// An RFC 3339 timestamp.
    Time { d: String },
}

/// The situations of one evaluation node as a table.
///
/// The cell *roles* travel alongside the values, not inside them. Everything the old server-side
/// `XLSXTableWriter` needed to style a sheet is positional except two things -- which header cells
/// begin a variable's block, and which column holds the satisfied/violated flag -- so those are
/// carried once per table rather than tagged onto every cell. Without them a client can render the
/// values but not the formatting, which is how the XLSX export lost its header styling and its
/// green/red violation shading when the writer moved out of the backend.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct BindingsTable {
    /// One entry per row. The first row is the header unless `omit_header` was set.
    pub rows: Vec<Vec<TableCell>>,
    /// Per column of the header row: whether it begins a variable's block (an id column, a label or
    /// the satisfied flag) rather than continuing one (an attribute column). Empty when
    /// `omit_header` suppressed the header, since then there is no header row to style.
    pub header_group_starts: Vec<bool>,
    /// Column holding the satisfied flag, when `include_violation_status` wrote one. The flag itself
    /// is the cell's own text, so only its position has to be stated.
    pub violation_column: Option<usize>,
}

/// Lay out node `node_index` of a stored evaluation as a table of typed cells.
///
/// Takes the evaluation as a handle rather than a tree to re-evaluate: the caller is exporting
/// what it is already looking at, and a second evaluation could disagree with it.
///
/// `options.format` is ignored: the caller decides how to render the rows.
#[register_binding(stringify_error)]
pub fn export_bindings_table(
    ocel: &SlimLinkedOCEL,
    #[bind(handle)] eval: &EvaluateBoxTreeResult,
    node_index: usize,
    #[bind(default)] options: TableExportOptions,
) -> Result<BindingsTable, String> {
    same_ocel(eval, ocel)?;
    let node_res = eval
        .evaluation_results
        .get(node_index)
        .ok_or_else(|| format!("node_index {node_index} out of range"))?;
    let mut buf: Vec<u8> = Vec::new();
    export_bindings_to_table_writer(ocel, node_res, RowCollector::new(&mut buf), &options)
        .map_err(|e| e.to_string())?;
    // `export_bindings_to_table_writer` writes nothing at all for a node with no situations, so an
    // empty buffer is an empty table rather than a parse failure.
    if buf.is_empty() {
        return Ok(BindingsTable {
            rows: Vec::new(),
            header_group_starts: Vec::new(),
            violation_column: None,
        });
    }
    serde_json::from_slice(&buf).map_err(|e| e.to_string())
}

/// A `TableWriter` that keeps the cells instead of formatting a file. `save` consumes the writer,
/// so the collected rows leave through the writer they were handed, as JSON.
struct RowCollector<'a, W: std::io::Write> {
    rows: Vec<Vec<TableCell>>,
    row: Vec<TableCell>,
    /// `HEADER(bool)` positions of the header row, in order. Only filled while the first row is
    /// being written, and only if that row is a header at all.
    header_group_starts: Vec<bool>,
    violation_column: Option<usize>,
    out: &'a mut W,
}

impl<'a, W: std::io::Write> TableWriter<'a, W> for RowCollector<'a, W> {
    fn new(out: &'a mut W) -> Self {
        Self {
            rows: Vec::new(),
            row: Vec::new(),
            header_group_starts: Vec::new(),
            violation_column: None,
            out,
        }
    }

    fn write_cell<'b>(
        &mut self,
        s: impl Into<CellContent<'b>>,
        t: CellType,
    ) -> Result<(), anyhow::Error> {
        let content = s.into();
        let text = match &content {
            CellContent::String(s) => s.to_string(),
            CellContent::Value(v) => v.to_string(),
        };
        // Keep the two pieces of role information a client cannot infer from position or value.
        // `HEADER` only ever appears in the first row, so no row index has to be tracked.
        match t {
            CellType::HEADER(group_start) => self.header_group_starts.push(group_start),
            CellType::ViolationStatus(_) => self.violation_column = Some(self.row.len()),
            _ => {}
        }
        // A boolean is the one type whose value cannot be recovered from `text` without parsing it
        // back, so it is taken from the value; the rest keep their text and are only labelled.
        self.row.push(match (t, &content) {
            (
                CellType::ValueType(OCELAttributeType::Boolean),
                CellContent::Value(OCELAttributeValue::Boolean(b)),
            ) => TableCell::Bool { b: *b },
            (
                CellType::ValueType(OCELAttributeType::Integer | OCELAttributeType::Float),
                CellContent::Value(_),
            ) => TableCell::Num { n: text },
            (CellType::ValueType(OCELAttributeType::Time), CellContent::Value(_)) => {
                TableCell::Time { d: text }
            }
            _ => TableCell::Text(text),
        });
        Ok(())
    }

    fn new_row(&mut self) -> Result<(), anyhow::Error> {
        self.rows.push(std::mem::take(&mut self.row));
        Ok(())
    }

    fn save(self) -> Result<(), anyhow::Error> {
        serde_json::to_writer(
            self.out,
            &BindingsTable {
                rows: self.rows,
                header_group_starts: self.header_group_starts,
                violation_column: self.violation_column,
            },
        )?;
        Ok(())
    }
}

/// Filter the OCEL down to what the tree's INCLUDED/EXCLUDED labels select, and store the result.
///
/// Stored as a `SlimLinkedOCEL`, the kind the rest of the app works on, so the caller can export it
/// or keep using it without a follow-up link step.
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

/// The evaluation-handle lifecycle, driven through the real registry the way a transport does it:
/// `check_constraints_box` stores a result and returns its id, and the reader bindings take that
/// id back. Nothing here calls `ocpq_core` directly -- the point is the wiring (argument names,
/// handle storage, `#[bind(handle)]` resolution), not the evaluation.
#[cfg(test)]
mod tests {
    use process_mining::bindings::{call, get_fn_binding, AppState};
    use process_mining::core::event_data::object_centric::linked_ocel::SlimLinkedOCEL;
    use process_mining::OCEL;
    use serde_json::{json, Value};

    /// Two orders, each with one `place` event; only o1's is above the threshold the tree
    /// constrains, so every evaluation below has 2 situations of which 1 is violated. The order
    /// attributes cover one value of every type the table export distinguishes.
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

    /// The wire form of the tree, as the frontend sends it: one box binding an order and its
    /// `place` event, with `amount >= 10` as a constraint so the failing binding is reported
    /// rather than dropped.
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

        // ... and so does asking a real evaluation for a node it does not have.
        let handle = evaluate(&state);
        let err = invoke(
            &state,
            "app_bindings::query::export_bindings_table",
            json!({ "ocel": "ocel", "eval": handle, "node_index": 7 }),
        )
        .expect_err("node_index out of range");
        assert!(err.contains("out of range"), "got: {err}");
    }

    #[test]
    fn the_bindings_table_renders_the_situations_of_the_stored_evaluation() {
        let state = state();
        let handle = evaluate(&state);
        let table = invoke(
            &state,
            "app_bindings::query::export_bindings_table",
            json!({ "ocel": "ocel", "eval": handle, "node_index": 0 }),
        )
        .expect("table");
        let rows = table["rows"].as_array().expect("rows");
        assert_eq!(rows.len(), 3, "a header plus one row per situation");
        let flat: Vec<String> = rows
            .iter()
            .flat_map(|r| r.as_array().unwrap())
            .map(|c| c.as_str().unwrap_or_default().to_string())
            .collect();
        for id in ["o1", "o2", "e1", "e2"] {
            assert!(flat.iter().any(|c| c == id), "{id} missing from {flat:?}");
        }
    }

    /// The point of the typed cells: a caller writing a spreadsheet has to know a number from a
    /// timestamp from a label, and the text alone does not say which is which.
    #[test]
    fn the_bindings_table_tags_every_cell_with_the_type_of_the_value_behind_it() {
        let state = state();
        let handle = evaluate(&state);
        let table = invoke(
            &state,
            "app_bindings::query::export_bindings_table",
            json!({ "ocel": "ocel", "eval": handle, "node_index": 0 }),
        )
        .expect("table");
        let rows = table["rows"].as_array().expect("rows");

        // Attribute columns come out of a HashSet, so their order is not fixed: address them by
        // header instead of by position.
        let header: Vec<&str> = rows[0]
            .as_array()
            .expect("header row")
            .iter()
            .map(|c| c.as_str().expect("a header is always a text cell"))
            .collect();
        let cell = |row: &Value, column: &str| -> Value {
            let at = header
                .iter()
                .position(|h| *h == column)
                .unwrap_or_else(|| panic!("no {column} column in {header:?}"));
            row.as_array().expect("a row")[at].clone()
        };
        let row = rows[1..]
            .iter()
            .find(|r| cell(r, "o1") == json!("o1"))
            .expect("the situation binding o1");

        assert_eq!(cell(row, "o1.total"), json!({ "n": "12.5" }));
        assert_eq!(cell(row, "e1.amount"), json!({ "n": "100" }));
        assert_eq!(cell(row, "o1.rush"), json!({ "b": true }));
        assert_eq!(cell(row, "o1.due"), json!({ "d": "2024-03-04T05:06:07+00:00" }));
        assert_eq!(cell(row, "o1.region"), json!("eu"));
        // Ids, headers and the violation status are text: they are labels, not values.
        assert_eq!(cell(row, "e1"), json!("e1"));
        assert_eq!(cell(row, "Satisfied"), json!("true"));

        // A missing attribute stays an empty text cell rather than a typed hole.
        let violated = rows[1..]
            .iter()
            .find(|r| cell(r, "o1") == json!("o2"))
            .expect("the situation binding o2");
        assert_eq!(cell(violated, "o1.rush"), json!({ "b": false }));
        assert_eq!(cell(violated, "Satisfied"), json!("false"));
    }
}
