use std::{borrow::Cow, collections::HashSet};

use anyhow::{Error, Ok};
use itertools::Itertools;
use process_mining::ocel::{
    linked_ocel::IndexLinkedOCEL,
    ocel_struct::{OCELAttributeType, OCELAttributeValue},
};
use rust_xlsxwriter::{
    ColNum, Format, FormatAlign, FormatBorder, IntoExcelData, RowNum, Workbook, Worksheet,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::binding_box::EvaluationResultWithCount;

// #[test]
// fn test(){

//     let mut workbook = Workbook::new();
//     workbook.save_to_writer(writer)
// }
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
                s => {
                    IntoExcelData::write_with_format(format!("{s}"), worksheet, row, col, format)
                }
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
            CellContent::Value(v) => {
                match v {
                    // OCELAttributeValue::Time(date_time) => todo!(),
                    // OCELAttributeValue::Integer(_) => todo!(),
                    // OCELAttributeValue::Float(_) => todo!(),
                    // OCELAttributeValue::Boolean(_) => todo!(),
                    // OCELAttributeValue::String(_) => todo!(),
                    // OCELAttributeValue::Null => todo!(),
                    v => format!("{v}").into_bytes(),
                }
            }
        }
    }
}

pub trait TableWriter<'a, W: std::io::Write> {
    fn new(w: &'a mut W) -> Self;
    fn write_cell(&mut self, s: impl Into<CellContent<'a>>, t: CellType) -> Result<(), Error>;
    fn new_row(&mut self) -> Result<(), Error>;
    fn save(self) -> Result<(), Error>;
}

struct CSVTableWriter<'a, W: std::io::Write> {
    writer: csv::Writer<&'a mut W>,
}

impl<'a, W: std::io::Write> TableWriter<'a, W> for CSVTableWriter<'a, W> {
    fn new(writer: &'a mut W) -> Self {
        CSVTableWriter {
            writer: csv::WriterBuilder::new().from_writer(writer),
        }
    }

    fn write_cell(&mut self, s: impl Into<CellContent<'a>>, _: CellType) -> Result<(), Error> {
        self.writer.write_field(Into::<Vec<u8>>::into(&s.into()))?;
        Ok(())
    }

    fn new_row(&mut self) -> Result<(), Error> {
        self.writer.write_record(None::<&[u8]>)?;
        Ok(())
    }

    fn save(mut self) -> Result<(), Error> {
        self.writer.flush()?;
        Ok(())
    }
}

struct XLSXTableWriter<'a, W: std::io::Write + std::io::Seek + std::marker::Send> {
    writer: &'a mut W,
    worksheet: Worksheet,
    column: ColNum,
    row: RowNum,
    max_columns: ColNum,
    max_rows: RowNum,
}

impl<'a, W: std::io::Write + std::io::Seek + std::marker::Send> TableWriter<'a, W>
    for XLSXTableWriter<'a, W>
{
    fn new(writer: &'a mut W) -> Self {
        XLSXTableWriter {
            writer,
            worksheet: Worksheet::new(),
            column: 0,
            row: 0,
            max_columns: 0,
            max_rows: 0,
        }
    }

    fn write_cell(&mut self, s: impl Into<CellContent<'a>>, t: CellType) -> Result<(), Error> {
        let format: Format = match t {
            CellType::HEADER(b) => {
                let f = Format::new()
                    // .set_bold()
                    .set_background_color("#dbdbdb")
                    .set_border_bottom(FormatBorder::Medium)
                    .set_align(FormatAlign::Center);
                if b {
                    f.set_bold().set_border_left(FormatBorder::Medium)
                } else {
                    f.set_border_left(FormatBorder::MediumDashDot)
                }
            }
            t => {
                let f = match t {
                    CellType::HEADER(_) => Format::new(),
                    CellType::DEFAULT => Format::new(),
                    CellType::ViolationStatus(satisfied) => Format::new()
                        .set_background_color(if satisfied { "#a2f99f" } else { "#f99f9f" }),
                    CellType::ValueType(t) => match t {
                        OCELAttributeType::Integer => Format::new().set_num_format("#,##0"),
                        OCELAttributeType::Float => Format::new().set_num_format("#,##0.00"),
                        OCELAttributeType::Boolean => Format::new(),
                        OCELAttributeType::Time => Format::new().set_num_format("dd/mm/yyyy HH:mm"),
                        OCELAttributeType::String => Format::new(),
                        OCELAttributeType::Null => Format::new(),
                    },
                };
                if self.column > 0 {
                    f.set_border_left(FormatBorder::Medium)
                } else {
                    f
                }
            }
        };
        self.worksheet
            .write_with_format(self.row, self.column, s.into(), &format)?;

        // Save maximum position of written content
        self.max_columns = self.column;
        self.max_rows = self.row;

        self.column += 1;
        Ok(())
    }

    fn new_row(&mut self) -> Result<(), Error> {
        self.row += 1;
        self.column = 0;
        Ok(())
    }

    fn save(mut self) -> Result<(), Error> {
        self.worksheet.autofit();
        self.worksheet
            .autofilter(0, 0, self.max_rows, self.max_columns)?;
        let mut workbook = Workbook::new();
        workbook.push_worksheet(self.worksheet);
        workbook.save_to_writer(self.writer)?;
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
pub struct TableExportOptions {
    pub include_violation_status: bool,
    pub include_ids: bool,
    pub omit_header: bool,
    pub labels: Vec<String>,
    pub format: TableExportFormat,
}
#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../frontend/src/types/generated/")]
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
    ocel: &'a IndexLinkedOCEL,
    bindings: &EvaluationResultWithCount,
    mut w: impl TableWriter<'a, W>,
    options: &'a TableExportOptions,
) -> Result<(), Error> {
    if let Some((b, _)) = bindings.situations.first() {
        let ev_vars = b.event_map.keys().sorted().collect_vec();
        let ob_vars = b.object_map.keys().sorted().collect_vec();

        let ev_attrs = ev_vars
            .iter()
            .map(|ev_var| {
                bindings
                    .situations
                    .iter()
                    .flat_map(|(b, _)| {
                        b.get_ev(ev_var, ocel)
                            .iter()
                            .flat_map(|e| e.attributes.iter().map(|a| &a.name))
                            .collect::<Vec<_>>()
                    })
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
                        b.get_ob(ob_var, ocel)
                            .iter()
                            .flat_map(|e| e.attributes.iter().map(|a| &a.name))
                            .collect::<Vec<_>>()
                    })
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
                            .filter(|a| &&a.name == attr)
                            .sorted_by_key(|a| a.time)
                            .next()
                        {
                            w.write_cell(
                                CellContent::Value(&val.value),
                                CellType::ValueType((&val.value).into()),
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
                        if let Some(val) = ev.attributes.iter().find(|a| &&a.name == attr) {
                            w.write_cell(
                                CellContent::Value(&val.value),
                                CellType::ValueType((&val.value).into()),
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
                match b.label_map.get(label) {
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

pub fn export_bindings_to_csv_writer<'a, W: std::io::Write>(
    ocel: &'a IndexLinkedOCEL,
    bindings: &EvaluationResultWithCount,
    w: &mut W,
    options: &'a TableExportOptions,
) -> Result<(), Error> {
    let csv_writer = CSVTableWriter::new(w);
    export_bindings_to_table_writer(ocel, bindings, csv_writer, options)
}

pub fn export_bindings_to_xlsx_writer<'a, W: std::io::Write + std::io::Seek + std::marker::Send>(
    ocel: &'a IndexLinkedOCEL,
    bindings: &EvaluationResultWithCount,
    w: &mut W,
    options: &'a TableExportOptions,
) -> Result<(), Error> {
    let xlsx_writer = XLSXTableWriter::new(w);
    export_bindings_to_table_writer(ocel, bindings, xlsx_writer, options)
}

pub fn export_bindings_to_writer<'a, W: std::io::Write + std::io::Seek + std::marker::Send>(
    ocel: &'a IndexLinkedOCEL,
    bindings: &EvaluationResultWithCount,
    w: &mut W,
    options: &'a TableExportOptions,
) -> Result<(), Error> {
    match options.format {
        TableExportFormat::CSV => export_bindings_to_csv_writer(ocel, bindings, w, options),
        TableExportFormat::XLSX => export_bindings_to_xlsx_writer(ocel, bindings, w, options),
    }
}
