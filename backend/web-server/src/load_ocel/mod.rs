use std::fs;

use axum::{extract::State, http::StatusCode, Json};
use ocpq_shared::{OCELInfo, process_mining::{Importable, OCEL, core::event_data::object_centric::{io::OCELIOError, linked_ocel::SlimLinkedOCEL}}};
use serde::{Deserialize, Serialize};


use crate::AppState;

#[derive(Deserialize, Serialize)]
pub struct LoadOcel {
    name: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct OCELFilePath {
    name: &'static str,
    path: &'static str,
}

pub const DEFAULT_OCEL_FILE: &str = "order-management.json"; // "bpic2017-o2o-qualifier.json"; //
pub const DATA_PATH: &str = "../data/";

pub async fn get_available_ocels() -> (StatusCode, Json<Option<Vec<String>>>) {
    let mut ocel_names: Vec<String> = Vec::new();
    if let Ok(paths) = fs::read_dir(DATA_PATH) {
        for dir_entry in paths.flatten() {
            let path_buf = dir_entry.path();
            let path = path_buf.as_os_str().to_str().unwrap();
            if path.ends_with(".json") || path.ends_with(".xml") || path.ends_with(".sqlite") {
                ocel_names.push(path.split('/').next_back().unwrap().to_string())
            }
        }
    }
    (StatusCode::OK, Json(Some(ocel_names)))
}

pub async fn load_ocel_file_req(
    State(state): State<AppState>,
    Json(payload): Json<LoadOcel>,
) -> (StatusCode, Json<Option<OCELInfo>>) {
    match load_ocel_file_to_state(&payload.name, &state, false) {
        Some(ocel_info) => (StatusCode::OK, Json(Some(ocel_info))),
        None => (StatusCode::BAD_REQUEST, Json(None)),
    }
}

pub fn load_ocel_file_to_state(
    name: &str,
    state: &AppState,
    ignore_errors: bool,
) -> Option<OCELInfo> {
    match load_ocel_file(name) {
        Ok(ocel) => {
            let locel = SlimLinkedOCEL::from_ocel(ocel);
            let ocel_info: OCELInfo = (&locel).into();
            let mut x = state.ocel.write().unwrap();
            *x = Some(locel);
            Some(ocel_info)
        }
        Err(e) => {
            if !ignore_errors {
                eprintln!("Error importing OCEL: {e:?}");
            }
            None
        }
    }
}

pub fn load_ocel_file(name: &str) -> Result<OCEL, OCELIOError> {
    let path = format!("{DATA_PATH}{name}");
    let ocel = OCEL::import_from_path(path)?;
    Ok(ocel)
}
