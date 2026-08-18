use std::{borrow::Cow, collections::HashSet};

use anyhow::{Error, Ok};
use itertools::Itertools;
use process_mining::core::event_data::object_centric::{
    linked_ocel::{LinkedOCELAccess, SlimLinkedOCEL},
    OCELAttributeType, OCELAttributeValue,
};
use rust_xlsxwriter::{ColNum, Format, IntoExcelData, RowNum, Worksheet};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::binding_box::EvaluationResultWithCount;

pub enum CellContent<'a> {
    String(Cow<'a, str>),
    Value(&'a OCELAttributeValue),
}

impl IntoExcelData for CellContent<'_> {
    fn write(
        self,
        worksheet: &mut Worksheet,
        row: RowNum,
        col: ColNum,
    ) -> Result<&mut Worksheet, rust_xlsxwriter::XlsxError> {
        match self {
            CellContent::String(cow) => IntoExcelData::write(cow, worksheet, row, col),
            CellContent::Value(val) => match val {
                OCELAttributeValue::Integer(i) => IntoExcelData::write(*i, worksheet, row, col),
                OCELAttributeValue::Float(f) => IntoExcelData::write(*f, worksheet, row, col),
                OCELAttributeValue::Boolean(b) => IntoExcelData::write(*b, worksheet, row, col),
                OCELAttributeValue::Time(date_time) => {
                    IntoExcelData::write(&date_time.naive_utc(), worksheet, row, col)
                }
                s => IntoExcelData::write(format!("{s}"), worksheet, row, col),
            },
        }
    }

    fn write_with_format<'a>(
        self,
        worksheet: &'a mut Worksheet,
        row: RowNum,
        col: ColNum,
        format: &Format,
    ) -> Result<&'a mut Worksheet, rust_xlsxwriter::XlsxError> {
        match self {
            CellContent::String(cow) => {
                IntoExcelData::write_with_format(cow, worksheet, row, col, format)
            }
            CellContent::Value(val) => match val {
                OCELAttributeValue::Integer(i) => {
                    IntoExcelData::write_with_format(*i, worksheet, row, col, format)
                }
                OCELAttributeValue::Float(f) => {
                    IntoExcelData::write_with_format(*f, worksheet, row, col, format)
                }
                OCELAttributeValue::Boolean(b) => {
                    IntoExcelData::write_with_format(*b, worksheet, row, col, format)
                }
                OCELAttributeValue::Time(date_time) => IntoExcelData::write_with_format(
                    &date_time.naive_utc(),
                    worksheet,
                    row,
                    col,
                    format,
                ),
                s => IntoExcelData::write_with_format(format!("{s}"), worksheet, row, col, format),
            },
        }
    }
}

pub enum CellType {
    DEFAULT,
    HEADER(bool),
    ValueType(OCELAttributeType),
    ViolationStatus(bool),
}

impl<'a, T> From<T> for CellContent<'a>
where
    T: Into<Cow<'a, str>>,
{
    fn from(value: T) -> Self {
        Self::String(value.into())
    }
}

// impl<'a> From<&'a String> for CellContent<'a> {
//     fn from(value: &'a String) -> Self {
//         Self::String(value.into())
//     }
// }
// impl<'a> From<String> for CellContent<'a> {
//     fn from(value: String) -> Self {
//         Self::String(value.into())
//     }
// }

impl From<&CellContent<'_>> for Vec<u8> {
    fn from(val: &CellContent<'_>) -> Self {
        match val {
            CellContent::String(s) => s.as_bytes().to_vec(),
            CellContent::Value(v) => format!("{v}").into_bytes(),
        }
    }
}

pub trait TableWriter<'a, W: std::io::Write> {
    fn new(w: &'a mut W) -> Self;
    fn write_cell<'b>(&mut self, s: impl Into<CellContent<'b>>, t: CellType) -> Result<(), Error>;
    fn new_row(&mut self) -> Result<(), Error>;
    fn save(self) -> Result<(), Error>;
}


#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
#[ts(export)]
pub struct TableExportOptions {
    pub include_violation_status: bool,
    pub include_ids: bool,
    pub omit_header: bool,
    pub labels: Vec<String>,
    pub format: TableExportFormat,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema, TS)]
#[ts(export)]
pub enum TableExportFormat {
    CSV,
    XLSX,
}

impl Default for TableExportOptions {
    fn default() -> Self {
        Self {
            include_violation_status: true,
            include_ids: true,
            omit_header: false,
            labels: Vec::default(),
            format: TableExportFormat::CSV,
        }
    }
}

pub fn export_bindings_to_table_writer<'a, W: std::io::Write>(
    ocel: &'a SlimLinkedOCEL,
    bindings: &EvaluationResultWithCount,
    mut w: impl TableWriter<'a, W> + 'a,
    options: &'a TableExportOptions,
) -> Result<(), Error> {
    if let Some((b, _)) = bindings.situations.first() {
        let ev_vars = b.get_all_ev_vars().sorted().collect_vec();
        let ob_vars = b.get_all_ob_vars().sorted().collect_vec();

        let ev_attrs = ev_vars
            .iter()
            .map(|ev_var| {
                bindings
                    .situations
                    .iter()
                    .flat_map(|(b, _)| {
                        let ev = b.get_ev_index(ev_var)?;
                        Some(ocel.get_ev_attrs(ev))
                    })
                    .flatten()
                    .collect::<HashSet<_>>()
                    .into_iter()
                    .collect_vec()
            })
            .collect_vec();

        let ob_attrs = ob_vars
            .iter()
            .map(|ob_var| {
                bindings
                    .situations
                    .iter()
                    .flat_map(|(b, _)| {
                        let ob = b.get_ob_index(ob_var)?;
                        Some(ocel.get_ob_attrs(ob))
                    })
                    .flatten()
                    .collect::<HashSet<_>>()
                    .into_iter()
                    .collect_vec()
            })
            .collect_vec();
        // Write Headers
        if !options.omit_header {
            // First object/event ID, then attributes, then next object/event ID, ..
            for (ob, ob_attrs) in ob_vars.iter().zip(&ob_attrs) {
                if options.include_ids {
                    w.write_cell(format!("o{}", ob.0 + 1), CellType::HEADER(true))?;
                }
                for attr in ob_attrs {
                    w.write_cell(format!("o{}.{}", ob.0 + 1, attr), CellType::HEADER(false))?;
                }
            }
            for (ev, ev_attrs) in ev_vars.iter().zip(&ev_attrs) {
                if options.include_ids {
                    w.write_cell(format!("e{}", ev.0 + 1), CellType::HEADER(true))?;
                }
                for attr in ev_attrs {
                    w.write_cell(format!("e{}.{}", ev.0 + 1, attr), CellType::HEADER(false))?;
                }
            }

            for label in &options.labels {
                w.write_cell(label, CellType::HEADER(true))?;
            }

            if options.include_violation_status {
                w.write_cell("Satisfied", CellType::HEADER(true))?;
            }
            w.new_row()?;
        }

        for (b, v) in &bindings.situations {
            for (ob_v, ob_attrs) in ob_vars.iter().zip(&ob_attrs) {
                if let Some(ob) = b.get_ob(ob_v, ocel) {
                    if options.include_ids {
                        w.write_cell(&ob.id, CellType::DEFAULT)?;
                    }
                    for attr in ob_attrs {
                        if let Some(val) = ob
                            .attributes
                            .iter()
                            .filter(|a| &a.name == attr)
                            .sorted_by_key(|a| a.time)
                            .next()
                        {
                            w.write_cell(
                                CellContent::Value(&val.value),
                                CellType::ValueType(val.value.get_type()),
                            )?;
                        } else {
                            w.write_cell("", CellType::DEFAULT)?;
                        }
                    }
                } else {
                    if options.include_ids {
                        w.write_cell("", CellType::DEFAULT)?;
                    }
                    for _attr in ob_attrs {
                        w.write_cell("", CellType::DEFAULT)?;
                    }
                }
            }
            for (ev_v, ev_attrs) in ev_vars.iter().zip(&ev_attrs) {
                if let Some(ev) = b.get_ev(ev_v, ocel) {
                    if options.include_ids {
                        w.write_cell(&ev.id, CellType::DEFAULT)?;
                    }
                    for attr in ev_attrs {
                        if let Some(val) = ev.attributes.iter().find(|a| &a.name == attr) {
                            w.write_cell(
                                CellContent::Value(&val.value),
                                CellType::ValueType(val.value.get_type()),
                            )?;
                        } else {
                            w.write_cell("", CellType::DEFAULT)?;
                        }
                    }
                } else {
                    if options.include_ids {
                        w.write_cell("", CellType::DEFAULT)?;
                    }
                    for _attr in ev_attrs {
                        w.write_cell("", CellType::DEFAULT)?;
                    }
                }
            }

            for label in &options.labels {
                match b.get_label_value(label) {
                    // TODO: Also represent label values with correct types
                    Some(val) => w.write_cell(val.to_string(), CellType::DEFAULT)?,
                    None => w.write_cell("null", CellType::DEFAULT)?,
                }
            }

            if options.include_violation_status {
                w.write_cell(
                    format!("{}", v.is_none()),
                    CellType::ViolationStatus(v.is_none()),
                )?;
            }
            w.new_row()?;
        }
        // w.write_record(ob_vars.iter().map(|ob| vec![format!("o{}", ob.0)].into).chain(
        //    ,
        // ).chain(ev_vars.iter().map(|ob| format!("o{}", ob.0)).chain(
        //     ev_vars.iter().zip(ev_attrs).flat_map(|(ob, attrs)| {
        //         attrs.into_iter().map(|attr| format!("o{}.{}", ob.0, attr))
        //     }),
        // )))?;
    }
    w.save()?;
    Ok(())
}

