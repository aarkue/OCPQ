// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

use std::{
    fs::File,
    io::{Cursor, Write},
    path::Path,
    sync::{Arc, Mutex},
};
use itertools::Itertools;
use ocpq_shared::{
    binding_box::{
        evaluate_box_tree, filter_ocel_box_tree, CheckWithBoxTreeRequest, EvaluateBoxTreeResult,
        FilterExportWithBoxTreeRequest,
    },
    db_translation::{translate_to_sql_shared, DBTranslationInput},
    discovery::{
        auto_discover_constraints_with_options, AutoDiscoverConstraintsRequest,
        AutoDiscoverConstraintsResponse,
    },
    get_event_info, get_object_info,
    hpc_backend::{
        get_job_status, login_on_hpc, start_port_forwarding, submit_hpc_job, Client,
        ConnectionConfig, JobStatus, OCPQJobOptions,
    },
    oc_declare::statistics::{get_activity_statistics, get_edge_stats, ActivityStatistics},
    ocel_graph::{get_ocel_graph, OCELGraph, OCELGraphOptions},
    process_mining::{
        core::{
            event_data::{
                case_centric::xes::{import_xes_path, import_xes_slice, XESImportOptions},
                object_centric::linked_ocel::SlimLinkedOCEL,
            },
            process_models::oc_declare::OCDeclareArc,
        },
        discovery::object_centric::oc_declare::OCDeclareDiscoveryOptions,
        Exportable, Importable, OCEL,
    },
    table_export::{export_bindings_to_writer, TableExportFormat, TableExportOptions},
    EventWithIndex, IndexOrID, OCELInfo, ObjectWithIndex,
};
use ocpq_shared::{
    process_mining::discovery::object_centric::oc_declare::discover_behavior_constraints,
    trad_event_log::trad_log_to_ocel,
};
use tauri::{
    async_runtime::{JoinHandle, RwLock},
    AppHandle, Manager, State,
};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Debug, Default)]
pub struct AppState {
    ocel: Arc<RwLock<Option<SlimLinkedOCEL>>>,
    client: Arc<RwLock<Option<Client>>>,
    jobs: Arc<RwLock<Vec<(String, u16, JoinHandle<()>)>>>,
    eval_res: Arc<RwLock<Option<EvaluateBoxTreeResult>>>,
    initial_files: Arc<Mutex<Option<Vec<String>>>>,
}

fn import_ocel_from_path(path: impl AsRef<Path>) -> Result<OCEL, String> {
    let path = path.as_ref();
    println!("{path:?}");
    let _path_str = path.to_string_lossy();
    let ocel = OCEL::import_from_path(path).map_err(|e| e.to_string())?;
    Ok(ocel)
}
#[tauri::command(async)]
async fn import_ocel(path: &str, state: tauri::State<'_, AppState>) -> Result<OCELInfo, String> {
    let ocel = import_ocel_from_path(path)?;
    let locel = SlimLinkedOCEL::from_ocel(ocel);
    let ocel_info: OCELInfo = (&locel).into();
    let mut state_guard = state.ocel.write().await;
    *state_guard = Some(locel);
    Ok(ocel_info)
}

#[tauri::command(async)]
async fn import_ocel_slice(
    data: Vec<u8>,
    format: &str,
    state: tauri::State<'_, AppState>,
) -> Result<OCELInfo, String> {
    let ocel = OCEL::import_from_bytes(&data, format).map_err(|e| e.to_string())?;
    let locel = SlimLinkedOCEL::from_ocel(ocel);
    let ocel_info: OCELInfo = (&locel).into();
    let mut state_guard = state.ocel.write().await;
    *state_guard = Some(locel);
    Ok(ocel_info)
}

#[tauri::command(async)]
async fn import_xes_path_as_ocel(
    path: &str,
    state: tauri::State<'_, AppState>,
) -> Result<OCELInfo, String> {
    let xes = import_xes_path(path, XESImportOptions::default()).map_err(|e| e.to_string())?;
    let ocel = trad_log_to_ocel(&xes);

    let locel = SlimLinkedOCEL::from_ocel(ocel);
    let ocel_info: OCELInfo = (&locel).into();
    let mut state_guard = state.ocel.write().await;
    *state_guard = Some(locel);
    Ok(ocel_info)
}
#[tauri::command(async)]
async fn import_xes_slice_as_ocel(
    data: Vec<u8>,
    format: &str,
    state: tauri::State<'_, AppState>,
) -> Result<OCELInfo, String> {
    let xes = import_xes_slice(&data, format == ".xes.gz", XESImportOptions::default()).unwrap();
    let ocel = trad_log_to_ocel(&xes);
    let locel = SlimLinkedOCEL::from_ocel(ocel);
    let ocel_info: OCELInfo = (&locel).into();
    let mut state_guard = state.ocel.write().await;
    *state_guard = Some(locel);
    Ok(ocel_info)
}

#[tauri::command(async)]
async fn get_current_ocel_info(
    state: tauri::State<'_, AppState>,
) -> Result<Option<OCELInfo>, String> {
    let res: Result<Option<OCELInfo>, String> = match state.ocel.read().await.as_ref() {
        Some(ocel) => Ok(Some(ocel.into())),
        None => Ok(None),
    };
    res
}

#[tauri::command(async)]
async fn check_with_box_tree(
    req: CheckWithBoxTreeRequest,
    state: State<'_, AppState>,
) -> Result<EvaluateBoxTreeResult, String> {
    match state.ocel.read().await.as_ref() {
        Some(ocel) => {
            let res = evaluate_box_tree(req.tree, ocel, req.measure_performance.unwrap_or(false))?;
            let res_to_ret: EvaluateBoxTreeResult = res.clone_first_few();
            *state.eval_res.write().await = Some(res);
            Ok(res_to_ret)
        }
        None => Err("No OCEL loaded".to_string()),
    }
}

#[tauri::command(async)]
async fn export_filter_box(
    req: FilterExportWithBoxTreeRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let res = match state.ocel.read().await.as_ref() {
        Some(ocel) => {
            let res: OCEL = filter_ocel_box_tree(req.tree, ocel).unwrap();
            Some(res)
        }
        None => None,
    }
    .unwrap();

    app.dialog()
        .file()
        .set_title("Save Filtered OCEL")
        .add_filter(
            format!("OCEL {:?} Files", req.export_format),
            &[req.export_format.to_extension()],
        )
        .set_file_name(format!("filtered-export.{}", req.export_format.to_extension()).as_str())
        .save_file(move |f| {
            if let Some(path) = f {
                if let Some(path) = path.as_path() {
                    if let Ok(_file) = File::open(path) {
                        let _ = std::fs::remove_file(path);
                    }
                    // TODO: Handle error correctly
                    // Maybe even change to blocking dialog
                    OCEL::export_to_path(&res, path).unwrap();
                }
            }
        });
    Ok(())
}

#[tauri::command(async)]
async fn auto_discover_constraints(
    options: AutoDiscoverConstraintsRequest,
    state: State<'_, AppState>,
) -> Result<AutoDiscoverConstraintsResponse, String> {
    match state.ocel.read().await.as_ref() {
        Some(ocel) => Ok(auto_discover_constraints_with_options(ocel, options)),
        None => Err("No OCEL loaded".to_string()),
    }
}
#[tauri::command(async)]
async fn auto_discover_oc_declare(
    options: OCDeclareDiscoveryOptions,
    state: State<'_, AppState>,
) -> Result<Vec<OCDeclareArc>, String> {
    match state.ocel.read().await.as_ref() {
        Some(locel) => Ok(discover_behavior_constraints(locel, options)),
        None => Err("No OCEL loaded".to_string()),
    }
}

#[tauri::command(async)]
async fn evaluate_oc_declare_arcs(
    arcs: Vec<OCDeclareArc>,
    state: State<'_, AppState>,
) -> Result<Vec<f64>, String> {
    match state.ocel.read().await.as_ref() {
        Some(locel) => {
            let res = arcs
                .iter()
                .map(|arc| arc.get_for_all_evs_perf(locel))
                .collect();
            Ok(res)
        }

        None => Err("No OCEL loaded".to_string()),
    }
}

#[tauri::command(async)]
async fn get_oc_declare_edge_statistics(
    arc: OCDeclareArc,
    state: State<'_, AppState>,
) -> Result<Vec<i64>, String> {
    match state.ocel.read().await.as_ref() {
        Some(locel) => Ok(get_edge_stats(locel, &arc)),
        None => Err("No OCEL loaded".to_string()),
    }
}

#[tauri::command(async)]
async fn get_oc_declare_template_string(arcs: Vec<OCDeclareArc>) -> Result<String, String> {
    let result = arcs.iter().map(|a| a.as_template_string()).join("\n");
    Ok(result)
}

#[tauri::command(async)]
async fn get_oc_declare_activity_statistics(
    activity: String,
    state: State<'_, AppState>,
) -> Result<ActivityStatistics, String> {
    match state.ocel.read().await.as_ref() {
        Some(locel) => Ok(get_activity_statistics(locel, &activity)),
        None => Err("No OCEL loaded".to_string()),
    }
}

#[tauri::command(async)]
async fn export_bindings_table(
    node_index: usize,
    options: TableExportOptions,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if let Some(ocel) = state.ocel.read().await.as_ref() {
        let mut writer = Cursor::new(Vec::new());
        let eval_guard = state.eval_res.read().await;
        let eval_res = eval_guard
            .as_ref()
            .and_then(|e_res| e_res.evaluation_results.get(node_index));
        if let Some(node_eval_res) = eval_res {
            export_bindings_to_writer(ocel, node_eval_res, &mut writer, &options).unwrap();
            app.dialog()
                .file()
                .set_title("Save Filtered OCEL")
                .add_filter(
                    "CSV/XLSX Files",
                    &[match options.format {
                        TableExportFormat::CSV => "csv",
                        TableExportFormat::XLSX => "xlsx",
                    }],
                )
                .set_file_name(format!(
                    "situation-table.{}",
                    match options.format {
                        TableExportFormat::CSV => "csv",
                        TableExportFormat::XLSX => "xlsx",
                    }
                ))
                .save_file(move |f| {
                    if let Some(path) = f {
                        if let Some(path) = path.as_path() {
                            if let Ok(_file) = File::open(path) {
                                let _ = std::fs::remove_file(path);
                            }
                            let mut f = File::create(path).unwrap();
                            f.write_all(&writer.into_inner()).unwrap();
                        }
                    }
                });
            return Ok(());
        }
    }
    Err("No OCEL loaded".to_string())
}

#[tauri::command(async)]
async fn ocel_graph(
    options: OCELGraphOptions,
    state: State<'_, AppState>,
) -> Result<OCELGraph, String> {
    match state.ocel.read().await.as_ref() {
        Some(ocel) => match get_ocel_graph(ocel, options) {
            Some(graph) => Ok(graph),
            None => Err("Could not construct OCEL Graph".to_string()),
        },
        None => Err("No OCEL loaded".to_string()),
    }
}

#[tauri::command(async)]
async fn create_db_query(
    input: DBTranslationInput,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    Ok(translate_to_sql_shared(input))
}

#[tauri::command(async)]
async fn get_event(req: IndexOrID, state: State<'_, AppState>) -> Result<EventWithIndex, String> {
    match state.ocel.read().await.as_ref() {
        Some(ocel) => get_event_info(ocel, req),
        None => None,
    }
    .ok_or("Failed to get event".to_string())
}

#[tauri::command(async)]
async fn get_object(req: IndexOrID, state: State<'_, AppState>) -> Result<ObjectWithIndex, String> {
    match state.ocel.read().await.as_ref() {
        Some(ocel) => get_object_info(ocel, req),
        None => None,
    }
    .ok_or("Failed to get object".to_string())
}

#[tauri::command(async)]
async fn login_to_hpc_tauri(
    cfg: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let client = login_on_hpc(&cfg).await.map_err(|er| er.to_string())?;
    let mut x = state.client.write().await;
    *x = Some(client);

    Ok(())
}

#[tauri::command(async)]
async fn start_hpc_job_tauri(
    options: OCPQJobOptions,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let x = state.client.write().await.clone().unwrap();
    let c = Arc::new(x);
    let c2 = Arc::clone(&c);
    let port: u16 = options.port.parse::<u16>().map_err(|e| e.to_string())?;
    let (folder_id, job_id) = submit_hpc_job(c, options)
        .await
        .map_err(|er| er.to_string())?;
    let p = start_port_forwarding(
        c2,
        &format!("127.0.0.1:{port}"),
        &format!("127.0.0.1:{port}"),
    )
    .await
    .map_err(|er| er.to_string())?;

    state.jobs.write().await.push((
        job_id.clone(),
        port,
        tauri::async_runtime::JoinHandle::Tokio(p),
    ));
    println!("Ceated job {job_id} in folder {folder_id}");
    Ok(job_id)
}

#[tauri::command(async)]
async fn get_hpc_job_status_tauri(
    job_id: String,
    state: State<'_, AppState>,
) -> Result<JobStatus, String> {
    let x = state.client.write().await.clone().unwrap();
    let c = Arc::new(x);
    let status = get_job_status(c, job_id).await;
    let status = status.map_err(|er| er.to_string())?;
    Ok(status)
}

#[tauri::command]
fn get_initial_files(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut ret = state.initial_files.lock().unwrap();
    if let Some(ret) = ret.take() {
        Ok(ret)
    } else {
        Ok(Vec::default())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(
            #[allow(unused_variables)]
            // might be unused, depending on the platform
            |app| {
                log::info!("Setup!");
                #[cfg(any(windows, target_os = "linux"))]
                {
                    let state = app.state::<AppState>();
                    let mut files = Vec::new();

                    // NOTICE: `args` may include URL protocol (`your-app-protocol://`)
                    // or arguments (`--`) if your app supports them.
                    // files may also be passed as `file://path/to/file`
                    for maybe_file in std::env::args().skip(1) {
                        // skip flags like -f or --flag
                        log::info!("Args: {maybe_file}");
                        use std::path::PathBuf;
                        if maybe_file.starts_with('-') {
                            continue;
                        }

                        // handle `file://` path urls and fallback for other urls
                        if let Ok(url) = url::Url::parse(&maybe_file) {
                            if let Ok(path) = url.to_file_path() {
                                files.push(path);
                            } else {
                                log::info!(
                                    "Url file path failed. Using directly as PathBuf instead."
                                );
                                files.push(maybe_file.into());
                            }
                        } else {
                            files.push(PathBuf::from(maybe_file))
                        }
                    }
                    let mut init_files_guard = state.initial_files.lock().unwrap();
                    *init_files_guard = Some(
                        files
                            .into_iter()
                            .map(|f| f.to_string_lossy().to_string())
                            .collect(),
                    );
                }
                Ok(())
            },
        )
        .invoke_handler(tauri::generate_handler![
            import_ocel,
            import_ocel_slice,
            import_xes_path_as_ocel,
            import_xes_slice_as_ocel,
            get_current_ocel_info,
            export_filter_box,
            check_with_box_tree,
            auto_discover_constraints,
            export_bindings_table,
            ocel_graph,
            get_event,
            get_object,
            login_to_hpc_tauri,
            start_hpc_job_tauri,
            get_hpc_job_status_tauri,
            get_initial_files,
            auto_discover_oc_declare,
            evaluate_oc_declare_arcs,
            get_oc_declare_edge_statistics,
            get_oc_declare_activity_statistics,
            get_oc_declare_template_string,
            create_db_query
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(
            #[allow(unused_variables)]
            |app, event| {
                #[cfg(any(target_os = "macos", target_os = "ios"))]
                if let tauri::RunEvent::Opened { urls } = event {
                    let state = app.state::<AppState>();
                    let files = urls
                        .into_iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .collect::<Vec<_>>();
                    let strs: Vec<_> = files
                        .into_iter()
                        .map(|f| f.to_string_lossy().to_string())
                        .collect();
                    let mut initial_files = state.initial_files.lock().unwrap();
                    *initial_files = Some(strs);
                }
            },
        );
}
