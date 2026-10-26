import { useQueries } from "@tanstack/react-query";
import clsx from "clsx";
import {
	Fragment,
	type MutableRefObject,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import toast from "react-hot-toast";
import {
	LuClipboardCopy,
	LuDownload,
	LuPanelRight,
	LuPlus,
	LuScan,
	LuUndo2,
	LuZoomIn,
	LuZoomOut,
} from "react-icons/lu";
import AutoSizer from "react-virtualized-auto-sizer";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBackend } from "@/hooks";
import { MOD_KEY } from "@/lib/platform";
import Spinner from "../Spinner";
import { TypeDot } from "../TypeDot";
import {
	BADGE_H,
	collideForce,
	type DrawLink,
	type DrawNode,
	drawLink,
	drawNode,
	type LinkLook,
	paintNodeHitArea,
	ringForce,
} from "./draw";
import {
	EMPTY_GRAPH,
	fitView,
	type GraphState,
	type HopRings,
	hopRings,
	isEvent,
	mergeGraphs,
	neighbourhood,
	relationsAmong,
	typeCounts,
	wheelZoomFactor,
	withoutTypes,
} from "./graph-model";

export type GraphRef = { type: "event" | "object"; id: string };

/** A node as extra menu entries see it: its type and the types of the nodes linked to it. */
export type GraphNodeContext = {
	ref: GraphRef;
	type: string;
	neighbours: { isEvent: boolean; name: string }[];
};
export type GraphNodeAction = { label: string; icon?: ReactNode; onSelect: () => unknown };

const MAX_NODES = { page: 500, card: 150 };
const HOP_CHOICES = { page: [1, 2, 3], card: [1, 2] };
/** Nodes sit on one ring per hop around the root. `ringGap` separates the rings, `slot` is the
 *  arc a badge needs, so crowded rings grow. Cards pack tighter to stay readable at card size. */
const LAYOUT = {
	page: { ringGap: 230, slot: 180, charge: -400, collideMargin: 16, maxZoom: 1.6 },
	card: { ringGap: 160, slot: 150, charge: -250, collideMargin: 10, maxZoom: 1.2 },
};
const ZOOM_RANGE = [0.05, 6] as const;
const ZOOM_BUTTON_FACTOR = 1.4;
export const ZOOM_KEY = MOD_KEY;

function escapeHtml(text: string) {
	return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

type NeighbourhoodOptions = {
	variant: "page" | "card";
	neighbourLimit?: number;
	spanningTree?: boolean;
};

/** The elements up to `hops` away from any of `roots`, plus every relation among the roots
 *  themselves. With 0 hops that is the roots and how they relate. */
export function useNeighbourhood(
	roots: GraphRef[],
	hops: number,
	{ variant, neighbourLimit = 10, spanningTree = false }: NeighbourhoodOptions,
) {
	const backend = useBackend();
	const options = roots.map((r) => ({
		root: r.id,
		rootIsObject: r.type === "object",
		maxDistance: hops,
		relsSizeIgnoreThreshold: neighbourLimit,
		spanningTree,
		maxNodes: MAX_NODES[variant],
	}));
	const results = useQueries({
		queries: options.map((o) => ({
			queryKey: ["ocel", "graph", o],
			queryFn: () => backend["ocel/graph"](o),
		})),
	});
	const data = results.map((q) => q.data);
	const key = JSON.stringify(options);
	// Changes when a graph arrives and when one is fetched again, e.g., after another log is loaded.
	const loaded = results.map((q) => (q.data === undefined ? 0 : q.dataUpdatedAt)).join();
	// biome-ignore lint/correctness/useExhaustiveDependencies: `loaded` stands for `data`
	const graph = useMemo(() => {
		if (data.length === 0 || data.some((d) => d === undefined)) return undefined;
		const merged = data.reduce<GraphState>(
			(acc, d) => (d ? mergeGraphs(acc, d) : acc),
			EMPTY_GRAPH,
		);
		const rootIds = new Set(roots.map((r) => r.id));
		const among: GraphState = {
			nodes: [],
			links: relationsAmong(merged.nodes.filter((n) => rootIds.has(n.id))),
			expanded: [],
		};
		return { ...mergeGraphs(merged, among), truncated: data.some((d) => d?.truncated) };
	}, [key, loaded]);
	return {
		graph,
		key,
		isError: results.some((q) => q.isError),
		isFetching: results.some((q) => q.isFetching),
	};
}

/** The neighbourhood of one event or object, as a full page or a small card. Clicking a node opens
 *  a menu to show its details, add its relations or copy its id. */
export function RelationshipGraph({
	root,
	variant,
	height,
	selectedId,
	onSelect,
	neighbourLimit = 10,
	spanningTree = false,
	nodeActions,
	anchors = [],
	hops: hopsProp,
}: {
	root: GraphRef;
	variant: "page" | "card";
	/** Card only. The page version fills its parent. */
	height?: number;
	selectedId?: string;
	onSelect: (el: GraphRef) => unknown;
	/** Nodes with more relations than this are not expanded on their own. */
	neighbourLimit?: number;
	spanningTree?: boolean;
	/** Further entries for a node's menu, after the built-in ones. */
	nodeActions?: (node: GraphNodeContext) => GraphNodeAction[];
	/** Elements to center on together with `root`, e.g., what a result row binds, each with a tag
	 *  on its badge. Relations among them are drawn dark. */
	anchors?: { ref: GraphRef; tag: string }[];
	/** Hops shown, set by the parent, which hides the card's own hop toggle. 0 shows only the root
	 *  and anchors with all relations among them. */
	hops?: number;
}) {
	const backend = useBackend();
	const [ownHops, setHops] = useState(variant === "page" ? 2 : 1);
	const hops = hopsProp ?? ownHops;
	const others = anchors.filter((a) => a.ref.id !== root.id);
	const rootsKey = [root.id, ...others.map((a) => a.ref.id)].join("\u0000");
	const rootRefs = [root, ...others.map((a) => a.ref)];
	const rootIds = useMemo(() => rootsKey.split("\u0000"), [rootsKey]);
	const {
		graph: base,
		key: baseKey,
		isError,
		isFetching,
	} = useNeighbourhood(rootRefs, hops, { variant, neighbourLimit, spanningTree });
	const rootSet = useMemo(() => new Set(rootIds), [rootIds]);
	const tags = useMemo(() => new Map(anchors.map((a) => [a.ref.id, a.tag])), [anchors]);

	// Expansions are layered over the fetched graph and dropped when that graph changes.
	const [expansions, setExpansions] = useState({
		key: "",
		graph: EMPTY_GRAPH,
		history: [] as GraphState[],
	});
	const current =
		expansions.key === baseKey ? expansions : { key: baseKey, graph: EMPTY_GRAPH, history: [] };
	const full = useMemo(
		() => (base === undefined ? undefined : mergeGraphs(base, current.graph)),
		[base, current.graph],
	);
	const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<string>>(new Set());
	const shown = useMemo(
		() => (full === undefined ? undefined : withoutTypes(full, hiddenTypes)),
		[full, hiddenTypes],
	);
	const expanded = useMemo(() => new Set(full?.expanded), [full]);

	// force-graph keeps positions on the node objects, so a node keeps its object across updates.
	const nodeObjects = useRef(new Map<string, DrawNode>());
	const ringsRef = useRef<HopRings>();
	const graphData = useMemo(() => {
		const layout = LAYOUT[variant];
		const shownNodes = shown?.nodes ?? [];
		const rings = hopRings(
			shownNodes.map((n) => n.id),
			shown?.links ?? [],
			rootIds,
			layout.slot,
			layout.ringGap,
		);
		ringsRef.current = rings;
		const next = new Map<string, DrawNode>();
		const added = new Set<string>();
		const nodes = shownNodes.map((n) => {
			let obj = nodeObjects.current.get(n.id);
			if (obj === undefined) {
				obj = { ...n };
				added.add(n.id);
			}
			next.set(n.id, obj);
			return obj;
		});
		nodeObjects.current = next;
		// New nodes start on their ring, next to the node they were reached from, so the layout
		// only has to settle instead of untangle.
		const children = new Map<string, number>();
		for (const p of rings.parent.values()) children.set(p, (children.get(p) ?? 0) + 1);
		const placed = new Map<string, number>();
		const firstRing = rings.order.filter((id) => rings.dist.get(id) === 1);
		for (const id of rings.order) {
			const obj = next.get(id);
			const d = rings.dist.get(id) ?? 0;
			if (obj === undefined) continue;
			if (d !== 0) {
				// A former root keeps its node object, which must not stay pinned in place.
				obj.fx = undefined;
				obj.fy = undefined;
			}
			if (d === 0) {
				const i = rootIds.indexOf(id);
				const a = (2 * Math.PI * i) / rootIds.length - Math.PI / 2;
				obj.fx = rings.radii[0] * Math.cos(a);
				obj.fy = rings.radii[0] * Math.sin(a);
				obj.x = obj.fx;
				obj.y = obj.fy;
				continue;
			}
			if (!added.has(id)) continue;
			const r = rings.radii[d];
			let angle: number;
			const parent = next.get(rings.parent.get(id) ?? "");
			if (d === 1 || parent?.x === undefined || parent.y === undefined) {
				angle = (2 * Math.PI * firstRing.indexOf(id)) / Math.max(1, firstRing.length) - Math.PI / 2;
			} else {
				const pid = parent.id;
				const k = placed.get(pid) ?? 0;
				placed.set(pid, k + 1);
				angle =
					Math.atan2(parent.y, parent.x) +
					((k - ((children.get(pid) ?? 1) - 1) / 2) * layout.slot) / r;
			}
			obj.x = r * Math.cos(angle);
			obj.y = r * Math.sin(angle);
		}
		const links: DrawLink[] = (shown?.links ?? []).map((l) => ({ ...l }));
		return { nodes, links };
	}, [shown, rootIds, variant]);

	const [hoverId, setHoverId] = useState<string>();
	const [legendType, setLegendType] = useState<string>();
	const lit = useMemo(() => {
		if (hoverId !== undefined) return neighbourhood(shown?.links ?? [], hoverId);
		// A type hidden while its chip is hovered has no nodes to light up, and lighting none would
		// dim the whole graph.
		if (legendType !== undefined && !hiddenTypes.has(legendType)) {
			return new Set((shown?.nodes ?? []).filter((n) => n.type === legendType).map((n) => n.id));
		}
		return undefined;
	}, [hoverId, legendType, hiddenTypes, shown]);
	const linkLook = (l: DrawLink): LinkLook => {
		const s = typeof l.source === "object" ? l.source.id : l.source;
		const t = typeof l.target === "object" ? l.target.id : l.target;
		if (hoverId !== undefined) return s === hoverId || t === hoverId ? "hot" : "dim";
		if (lit !== undefined) return lit.has(s) || lit.has(t) ? "normal" : "dim";
		return rootSet.size > 1 && rootSet.has(s) && rootSet.has(t) ? "hot" : "normal";
	};

	const graphRef = useRef<ForceGraphMethods<DrawNode, DrawLink>>();
	const containerRef = useRef<HTMLDivElement>(null);
	const fitPending = useRef<"warmup" | "settled">();
	// biome-ignore lint/correctness/useExhaustiveDependencies: frame each newly fetched graph
	useEffect(() => {
		fitPending.current = "warmup";
	}, [base]);
	const legendRef = useRef<HTMLDivElement>(null);
	// force-graph's zoomToFit treats nodes as small circles. This fits the measured badges into the
	// area the toolbar and legend leave free.
	const frameGraph = (ms = 300) => {
		const g = graphRef.current;
		const box = containerRef.current;
		if (g === undefined || box === null) return;
		const boxes = graphData.nodes.flatMap((n) =>
			n.x === undefined || n.y === undefined
				? []
				: [{ x: n.x, y: n.y, halfW: (n.__w ?? 90) / 2 + 8, halfH: BADGE_H / 2 + 8 }],
		);
		const insets =
			variant === "page"
				? { top: 60, right: 24, bottom: (legendRef.current?.offsetHeight ?? 0) + 24, left: 24 }
				: { top: 34, right: 8, bottom: 8, left: 8 };
		const view = fitView(boxes, box.clientWidth, box.clientHeight, insets, LAYOUT[variant].maxZoom);
		if (view === undefined) return;
		g.centerAt(view.x, view.y, ms);
		g.zoom(view.k, ms);
	};
	/** Zooms by `factor` and keeps the graph point under (`sx`, `sy`), in px from the top left of the
	 *  canvas, where it is. */
	const zoomAt = useCallback((factor: number, sx?: number, sy?: number, ms = 0) => {
		const g = graphRef.current;
		const box = containerRef.current;
		if (g === undefined || box === null) return;
		const w = box.clientWidth;
		const h = box.clientHeight;
		const x = sx ?? w / 2;
		const y = sy ?? h / 2;
		const k = Math.min(ZOOM_RANGE[1], Math.max(ZOOM_RANGE[0], g.zoom() * factor));
		const p = g.screen2GraphCoords(x, y);
		g.zoom(k, ms);
		g.centerAt(p.x - (x - w / 2) / k, p.y - (y - h / 2) / k, ms);
	}, []);
	// In a card the plain wheel scrolls the panel around it, so zooming needs Ctrl (or a pinch,
	// which browsers report as a wheel event with Ctrl held).
	const [zoomHint, setZoomHint] = useState(false);
	useEffect(() => {
		const box = containerRef.current;
		if (box === null) return;
		let hideHint: ReturnType<typeof setTimeout> | undefined;
		const onWheel = (ev: WheelEvent) => {
			if (!(ev.target instanceof HTMLCanvasElement)) return;
			if (variant === "card" && !ev.ctrlKey && !ev.metaKey) {
				setZoomHint(true);
				clearTimeout(hideHint);
				hideHint = setTimeout(() => setZoomHint(false), 1200);
				return;
			}
			ev.preventDefault();
			const rect = ev.target.getBoundingClientRect();
			zoomAt(
				wheelZoomFactor(ev.deltaY, ev.deltaMode, ev.ctrlKey),
				ev.clientX - rect.left,
				ev.clientY - rect.top,
			);
		};
		// Safari and WebKit report trackpad pinches as gesture events instead, and zoom the page
		// unless they are cancelled.
		let lastScale = 1;
		const onGesture = (ev: Event) => {
			ev.preventDefault();
			const g = ev as Event & { scale: number; clientX: number; clientY: number };
			if (ev.type === "gesturestart") {
				lastScale = 1;
				return;
			}
			const rect = box.getBoundingClientRect();
			zoomAt(g.scale / lastScale, g.clientX - rect.left, g.clientY - rect.top);
			lastScale = g.scale;
		};
		box.addEventListener("wheel", onWheel, { passive: false });
		box.addEventListener("gesturestart", onGesture, { passive: false });
		box.addEventListener("gesturechange", onGesture, { passive: false });
		return () => {
			box.removeEventListener("wheel", onWheel);
			box.removeEventListener("gesturestart", onGesture);
			box.removeEventListener("gesturechange", onGesture);
			clearTimeout(hideHint);
		};
	}, [variant, zoomAt]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: frame again when a card grows or shrinks
	useEffect(() => {
		const t = setTimeout(() => frameGraph(), 50);
		// On mount, the first layout's own fit is still pending and does a better job.
		if (fitPending.current !== "warmup") fitPending.current = "settled";
		return () => clearTimeout(t);
	}, [height]);
	// AutoSizer mounts the graph only once it knows its size, so the forces are set from the ref.
	const attachGraph = (g: ForceGraphMethods<DrawNode, DrawLink> | null) => {
		if (g === null) return;
		graphRef.current = g;
		// The handle is a new object on every render. An installed collide force marks the instance
		// as set up, so hovering does not restart the layout.
		if (g.d3Force("collide") !== undefined) return;
		const layout = LAYOUT[variant];
		g.d3Force("center", null);
		g.d3Force("charge")?.strength(layout.charge);
		// The rings place the nodes. A link between rings keeps a node near its relative. A link within
		// a ring would bunch the ring up on one side of the root, so it does not pull.
		const ringOf = (end: string | DrawNode) =>
			ringsRef.current?.dist.get(typeof end === "object" ? end.id : end);
		g.d3Force("link")
			?.distance(layout.ringGap)
			.strength((l: DrawLink) => (ringOf(l.source) === ringOf(l.target) ? 0 : 0.1));
		g.d3Force("collide", collideForce(layout.collideMargin));
		g.d3Force(
			"ring",
			ringForce((n) => {
				const rings = ringsRef.current;
				const d = rings?.dist.get(n.id);
				return d === undefined ? undefined : rings?.radii[d];
			}),
		);
		g.d3ReheatSimulation();
	};

	const [expanding, setExpanding] = useState(false);
	const expand = (node: GraphRef) => {
		setExpanding(true);
		toast
			.promise(
				backend["ocel/graph"]({
					root: node.id,
					rootIsObject: node.type === "object",
					maxDistance: 1,
					relsSizeIgnoreThreshold: 0,
					spanningTree: false,
					maxNodes: MAX_NODES[variant],
				}),
				{
					loading: `Adding the relations of ${node.id}...`,
					success: `Added the relations of ${node.id}`,
					error: `Could not add the relations of ${node.id}`,
				},
			)
			.then((gd) => {
				if (gd.truncated) {
					toast(
						// The node itself counts towards the limit.
						`${node.id} has too many relations. Only the first ${MAX_NODES[variant] - 1} were added.`,
					);
				}
				fitPending.current = "settled";
				setExpansions((prev) => {
					const cur =
						prev.key === baseKey ? prev : { key: baseKey, graph: EMPTY_GRAPH, history: [] };
					return {
						key: baseKey,
						graph: mergeGraphs(cur.graph, gd),
						history: [...cur.history, cur.graph],
					};
				});
			})
			.catch(() => {})
			.finally(() => setExpanding(false));
	};
	const undo = () => {
		if (current.history.length === 0) return;
		fitPending.current = "settled";
		setExpansions({
			key: baseKey,
			graph: current.history[current.history.length - 1],
			history: current.history.slice(0, -1),
		});
	};

	// x and y are in px from the top left of the graph.
	const [menu, setMenu] = useState<{ node: DrawNode; x: number; y: number }>();
	const openMenu = (node: DrawNode, ev: MouseEvent) => {
		const rect = containerRef.current?.getBoundingClientRect();
		if (rect === undefined) return;
		setMenu({ node, x: ev.clientX - rect.left, y: ev.clientY - rect.top });
	};
	const menuActions = (node: DrawNode, ref: GraphRef): GraphNodeAction[] => {
		if (nodeActions === undefined) return [];
		const byId = new Map(graphData.nodes.map((n) => [n.id, n]));
		const idOf = (end: string | DrawNode) => (typeof end === "object" ? end.id : end);
		const neighbours = graphData.links.flatMap((l) => {
			const s = idOf(l.source as string | DrawNode);
			const t = idOf(l.target as string | DrawNode);
			const other = s === node.id ? byId.get(t) : t === node.id ? byId.get(s) : undefined;
			return other === undefined ? [] : [{ isEvent: isEvent(other), name: other.type }];
		});
		return nodeActions({ ref, type: node.type, neighbours });
	};
	const menuRef: GraphRef | undefined =
		menu === undefined
			? undefined
			: { type: isEvent(menu.node) ? "event" : "object", id: menu.node.id };
	const selectedNode = shown?.nodes.find((n) => n.id === selectedId);
	const canExpandSelected = selectedNode !== undefined && !expanded.has(selectedNode.id);

	const downloadPng = () => {
		containerRef.current?.querySelector("canvas")?.toBlob((blob) => {
			if (blob !== null) backend["download-blob"](blob, `graph-${root.id}.png`);
		}, "image/png");
	};

	return (
		<div
			ref={containerRef}
			tabIndex={-1}
			role="group"
			aria-label={`Relationship graph around ${root.id}`}
			className={clsx(
				"relative overflow-hidden bg-slate-50 outline-none",
				variant === "card" ? "rounded-lg border border-slate-200" : "h-full w-full",
			)}
			style={variant === "card" ? { height } : undefined}
			onKeyDown={(ev) => {
				if (ev.key === "z" && (ev.ctrlKey || ev.metaKey)) {
					ev.preventDefault();
					undo();
				}
			}}
		>
			{isError && (
				<p className="p-3 text-sm text-red-700">
					The graph could not be loaded. Check that {root.id} exists.
				</p>
			)}
			{!isError && base === undefined && (
				<div className="flex h-full items-center justify-center">
					<Spinner />
				</div>
			)}
			{shown !== undefined && (
				// force-graph only clears its hover on canvas moves, not when the pointer goes onto an overlay.
				<div className="absolute inset-0" onMouseLeave={() => setHoverId(undefined)}>
					<AutoSizer>
						{({ width, height: h }) => (
							<ForceGraph2D<DrawNode, DrawLink>
								// The typings only allow ref objects, but forwardRef also takes callbacks.
								ref={
									attachGraph as unknown as MutableRefObject<ForceGraphMethods<DrawNode, DrawLink>>
								}
								graphData={graphData}
								// Warm-up ticks would run with force-graph's default forces, before ours are set, and
								// drag the ring placement out of shape.
								warmupTicks={0}
								cooldownTicks={300}
								cooldownTime={4000}
								width={width}
								height={h}
								backgroundColor="#f8fafc"
								onEngineTick={() => {
									if (fitPending.current === "warmup") {
										fitPending.current = "settled";
										frameGraph(0);
									}
								}}
								onEngineStop={() => {
									if (fitPending.current !== undefined) {
										fitPending.current = undefined;
										frameGraph(400);
									}
								}}
								// The wheel listener above zooms, since d3's zoom steps too far with Ctrl held.
								enableZoomInteraction={false}
								nodeCanvasObject={(node, ctx, scale) =>
									drawNode(node, ctx, scale, {
										root: rootSet.has(node.id),
										tag: tags.get(node.id),
										selected: node.id === selectedId,
										dimmed: lit !== undefined && !lit.has(node.id),
										expandable: !expanded.has(node.id),
									})
								}
								nodePointerAreaPaint={(node, color, ctx, scale) =>
									paintNodeHitArea(node, color, ctx, scale, rootSet.has(node.id))
								}
								linkCanvasObjectMode={() => "replace"}
								linkCanvasObject={(link, ctx, scale) =>
									drawLink(link, ctx, scale, linkLook(link), rootSet)
								}
								nodeLabel={(n) => (menu === undefined ? `<b>${escapeHtml(n.id)}</b>` : "")}
								onNodeHover={(n) => setHoverId(n?.id)}
								onNodeClick={openMenu}
								onNodeRightClick={openMenu}
								onBackgroundClick={() => setMenu(undefined)}
							/>
						)}
					</AutoSizer>
				</div>
			)}
			<DropdownMenu
				open={menu !== undefined}
				onOpenChange={(open) => !open && setMenu(undefined)}
				// Not modal, so a click on another node closes this menu and opens that one's.
				modal={false}
			>
				<DropdownMenuTrigger asChild>
					<span
						aria-hidden="true"
						className="pointer-events-none absolute size-px"
						style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
					/>
				</DropdownMenuTrigger>
				{menu !== undefined && menuRef !== undefined && (
					<DropdownMenuContent align="start" sideOffset={4} className="w-72">
						<DropdownMenuLabel className="flex items-center gap-1.5 font-normal">
							<TypeDot
								isEvent={menuRef.type === "event"}
								name={menu.node.type}
								className={clsx("h-2 w-2", menuRef.type === "event" && "rounded-[2px]")}
							/>
							<span className="truncate font-semibold text-slate-900">{menu.node.id}</span>
							<span className="shrink-0 text-xs text-slate-500">{menu.node.type}</span>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						<DropdownMenuItem className="gap-2" onSelect={() => onSelect(menuRef)}>
							<LuPanelRight aria-hidden="true" />
							Show details
						</DropdownMenuItem>
						<DropdownMenuItem
							className="gap-2"
							disabled={expanded.has(menu.node.id) || expanding}
							onSelect={() => expand(menuRef)}
						>
							<LuPlus aria-hidden="true" />
							{expanded.has(menu.node.id) ? "All its relations are shown" : "Expand relations"}
						</DropdownMenuItem>
						<DropdownMenuItem
							className="gap-2"
							onSelect={async () => {
								await navigator.clipboard.writeText(menuRef.id);
								toast("Copied the ID", { icon: <LuClipboardCopy /> });
							}}
						>
							<LuClipboardCopy aria-hidden="true" />
							Copy ID
						</DropdownMenuItem>
						{menuActions(menu.node, menuRef).map((a, i) => (
							<Fragment key={a.label}>
								{i === 0 && <DropdownMenuSeparator />}
								<DropdownMenuItem className="gap-2" onSelect={() => a.onSelect()}>
									{a.icon}
									{a.label}
								</DropdownMenuItem>
							</Fragment>
						))}
					</DropdownMenuContent>
				)}
			</DropdownMenu>
			{isFetching && base !== undefined && (
				<span className="absolute top-3 left-1/2 -translate-x-1/2">
					<Spinner />
				</span>
			)}

			{variant === "page" && shown !== undefined && (
				<>
					<div className="absolute top-3 left-3 flex h-8 items-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-600 tabular-nums">
						{shown.nodes.length.toLocaleString()} {shown.nodes.length === 1 ? "node" : "nodes"} ·{" "}
						{shown.links.length.toLocaleString()}{" "}
						{shown.links.length === 1 ? "relation" : "relations"}
						{base?.truncated && (
							<span className="ml-1.5 text-amber-700">· capped at {MAX_NODES.page}</span>
						)}
					</div>
					<div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
						<HopToggle choices={HOP_CHOICES.page} value={hops} onChange={setHops} />
						<span aria-hidden="true" className="h-5 w-px bg-slate-200" />
						<ToolButton
							label={
								selectedNode === undefined
									? "Select a node to add its relations"
									: `Add the relations of ${selectedNode.id}`
							}
							disabled={!canExpandSelected || expanding}
							onClick={() =>
								selectedNode !== undefined &&
								expand({ type: isEvent(selectedNode) ? "event" : "object", id: selectedNode.id })
							}
						>
							<LuPlus />
						</ToolButton>
						<ToolButton
							label={`Undo the last addition (${MOD_KEY}+Z)`}
							disabled={current.history.length === 0}
							onClick={undo}
						>
							<LuUndo2 />
						</ToolButton>
						<ZoomButtons
							onZoom={(f) => zoomAt(f, undefined, undefined, 200)}
							onFit={() => frameGraph()}
						/>
						<ToolButton label="Download as PNG" onClick={downloadPng}>
							<LuDownload />
						</ToolButton>
					</div>
					<TypeLegend
						boxRef={legendRef}
						nodes={full?.nodes ?? []}
						hidden={hiddenTypes}
						onToggle={(type) =>
							setHiddenTypes((prev) => {
								const next = new Set(prev);
								if (!next.delete(type)) next.add(type);
								return next;
							})
						}
						onHover={setLegendType}
					/>
				</>
			)}
			{variant === "card" && (
				<>
					{hopsProp === undefined && (
						<div className="absolute top-2 left-2 rounded-lg border border-slate-200 bg-white p-0.5">
							<HopToggle choices={HOP_CHOICES.card} value={hops} onChange={setHops} small />
						</div>
					)}
					<div className="absolute top-2 right-2 flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
						<ZoomButtons
							onZoom={(f) => zoomAt(f, undefined, undefined, 200)}
							onFit={() => frameGraph()}
						/>
					</div>
					<span
						aria-hidden="true"
						className={clsx(
							"pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-white transition-opacity duration-300",
							zoomHint ? "opacity-100" : "opacity-0",
						)}
					>
						Hold {ZOOM_KEY} to zoom
					</span>
				</>
			)}
		</div>
	);
}

function HopToggle({
	choices,
	value,
	onChange,
	small,
}: {
	choices: number[];
	value: number;
	onChange: (hops: number) => unknown;
	small?: boolean;
}) {
	return (
		<div
			role="group"
			aria-label="Hops from the root"
			className="flex items-center rounded-md bg-slate-100 p-0.5"
		>
			{!small && <span className="px-1.5 text-xs font-medium text-slate-600">Hops</span>}
			{choices.map((c) => (
				<button
					key={c}
					type="button"
					aria-pressed={c === value}
					onClick={() => onChange(c)}
					className={clsx(
						"rounded px-2 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
						small ? "h-5 text-[11px]" : "h-6 min-w-7 text-xs",
						c === value ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-white",
					)}
				>
					{small ? (c === 1 ? "1 hop" : `${c} hops`) : c}
				</button>
			))}
		</div>
	);
}

function ZoomButtons({ onZoom, onFit }: { onZoom: (factor: number) => void; onFit: () => void }) {
	return (
		<>
			<ToolButton
				label={`Zoom in (${ZOOM_KEY} + scroll)`}
				onClick={() => onZoom(ZOOM_BUTTON_FACTOR)}
			>
				<LuZoomIn />
			</ToolButton>
			<ToolButton
				label={`Zoom out (${ZOOM_KEY} + scroll)`}
				onClick={() => onZoom(1 / ZOOM_BUTTON_FACTOR)}
			>
				<LuZoomOut />
			</ToolButton>
			<ToolButton label="Fit the graph" onClick={onFit}>
				<LuScan />
			</ToolButton>
		</>
	);
}

function ToolButton({
	label,
	disabled,
	onClick,
	children,
}: {
	label: string;
	disabled?: boolean;
	onClick: () => unknown;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className="flex h-7 w-7 items-center justify-center rounded-md text-slate-700 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 disabled:text-slate-400 disabled:hover:bg-transparent [&>svg]:size-4"
		>
			{children}
		</button>
	);
}

function TypeLegend({
	boxRef,
	nodes,
	hidden,
	onToggle,
	onHover,
}: {
	boxRef: RefObject<HTMLDivElement>;
	nodes: DrawNode[] | GraphState["nodes"];
	hidden: ReadonlySet<string>;
	onToggle: (type: string) => unknown;
	onHover: (type: string | undefined) => unknown;
}) {
	const types = useMemo(() => typeCounts(nodes), [nodes]);
	return (
		<div
			ref={boxRef}
			className="pointer-events-none absolute right-3 bottom-3 left-3 flex flex-wrap gap-1.5"
		>
			{types.map((t) => {
				const off = hidden.has(t.type);
				return (
					<button
						key={`${t.isEvent}:${t.type}`}
						type="button"
						aria-pressed={!off}
						title={off ? `Show ${t.type}` : `Hide ${t.type}`}
						onClick={() => onToggle(t.type)}
						onMouseEnter={() => !off && onHover(t.type)}
						onMouseLeave={() => onHover(undefined)}
						onFocus={() => !off && onHover(t.type)}
						onBlur={() => onHover(undefined)}
						className={clsx(
							"pointer-events-auto inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium shadow-[0_1px_2px_rgba(15,23,42,0.05)] outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
							off
								? "border-slate-200 bg-slate-50 text-slate-500"
								: "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
						)}
					>
						<TypeDot
							isEvent={t.isEvent}
							name={t.type}
							className={clsx("h-2 w-2", t.isEvent && "rounded-[2px]", off && "opacity-40")}
						/>
						<span className={clsx(off && "line-through")}>{t.type}</span>
						<span className="tabular-nums text-slate-500">{t.count.toLocaleString()}</span>
					</button>
				);
			})}
		</div>
	);
}
