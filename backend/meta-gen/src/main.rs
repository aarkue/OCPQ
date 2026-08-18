//! Dumps the live binding registry metadata to JSON for the frontend codegen.
//! Run: `cargo run -p meta-gen [-- <out-path>]` (default ./bindings-meta.json, cwd).

// Force-link app-bindings so its `inventory::submit!` registrations are included.
extern crate app_bindings;

use std::collections::BTreeMap;

fn main() {
    let metas = process_mining::bindings::list_functions_meta();
    // De-dup by id and order stably, so the codegen output does not churn between runs.
    let by_id: BTreeMap<_, _> = metas.iter().map(|m| (m.id.clone(), m)).collect();
    let ordered: Vec<_> = by_id.values().copied().collect();
    let json = serde_json::to_string_pretty(&ordered).unwrap();
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "bindings-meta.json".to_string());
    std::fs::write(&out, &json).unwrap();
    eprintln!("wrote {out}: {} bindings", ordered.len());
}
