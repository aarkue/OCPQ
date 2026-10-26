import { describe, expect, it } from "vitest";
import type { OCELInfo } from "@/types/ocel";
import { buildTypeGraph, parseTypeKey, relatedTypes } from "./type-graph";

const ocelInfo = {
	event_types: [{ name: "pay order", attributes: [] }],
	object_types: [
		{ name: "orders", attributes: [] },
		{ name: "items", attributes: [] },
	],
	e2o_types: { "pay order": { orders: [2000, ["order"]], items: [0, []] } },
	o2o_types: {
		orders: { items: [7659, ["comprises", "contains"]], orders: [0, []] },
		items: { orders: [0, []], items: [0, []] },
	},
} as unknown as OCELInfo;

describe("buildTypeGraph", () => {
	const graph = buildTypeGraph(ocelInfo, {
		event_type_counts: { "pay order": 2000 },
		object_type_counts: { orders: 2000, items: 7659 },
	});

	it("draws one edge per related type pair and skips pairs without relations", () => {
		expect(graph.edges).toEqual([
			{ id: "e:pay order->o:orders", source: "e:pay order", target: "o:orders", kind: "e2o" },
			{ id: "o:orders->o:items", source: "o:orders", target: "o:items", kind: "o2o" },
		]);
		expect(graph.relationCounts.get("o:orders->o:items")).toBe(7659);
	});

	it("keys nodes by kind, so an event and an object type may share a name", () => {
		expect(graph.nodes.map((n) => n.id)).toEqual(["e:pay order", "o:orders", "o:items"]);
		expect(graph.nodes.find((n) => n.id === "o:items")?.count).toBe(7659);
	});

	it("shows every type of a small log by default", () => {
		expect([...graph.autoScope].sort()).toEqual(["e:pay order", "o:items", "o:orders"]);
	});
});

describe("parseTypeKey", () => {
	it("reads back the kind and a name that itself contains a colon", () => {
		expect(parseTypeKey("e:pay order")).toEqual({ isEvent: true, name: "pay order" });
		expect(parseTypeKey("o:a:b")).toEqual({ isEvent: false, name: "a:b" });
	});
});

describe("relatedTypes", () => {
	it("lists the objects an event type relates to", () => {
		expect(relatedTypes(ocelInfo, true, "pay order")).toEqual([
			{ isEvent: false, name: "orders", count: 2000, via: "E2O" },
		]);
	});

	it("lists events and both O2O directions for an object type", () => {
		expect(relatedTypes(ocelInfo, false, "orders")).toEqual([
			{ isEvent: false, name: "items", count: 7659, via: "O2O →" },
			{ isEvent: true, name: "pay order", count: 2000, via: "E2O" },
		]);
		expect(relatedTypes(ocelInfo, false, "items")).toEqual([
			{ isEvent: false, name: "orders", count: 7659, via: "O2O ←" },
		]);
	});
});
