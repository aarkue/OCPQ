import { describe, expect, it } from "vitest";
import type { GraphLink } from "@/components/relationship-graph/graph-model";
import type { OCELEvent, OCELObject } from "@/types/ocel";
import {
	eventGaps,
	eventMatrix,
	feedItems,
	rowElements,
	rowTags,
	shortDuration,
} from "./row-timeline";

const ev = (id: string, type: string, time: string, objectIds: string[]): OCELEvent => ({
	id,
	type,
	time,
	attributes: [],
	relationships: objectIds.map((objectId) => ({ objectId, qualifier: objectId.split("-")[0] })),
});
const ob = (id: string, type: string): OCELObject => ({ id, type, attributes: [] });
const linksOf = (events: OCELEvent[]): GraphLink[] =>
	events.flatMap((e) =>
		(e.relationships ?? []).map((r) => ({ source: e.id, target: r.objectId, qualifier: "" })),
	);

const place = ev("place-1", "place order", "2024-03-01T09:00:00Z", [
	"o-1",
	"i-1",
	"i-2",
	"i-3",
	"c-1",
]);
const confirm = ev("confirm-1", "confirm order", "2024-03-01T15:00:00Z", ["o-1", "emp-1"]);
const pay = ev("pay-1", "pay order", "2024-03-22T09:00:00Z", ["o-1"]);
const nodes = [
	ob("o-1", "orders"),
	place,
	pay,
	confirm,
	ob("i-1", "items"),
	ob("i-2", "items"),
	ob("i-3", "items"),
	ob("c-1", "customers"),
	ob("emp-1", "employees"),
];
const tags = rowTags({
	objects: [[0, "o-1"]],
	events: [
		[0, "place-1"],
		[1, "pay-1"],
	],
});

describe("rowElements", () => {
	it("sorts events by time and objects by hops, then by when their type first shows up", () => {
		const { events, objects } = rowElements(nodes, linksOf([place, confirm, pay]), tags);
		expect(events.map((e) => e.id)).toEqual(["place-1", "confirm-1", "pay-1"]);
		expect(objects.map((o) => [o.id, o.hops])).toEqual([
			["o-1", 0],
			["i-1", 1],
			["i-2", 1],
			["i-3", 1],
			["c-1", 1],
			["emp-1", 2],
		]);
	});
});

describe("feedItems", () => {
	const { events, objects } = rowElements(nodes, linksOf([place, confirm, pay]), tags);
	const items = feedItems(events, objects, tags);
	it("puts the time between events in between, long ones marked, and says how long after the first bound event a later one is", () => {
		expect(items.map((i) => (i.kind === "gap" ? [i.text, i.long] : i.event.id))).toEqual([
			"place-1",
			["6 h", false],
			"confirm-1",
			["20 d 18 h", true],
			"pay-1",
		]);
		const last = items[4];
		expect(last.kind === "event" && [last.tag, last.since]).toEqual(["e2", "21 d after e1"]);
	});
	it("puts bound objects first and folds many unbound objects of a type", () => {
		const first = items[0];
		expect(first.kind === "event" && first.chips).toEqual([
			{ kind: "object", id: "o-1", type: "orders", tag: "o1", qualifier: "o" },
			{ kind: "group", type: "items", ids: ["i-1", "i-2", "i-3"], qualifiers: ["i", "i", "i"] },
			{ kind: "object", id: "c-1", type: "customers", tag: undefined, qualifier: "c" },
		]);
	});
	it("counts the objects left out at fewer hops", () => {
		const bound = objects.filter((o) => o.hops === 0);
		const first = feedItems(events, bound, tags)[0];
		expect(first.kind === "event" && [first.chips.length, first.hidden]).toEqual([1, 4]);
	});
});

describe("eventMatrix", () => {
	const { events, objects } = rowElements(nodes, linksOf([place, confirm, pay]), tags);
	it("has a row per object and marks long pauses", () => {
		const m = eventMatrix(events, objects, tags);
		expect(m.rows.map((r) => r.id)).toEqual(["o-1", "i-1", "i-2", "i-3", "c-1", "emp-1"]);
		expect(m.columns.map((c) => c.rows)).toEqual([[0, 1, 2, 3, 4], [0, 5], [0]]);
		expect(m.columns[1].qualifiers).toEqual(["o", "emp"]);
		expect(m.columns.map((c) => c.gap && [c.gap.short, c.gap.long])).toEqual([
			undefined,
			["6 h", false],
			["21 d", true],
		]);
		expect(m.columns.map((c) => c.tag)).toEqual(["e1", undefined, "e2"]);
	});
	it("caps the rows and says how many are left out", () => {
		const m = eventMatrix(events, objects, tags, { maxRows: 2 });
		expect(m.rows.map((r) => r.id)).toEqual(["o-1", "i-1"]);
		expect(m.hiddenRows).toBe(4);
		expect(m.columns[0].rows).toEqual([0, 1]);
	});
});

describe("eventGaps", () => {
	const at = (iso: string) => ev(iso, "x", iso, []);
	it("judges gaps against the median gap, so short logs get short pauses", () => {
		const minutes = [
			"2024-01-01T10:00:00Z",
			"2024-01-01T10:01:00Z",
			"2024-01-01T10:02:00Z",
			"2024-01-01T10:12:00Z",
		].map(at);
		expect(eventGaps(minutes).map((g) => g?.long)).toEqual([undefined, false, false, true]);
	});
	it("says when events happen at the same time", () => {
		const same = ["2024-01-01T10:00:00Z", "2024-01-01T10:00:00Z"].map(at);
		expect(eventGaps(same)[1]).toEqual({ text: "same time", short: "0 s", long: false });
	});
	it("writes durations in their largest unit", () => {
		expect([59.6 * 60e3, 23.8 * 3600e3].map(shortDuration)).toEqual(["1 h", "1 d"]);
		expect([45e3, 12 * 60e3, 4.4 * 3600e3, 21 * 86400e3].map(shortDuration)).toEqual([
			"45 s",
			"12 min",
			"4 h",
			"21 d",
		]);
	});
});

describe("rowTags", () => {
	it("gives an element bound by several variables all their names", () => {
		const tags = rowTags({
			objects: [
				[0, "o-1"],
				[1, "o-1"],
			],
			events: [[0, "e-1"]],
		});
		expect([...tags]).toEqual([
			["o-1", "o1, o2"],
			["e-1", "e1"],
		]);
	});
});
