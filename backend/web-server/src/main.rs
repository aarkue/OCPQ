use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use itertools::Itertools;
use tokio::net::TcpListener;

use std::{
    collections::{HashMap, HashSet},
    env,
    io::{Cursor, Read},
    sync::{Arc, RwLock},
};

use ocedeclare_shared::{
    binding_box::{
        evaluate_box_tree, filter_ocel_box_tree, CheckWithBoxTreeRequest, EvaluateBoxTreeResult,
        ExportFormat, FilterExportWithBoxTreeRequest,
    },
    discovery::{
        auto_discover_constraints_with_options, AutoDiscoverConstraintsRequest,
        AutoDiscoverConstraintsResponse,
    },
    get_event_info, get_object_info,
    ocel_graph::{get_ocel_graph, OCELGraph, OCELGraphOptions},
    ocel_qualifiers::qualifiers::{
        get_qualifiers_for_event_types, QualifierAndObjectType, QualifiersForEventType,
    },
    preprocessing::{linked_ocel::IndexLinkedOCEL, preprocess::link_ocel_info},
    EventWithIndex, IndexOrID, OCELInfo, ObjectWithIndex,
};
use process_mining::{
    event_log::ocel::ocel_struct::OCEL, export_ocel_json_to_vec, export_ocel_sqlite_to_slice, export_ocel_xml, import_ocel_sqlite_from_slice, import_ocel_xml_slice, ocel::ocel_struct::{OCELEvent, OCELObject}
};
use tower_http::cors::CorsLayer;

use crate::load_ocel::{
    get_available_ocels, load_ocel_file_req, load_ocel_file_to_state, DEFAULT_OCEL_FILE,
};
pub mod load_ocel;

#[derive(Clone)]
pub struct AppState {
    ocel: Arc<RwLock<Option<IndexLinkedOCEL>>>,
}

#[tokio::main]
async fn main() {
    let args = env::args().collect_vec();
    dbg!(args);
    let state = AppState {
        ocel: Arc::new(RwLock::new(None)),
    };
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
        .route("/ocel/event/:event_id", get(get_event_info_req))
        .route("/ocel/object/:object_id", get(get_object_info_req))
        .route("/ocel/get-event", post(get_event_req))
        .route("/ocel/get-object", post(get_object_req))
        .with_state(state)
        .route("/", get(|| async { "Hello, Aaron!" }))
        .layer(cors);
    // run it with hyper on localhost:3000
    let listener = TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();
}

pub async fn get_loaded_ocel_info(
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
    with_ocel_from_state(&state, |ocel| {
        (
            StatusCode::OK,
            Json(Some(evaluate_box_tree(
                req.tree,
                ocel,
                req.measure_performance.unwrap_or(false),
            ))),
        )
    })
    .unwrap_or((StatusCode::INTERNAL_SERVER_ERROR, Json(None)))
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
                let res = export_ocel_sqlite_to_slice(&res).unwrap();
                Bytes::from(res)
            },
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
