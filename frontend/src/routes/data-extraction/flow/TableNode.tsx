import { Handle, type NodeProps, Position, useReactFlow } from "@xyflow/react";
import clsx from "clsx";
import { useMemo, useRef, useState } from "react";
import { LuChevronDown, LuChevronUp, LuDatabase, LuKey, LuPlus } from "react-icons/lu";
import { TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { TableNodeType } from "./blueprint-flow-types";

const MAX_VISIBLE_COLS = 10;

/** Custom event dispatched when the "+" button is clicked on a source node */
export const TABLE_ADD_CHILD_EVENT = "table-add-child";
export interface TableAddChildDetail {
	nodeId: string;
}

/** Custom event dispatched when an extractor/transform node wants to open the edit dialog */
export const NODE_EDIT_EVENT = "node-edit";
export interface NodeEditDetail {
	nodeId: string;
}

export function TableNode({ id, data, selected }: NodeProps<TableNodeType>) {
	const { deleteElements } = useReactFlow<TableNodeType>();
	const [expanded, setExpanded] = useState(true);
	const [showAllColumns, setShowAllColumns] = useState(false);
	const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);

	const columns = data.tableInfo ? Object.entries(data.tableInfo.columns) : [];
	const primaryKeyColumns = new Set(data.tableInfo?.primaryKeys.flatMap((pk) => pk.columns) ?? []);

	const { visibleColumns, hiddenCount } = useMemo(() => {
		if (showAllColumns || columns.length <= MAX_VISIBLE_COLS) {
			return { visibleColumns: columns, hiddenCount: 0 };
		}
		return {
			visibleColumns: columns.slice(0, MAX_VISIBLE_COLS),
			hiddenCount: columns.length - MAX_VISIBLE_COLS,
		};
	}, [columns, showAllColumns]);

	// When a blueprint is loaded from localStorage but the source/table metadata
	// can no longer be resolved (source deleted, table renamed, disconnected),
	// `data.tableInfo` is undefined after hydration. Render a placeholder instead
	// of crashing downstream code that relies on the schema.
	if (!data.tableInfo) {
		return (
			<MissingTableNode
				id={id}
				tableName={data.tableName}
				sourceName={data.sourceName}
				selected={selected}
				onDelete={() => deleteElements({ nodes: [{ id }] })}
			/>
		);
	}

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
						Remove from Blueprint
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{/* Output handle */}
			<Handle type="source" position={Position.Right} className="w-3! h-3! bg-blue-400!" />

			{/* "+" button: opens add-child-node dialog */}
			<div className="absolute -right-2.5 top-[calc(50%+12px)] z-10">
				<button
					type="button"
					className="w-5 h-5 rounded-full bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center shadow-sm hover:shadow-md transition-all"
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
					"bg-white border-2 rounded-lg shadow-sm min-w-[180px] max-w-[280px]",
					selected ? "border-sky-500 shadow-md" : "border-slate-300",
				)}
			>
				{/* Header */}
				<div className="px-3 py-2 bg-slate-50 border-b border-slate-200 rounded-t-md">
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-1.5 min-w-0">
							<LuDatabase className="w-4 h-4 text-blue-500 shrink-0" />
							<span className="font-semibold text-sm truncate">{data.tableName}</span>
						</div>
						<Button
							size="icon"
							variant="ghost"
							className="h-5 w-5 shrink-0"
							onClick={() => setExpanded(!expanded)}
						>
							{expanded ? (
								<LuChevronUp className="w-3 h-3" />
							) : (
								<LuChevronDown className="w-3 h-3" />
							)}
						</Button>
					</div>
					<span className="text-[10px] text-slate-500">
						{data.sourceName} · {columns.length} cols
					</span>
				</div>

				{/* Columns */}
				<div className="px-2 py-1.5">
					{!expanded ? (
						<div className="text-xs text-slate-600">
							{columns.length} column{columns.length !== 1 ? "s" : ""}
							{primaryKeyColumns.size > 0 && (
								<span className="text-slate-400"> · {primaryKeyColumns.size} PK</span>
							)}
						</div>
					) : (
						<div className="space-y-0.5">
							{visibleColumns.map(([colName, colInfo]) => (
								<div
									key={colName}
									className="flex items-center justify-between gap-2 text-xs py-0.5 px-1 rounded hover:bg-slate-50"
								>
									<div className="flex items-center gap-1 min-w-0">
										{primaryKeyColumns.has(colName) && (
											<LuKey className="w-3 h-3 text-amber-500 shrink-0" />
										)}
										<span className="font-medium truncate">{colName}</span>
									</div>
									<span className="text-slate-400 text-[10px] shrink-0 text-right truncate max-w-25">
										{colInfo.colType}
									</span>
								</div>
							))}
							{hiddenCount > 0 && (
								<button
									type="button"
									className="text-[10px] text-slate-400 hover:text-slate-600 w-full text-center py-0.5"
									onClick={() => setShowAllColumns(true)}
								>
									+ {hiddenCount} more column{hiddenCount !== 1 ? "s" : ""}
								</button>
							)}
							{showAllColumns && columns.length > MAX_VISIBLE_COLS && (
								<button
									type="button"
									className="text-[10px] text-slate-400 hover:text-slate-600 w-full text-center py-0.5"
									onClick={() => setShowAllColumns(false)}
								>
									Show fewer
								</button>
							)}
						</div>
					)}
				</div>
			</div>
		</>
	);
}

function MissingTableNode({
	id,
	tableName,
	sourceName,
	selected,
	onDelete,
}: {
	id: string;
	tableName: string;
	sourceName: string;
	selected: boolean | undefined;
	onDelete: () => void;
}) {
	return (
		<>
			<Handle type="source" position={Position.Right} className="w-3! h-3! bg-red-400!" />
			<div
				className={clsx(
					"bg-white border-2 border-dashed rounded-lg shadow-sm min-w-[200px] max-w-[280px]",
					selected ? "border-red-500 shadow-md" : "border-red-300",
				)}
			>
				<div className="px-3 py-2 bg-red-50 border-b border-red-200 rounded-t-md">
					<div className="flex items-center gap-1.5 min-w-0">
						<LuDatabase className="w-4 h-4 text-red-500 shrink-0" />
						<span className="font-semibold text-sm truncate">{tableName}</span>
					</div>
					<span className="text-[10px] text-red-600">Source "{sourceName}" is not connected</span>
				</div>
				<div className="px-3 py-2 text-xs text-slate-600 space-y-1.5">
					<p>
						Table metadata unavailable. Reconnect the data source, or remove this node to clean up
						the blueprint.
					</p>
					<Button
						size="sm"
						variant="outline"
						className="h-6 text-xs text-red-600 w-full"
						onClick={(ev) => {
							ev.stopPropagation();
							onDelete();
						}}
					>
						<TbTrash className="w-3 h-3 mr-1" />
						Remove node ({id.slice(0, 6)})
					</Button>
				</div>
			</div>
		</>
	);
}
