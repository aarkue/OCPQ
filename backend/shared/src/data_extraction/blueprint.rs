use std::collections::{HashMap, HashSet};

use chrono::{DateTime, FixedOffset, NaiveDateTime};
use dbcon::NormalizedValue;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::data_source::DataSourceTableInfo;

/// Maps column names to their index in a row's Vec<NormalizedValue>
pub type ColumnIndex<'a> = HashMap<&'a str, usize>;

/// A row of data with indexed column access
pub struct IndexedRow<'a> {
    pub values: &'a [NormalizedValue],
    pub index: &'a ColumnIndex<'a>,
}

impl<'a> IndexedRow<'a> {
    #[inline]
    pub fn get(&self, column: &str) -> Option<&NormalizedValue> {
        self.index.get(column).and_then(|&i| self.values.get(i))
    }

    #[inline]
    pub fn get_string(&self, column: &str) -> Option<String> {
        self.get(column).map(|v| v.to_string())
    }

    /// Get a string reference without cloning (only works for Text/Unknown variants)
    #[inline]
    pub fn get_str(&self, column: &str) -> Option<&str> {
        self.get(column).and_then(|v| v.as_str())
    }

    /// Get a timestamp reference without string roundtrip
    #[inline]
    pub fn get_timestamp(&self, column: &str) -> Option<&DateTime<FixedOffset>> {
        self.get(column).and_then(|v| v.as_timestamp())
    }
}

pub fn build_column_index<'a>(columns: &[&'a str]) -> ColumnIndex<'a> {
    columns
        .iter()
        .enumerate()
        .map(|(i, &name)| (name, i))
        .collect()
}

/// A value derived from column data. Supports column reference, constant, or template.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ValueExpression {
    /// Direct column reference
    Column { column: String },
    /// Constant value
    Constant { value: String },
    /// Template with placeholders, e.g., "ORD-{order_id}-{region}"
    Template { template: String },
}

impl ValueExpression {
    /// Evaluate the expression against an indexed row
    ///
    /// Returns either a constant value, a column value, or an evaluated template string
    ///
    /// Returns None if the value references a column that is missing or null.
    pub fn evaluate(&self, row: &IndexedRow<'_>) -> Option<String> {
        match self {
            ValueExpression::Constant { value } => Some(value.clone()),
            ValueExpression::Column { column } => row.get_string(column),
            ValueExpression::Template { template } => {
                let mut result = template.clone();
                let mut start = 0;
                while let Some(open) = result[start..].find('{') {
                    let open_idx = start + open;
                    if let Some(close) = result[open_idx..].find('}') {
                        let close_idx = open_idx + close;
                        let col_name = &result[open_idx + 1..close_idx];
                        if let Some(val) = row.get_string(col_name) {
                            result.replace_range(open_idx..=close_idx, &val);
                            start = open_idx + val.len();
                        } else {
                            start = close_idx + 1;
                        }
                    } else {
                        break;
                    }
                }
                // If any placeholders remain unreplaced or there is a mismatch, treat as missing value
                if result.contains('{') && result.contains('}') {
                    None
                } else {
                    Some(result)
                }
            }
        }
    }

    /// Get all column names referenced by this expression
    pub fn referenced_columns<'a>(&'a self, out: &mut HashSet<&'a str>) {
        match self {
            ValueExpression::Column { column } if !column.is_empty() => {
                out.insert(column);
            }
            ValueExpression::Template { template } => {
                let mut start = 0;
                while let Some(open) = template[start..].find('{') {
                    let open_idx = start + open;
                    if let Some(close) = template[open_idx..].find('}') {
                        let close_idx = open_idx + close;
                        let col_name = &template[open_idx + 1..close_idx];
                        if !col_name.is_empty() {
                            out.insert(col_name);
                        }
                        start = close_idx + 1;
                    } else {
                        break;
                    }
                }
            }
            _ => {}
        }
    }
}

/// Format specification for parsing timestamps
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TimestampFormat {
    Auto,
    FormatString { format: String },
    UnixSeconds,
    UnixMillis,
}

/// Source specification for extracting timestamps
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TimestampSource {
    Column {
        column: String,
        format: TimestampFormat,
    },
    Components {
        date_column: Option<String>,
        time_column: Option<String>,
    },
    /// Fixed timestamp value (e.g., Unix epoch for attributes without timestamps)
    Constant {
        value: String,
        format: TimestampFormat,
    },
}

impl TimestampSource {
    pub fn parse(&self, row: &IndexedRow<'_>) -> Option<DateTime<FixedOffset>> {
        match self {
            TimestampSource::Column { column, format } => {
                if let Some(ts) = row.get_timestamp(column) {
                    return Some(*ts);
                }
                let value = row.get_string(column)?;
                parse_timestamp(&value, format)
            }
            TimestampSource::Components {
                date_column,
                time_column,
            } => {
                let date_str = date_column.as_ref().and_then(|c| row.get_string(c));
                let time_str = time_column.as_ref().and_then(|c| row.get_string(c));
                parse_timestamp_components(date_str.as_deref(), time_str.as_deref())
            }
            TimestampSource::Constant { value, format } => parse_timestamp(value, format),
        }
    }

    pub fn referenced_columns<'a>(&'a self, out: &mut HashSet<&'a str>) {
        match self {
            TimestampSource::Column { column, .. } if !column.is_empty() => {
                out.insert(column);
            }
            TimestampSource::Components {
                date_column,
                time_column,
            } => {
                if let Some(c) = date_column {
                    out.insert(c);
                }
                if let Some(c) = time_column {
                    out.insert(c);
                }
            }
            _ => {}
        }
    }
}

/// Parse a timestamp from separate date and time strings, trying multiple strategies.
///
/// Handles cases where columns contain:
/// - Just date/time: "2015-01-06" + "15:02:03"
/// - Full datetimes: "2015-01-06T00:00:00" + "1970-01-01T15:02:03" (date from first, time from second)
/// - Mixed: "2015-01-06" + "1970-01-01T15:02:03"
/// - Only one column provided
fn parse_timestamp_components(
    date_str: Option<&str>,
    time_str: Option<&str>,
) -> Option<DateTime<FixedOffset>> {
    let auto = &TimestampFormat::Auto;

    match (date_str, time_str) {
        (Some(d), Some(t)) => {
            // Strategy 1: Try raw concatenation "date time" (works for pure date + pure time)
            if let Some(ts) = parse_timestamp(&format!("{} {}", d, t), auto) {
                return Some(ts);
            }
            // Strategy 2: Extract date part from first, time part from second
            // Handles "2015-01-06T00:00:00" + "1970-01-01T15:02:03"
            let date_part = d
                .split_once('T')
                .or_else(|| d.split_once(' '))
                .map(|(p, _)| p)
                .unwrap_or(d);
            let time_part = t
                .rsplit_once('T')
                .or_else(|| t.rsplit_once(' '))
                .map(|(_, p)| p)
                .unwrap_or(t);
            if let Some(ts) = parse_timestamp(&format!("{} {}", date_part, time_part), auto) {
                return Some(ts);
            }
            // Strategy 3: Try each value as a standalone full timestamp
            parse_timestamp(d, auto).or_else(|| parse_timestamp(t, auto))
        }
        (Some(d), None) => parse_timestamp(d, auto),
        (None, Some(t)) => parse_timestamp(t, auto),
        (None, None) => None,
    }
}
/// Parse timestamp, trying multiple formats if Auto is specified.
///
/// Auto mode tries formats in order of specificity, covering:
/// - ISO 8601 / RFC 3339 (with and without timezone offsets)
/// - Naive datetimes with fractional seconds, with seconds, and without seconds
/// - Date-only values (set to midnight UTC)
/// - European (dd/mm/yyyy) and American (mm/dd/yyyy) date formats
/// - RFC 2822
/// - GMT-style timestamps (e.g., "Mon Apr 03 2023 12:08:18 GMT+0200")
/// - UTC-suffix datetimes
fn parse_timestamp(value: &str, format: &TimestampFormat) -> Option<DateTime<FixedOffset>> {
    let utc = FixedOffset::east_opt(0)?;
    match format {
        TimestampFormat::Auto => {
            // 1. Try RFC 3339 / ISO 8601 with timezone
            if let Ok(dt) = DateTime::parse_from_rfc3339(value) {
                return Some(dt);
            }
            // ISO 8601 with non-colon offset (e.g., +0000)
            if let Ok(dt) = DateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%z") {
                return Some(dt);
            }
            // 2. Try RFC 2822
            if let Ok(dt) = DateTime::parse_from_rfc2822(value) {
                return Some(dt);
            }

            // 3. Naive formats (assumed UTC), ordered by specificity
            const NAIVE_FORMATS: &[&str] = &[
                "%Y-%m-%d %H:%M:%S%.f",
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%d %H:%M",
                "%Y-%m-%dT%H:%M:%S%.f",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%dT%H:%M",
                "%d/%m/%Y %H:%M:%S",
                "%d/%m/%Y %H:%M",
                "%d.%m.%Y %H:%M:%S",
                "%d.%m.%Y %H:%M",
                "%m/%d/%Y %H:%M:%S",
                "%m/%d/%Y %H:%M",
                // UTC suffix
                "%Y-%m-%d %H:%M:%S UTC",
            ];
            for fmt in NAIVE_FORMATS {
                if let Ok(dt) = NaiveDateTime::parse_from_str(value, fmt) {
                    return Some(DateTime::from_naive_utc_and_offset(dt, utc));
                }
            }

            // 4. Date-only formats (set to midnight UTC)
            const DATE_FORMATS: &[&str] = &["%Y-%m-%d", "%d/%m/%Y", "%d.%m.%Y", "%m/%d/%Y"];
            for fmt in DATE_FORMATS {
                if let Ok(d) = chrono::NaiveDate::parse_from_str(value, fmt) {
                    return Some(DateTime::from_naive_utc_and_offset(
                        d.and_hms_opt(0, 0, 0)?,
                        utc,
                    ));
                }
            }

            // 5. GMT format: "Mon Apr 03 2023 12:08:18 GMT+0200 (...)"
            if let Ok((dt, _)) = DateTime::parse_and_remainder(value, "%Z %b %d %Y %T GMT%z") {
                return Some(dt);
            }

            // 6. Last resort: generic DateTime parse
            value.parse::<DateTime<FixedOffset>>().ok()
        }
        TimestampFormat::FormatString { format: fmt } => {
            // Try as NaiveDateTime first (format includes time components)
            if let Ok(dt) = NaiveDateTime::parse_from_str(value, fmt) {
                return Some(DateTime::from_naive_utc_and_offset(dt, utc));
            }
            // Fallback: date-only format strings (NaiveDateTime fails without hour)
            if let Ok(d) = chrono::NaiveDate::parse_from_str(value, fmt) {
                return Some(DateTime::from_naive_utc_and_offset(
                    d.and_hms_opt(0, 0, 0)?,
                    utc,
                ));
            }
            None
        }
        TimestampFormat::UnixSeconds => value
            .parse::<i64>()
            .ok()
            .and_then(|s| DateTime::from_timestamp(s, 0))
            .map(|dt| dt.with_timezone(&utc)),
        TimestampFormat::UnixMillis => value
            .parse::<i64>()
            .ok()
            .and_then(DateTime::from_timestamp_millis)
            .map(|dt| dt.with_timezone(&utc)),
    }
}

/// Change Tables

/// Condition for matching rows in change tables (serializable)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ChangeTableCondition {
    #[serde(rename = "OR")]
    Or {
        conditions: Vec<ChangeTableCondition>,
    },
    #[serde(rename = "AND")]
    And {
        conditions: Vec<ChangeTableCondition>,
    },
    ColumnEquals {
        column: String,
        value: String,
    },
    ColumnNotEquals {
        column: String,
        value: String,
    },
    ColumnMatches {
        column: String,
        regex: String,
    },
    ColumnNotEmpty {
        column: String,
    },
}

impl ChangeTableCondition {
    /// Pre-compile into a PreparedCondition for efficient repeated evaluation
    pub fn prepare(&self) -> Result<PreparedCondition, regex::Error> {
        match self {
            ChangeTableCondition::Or { conditions } => Ok(PreparedCondition::Or(
                conditions
                    .iter()
                    .map(|c| c.prepare())
                    .collect::<Result<_, _>>()?,
            )),
            ChangeTableCondition::And { conditions } => Ok(PreparedCondition::And(
                conditions
                    .iter()
                    .map(|c| c.prepare())
                    .collect::<Result<_, _>>()?,
            )),
            ChangeTableCondition::ColumnEquals { column, value } => {
                Ok(PreparedCondition::ColumnEquals {
                    column: column.clone(),
                    value: value.clone(),
                })
            }
            ChangeTableCondition::ColumnNotEquals { column, value } => {
                Ok(PreparedCondition::ColumnNotEquals {
                    column: column.clone(),
                    value: value.clone(),
                })
            }
            ChangeTableCondition::ColumnMatches { column, regex } => {
                Ok(PreparedCondition::ColumnMatches {
                    column: column.clone(),
                    regex: regex::Regex::new(regex)?,
                })
            }
            ChangeTableCondition::ColumnNotEmpty { column } => {
                Ok(PreparedCondition::ColumnNotEmpty {
                    column: column.clone(),
                })
            }
        }
    }

    pub fn referenced_columns<'a>(&'a self, out: &mut HashSet<&'a str>) {
        match self {
            ChangeTableCondition::Or { conditions } | ChangeTableCondition::And { conditions } => {
                for c in conditions {
                    c.referenced_columns(out);
                }
            }
            ChangeTableCondition::ColumnEquals { column, .. }
            | ChangeTableCondition::ColumnNotEquals { column, .. }
            | ChangeTableCondition::ColumnMatches { column, .. }
            | ChangeTableCondition::ColumnNotEmpty { column } => {
                if !column.is_empty() {
                    out.insert(column);
                }
            }
        }
    }
}

/// Pre-compiled condition with cached regex patterns
pub enum PreparedCondition {
    Or(Vec<PreparedCondition>),
    And(Vec<PreparedCondition>),
    ColumnEquals { column: String, value: String },
    ColumnNotEquals { column: String, value: String },
    ColumnMatches { column: String, regex: regex::Regex },
    ColumnNotEmpty { column: String },
}

impl PreparedCondition {
    pub fn evaluate(&self, row: &IndexedRow<'_>) -> bool {
        match self {
            PreparedCondition::Or(conds) => conds.iter().any(|c| c.evaluate(row)),
            PreparedCondition::And(conds) => conds.iter().all(|c| c.evaluate(row)),
            PreparedCondition::ColumnEquals { column, value } => {
                // Try zero-copy str comparison first, fall back to string for non-text types
                if let Some(s) = row.get_str(column) {
                    s == value.as_str()
                } else {
                    row.get_string(column).map(|v| v == *value).unwrap_or(false)
                }
            }
            PreparedCondition::ColumnNotEquals { column, value } => {
                // True if the column value differs from the target (missing value counts as differing)
                if let Some(s) = row.get_str(column) {
                    s != value.as_str()
                } else {
                    row.get_string(column).map(|v| v != *value).unwrap_or(true)
                }
            }
            PreparedCondition::ColumnMatches { column, regex } => {
                if let Some(s) = row.get_str(column) {
                    regex.is_match(s)
                } else {
                    row.get_string(column)
                        .map(|v| regex.is_match(&v))
                        .unwrap_or(false)
                }
            }
            PreparedCondition::ColumnNotEmpty { column } => row
                .get(column)
                .map(|v| match v {
                    NormalizedValue::Null => false,
                    _ => v.as_str().map(|s| !s.is_empty()).unwrap_or(true),
                })
                .unwrap_or(false),
        }
    }
}

/// Rule for extracting events from change tables
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChangeTableEventRule {
    pub id: String,
    pub event_type: String,
    pub conditions: ChangeTableCondition,
}

/// Mapping from source column to attribute name
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AttributeMapping {
    pub id: String,
    pub source_column: String,
    pub attribute_name: String,
}

/// Configuration for extracting attributes
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum AttributeConfig {
    Static {
        mappings: Vec<AttributeMapping>,
    },
    Dynamic {
        name_column: String,
        value_column: String,
    },
}

impl AttributeConfig {
    pub fn referenced_columns<'a>(&'a self, out: &mut HashSet<&'a str>) {
        match self {
            AttributeConfig::Static { mappings } => {
                for m in mappings {
                    if !m.source_column.is_empty() {
                        out.insert(&m.source_column);
                    }
                }
            }
            AttributeConfig::Dynamic {
                name_column,
                value_column,
            } => {
                if !name_column.is_empty() {
                    out.insert(name_column);
                }
                if !value_column.is_empty() {
                    out.insert(value_column);
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MultiValueConfig {
    pub enabled: bool,
    pub delimiter: String,
    pub trim_values: bool,
    /// When set (and non-empty), extract values via regex instead of splitting by delimiter.
    /// Each capture group yields one value; if the regex has no groups, the full match is used.
    #[serde(default)]
    pub regex_pattern: Option<String>,
}

impl MultiValueConfig {
    /// Split a raw string into values using this config.
    /// Returns the raw string as a single-element vec when the config is disabled or invalid.
    pub fn split(&self, raw: &str) -> Vec<String> {
        if !self.enabled {
            return vec![raw.to_string()];
        }
        if let Some(pattern) = self.regex_pattern.as_ref().filter(|p| !p.is_empty()) {
            if let Ok(re) = regex::Regex::new(pattern) {
                let mut out = Vec::new();
                for caps in re.captures_iter(raw) {
                    // If there are capture groups, use group 1..n; otherwise use full match.
                    if caps.len() > 1 {
                        for i in 1..caps.len() {
                            if let Some(m) = caps.get(i) {
                                let v = if self.trim_values {
                                    m.as_str().trim()
                                } else {
                                    m.as_str()
                                };
                                if !v.is_empty() {
                                    out.push(v.to_string());
                                }
                            }
                        }
                    } else if let Some(m) = caps.get(0) {
                        let v = if self.trim_values {
                            m.as_str().trim()
                        } else {
                            m.as_str()
                        };
                        if !v.is_empty() {
                            out.push(v.to_string());
                        }
                    }
                }
                return out;
            }
            return Vec::new();
        }
        if self.delimiter.is_empty() {
            return vec![raw.to_string()];
        }
        raw.split(&self.delimiter)
            .map(|s| if self.trim_values { s.trim() } else { s })
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect()
    }
}

/// Split a value by an optional multi-value config.
/// Returns `vec![raw]` when the config is None/disabled, `vec![]` when raw is empty.
pub fn split_value(raw: String, config: Option<&MultiValueConfig>) -> Vec<String> {
    if raw.is_empty() {
        return Vec::new();
    }
    match config {
        Some(cfg) if cfg.enabled => cfg.split(&raw),
        _ => vec![raw],
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InlineObjectReference {
    pub id: String,
    pub object_id: ValueExpression,
    pub object_type: Option<ObjectTypeSpec>,
    pub qualifier: Option<ValueExpression>,
    pub multi_value_config: Option<MultiValueConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(untagged)]
pub enum ObjectTypeSpec {
    Fixed(String),
    Expression(ValueExpression),
}

impl ObjectTypeSpec {
    pub fn evaluate(&self, row: &IndexedRow<'_>) -> Option<String> {
        match self {
            ObjectTypeSpec::Fixed(s) if !s.is_empty() => Some(s.clone()),
            ObjectTypeSpec::Fixed(_) => None,
            ObjectTypeSpec::Expression(expr) => expr.evaluate(row),
        }
    }

    pub fn referenced_columns<'a>(&'a self, out: &mut HashSet<&'a str>) {
        if let ObjectTypeSpec::Expression(expr) = self {
            expr.referenced_columns(out);
        }
    }
}

impl InlineObjectReference {
    pub fn referenced_columns<'a>(&'a self, out: &mut HashSet<&'a str>) {
        self.object_id.referenced_columns(out);
        if let Some(t) = &self.object_type {
            t.referenced_columns(out);
        }
        if let Some(q) = &self.qualifier {
            q.referenced_columns(out);
        }
    }

    /// Extract object IDs from a row, handling multi-value splitting
    pub fn extract_object_ids(&self, row: &IndexedRow<'_>) -> Vec<String> {
        let raw = match self.object_id.evaluate(row) {
            Some(v) if !v.is_empty() => v,
            _ => return vec![],
        };
        split_value(raw, self.multi_value_config.as_ref())
    }
}

/// How a table should be used in the extraction
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum TableUsageData {
    Event {
        event_type: ValueExpression,
        id: Option<ValueExpression>,
        timestamp: TimestampSource,
        #[serde(default)]
        inline_object_references: Vec<InlineObjectReference>,
    },
    Object {
        object_type: ValueExpression,
        id: ValueExpression,
        #[serde(default)]
        prefix_id_with_type: bool,
        /// When set, enables object change tracking (attribute values over time)
        #[serde(default)]
        timestamp: Option<TimestampSource>,
        /// When set, enables object change tracking (attribute values over time)
        #[serde(default)]
        attribute_config: Option<AttributeConfig>,
    },
    #[serde(rename = "e2o-relation")]
    E2ORelation {
        source_event: ValueExpression,
        target_object: ValueExpression,
        qualifier: Option<ValueExpression>,
        #[serde(default)]
        target_object_type: Option<ObjectTypeSpec>,
        /// Split the target_object cell into multiple IDs (delimiter or regex)
        #[serde(default)]
        target_object_multi: Option<MultiValueConfig>,
    },
    #[serde(rename = "o2o-relation")]
    O2ORelation {
        source_object: ValueExpression,
        target_object: ValueExpression,
        qualifier: Option<ValueExpression>,
        #[serde(default)]
        source_object_type: Option<ObjectTypeSpec>,
        #[serde(default)]
        target_object_type: Option<ObjectTypeSpec>,
        #[serde(default)]
        source_object_multi: Option<MultiValueConfig>,
        #[serde(default)]
        target_object_multi: Option<MultiValueConfig>,
    },
    ChangeTableEvents {
        timestamp: TimestampSource,
        id: Option<ValueExpression>,
        event_rules: Vec<ChangeTableEventRule>,
        #[serde(default)]
        inline_object_references: Vec<InlineObjectReference>,
    },
}

impl TableUsageData {
    /// Get all column names required by this usage configuration
    pub fn required_columns(&self) -> HashSet<&str> {
        let mut cols = HashSet::new();
        match self {
            TableUsageData::Event {
                event_type,
                id,
                timestamp,
                inline_object_references,
            } => {
                event_type.referenced_columns(&mut cols);
                if let Some(id_expr) = id {
                    id_expr.referenced_columns(&mut cols);
                }
                timestamp.referenced_columns(&mut cols);
                for r in inline_object_references {
                    r.referenced_columns(&mut cols);
                }
            }
            TableUsageData::Object {
                object_type,
                id,
                timestamp,
                attribute_config,
                ..
            } => {
                object_type.referenced_columns(&mut cols);
                id.referenced_columns(&mut cols);
                if let Some(ts) = timestamp {
                    ts.referenced_columns(&mut cols);
                }
                if let Some(ac) = attribute_config {
                    ac.referenced_columns(&mut cols);
                }
            }
            TableUsageData::E2ORelation {
                source_event,
                target_object,
                qualifier,
                target_object_type,
                ..
            } => {
                source_event.referenced_columns(&mut cols);
                target_object.referenced_columns(&mut cols);
                if let Some(q) = qualifier {
                    q.referenced_columns(&mut cols);
                }
                if let Some(t) = target_object_type {
                    t.referenced_columns(&mut cols);
                }
            }
            TableUsageData::O2ORelation {
                source_object,
                target_object,
                qualifier,
                source_object_type,
                target_object_type,
                ..
            } => {
                source_object.referenced_columns(&mut cols);
                target_object.referenced_columns(&mut cols);
                if let Some(q) = qualifier {
                    q.referenced_columns(&mut cols);
                }
                if let Some(t) = source_object_type {
                    t.referenced_columns(&mut cols);
                }
                if let Some(t) = target_object_type {
                    t.referenced_columns(&mut cols);
                }
            }
            TableUsageData::ChangeTableEvents {
                timestamp,
                id,
                event_rules,
                inline_object_references,
            } => {
                timestamp.referenced_columns(&mut cols);
                if let Some(id_expr) = id {
                    id_expr.referenced_columns(&mut cols);
                }
                for rule in event_rules {
                    rule.conditions.referenced_columns(&mut cols);
                }
                for r in inline_object_references {
                    r.referenced_columns(&mut cols);
                }
            }
        }
        cols
    }

    /// Whether this usage mode can be processed row-by-row via `process_single_row`
    pub fn is_streaming_eligible(&self) -> bool {
        matches!(
            self,
            TableUsageData::Event { .. }
                | TableUsageData::Object { .. }
                | TableUsageData::E2ORelation { .. }
                | TableUsageData::O2ORelation { .. }
        )
    }

    /// Processing order: objects (0) < events (1) < relations (2).
    pub fn processing_order(&self) -> u8 {
        match self {
            TableUsageData::Object { .. } => 0,
            TableUsageData::Event { .. } | TableUsageData::ChangeTableEvents { .. } => 1,
            TableUsageData::E2ORelation { .. } | TableUsageData::O2ORelation { .. } => 2,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TableExtractionConfig {
    pub source_id: String,
    pub table_name: String,
    pub table_info: DataSourceTableInfo,
    pub usage: TableUsageData,
    /// If set, rows come from this virtual table instead of source_id/table_name
    #[serde(default)]
    pub virtual_table_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum DataSourceType {
    SQLite,
    CSV,
    MySQL,
    PostgreSQL,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DataSourceConfig {
    pub id: String,
    #[serde(rename = "type")]
    pub source_type: DataSourceType,
    pub name: String,
    pub connection_string: String,
}

/// Reference to either a real database table or a previously computed virtual table
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TransformSource {
    Table {
        source_id: String,
        table_name: String,
    },
    VirtualTable {
        virtual_table_id: String,
    },
}

/// Join type for Join transforms
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "kebab-case")]
pub enum JoinType {
    Inner,
    Left,
    Right,
    Full,
}

/// Defines how a virtual table derives its rows
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TransformOperation {
    Filter {
        source: TransformSource,
        condition: ChangeTableCondition,
    },
    Join {
        left: TransformSource,
        right: TransformSource,
        join_type: JoinType,
        /// Column pairs to join on: (left_col, right_col)
        on: Vec<(String, String)>,
    },
    Union {
        sources: Vec<TransformSource>,
    },
}

/// A virtual table definition
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VirtualTableConfig {
    pub id: String,
    pub name: String,
    pub operation: TransformOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DataExtractionBlueprint {
    pub sources: Vec<DataSourceConfig>,
    pub tables: Vec<TableExtractionConfig>,
    #[serde(default)]
    pub virtual_tables: Vec<VirtualTableConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecuteExtractionRequest {
    pub blueprint: DataExtractionBlueprint,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecuteExtractionResponse {
    pub success: bool,
    pub total_events: usize,
    pub total_objects: usize,
    pub event_types: Vec<String>,
    pub object_types: Vec<String>,
    pub errors: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}
