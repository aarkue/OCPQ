//! The parts of OCPQ that need a live OS: an SSH session to an HPC cluster and the tokio runtime
//! driving it. Kept out of `ocpq-core` so that crate stays buildable for `wasm32-unknown-unknown`.

// Re-exported so a call site can name the `JoinHandle` a port forward hands back without taking
// its own dependency on a runtime it does not drive.
pub use tokio;

pub mod hpc_backend;
