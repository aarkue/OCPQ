import clsx from "clsx";
import {
	cloneElement,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { LuClipboardCopy, LuListPlus, LuPin, LuScanSearch } from "react-icons/lu";
import type {
	GraphNodeAction,
	GraphNodeContext,
} from "@/components/relationship-graph/RelationshipGraph";
import { TypeDot } from "@/components/TypeDot";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOcelEvent, useOcelObject } from "@/hooks/useOcelElement";
import { InspectorContext } from "./InspectorContext";
import type { InspectTarget } from "./inspect";
import { requestAddVariable, useQueryContext } from "./query-context";
import { scopeOfQuery } from "./query-scope";

/** A type, event or object as menus see it. `typeName` is an element's type, when known. */
export type MenuTarget =
	| { kind: "type"; isEvent: boolean; name: string }
	| { kind: "element"; type: "event" | "object"; id: string; typeName?: string };

export type MenuEntry = { label: string; icon: ReactNode; onSelect: () => unknown };

function typeOf(t: MenuTarget): { isEvent: boolean; name: string } | undefined {
	if (t.kind === "type") return { isEvent: t.isEvent, name: t.name };
	return t.typeName === undefined ? undefined : { isEvent: t.type === "event", name: t.typeName };
}

function inspectTarget(t: MenuTarget): InspectTarget {
	return t.kind === "type"
		? { kind: "type", isEvent: t.isEvent, name: t.name }
		: { kind: "element", type: t.type, id: t.id };
}

/** The action that adds a type to the open query, through the add-variable dialog of the selected
 *  box, else the top one. Undefined while no query is open. */
export function useAddTypeToQuery() {
	const query = useQueryContext();
	return useCallback(
		(type: { isEvent: boolean; name: string }) => {
			if (query === undefined) return undefined;
			const nodeId = scopeOfQuery(query).targetNodeId;
			if (nodeId === undefined) return undefined;
			return () =>
				requestAddVariable({ nodeId, kind: type.isEvent ? "event" : "object", type: type.name });
		},
		[query],
	);
}

/** The entries every menu of a type, event or object has, in this order. `inspect` shows the
 *  target in the card the menu was opened in. */
export function useMenuEntries() {
	const { pin } = useContext(InspectorContext);
	const addType = useAddTypeToQuery();
	return useCallback(
		(
			target: MenuTarget,
			inspect?: (t: InspectTarget) => unknown,
			{ details = true, copy = true }: { details?: boolean; copy?: boolean } = {},
		): MenuEntry[] => {
			const entries: MenuEntry[] = [];
			if (details && inspect !== undefined) {
				entries.push({
					label: "Show details",
					icon: <LuScanSearch aria-hidden="true" />,
					onSelect: () => inspect(inspectTarget(target)),
				});
			}
			const type = typeOf(target);
			const add = type === undefined ? undefined : addType(type);
			if (type !== undefined && add !== undefined) {
				entries.push({
					label: `Add "${type.name}" to the query`,
					icon: <LuListPlus aria-hidden="true" />,
					onSelect: add,
				});
			}
			if (copy && target.kind === "element") {
				entries.push({
					label: "Copy ID",
					icon: <LuClipboardCopy aria-hidden="true" />,
					onSelect: async () => {
						try {
							await navigator.clipboard.writeText(target.id);
							toast("Copied the ID", { icon: <LuClipboardCopy /> });
						} catch (e) {
							toast.error(`Could not copy the ID: ${String(e)}`);
						}
					},
				});
			}
			entries.push({
				label: "Pin as a card",
				icon: <LuPin aria-hidden="true" />,
				onSelect: () => pin(inspectTarget(target)),
			});
			return entries;
		},
		[pin, addType],
	);
}

function MenuLabel({ target }: { target: MenuTarget }) {
	const type = typeOf(target);
	return (
		<DropdownMenuLabel className="flex items-center gap-1.5 font-normal">
			{type !== undefined && (
				<TypeDot
					isEvent={type.isEvent}
					name={type.name}
					className={clsx("h-2 w-2", type.isEvent && "rounded-[2px]")}
				/>
			)}
			<span className="truncate font-semibold text-slate-900">
				{target.kind === "type" ? target.name : target.id}
			</span>
			<span className="shrink-0 text-xs text-slate-500">
				{target.kind === "type" ? "type" : (target.typeName ?? target.type)}
			</span>
		</DropdownMenuLabel>
	);
}

/** Right-click on `children` opens the menu of `target`. A right-click inside a nested menu
 *  target opens only the innermost one. */
export function InspectContextMenu({
	target,
	inspect,
	children,
}: {
	target: MenuTarget;
	inspect?: (t: InspectTarget) => unknown;
	children: ReactElement<{ onContextMenu?: (ev: MouseEvent<HTMLElement>) => unknown }>;
}) {
	const entries = useMenuEntries();
	// The menu mounts at the click point instead of reusing a context menu, which shows for one
	// frame at the previous click point (at first the top left corner) before it moves.
	const [at, setAt] = useState<{ x: number; y: number }>();
	const trigger = cloneElement(children, {
		onContextMenu: (ev: MouseEvent<HTMLElement>) => {
			children.props.onContextMenu?.(ev);
			if (ev.defaultPrevented) return;
			ev.preventDefault();
			ev.stopPropagation();
			// The menu key reports no pointer position.
			const r = ev.currentTarget.getBoundingClientRect();
			setAt(
				ev.clientX === 0 && ev.clientY === 0
					? { x: r.left, y: r.bottom }
					: { x: ev.clientX, y: ev.clientY },
			);
		},
	});
	return (
		<>
			{trigger}
			{at !== undefined &&
				createPortal(
					<DropdownMenu open onOpenChange={(open) => !open && setAt(undefined)} modal={false}>
						<DropdownMenuTrigger asChild>
							<span
								aria-hidden="true"
								className="pointer-events-none fixed size-px"
								style={{ left: at.x, top: at.y }}
							/>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" sideOffset={2} className="w-72">
							<MenuLabel target={target} />
							<DropdownMenuSeparator />
							{entries(target, inspect).map((e) => (
								<DropdownMenuItem key={e.label} className="gap-2" onSelect={() => e.onSelect()}>
									{e.icon}
									{e.label}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>,
					document.body,
				)}
		</>
	);
}

/** The type of an inspected type or element, once the element is loaded. */
export function useTypeOf(
	target: InspectTarget | undefined,
): { isEvent: boolean; name: string } | undefined {
	const req = target?.kind === "element" ? { id: target.id } : undefined;
	const object = useOcelObject(
		target?.kind === "element" && target.type === "object" ? req : undefined,
	);
	const event = useOcelEvent(
		target?.kind === "element" && target.type === "event" ? req : undefined,
	);
	if (target === undefined) return undefined;
	if (target.kind === "type") return { isEvent: target.isEvent, name: target.name };
	if (target.kind !== "element") return undefined;
	const name = target.type === "object" ? object.data?.object.type : event.data?.event.type;
	return name === undefined ? undefined : { isEvent: target.type === "event", name };
}

/** The menu target of an inspected type or element, with the element's type once it is loaded. */
export function useMenuTargetOf(target: InspectTarget | undefined): MenuTarget | undefined {
	const type = useTypeOf(target);
	if (target === undefined || target.kind === "row") return undefined;
	if (target.kind === "type") return target;
	return { kind: "element", type: target.type, id: target.id, typeName: type?.name };
}

/** The add-to-query button in the header of an inspected type or element. Renders nothing while
 *  no query is open. */
export function AddToQueryButton({
	target,
	className,
}: {
	target: InspectTarget;
	className?: string;
}) {
	const type = useTypeOf(target);
	const addType = useAddTypeToQuery();
	const add = type === undefined ? undefined : addType(type);
	if (type === undefined || add === undefined) return null;
	const label = `Add "${type.name}" to the query`;
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			className={clsx(
				"p-1 rounded-md hover:bg-slate-100 text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
				className,
			)}
			onClick={add}
		>
			<LuListPlus />
		</button>
	);
}

/** The shared entries for a relationship graph's node menu, after its own Show details, Expand
 *  and Copy ID. */
export function useGraphNodeEntries(): (node: GraphNodeContext) => GraphNodeAction[] {
	const entries = useMenuEntries();
	return useCallback(
		(node) =>
			entries(
				{ kind: "element", type: node.ref.type, id: node.ref.id, typeName: node.type },
				undefined,
				{ details: false, copy: false },
			),
		[entries],
	);
}
