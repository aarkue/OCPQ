//! Differential tests: the compiled views must agree with `execute_extraction`.
//!
//! The extractor is the reference. Each test builds a small SQLite fixture, runs the
//! extractor over it, runs the compiled views over the same file through the DuckDB CLI
//! (which reads the fixture via its sqlite extension), and compares the OCEL surface.
//!
//! Tests that need the fixture are skipped when `sqlite3` or `duckdb` is not on PATH.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use process_mining::core::event_data::object_centric::linked_ocel::{
    LinkedOCELAccess, SlimLinkedOCEL,
};

use super::blueprint::{
    ChangeTableCondition, ChangeTableEventRule, DataExtractionBlueprint, DataSourceConfig,
    DataSourceType, InlineObjectReference, JoinType, MultiValueConfig, ObjectTypeSpec,
    TableExtractionConfig, TableUsageData, TimestampFormat, TimestampSource, TransformOperation,
    TransformSource, ValueExpression, VirtualTableConfig,
};
use super::compile::{
    compile_blueprint, resolve_vt_schemas, CompiledOcel, ProbeKind, RejectReason, SqlDialect,
};
use crate::data_source::DataSourceTableInfo;

const TS_FMT: &str = "%Y-%m-%d %H:%M:%S";

/// See `duckdb_emission_is_unchanged_by_dialect_refactor`. Filled in from the compiler's
/// own output before the dialect refactor -- this is a snapshot, not a hand-written spec.
const DUCKDB_SNAPSHOT_DDL: &str = "CREATE VIEW \"object\" AS\nSELECT DISTINCT ocel_id, ocel_type FROM (\n  SELECT ('Flag-' || CASE WHEN t.\"active\" THEN 'true' ELSE 'false' END) AS ocel_id, 'Flag' AS ocel_type FROM \"flags\" AS t WHERE t.\"active\" IS NOT NULL\n  UNION ALL SELECT CAST(t.\"cids\" AS VARCHAR) AS ocel_id, 'Cust' AS ocel_type FROM \"orders\" AS t WHERE CAST(t.\"cids\" AS VARCHAR) <> ''\n) AS object_union;\nCREATE VIEW \"object_Cust\" AS\nSELECT ocel_id, TIMESTAMP '1970-01-01 00:00:00' AS ocel_time, CAST(NULL AS VARCHAR) AS ocel_changed_field FROM \"object\" WHERE ocel_type = 'Cust';\nCREATE VIEW \"object_Flag\" AS\nSELECT ocel_id, TIMESTAMP '1970-01-01 00:00:00' AS ocel_time, CAST(NULL AS VARCHAR) AS ocel_changed_field FROM \"object\" WHERE ocel_type = 'Flag';\nCREATE VIEW \"event_all\" AS\nSELECT DISTINCT ocel_id, ocel_type, ocel_time FROM (\n  SELECT ('evt-' || CAST(t.\"oid\" AS VARCHAR)) AS ocel_id, 'PlaceOrder' AS ocel_type, TIMESTAMP '2020-05-04 03:02:01' AS ocel_time FROM \"orders\" AS t\n) AS event_union;\nCREATE VIEW \"event\" AS\nSELECT ocel_id, ocel_type FROM \"event_all\";\nCREATE VIEW \"event_PlaceOrder\" AS\nSELECT ocel_id, ocel_time FROM \"event_all\" WHERE ocel_type = 'PlaceOrder';\nCREATE VIEW \"event_map_type\" AS\nSELECT 'PlaceOrder' AS ocel_type, 'PlaceOrder' AS ocel_type_map;\nCREATE VIEW \"object_map_type\" AS\nSELECT 'Cust' AS ocel_type, 'Cust' AS ocel_type_map\n  UNION ALL SELECT 'Flag' AS ocel_type, 'Flag' AS ocel_type_map;\nCREATE VIEW \"event_object\" AS\nSELECT DISTINCT ocel_event_id, ocel_object_id, ocel_qualifier FROM (\n  SELECT ('evt-' || CAST(t.\"oid\" AS VARCHAR)) AS ocel_event_id, CAST(t.\"cids\" AS VARCHAR) AS ocel_object_id, 'linked' AS ocel_qualifier FROM \"orders\" AS t WHERE CAST(t.\"cids\" AS VARCHAR) <> '' AND ('evt-' || CAST(t.\"oid\" AS VARCHAR)) IN (SELECT ocel_id FROM \"event\") AND CAST(t.\"cids\" AS VARCHAR) IN (SELECT ocel_id FROM \"object\")\n  UNION ALL SELECT CAST(t.\"oid\" AS VARCHAR) AS ocel_event_id, trim(t.\"__mv0\", '\t\n\u{b}\u{c}\r \u{85}\u{a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}') AS ocel_object_id, '' AS ocel_qualifier FROM (SELECT t.*, unnest(string_split(CAST(t.\"cids\" AS VARCHAR), ',')) AS \"__mv0\" FROM \"orders\" AS t WHERE CAST(t.\"cids\" AS VARCHAR) IS NOT NULL AND CAST(t.\"cids\" AS VARCHAR) <> '') AS t WHERE trim(t.\"__mv0\", '\t\n\u{b}\u{c}\r \u{85}\u{a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}') <> '' AND CAST(t.\"oid\" AS VARCHAR) IN (SELECT ocel_id FROM \"event\") AND trim(t.\"__mv0\", '\t\n\u{b}\u{c}\r \u{85}\u{a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}') IN (SELECT ocel_id FROM \"object\")\n) AS rel_union;\nCREATE VIEW \"object_object\" AS\nSELECT CAST(NULL AS VARCHAR) AS ocel_source_id, CAST(NULL AS VARCHAR) AS ocel_target_id, CAST(NULL AS VARCHAR) AS ocel_qualifier WHERE 1 = 0;";

/// See `duckdb_emission_is_unchanged_by_dialect_refactor`: the `DuplicateEventIdWithInlineRefs`
/// probe's SQL, which is not part of `ddl()` and so needs its own pin.
const DUCKDB_SNAPSHOT_DUPLICATE_INLINE_REFS_PROBE: &str = "SELECT ocel_id FROM (\n  SELECT ('evt-' || CAST(t.\"oid\" AS VARCHAR)) AS ocel_id FROM \"orders\" AS t\n) AS dup GROUP BY ocel_id HAVING COUNT(*) > 1";

fn have_tools() -> bool {
    ["sqlite3", "duckdb"].iter().all(|bin| {
        Command::new("which")
            .arg(bin)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}

fn fixture(name: &str, ddl: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("ocpq-compile-tests");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!("{}.sqlite", name));
    let _ = std::fs::remove_file(&path);
    let out = Command::new("sqlite3")
        .arg(&path)
        .arg(ddl)
        .output()
        .expect("sqlite3 failed to run");
    assert!(
        out.status.success(),
        "sqlite3 fixture failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    path
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Runtime::new().unwrap()
}

/// Discover the real table metadata, so the blueprint carries the same declared column
/// types the compiler will reason about in production.
fn table_info(path: &Path, table: &str) -> DataSourceTableInfo {
    runtime().block_on(async {
        let ds = dbcon::DataSource::new_any("fixture".to_string(), conn_string(path))
            .await
            .expect("connect");
        DataSourceTableInfo::from(ds.tables.get(table).expect("table discovered"))
    })
}

fn conn_string(path: &Path) -> String {
    format!("sqlite:{}", path.display())
}

fn source(path: &Path) -> DataSourceConfig {
    DataSourceConfig {
        id: "s1".to_string(),
        source_type: DataSourceType::SQLite,
        name: "fixture".to_string(),
        connection_string: conn_string(path),
    }
}

fn table(path: &Path, table_name: &str, usage: TableUsageData) -> TableExtractionConfig {
    TableExtractionConfig {
        source_id: "s1".to_string(),
        table_name: table_name.to_string(),
        table_info: table_info(path, table_name),
        usage,
        virtual_table_id: None,
    }
}

/// The OCEL surface, flattened for comparison.
type Surface = BTreeSet<(String, String, String, String)>;

fn extract(blueprint: &DataExtractionBlueprint) -> SlimLinkedOCEL {
    runtime()
        .block_on(super::execute_extraction_slim_with_dbcon(blueprint))
        .expect("extraction")
        .0
}

fn surface_from_extractor(locel: &SlimLinkedOCEL) -> Surface {
    let mut out = Surface::new();
    for ob in locel.get_all_obs() {
        out.insert((
            "object".to_string(),
            locel.get_ob_id(&ob).to_string(),
            locel.get_ob_type_of(&ob).to_string(),
            String::new(),
        ));
        for (qual, target) in locel.get_o2o(&ob) {
            out.insert((
                "o2o".to_string(),
                locel.get_ob_id(&ob).to_string(),
                locel.get_ob_id(target).to_string(),
                qual.to_string(),
            ));
        }
    }
    for ev in locel.get_all_evs() {
        out.insert((
            "event".to_string(),
            locel.get_ev_id(&ev).to_string(),
            locel.get_ev_type_of(&ev).to_string(),
            locel
                .get_ev_time(&ev)
                .naive_utc()
                .format(TS_FMT)
                .to_string(),
        ));
        for (qual, ob) in locel.get_e2o(&ev) {
            out.insert((
                "e2o".to_string(),
                locel.get_ev_id(&ev).to_string(),
                locel.get_ob_id(ob).to_string(),
                qual.to_string(),
            ));
        }
    }
    out
}

const SURFACE_QUERY: &str = "\
SELECT 'object' AS kind, ocel_id AS a, ocel_type AS b, '' AS c FROM \"object\"
UNION ALL SELECT 'event', ocel_id, ocel_type, strftime(ocel_time, '%Y-%m-%d %H:%M:%S') FROM \"event_all\"
UNION ALL SELECT 'e2o', ocel_event_id, ocel_object_id, ocel_qualifier FROM \"event_object\"
UNION ALL SELECT 'o2o', ocel_source_id, ocel_target_id, ocel_qualifier FROM \"object_object\"
ORDER BY 1, 2, 3, 4";

/// Run setup + views + one final SELECT through the DuckDB CLI, returning JSON rows.
fn run_duckdb(path: &Path, blueprint: &DataExtractionBlueprint, ddl: &str, query: &str) -> String {
    let mut script = String::new();
    script.push_str("INSTALL sqlite; LOAD sqlite;\n");
    script.push_str(&format!(
        "ATTACH '{}' AS src (TYPE sqlite);\n",
        path.display()
    ));
    // Copy into the default in-memory catalog so the compiled (unqualified) view SQL
    // resolves without a search-path dependency, and so views are creatable.
    let mut copied = BTreeSet::new();
    for t in &blueprint.tables {
        if copied.insert(t.table_name.clone()) {
            script.push_str(&format!(
                "CREATE TABLE \"{0}\" AS SELECT * FROM src.\"{0}\";\n",
                t.table_name
            ));
        }
    }
    script.push_str(ddl);
    script.push('\n');
    script.push_str(query);
    script.push(';');

    let out = Command::new("duckdb")
        .arg("-json")
        .arg("-c")
        .arg(&script)
        .output()
        .expect("duckdb failed to run");
    assert!(
        out.status.success(),
        "duckdb failed: {}\n--- script ---\n{}",
        String::from_utf8_lossy(&out.stderr),
        script
    );
    String::from_utf8_lossy(&out.stdout).to_string()
}

fn parse_surface(raw: &str) -> Surface {
    let rows: Vec<serde_json::Value> = if raw.trim().is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(raw).unwrap_or_else(|e| panic!("bad duckdb json: {} in {}", e, raw))
    };
    rows.into_iter()
        .map(|r| {
            let get = |k: &str| match &r[k] {
                serde_json::Value::Null => String::new(),
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            (get("kind"), get("a"), get("b"), get("c"))
        })
        .collect()
}

fn surface_from_views(
    path: &Path,
    blueprint: &DataExtractionBlueprint,
    compiled: &CompiledOcel,
) -> Surface {
    parse_surface(&run_duckdb(path, blueprint, &compiled.ddl(), SURFACE_QUERY))
}

/// Same surface, view-free: no DDL is run; the relations are supplied to the surface
/// query as a `WITH` prelude ([`CompiledOcel::with_prelude`]).
fn surface_from_no_view(
    path: &Path,
    blueprint: &DataExtractionBlueprint,
    compiled: &CompiledOcel,
) -> Surface {
    parse_surface(&run_duckdb(
        path,
        blueprint,
        "",
        &compiled.with_prelude(SURFACE_QUERY),
    ))
}

/// Every probe must hold (return zero rows) for the comparison to be meaningful.
fn assert_probes_hold(path: &Path, blueprint: &DataExtractionBlueprint, compiled: &CompiledOcel) {
    for probe in &compiled.probes {
        let raw = run_duckdb(
            path,
            blueprint,
            &compiled.ddl(),
            &format!("SELECT COUNT(*) AS n FROM ({}) AS probe_result", probe.sql),
        );
        let rows: Vec<serde_json::Value> = serde_json::from_str(&raw).expect("probe json");
        let n = rows[0]["n"].as_i64().unwrap();
        assert_eq!(n, 0, "probe {:?} did not hold: {}", probe.kind, probe.sql);
    }
}

fn assert_agrees(path: &Path, blueprint: &DataExtractionBlueprint) -> CompiledOcel {
    let compiled = compile_blueprint(blueprint, SqlDialect::DuckDB);
    assert!(
        compiled.errors.is_empty(),
        "unexpected compile errors: {:?}",
        compiled
            .errors
            .iter()
            .map(|e| e.to_string())
            .collect::<Vec<_>>()
    );
    assert_probes_hold(path, blueprint, &compiled);
    let expected = surface_from_extractor(&extract(blueprint));
    let actual = surface_from_views(path, blueprint, &compiled);
    assert_eq!(
        expected,
        actual,
        "view path and extraction path disagree\nonly in extractor: {:?}\nonly in views: {:?}",
        expected.difference(&actual).collect::<Vec<_>>(),
        actual.difference(&expected).collect::<Vec<_>>()
    );
    compiled
}

fn col(name: &str) -> ValueExpression {
    ValueExpression::Column {
        column: name.to_string(),
    }
}

fn constant(value: &str) -> ValueExpression {
    ValueExpression::Constant {
        value: value.to_string(),
    }
}

fn native_ts(column: &str) -> TimestampSource {
    TimestampSource::Column {
        column: column.to_string(),
        format: TimestampFormat::Auto,
    }
}

const BASIC_FIXTURE_SQL: &str = "CREATE TABLE customers(cid TEXT NOT NULL, name TEXT);
     INSERT INTO customers VALUES ('c1','Alice'),('c2','Bob');
     CREATE TABLE orders(oid TEXT NOT NULL, cid TEXT NOT NULL, ts TIMESTAMP NOT NULL);
     INSERT INTO orders VALUES ('o1','c1','2024-01-15 10:30:00'),
                               ('o2','c2','2024-01-16 11:00:00');
     CREATE TABLE links(oid TEXT NOT NULL, cid TEXT NOT NULL, q TEXT NOT NULL);
     INSERT INTO links VALUES ('o1','c1','places'),('o2','c9','dangling');";

/// Customer/Order + PlaceOrder event + O2O blueprint over [`BASIC_FIXTURE_SQL`].
/// Exercises object, event, per-type, and e2o/o2o relations plus identity probes.
fn basic_blueprint(path: &Path) -> DataExtractionBlueprint {
    DataExtractionBlueprint {
        sources: vec![source(path)],
        virtual_tables: Vec::new(),
        tables: vec![
            table(
                path,
                "customers",
                TableUsageData::Object {
                    object_type: constant("Customer"),
                    id: col("cid"),
                    prefix_id_with_type: false,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
            table(
                path,
                "orders",
                TableUsageData::Object {
                    object_type: constant("Order"),
                    id: col("oid"),
                    prefix_id_with_type: false,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
            table(
                path,
                "orders",
                TableUsageData::Event {
                    event_type: constant("PlaceOrder"),
                    id: Some(ValueExpression::Template {
                        template: "evt-{oid}".to_string(),
                    }),
                    timestamp: native_ts("ts"),
                    inline_object_references: Vec::new(),
                },
            ),
            table(
                path,
                "links",
                TableUsageData::O2ORelation {
                    source_object: col("oid"),
                    target_object: col("cid"),
                    qualifier: Some(col("q")),
                    source_object_type: None,
                    target_object_type: None,
                    source_object_multi: None,
                    target_object_multi: None,
                },
            ),
        ],
    }
}

#[test]
fn events_objects_and_relations_agree() {
    if !have_tools() {
        return;
    }
    // 'o2' -> 'c9' in links is dangling: the extractor drops it, so the view must too.
    let path = fixture("basic", BASIC_FIXTURE_SQL);
    let blueprint = basic_blueprint(&path);

    let compiled = assert_agrees(&path, &blueprint);
    // The dangling o2->c9 link must be absent from both sides.
    let surface = surface_from_views(&path, &blueprint, &compiled);
    assert!(!surface.iter().any(|(k, _, b, _)| k == "o2o" && b == "c9"));
    assert!(surface.contains(&(
        "o2o".to_string(),
        "o1".to_string(),
        "c1".to_string(),
        "places".to_string()
    )));
}

/// The view-free emission paths (`with_prelude`, `materialize_ddl`) and view-free
/// certification (`probes` under `with_prelude`) agree with the `CREATE VIEW` path.
#[test]
fn no_view_and_materialized_emission_match_view_path() {
    if !have_tools() {
        return;
    }
    let path = fixture("no_view", BASIC_FIXTURE_SQL);
    let blueprint = basic_blueprint(&path);
    let compiled = compile_blueprint(&blueprint, SqlDialect::DuckDB);
    assert!(
        compiled.errors.is_empty(),
        "unexpected compile errors: {:?}",
        compiled
            .errors
            .iter()
            .map(|e| e.to_string())
            .collect::<Vec<_>>()
    );
    assert!(!compiled.views.is_empty(), "expected relations to compile");

    let view_surface = surface_from_views(&path, &blueprint, &compiled);
    assert_eq!(
        view_surface,
        surface_from_extractor(&extract(&blueprint)),
        "view path must match the extractor (guards the comparison)"
    );

    // (1) View-free WITH-prelude emission yields the same surface, no DDL run.
    assert_eq!(
        surface_from_no_view(&path, &blueprint, &compiled),
        view_surface,
        "with_prelude (no-view) surface disagrees with the view path"
    );

    // (2) Materialized CREATE TABLE AS emission yields the same surface.
    let mat_surface = parse_surface(&run_duckdb(
        &path,
        &blueprint,
        &compiled.materialize_ddl(),
        SURFACE_QUERY,
    ));
    assert_eq!(
        mat_surface, view_surface,
        "materialized surface disagrees with the view path"
    );

    // (3) Certification holds view-free: every probe returns zero rows with only the
    // relation CTEs present (no views created).
    assert!(
        !compiled.probes.is_empty(),
        "expected at least one identity probe"
    );
    for probe in &compiled.probes {
        let counted = format!("SELECT COUNT(*) AS n FROM ({}) AS probe_result", probe.sql);
        let raw = run_duckdb(&path, &blueprint, "", &compiled.with_prelude(&counted));
        let rows: Vec<serde_json::Value> = serde_json::from_str(&raw).expect("probe json");
        assert_eq!(
            rows[0]["n"].as_i64().unwrap(),
            0,
            "view-free probe did not hold: {:?}",
            probe.kind
        );
    }
}

#[test]
fn inline_object_references_create_objects_and_relations() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "inline",
        "CREATE TABLE orders(oid TEXT NOT NULL, cid TEXT NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO orders VALUES ('o1','c1','2024-01-15 10:30:00'),
                                   ('o2','c1','2024-01-16 11:00:00'),
                                   ('o3','','2024-01-17 11:00:00');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![table(
            &path,
            "orders",
            TableUsageData::Event {
                event_type: constant("PlaceOrder"),
                id: Some(col("oid")),
                timestamp: native_ts("ts"),
                inline_object_references: vec![InlineObjectReference {
                    id: "r1".to_string(),
                    // No Customer object usage exists, so these objects only come into
                    // being through the inline reference.
                    object_id: col("cid"),
                    object_type: Some(ObjectTypeSpec::Fixed("Customer".to_string())),
                    qualifier: Some(constant("buyer")),
                    multi_value_config: None,
                }],
            },
        )],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);
    assert!(surface.contains(&(
        "object".to_string(),
        "c1".to_string(),
        "Customer".to_string(),
        String::new()
    )));
    // The empty cid on o3 yields no object and no relation.
    assert!(!surface
        .iter()
        .any(|(k, _, b, _)| k == "e2o" && b.is_empty()));
}

fn multi_value(delimiter: &str, trim_values: bool) -> MultiValueConfig {
    MultiValueConfig {
        enabled: true,
        delimiter: delimiter.to_string(),
        trim_values,
        regex_pattern: None,
    }
}

/// Delimiter multi-value split on an E2O target, trimmed: mirrors `MultiValueConfig::split`'s
/// delimiter branch (trim each part, drop empties) for `'o1, o2'`, `''`, `'o1,,o3'`, `' o1 '`.
#[test]
fn e2o_multi_value_delimiter_trim_on_agrees() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "e2o_mv_trim_on",
        "CREATE TABLE objs(oid TEXT NOT NULL);
         INSERT INTO objs VALUES ('o1'),('o2'),('o3');
         CREATE TABLE events(eid TEXT NOT NULL, cid TEXT NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO events VALUES
             ('e1','o1, o2','2024-01-01 00:00:00'),
             ('e2','','2024-01-02 00:00:00'),
             ('e3','o1,,o3','2024-01-03 00:00:00'),
             ('e4',' o1 ','2024-01-04 00:00:00');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![
            table(
                &path,
                "objs",
                TableUsageData::Object {
                    object_type: constant("Thing"),
                    id: col("oid"),
                    prefix_id_with_type: false,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
            table(
                &path,
                "events",
                TableUsageData::Event {
                    event_type: constant("Evt"),
                    id: Some(col("eid")),
                    timestamp: native_ts("ts"),
                    inline_object_references: Vec::new(),
                },
            ),
            table(
                &path,
                "events",
                TableUsageData::E2ORelation {
                    source_event: col("eid"),
                    target_object: col("cid"),
                    qualifier: None,
                    target_object_type: None,
                    target_object_multi: Some(multi_value(",", true)),
                },
            ),
        ],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);
    let has_e2o = |e: &str, o: &str| {
        surface.contains(&(
            "e2o".to_string(),
            e.to_string(),
            o.to_string(),
            String::new(),
        ))
    };
    assert!(has_e2o("e1", "o1"));
    assert!(has_e2o("e1", "o2"));
    assert!(!surface.iter().any(|(k, a, _, _)| k == "e2o" && a == "e2"));
    assert!(has_e2o("e3", "o1"));
    assert!(has_e2o("e3", "o3"));
    assert!(has_e2o("e4", "o1"));
}

/// Same as above with `trim_values: false`: an untrimmed part keeps its surrounding
/// whitespace, a middle empty part between two delimiters is still dropped regardless of
/// trim, and a whole untrimmed single-part value (no delimiter present) is kept verbatim.
#[test]
fn e2o_multi_value_delimiter_trim_off_agrees() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "e2o_mv_trim_off",
        "CREATE TABLE objs(oid TEXT NOT NULL);
         INSERT INTO objs VALUES ('o1'),(' o2'),('o3'),(' o1 ');
         CREATE TABLE events(eid TEXT NOT NULL, cid TEXT NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO events VALUES
             ('e1','o1, o2','2024-01-01 00:00:00'),
             ('e2','','2024-01-02 00:00:00'),
             ('e3','o1,,o3','2024-01-03 00:00:00'),
             ('e4',' o1 ','2024-01-04 00:00:00');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![
            table(
                &path,
                "objs",
                TableUsageData::Object {
                    object_type: constant("Thing"),
                    id: col("oid"),
                    prefix_id_with_type: false,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
            table(
                &path,
                "events",
                TableUsageData::Event {
                    event_type: constant("Evt"),
                    id: Some(col("eid")),
                    timestamp: native_ts("ts"),
                    inline_object_references: Vec::new(),
                },
            ),
            table(
                &path,
                "events",
                TableUsageData::E2ORelation {
                    source_event: col("eid"),
                    target_object: col("cid"),
                    qualifier: None,
                    target_object_type: None,
                    target_object_multi: Some(multi_value(",", false)),
                },
            ),
        ],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);
    let has_e2o = |e: &str, o: &str| {
        surface.contains(&(
            "e2o".to_string(),
            e.to_string(),
            o.to_string(),
            String::new(),
        ))
    };
    assert!(has_e2o("e1", "o1"));
    assert!(has_e2o("e1", " o2"));
    assert!(has_e2o("e3", "o1"));
    assert!(has_e2o("e3", "o3"));
    assert!(has_e2o("e4", " o1 "));
}

/// `trim_values` must strip the *full* Unicode `White_Space` set, matching Rust's
/// `str::trim` exactly -- not just ASCII space/tab/CR/LF. NBSP (U+00A0) and LINE SEPARATOR
/// (U+2028) are both real-world cases (common in pasted spreadsheet/CSV exports). A
/// non-whitespace lookalike, ZERO WIDTH SPACE (U+200B), must NOT be stripped, proving the
/// mirror isn't simply "trim everything non-alphanumeric".
#[test]
fn e2o_multi_value_delimiter_trim_full_unicode_whitespace_agrees() {
    if !have_tools() {
        return;
    }
    let nbsp = '\u{00A0}';
    let sep2028 = '\u{2028}';
    let zwsp = '\u{200B}';
    let ddl = format!(
        "CREATE TABLE objs(oid TEXT NOT NULL);
         INSERT INTO objs VALUES ('o1'),('o2'),('o3'),('{zwsp}o4{zwsp}');
         CREATE TABLE events(eid TEXT NOT NULL, cid TEXT NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO events VALUES
             ('e1','{nbsp}o1{nbsp}','2024-01-01 00:00:00'),
             ('e2','{sep2028}o2{sep2028}','2024-01-02 00:00:00'),
             ('e3','{nbsp}o1{nbsp},{sep2028}o3{sep2028}','2024-01-03 00:00:00'),
             ('e4','{zwsp}o4{zwsp}','2024-01-04 00:00:00');"
    );
    let path = fixture("e2o_mv_trim_unicode_ws", &ddl);
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![
            table(
                &path,
                "objs",
                TableUsageData::Object {
                    object_type: constant("Thing"),
                    id: col("oid"),
                    prefix_id_with_type: false,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
            table(
                &path,
                "events",
                TableUsageData::Event {
                    event_type: constant("Evt"),
                    id: Some(col("eid")),
                    timestamp: native_ts("ts"),
                    inline_object_references: Vec::new(),
                },
            ),
            table(
                &path,
                "events",
                TableUsageData::E2ORelation {
                    source_event: col("eid"),
                    target_object: col("cid"),
                    qualifier: None,
                    target_object_type: None,
                    target_object_multi: Some(multi_value(",", true)),
                },
            ),
        ],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);
    let has_e2o = |e: &str, o: &str| {
        surface.contains(&(
            "e2o".to_string(),
            e.to_string(),
            o.to_string(),
            String::new(),
        ))
    };
    // Leading and trailing NBSP, single part, no delimiter present.
    assert!(has_e2o("e1", "o1"));
    // Leading and trailing LINE SEPARATOR (U+2028), single part.
    assert!(has_e2o("e2", "o2"));
    // Both codepoints, mixed across two comma-separated parts.
    assert!(has_e2o("e3", "o1"));
    assert!(has_e2o("e3", "o3"));
    // ZERO WIDTH SPACE is not Unicode whitespace: it must survive the trim verbatim.
    let zwsp_id = format!("{zwsp}o4{zwsp}");
    assert!(has_e2o("e4", &zwsp_id));
    assert!(!has_e2o("e4", "o4"));
}

/// O2O with both endpoints multi-valued: the extractor's nested for-loops over
/// (source parts) x (target parts) is a cross product, and an empty parts list on either
/// side (whether from a wholly empty raw value or from a delimiter-only value with all
/// parts filtered) yields zero relations regardless of the other side's parts.
#[test]
fn o2o_both_sides_multi_value_cross_product_agrees() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "o2o_mv_cross",
        "CREATE TABLE nodes(nid TEXT NOT NULL);
         INSERT INTO nodes VALUES ('s1'),('s2'),('s3'),('s4'),('t1'),('t2'),('t3');
         CREATE TABLE links(lid TEXT NOT NULL, sid TEXT NOT NULL, tid TEXT NOT NULL);
         INSERT INTO links VALUES
             ('l1','s1,s2','t1,t2'),
             ('l2','s3,,s4','t3'),
             ('l3','','t1');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![
            table(
                &path,
                "nodes",
                TableUsageData::Object {
                    object_type: constant("Node"),
                    id: col("nid"),
                    prefix_id_with_type: false,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
            table(
                &path,
                "links",
                TableUsageData::O2ORelation {
                    source_object: col("sid"),
                    target_object: col("tid"),
                    qualifier: Some(col("lid")),
                    source_object_type: None,
                    target_object_type: None,
                    source_object_multi: Some(multi_value(",", true)),
                    target_object_multi: Some(multi_value(",", true)),
                },
            ),
        ],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);
    let has = |s: &str, t: &str, q: &str| {
        surface.contains(&(
            "o2o".to_string(),
            s.to_string(),
            t.to_string(),
            q.to_string(),
        ))
    };
    assert!(has("s1", "t1", "l1"));
    assert!(has("s1", "t2", "l1"));
    assert!(has("s2", "t1", "l1"));
    assert!(has("s2", "t2", "l1"));
    assert!(has("s3", "t3", "l2"));
    assert!(has("s4", "t3", "l2"));
    assert_eq!(surface.iter().filter(|(k, _, _, _)| k == "o2o").count(), 6);
}

/// Inline object reference with a delimiter multi-value config: each split part both
/// creates its own object and its own qualified E2O relation.
#[test]
fn inline_ref_multi_value_delimiter_agrees() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "inline_mv",
        "CREATE TABLE orders(oid TEXT NOT NULL, cids TEXT NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO orders VALUES
             ('o1','c1, c2','2024-01-01 00:00:00'),
             ('o2','','2024-01-02 00:00:00'),
             ('o3','c1,,c3','2024-01-03 00:00:00');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![table(
            &path,
            "orders",
            TableUsageData::Event {
                event_type: constant("PlaceOrder"),
                id: Some(col("oid")),
                timestamp: native_ts("ts"),
                inline_object_references: vec![InlineObjectReference {
                    id: "r1".to_string(),
                    object_id: col("cids"),
                    object_type: Some(ObjectTypeSpec::Fixed("Customer".to_string())),
                    qualifier: Some(constant("buyer")),
                    multi_value_config: Some(multi_value(",", true)),
                }],
            },
        )],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);
    let has_obj = |id: &str| {
        surface.contains(&(
            "object".to_string(),
            id.to_string(),
            "Customer".to_string(),
            String::new(),
        ))
    };
    assert!(has_obj("c1"));
    assert!(has_obj("c2"));
    assert!(has_obj("c3"));
    let has_e2o = |e: &str, o: &str| {
        surface.contains(&(
            "e2o".to_string(),
            e.to_string(),
            o.to_string(),
            "buyer".to_string(),
        ))
    };
    assert!(has_e2o("o1", "c1"));
    assert!(has_e2o("o1", "c2"));
    assert!(has_e2o("o3", "c1"));
    assert!(has_e2o("o3", "c3"));
    assert!(!surface.iter().any(|(k, a, _, _)| k == "e2o" && a == "o2"));
}

/// A nullable qualifier column keeps the NULL-tolerant path: `get_id_string` -> None ->
/// `unwrap_or_default()` -> `""`, mirrored by `COALESCE(CAST(col AS VARCHAR), '')`. Unlike
/// identity positions, a null qualifier column does not drop the row on either side.
#[test]
fn nullable_qualifier_column_agrees_as_empty_string() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "nullqual",
        "CREATE TABLE customers(cid TEXT NOT NULL);
         INSERT INTO customers VALUES ('c1'),('c2');
         CREATE TABLE orders(oid TEXT NOT NULL);
         INSERT INTO orders VALUES ('o1'),('o2');
         CREATE TABLE links(oid TEXT NOT NULL, cid TEXT NOT NULL, q TEXT);
         INSERT INTO links VALUES ('o1','c1','vip'), ('o2','c2',NULL);",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![
            table(
                &path,
                "customers",
                TableUsageData::Object {
                    object_type: constant("Customer"),
                    id: col("cid"),
                    prefix_id_with_type: false,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
            table(
                &path,
                "orders",
                TableUsageData::Object {
                    object_type: constant("Order"),
                    id: col("oid"),
                    prefix_id_with_type: false,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
            table(
                &path,
                "links",
                TableUsageData::O2ORelation {
                    source_object: col("oid"),
                    target_object: col("cid"),
                    qualifier: Some(col("q")),
                    source_object_type: None,
                    target_object_type: None,
                    source_object_multi: None,
                    target_object_multi: None,
                },
            ),
        ],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);
    // The null-qualifier row still participates (unlike a null identity column), just
    // with an empty-string qualifier.
    assert!(surface.contains(&(
        "o2o".to_string(),
        "o2".to_string(),
        "c2".to_string(),
        String::new()
    )));
    assert!(surface.contains(&(
        "o2o".to_string(),
        "o1".to_string(),
        "c1".to_string(),
        "vip".to_string()
    )));
}

/// Pins the exact SQL shape for a Boolean identity column: an explicit `CASE` (not a
/// bare cast) and a companion `IS NOT NULL` filter, with no `COALESCE` wrapper. Built
/// without a real database since this only inspects the compiled SQL text.
#[test]
fn boolean_identity_column_uses_case_and_not_null_filter() {
    let mut columns = std::collections::HashMap::new();
    columns.insert(
        "active".to_string(),
        crate::data_source::DataSourceColumnInfo {
            name: "active".to_string(),
            col_type: "Boolean".to_string(),
            is_nullable: true,
        },
    );
    let info = DataSourceTableInfo {
        name: "flags".to_string(),
        columns,
        primary_keys: Vec::new(),
        foreign_keys: Vec::new(),
    };
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&std::path::PathBuf::from("/nonexistent.sqlite"))],
        virtual_tables: Vec::new(),
        tables: vec![TableExtractionConfig {
            source_id: "s1".to_string(),
            table_name: "flags".to_string(),
            table_info: info,
            usage: TableUsageData::Object {
                object_type: constant("Flag"),
                id: col("active"),
                prefix_id_with_type: false,
                timestamp: None,
                attribute_config: None,
            },
            virtual_table_id: None,
        }],
    };

    let compiled = compile_blueprint(&blueprint, SqlDialect::DuckDB);
    assert!(compiled.errors.is_empty(), "{:?}", compiled.errors);
    let ddl = compiled.ddl();
    assert!(
        ddl.contains("CASE WHEN t.\"active\" THEN 'true' ELSE 'false' END"),
        "expected an explicit boolean CASE, not a bare cast: {}",
        ddl
    );
    assert!(
        ddl.contains("t.\"active\" IS NOT NULL"),
        "expected an IS NOT NULL filter alongside the boolean identity rendering: {}",
        ddl
    );
    assert!(
        !ddl.contains("COALESCE(CASE WHEN t.\"active\""),
        "identity positions must not be COALESCE-wrapped: {}",
        ddl
    );
}

/// Pins today's exact DuckDB DDL byte-for-byte, before the expression-level dialect
/// refactor (routing hardcoded DuckDB fragments through `SqlDialect`). No fixture: this
/// only inspects compiled SQL text, like `boolean_identity_column_uses_case_and_not_null_filter`
/// above. Exercises, in one blueprint: template concat (`evt-{oid}`), prefix concat
/// (`prefix_id_with_type` on a Boolean id, so concat and bool_to_text compose), a boolean
/// identity column, a delimiter multi-value split with trim on, a constant timestamp
/// (folds to a literal), a per-type object view (epoch literal), an empty relation view
/// (no O2ORelation usage, so `object_object` takes the empty branch), and an inline object
/// reference on the event (so `assemble` also emits a `DuplicateEventIdWithInlineRefs`
/// probe -- pinned separately below, since `ddl()` does not include probe SQL).
#[test]
fn duckdb_emission_is_unchanged_by_dialect_refactor() {
    let flags_info = table_info_of("flags", &[("active", "Boolean", true)]);
    let orders_info = table_info_of("orders", &[("oid", "Text", false), ("cids", "Text", false)]);

    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&std::path::PathBuf::from("/nonexistent.sqlite"))],
        virtual_tables: Vec::new(),
        tables: vec![
            TableExtractionConfig {
                source_id: "s1".to_string(),
                table_name: "flags".to_string(),
                table_info: flags_info,
                usage: TableUsageData::Object {
                    object_type: constant("Flag"),
                    id: col("active"),
                    prefix_id_with_type: true,
                    timestamp: None,
                    attribute_config: None,
                },
                virtual_table_id: None,
            },
            TableExtractionConfig {
                source_id: "s1".to_string(),
                table_name: "orders".to_string(),
                table_info: orders_info.clone(),
                usage: TableUsageData::Event {
                    event_type: constant("PlaceOrder"),
                    id: Some(ValueExpression::Template {
                        template: "evt-{oid}".to_string(),
                    }),
                    // Both arguments come from the blueprint, so Auto folds at compile time.
                    timestamp: TimestampSource::Constant {
                        value: "2020-05-04 03:02:01".to_string(),
                        format: TimestampFormat::Auto,
                    },
                    inline_object_references: vec![InlineObjectReference {
                        id: "r1".to_string(),
                        object_id: col("cids"),
                        object_type: Some(ObjectTypeSpec::Fixed("Cust".to_string())),
                        qualifier: Some(constant("linked")),
                        multi_value_config: None,
                    }],
                },
                virtual_table_id: None,
            },
            TableExtractionConfig {
                source_id: "s1".to_string(),
                table_name: "orders".to_string(),
                table_info: orders_info,
                usage: TableUsageData::E2ORelation {
                    source_event: col("oid"),
                    target_object: col("cids"),
                    qualifier: None,
                    target_object_type: None,
                    target_object_multi: Some(multi_value(",", true)),
                },
                virtual_table_id: None,
            },
        ],
    };

    let compiled = compile_blueprint(&blueprint, SqlDialect::DuckDB);
    assert!(compiled.errors.is_empty(), "{:?}", compiled.errors);
    let ddl = compiled.ddl();

    let probe = compiled
        .probes
        .iter()
        .find(|p| matches!(p.kind, ProbeKind::DuplicateEventIdWithInlineRefs))
        .expect("inline object reference must produce a DuplicateEventIdWithInlineRefs probe");

    assert_eq!(ddl, DUCKDB_SNAPSHOT_DDL, "DuckDB DDL changed byte-for-byte:\n{}", ddl);
    assert_eq!(
        probe.sql, DUCKDB_SNAPSHOT_DUPLICATE_INLINE_REFS_PROBE,
        "DuplicateEventIdWithInlineRefs probe SQL changed byte-for-byte:\n{}",
        probe.sql
    );
}

#[test]
fn change_table_events_first_match_wins() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "changes",
        "CREATE TABLE audit(rid TEXT NOT NULL, status TEXT, region TEXT, ts TIMESTAMP NOT NULL);
         INSERT INTO audit VALUES ('r1','active','EU','2024-01-15 10:30:00'),
                                  ('r2','active','US','2024-01-15 10:31:00'),
                                  ('r3','closed','EU','2024-01-15 10:32:00'),
                                  ('r4',NULL,'EU','2024-01-15 10:33:00');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![table(
            &path,
            "audit",
            TableUsageData::ChangeTableEvents {
                timestamp: native_ts("ts"),
                id: Some(col("rid")),
                event_rules: vec![
                    // r1 matches both rules; first-match-wins must pick ActiveEU.
                    ChangeTableEventRule {
                        id: "rule1".to_string(),
                        event_type: "ActiveEU".to_string(),
                        conditions: ChangeTableCondition::And {
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
                        },
                    },
                    ChangeTableEventRule {
                        id: "rule2".to_string(),
                        event_type: "AnyActive".to_string(),
                        conditions: ChangeTableCondition::ColumnEquals {
                            column: "status".to_string(),
                            value: "active".to_string(),
                        },
                    },
                    ChangeTableEventRule {
                        id: "rule3".to_string(),
                        event_type: "HasStatus".to_string(),
                        conditions: ChangeTableCondition::ColumnNotEmpty {
                            column: "status".to_string(),
                        },
                    },
                ],
                inline_object_references: Vec::new(),
            },
        )],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);
    assert!(surface.contains(&(
        "event".to_string(),
        "r1".to_string(),
        "ActiveEU".to_string(),
        "2024-01-15 10:30:00".to_string()
    )));
    assert!(surface
        .iter()
        .any(|(k, a, b, _)| k == "event" && a == "r2" && b == "AnyActive"));
    assert!(surface
        .iter()
        .any(|(k, a, b, _)| k == "event" && a == "r3" && b == "HasStatus"));
    // r4's status is NULL: ColumnNotEmpty is false, so no rule matches.
    assert!(!surface.iter().any(|(k, a, _, _)| k == "event" && a == "r4"));
}

/// A portable pattern exercising alternation, an anchored bracketed range, and a bounded
/// repetition all together -- proves `regexp_matches` and Rust `regex` agree on more than
/// a trivial single-construct pattern, not just that the guard lets it through.
#[test]
fn column_matches_allowed_pattern_agrees_with_extractor() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "regex_agree",
        "CREATE TABLE audit(rid TEXT NOT NULL, status TEXT, ts TIMESTAMP NOT NULL);
         INSERT INTO audit VALUES ('r1','active-EU','2024-01-15 10:30:00'),
                                  ('r2','active-us','2024-01-15 10:31:00'),
                                  ('r3','closed-DE','2024-01-15 10:32:00'),
                                  ('r4',NULL,'2024-01-15 10:33:00');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![table(
            &path,
            "audit",
            TableUsageData::ChangeTableEvents {
                timestamp: native_ts("ts"),
                id: Some(col("rid")),
                event_rules: vec![ChangeTableEventRule {
                    id: "rule1".to_string(),
                    event_type: "Matched".to_string(),
                    conditions: ChangeTableCondition::ColumnMatches {
                        column: "status".to_string(),
                        regex: r"^(active|closed)-[A-Z]{2}$".to_string(),
                    },
                }],
                inline_object_references: Vec::new(),
            },
        )],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);
    // r1 and r3 match (uppercase region code); r2's lowercase 'us' and r4's NULL do not.
    assert!(surface
        .iter()
        .any(|(k, a, b, _)| k == "event" && a == "r1" && b == "Matched"));
    assert!(surface
        .iter()
        .any(|(k, a, b, _)| k == "event" && a == "r3" && b == "Matched"));
    assert!(!surface.iter().any(|(k, a, _, _)| k == "event" && a == "r2"));
    assert!(!surface.iter().any(|(k, a, _, _)| k == "event" && a == "r4"));
}

#[test]
fn prefix_id_with_type_agrees() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "prefix",
        "CREATE TABLE customers(cid TEXT NOT NULL);
         INSERT INTO customers VALUES ('1'),('2');
         CREATE TABLE orders(oid TEXT NOT NULL, cid TEXT NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO orders VALUES ('1','1','2024-01-15 10:30:00');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![
            table(
                &path,
                "customers",
                TableUsageData::Object {
                    object_type: constant("Customer"),
                    id: col("cid"),
                    prefix_id_with_type: true,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
            table(
                &path,
                "orders",
                TableUsageData::Event {
                    event_type: constant("PlaceOrder"),
                    id: Some(ValueExpression::Template {
                        template: "evt-{oid}".to_string(),
                    }),
                    timestamp: native_ts("ts"),
                    inline_object_references: vec![InlineObjectReference {
                        id: "r1".to_string(),
                        object_id: col("cid"),
                        object_type: Some(ObjectTypeSpec::Fixed("Customer".to_string())),
                        qualifier: None,
                        multi_value_config: None,
                    }],
                },
            ),
        ],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);
    // Ids '1' and '2' collide across types unless the prefix is applied.
    assert!(surface.contains(&(
        "object".to_string(),
        "Customer-1".to_string(),
        "Customer".to_string(),
        String::new()
    )));
    assert!(surface
        .iter()
        .any(|(k, _, b, _)| k == "e2o" && b == "Customer-1"));
}

#[test]
fn constant_timestamp_folds_for_auto_format() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "constts",
        "CREATE TABLE items(iid TEXT NOT NULL);
         INSERT INTO items VALUES ('i1'),('i2');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![table(
            &path,
            "items",
            TableUsageData::Event {
                event_type: constant("Seen"),
                id: Some(col("iid")),
                // Both arguments come from the blueprint, so Auto folds at compile time.
                timestamp: TimestampSource::Constant {
                    value: "2020-05-04 03:02:01".to_string(),
                    format: TimestampFormat::Auto,
                },
                inline_object_references: Vec::new(),
            },
        )],
    };

    let compiled = assert_agrees(&path, &blueprint);
    assert!(
        compiled.ddl().contains("TIMESTAMP '2020-05-04 03:02:01'"),
        "constant timestamp should be folded into a literal: {}",
        compiled.ddl()
    );
}

#[test]
fn per_type_views_match_the_ocel_layout() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "pertype",
        "CREATE TABLE orders(oid TEXT NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO orders VALUES ('o1','2024-01-15 10:30:00');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![
            table(
                &path,
                "orders",
                TableUsageData::Object {
                    object_type: constant("Order"),
                    id: col("oid"),
                    prefix_id_with_type: false,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
            table(
                &path,
                "orders",
                TableUsageData::Event {
                    event_type: constant("PlaceOrder"),
                    id: Some(col("oid")),
                    timestamp: native_ts("ts"),
                    inline_object_references: Vec::new(),
                },
            ),
        ],
    };
    let compiled = compile_blueprint(&blueprint, SqlDialect::DuckDB);
    assert!(compiled.errors.is_empty(), "{:?}", compiled.errors);

    let raw = run_duckdb(
        &path,
        &blueprint,
        &compiled.ddl(),
        "SELECT (SELECT COUNT(*) FROM \"event_PlaceOrder\") AS ev,
                (SELECT COUNT(*) FROM \"object_Order\") AS ob,
                (SELECT strftime(ocel_time, '%Y-%m-%d %H:%M:%S') FROM \"object_Order\") AS ob_time,
                (SELECT ocel_changed_field IS NULL FROM \"object_Order\") AS ob_changed_null,
                (SELECT COUNT(*) FROM \"event_map_type\") AS emt,
                (SELECT COUNT(*) FROM \"object_map_type\") AS omt",
    );
    let rows: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
    assert_eq!(rows[0]["ev"].as_i64(), Some(1));
    assert_eq!(rows[0]["ob"].as_i64(), Some(1));
    // Objects with no attribute changes are exported stamped with the Unix epoch.
    assert_eq!(rows[0]["ob_time"].as_str(), Some("1970-01-01 00:00:00"));
    assert_eq!(rows[0]["ob_changed_null"].as_bool(), Some(true));
    assert_eq!(rows[0]["emt"].as_i64(), Some(1));
    assert_eq!(rows[0]["omt"].as_i64(), Some(1));
}

/// A nullable id column is not a UUID trigger, nor does it collapse onto a "NULL"
/// entity: `get_id_string` returns None for a null identity input, so the extractor
/// drops the row instead of synthesizing or rendering a sentinel identity. The compiler
/// mirrors this exactly with a plain cast/CASE (no COALESCE) plus a `col IS NOT NULL`
/// filter, so nullability of the id column is no longer a data-dependent property that
/// needs a probe (the unavoidable `AmbiguousObjectIdentity` probe still applies, since
/// this usage produces at least one object row).
#[test]
fn null_identity_rows_drop_on_both_sides() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "nullid",
        "CREATE TABLE orders(oid TEXT, ts TIMESTAMP NOT NULL);
         INSERT INTO orders VALUES ('o1','2024-01-15 10:30:00'),
                                   (NULL,'2024-01-16 10:30:00');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![table(
            &path,
            "orders",
            TableUsageData::Object {
                object_type: constant("Order"),
                id: col("oid"),
                prefix_id_with_type: false,
                timestamp: None,
                attribute_config: None,
            },
        )],
    };

    let locel = extract(&blueprint);
    let ids: BTreeSet<String> = locel
        .get_all_obs()
        .map(|o| locel.get_ob_id(&o).to_string())
        .collect();
    assert_eq!(
        ids,
        BTreeSet::from(["o1".to_string()]),
        "the null-id row is dropped, not named \"NULL\" or uuid-synthesised: {:?}",
        ids
    );

    let compiled = compile_blueprint(&blueprint, SqlDialect::DuckDB);
    assert!(compiled.errors.is_empty());
    // The `IS NOT NULL` filter makes id-nullability agreement structural, so the only
    // probe left standing is the routine ambiguous-identity check, not one about nulls.
    assert!(compiled
        .probes
        .iter()
        .all(|p| matches!(&p.kind, ProbeKind::AmbiguousObjectIdentity)));

    // The views agree with the extractor: both omit the null-id row.
    let expected = surface_from_extractor(&locel);
    let actual = surface_from_views(&path, &blueprint, &compiled);
    assert_eq!(expected, actual);
    assert!(!actual.iter().any(|(_, a, _, _)| a == "NULL"));
}

/// Text timestamp columns are residual, native ones are a plain column reference.
#[test]
fn text_timestamp_is_rejected_native_is_compiled() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "tstypes",
        "CREATE TABLE orders(oid TEXT NOT NULL, ts_text TEXT NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO orders VALUES ('o1','2024-01-15 10:30:00','2024-01-15 10:30:00');",
    );
    let info = table_info(&path, "orders");
    assert_eq!(info.columns["ts"].col_type, "Timestamp");
    assert_eq!(info.columns["ts_text"].col_type, "Text");

    let make = |ts_col: &str| DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![table(
            &path,
            "orders",
            TableUsageData::Event {
                event_type: constant("PlaceOrder"),
                id: Some(col("oid")),
                timestamp: native_ts(ts_col),
                inline_object_references: Vec::new(),
            },
        )],
    };

    let native = compile_blueprint(&make("ts"), SqlDialect::DuckDB);
    assert!(native.errors.is_empty(), "{:?}", native.errors);

    let text = compile_blueprint(&make("ts_text"), SqlDialect::DuckDB);
    assert!(matches!(
        text.errors.first().map(|e| &e.reason),
        Some(RejectReason::ResidualTimestamp { .. })
    ));
}

/// The construct classification, asserted against the compiler rather than read off the
/// extractor.
#[test]
fn rejected_constructs_are_named() {
    let path = std::path::PathBuf::from("/nonexistent.sqlite");
    let empty_info = DataSourceTableInfo {
        name: "t".to_string(),
        columns: Default::default(),
        primary_keys: Vec::new(),
        foreign_keys: Vec::new(),
    };
    let cfg = |usage: TableUsageData, virtual_table_id: Option<String>| TableExtractionConfig {
        source_id: "s1".to_string(),
        table_name: "t".to_string(),
        table_info: empty_info.clone(),
        usage,
        virtual_table_id,
    };
    let bp = |t: TableExtractionConfig| DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![t],
    };
    let reason = |t: TableExtractionConfig| {
        compile_blueprint(&bp(t), SqlDialect::DuckDB)
            .errors
            .into_iter()
            .next()
            .map(|e| e.reason)
    };

    // Event without an id -> Uuid::new_v4() per row.
    assert!(matches!(
        reason(cfg(
            TableUsageData::Event {
                event_type: constant("E"),
                id: None,
                timestamp: TimestampSource::Constant {
                    value: "2020-01-01 00:00:00".to_string(),
                    format: TimestampFormat::Auto,
                },
                inline_object_references: Vec::new(),
            },
            None
        )),
        Some(RejectReason::SynthesizedId { field: "id" })
    ));

    // ChangeTableEvents without an id -> shared counter in row order.
    assert!(matches!(
        reason(cfg(
            TableUsageData::ChangeTableEvents {
                timestamp: TimestampSource::Constant {
                    value: "2020-01-01 00:00:00".to_string(),
                    format: TimestampFormat::Auto,
                },
                id: None,
                event_rules: Vec::new(),
                inline_object_references: Vec::new(),
            },
            None
        )),
        Some(RejectReason::SynthesizedChangeTableEventId)
    ));

    // Components timestamps are a chrono cascade.
    assert!(matches!(
        reason(cfg(
            TableUsageData::Event {
                event_type: constant("E"),
                id: Some(constant("x")),
                timestamp: TimestampSource::Components {
                    date_column: Some("d".to_string()),
                    time_column: Some("t".to_string()),
                },
                inline_object_references: Vec::new(),
            },
            None
        )),
        Some(RejectReason::ResidualTimestamp { .. })
    ));

    // Object change tracking is not compiled.
    assert!(matches!(
        reason(cfg(
            TableUsageData::Object {
                object_type: constant("O"),
                id: constant("x"),
                prefix_id_with_type: false,
                timestamp: Some(TimestampSource::Constant {
                    value: "2020-01-01 00:00:00".to_string(),
                    format: TimestampFormat::Auto,
                }),
                attribute_config: Some(super::blueprint::AttributeConfig::Dynamic {
                    name_column: "n".to_string(),
                    value_column: "v".to_string(),
                }),
            },
            None
        )),
        Some(RejectReason::ObjectAttributeTracking)
    ));

    // Regex-configured multi-value splitting has no single-expression SQL mirror
    // (`captures_iter` group iteration); delimiter splitting compiles (see
    // `e2o_multi_value_delimiter_trim_on_agrees` and friends).
    assert!(matches!(
        reason(cfg(
            TableUsageData::E2ORelation {
                source_event: constant("e"),
                target_object: constant("o"),
                qualifier: None,
                target_object_type: None,
                target_object_multi: Some(MultiValueConfig {
                    enabled: true,
                    delimiter: ",".to_string(),
                    trim_values: true,
                    regex_pattern: Some("(\\w+)".to_string()),
                }),
            },
            None
        )),
        Some(RejectReason::MultiValueRegexSplit { .. })
    ));

    // Same rejection for an O2O source endpoint.
    assert!(matches!(
        reason(cfg(
            TableUsageData::O2ORelation {
                source_object: constant("s"),
                target_object: constant("t"),
                qualifier: None,
                source_object_type: None,
                target_object_type: None,
                source_object_multi: Some(MultiValueConfig {
                    enabled: true,
                    delimiter: ",".to_string(),
                    trim_values: true,
                    regex_pattern: Some("(\\w+)".to_string()),
                }),
                target_object_multi: None,
            },
            None
        )),
        Some(RejectReason::MultiValueRegexSplit { .. })
    ));

    // Same rejection for an O2O target endpoint.
    assert!(matches!(
        reason(cfg(
            TableUsageData::O2ORelation {
                source_object: constant("s"),
                target_object: constant("t"),
                qualifier: None,
                source_object_type: None,
                target_object_type: None,
                source_object_multi: None,
                target_object_multi: Some(MultiValueConfig {
                    enabled: true,
                    delimiter: ",".to_string(),
                    trim_values: true,
                    regex_pattern: Some("(\\w+)".to_string()),
                }),
            },
            None
        )),
        Some(RejectReason::MultiValueRegexSplit { .. })
    ));

    // Same rejection for an inline object reference.
    assert!(matches!(
        reason(cfg(
            TableUsageData::Event {
                event_type: constant("E"),
                id: Some(constant("x")),
                timestamp: TimestampSource::Constant {
                    value: "2020-01-01 00:00:00".to_string(),
                    format: TimestampFormat::Auto,
                },
                inline_object_references: vec![InlineObjectReference {
                    id: "r1".to_string(),
                    object_id: constant("o"),
                    object_type: Some(ObjectTypeSpec::Fixed("O".to_string())),
                    qualifier: None,
                    multi_value_config: Some(MultiValueConfig {
                        enabled: true,
                        delimiter: ",".to_string(),
                        trim_values: true,
                        regex_pattern: Some("(\\w+)".to_string()),
                    }),
                }],
            },
            None
        )),
        Some(RejectReason::MultiValueRegexSplit { .. })
    ));

    // A virtual_table_id naming a VT absent from the blueprint.
    assert!(matches!(
        reason(cfg(
            TableUsageData::Object {
                object_type: constant("O"),
                id: constant("x"),
                prefix_id_with_type: false,
                timestamp: None,
                attribute_config: None,
            },
            Some("vt1".to_string())
        )),
        Some(RejectReason::UnknownVirtualTable { .. })
    ));

    // A data-dependent type name leaves the per-type view unnameable.
    assert!(matches!(
        reason(cfg(
            TableUsageData::Object {
                object_type: col("type_col"),
                id: constant("x"),
                prefix_id_with_type: false,
                timestamp: None,
                attribute_config: None,
            },
            None
        )),
        Some(RejectReason::DynamicTypeName { .. })
    ));
}

/// The extractor's `ColumnNotEmpty` emptiness-checks an `Unknown`-typed value's string
/// payload via `as_str` (blueprint.rs `PreparedCondition::ColumnNotEmpty`), so an
/// empty-string value is "not empty" == false. Compiled SQL has no declared rendering for
/// Unknown and would emit a bare `IS NOT NULL`, which is true for an empty string --
/// diverging from the extractor. Must reject rather than approximate.
#[test]
fn column_not_empty_on_unknown_type_is_rejected() {
    let path = std::path::PathBuf::from("/nonexistent.sqlite");
    let info = table_info_of("t", &[("rid", "Text", false), ("status", "Unknown", true)]);
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![TableExtractionConfig {
            source_id: "s1".to_string(),
            table_name: "t".to_string(),
            table_info: info,
            usage: TableUsageData::ChangeTableEvents {
                timestamp: TimestampSource::Constant {
                    value: "2020-01-01 00:00:00".to_string(),
                    format: TimestampFormat::Auto,
                },
                id: Some(col("rid")),
                event_rules: vec![ChangeTableEventRule {
                    id: "rule1".to_string(),
                    event_type: "E".to_string(),
                    conditions: ChangeTableCondition::ColumnNotEmpty {
                        column: "status".to_string(),
                    },
                }],
                inline_object_references: Vec::new(),
            },
            virtual_table_id: None,
        }],
    };

    let compiled = compile_blueprint(&blueprint, SqlDialect::DuckDB);
    assert!(
        matches!(
            compiled.errors.first().map(|e| &e.reason),
            Some(RejectReason::UnknownTypedNotEmpty { column }) if column == "status"
        ),
        "{:?}",
        compiled.errors
    );
}

/// `prefix_id_with_type` is keyed by type name in shared extractor state, so the same type
/// declared both ways is order-dependent.
#[test]
fn conflicting_prefix_flag_is_rejected() {
    let path = std::path::PathBuf::from("/nonexistent.sqlite");
    let info = DataSourceTableInfo {
        name: "t".to_string(),
        columns: Default::default(),
        primary_keys: Vec::new(),
        foreign_keys: Vec::new(),
    };
    let object = |prefix: bool| TableExtractionConfig {
        source_id: "s1".to_string(),
        table_name: "t".to_string(),
        table_info: info.clone(),
        usage: TableUsageData::Object {
            object_type: constant("Customer"),
            id: constant("x"),
            prefix_id_with_type: prefix,
            timestamp: None,
            attribute_config: None,
        },
        virtual_table_id: None,
    };
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![object(true), object(false)],
    };
    let compiled = compile_blueprint(&blueprint, SqlDialect::DuckDB);
    assert!(compiled.errors.iter().any(|e| matches!(
        &e.reason,
        RejectReason::ConflictingPrefixFlag { object_type } if object_type == "Customer"
    )));
}

/// Integer columns reach `get_string` through Rust's `Display`, which must agree with a
/// SQL cast. Float and Timestamp columns do not, and are rejected instead.
#[test]
fn integer_id_column_agrees_float_is_rejected() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "coltypes",
        "CREATE TABLE orders(oid INTEGER NOT NULL, amount REAL NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO orders VALUES (1, 5.0, '2024-01-15 10:30:00'),
                                   (2, 7.5, '2024-01-16 10:30:00');",
    );
    let info = table_info(&path, "orders");
    assert_eq!(info.columns["oid"].col_type, "Integer");
    assert_eq!(info.columns["amount"].col_type, "Float");

    let usage = |id_col: &str| TableUsageData::Object {
        object_type: constant("Order"),
        id: col(id_col),
        prefix_id_with_type: false,
        timestamp: None,
        attribute_config: None,
    };

    let int_bp = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![table(&path, "orders", usage("oid"))],
    };
    assert_agrees(&path, &int_bp);

    // Rust renders `Float(5.0)` as "5" while SQL renders "5.0", so this cannot be compiled.
    let float_bp = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![table(&path, "orders", usage("amount"))],
    };
    assert!(matches!(
        compile_blueprint(&float_bp, SqlDialect::DuckDB)
            .errors
            .first()
            .map(|e| &e.reason),
        Some(RejectReason::UnstableIdentityRendering { .. })
    ));
}

/// A join key of an unstable-rendering type (Float here) is an identity-position check
/// (`join_key_facts`, same `get_id_string` rule as `column_as_identity_text`) -- ENGINEERING,
/// not the condition-position DIALECT marker.
#[test]
fn join_key_unstable_rendering_is_rejected() {
    let bp = blueprint_with(
        vec![
            base_table("s1", "a", table_info_of("a", &[("amount", "Float", false)])),
            base_table("s1", "b", table_info_of("b", &[("amount", "Float", false)])),
            TableExtractionConfig {
                source_id: "s1".to_string(),
                table_name: "a".to_string(),
                table_info: table_info_of("a", &[("amount", "Float", false)]),
                usage: dummy_usage(),
                virtual_table_id: Some("vt1".to_string()),
            },
        ],
        vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "vt1".to_string(),
            operation: TransformOperation::Join {
                left: table_source("s1", "a"),
                right: table_source("s1", "b"),
                join_type: JoinType::Inner,
                on: vec![("amount".to_string(), "amount".to_string())],
            },
        }],
    );

    let compiled = compile_blueprint(&bp, SqlDialect::DuckDB);
    let err = compiled
        .errors
        .into_iter()
        .next()
        .expect("compile error expected");
    assert!(
        matches!(
            &err.reason,
            RejectReason::UnstableIdentityRendering { column, field, .. }
                if column == "amount" && *field == "join key"
        ),
        "{:?}",
        err.reason
    );
}

/// A `ChangeTableCondition` reads a column through `get_string`/`Display` (`column_as_condition_text`),
/// not `get_id_string` -- a genuinely different rendering rule, so an unstable-type column
/// here is the DIALECT marker, not the identity-position ENGINEERING one.
#[test]
fn condition_position_float_column_uses_dialect_marker() {
    let bp = blueprint_with(
        vec![
            base_table("s1", "a", table_info_of("a", &[("amount", "Float", false)])),
            TableExtractionConfig {
                source_id: "s1".to_string(),
                table_name: "a".to_string(),
                table_info: table_info_of("a", &[("amount", "Float", false)]),
                usage: dummy_usage(),
                virtual_table_id: Some("vt1".to_string()),
            },
        ],
        vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "vt1".to_string(),
            operation: TransformOperation::Filter {
                source: table_source("s1", "a"),
                condition: ChangeTableCondition::ColumnEquals {
                    column: "amount".to_string(),
                    value: "5".to_string(),
                },
            },
        }],
    );

    let compiled = compile_blueprint(&bp, SqlDialect::DuckDB);
    let err = compiled
        .errors
        .into_iter()
        .next()
        .expect("compile error expected");
    assert!(
        matches!(
            &err.reason,
            RejectReason::UnstableConditionRendering { column, field, .. }
                if column == "amount" && *field == "condition"
        ),
        "{:?}",
        err.reason
    );
}

/// Where the paths genuinely disagree: the extractor gives an id to the first object type
/// that claims it and silently drops the later one, which is a row-order property SQL has
/// no access to. `DISTINCT` keeps both. The probe exists to catch exactly this.
#[test]
fn ambiguous_object_identity_probe_catches_disagreement() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "ambiguous",
        "CREATE TABLE customers(cid TEXT NOT NULL);
         INSERT INTO customers VALUES ('1');
         CREATE TABLE orders(oid TEXT NOT NULL);
         INSERT INTO orders VALUES ('1');",
    );
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![
            table(
                &path,
                "customers",
                TableUsageData::Object {
                    object_type: constant("Customer"),
                    id: col("cid"),
                    prefix_id_with_type: false,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
            table(
                &path,
                "orders",
                TableUsageData::Object {
                    object_type: constant("Order"),
                    id: col("oid"),
                    prefix_id_with_type: false,
                    timestamp: None,
                    attribute_config: None,
                },
            ),
        ],
    };

    let compiled = compile_blueprint(&blueprint, SqlDialect::DuckDB);
    assert!(compiled.errors.is_empty());

    // The extractor keeps one object; `add_object` returned None for the second.
    let locel = extract(&blueprint);
    assert_eq!(locel.get_all_obs().count(), 1);

    // The views keep both, so the paths disagree...
    let expected = surface_from_extractor(&locel);
    let actual = surface_from_views(&path, &blueprint, &compiled);
    assert_ne!(expected, actual);

    // ...and the probe reports it rather than letting the views claim agreement.
    let probe = compiled
        .probes
        .iter()
        .find(|p| matches!(&p.kind, ProbeKind::AmbiguousObjectIdentity))
        .expect("ambiguous identity probe");
    let raw = run_duckdb(
        &path,
        &blueprint,
        &compiled.ddl(),
        &format!("SELECT COUNT(*) AS n FROM ({}) AS probe_result", probe.sql),
    );
    let rows: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
    assert_eq!(rows[0]["n"].as_i64(), Some(1), "probe must fire");
}

/// A prefixed usage over an empty table never registers the type, so the extractor emits
/// unprefixed ids. The compiler cannot see this in the blueprint, so it probes.
#[test]
fn prefixed_type_over_empty_table_is_probed() {
    if !have_tools() {
        return;
    }
    let path = fixture("emptyprefix", "CREATE TABLE customers(cid TEXT NOT NULL);");
    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: Vec::new(),
        tables: vec![table(
            &path,
            "customers",
            TableUsageData::Object {
                object_type: constant("Customer"),
                id: col("cid"),
                prefix_id_with_type: true,
                timestamp: None,
                attribute_config: None,
            },
        )],
    };
    let compiled = compile_blueprint(&blueprint, SqlDialect::DuckDB);
    let probe = compiled
        .probes
        .iter()
        .find(|p| matches!(&p.kind, ProbeKind::PrefixedTypeEmptyTable { .. }))
        .expect("empty-table prefix probe");

    let raw = run_duckdb(
        &path,
        &blueprint,
        &compiled.ddl(),
        &format!("SELECT COUNT(*) AS n FROM ({}) AS probe_result", probe.sql),
    );
    let rows: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        rows[0]["n"].as_i64(),
        Some(1),
        "probe must fire on empty table"
    );
}

// --- Virtual-table schema resolver (Task 1) -------------------------------------------
//
// `resolve_vt_schemas` mirrors the column-composition rules of `apply_transform`
// (mod.rs) without touching data. These tests are hand-built blueprints; no fixture.

fn col_info(
    name: &str,
    col_type: &str,
    is_nullable: bool,
) -> crate::data_source::DataSourceColumnInfo {
    crate::data_source::DataSourceColumnInfo {
        name: name.to_string(),
        col_type: col_type.to_string(),
        is_nullable,
    }
}

fn table_info_of(name: &str, cols: &[(&str, &str, bool)]) -> DataSourceTableInfo {
    let columns = cols
        .iter()
        .map(|(n, t, nullable)| (n.to_string(), col_info(n, t, *nullable)))
        .collect();
    DataSourceTableInfo {
        name: name.to_string(),
        columns,
        primary_keys: Vec::new(),
        foreign_keys: Vec::new(),
    }
}

/// A dummy usage; the resolver never inspects it, only `table_info`.
fn dummy_usage() -> TableUsageData {
    TableUsageData::Object {
        object_type: constant("X"),
        id: constant("x"),
        prefix_id_with_type: false,
        timestamp: None,
        attribute_config: None,
    }
}

fn base_table(
    source_id: &str,
    table_name: &str,
    info: DataSourceTableInfo,
) -> TableExtractionConfig {
    TableExtractionConfig {
        source_id: source_id.to_string(),
        table_name: table_name.to_string(),
        table_info: info,
        usage: dummy_usage(),
        virtual_table_id: None,
    }
}

fn table_source(source_id: &str, table_name: &str) -> TransformSource {
    TransformSource::Table {
        source_id: source_id.to_string(),
        table_name: table_name.to_string(),
    }
}

fn blueprint_with(
    tables: Vec<TableExtractionConfig>,
    virtual_tables: Vec<VirtualTableConfig>,
) -> DataExtractionBlueprint {
    DataExtractionBlueprint {
        sources: Vec::new(),
        tables,
        virtual_tables,
    }
}

#[test]
fn join_renames_colliding_right_column_and_drops_right_key() {
    let bp = blueprint_with(
        vec![
            base_table(
                "s1",
                "orders",
                table_info_of(
                    "orders",
                    &[("id", "Integer", false), ("status", "Text", true)],
                ),
            ),
            base_table(
                "s1",
                "order_status",
                table_info_of(
                    "order_status",
                    &[("id", "Integer", false), ("status", "Text", false)],
                ),
            ),
        ],
        vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "joined".to_string(),
            operation: TransformOperation::Join {
                left: table_source("s1", "orders"),
                right: table_source("s1", "order_status"),
                join_type: JoinType::Inner,
                on: vec![("id".to_string(), "id".to_string())],
            },
        }],
    );

    let schemas = resolve_vt_schemas(&bp.tables, &bp.virtual_tables).expect("resolves");
    let vt = schemas.get("vt1").expect("vt1 present");

    // Right join key ("id") is dropped; the colliding right "status" becomes "right_status".
    assert_eq!(vt.columns, vec!["id", "status", "right_status"]);
    assert!(
        !vt.facts.contains_key("right_id"),
        "join key must not be duplicated"
    );

    let left_status = vt.facts.get("status").expect("left status kept");
    assert_eq!(left_status.col_type, "Text");
    assert!(left_status.nullable);

    let right_status = vt.facts.get("right_status").expect("right status renamed");
    assert_eq!(right_status.col_type, "Text");
    assert!(!right_status.nullable);
}

/// SQL JOIN...ON semantics: a right join-key column is dropped only on collision with a
/// left column name. A differently-named key has nothing to collide with, so it must
/// survive in the output under its own name (mirrors the fixed `apply_transform`, mod.rs).
#[test]
fn join_keeps_non_colliding_right_join_key_under_its_own_name() {
    let bp = blueprint_with(
        vec![
            base_table(
                "s1",
                "customers",
                table_info_of(
                    "customers",
                    &[("cust_id", "Integer", false), ("name", "Text", false)],
                ),
            ),
            base_table(
                "s1",
                "orders",
                table_info_of(
                    "orders",
                    &[
                        ("order_cust_id", "Integer", false),
                        ("amount", "Text", true),
                    ],
                ),
            ),
        ],
        vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "joined".to_string(),
            operation: TransformOperation::Join {
                left: table_source("s1", "customers"),
                right: table_source("s1", "orders"),
                join_type: JoinType::Inner,
                on: vec![("cust_id".to_string(), "order_cust_id".to_string())],
            },
        }],
    );

    let schemas = resolve_vt_schemas(&bp.tables, &bp.virtual_tables).expect("resolves");
    let vt = schemas.get("vt1").expect("vt1 present");

    // No collision anywhere: the right key keeps its own name (no `right_` prefix, and
    // it is not dropped), alongside every other column.
    assert_eq!(
        vt.columns,
        vec!["cust_id", "name", "amount", "order_cust_id"]
    );
    assert!(!vt.columns.contains(&"right_order_cust_id".to_string()));

    let key_facts = vt.facts.get("order_cust_id").expect("right key kept");
    assert_eq!(key_facts.col_type, "Integer");
    assert!(!key_facts.nullable);
}

#[test]
fn union_pads_missing_columns_and_flags_type_disagreement() {
    let bp = blueprint_with(
        vec![
            base_table(
                "s1",
                "a",
                table_info_of("a", &[("id", "Text", false), ("amount", "Integer", false)]),
            ),
            base_table("s1", "b", table_info_of("b", &[("id", "Text", false)])),
            base_table("s1", "c", table_info_of("c", &[("id", "Integer", false)])),
        ],
        vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "unioned".to_string(),
            operation: TransformOperation::Union {
                sources: vec![
                    table_source("s1", "a"),
                    table_source("s1", "b"),
                    table_source("s1", "c"),
                ],
            },
        }],
    );

    let schemas = resolve_vt_schemas(&bp.tables, &bp.virtual_tables).expect("resolves");
    let vt = schemas.get("vt1").expect("vt1 present");

    // Base = first source's columns ("a": amount, id).
    assert_eq!(vt.columns, vec!["amount", "id"]);

    // "amount" is absent from "b" and "c" -> padded NULL -> nullable, but its lone
    // contributor's type ("Integer") stands.
    let amount = vt.facts.get("amount").expect("amount present");
    assert_eq!(amount.col_type, "Integer");
    assert!(amount.nullable);

    // "id" is present (non-null) everywhere, but "c" disagrees on type -> Unknown.
    let id = vt.facts.get("id").expect("id present");
    assert_eq!(id.col_type, "Unknown");
    assert!(!id.nullable);
}

/// A Union with zero sources yields `VtSchema { columns: [], .. }` (Task 1) -- and,
/// independently, `vt_select` itself rejects an empty Union directly (`EmptyUnion`),
/// regardless of whether any usage would go on to reference a real column. See
/// `filter_over_empty_union_is_rejected_not_silently_invalid` below for why: a usage that
/// references *no* real column at all (fully constant) would otherwise sail through the
/// column-facts check and reach a `SELECT` with an empty projection list -- invalid SQL,
/// certified clean.
#[test]
fn union_with_no_sources_is_rejected() {
    let bp = blueprint_with(
        vec![TableExtractionConfig {
            source_id: "s1".to_string(),
            table_name: "irrelevant".to_string(),
            table_info: table_info_of("irrelevant", &[("id", "Integer", false)]),
            usage: TableUsageData::Object {
                object_type: constant("X"),
                id: col("id"),
                prefix_id_with_type: false,
                timestamp: None,
                attribute_config: None,
            },
            virtual_table_id: Some("vt1".to_string()),
        }],
        vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "empty_union".to_string(),
            operation: TransformOperation::Union {
                sources: Vec::new(),
            },
        }],
    );

    let compiled = compile_blueprint(&bp, SqlDialect::DuckDB);
    let err = compiled
        .errors
        .into_iter()
        .next()
        .expect("compile error expected");
    assert!(
        matches!(
            &err.reason,
            RejectReason::EmptyUnion { virtual_table_id } if virtual_table_id == "vt1"
        ),
        "{:?}",
        err.reason
    );
}

/// Demonstrates the bug a bare `Ok` placeholder for empty-sources Union would let through:
/// a Filter over an empty Union, with a vacuous `And { conditions: [] }` condition,
/// consumed by a usage that references *no* real column (fully constant id/type) never
/// touches the column-facts check at all -- so if `vt_select` didn't reject the empty
/// Union up front, this blueprint would compile with zero `CompileError`s while emitting
/// `SELECT  FROM (...) AS t WHERE ...` (an empty projection list: invalid SQL, since
/// `vt_schema.columns` is `[]`). `vt_select` must reject at the empty Union itself, before
/// any of that machinery runs.
#[test]
fn filter_over_empty_union_is_rejected_not_silently_invalid() {
    let bp = blueprint_with(
        vec![TableExtractionConfig {
            source_id: "s1".to_string(),
            table_name: "irrelevant".to_string(),
            table_info: table_info_of("irrelevant", &[]),
            usage: TableUsageData::Object {
                object_type: constant("X"),
                id: constant("x"),
                prefix_id_with_type: false,
                timestamp: None,
                attribute_config: None,
            },
            virtual_table_id: Some("vt2".to_string()),
        }],
        vec![
            VirtualTableConfig {
                id: "vt1".to_string(),
                name: "empty_union".to_string(),
                operation: TransformOperation::Union {
                    sources: Vec::new(),
                },
            },
            VirtualTableConfig {
                id: "vt2".to_string(),
                name: "filtered_empty_union".to_string(),
                operation: TransformOperation::Filter {
                    source: TransformSource::VirtualTable {
                        virtual_table_id: "vt1".to_string(),
                    },
                    condition: ChangeTableCondition::And {
                        conditions: Vec::new(),
                    },
                },
            },
        ],
    );

    let compiled = compile_blueprint(&bp, SqlDialect::DuckDB);
    assert!(
        !compiled.errors.is_empty(),
        "expected a CompileError, got a clean compile with DDL: {:?}",
        compiled.views.iter().map(|v| &v.name).collect::<Vec<_>>()
    );
    let err = &compiled.errors[0];
    assert!(
        matches!(
            &err.reason,
            RejectReason::EmptyUnion { virtual_table_id } if virtual_table_id == "vt1"
        ),
        "{:?}",
        err.reason
    );
}

// --- Union virtual tables (Task 4) ------------------------------------------------------

/// Union arm end-to-end: `evts_shop` lacks `ts`, so `union_schema` pads it NULL and marks
/// it nullable; the native-timestamp path (Task 3's `timestamp_expr`) then adds an
/// `IS NOT NULL` filter, dropping the padded row exactly like the extractor's
/// `TimestampSource::Column::parse` (NULL -> no timestamp -> row skipped). A
/// Filter-over-Union VT is chained on top (drops "s2" by id) to exercise the recursion
/// through a Union source, not just a single level.
///
/// `vt1` (the Union) is used *only* indirectly here -- as `vt2`'s own Filter source, never
/// by any usage's own `virtual_table_id` -- which is exactly the shape that used to break
/// the reference extractor: `compute_needed_columns` (mod.rs) only looked at
/// `TableExtractionConfig`s whose `virtual_table_id` *directly* named the VT being
/// resolved, so `vt1`'s needed columns computed as empty, `fetch_source_rows` requested
/// zero columns from "evts_web"/"evts_shop", and the underlying `SELECT` failed outright.
/// `compute_needed_columns` now also recurses into any VT that uses another as one of its
/// own sources, so `vt1` picks up `vt2`'s needs ("id", "ts") transitively. This is the
/// regression guard for that fix -- no workaround usage of `vt1` needed anymore.
#[test]
fn union_virtual_table_pads_and_chains_through_filter() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "union_vt",
        "CREATE TABLE evts_web(id TEXT NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO evts_web VALUES ('w1','2024-01-01 00:00:00'),('w2','2024-01-02 00:00:00');
         CREATE TABLE evts_shop(id TEXT NOT NULL);
         INSERT INTO evts_shop VALUES ('s1'),('s2');",
    );
    let web_info = table_info(&path, "evts_web");
    assert_eq!(web_info.columns["ts"].col_type, "Timestamp");

    // Direct usages of the two underlying tables, in a disjoint id namespace, so a
    // coincidental surface match can't mask a Union-compilation bug. `source_from` needs
    // both tables declared as real sources somewhere for the DuckDB harness to copy them
    // in (`run_duckdb` copies every `blueprint.tables[].table_name`).
    let raw_web = table(
        &path,
        "evts_web",
        TableUsageData::Object {
            object_type: constant("RawWeb"),
            id: ValueExpression::Template {
                template: "raw-web-{id}".to_string(),
            },
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );
    let raw_shop = table(
        &path,
        "evts_shop",
        TableUsageData::Object {
            object_type: constant("RawShop"),
            id: ValueExpression::Template {
                template: "raw-shop-{id}".to_string(),
            },
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );

    // The only usage of the Union chain: an Event over vt2 = Filter(vt1). vt1 is never
    // referenced directly by any usage's own `virtual_table_id`.
    let event_over_filtered_union = TableExtractionConfig {
        source_id: "s1".to_string(),
        table_name: "evts_web".to_string(),
        table_info: web_info,
        usage: TableUsageData::Event {
            event_type: constant("Placed"),
            id: Some(col("id")),
            timestamp: native_ts("ts"),
            inline_object_references: Vec::new(),
        },
        virtual_table_id: Some("vt2".to_string()),
    };

    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: vec![
            VirtualTableConfig {
                id: "vt1".to_string(),
                name: "unioned_evts".to_string(),
                operation: TransformOperation::Union {
                    sources: vec![
                        table_source("s1", "evts_web"),
                        table_source("s1", "evts_shop"),
                    ],
                },
            },
            VirtualTableConfig {
                id: "vt2".to_string(),
                name: "filtered_unioned_evts".to_string(),
                operation: TransformOperation::Filter {
                    source: TransformSource::VirtualTable {
                        virtual_table_id: "vt1".to_string(),
                    },
                    condition: ChangeTableCondition::ColumnNotEquals {
                        column: "id".to_string(),
                        value: "s2".to_string(),
                    },
                },
            },
        ],
        tables: vec![raw_web, raw_shop, event_over_filtered_union],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);

    // w1, w2 carry a real timestamp and survive the Filter (id <> 's2'). s2 is dropped by
    // the Filter; s1 survives the Filter but is dropped at the timestamp stage since Union
    // padded its "ts" to NULL (pad-drop on both sides).
    assert!(surface.contains(&(
        "event".to_string(),
        "w1".to_string(),
        "Placed".to_string(),
        "2024-01-01 00:00:00".to_string()
    )));
    assert!(surface.contains(&(
        "event".to_string(),
        "w2".to_string(),
        "Placed".to_string(),
        "2024-01-02 00:00:00".to_string()
    )));
    assert_eq!(
        surface
            .iter()
            .filter(|(k, _, t, _)| k == "event" && t == "Placed")
            .count(),
        2
    );
    assert!(!surface
        .iter()
        .any(|(k, a, _, _)| k == "event" && (a == "s1" || a == "s2")));
}

/// A Union branch ("evts_b") lacks the Text qualifier column "q" that the other branch
/// ("evts_a") has. Pre-fix, `fetch_source_rows` (mod.rs) requests every needed column --
/// including "q" -- from `evts_b` even though it has none, and SQLite's double-quoted-
/// string fallback resolves `"q"` to the string literal 'q' instead of erroring; since
/// `col_names` echoed the requested list, the Union merge in `apply_transform` sees "q" as
/// present in both branches and never NULL-pads it, so the garbage literal 'q' becomes the
/// e2o qualifier for e2 -- where the compiler's `union_schema` correctly marks "q" absent
/// (nullable) for the `evts_b` branch, and `column_as_qualifier_text`'s
/// `COALESCE(.., '')` renders the pad as `''`.
///
/// A Text qualifier is used deliberately, not a Timestamp: a bad Timestamp gets dropped by
/// an `IS NOT NULL` filter on both sides (coincidental agreement, as in the Filter/
/// Timestamp union test above), so it can't distinguish "reported absent" from "reported
/// present with garbage". A qualifier has no such filter -- the garbage value surfaces
/// directly in the comparison, as a *different* qualifier string on each side, not a
/// dropped row on both.
#[test]
fn union_missing_qualifier_column_reports_absent_not_garbage_string() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "union_missing_qualifier",
        "CREATE TABLE objs(oid TEXT NOT NULL);
         INSERT INTO objs VALUES ('o1');
         CREATE TABLE evts_a(eid TEXT NOT NULL, oid TEXT NOT NULL, q TEXT NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO evts_a VALUES ('e1','o1','q1','2024-01-01 00:00:00');
         CREATE TABLE evts_b(eid TEXT NOT NULL, oid TEXT NOT NULL, ts TIMESTAMP NOT NULL);
         INSERT INTO evts_b VALUES ('e2','o1','2024-01-02 00:00:00');",
    );

    let objs = table(
        &path,
        "objs",
        TableUsageData::Object {
            object_type: constant("Obj"),
            id: col("oid"),
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );
    let evts_a = table(
        &path,
        "evts_a",
        TableUsageData::Event {
            event_type: constant("Evt"),
            id: Some(col("eid")),
            timestamp: native_ts("ts"),
            inline_object_references: Vec::new(),
        },
    );
    let evts_b = table(
        &path,
        "evts_b",
        TableUsageData::Event {
            event_type: constant("Evt"),
            id: Some(col("eid")),
            timestamp: native_ts("ts"),
            inline_object_references: Vec::new(),
        },
    );

    // The only usage of the Union: an E2ORelation over vt1, needing "q" as its qualifier.
    let relation_over_union = TableExtractionConfig {
        source_id: "s1".to_string(),
        table_name: "evts_a".to_string(),
        table_info: table_info(&path, "evts_a"),
        usage: TableUsageData::E2ORelation {
            source_event: col("eid"),
            target_object: col("oid"),
            qualifier: Some(col("q")),
            target_object_type: None,
            target_object_multi: None,
        },
        virtual_table_id: Some("vt1".to_string()),
    };

    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "unioned_evts".to_string(),
            operation: TransformOperation::Union {
                sources: vec![table_source("s1", "evts_a"), table_source("s1", "evts_b")],
            },
        }],
        tables: vec![objs, evts_a, evts_b, relation_over_union],
    };

    let compiled = assert_agrees(&path, &blueprint);
    let surface = surface_from_views(&path, &blueprint, &compiled);

    // e1 carries its real "q1" qualifier through untouched; e2's qualifier column is
    // absent from evts_b, so both sides must pad/coalesce it to "".
    assert!(surface.contains(&(
        "e2o".to_string(),
        "e1".to_string(),
        "o1".to_string(),
        "q1".to_string()
    )));
    assert!(surface.contains(&(
        "e2o".to_string(),
        "e2".to_string(),
        "o1".to_string(),
        "".to_string()
    )));
}

#[test]
fn virtual_table_cycle_is_detected() {
    let bp = blueprint_with(
        Vec::new(),
        vec![
            VirtualTableConfig {
                id: "a".to_string(),
                name: "a".to_string(),
                operation: TransformOperation::Filter {
                    source: TransformSource::VirtualTable {
                        virtual_table_id: "b".to_string(),
                    },
                    condition: ChangeTableCondition::ColumnNotEmpty {
                        column: "x".to_string(),
                    },
                },
            },
            VirtualTableConfig {
                id: "b".to_string(),
                name: "b".to_string(),
                operation: TransformOperation::Filter {
                    source: TransformSource::VirtualTable {
                        virtual_table_id: "a".to_string(),
                    },
                    condition: ChangeTableCondition::ColumnNotEmpty {
                        column: "x".to_string(),
                    },
                },
            },
        ],
    );

    let err = resolve_vt_schemas(&bp.tables, &bp.virtual_tables).expect_err("cycle must be rejected");
    assert!(
        matches!(err, RejectReason::VirtualTableCycle { .. }),
        "{:?}",
        err
    );
}

#[test]
fn unknown_table_and_unsupported_join_type_are_rejected() {
    // TransformSource::Table naming a table absent from blueprint.tables.
    let bp_missing_table = blueprint_with(
        Vec::new(),
        vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "vt1".to_string(),
            operation: TransformOperation::Filter {
                source: table_source("s1", "does_not_exist"),
                condition: ChangeTableCondition::ColumnNotEmpty {
                    column: "x".to_string(),
                },
            },
        }],
    );
    assert!(matches!(
        resolve_vt_schemas(&bp_missing_table.tables, &bp_missing_table.virtual_tables),
        Err(RejectReason::UnknownVirtualTable { .. })
    ));

    // A non-Inner join is not implemented by the extractor either (mod.rs).
    let bp_left_join = blueprint_with(
        vec![
            base_table("s1", "a", table_info_of("a", &[("id", "Integer", false)])),
            base_table("s1", "b", table_info_of("b", &[("id", "Integer", false)])),
        ],
        vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "vt1".to_string(),
            operation: TransformOperation::Join {
                left: table_source("s1", "a"),
                right: table_source("s1", "b"),
                join_type: JoinType::Left,
                on: vec![("id".to_string(), "id".to_string())],
            },
        }],
    );
    assert!(matches!(
        resolve_vt_schemas(&bp_left_join.tables, &bp_left_join.virtual_tables),
        Err(RejectReason::UnsupportedJoinType { .. })
    ));
}

/// A usage over a Filter virtual table: rows must go through the VT's WHERE clause, and
/// the NULL-status row must drop on both paths (extractor: `get_str`/`get_string` both
/// miss on NULL -> `ColumnEquals` is false; compiler: `COALESCE(..,'NULL') = 'ok'` is false).
#[test]
fn filter_virtual_table_agrees() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "filter_vt",
        "CREATE TABLE orders(id TEXT NOT NULL, status TEXT);
         INSERT INTO orders VALUES ('o1','ok'),('o2','pending'),('o3',NULL);",
    );
    let orders_info = table_info(&path, "orders");

    // Declared purely so the transform layer has schema for the raw Filter source. Its own
    // usage is compiled and extracted identically on both paths, and kept in a disjoint id
    // namespace ("raw-*"/"RawOrder") so it cannot mask a VT filtering bug by coincidentally
    // reproducing the same surface rows.
    let raw_orders = table(
        &path,
        "orders",
        TableUsageData::Object {
            object_type: constant("RawOrder"),
            id: ValueExpression::Template {
                template: "raw-{id}".to_string(),
            },
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );

    let vt_usage = TableExtractionConfig {
        source_id: "s1".to_string(),
        table_name: "orders".to_string(),
        table_info: orders_info,
        usage: TableUsageData::Object {
            object_type: constant("Order"),
            id: col("id"),
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
        virtual_table_id: Some("vt1".to_string()),
    };

    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "ok_orders".to_string(),
            operation: TransformOperation::Filter {
                source: TransformSource::Table {
                    source_id: "s1".to_string(),
                    table_name: "orders".to_string(),
                },
                condition: ChangeTableCondition::ColumnEquals {
                    column: "status".to_string(),
                    value: "ok".to_string(),
                },
            },
        }],
        tables: vec![raw_orders, vt_usage],
    };

    assert_agrees(&path, &blueprint);
}

/// A declared virtual table that no usage's `virtual_table_id` ever reaches must still be
/// reported when broken -- the reference extractor's `resolve_virtual_tables` (mod.rs)
/// resolves every declared VT eagerly, regardless of use, and errors on this exact case
/// (a non-Inner join type). "Compiles cleanly" must be at least as strict.
#[test]
fn unreferenced_broken_virtual_table_is_still_reported() {
    let bp = blueprint_with(
        vec![base_table(
            "s1",
            "t",
            table_info_of("t", &[("id", "Integer", false)]),
        )],
        vec![VirtualTableConfig {
            id: "unused_vt".to_string(),
            name: "unused_vt".to_string(),
            operation: TransformOperation::Join {
                left: table_source("s1", "t"),
                right: table_source("s1", "t"),
                join_type: JoinType::Left,
                on: vec![("id".to_string(), "id".to_string())],
            },
        }],
    );

    let compiled = compile_blueprint(&bp, SqlDialect::DuckDB);

    // The valid, referenced usage (base_table's dummy Object usage) still compiles.
    assert!(
        compiled.views.iter().any(|v| v.name == "object_X"),
        "{:?}",
        compiled.views
    );

    // The unreferenced-but-broken VT is still reported, even though nothing consumes it.
    assert_eq!(compiled.errors.len(), 1, "{:?}", compiled.errors);
    let err = &compiled.errors[0];
    assert!(err.usage.is_none());
    assert_eq!(err.origin_vt.as_deref(), Some("unused_vt"));
    assert!(matches!(
        err.reason,
        RejectReason::UnsupportedJoinType { .. }
    ));
}

/// A *referenced* declared virtual table that fails resolution must be reported once, not
/// twice: the per-usage loop already reports it via its own `virtual_table_id` usage, so
/// the unreferenced-VT pass must not re-attempt (and re-report) the same id.
#[test]
fn referenced_broken_virtual_table_is_reported_once() {
    let bp = blueprint_with(
        vec![
            base_table("s1", "t", table_info_of("t", &[("id", "Integer", false)])),
            TableExtractionConfig {
                source_id: "s1".to_string(),
                table_name: "t".to_string(),
                table_info: table_info_of("t", &[("id", "Integer", false)]),
                usage: dummy_usage(),
                virtual_table_id: Some("bad_vt".to_string()),
            },
        ],
        vec![VirtualTableConfig {
            id: "bad_vt".to_string(),
            name: "bad_vt".to_string(),
            operation: TransformOperation::Join {
                left: table_source("s1", "t"),
                right: table_source("s1", "t"),
                join_type: JoinType::Left,
                on: vec![("id".to_string(), "id".to_string())],
            },
        }],
    );

    let compiled = compile_blueprint(&bp, SqlDialect::DuckDB);
    assert_eq!(compiled.errors.len(), 1, "{:?}", compiled.errors);
    assert!(matches!(
        compiled.errors[0].reason,
        RejectReason::UnsupportedJoinType { .. }
    ));
}

/// Two mutually-cyclic, UNREFERENCED virtual tables are one problem, not two: the
/// reference extractor's `topological_sort_virtual_tables` (mod.rs:114-177) aborts on the
/// very first cycle found in the whole graph and reports exactly one error, rather than
/// one per node caught up in it.
#[test]
fn unreferenced_mutually_cyclic_virtual_tables_produce_one_error() {
    let bp = blueprint_with(
        Vec::new(),
        vec![
            VirtualTableConfig {
                id: "a".to_string(),
                name: "a".to_string(),
                operation: TransformOperation::Filter {
                    source: TransformSource::VirtualTable {
                        virtual_table_id: "b".to_string(),
                    },
                    condition: ChangeTableCondition::ColumnNotEmpty {
                        column: "x".to_string(),
                    },
                },
            },
            VirtualTableConfig {
                id: "b".to_string(),
                name: "b".to_string(),
                operation: TransformOperation::Filter {
                    source: TransformSource::VirtualTable {
                        virtual_table_id: "a".to_string(),
                    },
                    condition: ChangeTableCondition::ColumnNotEmpty {
                        column: "x".to_string(),
                    },
                },
            },
        ],
    );

    let compiled = compile_blueprint(&bp, SqlDialect::DuckDB);
    assert_eq!(compiled.errors.len(), 1, "{:?}", compiled.errors);
    assert!(compiled.errors[0].usage.is_none());
    assert!(matches!(
        compiled.errors[0].reason,
        RejectReason::VirtualTableCycle { .. }
    ));
}

/// Two independent, unrelated broken VTs are two distinct problems and must stay two
/// errors -- only an actual cycle collapses into one.
// --- Inner Join virtual tables (Task 3) -----------------------------------------------

/// Join arm end-to-end: typed same-type keys, NULL keys on either side excluded (SQL
/// native equality never matches NULL), one left row fanning out to two right rows, and
/// collision-renamed right columns (both tables declare "name") consumed through a
/// Template id. A Filter-over-Join VT is chained on top to exercise alias scoping across
/// levels (the join's internal l/r aliases vs. the Filter arm's own "t").
#[test]
fn inner_join_virtual_table_agrees() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "inner_join",
        "CREATE TABLE a(k INTEGER, name TEXT NOT NULL);
         INSERT INTO a VALUES (1,'A1'),(2,'A2'),(NULL,'A3');
         CREATE TABLE b(k INTEGER, name TEXT NOT NULL, price REAL);
         INSERT INTO b VALUES (1,'B1',10.0),(1,'B2',20.0),(NULL,'B3',5.0),(3,'B4',1.0);",
    );

    let raw_a = table(
        &path,
        "a",
        TableUsageData::Object {
            object_type: constant("RawA"),
            id: ValueExpression::Template {
                template: "raw-a-{name}".to_string(),
            },
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );
    let raw_b = table(
        &path,
        "b",
        TableUsageData::Object {
            object_type: constant("RawB"),
            id: ValueExpression::Template {
                template: "raw-b-{name}".to_string(),
            },
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );

    let event_over_join = TableExtractionConfig {
        source_id: "s1".to_string(),
        table_name: "a".to_string(),
        table_info: table_info(&path, "a"),
        usage: TableUsageData::Event {
            event_type: constant("Joined"),
            id: Some(ValueExpression::Template {
                template: "{name}-{right_name}".to_string(),
            }),
            timestamp: TimestampSource::Constant {
                value: "2024-01-01 00:00:00".to_string(),
                format: TimestampFormat::Auto,
            },
            inline_object_references: Vec::new(),
        },
        virtual_table_id: Some("vt1".to_string()),
    };

    // Filter-over-Join: vt2 keeps only the B1 side of the fanout.
    let object_over_filtered_join = TableExtractionConfig {
        source_id: "s1".to_string(),
        table_name: "a".to_string(),
        table_info: table_info(&path, "a"),
        usage: TableUsageData::Object {
            object_type: constant("JoinedObj"),
            id: col("name"),
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
        virtual_table_id: Some("vt2".to_string()),
    };

    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: vec![
            VirtualTableConfig {
                id: "vt1".to_string(),
                name: "joined".to_string(),
                operation: TransformOperation::Join {
                    left: table_source("s1", "a"),
                    right: table_source("s1", "b"),
                    join_type: JoinType::Inner,
                    on: vec![("k".to_string(), "k".to_string())],
                },
            },
            VirtualTableConfig {
                id: "vt2".to_string(),
                name: "filtered_joined".to_string(),
                operation: TransformOperation::Filter {
                    source: TransformSource::VirtualTable {
                        virtual_table_id: "vt1".to_string(),
                    },
                    condition: ChangeTableCondition::ColumnEquals {
                        column: "right_name".to_string(),
                        value: "B1".to_string(),
                    },
                },
            },
        ],
        tables: vec![raw_a, raw_b, event_over_join, object_over_filtered_join],
    };

    let compiled = assert_agrees(&path, &blueprint);

    // Pins the exact `ON` clause shape: native equality only, no CAST/COALESCE -- NULL
    // keys must drop via SQL's own null semantics, not a stringified fallback.
    let ddl = compiled.ddl();
    let on_needle = "ON l.\"k\" = r.\"k\"";
    assert!(
        ddl.contains(on_needle),
        "expected a plain native-equality ON clause: {}",
        ddl
    );
    // The join SELECT is emitted on one line (no embedded newlines for real-table
    // sources), so the ON clause runs from its own start to the end of that line.
    let on_pos = ddl.find(on_needle).expect("checked above");
    let line_end = ddl[on_pos..]
        .find('\n')
        .map(|i| on_pos + i)
        .unwrap_or(ddl.len());
    let on_clause = &ddl[on_pos..line_end];
    assert!(
        !on_clause.contains("CAST") && !on_clause.contains("COALESCE"),
        "ON clause must not CAST/COALESCE either key: {:?}",
        on_clause
    );

    let surface = surface_from_views(&path, &blueprint, &compiled);

    // The fanout: a.k=1/name=A1 matches both b rows with k=1.
    assert!(surface.contains(&(
        "event".to_string(),
        "A1-B1".to_string(),
        "Joined".to_string(),
        "2024-01-01 00:00:00".to_string()
    )));
    assert!(surface.contains(&(
        "event".to_string(),
        "A1-B2".to_string(),
        "Joined".to_string(),
        "2024-01-01 00:00:00".to_string()
    )));
    // Nothing else joins: a.k=2 has no match, and NULL keys on either side participate
    // in no join (SQL native equality, like the extractor's id_string-keyed map, never
    // matches NULL against NULL or anything else).
    assert_eq!(
        surface
            .iter()
            .filter(|(k, _, t, _)| k == "event" && t == "Joined")
            .count(),
        2
    );
    // Filter-over-Join: vt2 keeps only the B1 side of the fanout.
    assert!(surface.contains(&(
        "object".to_string(),
        "A1".to_string(),
        "JoinedObj".to_string(),
        String::new()
    )));
    assert_eq!(
        surface
            .iter()
            .filter(|(k, _, t, _)| k == "object" && t == "JoinedObj")
            .count(),
        1
    );
}

/// Same declared type is required on both sides of a join key: SQL's own implicit-cast
/// rules for cross-type equality are dialect/pair specific, so only a same-type
/// comparison is provably the extractor's typed, same-type `id_string` comparison.
#[test]
fn join_key_type_mismatch_is_rejected() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "join_type_mismatch",
        "CREATE TABLE ta(k INTEGER NOT NULL);
         CREATE TABLE tb(k TEXT NOT NULL);",
    );
    let ta_info = table_info(&path, "ta");
    let tb_info = table_info(&path, "tb");
    assert_eq!(ta_info.columns["k"].col_type, "Integer");
    assert_eq!(tb_info.columns["k"].col_type, "Text");

    let raw_ta = table(
        &path,
        "ta",
        TableUsageData::Object {
            object_type: constant("RawTa"),
            id: ValueExpression::Template {
                template: "raw-{k}".to_string(),
            },
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );
    let raw_tb = table(
        &path,
        "tb",
        TableUsageData::Object {
            object_type: constant("RawTb"),
            id: col("k"),
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );
    let usage_over_join = TableExtractionConfig {
        source_id: "s1".to_string(),
        table_name: "ta".to_string(),
        table_info: ta_info,
        usage: TableUsageData::Object {
            object_type: constant("Joined"),
            id: constant("x"),
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
        virtual_table_id: Some("vt1".to_string()),
    };

    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "vt1".to_string(),
            operation: TransformOperation::Join {
                left: table_source("s1", "ta"),
                right: table_source("s1", "tb"),
                join_type: JoinType::Inner,
                on: vec![("k".to_string(), "k".to_string())],
            },
        }],
        tables: vec![raw_ta, raw_tb, usage_over_join],
    };

    let compiled = compile_blueprint(&blueprint, SqlDialect::DuckDB);
    let err = compiled
        .errors
        .into_iter()
        .next()
        .expect("compile error expected");
    assert!(
        matches!(
            &err.reason,
            RejectReason::JoinKeyTypeMismatch { left, right } if left == "k" && right == "k"
        ),
        "{:?}",
        err.reason
    );
}

/// The differential-test counterpart to `test_join_missing_on_column_errors_instead_of_silently_dropping`
/// (`tests.rs`): the extractor now errors on a missing `on` column instead of silently
/// filter_map-dropping it, and the compiler already rejects the same blueprint with
/// `UnknownColumn` (via `join_key_facts`) -- both sides reject.
#[test]
fn join_missing_on_column_is_rejected() {
    let bp = blueprint_with(
        vec![
            base_table("s1", "a", table_info_of("a", &[("k", "Integer", false)])),
            base_table("s1", "b", table_info_of("b", &[("k", "Integer", false)])),
            TableExtractionConfig {
                source_id: "s1".to_string(),
                table_name: "a".to_string(),
                table_info: table_info_of("a", &[("k", "Integer", false)]),
                usage: dummy_usage(),
                virtual_table_id: Some("vt1".to_string()),
            },
        ],
        vec![VirtualTableConfig {
            id: "vt1".to_string(),
            name: "vt1".to_string(),
            operation: TransformOperation::Join {
                left: table_source("s1", "a"),
                right: table_source("s1", "b"),
                join_type: JoinType::Inner,
                // "does_not_exist" names no column in "b".
                on: vec![("k".to_string(), "does_not_exist".to_string())],
            },
        }],
    );

    let compiled = compile_blueprint(&bp, SqlDialect::DuckDB);
    let err = compiled
        .errors
        .into_iter()
        .next()
        .expect("compile error expected");
    assert!(
        matches!(
            &err.reason,
            RejectReason::UnknownColumn { column, field }
                if column == "does_not_exist" && *field == "join key"
        ),
        "{:?}",
        err.reason
    );
}

#[test]
fn two_independent_broken_virtual_tables_produce_two_errors() {
    let bp = blueprint_with(
        vec![base_table(
            "s1",
            "t",
            table_info_of("t", &[("id", "Integer", false)]),
        )],
        vec![
            VirtualTableConfig {
                id: "vt1".to_string(),
                name: "vt1".to_string(),
                operation: TransformOperation::Join {
                    left: table_source("s1", "t"),
                    right: table_source("s1", "t"),
                    join_type: JoinType::Left,
                    on: vec![("id".to_string(), "id".to_string())],
                },
            },
            VirtualTableConfig {
                id: "vt2".to_string(),
                name: "vt2".to_string(),
                operation: TransformOperation::Filter {
                    source: table_source("s1", "does_not_exist"),
                    condition: ChangeTableCondition::ColumnNotEmpty {
                        column: "x".to_string(),
                    },
                },
            },
        ],
    );

    let compiled = compile_blueprint(&bp, SqlDialect::DuckDB);
    assert_eq!(compiled.errors.len(), 2, "{:?}", compiled.errors);
}

/// A single-usage blueprint whose only condition is `ColumnMatches` on `status`, so a
/// compile failure can only come from the regex portability guard.
fn column_matches_blueprint(pattern: &str) -> DataExtractionBlueprint {
    blueprint_with(
        vec![TableExtractionConfig {
            source_id: "s1".to_string(),
            table_name: "audit".to_string(),
            table_info: table_info_of(
                "audit",
                &[
                    ("rid", "Text", false),
                    ("status", "Text", true),
                    ("ts", "Timestamp", false),
                ],
            ),
            usage: TableUsageData::ChangeTableEvents {
                timestamp: native_ts("ts"),
                id: Some(col("rid")),
                event_rules: vec![ChangeTableEventRule {
                    id: "rule1".to_string(),
                    event_type: "E".to_string(),
                    conditions: ChangeTableCondition::ColumnMatches {
                        column: "status".to_string(),
                        regex: pattern.to_string(),
                    },
                }],
                inline_object_references: Vec::new(),
            },
            virtual_table_id: None,
        }],
        Vec::new(),
    )
}

#[test]
fn portable_regex_patterns_compile_unportable_reject() {
    let allowed = [
        r"^ORD-[0-9]+$",
        r"(a|b)+c?",
        r"foo.*bar",
        r"\d{2,4}",
        r"(?i)status",
    ];
    for pattern in allowed {
        let compiled = compile_blueprint(&column_matches_blueprint(pattern), SqlDialect::DuckDB);
        assert!(
            compiled.errors.is_empty(),
            "expected '{}' to compile, got {:?}",
            pattern,
            compiled.errors
        );
        assert!(
            compiled.ddl().contains("regexp_matches"),
            "expected '{}' to emit regexp_matches: {}",
            pattern,
            compiled.ddl()
        );
    }

    let rejected = [
        r"\bword\b",
        r"\p{Greek}+",
        r"(?x) a b",
        r"[[:alpha:]--[aeiou]]",
    ];
    for pattern in rejected {
        let compiled = compile_blueprint(&column_matches_blueprint(pattern), SqlDialect::DuckDB);
        let err = compiled
            .errors
            .into_iter()
            .next()
            .unwrap_or_else(|| panic!("expected '{}' to be rejected", pattern));
        assert!(
            matches!(&err.reason, RejectReason::UnportableRegex { pattern: p, .. } if p == pattern),
            "expected UnportableRegex for '{}', got {:?}",
            pattern,
            err.reason
        );
    }
}

#[test]
fn certified_ddl_requires_no_errors() {
    let clean = compile_blueprint(
        &column_matches_blueprint(r"^ORD-[0-9]+$"),
        SqlDialect::DuckDB,
    );
    assert!(clean.errors.is_empty(), "{:?}", clean.errors);
    let certified = clean
        .certified_ddl()
        .expect("a fully-compilable blueprint must certify");
    assert!(!certified.is_empty());
    assert_eq!(certified, clean.ddl());

    let unportable = compile_blueprint(&column_matches_blueprint(r"\bword\b"), SqlDialect::DuckDB);
    assert!(!unportable.errors.is_empty());
    let err = unportable
        .certified_ddl()
        .expect_err("a blueprint with any reject must not certify");
    assert_eq!(err, unportable.errors.as_slice());
    assert!(
        !unportable.ddl().is_empty(),
        "raw ddl() must still be available for diagnostics"
    );
}

// --- Task 9 fix pass: extractor-side cross-type join-key robustness ---------------------

/// A VT-chain (Filter passthrough into a Join) whose join key came through the chain, not
/// straight off a base table -- exercises `declared_col_type`'s `TransformSource::
/// VirtualTable` branch specifically (mod.rs). Every other extractor test's join keys are
/// base-table columns, which only ever hit the `TransformSource::Table` branch.
#[test]
fn vt_chain_cross_type_join_key_is_rejected_matching_compiler() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "vtchain_crosstype",
        "CREATE TABLE ta(k INTEGER NOT NULL);
         INSERT INTO ta VALUES (1);
         CREATE TABLE tb(k TEXT NOT NULL);
         INSERT INTO tb VALUES ('1');",
    );
    let raw_ta = table(
        &path,
        "ta",
        TableUsageData::Object {
            object_type: constant("RawTa"),
            id: ValueExpression::Template {
                template: "raw-a-{k}".to_string(),
            },
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );
    let raw_tb = table(
        &path,
        "tb",
        TableUsageData::Object {
            object_type: constant("RawTb"),
            id: col("k"),
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );
    let usage_over_cross_join = TableExtractionConfig {
        source_id: "s1".to_string(),
        table_name: "ta".to_string(),
        table_info: table_info(&path, "ta"),
        usage: TableUsageData::Object {
            object_type: constant("CrossJoined"),
            id: constant("x"),
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
        virtual_table_id: Some("cross_join".to_string()),
    };

    let passthrough = |column: &str| ChangeTableCondition::ColumnNotEmpty {
        column: column.to_string(),
    };

    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: vec![
            VirtualTableConfig {
                id: "leaky_int".to_string(),
                name: "leaky_int".to_string(),
                operation: TransformOperation::Filter {
                    source: table_source("s1", "ta"),
                    condition: passthrough("k"),
                },
            },
            VirtualTableConfig {
                id: "leaky_text".to_string(),
                name: "leaky_text".to_string(),
                operation: TransformOperation::Filter {
                    source: table_source("s1", "tb"),
                    condition: passthrough("k"),
                },
            },
            VirtualTableConfig {
                id: "cross_join".to_string(),
                name: "cross_join".to_string(),
                operation: TransformOperation::Join {
                    left: TransformSource::VirtualTable {
                        virtual_table_id: "leaky_int".to_string(),
                    },
                    right: TransformSource::VirtualTable {
                        virtual_table_id: "leaky_text".to_string(),
                    },
                    join_type: JoinType::Inner,
                    on: vec![("k".to_string(), "k".to_string())],
                },
            },
        ],
        tables: vec![raw_ta, raw_tb, usage_over_cross_join],
    };

    // Extractor: cross_join's keys are sourced through leaky_int/leaky_text (both VTs),
    // not straight off ta/tb, so this only rejects if declared_col_type actually resolves
    // types through the VirtualTable branch.
    let (_, response) = runtime()
        .block_on(super::execute_extraction_slim_with_dbcon(&blueprint))
        .expect("extraction runs (errors accumulate in the response, not a hard Err)");
    assert!(
        response
            .errors
            .iter()
            .any(|e| e.contains("cross_join") && e.contains("declared types")),
        "expected cross_join to be rejected for cross-type keys sourced through a VT \
         chain: {:?}",
        response.errors
    );

    // Compiler: the identical blueprint shape already rejects with JoinKeyTypeMismatch
    // (Task 3) -- both interpreters reject the same construct.
    let compiled = compile_blueprint(&blueprint, SqlDialect::DuckDB);
    assert!(
        compiled
            .errors
            .iter()
            .any(|e| matches!(&e.reason, RejectReason::JoinKeyTypeMismatch { .. })),
        "compiler must also reject the identical cross-type VT-chain join: {:?}",
        compiled.errors
    );
}

/// The compound symmetry hole: an unrelated, independently-broken VT must not disable the
/// cross-type join-key check for a *different*, otherwise-valid VT elsewhere in the same
/// blueprint. Before the fix, the extractor's pre-pass batch-resolved every declared VT's
/// schema in one call (`compile::resolve_vt_schemas`) and `.unwrap_or_default()`-ed the
/// whole map to empty on any single failure, silently disabling the check for every VT,
/// not just the broken one's dependents.
#[test]
fn unrelated_broken_vt_does_not_disable_cross_type_check_for_other_vts() {
    if !have_tools() {
        return;
    }
    let path = fixture(
        "compound_symmetry",
        "CREATE TABLE ta(k INTEGER NOT NULL);
         INSERT INTO ta VALUES (1);
         CREATE TABLE tb(k TEXT NOT NULL);
         INSERT INTO tb VALUES ('1');",
    );
    let raw_ta = table(
        &path,
        "ta",
        TableUsageData::Object {
            object_type: constant("RawTa"),
            id: ValueExpression::Template {
                template: "raw-a-{k}".to_string(),
            },
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );
    let raw_tb = table(
        &path,
        "tb",
        TableUsageData::Object {
            object_type: constant("RawTb"),
            id: col("k"),
            prefix_id_with_type: false,
            timestamp: None,
            attribute_config: None,
        },
    );

    let passthrough = |column: &str| ChangeTableCondition::ColumnNotEmpty {
        column: column.to_string(),
    };

    let blueprint = DataExtractionBlueprint {
        sources: vec![source(&path)],
        virtual_tables: vec![
            VirtualTableConfig {
                id: "leaky_int".to_string(),
                name: "leaky_int".to_string(),
                operation: TransformOperation::Filter {
                    source: table_source("s1", "ta"),
                    condition: passthrough("k"),
                },
            },
            VirtualTableConfig {
                id: "leaky_text".to_string(),
                name: "leaky_text".to_string(),
                operation: TransformOperation::Filter {
                    source: table_source("s1", "tb"),
                    condition: passthrough("k"),
                },
            },
            VirtualTableConfig {
                id: "cross_join".to_string(),
                name: "cross_join".to_string(),
                operation: TransformOperation::Join {
                    left: TransformSource::VirtualTable {
                        virtual_table_id: "leaky_int".to_string(),
                    },
                    right: TransformSource::VirtualTable {
                        virtual_table_id: "leaky_text".to_string(),
                    },
                    join_type: JoinType::Inner,
                    on: vec![("k".to_string(), "k".to_string())],
                },
            },
            // Entirely unrelated to leaky_int/leaky_text/cross_join: a non-Inner join,
            // broken for a reason that has nothing to do with cross-type keys.
            VirtualTableConfig {
                id: "broken_unrelated".to_string(),
                name: "broken_unrelated".to_string(),
                operation: TransformOperation::Join {
                    left: table_source("s1", "ta"),
                    right: table_source("s1", "tb"),
                    join_type: JoinType::Left,
                    on: vec![("k".to_string(), "k".to_string())],
                },
            },
        ],
        tables: vec![raw_ta, raw_tb],
    };

    // `resolve_virtual_tables` processes every declared VT eagerly regardless of use, so
    // no usage needs to reference `cross_join`/`broken_unrelated` for both to be attempted.
    let (_, response) = runtime()
        .block_on(super::execute_extraction_slim_with_dbcon(&blueprint))
        .expect("extraction runs (errors accumulate in the response, not a hard Err)");

    // The unrelated VT's own defect is still reported...
    assert!(
        response.errors.iter().any(|e| e.contains("broken_unrelated")),
        "{:?}",
        response.errors
    );
    // ...but must not silently disable cross_join's own, independent cross-type check.
    assert!(
        response
            .errors
            .iter()
            .any(|e| e.contains("cross_join") && e.contains("declared types")),
        "an unrelated broken VT must not disable cross_join's cross-type check: {:?}",
        response.errors
    );
}
