//! Webserver target: runs OCPQ in an axum process and serves the frontend over HTTP. The API
//! mirrors the wasm exports and the tauri commands one-to-one, so `BackendProviderContext` speaks
//! one protocol to all three.

ocpq_core::use_mimalloc!();

use std::convert::Infallible;
use std::str::FromStr;
use std::sync::{Arc, RwLock};

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, StatusCode},
    response::sse::{Event, KeepAlive, Sse},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

use backend_shared::process_mining::bindings::RegistryItemKind;
use backend_shared::{Backend, ExtendedAppState};
use ocpq_native::hpc_backend::{
    get_job_status, job_is_over, login_on_hpc, start_port_forwarding, submit_hpc_job, Client,
    ConnectionConfig, JobForwards, JobStatus, OCPQJobOptions,
};

// Force-link the app-bindings crate so its registry entries are included: `extern crate` alone is
// a side-effect link that an optimising build drops, so the `#[used]` reference to a real symbol
// pulls it in.
extern crate app_bindings;
#[used]
static _FORCE_LINK_APP_BINDINGS: fn() -> String = app_bindings::app_ping;

/// Where `/ocel/available` looks for logs to offer, and what `/ocel/load-local` loads from. A
/// development convenience for a checkout with sample logs next to it, not part of the protocol.
const DATA_PATH: &str = "../data/";

/// `/api` runs any registered binding with no auth, so `*` would let any open tab drive the backend.
/// Same-origin builds need no CORS; `OCPQ_ALLOWED_ORIGINS` sets exact origins for other deployments.
fn cors_layer() -> CorsLayer {
    let configured: Option<Vec<String>> = std::env::var("OCPQ_ALLOWED_ORIGINS").ok().map(|v| {
        v.split(',')
            .map(|o| o.trim().to_string())
            .filter(|o| !o.is_empty())
            .collect()
    });
    let allow = match configured {
        Some(list) if !list.is_empty() => AllowOrigin::predicate(move |origin, _| {
            origin.to_str().is_ok_and(|o| list.iter().any(|a| a == o))
        }),
        // Any port, so `vite dev` and a forwarded HPC port both work without being enumerated; the
        // host is pinned to loopback, which is what keeps a remote page out.
        _ => AllowOrigin::predicate(|origin, _| {
            origin.to_str().is_ok_and(|o| {
                o.strip_prefix("http://")
                    .map(|rest| rest.split(':').next().unwrap_or(rest))
                    .is_some_and(|host| {
                        host == "localhost" || host == "127.0.0.1" || host == "[::1]"
                    })
            })
        }),
    };
    CorsLayer::new()
        .allow_origin(allow)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any)
}

#[derive(Clone)]
struct WebBackend {
    state: Arc<ExtendedAppState>,
    /// Engine events fanned out to connected SSE clients as `(event name, JSON payload)`.
    events: broadcast::Sender<(String, String)>,
    /// The HPC session, and the port forwards opened for jobs submitted through it.
    hpc_client: Arc<RwLock<Option<Client>>>,
    hpc_jobs: Arc<JobForwards>,
}

impl Default for WebBackend {
    fn default() -> Self {
        let (events, _) = broadcast::channel(256);
        Self {
            state: Arc::new(ExtendedAppState::default()),
            events,
            hpc_client: Arc::new(RwLock::new(None)),
            hpc_jobs: Arc::new(JobForwards::default()),
        }
    }
}

impl Backend for WebBackend {
    fn get_state(&self) -> &ExtendedAppState {
        &self.state
    }
    fn emit<S: Serialize + Clone>(&self, name: &str, data: S) -> Result<(), String> {
        let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
        // Best-effort: zero connected SSE clients (no subscribers) is not an error.
        let _ = self.events.send((name.to_string(), json));
        Ok(())
    }
}

/// Map a backend `Result<_, String>` error to a status code from the message, since
/// `backend_shared` only ever returns a `String`: "not found"/"not loaded" means the requested
/// OCEL, artifact or object is missing (404), "unknown ..."/"invalid ..." means the request itself
/// was malformed (400), anything else is a genuine server fault (500).
fn err(e: String) -> (StatusCode, String) {
    let lower = e.to_lowercase();
    let status = if lower.contains("not found") || lower.contains("not loaded") {
        StatusCode::NOT_FOUND
    } else if lower.starts_with("unknown") || lower.contains("invalid") {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    };
    (status, e)
}

#[derive(Deserialize)]
struct CallReq {
    id: String,
    args: Value,
    #[serde(default)]
    output_name: Option<String>,
}

/// The one route every binding is reached through. `execute_binding` is synchronous CPU work (and
/// the `dbcon`-backed extraction bindings own a runtime of their own), so it goes to the blocking
/// pool rather than stalling a reactor thread.
async fn call(
    State(b): State<WebBackend>,
    Json(req): Json<CallReq>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let bytes = tokio::task::spawn_blocking(move || {
        backend_shared::execute_binding(&b, &req.id, &req.args, req.output_name.as_deref())
    })
    .await
    .map_err(|e| err(e.to_string()))?
    .map_err(err)?;
    Ok(([(header::CONTENT_TYPE, "application/json")], bytes))
}

async fn functions() -> impl IntoResponse {
    Json(backend_shared::list_functions())
}

async fn item_kinds() -> Result<impl IntoResponse, (StatusCode, String)> {
    Ok(Json(backend_shared::get_all_item_kinds().map_err(err)?))
}

async fn objects(State(b): State<WebBackend>) -> Result<impl IntoResponse, (StatusCode, String)> {
    Ok(Json(
        backend_shared::get_objects_with_type(&b).map_err(err)?,
    ))
}

#[derive(Deserialize)]
struct SetLabelParams {
    id: String,
    label: Option<String>,
}

async fn set_label(
    State(b): State<WebBackend>,
    Query(p): Query<SetLabelParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    backend_shared::set_object_label(&b, p.id, p.label).map_err(err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct RenameParams {
    from: String,
    to: String,
}

async fn rename(
    State(b): State<WebBackend>,
    Query(p): Query<RenameParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    backend_shared::rename_object(&b, &p.from, &p.to).map_err(err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct LoadParams {
    id: String,
    kind: String,
    format: String,
}

async fn load(
    State(b): State<WebBackend>,
    Query(p): Query<LoadParams>,
    data: Bytes,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let kind = RegistryItemKind::from_str(&p.kind).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            format!("Unknown item kind: {}", p.kind),
        )
    })?;
    tokio::task::spawn_blocking(move || {
        backend_shared::load_item_bytes(&b, p.id, &kind, &data, &p.format)
    })
    .await
    .map_err(|e| err(e.to_string()))?
    .map_err(err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ExportParams {
    name: String,
    format: String,
}

async fn export(
    State(b): State<WebBackend>,
    Query(p): Query<ExportParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let bytes =
        tokio::task::spawn_blocking(move || backend_shared::export_object(&b, &p.name, &p.format))
            .await
            .map_err(|e| err(e.to_string()))?
            .map_err(err)?;
    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], bytes))
}

#[derive(Deserialize)]
struct UnloadParams {
    name: String,
}

async fn unload(
    State(b): State<WebBackend>,
    Query(p): Query<UnloadParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    backend_shared::unload_object(&b, p.name).map_err(err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct LoadArtifactParams {
    id: String,
    kind: String,
    format: String,
}

async fn load_artifact(
    State(b): State<WebBackend>,
    Query(p): Query<LoadArtifactParams>,
    data: Bytes,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    tokio::task::spawn_blocking(move || {
        backend_shared::load_artifact_bytes(&b, p.id, &p.kind, &data, &p.format)
    })
    .await
    .map_err(|e| err(e.to_string()))?
    .map_err(err)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn artifacts(State(b): State<WebBackend>) -> Result<impl IntoResponse, (StatusCode, String)> {
    Ok(Json(backend_shared::list_artifacts(&b).map_err(err)?))
}

#[derive(Deserialize)]
struct ArtifactParams {
    id: String,
}

async fn artifact(
    State(b): State<WebBackend>,
    Query(p): Query<ArtifactParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    Ok(Json(backend_shared::get_artifact(&b, &p.id).map_err(err)?))
}

async fn unload_artifact(
    State(b): State<WebBackend>,
    Query(p): Query<ArtifactParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    backend_shared::unload_artifact(&b, p.id).map_err(err)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ExportArtifactParams {
    id: String,
    format: String,
}

async fn export_artifact(
    State(b): State<WebBackend>,
    Query(p): Query<ExportArtifactParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let bytes =
        tokio::task::spawn_blocking(move || backend_shared::export_artifact(&b, &p.id, &p.format))
            .await
            .map_err(|e| err(e.to_string()))?
            .map_err(err)?;
    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], bytes))
}

#[derive(Deserialize)]
struct ExportBindingsTableBody {
    ocel_id: String,
    eval_id: String,
    node_index: usize,
    options: ocpq_core::table_export::TableExportOptions,
}

/// Exports the situations of one evaluation node to CSV/XLSX. Takes `options` as a JSON body since
/// it's a nested struct, unlike `/export`'s flat query params.
async fn export_bindings_table(
    State(b): State<WebBackend>,
    Json(body): Json<ExportBindingsTableBody>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let bytes = tokio::task::spawn_blocking(move || {
        backend_shared::export_bindings_table_file(
            &b,
            &body.ocel_id,
            &body.eval_id,
            body.node_index,
            &body.options,
        )
    })
    .await
    .map_err(|e| err(e.to_string()))?
    .map_err(err)?;
    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], bytes))
}

/// Server-Sent Events stream of engine events (`objects-changed`, `*-import-finished`, ...), so the
/// http transport live-reconciles like wasm and tauri. Each engine `emit` is forwarded as a named
/// SSE event.
async fn events(State(b): State<WebBackend>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = BroadcastStream::new(b.events.subscribe()).filter_map(|msg| {
        msg.ok()
            .map(|(name, json)| Ok(Event::default().event(name).data(json)))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// Logs sitting next to the checkout, offered so a developer can load one without an upload.
async fn available_local() -> Result<Json<Vec<String>>, (StatusCode, String)> {
    let mut names: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(DATA_PATH) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".json") || name.ends_with(".xml") || name.ends_with(".sqlite") {
                names.push(name);
            }
        }
    }
    names.sort();
    Ok(Json(names))
}

#[derive(Deserialize)]
struct LoadLocalParams {
    id: String,
    kind: String,
    name: String,
}

/// Load one of the logs `available_local` listed, by name rather than by upload.
async fn load_local(
    State(b): State<WebBackend>,
    Json(p): Json<LoadLocalParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // Reject anything that could escape the data directory: this takes a name, not a path.
    if p.name.contains('/') || p.name.contains('\\') || p.name.contains("..") {
        return Err((StatusCode::BAD_REQUEST, format!("Invalid name: {}", p.name)));
    }
    let kind = RegistryItemKind::from_str(&p.kind).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            format!("Unknown item kind: {}", p.kind),
        )
    })?;
    let path = format!("{DATA_PATH}{}", p.name);
    tokio::task::spawn_blocking(move || backend_shared::load_item_path(&b, p.id, &kind, &path))
        .await
        .map_err(|e| err(e.to_string()))?
        .map_err(err)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn hpc_login(
    State(b): State<WebBackend>,
    Json(cfg): Json<ConnectionConfig>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let client = login_on_hpc(&cfg)
        .await
        .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;
    *b.hpc_client.write().unwrap() = Some(client);
    Ok(StatusCode::NO_CONTENT)
}

async fn hpc_start(
    State(b): State<WebBackend>,
    Json(options): Json<OCPQJobOptions>,
) -> Result<Json<String>, (StatusCode, String)> {
    let client = b
        .hpc_client
        .read()
        .unwrap()
        .clone()
        .ok_or((StatusCode::UNAUTHORIZED, "Not logged in to HPC".to_string()))?;
    let port: u16 = options
        .port
        .parse()
        .map_err(|e: std::num::ParseIntError| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let client = Arc::new(client);
    let (_folder_id, job_id) = submit_hpc_job(Arc::clone(&client), options)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let forward = start_port_forwarding(
        client,
        &format!("127.0.0.1:{port}"),
        &format!("127.0.0.1:{port}"),
    )
    .await
    .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    b.hpc_jobs.insert(job_id.clone(), port, forward);
    Ok(Json(job_id))
}

async fn hpc_job_status(
    State(b): State<WebBackend>,
    Path(job_id): Path<String>,
) -> Result<Json<JobStatus>, (StatusCode, String)> {
    let client = b
        .hpc_client
        .read()
        .unwrap()
        .clone()
        .ok_or((StatusCode::UNAUTHORIZED, "Not logged in to HPC".to_string()))?;
    let status = get_job_status(Arc::new(client), job_id.clone())
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    // Polling this is the only signal either target gets that a job is done, so it is where the
    // forward is closed; otherwise the task keeps holding its local port for the process lifetime.
    if job_is_over(&status) {
        b.hpc_jobs.release(&job_id);
    }
    Ok(Json(status))
}

#[tokio::main]
async fn main() {
    let state = WebBackend::default();

    let api = Router::new()
        .route("/call", post(call))
        .route("/functions", get(functions))
        .route("/item-kinds", get(item_kinds))
        .route("/objects", get(objects))
        .route("/set-label", post(set_label))
        .route("/rename", post(rename))
        .route("/load", post(load).layer(DefaultBodyLimit::disable()))
        .route("/export", get(export))
        .route("/unload", post(unload))
        .route(
            "/load-artifact",
            post(load_artifact).layer(DefaultBodyLimit::disable()),
        )
        .route("/artifacts", get(artifacts))
        .route("/artifact", get(artifact))
        .route("/unload-artifact", post(unload_artifact))
        .route("/export-artifact", get(export_artifact))
        .route("/export-bindings-table", post(export_bindings_table))
        .route("/events", get(events))
        .route("/available-local", get(available_local))
        .route("/load-local", post(load_local))
        .route("/hpc/login", post(hpc_login))
        .route("/hpc/start", post(hpc_start))
        .route("/hpc/job-status/:job_id", get(hpc_job_status));

    // Built frontend assets. Overridable for deployment; defaults to the in-repo build output.
    let dist = std::env::var("OCPQ_DIST")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../../frontend/dist").into());
    let index = format!("{dist}/index.html");

    let app = Router::new()
        .nest("/api", api)
        // SPA: serve static files, falling back to index.html for client-side routes.
        .fallback_service(ServeDir::new(&dist).not_found_service(ServeFile::new(index)))
        .layer(cors_layer())
        .with_state(state);

    let port: u16 = std::env::var("OCPQ_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    // Loopback by default. `/api` is unauthenticated and `/call` runs any registered binding, so
    // reaching it from the network is opt-in via `OCPQ_BIND` rather than the default.
    let host = std::env::var("OCPQ_BIND").unwrap_or_else(|_| "127.0.0.1".to_string());
    let addr = format!("{host}:{port}");
    println!("ocpq webserver on http://{addr}  (serving {dist})");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
