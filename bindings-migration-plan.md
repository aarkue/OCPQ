# Plan: Migrate OCPQ backends to register_binding

## Problem

Adding one backend function today touches ~5 places:

1. Function in `ocpq-shared`
2. Axum route + handler (`backend/web-server/src/main.rs`)
3. Tauri command + `generate_handler!` registration (`tauri/src-tauri/src/main.rs`)
4. `BackendProviderContext.ts`: method signature + stub + web (fetch) impl
5. `tauri/src/main.tsx`: invoke mapping

## Idea

Adopt the propel pattern (`doc/projects/propel`): functions are defined once in Rust with
`#[register_binding]` (from `process_mining::bindings`, inventory-collected). Every surface
exposes only two generic entry points:

- `execute_binding(function_id, args)` -> JSON bytes
- `list_functions()` -> binding metadata (arg/return JSON schemas)

Adding a function then means: one `#[register_binding]` fn in `ocpq-shared` + one line in a
typed frontend wrapper.

Our locked rust4pm rev (15fa19e) already ships the full framework, including
`slim_ocel_bindings` and `path_schema_bindings`. No dependency bump needed.

## Design decisions

- **State**: bindings resolve `&SlimLinkedOCEL` params from `bindings::AppState` (registry of
  id -> item). Replace `Arc<RwLock<Option<SlimLinkedOCEL>>>` with the registry, storing the
  loaded OCEL under fixed id `"ocel"`. The frontend wrapper injects `{ ocel: "ocel" }`.
  Single-OCEL semantics unchanged; multi-OCEL becomes possible later.
- **Types**: bound fns need `schemars::JsonSchema` derives on options/result types
  (mechanical). Keep ts-rs for frontend typing; a hand-written typed wrapper around a generic
  `callBinding(id, args)` avoids any schema-to-TS generator.
- **Blocking**: `execute_binding` is sync CPU work. Web server: `spawn_blocking` in the one
  generic handler. Tauri: one `#[tauri::command(async)]`.
- **Ids**: binding ids embed the Rust module path; moving a fn renames its id. Keep all id
  strings in one wrapper file (`frontend/src/bindings.ts`).

## Stays bespoke (side effects / extra state)

- OCEL import/upload, file-dialog exports (`export_bindings_table`)
- HPC job start/status, DB connect/extraction
- Eval-result cache + paging (`eval_res` + versioning)

## Steps

1. **Transport** (small): add `execute_binding` + `list_functions` to web-server and tauri;
   add generic `callBinding` to `BackendProviderContext`; create `frontend/src/bindings.ts`
   typed wrapper module.
2. **Policy**: all new backend functions go through bindings only.
3. **First migration batch** (pure `locel + options -> JSON`): oc-declare discover / evaluate /
   activity-statistics / edge-statistics / template-string / project-arcs, `ocel/info`,
   `ocel/stats`. Path-schema endpoints can likely switch to the upstream bindings directly.
4. **Cleanup**: delete migrated routes/commands/mappings; port remaining pure endpoints
   opportunistically.

## Risks

- inventory registration requires the bindings' crate to be linked into both binaries
  (works via ctor; verify once in step 1).
- Error surface changes from typed HTTP statuses to `Result<_, String>` -> keep the wrapper
  mapping errors consistently.
- Registry `AppState` swap touches every `with_ocel_from_state` call site; do it as its own
  commit before migrating endpoints.
