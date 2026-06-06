pub mod resolver;

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    sync::{Arc, RwLock},
    usize,
};

use cel_interpreter::{
    extractors::This, objects::Map, Context, ExecutionError, FunctionContext, Program,
    ResolveResult, Value,
};
use chrono::{DateTime, FixedOffset, Local};
use itertools::Itertools;
use once_cell::sync::Lazy;
use process_mining::core::event_data::object_centric::{
    linked_ocel::{
        slim_linked_ocel::{EventIndex, ObjectIndex},
        LinkedOCELAccess, SlimLinkedOCEL,
    },
    OCELAttributeValue,
};

use crate::binding_box::{
    structs::{EventVariable, LabelFunction, LabelValue, ObjectVariable, Variable},
    Binding, ViolationReason,
};

// Thread-local handle to the current resolver. Set by `evaluate_cel` /
// `evaluate_cel_id` for the duration of the CEL execution; cleared after.
// Closures inside `Context<'static>` read the resolver from here, so the
// per-thread cache (`CEL_BASE_CTX`) can be shared across calls even when the
// underlying resolver changes: the closures dereference the current handle,
// not a captured pointer.
//
// Safety: each closure is invoked synchronously from `Program::execute`, which
// runs on the same thread that called `evaluate_cel`. The resolver Rc is alive
// for the duration of `execute`. Closures take `&self` on the resolver through
// `with_resolver`; no borrows escape.
thread_local! {
    static CURRENT_RESOLVER: RefCell<Option<std::rc::Rc<&'static dyn resolver::Resolver>>> =
        const { RefCell::new(None) };
}

/// Replace the thread-local resolver handle for the duration of `f`.
/// Restores the previous handle on return so nested calls (CEL inside
/// CEL, e.g. AdvancedCEL re-entering) behave correctly.
fn with_resolver<R>(resolver: &dyn resolver::Resolver, f: impl FnOnce() -> R) -> R {
    // Lifetime erase: the resolver is 'a, but the thread_local can
    // only hold 'static. We restore the slot before `f` returns, so
    // the erased borrow never outlives the actual resolver.
    let erased: &'static dyn resolver::Resolver =
        unsafe { std::mem::transmute::<&dyn resolver::Resolver, _>(resolver) };
    let prev = CURRENT_RESOLVER.with(|c| c.replace(Some(std::rc::Rc::new(erased))));
    struct Guard {
        prev: Option<std::rc::Rc<&'static dyn resolver::Resolver>>,
    }
    impl Drop for Guard {
        fn drop(&mut self) {
            CURRENT_RESOLVER.with(|c| {
                c.replace(self.prev.take());
            });
        }
    }
    let _g = Guard { prev };
    f()
}

fn current_resolver_call<R>(f: impl FnOnce(&dyn resolver::Resolver) -> R) -> R {
    CURRENT_RESOLVER.with(|c| {
        let borrowed = c.borrow();
        let r = borrowed
            .as_ref()
            .expect("CEL closure called outside with_resolver scope");
        f(**r)
    })
}

pub static CEL_PROGRAM_CACHE: Lazy<RwLock<HashMap<String, Program>>> = Lazy::new(|| {
    let m = HashMap::new();
    RwLock::new(m)
});

pub fn lazy_compile_and_insert_into_cache(cel: &str) -> Result<(), String> {
    let already_in_cache = CEL_PROGRAM_CACHE.read().unwrap().contains_key(cel);
    if !already_in_cache {
        let program = Program::compile(cel).map_err(|e| format!("Failed to compile CEL: {e}"))?;
        let mut w_lock = CEL_PROGRAM_CACHE.write().unwrap();
        w_lock.insert(cel.to_string(), program);
    }
    Ok(())
}

pub fn ev_var_to_name(ev_var: &EventVariable) -> String {
    format!("e{}", ev_var.0 + 1)
}
pub fn ob_var_to_name(ob_var: &ObjectVariable) -> String {
    format!("o{}", ob_var.0 + 1)
}

pub fn ev_index_to_name(ev_index: &EventIndex) -> String {
    format!("ev_{}", ev_index.into_inner())
}
pub fn ob_index_to_name(ob_index: &ObjectIndex) -> String {
    format!("ob_{}", ob_index.into_inner())
}

thread_local! {
    static CEL_BASE_CTX: RefCell<Option<(CelCacheKey, Context<'static>)>> = const { RefCell::new(None) };

    static EV_INDEX_NAME_CACHE: RefCell<Option<IndexNameCache>> = const { RefCell::new(None) };
    static OB_INDEX_NAME_CACHE: RefCell<Option<IndexNameCache>> = const { RefCell::new(None) };
}

struct IndexNameCache {
    key: CelCacheKey,
    names: Vec<Option<Arc<String>>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct CelCacheKey {
    ptr: usize,
    num_evs: usize,
    num_obs: usize,
}

impl CelCacheKey {
    fn from_ocel(ocel: &SlimLinkedOCEL) -> Self {
        Self {
            ptr: ocel as *const _ as usize,
            num_evs: ocel.get_all_evs().count(),
            num_obs: ocel.get_all_obs().count(),
        }
    }
    fn from_resolver(r: &dyn resolver::Resolver) -> Self {
        // Thin-pointer identity over a fat trait-object reference.
        // Two impls that share an address are unlikely (they would have to
        // be the same instance); the auxiliary num_evs / num_obs fields
        // pin the cache key further so a slim_locel and an id_backed_ocel
        // that incidentally land at the same address still get distinct
        // cache slots (different counts).
        let raw: *const dyn resolver::Resolver = r;
        Self {
            ptr: raw as *const () as usize,
            num_evs: r.num_events() as usize,
            num_obs: r.num_objects() as usize,
        }
    }
}

fn cached_ev_index_name(idx: &EventIndex, key: CelCacheKey) -> Arc<String> {
    EV_INDEX_NAME_CACHE.with(|cell| {
        let mut slot = cell.borrow_mut();
        let cache = slot.get_or_insert_with(|| IndexNameCache {
            key,
            names: vec![None; key.num_evs],
        });
        if cache.key != key {
            cache.key = key;
            cache.names = vec![None; key.num_evs];
        }
        let inner = idx.into_inner();
        let i = inner as usize;
        if i >= cache.names.len() {
            cache.names.resize(i + 1, None);
        }
        cache.names[i]
            .get_or_insert_with(|| Arc::new(format!("ev_{inner}")))
            .clone()
    })
}

fn cached_ob_index_name(idx: &ObjectIndex, key: CelCacheKey) -> Arc<String> {
    OB_INDEX_NAME_CACHE.with(|cell| {
        let mut slot = cell.borrow_mut();
        let cache = slot.get_or_insert_with(|| IndexNameCache {
            key,
            names: vec![None; key.num_obs],
        });
        if cache.key != key {
            cache.key = key;
            cache.names = vec![None; key.num_obs];
        }
        let inner = idx.into_inner();
        let i = inner as usize;
        if i >= cache.names.len() {
            cache.names.resize(i + 1, None);
        }
        cache.names[i]
            .get_or_insert_with(|| Arc::new(format!("ob_{inner}")))
            .clone()
    })
}

/// Build the per-(thread, resolver) CEL execution context. The
/// resolver is held via a raw `*const dyn Resolver` so the closures
/// can be `'static` (cel-interpreter requires it). Safety contract:
/// callers must keep the underlying resolver alive for the duration
/// of every CEL execution that uses the resulting context. The
/// `CEL_BASE_CTX` cache invalidates whenever the resolver pointer
/// changes (`CelCacheKey`), so stale contexts cannot outlive their
/// resolver.
fn build_base_cel_context() -> Context<'static> {
    let mut context: Context<'static> = Context::default();

    context.add_function(
        "type",
        |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
            current_resolver_call(|r| {
                if let Some(ev) = r.get_event(&variable) {
                    return Ok(ev.event_type.into());
                }
                if let Some(ob) = r.get_object(&variable) {
                    return Ok(ob.object_type.into());
                }
                ftx.error("Event or Object not found.").into()
            })
        },
    );

    context.add_function("min", |cel_interpreter::extractors::Arguments(args): cel_interpreter::extractors::Arguments| -> Result<Value,ExecutionError> {
            let items = if args.len() == 1 {
                match &args[0] {
                    Value::List(values) => values,
                    _ => return Ok(args[0].clone()),
                }
            } else {
                &args
            };
            items
                .iter()
                .skip(1)
                .try_fold(items.first().unwrap_or(&Value::Null), |acc, x| {
                    match acc.partial_cmp(x) {
                        Some(std::cmp::Ordering::Less) => Ok(acc),
                        Some(_) => Ok(x),
                        None => Err(ExecutionError::ValuesNotComparable(acc.clone(), x.clone())),
                    }
                })
                .cloned()
        });

    context.add_function(
        "attr",
        |ftx: &FunctionContext,
         This(variable): This<Arc<String>>,
         attr_name: Arc<String>|
         -> ResolveResult {
            current_resolver_call(|r| {
                let attr_val = if let Some(ev) = r.get_event(&variable) {
                    ev.attributes
                        .into_iter()
                        .find(|a| &a.name == attr_name.as_ref())
                        .map(|a| a.value)
                        .unwrap_or(OCELAttributeValue::Null)
                } else if let Some(ob) = r.get_object(&variable) {
                    ob.attributes
                        .into_iter()
                        .find(|a| &a.name == attr_name.as_ref())
                        .map(|a| a.value)
                        .unwrap_or(OCELAttributeValue::Null)
                } else {
                    return ftx.error("Event or Object not found.").into();
                };
                Ok(ocel_val_to_cel_val(attr_val))
            })
        },
    );

    context.add_function(
        "attrAt",
        |ftx: &FunctionContext,
         This(variable): This<Arc<String>>,
         attr_name: Arc<String>,
         at: DateTime<FixedOffset>|
         -> ResolveResult {
            current_resolver_call(|r| {
                let attr_val = if let Some(ev) = r.get_event(&variable) {
                    ev.attributes
                        .into_iter()
                        .find(|a| &a.name == attr_name.as_ref())
                        .map(|a| a.value)
                        .unwrap_or(OCELAttributeValue::Null)
                } else if let Some(ob) = r.get_object(&variable) {
                    ob.attributes
                        .into_iter()
                        .filter(|a| &a.name == attr_name.as_ref())
                        .sorted_by_key(|a| a.time)
                        .rfind(|a| a.time <= at)
                        .map(|a| a.value)
                        .unwrap_or(OCELAttributeValue::Null)
                } else {
                    return ftx.error("Event or Object not found.").into();
                };
                Ok(ocel_val_to_cel_val(attr_val))
            })
        },
    );

    context.add_function(
        "id",
        |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
            current_resolver_call(|r| {
                if let Some(ev) = r.get_event(&variable) {
                    return Ok(ev.id.into());
                }
                if let Some(ob) = r.get_object(&variable) {
                    return Ok(ob.id.into());
                }
                ftx.error("Event or Object not found.").into()
            })
        },
    );

    context.add_function(
        "attrs",
        |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
            current_resolver_call(|r| {
                let attr_val: Vec<Vec<Value>> = if let Some(ev) = r.get_event(&variable) {
                    ev.attributes
                        .into_iter()
                        .map(|a| {
                            vec![
                                a.name.clone().into(),
                                ocel_val_to_cel_val(a.value),
                                Value::Null,
                            ]
                        })
                        .collect()
                } else if let Some(ob) = r.get_object(&variable) {
                    ob.attributes
                        .into_iter()
                        .map(|a| {
                            vec![
                                a.name.clone().into(),
                                ocel_val_to_cel_val(a.value),
                                a.time.fixed_offset().into(),
                            ]
                        })
                        .collect()
                } else {
                    return ftx.error("Event or Object not found.").into();
                };
                Ok(attr_val.into())
            })
        },
    );

    context.add_function(
        "time",
        |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
            current_resolver_call(|r| match r.get_event_time(&variable) {
                Some(t) => Ok(t.into()),
                None => ftx.error("Event not found.").into(),
            })
        },
    );

    context.add_function("numEvents", || -> ResolveResult {
        current_resolver_call(|r| Ok(r.num_events().into()))
    });
    context.add_function("numObjects", || -> ResolveResult {
        current_resolver_call(|r| Ok(r.num_objects().into()))
    });

    // `events()` / `objects()` are rejected at translation time by
    // `db_translation::validate_translatable` (they enumerate the full
    // dataset id list, which has no row-context analogue on SQL
    // backends). The closures here exist only to preserve the in-mem
    // engine's prior behaviour; they error out conservatively rather
    // than returning a partial list.
    context.add_function("events", move |ftx: &FunctionContext| -> ResolveResult {
        ftx.error("events() builtin is not supported by the row-context evaluator; the in-mem path that previously enumerated all events has been replaced. Use a per-binding CEL filter instead.").into()
    });
    context.add_function("objects", move |ftx: &FunctionContext| -> ResolveResult {
        ftx.error("objects() builtin is not supported by the row-context evaluator; see events() builtin notes.").into()
    });

    context.add_function(
        "sum",
        move |_ftx: &FunctionContext, This(variable): This<Arc<Vec<Value>>>| -> ResolveResult {
            Ok(variable.iter().map(value_to_float).sum::<f64>().into())
        },
    );

    context.add_function(
        "avg",
        move |_ftx: &FunctionContext, This(variable): This<Arc<Vec<Value>>>| -> ResolveResult {
            let (count, sum) = variable
                .iter()
                .map(value_to_float)
                .fold((0_usize, 0.0), |(count, sum), f| (count + 1, sum + f));
            Ok((sum / count as f64).into())
        },
    );
    context
}

pub fn evaluate_cel<'a>(
    cel: &str,
    binding: &'a Binding,
    child_res: Option<&HashMap<String, Vec<(Arc<Binding>, Option<ViolationReason>)>>>,
    ocel: &'a SlimLinkedOCEL,
) -> Result<Value, CELEvalError> {
    lazy_compile_and_insert_into_cache(cel).map_err(CELEvalError::ParseError)?;
    let cache_read = CEL_PROGRAM_CACHE.read().unwrap();
    let p = match cache_read.get(cel) {
        Some(p) => p,
        None => {
            return Err(CELEvalError::ParseError(String::from(
                "Could not parse CEL",
            )))
        }
    };

    let r = resolver::SlimLinkedOCELResolver::new(ocel);
    let ocel_key = CelCacheKey::from_ocel(ocel);

    with_resolver(&r, || CEL_BASE_CTX.with(|cell| {
        let needs_rebuild = cell
            .borrow()
            .as_ref()
            .map(|(k, _)| *k != ocel_key)
            .unwrap_or(true);
        if needs_rebuild {
            *cell.borrow_mut() = Some((ocel_key, build_base_cel_context()));
        }

        let cached = cell.borrow();
        let base = &cached.as_ref().unwrap().1;

        let mut context = base.new_inner_scope();

        for (e_var, e_index) in binding.event_map.iter() {
            let arc = cached_ev_index_name(e_index, ocel_key);
            context.add_variable_from_value(ev_var_to_name(e_var), Value::String(arc));
        }
        for (o_var, o_index) in binding.object_map.iter() {
            let arc = cached_ob_index_name(o_index, ocel_key);
            context.add_variable_from_value(ob_var_to_name(o_var), Value::String(arc));
        }
        for (label, value) in binding.label_map.iter() {
            context.add_variable_from_value(
                label.clone(),
                Into::<cel_interpreter::Value>::into(value.clone()),
            );
        }
        context.add_variable_from_value("now", Value::Timestamp(Local::now().into()));

        if let Some(child_res) = child_res {
            for (child_name, child_out) in child_res {
                let value: Vec<Value> = child_out
                    .iter()
                    .map(|(b, violated)| {
                        let mut b_map = HashMap::with_capacity(
                            b.event_map.len() + b.object_map.len() + b.label_map.len() + 1,
                        );
                        b_map.extend(b.event_map.iter().map(|(ev_v, ev_i)| {
                            (
                                ev_var_to_name(ev_v).into(),
                                Value::String(cached_ev_index_name(ev_i, ocel_key)),
                            )
                        }));
                        b_map.extend(b.object_map.iter().map(|(ob_v, ob_i)| {
                            (
                                ob_var_to_name(ob_v).into(),
                                Value::String(cached_ob_index_name(ob_i, ocel_key)),
                            )
                        }));
                        b_map.extend(b.label_map.iter().map(|(label, value)| {
                            (
                                label.clone().into(),
                                Into::<cel_interpreter::Value>::into(value.clone()),
                            )
                        }));
                        b_map.insert("satisfied".into(), violated.is_none().into());
                        Value::Map(Map {
                            map: Arc::new(b_map),
                        })
                    })
                    .collect();
                context.add_variable_from_value(child_name.clone(), value)
            }
        }

        Ok(p.execute(&context)?)
    }))
}

/// Id-native evaluator. Mirrors [`evaluate_cel`] but operates on
/// `BindingId` (ocel_id-keyed) + an arbitrary `Resolver`, letting the SQL
/// execution path avoid allocating `EventIndex` / `ObjectIndex` for its
/// bindings.
pub fn evaluate_cel_id<'a>(
    cel: &str,
    binding: &'a crate::binding_box::structs::BindingId,
    child_res: Option<
        &HashMap<
            String,
            Vec<(
                Arc<crate::binding_box::structs::BindingId>,
                Option<ViolationReason>,
            )>,
        >,
    >,
    resolver: &dyn resolver::Resolver,
) -> Result<Value, CELEvalError> {
    lazy_compile_and_insert_into_cache(cel).map_err(CELEvalError::ParseError)?;
    let cache_read = CEL_PROGRAM_CACHE.read().unwrap();
    let p = match cache_read.get(cel) {
        Some(p) => p,
        None => {
            return Err(CELEvalError::ParseError(String::from(
                "Could not parse CEL",
            )))
        }
    };

    let key = CelCacheKey::from_resolver(resolver);

    with_resolver(resolver, || CEL_BASE_CTX.with(|cell| {
        let needs_rebuild = cell
            .borrow()
            .as_ref()
            .map(|(k, _)| *k != key)
            .unwrap_or(true);
        if needs_rebuild {
            *cell.borrow_mut() = Some((key, build_base_cel_context()));
        }

        let cached = cell.borrow();
        let base = &cached.as_ref().unwrap().1;

        let mut context = base.new_inner_scope();

        for (e_var, ocel_id) in binding.event_map.iter() {
            context.add_variable_from_value(ev_var_to_name(e_var), Value::String(ocel_id.clone()));
        }
        for (o_var, ocel_id) in binding.object_map.iter() {
            context.add_variable_from_value(ob_var_to_name(o_var), Value::String(ocel_id.clone()));
        }
        for (label, value) in binding.label_map.iter() {
            context.add_variable_from_value(
                label.clone(),
                Into::<cel_interpreter::Value>::into(value.clone()),
            );
        }
        context.add_variable_from_value("now", Value::Timestamp(Local::now().into()));

        if let Some(child_res) = child_res {
            for (child_name, child_out) in child_res {
                let value: Vec<Value> = child_out
                    .iter()
                    .map(|(b, violated)| {
                        let mut b_map = HashMap::with_capacity(
                            b.event_map.len() + b.object_map.len() + b.label_map.len() + 1,
                        );
                        b_map.extend(b.event_map.iter().map(|(ev_v, ev_id)| {
                            (ev_var_to_name(ev_v).into(), Value::String(ev_id.clone()))
                        }));
                        b_map.extend(b.object_map.iter().map(|(ob_v, ob_id)| {
                            (ob_var_to_name(ob_v).into(), Value::String(ob_id.clone()))
                        }));
                        b_map.extend(b.label_map.iter().map(|(label, value)| {
                            (
                                label.clone().into(),
                                Into::<cel_interpreter::Value>::into(value.clone()),
                            )
                        }));
                        b_map.insert("satisfied".into(), violated.is_none().into());
                        Value::Map(Map {
                            map: Arc::new(b_map),
                        })
                    })
                    .collect();
                context.add_variable_from_value(child_name.clone(), value)
            }
        }

        Ok(p.execute(&context)?)
    }))
}

#[derive(Debug)]
pub enum CELEvalError {
    ExecError(ExecutionError),
    ParseError(String),
}

impl From<ExecutionError> for CELEvalError {
    fn from(value: ExecutionError) -> Self {
        Self::ExecError(value)
    }
}

pub fn check_cel_predicate<'a>(
    cel: &str,
    binding: &'a Binding,
    child_res: Option<&HashMap<String, Vec<(Arc<Binding>, Option<ViolationReason>)>>>,
    ocel: &'a SlimLinkedOCEL,
) -> Result<bool, String> {
    match evaluate_cel(cel, binding, child_res, ocel) {
        Ok(Value::Bool(b)) => Ok(b),
        Ok(_) => Err("Got non-bool CEL result!".to_string()),
        Err(CELEvalError::ExecError(e)) => Err(e.to_string()),
        Err(CELEvalError::ParseError(e)) => Err(e),
    }
}

pub fn add_cel_label<'a>(
    binding: &'a mut Binding,
    child_res: Option<&HashMap<String, Vec<(Arc<Binding>, Option<ViolationReason>)>>>,
    ocel: &'a SlimLinkedOCEL,
    label_fun: &'a LabelFunction,
) -> Result<(), String> {
    match evaluate_cel(&label_fun.cel, binding, child_res, ocel) {
        Ok(v) => {
            binding.add_label(label_fun.label.clone(), v.into());
            Ok(())
        }
        Err(e) => {
            binding.add_label(label_fun.label.clone(), LabelValue::Null);
            Err(format!(
                "Error while computing binding label {} with error {e:?}",
                label_fun.label
            ))
        }
    }
}

pub fn check_cel_predicate_id<'a>(
    cel: &str,
    binding: &'a crate::binding_box::structs::BindingId,
    child_res: Option<
        &HashMap<
            String,
            Vec<(
                Arc<crate::binding_box::structs::BindingId>,
                Option<ViolationReason>,
            )>,
        >,
    >,
    resolver: &dyn resolver::Resolver,
) -> Result<bool, String> {
    match evaluate_cel_id(cel, binding, child_res, resolver) {
        Ok(Value::Bool(b)) => Ok(b),
        Ok(_) => Err("Got non-bool CEL result!".to_string()),
        Err(CELEvalError::ExecError(e)) => Err(e.to_string()),
        Err(CELEvalError::ParseError(e)) => Err(e),
    }
}

pub fn add_cel_label_id<'a>(
    binding: &'a mut crate::binding_box::structs::BindingId,
    child_res: Option<
        &HashMap<
            String,
            Vec<(
                Arc<crate::binding_box::structs::BindingId>,
                Option<ViolationReason>,
            )>,
        >,
    >,
    resolver: &dyn resolver::Resolver,
    label_fun: &'a LabelFunction,
) -> Result<(), String> {
    match evaluate_cel_id(&label_fun.cel, binding, child_res, resolver) {
        Ok(v) => {
            binding.add_label(label_fun.label.clone(), v.into());
            Ok(())
        }
        Err(e) => {
            binding.add_label(label_fun.label.clone(), LabelValue::Null);
            Err(format!(
                "Error while computing binding label {} with error {e:?}",
                label_fun.label
            ))
        }
    }
}

fn value_to_float(val: &Value) -> f64 {
    match val {
        Value::Int(i) => *i as f64,
        Value::UInt(ui) => *ui as f64,
        Value::Float(f) => *f,
        Value::String(s) => s.parse().unwrap_or_default(),
        _ => 0.0,
    }
}

fn ocel_val_to_cel_val(val: OCELAttributeValue) -> Value {
    match val {
        OCELAttributeValue::Float(f) => f.into(),
        OCELAttributeValue::Integer(i) => i.into(),
        OCELAttributeValue::String(s) => s.into(),
        OCELAttributeValue::Time(t) => t.fixed_offset().into(),
        OCELAttributeValue::Boolean(b) => b.into(),
        OCELAttributeValue::Null => Value::Null,
    }
}
fn string_to_var(s: &str) -> Variable {
    let (typ, num) = s.split_at(1);
    let num = num.parse::<usize>().map(|v| v - 1).unwrap_or_default();
    if typ == "o" {
        Variable::Object(ObjectVariable(num))
    } else {
        Variable::Event(EventVariable(num))
    }
}

pub fn get_vars_in_cel_program(cel: &str) -> HashSet<Variable> {
    if lazy_compile_and_insert_into_cache(cel).is_ok() {
        let r_lock = CEL_PROGRAM_CACHE.read().unwrap();
        let p = r_lock.get(cel).unwrap();
        p.references()
            .variables()
            .into_iter()
            .map(string_to_var)
            .collect()
    } else {
        HashSet::default()
    }
}

/// Return the subset of `candidate_labels` that the CEL program references
/// as top-level variables, letting the AdvancedCEL batched-LATERAL executor
/// skip materialising child binding-sets for labels the CEL string does
/// not mention. If compilation fails (which should not happen at runtime,
/// the CEL is already validated elsewhere) returns the empty set rather
/// than panicking, conservatively triggering re-materialisation upstream.
pub fn get_child_labels_in_cel_program(
    cel: &str,
    candidate_labels: &[String],
) -> HashSet<String> {
    if lazy_compile_and_insert_into_cache(cel).is_ok() {
        let r_lock = CEL_PROGRAM_CACHE.read().unwrap();
        let p = match r_lock.get(cel) {
            Some(p) => p,
            None => return HashSet::default(),
        };
        let referenced: HashSet<String> = p
            .references()
            .variables()
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        candidate_labels
            .iter()
            .filter(|label| referenced.contains(label.as_str()))
            .cloned()
            .collect()
    } else {
        HashSet::default()
    }
}

impl From<cel_interpreter::Value> for LabelValue {
    fn from(value: cel_interpreter::Value) -> Self {
        match value {
            Value::Int(i) => LabelValue::Int(i),
            Value::UInt(i) => LabelValue::Int(i as i64),
            Value::Float(f) => LabelValue::Float(f.into()),
            Value::String(arc) => LabelValue::String(arc),
            Value::Bool(b) => LabelValue::Bool(b),
            Value::Duration(time_delta) => LabelValue::String(Arc::new(time_delta.to_string())),
            Value::Timestamp(date_time) => LabelValue::String(Arc::new(date_time.to_rfc3339())),
            _ => LabelValue::Null,
        }
    }
}

impl From<LabelValue> for cel_interpreter::Value {
    fn from(val: LabelValue) -> Self {
        match val {
            LabelValue::String(arc) => Value::String(arc),
            LabelValue::Int(i) => Value::Int(i),
            LabelValue::Float(f) => Value::Float(f.into()),
            LabelValue::Bool(b) => Value::Bool(b),
            LabelValue::Null => Value::Null,
        }
    }
}
