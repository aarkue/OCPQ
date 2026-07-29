use crate::data_extraction::blueprint::{
    ChangeTableCondition, ChangeTableEventRule, MultiValueConfig, ObjectTypeSpec, TimestampFormat,
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

// --- Task 0: canonical id rendering + typed join keys ---

#[test]
fn test_get_id_string_semantics() {
    let col_index = build_column_index(&["v"]);
    let get = |v: NormalizedValue| {
        let values = vec![v];
        let row = IndexedRow {
            values: &values,
            index: &col_index,
        };
        row.get_id_string("v")
    };

    assert_eq!(get(NormalizedValue::Text("abc".to_string())), Some("abc".to_string()));
    assert_eq!(get(NormalizedValue::Integer(42)), Some("42".to_string()));
    assert_eq!(get(NormalizedValue::Boolean(true)), Some("true".to_string()));
    assert_eq!(get(NormalizedValue::Boolean(false)), Some("false".to_string()));
    assert_eq!(get(NormalizedValue::Null), None);
    assert_eq!(get(NormalizedValue::Float(5.0)), None);
    assert_eq!(
        get(NormalizedValue::Timestamp(
            chrono::DateTime::parse_from_rfc3339("2024-01-15T10:30:00Z").unwrap()
        )),
        None
    );
    assert_eq!(get(NormalizedValue::Json(serde_json::json!({"a": 1}))), None);
    assert_eq!(get(NormalizedValue::Unknown("x".to_string())), None);
}

#[test]
fn test_object_usage_null_id_creates_no_object() {
    // Previously: get_string rendered NULL as the literal "NULL", creating an object
    // named "NULL". Now: identity evaluation returns None and the row is dropped.
    let usage = TableUsageData::Object {
        object_type: ValueExpression::Constant {
            value: "Order".to_string(),
        },
        id: ValueExpression::Column {
            column: "oid".to_string(),
        },
        prefix_id_with_type: false,
        timestamp: None,
        attribute_config: None,
    };
    let col_index = build_column_index(&["oid"]);
    let values = vec![NormalizedValue::Null];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };

    let mut locel = SlimLinkedOCEL::new();
    let mut ctx = ExtractionContext::new();
    process_single_row(&mut locel, &usage, &row, "orders", &mut ctx);

    assert_eq!(locel.get_all_obs().count(), 0);
    assert_eq!(ctx.object_count, 0);
}

#[test]
fn test_template_with_null_placeholder_drops_row() {
    let expr = ValueExpression::Template {
        template: "{a}-{b}".to_string(),
    };
    let col_index = build_column_index(&["a", "b"]);
    let values = vec![NormalizedValue::Text("X".to_string()), NormalizedValue::Null];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };
    assert_eq!(expr.evaluate(&row), None);
}

#[test]
fn test_qualifier_null_still_becomes_empty_string() {
    // Qualifier positions keep the `unwrap_or_default` fallback: a None qualifier
    // evaluation (missing expression, or now also a null/unstable column) becomes "".
    let usage = TableUsageData::E2ORelation {
        source_event: ValueExpression::Constant {
            value: "e1".to_string(),
        },
        target_object: ValueExpression::Constant {
            value: "o1".to_string(),
        },
        qualifier: Some(ValueExpression::Column {
            column: "q".to_string(),
        }),
        target_object_type: None,
        target_object_multi: None,
    };
    let col_index = build_column_index(&["q"]);
    let values = vec![NormalizedValue::Null];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };

    let mut locel = SlimLinkedOCEL::new();
    locel.add_event_type("Order", Vec::new());
    locel.add_object_type("Customer", Vec::new());
    let ev_idx = locel
        .add_event(
            "Order",
            chrono::DateTime::parse_from_rfc3339("2024-01-15T10:30:00Z").unwrap(),
            Some("e1".to_string()),
            Vec::new(),
            Vec::new(),
        )
        .unwrap();
    locel
        .add_object("Customer", Some("o1".to_string()), Vec::new(), Vec::new())
        .unwrap();

    let mut ctx = ExtractionContext::new();
    process_single_row(&mut locel, &usage, &row, "links", &mut ctx);

    let rels: Vec<(&str, String)> = locel
        .get_e2o(&ev_idx)
        .map(|(q, o)| (q, locel.get_ob_id(o).to_string()))
        .collect();
    assert_eq!(rels, vec![("", "o1".to_string())]);
}

#[test]
fn test_change_table_events_null_id_drops_row_not_counter_numbered() {
    let usage = TableUsageData::ChangeTableEvents {
        timestamp: TimestampSource::Column {
            column: "ts".to_string(),
            format: TimestampFormat::Auto,
        },
        id: Some(ValueExpression::Column {
            column: "rid".to_string(),
        }),
        event_rules: vec![ChangeTableEventRule {
            id: "r1".to_string(),
            event_type: "Seen".to_string(),
            conditions: ChangeTableCondition::ColumnNotEmpty {
                column: "status".to_string(),
            },
        }],
        inline_object_references: Vec::new(),
    };
    let col_refs = ["rid", "status", "ts"];
    let col_index = build_column_index(&col_refs);
    let rows = vec![
        vec![
            NormalizedValue::Null,
            NormalizedValue::Text("active".to_string()),
            NormalizedValue::Text("2024-01-15 10:30:00".to_string()),
        ],
        vec![
            NormalizedValue::Text("r2".to_string()),
            NormalizedValue::Text("active".to_string()),
            NormalizedValue::Text("2024-01-15 10:31:00".to_string()),
        ],
    ];

    let mut locel = SlimLinkedOCEL::new();
    let mut ctx = ExtractionContext::new();
    process_rows(&mut locel, &usage, &rows, &col_index, "audit", &mut ctx);

    let ids: Vec<String> = locel
        .get_all_evs()
        .map(|e| locel.get_ev_id(&e).to_string())
        .collect();
    // Only r2 survives. If the null-id row fell back to counter-numbering it would
    // still produce a second event (e.g. "audit_Seen_1").
    assert_eq!(ids, vec!["r2".to_string()]);
    assert_eq!(ctx.event_count, 1);
}

#[test]
fn test_event_usage_present_id_expr_evaluating_null_drops_row() {
    // `id` expression present but evaluating to None must drop the row, not fall back
    // to a synthesized uuid (that fallback is reserved for `id: None`, i.e. no
    // expression at all).
    let usage = TableUsageData::Event {
        event_type: ValueExpression::Constant {
            value: "Order".to_string(),
        },
        id: Some(ValueExpression::Column {
            column: "eid".to_string(),
        }),
        timestamp: TimestampSource::Column {
            column: "ts".to_string(),
            format: TimestampFormat::Auto,
        },
        inline_object_references: Vec::new(),
    };
    let col_index = build_column_index(&["eid", "ts"]);
    let values = vec![
        NormalizedValue::Null,
        NormalizedValue::Text("2024-01-15 10:30:00".to_string()),
    ];
    let row = IndexedRow {
        values: &values,
        index: &col_index,
    };

    let mut locel = SlimLinkedOCEL::new();
    let mut ctx = ExtractionContext::new();
    process_single_row(&mut locel, &usage, &row, "orders", &mut ctx);

    assert_eq!(locel.get_all_evs().count(), 0);
    assert_eq!(ctx.event_count, 0);
}

#[test]
fn test_join_keys_use_id_rendering_and_drop_null_on_either_side() {
    // Float/Timestamp/Json/Unknown columns and NULLs have no canonical join key: a row
    // with such a key on either side of the join must not participate (SQL inner-join
    // null semantics), rather than joining on the stringified sentinel.
    let left_cols = ["lkey", "lval"];
    let right_cols = ["rkey", "rval"];
    let left_rows = vec![
        vec![
            NormalizedValue::Text("k1".to_string()),
            NormalizedValue::Text("left1".to_string()),
        ],
        vec![
            NormalizedValue::Null,
            NormalizedValue::Text("left-null".to_string()),
        ],
    ];
    let right_rows = vec![
        vec![
            NormalizedValue::Text("k1".to_string()),
            NormalizedValue::Text("right1".to_string()),
        ],
        vec![
            NormalizedValue::Null,
            NormalizedValue::Text("right-null".to_string()),
        ],
    ];

    let operation = TransformOperation::Join {
        left: TransformSource::Table {
            source_id: "s1".to_string(),
            table_name: "left_t".to_string(),
        },
        right: TransformSource::Table {
            source_id: "s1".to_string(),
            table_name: "right_t".to_string(),
        },
        join_type: JoinType::Inner,
        on: vec![("lkey".to_string(), "rkey".to_string())],
    };

    let mut cache: VirtualTableCache = HashMap::new();
    cache.insert(
        "left_vt".to_string(),
        (left_cols.iter().map(|s| s.to_string()).collect(), left_rows),
    );
    cache.insert(
        "right_vt".to_string(),
        (
            right_cols.iter().map(|s| s.to_string()).collect(),
            right_rows,
        ),
    );

    // Re-point the operation's sources at the virtual cache so no real data source is
    // needed for this row-processing test.
    let operation = match operation {
        TransformOperation::Join {
            join_type, on, ..
        } => TransformOperation::Join {
            left: TransformSource::VirtualTable {
                virtual_table_id: "left_vt".to_string(),
            },
            right: TransformSource::VirtualTable {
                virtual_table_id: "right_vt".to_string(),
            },
            join_type,
            on,
        },
        _ => unreachable!(),
    };

    let needed: HashSet<String> = ["lkey", "lval", "rkey", "rval"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let data_sources = HashMap::new();
    let table_schemas = HashMap::new();
    let mut vt_type_schemas = std::collections::BTreeMap::new();
    let (_cols, rows) = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(apply_transform(
            &operation,
            &needed,
            &data_sources,
            &cache,
            &table_schemas,
            &[],
            &[],
            &mut vt_type_schemas,
        ))
        .expect("join succeeds");

    // Only the k1/k1 pair participates; both NULL-keyed rows are dropped on both sides.
    assert_eq!(rows.len(), 1);
}

#[test]
fn test_join_keeps_non_colliding_right_join_key_aligned() {
    // SQL JOIN...ON semantics: a right join-key column is dropped only when its name
    // collides with a left column; a differently-named key (order_cust_id vs cust_id)
    // must survive in the output, under its own name, with its own value -- not silently
    // dropped from the row while its name stays in the column list (which shifts every
    // later column's value left by one, the misalignment this test pins).
    let left_cols = ["cust_id", "name"];
    let right_cols = ["order_cust_id", "amount"];
    let left_rows = vec![vec![
        NormalizedValue::Integer(1),
        NormalizedValue::Text("Alice".to_string()),
    ]];
    let right_rows = vec![vec![
        NormalizedValue::Integer(1),
        NormalizedValue::Text("100".to_string()),
    ]];

    let mut cache: VirtualTableCache = HashMap::new();
    cache.insert(
        "customers".to_string(),
        (left_cols.iter().map(|s| s.to_string()).collect(), left_rows),
    );
    cache.insert(
        "orders".to_string(),
        (
            right_cols.iter().map(|s| s.to_string()).collect(),
            right_rows,
        ),
    );

    let operation = TransformOperation::Join {
        left: TransformSource::VirtualTable {
            virtual_table_id: "customers".to_string(),
        },
        right: TransformSource::VirtualTable {
            virtual_table_id: "orders".to_string(),
        },
        join_type: JoinType::Inner,
        on: vec![("cust_id".to_string(), "order_cust_id".to_string())],
    };

    let needed: HashSet<String> = ["cust_id", "name", "order_cust_id", "amount"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let data_sources = HashMap::new();
    let table_schemas = HashMap::new();
    let mut vt_type_schemas = std::collections::BTreeMap::new();
    let (cols, rows) = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(apply_transform(
            &operation,
            &needed,
            &data_sources,
            &cache,
            &table_schemas,
            &[],
            &[],
            &mut vt_type_schemas,
        ))
        .expect("join succeeds");

    assert_eq!(rows.len(), 1);
    // Structural alignment: every named column has a value.
    assert_eq!(
        cols.len(),
        rows[0].len(),
        "column list and row must have the same length: cols={:?} row={:?}",
        cols,
        rows[0]
    );

    // No collision anywhere, so the right join key keeps its own name and is not
    // renamed to `right_order_cust_id`.
    assert!(cols.contains(&"order_cust_id".to_string()));
    assert!(!cols.contains(&"right_order_cust_id".to_string()));

    let idx = |name: &str| cols.iter().position(|c| c == name).expect(name);
    assert_eq!(
        rows[0][idx("order_cust_id")],
        NormalizedValue::Integer(1),
        "order_cust_id must read its own key value, not amount's"
    );
    assert_eq!(
        rows[0][idx("amount")],
        NormalizedValue::Text("100".to_string()),
        "amount must read its own value"
    );
}

#[test]
fn test_join_missing_on_column_errors_instead_of_silently_dropping() {
    // `left_join_col_indices`/`right_join_col_indices` used to be built with independent
    // `filter_map`s, so an `on` column absent from one side was silently dropped from the
    // key vector rather than erroring -- an empty join for a single pair, or a
    // positionally-misaligned wrong-column comparison for multiple pairs. A missing
    // column must error instead.
    let left_cols = ["cust_id", "name"];
    let right_cols = ["order_cust_id", "amount"];
    let left_rows = vec![vec![
        NormalizedValue::Integer(1),
        NormalizedValue::Text("Alice".to_string()),
    ]];
    let right_rows = vec![vec![
        NormalizedValue::Integer(1),
        NormalizedValue::Text("100".to_string()),
    ]];

    let mut cache: VirtualTableCache = HashMap::new();
    cache.insert(
        "customers".to_string(),
        (left_cols.iter().map(|s| s.to_string()).collect(), left_rows),
    );
    cache.insert(
        "orders".to_string(),
        (
            right_cols.iter().map(|s| s.to_string()).collect(),
            right_rows,
        ),
    );

    // "does_not_exist" names no column on the right side.
    let operation = TransformOperation::Join {
        left: TransformSource::VirtualTable {
            virtual_table_id: "customers".to_string(),
        },
        right: TransformSource::VirtualTable {
            virtual_table_id: "orders".to_string(),
        },
        join_type: JoinType::Inner,
        on: vec![("cust_id".to_string(), "does_not_exist".to_string())],
    };

    let needed: HashSet<String> = ["cust_id", "name", "order_cust_id", "amount"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let data_sources = HashMap::new();
    let table_schemas = HashMap::new();
    let mut vt_type_schemas = std::collections::BTreeMap::new();
    let result = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(apply_transform(
            &operation,
            &needed,
            &data_sources,
            &cache,
            &table_schemas,
            &[],
            &[],
            &mut vt_type_schemas,
        ));

    assert!(
        result.is_err(),
        "a missing on-column must error, not silently produce an empty/misaligned join: {:?}",
        result.map(|(_, rows)| rows.len())
    );
}

#[test]
fn test_join_cross_type_base_column_keys_are_rejected() {
    // Without a type check, `join_key`'s `id_string` rendering would match Integer `1`
    // against Text `'1'` (both render `"1"`) -- a cross-type join the compiler already
    // refuses to emit SQL for (`RejectReason::JoinKeyTypeMismatch`, compile.rs). Restoring
    // symmetry: the extractor must reject the same blueprint, not silently compute it.
    // Uses real `TransformSource::Table` sources (not the `VirtualTable`-cache
    // workaround the other Join tests use) so the check is exercised through
    // `table_schemas` -- the declared-type lookup a *base-table* join key resolves
    // through -- matching the "cross-type base-column VT join" case the compiler
    // already rejects for the identical blueprint shape (see
    // `compile_tests::join_key_type_mismatch_is_rejected`).
    let mut a_columns = HashMap::new();
    a_columns.insert(
        "k".to_string(),
        crate::data_source::DataSourceColumnInfo {
            name: "k".to_string(),
            col_type: "Integer".to_string(),
            is_nullable: false,
        },
    );
    let a_info = DataSourceTableInfo {
        name: "a".to_string(),
        columns: a_columns,
        primary_keys: Vec::new(),
        foreign_keys: Vec::new(),
    };
    let mut b_columns = HashMap::new();
    b_columns.insert(
        "k".to_string(),
        crate::data_source::DataSourceColumnInfo {
            name: "k".to_string(),
            col_type: "Text".to_string(),
            is_nullable: false,
        },
    );
    let b_info = DataSourceTableInfo {
        name: "b".to_string(),
        columns: b_columns,
        primary_keys: Vec::new(),
        foreign_keys: Vec::new(),
    };

    let mut table_schemas: TableSchemaLookup = HashMap::new();
    table_schemas.insert(("s1", "a"), &a_info);
    table_schemas.insert(("s1", "b"), &b_info);

    let operation = TransformOperation::Join {
        left: TransformSource::Table {
            source_id: "s1".to_string(),
            table_name: "a".to_string(),
        },
        right: TransformSource::Table {
            source_id: "s1".to_string(),
            table_name: "b".to_string(),
        },
        join_type: JoinType::Inner,
        on: vec![("k".to_string(), "k".to_string())],
    };

    // The type check is declarative (declared schema only) and runs before any row is
    // fetched, so `data_sources`/`cache` are never touched -- left empty on purpose,
    // rather than standing up a real connection, to keep this a pure unit test.
    let needed: HashSet<String> = ["k"].iter().map(|s| s.to_string()).collect();
    let data_sources = HashMap::new();
    let cache = HashMap::new();
    let mut vt_type_schemas = std::collections::BTreeMap::new();
    let result = tokio::runtime::Runtime::new().unwrap().block_on(apply_transform(
        &operation,
        &needed,
        &data_sources,
        &cache,
        &table_schemas,
        &[],
        &[],
        &mut vt_type_schemas,
    ));

    // Asserting on the message content, not just `is_err()`: with an empty
    // `data_sources`, fetching would *also* fail (a different error, "No data source for
    // id"), so `is_err()` alone wouldn't prove the type check specifically fired.
    let err = result.expect_err("cross-type join keys (Integer vs Text) must be rejected");
    assert!(
        err.contains("declared types"),
        "expected the cross-type join-key rejection, got a different error: {}",
        err
    );
}
