use std::{
    fs::{self, File},
    io::BufReader,
};

use axum::{extract::State, http::StatusCode, Json};
use ocpq_shared::OCELInfo;
use serde::{Deserialize, Serialize};

use ocpq_shared::process_mining::{
    event_log::ocel::ocel_struct::OCEL,
    import_ocel_sqlite_from_path,
    ocel::{
        linked_ocel::IndexLinkedOCEL,
        xml_ocel_import::{import_ocel_xml_file_with, OCELImportOptions},
    },
};

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
    match load_ocel_file_to_state(&payload.name, &state) {
        Some(ocel_info) => (StatusCode::OK, Json(Some(ocel_info))),
        None => (StatusCode::BAD_REQUEST, Json(None)),
    }
}

pub fn load_ocel_file_to_state(name: &str, state: &AppState) -> Option<OCELInfo> {
    match load_ocel_file(name) {
        Ok(ocel) => {
            let ocel_info: OCELInfo = (&ocel).into();
            let mut x = state.ocel.write().unwrap();
            *x = Some(IndexLinkedOCEL::from_ocel(ocel));
            Some(ocel_info)
        }
        Err(e) => {
            eprintln!("Error importing OCEL: {e:?}");
            None
        }
    }
}

pub fn load_ocel_file(name: &str) -> Result<OCEL, std::io::Error> {
    let path = format!("{DATA_PATH}{name}");
    if name.ends_with(".json") {
        let file = File::open(path)?;
        let reader = BufReader::new(file);
        let ocel: OCEL = serde_json::from_reader(reader)?;
        Ok(ocel)
    } else if name.ends_with(".xml") {
        let ocel = import_ocel_xml_file_with(&path, OCELImportOptions::default());
        Ok(ocel)
    } else {
        let ocel = import_ocel_sqlite_from_path(&path)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::FileTooLarge, e))?;
        Ok(ocel)
    }
}
