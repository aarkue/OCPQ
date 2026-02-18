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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import "@xyflow/react/dist/style.css";
import { useQueryClient } from "@tanstack/react-query";
import debounce from "lodash.debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { LuDatabase, LuPlay, LuPlus, LuSearch, LuTable2, LuTrash2 } from "react-icons/lu";
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

	// Track mouse position for context menu node placement
	useEffect(() => {
		function handleMouseMove(e: MouseEvent) {
			mousePos.current = { x: e.clientX, y: e.clientY };
		}
		document.addEventListener("mousemove", handleMouseMove);
		return () => document.removeEventListener("mousemove", handleMouseMove);
	}, []);

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
			>
				<Background />
				<Controls />
				<Panel position="top-left">
					<Popover open={addMenuOpen} onOpenChange={(open) => {
						setAddMenuOpen(open);
						if (!open) setTableSearch("");
					}}>
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

function HighlightMatch({ text, search }: { text: string; search: string }) {
	if (!search) return <>{text}</>;
	const idx = text.toLowerCase().indexOf(search.toLowerCase());
	if (idx === -1) return <>{text}</>;
	return (
		<>
			{text.slice(0, idx)}
			<mark className="bg-yellow-200 text-inherit rounded-sm px-px">{text.slice(idx, idx + search.length)}</mark>
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

	// Hide this source entirely if searching and nothing matches
	if (query && !sourceMatches && matchingTables.length === 0) return null;

	// Auto-expand when there's a search match, otherwise use manual toggle
	const expanded = query ? (sourceMatches || matchingTables.length > 0) : manualExpanded;
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
				<span className="text-xs text-muted-foreground ml-auto shrink-0">{displayedTables.length}</span>
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
