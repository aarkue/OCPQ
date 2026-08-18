pub use process_mining;
use process_mining::{
    bindings::{self, RegistryItemKind},
    core::{
        event_data::case_centric::xes::{XESOuterLogData, XESParsingTraceStream},
        io::ExtensionWithMime,
    },
    EventLog, OCEL,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::RwLock;
pub mod artifact;
pub mod meta;
pub use meta::{ItemMeta, ItemRole, ObjMeta, Provenance};
pub use state::{Backend, ExtendedAppState};
pub mod state {
    use std::collections::HashMap;
    use std::ops::Deref;
    use std::{path::PathBuf, sync::RwLock};

    use process_mining::bindings::AppState;

    use serde::Serialize;

    use crate::artifact::OcpqArtifact;
    use crate::meta::ObjMeta;

    #[derive(Default)]
    pub struct ExtendedAppState {
        pub inner: AppState,
        pub meta: ObjMeta,
        pub files_to_import: RwLock<Vec<PathBuf>>,
        pub artifacts: RwLock<HashMap<String, OcpqArtifact>>,
        /// Insertion order of registry-object / artifact ids, kept because the underlying maps
        /// are unordered; reconciled lazily so the frontend gets a stable order. See `reconcile_order`.
        pub object_order: RwLock<Vec<String>>,
        pub artifact_order: RwLock<Vec<String>>,
    }
    /// Deref to the wrapped `AppState` so existing `.items` / `.add` / `.contains_key` call
    /// sites keep working unchanged; only the lifecycle policy (`.meta`) is new.
    impl Deref for ExtendedAppState {
        type Target = AppState;
        fn deref(&self) -> &AppState {
            &self.inner
        }
    }

    pub trait Backend {
        fn get_state(&self) -> &ExtendedAppState;
        fn emit<S: Serialize + Clone>(&self, name: &str, data: S) -> Result<(), String>;
    }
}

/// Single generic signal the frontend subscribes to so every surface refreshes whenever the
/// loaded-object set changes, regardless of which path mutated it.
fn emit_objects_changed<B: Backend>(backend: &B) {
    let _ = backend.emit("objects-changed", ());
}

/// Record that `id` now holds something other than what it held before.
///
/// Must be called by every path that writes over an existing id. `is_fresh` validates a cached
/// `{id}__as__{Kind}` conversion by comparing its recorded `source_gen` against the source's
/// current generation, so an id whose content is replaced without moving its generation keeps
/// serving the conversion of the *old* content -- every later query then silently answers from a
/// log that is no longer loaded. `rename_object` avoids this by deleting the conversions outright;
/// the load paths and a named binding output cannot, because they do not know what is cached, so
/// they move the generation and let the caches invalidate themselves.
///
/// The stale entries are dropped as well, so a replaced OCEL does not leave its conversion in
/// memory until the process exits.
fn mark_replaced(st: &ExtendedAppState, id: &str) {
    st.meta.bump_generation(id);
    let prefix = format!("{id}__as__");
    st.meta.remove_with_prefix(&prefix);
    if let Ok(mut items) = st.items.write() {
        let stale: Vec<String> = items
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect();
        for k in stale {
            items.remove(&k);
        }
    }
}

pub fn load_xes_object<B: Backend>(backend: &B, name: String, xes: EventLog) -> Result<(), String> {
    mark_replaced(backend.get_state(), &name);
    backend.get_state().add(name, xes);
    backend.emit("EventLog-import-finished", ())?;
    emit_objects_changed(backend);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EventLogStreamProgress {
    name: String,
    num_traces: usize,
    num_events: usize,
}

pub fn stream_load_xes_object<B: Backend>(
    backend: &B,
    name: String,
    mut trace_stream: XESParsingTraceStream,
    log_data: XESOuterLogData,
) -> Result<(), String> {
    let mut progress = EventLogStreamProgress {
        name: name.clone(),
        num_traces: 0,
        num_events: 0,
    };
    let traces: Vec<_> = trace_stream
        .inspect(|trace| {
            progress.num_traces += 1;
            progress.num_events += trace.events.len();
            // Do not send status updates for each trace
            if progress.num_events.is_multiple_of(221) {
                let _ = backend.emit("EventLog-import-progress", &progress);
            }
        })
        .collect();
    let _ = backend.emit("EventLog-import-finished", &progress);
    let xes = EventLog::from_traces_and_log_data(traces, log_data);
    mark_replaced(backend.get_state(), &name);
    backend.get_state().add(name, xes);
    emit_objects_changed(backend);
    Ok(())
}

pub fn load_ocel_object<B: Backend>(backend: &B, name: String, ocel: OCEL) -> Result<(), String> {
    mark_replaced(backend.get_state(), &name);
    backend.get_state().add(name.clone(), ocel);
    let _ = backend.emit("OCEL-import-finished", &name);
    emit_objects_changed(backend);
    Ok(())
}

pub fn unload_object<B: Backend>(backend: &B, name: String) -> Result<(), String> {
    let st = backend.get_state();
    st.meta.remove(&name);
    let _ = st.meta.remove_with_prefix(&format!("{name}__as__"));
    {
        let mut objects = st.items.write().map_err(|e| e.to_string())?;
        objects.remove(&name);
        let prefix = format!("{name}__as__");
        let derived: Vec<String> = objects
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect();
        for d in derived {
            objects.remove(&d);
        }
    }
    emit_objects_changed(backend);
    Ok(())
}

fn emit_artifacts_changed<B: Backend>(backend: &B) {
    let _ = backend.emit("artifacts-changed", ());
}

pub fn load_artifact_bytes<B: Backend>(
    backend: &B,
    id: String,
    kind: &str,
    bytes: &[u8],
    format: &str,
) -> Result<(), String> {
    let a = crate::artifact::OcpqArtifact::import_from_bytes(kind, bytes, format)?;
    backend
        .get_state()
        .artifacts
        .write()
        .map_err(|e| e.to_string())?
        .insert(id, a);
    emit_artifacts_changed(backend);
    Ok(())
}

pub fn load_artifact_path<B: Backend>(
    backend: &B,
    id: String,
    kind: &str,
    path: &str,
) -> Result<(), String> {
    let a = crate::artifact::OcpqArtifact::import_from_path(kind, path)?;
    backend
        .get_state()
        .artifacts
        .write()
        .map_err(|e| e.to_string())?
        .insert(id, a);
    emit_artifacts_changed(backend);
    Ok(())
}

pub fn list_artifacts<B: Backend>(backend: &B) -> Result<Vec<ObjectInfo>, String> {
    let st = backend.get_state();
    let m = st.artifacts.read().map_err(|e| e.to_string())?;
    let present: HashSet<String> = m.keys().cloned().collect();
    let ordered = reconcile_order(&st.artifact_order, &present);
    Ok(ordered
        .into_iter()
        .filter_map(|id| {
            m.get(&id).map(|a| ObjectInfo {
                kind: a.kind().to_string(),
                label: st.meta.label_of(&id),
                provenance: st.meta.provenance_of(&id),
                id,
            })
        })
        .collect())
}

pub fn get_artifact<B: Backend>(backend: &B, id: &str) -> Result<serde_json::Value, String> {
    let m = backend
        .get_state()
        .artifacts
        .read()
        .map_err(|e| e.to_string())?;
    m.get(id)
        .ok_or_else(|| "Artifact not found".to_string())?
        .to_json()
}

pub fn unload_artifact<B: Backend>(backend: &B, id: String) -> Result<(), String> {
    let st = backend.get_state();
    st.artifacts.write().map_err(|e| e.to_string())?.remove(&id);
    // The whole entry, not just the label, matching `unload_object`. Clearing only the label left
    // the role, generation and provenance behind, so a later import under the same id was reported
    // by `list_artifacts` as derived from the unloaded one's sources -- and a stale
    // `Derived`/`Result` role would additionally hide an object stored there from
    // `get_objects_with_type`.
    st.meta.remove(&id);
    emit_artifacts_changed(backend);
    Ok(())
}

pub fn export_artifact<B: Backend>(backend: &B, id: &str, format: &str) -> Result<Vec<u8>, String> {
    let m = backend
        .get_state()
        .artifacts
        .read()
        .map_err(|e| e.to_string())?;
    m.get(id)
        .ok_or_else(|| "Artifact not found".to_string())?
        .export_to_bytes(format)
}

/// Registry kinds an item of `kind` can be converted into, mirroring
/// `RegistryItem::convert`'s match arms; keep in sync if upstream adds a conversion.
pub fn convertible_to(kind: RegistryItemKind) -> Vec<RegistryItemKind> {
    use process_mining::bindings::RegistryItemKind::*;
    match kind {
        EventLog => vec![EventLogActivityProjection],
        OCEL => vec![IndexLinkedOCEL, SlimLinkedOCEL],
        IndexLinkedOCEL => vec![OCEL],
        SlimLinkedOCEL => vec![OCEL],
        EventLogActivityProjection => vec![],
        // A source is read by an extraction, never converted into a log directly.
        TabularSource => vec![],
        // `RegistryItem::convert` has no arm for a downstream handle type.
        Custom(_) => vec![],
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryItemInfo {
    pub kind: RegistryItemKind,
    pub import_formats: Vec<ExtensionWithMime>,
    pub export_formats: Vec<ExtensionWithMime>,
    pub convertible_to: Vec<RegistryItemKind>,
}
pub fn get_all_item_kinds() -> Result<Vec<RegistryItemInfo>, String> {
    Ok(bindings::RegistryItemKind::all_kinds()
        .iter()
        .map(|k| RegistryItemInfo {
            kind: *k,
            import_formats: k.known_import_formats(),
            export_formats: k.known_export_formats(),
            convertible_to: convertible_to(*k),
        })
        .collect())
}

/// Import/export formats for an OCPQ artifact kind (the non-registry, engine-stored values like
/// `PetriNet`). Parallels [`RegistryItemInfo`] so callers can treat both uniformly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactKindInfo {
    pub kind: String,
    pub import_formats: Vec<ExtensionWithMime>,
    pub export_formats: Vec<ExtensionWithMime>,
}
pub fn get_all_artifact_kinds() -> Vec<ArtifactKindInfo> {
    use crate::artifact::OcpqArtifact;
    OcpqArtifact::KINDS
        .iter()
        .map(|&kind| ArtifactKindInfo {
            kind: kind.to_string(),
            import_formats: OcpqArtifact::known_import_formats(kind),
            export_formats: OcpqArtifact::known_export_formats(kind),
        })
        .collect()
}

#[cfg(test)]
mod convert_pairs_tests {
    use super::convertible_to;
    use process_mining::bindings::RegistryItemKind::*;
    #[test]
    fn pairs_match_registryitem_convert_arms() {
        assert_eq!(convertible_to(EventLog), vec![EventLogActivityProjection]);
        assert_eq!(convertible_to(OCEL), vec![IndexLinkedOCEL, SlimLinkedOCEL]);
        assert_eq!(convertible_to(IndexLinkedOCEL), vec![OCEL]);
        assert_eq!(convertible_to(SlimLinkedOCEL), vec![OCEL]);
        assert_eq!(convertible_to(EventLogActivityProjection), Vec::new());
    }
}

pub fn load_item_bytes<B: Backend>(
    backend: &B,
    id: String,
    item_kind: &RegistryItemKind,
    data: &[u8],
    format: &str,
) -> Result<(), String> {
    let _ = backend.emit("import-started", &id);
    match bindings::RegistryItem::load_from_bytes(item_kind, data, format) {
        Ok(item) => {
            mark_replaced(backend.get_state(), &id);
            backend.get_state().add(id.clone(), item);
            let _ = backend.emit("import-finished", &id);
            emit_objects_changed(backend);
            Ok(())
        }
        Err(e) => {
            let _ = backend.emit("import-failed", serde_json::json!({ "id": id, "error": e }));
            Err(e)
        }
    }
}

pub fn load_item_path<B: Backend>(
    backend: &B,
    id: String,
    item_kind: &RegistryItemKind,
    path: &str,
) -> Result<(), String> {
    let _ = backend.emit("import-started", &id);
    match bindings::RegistryItem::load_from_path(item_kind, path) {
        Ok(item) => {
            mark_replaced(backend.get_state(), &id);
            backend.get_state().add(id.clone(), item);
            let _ = backend.emit("import-finished", &id);
            emit_objects_changed(backend);
            Ok(())
        }
        Err(e) => {
            let _ = backend.emit("import-failed", serde_json::json!({ "id": id, "error": e }));
            Err(e)
        }
    }
}

pub fn export_item_bytes<B: Backend>(
    backend: &B,
    id: &str,
    format: &str,
) -> Result<Vec<u8>, String> {
    let lock = backend
        .get_state()
        .items
        .read()
        .map_err(|e| e.to_string())?;
    if let Some(item) = lock.get(id) {
        item.export_to_bytes(format).map_err(|e| e.to_string())
    } else {
        Err("Item not found.".to_string())
    }
}

pub fn export_item_path<B: Backend>(backend: &B, id: &str, path: &str) -> Result<(), String> {
    let lock = backend
        .get_state()
        .items
        .read()
        .map_err(|e| e.to_string())?;
    if let Some(item) = lock.get(id) {
        item.export_to_path(path).map_err(|e| e.to_string())
    } else {
        Err("Item not found.".to_string())
    }
}

/// A loaded registry object as the frontend sees it: handle `id`, registry `kind`, and the
/// optional user-facing `label` (absent when the user never renamed it, so the UI shows the id).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ObjectInfo {
    pub id: String,
    pub kind: String,
    pub label: Option<String>,
    /// Recorded lineage when this object was produced by a binding (transform/discovery); absent for imports.
    pub provenance: Option<Provenance>,
}

/// The ids in `present`, in insertion order: drop remembered ids that are gone, append ones we
/// haven't seen. Gives the frontend a stable "newest last" order over the unordered stores.
fn reconcile_order(order_lock: &RwLock<Vec<String>>, present: &HashSet<String>) -> Vec<String> {
    let mut order = order_lock.write().unwrap();
    order.retain(|id| present.contains(id));
    // Append ids we have not seen. Normally one appears at a time (each add re-lists), so this is
    // plain insertion order; sorting only breaks ties when several first show up in the same call.
    let mut newcomers: Vec<&String> = present.iter().filter(|id| !order.contains(id)).collect();
    newcomers.sort();
    order.extend(newcomers.into_iter().cloned());
    order.clone()
}

pub fn get_objects_with_type<B: Backend>(backend: &B) -> Result<Vec<ObjectInfo>, String> {
    let st = backend.get_state();
    let meta = &st.meta;
    let objects = st.items.read().map_err(|e| e.to_string())?;
    let present: HashSet<String> = objects
        .iter()
        .filter(|(name, _)| !meta.is_hidden(name))
        .map(|(name, _)| name.clone())
        .collect();
    let ordered = reconcile_order(&st.object_order, &present);
    Ok(ordered
        .into_iter()
        .filter_map(|id| {
            objects.get(&id).map(|object| ObjectInfo {
                kind: object.kind().to_string(),
                label: meta.label_of(&id),
                provenance: meta.provenance_of(&id),
                id,
            })
        })
        .collect())
}

/// Set (or, when `label` is empty/blank, clear) the user-facing display label for object `id`;
/// emits `objects-changed` so every surface picks up the new name.
pub fn set_object_label<B: Backend>(
    backend: &B,
    id: String,
    label: Option<String>,
) -> Result<(), String> {
    let label = label.filter(|l| !l.trim().is_empty());
    backend.get_state().meta.set_label(&id, label);
    emit_objects_changed(backend);
    Ok(())
}

/// Move the object stored under `from` to `to`, taking its metadata with it and replacing whatever
/// `to` held. Lets a caller build a result under a scratch id and adopt it only once the work that
/// produced it succeeded, instead of overwriting a live object it might then fail to fill.
pub fn rename_object<B: Backend>(backend: &B, from: &str, to: &str) -> Result<(), String> {
    let st = backend.get_state();
    if from == to {
        return Ok(());
    }
    let from_prefix = format!("{from}__as__");
    let to_prefix = format!("{to}__as__");
    {
        let mut objects = st.items.write().map_err(|e| e.to_string())?;
        let item = objects
            .remove(from)
            .ok_or_else(|| format!("Object not found: {from}"))?;
        objects.insert(to.to_string(), item);
        // Both ids' cached `__as__` conversions were built from what those ids held before the
        // move, and the generation they were validated against did not change, so they would be
        // reused as if fresh. Drop them instead of leaving a stale conversion reachable.
        let stale: Vec<String> = objects
            .keys()
            .filter(|k| k.starts_with(&from_prefix) || k.starts_with(&to_prefix))
            .cloned()
            .collect();
        for k in stale {
            objects.remove(&k);
        }
    }
    st.meta.remove_with_prefix(&from_prefix);
    st.meta.remove_with_prefix(&to_prefix);
    st.meta.rename(from, to);
    emit_objects_changed(backend);
    Ok(())
}

pub fn export_object<B: Backend>(backend: &B, name: &str, format: &str) -> Result<Vec<u8>, String> {
    let lock = backend
        .get_state()
        .items
        .read()
        .map_err(|e| e.to_string())?;
    if let Some(object) = lock.get(name) {
        object.export_to_bytes(format).map_err(|e| e.to_string())
    } else {
        Err("Object not found".to_string())
    }
}

/// Export an object straight to a filesystem path, in an explicitly named `format`.
///
/// Not covered by [`export_object`]: the OCEL 2.0 bundled format's uncompressed form is a
/// directory, which has no byte stream at all. It also keeps a large log from being materialised
/// in memory just to cross an IPC boundary.
pub fn export_object_to_path<B: Backend>(
    backend: &B,
    name: &str,
    format: &str,
    path: &str,
) -> Result<(), String> {
    let lock = backend
        .get_state()
        .items
        .read()
        .map_err(|e| e.to_string())?;
    if let Some(object) = lock.get(name) {
        object.export_to_path_as(path, format)
    } else {
        Err("Object not found".to_string())
    }
}

pub fn list_functions() -> Vec<bindings::BindingMeta> {
    bindings::list_functions_meta()
}

/// A single planned argument conversion: the item referenced by `arg_name` (`src_id`) should be
/// materialized as `derived_id` of `target_kind`, and the argument swapped to point at it.
pub struct ConvPlan {
    pub arg_name: String,
    pub src_id: String,
    pub target_kind: String,
    pub derived_id: String,
}

/// Pure planner: for each registry-ref argument whose passed id has a different but convertible
/// kind, plan a conversion to the wanted kind. `kind_of` maps a stored id to its current kind.
pub fn plan_conversions(
    args: &Value,
    arg_schemas: &[(String, Value)],
    kind_of: impl Fn(&str) -> Option<String>,
) -> Vec<ConvPlan> {
    let mut out = Vec::new();
    let obj = match args.as_object() {
        Some(o) => o,
        None => return out,
    };
    for (name, schema) in arg_schemas {
        let want = match schema.get("x-registry-ref").and_then(|v| v.as_str()) {
            Some(w) => w,
            None => continue,
        };
        let id = match obj.get(name).and_then(|v| v.as_str()) {
            Some(i) => i,
            None => continue,
        };
        let have = match kind_of(id) {
            Some(h) => h,
            None => continue,
        };
        if have == want {
            continue;
        }
        let have_kind: RegistryItemKind = match have.parse() {
            Ok(k) => k,
            Err(_) => continue,
        };
        let want_kind: RegistryItemKind = match want.parse() {
            Ok(k) => k,
            Err(_) => continue,
        };
        if !convertible_to(have_kind).contains(&want_kind) {
            continue;
        }
        out.push(ConvPlan {
            arg_name: name.clone(),
            src_id: id.to_string(),
            target_kind: want.to_string(),
            derived_id: format!("{id}__as__{want}"),
        });
    }
    out
}

/// Ids of the args whose schema is a registry reference (`x-registry-ref`).
pub fn registry_ref_arg_ids(args: &Value, arg_schemas: &[(String, Value)]) -> Vec<String> {
    let obj = match args.as_object() {
        Some(o) => o,
        None => return Vec::new(),
    };
    arg_schemas
        .iter()
        .filter(|(_, schema)| {
            schema
                .get("x-registry-ref")
                .and_then(|v| v.as_str())
                .is_some()
        })
        .filter_map(|(name, _)| obj.get(name).and_then(|v| v.as_str()).map(String::from))
        .collect()
}

/// `None` when the call reads no registry objects.
pub fn build_provenance(
    function_id: &str,
    args: &Value,
    arg_schemas: &[(String, Value)],
    gen_of: impl Fn(&str) -> u64,
) -> Option<Provenance> {
    let sources = registry_ref_arg_ids(args, arg_schemas);
    if sources.is_empty() {
        return None;
    }
    let source_gen = sources.iter().map(|id| gen_of(id)).max().unwrap_or(0);
    let op = serde_json::json!({ "fn": function_id, "args": args });
    Some(Provenance {
        sources,
        op,
        source_gen,
    })
}

/// Whether the cached derived object `derived_id` was built from the current generation of its
/// source (so it can be reused instead of rebuilt).
fn is_fresh(meta: &ObjMeta, derived_id: &str, src_gen: u64) -> bool {
    meta.provenance_source_gen(derived_id) == Some(src_gen)
}

/// Marks a schema as naming a registry object rather than carrying its value.
const REGISTRY_REF: &str = "x-registry-ref";

/// The argument every binding whose result is stored in the registry takes, to store it under a
/// caller-chosen id instead of a generated one.
const OUTPUT_ID_ARG: &str = "output_id";

pub fn execute_binding<B: Backend>(
    backend: &B,
    function_id: &str,
    args: &Value,
    output_name: Option<&str>,
) -> Result<Vec<u8>, String> {
    let binding =
        bindings::get_fn_binding(function_id).ok_or_else(|| "Unknown function ID".to_string())?;
    let st = backend.get_state();
    let arg_schemas = (binding.args)();
    // Provenance sources are the user-supplied ids, captured before the __as__ conversion below may
    // rewrite an arg to point at a hidden derived object.
    let original_args = args.clone();
    let mut args = args.clone();

    // Transparently convert registry-ref arguments whose passed object is of a different but
    // convertible kind, caching the result as a hidden `{src}__as__{Kind}` derived item.
    let plans = {
        let kind_of = |id: &str| {
            st.items
                .read()
                .ok()
                .and_then(|m| m.get(id).map(|i| i.kind().to_string()))
        };
        plan_conversions(&args, &arg_schemas, kind_of)
    };
    for p in &plans {
        let src_gen = st.meta.generation_of(&p.src_id);
        if !st.contains_key(&p.derived_id) || !is_fresh(&st.meta, &p.derived_id, src_gen) {
            let converted = {
                let items = st.items.read().map_err(|e| e.to_string())?;
                let item = items.get(&p.src_id).ok_or("source not found")?;
                item.convert(p.target_kind.parse()?)?
            };
            st.add(p.derived_id.clone(), converted);
            st.meta.set(
                &p.derived_id,
                ItemMeta {
                    role: ItemRole::Derived,
                    generation: 0,
                    provenance: Some(Provenance {
                        sources: vec![p.src_id.clone()],
                        op: format!("convert:{}", p.target_kind).into(),
                        source_gen: src_gen,
                    }),
                },
            );
        }
        if let Some(obj) = args.as_object_mut() {
            obj.insert(p.arg_name.clone(), Value::String(p.derived_id.clone()));
        }
    }

    // A binding whose result goes into the registry says so on its return schema and takes an
    // `output_id`, so a caller-chosen name is honoured by the store itself: the result lands under
    // that id and nothing has to be re-keyed afterwards.
    let stores_result = (binding.return_type)().get(REGISTRY_REF).is_some();
    if stores_result {
        if let (Some(name), Some(obj)) = (output_name, args.as_object_mut()) {
            obj.insert(OUTPUT_ID_ARG.to_string(), Value::String(name.to_string()));
        }
    }

    let result = bindings::call(binding, &args, &st.inner);

    if let (true, Ok(bytes)) = (stores_result, &result) {
        emit_objects_changed(backend);
        if let Ok(id) = serde_json::from_slice::<String>(bytes) {
            if st.contains_key(&id) {
                // A named output writes over whatever that id held, so it is a replacement like any
                // import: without this the id keeps its generation and every cached
                // `{id}__as__{Kind}` conversion of the *previous* content still validates as fresh.
                mark_replaced(st, &id);
                // Keep the role the id already carries -- `Primary` for a fresh one. A named output
                // is the dataset the caller asked for, so it stays listed; only the machine-minted
                // `__as__` conversions above are hidden.
                st.meta.set(
                    &id,
                    ItemMeta {
                        role: st.meta.role_of(&id),
                        generation: st.meta.generation_of(&id),
                        provenance: build_provenance(
                            function_id,
                            &original_args,
                            &arg_schemas,
                            |i| st.meta.generation_of(i),
                        ),
                    },
                );
            }
        }
    }
    result
}

#[cfg(test)]
mod convert_dispatch_tests {
    use super::{build_provenance, plan_conversions, registry_ref_arg_ids};
    use serde_json::json;

    fn schemas() -> Vec<(String, serde_json::Value)> {
        vec![("locel".into(), json!({ "x-registry-ref": "SlimLinkedOCEL" }))]
    }

    #[test]
    fn collects_registry_ref_arg_ids() {
        let schemas = vec![
            ("ocel".to_string(), json!({ "x-registry-ref": "OCEL" })),
            ("object_types".to_string(), json!({ "type": "array" })),
        ];
        let args = json!({ "ocel": "ocel1", "object_types": [] });
        assert_eq!(
            registry_ref_arg_ids(&args, &schemas),
            vec!["ocel1".to_string()]
        );
        let plain = vec![("n".to_string(), json!({ "type": "number" }))];
        assert!(registry_ref_arg_ids(&json!({ "n": 1 }), &plain).is_empty());
    }

    #[test]
    fn builds_provenance_from_registry_args() {
        let schemas = vec![("ocel".to_string(), json!({ "x-registry-ref": "OCEL" }))];
        let args = json!({ "ocel": "ocel1", "object_types": ["order"] });
        let p = build_provenance("filter_ocel_object_types", &args, &schemas, |id| {
            if id == "ocel1" {
                3
            } else {
                0
            }
        })
        .unwrap();
        assert_eq!(p.sources, vec!["ocel1".to_string()]);
        assert_eq!(p.source_gen, 3);
        assert_eq!(p.op["fn"], "filter_ocel_object_types");
        assert_eq!(p.op["args"], args);
    }

    #[test]
    fn no_provenance_without_registry_args() {
        let schemas = vec![("x".to_string(), json!({ "type": "number" }))];
        assert!(build_provenance("f", &json!({ "x": 1 }), &schemas, |_| 0).is_none());
    }

    #[test]
    fn plans_conversion_when_kind_differs_and_convertible() {
        let args = json!({ "locel": "myocel" });
        let plans = plan_conversions(&args, &schemas(), |id| {
            if id == "myocel" {
                Some("OCEL".into())
            } else {
                None
            }
        });
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].derived_id, "myocel__as__SlimLinkedOCEL");
        assert_eq!(plans[0].src_id, "myocel");
        assert_eq!(plans[0].target_kind, "SlimLinkedOCEL");
    }

    #[test]
    fn no_plan_when_kind_matches() {
        let args = json!({ "locel": "p" });
        let plans = plan_conversions(&args, &schemas(), |_| Some("SlimLinkedOCEL".into()));
        assert!(plans.is_empty());
    }

    #[test]
    fn no_plan_when_arg_is_not_a_known_id() {
        let args = json!({ "locel": "p" });
        let plans = plan_conversions(&args, &schemas(), |_| None);
        assert!(plans.is_empty());
    }

    #[test]
    fn no_plan_for_non_registry_arg() {
        let args = json!({ "threshold": 0.5 });
        let schemas = vec![("threshold".into(), json!({ "type": "number" }))];
        let plans = plan_conversions(&args, &schemas, |_| Some("OCEL".into()));
        assert!(plans.is_empty());
    }
}

#[cfg(test)]
mod artifact_store_tests {
    use super::*;
    use std::sync::Mutex;

    struct StubBackend {
        state: ExtendedAppState,
        events: Mutex<Vec<String>>,
    }
    impl Backend for StubBackend {
        fn get_state(&self) -> &ExtendedAppState {
            &self.state
        }
        fn emit<S: serde::Serialize + Clone>(&self, name: &str, _data: S) -> Result<(), String> {
            self.events.lock().unwrap().push(name.to_string());
            Ok(())
        }
    }
    fn backend() -> StubBackend {
        StubBackend {
            state: ExtendedAppState::default(),
            events: Mutex::new(Vec::new()),
        }
    }
    const PNML: &str = r#"<?xml version="1.0"?><pnml><net id="n" type="http://www.pnml.org/version-2009/grammar/pnmlcoremodel"><page id="p0"><place id="p1"/><transition id="t1"/></page></net></pnml>"#;

    #[test]
    fn load_list_get_unload_artifact() {
        let b = backend();
        load_artifact_bytes(&b, "net1".into(), "PetriNet", PNML.as_bytes(), "pnml").unwrap();
        assert_eq!(
            list_artifacts(&b).unwrap(),
            vec![ObjectInfo {
                id: "net1".to_string(),
                kind: "PetriNet".to_string(),
                label: None,
                provenance: None,
            }]
        );
        assert!(get_artifact(&b, "net1").unwrap().get("places").is_some());
        assert!(b
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|e| e == "artifacts-changed"));
        unload_artifact(&b, "net1".into()).unwrap();
        assert!(list_artifacts(&b).unwrap().is_empty());
    }

    #[test]
    fn export_artifact_round_trips() {
        let b = backend();
        load_artifact_bytes(&b, "n".into(), "PetriNet", PNML.as_bytes(), "pnml").unwrap();
        let bytes = export_artifact(&b, "n", "pnml").unwrap();
        assert!(!bytes.is_empty());
    }

    const LOCEL_NEW: &str = "process_mining::bindings::slim_ocel_bindings::locel_new";

    fn handle(bytes: &[u8]) -> String {
        serde_json::from_slice(bytes).expect("a handle id")
    }

    fn listed_ids<B: Backend>(b: &B) -> Vec<String> {
        get_objects_with_type(b)
            .expect("objects")
            .into_iter()
            .map(|o| o.id)
            .collect()
    }

    /// `output_name` names the stored result; it is not a hiding flag. The object the caller asked
    /// for lands under exactly that id and stays a listed dataset -- it used to be re-keyed after
    /// the fact and stamped `Result`, which `get_objects_with_type` hides, so a freshly extracted
    /// log was reported as "no log loaded". Pin both halves.
    #[test]
    fn a_named_binding_output_lands_under_that_id_and_is_listed() {
        let b = backend();
        let unnamed_id =
            handle(&execute_binding(&b, LOCEL_NEW, &serde_json::json!({}), None).unwrap());
        assert!(unnamed_id.starts_with("res_"), "got {unnamed_id}");

        let named_id = handle(
            &execute_binding(&b, LOCEL_NEW, &serde_json::json!({}), Some("named-output")).unwrap(),
        );
        assert_eq!(named_id, "named-output", "the caller's id is the result");

        let listed = listed_ids(&b);
        assert!(listed.contains(&unnamed_id), "got {listed:?}");
        assert!(
            listed.contains(&"named-output".to_string()),
            "got {listed:?}"
        );
    }

    /// Re-running a named step overwrites its previous output instead of accumulating one object
    /// per run, which is what lets a panel keep a fixed id for the thing it is showing.
    #[test]
    fn re_running_a_named_step_replaces_its_previous_output() {
        let b = backend();
        for _ in 0..3 {
            execute_binding(&b, LOCEL_NEW, &serde_json::json!({}), Some("fixed")).unwrap();
        }
        assert_eq!(listed_ids(&b), vec!["fixed".to_string()]);
    }

    /// The transports' `output_name` channel and the binding's own `output_id` argument are the
    /// same mechanism, so a caller that has the typed argument need not reach for the channel.
    #[test]
    fn output_id_passed_as_an_argument_names_the_result_too() {
        let b = backend();
        let id = handle(
            &execute_binding(
                &b,
                LOCEL_NEW,
                &serde_json::json!({ "output_id": "from-args" }),
                None,
            )
            .unwrap(),
        );
        assert_eq!(id, "from-args");
        assert!(listed_ids(&b).contains(&"from-args".to_string()));
    }

    fn empty_ocel() -> process_mining::OCEL {
        process_mining::OCEL {
            event_types: Vec::new(),
            object_types: Vec::new(),
            events: Vec::new(),
            objects: Vec::new(),
        }
    }

    /// The point of the whole operation: a result built under a scratch id becomes the object the
    /// fixed id names, label and provenance included, and the scratch id stops existing.
    #[test]
    fn rename_moves_the_object_its_label_and_its_provenance() {
        let b = backend();
        execute_binding(&b, LOCEL_NEW, &serde_json::json!({}), Some("scratch")).unwrap();
        set_object_label(&b, "scratch".into(), Some("Extracted".into())).unwrap();
        b.get_state().add("ocel".to_string(), empty_ocel());

        rename_object(&b, "scratch", "ocel").unwrap();

        let listed = get_objects_with_type(&b).unwrap();
        assert_eq!(listed.iter().map(|o| &o.id).collect::<Vec<_>>(), ["ocel"]);
        assert_eq!(
            listed[0].kind, "SlimLinkedOCEL",
            "the moved item, not the old"
        );
        assert_eq!(listed[0].label.as_deref(), Some("Extracted"));
        assert!(b
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|e| e == "objects-changed"));
    }

    /// A failed run must not take the loaded object with it, so a rename of something that is not
    /// there fails loudly and leaves the destination alone.
    #[test]
    fn rename_of_a_missing_source_errors_and_keeps_the_destination() {
        let b = backend();
        b.get_state().add("ocel".to_string(), empty_ocel());
        let err = rename_object(&b, "scratch", "ocel").unwrap_err();
        assert!(err.contains("scratch"), "got {err}");
        assert_eq!(listed_ids(&b), vec!["ocel".to_string()]);
    }

    /// The `{id}__as__{Kind}` caches of both ids describe items neither id holds any more, and the
    /// generation they were validated against did not move, so they have to go.
    #[test]
    fn rename_evicts_the_cached_conversions_of_both_ids() {
        let b = backend();
        let st = b.get_state();
        st.add("scratch".to_string(), empty_ocel());
        st.add("scratch__as__SlimLinkedOCEL".to_string(), empty_ocel());
        st.add("ocel".to_string(), empty_ocel());
        st.add("ocel__as__SlimLinkedOCEL".to_string(), empty_ocel());
        for id in ["scratch__as__SlimLinkedOCEL", "ocel__as__SlimLinkedOCEL"] {
            st.meta.set(
                id,
                ItemMeta {
                    role: ItemRole::Derived,
                    generation: 0,
                    provenance: None,
                },
            );
        }

        rename_object(&b, "scratch", "ocel").unwrap();

        assert!(!st.contains_key("scratch__as__SlimLinkedOCEL"));
        assert!(!st.contains_key("ocel__as__SlimLinkedOCEL"));
        assert!(st.contains_key("ocel"));
    }

    #[test]
    fn renaming_an_id_onto_itself_is_a_no_op() {
        let b = backend();
        b.get_state().add("ocel".to_string(), empty_ocel());
        rename_object(&b, "ocel", "ocel").unwrap();
        assert_eq!(listed_ids(&b), vec!["ocel".to_string()]);
    }

    #[test]
    fn listing_carries_provenance() {
        let b = backend();
        load_artifact_bytes(&b, "net1".into(), "PetriNet", PNML.as_bytes(), "pnml").unwrap();
        b.get_state().meta.set(
            "net1",
            ItemMeta {
                role: ItemRole::Primary,
                generation: 0,
                provenance: Some(Provenance {
                    sources: vec!["ocel1".into()],
                    op: "op".into(),
                    source_gen: 0,
                }),
            },
        );
        let listed = list_artifacts(&b).unwrap();
        let info = listed.iter().find(|o| o.id == "net1").expect("net1 listed");
        assert_eq!(
            info.provenance.as_ref().unwrap().sources,
            vec!["ocel1".to_string()]
        );
    }
}

#[cfg(test)]
mod provenance_dispatch_tests {
    use super::*;
    use process_mining::bindings::register_binding;
    use serde_json::json;
    use std::sync::Mutex;

    #[register_binding]
    fn test_clone_ocel(ocel: &process_mining::OCEL) -> process_mining::OCEL {
        ocel.clone()
    }

    struct B {
        state: ExtendedAppState,
        events: Mutex<Vec<String>>,
    }
    impl Backend for B {
        fn get_state(&self) -> &ExtendedAppState {
            &self.state
        }
        fn emit<S: serde::Serialize + Clone>(&self, name: &str, _data: S) -> Result<(), String> {
            self.events.lock().unwrap().push(name.to_string());
            Ok(())
        }
    }

    #[test]
    fn records_provenance_for_produced_object() {
        let b = B {
            state: ExtendedAppState::default(),
            events: Mutex::new(Vec::new()),
        };
        b.get_state().add(
            "ocel1".to_string(),
            process_mining::OCEL {
                event_types: Vec::new(),
                object_types: Vec::new(),
                events: Vec::new(),
                objects: Vec::new(),
            },
        );
        // The test binding's registry id is compiler-decided; find it by suffix.
        let fid = list_functions()
            .into_iter()
            .map(|f| f.id)
            .find(|id| id.ends_with("test_clone_ocel"))
            .expect("test binding registered");
        let out = execute_binding(&b, &fid, &json!({ "ocel": "ocel1" }), None).unwrap();
        let new_id: String = serde_json::from_slice(&out).unwrap();
        let prov = b
            .get_state()
            .meta
            .provenance_of(&new_id)
            .expect("provenance recorded");
        assert_eq!(prov.sources, vec!["ocel1".to_string()]);
        assert!(prov.op["fn"].as_str().unwrap().ends_with("test_clone_ocel"));
    }
}
