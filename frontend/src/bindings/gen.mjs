// Generate TS types (./generated.ts) from backend binding metadata (./bindings-meta.json,
// written by `-p meta-gen`).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import { normalizeDefs } from "./normalize.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const metas = JSON.parse(readFileSync(join(here, "bindings-meta.json"), "utf8"));

const JSTS_OPTS = {
	bannerComment: "",
	declareExternallyReferenced: true,
	additionalProperties: false,
	format: false,
};

const handleRefs = new Set();
const namedRoots = []; // { schema, title }
const titleToRoot = new Map(); // dedup identical types by schemars title
const cyclicRegistering = new Set(); // guards eager cyclic-root registration against mutual cycles

const sanitize = (s) => s.replace(/[^A-Za-z0-9_]/g, "_");

// A def is "cyclic" if it can reach itself via `$ref` (e.g. `Predicate`'s `And`/`Or` holding
// `Vec<Predicate>`). json-schema-to-typescript blows the stack compiling one embedded inside
// another root, so each cyclic def gets its own dedicated root, referenced opaquely elsewhere.
function findCyclicDefs(defs) {
	if (!defs) return new Set();
	const refsOf = new Map();
	const collectRefs = (node, out) => {
		if (!node || typeof node !== "object") return;
		if (typeof node.$ref === "string") {
			const m = node.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
			if (m) out.add(m[1]);
			return; // sibling keys next to `$ref` are ignored per JSON Schema, nothing else to walk
		}
		for (const v of Object.values(node)) {
			if (Array.isArray(v)) {
				for (const x of v) collectRefs(x, out);
			} else {
				collectRefs(v, out);
			}
		}
	};
	for (const name of Object.keys(defs)) {
		const out = new Set();
		collectRefs(defs[name], out);
		refsOf.set(name, out);
	}
	const cyclic = new Set();
	for (const start of refsOf.keys()) {
		const seen = new Set();
		const stack = [...refsOf.get(start)];
		while (stack.length) {
			const cur = stack.pop();
			if (cur === start) {
				cyclic.add(start);
				break;
			}
			if (seen.has(cur)) continue;
			seen.add(cur);
			for (const next of refsOf.get(cur) || []) stack.push(next);
		}
	}
	return cyclic;
}

// Replace every cyclic def with an opaque untitled `tsType` leaf (json-schema-to-typescript's
// escape hatch, emitted as literal text and never dereferenced) so a self-`$ref` never triggers
// an invalid self-aliased declaration or an inconsistent scalar-vs-array resolver clone.
function pruneCyclicDefs(defs, cyclic) {
	if (!defs || cyclic.size === 0) return defs;
	const pruned = {};
	for (const [name, value] of Object.entries(defs)) {
		pruned[name] = cyclic.has(name) ? { tsType: sanitize(name) } : value;
	}
	return pruned;
}

// Roots are compiled under stable `RootT{n}` placeholders (json-schema-to-typescript
// leaves these untouched, unlike titles which it normalizes). After generation we
// rename each placeholder to its readable schemars title in a post-process pass.
function registerRoot(schema, defs) {
	const title = schema.title;
	if (title && titleToRoot.has(title)) return titleToRoot.get(title);
	const cyclic = findCyclicDefs(defs);
	// Eagerly register every cyclic def as its own root first, so this root's compile() can't race
	// it into a stubbed duplicate; `cyclicRegistering` guards mutually-cyclic defs from ping-ponging.
	for (const name of cyclic) {
		if (name !== title && defs[name] && !titleToRoot.has(name) && !cyclicRegistering.has(name)) {
			cyclicRegistering.add(name);
			// No spread copy: must stay referentially identical to its `$defs` entry.
			defs[name].title ??= name;
			registerRoot(defs[name], defs);
		}
	}
	// Carry the ambient `$defs` (pruned of other cyclic defs) so nested `$ref`s still resolve.
	const prunedDefs = defs && pruneCyclicDefs(defs, cyclic);
	// Mutate in place, never spread-copy: would break referential identity with `prunedDefs[title]`.
	if (prunedDefs) schema.$defs = prunedDefs;
	const stored = schema;
	const name = `RootT${namedRoots.length}`;
	namedRoots.push({ schema: stored, title });
	if (title) titleToRoot.set(title, name);
	return name;
}

function tsType(schema, defs) {
	if (!schema || typeof schema !== "object") return "unknown";
	if (schema["x-registry-ref"]) {
		handleRefs.add(schema["x-registry-ref"]);
		return `${sanitize(schema["x-registry-ref"])}Handle`;
	}
	// Threaded down so nested arrays/refs resolve instead of degrading to `unknown`.
	defs = schema.$defs ?? schema.definitions ?? defs;
	const ref =
		typeof schema.$ref === "string" && schema.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
	if (ref && defs?.[ref[1]]) {
		// Recurse on the same def object, never a spread copy: a self-recursive def must stay
		// referentially identical for jsts's own `$ref` dereferencing to recognize the cycle.
		defs[ref[1]].title ??= ref[1];
		return tsType(defs[ref[1]], defs);
	}
	const t = schema.type;
	if (t === "integer" || t === "number") return "number";
	if (t === "string" && !schema.oneOf && !schema.enum) return "string";
	if (t === "boolean") return "boolean";
	if (t === "null") return "null";
	// Tuple (Rust `(A, B)`): inline so it renders as `[A, B]`, not an unnamed `RootTn` placeholder.
	const tuple = Array.isArray(schema.prefixItems)
		? schema.prefixItems
		: Array.isArray(schema.items)
			? schema.items
			: null;
	if (t === "array" && tuple) {
		return `[${tuple.map((s) => tsType(s, defs)).join(", ")}]`;
	}
	if (t === "array" && schema.items && !schema.items.oneOf) {
		return `${tsType(schema.items, defs)}[]`;
	}
	return registerRoot(schema, defs);
}

const bindingEntries = [];
const retTitleById = {}; // binding id -> return-type schemars title (null when unnamed)
const titleSet = new Set();
const titleToTs = new Map(); // return-type title -> ts expression (same title = same schema)
for (const m of metas) {
	const required = new Set(m.required_args || []);
	const argParts = m.args.map(([name, schema]) => {
		const opt = required.has(name) ? "" : "?";
		return `    ${JSON.stringify(name)}${opt}: ${tsType(schema)};`;
	});
	const retTy = tsType(m.return_type);
	const argsBlock = argParts.length ? `{\n${argParts.join("\n")}\n    }` : "{}";
	bindingEntries.push(`  ${JSON.stringify(m.id)}: { args: ${argsBlock}; ret: ${retTy} };`);
	const title = m.return_type?.title ?? null;
	retTitleById[m.id] = title;
	if (title) {
		titleSet.add(title);
		if (!titleToTs.has(title)) titleToTs.set(title, retTy);
	}
}

const declByName = new Map();
const declRe = /export\s+(?:interface|type)\s+([A-Za-z0-9_]+)/;
const failures = [];
for (let idx = 0; idx < namedRoots.length; idx++) {
	const name = `RootT${idx}`;
	let out;
	try {
		// Mutate the fresh normalized root in place, never spread-copy: `normalizeDefs` preserves a
		// cyclic def's self-reference as a real JS cycle, which a copy here would break.
		const normalized = normalizeDefs(namedRoots[idx].schema);
		normalized.title = name;
		out = await compile(normalized, name, JSTS_OPTS);
	} catch (e) {
		out = `export type ${name} = unknown; // compile failed: ${e.message}`;
		failures.push({ name, title: namedRoots[idx].title, error: e.message });
	}
	for (const block of out.split(/\n(?=export )/)) {
		const mm = block.match(declRe);
		if (!mm) continue;
		// A cyclic def's stub can still surface as a bogus self-alias (`export type Predicate =
		// Predicate;`) from another root's compile(); never valid TS, so drop the whole block.
		if (new RegExp(`^export type ${mm[1]} = ${mm[1]}\\b`).test(block.trim())) continue;
		if (!declByName.has(mm[1])) declByName.set(mm[1], block.trim());
	}
}

// Rename `RootT{n}` placeholders to their readable schemars title, deduping against any
// structurally-equivalent type already emitted under that title.
const rootRename = new Map(); // RootTn -> readable name
for (let idx = 0; idx < namedRoots.length; idx++) {
	const root = `RootT${idx}`;
	const { title } = namedRoots[idx];
	if (!title || !declByName.has(root)) continue;
	const desired = sanitize(title);
	if (desired === root) continue;
	if (declByName.has(desired)) {
		declByName.delete(root); // twin already exists -> dedup
	} else {
		const decl = declByName
			.get(root)
			.replace(new RegExp(`(export (?:interface|type) )${root}\\b`), `$1${desired}`);
		declByName.delete(root);
		declByName.set(desired, decl);
	}
	rootRename.set(root, desired);
}

const applyRename = (s) =>
	rootRename.size === 0 ? s : s.replace(/\bRootT\d+\b/g, (m) => rootRename.get(m) ?? m);

const handleDecls = [...handleRefs]
	.sort()
	.map((r) => `export type ${sanitize(r)}Handle = Handle<${JSON.stringify(r)}>;`)
	.join("\n");

const retTitles = [...titleSet].sort();
const retTypesEntries = retTitles
	.map((t) => `  ${JSON.stringify(sanitize(t))}: ${JSON.stringify(t)},`)
	.join("\n");
const retShapeEntries = retTitles
	.map((t) => `  ${JSON.stringify(t)}: ${titleToTs.get(t)};`)
	.join("\n");
const bindingRetEntries = metas
	.map(
		(m) =>
			`  ${JSON.stringify(m.id)}: ${retTitleById[m.id] ? JSON.stringify(retTitleById[m.id]) : "null"},`,
	)
	.join("\n");

const output = `// AUTO-GENERATED from backend binding metadata. Do not edit.
// Regenerate with \`pnpm codegen\` in frontend/.

/** A registry-stored object referenced by id; never the value itself. */
export type Handle<T extends string> = string & { readonly __ref: T };

${handleDecls}

${applyRename([...declByName.values()].join("\n\n"))}

export interface Bindings {
${applyRename(bindingEntries.join("\n"))}
}

export type BindingId = keyof Bindings;

/** Typed dispatch. Runtime decodes the binding's Vec<u8> JSON; types are compile-time only.
 *  \`opts.outputName\` deterministically names a minted result handle (pipeline intermediates). */
export type CallBinding = <K extends BindingId>(id: K, args: Bindings[K]["args"], opts?: { outputName?: string }) => Promise<Bindings[K]["ret"]>;

/** The untyped dispatch each transport implements once (http fetch / tauri invoke / wasm direct);
 *  supplied by the host app, which is what keeps this file transport-agnostic. */
export type BindingTransport = (id: BindingId, args: unknown, opts?: { outputName?: string }) => Promise<unknown>;

/** Put the generated types back on top of a host-supplied transport. */
export function createBindingClient(transport: BindingTransport): CallBinding {
  return <K extends BindingId>(id: K, args: Bindings[K]["args"], opts?: { outputName?: string }) =>
    transport(id, args, opts) as Promise<Bindings[K]["ret"]>;
}

/** Distinct return-type titles, keyed for rename-safe reference from viewer \`accepts\` predicates. */
export const RETURN_TYPES = {
${retTypesEntries}
} as const;

/** Every value a binding's return type can be matched on by the viewer registry. */
export type ReturnTypeTitle = (typeof RETURN_TYPES)[keyof typeof RETURN_TYPES];

/** Return-type title -> decoded payload type, so a viewer registration can pin its per-title
 *  transform/component to the actual binding payload shape instead of trusting the title string. */
export interface ReturnTypeShape {
${applyRename(retShapeEntries)}
}

/** Each binding's return-type title (null when the return type is unnamed, e.g. a tuple/primitive). */
export const BINDING_RETURN_TYPE: Record<BindingId, ReturnTypeTitle | null> = {
${bindingRetEntries}
};
`;

writeFileSync(join(here, "generated.ts"), output);
console.log(
	`generated.ts: ${metas.length} bindings, ${declByName.size} types, ${handleRefs.size} handles, ${retTitles.length} return types`,
);

if (failures.length > 0) {
	console.error(
		`\ncodegen FAILED: ${failures.length} type(s) did not compile (emitted as \`unknown\`):`,
	);
	for (const f of failures) console.error(`  - ${f.title ?? f.name}: ${f.error}`);
	process.exitCode = 1;
}
