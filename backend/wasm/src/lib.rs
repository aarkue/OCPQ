//! In-browser OCPQ backend. Exposes the same generic entry points as the axum server and the
//! tauri app, so `BackendProviderContext` speaks one protocol to all three.

mod utils;

// Force-link app-bindings so its `inventory` registry entries survive optimisation. `extern crate`
// alone is a side-effect link that an optimising build drops; the `#[used]` reference to a real
// symbol keeps the crate, and with it every registration.
extern crate app_bindings;
#[used]
static _FORCE_LINK_APP_BINDINGS: fn() -> String = app_bindings::app_ping;

use std::str::FromStr;
use std::sync::LazyLock;

use backend_shared::process_mining::bindings;
use backend_shared::{Backend, ExtendedAppState};
use gloo_utils::format::JsValueSerdeExt;
use serde_json::Value;
use wasm_bindgen::prelude::*;

struct WasmBackend(LazyLock<ExtendedAppState>);

static BACKEND: WasmBackend = WasmBackend(LazyLock::new(ExtendedAppState::default));

impl Backend for WasmBackend {
    fn get_state(&self) -> &ExtendedAppState {
        &self.0
    }

    fn emit<S: serde::Serialize + Clone>(&self, name: &str, data: S) -> Result<(), String> {
        emit(name, JsValue::from_serde(&data).map_err(|e| e.to_string())?);
        Ok(())
    }
}

#[wasm_bindgen]
pub fn execute_binding(
    function_id: String,
    args: JsValue,
    output_name: Option<String>,
) -> Result<Vec<u8>, String> {
    let args: Value = args.into_serde().map_err(|e| e.to_string())?;
    backend_shared::execute_binding(&BACKEND, &function_id, &args, output_name.as_deref())
}

#[wasm_bindgen]
pub fn list_functions() -> Result<JsValue, String> {
    let functions = backend_shared::list_functions();
    JsValue::from_serde(&functions).map_err(|e| e.to_string())
}

#[wasm_bindgen]
pub fn get_all_item_kinds() -> Result<JsValue, String> {
    let kinds = backend_shared::get_all_item_kinds()?;
    JsValue::from_serde(&kinds).map_err(|e| e.to_string())
}

#[wasm_bindgen]
pub fn load_item_bytes(
    id: String,
    item_kind: String,
    data: &[u8],
    format: String,
) -> Result<(), String> {
    let item_kind = bindings::RegistryItemKind::from_str(&item_kind)
        .map_err(|_| format!("Unknown item kind: {item_kind}"))?;
    backend_shared::load_item_bytes(&BACKEND, id, &item_kind, data, &format)
}

#[wasm_bindgen]
pub fn get_all_objects_with_type() -> Result<JsValue, String> {
    let all_objs = backend_shared::get_objects_with_type(&BACKEND)?;
    JsValue::from_serde(&all_objs).map_err(|e| e.to_string())
}

#[wasm_bindgen]
pub fn set_object_label(id: String, label: Option<String>) -> Result<(), String> {
    backend_shared::set_object_label(&BACKEND, id, label)
}

#[wasm_bindgen]
pub fn rename_object(from: String, to: String) -> Result<(), String> {
    backend_shared::rename_object(&BACKEND, &from, &to)
}

#[wasm_bindgen]
pub fn unload_object(name: String) -> Result<(), String> {
    backend_shared::unload_object(&BACKEND, name)
}

#[wasm_bindgen]
pub fn export_object(name: String, format: String) -> Result<Vec<u8>, String> {
    backend_shared::export_object(&BACKEND, &name, &format)
}

#[wasm_bindgen]
pub fn export_bindings_table(
    ocel_id: String,
    eval_id: String,
    node_index: usize,
    options: JsValue,
) -> Result<Vec<u8>, String> {
    let options: backend_shared::ocpq_core::table_export::TableExportOptions =
        options.into_serde().map_err(|e| e.to_string())?;
    backend_shared::export_bindings_table_file(&BACKEND, &ocel_id, &eval_id, node_index, &options)
}

#[wasm_bindgen]
pub fn load_artifact_bytes(
    id: String,
    kind: String,
    data: &[u8],
    format: String,
) -> Result<(), String> {
    backend_shared::load_artifact_bytes(&BACKEND, id, &kind, data, &format)
}

#[wasm_bindgen]
pub fn list_artifacts() -> Result<JsValue, String> {
    let v = backend_shared::list_artifacts(&BACKEND)?;
    JsValue::from_serde(&v).map_err(|e| e.to_string())
}

#[wasm_bindgen]
pub fn get_artifact(id: String) -> Result<JsValue, String> {
    let v = backend_shared::get_artifact(&BACKEND, &id)?;
    JsValue::from_serde(&v).map_err(|e| e.to_string())
}

#[wasm_bindgen]
pub fn unload_artifact(id: String) -> Result<(), String> {
    backend_shared::unload_artifact(&BACKEND, id)
}

#[wasm_bindgen]
pub fn export_artifact(id: String, format: String) -> Result<Vec<u8>, String> {
    backend_shared::export_artifact(&BACKEND, &id, &format)
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = wasmSpace)]
    fn emit(s: &str, data: JsValue);
}

// Required for the wasm binary to include constructors.
// See https://github.com/dtolnay/inventory/issues/77
// and https://docs.rs/inventory/latest/inventory/#webassembly-and-constructors.
extern "C" {
    fn __wasm_call_ctors();
}

#[wasm_bindgen(start)]
pub fn main() {
    unsafe { __wasm_call_ctors() };
    utils::set_panic_hook();
}
