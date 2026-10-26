import clsx from "clsx";
import { Fragment, useMemo, useState } from "react";
import { LuMaximize2 } from "react-icons/lu";
import {
	type GraphRef,
	RelationshipGraph,
	useNeighbourhood,
} from "@/components/relationship-graph/RelationshipGraph";
import Spinner from "@/components/Spinner";
import { TypeDot, typeColor } from "@/components/TypeDot";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatEventTime } from "@/lib/time-format";
import type { OCELEvent } from "@/types/ocel";
import type { InspectTarget } from "./inspect";
import { InspectContextMenu, useGraphNodeEntries } from "./inspect-menu";
import type { PinTarget } from "./inspector-state";
import {
	eventMatrix,
	type FeedChip,
	feedItems,
	type Gap,
	rowElements,
	rowTags,
	type ShownObject,
} from "./row-timeline";

type Inspect = (target: InspectTarget) => unknown;
type RowTarget = PinTarget & { kind: "row" };
type View = "graph" | "timeline" | "matrix";

/** Above the graph's default, so items and packages open up at +2 hops while customers or
 *  products with hundreds of relations still stay closed. */
const NEIGHBOUR_LIMIT = 25;
const HOPS: { hops: number; label: string; title: string }[] = [
	{
		hops: 0,
		label: "Bound",
		title: "Only the bound events and objects, with all relations between them",
	},
	{ hops: 1, label: "+1 hop", title: "Also everything directly related to them" },
	{ hops: 2, label: "+2 hops", title: "Also everything related to those" },
];
const VIEWS: { id: View; label: string }[] = [
	{ id: "graph", label: "Graph" },
	{ id: "timeline", label: "Timeline" },
	{ id: "matrix", label: "Matrix" },
];

function VarTag({ tag }: { tag: string }) {
	return (
		<span className="rounded-full bg-slate-700 px-1.5 text-[11px] font-bold leading-4 text-white">
			{tag}
		</span>
	);
}

export function RowCardBody({
	target,
	inspect,
	wide,
}: {
	target: RowTarget;
	inspect: Inspect;
	wide?: boolean;
}) {
	const [view, setView] = useState<View>("graph");
	const [hops, setHops] = useState(0);
	const tags = useMemo(() => rowTags(target.row), [target.row]);
	const bound: GraphRef[] = [
		...target.row.objects.map(([, id]) => ({ type: "object" as const, id })),
		...target.row.events.map(([, id]) => ({ type: "event" as const, id })),
	];
	const segment = (pressed: boolean) =>
		clsx(
			"h-6 rounded-md px-2 text-xs whitespace-nowrap",
			pressed
				? "bg-white font-semibold text-slate-900 shadow-sm"
				: "text-slate-600 hover:text-slate-900",
		);
	return (
		<div className="flex min-w-0 flex-col gap-2.5">
			<div className="flex flex-wrap items-center gap-1.5">
				<RowBinding row={target.row} inspect={inspect} />
			</div>
			<div className="flex flex-wrap items-center gap-1.5">
				<div role="group" aria-label="View" className="flex rounded-lg bg-slate-100 p-0.5">
					{VIEWS.map((v) => (
						<button
							key={v.id}
							type="button"
							aria-pressed={view === v.id}
							className={segment(view === v.id)}
							onClick={() => setView(v.id)}
						>
							{v.label}
						</button>
					))}
				</div>
				<span className="flex-1" />
				<div
					role="group"
					aria-label="Distance from the bound elements"
					className="flex rounded-lg bg-slate-100 p-0.5"
				>
					{HOPS.map((h) => (
						<button
							key={h.hops}
							type="button"
							title={h.title}
							aria-pressed={hops === h.hops}
							className={segment(hops === h.hops)}
							onClick={() => setHops(h.hops)}
						>
							{h.label}
						</button>
					))}
				</div>
			</div>
			{bound.length === 0 ? (
				<span className="text-slate-600">This row binds nothing.</span>
			) : view === "graph" ? (
				<RowGraph
					bound={bound}
					tags={tags}
					hops={hops}
					inspect={inspect}
					height={wide ? 620 : 380}
				/>
			) : (
				<RowTimeline
					bound={bound}
					tags={tags}
					hops={hops}
					view={view}
					inspect={inspect}
					wide={wide}
				/>
			)}
		</div>
	);
}

/** One chip per variable of the row, with the element bound to it. */
function RowBinding({ row, inspect }: { row: RowTarget["row"]; inspect: Inspect }) {
	const bound = [
		...row.objects.map(([v, id]) => ({ type: "object" as const, id, tag: `o${v + 1}` })),
		...row.events.map(([v, id]) => ({ type: "event" as const, id, tag: `e${v + 1}` })),
	];
	return bound.map((b) => (
		<InspectContextMenu
			key={b.tag}
			target={{ kind: "element", type: b.type, id: b.id }}
			inspect={inspect}
		>
			<button
				type="button"
				className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-slate-200 bg-white py-0.5 pl-1 pr-2 text-xs font-normal hover:bg-slate-50"
				onClick={() => inspect({ kind: "element", type: b.type, id: b.id })}
			>
				<VarTag tag={b.tag} />
				<span className="truncate">{b.id}</span>
			</button>
		</InspectContextMenu>
	));
}

function RowGraph({
	bound,
	tags,
	hops,
	inspect,
	height,
}: {
	bound: GraphRef[];
	tags: Map<string, string>;
	hops: number;
	inspect: Inspect;
	height: number;
}) {
	const nodeEntries = useGraphNodeEntries();
	const anchors = bound.map((ref) => ({ ref, tag: tags.get(ref.id) ?? "" }));
	return (
		<RelationshipGraph
			variant="card"
			root={bound[0]}
			anchors={anchors}
			hops={hops}
			neighbourLimit={NEIGHBOUR_LIMIT}
			height={height}
			onSelect={(el) => inspect({ kind: "element", type: el.type, id: el.id })}
			nodeActions={nodeEntries}
		/>
	);
}

function RowTimeline({
	bound,
	tags,
	hops,
	view,
	inspect,
	wide,
}: {
	bound: GraphRef[];
	tags: Map<string, string>;
	hops: number;
	view: "timeline" | "matrix";
	inspect: Inspect;
	wide?: boolean;
}) {
	const { graph, isError } = useNeighbourhood(bound, hops, {
		variant: "card",
		neighbourLimit: NEIGHBOUR_LIMIT,
	});
	const elements = useMemo(
		() => (graph === undefined ? undefined : rowElements(graph.nodes, graph.links, tags)),
		[graph, tags],
	);
	if (isError) return <span className="text-red-700">The events could not be loaded.</span>;
	if (graph === undefined || elements === undefined)
		return (
			<span className="flex items-center gap-2 text-slate-600">
				<Spinner /> Loading events...
			</span>
		);
	const { events, objects } = elements;
	return (
		<div className="flex flex-col gap-2">
			{events.length === 0 ? (
				<span className="text-slate-600">
					{hops < 2 ? `No events. Try +${hops + 1} ${hops === 0 ? "hop" : "hops"}.` : "No events."}
				</span>
			) : view === "timeline" ? (
				<Feed events={events} objects={objects} tags={tags} inspect={inspect} />
			) : (
				<EventMatrix events={events} objects={objects} tags={tags} inspect={inspect} wide={wide} />
			)}
			{graph.truncated && (
				<span className="text-xs text-slate-600">
					Some related elements are left out, as there are too many.
				</span>
			)}
		</div>
	);
}

function Feed({
	events,
	objects,
	tags,
	inspect,
}: {
	events: OCELEvent[];
	objects: ShownObject[];
	tags: Map<string, string>;
	inspect: Inspect;
}) {
	const items = useMemo(() => feedItems(events, objects, tags), [events, objects, tags]);
	const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
	const chip = (c: FeedChip, eventId: string) => {
		const key = `${eventId}:${c.kind === "group" ? c.type : c.id}`;
		if (c.kind === "group" && !unfolded.has(key)) {
			return (
				<InspectContextMenu
					key={key}
					target={{ kind: "type", isEvent: false, name: c.type }}
					inspect={inspect}
				>
					<button
						type="button"
						title={c.ids.map((id, i) => withQualifier(id, c.qualifiers[i])).join("\n")}
						className="inline-flex h-5 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[11.5px] text-slate-700 hover:bg-slate-50"
						onClick={() => setUnfolded((prev) => new Set(prev).add(key))}
					>
						<TypeDot isEvent={false} name={c.type} className="h-2 w-2" />
						{c.ids.length} {c.type}
					</button>
				</InspectContextMenu>
			);
		}
		const objects =
			c.kind === "group"
				? c.ids.map((id, i) => ({ id, type: c.type, tag: undefined, qualifier: c.qualifiers[i] }))
				: [c];
		return objects.map((o) => (
			<InspectContextMenu
				key={`${eventId}:${o.id}`}
				target={{ kind: "element", type: "object", id: o.id, typeName: o.type }}
				inspect={inspect}
			>
				<button
					type="button"
					title={`${withQualifier(o.id, o.qualifier)} (${o.type})`}
					className={clsx(
						"inline-flex h-5 max-w-full items-center gap-1 rounded-full border px-2 text-[11.5px] hover:bg-slate-50",
						o.tag !== undefined
							? "border-slate-400 bg-white font-semibold text-slate-900"
							: "border-slate-200 bg-white text-slate-700",
					)}
					onClick={() => inspect({ kind: "element", type: "object", id: o.id })}
				>
					<TypeDot isEvent={false} name={o.type} className="h-2 w-2" />
					{o.tag !== undefined && <span className="text-slate-500">{o.tag}</span>}
					<span className="truncate">{o.id}</span>
				</button>
			</InspectContextMenu>
		));
	};
	return (
		<ol className="relative ml-1.5 flex flex-col gap-1 border-l-2 border-slate-200 pl-4">
			{items.map((item) =>
				item.kind === "gap" ? (
					<li
						key={`gap-${item.before}`}
						className={clsx(
							"-ml-[18px] border-l-2 py-0.5 pl-4",
							item.long ? "border-dashed border-amber-300" : "border-transparent",
						)}
					>
						<GapBadge gap={item} />
					</li>
				) : (
					<li key={item.event.id} className="relative">
						<span
							aria-hidden="true"
							className="absolute -left-[23px] top-3 size-2.5 rounded-sm ring-4 ring-slate-50"
							style={{ background: typeColor(true, item.event.type) }}
						/>
						<InspectContextMenu
							target={{
								kind: "element",
								type: "event",
								id: item.event.id,
								typeName: item.event.type,
							}}
							inspect={inspect}
						>
							<div
								className={clsx(
									"rounded-lg border bg-white px-2.5 py-1.5",
									item.tag !== undefined ? "border-slate-500" : "border-slate-200",
								)}
							>
								<div className="flex items-center gap-1.5">
									<button
										type="button"
										className="min-w-0 truncate font-semibold text-slate-900 hover:underline"
										onClick={() => inspect({ kind: "element", type: "event", id: item.event.id })}
									>
										{item.event.type}
									</button>
									{item.tag !== undefined && <VarTag tag={item.tag} />}
									<span className="ml-auto shrink-0 text-xs tabular-nums text-slate-500">
										{formatEventTime(item.event.time)}
									</span>
								</div>
								{item.since !== undefined && (
									<div className="text-xs text-slate-600">{item.since}</div>
								)}
								{(item.chips.length > 0 || item.hidden > 0) && (
									<div className="mt-1 flex flex-wrap items-center gap-1">
										{item.chips.map((c) => chip(c, item.event.id))}
										{item.hidden > 0 && (
											<span className="text-[11.5px] text-slate-500">
												{item.chips.length > 0 ? "+" : ""}
												{item.hidden} other {item.hidden === 1 ? "object" : "objects"}
											</span>
										)}
									</div>
								)}
							</div>
						</InspectContextMenu>
					</li>
				),
			)}
		</ol>
	);
}

/** The time between two events. Gaps much longer than the row's usual one stand out in amber. */
function GapBadge({ gap, short }: { gap: Gap; short?: boolean }) {
	return (
		<span
			title={gap.long ? `${gap.text}, much longer than the other gaps here` : gap.text}
			className={clsx(
				"inline-flex h-4 items-center whitespace-nowrap rounded-full border px-1.5 text-[10.5px] leading-none tabular-nums",
				gap.long
					? "border-amber-300 bg-amber-50 font-semibold text-amber-900"
					: "border-slate-200 bg-white text-slate-600",
			)}
		>
			{short ? gap.short : `+${gap.text}`}
		</span>
	);
}

/** `o-1 as "customer"`, or the id alone without a qualifier. */
function withQualifier(id: string, qualifier: string | undefined) {
	return qualifier ? `${id} as "${qualifier}"` : id;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mar 1" as written in the log, without a time zone shifting it. */
function shortDate(iso: string) {
	const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
	return m === null ? iso : `${MONTHS[Number(m[1]) - 1]} ${Number(m[2])}`;
}

function EventMatrix({
	events,
	objects,
	tags,
	inspect,
	wide,
}: {
	events: OCELEvent[];
	objects: ShownObject[];
	tags: Map<string, string>;
	inspect: Inspect;
	wide?: boolean;
}) {
	const m = useMemo(() => eventMatrix(events, objects, tags), [events, objects, tags]);
	const labelW = wide ? 168 : 124;
	const colW = wide ? 76 : 60;
	const pauseW = 30;
	// Column titles, then a strip with the time between each two events.
	const headH = 74;
	const gapY = headH - 15;
	const rowH = 26;
	const xs: number[] = [];
	let x = 0;
	for (const c of m.columns) {
		if (c.gap?.long) x += pauseW;
		xs.push(x + colW / 2);
		x += colW;
	}
	const width = x + 8;
	const height = headH + m.rows.length * rowH + 6;
	const rowY = (r: number) => headH + r * rowH + rowH / 2;
	const bands = (w: number) =>
		m.rows.map((r, i) =>
			r.tag !== undefined ? (
				<div
					key={`band-${r.id}`}
					className="absolute bg-slate-100"
					style={{ left: 0, width: w, top: headH + i * rowH, height: rowH }}
				/>
			) : null,
		);
	return (
		<div className="flex flex-col gap-1">
			<div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
				<div
					className="relative shrink-0 border-r border-slate-200"
					style={{ width: labelW, height }}
				>
					{bands(labelW)}
					{m.rows.map((r, i) => (
						<InspectContextMenu
							key={r.id}
							target={{ kind: "element", type: "object", id: r.id, typeName: r.type }}
							inspect={inspect}
						>
							<button
								type="button"
								className="absolute left-0 flex items-center gap-1 px-2 text-left text-xs hover:underline"
								style={{ top: headH + i * rowH, height: rowH, width: labelW }}
								onClick={() => inspect({ kind: "element", type: "object", id: r.id })}
							>
								<TypeDot isEvent={false} name={r.type} className="h-2 w-2 shrink-0" />
								{r.tag !== undefined && <VarTag tag={r.tag} />}
								<span
									className={clsx(
										"truncate",
										r.tag !== undefined ? "font-semibold text-slate-900" : "text-slate-700",
									)}
								>
									{r.id}
								</span>
							</button>
						</InspectContextMenu>
					))}
				</div>
				<div className="min-w-0 flex-1 overflow-x-auto">
					<div className="relative" style={{ width, height }}>
						{bands(width)}
						{m.columns.map((c, k) => (
							<Fragment key={c.event.id}>
								{c.tag !== undefined && (
									<div
										className="absolute rounded-md bg-sky-50 ring-1 ring-sky-200"
										style={{
											left: xs[k] - colW / 2 + 4,
											width: colW - 8,
											top: 2,
											height: height - 4,
										}}
									/>
								)}
								{c.gap?.long && (
									<div
										className="pointer-events-none absolute border-l-2 border-dashed border-amber-200"
										style={{ left: xs[k] - colW / 2 - pauseW / 2, top: 6, height: height - 12 }}
									/>
								)}
								{c.gap !== undefined && (
									<span
										className="absolute z-10 -translate-x-1/2"
										style={{
											left: xs[k] - colW / 2 - (c.gap.long ? pauseW / 2 : 0),
											top: gapY,
										}}
									>
										<GapBadge gap={c.gap} short />
									</span>
								)}
							</Fragment>
						))}
						{m.columns.map((c, k) => (
							<Fragment key={`col-${c.event.id}`}>
								<InspectContextMenu
									target={{
										kind: "element",
										type: "event",
										id: c.event.id,
										typeName: c.event.type,
									}}
									inspect={inspect}
								>
									<div
										title={`${c.event.type} · ${formatEventTime(c.event.time)}`}
										className="absolute"
										style={{ left: xs[k] - colW / 2, width: colW, top: 0, height }}
									>
										<button
											type="button"
											className="absolute inset-x-0 top-1 flex flex-col items-center text-center leading-tight hover:underline"
											onClick={() => inspect({ kind: "element", type: "event", id: c.event.id })}
										>
											{c.tag !== undefined && <VarTag tag={c.tag} />}
											<span
												className={clsx(
													"line-clamp-2 w-full px-0.5 text-[11px]",
													c.tag !== undefined ? "font-semibold text-slate-900" : "text-slate-700",
												)}
											>
												{c.event.type}
											</span>
											<span className="text-[10px] text-slate-500">{shortDate(c.event.time)}</span>
										</button>
									</div>
								</InspectContextMenu>
								{c.rows.length > 1 && (
									<div
										className={clsx(
											"pointer-events-none absolute w-0.5 rounded",
											c.tag !== undefined ? "bg-sky-500" : "bg-slate-300",
										)}
										style={{
											left: xs[k] - 1,
											top: rowY(c.rows[0]),
											height: rowY(c.rows[c.rows.length - 1]) - rowY(c.rows[0]),
										}}
									/>
								)}
								{c.rows.map((r, j) => (
									<InspectContextMenu
										key={`${c.event.id}:${r}`}
										target={{
											kind: "element",
											type: "object",
											id: m.rows[r].id,
											typeName: m.rows[r].type,
										}}
										inspect={inspect}
									>
										<span
											title={`${c.event.type} involves ${withQualifier(m.rows[r].id, c.qualifiers[j])}`}
											// A larger hit area than the dot, centred on it.
											className="absolute flex size-4 items-center justify-center"
											style={{ left: xs[k] - 8, top: rowY(r) - 8 }}
										>
											<span
												className="size-2.5 rounded-full ring-2 ring-white"
												style={{ background: typeColor(false, m.rows[r].type) }}
											/>
										</span>
									</InspectContextMenu>
								))}
							</Fragment>
						))}
					</div>
				</div>
			</div>
			{m.hiddenRows > 0 && (
				<span className="text-xs text-slate-600">
					{m.hiddenRows.toLocaleString()} more {m.hiddenRows === 1 ? "object is" : "objects are"}{" "}
					not shown.
				</span>
			)}
		</div>
	);
}

export function ExpandRowButton({ target, inspect }: { target: RowTarget; inspect: Inspect }) {
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Button
				size="icon"
				variant="outline"
				className="size-7"
				title="Show larger"
				onClick={() => setOpen(true)}
			>
				<LuMaximize2 />
			</Button>
			<DialogContent className="max-w-[min(92vw,80rem)] max-h-[92vh] overflow-auto">
				<DialogTitle>{target.title}</DialogTitle>
				<DialogDescription className="sr-only">What this result row binds</DialogDescription>
				<RowCardBody
					target={target}
					wide
					inspect={(t) => {
						setOpen(false);
						inspect(t);
					}}
				/>
			</DialogContent>
		</Dialog>
	);
}
