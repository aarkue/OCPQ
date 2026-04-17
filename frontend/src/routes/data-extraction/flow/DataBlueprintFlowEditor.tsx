import { useQueryClient } from "@tanstack/react-query";
import {
	addEdge,
	Background,
	Controls,
	type OnConnect,
	Panel,
	ReactFlow,
	type ReactFlowInstance,
	useEdgesState,
	useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import debounce from "lodash.debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { LuDatabase, LuPlay, LuPlus, LuSearch, LuTable2, LuTrash2 } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import {
	CardTypeSelector,
	CardTypeSelectorContent,
	type CardTypeSelectorOption,
} from "@/components/ui/card-type-selector";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBackend } from "@/hooks";
import type { DataSourceColumnInfo } from "@/types/generated/DataSourceColumnInfo";
import type { DataSource } from "../data-extraction-types";
import {
	ALL_TABLE_USAGE_MODES,
	type AnyNodeType,
	type BlueprintEdgeType,
	type BlueprintFlowState,
	EXTRACTOR_MENU_ITEMS,
	type ExtractorNodeType,
	getColumnsForNode,
	getDefaultUsageDataForMode,
	getExtractorCategory,
	getPreviewDataForNode,
	MODE_REGISTRY,
	type TableNodeType,
	type TableUsageData,
	type TableUsageType,
	TRANSFORM_MENU_ITEMS,
	type TransformNodeType,
	type TransformOperationConfig,
	type TransformType,
	toBackendBlueprint,
} from "./blueprint-flow-types";
import { ConditionBuilder } from "./ConditionBuilder";
import { ExtractorNode } from "./ExtractorNode";
import {
	NODE_EDIT_EVENT,
	type NodeEditDetail,
	TABLE_ADD_CHILD_EVENT,
	type TableAddChildDetail,
	TableNode,
} from "./TableNode";
import { ColumnSelector, TableUsageConfig } from "./TableUsageConfig";
import { TransformNode } from "./TransformNode";

const nodeTypes = {
	table: TableNode,
	extractor: ExtractorNode,
	transform: TransformNode,
};

interface DataBlueprintFlowEditorProps {
	sources: DataSource[];
	initialState?: BlueprintFlowState;
	onChange: (state: BlueprintFlowState) => void;
}

export default function DataBlueprintFlowEditor({
	sources,
	initialState,
	onChange,
}: DataBlueprintFlowEditorProps) {
	const backend = useBackend();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const flowRef = useRef<ReactFlowInstance<AnyNodeType, BlueprintEdgeType>>();
	const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);
	const mousePos = useRef({ x: 0, y: 0 });
	const [isExecuting, setIsExecuting] = useState(false);

	const [nodes, setNodes, onNodesChange] = useNodesState<AnyNodeType>(
		(initialState?.nodes as AnyNodeType[]) ?? [],
	);
	const [edges, setEdges, onEdgesChange] = useEdgesState<BlueprintEdgeType>(
		initialState?.edges ?? [],
	);

	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const debouncedSave = useMemo(
		() =>
			debounce(() => {
				if (flowRef.current) {
					const state = flowRef.current.toObject();
					onChangeRef.current(state as BlueprintFlowState);
				}
			}, 300),
		[],
	);

	const onNodesChangeWrapped = useCallback(
		(...args: Parameters<typeof onNodesChange>) => {
			onNodesChange(...args);
			debouncedSave();
		},
		[onNodesChange, debouncedSave],
	);

	const onEdgesChangeWrapped = useCallback(
		(...args: Parameters<typeof onEdgesChange>) => {
			onEdgesChange(...args);
			debouncedSave();
		},
		[onEdgesChange, debouncedSave],
	);

	const onConnect = useCallback<OnConnect>(
		(connection) => {
			setEdges((eds) => addEdge(connection, eds));
			debouncedSave();
		},
		[setEdges, debouncedSave],
	);

	useEffect(() => {
		return () => {
			debouncedSave.flush();
		};
	}, [debouncedSave]);

	const addTableNode = useCallback(
		(source: DataSource, tableName: string, position: { x: number; y: number }) => {
			const tableInfo = source.cachedMetadata?.tables[tableName];
			if (!tableInfo) return;

			const newNode: TableNodeType = {
				id: uuidv4(),
				type: "table",
				position,
				data: {
					sourceId: source.id,
					sourceName: source.name,
					tableName,
					tableInfo,
					previewData: source.cachedMetadata?.previewData[tableName],
				},
			};

			setNodes((nds) => [...nds, newNode]);
			debouncedSave();
		},
		[setNodes, debouncedSave],
	);

	// State for the unified add/edit dialog
	const [pendingAdd, setPendingAdd] = useState<{
		sourceNodeId: string;
		columns: Record<string, DataSourceColumnInfo>;
		previewData?: Array<Record<string, string>>;
		/** When editing an existing node, its ID and current config */
		editingNodeId?: string;
		editingMode?: AddChildMode;
		editingUsage?: TableUsageData;
		editingTransformConfig?: TransformOperationConfig;
	} | null>(null);

	/** Resolve columns from a source node */
	const resolveSourceInfo = useCallback(
		(sourceNodeId: string) => {
			const columns = getColumnsForNode(sourceNodeId, nodes, edges);
			const sourceNode = nodes.find((n) => n.id === sourceNodeId);
			let previewData: Array<Record<string, string>> | undefined;
			if (sourceNode?.type === "table") {
				previewData = (sourceNode as TableNodeType).data.previewData;
			} else {
				previewData = getPreviewDataForNode(sourceNodeId, nodes, edges);
			}
			return { columns, previewData };
		},
		[nodes, edges],
	);

	/** Open dialog to add a new child node */
	const openAddChildDialog = useCallback(
		(sourceNodeId: string) => {
			const { columns, previewData } = resolveSourceInfo(sourceNodeId);
			setPendingAdd({ sourceNodeId, columns, previewData });
		},
		[resolveSourceInfo],
	);

	/** Open dialog to edit an existing extractor or transform node */
	const openEditNodeDialog = useCallback(
		(nodeId: string) => {
			const node = nodes.find((n) => n.id === nodeId);
			if (!node) return;
			// Find the source node connected to this node
			const incomingEdge = edges.find((e) => e.target === nodeId);
			const sourceNodeId = incomingEdge?.source ?? nodeId;
			const { columns, previewData } = resolveSourceInfo(sourceNodeId);

			if (node.type === "extractor") {
				const extData = (node as ExtractorNodeType).data;
				setPendingAdd({
					sourceNodeId,
					columns,
					previewData,
					editingNodeId: nodeId,
					editingMode: extData.extractorMode,
					editingUsage: extData.usage,
				});
			} else if (node.type === "transform") {
				const txData = (node as TransformNodeType).data;
				setPendingAdd({
					sourceNodeId,
					columns,
					previewData,
					editingNodeId: nodeId,
					editingMode: `transform-${txData.transformType}` as AddChildMode,
					editingTransformConfig: txData.config,
				});
			}
		},
		[nodes, edges, resolveSourceInfo],
	);

	/** Confirm extractor from the dialog (create or update) */
	const confirmAddExtractor = useCallback(
		(mode: TableUsageType, usage: TableUsageData) => {
			if (!pendingAdd) return;
			const { sourceNodeId, editingNodeId } = pendingAdd;
			const label = EXTRACTOR_MENU_ITEMS.find((item) => item.mode === mode)?.label ?? mode;

			if (editingNodeId) {
				// Editing: update the existing node (replace it if type changed)
				const existingNode = nodes.find((n) => n.id === editingNodeId);
				if (existingNode?.type === "extractor") {
					// Same type, update data in place
					setNodes((nds) =>
						nds.map((n) =>
							n.id === editingNodeId
								? ({
										...n,
										data: { label, extractorMode: mode, usage },
									} as ExtractorNodeType)
								: n,
						),
					);
				} else {
					// Was a transform, now an extractor; replace node, keep edges
					setNodes((nds) =>
						nds.map((n) =>
							n.id === editingNodeId
								? ({
										...n,
										type: "extractor",
										data: { label, extractorMode: mode, usage },
									} as unknown as AnyNodeType)
								: n,
						),
					);
					const cat = getExtractorCategory(mode);
					const edgeColor = cat === "event" ? "#ec4899" : cat === "object" ? "#6366f1" : "#8b5cf6";
					setEdges((eds) =>
						eds.map((e) =>
							e.target === editingNodeId
								? { ...e, style: { stroke: edgeColor, strokeWidth: 2 } }
								: e,
						),
					);
				}
			} else {
				// Creating new
				const extractorId = uuidv4();
				const sourceNode = nodes.find((n) => n.id === sourceNodeId);
				const siblingCount = edges.filter((e) => e.source === sourceNodeId).length;
				const position = sourceNode
					? {
							x: sourceNode.position.x + 280,
							y: sourceNode.position.y + siblingCount * 130,
						}
					: { x: 400, y: 100 };
				setNodes((nds) => [
					...nds,
					{
						id: extractorId,
						type: "extractor",
						position,
						data: { label, extractorMode: mode, usage },
					} as ExtractorNodeType,
				]);
				const cat = getExtractorCategory(mode);
				const edgeColor = cat === "event" ? "#ec4899" : cat === "object" ? "#6366f1" : "#8b5cf6";
				setEdges((eds) => [
					...eds,
					{
						id: `${sourceNodeId}-${extractorId}`,
						source: sourceNodeId,
						target: extractorId,
						style: { stroke: edgeColor, strokeWidth: 2 },
					},
				]);
			}
			setPendingAdd(null);
			debouncedSave();
		},
		[pendingAdd, nodes, edges, setNodes, setEdges, debouncedSave],
	);

	/** Confirm transform from the dialog (create or update) */
	const confirmAddTransform = useCallback(
		(transformType: TransformType, config: TransformOperationConfig) => {
			if (!pendingAdd) return;
			const { sourceNodeId, editingNodeId } = pendingAdd;
			const txLabel =
				TRANSFORM_MENU_ITEMS.find((t) => t.type === transformType)?.label ?? transformType;

			if (editingNodeId) {
				const existingNode = nodes.find((n) => n.id === editingNodeId);
				if (existingNode?.type === "transform") {
					setNodes((nds) =>
						nds.map((n) =>
							n.id === editingNodeId
								? ({
										...n,
										data: { label: txLabel, transformType, config },
									} as TransformNodeType)
								: n,
						),
					);
				} else {
					// Was an extractor, now a transform; replace
					setNodes((nds) =>
						nds.map((n) =>
							n.id === editingNodeId
								? ({
										...n,
										type: "transform",
										data: { label: txLabel, transformType, config },
									} as unknown as AnyNodeType)
								: n,
						),
					);
					setEdges((eds) =>
						eds.map((e) =>
							e.target === editingNodeId
								? { ...e, style: { stroke: "#14b8a6", strokeWidth: 2 } }
								: e,
						),
					);
				}
			} else {
				const transformId = uuidv4();
				const sourceNode = nodes.find((n) => n.id === sourceNodeId);
				if (!sourceNode) {
					setPendingAdd(null);
					return;
				}
				const siblingCount = edges.filter((e) => e.source === sourceNodeId).length;
				setNodes((nds) => [
					...nds,
					{
						id: transformId,
						type: "transform",
						position: {
							x: sourceNode.position.x + 280,
							y: sourceNode.position.y + siblingCount * 130,
						},
						data: { label: txLabel, transformType, config },
					} as TransformNodeType,
				]);
				setEdges((eds) => [
					...eds,
					{
						id: `${sourceNodeId}-${transformId}`,
						source: sourceNodeId,
						target: transformId,
						style: { stroke: "#14b8a6", strokeWidth: 2 },
					},
				]);
			}
			setPendingAdd(null);
			debouncedSave();
		},
		[pendingAdd, nodes, edges, setNodes, setEdges, debouncedSave],
	);

	useEffect(() => {
		function handleMouseMove(e: MouseEvent) {
			mousePos.current = { x: e.clientX, y: e.clientY };
		}
		document.addEventListener("mousemove", handleMouseMove);
		return () => document.removeEventListener("mousemove", handleMouseMove);
	}, []);

	// Listen for "+" button clicks from source nodes
	useEffect(() => {
		function handleAddChild(e: Event) {
			const detail = (e as CustomEvent<TableAddChildDetail>).detail;
			openAddChildDialog(detail.nodeId);
		}
		window.addEventListener(TABLE_ADD_CHILD_EVENT, handleAddChild);
		return () => window.removeEventListener(TABLE_ADD_CHILD_EVENT, handleAddChild);
	}, [openAddChildDialog]);

	// Listen for edit button clicks from extractor/transform nodes
	useEffect(() => {
		function handleEdit(e: Event) {
			const detail = (e as CustomEvent<NodeEditDetail>).detail;
			openEditNodeDialog(detail.nodeId);
		}
		window.addEventListener(NODE_EDIT_EVENT, handleEdit);
		return () => window.removeEventListener(NODE_EDIT_EVENT, handleEdit);
	}, [openEditNodeDialog]);

	// Listen for auto-add-tables event (from file drop / file picker)
	useEffect(() => {
		function handleAutoAdd(e: Event) {
			const { source } = (e as CustomEvent<{ source: DataSource }>).detail;
			if (!source?.cachedMetadata) return;
			const tableNames = Object.keys(source.cachedMetadata.tables);
			if (tableNames.length === 0) return;

			// Position at last known mouse position, or center of viewport
			const pos = flowRef.current?.screenToFlowPosition(mousePos.current) ??
				flowRef.current?.screenToFlowPosition({
					x: window.innerWidth / 2,
					y: window.innerHeight / 3,
				}) ?? { x: 100, y: 100 };

			for (let i = 0; i < tableNames.length; i++) {
				addTableNode(source, tableNames[i], {
					x: pos.x,
					y: pos.y + i * 150,
				});
			}
		}
		window.addEventListener("data-source-auto-add-tables", handleAutoAdd);
		return () => window.removeEventListener("data-source-auto-add-tables", handleAutoAdd);
	}, [addTableNode]);

	const connectedSources = sources.filter(
		(s) => s.cachedMetadata && Object.keys(s.cachedMetadata.tables).length > 0,
	);

	const extractorCount = nodes.filter((n) => n.type === "extractor").length;

	const handleExecuteExtraction = useCallback(async () => {
		if (!flowRef.current) return;

		const flowState = flowRef.current.toObject() as BlueprintFlowState;
		const blueprint = toBackendBlueprint(sources, flowState);

		if (blueprint.tables.length === 0) {
			toast.error("No extractors configured with sources");
			return;
		}

		setIsExecuting(true);
		try {
			const response = await backend["data-extraction/execute"](blueprint);
			if (response.success) {
				toast.success(
					`Extracted ${response.total_events} events and ${response.total_objects} objects`,
				);
				await queryClient.invalidateQueries({ queryKey: ["ocel"] });
				navigate("/ocel-info");
			} else {
				toast.error(`Extraction failed: ${response.errors.join(", ")}`);
			}
		} catch (err) {
			toast.error(`Extraction failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setIsExecuting(false);
		}
	}, [sources, backend, navigate, queryClient]);

	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const [tableSearch, setTableSearch] = useState("");
	const searchInputRef = useRef<HTMLInputElement>(null);

	return (
		<div className="w-full h-full mt-1.5 pb-1">
			<ContextMenu>
				<ContextMenuTrigger className="hidden" asChild>
					<button ref={contextMenuTriggerRef} type="button" />
				</ContextMenuTrigger>
				<ContextMenuContent className="w-56">
					{connectedSources.length === 0 ? (
						<ContextMenuItem disabled>No connected data sources</ContextMenuItem>
					) : (
						connectedSources.map((source) => (
							<ContextMenuSub key={source.id}>
								<ContextMenuSubTrigger>
									<LuDatabase className="w-4 h-4 mr-2" />
									{source.name}
								</ContextMenuSubTrigger>
								<ContextMenuSubContent className="max-h-64 overflow-auto">
									{Object.keys(source.cachedMetadata?.tables || {}).map((tableName) => (
										<ContextMenuItem
											key={tableName}
											onClick={() => {
												const pos = flowRef.current?.screenToFlowPosition(mousePos.current) ?? {
													x: 100,
													y: 100,
												};
												addTableNode(source, tableName, pos);
											}}
										>
											<LuTable2 className="w-4 h-4 mr-2" />
											{tableName}
										</ContextMenuItem>
									))}
								</ContextMenuSubContent>
							</ContextMenuSub>
						))
					)}
				</ContextMenuContent>
			</ContextMenu>

			<ReactFlow
				className="react-flow border"
				nodes={nodes}
				edges={edges}
				onNodesChange={onNodesChangeWrapped}
				onEdgesChange={onEdgesChangeWrapped}
				onConnect={onConnect}
				nodeTypes={nodeTypes}
				onInit={(instance) => {
					flowRef.current = instance;
					if (initialState?.viewport) {
						instance.setViewport(initialState.viewport);
					}
				}}
				onContextMenu={(ev) => {
					if (!ev.isDefaultPrevented() && contextMenuTriggerRef.current) {
						contextMenuTriggerRef.current.dispatchEvent(
							new MouseEvent("contextmenu", {
								bubbles: true,
								cancelable: true,
								clientX: ev.clientX,
								clientY: ev.clientY,
							}),
						);
					}
					ev.preventDefault();
				}}
				fitView={!initialState}
				proOptions={{ hideAttribution: true }}
				minZoom={0.1}
				maxZoom={2}
				defaultEdgeOptions={{
					style: { strokeWidth: 2, stroke: "#94a3b8" },
				}}
			>
				<Background />
				<Controls />
				<Panel position="top-left" className="flex gap-2">
					{/* Add Table */}
					<Popover
						open={addMenuOpen}
						onOpenChange={(open) => {
							setAddMenuOpen(open);
							if (!open) setTableSearch("");
						}}
					>
						<PopoverTrigger asChild>
							<Button size="sm" variant="outline" className="bg-white/90 shadow-sm">
								<LuPlus className="w-4 h-4 mr-1.5" />
								Add Table
							</Button>
						</PopoverTrigger>
						<PopoverContent
							align="start"
							side="bottom"
							className="w-64 p-1.5"
							onOpenAutoFocus={(e) => {
								e.preventDefault();
								searchInputRef.current?.focus();
							}}
						>
							{connectedSources.length === 0 ? (
								<p className="text-sm text-muted-foreground px-2 py-3 text-center">
									No connected data sources
								</p>
							) : (
								<>
									<div className="relative mb-1.5">
										<LuSearch className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
										<input
											ref={searchInputRef}
											type="text"
											value={tableSearch}
											onChange={(e) => setTableSearch(e.target.value)}
											placeholder="Search tables..."
											className="w-full pl-7 pr-2 py-1.5 text-sm rounded border bg-transparent outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
										/>
									</div>
									{connectedSources.map((source) => (
										<SourceTableMenu
											key={source.id}
											source={source}
											search={tableSearch}
											onSelectTable={(tableName) => {
												const center = flowRef.current?.screenToFlowPosition({
													x: window.innerWidth / 2,
													y: window.innerHeight / 2,
												}) ?? { x: 100, y: 100 };
												addTableNode(source, tableName, center);
												setAddMenuOpen(false);
											}}
										/>
									))}
								</>
							)}
						</PopoverContent>
					</Popover>
				</Panel>
				{nodes.length > 0 && (
					<Panel position="top-right" className="flex gap-2">
						{extractorCount > 0 && (
							<Button
								size="sm"
								variant="default"
								className="bg-green-600 hover:bg-green-700"
								onClick={handleExecuteExtraction}
								disabled={isExecuting}
							>
								<LuPlay className="w-4 h-4 mr-1" />
								{isExecuting
									? "Extracting..."
									: `Extract OCEL (${extractorCount} extractor${extractorCount !== 1 ? "s" : ""})`}
							</Button>
						)}
						<Button
							size="sm"
							variant="outline"
							className="bg-white/90"
							onClick={() => {
								setNodes([]);
								setEdges([]);
								debouncedSave();
							}}
						>
							<LuTrash2 className="w-4 h-4 mr-1" />
							Clear All
						</Button>
					</Panel>
				)}
			</ReactFlow>

			{/* Add child node dialog (portaled to body to avoid React Flow transform blurriness) */}
			{pendingAdd &&
				createPortal(
					<AddChildNodeDialog
						columns={pendingAdd.columns}
						previewData={pendingAdd.previewData}
						onConfirmExtractor={confirmAddExtractor}
						onConfirmTransform={confirmAddTransform}
						onCancel={() => setPendingAdd(null)}
						initialMode={pendingAdd.editingMode}
						initialUsage={pendingAdd.editingUsage}
						initialTransformConfig={pendingAdd.editingTransformConfig}
						isEditing={!!pendingAdd.editingNodeId}
					/>,
					document.body,
				)}
		</div>
	);
}

type AddChildMode = TableUsageType | `transform-${TransformType}`;

const ADD_CHILD_OPTIONS: CardTypeSelectorOption<AddChildMode>[] = [
	// Extractor modes (derived from registry)
	...ALL_TABLE_USAGE_MODES.map((mode) => {
		const entry = MODE_REGISTRY[mode];
		const Icon = entry.icon;
		return {
			value: mode as AddChildMode,
			title: entry.label,
			description: entry.description,
			icon: <Icon className={`w-4 h-4 ${entry.iconColor}`} />,
			group: "extractors",
		};
	}),
	// Transform modes
	...TRANSFORM_MENU_ITEMS.map((item) => {
		const Icon = item.icon;
		return {
			value: `transform-${item.type}` as AddChildMode,
			title: item.label,
			description: item.description,
			icon: <Icon className="w-4 h-4 text-teal-500" />,
			group: "transforms",
		};
	}),
];

const ADD_CHILD_GROUP_LABELS: Record<string, string> = {
	extractors: "Table Usages",
	transforms: "Transforms",
};

function isTransformMode(mode: AddChildMode): mode is `transform-${TransformType}` {
	return mode.startsWith("transform-");
}

function getDefaultTransformConfig(type: TransformType): TransformOperationConfig {
	return type === "filter"
		? {
				type: "filter",
				condition: {
					type: "AND",
					conditions: [{ type: "column-not-empty", column: "" }],
				},
			}
		: type === "join"
			? { type: "join", join_type: "inner", on: [["", ""]] }
			: { type: "union" };
}

function AddChildNodeDialog({
	columns,
	previewData,
	onConfirmExtractor,
	onConfirmTransform,
	onCancel,
	initialMode,
	initialUsage,
	initialTransformConfig,
	isEditing,
}: {
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
	onConfirmExtractor: (mode: TableUsageType, usage: TableUsageData) => void;
	onConfirmTransform: (type: TransformType, config: TransformOperationConfig) => void;
	onCancel: () => void;
	initialMode?: AddChildMode;
	initialUsage?: TableUsageData;
	initialTransformConfig?: TransformOperationConfig;
	isEditing?: boolean;
}) {
	const [mode, setMode] = useState<AddChildMode>(initialMode ?? "event");
	const [usage, setUsage] = useState<TableUsageData>(
		() =>
			initialUsage ??
			getDefaultUsageDataForMode(
				initialMode && !isTransformMode(initialMode) ? initialMode : "event",
			),
	);
	const [transformConfig, setTransformConfig] = useState<TransformOperationConfig>(
		() => initialTransformConfig ?? getDefaultTransformConfig("filter"),
	);

	const handleModeChange = (newMode: AddChildMode) => {
		setMode(newMode);
		if (isTransformMode(newMode)) {
			const type = newMode.replace("transform-", "") as TransformType;
			setTransformConfig(getDefaultTransformConfig(type));
		} else {
			setUsage(getDefaultUsageDataForMode(newMode));
		}
	};

	const handleConfirm = () => {
		if (isTransformMode(mode)) {
			const type = mode.replace("transform-", "") as TransformType;
			onConfirmTransform(type, transformConfig);
		} else {
			onConfirmExtractor(mode, usage);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
				<div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
					<h2 className="font-semibold text-base">{isEditing ? "Edit Node" : "Add Node"}</h2>
					<button
						type="button"
						className="text-slate-400 hover:text-slate-600 text-lg"
						onClick={onCancel}
					>
						✕
					</button>
				</div>
				<div className="flex-1 overflow-auto p-5">
					<CardTypeSelector
						options={ADD_CHILD_OPTIONS}
						value={mode}
						onValueChange={handleModeChange}
						columns={3}
						groupLabels={ADD_CHILD_GROUP_LABELS}
					>
						{/* Extractor config panels */}
						{!isTransformMode(mode) && (
							<CardTypeSelectorContent value={mode}>
								<TableUsageConfig
									data={usage}
									setData={setUsage}
									tableInfo={{
										name: "",
										columns,
										primaryKeys: [],
										foreignKeys: [],
									}}
									previewData={previewData}
									hideSelector
								/>
							</CardTypeSelectorContent>
						)}

						{/* Transform config panels */}
						{isTransformMode(mode) && (
							<CardTypeSelectorContent value={mode}>
								<TransformConfigPanel
									config={transformConfig}
									setConfig={setTransformConfig}
									columns={columns}
									previewData={previewData}
								/>
							</CardTypeSelectorContent>
						)}
					</CardTypeSelector>
				</div>
				<div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button onClick={handleConfirm}>
						{isEditing ? "Apply" : isTransformMode(mode) ? "Add Transform" : "Add Extractor"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function TransformConfigPanel({
	config,
	setConfig,
	columns,
	previewData,
}: {
	config: TransformOperationConfig;
	setConfig: (c: TransformOperationConfig) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
}) {
	if (config.type === "filter") {
		// Normalize to a group root so the AND/OR chrome (add condition, add group) is always available.
		const rootCondition =
			config.condition.type === "AND" || config.condition.type === "OR"
				? config.condition
				: {
						type: "AND" as const,
						conditions: [config.condition],
					};
		return (
			<div className="space-y-3">
				<p className="text-sm text-slate-600">Keep only rows that match the condition below.</p>
				<ConditionBuilder
					condition={rootCondition}
					onChange={(condition) => setConfig({ type: "filter", condition })}
					columns={columns}
					previewData={previewData}
				/>
			</div>
		);
	}
	if (config.type === "join") {
		return (
			<div className="space-y-4">
				<p className="text-sm text-slate-600">
					Join two connected tables. Connect left and right sources via edges after creation.
				</p>
				<div className="space-y-1">
					<Label className="font-medium text-slate-700">Join Type</Label>
					<div className="text-sm text-slate-600 px-2 py-1.5 rounded border bg-slate-50">
						Inner Join
					</div>
				</div>
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<Label className="font-medium text-slate-700">Join Columns</Label>
						<Button
							size="sm"
							variant="outline"
							className="h-6 text-xs"
							onClick={() => setConfig({ ...config, on: [...config.on, ["", ""]] })}
						>
							+ Add pair
						</Button>
					</div>
					{config.on.map(([left, right], i) => (
						<div key={i} className="flex items-center gap-2">
							<div className="flex-1 w-full overflow-hidden">
								<ColumnSelector
									value={left}
									onChange={(v) => {
										const next = [...config.on];
										next[i] = [v, right];
										setConfig({ ...config, on: next });
									}}
									columns={columns}
									previewData={previewData}
									placeholder="Left column..."
								/>
							</div>
							<span className="text-xs text-slate-400 shrink-0">=</span>
							<div className="flex-1 w-full overflow-hidden">
								<ColumnSelector
									value={right}
									onChange={(v) => {
										const next = [...config.on];
										next[i] = [left, v];
										setConfig({ ...config, on: next });
									}}
									columns={columns}
									previewData={previewData}
									placeholder="Right column..."
								/>
							</div>
							<Button
								size="icon"
								variant="ghost"
								className="h-6 w-6 text-red-400 hover:text-red-600 shrink-0"
								onClick={() =>
									setConfig({
										...config,
										on: config.on.filter((_, j) => j !== i),
									})
								}
							>
								✕
							</Button>
						</div>
					))}
				</div>
			</div>
		);
	}
	// Union
	return (
		<p className="text-sm text-slate-500 py-2">
			Union combines all rows from connected sources. No additional configuration needed.
		</p>
	);
}

// ---- Source Table Menu (for Add Table popover) ----

function HighlightMatch({ text, search }: { text: string; search: string }) {
	if (!search) return <>{text}</>;
	const idx = text.toLowerCase().indexOf(search.toLowerCase());
	if (idx === -1) return <>{text}</>;
	return (
		<>
			{text.slice(0, idx)}
			<mark className="bg-yellow-200 text-inherit rounded-sm px-px">
				{text.slice(idx, idx + search.length)}
			</mark>
			{text.slice(idx + search.length)}
		</>
	);
}

function SourceTableMenu({
	source,
	search,
	onSelectTable,
}: {
	source: DataSource;
	search: string;
	onSelectTable: (tableName: string) => void;
}) {
	const [manualExpanded, setManualExpanded] = useState(false);
	const tableNames = Object.keys(source.cachedMetadata?.tables ?? {});

	if (tableNames.length === 0) return null;

	const query = search.toLowerCase();
	const sourceMatches = query && source.name.toLowerCase().includes(query);
	const matchingTables = query
		? tableNames.filter((t) => t.toLowerCase().includes(query))
		: tableNames;

	if (query && !sourceMatches && matchingTables.length === 0) return null;

	const expanded = query ? sourceMatches || matchingTables.length > 0 : manualExpanded;
	const displayedTables = query && !sourceMatches ? matchingTables : tableNames;

	return (
		<div className="mb-0.5">
			<button
				type="button"
				onClick={() => !query && setManualExpanded(!manualExpanded)}
				className="flex items-center gap-1.5 w-full px-2 py-1.5 text-sm font-medium text-left rounded hover:bg-accent transition-colors"
			>
				<LuDatabase className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
				<span className="truncate">
					<HighlightMatch text={source.name} search={search} />
				</span>
				<span className="text-xs text-muted-foreground ml-auto shrink-0">
					{displayedTables.length}
				</span>
			</button>
			{expanded && (
				<div className="ml-2 border-l pl-1">
					{displayedTables.map((tableName) => (
						<button
							type="button"
							key={tableName}
							onClick={() => onSelectTable(tableName)}
							className="flex items-center gap-1.5 w-full px-2 py-1 text-sm text-left rounded hover:bg-accent transition-colors"
						>
							<LuTable2 className="w-3 h-3 text-muted-foreground shrink-0" />
							<span className="truncate">
								<HighlightMatch text={tableName} search={search} />
							</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
