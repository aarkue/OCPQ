import { type NodeProps, useReactFlow } from "@xyflow/react";
import clsx from "clsx";
import { useMemo, useRef, useState } from "react";
import {
	LuBox,
	LuChevronDown,
	LuChevronUp,
	LuClock,
	LuDatabase,
	LuFilter,
	LuFingerprint,
	LuKey,
	LuLink,
	LuPencil,
	LuSettings2,
	LuTag,
} from "react-icons/lu";
import { MdEvent, MdTableChart } from "react-icons/md";
import { TbArrowRight, TbRelationManyToMany, TbTrash } from "react-icons/tb";
import AlertHelper from "@/components/AlertHelper";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	getColumnsFromCondition,
	getColumnsFromExpr,
	getColumnsFromTimestamp,
	getUsageSummaryLabel,
	TABLE_USAGE_MODE_LABELS,
	type TableNodeType,
	type TableUsageData,
} from "./blueprint-flow-types";
import { TableUsageConfig } from "./TableUsageConfig";

const MAX_VISIBLE_COLS = 10;

type ColumnUsageType =
	| "id"
	| "timestamp"
	| "objectType"
	| "eventType"
	| "sourceEvent"
	| "sourceObject"
	| "targetObject"
	| "qualifier"
	| "attribute"
	| "condition"
	| "objectRef";

function getColumnUsages(colName: string, usage: TableUsageData | undefined): ColumnUsageType[] {
	if (!usage || usage.mode === "none") return [];
	const usages: ColumnUsageType[] = [];

	const exprHasCol = (
		expr: { type: string; column?: string; template?: string } | null | undefined,
	) => {
		if (!expr) return false;
		return getColumnsFromExpr(expr as Parameters<typeof getColumnsFromExpr>[0]).includes(colName);
	};

	// ID fields
	if ("id" in usage && exprHasCol(usage.id)) {
		usages.push("id");
	}
	if ("object_id" in usage && exprHasCol(usage.object_id)) {
		usages.push("id");
	}

	// Timestamp fields
	if ("timestamp" in usage) {
		const tsCols = getColumnsFromTimestamp(usage.timestamp);
		if (tsCols.includes(colName)) usages.push("timestamp");
	}

	// Object type
	if (usage.mode === "multi-object" && exprHasCol(usage.object_type)) {
		usages.push("objectType");
	}

	// Event type
	if (usage.mode === "multi-event" && exprHasCol(usage.event_type)) {
		usages.push("eventType");
	}

	// Relation source/target
	if (usage.mode === "e2o-relation") {
		if (exprHasCol(usage.source_event)) usages.push("sourceEvent");
		if (exprHasCol(usage.target_object)) usages.push("targetObject");
		if (usage.qualifier && exprHasCol(usage.qualifier)) usages.push("qualifier");
	}
	if (usage.mode === "o2o-relation") {
		if (exprHasCol(usage.source_object)) usages.push("sourceObject");
		if (exprHasCol(usage.target_object)) usages.push("targetObject");
		if (usage.qualifier && exprHasCol(usage.qualifier)) usages.push("qualifier");
	}

	// Change table attributes
	if (usage.mode === "change-table-object-changes") {
		const cfg = usage.attribute_config;
		if (cfg.mode === "static") {
			if (cfg.mappings.some((a) => a.source_column === colName)) {
				usages.push("attribute");
			}
		} else {
			if (cfg.name_column === colName || cfg.value_column === colName) {
				usages.push("attribute");
			}
		}
	}

	// Change table event rule conditions
	if (usage.mode === "change-table-events") {
		for (const rule of usage.event_rules) {
			if (getColumnsFromCondition(rule.conditions).includes(colName)) {
				usages.push("condition");
				break;
			}
		}
	}

	// Inline object references (for event modes)
	if ("inline_object_references" in usage && usage.inline_object_references) {
		for (const ref of usage.inline_object_references) {
			// Check object_id column
			if (exprHasCol(ref.object_id)) {
				usages.push("objectRef");
				break;
			}
			// Check object_type if it's an expression
			if (ref.object_type && typeof ref.object_type !== "string" && exprHasCol(ref.object_type)) {
				usages.push("objectRef");
				break;
			}
			// Check qualifier
			if (ref.qualifier && exprHasCol(ref.qualifier)) {
				usages.push("objectRef");
				break;
			}
		}
	}

	return usages;
}

/** Collect all column names that have at least one usage */
function getUsedColumnNames(usage: TableUsageData | undefined): Set<string> {
	if (!usage || usage.mode === "none") return new Set();
	const cols = new Set<string>();

	const addFromExpr = (
		expr: { type: string; column?: string; template?: string } | null | undefined,
	) => {
		if (!expr) return;
		for (const c of getColumnsFromExpr(expr as Parameters<typeof getColumnsFromExpr>[0])) {
			cols.add(c);
		}
	};

	if ("id" in usage) addFromExpr(usage.id);
	if ("object_id" in usage) addFromExpr(usage.object_id);
	if ("timestamp" in usage) {
		for (const c of getColumnsFromTimestamp(usage.timestamp)) cols.add(c);
	}
	if (usage.mode === "multi-object") addFromExpr(usage.object_type);
	if (usage.mode === "multi-event") addFromExpr(usage.event_type);
	if (usage.mode === "e2o-relation") {
		addFromExpr(usage.source_event);
		addFromExpr(usage.target_object);
		if (usage.qualifier) addFromExpr(usage.qualifier);
	}
	if (usage.mode === "o2o-relation") {
		addFromExpr(usage.source_object);
		addFromExpr(usage.target_object);
		if (usage.qualifier) addFromExpr(usage.qualifier);
	}
	if (usage.mode === "change-table-object-changes") {
		const cfg = usage.attribute_config;
		if (cfg.mode === "static") {
			for (const a of cfg.mappings) {
				if (a.source_column) cols.add(a.source_column);
			}
		} else {
			if (cfg.name_column) cols.add(cfg.name_column);
			if (cfg.value_column) cols.add(cfg.value_column);
		}
	}
	if (usage.mode === "change-table-events") {
		for (const rule of usage.event_rules) {
			for (const c of getColumnsFromCondition(rule.conditions)) {
				cols.add(c);
			}
		}
	}

	// Inline object references (for event modes)
	if ("inline_object_references" in usage && usage.inline_object_references) {
		for (const ref of usage.inline_object_references) {
			// object_id column
			for (const c of getColumnsFromExpr(ref.object_id)) {
				cols.add(c);
			}
			// object_type if it's an expression
			if (ref.object_type && typeof ref.object_type !== "string") {
				for (const c of getColumnsFromExpr(ref.object_type)) {
					cols.add(c);
				}
			}
			// qualifier
			if (ref.qualifier) {
				for (const c of getColumnsFromExpr(ref.qualifier)) {
					cols.add(c);
				}
			}
		}
	}

	return cols;
}

const COLUMN_USAGE_INFO: Record<
	ColumnUsageType,
	{ icon: React.ReactNode; label: string; color: string }
> = {
	id: {
		icon: <LuFingerprint className="w-3 h-3" />,
		label: "ID",
		color: "text-violet-500",
	},
	timestamp: {
		icon: <LuClock className="w-3 h-3" />,
		label: "Timestamp",
		color: "text-green-600",
	},
	objectType: {
		icon: <LuTag className="w-3 h-3" />,
		label: "Object Type",
		color: "text-blue-500",
	},
	eventType: {
		icon: <LuTag className="w-3 h-3" />,
		label: "Event Type",
		color: "text-pink-500",
	},
	sourceEvent: {
		icon: <TbArrowRight className="w-3 h-3" />,
		label: "Source Event",
		color: "text-pink-500",
	},
	sourceObject: {
		icon: <TbArrowRight className="w-3 h-3" />,
		label: "Source Object",
		color: "text-blue-500",
	},
	targetObject: {
		icon: <TbArrowRight className="w-3 h-3 rotate-180" />,
		label: "Target Object",
		color: "text-blue-500",
	},
	qualifier: {
		icon: <LuTag className="w-3 h-3" />,
		label: "Qualifier",
		color: "text-purple-500",
	},
	attribute: {
		icon: <LuSettings2 className="w-3 h-3" />,
		label: "Attribute",
		color: "text-teal-500",
	},
	condition: {
		icon: <LuFilter className="w-3 h-3" />,
		label: "Condition",
		color: "text-orange-500",
	},
	objectRef: {
		icon: <LuLink className="w-3 h-3" />,
		label: "Object Reference",
		color: "text-purple-500",
	},
};

export function TableNode({ id, data, selected }: NodeProps<TableNodeType>) {
	const { deleteElements, updateNodeData } = useReactFlow<TableNodeType>();
	const [expanded, setExpanded] = useState(true);
	const [showAllColumns, setShowAllColumns] = useState(false);
	const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);

	const columns = Object.entries(data.tableInfo.columns);
	const primaryKeyColumns = new Set(data.tableInfo.primaryKeys.flatMap((pk) => pk.columns));

	const usageMode = data.usage?.mode ?? "none";
	const usedCols = useMemo(() => getUsedColumnNames(data.usage), [data.usage]);

	// Build the visible column list: first MAX_VISIBLE_COLS + any used columns beyond that
	const { visibleColumns, hiddenCount } = useMemo(() => {
		if (showAllColumns || columns.length <= MAX_VISIBLE_COLS) {
			return { visibleColumns: columns, hiddenCount: 0 };
		}

		const firstN = columns.slice(0, MAX_VISIBLE_COLS);
		const firstNNames = new Set(firstN.map(([name]) => name));

		// Add used columns that are beyond the limit
		const extraUsed = columns.filter(([name]) => usedCols.has(name) && !firstNNames.has(name));

		const visible = [...firstN, ...extraUsed];
		const hidden = columns.length - visible.length;
		return { visibleColumns: visible, hiddenCount: hidden };
	}, [columns, showAllColumns, usedCols]);

	const summaryLabel = useMemo(
		() => getUsageSummaryLabel(data.usage, data.previewData),
		[data.usage, data.previewData],
	);

	const headerIcon = (() => {
		switch (usageMode) {
			case "single-object":
				return <LuBox className="w-4 h-4 text-blue-500 shrink-0" />;
			case "multi-object":
				return (
					<>
						<LuBox className="w-4 h-4 text-blue-500 shrink-0 relative z-10" />
						<LuBox className="absolute -right-0.5 -top-0.5 w-4 h-4 text-blue-500/15" />
					</>
				);
			case "single-event":
				return <MdEvent className="w-4 h-4 text-pink-500 shrink-0" />;
			case "multi-event":
				return (
					<>
						<MdEvent className="w-4 h-4 text-pink-500 shrink-0 relative z-10" />
						<MdEvent className="absolute -right-0.5 -top-0.5 w-4 h-4 text-pink-500/15" />
					</>
				);
			case "e2o-relation":
				return <TbRelationManyToMany className="w-4 h-4 text-pink-500 shrink-0" />;
			case "o2o-relation":
				return <TbRelationManyToMany className="w-4 h-4 text-blue-500 shrink-0" />;
			case "change-table-events":
				return <MdTableChart className="w-4 h-4 text-orange-500 shrink-0" />;
			case "change-table-object-changes":
				return <MdTableChart className="w-4 h-4 text-teal-500 shrink-0" />;
			default:
				return <LuDatabase className="w-4 h-4 text-slate-500 shrink-0" />;
		}
	})();

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
							<div className="relative">{headerIcon}</div>
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
					<div className="flex items-center justify-between gap-x-2 mt-1">
						<span className="text-[10px] text-slate-500 shrink-0">{data.sourceName}</span>
						<AlertHelper
							mode="normal"
							title="Configure Table Usage"
							initialData={data.usage}
							onSubmit={(data) => {
								updateNodeData(id, { usage: data });
							}}
							trigger={
								<button
									className="text-[11px] text-slate-800 hover:text-slate-950 border px-1 py-0.5 rounded flex items-center gap-x-1 bg-gray-200/70 border-gray-300 hover:bg-gray-200/70 group max-w-[180px]"
									type="button"
									title={`${TABLE_USAGE_MODE_LABELS[usageMode]}: ${summaryLabel}`}
								>
									<span className="truncate">{summaryLabel}</span>
									<LuPencil className="group-hover:scale-105 text-gray-400/70 group-hover:text-slate-950 shrink-0" />
								</button>
							}
							submitAction="Apply"
							content={({ data: usageData, setData: setUsageData }) => (
								<TableUsageConfig
									data={usageData}
									setData={setUsageData}
									tableInfo={data.tableInfo}
									previewData={data.previewData}
								/>
							)}
						/>
					</div>
				</div>

				{/* Columns summary or expanded list */}
				<div className="px-2 py-1.5">
					{!expanded ? (
						<div className="text-xs text-slate-600">
							{columns.length} column{columns.length !== 1 ? "s" : ""}
							{data.tableInfo.primaryKeys.length > 0 && (
								<span className="text-slate-400"> · {primaryKeyColumns.size} PK</span>
							)}
						</div>
					) : (
						<div className="space-y-0.5">
							{visibleColumns.map(([colName, colInfo]) => {
								const usages = getColumnUsages(colName, data.usage);
								const hasUsage = usages.length > 0;
								return (
									<div
										key={colName}
										className="flex items-center justify-between gap-2 text-xs py-0.5 px-1 rounded hover:bg-slate-50"
									>
										<div className="flex items-center gap-1 min-w-0">
											{primaryKeyColumns.has(colName) && (
												<LuKey className="w-3 h-3 text-amber-500 shrink-0" />
											)}
											<span
												className={clsx(
													"truncate",
													hasUsage ? "font-semibold underline" : "font-medium",
												)}
											>
												{colName}
											</span>
										</div>
										<div className="flex items-center gap-x-1">
											{usages.map((usage) => {
												const info = COLUMN_USAGE_INFO[usage];
												return (
													<span
														key={usage}
														className={clsx(info.color, "shrink-0")}
														title={info.label}
													>
														{info.icon}
													</span>
												);
											})}
											<span className="text-slate-400 text-[10px] shrink-0 text-right truncate max-w-25">
												{colInfo.colType}
											</span>
										</div>
									</div>
								);
							})}
							{hiddenCount > 0 && (
								<button
									type="button"
									className="text-[10px] text-slate-400 hover:text-slate-600 w-full text-center py-0.5"
									onClick={() => setShowAllColumns(true)}
								>
									+ {hiddenCount} more column
									{hiddenCount !== 1 ? "s" : ""}
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
