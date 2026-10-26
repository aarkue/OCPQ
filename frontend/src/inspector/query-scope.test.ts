import { describe, expect, it } from "vitest";
import type { BindingBox } from "@/types/generated/BindingBox";
import type { QueryContext } from "./query-context";
import { focusTypeGraph, scopeOfQuery } from "./query-scope";

const box = (b: Partial<BindingBox>) =>
	({
		newObjectVars: {},
		newEventVars: {},
		filters: [],
		sizeFilters: [],
		constraints: [],
		...b,
	}) as BindingBox;

/** Root: o1 orders, e1 place order, filtered together. Child: o2 items, not connected. */
const ctx: QueryContext = {
	nodes: [
		{
			id: "root",
			box: box({
				newObjectVars: { 0: ["orders"] },
				newEventVars: { 0: ["place order"] },
				filters: [{ type: "O2E", object: 0, event: 0, qualifier: null }],
			}),
		},
		{ id: "gate", parentId: "root" },
		{ id: "child", parentId: "gate", box: box({ newObjectVars: { 1: ["items"] } }) },
		{ id: "sibling", parentId: "root", box: box({ newEventVars: { 1: ["pay order"] } }) },
	],
};

const edges = [
	{ id: "e:place order->o:orders", source: "e:place order", target: "o:orders" },
	{ id: "e:place order->o:items", source: "e:place order", target: "o:items" },
	{ id: "o:orders->o:items", source: "o:orders", target: "o:items" },
	{ id: "o:customers->o:orders", source: "o:customers", target: "o:orders" },
	{ id: "e:pick item->o:items", source: "e:pick item", target: "o:items" },
	{ id: "e:ship->o:packages", source: "e:ship", target: "o:packages" },
];

describe("scopeOfQuery", () => {
	it("takes every box when none is selected, and adds to the root", () => {
		const scope = scopeOfQuery(ctx);
		expect(scope.focus).toBe("query");
		expect(scope.variables.map((v) => `${v.kind}${v.variable}`).sort()).toEqual([
			"event0",
			"event1",
			"object0",
			"object1",
		]);
		expect(scope.targetNodeId).toBe("root");
		expect(scope.boxCount).toBe(3);
	});

	it("narrows to the selected box and its ancestors, through gates", () => {
		const scope = scopeOfQuery({ ...ctx, selectedId: "child" });
		expect(scope.focus).toBe("box");
		expect(scope.variables.map((v) => v.types[0]).sort()).toEqual([
			"items",
			"orders",
			"place order",
		]);
		expect(scope.targetNodeId).toBe("child");
	});

	it("maps filters to the type edges they cover, using variables of ancestor boxes", () => {
		const child = {
			id: "child",
			parentId: "root",
			box: box({
				newObjectVars: { 1: ["items"] },
				filters: [{ type: "O2O", object: 0, other_object: 1, qualifier: null }],
			}),
		};
		const scope = scopeOfQuery({ nodes: [ctx.nodes[0], child] });
		expect([...scope.filteredEdges].sort()).toEqual([
			"e:place order->o:orders",
			"o:orders->o:items",
		]);
	});
});

describe("focusTypeGraph", () => {
	it("shows bound types with their direct neighbours and grades the edges", () => {
		const focus = focusTypeGraph(
			scopeOfQuery({ ...ctx, selectedId: "child" }),
			edges as never,
			() => 1,
			10,
		);
		expect(Object.fromEntries(focus.bound)).toEqual({
			"o:orders": ["o1"],
			"e:place order": ["e1"],
			"o:items": ["o2"],
		});
		expect([...focus.visible].sort()).toEqual([
			"e:pick item",
			"e:place order",
			"o:customers",
			"o:items",
			"o:orders",
		]);
		expect(Object.fromEntries(focus.edgeLook)).toEqual({
			"e:place order->o:orders": "filter",
			"e:place order->o:items": "possible",
			"o:orders->o:items": "possible",
			"o:customers->o:orders": "faint",
			"e:pick item->o:items": "faint",
		});
	});

	it("keeps the neighbours with the most relations and counts the rest", () => {
		const relations = (id: string) => (id === "e:pick item->o:items" ? 500 : 10);
		const focus = focusTypeGraph(
			scopeOfQuery({ ...ctx, selectedId: "child" }),
			edges as never,
			relations,
			1,
		);
		expect(focus.visible.has("e:pick item")).toBe(true);
		expect(focus.visible.has("o:customers")).toBe(false);
		expect(focus.edgeLook.has("o:customers->o:orders")).toBe(false);
		expect(focus.hiddenNeighbours).toBe(1);
	});

	it("lists every variable bound to a type", () => {
		const twoOrders = {
			nodes: [{ id: "r", box: box({ newObjectVars: { 0: ["orders"], 2: ["orders", "items"] } }) }],
		};
		const focus = focusTypeGraph(scopeOfQuery(twoOrders), edges as never, () => 1, 10);
		expect(focus.bound.get("o:orders")).toEqual(["o1", "o3"]);
		expect(focus.bound.get("o:items")).toEqual(["o3"]);
	});
});
