import { describe, expect, it } from "vitest";
import type { BindingsTable, TableCell } from "@/bindings/generated";
import { bindingsTableToBlob } from "./table-file";

/** Bitwise, so a broken CRC table in the writer cannot agree with a broken one here. */
function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of bytes) {
		c ^= byte;
		for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	}
	return (c ^ 0xffffffff) >>> 0;
}

/**
 * Read the archive the way a zip reader does -- end record, central directory, then each local
 * header -- rather than at the offsets the writer used, so a wrong length or offset shows up as a
 * failure instead of cancelling out.
 */
function unzip(bytes: Uint8Array): Map<string, string> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const decoder = new TextDecoder();
	let end = bytes.length - 22;
	for (; end >= 0; end--) if (view.getUint32(end, true) === 0x06054b50) break;
	expect(end, "no end-of-central-directory record").toBeGreaterThanOrEqual(0);

	const count = view.getUint16(end + 10, true);
	let at = view.getUint32(end + 16, true);
	const entries = new Map<string, string>();
	for (let i = 0; i < count; i++) {
		expect(view.getUint32(at, true), "central directory entry signature").toBe(0x02014b50);
		const crc = view.getUint32(at + 16, true);
		const size = view.getUint32(at + 24, true);
		const nameLength = view.getUint16(at + 28, true);
		const local = view.getUint32(at + 42, true);
		const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
		at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);

		expect(view.getUint32(local, true), `local header of ${name}`).toBe(0x04034b50);
		expect(view.getUint16(local + 8, true), `${name} is stored, not deflated`).toBe(0);
		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
		const data = bytes.subarray(start, start + size);
		expect(crc32(data), `crc of ${name}`).toBe(crc);
		entries.set(name, decoder.decode(data));
	}
	expect(at, "central directory ends where the end record starts").toBe(end);
	return entries;
}

/** `<c ...>` elements of the sheet, keyed by cell reference. */
function cells(sheet: string): Map<string, string> {
	return new Map([...sheet.matchAll(/<c r="([A-Z]+\d+)"[\s\S]*?<\/c>/g)].map((m) => [m[1], m[0]]));
}

/**
 * Every `<tag .../>` or `<tag ...>...</tag>` in `xml`, in document order.
 *
 * The self-closing form is a whole alternative rather than a suffix on a shared attribute run:
 * `<tag\\s[^>]*(?:/>|>...)` looks equivalent but is not, because the greedy `[^>]*` consumes the
 * trailing `/` and then matches the second branch at the `>` -- swallowing the following element
 * into the same match instead of backtracking.
 */
function elements(xml: string, tag: string): string[] {
	const re = new RegExp(`<${tag}\\b[^>]*/>|<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "g");
	return [...xml.matchAll(re)].map((m) => m[0]);
}

/** Top-level children of a `<fills>` / `<borders>` / `<fonts>` block, in index order. */
function list(xml: string, tag: string): string[] {
	const block = xml.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`))?.[0] ?? "";
	const inner = block
		.replace(new RegExp(`^<${tag}[^>]*>`), "")
		.replace(new RegExp(`</${tag}>$`), "");
	return elements(inner, tag.replace(/s$/, ""));
}

/**
 * Resolve what a cell actually looks like, by following its `s=` index into the stylesheet the way
 * Excel does. Asserting on the index itself would pass for a file whose stylesheet says something
 * else entirely, which is exactly the bug this export had.
 */
function formatOf(parts: Map<string, string>, ref: string) {
	const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
	const styles = parts.get("xl/styles.xml") ?? "";
	const cell = cells(sheet).get(ref) ?? "";
	const index = Number(cell.match(/ s="(\d+)"/)?.[1] ?? 0);
	// `cellXfs` holds `<xf>` children, so it does not follow the plural/singular rule `list` uses.
	const cellXfs = styles.match(/<cellXfs[^>]*>[\s\S]*?<\/cellXfs>/)?.[0] ?? "";
	const xf = elements(cellXfs, "xf")[index] ?? "";
	const idOf = (attr: string) => Number(xf.match(new RegExp(`${attr}="(\\d+)"`))?.[1] ?? 0);
	const numFmtId = idOf("numFmtId");
	return {
		cell,
		numberFormat:
			styles.match(new RegExp(`<numFmt numFmtId="${numFmtId}" formatCode="([^"]*)"/>`))?.[1] ?? "",
		fill: list(styles, "fills")[idOf("fillId")] ?? "",
		border: list(styles, "borders")[idOf("borderId")] ?? "",
		font: list(styles, "fonts")[idOf("fontId")] ?? "",
		centred: /horizontal="center"/.test(xf),
	};
}

const ROWS: TableCell[][] = [
	["o1", "o1.total", "o1.rush", "o1.due", "o1.region", "Satisfied"],
	["o1", { n: "12.5" }, { b: true }, { d: "2024-03-04T05:06:07+00:00" }, "eu", "true"],
	["o2", { n: "inf" }, { b: false }, { d: "whenever" }, 'a,b"c', "false"],
];

/** `o1` starts a variable's block, its attributes continue it, `Satisfied` starts one of its own. */
const TABLE: BindingsTable = {
	rows: ROWS,
	header_group_starts: [true, false, false, false, false, true],
	violation_column: 5,
};

async function xlsx(table: BindingsTable = TABLE): Promise<Map<string, string>> {
	const blob = bindingsTableToBlob(table, "XLSX");
	return unzip(new Uint8Array(await blob.arrayBuffer()));
}

describe("bindingsTableToBlob, XLSX", () => {
	it("writes a package that unzips into the parts a workbook needs", async () => {
		const parts = await xlsx();
		expect([...parts.keys()].sort()).toEqual([
			"[Content_Types].xml",
			"_rels/.rels",
			"xl/_rels/workbook.xml.rels",
			"xl/styles.xml",
			"xl/workbook.xml",
			"xl/worksheets/sheet1.xml",
		]);
		expect(parts.get("[Content_Types].xml")).toContain("/xl/styles.xml");
		expect(parts.get("xl/_rels/workbook.xml.rels")).toContain('Target="styles.xml"');
	});

	it("gives every cell the type of the value behind it", async () => {
		const sheet = cells((await xlsx()).get("xl/worksheets/sheet1.xml") ?? "");

		expect(sheet.get("A1")).toContain('t="inlineStr"');
		expect(sheet.get("A1")).toContain('<t xml:space="preserve">o1</t>');
		expect(sheet.get("B2")).toContain('t="n"');
		expect(sheet.get("B2")).toContain("<v>12.5</v>");
		expect(sheet.get("C2")).toContain('t="b"');
		expect(sheet.get("C2")).toContain("<v>1</v>");
		expect(sheet.get("C3")).toContain("<v>0</v>");
		expect(sheet.get("E2")).toContain('t="inlineStr"');
		// Escaped, not dropped: the quote and comma only matter to CSV.
		expect(sheet.get("E3")).toContain('a,b"c');
	});

	it("writes a timestamp as an Excel serial carrying the date format", async () => {
		const parts = await xlsx();
		const { cell, numberFormat } = formatOf(parts, "D2");
		expect(cell).toMatch(/ t="n"/);
		expect(numberFormat).toMatch(/yyyy/);

		const serial = Number(cell.match(/<v>([^<]+)<\/v>/)?.[1]);
		expect(Math.floor(serial)).toBe(45355);
		// Read back through Excel's epoch, the serial has to be the instant that went in.
		expect((serial - 25569) * 86_400_000).toBeCloseTo(Date.UTC(2024, 2, 4, 5, 6, 7), 0);
	});

	it("falls back to a string for text no number or date cell can hold", async () => {
		const sheet = cells((await xlsx()).get("xl/worksheets/sheet1.xml") ?? "");
		expect(sheet.get("B3")).toContain('t="inlineStr"');
		expect(sheet.get("B3")).toContain("inf");
		expect(sheet.get("D3")).toContain('t="inlineStr"');
		expect(sheet.get("D3")).toContain("whenever");
	});

	// The formatting the server-side writer drew, which the move to a client-side writer dropped.
	it("styles the header row, with the block-starting columns set apart", async () => {
		const parts = await xlsx();
		const blockStart = formatOf(parts, "A1");
		const attribute = formatOf(parts, "B1");

		for (const h of [blockStart, attribute]) {
			expect(h.fill, "header cells are shaded").toContain("dbdbdb");
			expect(h.border, "header cells carry a bottom rule").toContain('style="medium"');
			expect(h.centred).toBe(true);
		}
		expect(blockStart.font, "a block-starting header is bold").toContain("<b/>");
		expect(attribute.font, "an attribute header is not").not.toContain("<b/>");
		expect(blockStart.border).toContain('<left style="medium"');
		expect(attribute.border, "a lighter rule inside a block").toContain(
			'<left style="mediumDashDot"',
		);
	});

	it("shades the satisfied column green and the violated one red", async () => {
		const parts = await xlsx();
		expect(formatOf(parts, "F2").fill).toContain("a2f99f");
		expect(formatOf(parts, "F3").fill).toContain("f99f9f");
	});

	it("formats integers and decimals differently", async () => {
		const parts = await xlsx({
			rows: [["n"], [{ n: "1234" }], [{ n: "12.5" }]],
			header_group_starts: [true],
			violation_column: null,
		});
		expect(formatOf(parts, "A2").numberFormat).toBe("#,##0");
		expect(formatOf(parts, "A3").numberFormat).toBe("#,##0.00");
	});

	it("sets column widths and an autofilter over the header", async () => {
		const sheet = (await xlsx()).get("xl/worksheets/sheet1.xml") ?? "";
		expect(sheet).toMatch(/<cols><col min="1" max="1" width="\d+"/);
		expect(sheet).toContain('<autoFilter ref="A1:F3"/>');
		// `cols` before `sheetData` before `autoFilter`, which is the order the schema requires.
		expect(sheet.indexOf("<cols>")).toBeLessThan(sheet.indexOf("<sheetData>"));
		expect(sheet.indexOf("</sheetData>")).toBeLessThan(sheet.indexOf("<autoFilter"));
	});

	it("adds no autofilter when the table has no header row", async () => {
		const sheet =
			(await xlsx({ rows: ROWS.slice(1), header_group_starts: [], violation_column: 5 })).get(
				"xl/worksheets/sheet1.xml",
			) ?? "";
		expect(sheet).not.toContain("<autoFilter");
	});

	it("writes a workbook for a node with no situations at all", async () => {
		const parts = await xlsx({ rows: [], header_group_starts: [], violation_column: null });
		expect(parts.get("xl/worksheets/sheet1.xml")).toContain("<sheetData></sheetData>");
	});
});

describe("bindingsTableToBlob, CSV", () => {
	it("writes the text of every cell, unchanged by the typing", async () => {
		const csv = await bindingsTableToBlob(TABLE, "CSV").text();
		expect(csv).toBe(
			"o1,o1.total,o1.rush,o1.due,o1.region,Satisfied\n" +
				"o1,12.5,true,2024-03-04T05:06:07+00:00,eu,true\n" +
				'o2,inf,false,whenever,"a,b""c",false\n',
		);
	});
});
