import { describe, expect, it } from "vitest";
import type { FlowAndViolationData } from "@/types/misc";
import type { OCELInfo } from "@/types/ocel";
import {
	COLLAPSED_BY_DEFAULT,
	fitOf,
	groupQueries,
	matchesSearch,
	type QueryItem,
	queryItems,
	tagCounts,
	tagsOf,
	typesOfFlow,
	withTags,
} from "./query-list";

const box = (events: Record<number, string[]>, objects: Record<number, string[]>) => ({
	id: crypto.randomUUID(),
	type: "eventType",
	position: { x: 0, y: 0 },
	data: {
		box: {
			newEventVars: events,
			newObjectVars: objects,
			filters: [],
			sizeFilters: [],
			constraints: [],
		},
	},
});
const gate = { id: "g", type: "gate", position: { x: 0, y: 0 }, data: { type: "not" } };
const flow = (...nodes: unknown[]) =>
	({ flowJson: { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } } }) as FlowAndViolationData;

const ocelInfo = {
	event_types: [{ name: "place order" }, { name: "pay order" }],
	object_types: [{ name: "orders" }, { name: "items" }],
} as OCELInfo;

describe("typesOfFlow", () => {
	it("collects the types of every box and skips gates", () => {
		const f = flow(
			box({ 0: ["pay order"] }, { 0: ["orders"] }),
			gate,
			box({}, { 1: ["items", "orders"] }),
		);
		expect(typesOfFlow(f.flowJson)).toEqual({
			events: ["pay order"],
			objects: ["items", "orders"],
		});
		expect(typesOfFlow(undefined)).toEqual({ events: [], objects: [] });
	});
});

describe("fitOf", () => {
	it("tells queries that fit the log, partly fit it, or belong to another log apart", () => {
		expect(fitOf({ events: ["pay order"], objects: ["orders"] }, ocelInfo)).toEqual({
			kind: "fits",
		});
		expect(fitOf({ events: ["payment reminder"], objects: ["orders"] }, ocelInfo)).toEqual({
			kind: "partial",
			missing: ["payment reminder"],
		});
		expect(fitOf({ events: [], objects: ["Container"] }, ocelInfo)).toEqual({ kind: "other" });
		expect(fitOf({ events: [], objects: [] }, ocelInfo)).toEqual({ kind: "fits" });
	});
});

describe("tags", () => {
	it("reads saves from before tags existed as untagged", () => {
		expect(tagsOf({ name: "Old", description: "" })).toEqual([]);
		const fromStorage = JSON.parse('{"name":"Old","description":"x","tags":["a"," b ","",3,"a"]}');
		expect(tagsOf(fromStorage)).toEqual(["a", "b"]);
		expect(tagsOf(JSON.parse('{"name":"Odd","description":"","tags":"a"}'))).toEqual([]);
	});

	it("leaves the field out when a query has no tags", () => {
		const info = { name: "Q", description: "", tags: ["a"] };
		expect(withTags(info, [])).toEqual({ name: "Q", description: "" });
		expect(withTags(info, ["b", " b"])).toEqual({ name: "Q", description: "", tags: ["b"] });
	});
});

const item = (over: Partial<QueryItem>): QueryItem => ({
	index: 0,
	name: "Q",
	description: "",
	tags: [],
	types: { events: [], objects: [] },
	fit: { kind: "fits" },
	...over,
});

describe("queryItems", () => {
	it("names unnamed queries by position and keeps their index", () => {
		const items = queryItems(
			[
				{ name: "", description: "" },
				{ name: "Late", description: "d", tags: ["x"] },
			],
			[flow(box({}, { 0: ["orders"] })), undefined],
			ocelInfo,
		);
		expect(items.map((i) => [i.index, i.name, i.tags])).toEqual([
			[0, "Query 1", []],
			[1, "Late", ["x"]],
		]);
	});
});

describe("matchesSearch", () => {
	it("finds queries by name, description, tag or a type they use", () => {
		const q = item({
			name: "Late payments",
			description: "Paid after 14 days",
			tags: ["compliance"],
			types: { events: ["pay order"], objects: ["orders"] },
		});
		for (const s of ["late", "14 DAYS", "compl", "ORDERS", "pay ord", ""]) {
			expect(matchesSearch(q, s)).toBe(true);
		}
		expect(matchesSearch(q, "items")).toBe(false);
	});

	it("searches the sentence shown when there is no description", () => {
		const q = item({ name: "Q", description: "", sentence: "Every order should be paid." });
		expect(matchesSearch(q, "be paid")).toBe(true);
		expect(matchesSearch({ ...q, description: "Paid in time" }, "be paid")).toBe(false);
	});
});

describe("groupQueries", () => {
	const fits = item({ index: 0, tags: ["b", "a"] });
	const partial = item({ index: 1, fit: { kind: "partial", missing: ["x"] }, tags: ["a"] });
	const other = item({ index: 2, fit: { kind: "other" } });
	const rows = (by: "fit" | "tag", collapsed = (id: string) => COLLAPSED_BY_DEFAULT.has(id)) =>
		groupQueries([fits, partial, other], by, collapsed).map((r) =>
			r.kind === "section"
				? `${r.title} ${r.count}${r.collapsed ? " (closed)" : ""}`
				: r.item.index,
		);

	it("groups by fit, with other logs closed at first", () => {
		expect(rows("fit")).toEqual([
			"Fits this log 1",
			0,
			"Partly fits 1",
			1,
			"Other logs 1 (closed)",
		]);
	});

	it("groups by tag, a query under each of its tags and untagged ones last", () => {
		expect(rows("tag", () => false)).toEqual(["a 2", 0, 1, "b 1", 0, "No tag 1", 2]);
	});

	it("leaves out empty sections", () => {
		expect(groupQueries([fits], "fit", () => false).map((r) => r.kind)).toEqual([
			"section",
			"query",
		]);
	});
});

describe("tagCounts", () => {
	it("lists tags with their counts, most used first", () => {
		expect(tagCounts([item({ tags: ["b", "a"] }), item({ tags: ["a"] })])).toEqual([
			["a", 2],
			["b", 1],
		]);
	});
});
