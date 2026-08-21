import { describe, expect, it } from "vitest";
import { normalizeDefs } from "./normalize.mjs";

describe("normalizeDefs (codegen schema normalization)", () => {
	it("renames $defs to draft-07 definitions", () => {
		expect(normalizeDefs({ $defs: { Foo: { type: "string" } } })).toEqual({
			definitions: { Foo: { type: "string" } },
		});
	});

	it("rewrites $ref pointers from #/$defs to #/definitions", () => {
		expect(normalizeDefs({ $ref: "#/$defs/Foo" })).toEqual({ $ref: "#/definitions/Foo" });
	});

	it("down-converts prefixItems to array-form items (Rust tuple -> [A, B])", () => {
		const out = normalizeDefs({
			type: "array",
			prefixItems: [{ type: "string" }, { type: "integer" }],
			minItems: 2,
			maxItems: 2,
		});
		expect(out.items).toEqual([{ type: "string" }, { type: "integer" }]);
		expect(out.prefixItems).toBeUndefined();
	});

	it("does not overwrite an existing items when prefixItems is also present", () => {
		const out = normalizeDefs({ items: { type: "string" }, prefixItems: [{ type: "number" }] });
		expect(out.items).toEqual({ type: "string" });
	});

	it("recurses into nested structures", () => {
		const out = normalizeDefs({ properties: { a: { $ref: "#/$defs/X" } } });
		expect(out.properties.a.$ref).toBe("#/definitions/X");
	});

	it("passes primitives through unchanged", () => {
		expect(normalizeDefs(5)).toBe(5);
		expect(normalizeDefs(null)).toBe(null);
	});

	// The memo is load-bearing, not an optimization: json-schema-to-typescript only recognises a
	// cycle when the two paths to a self-recursive def reach the *same* object.
	it("rebuilds a node reachable two ways into one shared output object", () => {
		const shared = { type: "object", properties: { self: { $ref: "#/$defs/Node" } } };
		const out = normalizeDefs({ anyOf: [shared], $defs: { Node: shared } });
		expect(out.definitions.Node).toBe(out.anyOf[0]);
		expect(out.definitions.Node.properties.self.$ref).toBe("#/definitions/Node");
	});

	it("terminates on a self-referential input instead of overflowing the stack", () => {
		const node = { type: "object" };
		node.child = node;
		const out = normalizeDefs(node);
		expect(out.child).toBe(out);
	});
});
