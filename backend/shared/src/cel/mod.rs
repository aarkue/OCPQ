use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, RwLock},
    usize,
};

use cel_interpreter::{
    extractors::This, objects::Map, Context, FunctionContext, Program, ResolveResult, Value,
};
use chrono::{DateTime, FixedOffset};
use itertools::Itertools;
use once_cell::sync::Lazy;
use process_mining::ocel::ocel_struct::OCELAttributeValue;

use crate::{
    binding_box::{
        structs::{EventVariable, ObjectVariable, Variable},
        Binding, ViolationReason,
    },
    preprocessing::linked_ocel::{
        EventIndex, EventOrObjectIndex, IndexLinkedOCEL, OCELNodeRef, ObjectIndex,
    },
};

fn string_to_index(s: &str) -> Option<EventOrObjectIndex> {
    // ob_ and ev_ are the prefixes we reserve
    let (typ, num) = s.split_at(3);
    let num = num.parse::<usize>().ok()?;
    if typ == "ob_" {
        Some(EventOrObjectIndex::Object(ObjectIndex(num)))
    } else if typ == "ev_" {
        Some(EventOrObjectIndex::Event(EventIndex(num)))
    } else {
        None
    }
}

struct RawBindingContextPtr<'a, T>(*mut &'a T);

unsafe impl<'a, T> Send for RawBindingContextPtr<'a, T> {}
unsafe impl<'a, T> Sync for RawBindingContextPtr<'a, T> {}
impl<'a, T> Clone for RawBindingContextPtr<'a, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<'a, T> Copy for RawBindingContextPtr<'a, T> {}

fn index_string_to_val<'a>(s: &str, ocel: &'a IndexLinkedOCEL) -> Option<OCELNodeRef<'a>> {
    let index = string_to_index(s)?;
    ocel.ob_or_ev_by_index(index)
}

unsafe fn index_string_to_val_raw<'a>(
    s: &str,
    ocel: RawBindingContextPtr<'a, IndexLinkedOCEL>,
) -> Option<OCELNodeRef<'a>> {
    index_string_to_val(s, ocel.0.as_ref().unwrap())
}

unsafe fn get_ocel_raw(ocel: RawBindingContextPtr<'_, IndexLinkedOCEL>) -> &IndexLinkedOCEL {
    ocel.0.as_ref().unwrap()
}

pub static CEL_PROGRAM_CACHE: Lazy<RwLock<HashMap<String, Program>>> = Lazy::new(|| {
    let m = HashMap::new();
    RwLock::new(m)
});

pub fn lazy_compile_and_insert_into_cache(cel: &str) {
    let already_in_cache = CEL_PROGRAM_CACHE.read().unwrap().contains_key(cel);
    if !already_in_cache {
        let program = Program::compile(cel).unwrap();
        let mut w_lock = CEL_PROGRAM_CACHE.write().unwrap();
        w_lock.insert(cel.to_string(), program);
    }
}

pub fn ev_var_to_name(ev_var: &EventVariable) -> String {
    format!("e{}", ev_var.0 + 1)
}
pub fn ob_var_to_name(ob_var: &ObjectVariable) -> String {
    format!("o{}", ob_var.0 + 1)
}

pub fn ev_index_to_name(ev_index: &EventIndex) -> String {
    format!("ev_{}", ev_index.0)
}
pub fn ob_index_to_name(ob_index: &ObjectIndex) -> String {
    format!("ob_{}", ob_index.0)
}

pub fn evaluate_cel<'a>(
    cel: &str,
    binding: &'a Binding,
    child_res: Option<&HashMap<String, Vec<(Binding, Option<ViolationReason>)>>>,
    ocel: &'a IndexLinkedOCEL,
) -> bool {
    // let now = Instant::now();
    lazy_compile_and_insert_into_cache(cel);
    let cache_read = CEL_PROGRAM_CACHE.read().unwrap();
    if let Some(p) = cache_read.get(cel) {
        // println!("Program compiled: {:?}", now.elapsed());

        let mut context: Context<'a> = Context::default();
        for (e_var, e_index) in binding.event_map.iter() {
            let name = ev_var_to_name(e_var);
            let value = ev_index_to_name(e_index);
            context.add_variable(name, value).unwrap();
        }
        for (o_var, o_index) in binding.object_map.iter() {
            let name = ob_var_to_name(o_var);
            let value = ob_index_to_name(o_index);
            context.add_variable(name, value).unwrap();
        }
        if let Some(child_res) = child_res {
            for (child_name, child_out) in child_res {
                let value: Vec<Value> = child_out
                    .iter()
                    .map(|(b, violated)| {
                        let mut b_map = HashMap::new();
                        b_map.extend(b.event_map.iter().map(|(ev_v, ev_i)| {
                            (ev_var_to_name(ev_v).into(), ev_index_to_name(ev_i).into())
                        }));
                        b_map.extend(b.object_map.iter().map(|(ob_v, ob_i)| {
                            (ob_var_to_name(ob_v).into(), ob_index_to_name(ob_i).into())
                        }));
                        b_map.insert("satisfied".into(), violated.is_none().into());
                        Value::Map(Map {
                            map: Arc::new(b_map),
                        })
                    })
                    .collect_vec();
                context.add_variable_from_value(child_name.clone(), value)
            }
        }

        // println!("Context added: {:?}", now.elapsed());

        let ocel_raw = RawBindingContextPtr(unsafe {
            std::mem::transmute::<*mut &'a IndexLinkedOCEL, *mut &'static IndexLinkedOCEL>(
                Box::into_raw(Box::new(ocel)),
            )
        });
        // let binding_raw = RawBindingContextPtr(unsafe {
        //     std::mem::transmute::<*mut &'a Binding, *mut &'static Binding>(Box::into_raw(Box::new(
        //         binding,
        //     )))
        // });

        context.add_function(
            "type",
            move |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
                let val = unsafe { index_string_to_val_raw(&variable, ocel_raw) };

                match val {
                    Some(val_ref) => {
                        let ocel_type = match val_ref {
                            OCELNodeRef::Event(ev) => &ev.event_type,
                            OCELNodeRef::Object(ob) => &ob.object_type,
                        };
                        Ok(ocel_type.clone().into())
                    }

                    None => ftx.error("Event or Object not found.").into(),
                }
            },
        );

        context.add_function(
            "attr",
            move |ftx: &FunctionContext,
                  This(variable): This<Arc<String>>,
                  attr_name: Arc<String>|
                  -> ResolveResult {
                let val = unsafe { index_string_to_val_raw(&variable, ocel_raw) };
                let res = match val {
                    Some(val_ref) => {
                        let attr_val = match val_ref {
                            OCELNodeRef::Event(ev) => ev
                                .attributes
                                .iter()
                                .find(|a| &a.name == attr_name.as_ref())
                                .map(|a| &a.value),
                            OCELNodeRef::Object(ob) => ob
                                .attributes
                                .iter()
                                .find(|a| &a.name == attr_name.as_ref())
                                .map(|a| &a.value),
                        }
                        .unwrap_or(&OCELAttributeValue::Null);
                        let cel_val = match attr_val {
                            OCELAttributeValue::Float(f) => (*f).into(),
                            OCELAttributeValue::Integer(i) => (*i).into(),
                            OCELAttributeValue::String(s) => s.clone().into(),
                            OCELAttributeValue::Time(t) => t.fixed_offset().into(),
                            OCELAttributeValue::Boolean(b) => (*b).into(),
                            OCELAttributeValue::Null => Value::Null,
                        };
                        Ok(cel_val)
                    }

                    None => ftx.error("Event or Object not found.").into(),
                };
                res
            },
        );

        context.add_function(
            "attrAt",
            move |ftx: &FunctionContext,
                  This(variable): This<Arc<String>>,
                  attr_name: Arc<String>,
                  at: DateTime<FixedOffset>|
                  -> ResolveResult {
                let val = unsafe { index_string_to_val_raw(&variable, ocel_raw) };
                let res = match val {
                    Some(val_ref) => {
                        let attr_val = match val_ref {
                            OCELNodeRef::Event(ev) => ev
                                .attributes
                                .iter()
                                .find(|a| &a.name == attr_name.as_ref())
                                .map(|a| &a.value),
                            OCELNodeRef::Object(ob) => ob
                                .attributes
                                .iter()
                                .filter(|a| &a.name == attr_name.as_ref())
                                .sorted_by_key(|a| a.time)
                                .filter(|a| a.time <= at)
                                .last()
                                .map(|a| &a.value),
                        }
                        .unwrap_or(&OCELAttributeValue::Null);
                        Ok(ocel_val_to_cel_val(attr_val))
                    }

                    None => ftx.error("Event or Object not found.").into(),
                };
                res
            },
        );

        context.add_function(
            "id",
            move |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
                let val = unsafe { index_string_to_val_raw(&variable, ocel_raw) };

                match val {
                    Some(val_ref) => {
                        let attr_val = match val_ref {
                            OCELNodeRef::Event(ev) => &ev.id,
                            OCELNodeRef::Object(ob) => &ob.id,
                        };
                        Ok(attr_val.clone().into())
                    }

                    None => ftx.error("Event or Object not found.").into(),
                }
            },
        );

        context.add_function(
            "attrs",
            move |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
                let val = unsafe { index_string_to_val_raw(&variable, ocel_raw) };
                let res = match val {
                    Some(val_ref) => {
                        let attr_val: Vec<Vec<Value>> = match val_ref {
                            OCELNodeRef::Event(ev) => ev
                                .attributes
                                .iter()
                                .map(|a| {
                                    vec![
                                        a.name.clone().into(),
                                        ocel_val_to_cel_val(&a.value),
                                        Value::Null,
                                    ]
                                })
                                .collect(),
                            OCELNodeRef::Object(ob) => ob
                                .attributes
                                .iter()
                                .map(|a| {
                                    vec![
                                        a.name.clone().into(),
                                        ocel_val_to_cel_val(&a.value),
                                        a.time.fixed_offset().into(),
                                    ]
                                })
                                .collect(),
                        };
                        Ok(attr_val.into())
                    }

                    None => ftx.error("Event or Object not found.").into(),
                };
                res
            },
        );

        context.add_function(
            "time",
            move |ftx: &FunctionContext, This(variable): This<Arc<String>>| -> ResolveResult {
                let val = unsafe { index_string_to_val_raw(&variable, ocel_raw) };
                match val {
                    Some( OCELNodeRef::Event(ev)) =>  Ok(ev.time.fixed_offset().into()),
                    _ => ftx.error("Event not found.").into(),
                }
            },
        );

        context.add_function("numEvents", move || -> ResolveResult {
            unsafe { Ok((get_ocel_raw(ocel_raw).ocel.events.len() as u64).into()) }
        });
        context.add_function("numObjects", move || -> ResolveResult {
            unsafe { Ok((get_ocel_raw(ocel_raw).ocel.objects.len() as u64).into()) }
        });

        context.add_function("events", move || -> ResolveResult {
            unsafe {
                Ok((get_ocel_raw(ocel_raw)
                    .ocel
                    .events
                    .iter()
                    .enumerate()
                    .map(|(i, _)| ev_index_to_name(&EventIndex(i))))
                .collect_vec()
                .into())
            }
        });

        context.add_function("objects", move || -> ResolveResult {
            unsafe {
                Ok((get_ocel_raw(ocel_raw)
                    .ocel
                    .objects
                    .iter()
                    .enumerate()
                    .map(|(i, _)| ob_index_to_name(&ObjectIndex(i))))
                .collect_vec()
                .into())
            }
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

        let res = match p.execute(&context) {
            Ok(Value::Bool(b)) => b,
            Ok(_) => false,
            Err(e) => {
                eprintln!("{e}");
                false
            }
        };

        unsafe {
            let _ocel_box = Box::from_raw(ocel_raw.0);
        }
        res
    } else {
        false
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

fn ocel_val_to_cel_val(val: &OCELAttributeValue) -> Value {
    match val {
        OCELAttributeValue::Float(f) => (*f).into(),
        OCELAttributeValue::Integer(i) => (*i).into(),
        OCELAttributeValue::String(s) => s.clone().into(),
        OCELAttributeValue::Time(t) => t.fixed_offset().into(),
        OCELAttributeValue::Boolean(b) => (*b).into(),
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
    lazy_compile_and_insert_into_cache(cel);
    let r_lock = CEL_PROGRAM_CACHE.read().unwrap();
    let p = r_lock.get(cel).unwrap();
    p.references()
        .variables()
        .into_iter()
        .map(string_to_var)
        .collect()
}