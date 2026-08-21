import { describe, expect, it } from "vitest";
import type { PathSchemaInfo } from "@/types/generated/PathSchemaInfo";
import type { PathSchemaStep } from "@/types/generated/PathSchemaStep";
import type { PathTypeRef } from "@/types/generated/PathTypeRef";
import { schemasToBindingBoxTree, schemaToBindingBoxTree } from "./pathSchemaQueryBuilder";

const ORDER: PathTypeRef = { name: "order", is_event: false };
const ITEM: PathTypeRef = { name: "item", is_event: false };
const PLACE: PathTypeRef = { name: "place order", is_event: true };
const SHIP: PathTypeRef = { name: "ship", is_event: true };
const PAY: PathTypeRef = { name: "pay", is_event: true };

function step(
	source: PathTypeRef,
	target: PathTypeRef,
	qualifier: string,
	reverse = false,
): PathSchemaStep {
	return { qualifier, source, target, reverse };
}

function schema(
	index: number,
	source: PathTypeRef,
	target: PathTypeRef,
	steps: PathSchemaStep[],
): PathSchemaInfo {
	return { index, schema: `schema-${index}`, source, target, length: steps.length, steps };
}

function box(tree: ReturnType<typeof schemaToBindingBoxTree>) {
	const boxNode = tree.nodes[0];
	if (!("Box" in boxNode)) throw new Error("expected a Box node");
	return boxNode.Box[0];
}

describe("schemaToBindingBoxTree (single schema)", () => {
	it("creates one variable per node and one filter per step", () => {
		const info = schema(0, ORDER, SHIP, [
			step(PLACE, ORDER, "places", true), // edge place-order --places--> order, reversed
			step(PLACE, SHIP, "leads to"),
		]);
		const tree = schemaToBindingBoxTree(info, "None", 0);
		const b = box(tree);
		expect(Object.keys(b.newObjectVars)).toHaveLength(1);
		expect(Object.keys(b.newEventVars)).toHaveLength(2);
		expect(b.filters).toHaveLength(2);
	});
});

describe("schemasToBindingBoxTree (combined selection)", () => {
	it("throws when schemas don't share a source type", () => {
		const a = schema(0, ORDER, SHIP, [step(ORDER, SHIP, "ships")]);
		const b = schema(1, ITEM, SHIP, [step(ITEM, SHIP, "ships")]);
		expect(() => schemasToBindingBoxTree([a, b], "None", 0)).toThrow();
	});

	it("throws when schemas don't share a target type", () => {
		const a = schema(0, ORDER, SHIP, [step(ORDER, SHIP, "ships")]);
		const b = schema(1, ORDER, PAY, [step(ORDER, PAY, "paid")]);
		expect(() => schemasToBindingBoxTree([a, b], "None", 0)).toThrow();
	});

	it("binds both endpoints once, as the first variables", () => {
		// The reported bug: two order->item paths produced two endpoint variables. Both
		// paths must connect the SAME order (o1) to the SAME item (o2).
		const a = schema(0, ORDER, ITEM, [step(PLACE, ORDER, "in", true), step(PLACE, ITEM, "adds")]);
		const b = schema(1, ORDER, ITEM, [step(SHIP, ORDER, "in", true), step(SHIP, ITEM, "ships")]);
		const tree = schemasToBindingBoxTree([a, b], "None", 0);
		const bx = box(tree);
		// Exactly one order and one item variable (ids 0 and 1), two intermediate events.
		expect(bx.newObjectVars).toEqual({ 0: [ORDER.name], 1: [ITEM.name] });
		expect(Object.keys(bx.newEventVars)).toHaveLength(2);
		// Each path: one step onto its event + one step onto the shared item = 4 filters.
		expect(bx.filters).toHaveLength(4);
		// Every relation filter touching an object touches var 0 or 1, never a third object.
		for (const f of bx.filters) {
			if (f.type === "O2E") expect([0, 1]).toContain(f.object);
		}
	});

	it("gives same-typed endpoints two distinct variables", () => {
		const a = schema(0, ORDER, ORDER, [step(SHIP, ORDER, "in", true), step(SHIP, ORDER, "also")]);
		const tree = schemasToBindingBoxTree([a], "None", 0);
		const bx = box(tree);
		expect(bx.newObjectVars).toEqual({ 0: [ORDER.name], 1: [ORDER.name] });
	});

	it("merges an identical common prefix instead of duplicating it", () => {
		const a = schema(0, ORDER, ITEM, [
			step(PLACE, ORDER, "places", true),
			step(PLACE, SHIP, "then"),
			step(SHIP, ITEM, "ships"),
		]);
		const b = schema(1, ORDER, ITEM, [
			step(PLACE, ORDER, "places", true),
			step(PLACE, PAY, "then"),
			step(PAY, ITEM, "pays"),
		]);
		const tree = schemasToBindingBoxTree([a, b], "None", 0);
		const bx = box(tree);
		// order + item endpoints; place-order shared; ship and pay diverge.
		expect(Object.keys(bx.newObjectVars)).toHaveLength(2);
		expect(Object.keys(bx.newEventVars)).toHaveLength(3);
		// Shared first step once + 2 divergent middles + 2 final steps onto the shared item.
		expect(bx.filters).toHaveLength(5);
	});

	it("does not duplicate filters when identical schemas are selected twice", () => {
		const a = schema(0, ORDER, ITEM, [
			step(PLACE, ORDER, "places", true),
			step(PLACE, ITEM, "adds"),
		]);
		const b = schema(1, ORDER, ITEM, [
			step(PLACE, ORDER, "places", true),
			step(PLACE, ITEM, "adds"),
		]);
		const tree = schemasToBindingBoxTree([a, b], "Forward", 0);
		const bx = box(tree);
		expect(bx.filters.filter((f) => f.type === "O2E" || f.type === "O2O")).toHaveLength(2);
		expect(bx.filters.filter((f) => f.type === "TimeBetweenEvents")).toHaveLength(0);
	});
});
