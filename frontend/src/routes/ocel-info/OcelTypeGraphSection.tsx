import { colorForKey, OcelTypeGraph, TypeScopeSelector, ViewerExportFrame } from "@r4pm/components";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { R4pmIsland } from "@/components/r4pm/R4pmIsland";
import { ZOOM_KEY } from "@/components/relationship-graph/RelationshipGraph";
import { TypeDot } from "@/components/TypeDot";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MenuEntry } from "@/inspector/inspect-menu";
import type { EdgeLook, TypeGraphFocus } from "@/inspector/query-scope";
import { scrollAncestor, wheelGesture } from "@/lib/wheel-gesture";
import type { OCELTypeStats } from "@/types/generated/OCELTypeStats";
import type { OCELInfo } from "@/types/ocel";
import { buildTypeGraph, parseTypeKey } from "./type-graph";

const FOCUS_EDGE: Record<EdgeLook, { color: string; width: number }> = {
	filter: { color: "#0f172a", width: 3 },
	possible: { color: "#64748b", width: 1.8 },
	faint: { color: "#cbd5e1", width: 1.2 },
};
/** Bound types list their variables after this separator. Colors use the name before it. */
const VARIABLES_SEPARATOR = " · ";
const compactCount = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** The type graph in a bordered box whose height `className` sets. With `focus`, it shows only the
 *  types around a query, labels the bound ones with their variables and fades the rest. With
 *  `typeMenu`, clicking a type opens a menu of these entries. */
export function OcelTypeGraphView({
	ocelInfo,
	stats,
	className,
	onTypeClick,
	focus,
	typeMenu,
}: {
	ocelInfo: OCELInfo;
	stats: OCELTypeStats | undefined;
	className?: string;
	onTypeClick?: (type: { isEvent: boolean; name: string }) => unknown;
	focus?: TypeGraphFocus;
	typeMenu?: (type: { isEvent: boolean; name: string }) => MenuEntry[];
}) {
	const { nodes, edges, relationCounts, autoScope } = useMemo(
		() => buildTypeGraph(ocelInfo, stats),
		[ocelInfo, stats],
	);
	const [scope, setScope] = useState(autoScope);
	useEffect(() => setScope(autoScope), [autoScope]);
	const isAuto = scope.size === autoScope.size && [...scope].every((id) => autoScope.has(id));

	// The r4pm export frame reports failures via this event instead of throwing.
	useEffect(() => {
		const onError = (e: Event) =>
			toast.error(`Image export failed: ${(e as CustomEvent<string>).detail}`);
		window.addEventListener("propel:export-error", onError);
		return () => window.removeEventListener("propel:export-error", onError);
	}, []);

	// The graph writes an edge's qualifier along it, so the unused field carries the relation count.
	const shownEdges = useMemo(
		() =>
			edges.map((e) => ({
				...e,
				qualifier: compactCount.format(relationCounts.get(e.id) ?? 0),
			})),
		[edges, relationCounts],
	);
	const maxCount = Math.max(1, ...relationCounts.values());
	const edgeStyle = (id: string) => {
		if (focus !== undefined) {
			const look = focus.edgeLook.get(id);
			// Edges the query does not touch stay visible but faint.
			return look !== undefined ? FOCUS_EDGE[look] : { color: "#e2e8f0", width: 1 };
		}
		return {
			color: "#94a3b8",
			width: 1 + (2.5 * Math.log1p(relationCounts.get(id) ?? 1)) / Math.log1p(maxCount),
		};
	};
	const shownNodes = useMemo(
		() =>
			focus === undefined
				? nodes
				: nodes.map((n) => {
						const vars = focus.bound.get(n.id);
						return vars === undefined
							? n
							: { ...n, label: `${n.label}${VARIABLES_SEPARATOR}${vars.join(", ")}` };
					}),
		[nodes, focus],
	);
	// Before any variable exists, every type of the default scope is there to be added.
	const visible = focus === undefined ? scope : focus.visible.size > 0 ? focus.visible : autoScope;
	// The graph reports which node was clicked but not where, so the menu goes where the pointer
	// last went down.
	const pointer = useRef({ x: 0, y: 0 });
	const [menu, setMenu] = useState<{
		type: { isEvent: boolean; name: string };
		x: number;
		y: number;
	}>();
	const menuOpened = useRef(false);
	// As in the relationship graph, the plain wheel scrolls the page or panel around the graph, and
	// only Ctrl (or a pinch) zooms it.
	const boxRef = useRef<HTMLDivElement>(null);
	const [zoomHint, setZoomHint] = useState(false);
	useEffect(() => {
		const box = boxRef.current;
		if (box === null) return;
		let hideHint: ReturnType<typeof setTimeout> | undefined;
		const gesture = wheelGesture();
		const onWheel = (ev: WheelEvent) => {
			if (gesture(ev) === "zoom") {
				ev.preventDefault();
				return;
			}
			ev.stopPropagation();
			if (ev.ctrlKey || ev.metaKey) {
				ev.preventDefault();
				scrollAncestor(box, ev);
			}
			setZoomHint(true);
			clearTimeout(hideHint);
			hideHint = setTimeout(() => setZoomHint(false), 1200);
		};
		box.addEventListener("wheel", onWheel, { capture: true, passive: false });
		return () => {
			box.removeEventListener("wheel", onWheel, { capture: true });
			clearTimeout(hideHint);
		};
	}, []);
	const clickType = (id: string) => {
		const type = parseTypeKey(id);
		if (typeMenu !== undefined) {
			menuOpened.current = true;
			setMenu({ type, ...pointer.current });
		} else onTypeClick?.(type);
	};

	return (
		<div
			ref={boxRef}
			className={clsx("border rounded-lg relative overflow-hidden bg-white", className)}
			onPointerDownCapture={(ev) => {
				const rect = ev.currentTarget.getBoundingClientRect();
				pointer.current = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
			}}
			// The graph only reports clicks, so a right-click on a node is replayed as one. On the
			// background the browser's own menu stays.
			onContextMenu={(ev) => {
				if (typeMenu === undefined) return;
				const rect = ev.currentTarget.getBoundingClientRect();
				pointer.current = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
				menuOpened.current = false;
				const init = { bubbles: true, cancelable: true, clientX: ev.clientX, clientY: ev.clientY };
				ev.target.dispatchEvent(new PointerEvent("pointerdown", init));
				ev.target.dispatchEvent(new PointerEvent("pointerup", init));
				ev.target.dispatchEvent(new MouseEvent("click", init));
				if (menuOpened.current) ev.preventDefault();
			}}
		>
			{focus === undefined && (
				<div className="absolute top-2 right-16 z-30">
					<R4pmIsland>
						<TypeScopeSelector
							items={nodes}
							value={scope}
							onChange={setScope}
							onResetAuto={() => setScope(autoScope)}
							isAuto={isAuto}
						/>
					</R4pmIsland>
				</div>
			)}
			<R4pmIsland className="w-full h-full">
				<ViewerExportFrame filename="type-relations" style={{ width: "100%", height: "100%" }}>
					<OcelTypeGraph
						nodes={shownNodes}
						edges={shownEdges}
						visibleNodeIds={visible}
						edgeStyle={edgeStyle}
						nodeDimmed={focus && ((id) => !focus.bound.has(id))}
						colorOf={
							focus &&
							((colorScope, key) =>
								colorForKey(colorScope, key.split(VARIABLES_SEPARATOR)[0]) ?? "#64748b")
						}
						onNodeClick={onTypeClick || typeMenu ? clickType : undefined}
					/>
				</ViewerExportFrame>
			</R4pmIsland>
			<span
				aria-hidden="true"
				className={clsx(
					"pointer-events-none absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-white transition-opacity duration-300",
					zoomHint ? "opacity-100" : "opacity-0",
				)}
			>
				Hold {ZOOM_KEY} to zoom
			</span>
			{typeMenu !== undefined && (
				<DropdownMenu
					open={menu !== undefined}
					onOpenChange={(open) => !open && setMenu(undefined)}
					modal={false}
				>
					<DropdownMenuTrigger asChild>
						<span
							aria-hidden="true"
							className="pointer-events-none absolute size-px"
							style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
						/>
					</DropdownMenuTrigger>
					{menu !== undefined && (
						<DropdownMenuContent align="start" sideOffset={4} className="w-72">
							<DropdownMenuLabel className="flex items-center gap-1.5 font-normal">
								<TypeDot
									isEvent={menu.type.isEvent}
									name={menu.type.name}
									className={clsx("h-2 w-2", menu.type.isEvent && "rounded-[2px]")}
								/>
								<span className="truncate font-semibold text-slate-900">{menu.type.name}</span>
								<span className="shrink-0 text-xs text-slate-500">type</span>
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							{typeMenu(menu.type).map((e) => (
								<DropdownMenuItem key={e.label} className="gap-2" onSelect={() => e.onSelect()}>
									{e.icon}
									{e.label}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					)}
				</DropdownMenu>
			)}
		</div>
	);
}

export default function OcelTypeGraphSection({
	ocelInfo,
	stats,
}: {
	ocelInfo: OCELInfo;
	stats: OCELTypeStats | undefined;
}) {
	return (
		<div className="mt-4 mb-3">
			<h3 className="text-xl font-bold">Type relations</h3>
			<p className="text-sm text-muted-foreground mb-2">
				Event-to-object (solid) and object-to-object (dashed) relations between types. Thicker edges
				indicate more frequent relations.
			</p>
			<OcelTypeGraphView ocelInfo={ocelInfo} stats={stats} className="h-[28rem]" />
		</div>
	);
}
