import type { FlowAndViolationData } from "@/types/misc";
import type { OCELInfo } from "@/types/ocel";
import { evaluateConstraints } from "../helper/evaluation/evaluate-constraints";
import { describeQuery, sentenceText } from "../helper/query-sentence";
import type { ConstraintInfo } from "../helper/types";

export type QueryTypes = { events: string[]; objects: string[] };

/** Whether the loaded log has all, some or none of a query's types. */
export type QueryFit =
	| { kind: "fits" }
	| { kind: "partial"; missing: string[] }
	| { kind: "other" };

export type QueryItem = {
	/** Position in the saved lists, which is what identifies a query. */
	index: number;
	name: string;
	description: string;
	/** The query in words, shown when the description is empty. */
	sentence?: string;
	tags: string[];
	types: QueryTypes;
	fit: QueryFit;
};

/** Every event and object type the boxes of a saved query bind, sorted. */
export function typesOfFlow(flow: FlowAndViolationData["flowJson"] | undefined): QueryTypes {
	const events = new Set<string>();
	const objects = new Set<string>();
	for (const node of flow?.nodes ?? []) {
		if (!("box" in node.data) || node.data.box === undefined) continue;
		for (const types of Object.values(node.data.box.newEventVars ?? {})) {
			for (const t of types) events.add(t);
		}
		for (const types of Object.values(node.data.box.newObjectVars ?? {})) {
			for (const t of types) objects.add(t);
		}
	}
	return { events: [...events].sort(), objects: [...objects].sort() };
}

/** A query without any type fits every log. */
export function fitOf(types: QueryTypes, ocelInfo: OCELInfo | undefined): QueryFit {
	if (ocelInfo === undefined) return { kind: "fits" };
	const events = new Set(ocelInfo.event_types.map((t) => t.name));
	const objects = new Set(ocelInfo.object_types.map((t) => t.name));
	const missing = [
		...types.events.filter((t) => !events.has(t)),
		...types.objects.filter((t) => !objects.has(t)),
	];
	if (missing.length === 0) return { kind: "fits" };
	if (missing.length === types.events.length + types.objects.length) return { kind: "other" };
	return { kind: "partial", missing };
}

type Tagged = { tags?: string[] };

/** The tags of a saved query or model, keeping only non-empty strings. Older saves have no tags. */
export function tagsOf(info: object | undefined): string[] {
	const raw: unknown = (info as Tagged | undefined)?.tags;
	if (!Array.isArray(raw)) return [];
	const tags = raw.filter((t): t is string => typeof t === "string").map((t) => t.trim());
	return [...new Set(tags.filter((t) => t !== ""))];
}

/** `info` with `tags`. Without tags the field is left out, so untagged entries keep the format of
 *  older saves. */
export function withTags<T extends Tagged>(info: T, tags: string[]): T {
	const { tags: _old, ...rest } = info;
	const clean = tagsOf({ tags });
	return (clean.length > 0 ? { ...rest, tags: clean } : rest) as T;
}

export function queryItems(
	constraints: ConstraintInfo[],
	flows: (FlowAndViolationData | undefined)[],
	ocelInfo: OCELInfo | undefined,
): QueryItem[] {
	return constraints.map((c, index) => {
		const flow = flows[index]?.flowJson;
		const types = typesOfFlow(flow);
		return {
			index,
			name: c.name !== "" ? c.name : `Query ${index + 1}`,
			description: c.description ?? "",
			sentence: flow === undefined ? undefined : sentenceOfFlow(flow),
			tags: tagsOf(c),
			types,
			fit: fitOf(types, ocelInfo),
		};
	});
}

function sentenceOfFlow(flow: NonNullable<FlowAndViolationData["flowJson"]>): string | undefined {
	try {
		const text = evaluateConstraints(flow.nodes ?? [], flow.edges ?? [])
			.map(({ tree }) => sentenceText(describeQuery(tree).parts))
			.filter((t) => t !== "")
			.join(" ");
		return text === "" ? undefined : text;
	} catch {
		// A query saved by another version may not have the shape the sentence expects.
		return undefined;
	}
}

/** Case-insensitive match on the name, the description (or the sentence shown in its place), the
 *  tags and the types the query uses. */
export function matchesSearch(item: QueryItem, search: string): boolean {
	const q = search.trim().toLowerCase();
	if (q === "") return true;
	return [
		item.name,
		item.description.trim() !== "" ? item.description : (item.sentence ?? ""),
		...item.tags,
		...item.types.events,
		...item.types.objects,
	].some((s) => s.toLowerCase().includes(q));
}

export type QueryGrouping = "fit" | "tag";

export type QuerySection = {
	id: string;
	title: string;
	tone: "fits" | "partial" | "other" | "tag" | "none";
	count: number;
	collapsed: boolean;
};

export type QueryListRow =
	| ({ kind: "section" } & QuerySection)
	| { kind: "query"; item: QueryItem; sectionId: string };

/** Queries from other logs start collapsed, so the list leads with what can run here. */
export const COLLAPSED_BY_DEFAULT: ReadonlySet<string> = new Set(["fit:other"]);

const FIT_SECTIONS = [
	{ kind: "fits", title: "Fits this log" },
	{ kind: "partial", title: "Partly fits" },
	{ kind: "other", title: "Other logs" },
] as const;

/** The list as section headers and query rows. Grouped by tag, a query with several tags shows
 *  under each of them. Empty sections are left out. */
export function groupQueries(
	items: QueryItem[],
	by: QueryGrouping,
	isCollapsed: (sectionId: string) => boolean,
): QueryListRow[] {
	const sections: { id: string; title: string; tone: QuerySection["tone"]; items: QueryItem[] }[] =
		by === "fit"
			? FIT_SECTIONS.map((s) => ({
					id: `fit:${s.kind}`,
					title: s.title,
					tone: s.kind,
					items: items.filter((i) => i.fit.kind === s.kind),
				}))
			: [
					...[...new Set(items.flatMap((i) => i.tags))]
						.sort((a, b) => a.localeCompare(b))
						.map((tag) => ({
							id: `tag:${tag}`,
							title: tag,
							tone: "tag" as const,
							items: items.filter((i) => i.tags.includes(tag)),
						})),
					{
						id: "tag:",
						title: "No tag",
						tone: "none" as const,
						items: items.filter((i) => i.tags.length === 0),
					},
				];
	return sections
		.filter((s) => s.items.length > 0)
		.flatMap((s): QueryListRow[] => {
			const collapsed = isCollapsed(s.id);
			const header: QueryListRow = {
				kind: "section",
				id: s.id,
				title: s.title,
				tone: s.tone,
				count: s.items.length,
				collapsed,
			};
			return collapsed
				? [header]
				: [header, ...s.items.map((item) => ({ kind: "query" as const, item, sectionId: s.id }))];
		});
}

/** Every tag in use with the number of queries carrying it, most used first. */
export function tagCounts(items: { tags: string[] }[]): [string, number][] {
	const counts = new Map<string, number>();
	for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
