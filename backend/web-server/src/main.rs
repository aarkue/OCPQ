#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
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
    EventWithIndex, IndexOrID, OCELInfo, ObjectWithIndex, binding_box::{
        CheckWithBoxTreeRequest, EvaluateBoxTreeResult, ExportFormat, FilterExportWithBoxTreeRequest, evaluate_box_tree, filter_ocel_box_tree
    }, db_translation::{DBTranslationInput, translate_to_sql_shared}, discovery::{
        AutoDiscoverConstraintsRequest, AutoDiscoverConstraintsResponse, auto_discover_constraints_with_options
    }, get_event_info, get_object_info, hpc_backend::{
        Client, ConnectionConfig, JobStatus, OCPQJobOptions, get_job_status, login_on_hpc, start_port_forwarding, submit_hpc_job
    }, oc_declare::statistics::{ActivityStatistics, get_activity_statistics, get_edge_stats}, ocel_graph::{OCELGraph, OCELGraphOptions, get_ocel_graph}, ocel_qualifiers::qualifiers::{
        QualifierAndObjectType, QualifiersForEventType, get_qualifiers_for_event_types
    },  process_mining::{OCEL, core::{event_data::{case_centric::xes::{XESImportOptions, import_xes_slice}, object_centric::{
        OCELEvent, OCELObject, linked_ocel::{SlimLinkedOCEL, LinkedOCELAccess}, ocel_json::export_ocel_json_to_vec, ocel_sql::{export_ocel_sqlite_to_vec, import_ocel_sqlite_from_slice}, ocel_xml::{export_ocel_xml, import_ocel_xml_slice}
    }}, process_models::oc_declare::OCDeclareArc}, discovery::object_centric::oc_declare::OCDeclareDiscoveryOptions}, table_export::{TableExportOptions, export_bindings_to_writer}, trad_event_log::trad_log_to_ocel
};

use tower_http::cors::CorsLayer;

use crate::load_ocel::{
    get_available_ocels, load_ocel_file_req, load_ocel_file_to_state, DEFAULT_OCEL_FILE,
};
pub mod load_ocel;

#[derive(Clone, Default)]
pub struct AppState {
    ocel: Arc<RwLock<Option<SlimLinkedOCEL>>>,
    client: Arc<RwLock<Option<Client>>>,
    jobs: Arc<RwLock<Vec<(String, u16, JoinHandle<()>)>>>,
    eval_res: Arc<RwLock<Option<EvaluateBoxTreeResult>>>,
}

struct AppError(String);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.0).into_response()
    }
}

impl From<String> for AppError {
    fn from(err: String) -> Self {
        Self(err)
    }
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

    load_ocel_file_to_state(DEFAULT_OCEL_FILE, &state, true);

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
        .route(
            "/ocel/upload-xes-conversion/:format",
            post(upload_ocel_xes_conversion).layer(DefaultBodyLimit::disable()),
        )
        .route("/ocel/available", get(get_available_ocels))
        .route("/ocel/graph", post(ocel_graph_req))
        .route("/ocel/check-constraints-box", post(check_with_box_tree_req))
        .route("/ocel/create-db-query", post(translate_to_db_req))
        .route(
            "/ocel/export-filter-box",
            post(filter_export_with_box_tree_req),
        )
        .route(
            "/ocel/discover-constraints",
            post(auto_discover_constraints_handler),
        )
        .route(
            "/ocel/discover-oc-declare",
            post(auto_discover_oc_declare_handler),
        )
        .route(
            "/ocel/evaluate-oc-declare-arcs",
            post(evaluate_oc_declare_arcs_handler),
        )
        .route(
            "/ocel/get-activity-statistics",
            post(get_activity_statistics_handler),
        )
        .route(
            "/ocel/get-oc-declare-edge-statistics",
            post(get_oc_declare_edge_statistics_handler),
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
    match with_ocel_from_state(&State(state), |ocel| ocel.into()) {
        Some(ocel_info) => (StatusCode::OK, Json(Some(ocel_info))),
        None => (StatusCode::NOT_FOUND, Json(None)),
    }
}

async fn upload_ocel_xml<'a>(
    State(state): State<AppState>,
    ocel_bytes: Bytes,
) -> Result<Json<OCELInfo>, AppError> {
    match import_ocel_xml_slice(&ocel_bytes) {
        Ok(ocel) => {
            let mut x = state.ocel.write().unwrap();
            let locel = SlimLinkedOCEL::from_ocel(ocel);
            let ocel_info: OCELInfo = (&locel).into();
            *x = Some(locel);
            Ok(Json(ocel_info))
        }
        Err(e) => Err(e.to_string().into()),
    }
}

async fn upload_ocel_sqlite<'a>(
    State(state): State<AppState>,
    ocel_bytes: Bytes,
) -> (StatusCode, Json<OCELInfo>) {
    let ocel = import_ocel_sqlite_from_slice(&ocel_bytes).unwrap();
    let mut x = state.ocel.write().unwrap();
    let locel = SlimLinkedOCEL::from_ocel(ocel);
    let ocel_info: OCELInfo = (&locel).into();
    *x = Some(locel);

    (StatusCode::OK, Json(ocel_info))
}

async fn upload_ocel_json<'a>(
    State(state): State<AppState>,
    ocel_bytes: Bytes,
) -> (StatusCode, Json<OCELInfo>) {
    let ocel: OCEL = serde_json::from_slice(&ocel_bytes).unwrap();
    let locel = SlimLinkedOCEL::from_ocel(ocel);
    let ocel_info: OCELInfo = (&locel).into();
    let mut x = state.ocel.write().unwrap();
    *x = Some(locel);
    (StatusCode::OK, Json(ocel_info))
}

async fn upload_ocel_xes_conversion<'a>(
    State(state): State<AppState>,
    Path(format): Path<String>,
    xes_bytes: Bytes,
) -> (StatusCode, Json<OCELInfo>) {
    let is_compressed_gz = format == ".xes.gz";
    let xes = import_xes_slice(&xes_bytes, is_compressed_gz, XESImportOptions::default()).unwrap();
    let ocel = trad_log_to_ocel(&xes);

    let locel = SlimLinkedOCEL::from_ocel(ocel);
    let ocel_info: OCELInfo = (&locel).into();
    let mut x = state.ocel.write().unwrap();
    *x = Some(locel);
    (StatusCode::OK, Json(ocel_info))
}
pub fn with_ocel_from_state<T, F>(State(state): &State<AppState>, f: F) -> Option<T>
where
    F: FnOnce(&SlimLinkedOCEL) -> T,
{
    let read_guard = state.ocel.read().ok()?;
    let ocel_ref = read_guard.as_ref()?;
    Some(f(ocel_ref))
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
) -> axum::response::Result<Json<Option<EvaluateBoxTreeResult>>, (StatusCode, String)> {
    let ocel_guard = state.ocel.read().unwrap();
    let ocel = ocel_guard.as_ref();
    if let Some(ocel) = ocel {
        let res = evaluate_box_tree(req.tree, ocel, req.measure_performance.unwrap_or(false))
            .map_err(|s| (StatusCode::BAD_REQUEST, s))?;
        let res_to_ret = res.clone_first_few();
        let mut new_eval_res_state = state.eval_res.write().unwrap();
        *new_eval_res_state = Some(res);
        return Ok(Json(Some(res_to_ret)));
    }
    Err((StatusCode::NOT_FOUND, "No OCEL Loaded".to_string()))
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

pub async fn auto_discover_oc_declare_handler(
    state: State<AppState>,
    Json(req): Json<OCDeclareDiscoveryOptions>,
) -> Json<Option<Vec<OCDeclareArc>>> {
    Json(with_ocel_from_state(&state, |locel| {
        todo!("TODO")
        // ocpq_shared::process_mining::discovery::object_centric::oc_declare::discover_behavior_constraints(locel, req)
    }))
}
pub async fn evaluate_oc_declare_arcs_handler(
    state: State<AppState>,
    Json(req): Json<Vec<OCDeclareArc>>,
) -> Json<Option<Vec<f64>>> {
    Json(with_ocel_from_state(&state, |locel| {
        todo!("TODO")
        // req.iter()
        //     .map(|arc| arc.get_for_all_evs_perf(&locel))
        //     .collect()
    }))
}
pub async fn get_activity_statistics_handler(
    state: State<AppState>,
    Json(req): Json<String>,
) -> Json<Option<ActivityStatistics>> {
    Json(with_ocel_from_state(&state, |ocel| {
        get_activity_statistics(ocel, &req)
    }))
}
pub async fn get_oc_declare_edge_statistics_handler(
    state: State<AppState>,
    Json(req): Json<OCDeclareArc>,
) -> Json<Option<Vec<i64>>> {
    Json(with_ocel_from_state(&state, |ocel| {
        get_edge_stats(ocel, &req)
    }))
}

pub async fn translate_to_db_req(Json(req): Json<DBTranslationInput>) -> String {
    translate_to_sql_shared(req)
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
    Json(
        with_ocel_from_state(&state, |ocel| {
            ocel.get_ev_by_id(event_id)
                .map(|e_index| ocel.get_ev(&e_index).into_owned())
        })
        .unwrap_or_default(),
    )
}
pub async fn get_object_info_req<'a>(
    state: State<AppState>,
    Path(object_id): Path<String>,
) -> Json<Option<OCELObject>> {
    Json(
        with_ocel_from_state(&state, |ocel| {
            ocel.get_ob_by_id(&object_id)
                .map(|o_index| ocel.get_ob(&o_index).into_owned())
        })
        .unwrap_or_default(),
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
        &format!("127.0.0.1:{port}"),
        &format!("127.0.0.1:{port}"),
    )
    .await
    .map_err(|er| (StatusCode::BAD_REQUEST, er.to_string()))?;

    state.jobs.write().unwrap().push((job_id.clone(), port, p));
    println!("Ceated job {job_id} in folder {folder_id}");
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
