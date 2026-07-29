//! HTTP/tauri-facing request and response shapes for running an extraction blueprint.
//!
//! These stay in OCPQ by design: they are API shapes, not library types. A request needs the
//! connections a blueprint's `source_id`s resolve to in addition to the blueprint itself, since
//! `process_mining`'s [`Blueprint`] deliberately carries no connection details of its own.

use std::collections::HashMap;

use process_mining::core::event_data::object_centric::extraction::{Blueprint, ExtractionReport};
use serde::{Deserialize, Serialize};

/// A blueprint plus the connections its `source_id`s resolve to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteExtractionRequest {
    pub blueprint: Blueprint,
    /// Maps each source id the blueprint's nodes name to a `dbcon` connection string
    /// (`postgres://...`, `sqlite:...`, or a bare path ending in `.csv`).
    pub connections: HashMap<String, String>,
}

/// What running a blueprint produced.
///
/// `ExtractionReport` derives `Serialize` but not `Deserialize` (some `ExtractionError`
/// variants carry `&'static str` fields), so this response only ever crosses the wire outbound.
#[derive(Debug, Clone, Serialize)]
pub struct ExecuteExtractionResponse {
    pub report: ExtractionReport,
}
