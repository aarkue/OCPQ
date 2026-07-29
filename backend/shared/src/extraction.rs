//! Relational-to-OCEL extraction.
//!
//! The blueprint model, validation, SQL compiler and row-by-row extractor all live in
//! `process_mining::core::event_data::object_centric::extraction`; this module adds the
//! `dbcon`-connection glue a caller running against real sources needs -- resolving a
//! `HashMap<source_id, connection_string>` into a discovered [`ExtractionCatalog`] and a set of
//! open [`DbconRowProvider`]s, then handing both to [`extract`] -- plus the request/response
//! shapes the web-server and tauri call sites carry over their own API boundary.
//!
//! [`ExecuteExtractionRequest`]/[`ExecuteExtractionResponse`] stay here by design: they are API
//! shapes, not library types. A request needs the connections a blueprint's `source_id`s resolve
//! to in addition to the blueprint itself, since [`Blueprint`] deliberately carries no connection
//! details of its own.

use std::collections::HashMap;

use process_mining::core::event_data::object_centric::extraction::{
    discover_catalog, extract, DbconProviderError, DbconRowProvider, ExtractionCatalog,
    ExtractionError, ExtractionReport, RowProvider, SlimOcelSink,
};
use process_mining::core::event_data::object_centric::linked_ocel::SlimLinkedOCEL;
use serde::{Deserialize, Serialize};

pub use process_mining::core::event_data::object_centric::extraction::Blueprint;

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

/// Failure discovering a catalog, connecting to a source, or running an extraction against one.
#[derive(Debug)]
pub enum ExtractionRunError {
    /// A blueprint node, or a direct call, named a `source_id` with no entry in `connections`.
    UnknownSource(String),
    /// Connecting to a source, or discovering its schema, failed.
    Connect(DbconProviderError),
    /// The extraction itself failed.
    Extract(ExtractionError),
}

impl std::fmt::Display for ExtractionRunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownSource(id) => write!(f, "no connection given for source '{id}'"),
            Self::Connect(e) => write!(f, "{e}"),
            Self::Extract(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for ExtractionRunError {}

impl From<DbconProviderError> for ExtractionRunError {
    fn from(e: DbconProviderError) -> Self {
        Self::Connect(e)
    }
}

impl From<ExtractionError> for ExtractionRunError {
    fn from(e: ExtractionError) -> Self {
        Self::Extract(e)
    }
}

/// Discover the schema of every source in `connections` and merge the results into one
/// [`ExtractionCatalog`], keyed by the same source ids.
fn discover_catalog_from_connections(
    connections: &HashMap<String, String>,
) -> Result<ExtractionCatalog, ExtractionRunError> {
    let mut catalog = ExtractionCatalog::new();
    for (source_id, connection_string) in connections {
        let discovered = discover_catalog(source_id, connection_string)?;
        catalog.tables.extend(discovered.tables);
        catalog.domains.extend(discovered.domains);
    }
    Ok(catalog)
}

/// Open a fast, non-discovering connection for every entry in `connections`, keyed the same way.
fn open_providers(
    connections: &HashMap<String, String>,
) -> Result<HashMap<String, DbconRowProvider>, ExtractionRunError> {
    let mut providers = HashMap::with_capacity(connections.len());
    for (source_id, connection_string) in connections {
        providers.insert(
            source_id.clone(),
            DbconRowProvider::connect(source_id, connection_string)?,
        );
    }
    Ok(providers)
}

/// Discover `connections`' schema, open a provider for each, and run `blueprint` into an
/// in-memory [`SlimLinkedOCEL`], returning it alongside the [`ExtractionReport`].
///
/// This is synchronous, not `async`: it blocks the calling thread for as long as discovery and
/// extraction take. A caller running inside an async runtime (an axum handler, a tauri command)
/// **must** wrap the call in `tokio::task::spawn_blocking` (or `tauri::async_runtime::spawn_blocking`)
/// -- see the module docs on `process_mining`'s `dbcon_provider` for why calling it directly from
/// an async context panics.
///
/// # Errors
/// Returns [`ExtractionRunError`] if connecting to or discovering a source fails, or if the
/// extraction itself fails.
pub fn execute_extraction_slim_with_dbcon(
    blueprint: &Blueprint,
    connections: &HashMap<String, String>,
) -> Result<(SlimLinkedOCEL, ExtractionReport), ExtractionRunError> {
    let catalog = discover_catalog_from_connections(connections)?;
    let providers = open_providers(connections)?;
    let provider_refs: HashMap<String, &dyn RowProvider> = providers
        .iter()
        .map(|(source_id, provider)| (source_id.clone(), provider as &dyn RowProvider))
        .collect();
    let mut sink = SlimOcelSink::new();
    let report = extract(blueprint, &catalog, &provider_refs, &mut sink)?;
    Ok((sink.into_ocel(), report))
}
