import { describe, expect, it } from "vitest";
import type { PersistedFlow } from "./OCDeclareEditor";
import { typesOfOCDeclareFlow } from "./oc-declare-types";

describe("typesOfOCDeclareFlow", () => {
	it("takes activities from activity nodes and object types from object nodes and arcs", () => {
		const flow = {
			nodes: [
				{ id: "a", type: "activity", position: { x: 0, y: 0 }, data: { type: "place order" } },
				{ id: "b", type: "activity", position: { x: 0, y: 0 }, data: { type: "pay order" } },
				{
					id: "c",
					type: "activity",
					position: { x: 0, y: 0 },
					data: { type: "packages", isObject: "init" },
				},
			],
			edges: [
				{
					id: "e",
					source: "a",
					target: "b",
					data: {
						type: "EF",
						objectTypes: {
							each: [{ type: "Simple", object_type: "orders" }],
							any: [{ type: "O2O", first: "orders", second: "customers", reversed: false }],
							all: [],
						},
					},
				},
			],
			viewport: { x: 0, y: 0, zoom: 1 },
		} as unknown as PersistedFlow;
		expect(typesOfOCDeclareFlow(flow)).toEqual({
			events: ["pay order", "place order"],
			objects: ["customers", "orders", "packages"],
		});
	});

	it("reads a missing or empty model as using no types", () => {
		expect(typesOfOCDeclareFlow(undefined)).toEqual({ events: [], objects: [] });
		expect(typesOfOCDeclareFlow([] as unknown as PersistedFlow)).toEqual({
			events: [],
			objects: [],
		});
	});
});
