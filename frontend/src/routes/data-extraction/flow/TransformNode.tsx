import { Handle, type NodeProps, Position, useEdges, useReactFlow } from "@xyflow/react";
import clsx from "clsx";
import { useRef } from "react";
import type { IconType } from "react-icons";
import { LuPencil, LuPlus } from "react-icons/lu";
import { TbAlertTriangle, TbSettings, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ChangeTableCondition } from "@/types/generated/ChangeTableCondition";
import {
	type BlueprintEdgeType,
	TRANSFORM_MENU_ITEMS,
	type TransformNodeType,
	type TransformOperationConfig,
	type TransformType,
} from "./blueprint-flow-types";
import {
	NODE_EDIT_EVENT,
	type NodeEditDetail,
	TABLE_ADD_CHILD_EVENT,
	type TableAddChildDetail,
} from "./TableNode";

const TRANSFORM_STYLES: Record<
	TransformType,
	{ border: string; borderSelected: string; headerBg: string; headerText: string; handle: string }
> = {
	filter: {
		border: "border-teal-400",
		borderSelected: "border-teal-500",
		headerBg: "bg-teal-50",
		headerText: "text-teal-700",
		handle: "bg-teal-400!",
	},
	join: {
		border: "border-orange-400",
		borderSelected: "border-orange-500",
		headerBg: "bg-orange-50",
		headerText: "text-orange-700",
		handle: "bg-orange-400!",
	},
	union: {
		border: "border-green-400",
		borderSelected: "border-green-500",
		headerBg: "bg-green-50",
		headerText: "text-green-700",
		handle: "bg-green-400!",
	},
};

function getTransformIcon(type: TransformType): IconType {
	return TRANSFORM_MENU_ITEMS.find((t) => t.type === type)?.icon ?? TbSettings;
}

function summarizeLeaf(c: Exclude<ChangeTableCondition, { type: "AND" | "OR" }>): string {
	switch (c.type) {
		case "column-equals":
			return `${c.column || "?"} = "${c.value}"`;
		case "column-not-equals":
			return `${c.column || "?"} ≠ "${c.value}"`;
		case "column-not-empty":
			return `${c.column || "?"} not empty`;
		case "column-matches":
			return `${c.column || "?"} matches /${c.regex}/`;
	}
}

function summarizeCondition(c: ChangeTableCondition): string {
	if (c.type !== "AND" && c.type !== "OR") return summarizeLeaf(c);
	if (c.conditions.length === 0) return "empty group";
	if (c.conditions.length === 1) return summarizeCondition(c.conditions[0]);
	return `${c.conditions.length} ${c.type} conditions`;
}

function getTransformSummary(config: TransformOperationConfig): string {
	switch (config.type) {
		case "filter":
			return summarizeCondition(config.condition);
		case "join": {
			const cols = config.on.map(([l, r]) => `${l} = ${r}`).join(", ");
			return cols || "no join columns";
		}
		case "union":
			return "combine rows";
	}
}

export function TransformNode({ id, data, selected }: NodeProps<TransformNodeType>) {
	const { deleteElements } = useReactFlow();
	const edges = useEdges() as BlueprintEdgeType[];
	const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);

	const styles = TRANSFORM_STYLES[data.transformType];
	const Icon = getTransformIcon(data.transformType);
	const label =
		data.label ||
		TRANSFORM_MENU_ITEMS.find((t) => t.type === data.transformType)?.label ||
		data.transformType;

	const hasInputs = edges.some((e) => e.target === id);
	const summary = getTransformSummary(data.config);

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger className="pointer-events-auto hidden" asChild>
					<button ref={contextMenuTriggerRef} type="button" />
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem
						className="text-red-600 focus:text-red-500"
						onClick={(ev) => {
							ev.stopPropagation();
							deleteElements({ nodes: [{ id }] });
						}}
					>
						<TbTrash className="w-4 h-4 mr-1" />
						Delete Transform
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{/* Input handle */}
			<Handle type="target" position={Position.Left} className={clsx("w-3! h-3!", styles.handle)} />
			{/* Output handle */}
			<Handle
				type="source"
				position={Position.Right}
				className={clsx("w-3! h-3!", styles.handle)}
			/>

			{/* "+" button: opens add-child-node dialog */}
			<div className="absolute -right-2.5 top-[calc(50%+12px)] z-10">
				<button
					type="button"
					className="w-5 h-5 rounded-full bg-teal-500 hover:bg-teal-600 text-white flex items-center justify-center shadow-sm hover:shadow-md transition-all"
					title="Add extractor or transform"
					onClick={(ev) => {
						ev.stopPropagation();
						const detail: TableAddChildDetail = { nodeId: id };
						window.dispatchEvent(new CustomEvent(TABLE_ADD_CHILD_EVENT, { detail }));
					}}
				>
					<LuPlus className="w-3 h-3" />
				</button>
			</div>

			<div
				role="application"
				tabIndex={-1}
				onContextMenu={(ev) => {
					if (contextMenuTriggerRef.current) {
						contextMenuTriggerRef.current.dispatchEvent(
							new MouseEvent("contextmenu", {
								bubbles: true,
								cancelable: true,
								clientX: ev.clientX,
								clientY: ev.clientY,
							}),
						);
						ev.preventDefault();
					}
				}}
				className={clsx(
					"bg-white border-2 border-dashed rounded-lg shadow-sm min-w-[160px] max-w-[220px]",
					selected ? styles.borderSelected : styles.border,
					selected && "shadow-md",
				)}
			>
				{/* Header */}
				<div
					className={clsx(
						"px-3 py-1.5 border-b border-dashed rounded-t-md flex items-center gap-1.5",
						styles.headerBg,
						styles.border,
					)}
				>
					<Icon className={clsx("w-3.5 h-3.5 shrink-0", styles.headerText)} />
					<span className={clsx("font-semibold text-xs truncate flex-1", styles.headerText)}>
						{label}
					</span>
					<Button
						size="icon"
						variant="ghost"
						className="h-5 w-5 shrink-0"
						title="Configure"
						onClick={(ev) => {
							ev.stopPropagation();
							const detail: NodeEditDetail = { nodeId: id };
							window.dispatchEvent(new CustomEvent(NODE_EDIT_EVENT, { detail }));
						}}
					>
						<LuPencil className="w-3 h-3" />
					</Button>
				</div>

				{/* Summary */}
				<div className="px-3 py-1.5">
					{!hasInputs && (
						<div className="text-[10px] text-amber-600 italic mb-1 flex items-center gap-1">
							<TbAlertTriangle className="w-3 h-3 shrink-0" />
							No source connected
						</div>
					)}
					<div className="text-[11px] text-slate-600 font-mono truncate" title={summary}>
						{summary}
					</div>
				</div>
			</div>
		</>
	);
}
