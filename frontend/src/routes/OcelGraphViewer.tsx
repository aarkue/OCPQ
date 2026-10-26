import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useContext, useEffect, useState } from "react";
import { LuPin, LuSearch, LuX } from "react-icons/lu";
import { useSearchParams } from "react-router-dom";
import { ElementKindIcon } from "@/components/ElementKindIcon";
import { OcelElementDetails } from "@/components/OcelElementInfo";
import {
	type GraphRef,
	RelationshipGraph,
} from "@/components/relationship-graph/RelationshipGraph";
import { useBackend } from "@/hooks";
import { InspectorContext } from "@/inspector/InspectorContext";
import { useOcelSampleIds } from "../hooks/useOcelSampleIds";

const SEARCH_HITS = 12;

function rootFromParams(params: URLSearchParams): GraphRef | undefined {
	const id = params.get("root");
	const type = params.get("type");
	return id !== null && (type === "event" || type === "object") ? { type, id } : undefined;
}

/** The /graph page. `?root=<id>&type=event|object` opens it on that element. */
export function OcelGraphRoute() {
	const [params, setParams] = useSearchParams();
	const { data: sampleIds } = useOcelSampleIds(1);
	const fromParams = rootFromParams(params);
	const firstObject = sampleIds?.object_ids[0];
	const root: GraphRef | undefined =
		fromParams ?? (firstObject !== undefined ? { type: "object", id: firstObject } : undefined);
	const setRoot = (r: GraphRef) => setParams({ root: r.id, type: r.type });

	const [neighbourLimit, setNeighbourLimit] = useState(50);
	const [spanningTree, setSpanningTree] = useState(false);
	const [selected, setSelected] = useState<GraphRef>();
	const [detailsOpen, setDetailsOpen] = useState(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new root starts out selected
	useEffect(() => {
		setSelected(root);
		setDetailsOpen(true);
	}, [root?.id, root?.type]);
	const shownDetails = selected ?? root;

	return (
		<div className="flex h-full flex-col text-left">
			<div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 pb-2.5">
				<RootSearch root={root} onPick={setRoot} />
				<label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
					Neighbours per node
					<input
						type="number"
						min={1}
						value={neighbourLimit}
						onChange={(ev) => {
							const v = ev.currentTarget.valueAsNumber;
							if (Number.isFinite(v) && v > 0) setNeighbourLimit(v);
						}}
						title="Nodes with more relations than this are not expanded on their own"
						className="h-9 w-16 rounded-lg border border-slate-300 px-2 text-sm font-medium text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
					/>
				</label>
				<label className="flex items-center gap-2 text-sm text-slate-700">
					<input
						type="checkbox"
						checked={spanningTree}
						onChange={(ev) => setSpanningTree(ev.currentTarget.checked)}
						className="h-4 w-4 accent-sky-700"
					/>
					Spanning tree
				</label>
				<span className="flex-1" />
				<span className="text-xs text-slate-600">
					Click a node to show its details or add its relations
				</span>
			</div>
			<div className="flex min-h-0 flex-1">
				<div className="min-w-0 flex-1">
					{root !== undefined && (
						<RelationshipGraph
							key={`${root.type}:${root.id}`}
							variant="page"
							root={root}
							selectedId={detailsOpen ? shownDetails?.id : undefined}
							neighbourLimit={neighbourLimit}
							spanningTree={spanningTree}
							onSelect={(el) => {
								setSelected(el);
								setDetailsOpen(true);
							}}
						/>
					)}
				</div>
				{detailsOpen && shownDetails !== undefined && (
					<DetailsColumn
						el={shownDetails}
						onNavigate={setSelected}
						onClose={() => setDetailsOpen(false)}
					/>
				)}
			</div>
		</div>
	);
}

function RootSearch({
	root,
	onPick,
}: {
	root: GraphRef | undefined;
	onPick: (r: GraphRef) => unknown;
}) {
	const backend = useBackend();
	const [text, setText] = useState("");
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	useEffect(() => {
		const t = setTimeout(() => setQuery(text.trim()), 150);
		return () => clearTimeout(t);
	}, [text]);
	const { data: hits } = useQuery({
		queryKey: ["ocel", "search-elements", query, SEARCH_HITS],
		queryFn: () => backend["ocel/search-elements"](query, SEARCH_HITS),
		enabled: query !== "",
		staleTime: Number.POSITIVE_INFINITY,
	});
	const list = open && query !== "" ? (hits ?? []) : [];
	const pick = (i: number) => {
		const hit = list[i];
		if (hit === undefined) return;
		onPick({ type: hit.is_event ? "event" : "object", id: hit.id });
		setText("");
		setOpen(false);
	};
	return (
		<div className="relative">
			<label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
				Root
				<span className="flex h-9 w-80 items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 focus-within:ring-2 focus-within:ring-sky-500">
					<LuSearch className="shrink-0 text-slate-600" aria-hidden="true" />
					<input
						role="combobox"
						aria-expanded={list.length > 0}
						aria-controls="graph-root-hits"
						aria-activedescendant={list.length > 0 ? `graph-root-hit-${active}` : undefined}
						value={text}
						placeholder={root?.id ?? "Search an event or object ID"}
						onChange={(ev) => {
							setText(ev.currentTarget.value);
							setOpen(true);
							setActive(0);
						}}
						onFocus={() => setOpen(true)}
						onBlur={() => setOpen(false)}
						onKeyDown={(ev) => {
							if (ev.key === "ArrowDown") {
								ev.preventDefault();
								setActive((a) => Math.min(a + 1, list.length - 1));
							} else if (ev.key === "ArrowUp") {
								ev.preventDefault();
								setActive((a) => Math.max(a - 1, 0));
							} else if (ev.key === "Enter") {
								// Until the debounce catches up, the hits are for the previous text.
								if (query === text.trim()) pick(active);
							} else if (ev.key === "Escape") {
								setOpen(false);
							}
						}}
						className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-900"
					/>
					{root !== undefined && text === "" && (
						<span className="shrink-0 text-xs font-normal text-slate-600">{root.type}</span>
					)}
				</span>
			</label>
			{list.length > 0 && (
				<div
					id="graph-root-hits"
					role="listbox"
					aria-label="Matching events and objects"
					className="absolute top-full right-0 z-20 mt-1 max-h-80 w-80 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
				>
					{list.map((hit, i) => (
						<div
							key={`${hit.is_event}:${hit.id}`}
							id={`graph-root-hit-${i}`}
							role="option"
							aria-selected={i === active}
							tabIndex={-1}
							onMouseDown={(ev) => {
								ev.preventDefault();
								pick(i);
							}}
							onMouseEnter={() => setActive(i)}
							className={clsx(
								"flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
								i === active && "bg-sky-50",
							)}
						>
							<ElementKindIcon isEvent={hit.is_event} />
							<span className="min-w-0 flex-1 truncate font-medium text-slate-900">{hit.id}</span>
							<span className="shrink-0 text-xs text-slate-600">{hit.type_name}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/** Details of the selected node, beside the graph. */
function DetailsColumn({
	el,
	onNavigate,
	onClose,
}: {
	el: GraphRef;
	onNavigate: (el: GraphRef) => unknown;
	onClose: () => unknown;
}) {
	const { pin } = useContext(InspectorContext);
	return (
		<aside
			aria-label={`Details of ${el.id}`}
			className="flex w-[340px] shrink-0 flex-col border-l border-slate-200 bg-white text-sm"
		>
			<header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-slate-100 pr-2 pl-4">
				<ElementKindIcon isEvent={el.type === "event"} />
				<span className="min-w-0 truncate text-[15px] font-bold">{el.id}</span>
				<span className="shrink-0 text-xs text-slate-600">{el.type}</span>
				<span className="flex-1" />
				<button
					type="button"
					title="Pin to the inspector"
					aria-label="Pin to the inspector"
					onClick={() => pin({ kind: "element", type: el.type, id: el.id })}
					className="rounded-md p-1.5 text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500"
				>
					<LuPin />
				</button>
				<button
					type="button"
					title="Close"
					aria-label="Close"
					onClick={onClose}
					className="rounded-md p-1.5 text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500"
				>
					<LuX />
				</button>
			</header>
			<div className="min-h-0 flex-1 overflow-auto px-4 pt-3 pb-4">
				<OcelElementDetails
					type={el.type}
					req={{ id: el.id }}
					showGraph={false}
					onNavigate={(next) =>
						"id" in next.req && onNavigate({ type: next.type, id: next.req.id })
					}
				/>
			</div>
		</aside>
	);
}
