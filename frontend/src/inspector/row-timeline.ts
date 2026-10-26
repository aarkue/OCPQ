import {
	type GraphElement,
	type GraphLink,
	hopRings,
	isEvent,
} from "@/components/relationship-graph/graph-model";
import { formatGap } from "@/lib/time-format";
import type { ParentRow } from "@/types/generated/ParentRow";
import type { OCELEvent } from "@/types/ocel";

/** The variable name of each element a row binds, e.g., o1 for object variable 0. An element
 *  bound by several variables gets all of them, e.g., "o1, o2". */
export function rowTags(row: ParentRow): Map<string, string> {
	const tags = new Map<string, string>();
	const add = (id: string, tag: string) => {
		const had = tags.get(id);
		tags.set(id, had === undefined ? tag : `${had}, ${tag}`);
	};
	for (const [v, id] of row.objects) add(id, `o${v + 1}`);
	for (const [v, id] of row.events) add(id, `e${v + 1}`);
	return tags;
}

export type ShownObject = { id: string; type: string; tag?: string; hops: number };

/** A row's neighbourhood as a timeline needs it: events oldest first, objects nearest first, so
 *  a further hop only adds objects at the end. Objects at the same distance go by type, in the
 *  order the types first take part in an event. */
export function rowElements(
	nodes: GraphElement[],
	links: GraphLink[],
	tags: ReadonlyMap<string, string>,
): { events: OCELEvent[]; objects: ShownObject[] } {
	const anchors = nodes.filter((n) => tags.has(n.id)).map((n) => n.id);
	const { dist } = hopRings(
		nodes.map((n) => n.id),
		links,
		anchors,
		1,
		1,
	);
	const events = nodes
		.filter(isEvent)
		.sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.id.localeCompare(b.id));
	// Position of an object's first relation, by event and then by order within the event.
	const firstSeen = new Map<string, number>();
	let position = 0;
	for (const e of events) {
		for (const r of e.relationships ?? []) {
			if (!firstSeen.has(r.objectId)) firstSeen.set(r.objectId, position);
			position++;
		}
	}
	const objects = nodes
		.filter((n) => !isEvent(n))
		.map((o) => ({
			id: o.id,
			type: o.type,
			tag: tags.get(o.id),
			hops: dist.get(o.id) ?? Number.POSITIVE_INFINITY,
			seen: firstSeen.get(o.id) ?? Number.POSITIVE_INFINITY,
		}));
	const typeSeen = new Map<string, number>();
	for (const o of objects) typeSeen.set(o.type, Math.min(typeSeen.get(o.type) ?? o.seen, o.seen));
	objects.sort(
		(a, b) =>
			a.hops - b.hops ||
			(a.tag ?? "").localeCompare(b.tag ?? "", undefined, { numeric: true }) ||
			(typeSeen.get(a.type) ?? 0) - (typeSeen.get(b.type) ?? 0) ||
			a.type.localeCompare(b.type) ||
			a.seen - b.seen ||
			a.id.localeCompare(b.id),
	);
	return { events, objects: objects.map(({ seen: _, ...o }) => o) };
}

/** A duration in its largest unit, rounded: "45 s", "12 min", "4 h", "21 d". */
export function shortDuration(ms: number): string {
	// Rounded before the unit is picked, so 59.5 min is "1 h", not "60 min".
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s} s`;
	const min = Math.round(s / 60);
	if (min < 60) return `${min} min`;
	const h = Math.round(s / 3600);
	if (h < 24) return `${h} h`;
	return `${Math.round(s / 86400)} d`;
}

export type Gap = {
	/** e.g., "4 h 28 min", or "same time". */
	text: string;
	/** e.g., "4 h". */
	short: string;
	/** Much longer than this row's usual gap between events. */
	long: boolean;
};

/** The time between each event and the one before it. A gap is long when it is at least
 *  `longFactor` times the median gap, so what counts as a pause follows the pace of these events:
 *  minutes in one log, days in another. */
export function eventGaps(events: OCELEvent[], longFactor = 4): (Gap | undefined)[] {
	const ms = events.map((e, i) =>
		i === 0 ? undefined : Date.parse(e.time) - Date.parse(events[i - 1].time),
	);
	const positive = ms.filter((m): m is number => m !== undefined && m > 0).sort((a, b) => a - b);
	const median = positive[Math.floor((positive.length - 1) / 2)] ?? 0;
	return ms.map((m, i) =>
		m === undefined
			? undefined
			: {
					text: formatGap(events[i - 1].time, events[i].time).replace(/^\+/, ""),
					short: m <= 0 ? "0 s" : shortDuration(m),
					long: median > 0 && m >= longFactor * median,
				},
	);
}

export type FeedChip =
	/** `qualifier` is how the event relates to the object, e.g., "customer". */
	| { kind: "object"; id: string; type: string; tag?: string; qualifier: string }
	/** Unbound objects of one type, folded into one chip. `qualifiers` lines up with `ids`. */
	| { kind: "group"; type: string; ids: string[]; qualifiers: string[] };

/** The qualifiers of each object an event relates to, joined when it relates to one several
 *  ways. */
function qualifiersOf(event: OCELEvent): Map<string, string> {
	const byObject = new Map<string, string[]>();
	for (const r of event.relationships ?? []) {
		byObject.set(r.objectId, [...(byObject.get(r.objectId) ?? []), r.qualifier]);
	}
	return new Map([...byObject].map(([id, qs]) => [id, [...new Set(qs)].join(", ")]));
}

export type FeedItem =
	| {
			kind: "event";
			event: OCELEvent;
			tag?: string;
			/** How long after the first bound event a later bound event happens, e.g., "21 d after e1". */
			since?: string;
			chips: FeedChip[];
			/** Objects of the event that are further away than the shown hops. */
			hidden: number;
	  }
	/** The time between two events, before the event with id `before`. */
	| ({ kind: "gap"; before: string } & Gap);

/** The events as a list with the time between each two. Chips show the event's objects among
 *  `objects`, and more than `foldOver` unbound ones of a type fold into one chip. */
export function feedItems(
	events: OCELEvent[],
	objects: ShownObject[],
	tags: ReadonlyMap<string, string>,
	{ foldOver = 2 }: { foldOver?: number } = {},
): FeedItem[] {
	const shown = new Map(objects.map((o) => [o.id, o]));
	const items: FeedItem[] = [];
	const firstBound = events.find((e) => tags.has(e.id));
	const gaps = eventGaps(events);
	for (const [i, event] of events.entries()) {
		const gap = gaps[i];
		if (gap !== undefined) items.push({ kind: "gap", before: event.id, ...gap });
		const ids = new Set((event.relationships ?? []).map((r) => r.objectId));
		const qualifiers = qualifiersOf(event);
		const own = [...ids].flatMap((id) => {
			const o = shown.get(id);
			return o === undefined ? [] : [o];
		});
		const byType = new Map<string, string[]>();
		for (const o of own) {
			if (o.tag === undefined) byType.set(o.type, [...(byType.get(o.type) ?? []), o.id]);
		}
		const chips: FeedChip[] = [];
		const folded = new Set<string>();
		for (const o of own) {
			const same = byType.get(o.type) ?? [];
			if (o.tag === undefined && same.length > foldOver) {
				if (!folded.has(o.type)) {
					chips.push({
						kind: "group",
						type: o.type,
						ids: same,
						qualifiers: same.map((id) => qualifiers.get(id) ?? ""),
					});
				}
				folded.add(o.type);
			} else {
				chips.push({
					kind: "object",
					id: o.id,
					type: o.type,
					tag: o.tag,
					qualifier: qualifiers.get(o.id) ?? "",
				});
			}
		}
		const bound = (c: FeedChip) => Number(c.kind === "object" && c.tag !== undefined);
		chips.sort((a, b) => bound(b) - bound(a));
		const tag = tags.get(event.id);
		const since =
			tag !== undefined && firstBound !== undefined && firstBound !== event
				? `${formatGap(firstBound.time, event.time).replace(/^\+/, "")} after ${tags.get(firstBound.id)}`
				: undefined;
		items.push({ kind: "event", event, tag, since, chips, hidden: ids.size - own.length });
	}
	return items;
}

export type MatrixColumn = {
	event: OCELEvent;
	tag?: string;
	/** The time since the event before. */
	gap?: Gap;
	/** Row indices of the objects the event involves, ascending. */
	rows: number[];
	/** How the event relates to each of `rows`, e.g., "customer". */
	qualifiers: string[];
};
export type Matrix = { rows: ShownObject[]; columns: MatrixColumn[]; hiddenRows: number };

/** Events across and objects down, in the order of `objects` and at most `maxRows` of them. */
export function eventMatrix(
	events: OCELEvent[],
	objects: ShownObject[],
	tags: ReadonlyMap<string, string>,
	{ maxRows = 40 }: { maxRows?: number } = {},
): Matrix {
	const rows = objects.slice(0, maxRows);
	const index = new Map(rows.map((r, i) => [r.id, i]));
	const gaps = eventGaps(events);
	const columns = events.map((event, i): MatrixColumn => {
		const hit = (event.relationships ?? []).flatMap((r) => {
			const row = index.get(r.objectId);
			return row === undefined ? [] : [row];
		});
		const qualifiers = qualifiersOf(event);
		const shownRows = [...new Set(hit)].sort((a, b) => a - b);
		return {
			event,
			tag: tags.get(event.id),
			gap: gaps[i],
			rows: shownRows,
			qualifiers: shownRows.map((r) => qualifiers.get(rows[r].id) ?? ""),
		};
	});
	return { rows, columns, hiddenRows: objects.length - rows.length };
}
