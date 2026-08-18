import type { BindingsTable, TableCell } from "@/bindings/generated";
import type { TableExportFormat } from "@/types/generated/TableExportFormat";

/**
 * `export_bindings_table` hands back typed cells and ignores `options.format`, so rendering the
 * situation table into a downloadable file happens here.
 *
 * The XLSX side reproduces what the deleted server-side `XLSXTableWriter` drew: a grey, bordered,
 * centred header row with the block-starting columns bold, medium rules between variable blocks,
 * green/red shading on the satisfied column, and integer / decimal / date number formats. The two
 * things position and value cannot tell us -- which header cells start a block, and which column is
 * the flag -- come from `BindingsTable`.
 */

/** Every typed variant carries the exact text the engine has always written for that value. */
function cellText(cell: TableCell): string {
	if (typeof cell === "string") return cell;
	if ("n" in cell) return cell.n;
	if ("d" in cell) return cell.d;
	return String(cell.b);
}

const MIME: Record<TableExportFormat, string> = {
	CSV: "text/csv",
	XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Quoting rules of the `csv` crate's defaults, which produced the previous server-side export. */
function csvCell(cell: string): string {
	return /["\r\n,]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

function toCsv(rows: string[][]): string {
	return rows.map((row) => `${row.map(csvCell).join(",")}\n`).join("");
}

/** Control characters other than tab/newline/carriage return have no XML representation. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: dropping them is the point.
const ILLEGAL_XML = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

function xmlText(cell: string): string {
	return cell
		.replace(ILLEGAL_XML, "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function columnRef(index: number): string {
	let ref = "";
	for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
		ref = String.fromCharCode(65 + (n % 26)) + ref;
	}
	return ref;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Excel counts days from 1899-12-30, which is 25569 days before the Unix epoch. */
const EXCEL_EPOCH_DAY = 25569;
const MS_PER_DAY = 86_400_000;

/**
 * Number formats, as `numFmtId`s. 0 is Excel's General; the custom ones start at 164, the first id
 * the spec leaves to a document.
 */
const NUM_FMT = { general: 0, integer: 164, decimal: 165, date: 166 } as const;

/** Fill indices in `styles.xml`. 0 and 1 are the two Excel demands come first, in that order. */
const FILL = { none: 0, gray125: 1, header: 2, satisfied: 3, violated: 4 } as const;

/**
 * Border indices. `blockLeft` is the rule between two variables' blocks; `attrLeft` the lighter one
 * between an attribute and the column before it. The header row carries a bottom rule as well.
 */
const BORDER = {
	none: 0,
	blockLeft: 1,
	attrLeft: 2,
	headerBlock: 3,
	headerAttr: 4,
} as const;

/** What a cell is, as far as styling cares. Derived from position plus the `TableCell` variant. */
type CellStyle = {
	numFmt: (typeof NUM_FMT)[keyof typeof NUM_FMT];
	fill: (typeof FILL)[keyof typeof FILL];
	border: (typeof BORDER)[keyof typeof BORDER];
	bold: boolean;
	centre: boolean;
};

const DEFAULT_STYLE: CellStyle = {
	numFmt: NUM_FMT.general,
	fill: FILL.none,
	border: BORDER.none,
	bold: false,
	centre: false,
};

function styleKey(s: CellStyle): string {
	return `${s.numFmt}|${s.fill}|${s.border}|${s.bold ? 1 : 0}|${s.centre ? 1 : 0}`;
}

/**
 * Collects the distinct styles a sheet uses and hands out their `cellXfs` indices.
 *
 * Built per export rather than enumerated up front: which combinations occur depends on the columns
 * and the value types in the data, and an unused `xf` is dead weight in the file.
 */
class StyleTable {
	private readonly index = new Map<string, number>();
	private readonly order: CellStyle[] = [];

	constructor() {
		// Index 0 must be the plain style: Excel treats it as the sheet default.
		this.idFor(DEFAULT_STYLE);
	}

	idFor(style: CellStyle): number {
		const key = styleKey(style);
		const existing = this.index.get(key);
		if (existing !== undefined) return existing;
		const id = this.order.length;
		this.index.set(key, id);
		this.order.push(style);
		return id;
	}

	xfsXml(): string {
		const xfs = this.order
			.map((s) => {
				const attrs = [
					`numFmtId="${s.numFmt}"`,
					`fontId="${s.bold ? 1 : 0}"`,
					`fillId="${s.fill}"`,
					`borderId="${s.border}"`,
					'xfId="0"',
					s.numFmt === NUM_FMT.general ? "" : 'applyNumberFormat="1"',
					s.fill === FILL.none ? "" : 'applyFill="1"',
					s.border === BORDER.none ? "" : 'applyBorder="1"',
					s.bold ? 'applyFont="1"' : "",
					s.centre ? 'applyAlignment="1"' : "",
				]
					.filter(Boolean)
					.join(" ");
				return s.centre ? `<xf ${attrs}><alignment horizontal="center"/></xf>` : `<xf ${attrs}/>`;
			})
			.join("");
		return `<cellXfs count="${this.order.length}">${xfs}</cellXfs>`;
	}
}

/** Integers and decimals are formatted differently, and only the text says which this is. */
function numberFormatOf(text: string): typeof NUM_FMT.integer | typeof NUM_FMT.decimal {
	return /[.eE]/.test(text) ? NUM_FMT.decimal : NUM_FMT.integer;
}

/**
 * The style for one cell.
 *
 * `column > 0` carries a left rule, exactly as the old writer did for every data cell after the
 * first; in the header the rule is heavy for a column that starts a block and light for an
 * attribute column continuing one.
 */
function styleOf(
	cell: TableCell,
	row: number,
	column: number,
	table: Pick<BindingsTable, "header_group_starts" | "violation_column">,
): CellStyle {
	const isHeader = row === 0 && table.header_group_starts.length > 0;
	if (isHeader) {
		// A header wider than the recorded roles cannot happen, but treat any overflow as a block
		// start rather than indexing past the end and losing the border entirely.
		const blockStart = table.header_group_starts[column] ?? true;
		return {
			numFmt: NUM_FMT.general,
			fill: FILL.header,
			border: blockStart ? BORDER.headerBlock : BORDER.headerAttr,
			bold: blockStart,
			centre: true,
		};
	}
	const border = column === 0 ? BORDER.none : BORDER.blockLeft;
	if (column === table.violation_column) {
		// The flag's own text, which the engine writes as `true` / `false`.
		const satisfied = cellText(cell) === "true";
		return {
			numFmt: NUM_FMT.general,
			fill: satisfied ? FILL.satisfied : FILL.violated,
			border,
			bold: false,
			centre: false,
		};
	}
	if (typeof cell !== "string") {
		if ("n" in cell && Number.isFinite(Number(cell.n))) {
			return { ...DEFAULT_STYLE, numFmt: numberFormatOf(cell.n), border };
		}
		if ("d" in cell && dateSerial(cell.d) !== undefined) {
			return { ...DEFAULT_STYLE, numFmt: NUM_FMT.date, border };
		}
	}
	return { ...DEFAULT_STYLE, border };
}

/** A serial in Excel's date system, or undefined for text no `Date` can read. */
function dateSerial(rfc3339: string): number | undefined {
	const ms = Date.parse(rfc3339);
	return Number.isNaN(ms) ? undefined : ms / MS_PER_DAY + EXCEL_EPOCH_DAY;
}

/**
 * A typed cell where the value allows one, an inline string otherwise.
 *
 * Numbers keep the engine's decimal text rather than a re-serialized JS number, so a large integer
 * lands in the sheet as written. Text that is not a finite number or a readable timestamp -- `inf`,
 * `NaN` -- has no numeric cell, so it falls through to the string form instead of being written as
 * a `<v>` Excel would reject.
 */
function cellXml(cell: TableCell, ref: string, style: number): string {
	const s = style === 0 ? "" : ` s="${style}"`;
	if (typeof cell !== "string") {
		if ("n" in cell && Number.isFinite(Number(cell.n))) {
			return `<c r="${ref}"${s} t="n"><v>${cell.n}</v></c>`;
		}
		if ("b" in cell) return `<c r="${ref}"${s} t="b"><v>${cell.b ? 1 : 0}</v></c>`;
		if ("d" in cell) {
			const serial = dateSerial(cell.d);
			if (serial !== undefined) {
				return `<c r="${ref}"${s} t="n"><v>${serial}</v></c>`;
			}
		}
	}
	return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(cellText(cell))}</t></is></c>`;
}

/**
 * Approximate the widths `rust_xlsxwriter`'s `autofit()` produced.
 *
 * Character count of the longest cell, capped: a single long attribute value used to widen a column
 * past the width of the window, and Excel's own limit is 255 anyway.
 */
function columnWidths(rows: TableCell[][]): number[] {
	const widths: number[] = [];
	for (const row of rows) {
		row.forEach((cell, c) => {
			const len = cellText(cell).length;
			if (len > (widths[c] ?? 0)) widths[c] = len;
		});
	}
	return widths.map((w) => Math.min(Math.max(w + 2, 8), 60));
}

/** The sheet, plus the `styles.xml` its `s=` indices refer to. The two are built together because
 *  the style table is discovered while walking the cells. */
function sheetXml(table: BindingsTable): { sheet: string; styles: string } {
	const { rows } = table;
	const styles = new StyleTable();
	const body = rows
		.map((row, r) => {
			const cells = row
				.map((cell, c) =>
					cellXml(cell, `${columnRef(c)}${r + 1}`, styles.idFor(styleOf(cell, r, c, table))),
				)
				.join("");
			return `<row r="${r + 1}">${cells}</row>`;
		})
		.join("");

	const widths = columnWidths(rows);
	const cols = widths.length
		? `<cols>${widths
				.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
				.join("")}</cols>`
		: "";
	// Only with a header row: an autofilter needs one to name the columns it filters, and Excel
	// treats the first data row as headers if it is given none.
	const lastColumn = Math.max(...rows.map((r) => r.length), 1) - 1;
	const filter =
		table.header_group_starts.length > 0 && rows.length > 1
			? `<autoFilter ref="A1:${columnRef(lastColumn)}${rows.length}"/>`
			: "";
	// `cols` must precede `sheetData`, and `autoFilter` must follow it.
	return {
		sheet: `${XML_HEAD}<worksheet xmlns="${SHEET_NS}">${cols}<sheetData>${body}</sheetData>${filter}</worksheet>`,
		styles: stylesXml(styles),
	};
}

/** A solid fill in `rrggbb`. */
function solidFill(rgb: string): string {
	return `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
}

function border(sides: { left?: string; bottom?: string }): string {
	const left = sides.left ? `<left style="${sides.left}"><color auto="1"/></left>` : "<left/>";
	const bottom = sides.bottom
		? `<bottom style="${sides.bottom}"><color auto="1"/></bottom>`
		: "<bottom/>";
	return `<border>${left}<right/><top/>${bottom}<diagonal/></border>`;
}

/**
 * The stylesheet backing a sheet's `s=` indices.
 *
 * Colours and rules are the ones the deleted `XLSXTableWriter` used, so a re-exported file looks the
 * way it always did: `#dbdbdb` headers, `#a2f99f` satisfied, `#f99f9f` violated. The `fills` list
 * must begin with `none` and `gray125` -- Excel refuses a stylesheet whose first two entries are
 * anything else -- and the order of these arrays is what `FILL` / `BORDER` / `NUM_FMT` index into.
 */
function stylesXml(styles: StyleTable): string {
	const numFmts = [
		`<numFmt numFmtId="${NUM_FMT.integer}" formatCode="#,##0"/>`,
		`<numFmt numFmtId="${NUM_FMT.decimal}" formatCode="#,##0.00"/>`,
		`<numFmt numFmtId="${NUM_FMT.date}" formatCode="dd/mm/yyyy hh:mm"/>`,
	];
	const fills = [
		'<fill><patternFill patternType="none"/></fill>',
		'<fill><patternFill patternType="gray125"/></fill>',
		solidFill("dbdbdb"),
		solidFill("a2f99f"),
		solidFill("f99f9f"),
	];
	const borders = [
		border({}),
		border({ left: "medium" }),
		border({ left: "mediumDashDot" }),
		border({ left: "medium", bottom: "medium" }),
		border({ left: "mediumDashDot", bottom: "medium" }),
	];
	return (
		`${XML_HEAD}<styleSheet xmlns="${SHEET_NS}">` +
		`<numFmts count="${numFmts.length}">${numFmts.join("")}</numFmts>` +
		'<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
		'<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
		`<fills count="${fills.length}">${fills.join("")}</fills>` +
		`<borders count="${borders.length}">${borders.join("")}</borders>` +
		'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
		styles.xfsXml() +
		"</styleSheet>"
	);
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** A zip with every entry stored uncompressed, which needs no deflate implementation. */
function storedZip(entries: { name: Uint8Array; data: Uint8Array }[]): Uint8Array {
	const size = entries.reduce((n, e) => n + 76 + 2 * e.name.length + e.data.length, 22);
	const out = new Uint8Array(size);
	const view = new DataView(out.buffer);
	let at = 0;
	const u16 = (v: number) => {
		view.setUint16(at, v, true);
		at += 2;
	};
	const u32 = (v: number) => {
		view.setUint32(at, v, true);
		at += 4;
	};
	const raw = (b: Uint8Array) => {
		out.set(b, at);
		at += b.length;
	};

	const offsets: number[] = [];
	const crcs: number[] = [];
	for (const entry of entries) {
		offsets.push(at);
		crcs.push(crc32(entry.data));
		u32(0x04034b50);
		u16(20);
		u16(0);
		u16(0);
		u16(0);
		u16(0);
		u32(crcs[crcs.length - 1]);
		u32(entry.data.length);
		u32(entry.data.length);
		u16(entry.name.length);
		u16(0);
		raw(entry.name);
		raw(entry.data);
	}

	const directoryStart = at;
	entries.forEach((entry, i) => {
		u32(0x02014b50);
		u16(20);
		u16(20);
		u16(0);
		u16(0);
		u16(0);
		u16(0);
		u32(crcs[i]);
		u32(entry.data.length);
		u32(entry.data.length);
		u16(entry.name.length);
		u16(0);
		u16(0);
		u16(0);
		u16(0);
		u32(0);
		u32(offsets[i]);
		raw(entry.name);
	});

	const directorySize = at - directoryStart;
	u32(0x06054b50);
	u16(0);
	u16(0);
	u16(entries.length);
	u16(entries.length);
	u32(directorySize);
	u32(directoryStart);
	u16(0);
	return out;
}

function toXlsx(table: BindingsTable): Uint8Array {
	const encoder = new TextEncoder();
	const { sheet, styles } = sheetXml(table);
	const parts: [string, string][] = [
		[
			"[Content_Types].xml",
			`${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
		],
		[
			"_rels/.rels",
			`${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		],
		[
			"xl/workbook.xml",
			`${XML_HEAD}<workbook xmlns="${SHEET_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="Situations" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		],
		[
			"xl/_rels/workbook.xml.rels",
			`${XML_HEAD}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
		],
		["xl/styles.xml", styles],
		["xl/worksheets/sheet1.xml", sheet],
	];
	return storedZip(
		parts.map(([name, xml]) => ({ name: encoder.encode(name), data: encoder.encode(xml) })),
	);
}

/** Render a bindings table as the file the chosen format asks for.
 *
 *  CSV takes only the values -- it has nowhere to put a style -- so it is byte-identical to what the
 *  server-side `csv` writer produced. XLSX needs the whole table, since the header roles and the
 *  violation column decide the formatting. */
export function bindingsTableToBlob(table: BindingsTable, format: TableExportFormat): Blob {
	const body: BlobPart =
		format === "XLSX"
			? (toXlsx(table) as BlobPart)
			: toCsv(table.rows.map((row) => row.map(cellText)));
	return new Blob([body], { type: MIME[format] });
}
