import { describe, expect, it } from "vitest";
import type { BindingBox } from "@/types/generated/BindingBox";
import type { OCELInfo } from "@/types/ocel";
import {
	getConnectionCandidates,
	getPossibleE2OVariables,
	getPossibleO2OVariables,
	getTypesRelatedToBound,
	getTypesRelationshipQualifiers,
	matchQualifiers,
} from "./variable-hints";

/** Orders relate to `pay order` events and to items; nothing else relates to anything. */
const ocelInfo = {
	e2o_types: { "pay order": { orders: [2000, []] } },
	o2o_types: { orders: { items: [7659, []] } },
} as unknown as OCELInfo;

const typesFor = (_node: string, _variable: number, scope: "object" | "event") =>
	scope === "event" ? [{ name: "pay order" }] : [{ name: "orders" }];
const objectTypesFor = (_node: string, variable: number, _scope: "object" | "event") => [
	{ name: variable === 0 ? "orders" : "items" },
];

const boxWith = (filters: BindingBox["filters"]) => ({ filters }) as BindingBox;

describe("getPossibleE2OVariables", () => {
	it("suggests a supported pair", () => {
		expect(getPossibleE2OVariables(ocelInfo, typesFor as never, "n", [0], [0])).toEqual({
			object: 0,
			event: 0,
		});
	});

	it("still suggests a pair when an identical filter exists elsewhere in the tree", () => {
		// A sibling box scopes its own variables, so it needs the same pair the first box already uses.
		// Returning nothing here left the editor with unset variables and a disabled submit.
		const existing = [boxWith([{ type: "O2E", object: 0, event: 0, qualifier: null }])];
		expect(getPossibleE2OVariables(ocelInfo, typesFor as never, "n", [0], [0], existing)).toEqual({
			object: 0,
			event: 0,
		});
	});

	it("gives nothing when no pair is supported at all", () => {
		const unrelated = { e2o_types: {}, o2o_types: {} } as unknown as OCELInfo;
		expect(getPossibleE2OVariables(unrelated, typesFor as never, "n", [0], [0])).toEqual({});
	});
});

describe("getPossibleO2OVariables", () => {
	it("still suggests a pair when an identical filter exists elsewhere in the tree", () => {
		const existing = [boxWith([{ type: "O2O", object: 0, other_object: 1, qualifier: null }])];
		expect(
			getPossibleO2OVariables(ocelInfo, objectTypesFor as never, "n", [0, 1], existing),
		).toEqual({ object: 0, other_object: 1 });
	});
});

/** Orders link to `pay order` events and to items. Customers relate to nothing, `ship` to items. */
const typedOcelInfo = {
	object_types: [{ name: "orders" }, { name: "items" }, { name: "customers" }],
	event_types: [{ name: "pay order" }, { name: "ship" }, { name: "idle" }],
	e2o_types: {
		"pay order": { orders: [2000, ["order", "payment"]] },
		ship: { items: [10, ["item"]], orders: [0, []] },
	},
	o2o_types: { orders: { items: [7659, ["comprises"]], customers: [0, []] } },
} as unknown as OCELInfo;

describe("getTypesRelatedToBound", () => {
	it("relates object types to bound events through E2O", () => {
		expect(getTypesRelatedToBound(typedOcelInfo, "object", [], ["pay order"])).toEqual(["orders"]);
	});

	it("relates object types to bound objects through O2O in both directions", () => {
		expect(getTypesRelatedToBound(typedOcelInfo, "object", ["items"], [])).toEqual(["orders"]);
		expect(getTypesRelatedToBound(typedOcelInfo, "object", ["orders"], [])).toEqual(["items"]);
	});

	it("relates event types to bound objects through E2O", () => {
		expect(getTypesRelatedToBound(typedOcelInfo, "event", ["orders", "items"], [])).toEqual([
			"pay order",
			"ship",
		]);
	});

	it("ignores relationships that never occur", () => {
		expect(getTypesRelatedToBound(typedOcelInfo, "object", ["customers"], ["idle"])).toEqual([]);
	});
});

describe("getTypesRelationshipQualifiers", () => {
	it("collects qualifiers over all type pairs, deduplicated", () => {
		expect(
			getTypesRelationshipQualifiers(
				typedOcelInfo,
				["pay order", "ship"],
				["orders", "items", "orders"],
				true,
			).sort(),
		).toEqual(["item", "order", "payment"]);
	});

	it("uses the O2O direction as given", () => {
		expect(getTypesRelationshipQualifiers(typedOcelInfo, ["orders"], ["items"], false)).toEqual([
			"comprises",
		]);
		expect(getTypesRelationshipQualifiers(typedOcelInfo, ["items"], ["orders"], false)).toEqual([]);
	});
});

describe("matchQualifiers", () => {
	it("matches case-insensitive substrings and sorts the shown ones", () => {
		expect(matchQualifiers(["Shipper", "order", "ship-to", "payer"], "SHIP", 10)).toEqual({
			matches: ["ship-to", "Shipper"],
			more: false,
		});
	});

	it("puts an exact match first, even past the limit", () => {
		const many = [...Array.from({ length: 60 }, (_, i) => `ab${i}`), "a"];
		const { matches, more } = matchQualifiers(many, "a", 50);
		expect(matches[0]).toBe("a");
		expect(matches).toHaveLength(50);
		expect(more).toBe(true);
	});

	it("stops at the limit and reports that more exist", () => {
		const many = Array.from({ length: 1000 }, (_, i) => `q${i}`);
		const { matches, more } = matchQualifiers(many, "", 50);
		expect(matches).toHaveLength(50);
		expect(more).toBe(true);
	});

	it("reports no more when the matches fit exactly", () => {
		expect(matchQualifiers(["a", "b"], "", 2)).toEqual({ matches: ["a", "b"], more: false });
	});
});

describe("getConnectionCandidates", () => {
	const summary = (cs: ReturnType<typeof getConnectionCandidates>) =>
		cs.map((c) => [c.key, c.support]);

	it("connects a new object to bound events and to objects in both directions", () => {
		const cs = getConnectionCandidates(
			typedOcelInfo,
			{ kind: "object", variable: 1, types: ["items"] },
			[
				{ kind: "object", variable: 0, types: ["orders"] },
				{ kind: "event", variable: 0, types: ["ship"] },
			],
		);
		expect(summary(cs)).toEqual([
			["O2O:o0:o1", 7659],
			["O2E:o1:e0", 10],
		]);
		expect(cs[0].filter).toEqual({ type: "O2O", object: 0, other_object: 1, qualifier: null });
		expect(cs[0].suggestQualifiers()).toEqual(["comprises"]);
	});

	it("connects a new event only to objects", () => {
		const cs = getConnectionCandidates(
			typedOcelInfo,
			{ kind: "event", variable: 2, types: ["pay order"] },
			[
				{ kind: "event", variable: 0, types: ["ship"] },
				{ kind: "object", variable: 0, types: ["orders"] },
			],
		);
		expect(cs.map((c) => c.filter)).toEqual([
			{ type: "O2E", object: 0, event: 2, qualifier: null },
		]);
		expect(cs[0].suggestQualifiers()).toEqual(["order", "payment"]);
	});

	it("offers nothing for unrelated types", () => {
		expect(
			getConnectionCandidates(
				typedOcelInfo,
				{ kind: "object", variable: 1, types: ["customers"] },
				[{ kind: "event", variable: 0, types: ["pay order"] }],
			),
		).toEqual([]);
	});
});
