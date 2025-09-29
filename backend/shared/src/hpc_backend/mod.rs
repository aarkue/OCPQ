use std::{path::PathBuf, sync::Arc};

use anyhow::Error;
use slurry::{
    self,
    job_management::{JobFilesToUpload, JobLocalForwarding, JobOptions},
    login_with_cfg,
};
pub use slurry::{job_management::JobStatus, Client, ConnectionConfig};
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use ts_rs::TS;

pub async fn login_on_hpc(cfg: &ConnectionConfig) -> Result<Client, Error> {
    login_with_cfg(cfg).await
}

#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OCPQJobOptions {
    pub binary_path: PathBuf,
    pub cpus: usize,
    pub hours: f32,
    pub port: String,
    pub relay_addr: String,
}

pub async fn submit_hpc_job(
    client: Arc<Client>,
    options: OCPQJobOptions,
) -> Result<(String, String), Error> {
    let job_options = JobOptions {
        root_dir: "ocpq".to_string(),
        files_to_upload: vec![JobFilesToUpload {
            local_path: options.binary_path,
            remote_subpath: "".to_string(),
            remote_file_name: "ocpq-server".to_string(),
        }]
        .into_iter()
        .collect(),
        num_cpus: options.cpus,
        time: hour_float_to_slurm_time(options.hours),
        command: "chmod +x ./ocpq-server && ./ocpq-server".to_string(),
        local_forwarding: Some(JobLocalForwarding {
            local_port: 3000,
            relay_port: options.port.parse()?,
            relay_addr: options.relay_addr,
        }),
    };
    slurry::job_management::submit_job(client, job_options).await
}

fn hour_float_to_slurm_time(hours: f32) -> String {
    let minutes = hours * 60.0;
    let full_hours: usize = (minutes / 60.0).floor() as usize;

    format!("0-{}:{}:00", full_hours, minutes as usize % 60)
}

pub async fn get_job_status(client: Arc<Client>, job_id: String) -> Result<JobStatus, Error> {
    slurry::job_management::get_job_status(client.as_ref(), &job_id).await
}

// #[derive(TS)]
// #[ts(export, export_to = "../../../frontend/src/types/generated/")]
// #[derive(Debug, Serialize, Deserialize, Clone)]
// #[serde(rename_all = "camelCase")]
// pub struct OCPQPortForwardingOptions {
//     local_addr: String,
//     remote_addr: String
// }

pub async fn start_port_forwarding(
    client: Arc<Client>,
    local_addr: &str,
    remote_addr: &str,
) -> Result<JoinHandle<()>, Error> {
    slurry::ssh_port_forwarding(client, local_addr, remote_addr).await
}
