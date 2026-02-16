use std::collections::{HashMap, HashSet};

use chrono::{DateTime, FixedOffset, NaiveDateTime};
use dbcon::NormalizedValue;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::data_source::DataSourceTableInfo;

// Table Column Access

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
}

/// Build a column index from a list of column names
pub fn build_column_index<'a>(columns: &[&'a str]) -> ColumnIndex<'a> {
    columns
        .iter()
        .enumerate()
        .map(|(i, &name)| (name, i))
        .collect()
}

// Evaluating Value Expressions (including templates)

/// A value derived from column data. Supports column reference, constant, or template.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
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

// Parsing Timestamps

/// Format specification for parsing timestamps
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TimestampFormat {
    Auto,
    FormatString { format: String },
    UnixSeconds,
    UnixMillis,
}

/// Source specification for extracting timestamps
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
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
}

impl TimestampSource {
    pub fn parse(&self, row: &IndexedRow<'_>) -> Option<DateTime<FixedOffset>> {
        match self {
            TimestampSource::Column { column, format } => {
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
/// Parse timestamp, trying multiple formats if Auto is specified
/// Prioritizes common date and time formats, preferring european dd/mm/yyyy over american mm/dd/yyyy when ambiguous. Falls back to direct DateTime parsing if all else fails.
fn parse_timestamp(value: &str, format: &TimestampFormat) -> Option<DateTime<FixedOffset>> {
    let utc = FixedOffset::east_opt(0)?;
    match format {
        TimestampFormat::Auto => {
            const FORMATS: &[&str] = &[
                "%Y-%m-%d %H:%M:%S%.f",
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%dT%H:%M:%S%.f",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d",
                "%d/%m/%Y %H:%M:%S",
                "%d/%m/%Y",
                "%m/%d/%Y %H:%M:%S",
                "%m/%d/%Y",
            ];
            for fmt in FORMATS {
                if let Ok(dt) = NaiveDateTime::parse_from_str(value, fmt) {
                    return Some(DateTime::from_naive_utc_and_offset(dt, utc));
                }
                if let Ok(d) = chrono::NaiveDate::parse_from_str(value, fmt) {
                    return Some(DateTime::from_naive_utc_and_offset(
                        d.and_hms_opt(0, 0, 0)?,
                        utc,
                    ));
                }
            }
            value.parse::<DateTime<FixedOffset>>().ok()
        }
        TimestampFormat::FormatString { format: fmt } => NaiveDateTime::parse_from_str(value, fmt)
            .ok()
            .map(|dt| DateTime::from_naive_utc_and_offset(dt, utc)),
        TimestampFormat::UnixSeconds => value
            .parse::<i64>()
            .ok()
            .and_then(|s| DateTime::from_timestamp(s, 0))
            .map(|dt| dt.with_timezone(&utc)),
        TimestampFormat::UnixMillis => value
            .parse::<i64>()
            .ok()
            .and_then(|ms| DateTime::from_timestamp_millis(ms))
            .map(|dt| dt.with_timezone(&utc)),
    }
}

/// Change Tables

/// Condition for matching rows in change tables (serializable)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
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
    ColumnMatches { column: String, regex: regex::Regex },
    ColumnNotEmpty { column: String },
}

impl PreparedCondition {
    pub fn evaluate(&self, row: &IndexedRow<'_>) -> bool {
        match self {
            PreparedCondition::Or(conds) => conds.iter().any(|c| c.evaluate(row)),
            PreparedCondition::And(conds) => conds.iter().all(|c| c.evaluate(row)),
            PreparedCondition::ColumnEquals { column, value } => {
                row.get_string(column).map(|v| v == *value).unwrap_or(false)
            }
            PreparedCondition::ColumnMatches { column, regex } => row
                .get_string(column)
                .map(|v| regex.is_match(&v))
                .unwrap_or(false),
            PreparedCondition::ColumnNotEmpty { column } => row
                .get(column)
                .map(|v| !matches!(v, NormalizedValue::Null) && !v.to_string().is_empty())
                .unwrap_or(false),
        }
    }
}

/// Rule for extracting events from change tables
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
pub struct ChangeTableEventRule {
    pub id: String,
    pub event_type: String,
    pub conditions: ChangeTableCondition,
}

/// Mapping from source column to attribute name
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
pub struct AttributeMapping {
    pub id: String,
    pub source_column: String,
    pub attribute_name: String,
}

/// Configuration for extracting attributes
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
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

// Inline Object References

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
pub struct MultiValueConfig {
    pub enabled: bool,
    pub delimiter: String,
    pub trim_values: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
pub struct InlineObjectReference {
    pub id: String,
    pub object_id: ValueExpression,
    pub object_type: Option<ObjectTypeSpec>,
    pub qualifier: Option<ValueExpression>,
    pub multi_value_config: Option<MultiValueConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
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

        if let Some(cfg) = &self.multi_value_config {
            if cfg.enabled && !cfg.delimiter.is_empty() {
                return raw
                    .split(&cfg.delimiter)
                    .map(|s| if cfg.trim_values { s.trim() } else { s })
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect();
            }
        }

        vec![raw]
    }
}

// Overall Table Usage Configuration

/// How a table should be used in the extraction
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum TableUsageData {
    None,
    SingleObject {
        object_type: String,
        id: ValueExpression,
    },
    MultiObject {
        object_type: ValueExpression,
        id: ValueExpression,
    },
    SingleEvent {
        event_type: String,
        id: ValueExpression,
        timestamp: TimestampSource,
        #[serde(default)]
        inline_object_references: Vec<InlineObjectReference>,
    },
    MultiEvent {
        event_type: ValueExpression,
        id: ValueExpression,
        timestamp: TimestampSource,
        #[serde(default)]
        inline_object_references: Vec<InlineObjectReference>,
    },
    #[serde(rename = "e2o-relation")]
    E2ORelation {
        source_event: ValueExpression,
        target_object: ValueExpression,
        qualifier: Option<ValueExpression>,
    },
    #[serde(rename = "o2o-relation")]
    O2ORelation {
        source_object: ValueExpression,
        target_object: ValueExpression,
        qualifier: Option<ValueExpression>,
    },
    ChangeTableEvents {
        timestamp: TimestampSource,
        id: Option<ValueExpression>,
        event_rules: Vec<ChangeTableEventRule>,
        #[serde(default)]
        inline_object_references: Vec<InlineObjectReference>,
    },
    ChangeTableObjectChanges {
        object_id: ValueExpression,
        object_type: String,
        timestamp: TimestampSource,
        attribute_config: AttributeConfig,
    },
}

impl TableUsageData {
    /// Get all column names required by this usage configuration
    pub fn required_columns(&self) -> HashSet<&str> {
        let mut cols = HashSet::new();
        match self {
            TableUsageData::None => {}
            TableUsageData::SingleObject { id, .. } => id.referenced_columns(&mut cols),
            TableUsageData::MultiObject { object_type, id } => {
                object_type.referenced_columns(&mut cols);
                id.referenced_columns(&mut cols);
            }
            TableUsageData::SingleEvent {
                id,
                timestamp,
                inline_object_references,
                ..
            } => {
                id.referenced_columns(&mut cols);
                timestamp.referenced_columns(&mut cols);
                for r in inline_object_references {
                    r.referenced_columns(&mut cols);
                }
            }
            TableUsageData::MultiEvent {
                event_type,
                id,
                timestamp,
                inline_object_references,
            } => {
                event_type.referenced_columns(&mut cols);
                id.referenced_columns(&mut cols);
                timestamp.referenced_columns(&mut cols);
                for r in inline_object_references {
                    r.referenced_columns(&mut cols);
                }
            }
            TableUsageData::E2ORelation {
                source_event,
                target_object,
                qualifier,
            } => {
                source_event.referenced_columns(&mut cols);
                target_object.referenced_columns(&mut cols);
                if let Some(q) = qualifier {
                    q.referenced_columns(&mut cols);
                }
            }
            TableUsageData::O2ORelation {
                source_object,
                target_object,
                qualifier,
            } => {
                source_object.referenced_columns(&mut cols);
                target_object.referenced_columns(&mut cols);
                if let Some(q) = qualifier {
                    q.referenced_columns(&mut cols);
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
            TableUsageData::ChangeTableObjectChanges {
                object_id,
                timestamp,
                attribute_config,
                ..
            } => {
                object_id.referenced_columns(&mut cols);
                timestamp.referenced_columns(&mut cols);
                attribute_config.referenced_columns(&mut cols);
            }
        }
        cols
    }

    /// Processing order: objects (0) < events (1) < relations (2). None is skipped.
    pub fn processing_order(&self) -> u8 {
        match self {
            TableUsageData::None => 255,
            TableUsageData::SingleObject { .. }
            | TableUsageData::MultiObject { .. }
            | TableUsageData::ChangeTableObjectChanges { .. } => 0,
            TableUsageData::SingleEvent { .. }
            | TableUsageData::MultiEvent { .. }
            | TableUsageData::ChangeTableEvents { .. } => 1,
            TableUsageData::E2ORelation { .. } | TableUsageData::O2ORelation { .. } => 2,
        }
    }
}

// Blueprint & Request/Response Types

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
pub struct TableExtractionConfig {
    pub source_id: String,
    pub table_name: String,
    pub table_info: DataSourceTableInfo,
    pub usage: TableUsageData,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum DataSourceType {
    SQLite,
    CSV,
    MySQL,
    PostgreSQL,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
pub struct DataSourceConfig {
    pub id: String,
    #[serde(rename = "type")]
    pub source_type: DataSourceType,
    pub name: String,
    pub connection_string: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
pub struct DataExtractionBlueprint {
    pub sources: Vec<DataSourceConfig>,
    pub tables: Vec<TableExtractionConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
pub struct ExecuteExtractionRequest {
    pub blueprint: DataExtractionBlueprint,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../frontend/src/types/generated/")]
pub struct ExecuteExtractionResponse {
    pub success: bool,
    pub total_events: usize,
    pub total_objects: usize,
    pub event_types: Vec<String>,
    pub object_types: Vec<String>,
    pub errors: Vec<String>,
}
