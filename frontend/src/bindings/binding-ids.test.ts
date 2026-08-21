import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GENERATED = path.join(HERE, "generated.ts");
const ADAPTER = path.join(HERE, "..", "BackendProviderContext.ts");

/** Keys of the generated `Bindings` interface, read from source: it is a type, so there is no
 *  runtime value to inspect. */
function generatedBindingIds(): Set<string> {
	const source = readFileSync(GENERATED, "utf8");
	const start = source.indexOf("export interface Bindings {");
	expect(start).toBeGreaterThanOrEqual(0);
	const body = source.slice(start, source.indexOf("\nexport type BindingId", start));
	return new Set([...body.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]));
}

/** Binding ids the adapter hard-codes, i.e. the first argument of every `call(...)`. */
function adapterBindingIds(): string[] {
	const source = readFileSync(ADAPTER, "utf8");
	return [...source.matchAll(/\bcall\(\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("BackendProviderContext binding ids", () => {
	const generated = generatedBindingIds();
	const used = adapterBindingIds();

	// Guards the two regexes above: a pattern that silently stops matching would otherwise turn
	// this whole file into a no-op that passes.
	it("finds both sides", () => {
		expect(generated.size).toBeGreaterThan(100);
		expect(used.length).toBeGreaterThan(20);
		expect(generated.has("app_bindings::ocel::ocel_info")).toBe(true);
		expect(used).toContain("app_bindings::ocel::ocel_info");
	});

	// A renamed or removed binding is a compile error only where the adapter's `call` is typed;
	// if that ever loosens, this still catches it here instead of at runtime in a browser.
	it("every id the adapter calls is a key of the generated Bindings interface", () => {
		expect(used.filter((id) => !generated.has(id))).toEqual([]);
	});
});
