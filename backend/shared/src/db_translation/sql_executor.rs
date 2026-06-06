//! Backend-agnostic row source for emitted SQL queries.
//!
//! Wraps either a `dbcon::DataSource` (SQLite, PostgreSQL via sqlx) or an
//! embedded DuckDB connection behind a single [`RowSource`] enum. The id-
//! native execution path in [`super::sql_executor_id`] streams rows
//! through this surface; CEL post-processing is applied host-side on the
//! id-keyed bindings the executor produces.

use dbcon::{DataSource, NormalizedValue};

/// A backend-agnostic source of rows for an emitted SQL query.
///
/// SQLite and PostgreSQL are served through `dbcon`'s sqlx-based pool;
/// DuckDB is served through the embedded `duckdb` crate (synchronous; we
/// expose the same async surface by running the scan on the calling
/// thread, which is fine since DuckDB's reads are I/O-bound on the file
/// system rather than on a remote socket).
pub enum RowSource<'a> {
    Dbcon(&'a DataSource),
    DuckDb(&'a duckdb::Connection),
}

impl<'a> RowSource<'a> {
    /// Stream rows for `sql`, invoking `handler` once per row with a
    /// vector of `(column_name, NormalizedValue)` pairs.
    pub async fn for_each_row<F: FnMut(Vec<(String, NormalizedValue)>)>(
        &self,
        sql: &str,
        mut handler: F,
    ) -> anyhow::Result<()> {
        match self {
            RowSource::Dbcon(ds) => ds.for_each_row_sql(sql, handler).await,
            RowSource::DuckDb(conn) => {
                let mut stmt = conn.prepare(sql)?;
                let mut rows = stmt.query([])?;
                let mut col_names: Option<Vec<String>> = None;
                while let Some(row) = rows.next()? {
                    if col_names.is_none() {
                        let stmt_ref: &duckdb::Statement<'_> = row.as_ref();
                        let n = stmt_ref.column_count();
                        let mut names = Vec::with_capacity(n);
                        for i in 0..n {
                            names.push(
                                stmt_ref
                                    .column_name(i)
                                    .cloned()
                                    .unwrap_or_else(|_| format!("col_{i}")),
                            );
                        }
                        col_names = Some(names);
                    }
                    let names = col_names.as_ref().unwrap();
                    let mut named: Vec<(String, NormalizedValue)> =
                        Vec::with_capacity(names.len());
                    for (i, nm) in names.iter().enumerate() {
                        named.push((nm.clone(), duckdb_value_to_normalized(row, i)?));
                    }
                    handler(named);
                }
                Ok(())
            }
        }
    }
}

fn duckdb_value_to_normalized(
    row: &duckdb::Row<'_>,
    col_index: usize,
) -> anyhow::Result<NormalizedValue> {
    use duckdb::types::{TimeUnit, Value as DV};
    let value: DV = row.get(col_index)?;
    Ok(match value {
        DV::Null => NormalizedValue::Null,
        DV::Boolean(b) => NormalizedValue::Boolean(b),
        DV::TinyInt(i) => NormalizedValue::Integer(i as i64),
        DV::SmallInt(i) => NormalizedValue::Integer(i as i64),
        DV::Int(i) => NormalizedValue::Integer(i as i64),
        DV::BigInt(i) => NormalizedValue::Integer(i),
        DV::HugeInt(i) => i64::try_from(i)
            .map(NormalizedValue::Integer)
            .unwrap_or_else(|_| NormalizedValue::Text(i.to_string())),
        DV::UTinyInt(i) => NormalizedValue::Integer(i as i64),
        DV::USmallInt(i) => NormalizedValue::Integer(i as i64),
        DV::UInt(i) => NormalizedValue::Integer(i as i64),
        DV::UBigInt(i) => NormalizedValue::Integer(i as i64),
        DV::Float(f) => NormalizedValue::Float(f as f64),
        DV::Double(f) => NormalizedValue::Float(f),
        DV::Text(s) => NormalizedValue::Text(s),
        DV::Blob(b) => NormalizedValue::Text(format!("<{} bytes>", b.len())),
        DV::Timestamp(unit, raw) => {
            let (secs, nanos) = match unit {
                TimeUnit::Second => (raw, 0i64),
                TimeUnit::Millisecond => (raw / 1_000, (raw % 1_000) * 1_000_000),
                TimeUnit::Microsecond => (raw / 1_000_000, (raw % 1_000_000) * 1_000),
                TimeUnit::Nanosecond => (raw / 1_000_000_000, raw % 1_000_000_000),
            };
            match chrono::DateTime::from_timestamp(secs, nanos as u32) {
                Some(dt) => NormalizedValue::Timestamp(dt.fixed_offset()),
                None => NormalizedValue::Unknown(format!("Timestamp({unit:?}, {raw})")),
            }
        }
        DV::Date32(d) => {
            let secs = (d as i64) * 86_400;
            match chrono::DateTime::from_timestamp(secs, 0) {
                Some(dt) => NormalizedValue::Timestamp(dt.fixed_offset()),
                None => NormalizedValue::Unknown(format!("Date32({d})")),
            }
        }
        other => NormalizedValue::Unknown(format!("{:?}", other)),
    })
}

/// Decode the `__parent_row_id__` column from a batched row.
/// dbcon's SQLite path reports window-function columns with an empty
/// `type_info().name()`, which routes the decode through the text
/// fallback and returns `Null` even though the underlying value is a
/// positive INTEGER. Accept Integer, Float (cast), text (parse), or
/// stringified-Unknown (parse).
pub fn parse_row_id(value: Option<&NormalizedValue>) -> Result<i64, String> {
    match value {
        Some(NormalizedValue::Integer(i)) => Ok(*i),
        Some(NormalizedValue::Float(f)) => Ok(*f as i64),
        Some(NormalizedValue::Text(s)) | Some(NormalizedValue::Unknown(s)) => s
            .parse::<i64>()
            .map_err(|e| format!("__parent_row_id__ text `{s}` not an integer: {e}")),
        Some(other) => Err(format!(
            "__parent_row_id__ not an integer (got {other:?})"
        )),
        None => Err("missing __parent_row_id__ on row".to_string()),
    }
}

