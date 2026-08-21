use std::{borrow::Cow, collections::HashSet};

use anyhow::{Error, Ok};
use itertools::Itertools;
use process_mining::core::event_data::object_centric::{
    linked_ocel::{LinkedOCELAccess, SlimLinkedOCEL},
    OCELAttributeType, OCELAttributeValue,
};
use rust_xlsxwriter::{
    ColNum, Format, FormatAlign, FormatBorder, IntoExcelData, RowNum, Workbook, Worksheet,
};
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
    }
    w.save()?;
    Ok(())
}

/// Plain-text CSV, one field per cell; cell roles (`CellType`) carry no formatting here.
struct CSVTableWriter<'a, W: std::io::Write> {
    writer: csv::Writer<&'a mut W>,
}

impl<'a, W: std::io::Write> TableWriter<'a, W> for CSVTableWriter<'a, W> {
    fn new(writer: &'a mut W) -> Self {
        CSVTableWriter {
            writer: csv::WriterBuilder::new().from_writer(writer),
        }
    }

    fn write_cell<'b>(&mut self, s: impl Into<CellContent<'b>>, _: CellType) -> Result<(), Error> {
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

/// A single-worksheet XLSX workbook: bordered/shaded headers, per-[`OCELAttributeType`] number
/// formats, and green/red shading on the satisfied column.
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

    fn write_cell<'b>(&mut self, s: impl Into<CellContent<'b>>, t: CellType) -> Result<(), Error> {
        let format: Format = match t {
            CellType::HEADER(block_start) => {
                let f = Format::new()
                    .set_background_color("#dbdbdb")
                    .set_border_bottom(FormatBorder::Medium)
                    .set_align(FormatAlign::Center);
                if block_start {
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
                        OCELAttributeType::Time => {
                            Format::new().set_num_format("dd/mm/yyyy HH:mm")
                        }
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

        // Track the largest written position, so `save` can size the autofilter to exactly what
        // was written rather than guessing at a fixed range.
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

pub fn export_bindings_to_csv_writer<'a, W: std::io::Write>(
    ocel: &'a SlimLinkedOCEL,
    bindings: &EvaluationResultWithCount,
    w: &mut W,
    options: &'a TableExportOptions,
) -> Result<(), Error> {
    let csv_writer = CSVTableWriter::new(w);
    export_bindings_to_table_writer(ocel, bindings, csv_writer, options)
}

pub fn export_bindings_to_xlsx_writer<'a, W: std::io::Write + std::io::Seek + std::marker::Send>(
    ocel: &'a SlimLinkedOCEL,
    bindings: &EvaluationResultWithCount,
    w: &mut W,
    options: &'a TableExportOptions,
) -> Result<(), Error> {
    let xlsx_writer = XLSXTableWriter::new(w);
    export_bindings_to_table_writer(ocel, bindings, xlsx_writer, options)
}

/// Writes `bindings` in `options.format`. `w` requires `Seek` because XLSX seeks back while
/// writing, even though CSV never uses it.
pub fn export_bindings_to_writer<'a, W: std::io::Write + std::io::Seek + std::marker::Send>(
    ocel: &'a SlimLinkedOCEL,
    bindings: &EvaluationResultWithCount,
    w: &mut W,
    options: &'a TableExportOptions,
) -> Result<(), Error> {
    match options.format {
        TableExportFormat::CSV => export_bindings_to_csv_writer(ocel, bindings, w, options),
        TableExportFormat::XLSX => export_bindings_to_xlsx_writer(ocel, bindings, w, options),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{HashMap, HashSet},
        io::Cursor,
    };

    use process_mining::core::event_data::object_centric::OCEL;

    use super::*;
    use crate::binding_box::{
        evaluate_box_tree,
        structs::{BindingBoxTreeNode, Filter},
        BindingBox, BindingBoxTree, EventVariable, ObjectVariable,
    };

    /// One order/event pair covering every `CellType::ValueType` arm. Built via real evaluation
    /// rather than a hand-built `Binding`, whose indices are only valid against the OCEL they
    /// were resolved against.
    const OCEL_JSON: &str = r#"{
        "objectTypes": [{ "name": "order", "attributes": [
            { "name": "total", "type": "float" },
            { "name": "rush", "type": "boolean" },
            { "name": "due", "type": "time" }
        ] }],
        "eventTypes": [
            { "name": "place", "attributes": [{ "name": "amount", "type": "integer" }] }
        ],
        "objects": [
            { "id": "o1", "type": "order", "relationships": [], "attributes": [
                { "name": "total", "value": 12.5, "time": "1970-01-01T00:00:00Z" },
                { "name": "rush", "value": true, "time": "1970-01-01T00:00:00Z" },
                { "name": "due", "value": "2024-03-04T05:06:07Z", "time": "1970-01-01T00:00:00Z" }
            ] }
        ],
        "events": [
            { "id": "e1", "type": "place", "time": "2024-01-01T00:00:00Z",
              "attributes": [{ "name": "amount", "value": 100 }],
              "relationships": [{ "objectId": "o1", "qualifier": "order" }] }
        ]
    }"#;

    fn fixture() -> (SlimLinkedOCEL, EvaluationResultWithCount) {
        let ocel: OCEL = serde_json::from_str(OCEL_JSON).expect("fixture OCEL parses");
        let ocel = SlimLinkedOCEL::from_ocel(ocel);

        let node = BindingBoxTreeNode::Box(
            BindingBox {
                new_object_vars: HashMap::from([(
                    ObjectVariable(0),
                    HashSet::from(["order".to_string()]),
                )]),
                new_event_vars: HashMap::from([(
                    EventVariable(0),
                    HashSet::from(["place".to_string()]),
                )]),
                filters: vec![Filter::O2E {
                    object: ObjectVariable(0),
                    event: EventVariable(0),
                    qualifier: None,
                    filter_label: None,
                }],
                ..Default::default()
            },
            Vec::new(),
        );
        let tree = BindingBoxTree {
            nodes: vec![node],
            edge_names: HashMap::new(),
        };
        let mut res = evaluate_box_tree(tree, &ocel, false).expect("evaluation succeeds");
        (ocel, res.evaluation_results.remove(0))
    }

    #[test]
    fn csv_writer_produces_a_header_and_a_data_row() {
        let (ocel, bindings) = fixture();
        let mut buf = Vec::new();
        export_bindings_to_csv_writer(&ocel, &bindings, &mut buf, &TableExportOptions::default())
            .unwrap();
        let text = String::from_utf8(buf).unwrap();
        let mut lines = text.lines();
        let header = lines.next().unwrap();
        assert!(header.contains("o1"), "header: {header}");
        assert!(header.contains("Satisfied"), "header: {header}");
        let row = lines.next().unwrap();
        assert!(row.contains("o1"), "row: {row}");
        assert!(row.contains("true"), "row (no constraints -> satisfied): {row}");
    }

    #[test]
    fn xlsx_writer_builds_a_non_empty_workbook() {
        let (ocel, bindings) = fixture();
        let mut cursor = Cursor::new(Vec::new());
        export_bindings_to_xlsx_writer(
            &ocel,
            &bindings,
            &mut cursor,
            &TableExportOptions::default(),
        )
        .unwrap();
        let bytes = cursor.into_inner();
        // An XLSX file is a zip archive; "PK" is the local-file-header signature.
        assert!(bytes.len() > 100, "workbook should not be trivially empty");
        assert_eq!(&bytes[0..2], b"PK", "workbook should be a zip archive");
    }
}

