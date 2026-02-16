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
import { BackendProviderContext } from "@/BackendProviderContext";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import "@xyflow/react/dist/style.css";
import { useQueryClient } from "@tanstack/react-query";
import debounce from "lodash.debounce";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { LuDatabase, LuPlay, LuTable2, LuTrash2 } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { useBackend } from "@/hooks";
import type { DataSource } from "../data-extraction-types";
import {
	type BlueprintEdgeType,
	type BlueprintFlowState,
	type TableNodeType,
	toBackendBlueprint,
} from "./blueprint-flow-types";
import { TableNode } from "./TableNode";

const nodeTypes = {
	table: TableNode,
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
	const flowRef = useRef<ReactFlowInstance<TableNodeType, BlueprintEdgeType>>();
	const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);
	const mousePos = useRef({ x: 0, y: 0 });
	const [isExecuting, setIsExecuting] = useState(false);

	const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeType>(initialState?.nodes ?? []);
	const [edges, setEdges, onEdgesChange] = useEdgesState<BlueprintEdgeType>(
		initialState?.edges ?? [],
	);

	// Store onChange in a ref to avoid recreating the debounced function
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	// Create a stable debounced save function
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

	// Wrap change handlers to trigger debounced save
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

	// Flush pending saves on unmount
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

	// Track mouse position for node placement
	useEffect(() => {
		function handleMouseMove(e: MouseEvent) {
			mousePos.current = { x: e.clientX, y: e.clientY };
		}
		document.addEventListener("mousemove", handleMouseMove);
		return () => document.removeEventListener("mousemove", handleMouseMove);
	}, []);

	const onDragOver = useCallback((event: React.DragEvent) => {
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
	}, []);

	const onDrop = useCallback(
		(event: React.DragEvent) => {
			event.preventDefault();
			const type = event.dataTransfer.getData("application/reactflow");
			if (typeof type === "undefined" || !type) return;
			const [sourceID, tableName] = event.dataTransfer.getData("application/dataId").split("||");
			const source = sources.find((s) => s.id === sourceID);
			if (!source) {
				return;
			}

			const pos = flowRef.current!.screenToFlowPosition({
				x: event.clientX,
				y: event.clientY,
			});
			addTableNode(source, tableName, pos);
		},
		[addTableNode, sources],
	);

	// Get sources with cached metadata
	const connectedSources = sources.filter(
		(s) => s.cachedMetadata && Object.keys(s.cachedMetadata.tables).length > 0,
	);

	// Count tables with configured usage (not "none")
	const configuredTablesCount = nodes.filter(
		(n) => n.data.usage && n.data.usage.mode !== "none",
	).length;

	const handleExecuteExtraction = useCallback(async () => {
		if (!flowRef.current) return;

		const flowState = flowRef.current.toObject() as BlueprintFlowState;
		const blueprint = toBackendBlueprint(sources, flowState);

		if (blueprint.tables.length === 0) {
			toast.error("No tables configured for extraction");
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
				// Navigate to OCEL info page to see the result
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
				onDrop={onDrop}
				onDragOver={onDragOver}
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
			>
				<Background />
				<Controls />
				<Panel position="top-left" className="flex gap-2">
					<div className="bg-white/90 backdrop-blur-sm rounded-lg border shadow-sm p-2">
						<div className=" font-semibold mb-1 text-lg">
							Add Tables
							<p className="text-sm text-muted-foreground font-normal">
								Drag and drop tables to add them to the blueprint.
							</p>
						</div>
						<div className="flex flex-wrap gap-1 max-w-xs max-h-100 overflow-auto">
							{connectedSources.length === 0 ? (
								<span className="text-xs text-slate-400">Connect a data source first</span>
							) : (
								connectedSources.map((source) => (
									<div key={source.id} className="w-full border-b  mb-1 pb-2">
										<div className="font-semibold flex text-lg items-center gap-x-1">
											<LuDatabase className="w-3.5 h-3.5 text-slate-600" />
											{source.name}
										</div>
										{Object.keys(source.cachedMetadata?.tables ?? {}).map((tableName) => (
											<button
												tabIndex={-1}
												type="button"
												key={tableName}
												draggable
												onDragStart={(event) => {
													event.dataTransfer.setData("application/reactflow", "primitive");
													event.dataTransfer.setData(
														"application/dataId",
														`${source.id}||${tableName}`,
													);
													event.dataTransfer.effectAllowed = "move";
												}}
												className="px-2 m-1 py-1 inline-flex items-center text-center bg-white border border-gray-200 rounded shadow-sm cursor-grab hover:border-blue-400 transition-colors  truncate"
											>
												<LuTable2 className="w-3 h-3 mr-1" />
												{tableName}
											</button>
										))}
									</div>
								))
							)}
						</div>
					</div>
				</Panel>
				{nodes.length > 0 && (
					<Panel position="top-right" className="flex gap-2">
						{configuredTablesCount > 0 && (
							<Button
								size="sm"
								variant="default"
								className="bg-green-600 hover:bg-green-700"
								onClick={handleExecuteExtraction}
								disabled={isExecuting}
							>
								<LuPlay className="w-4 h-4 mr-1" />
								{isExecuting ? "Extracting..." : `Extract OCEL (${configuredTablesCount} tables)`}
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
		</div>
	);
}
