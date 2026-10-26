import type { BindingBox } from "@/types/generated/BindingBox";
import type { BindingBoxTree } from "@/types/generated/BindingBoxTree";
import type { Constraint } from "@/types/generated/Constraint";
import type { Filter } from "@/types/generated/Filter";
import type { SizeFilter } from "@/types/generated/SizeFilter";
import type { ValueFilter } from "@/types/generated/ValueFilter";
import type { Variable } from "@/types/generated/Variable";
import { type Timing, timingOf } from "./box/filter-editors/time-between";

export type SentenceVar = { kind: "object" | "event"; index: number };
export type SentencePart =
	| { kind: "text"; text: string }
	/** `label` is `type` inflected for the sentence, e.g., "order" for the type "orders". */
	| { kind: "type"; type: string; label: string; isEvent: boolean }
	| { kind: "var"; variable: SentenceVar }
	| { kind: "code"; text: string };
export type QuerySentence = { parts: SentencePart[]; notes: SentencePart[][] };

// The sentence is built as a string with tokens between these private-use characters, so type
// names and CEL code never collide with the markup.
const OPEN = "";
const CLOSE = "";
const SEP = "";

type Var = { key: string; kind: "o" | "e"; index: number; types: string[] };
const keyOf = (kind: "o" | "e", index: number) => `${kind}${index}`;
const keyOfVariable = (v: Variable) => ("Object" in v ? keyOf("o", v.Object) : keyOf("e", v.Event));
const ref = (key: string) => `${OPEN}V${SEP}${key}${CLOSE}`;
/** A variable's name where it is introduced, dropped if nothing else in the sentence refers to it. */
const intro = (key: string) => `${OPEN}I${SEP}${key}${CLOSE}`;
const code = (text: string) => `${OPEN}C${SEP}${text}${CLOSE}`;
const typeToken = (type: string, label: string, isEvent: boolean) =>
	`${OPEN}T${SEP}${isEvent ? "e" : "o"}${SEP}${label}${SEP}${type}${CLOSE}`;

const isWordy = (t: string) => /^[a-z][a-z ]*$/.test(t);
/** Only plain lowercase type names change. "Case_R" or "Offer" stay as they are. */
export function singularOf(type: string) {
	if (!isWordy(type)) return type;
	if (type.endsWith("ies")) return `${type.slice(0, -3)}y`;
	if (/(x|z|ch|sh|ss)es$/.test(type)) return type.slice(0, -2);
	// Not "address" or "status".
	if (/[^su]s$/.test(type)) return type.slice(0, -1);
	return type;
}
export function pluralOf(type: string) {
	if (!/^[A-Za-z][A-Za-z ]*$/.test(type) || type.endsWith("s")) return type;
	if (/[^aeiou]y$/.test(type)) return `${type.slice(0, -1)}ies`;
	return `${type}s`;
}

function typeLabel(v: Var, plural: boolean) {
	const types = v.types.map((t) =>
		typeToken(t, v.kind === "e" ? t : plural ? pluralOf(t) : singularOf(t), v.kind === "e"),
	);
	const joined = types.join(" or ");
	return v.kind === "e" ? `${joined} event${plural ? "s" : ""}` : joined;
}
const firstLetter = (v: Var) => (v.kind === "e" ? v.types[0] : singularOf(v.types[0] ?? ""));
const article = (v: Var) => (/^[aeiou]/i.test(firstLetter(v)) ? "an" : "a");
const joinAnd = (xs: string[]) =>
	xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

const UNITS = [
	["week", 7 * 86400],
	["day", 86400],
	["hour", 3600],
	["minute", 60],
	["second", 1],
] as const;
/** The largest unit that shows the duration in halves: 24.5 days are "3.5 weeks", 10 days "10 days". */
export function durationWords(seconds: number) {
	const abs = Math.abs(seconds);
	const [unit, size] =
		UNITS.find(([, s]) => abs / s >= 1 && Number.isInteger((abs / s) * 2)) ??
		UNITS.find(([, s]) => abs >= s) ??
		UNITS[UNITS.length - 1];
	const n = Math.round((abs / size) * 100) / 100;
	return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Where an event lies relative to `from`, e.g., "at most 3 weeks after e1". */
function timingPhrase(t: Timing, from: string): string {
	const d = durationWords;
	switch (t.kind) {
		case "any":
			return `at or ${t.direction} ${from}`;
		case "atLeast":
			return `at least ${d(t.seconds)} ${t.direction} ${from}`;
		case "atMost":
			return `at most ${d(t.seconds)} ${t.direction} ${from}`;
		case "between":
			return `${d(Math.min(t.from, t.to))} to ${d(Math.max(t.from, t.to))} ${t.direction} ${from}`;
		case "within":
			return `within ${d(t.seconds)} of ${from}`;
		case "range": {
			if (t.min === null && t.max === null) return `at any time around ${from}`;
			const bound = (s: number) => `${d(s)} ${s < 0 ? "before" : "after"}`;
			const lo = t.min === null ? "any time before" : bound(t.min);
			const hi = t.max === null ? "any time after" : bound(t.max);
			return `from ${lo} to ${hi} ${from}`;
		}
	}
}

/** Where `event` lies relative to the other event of `f`, which bounds `time(to) - time(from)`. */
function timingOfEvent(f: Filter & { type: "TimeBetweenEvents" }, event: number) {
	const neg = (x: number | null) => (x === null ? null : x === 0 ? 0 : -x);
	return f.to_event === event
		? timingOf(f.min_seconds, f.max_seconds)
		: timingOf(neg(f.max_seconds), neg(f.min_seconds));
}

function quantity(min: number | null | undefined, max: number | null | undefined): string {
	const lo = min ?? null;
	const hi = max ?? null;
	if (lo !== null && hi !== null) {
		if (lo === hi) return lo === 0 ? "no" : lo === 1 ? "exactly one" : `exactly ${lo}`;
		if (lo <= 0) return hi === 0 ? "no" : hi === 1 ? "at most one" : `at most ${hi}`;
		return `between ${lo} and ${hi}`;
	}
	if (lo !== null && lo > 0) return lo === 1 ? "at least one" : `at least ${lo}`;
	if (hi !== null) return hi === 0 ? "no" : hi === 1 ? "at most one" : `at most ${hi}`;
	return "any number of";
}
const isSingular = (q: string) =>
	q === "exactly one" || q === "at least one" || q === "at most one";
const isExistential = (q: string) => q === "at least one" || q === "no";

type Modal = "is" | "should";
const be = (m: Modal) => (m === "is" ? "is" : "should be");

function valuePhrase(vf: ValueFilter, m: Modal): string {
	switch (vf.type) {
		case "Float":
		case "Integer": {
			const lo = vf.min ?? null;
			const hi = vf.max ?? null;
			if (lo !== null && hi !== null) return `${be(m)} between ${lo} and ${hi}`;
			if (lo !== null) return `${be(m)} at least ${lo}`;
			if (hi !== null) return `${be(m)} at most ${hi}`;
			return `${be(m)} any number`;
		}
		case "Boolean":
			return `${be(m)} ${vf.is_true ? "true" : "false"}`;
		case "String":
			return vf.is_in.length <= 2
				? `${be(m)} ${vf.is_in.map((s) => `"${s}"`).join(" or ")}`
				: `${be(m)} one of ${joinAnd(vf.is_in.map((s) => `"${s}"`)).replace(/ and ([^,]*)$/, " or $1")}`;
		case "Time":
			return `${be(m)} between ${vf.from ?? "the start"} and ${vf.to ?? "the end"}`;
	}
}

function attributePhrase(f: Filter, m: Modal): string | undefined {
	if (f.type === "EventAttributeValueFilter")
		return `${f.attribute_name} ${valuePhrase(f.value_filter, m)}`;
	if (f.type === "ObjectAttributeValueFilter") {
		const when =
			f.at_time.type === "Always"
				? " at all times"
				: f.at_time.type === "Sometime"
					? " at some point"
					: ` at ${ref(keyOf("e", f.at_time.event))}`;
		return `${f.attribute_name} ${valuePhrase(f.value_filter, m)}${when}`;
	}
	return undefined;
}

/** A filter as a clause of its own, e.g., "e2 should be at most 3 weeks after e1". */
function condition(f: Filter, m: Modal): string {
	const q = "qualifier" in f && f.qualifier ? ` as "${f.qualifier}"` : "";
	const verb = (present: string, base: string) => (m === "is" ? present : `should ${base}`);
	switch (f.type) {
		case "O2E":
			return `${ref(keyOf("e", f.event))} ${verb("involves", "involve")} ${ref(keyOf("o", f.object))}${q}`;
		case "O2O":
			return `${ref(keyOf("o", f.object))} ${be(m)} linked to ${ref(keyOf("o", f.other_object))}${q}`;
		case "TimeBetweenEvents":
			return `${ref(keyOf("e", f.to_event))} ${be(m)} ${timingPhrase(timingOf(f.min_seconds, f.max_seconds), ref(keyOf("e", f.from_event)))}`;
		case "NotEqual":
			return `${ref(keyOfVariable(f.var_1))} and ${ref(keyOfVariable(f.var_2))} ${m === "is" ? "are" : "should be"} different`;
		case "EventAttributeValueFilter":
			return `the ${f.attribute_name} of ${ref(keyOf("e", f.event))} ${attributePhrase(f, m)?.slice(f.attribute_name.length + 1)}`;
		case "ObjectAttributeValueFilter":
			return `the ${f.attribute_name} of ${ref(keyOf("o", f.object))} ${attributePhrase(f, m)?.slice(f.attribute_name.length + 1)}`;
		case "BasicFilterCEL":
			return `${code(f.cel)} ${verb("holds", "hold")}`;
	}
}

type Link = { other: string; filter: Filter; rel: "of" | "involved" | "linked" };
function linksOf(v: Var, filters: Filter[]): Link[] {
	const links: Link[] = [];
	for (const f of filters) {
		if (f.type === "O2E") {
			if (v.kind === "e" && f.event === v.index)
				links.push({ other: keyOf("o", f.object), filter: f, rel: "of" });
			if (v.kind === "o" && f.object === v.index)
				links.push({ other: keyOf("e", f.event), filter: f, rel: "involved" });
		} else if (f.type === "O2O" && v.kind === "o") {
			if (f.object === v.index && f.other_object !== v.index)
				links.push({ other: keyOf("o", f.other_object), filter: f, rel: "linked" });
			else if (f.other_object === v.index)
				links.push({ other: keyOf("o", f.object), filter: f, rel: "linked" });
		}
	}
	return links;
}

type Item = {
	v: Var;
	anchor?: Link;
	/** The anchor is a variable of an outer box, so the phrase has to name the tie. */
	anchorOuter: boolean;
	/** Further ties to variables introduced earlier, said after the variable. */
	extras: Link[];
	mods: string[];
	children: Item[];
};

type Scope = {
	tree: BindingBoxTree;
	vars: Map<string, Var>;
	/** The outer variable this box hangs from. Ties to it go unsaid ("its items"). */
	subject?: string;
	notes: string[];
};

/** A box's variables arranged as a tree around its first variable, with the filters that tie them
 *  said as part of the phrase. Filters that fit nowhere come back in `rest`. */
function arrange(box: BindingBox, scope: Scope) {
	const vars: Var[] = [
		...Object.entries(box.newObjectVars).map(([i, types]) => ({
			key: keyOf("o", +i),
			kind: "o" as const,
			index: +i,
			types,
		})),
		...Object.entries(box.newEventVars).map(([i, types]) => ({
			key: keyOf("e", +i),
			kind: "e" as const,
			index: +i,
			types,
		})),
	];
	const used = new Set<Filter>();
	const order: string[] = [...scope.vars.keys()];
	let connected = false;
	const items = new Map<string, Item>();
	const head = vars[0];
	const rank = (l: Link) =>
		l.other === head?.key ? 0 : items.has(l.other) ? 1 : l.other === scope.subject ? 2 : 3;
	const place = (v: Var) => {
		const links = linksOf(v, box.filters).filter(
			(l) => !used.has(l.filter) && order.includes(l.other),
		);
		links.sort((a, b) => rank(a) - rank(b));
		for (const l of links) used.add(l.filter);
		if (links.some((l) => scope.vars.has(l.other))) connected = true;
		const [anchor, ...extras] = links;
		items.set(v.key, {
			v,
			anchor,
			anchorOuter: anchor !== undefined && scope.vars.has(anchor.other),
			extras: extras.filter(
				(l) => l.other !== scope.subject || ("qualifier" in l.filter && l.filter.qualifier),
			),
			mods: [],
			children: [],
		});
		order.push(v.key);
	};
	if (head) place(head);
	let pending = vars.slice(1);
	while (pending.length > 0) {
		const ready = pending.filter((v) =>
			linksOf(v, box.filters).some((l) => !used.has(l.filter) && order.includes(l.other)),
		);
		const next = ready[0] ?? pending[0];
		place(next);
		pending = pending.filter((v) => v !== next);
	}

	for (const f of box.filters) {
		if (used.has(f)) continue;
		if (f.type === "TimeBetweenEvents") {
			const [a, b] = [keyOf("e", f.from_event), keyOf("e", f.to_event)];
			const later = order.indexOf(a) > order.indexOf(b) ? a : b;
			const item = items.get(later);
			if (item && order.includes(a) && order.includes(b)) {
				const other = later === a ? b : a;
				item.mods.push(timingPhrase(timingOfEvent(f, item.v.index), ref(other)));
				used.add(f);
			}
		} else if (f.type === "EventAttributeValueFilter" || f.type === "ObjectAttributeValueFilter") {
			const item = items.get(
				f.type === "EventAttributeValueFilter" ? keyOf("e", f.event) : keyOf("o", f.object),
			);
			if (item) {
				// Attribute conditions come first, in filter order: "whose a is 1 and whose b is 2".
				const phrase = `whose ${attributePhrase(f, "is")}`;
				const last = item.mods.reduce((at, mod, i) => (/^(and )?whose /.test(mod) ? i : at), -1);
				item.mods.splice(last + 1, 0, last === -1 ? phrase : `and ${phrase}`);
				used.add(f);
			}
		} else if (f.type === "NotEqual") {
			const [a, b] = [keyOfVariable(f.var_1), keyOfVariable(f.var_2)];
			const later = order.indexOf(a) > order.indexOf(b) ? a : b;
			const item = items.get(later);
			if (item) {
				item.mods.push(`other than ${ref(later === a ? b : a)}`);
				used.add(f);
			}
		}
	}
	for (const it of items.values()) {
		const parent = it.anchor && items.get(it.anchor.other);
		if (parent && it !== items.get(head?.key ?? "")) parent.children.push(it);
	}
	for (const v of vars) scope.vars.set(v.key, v);
	const rest = box.filters.filter((f) => !used.has(f)).map((f) => condition(f, "is"));
	return { head: head && items.get(head.key), items, rest, connected };
}

const qualifierOf = (l: Link) =>
	"qualifier" in l.filter && l.filter.qualifier ? ` (as "${l.filter.qualifier}")` : "";

function tieWords(l: Link) {
	const to = ref(l.other);
	return l.rel === "of"
		? `of ${to}`
		: l.rel === "involved"
			? `involved in ${to}`
			: `linked to ${to}`;
}

/** One variable with its modifiers and the variables hanging from it, without a determiner. */
function itemPhrase(it: Item, head: Item | undefined, scope: Scope, plural: boolean): string {
	const parts = [`${typeLabel(it.v, plural)}${intro(it.v.key)}`];
	const a = it.anchor;
	// Like the head, a variable of the subject needs no "of o2" after "each of its items o2 should
	// have".
	if (a && it.anchorOuter && a.other !== scope.subject)
		parts.push(`${tieWords(a)}${qualifierOf(a)}`);
	else if (a && qualifierOf(a)) parts.push(qualifierOf(a).trim());
	if (it.extras.length > 0)
		parts.push(`also ${joinAnd(it.extras.map((l) => `${tieWords(l)}${qualifierOf(l)}`))}`);
	parts.push(...it.mods);
	const kids = it.children.map((c) => `${article(c.v)} ${itemPhrase(c, head, scope, false)}`);
	if (kids.length > 0) {
		const lead =
			it.v.kind === "o"
				? it.children.every((c) => c.v.kind === "e")
					? "that has"
					: "with"
				: "involving";
		parts.push(`${lead} ${joinAnd(kids)}`);
	}
	return parts.join(" ");
}

type Phrase = { text: string; head?: Item; tiedToSubject: boolean; connected: boolean };

/** A box as a noun phrase without its determiner: "order with a place order event e1 and at most
 *  10 items". Size filters of the box join the "with" list. */
function boxPhrase(boxIndex: number, scope: Scope, plural: boolean): Phrase {
	const node = scope.tree.nodes[boxIndex];
	if (!node || !("Box" in node))
		return { text: "matches of a sub-query", tiedToSubject: false, connected: false };
	const [box] = node.Box;
	const { head, items, rest, connected } = arrange(box, scope);
	if (!head) {
		const sizes = box.sizeFilters.map((sf) => sizePhrase(sf, boxIndex, scope, undefined));
		return {
			text: sizes.length ? `binding with ${joinAnd(sizes)}` : "",
			tiedToSubject: false,
			connected,
		};
	}
	const tiedToSubject = head.anchor?.other === scope.subject && scope.subject !== undefined;
	const parts = [`${typeLabel(head.v, plural)}${intro(head.v.key)}`];
	if (head.anchor && !tiedToSubject)
		parts.push(`${tieWords(head.anchor)}${qualifierOf(head.anchor)}`);
	else if (head.anchor && qualifierOf(head.anchor)) parts.push(qualifierOf(head.anchor).trim());
	parts.push(...head.mods);
	const outerTied = [...items.values()].filter(
		(it) => it !== head && it.anchor && !items.has(it.anchor.other),
	);
	const withParts = [
		...head.children.map((c) => `${article(c.v)} ${itemPhrase(c, head, scope, false)}`),
		...box.sizeFilters.map((sf) => sizePhrase(sf, boxIndex, scope, head.v.key)),
	];
	if (withParts.length > 0)
		parts.push(
			`${head.v.kind === "e" && head.children.every((c) => c.v.kind === "o") && box.sizeFilters.length === 0 ? "involving" : "with"} ${joinAnd(withParts)}`,
		);
	// Tied to an outer variable, not to the head, so neither "with" nor "involving" fits: "a
	// confirm order event e1 and a package delivered event at most 2 weeks after e1".
	const tied = outerTied.map((c) => `${article(c.v)} ${itemPhrase(c, head, scope, false)}`);
	if (tied.length > 0) parts.push(`and ${joinAnd(tied)}`);
	const loose = [...items.values()].filter((it) => it !== head && !it.anchor);
	for (const it of loose) parts.push(`and any ${itemPhrase(it, head, scope, false)}`);
	if (rest.length > 0) parts.push(`where ${joinAnd(rest)}`);
	return { text: parts.join(" "), head, tiedToSubject, connected };
}

function childIndex(scope: Scope, parent: number, name: string) {
	return scope.tree.edgeNames.find(([[p], n]) => p === parent && n === name)?.[0][1];
}

const scopeFor = (scope: Scope, subject: string | undefined): Scope => ({
	tree: scope.tree,
	vars: new Map(scope.vars),
	subject,
	notes: scope.notes,
});

/** A counted child set: "at least one pay order event e2 at most 3 weeks after e1". */
function countedChild(child: number, scope: Scope, q: string, subject?: string) {
	const inner = scopeFor(scope, subject);
	const node = scope.tree.nodes[child];
	const box = node && "Box" in node ? node.Box[0] : undefined;
	const p = boxPhrase(child, inner, !isSingular(q));
	const h = p.head;
	// "50 payment reminder events of its orders" counts what the box binds, (order, reminder) pairs,
	// where "50 orders with a payment reminder event" would read as 50 orders.
	const kid = h?.children[0];
	if (
		box &&
		h &&
		kid &&
		!isSingular(q) &&
		!isExistential(q) &&
		h.v.kind === "o" &&
		kid.v.kind === "e" &&
		h.children.length === 1 &&
		kid.children.length === 0 &&
		box.sizeFilters.length === 0 &&
		inner.vars.size - scope.vars.size === 2
	) {
		const owner = p.tiedToSubject ? "its" : "the";
		return `${q} ${typeLabel(kid.v, true)}${intro(kid.v.key)}${kid.mods.length ? ` ${kid.mods.join(" ")}` : ""} of ${owner} ${typeLabel(h.v, true)}${intro(h.v.key)}`;
	}
	const fresh = box
		? Object.keys(box.newObjectVars).length + Object.keys(box.newEventVars).length
		: 0;
	if (fresh > 1 && h && q !== "at least one" && q !== "no") {
		const others = [...inner.vars.values()].filter(
			(v) => !scope.vars.has(v.key) && v.key !== h.v.key,
		);
		scope.notes.push(
			`"${q}" counts each ${typeLabel(h.v, false)} once per ${joinAnd(others.map((v) => typeLabel(v, false)))}.`,
		);
	}
	return `${q} ${p.text}`;
}

function sizePhrase(sf: SizeFilter, boxIndex: number, scope: Scope, subject?: string): string {
	switch (sf.type) {
		case "NumChilds": {
			const c = childIndex(scope, boxIndex, sf.child_name);
			const q = quantity(sf.min, sf.max);
			return c === undefined ? `${q} ${sf.child_name}` : countedChild(c, scope, q, subject);
		}
		case "NumChildsProj":
			return `${quantity(sf.min, sf.max)} different ${ref(keyOfVariable(sf.var_name))} in ${sf.child_name}`;
		case "BindingSetEqual":
			return `the same matches in ${joinAnd(sf.child_names)}`;
		case "BindingSetProjectionEqual":
			return `the same ${sf.child_name_with_var_name.map(([c, v]) => `${ref(keyOfVariable(v))} in ${c}`).join(" as ")}`;
		case "AdvancedCEL":
			return code(sf.cel);
	}
}

/** A requirement of a box. "subject" clauses read "<subject> should ...", "free" ones carry their
 *  own subject, "each" ones quantify over a child set. */
type Clause =
	| { kind: "subject"; text: string }
	| { kind: "free"; text: string }
	| { kind: "each"; lead: string; inner: Clause[] };

function clausesOf(boxIndex: number, scope: Scope, head?: Item): Clause[] {
	const node = scope.tree.nodes[boxIndex];
	if (!node || !("Box" in node)) return [];
	const [box] = node.Box;
	const subject = head?.v.key;
	const forChild = (name: string, det: "each" | "some" | "none"): Clause | undefined => {
		const c = childIndex(scope, boxIndex, name);
		if (c === undefined) return { kind: "free", text: `${name} should be satisfied` };
		const asFilters = det !== "each" ? withConstraintsAsFilters(scope.tree, c) : undefined;
		if (asFilters) {
			// "at least one item whose weight is at most 5" says exactly what ANY/NOT check, without a
			// separate clause about the item.
			const q = det === "some" ? "at least one" : "no";
			const s2 = { ...scopeFor(scope, subject), tree: asFilters };
			const p = boxPhrase(c, { ...s2, vars: new Map(s2.vars) }, false);
			const counted = countedChild(c, s2, q, subject);
			if (!p.connected) return { kind: "free", text: `there should be ${counted}` };
			const involve = head?.v.kind === "e" && p.head?.v.kind === "o";
			return { kind: "subject", text: `${involve ? "involve" : "have"} ${counted}` };
		}
		const inner = scopeFor(scope, subject);
		const p = boxPhrase(c, inner, true);
		const innerClauses = clausesOf(c, inner, p.head);
		const its = p.tiedToSubject;
		if (innerClauses.length === 0) {
			if (det === "each") return undefined;
			const q = det === "some" ? "at least one" : "no";
			const one = det === "some" ? boxPhrase(c, scopeFor(scope, subject), false).text : p.text;
			return its
				? { kind: "subject", text: `have ${q} ${one}` }
				: { kind: "free", text: `there should be ${q} ${one}` };
		}
		const lead =
			det === "each"
				? its
					? `each of its ${p.text}`
					: `every ${boxPhrase(c, scopeFor(scope, subject), false).text}`
				: det === "some"
					? `at least one of ${its ? "its " : ""}${p.text}`
					: `none of ${its ? "its " : ""}${p.text}`;
		return { kind: "each", lead, inner: innerClauses };
	};
	const clauseOf = (c: Constraint): Clause | undefined => {
		switch (c.type) {
			case "Filter":
				return { kind: "free", text: condition(c.filter, "should") };
			case "SizeFilter": {
				const sf = c.filter;
				if (sf.type === "AdvancedCEL")
					return head
						? { kind: "subject", text: `satisfy ${code(sf.cel)}` }
						: { kind: "free", text: `${code(sf.cel)} should hold` };
				if (sf.type !== "NumChilds") {
					const phrase = sizePhrase(sf, boxIndex, scope, subject);
					if (head) return { kind: "subject", text: `have ${phrase}` };
					return {
						kind: "free",
						text:
							sf.type === "NumChildsProj" ? `there should be ${phrase}` : `${phrase} should hold`,
					};
				}
				if (!head)
					return {
						kind: "free",
						text: `there should be ${sizePhrase(sf, boxIndex, scope, subject)}`,
					};
				const ci = childIndex(scope, boxIndex, sf.child_name);
				const inner = scopeFor(scope, subject);
				const p = ci === undefined ? undefined : boxPhrase(ci, inner, false);
				const counted = sizePhrase(sf, boxIndex, scope, subject);
				if (p && !p.connected) return { kind: "free", text: `there should be ${counted}` };
				const involve = head.v.kind === "e" && p?.head?.v.kind === "o";
				return { kind: "subject", text: `${involve ? "involve" : "have"} ${counted}` };
			}
			case "SAT":
			case "AND": {
				const each = c.child_names.map((n) => forChild(n, "each")).filter((x) => x !== undefined);
				return each.length === 1
					? each[0]
					: each.length > 1
						? { kind: "free", text: joinAnd(each.map(renderClause)) }
						: undefined;
			}
			case "ANY":
				return c.child_names.length === 1
					? forChild(c.child_names[0], "some")
					: {
							kind: "free",
							text: `at least one match in each of ${joinAnd(c.child_names)} should satisfy its constraints`,
						};
			case "NOT":
				return c.child_names.length === 1
					? forChild(c.child_names[0], "none")
					: { kind: "free", text: `not all of ${joinAnd(c.child_names)} should be satisfied` };
			case "OR":
				return {
					kind: "free",
					text: `all matches in ${c.child_names.join(" or all matches in ")} should satisfy their constraints`,
				};
		}
	};
	return box.constraints.map(clauseOf).filter((c): c is Clause => c !== undefined);

	function renderClause(cl: Clause): string {
		if (cl.kind === "free") return cl.text;
		if (cl.kind === "subject") return `${subject ? ref(subject) : "it"} should ${cl.text}`;
		return renderEach(cl);
	}
}

/** The tree with box `index`'s constraints turned into filters, if all of them are filters or size
 *  filters. A match that satisfies the constraints is then a match of the stricter box. */
function withConstraintsAsFilters(tree: BindingBoxTree, index: number): BindingBoxTree | undefined {
	const node = tree.nodes[index];
	if (!node || !("Box" in node)) return undefined;
	const [box, children] = node.Box;
	if (!box.constraints.every((c) => c.type === "Filter" || c.type === "SizeFilter"))
		return undefined;
	const filters = [...box.filters];
	const sizeFilters = [...box.sizeFilters];
	for (const c of box.constraints) {
		if (c.type === "Filter") filters.push(c.filter);
		else if (c.type === "SizeFilter") sizeFilters.push(c.filter);
	}
	const strict: BindingBox = { ...box, filters, sizeFilters, constraints: [] };
	return {
		...tree,
		nodes: tree.nodes.map((n, i) => (i === index ? { Box: [strict, children] } : n)),
	};
}

function renderEach(cl: Clause & { kind: "each" }): string {
	if (cl.inner.every((c) => c.kind === "subject"))
		return `${cl.lead} should ${joinAnd(cl.inner.map((c) => c.text))}`;
	return `for ${cl.lead}, ${joinAnd(cl.inner.map((c) => (c.kind === "each" ? renderEach(c) : c.kind === "free" ? c.text : `it should ${c.text}`)))}`;
}

function sentenceOf(scope: Scope, root: number): string {
	const node = scope.tree.nodes[root];
	if (!node) return "";
	if (!("Box" in node)) return "Combines its sub-queries.";
	const [box] = node.Box;
	const subj = boxPhrase(root, scope, false);
	const clauses = clausesOf(root, scope, subj.head);
	const labels = box.labels ?? [];
	let text: string;
	const s = subj.text;
	if (clauses.length === 0) {
		text = s ? `Find every ${s}.` : "";
	} else if (!s) {
		text = `Across the whole log, ${joinAnd(clauses.map((c) => (c.kind === "each" ? renderEach(c) : c.kind === "free" ? c.text : `it should ${c.text}`)))}.`;
	} else if (clauses.every((c) => c.kind === "subject")) {
		text = `Every ${s} should ${joinAnd(clauses.map((c) => (c.kind === "subject" ? c.text : "")))}.`;
	} else if (clauses.length === 1 && clauses[0].kind === "each") {
		const each = clauses[0];
		text = each.inner.every((c) => c.kind === "subject")
			? `For every ${s}, ${renderEach(each)}.`
			: `For every ${s} and ${each.lead}, ${joinAnd(each.inner.map((c) => (c.kind === "each" ? renderEach(c) : c.kind === "free" ? c.text : `it should ${c.text}`)))}.`;
	} else {
		const head = subj.head?.v.key;
		text = `For every ${s}, ${joinAnd(
			clauses.map((c) =>
				c.kind === "free"
					? c.text
					: c.kind === "each"
						? renderEach(c)
						: `${head ? ref(head) : "it"} should ${c.text}`,
			),
		)}.`;
	}
	if (labels.length > 0) {
		const names = joinAnd(labels.map((l) => code(l.label)));
		const over = node.Box[1].map((c) => {
			const p = boxPhrase(c, scopeFor(scope, subj.head?.v.key), true);
			return p.tiedToSubject
				? `each of its ${p.text}`
				: `every ${boxPhrase(c, scopeFor(scope, subj.head?.v.key), false).text}`;
		});
		const src = `with CEL${over.length ? ` over ${joinAnd(over)}` : ""}`;
		text = text
			? `${text.slice(0, -1)}, where ${names} ${labels.length > 1 ? "are" : "is"} computed ${src}.`
			: `Computes ${names} ${src}.`;
	}
	return text;
}

/** Variables of one type that nothing keeps apart can bind the same object. */
function sameObjectNotes(
	tree: BindingBoxTree,
	root: number,
	outer: Var[] = [],
	apart: string[] = [],
): string[] {
	const node = tree.nodes[root];
	if (!node || !("Box" in node)) return [];
	const [box, children] = node.Box;
	const fresh: Var[] = Object.entries(box.newObjectVars).map(([i, types]) => ({
		key: keyOf("o", +i),
		kind: "o" as const,
		index: +i,
		types,
	}));
	const kept = [
		...apart,
		...box.filters.flatMap((f) =>
			f.type === "NotEqual" ? [[keyOfVariable(f.var_1), keyOfVariable(f.var_2)].sort().join()] : [],
		),
	];
	const all = [...outer, ...fresh];
	const notes: string[] = [];
	for (const b of fresh)
		for (const a of all) {
			if (a === b || all.indexOf(a) > all.indexOf(b)) continue;
			if (a.types.join() !== b.types.join() || kept.includes([a.key, b.key].sort().join()))
				continue;
			notes.push(`${ref(a.key)} and ${ref(b.key)} can be the same ${typeLabel(a, false)}.`);
		}
	for (const c of children) notes.push(...sameObjectNotes(tree, c, all, kept));
	return notes;
}

function celStrings(tree: BindingBoxTree): string[] {
	const out: string[] = [];
	for (const n of tree.nodes) {
		if (!("Box" in n)) continue;
		const [box] = n.Box;
		for (const l of box.labels ?? []) out.push(l.cel);
		for (const f of box.filters) if (f.type === "BasicFilterCEL") out.push(f.cel);
		for (const sf of box.sizeFilters) if (sf.type === "AdvancedCEL") out.push(sf.cel);
		for (const c of box.constraints) {
			if (c.type === "Filter" && c.filter.type === "BasicFilterCEL") out.push(c.filter.cel);
			if (c.type === "SizeFilter" && c.filter.type === "AdvancedCEL") out.push(c.filter.cel);
		}
	}
	return out;
}

const varOfKey = (key: string): SentenceVar => ({
	kind: key[0] === "o" ? "object" : "event",
	index: Number(key.slice(1)),
});
export const varName = (v: SentenceVar) => `${v.kind === "object" ? "o" : "e"}${v.index + 1}`;

function toParts(text: string, named: Set<string>): SentencePart[] {
	const parts: SentencePart[] = [];
	const push = (p: SentencePart) => {
		const last = parts[parts.length - 1];
		if (p.kind === "text" && last?.kind === "text") last.text += p.text;
		else parts.push(p);
	};
	for (const piece of text.split(new RegExp(`(${OPEN}[^${CLOSE}]*${CLOSE})`))) {
		if (!piece.startsWith(OPEN)) {
			if (piece) push({ kind: "text", text: piece });
			continue;
		}
		const [tag, ...fields] = piece.slice(1, -1).split(SEP);
		if (tag === "V") push({ kind: "var", variable: varOfKey(fields[0]) });
		else if (tag === "I") {
			if (named.has(fields[0])) {
				push({ kind: "text", text: " " });
				push({ kind: "var", variable: varOfKey(fields[0]) });
			}
		} else if (tag === "C") push({ kind: "code", text: fields[0] });
		else if (tag === "T")
			push({
				kind: "type",
				isEvent: fields[0] === "e",
				label: fields[1],
				type: fields.slice(2).join(SEP),
			});
	}
	return parts;
}

/** The query below `root` as one English sentence, plus notes on easy-to-miss behavior. */
export function describeQuery(tree: BindingBoxTree, root = 0): QuerySentence {
	const scope: Scope = { tree, vars: new Map(), notes: [] };
	const text = sentenceOf(scope, root);
	const notes = [...sameObjectNotes(tree, root), ...scope.notes];
	const all = [text, ...notes].join(" ");
	const named = new Set<string>();
	for (const m of all.matchAll(new RegExp(`${OPEN}V${SEP}([oe]\\d+)${CLOSE}`, "g")))
		named.add(m[1]);
	for (const cel of celStrings(tree))
		for (const m of cel.matchAll(/\b([oe])(\d+)\b/g))
			named.add(keyOf(m[1] as "o" | "e", Number(m[2]) - 1));
	return { parts: toParts(text, named), notes: [...new Set(notes)].map((n) => toParts(n, named)) };
}

export function sentenceText(parts: SentencePart[]): string {
	return parts
		.map((p) =>
			p.kind === "text"
				? p.text
				: p.kind === "type"
					? p.label
					: p.kind === "var"
						? varName(p.variable)
						: `\`${p.text}\``,
		)
		.join("");
}
