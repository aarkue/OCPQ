import clsx from "clsx";
import { type ReactNode, useId, useState } from "react";
import { LuChevronDown, LuChevronRight, LuPlus, LuSearch, LuTag, LuX } from "react-icons/lu";
import { AreaList, AreaListRow, SECTION_ROW_HEIGHT } from "@/components/layout/AreaPage";
import type { Area } from "@/components/layout/areas";
import { TypeDot } from "@/components/TypeDot";
import {
	COLLAPSED_BY_DEFAULT,
	groupQueries,
	matchesSearch,
	type QueryFit,
	type QueryGrouping,
	type QueryItem,
	type QuerySection,
	tagCounts,
} from "./query-list";

const TYPES_SHOWN = 3;

/** Tags take the color of their page: queries purple, OC-DECLARE emerald. */
export type TagTone = "purple" | "emerald";
const TONES: Record<
	TagTone,
	{
		pill: string;
		pressed: string;
		count: string;
		pressedCount: string;
		text: string;
		icon: string;
		ring: string;
		hover: string;
	}
> = {
	purple: {
		pill: "border-purple-300 bg-white text-purple-800 hover:bg-purple-50",
		pressed: "border-purple-700 bg-purple-700 text-white",
		count: "text-purple-600",
		pressedCount: "text-purple-100",
		text: "text-purple-800",
		icon: "text-purple-700",
		ring: "focus-visible:ring-purple-500 focus-within:ring-purple-500",
		hover: "hover:bg-purple-100",
	},
	emerald: {
		pill: "border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50",
		pressed: "border-emerald-700 bg-emerald-700 text-white",
		count: "text-emerald-700",
		pressedCount: "text-emerald-100",
		text: "text-emerald-800",
		icon: "text-emerald-700",
		ring: "focus-visible:ring-emerald-500 focus-within:ring-emerald-500",
		hover: "hover:bg-emerald-100",
	},
};

function loadGrouping(key: string): QueryGrouping {
	try {
		return localStorage.getItem(key) === "tag" ? "tag" : "fit";
	} catch {
		return "fit";
	}
}

/** Saved queries or OC-DECLARE models with a search, tag filters and sections by fit or by tag.
 *  `compact` drops the types from the rows for narrow places. */
export function QueryList({
	area,
	items,
	activeIndex,
	onOpen,
	onDelete,
	footer,
	compact = false,
	tone = "purple",
	groupingKey = "ocpq-query-list-grouping",
	noMatch = "No query matches.",
}: {
	area: Area;
	items: QueryItem[];
	activeIndex?: number;
	onOpen: (index: number) => unknown;
	onDelete: (index: number) => unknown;
	footer?: ReactNode;
	compact?: boolean;
	tone?: TagTone;
	/** Where the chosen grouping is remembered, one per list. */
	groupingKey?: string;
	noMatch?: string;
}) {
	const [search, setSearch] = useState("");
	const [chosenTag, setTag] = useState<string>();
	const tags = tagCounts(items);
	// A tag whose last query was deleted no longer filters, as its pill to clear it is gone.
	const tag = tags.some(([t]) => t === chosenTag) ? chosenTag : undefined;
	const [grouping, setGroupingState] = useState(() => loadGrouping(groupingKey));
	const setGrouping = (g: QueryGrouping) => {
		setGroupingState(g);
		try {
			localStorage.setItem(groupingKey, g);
		} catch {
			// Without storage the choice lasts until the page is left.
		}
	};
	const [toggled, setToggled] = useState<Record<string, boolean>>({});
	// While searching or filtering, every match shows, also in sections that are closed otherwise.
	const filtering = search.trim() !== "" || tag !== undefined;
	const shown = items.filter(
		(i) => matchesSearch(i, search) && (tag === undefined || i.tags.includes(tag)),
	);
	const rows = groupQueries(shown, grouping, (id) =>
		filtering ? false : (toggled[id] ?? COLLAPSED_BY_DEFAULT.has(id)),
	);
	const toggleTag = (t: string) => setTag((cur) => (cur === t ? undefined : t));

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-2.5">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<label
					className={clsx(
						"flex h-9 w-72 max-w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 text-sm focus-within:ring-2",
						TONES[tone].ring,
					)}
				>
					<LuSearch aria-hidden="true" className="shrink-0 text-slate-500" />
					<input
						aria-label="Search"
						placeholder="Search names, tags and types"
						value={search}
						onChange={(ev) => setSearch(ev.currentTarget.value)}
						className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-500"
					/>
					{search !== "" && (
						<button
							type="button"
							aria-label="Clear search"
							onClick={() => setSearch("")}
							className="rounded p-0.5 text-slate-500 hover:text-slate-900"
						>
							<LuX />
						</button>
					)}
				</label>
				{tags.length > 0 && (
					<div
						role="group"
						aria-label="Filter by tag"
						className="flex flex-wrap items-center gap-1.5"
					>
						{tags.map(([t, count]) => (
							<TagPill
								key={t}
								tag={t}
								tone={tone}
								count={count}
								pressed={tag === t}
								onClick={() => toggleTag(t)}
							/>
						))}
					</div>
				)}
				<span className="flex-1" />
				<div className="flex items-center gap-2 text-xs text-slate-600">
					Group by
					<div role="group" aria-label="Group by" className="flex rounded-md bg-slate-100 p-0.5">
						{(["fit", "tag"] as const).map((g) => (
							<button
								key={g}
								type="button"
								aria-pressed={grouping === g}
								onClick={() => setGrouping(g)}
								className={clsx(
									"h-7 rounded px-2.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
									grouping === g
										? "bg-white text-slate-900 shadow-sm"
										: "text-slate-600 hover:text-slate-900",
								)}
							>
								{g === "fit" ? "Fit" : "Tag"}
							</button>
						))}
					</div>
				</div>
			</div>
			{rows.length === 0 ? (
				<p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
					{noMatch}
				</p>
			) : (
				<AreaList
					itemCount={rows.length}
					rowHeight={(i) => (rows[i]?.kind === "section" ? SECTION_ROW_HEIGHT : undefined)}
					initialIndex={(() => {
						const i = rows.findIndex((r) => r.kind === "query" && r.item.index === activeIndex);
						return i >= 0 ? i : undefined;
					})()}
					footer={footer}
					renderRow={(i) => {
						const row = rows[i];
						if (row === undefined) return null;
						if (row.kind === "section") {
							return (
								<SectionRow
									section={row}
									tone={tone}
									locked={filtering}
									onToggle={() => setToggled((t) => ({ ...t, [row.id]: !row.collapsed }))}
								/>
							);
						}
						const { item } = row;
						return (
							<AreaListRow
								area={area}
								title={item.name}
								description={item.description}
								fallbackDescription={item.sentence}
								active={item.index === activeIndex}
								onOpen={() => onOpen(item.index)}
								onDelete={() => onDelete(item.index)}
								extra={
									<QueryRowExtra
										item={item}
										tone={tone}
										showTypes={!compact}
										showFit={grouping === "tag"}
										activeTag={tag}
										onTag={toggleTag}
									/>
								}
							/>
						);
					}}
				/>
			)}
		</div>
	);
}

const TONE_DOT: Partial<Record<QuerySection["tone"], string>> = {
	fits: "bg-green-600",
	partial: "bg-amber-500",
	other: "bg-slate-400",
};

function SectionRow({
	section,
	tone,
	locked,
	onToggle,
}: {
	section: QuerySection;
	tone: TagTone;
	locked: boolean;
	onToggle: () => unknown;
}) {
	return (
		<button
			type="button"
			aria-expanded={!section.collapsed}
			disabled={locked}
			onClick={onToggle}
			className="flex h-full w-full items-center gap-2 border-b border-slate-200 bg-slate-50 px-3.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 disabled:cursor-default"
		>
			{section.collapsed ? (
				<LuChevronRight aria-hidden="true" className="shrink-0 text-slate-500" />
			) : (
				<LuChevronDown aria-hidden="true" className="shrink-0 text-slate-500" />
			)}
			{section.tone === "tag" ? (
				<LuTag aria-hidden="true" className={clsx("shrink-0", TONES[tone].icon)} />
			) : (
				TONE_DOT[section.tone] !== undefined && (
					<span
						aria-hidden="true"
						className={clsx("h-2 w-2 rounded-full", TONE_DOT[section.tone])}
					/>
				)
			)}
			<span
				className={clsx(
					"font-semibold",
					section.tone === "tag" ? TONES[tone].text : "text-slate-900",
				)}
			>
				{section.title}
			</span>
			<span className="tabular-nums text-slate-500">{section.count}</span>
		</button>
	);
}

function QueryRowExtra({
	item,
	tone,
	showTypes,
	showFit,
	activeTag,
	onTag,
}: {
	item: QueryItem;
	tone: TagTone;
	showTypes: boolean;
	showFit: boolean;
	activeTag?: string;
	onTag: (tag: string) => unknown;
}) {
	const missing = new Set(
		item.fit.kind === "partial"
			? item.fit.missing
			: item.fit.kind === "other"
				? [...item.types.objects, ...item.types.events]
				: [],
	);
	const types = [
		...item.types.objects.map((name) => ({ name, isEvent: false })),
		...item.types.events.map((name) => ({ name, isEvent: true })),
	];
	return (
		// A fixed width on wide rows keeps the name and description columns aligned across rows.
		<span
			className={clsx("flex min-w-0 items-center justify-end gap-3", showTypes && "@3xl:w-[26rem]")}
		>
			{showTypes && types.length > 0 && (
				<span
					className="hidden min-w-0 items-center gap-2.5 overflow-hidden text-xs text-slate-700 @3xl:flex"
					title={missing.size > 0 ? `Not in this log: ${[...missing].join(", ")}` : undefined}
				>
					{types.slice(0, TYPES_SHOWN).map((t) => (
						<span
							key={`${t.isEvent}:${t.name}`}
							className={clsx(
								"inline-flex items-center gap-1 whitespace-nowrap",
								missing.has(t.name) && "text-slate-400 line-through",
							)}
						>
							<TypeDot
								isEvent={t.isEvent}
								name={t.name}
								className={clsx(
									"h-2 w-2",
									t.isEvent && "rounded-[2px]",
									missing.has(t.name) && "opacity-40",
								)}
							/>
							{t.name}
						</span>
					))}
					{types.length > TYPES_SHOWN && (
						<span className="text-slate-500">+{types.length - TYPES_SHOWN}</span>
					)}
				</span>
			)}
			{item.tags.length > 0 && (
				<span className="flex shrink-0 items-center gap-1">
					{item.tags.map((t) => (
						<TagPill
							key={t}
							tag={t}
							tone={tone}
							small
							pressed={t === activeTag}
							onClick={() => onTag(t)}
						/>
					))}
				</span>
			)}
			{showFit && <FitLabel fit={item.fit} />}
		</span>
	);
}

function FitLabel({ fit }: { fit: QueryFit }) {
	const [dot, text, label] =
		fit.kind === "fits"
			? ["bg-green-600", "text-green-800", "Fits"]
			: fit.kind === "partial"
				? [
						"bg-amber-500",
						"text-amber-800",
						`Misses ${fit.missing.length} ${fit.missing.length === 1 ? "type" : "types"}`,
					]
				: ["bg-slate-400", "text-slate-600", "Other log"];
	return (
		<span className={clsx("flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs", text)}>
			<span aria-hidden="true" className={clsx("h-2 w-2 rounded-full", dot)} />
			{label}
		</span>
	);
}

/** A tag as an outlined pill, set apart from the filled type labels. */
export function TagPill({
	tag,
	tone,
	count,
	pressed,
	small = false,
	onClick,
}: {
	tag: string;
	tone: TagTone;
	count?: number;
	pressed?: boolean;
	small?: boolean;
	onClick?: () => unknown;
}) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			title={pressed ? "Show all" : `Show only those tagged ${tag}`}
			onClick={onClick}
			className={clsx(
				"inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-medium outline-none focus-visible:ring-2",
				TONES[tone].ring,
				small ? "h-5 px-1.5 text-[11px]" : "h-7 px-2.5 text-xs",
				pressed ? TONES[tone].pressed : TONES[tone].pill,
			)}
		>
			<LuTag aria-hidden="true" className={small ? "size-2.5" : "size-3"} />
			{tag}
			{count !== undefined && (
				<span className={pressed ? TONES[tone].pressedCount : TONES[tone].count}>{count}</span>
			)}
		</button>
	);
}

/** The tags of an open query or model, each with a remove button, and a "+ Tag" field that
 *  suggests tags in use. */
export function QueryTagsEditor({
	tags,
	suggestions,
	onChange,
	tone = "purple",
}: {
	tone?: TagTone;
	tags: string[];
	suggestions: string[];
	onChange: (tags: string[]) => unknown;
}) {
	const [draft, setDraft] = useState<string>();
	const listId = useId();
	const commit = () => {
		const t = draft?.trim();
		if (t !== undefined && t !== "" && !tags.includes(t)) onChange([...tags, t]);
		setDraft(undefined);
	};
	return (
		<div className="flex flex-wrap items-center gap-1.5 px-1.5 pt-1">
			{tags.map((t) => (
				<span
					key={t}
					className={clsx(
						"inline-flex h-6 items-center gap-1 rounded-full border pl-2 pr-0.5 text-xs font-medium",
						TONES[tone].pill,
					)}
				>
					<LuTag aria-hidden="true" className="size-3" />
					{t}
					<button
						type="button"
						aria-label={`Remove tag ${t}`}
						onClick={() => onChange(tags.filter((x) => x !== t))}
						className={clsx(
							"rounded-full p-0.5 outline-none focus-visible:ring-2",
							TONES[tone].hover,
							TONES[tone].ring,
						)}
					>
						<LuX className="size-3" />
					</button>
				</span>
			))}
			{draft === undefined ? (
				<button
					type="button"
					onClick={() => setDraft("")}
					className={clsx(
						"inline-flex h-6 items-center gap-1 rounded-full border border-dashed px-2 text-xs font-medium outline-none focus-visible:ring-2",
						TONES[tone].pill,
						TONES[tone].ring,
					)}
				>
					<LuPlus aria-hidden="true" className="size-3" />
					Tag
				</button>
			) : (
				<>
					<input
						// biome-ignore lint/a11y/noAutofocus: the field only appears after clicking "+ Tag"
						autoFocus
						aria-label="New tag"
						list={listId}
						value={draft}
						onChange={(ev) => setDraft(ev.currentTarget.value)}
						onBlur={commit}
						onKeyDown={(ev) => {
							if (ev.key === "Enter") commit();
							if (ev.key === "Escape") setDraft(undefined);
						}}
						className={clsx(
							"h-6 w-36 rounded-full border px-2.5 text-xs text-slate-900 outline-none focus-visible:ring-2",
							TONES[tone].pill,
							TONES[tone].ring,
						)}
					/>
					<datalist id={listId}>
						{suggestions
							.filter((s) => !tags.includes(s))
							.map((s) => (
								<option key={s} value={s} />
							))}
					</datalist>
				</>
			)}
		</div>
	);
}
