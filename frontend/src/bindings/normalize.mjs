// json-schema-to-typescript resolves draft-07 `definitions`/`#/definitions/...` but not
// JSON-Schema-2020-12 `$defs`/`#/$defs/...`. Normalize so 2020-12 schemas (e.g. OCDeclareArc)
// compile to real types instead of degrading to `unknown`. We also down-convert 2020-12
// `prefixItems` (Rust tuples, e.g. `(String, usize)`) to draft-07 array-form `items`, which
// jsts renders as proper tuples (`[string, number]`) instead of `[unknown, unknown]`.
//
// `seen` memoizes by input-node identity so a node reachable two different ways (e.g. a
// self-recursive def's own body, reachable both as the compile root *and* as its own `$defs`
// entry -- see `registerRoot` in gen.mjs) is rebuilt exactly once and both paths end up pointing
// at the *same* output object. Without this, json-schema-to-typescript's own `$ref` dereferencing
// can no longer recognise the recursion as a cycle (it re-derives a structurally-identical but
// referentially-distinct copy every time it walks back into the "same" def) and recurses without
// bound -- confirmed empirically against `Predicate` (see git history/commit message for the
// repro). This function must stay identity-preserving; don't reintroduce a plain rebuild.
export function normalizeDefs(node, seen = new Map()) {
	if (Array.isArray(node)) {
		if (seen.has(node)) return seen.get(node);
		const out = [];
		seen.set(node, out);
		for (const v of node) out.push(normalizeDefs(v, seen));
		return out;
	}
	if (node && typeof node === "object") {
		if (seen.has(node)) return seen.get(node);
		const out = {};
		seen.set(node, out);
		for (const [k, v] of Object.entries(node)) {
			if (k === "$defs") out.definitions = normalizeDefs(v, seen);
			else if (k === "$ref" && typeof v === "string")
				out.$ref = v.replace("#/$defs/", "#/definitions/");
			else if (k === "prefixItems" && !("items" in node)) out.items = normalizeDefs(v, seen);
			else out[k] = normalizeDefs(v, seen);
		}
		return out;
	}
	return node;
}
