
use crate::data_extraction::blueprint::{
    ChangeTableCondition, MultiValueConfig, ObjectTypeSpec, TimestampFormat,
};

use super::*;

#[test]
fn test_value_expression_column() {
    let expr = ValueExpression::Column {
        column: "name".to_string(),
    };
    let col_index = build_column_index(&["name", "age"]);
    let values = vec![
        NormalizedValue::Text("Alice".to_string()),
        NormalizedValue::Integer(30),
    ];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    assert_eq!(expr.evaluate(&row), Some("Alice".to_string()));
}

#[test]
fn test_value_expression_template() {
    let expr = ValueExpression::Template {
        template: "ORD-{id}-{region}".to_string(),
    };
    let col_index = build_column_index(&["id", "region"]);
    let values = vec![
        NormalizedValue::Text("123".to_string()),
        NormalizedValue::Text("EU".to_string()),
    ];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    assert_eq!(expr.evaluate(&row), Some("ORD-123-EU".to_string()));
}

#[test]
fn test_timestamp_parsing() {
    let ts = TimestampSource::Column {
        column: "time".to_string(),
        format: TimestampFormat::Auto,
    };
    let col_index = build_column_index(&["time"]);
    let values = vec![NormalizedValue::Text("2024-01-15 10:30:00".to_string())];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    assert!(ts.parse(&row).is_some());
}

#[test]
fn test_timestamp_components_iso_datetimes() {
    // SAP-style: both columns contain full ISO datetimes
    let ts = TimestampSource::Components {
        date_column: Some("udate".to_string()),
        time_column: Some("utime".to_string()),
    };
    let col_index = build_column_index(&["udate", "utime"]);
    let values = vec![
        NormalizedValue::Text("2015-01-06T00:00:00".to_string()),
        NormalizedValue::Text("1970-01-01T15:02:03".to_string()),
    ];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    let parsed = ts.parse(&row);
    assert!(parsed.is_some(), "should parse ISO datetime components");
    let dt = parsed.unwrap();
    assert_eq!(
        dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        "2015-01-06 15:02:03"
    );
}

#[test]
fn test_timestamp_components_plain() {
    // Simple case: plain date + plain time
    let ts = TimestampSource::Components {
        date_column: Some("d".to_string()),
        time_column: Some("t".to_string()),
    };
    let col_index = build_column_index(&["d", "t"]);
    let values = vec![
        NormalizedValue::Text("2024-03-15".to_string()),
        NormalizedValue::Text("09:30:00".to_string()),
    ];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    let parsed = ts.parse(&row);
    assert!(
        parsed.is_some(),
        "should parse plain date + time components"
    );
    let dt = parsed.unwrap();
    assert_eq!(
        dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        "2024-03-15 09:30:00"
    );
}

#[test]
fn test_condition_prepare_and_evaluate() {
    let cond = ChangeTableCondition::ColumnEquals {
        column: "status".to_string(),
        value: "active".to_string(),
    };
    let prepared = cond.prepare().unwrap();
    let col_index = build_column_index(&["status"]);
    let values = vec![NormalizedValue::Text("active".to_string())];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    assert!(prepared.evaluate(&row));
}

#[test]
fn test_condition_regex() {
    let cond = ChangeTableCondition::ColumnMatches {
        column: "code".to_string(),
        regex: r"^ORD-\d+$".to_string(),
    };
    let prepared = cond.prepare().unwrap();
    let col_index = build_column_index(&["code"]);

    let values_match = vec![NormalizedValue::Text("ORD-123".to_string())];
    let row = IndexedRow {
        values: &values_match,
        index: &col_index,
    };
    assert!(prepared.evaluate(&row));

    let values_no_match = vec![NormalizedValue::Text("INV-456".to_string())];
    let row = IndexedRow {
        values: &values_no_match,
        index: &col_index,
    };
    assert!(!prepared.evaluate(&row));
}

#[test]
fn test_required_columns() {
    let usage = TableUsageData::SingleEvent {
        event_type: "Order".to_string(),
        id: ValueExpression::Template {
            template: "EVT-{order_id}".to_string(),
        },
        timestamp: TimestampSource::Column {
            column: "created_at".to_string(),
            format: TimestampFormat::Auto,
        },
        inline_object_references: Vec::new(),
    };
    let cols = usage.required_columns();
    assert!(cols.contains("order_id"));
    assert!(cols.contains("created_at"));
}

#[test]
fn test_inline_object_reference_multi_value() {
    let inline_ref = InlineObjectReference {
        id: "test".to_string(),
        object_id: ValueExpression::Column {
            column: "objects".to_string(),
        },
        object_type: None,
        qualifier: None,
        multi_value_config: Some(MultiValueConfig {
            enabled: true,
            delimiter: ",".to_string(),
            trim_values: true,
        }),
    };
    let col_index = build_column_index(&["objects"]);
    let values = vec![NormalizedValue::Text("obj1, obj2, obj3".to_string())];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    let ids = inline_ref.extract_object_ids(&row);
    assert_eq!(ids, vec!["obj1", "obj2", "obj3"]);
}

#[test]
fn test_table_usage_data_serde_inline_refs() {
    let json = r#"{
            "mode": "single-event",
            "event_type": "Order",
            "id": {"type": "column", "column": "event_id"},
            "timestamp": {"type": "column", "column": "ts", "format": {"type": "auto"}},
            "inline_object_references": [
                {
                    "id": "ref1",
                    "object_id": {"type": "column", "column": "customer_id"},
                    "object_type": "Customer",
                    "qualifier": null,
                    "multi_value_config": null
                }
            ]
        }"#;

    let usage: TableUsageData = serde_json::from_str(json).expect("should deserialize");
    match &usage {
        TableUsageData::SingleEvent {
            event_type,
            inline_object_references,
            ..
        } => {
            assert_eq!(event_type, "Order");
            assert_eq!(inline_object_references.len(), 1);
            assert_eq!(inline_object_references[0].id, "ref1");
            match &inline_object_references[0].object_id {
                ValueExpression::Column { column } => assert_eq!(column, "customer_id"),
                _ => panic!("expected Column expression"),
            }
            match &inline_object_references[0].object_type {
                Some(ObjectTypeSpec::Fixed(t)) => assert_eq!(t, "Customer"),
                _ => panic!("expected Fixed object type"),
            }
        }
        _ => panic!("expected SingleEvent variant"),
    }

    let json_no_refs = r#"{
            "mode": "single-event",
            "event_type": "Order",
            "id": {"type": "column", "column": "event_id"},
            "timestamp": {"type": "column", "column": "ts", "format": {"type": "auto"}}
        }"#;
    let usage2: TableUsageData =
        serde_json::from_str(json_no_refs).expect("should deserialize without refs");
    match &usage2 {
        TableUsageData::SingleEvent {
            inline_object_references,
            ..
        } => {
            assert!(inline_object_references.is_empty());
        }
        _ => panic!("expected SingleEvent variant"),
    }
}
