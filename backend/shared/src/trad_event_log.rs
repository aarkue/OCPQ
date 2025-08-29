use std::collections::HashMap;

use chrono::DateTime;
use process_mining::{
    event_log::{
        constants::{ACTIVITY_NAME, TRACE_ID_NAME},
        AttributeValue, XESEditableAttribute,
    },
    ocel::ocel_struct::{
        OCELAttributeType, OCELAttributeValue, OCELEvent, OCELEventAttribute, OCELObject,
        OCELObjectAttribute, OCELRelationship, OCELType, OCELTypeAttribute,
    },
    EventLog, OCEL,
};

fn xes_att_to_ocel_attr(attribute: &AttributeValue) -> OCELAttributeValue {
    match attribute {
        AttributeValue::String(s) => OCELAttributeValue::String(s.clone()),
        AttributeValue::Date(date_time) => OCELAttributeValue::Time(date_time.clone()),
        AttributeValue::Int(i) => OCELAttributeValue::Integer(*i),
        AttributeValue::Float(f) => OCELAttributeValue::Float(*f),
        AttributeValue::Boolean(b) => OCELAttributeValue::Boolean(*b),
        AttributeValue::ID(uuid) => OCELAttributeValue::String(uuid.to_string()),
        AttributeValue::List(attributes) => OCELAttributeValue::String(format!("{:?}", attributes)),
        AttributeValue::Container(attributes) => {
            OCELAttributeValue::String(format!("{:?}", attributes))
        }

        AttributeValue::None() => OCELAttributeValue::Null,
    }
}

pub fn trad_log_to_ocel(log: &EventLog) -> OCEL {
    let case_object_type_name = "Case";
    let mut case_object_type = OCELType {
        name: case_object_type_name.to_string(),
        attributes: Vec::new(),
    };
    let mut ret = OCEL {
        event_types: Vec::new(),
        object_types: Vec::new(),
        events: Vec::new(),
        objects: Vec::with_capacity(log.traces.len()),
    };
    let mut event_type_set: HashMap<&str, OCELType> = HashMap::new();

    for trace in &log.traces {
        let object_id = trace
            .attributes
            .get_by_key(TRACE_ID_NAME)
            .and_then(|a| a.value.try_as_string())
            .cloned()
            .unwrap_or_else(|| format!("ob_{}", ret.objects.len()));

        let attributes: Vec<_> = trace
            .attributes
            .iter()
            .map(|atr| {
                let value = xes_att_to_ocel_attr(&atr.value);
                OCELObjectAttribute {
                    name: atr.key.to_string(),
                    value,
                    time: DateTime::UNIX_EPOCH.into(),
                }
            })
            .collect();

        for attr in &attributes {
            if case_object_type
                .attributes
                .iter()
                .find(|a| a.name == attr.name)
                .is_none()
            {
                case_object_type.attributes.push(OCELTypeAttribute {
                    name: attr.name.to_string(),
                    value_type: OCELAttributeType::from(&attr.value).to_type_string(),
                })
            }
        }
        ret.objects.push(OCELObject {
            id: object_id.clone(),
            object_type: case_object_type_name.to_string(),
            attributes,
            relationships: Vec::new(),
        });
        for event in &trace.events {
            let event_type = event
                .attributes
                .get_by_key(ACTIVITY_NAME)
                .and_then(|a| a.value.try_as_string().map(|s| s.as_str()))
                .unwrap_or("UNKNOWN");
            if !event_type_set.contains_key(event_type) {
                event_type_set.insert(
                    event_type,
                    OCELType {
                        name: event_type.to_string(),
                        attributes: Vec::new(),
                    },
                );
            }
            let attributes: Vec<_> = event
                .attributes
                .iter()
                .map(|atr| {
                    let value = xes_att_to_ocel_attr(&atr.value);
                    OCELEventAttribute {
                        name: atr.key.to_string(),
                        value,
                    }
                })
                .collect();

            for attr in &attributes {
                if let Some(x) = event_type_set.get_mut(event_type) {
                    if x.attributes.iter().find(|a| a.name == attr.name).is_none() {
                        x.attributes.push(OCELTypeAttribute {
                            name: attr.name.to_string(),
                            value_type: OCELAttributeType::from(&attr.value).to_type_string(),
                        })
                    }
                }
            }
            ret.events.push(OCELEvent {
                id: format!("ev_{}", ret.events.len()),
                event_type: event_type.to_string(),
                time: event
                    .attributes
                    .get_by_key("time:timestamp")
                    .and_then(|t| t.value.try_as_date())
                    .cloned()
                    .unwrap_or_default(),
                attributes: attributes,
                relationships: vec![OCELRelationship {
                    object_id: object_id.clone(),
                    qualifier: "case".to_string(),
                }],
            })
        }
    }
    ret.event_types = event_type_set.into_values().collect();
    ret.object_types = vec![case_object_type];
    ret
}
