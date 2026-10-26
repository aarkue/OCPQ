import { RankedBarList } from "@r4pm/components";
import clsx from "clsx";
import {
	Fragment,
	lazy,
	type ReactElement,
	type ReactNode,
	Suspense,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import {
	LuArrowLeft,
	LuArrowRight,
	LuChevronDown,
	LuChevronRight,
	LuMaximize2,
	LuPanelRightClose,
	LuPanelRightOpen,
	LuPin,
	LuScanSearch,
	LuX,
} from "react-icons/lu";
import { BindingIcon } from "@/components/BindingIcon";
import BindingsExportButton from "@/components/binding-table/BindingsExportButton";
import type PaginatedBindingTable from "@/components/binding-table/PaginatedBindingTable";
import { ElementKindIcon } from "@/components/ElementKindIcon";
import { type Area, areaFor } from "@/components/layout/areas";
import { OcelElementDetails } from "@/components/OcelElementInfo";
import { R4pmIsland } from "@/components/r4pm/R4pmIsland";
import Spinner from "@/components/Spinner";
import { TypeDot } from "@/components/TypeDot";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOcelInfo, useOcelStats } from "@/hooks";
import { useEvalResultPage } from "@/hooks/useEvalResultPage";
import { AttrStatsDetail } from "@/routes/ocel-info/OcelInfoViewer";
import { OcelTypeGraphView } from "@/routes/ocel-info/OcelTypeGraphSection";
import { IconForDataType } from "@/routes/ocel-info/OcelTypeViewer";
import { buildTypeGraph, relatedTypes } from "@/routes/ocel-info/type-graph";
import type { BindingRow } from "@/types/generated/BindingRow";
import { InspectorContext } from "./InspectorContext";
import {
	currentInspected,
	EMPTY_INSPECT,
	type InspectAction,
	type InspectHistory,
	type InspectTarget,
	inspectKey,
	inspectReducer,
} from "./inspect";
import {
	AddToQueryButton,
	InspectContextMenu,
	type MenuTarget,
	useMenuEntries,
	useMenuTargetOf,
} from "./inspect-menu";
import {
	DEFAULT_INSPECTOR_WIDTH,
	groupPins,
	type InspectorAction,
	type InspectorState,
	isDefaultPin,
	isInspectorOpen,
	type PinGroupId,
	type PinTarget,
	pinGroupOf,
	pinKey,
} from "./inspector-state";
import { useLatestEvaluation } from "./latest-evaluations";
import { useQueryContext } from "./query-context";
import { focusTypeGraph, scopeOfQuery } from "./query-scope";
import { ExpandRowButton, RowCardBody } from "./RowCard";

const DataTablePaginationLazy = lazy(
	async () => await import("@/components/binding-table/PaginatedBindingTable"),
) as typeof PaginatedBindingTable;

/** Shows a type, event, object or result row at the bottom of the card it was clicked in. */
type Inspect = (target: InspectTarget) => unknown;

export default function Inspector({
	board,
	dispatch,
	page,
}: {
	board: InspectorState;
	dispatch: (action: InspectorAction) => unknown;
	/** The current page, which the panel remembers being open or closed on. */
	page: string;
}) {
	const open = isInspectorOpen(board, page);
	// Once shown, the panel stays mounted while closed, as mounting its cards again (charts, the type
	// graph, result tables) makes every reopening lag.
	const [mounted, setMounted] = useState(open);
	if (open && !mounted) setMounted(true);
	// Bring a newly pinned card into view, wherever its group sits, and mark it briefly.
	const listRef = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once per pin, keyed by its seq
	useEffect(() => {
		const key = board.reveal?.key;
		if (key === undefined) return;
		const card = listRef.current?.querySelector(`[data-pin-key="${CSS.escape(key)}"]`);
		card?.scrollIntoView({ block: "start", behavior: "smooth" });
		card?.animate([{ boxShadow: "0 0 0 2px #38bdf8" }, { boxShadow: "0 0 0 2px transparent" }], {
			duration: 1400,
			easing: "ease-out",
		});
	}, [board.reveal?.seq]);
	return (
		<>
			{!open && (
				<aside
					aria-label="Inspector"
					className="w-10 shrink-0 border-l border-slate-200 bg-white flex"
				>
					<button
						type="button"
						title="Show inspector"
						aria-label="Show inspector"
						className="flex-1 flex flex-col items-center py-2 gap-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
						onClick={() => dispatch({ type: "set-open", open: true, page })}
					>
						<span className="p-1.5">
							<LuPanelRightOpen size={18} />
						</span>
						<span className="text-xs [writing-mode:vertical-rl]">
							Inspector · {board.pins.length}
						</span>
					</button>
				</aside>
			)}
			{mounted && (
				<aside
					aria-label="Inspector"
					className={clsx(
						"shrink-0 border-l border-slate-200 bg-slate-50 flex-col relative min-h-0",
						open ? "flex" : "hidden",
					)}
					style={{ width: board.width ?? DEFAULT_INSPECTOR_WIDTH }}
				>
					<ResizeHandle onResize={(width) => dispatch({ type: "set-width", width })} />
					<div className="flex items-center gap-2 px-4 h-12 border-b border-slate-200 bg-white shrink-0">
						<LuScanSearch aria-hidden="true" className="text-slate-700" />
						<h2 className="font-bold text-[15px] tracking-tight text-slate-900">Inspector</h2>
						<span className="rounded-full bg-slate-100 px-2 py-px text-xs font-medium tabular-nums text-slate-700">
							{board.pins.length}
						</span>
						<span className="flex-1" />
						{board.pins.some((p) => !isDefaultPin(p.target)) && (
							<button
								type="button"
								title="Remove all cards except the overview"
								className="px-2 py-1 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
								onClick={() => dispatch({ type: "clear" })}
							>
								Clear all
							</button>
						)}
						<button
							type="button"
							title="Hide inspector"
							aria-label="Hide inspector"
							className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
							onClick={() => dispatch({ type: "set-open", open: false, page })}
						>
							<LuPanelRightClose size={18} />
						</button>
					</div>
					<div
						ref={listRef}
						// Positioned so absolute descendants (e.g., sr-only labels) clip here, not overflow the app shell.
						className="relative flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-2.5 text-sm text-left [scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent]"
					>
						{groupPins(board.pins).map((group) => (
							<Fragment key={group.id}>
								<GroupHeader
									area={GROUP_AREA[group.id]}
									title={group.title}
									count={group.pins.length}
								/>
								{group.pins.map((p) => {
									const key = pinKey(p.target);
									return (
										<PinnedCard
											// A new row, or child rows of another parent, keep the pin key but start a
											// fresh card, without the previous one's inspected elements.
											key={`${key}:${pinContent(p.target)}`}
											target={p.target}
											collapsed={p.collapsed}
											onToggle={() => dispatch({ type: "toggle-collapsed", key })}
											onUnpin={() => dispatch({ type: "unpin", key })}
										/>
									);
								})}
							</Fragment>
						))}
						{board.pins.length === 0 && (
							<p className="text-slate-600 p-2">
								Nothing pinned. Pin a type, event or object with its pin button, or find one with
								the search (Ctrl/⌘ K).
							</p>
						)}
					</div>
				</aside>
			)}
		</>
	);
}

/** What a row or result card shows besides its pin key: the row, or the parent row it is
 *  filtered to. */
function pinContent(target: PinTarget): string {
	if (target.kind === "row") return JSON.stringify(target.row);
	if (target.kind === "result") return JSON.stringify(target.parent?.row ?? null);
	return "";
}

function ResizeHandle({ onResize }: { onResize: (width: number) => unknown }) {
	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize inspector"
			tabIndex={-1}
			className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-sky-300/50"
			onPointerDown={(ev) => {
				ev.preventDefault();
				const target = ev.currentTarget;
				target.setPointerCapture(ev.pointerId);
				const right = document.documentElement.clientWidth;
				const move = (e: PointerEvent) => onResize(right - e.clientX);
				// A cancelled drag (e.g., a touch the browser takes over) must end it too, or the panel
				// keeps following the pointer.
				const up = () => {
					target.removeEventListener("pointermove", move);
					target.removeEventListener("pointerup", up);
					target.removeEventListener("pointercancel", up);
				};
				target.addEventListener("pointermove", move);
				target.addEventListener("pointerup", up);
				target.addEventListener("pointercancel", up);
			}}
		/>
	);
}

function CardFrame({
	title,
	collapsed,
	onToggle,
	actions,
	footer,
	children,
	pinKey: dataPinKey,
	menu,
}: {
	title: ReactNode;
	/** Right-clicking the header opens the menu of what the card shows. */
	menu?: MenuTarget;
	/** Lets the panel find the card to scroll to it. */
	pinKey?: string;
	collapsed?: boolean;
	onToggle?: () => unknown;
	actions?: ReactNode;
	footer?: ReactNode;
	children: ReactNode;
}) {
	const header = (
		<header className="flex items-center gap-2 pl-2 pr-1.5 h-10">
			{onToggle !== undefined && (
				<button
					type="button"
					aria-label={collapsed ? "Expand" : "Collapse"}
					className="p-1 rounded-md hover:bg-slate-100 text-slate-600"
					onClick={onToggle}
				>
					{collapsed ? <LuChevronRight /> : <LuChevronDown />}
				</button>
			)}
			<span className="font-semibold text-slate-900 truncate min-w-0">{title}</span>
			<span className="flex-1" />
			<span className="flex items-center opacity-60 group-hover:opacity-100 transition-opacity">
				{actions}
			</span>
		</header>
	);
	return (
		<section
			data-pin-key={dataPinKey}
			className="group bg-white border border-slate-200 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] shrink-0 scroll-mt-3"
		>
			{menu !== undefined ? (
				<InspectContextMenu target={menu}>{header}</InspectContextMenu>
			) : (
				header
			)}
			{!collapsed && <div className="px-3 pb-3">{children}</div>}
			{!collapsed && footer}
		</section>
	);
}

function IconButton({
	label,
	onClick,
	disabled,
	children,
}: {
	label: string;
	onClick: () => unknown;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			disabled={disabled}
			className="p-1 rounded-md hover:bg-slate-100 text-slate-600 disabled:opacity-40 disabled:hover:bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
			onClick={onClick}
		>
			{children}
		</button>
	);
}

/** Each group takes the color and icon of the area its pins come from. */
const GROUP_AREA: Record<PinGroupId, Area> = {
	results: areaFor("/constraints"),
	elements: areaFor("/graph"),
	types: areaFor("/ocel-info"),
	overview: areaFor("/ocel-info"),
};

function GroupHeader({ area, title, count }: { area: Area; title: string; count: number }) {
	return (
		<div className="flex items-center gap-2 px-0.5 pt-3 first:pt-0">
			<span
				aria-hidden="true"
				className={clsx(
					"flex h-6 w-6 shrink-0 items-center justify-center rounded-md [&>svg]:size-3.5",
					area.activeClass,
				)}
			>
				{area.icon}
			</span>
			<h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
			<span className="text-xs tabular-nums text-slate-600">{count}</span>
			<span aria-hidden="true" className="h-px flex-1 bg-slate-200" />
		</div>
	);
}

/** The details strip at the bottom of a card, showing what was last clicked inside it. */
function InspectStrip({
	history,
	dispatch,
	tintClass,
}: {
	history: InspectHistory;
	dispatch: (action: InspectAction) => unknown;
	tintClass: string;
}) {
	const { pin } = useContext(InspectorContext);
	const current = currentInspected(history);
	const ref = useRef<HTMLDivElement>(null);
	const currentKey = current !== undefined ? inspectKey(current) : undefined;
	useEffect(() => {
		if (currentKey !== undefined) {
			ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		}
	}, [currentKey]);
	if (current === undefined) return null;
	const inspect: Inspect = (target) => dispatch({ type: "show", target });
	return (
		<div ref={ref} className={clsx("border-t border-slate-200 rounded-b-xl px-3 pb-3", tintClass)}>
			<StripHeaderMenu target={current}>
				<div className="flex items-center gap-1.5 min-h-9">
					{current.kind === "row" ? (
						<>
							<BindingIcon aria-hidden="true" className="size-5 shrink-0 text-slate-600" />
							<span className="font-semibold truncate min-w-0">Binding details</span>
						</>
					) : (
						<>
							{current.kind === "type" ? (
								<TypeDot isEvent={current.isEvent} name={current.name} />
							) : null}
							<ElementKindIcon
								isEvent={current.kind === "type" ? current.isEvent : current.type === "event"}
							/>
							<span className="font-semibold truncate min-w-0">
								{current.kind === "type" ? current.name : current.id}
							</span>
							<span className="text-xs text-slate-600 shrink-0">
								{current.kind === "type" ? "type" : current.type}
							</span>
						</>
					)}
					<span className="flex-1" />
					{history.entries.length > 1 && (
						<>
							<IconButton
								label="Back"
								disabled={history.pos <= 0}
								onClick={() => dispatch({ type: "back" })}
							>
								<LuArrowLeft />
							</IconButton>
							<IconButton
								label="Forward"
								disabled={history.pos >= history.entries.length - 1}
								onClick={() => dispatch({ type: "forward" })}
							>
								<LuArrowRight />
							</IconButton>
						</>
					)}
					{current.kind !== "row" && <AddToQueryButton target={current} />}
					<IconButton
						label="Pin as a card"
						onClick={() => {
							pin(current);
							dispatch({ type: "close" });
						}}
					>
						<LuPin />
					</IconButton>
					<IconButton label="Close" onClick={() => dispatch({ type: "close" })}>
						<LuX />
					</IconButton>
				</div>
			</StripHeaderMenu>
			{current.kind === "row" ? (
				<RowCardBody key={currentKey} target={current} inspect={inspect} />
			) : current.kind === "type" ? (
				<TypeCardBody
					key={currentKey}
					isEvent={current.isEvent}
					name={current.name}
					inspect={inspect}
				/>
			) : (
				<OcelElementDetails
					type={current.type}
					req={{ id: current.id }}
					onNavigate={(el) =>
						"id" in el.req && inspect({ kind: "element", type: el.type, id: el.req.id })
					}
				/>
			)}
		</div>
	);
}

/** Right-clicking the header of an inspected type or element opens its menu. Rows have none. */
function StripHeaderMenu({ target, children }: { target: InspectTarget; children: ReactElement }) {
	const menu = useMenuTargetOf(target);
	if (menu === undefined) return children;
	return <InspectContextMenu target={menu}>{children}</InspectContextMenu>;
}

function PinnedCard({
	target,
	collapsed,
	onToggle,
	onUnpin,
}: {
	target: PinTarget;
	collapsed: boolean;
	onToggle: () => unknown;
	onUnpin: () => unknown;
}) {
	const [inspected, dispatchInspect] = useReducer(inspectReducer, EMPTY_INSPECT);
	const inspect: Inspect = (t) => dispatchInspect({ type: "show", target: t });
	const menu = useMenuTargetOf(
		target.kind === "type" || target.kind === "element" ? target : undefined,
	);
	const current = currentInspected(inspected);
	const footer = (
		<InspectStrip
			history={inspected}
			dispatch={dispatchInspect}
			tintClass={GROUP_AREA[pinGroupOf(target)].tintClass}
		/>
	);
	const unpin = (
		<IconButton label="Unpin" onClick={onUnpin}>
			<LuX />
		</IconButton>
	);
	const frame = { collapsed, onToggle, footer, pinKey: pinKey(target) };
	switch (target.kind) {
		case "log-overview":
			return (
				<CardFrame title="Log overview" {...frame}>
					<LogOverview inspect={inspect} selected={current} />
				</CardFrame>
			);
		case "type-graph":
			return (
				<CardFrame title="Type relations" {...frame}>
					<TypeGraphCardBody inspect={inspect} />
				</CardFrame>
			);
		case "type":
			return (
				<CardFrame
					title={
						<span className="inline-flex items-center gap-1.5">
							<TypeDot isEvent={target.isEvent} name={target.name} />
							<ElementKindIcon isEvent={target.isEvent} />
							{target.name}
						</span>
					}
					menu={menu}
					actions={
						<>
							<AddToQueryButton target={target} />
							{unpin}
						</>
					}
					{...frame}
				>
					<TypeCardBody isEvent={target.isEvent} name={target.name} inspect={inspect} />
				</CardFrame>
			);
		case "result":
			return (
				<CardFrame title={target.title} actions={unpin} {...frame}>
					<ResultTable target={target} compact inspect={inspect} />
				</CardFrame>
			);
		case "row":
			return (
				<CardFrame
					title={target.title}
					actions={
						<>
							<ExpandRowButton target={target} inspect={inspect} />
							{unpin}
						</>
					}
					{...frame}
				>
					<RowCardBody target={target} inspect={inspect} />
				</CardFrame>
			);
		case "element":
			return (
				<CardFrame
					title={
						<span className="inline-flex items-center gap-1.5">
							<ElementKindIcon isEvent={target.type === "event"} />
							{target.id}
						</span>
					}
					menu={menu}
					actions={
						<>
							<AddToQueryButton target={target} />
							{unpin}
						</>
					}
					{...frame}
				>
					<OcelElementDetails
						type={target.type}
						req={{ id: target.id }}
						onNavigate={(el) =>
							"id" in el.req && inspect({ kind: "element", type: el.type, id: el.req.id })
						}
					/>
				</CardFrame>
			);
	}
}

/** Rows per list before "Show all", to keep the card short without a second scroll area. */
const LOG_OVERVIEW_ROWS = 5;

function LogOverview({
	inspect,
	selected,
}: {
	inspect: Inspect;
	selected: InspectTarget | undefined;
}) {
	const stats = useOcelStats();
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	if (stats == null) {
		return <span className="text-slate-600">Loading...</span>;
	}
	const sections = [
		{ title: "Events", isEvent: true, scope: "activity", counts: stats.event_type_counts },
		{ title: "Objects", isEvent: false, scope: "objectType", counts: stats.object_type_counts },
	];
	return (
		<R4pmIsland>
			<div className="flex flex-col gap-4">
				{sections.map((s) => {
					const all = Object.values(s.counts);
					const open = expanded.has(s.title);
					return (
						<div key={s.title}>
							<div className="mb-1.5 text-sm">
								<span className="font-semibold">{s.title}</span>{" "}
								<span className="text-slate-600">
									({all.reduce((sum, c) => sum + c, 0).toLocaleString()})
								</span>
							</div>
							{/* The list pads its own bottom for a scroll fade it does not need here. */}
							<div className="[&>*]:[padding-block-end:0]!">
								<RankedBarList
									items={s.counts}
									max={open ? undefined : LOG_OVERVIEW_ROWS}
									scope={s.scope}
									selectedKey={
										selected?.kind === "type" && selected.isEvent === s.isEvent
											? selected.name
											: undefined
									}
									onItemClick={(name) => inspect({ kind: "type", isEvent: s.isEvent, name })}
								/>
							</div>
							{all.length > LOG_OVERVIEW_ROWS && (
								<button
									type="button"
									onClick={() =>
										setExpanded((prev) => {
											const next = new Set(prev);
											if (!next.delete(s.title)) next.add(s.title);
											return next;
										})
									}
									className="mt-1 rounded px-1 text-xs font-medium text-sky-700 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sky-500"
								>
									{open ? "Show fewer" : `Show all ${all.length}`}
								</button>
							)}
						</div>
					);
				})}
			</div>
		</R4pmIsland>
	);
}

/** Related types shown around a query before "Show more", as more would crowd the card. */
const FOCUS_NEIGHBOURS = 10;

function TypeGraphCardBody({ inspect }: { inspect: Inspect }) {
	const entries = useMenuEntries();
	const ocelInfo = useOcelInfo();
	const stats = useOcelStats();
	const query = useQueryContext();
	const [wholeLog, setWholeLog] = useState(false);
	const [allNeighbours, setAllNeighbours] = useState(false);
	const graph = useMemo(
		() => (ocelInfo === undefined ? undefined : buildTypeGraph(ocelInfo, stats ?? undefined)),
		[ocelInfo, stats],
	);
	const scope = useMemo(() => (query === undefined ? undefined : scopeOfQuery(query)), [query]);
	const focus = useMemo(
		() =>
			scope === undefined || wholeLog || graph === undefined
				? undefined
				: focusTypeGraph(
						scope,
						graph.edges,
						(id) => graph.relationCounts.get(id) ?? 0,
						allNeighbours ? Number.POSITIVE_INFINITY : FOCUS_NEIGHBOURS,
					),
		[scope, wholeLog, graph, allNeighbours],
	);
	if (ocelInfo === undefined) return null;
	return (
		<div className="flex flex-col gap-2">
			{scope !== undefined && (
				<div className="flex items-center gap-2">
					<span className="min-w-0 truncate text-xs text-slate-600">
						{wholeLog
							? "All types in the log"
							: scope.focus === "box"
								? "Types in the selected box's context"
								: "Types in query context"}
					</span>
					<span className="flex-1" />
					<div
						role="group"
						aria-label="Type graph scope"
						className="flex rounded-md bg-slate-100 p-0.5"
					>
						{[
							{ label: "Query", on: !wholeLog },
							{ label: "Log", on: wholeLog },
						].map((o) => (
							<button
								key={o.label}
								type="button"
								aria-pressed={o.on}
								onClick={() => setWholeLog(o.label === "Log")}
								className={clsx(
									"h-6 rounded px-2 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
									o.on
										? "bg-white text-slate-900 shadow-sm"
										: "text-slate-600 hover:text-slate-900",
								)}
							>
								{o.label}
							</button>
						))}
					</div>
				</div>
			)}
			<OcelTypeGraphView
				ocelInfo={ocelInfo}
				stats={stats ?? undefined}
				className="h-72"
				focus={focus}
				typeMenu={(t) => entries({ kind: "type", ...t }, inspect)}
			/>
			{focus !== undefined && (
				<div className="flex items-center gap-2 text-xs text-slate-600">
					<span className="min-w-0 flex-1">Click a type to add it or see its details</span>
					{(focus.hiddenNeighbours > 0 || allNeighbours) && (
						<button
							type="button"
							onClick={() => setAllNeighbours((a) => !a)}
							className="shrink-0 rounded font-medium text-sky-700 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sky-500"
						>
							{allNeighbours ? "Show fewer" : `Show ${focus.hiddenNeighbours} more`}
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function TypeCardBody({
	isEvent,
	name,
	inspect,
}: {
	isEvent: boolean;
	name: string;
	inspect: Inspect;
}) {
	const ocelInfo = useOcelInfo();
	const stats = useOcelStats();
	const [openAttr, setOpenAttr] = useState<string>();
	const type = (isEvent ? ocelInfo?.event_types : ocelInfo?.object_types)?.find(
		(t) => t.name === name,
	);
	if (ocelInfo === undefined) return null;
	if (type === undefined) {
		return <span className="text-slate-600">Not part of the loaded log.</span>;
	}
	const count = (isEvent ? stats?.event_type_counts : stats?.object_type_counts)?.[name];
	const related = relatedTypes(ocelInfo, isEvent, name);
	const relatedCounts = (events: boolean) => {
		const counts: Record<string, number> = {};
		for (const r of related.filter((r) => r.isEvent === events)) {
			counts[r.name] = (counts[r.name] ?? 0) + r.count;
		}
		return counts;
	};
	const relatedSections = [
		{ title: "Related events", isEvent: true, scope: "activity", counts: relatedCounts(true) },
		{ title: "Related objects", isEvent: false, scope: "objectType", counts: relatedCounts(false) },
	].filter((s) => Object.keys(s.counts).length > 0);
	return (
		<div className="flex flex-col gap-4">
			{count !== undefined && (
				<span className="text-slate-600">
					{count.toLocaleString()} {isEvent ? "event" : "object"}
					{count === 1 ? "" : "s"}
				</span>
			)}
			<div>
				<div className="mb-1.5 font-semibold">Attributes</div>
				{type.attributes.length === 0 && <span className="text-slate-600">None</span>}
				<div className="flex flex-wrap gap-1.5">
					{type.attributes.map((attr) => (
						<button
							key={attr.name}
							type="button"
							aria-pressed={openAttr === attr.name}
							className={clsx(
								"flex items-center gap-1 rounded-full border px-2 py-0.5 bg-white",
								openAttr === attr.name
									? "border-sky-400 bg-sky-50"
									: "border-slate-200 hover:bg-slate-50",
							)}
							onClick={() => setOpenAttr((a) => (a === attr.name ? undefined : attr.name))}
						>
							<IconForDataType dtype={attr.type} />
							{attr.name}
						</button>
					))}
				</div>
				{openAttr !== undefined && (
					<AttrStatsDetail scope={isEvent ? "event" : "object"} type={name} attr={openAttr} />
				)}
			</div>
			{relatedSections.length > 0 && (
				<R4pmIsland>
					<div className="flex flex-col gap-4">
						{relatedSections.map((s) => (
							<div key={s.title}>
								<div className="mb-1.5 text-sm font-semibold">{s.title}</div>
								<RankedBarList
									items={s.counts}
									scope={s.scope}
									onItemClick={(other) =>
										inspect({ kind: "type", isEvent: s.isEvent, name: other })
									}
								/>
							</div>
						))}
					</div>
				</R4pmIsland>
			)}
		</div>
	);
}

function ResultTable({
	target,
	compact,
	inspect,
	onPin,
}: {
	target: PinTarget & { kind: "result" };
	compact?: boolean;
	inspect: Inspect;
	/** Called before the table pins another card, e.g., to close the dialog it is shown in. */
	onPin?: () => unknown;
}) {
	const context = useContext(InspectorContext);
	const pin = (t: PinTarget) => {
		onPin?.();
		context.pin(t);
	};
	const latest = useLatestEvaluation(target.slot);
	const summary = latest?.evalRes[target.nodeId];
	const node = latest?.evalNodes[target.nodeId];
	const nodeIndex = latest?.nodeIdtoIndex[target.nodeId];
	const childSets = useMemo(
		() =>
			(latest?.childSets?.[target.nodeId] ?? []).flatMap((c) => {
				const i = latest?.nodeIdtoIndex[c.nodeId];
				return i === undefined ? [] : [{ name: c.name, nodeId: c.nodeId, nodeIndex: i }];
			}),
		[latest, target.nodeId],
	);
	if (
		latest === undefined ||
		summary === undefined ||
		node === undefined ||
		nodeIndex === undefined
	) {
		return <span className="text-slate-600">No results yet. Evaluate the query to see them.</span>;
	}
	const hasConstraints = "Box" in node ? node.Box[0].constraints.length > 0 : true;
	const labels = "Box" in node ? (node.Box[0].labels?.map((l) => l.label) ?? []) : [];
	const queryTitle = target.title.replace(/ · Box \d+$/, "");
	const boxTitle = (nodeId: string) =>
		`${queryTitle} · Box ${(latest.nodeIdtoIndex[nodeId] ?? 0) + 1}`;
	const parent = target.parent;
	return (
		<div className="flex flex-col gap-2 min-w-0">
			{parent !== undefined && (
				<nav
					aria-label="Parent row"
					className="flex min-w-0 flex-wrap items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs"
				>
					<button
						type="button"
						className="font-medium text-sky-800 hover:underline"
						onClick={() =>
							pin({ kind: "result", slot: target.slot, nodeId: parent.nodeId, title: parent.title })
						}
					>
						{parent.title.replace(`${queryTitle} · `, "")}
					</button>
					<LuChevronRight aria-hidden="true" className="text-slate-400" />
					<span className="max-w-40 truncate font-medium text-slate-800">{parent.label}</span>
					<LuChevronRight aria-hidden="true" className="text-slate-400" />
					<span className="font-semibold text-slate-900">{parent.childSet}</span>
					<span className="flex-1" />
					<button
						type="button"
						title="Show the rows of every parent row"
						className="flex items-center gap-0.5 rounded px-1 text-slate-600 hover:bg-white hover:text-slate-900"
						onClick={() => pin({ ...target, parent: undefined })}
					>
						<LuX aria-hidden="true" />
						All rows
					</button>
				</nav>
			)}
			<div className="flex items-center gap-2">
				<span>
					{parent !== undefined ? (
						<ChildRowCount
							evalVersion={latest.evalVersion}
							nodeIndex={nodeIndex}
							parent={parent}
							total={summary.situationCount}
						/>
					) : hasConstraints ? (
						<>
							<b>{summary.situationViolatedCount.toLocaleString()}</b> of{" "}
							{summary.situationCount.toLocaleString()} violated
						</>
					) : (
						<>
							<b>{summary.situationCount.toLocaleString()}</b>{" "}
							{summary.situationCount === 1 ? "binding" : "bindings"}
						</>
					)}
				</span>
				<span className="flex-1" />
				{compact && <ExpandResultButton target={target} inspect={inspect} />}
				{parent === undefined && (
					<BindingsExportButton
						nodeIndex={nodeIndex}
						evalVersion={latest.evalVersion}
						labels={labels}
						hasConstraints={hasConstraints}
					/>
				)}
			</div>
			{summary.situationCount > 0 && (
				<Suspense
					fallback={
						<span className="flex items-center gap-2 text-slate-600">
							<Spinner /> Loading table...
						</span>
					}
				>
					<DataTablePaginationLazy
						key={`${latest.evalVersion}:${target.mode}:${JSON.stringify(parent?.row ?? null)}`}
						parent={parent?.row}
						childSets={childSets}
						onShowRow={(row) =>
							inspect({
								kind: "row",
								slot: target.slot,
								nodeId: target.nodeId,
								title: `${boxTitle(target.nodeId)} · binding details`,
								row: { objects: row.objects, events: row.events },
							})
						}
						onOpenChildren={(row, k) => {
							const set = childSets[k];
							if (set === undefined) return;
							pin({
								kind: "result",
								slot: target.slot,
								nodeId: set.nodeId,
								title: boxTitle(set.nodeId),
								parent: {
									row: { objects: row.objects, events: row.events },
									label: rowLabel(row),
									nodeId: target.nodeId,
									title: boxTitle(target.nodeId),
									childSet: set.name,
								},
							});
						}}
						compact={compact}
						evalVersion={latest.evalVersion}
						nodeIndex={nodeIndex}
						totalCount={summary.situationCount}
						totalViolatedCount={summary.situationViolatedCount}
						node={node}
						addViolationStatus={hasConstraints}
						showElementInfo={(el) =>
							el !== undefined &&
							"id" in el.req &&
							inspect({ kind: "element", type: el.type, id: el.req.id })
						}
						initialMode={target.mode}
					/>
				</Suspense>
			)}
		</div>
	);
}

/** Names a row by the first element it binds, e.g., its order. */
function rowLabel(row: Pick<BindingRow, "objects" | "events">) {
	return row.objects[0]?.[1] ?? row.events[0]?.[1] ?? "row";
}

function ChildRowCount({
	evalVersion,
	nodeIndex,
	parent,
	total,
}: {
	evalVersion: number;
	nodeIndex: number;
	parent: NonNullable<(PinTarget & { kind: "result" })["parent"]>;
	total: number;
}) {
	const { data } = useEvalResultPage({
		evalVersion,
		nodeIndex,
		offset: 0,
		limit: 1,
		violated: null,
		parent: parent.row,
	});
	return (
		<>
			<b>{data?.filteredCount.toLocaleString() ?? "..."}</b> child{" "}
			{data?.filteredCount === 1 ? "row" : "rows"} of {parent.label}
			<span className="text-slate-600"> · {total.toLocaleString()} in total</span>
		</>
	);
}

function ExpandResultButton({
	target,
	inspect,
}: {
	target: PinTarget & { kind: "result" };
	inspect: Inspect;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<Button
				size="icon"
				variant="outline"
				title="Show the full table"
				onClick={() => setOpen(true)}
			>
				<LuMaximize2 />
			</Button>
			<DialogContent className="max-w-[min(90vw,72rem)] max-h-[90vh] overflow-auto">
				<DialogTitle>{target.title}</DialogTitle>
				<DialogDescription className="sr-only">Result rows of this box</DialogDescription>
				<ResultTable
					target={target}
					inspect={(t) => {
						setOpen(false);
						inspect(t);
					}}
					onPin={() => setOpen(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}
