use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};

use anyhow::Error;
use serde::{Deserialize, Serialize};
// use slurry::{
//     self,
//     jobs_management::{JobFilesToUpload, JobLocalForwarding, JobOptions},
//     login_with_cfg,
// };
// pub use slurry::{jobs_management::JobStatus, Client, ConnectionConfig};
pub use slurry::{
    self,
    job_management::{JobFilesToUpload, JobLocalForwarding, JobOptions, JobStatus},
    login_with_cfg, submit_job, Client, ConnectionConfig,
};
use tokio::task::JoinHandle;
use ts_rs::TS;

pub async fn login_on_hpc(cfg: &ConnectionConfig) -> Result<Client, Error> {
    login_with_cfg(cfg).await
}

/// The port forwards opened for submitted jobs.
///
/// A forward is a live task holding a local port for as long as its job needs it. Nothing used to
/// close one: both targets pushed a `JoinHandle` onto a `Vec` that was never awaited, aborted or
/// drained, so a finished job kept its port claimed for the process lifetime and re-submitting on
/// that port failed. Shared by the webserver and the tauri app rather than reimplemented in each.
#[derive(Default)]
pub struct JobForwards(RwLock<Vec<(String, u16, JoinHandle<()>)>>);

impl JobForwards {
    /// Record a job's forward, first closing anything that is finished or already holds `port`.
    ///
    /// A local port can only be forwarded once, so an entry still holding it is stale by
    /// construction -- either its job ended or the caller is reusing the port deliberately.
    pub fn insert(&self, job_id: String, port: u16, forward: JoinHandle<()>) {
        if let Ok(mut jobs) = self.0.write() {
            jobs.retain(|(id, p, handle)| {
                let stale = handle.is_finished() || *p == port || *id == job_id;
                if stale {
                    handle.abort();
                }
                !stale
            });
            jobs.push((job_id, port, forward));
        }
    }

    /// Close and forget the forward for `job_id`, if it still has one. Idempotent.
    pub fn release(&self, job_id: &str) {
        if let Ok(mut jobs) = self.0.write() {
            jobs.retain(|(id, _, handle)| {
                if id == job_id {
                    handle.abort();
                    return false;
                }
                true
            });
        }
    }

    /// Number of forwards currently held. For tests and diagnostics.
    pub fn len(&self) -> usize {
        self.0.read().map(|j| j.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Whether a job will never report anything further, so its forward can be closed.
pub fn job_is_over(status: &JobStatus) -> bool {
    matches!(status, JobStatus::ENDED { .. } | JobStatus::NotFound)
}

#[derive(TS)]
#[ts(export)]
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
    submit_job(client, job_options).await
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
// #[ts(export)]
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
