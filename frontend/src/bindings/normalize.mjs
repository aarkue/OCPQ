// Downgrades 2020-12 `$defs`/`prefixItems` to draft-07 `definitions`/`items`, which jsts resolves.
// `seen` preserves node identity so a cyclic def maps to one output object; don't rebuild plainly.
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
