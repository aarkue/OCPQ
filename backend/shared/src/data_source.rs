//! Data Source Connectivity using DBCon
//! This module defines the data structures and functions for connecting to various data sources using the DBCon library,
//! retrieving metadata about the tables, columns, primary keys, and foreign keys, and providing a preview of the data.
//!
//! The types of ConDB are wrapped for better integration with the frontend (e.g., generating TypeScript types using ts-rs).

use std::collections::HashMap;

use dbcon::{DataColumnInfo, DataSource, DataTableInfo, ForeignKey, PrimaryKey};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Request to connect to a data source
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct ConnectDataSourceRequest {
    /// A name to identify the data source
    pub name: String,
    /// Connection string (e.g., "postgres://...", "sqlite:...", "csv://path" or just a .csv path)
    pub connection_string: String,
}

/// Information about a single column
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct DataSourceColumnInfo {
    pub name: String,
    pub col_type: String,
    pub is_nullable: bool,
}

impl From<&DataColumnInfo> for DataSourceColumnInfo {
    fn from(col: &DataColumnInfo) -> Self {
        Self {
            name: col.name.clone(),
            col_type: format!("{:?}", col.col_type),
            is_nullable: col.is_nullable,
        }
    }
}

/// Information about a primary key
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct DataSourcePrimaryKey {
    pub name: String,
    pub columns: Vec<String>,
}

impl From<&PrimaryKey> for DataSourcePrimaryKey {
    fn from(pk: &PrimaryKey) -> Self {
        Self {
            name: pk.name.clone(),
            columns: pk.columns.clone(),
        }
    }
}

/// Information about a foreign key
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct DataSourceForeignKey {
    pub name: String,
    pub from_columns: Vec<String>,
    pub to_table: String,
    pub to_columns: Vec<String>,
}

impl From<&ForeignKey> for DataSourceForeignKey {
    fn from(fk: &ForeignKey) -> Self {
        Self {
            name: fk.name.clone(),
            from_columns: fk.from_columns.clone(),
            to_table: fk.to_table.clone(),
            to_columns: fk.to_columns.clone(),
        }
    }
}

/// Information about a single table
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct DataSourceTableInfo {
    pub name: String,
    pub columns: HashMap<String, DataSourceColumnInfo>,
    pub primary_keys: Vec<DataSourcePrimaryKey>,
    pub foreign_keys: Vec<DataSourceForeignKey>,
}

impl From<&DataTableInfo> for DataSourceTableInfo {
    fn from(table: &DataTableInfo) -> Self {
        Self {
            name: table.name.clone(),
            columns: table
                .columns
                .iter()
                .map(|(k, v)| (k.clone(), DataSourceColumnInfo::from(v)))
                .collect(),
            primary_keys: table
                .primary_keys
                .iter()
                .map(DataSourcePrimaryKey::from)
                .collect(),
            foreign_keys: table
                .foreign_keys
                .iter()
                .map(DataSourceForeignKey::from)
                .collect(),
        }
    }
}

/// Response containing all metadata about a connected data source
#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
#[serde(rename_all = "camelCase")]
pub struct DataSourceMetadata {
    /// The name of the data source
    pub name: String,
    /// Schema information for all tables
    pub tables: HashMap<String, DataSourceTableInfo>,
    /// First few rows of each table (table name -> rows)
    pub preview_data: HashMap<String, Vec<HashMap<String, String>>>,
}

const PREVIEW_ROW_COUNT: usize = 50;

/// Connect to a data source and retrieve its metadata
pub async fn connect_and_get_metadata(
    request: ConnectDataSourceRequest,
) -> anyhow::Result<DataSourceMetadata> {
    let data_source = DataSource::new_any(request.name.clone(), request.connection_string).await?;

    // Convert table info
    let tables: HashMap<String, DataSourceTableInfo> = data_source
        .tables
        .iter()
        .map(|(name, info)| (name.clone(), DataSourceTableInfo::from(info)))
        .collect();

    // Get preview data for all tables
    let preview_data = data_source
        .get_first_rows_of_all_tables(PREVIEW_ROW_COUNT)
        .await?;

    Ok(DataSourceMetadata {
        name: request.name,
        tables,
        preview_data,
    })
}
