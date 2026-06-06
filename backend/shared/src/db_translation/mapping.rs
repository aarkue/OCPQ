//! OCEL 2.0 schema mapping for the SQL emitter.
//!
//! [`OcelTableMappings`] describes how an OCEL 2.0 logical schema (event
//! tables per type, object tables per type, E2O / O2O junction tables) is
//! laid out in a concrete relational database. The emitter consumes this
//! mapping to decide:
//!
//! * which physical table name to read for a given OCEL event/object type
//!   (no `event_<T>` / `object_<T>` prefix is forced; the user picks the
//!   raw table name),
//! * how to project the source columns onto the OCEL-standard column names
//!   the emitter references (`ocel_id`, `ocel_time`, `ocel_event_id`,
//!   `ocel_object_id`, `ocel_qualifier`, `ocel_changed_field`, and OCEL
//!   attribute names),
//! * which junction table to read for each (event_type, object_type) or
//!   (object_type, object_type) pair, so different pairs can live in
//!   different physical tables (e.g. orders<->items in `order_items`,
//!   orders<->packages in `order_packages`).
//!
//! The default constructor produces the schema emitted by `process_mining`'s
//! OCEL 2.0 SQL exporter: per-type tables named `event_<T>` / `object_<T>`,
//! junction tables `event_object` and `object_object`, OCEL-standard column
//! names everywhere. Override individual specs to point at arbitrary source
//! schemas; if a spec needs more flexibility than the structured fields
//! provide, set [`EntityTableSpec::select_body`] (or
//! [`JunctionTableSpec::select_body`]) to a full SELECT statement.
//!
//! Optionally, [`OcelTableMappings::views`] carries DDL statements (e.g.
//! `CREATE OR REPLACE VIEW ...`) the caller wants installed before queries
//! run; [`OcelTableMappings::install_views`] hands them to a closure that
//! runs each statement on whatever connection the caller holds.

use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashMap;

// Public column-name constants used by the emitter.

/// OCEL-standard column names. The emitter always references these names in
/// the outer query; a non-standard source schema is bridged in the FROM
/// clause by [`EntityTableSpec::source_sql`] / [`JunctionTableSpec::source_sql`].
pub mod columns {
    pub const OCEL_ID: &str = "ocel_id";
    pub const OCEL_TIME: &str = "ocel_time";
    pub const OCEL_CHANGED_FIELD: &str = "ocel_changed_field";
    pub const OCEL_EVENT_ID: &str = "ocel_event_id";
    pub const OCEL_OBJECT_ID: &str = "ocel_object_id";
    pub const OCEL_QUALIFIER: &str = "ocel_qualifier";
    pub const OCEL_SOURCE_ID: &str = "ocel_source_id";
    pub const OCEL_TARGET_ID: &str = "ocel_target_id";
}

// EntityTableSpec: per-type event or object table.

/// Per-type spec for an event or object table.
///
/// The structured fields cover the common case where the source schema
/// stores rows in a single table with column renames. For anything more
/// complex (joins, type discriminators, computed IDs) set [`select_body`]
/// to a full SELECT statement; the emitter will wrap it in parentheses and
/// alias it in place of the table reference.
///
/// [`select_body`]: EntityTableSpec::select_body
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct EntityTableSpec {
    /// Raw source table name (no `event_` / `object_` prefix forced).
    pub table: String,
    /// Override for the column projected as `ocel_id`. `None` keeps the
    /// OCEL standard name.
    pub id_column: Option<String>,
    /// Override for the column projected as `ocel_time`. `None` keeps the
    /// OCEL standard name. Set to `Some("NULL")` to project a constant NULL
    /// when the source has no timestamp.
    pub time_column: Option<String>,
    /// Objects only. Override for the column projected as
    /// `ocel_changed_field`. `None` keeps the OCEL standard name; pass
    /// `Some("NULL")` if the source has no change-tracking column.
    pub changed_field_column: Option<String>,
    /// Map OCEL attribute name -> SQL column expression. Unmapped
    /// attribute names are referenced raw (i.e. assumed to match the
    /// source column name).
    pub attribute_columns: HashMap<String, String>,
    /// Escape hatch: full SELECT body. When `Some`, the emitter wraps this
    /// string in parentheses and uses it as the FROM source, ignoring the
    /// other fields. The body must project the OCEL-standard columns the
    /// emitter references (`ocel_id`, `ocel_time`, optionally
    /// `ocel_changed_field`, and any attribute the query touches).
    pub select_body: Option<String>,
}

impl EntityTableSpec {
    /// Spec that references `table` directly, assuming OCEL-standard column
    /// names. Equivalent to `EntityTableSpec { table, ..Default::default() }`.
    pub fn raw(table: impl Into<String>) -> Self {
        Self {
            table: table.into(),
            ..Self::default()
        }
    }

    /// Spec that uses an arbitrary SELECT body as the source.
    pub fn from_select(select_body: impl Into<String>) -> Self {
        Self {
            table: String::new(),
            select_body: Some(select_body.into()),
            ..Self::default()
        }
    }

    /// True iff every structured field is at the OCEL-standard default and
    /// no `select_body` override is set. In that case the emitter can
    /// reference the raw table name directly.
    fn is_passthrough(&self) -> bool {
        self.select_body.is_none()
            && self.id_column.is_none()
            && self.time_column.is_none()
            && self.changed_field_column.is_none()
            && self.attribute_columns.is_empty()
    }

    /// Build the FROM-clause source (without an alias). For OCEL-standard
    /// passthrough this is the quoted raw table name; otherwise it's a
    /// parenthesized SELECT projecting the standard OCEL columns plus
    /// `<table>.*` to pass through any unrenamed columns.
    ///
    /// `is_object` controls whether `ocel_changed_field` is projected
    /// (objects only).
    pub fn source_sql(&self, is_object: bool) -> String {
        if let Some(body) = &self.select_body {
            return format!("({})", body.trim());
        }
        if self.is_passthrough() {
            return format!("\"{}\"", self.table);
        }
        let mut projections: Vec<String> = Vec::new();
        let id_expr = self.id_column.as_deref().unwrap_or(columns::OCEL_ID);
        projections.push(format!("{} AS {}", id_expr, columns::OCEL_ID));
        let time_expr = self.time_column.as_deref().unwrap_or(columns::OCEL_TIME);
        projections.push(format!("{} AS {}", time_expr, columns::OCEL_TIME));
        if is_object {
            let cf_expr = self
                .changed_field_column
                .as_deref()
                .unwrap_or(columns::OCEL_CHANGED_FIELD);
            projections.push(format!("{} AS {}", cf_expr, columns::OCEL_CHANGED_FIELD));
        }
        let mut attr_names: Vec<&String> = self.attribute_columns.keys().collect();
        attr_names.sort();
        for name in attr_names {
            let expr = &self.attribute_columns[name];
            projections.push(format!("{} AS \"{}\"", expr, name));
        }
        // Pass non-mapped columns through. A renamed attribute therefore also
        // appears under its original name via `*`; the OCEL consumer reads
        // columns by name, so the duplicate is harmless here.
        projections.push("*".to_string());
        format!(
            "(SELECT {} FROM \"{}\")",
            projections.join(", "),
            self.table
        )
    }
}

// JunctionTableSpec: per-pair E2O / O2O junction table.

/// Per-pair junction-table spec. Used both for E2O links (event_type ->
/// object_type) and O2O links (object_type -> object_type). The standard
/// projected columns are:
/// * E2O: `ocel_event_id`, `ocel_object_id`, `ocel_qualifier`
/// * O2O: `ocel_source_id`, `ocel_target_id`, `ocel_qualifier`
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct JunctionTableSpec {
    pub table: String,
    /// E2O: overrides `ocel_event_id`. O2O: overrides `ocel_source_id`.
    pub source_id_column: Option<String>,
    /// E2O: overrides `ocel_object_id`. O2O: overrides `ocel_target_id`.
    pub target_id_column: Option<String>,
    pub qualifier_column: Option<String>,
    /// Escape hatch: full SELECT body. Must project the OCEL-standard
    /// junction column names for the relevant kind.
    pub select_body: Option<String>,
}

/// Distinguishes E2O from O2O junction shapes (different OCEL-standard
/// column names on each side).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JunctionKind {
    E2O,
    O2O,
}

impl JunctionKind {
    fn source_col(self) -> &'static str {
        match self {
            JunctionKind::E2O => columns::OCEL_EVENT_ID,
            JunctionKind::O2O => columns::OCEL_SOURCE_ID,
        }
    }
    fn target_col(self) -> &'static str {
        match self {
            JunctionKind::E2O => columns::OCEL_OBJECT_ID,
            JunctionKind::O2O => columns::OCEL_TARGET_ID,
        }
    }
}

impl JunctionTableSpec {
    pub fn raw(table: impl Into<String>) -> Self {
        Self {
            table: table.into(),
            ..Self::default()
        }
    }

    pub fn from_select(select_body: impl Into<String>) -> Self {
        Self {
            table: String::new(),
            select_body: Some(select_body.into()),
            ..Self::default()
        }
    }

    fn is_passthrough(&self) -> bool {
        self.select_body.is_none()
            && self.source_id_column.is_none()
            && self.target_id_column.is_none()
            && self.qualifier_column.is_none()
    }

    pub fn source_sql(&self, kind: JunctionKind) -> String {
        if let Some(body) = &self.select_body {
            return format!("({})", body.trim());
        }
        if self.is_passthrough() {
            return format!("\"{}\"", self.table);
        }
        let mut projections: Vec<String> = Vec::new();
        let src = self
            .source_id_column
            .as_deref()
            .unwrap_or(kind.source_col());
        projections.push(format!("{} AS {}", src, kind.source_col()));
        let tgt = self
            .target_id_column
            .as_deref()
            .unwrap_or(kind.target_col());
        projections.push(format!("{} AS {}", tgt, kind.target_col()));
        let q = self
            .qualifier_column
            .as_deref()
            .unwrap_or(columns::OCEL_QUALIFIER);
        projections.push(format!("{} AS {}", q, columns::OCEL_QUALIFIER));
        format!(
            "(SELECT {} FROM \"{}\")",
            projections.join(", "),
            self.table
        )
    }
}

// OcelTableMappings: the merged mapping struct.

/// Mapping from an OCEL 2.0 logical schema to a concrete relational layout.
///
/// Per-type entity tables are keyed by OCEL type name. Per-pair junction
/// tables are keyed by `(event_type, object_type)` for E2O or
/// `(object_type, object_type)` for O2O; when a specific pair has no spec
/// the emitter falls back to `default_e2o` / `default_o2o`.
///
/// Optional [`views`] DDL is the merge of the former `ViewBasedMapping`:
/// callers describe their source schema with `CREATE OR REPLACE VIEW ...`
/// strings and call [`install_views`] to run them.
///
/// [`views`]: OcelTableMappings::views
/// [`install_views`]: OcelTableMappings::install_views
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct OcelTableMappings {
    pub event_tables: HashMap<String, EntityTableSpec>,
    pub object_tables: HashMap<String, EntityTableSpec>,
    /// E2O junction per (event_type, object_type) pair.
    #[serde(with = "pair_map")]
    pub e2o_tables: HashMap<(String, String), JunctionTableSpec>,
    /// O2O junction per (object_type, object_type) pair.
    #[serde(with = "pair_map")]
    pub o2o_tables: HashMap<(String, String), JunctionTableSpec>,
    /// Fallback for any (e_type, o_type) pair not present in `e2o_tables`.
    pub default_e2o: JunctionTableSpec,
    /// Fallback for any (o_type, o_type) pair not present in `o2o_tables`.
    pub default_o2o: JunctionTableSpec,
    /// Optional DDL statements (typically `CREATE OR REPLACE VIEW ...`) to
    /// install before queries run. Empty for the plain OCEL-2.0 case.
    pub views: Vec<(String, String)>,
}

impl Default for OcelTableMappings {
    fn default() -> Self {
        Self::ocel20_default()
    }
}

impl OcelTableMappings {
    /// Empty mapping with the OCEL 2.0 default junction tables
    /// (`event_object`, `object_object`). Per-type entity tables resolve via
    /// the `event_<T>` / `object_<T>` convention only when explicitly added
    /// to `event_tables` / `object_tables`; an unknown type passes through
    /// as a bare table name matching the type itself (back-compat default).
    pub fn ocel20_default() -> Self {
        Self {
            event_tables: HashMap::new(),
            object_tables: HashMap::new(),
            e2o_tables: HashMap::new(),
            o2o_tables: HashMap::new(),
            default_e2o: JunctionTableSpec::raw("event_object"),
            default_o2o: JunctionTableSpec::raw("object_object"),
            views: Vec::new(),
        }
    }

    /// Default suitable for the `process_mining` OCEL SQL exporter:
    /// per-type tables are pre-populated as `event_<T>` / `object_<T>` for
    /// every type the caller hands in. Use when integrating against the
    /// stock OCEL 2.0 exporter so the emitter doesn't need to invent
    /// prefixes itself.
    pub fn process_mining_default(
        event_types: impl IntoIterator<Item = String>,
        object_types: impl IntoIterator<Item = String>,
    ) -> Self {
        let mut m = Self::ocel20_default();
        for t in event_types {
            m.event_tables
                .insert(t.clone(), EntityTableSpec::raw(format!("event_{}", t)));
        }
        for t in object_types {
            m.object_tables
                .insert(t.clone(), EntityTableSpec::raw(format!("object_{}", t)));
        }
        m
    }

    /// Spec for the event type's source table; falls back to a passthrough
    /// spec referencing the bare type name when the type is unmapped.
    pub fn event_spec(&self, event_type: &str) -> Cow<'_, EntityTableSpec> {
        match self.event_tables.get(event_type) {
            Some(s) => Cow::Borrowed(s),
            None => Cow::Owned(EntityTableSpec::raw(event_type.to_string())),
        }
    }

    /// Spec for the object type's source table; falls back to a passthrough
    /// spec referencing the bare type name when the type is unmapped.
    pub fn object_spec(&self, object_type: &str) -> Cow<'_, EntityTableSpec> {
        match self.object_tables.get(object_type) {
            Some(s) => Cow::Borrowed(s),
            None => Cow::Owned(EntityTableSpec::raw(object_type.to_string())),
        }
    }

    /// E2O junction spec for the given pair; falls back to `default_e2o`.
    pub fn e2o_spec(&self, event_type: &str, object_type: &str) -> &JunctionTableSpec {
        let key = (event_type.to_string(), object_type.to_string());
        self.e2o_tables.get(&key).unwrap_or(&self.default_e2o)
    }

    /// O2O junction spec for the given pair; falls back to `default_o2o`.
    pub fn o2o_spec(&self, object_type_1: &str, object_type_2: &str) -> &JunctionTableSpec {
        let key = (object_type_1.to_string(), object_type_2.to_string());
        self.o2o_tables.get(&key).unwrap_or(&self.default_o2o)
    }

    /// Convenience: raw source table name for an event type (the `table`
    /// field of the spec). Returns the bare type name when unmapped. Used
    /// by the Cypher emitter, which only consumes a label string.
    pub fn event_label(&self, event_type: &str) -> String {
        self.event_tables
            .get(event_type)
            .map(|s| s.table.clone())
            .unwrap_or_else(|| event_type.to_string())
    }

    /// Convenience: raw source table name for an object type.
    pub fn object_label(&self, object_type: &str) -> String {
        self.object_tables
            .get(object_type)
            .map(|s| s.table.clone())
            .unwrap_or_else(|| object_type.to_string())
    }

    /// Run each `views` DDL statement through `exec`. Stops on the first
    /// error; `CREATE OR REPLACE VIEW` DDL is idempotent so retrying after
    /// a partial failure is safe.
    pub fn install_views<F, E>(&self, mut exec: F) -> Result<(), E>
    where
        F: FnMut(&str) -> Result<(), E>,
    {
        for (_name, ddl) in &self.views {
            exec(ddl)?;
        }
        Ok(())
    }
}

// Serde helper: (String, String) tuple keys are not directly representable
// in JSON, so serialize as a map keyed by "event::object" composite strings.

mod pair_map {
    use super::JunctionTableSpec;
    use serde::de::Error as DeError;
    use serde::ser::SerializeMap;
    use serde::{Deserialize, Deserializer, Serializer};
    use std::collections::HashMap;

    const SEP: &str = "::";

    pub fn serialize<S: Serializer>(
        map: &HashMap<(String, String), JunctionTableSpec>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        let mut out = s.serialize_map(Some(map.len()))?;
        for ((a, b), v) in map {
            out.serialize_entry(&format!("{a}{SEP}{b}"), v)?;
        }
        out.end()
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(
        d: D,
    ) -> Result<HashMap<(String, String), JunctionTableSpec>, D::Error> {
        let raw: HashMap<String, JunctionTableSpec> = HashMap::deserialize(d)?;
        let mut out = HashMap::with_capacity(raw.len());
        for (k, v) in raw {
            let (a, b) = k.split_once(SEP).ok_or_else(|| {
                D::Error::custom(format!("expected `event{SEP}object` key, got {k:?}"))
            })?;
            out.insert((a.to_string(), b.to_string()), v);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_spec_emits_bare_quoted_table() {
        let spec = EntityTableSpec::raw("CUSTOMERORD");
        assert_eq!(spec.source_sql(true), "\"CUSTOMERORD\"");
        assert_eq!(spec.source_sql(false), "\"CUSTOMERORD\"");
    }

    #[test]
    fn override_id_column_emits_aliased_subquery() {
        let mut spec = EntityTableSpec::raw("CUSTOMERORD");
        spec.id_column = Some("order_id".into());
        spec.time_column = Some("order_ts".into());
        let sql = spec.source_sql(false);
        assert!(sql.contains("order_id AS ocel_id"), "{sql}");
        assert!(sql.contains("order_ts AS ocel_time"), "{sql}");
        assert!(sql.contains("FROM \"CUSTOMERORD\""), "{sql}");
    }

    #[test]
    fn attribute_column_rename_appears_in_projection() {
        let mut spec = EntityTableSpec::raw("CUSTOMERORD");
        spec.attribute_columns
            .insert("concept:name".into(), "customer_name".into());
        let sql = spec.source_sql(true);
        assert!(sql.contains("customer_name AS \"concept:name\""), "{sql}");
        assert!(sql.contains("ocel_changed_field"), "{sql}");
    }

    #[test]
    fn select_body_escape_hatch_bypasses_other_fields() {
        let spec = EntityTableSpec::from_select(
            "SELECT id AS ocel_id, ts AS ocel_time FROM weird_source WHERE active",
        );
        let sql = spec.source_sql(false);
        assert!(sql.starts_with('('));
        assert!(sql.contains("WHERE active"));
    }

    #[test]
    fn junction_passthrough_emits_bare_quoted_table() {
        let spec = JunctionTableSpec::raw("order_items");
        assert_eq!(spec.source_sql(JunctionKind::E2O), "\"order_items\"");
    }

    #[test]
    fn junction_with_overrides_aliases_columns() {
        let mut spec = JunctionTableSpec::raw("order_items");
        spec.source_id_column = Some("order_id".into());
        spec.target_id_column = Some("item_id".into());
        let sql = spec.source_sql(JunctionKind::E2O);
        assert!(sql.contains("order_id AS ocel_event_id"), "{sql}");
        assert!(sql.contains("item_id AS ocel_object_id"), "{sql}");
        assert!(sql.contains("ocel_qualifier AS ocel_qualifier"), "{sql}");
    }

    #[test]
    fn per_pair_e2o_lookup_falls_back_to_default() {
        let mut m = OcelTableMappings::ocel20_default();
        m.e2o_tables.insert(
            ("Order".into(), "Item".into()),
            JunctionTableSpec::raw("order_items"),
        );
        assert_eq!(m.e2o_spec("Order", "Item").table, "order_items");
        assert_eq!(m.e2o_spec("Order", "Package").table, "event_object");
    }

    #[test]
    fn install_views_runs_each_ddl_once() {
        let m = OcelTableMappings {
            views: vec![
                ("v1".into(), "DDL1".into()),
                ("v2".into(), "DDL2".into()),
            ],
            ..OcelTableMappings::ocel20_default()
        };
        let mut ran: Vec<String> = Vec::new();
        m.install_views(|s| {
            ran.push(s.to_string());
            Ok::<(), ()>(())
        })
        .unwrap();
        assert_eq!(ran, vec!["DDL1", "DDL2"]);
    }

    #[test]
    fn pair_map_round_trips_through_serde_json() {
        let mut m = OcelTableMappings::ocel20_default();
        m.e2o_tables.insert(
            ("Order".into(), "Item".into()),
            JunctionTableSpec::raw("order_items"),
        );
        let json = serde_json::to_string(&m).unwrap();
        let back: OcelTableMappings = serde_json::from_str(&json).unwrap();
        assert_eq!(
            back.e2o_spec("Order", "Item").table,
            "order_items"
        );
    }
}
