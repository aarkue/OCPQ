use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use itertools::Itertools;
use tokio::{net::TcpListener, task::JoinHandle};

use std::{
    collections::{HashMap, HashSet},
    env,
    io::Cursor,
    sync::{Arc, RwLock},
};

use ocpq_shared::{
    binding_box::{
        evaluate_box_tree, filter_ocel_box_tree, CheckWithBoxTreeRequest, EvaluateBoxTreeResult,
        ExportFormat, FilterExportWithBoxTreeRequest,
    },
    discovery::{
        auto_discover_constraints_with_options, AutoDiscoverConstraintsRequest,
        AutoDiscoverConstraintsResponse,
    },
    get_event_info, get_object_info,
    hpc_backend::{
        get_job_status, login_on_hpc, start_port_forwarding, submit_hpc_job, Client,
        ConnectionConfig, JobStatus, OCPQJobOptions,
    },
    ocel_graph::{get_ocel_graph, OCELGraph, OCELGraphOptions},
    ocel_qualifiers::qualifiers::{
        get_qualifiers_for_event_types, QualifierAndObjectType, QualifiersForEventType,
    },
    preprocessing::{linked_ocel::IndexLinkedOCEL, preprocess::link_ocel_info},
    table_export::{export_bindings_to_writer, TableExportOptions},
    EventWithIndex, IndexOrID, OCELInfo, ObjectWithIndex,
};
use process_mining::{
    event_log::ocel::ocel_struct::OCEL,
    export_ocel_json_to_vec, export_ocel_sqlite_to_vec, export_ocel_xml,
    import_ocel_sqlite_from_slice, import_ocel_xml_slice,
    ocel::ocel_struct::{OCELEvent, OCELObject},
};
use tower_http::cors::CorsLayer;

use crate::load_ocel::{
    get_available_ocels, load_ocel_file_req, load_ocel_file_to_state, DEFAULT_OCEL_FILE,
};
pub mod load_ocel;

#[derive(Clone, Default)]
pub struct AppState {
    ocel: Arc<RwLock<Option<IndexLinkedOCEL>>>,
    client: Arc<RwLock<Option<Client>>>,
    jobs: Arc<RwLock<Vec<(String, u16, JoinHandle<()>)>>>,
    eval_res: Arc<RwLock<Option<EvaluateBoxTreeResult>>>,
}

#[tokio::main]
async fn main() {
    let args = env::args().collect_vec();
    dbg!(args);
    let state = AppState::default();
    let cors = CorsLayer::permissive();
    // .allow_methods([Method::GET, Method::POST])
    // .allow_headers([CONTENT_TYPE])
    // .allow_origin(tower_http::cors::Any);

    load_ocel_file_to_state(DEFAULT_OCEL_FILE, &state);

    // build our application with a single route
    let app = Router::new()
        .route("/ocel/load", post(load_ocel_file_req))
        .route("/ocel/info", get(get_loaded_ocel_info))
        .route(
            "/ocel/upload-json",
            post(upload_ocel_json).layer(DefaultBodyLimit::disable()),
        )
        .route(
            "/ocel/upload-xml",
            post(upload_ocel_xml).layer(DefaultBodyLimit::disable()),
        )
        .route(
            "/ocel/upload-sqlite",
            post(upload_ocel_sqlite).layer(DefaultBodyLimit::disable()),
        )
        .route("/ocel/available", get(get_available_ocels))
        .route(
            "/ocel/event-qualifiers",
            get(get_qualifiers_for_event_types_handler),
        )
        .route(
            "/ocel/object-qualifiers",
            get(get_qualifers_for_object_types),
        )
        .route("/ocel/graph", post(ocel_graph_req))
        .route("/ocel/check-constraints-box", post(check_with_box_tree_req))
        .route(
            "/ocel/export-filter-box",
            post(filter_export_with_box_tree_req),
        )
        .route(
            "/ocel/discover-constraints",
            post(auto_discover_constraints_handler),
        )
        .route(
            "/ocel/export-bindings",
            post(export_bindings_table).layer(DefaultBodyLimit::disable()),
        )
        .route("/ocel/event/:event_id", get(get_event_info_req))
        .route("/ocel/object/:object_id", get(get_object_info_req))
        .route("/ocel/get-event", post(get_event_req))
        .route("/ocel/get-object", post(get_object_req))
        .route("/hpc/login", post(login_to_hpc_web))
        .route("/hpc/start", post(start_hpc_job_web))
        .route("/hpc/job-status/:job_id", get(get_hpc_job_status_web))
        .with_state(state)
        .route("/", get(|| async { "Hello, Aaron!" }))
        .layer(cors);
    // run it with hyper on localhost:3000
    let listener = TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();
}

async fn get_loaded_ocel_info(
    State(state): State<AppState>,
) -> (StatusCode, Json<Option<OCELInfo>>) {
    match with_ocel_from_state(&State(state), |ocel| (&ocel.ocel).into()) {
        Some(ocel_info) => (StatusCode::OK, Json(Some(ocel_info))),
        None => (StatusCode::NOT_FOUND, Json(None)),
    }
}

async fn upload_ocel_xml<'a>(
    State(state): State<AppState>,
    ocel_bytes: Bytes,
) -> (StatusCode, Json<OCELInfo>) {
    let ocel = import_ocel_xml_slice(&ocel_bytes);
    let mut x = state.ocel.write().unwrap();
    let ocel_info: OCELInfo = (&ocel).into();
    *x = Some(IndexLinkedOCEL::new(ocel));

    (StatusCode::OK, Json(ocel_info))
}

async fn upload_ocel_sqlite<'a>(
    State(state): State<AppState>,
    ocel_bytes: Bytes,
) -> (StatusCode, Json<OCELInfo>) {
    let ocel = import_ocel_sqlite_from_slice(&ocel_bytes).unwrap();
    let mut x: std::sync::RwLockWriteGuard<'_, Option<IndexLinkedOCEL>> =
        state.ocel.write().unwrap();
    let ocel_info: OCELInfo = (&ocel).into();
    *x = Some(IndexLinkedOCEL::new(ocel));

    (StatusCode::OK, Json(ocel_info))
}

async fn upload_ocel_json<'a>(
    State(state): State<AppState>,
    ocel_bytes: Bytes,
) -> (StatusCode, Json<OCELInfo>) {
    let ocel: OCEL = serde_json::from_slice(&ocel_bytes).unwrap();
    let mut x = state.ocel.write().unwrap();
    let ocel_info: OCELInfo = (&ocel).into();
    *x = Some(IndexLinkedOCEL::new(ocel));
    (StatusCode::OK, Json(ocel_info))
}

pub fn with_ocel_from_state<T, F>(State(state): &State<AppState>, f: F) -> Option<T>
where
    F: FnOnce(&IndexLinkedOCEL) -> T,
{
    let read_guard = state.ocel.read().ok()?;
    let ocel_ref = read_guard.as_ref()?;
    Some(f(ocel_ref))
}

pub async fn get_qualifiers_for_event_types_handler<'a>(
    State(state): State<AppState>,
) -> (
    StatusCode,
    Json<Option<HashMap<String, HashMap<String, QualifiersForEventType>>>>,
) {
    match with_ocel_from_state(
        &State(state),
        |ocel| -> HashMap<String, HashMap<String, QualifiersForEventType>> {
            get_qualifiers_for_event_types(&ocel.ocel)
        },
    ) {
        Some(x) => (StatusCode::OK, Json(Some(x))),
        None => (StatusCode::BAD_REQUEST, Json(None)),
    }
}

pub async fn get_qualifers_for_object_types<'a>(
    State(state): State<AppState>,
) -> (
    StatusCode,
    Json<Option<HashMap<String, HashSet<QualifierAndObjectType>>>>,
) {
    let qualifier_and_type = with_ocel_from_state(&State(state), |ocel| {
        link_ocel_info(&ocel.ocel).object_rels_per_type.clone()
    });
    match qualifier_and_type {
        Some(x) => (StatusCode::OK, Json(Some(x))),
        None => (StatusCode::BAD_REQUEST, Json(None)),
    }
}

pub async fn ocel_graph_req<'a>(
    State(state): State<AppState>,
    Json(options): Json<OCELGraphOptions>,
) -> (StatusCode, Json<Option<OCELGraph>>) {
    let graph = with_ocel_from_state(&State(state), |ocel| get_ocel_graph(ocel, options));
    match graph.flatten() {
        Some(x) => (StatusCode::OK, Json(Some(x))),
        None => (StatusCode::BAD_REQUEST, Json(None)),
    }
}

pub async fn check_with_box_tree_req<'a>(
    state: State<AppState>,
    Json(req): Json<CheckWithBoxTreeRequest>,
) -> (StatusCode, Json<Option<EvaluateBoxTreeResult>>) {
    let ocel_guard = state.ocel.read().unwrap();
    let ocel = ocel_guard.as_ref();
    if let Some(ocel) = ocel {
        let res = evaluate_box_tree(req.tree, ocel, req.measure_performance.unwrap_or(false));
        let res_to_ret = res.clone_first_few();
        let mut new_eval_res_state = state.eval_res.write().unwrap();
        *new_eval_res_state = Some(res);
        return (StatusCode::OK, Json(Some(res_to_ret)));
    }
    (StatusCode::INTERNAL_SERVER_ERROR, Json(None))
}

pub async fn filter_export_with_box_tree_req<'a>(
    state: State<AppState>,
    Json(req): Json<FilterExportWithBoxTreeRequest>,
) -> (StatusCode, Bytes) {
    with_ocel_from_state(&state, |ocel| {
        let res = filter_ocel_box_tree(req.tree, ocel).unwrap();
        let bytes = match req.export_format {
            ExportFormat::XML => {
                let inner = Vec::new();
                let mut w = Cursor::new(inner);
                export_ocel_xml(&mut w, &res).unwrap();
                Bytes::from(w.into_inner())
            }
            ExportFormat::JSON => {
                let res = export_ocel_json_to_vec(&res).unwrap();
                Bytes::from(res)
            }
            ExportFormat::SQLITE => {
                let res = export_ocel_sqlite_to_vec(&res).unwrap();
                Bytes::from(res)
            }
        };
        (StatusCode::OK, bytes)
    })
    .unwrap_or((StatusCode::INTERNAL_SERVER_ERROR, Bytes::default()))
}

pub async fn auto_discover_constraints_handler<'a>(
    state: State<AppState>,
    Json(req): Json<AutoDiscoverConstraintsRequest>,
) -> Json<Option<AutoDiscoverConstraintsResponse>> {
    Json(with_ocel_from_state(&state, |ocel| {
        auto_discover_constraints_with_options(ocel, req)
    }))
}

pub async fn export_bindings_table(
    state: State<AppState>,
    Json((node_index, table_options)): Json<(usize, TableExportOptions)>,
) -> (StatusCode, Bytes) {
    if let Some(ocel) = state.ocel.read().unwrap().as_ref() {
        if let Some(eval_res) = state.eval_res.read().unwrap().as_ref() {
            if let Some(node_eval_res) = eval_res.evaluation_results.get(node_index) {
                let inner = Vec::new();
                let mut w: Cursor<Vec<u8>> = Cursor::new(inner);
                export_bindings_to_writer(ocel, node_eval_res, &mut w, &table_options).unwrap();
                let b = Bytes::from(w.into_inner());
                return (StatusCode::OK, b);
            }
        }
    }
    (StatusCode::NOT_FOUND, Bytes::default())
}

pub async fn get_event_info_req<'a>(
    state: State<AppState>,
    Path(event_id): Path<String>,
) -> Json<Option<OCELEvent>> {
    Json(with_ocel_from_state(&state, |ocel| ocel.ev_by_id(&event_id).cloned()).unwrap_or_default())
}
pub async fn get_object_info_req<'a>(
    state: State<AppState>,
    Path(object_id): Path<String>,
) -> Json<Option<OCELObject>> {
    Json(
        with_ocel_from_state(&state, |ocel| ocel.ob_by_id(&object_id).cloned()).unwrap_or_default(),
    )
}

async fn get_event_req<'a>(
    state: State<AppState>,
    Json(req): Json<IndexOrID>,
) -> Json<Option<EventWithIndex>> {
    let res = with_ocel_from_state(&state, |ocel| get_event_info(ocel, req)).flatten();

    Json(res)
}

async fn get_object_req<'a>(
    state: State<AppState>,
    Json(req): Json<IndexOrID>,
) -> Json<Option<ObjectWithIndex>> {
    let res = with_ocel_from_state(&state, |ocel| get_object_info(ocel, req)).flatten();

    Json(res)
}

async fn login_to_hpc_web<'a>(
    State(state): State<AppState>,
    Json(cfg): Json<ConnectionConfig>,
) -> Result<Json<()>, (StatusCode, String)> {
    let client = login_on_hpc(&cfg)
        .await
        .map_err(|er| (StatusCode::UNAUTHORIZED, er.to_string()))?;
    let mut x = state.client.write().unwrap();
    *x = Some(client);

    Ok(Json(()))
}

async fn start_hpc_job_web(
    State(state): State<AppState>,
    Json(options): Json<OCPQJobOptions>,
) -> Result<Json<String>, (StatusCode, String)> {
    let x = state.client.write().unwrap().clone().unwrap();
    let c = Arc::new(x);
    let c2 = Arc::clone(&c);
    let port: u16 = options
        .port
        .parse::<u16>()
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let (folder_id, job_id) = submit_hpc_job(c, options)
        .await
        .map_err(|er| (StatusCode::BAD_REQUEST, er.to_string()))?;
    let p = start_port_forwarding(
        c2,
        &format!("127.0.0.1:{}", port),
        &format!("127.0.0.1:{}", port),
    )
    .await
    .map_err(|er| (StatusCode::BAD_REQUEST, er.to_string()))?;

    state.jobs.write().unwrap().push((job_id.clone(), port, p));
    println!("Ceated job {} in folder {}", job_id, folder_id);
    Ok(Json(job_id))
}

async fn get_hpc_job_status_web(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<JobStatus>, (StatusCode, String)> {
    let x = state.client.write().unwrap().clone().unwrap();
    let c = Arc::new(x);
    let status = get_job_status(c, job_id).await;
    let status = status.map_err(|er| (StatusCode::BAD_REQUEST, er.to_string()))?;
    Ok(Json(status))
}
