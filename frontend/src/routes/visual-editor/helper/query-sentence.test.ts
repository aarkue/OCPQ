import { describe, expect, it } from "vitest";
import type { BindingBox } from "@/types/generated/BindingBox";
import type { BindingBoxTree } from "@/types/generated/BindingBoxTree";
import { describeQuery, durationWords, pluralOf, sentenceText, singularOf } from "./query-sentence";
import fixtures from "./query-sentence.fixtures.json";

const say = (tree: BindingBoxTree) => {
	const s = describeQuery(tree);
	return { text: sentenceText(s.parts), notes: s.notes.map(sentenceText) };
};

describe("describeQuery on the examples from the OCPQ docs", () => {
	const examples = fixtures as unknown as Record<string, BindingBoxTree>;
	it.each([
		[
			"orders0",
			"For every order with a payment reminder event e1 and a pay order event e2, e2 should be at or after e1.",
		],
		["orders0.5", "Find every customer with at least 50 payment reminder events of its orders."],
		[
			"orders1",
			"Every order with a place order event e1 and at most 10 items should have at least one pay order event at most 3 weeks after e1.",
		],
		[
			"orders2",
			"For every order with a place order event e1 and each of its items with a package delivered event e2, e2 should be at most 3.5 weeks after e1.",
		],
		[
			"orders3",
			"Every customer should have at most 5 orders with a place order event and at least 2 payment reminder events.",
		],
		[
			"orders4",
			"Every customer should satisfy `order_volume >= 300000`, where `order_volume` is computed with CEL over each of its orders o2 with at least one pay order event.",
		],
		["Q1", "Every Application should have exactly one A_Submitted event."],
		[
			"Q2",
			"Every Offer with an O_Created event e1 should have at least one O_Returned event at or after e1.",
		],
		["Q3", "Every O_Returned event should involve exactly one Offer."],
		[
			"Q4",
			"Every Application with an A_Accepted event e1 should have at least one Offer with an O_Accepted event at or after e1.",
		],
		[
			"Q5",
			"For every Application with an A_Accepted event involving a Case_R o2 and each of its Offers with an O_Created event e2, e2 should involve o2.",
		],
		[
			"Q6",
			"Computes `max_dur` with CEL over every Offer with an O_Created event e1 and an O_Accepted event e2.",
		],
		[
			"Q7",
			"Find every Application with an Offer o2 that has an O_Created event and an Offer o3 that has an O_Created event.",
		],
	])("%s", (name, text) => {
		expect(say(examples[name]).text).toBe(text);
	});

	it("notes what is easy to miss", () => {
		expect(say(examples.Q7).notes).toEqual(["o2 and o3 can be the same Offer."]);
		expect(say(examples.orders3).notes).toEqual([
			'"at most 5" counts each order once per place order event.',
		]);
		expect(say(examples.Q1).notes).toEqual([]);
	});
});

const box = (b: Partial<BindingBox>): BindingBox => ({
	newEventVars: {},
	newObjectVars: {},
	filters: [],
	sizeFilters: [],
	constraints: [],
	...b,
});
const single = (b: Partial<BindingBox>): BindingBoxTree => ({
	nodes: [{ Box: [box(b), []] }],
	edgeNames: [],
});
const withChild = (parent: Partial<BindingBox>, child: Partial<BindingBox>): BindingBoxTree => ({
	nodes: [{ Box: [box(parent), [1]] }, { Box: [box(child), []] }],
	edgeNames: [[[0, 1], "A"]],
});

describe("describeQuery", () => {
	it("says attribute filters as part of the variable", () => {
		const t = single({
			newObjectVars: { 0: ["orders"] },
			newEventVars: { 0: ["place order"] },
			filters: [
				{ type: "O2E", object: 0, event: 0, qualifier: null },
				{
					type: "EventAttributeValueFilter",
					event: 0,
					attribute_name: "channel",
					value_filter: { type: "String", is_in: ["web", "app"] },
				},
			],
		});
		expect(say(t).text).toBe(
			'Find every order with a place order event whose channel is "web" or "app".',
		);
	});

	it("keeps two variables of one type apart only when a filter does", () => {
		const t = single({
			newObjectVars: { 0: ["Application"], 1: ["Offer"], 2: ["Offer"] },
			filters: [
				{ type: "O2O", object: 0, other_object: 1, qualifier: null },
				{ type: "O2O", object: 0, other_object: 2, qualifier: null },
				{ type: "NotEqual", var_1: { Object: 1 }, var_2: { Object: 2 } },
			],
		});
		expect(say(t)).toEqual({
			text: "Find every Application with an Offer o2 and an Offer other than o2.",
			notes: [],
		});
	});

	it("names unrelated variables as such", () => {
		expect(say(single({ newObjectVars: { 0: ["orders"], 1: ["employees"] } })).text).toBe(
			"Find every order and any employee.",
		);
	});

	it("turns a time filter around when the later variable is its start", () => {
		const t = withChild(
			{
				newObjectVars: { 0: ["orders"] },
				newEventVars: { 0: ["pay order"] },
				filters: [{ type: "O2E", object: 0, event: 0, qualifier: null }],
				constraints: [
					{ type: "SizeFilter", filter: { type: "NumChilds", child_name: "A", min: 1, max: null } },
				],
			},
			{
				newEventVars: { 1: ["payment reminder"] },
				filters: [
					{ type: "O2E", object: 0, event: 1, qualifier: null },
					{
						type: "TimeBetweenEvents",
						from_event: 1,
						to_event: 0,
						min_seconds: 0,
						max_seconds: 7 * 86400,
					},
				],
			},
		);
		expect(say(t).text).toBe(
			"Every order with a pay order event e1 should have at least one payment reminder event at most 1 week before e1.",
		);
	});

	it("reads ANY over a child set as having one match that satisfies it", () => {
		const t = withChild(
			{ newObjectVars: { 0: ["orders"] }, constraints: [{ type: "ANY", child_names: ["A"] }] },
			{
				newObjectVars: { 1: ["items"] },
				filters: [{ type: "O2O", object: 0, other_object: 1, qualifier: null }],
				constraints: [
					{
						type: "Filter",
						filter: {
							type: "ObjectAttributeValueFilter",
							object: 1,
							attribute_name: "weight",
							at_time: { type: "Always" },
							value_filter: { type: "Float", min: null, max: 5 },
						},
					},
				],
			},
		);
		expect(say(t).text).toBe(
			"Every order should have at least one item whose weight is at most 5 at all times.",
		);
	});

	it("reads a zero count as none", () => {
		const t = withChild(
			{
				newObjectVars: { 0: ["orders"] },
				constraints: [
					{ type: "SizeFilter", filter: { type: "NumChilds", child_name: "A", min: 0, max: 0 } },
				],
			},
			{
				newEventVars: { 0: ["cancel order"] },
				filters: [{ type: "O2E", object: 0, event: 0, qualifier: null }],
			},
		);
		expect(say(t).text).toBe("Every order should have no cancel order events.");
	});

	it("joins an event tied to an outer variable with and, not involving", () => {
		const t: BindingBoxTree = {
			nodes: [
				{
					Box: [
						box({
							newObjectVars: { 0: ["orders"] },
							constraints: [{ type: "SAT", child_names: ["A"] }],
						}),
						[1],
					],
				},
				{
					Box: [
						box({
							newObjectVars: { 1: ["items"] },
							filters: [{ type: "O2O", object: 0, other_object: 1, qualifier: null }],
							constraints: [
								{
									type: "SizeFilter",
									filter: { type: "NumChilds", child_name: "B", min: 1, max: null },
								},
							],
						}),
						[2],
					],
				},
				{
					Box: [
						box({
							newEventVars: { 0: ["confirm order"], 1: ["package delivered"] },
							filters: [
								{ type: "O2E", object: 1, event: 0, qualifier: null },
								{ type: "O2E", object: 1, event: 1, qualifier: null },
								{
									type: "TimeBetweenEvents",
									from_event: 0,
									to_event: 1,
									min_seconds: 0,
									max_seconds: 14 * 86400,
								},
							],
						}),
						[],
					],
				},
			],
			edgeNames: [
				[[1, 2], "B"],
				[[0, 1], "A"],
			],
		};
		expect(say(t).text).toBe(
			"For every order, each of its items should have at least one confirm order event e1 and a package delivered event at most 2 weeks after e1.",
		);
	});
});

describe("edge cases", () => {
	it("says nothing about an empty query", () => {
		expect(say({ nodes: [], edgeNames: [] }).text).toBe("");
	});

	it("keeps an event attribute name with a space whole", () => {
		const t = single({
			newEventVars: { 0: ["place order"] },
			constraints: [
				{
					type: "Filter",
					filter: {
						type: "EventAttributeValueFilter",
						event: 0,
						attribute_name: "total price",
						value_filter: { type: "Float", min: 10, max: null },
					},
				},
			],
		});
		expect(say(t).text).toBe(
			"For every place order event e1, the total price of e1 should be at least 10.",
		);
	});

	it("joins two attribute conditions on one variable in filter order", () => {
		const t = single({
			newEventVars: { 0: ["place order"] },
			filters: [
				{
					type: "EventAttributeValueFilter",
					event: 0,
					attribute_name: "channel",
					value_filter: { type: "String", is_in: ["web"] },
				},
				{
					type: "EventAttributeValueFilter",
					event: 0,
					attribute_name: "total",
					value_filter: { type: "Float", min: 10, max: null },
				},
			],
		});
		expect(say(t).text).toBe(
			'Find every place order event whose channel is "web" and whose total is at least 10.',
		);
	});

	it("reads at most one as singular", () => {
		const t = withChild(
			{
				newObjectVars: { 0: ["orders"] },
				constraints: [
					{ type: "SizeFilter", filter: { type: "NumChilds", child_name: "A", min: null, max: 1 } },
				],
			},
			{
				newEventVars: { 0: ["pay order"] },
				filters: [{ type: "O2E", object: 0, event: 0, qualifier: null }],
			},
		);
		expect(say(t).text).toBe("Every order should have at most one pay order event.");
	});

	it("counts a child of a box without variables", () => {
		const t = withChild(
			{
				constraints: [
					{ type: "SizeFilter", filter: { type: "NumChilds", child_name: "A", min: 1, max: null } },
				],
			},
			{ newObjectVars: { 0: ["orders"] } },
		);
		expect(say(t).text).toBe("Across the whole log, there should be at least one order.");
	});

	it("gives other size filters of a box with variables to the subject", () => {
		const t = withChild(
			{
				newObjectVars: { 0: ["orders"] },
				constraints: [
					{
						type: "SizeFilter",
						filter: {
							type: "NumChildsProj",
							child_name: "A",
							var_name: { Object: 1 },
							min: 2,
							max: null,
						},
					},
				],
			},
			{
				newObjectVars: { 1: ["items"] },
				filters: [{ type: "O2O", object: 0, other_object: 1, qualifier: null }],
			},
		);
		expect(say(t).text).toBe("Every order should have at least 2 different o2 in A.");
	});
});

describe("inflection", () => {
	it("singularizes plain lowercase names only", () => {
		expect(singularOf("orders")).toBe("order");
		expect(singularOf("deliveries")).toBe("delivery");
		expect(singularOf("address")).toBe("address");
		expect(singularOf("Case_R")).toBe("Case_R");
		expect(["boxes", "addresses", "batches", "status", "packages"].map(singularOf)).toEqual([
			"box",
			"address",
			"batch",
			"status",
			"package",
		]);
	});
	it("pluralizes words and leaves codes alone", () => {
		expect(pluralOf("Offer")).toBe("Offers");
		expect(pluralOf("items")).toBe("items");
		expect(pluralOf("Case_R")).toBe("Case_R");
	});
	it("writes durations in the largest unit that fits in halves", () => {
		expect(durationWords(21 * 86400)).toBe("3 weeks");
		expect(durationWords(24.5 * 86400)).toBe("3.5 weeks");
		expect(durationWords(10 * 86400)).toBe("10 days");
	});
});
