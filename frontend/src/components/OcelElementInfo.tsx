import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { LuArrowLeft, LuArrowRight, LuExternalLink } from "react-icons/lu";
import { Link } from "react-router-dom";
import type { ElementRelations, RelatedElement } from "@/bindings/generated";
import { ElementInfoContext, type ElementRef } from "@/ElementInfo";
import { useBackend, useOcelEvent, useOcelObject } from "@/hooks";
import { InspectContextMenu, useGraphNodeEntries } from "@/inspector/inspect-menu";
import { formatEventTime, formatGap } from "@/lib/time-format";
import type { OCELAttributeValue, OCELEvent, OCELObject } from "@/types/ocel";
import { ClipboardButton } from "./ClipboardButton";
import { RelationshipGraph } from "./relationship-graph/RelationshipGraph";
import Spinner from "./Spinner";
import { TypeDot, typeColor } from "./TypeDot";

const RELATIONS_PREVIEW = 50;
const RELATIONS_ALL = 1000;
const LIFECYCLE_ROWS = 8;
const CHIPS_PER_GROUP = 12;
const GRAPH_HEIGHT = 480;
/** OCEL 2.0 gives an object's initial attribute values this timestamp. */
const INITIAL_VALUE_TIME = "1970-01-01T00:00:00";

type Navigate = (el: ElementRef) => unknown;

function useOcelElementData(type: "event" | "object", req: ElementRef["req"]) {
	const objectQuery = useOcelObject(type === "object" ? req : undefined);
	const eventQuery = useOcelEvent(type === "event" ? req : undefined);
	const { data, isError } = type === "object" ? objectQuery : eventQuery;
	const object = data !== undefined && "object" in data ? data.object : undefined;
	const event = data !== undefined && "event" in data ? data.event : undefined;
	return { isError, object, event };
}

/** Attributes, lifecycle, relations and the neighbourhood graph of one event or object. */
export function OcelElementDetails({
	type,
	req,
	onNavigate,
	showGraph = true,
}: {
	type: "event" | "object";
	req: ElementRef["req"];
	/** Where clicks on related elements go. Defaults to the global element view. */
	onNavigate?: Navigate;
	/** Off where a full relationship graph is already beside the details. */
	showGraph?: boolean;
}) {
	const { showElementInfo } = useContext(ElementInfoContext);
	const navigate = onNavigate ?? showElementInfo;
	const { isError, object, event } = useOcelElementData(type, req);
	if (isError) {
		return <p className="py-2 text-sm font-semibold text-red-700">No {type} with this ID.</p>;
	}
	if (object !== undefined) {
		return (
			<ElementBody key={object.id} object={object} navigate={navigate} showGraph={showGraph} />
		);
	}
	if (event !== undefined) {
		return <ElementBody key={event.id} event={event} navigate={navigate} showGraph={showGraph} />;
	}
	return (
		<div className="flex items-center gap-x-2 py-2 text-sm text-slate-600">
			<Spinner /> Loading...
		</div>
	);
}

function ElementBody({
	object,
	event,
	navigate,
	showGraph,
}: ({ object: OCELObject; event?: undefined } | { event: OCELEvent; object?: undefined }) & {
	navigate: Navigate;
	showGraph: boolean;
}) {
	const element = object ?? event;
	const type = object !== undefined ? "object" : "event";
	const backend = useBackend();
	const [limit, setLimit] = useState(RELATIONS_PREVIEW);
	const { data: rels, isError: relsFailed } = useQuery({
		queryKey: ["ocel", "element-relations", type, element.id, limit],
		queryFn: () => backend["ocel/element-relations"](type, element.id, limit),
		placeholderData: keepPreviousData,
	});
	const loadAll = () => setLimit(RELATIONS_ALL);
	return (
		<div className="flex flex-col text-left text-sm">
			<div className="flex min-w-0 items-center gap-1.5 pb-1 text-xs text-slate-600">
				<TypeDot
					isEvent={event !== undefined}
					name={element.type}
					className={event !== undefined ? "rounded-[3px]" : undefined}
				/>
				<span className="truncate font-medium text-slate-800">{element.type}</span>
				{event !== undefined && (
					<span className="shrink-0 tabular-nums">· {formatEventTime(event.time)}</span>
				)}
				<span className="flex-1" />
				<ClipboardButton name="ID" value={element.id} />
			</div>
			<Attributes object={object} event={event} />
			{object !== undefined && (
				<Lifecycle rels={rels} failed={relsFailed} navigate={navigate} onLoadAll={loadAll} />
			)}
			<RelatedObjects
				isEvent={event !== undefined}
				id={element.id}
				rels={rels}
				failed={relsFailed}
				navigate={navigate}
				onLoadAll={loadAll}
				allRequested={limit >= RELATIONS_ALL}
			/>
			{showGraph && <RelationshipGraphSection type={type} id={element.id} navigate={navigate} />}
		</div>
	);
}

function Section({
	title,
	count,
	actions,
	children,
}: {
	title: string;
	count?: number;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="border-t border-slate-100 py-3 last:pb-0">
			<div className="mb-2 flex min-h-6 items-center gap-2">
				<h4 className="text-xs font-semibold text-slate-700">
					{title}
					{count !== undefined && (
						<span className="font-normal tabular-nums text-slate-600">
							{" "}
							· {count.toLocaleString()}
						</span>
					)}
				</h4>
				<span className="flex-1" />
				{actions}
			</div>
			{children}
		</section>
	);
}

const textButtonClass =
	"rounded text-xs font-medium text-sky-700 underline-offset-2 hover:underline outline-none focus-visible:ring-2 focus-visible:ring-sky-500";
const smallButtonClass =
	"inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

function formatValue(value: OCELAttributeValue) {
	return value === null ? "empty" : String(value);
}

function Attributes({ object, event }: { object?: OCELObject; event?: OCELEvent }) {
	const [open, setOpen] = useState<string>();
	const groups = useMemo(() => {
		const attributes: { name: string; value: OCELAttributeValue; time?: string }[] =
			object?.attributes ?? event?.attributes ?? [];
		const byName = new Map<string, { value: OCELAttributeValue; time?: string }[]>();
		for (const a of attributes) {
			const values = byName.get(a.name) ?? [];
			values.push({ value: a.value, time: a.time });
			byName.set(a.name, values);
		}
		for (const values of byName.values()) {
			values.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
		}
		return [...byName.entries()];
	}, [object, event]);
	if (groups.length === 0) return null;
	const history = groups.find(([name]) => name === open)?.[1];
	const chipClass =
		"inline-flex max-w-full items-baseline gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs";
	return (
		<div className="pt-1 pb-3">
			<div className="flex flex-wrap gap-1.5">
				{groups.map(([name, values]) => {
					const latest = values[values.length - 1];
					const content = (
						<>
							<span className="shrink-0 text-slate-600">{name}</span>
							<span className="truncate font-medium tabular-nums text-slate-900">
								{formatValue(latest.value)}
							</span>
							{values.length > 1 && (
								<span className="shrink-0 tabular-nums text-slate-600">{values.length} values</span>
							)}
						</>
					);
					return values.length > 1 ? (
						<button
							key={name}
							type="button"
							aria-expanded={open === name}
							title="Show how this value changed"
							className={`${chipClass} hover:border-slate-300 hover:bg-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 aria-expanded:border-sky-300 aria-expanded:bg-sky-50`}
							onClick={() => setOpen((o) => (o === name ? undefined : name))}
						>
							{content}
						</button>
					) : (
						<span key={name} className={chipClass} title={`${name}: ${formatValue(latest.value)}`}>
							{content}
						</span>
					);
				})}
			</div>
			{history !== undefined && (
				<ol className="mt-2 rounded-md border border-slate-200 bg-white text-xs">
					{history.map((v, i) => (
						<li
							key={i}
							className="flex justify-between gap-3 border-b border-slate-100 px-2 py-1 last:border-0"
						>
							<span className="tabular-nums text-slate-600">
								{v.time === undefined || v.time.startsWith(INITIAL_VALUE_TIME)
									? "initial"
									: formatEventTime(v.time)}
							</span>
							<span className="truncate font-medium tabular-nums text-slate-900">
								{formatValue(v.value)}
							</span>
						</li>
					))}
				</ol>
			)}
		</div>
	);
}

/** The events of an object in time order, with the time between consecutive ones. */
function Lifecycle({
	rels,
	navigate,
	onLoadAll,
	failed,
}: {
	rels: ElementRelations | null | undefined;
	navigate: Navigate;
	onLoadAll: () => unknown;
	failed: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	if (rels == null) {
		return (
			<Section title="Lifecycle">
				<RelationsPending failed={failed} />
			</Section>
		);
	}
	if (rels.num_events === 0) {
		return (
			<Section title="Lifecycle">
				<p className="text-xs text-slate-600">No events relate to this object.</p>
			</Section>
		);
	}
	const shown = expanded ? rels.events : rels.events.slice(0, LIFECYCLE_ROWS);
	const hidden = rels.num_events - shown.length;
	return (
		<Section title="Lifecycle" count={rels.num_events}>
			<ol>
				{shown.map((ev, i) => (
					<InspectContextMenu
						key={`${ev.id}@${ev.qualifier}`}
						target={{ kind: "element", type: "event", id: ev.id, typeName: ev.type_name }}
						inspect={(t) => t.kind === "element" && navigate({ type: t.type, req: { id: t.id } })}
					>
						<li className="grid grid-cols-[10px_minmax(0,1fr)_auto] gap-x-2.5">
							<span aria-hidden="true" className="flex flex-col items-center">
								<span
									className="mt-1 h-2.5 w-2.5 shrink-0 rounded-[3px]"
									style={{ backgroundColor: typeColor(true, ev.type_name) }}
								/>
								{i < shown.length - 1 && <span className="w-px flex-1 bg-slate-200" />}
							</span>
							<span className="min-w-0 pb-2.5">
								<button
									type="button"
									title={`Show ${ev.id}`}
									className="block max-w-full truncate rounded text-left font-semibold text-slate-900 underline-offset-2 hover:underline outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
									onClick={() => navigate({ type: "event", req: { id: ev.id } })}
								>
									{ev.type_name}
								</button>
								<span className="block truncate text-xs text-slate-600">
									<span className="tabular-nums">{formatEventTime(ev.time)}</span>
									<span className="italic"> as {ev.qualifier}</span>
								</span>
							</span>
							<span className="pt-0.5 text-right text-xs whitespace-nowrap tabular-nums text-slate-600">
								{i > 0 ? formatGap(shown[i - 1].time, ev.time) : ""}
							</span>
						</li>
					</InspectContextMenu>
				))}
			</ol>
			{hidden > 0 && !expanded && (
				<button
					type="button"
					className={textButtonClass}
					onClick={() => {
						setExpanded(true);
						if (rels.events.length < rels.num_events) onLoadAll();
					}}
				>
					Show all {rels.num_events.toLocaleString()} events
				</button>
			)}
			{hidden > 0 && expanded && (
				<p className="text-xs text-slate-600">
					The first {rels.events.length.toLocaleString()} of {rels.num_events.toLocaleString()}{" "}
					events.
				</p>
			)}
		</Section>
	);
}

function RelationsPending({ failed }: { failed: boolean }) {
	return failed ? (
		<p className="text-xs text-red-700">The relations could not be loaded.</p>
	) : (
		<Spinner />
	);
}

type RelationGroup = { key: string; qualifier: string; incoming: boolean; items: RelatedElement[] };

function groupByQualifier(rels: ElementRelations): RelationGroup[] {
	const groups: RelationGroup[] = [];
	for (const [list, incoming] of [
		[rels.objects, false],
		[rels.incoming_objects, true],
	] as const) {
		const byQualifier = new Map<string, RelatedElement[]>();
		for (const r of list) {
			byQualifier.set(r.qualifier, [...(byQualifier.get(r.qualifier) ?? []), r]);
		}
		for (const [qualifier, items] of byQualifier) {
			groups.push({ key: `${incoming ? "in" : "out"}:${qualifier}`, qualifier, incoming, items });
		}
	}
	return groups;
}

function RelatedObjects({
	isEvent,
	id,
	rels,
	navigate,
	onLoadAll,
	allRequested,
	failed,
}: {
	isEvent: boolean;
	id: string;
	rels: ElementRelations | null | undefined;
	navigate: Navigate;
	onLoadAll: () => unknown;
	allRequested: boolean;
	failed: boolean;
}) {
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const groups = useMemo(() => (rels != null ? groupByQualifier(rels) : []), [rels]);
	const title = isEvent ? "Objects" : "Related objects";
	if (rels == null) {
		return (
			<Section title={title}>
				<RelationsPending failed={failed} />
			</Section>
		);
	}
	const total = rels.num_objects + rels.num_incoming_objects;
	const listed = rels.objects.length + rels.incoming_objects.length;
	return (
		<Section title={title} count={total}>
			{total === 0 && <p className="text-xs text-slate-600">No related objects.</p>}
			<div className="grid grid-cols-[fit-content(7.5rem)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
				{groups.map((g) => {
					const open = expanded.has(g.key);
					const shown = open ? g.items : g.items.slice(0, CHIPS_PER_GROUP);
					return (
						<Fragment key={g.key}>
							<span
								className="flex min-w-0 items-center gap-1 text-xs text-slate-600"
								title={
									isEvent
										? `Involved as ${g.qualifier}`
										: g.incoming
											? `These objects ${g.qualifier} ${id}`
											: `${id} ${g.qualifier} these objects`
								}
							>
								{!isEvent && g.incoming && <LuArrowLeft className="shrink-0" aria-hidden="true" />}
								<span className="truncate italic">{g.qualifier}</span>
								{!isEvent && !g.incoming && (
									<LuArrowRight className="shrink-0" aria-hidden="true" />
								)}
							</span>
							<span className="flex min-w-0 flex-wrap gap-1">
								{shown.map((r) => (
									<InspectContextMenu
										key={r.id}
										target={{ kind: "element", type: "object", id: r.id, typeName: r.type_name }}
										inspect={(t) =>
											t.kind === "element" && navigate({ type: t.type, req: { id: t.id } })
										}
									>
										<button
											type="button"
											title={`${r.id} (${r.type_name})`}
											className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white py-px pr-2 pl-1.5 text-xs text-slate-900 hover:border-slate-300 hover:bg-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
											onClick={() => navigate({ type: "object", req: { id: r.id } })}
										>
											<TypeDot isEvent={false} name={r.type_name} className="h-2 w-2" />
											<span className="max-w-40 truncate">{r.id}</span>
										</button>
									</InspectContextMenu>
								))}
								{g.items.length > shown.length && (
									<button
										type="button"
										className={textButtonClass}
										onClick={() => setExpanded((s) => new Set(s).add(g.key))}
									>
										+{(g.items.length - shown.length).toLocaleString()} more
									</button>
								)}
							</span>
						</Fragment>
					);
				})}
			</div>
			{listed < total && (
				<p className="mt-2 text-xs text-slate-600">
					{listed.toLocaleString()} of {total.toLocaleString()} listed.{" "}
					{/* Once all are requested, the backend's cap per list keeps the rest out. */}
					{!allRequested && (
						<button type="button" className={textButtonClass} onClick={onLoadAll}>
							Load more
						</button>
					)}
				</p>
			)}
		</Section>
	);
}

function RelationshipGraphSection({
	type,
	id,
	navigate,
}: {
	type: "event" | "object";
	id: string;
	navigate: Navigate;
}) {
	const nodeEntries = useGraphNodeEntries();
	return (
		<Section
			title="Relationship graph"
			actions={
				<Link
					to={`/graph?${new URLSearchParams({ root: id, type })}`}
					className={smallButtonClass}
					title="Open in the relationship graph page"
				>
					<LuExternalLink aria-hidden="true" />
					Graph page
				</Link>
			}
		>
			<RelationshipGraph
				variant="card"
				root={{ type, id }}
				height={GRAPH_HEIGHT}
				onSelect={(el) => navigate({ type: el.type, req: { id: el.id } })}
				nodeActions={nodeEntries}
			/>
		</Section>
	);
}

/** Element details next to its relationship graph. */
export default function OcelElementInfo({
	type,
	req,
	onNavigate,
}: {
	type: "event" | "object";
	req: ElementRef["req"];
	/** Where clicks on related elements go. Defaults to the global element view. */
	onNavigate?: Navigate;
}) {
	const { showElementInfo } = useContext(ElementInfoContext);
	const navigate = onNavigate ?? showElementInfo;
	const { object, event } = useOcelElementData(type, req);
	const loadedId = (object ?? event)?.id;

	const overflowDiv = useRef<HTMLDivElement>(null);
	const elementKey = `${type}:${JSON.stringify(req)}`;
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll back up whenever another element is shown
	useEffect(() => {
		if (overflowDiv.current !== null) {
			overflowDiv.current.scrollTop = 0;
		}
	}, [elementKey]);

	// The graph keeps its layout when one of its own nodes is picked, and only re-roots when the
	// element comes from elsewhere (search, relation lists, history).
	const [graphRoot, setGraphRoot] = useState<{ type: "event" | "object"; id: string }>();
	const pickedInGraph = useRef(false);
	useEffect(() => {
		if (loadedId === undefined) return;
		if (pickedInGraph.current) {
			pickedInGraph.current = false;
			return;
		}
		setGraphRoot({ type, id: loadedId });
	}, [type, loadedId]);

	return (
		<div className="grid h-full w-full grid-cols-[minmax(20rem,1fr)_2fr] gap-x-4 text-left">
			<div className="h-full overflow-auto border-r border-slate-200 p-3" ref={overflowDiv}>
				{loadedId !== undefined && (
					<h2 className="truncate text-lg font-semibold text-slate-900">{loadedId}</h2>
				)}
				<OcelElementDetails type={type} req={req} onNavigate={navigate} showGraph={false} />
			</div>
			<div className="h-full w-full overflow-hidden">
				{graphRoot !== undefined && (
					<RelationshipGraph
						variant="page"
						root={graphRoot}
						selectedId={loadedId}
						onSelect={(el) => {
							if (el.id !== loadedId) {
								pickedInGraph.current = true;
							}
							navigate({ type: el.type, req: { id: el.id } });
						}}
					/>
				)}
			</div>
		</div>
	);
}
