import { Handle, type NodeProps, Position, useEdges, useReactFlow } from "@xyflow/react";
import clsx from "clsx";
import { useRef } from "react";
import { LuPencil } from "react-icons/lu";
import { TbAlertTriangle, TbTrash } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	type BlueprintEdgeType,
	type ExtractorNodeType,
	getExtractorCategory,
	MODE_REGISTRY,
	TABLE_USAGE_MODE_LABELS,
} from "./blueprint-flow-types";
import { NODE_EDIT_EVENT, type NodeEditDetail } from "./TableNode";

const CATEGORY_STYLES = {
	event: {
		border: "border-pink-400",
		borderSelected: "border-pink-500",
		handle: "!bg-pink-400",
		headerBg: "bg-pink-50",
		headerText: "text-pink-700",
	},
	object: {
		border: "border-indigo-400",
		borderSelected: "border-indigo-500",
		handle: "!bg-indigo-400",
		headerBg: "bg-indigo-50",
		headerText: "text-indigo-700",
	},
	relation: {
		border: "border-purple-400",
		borderSelected: "border-purple-500",
		handle: "!bg-purple-400",
		headerBg: "bg-purple-50",
		headerText: "text-purple-700",
	},
};

export function ExtractorNode({ id, data, selected }: NodeProps<ExtractorNodeType>) {
	const { deleteElements } = useReactFlow();
	const edges = useEdges() as BlueprintEdgeType[];
	const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);

	const category = getExtractorCategory(data.extractorMode);
	const styles = CATEGORY_STYLES[category];

	const hasSource = edges.some((e) => e.target === id);

	// Build config summary lines
	const configLines: Array<{ label: string; value: string }> = [];
	const usage = data.usage;
	// Type name
	if ("event_type" in usage) {
		const expr = usage.event_type;
		const val =
			expr.type === "constant"
				? expr.value
				: expr.type === "column"
					? `{${expr.column}}`
					: expr.type === "template"
						? expr.template
						: "...";
		if (val) configLines.push({ label: "Type", value: val });
	}
	if ("object_type" in usage) {
		const expr = usage.object_type;
		const val =
			expr.type === "constant"
				? expr.value
				: expr.type === "column"
					? `{${expr.column}}`
					: expr.type === "template"
						? expr.template
						: "...";
		if (val) configLines.push({ label: "Type", value: val });
	}
	// ID
	if ("id" in usage) {
		if (usage.id == null) {
			configLines.push({ label: "ID", value: "auto" });
		} else if (usage.id.type === "column" && usage.id.column) {
			configLines.push({ label: "ID", value: `{${usage.id.column}}` });
		}
	}
	// Timestamp
	if (
		"timestamp" in usage &&
		usage.timestamp != null &&
		usage.timestamp.type === "column" &&
		usage.timestamp.column
	) {
		configLines.push({ label: "Time", value: `{${usage.timestamp.column}}` });
	}
	// Prefix
	if ("prefix_id_with_type" in usage && usage.prefix_id_with_type) {
		const objType = "object_type" in usage ? usage.object_type : null;
		const typeName = objType?.type === "constant" && objType.value ? objType.value : "type";
		configLines.push({ label: "Prefix", value: `${typeName}-...` });
	}
	// Event rules count (Change Table Events)
	if ("event_rules" in usage && usage.event_rules.length > 0) {
		const names = usage.event_rules.map((r) => r.event_type).filter(Boolean);
		configLines.push({
			label: "Rules",
			value:
				names.length > 0
					? names.slice(0, 2).join(", ") + (names.length > 2 ? ", ..." : "")
					: `${usage.event_rules.length} rules`,
		});
	}
	// Attribute config (Object Changes)
	if ("attribute_config" in usage && usage.attribute_config != null) {
		const cfg = usage.attribute_config;
		if (cfg.mode === "static" && cfg.mappings.length > 0) {
			configLines.push({
				label: "Attrs",
				value: `${cfg.mappings.length} mapped`,
			});
		} else if (cfg.mode === "dynamic") {
			configLines.push({ label: "Attrs", value: "dynamic" });
		}
	}
	// Relation fields (E2O / O2O)
	if (
		"source_event" in usage &&
		usage.source_event.type === "column" &&
		usage.source_event.column
	) {
		configLines.push({
			label: "Event",
			value: `{${usage.source_event.column}}`,
		});
	}
	if (
		"source_object" in usage &&
		usage.source_object.type === "column" &&
		usage.source_object.column
	) {
		configLines.push({
			label: "Source",
			value: `{${usage.source_object.column}}`,
		});
	}
	if (
		"target_object" in usage &&
		usage.target_object.type === "column" &&
		usage.target_object.column
	) {
		configLines.push({
			label: "Target",
			value: `{${usage.target_object.column}}`,
		});
	}
	if (
		"qualifier" in usage &&
		usage.qualifier != null &&
		usage.qualifier.type === "column" &&
		usage.qualifier.column
	) {
		configLines.push({ label: "Qual", value: `{${usage.qualifier.column}}` });
	}
	// Inline refs count
	if ("inline_object_references" in usage && usage.inline_object_references.length > 0) {
		configLines.push({
			label: "Refs",
			value: `${usage.inline_object_references.length} inline`,
		});
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
						Delete Extractor
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			{/* Input handle */}
			<Handle type="target" position={Position.Left} className={clsx("w-3! h-3!", styles.handle)} />

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
					"bg-white border-2 rounded-lg shadow-sm min-w-[170px] max-w-[220px]",
					selected ? styles.borderSelected : styles.border,
					selected && "shadow-md",
				)}
			>
				{/* Header */}
				<div
					className={clsx(
						"px-3 py-1.5 border-b border-slate-100 rounded-t-md flex items-center gap-1.5",
						styles.headerBg,
					)}
				>
					{(() => {
						const Icon = MODE_REGISTRY[data.extractorMode].icon;
						return <Icon className={clsx("w-4 h-4 shrink-0", styles.headerText)} />;
					})()}
					<span
						className={clsx("font-semibold text-xs truncate flex-1", styles.headerText)}
						title={data.label}
					>
						{data.label || TABLE_USAGE_MODE_LABELS[data.extractorMode]}
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

				{/* Config summary */}
				<div className="px-3 py-1.5">
					{!hasSource && (
						<div className="text-[10px] text-amber-600 italic mb-1 flex items-center gap-1">
							<TbAlertTriangle className="w-3 h-3 shrink-0" />
							No source connected
						</div>
					)}
					{configLines.length > 0 ? (
						<div className="space-y-0.5">
							{configLines.map((line) => (
								<div key={line.label} className="flex items-center gap-1 text-[11px]">
									<span className="text-slate-400 min-w-6">{line.label}</span>
									<span className="text-slate-700 font-mono text-[10px] bg-slate-50 px-1 rounded truncate">
										{line.value}
									</span>
								</div>
							))}
						</div>
					) : (
						<div className="text-[10px] text-slate-400 italic flex items-center gap-1">
							Click
							<LuPencil className="w-3 h-3 inline-block" />
							to configure
						</div>
					)}
				</div>
			</div>
		</>
	);
}
