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
fn test_condition_not_equals() {
    let cond = ChangeTableCondition::ColumnNotEquals {
        column: "status".to_string(),
        value: "active".to_string(),
    };
    let prepared = cond.prepare().unwrap();
    let col_index = build_column_index(&["status"]);

    // Non-matching value -> not-equals is true
    let values = vec![NormalizedValue::Text("inactive".to_string())];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    assert!(prepared.evaluate(&row));

    // Matching value -> not-equals is false
    let values = vec![NormalizedValue::Text("active".to_string())];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    assert!(!prepared.evaluate(&row));

    // Missing value -> not-equals treats as differing (true)
    let values = vec![NormalizedValue::Null];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    assert!(prepared.evaluate(&row));
}

#[test]
fn test_condition_and_two_leaves() {
    // AND of two leaf conditions — both must match
    let cond = ChangeTableCondition::And {
        conditions: vec![
            ChangeTableCondition::ColumnEquals {
                column: "status".to_string(),
                value: "active".to_string(),
            },
            ChangeTableCondition::ColumnEquals {
                column: "region".to_string(),
                value: "EU".to_string(),
            },
        ],
    };
    let prepared = cond.prepare().unwrap();
    let col_index = build_column_index(&["status", "region"]);

    // Both match -> true
    let values = vec![
        NormalizedValue::Text("active".to_string()),
        NormalizedValue::Text("EU".to_string()),
    ];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    assert!(prepared.evaluate(&row));

    // Only first matches -> false (this is the scenario the bug report describes)
    let values = vec![
        NormalizedValue::Text("active".to_string()),
        NormalizedValue::Text("US".to_string()),
    ];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    assert!(
        !prepared.evaluate(&row),
        "AND should fail when second condition is false"
    );

    // Only second matches -> false
    let values = vec![
        NormalizedValue::Text("inactive".to_string()),
        NormalizedValue::Text("EU".to_string()),
    ];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    assert!(!prepared.evaluate(&row));

    // Verify referenced_columns covers both leaves
    let mut cols = std::collections::HashSet::new();
    cond.referenced_columns(&mut cols);
    assert!(cols.contains("status"));
    assert!(cols.contains("region"));
}

#[test]
fn test_multi_value_regex() {
    let cfg = MultiValueConfig {
        enabled: true,
        delimiter: ",".to_string(),
        trim_values: true,
        regex_pattern: Some(r"ID-(\d+)".to_string()),
    };
    // Capture groups win over delimiter when regex_pattern is set
    assert_eq!(cfg.split("ID-1, ID-2 and ID-3"), vec!["1", "2", "3"]);

    // No capture groups -> use full match
    let cfg_full = MultiValueConfig {
        enabled: true,
        delimiter: ",".to_string(),
        trim_values: true,
        regex_pattern: Some(r"ORD-\d+".to_string()),
    };
    assert_eq!(cfg_full.split("ORD-1 / ORD-2"), vec!["ORD-1", "ORD-2"]);
}

#[test]
fn test_required_columns() {
    let usage = TableUsageData::Event {
        event_type: ValueExpression::Constant {
            value: "Order".to_string(),
        },
        id: Some(ValueExpression::Template {
            template: "EVT-{order_id}".to_string(),
        }),
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
            regex_pattern: None,
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
fn test_format_string_without_seconds() {
    // Format string that doesn't include seconds (e.g., "%Y-%m-%d %H:%M")
    let ts = TimestampSource::Column {
        column: "time".to_string(),
        format: TimestampFormat::FormatString {
            format: "%Y-%m-%d %H:%M".to_string(),
        },
    };
    let col_index = build_column_index(&["time"]);
    let values = vec![NormalizedValue::Text("2024-01-15 10:30".to_string())];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    let parsed = ts.parse(&row);
    assert!(
        parsed.is_some(),
        "should parse timestamp without seconds using format string"
    );
    let dt = parsed.unwrap();
    assert_eq!(
        dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        "2024-01-15 10:30:00"
    );
}

#[test]
fn test_format_string_no_seconds_various() {
    // Test various format strings without seconds
    let cases: Vec<(&str, &str)> = vec![
        ("%Y-%m-%d %H:%M", "2024-01-15 10:30"),
        ("%d/%m/%Y %H:%M", "15/01/2024 10:30"),
        ("%d.%m.%Y %H:%M", "15.01.2024 10:30"),
        ("%m/%d/%Y %H:%M", "01/15/2024 10:30"),
    ];
    for (fmt, input) in &cases {
        let ts = TimestampSource::Column {
            column: "t".to_string(),
            format: TimestampFormat::FormatString {
                format: fmt.to_string(),
            },
        };
        let col_index = build_column_index(&["t"]);
        let values = vec![NormalizedValue::Text(input.to_string())];
        let row = IndexedRow {
            values: &values,
            index: &col_index,
        };
        assert!(
            ts.parse(&row).is_some(),
            "Failed to parse '{}' with format '{}'",
            input,
            fmt
        );
    }
}

#[test]
fn test_format_string_date_only() {
    // Format string with only date, no time components
    let ts = TimestampSource::Column {
        column: "time".to_string(),
        format: TimestampFormat::FormatString {
            format: "%Y-%m-%d".to_string(),
        },
    };
    let col_index = build_column_index(&["time"]);
    let values = vec![NormalizedValue::Text("2024-01-15".to_string())];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    let parsed = ts.parse(&row);
    assert!(
        parsed.is_some(),
        "FormatString with date-only format should parse to midnight"
    );
}

#[test]
fn test_auto_format_without_seconds() {
    let col_index = build_column_index(&["time"]);
    let cases = vec!["2024-01-15 10:30", "15/01/2024 10:30", "15.03.2026 00:25"];
    for input in cases {
        let ts = TimestampSource::Column {
            column: "time".to_string(),
            format: TimestampFormat::Auto,
        };
        let values = vec![NormalizedValue::Text(input.to_string())];
        let row = IndexedRow {
            values: &values,
            index: &col_index,
        };
        assert!(
            ts.parse(&row).is_some(),
            "Auto format should parse '{}'",
            input
        );
    }
}

#[test]
fn test_table_usage_data_serde_inline_refs() {
    let json = r#"{
            "mode": "event",
            "event_type": {"type": "constant", "value": "Order"},
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
        TableUsageData::Event {
            event_type,
            inline_object_references,
            ..
        } => {
            match event_type {
                ValueExpression::Constant { value } => assert_eq!(value, "Order"),
                _ => panic!("expected Constant expression"),
            }
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
        _ => panic!("expected Event variant"),
    }

    let json_no_refs = r#"{
            "mode": "event",
            "event_type": {"type": "constant", "value": "Order"},
            "id": {"type": "column", "column": "event_id"},
            "timestamp": {"type": "column", "column": "ts", "format": {"type": "auto"}}
        }"#;
    let usage2: TableUsageData =
        serde_json::from_str(json_no_refs).expect("should deserialize without refs");
    match &usage2 {
        TableUsageData::Event {
            inline_object_references,
            ..
        } => {
            assert!(inline_object_references.is_empty());
        }
        _ => panic!("expected Event variant"),
    }
}
