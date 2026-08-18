// Generate TS types from backend binding metadata (schemars JSON Schema).
// Input:  ./bindings-meta.json  (dump of list_functions_meta(), written by `-p meta-gen`)
// Output: ./generated.ts

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

// A def is "cyclic" if it can reach itself by following `$ref`s (direct or transitive) --
// e.g. `Predicate`'s `And`/`Or` variants hold `Vec<Predicate>`. json-schema-to-typescript
// (15.0.4) cannot compile a cyclic def *embedded inside a different root's own compile() call*:
// re-deriving a self-recursive structure from within an unrelated ancestor's dereference pass
// recurses without bound and blows the stack (confirmed empirically -- `Predicate` alone compiles
// fine, `NodeOp` embedding a `$ref` to `Predicate` does not, even though `NodeOp` itself is not
// recursive). It compiles a cyclic def fine as long as *that def is the root being compiled* --
// so each cyclic def gets its own dedicated root (registered eagerly below), and every other
// root sees it as an opaque named reference instead of re-expanding its structure.
function findCyclicDefs(defs) {
	if (!defs) return new Set();
	const refsOf = new Map();
	const collectRefs = (node, out) => {
		if (!node || typeof node !== "object") return;
		if (typeof node.$ref === "string") {
			const m = node.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
			if (m) out.add(m[1]);
			return; // sibling keys next to `$ref` are ignored per JSON Schema -- nothing else to walk
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

// Replace *every* cyclic def -- including the root being compiled itself, if it is one -- with an
// opaque `tsType` leaf (json-schema-to-typescript's escape hatch: a schema with a `tsType` key is
// emitted as that literal text, un-walked, never dereferenced). No `title` on the stub -- leaving
// one would make json-schema-to-typescript treat it as *its own* standalone declaration site too
// (`export type Predicate = Predicate;`, self-referential and invalid); the real declaration comes
// only from the root's own top-level body (see `registerRoot`: `schema` itself keeps its real
// `oneOf`/properties, only `schema.$defs[name]` -- what internal `$ref`s resolve *to* -- is stubbed).
//
// A cyclic def's *own* root is stubbed too (not just references reached from elsewhere): naively
// keeping a genuine self-`$ref` real, so json-schema-to-typescript builds an actual circular object
// reference and de-dereferences it, sounds right and works for an array-wrapped self-reference
// (`conditions: Vec<Predicate>`) -- but @apidevtools/json-schema-ref-parser resolves a *scalar*
// self-`$ref` (`Not { condition: Box<Predicate> }`) to a *different*, non-identical clone instead of
// the same live object, so the two forms end up pointing at different (but structurally identical)
// nodes and json-schema-to-typescript names them differently, leaking an unrenamed `RootTn`
// placeholder for the scalar one (confirmed empirically: `and`/`or`'s array self-ref resolves
// correctly, `not`'s scalar self-ref does not, in the exact same compile() call). Routing every
// self-reference through the same opaque-name leaf, regardless of array/scalar shape, sidesteps
// that inconsistency entirely rather than depending on a third-party resolver quirk.
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
	// Eagerly give every cyclic def its own root *before* this one is pushed, so if this root's
	// own compile() output also (incorrectly) tries to declare a stubbed cyclic def, the real
	// declaration is already in `declByName` first and wins the dedup in the merge step below.
	// `cyclicRegistering` guards against two (transitively) mutually-cyclic defs -- e.g. A and B
	// each reachable from the other -- re-triggering each other before either finishes registering
	// (titleToRoot alone isn't set until the end of a call, which would otherwise ping-pong forever).
	for (const name of cyclic) {
		if (name !== title && defs[name] && !titleToRoot.has(name) && !cyclicRegistering.has(name)) {
			cyclicRegistering.add(name);
			// Same-object rule as in `tsType`'s `$ref` branch: no spread copy, or the cyclic def's own
			// root stops being referentially identical to its `$defs` entry and the fix is defeated.
			defs[name].title ??= name;
			registerRoot(defs[name], defs);
		}
	}
	// Carry the ambient `$defs` so nested `$ref`s still resolve when this root is compiled
	// in isolation (it may have been lifted out of an ancestor that owned the `$defs`), with
	// every *other* cyclic def opaqued out per the above. Always rebuild with the pruned table,
	// even when `schema` already carries its own `$defs` (e.g. a top-level arg/return schema) --
	// otherwise the unpruned original leaks through unchanged and the cyclic-def fix never applies.
	const prunedDefs = defs && pruneCyclicDefs(defs, cyclic);
	// Mutate in place rather than `{...schema, $defs: prunedDefs}`: when `schema` is itself a
	// cyclic def's own `$defs` entry (the "keep" case above), spreading here would produce a new
	// object no longer referentially identical to `prunedDefs[title]`, silently reintroducing the
	// same duplicate-copy problem the same-object rule above exists to avoid.
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
	// Pick up a `$defs` table declared at this level; otherwise inherit the ancestor's. Threading
	// it down is what lets nested arrays / refs (e.g. `X[][]`) resolve instead of degrading to
	// `unknown` (the `$defs` only live on the top-level return schema).
	defs = schema.$defs ?? schema.definitions ?? defs;
	// Resolve a bare `$ref` against the ambient `$defs` so refs in tuples / array items / args become
	// a real type instead of an opaque `RootTn`: object targets become a named type (via registerRoot),
	// primitive newtypes (e.g. `ObjectIndex` = u32) inline to `number`.
	const ref =
		typeof schema.$ref === "string" && schema.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
	if (ref && defs?.[ref[1]]) {
		// Recurse on the *same* def object (never a `{...defs[ref[1]]}` spread copy): a self-recursive
		// def (e.g. `Predicate`) reached both as another root's nested `$ref` and as its own dedicated
		// compile root must stay referentially identical for json-schema-to-typescript's own `$ref`
		// dereferencing to recognise the recursion as a cycle -- two structurally-identical-but-distinct
		// copies re-derive each other without bound instead (confirmed empirically). `title` is set
		// once, idempotently, directly on the shared def object rather than on a copy.
		defs[ref[1]].title ??= ref[1];
		return tsType(defs[ref[1]], defs);
	}
	const t = schema.type;
	if (t === "integer" || t === "number") return "number";
	if (t === "string" && !schema.oneOf && !schema.enum) return "string";
	if (t === "boolean") return "boolean";
	if (t === "null") return "null";
	// Tuple (Rust `(A, B)`): 2020-12 `prefixItems` (or draft-07 array-form `items`). Inline it so
	// it renders as `[A, B]` and never leaks an unnamed `RootTn` placeholder.
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
		// Mutate the (already-fresh, per-call) normalized root in place rather than spreading a
		// `{...normalized, title: name}` wrapper around it: for a cyclic def, `normalizeDefs`
		// preserves the self-reference as a genuine `normalized === normalized.definitions[X]` JS
		// cycle (see its own comment), and a further shallow copy here would immediately undo that
		// by making the compiled root a distinct object from its own `$defs` entry again.
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
		// A cyclic def's `tsType` stub (see `pruneCyclicDefs`) can still surface as a bogus
		// self-alias when some *other* root's compile() reaches it -- e.g. `export type Predicate =
		// Predicate;`. Never valid TypeScript; drop it regardless of merge order rather than relying
		// solely on the eager-registration ordering in `registerRoot` to pre-empt it. Anchored at the
		// start only (not the whole block): jsts joins consecutive named-type declarations within one
		// compile() call with a single `\n` when there's no blank-line separator, so this block can
		// carry a trailing, unrelated declaration's orphaned leading comment after the alias line --
		// dropping the whole block is still correct (that comment's declaration starts its own chunk
		// elsewhere, split at the next `\nexport `, and is unaffected).
		if (new RegExp(`^export type ${mm[1]} = ${mm[1]}\\b`).test(block.trim())) continue;
		if (!declByName.has(mm[1])) declByName.set(mm[1], block.trim());
	}
}

// Post-process: rename `RootT{n}` placeholders to their readable schemars title.
// If a structurally-equivalent type was already emitted under its title (jsts names
// nested occurrences by title), drop the placeholder declaration and alias references
// to the existing one (dedup). References are rewritten on binding entries below.
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
