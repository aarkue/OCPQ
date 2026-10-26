import {
	Background,
	type Connection,
	Controls,
	type Edge,
	type Node,
	type OnConnectEnd,
	Panel,
	ReactFlow,
	useEdges,
	useNodes,
	useNodesInitialized,
	useReactFlow,
} from "@xyflow/react";
import {
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

import AlertHelper from "@/components/AlertHelper";
import Spinner from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import { ElementInfoContext } from "@/ElementInfo";
import { useBackend } from "@/hooks";
import { InspectorContext } from "@/inspector/InspectorContext";
import { setLatestEvaluation } from "@/inspector/latest-evaluations";
import { publishQueryContext } from "@/inspector/query-context";
import "@/lib/editor-loader";
import { ImageIcon } from "@radix-ui/react-icons";
import { isEditorElementTarget } from "@/lib/flow-helper";
import { MOD_KEY } from "@/lib/platform";
import type { BindingBoxTreeNode } from "@/types/generated/BindingBoxTreeNode";
import type { EventVariable } from "@/types/generated/EventVariable";
import type { ObjectVariable } from "@/types/generated/ObjectVariable";
import "@xyflow/react/dist/style.css";
import clsx from "clsx";
import { toBlob, toSvg } from "html-to-image";
import toast from "react-hot-toast";
import { LuClipboardCopy, LuClipboardPaste, LuFileSearch, LuLayoutDashboard } from "react-icons/lu";
import { PiPlayFill } from "react-icons/pi";
import { RxReset } from "react-icons/rx";
import { TbFileExport, TbFilter, TbLogicAnd, TbPlus, TbSquare } from "react-icons/tb";
import { v4 } from "uuid";
import type { OCELInfo, OCELType } from "../../types/ocel";
import {
	getAvailableChildNamesWithEdges,
	getNamesInConnectedTreeWithEdges,
} from "./helper/child-names";
import { variableDisplay } from "./helper/colors";
import {
	EVENT_TYPE_LINK_TYPE,
	EVENT_TYPE_NODE_TYPE,
	edgeTypes,
	GATE_NODE_TYPE,
	NODE_TYPE_SIZE,
	nodeTypes,
} from "./helper/const";
import { emptyBoxNode } from "./helper/constructNodes";
import DatabaseTranslationButton from "./helper/DatabaseTranslationButton";
import {
	evaluateConstraints,
	getParentNodeID,
	getParentsNodeIDs,
	mergeSubTrees,
} from "./helper/evaluation/evaluate-constraints";
import { FlowContext } from "./helper/FlowContext";
import { applyLayoutToNodes } from "./helper/LayoutFlow";
import {
	ALL_GATE_TYPES,
	type ConstraintInfo,
	type EvaluationRes,
	type EvaluationResPerNodes,
	type EventTypeLinkData,
	type EventTypeNodeData,
	type GateNodeData,
} from "./helper/types";
import { VisualEditorContext } from "./helper/VisualEditorContext";

interface VisualEditorProps {
	ocelInfo: OCELInfo;
	children?: ReactNode;
	constraintInfo: ConstraintInfo;
	/** Identifies the open query. The view is framed again only when it changes. */
	queryKey: number;
}

const DEFAULT_EDGE_OPTIONS = {
	type: EVENT_TYPE_LINK_TYPE,
	style: {
		strokeWidth: 4,
		stroke: "#646464",
	},
} as const;

/** Tells the inspector which boxes the open query has and which one is selected. */
function QueryContextPublisher() {
	const nodes = useNodes<Node<EventTypeNodeData | GateNodeData>>();
	const edges = useEdges();
	useEffect(() => {
		const parentOf = new Map(edges.map((e) => [e.target, e.source]));
		const selected = nodes.filter((n) => n.selected);
		publishQueryContext({
			nodes: nodes.map((n) => ({
				id: n.id,
				parentId: parentOf.get(n.id),
				box: "box" in n.data ? n.data.box : undefined,
			})),
			selectedId: selected.length === 1 ? selected[0].id : undefined,
		});
	}, [nodes, edges]);
	useEffect(() => () => publishQueryContext(undefined), []);
	return null;
}

export default function VisualEditor(props: VisualEditorProps) {
	const { setInstance, registerOtherDataGetter, otherData, flushData, scheduleAutoSave } =
		useContext(FlowContext);
	const instance = useReactFlow<Node<EventTypeNodeData | GateNodeData>, Edge<EventTypeLinkData>>();

	const [violationInfo, setViolationInfo] = useState<{
		violationsPerNode?: EvaluationResPerNodes;
		evalNodes?: Record<string, BindingBoxTreeNode>;
		showViolationsFor?: (
			nodeID: string,
			initialMode?: "violations" | "situations" | "satisfied-situations",
		) => unknown;
	}>({
		showViolationsFor,
		violationsPerNode: otherData?.violations,
	});
	const { pin } = useContext(InspectorContext);
	const evalSlot = `q${props.queryKey}`;
	const queryName =
		props.constraintInfo.name !== "" ? props.constraintInfo.name : `Query ${props.queryKey + 1}`;
	function showViolationsFor(
		nodeID: string,
		im?: "violations" | "situations" | "satisfied-situations",
	) {
		const evaluated = violationInfo.violationsPerNode;
		if (evaluated != null && nodeID in evaluated.evalRes && nodeID in evaluated.evalNodes) {
			pin({
				kind: "result",
				slot: evalSlot,
				nodeId: nodeID,
				title: `${queryName} · Box ${evaluated.nodeIdtoIndex[nodeID] + 1}`,
				mode: im,
			});
		}
	}

	// Frame the query when it is opened. Fitting has to wait for React Flow to measure the boxes,
	// since before that it has no sizes to fit to. The `maxZoom` cap only binds when the content is
	// small. Uncapped, a lone box fills the canvas; at scale 1 it is a stamp in an empty pane. At 2 it
	// takes up about 40% of the width.
	// Keyed on the query because autosave and evaluation hand back a fresh `otherData.nodes` array
	// for the same query, and refitting on each would undo the user's zoom.
	const nodesInitialized = useNodesInitialized();
	const fittedQuery = useRef<number>();
	useEffect(() => {
		if (!nodesInitialized || fittedQuery.current === props.queryKey) {
			return;
		}
		fittedQuery.current = props.queryKey;
		void instance.fitView({ padding: 0.2, maxZoom: 2 });
	}, [nodesInitialized, props.queryKey, instance]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: violationInfo intentionally excluded to avoid re-render loop
	useEffect(() => {
		instance.setNodes(otherData?.nodes ?? []);
		instance.setEdges(otherData?.edges ?? []);
		setViolationInfo({
			...violationInfo,
			violationsPerNode: otherData?.violations,
		});
		if (otherData?.viewport !== undefined) {
			instance.setViewport(otherData?.viewport);
		}
	}, [otherData?.edges, otherData?.nodes, otherData?.viewport, otherData?.violations, instance]);

	const backend = useBackend();

	const [isEvaluationLoading, setEvaluationLoading] = useState(false);

	const isValidConnection = useCallback(
		({ source, sourceHandle, target, targetHandle }: Edge<EventTypeLinkData> | Connection) => {
			const edges = instance.getEdges();
			if (source === null || target === null || sourceHandle === null || targetHandle === null) {
				return false;
			}
			const parents = getParentsNodeIDs(source, edges);
			if (source === target || parents.includes(target)) {
				toast.error(
					<span>
						<b>Invalid connection</b>
						<br />
						Loops are forbidden!
					</span>,
					{
						position: "bottom-center",
						id: "invalid-connection-toast",
					},
				);
				return false;
			}
			if (edges.some((e) => e.target === target)) {
				toast.error(
					<span>
						<b>Invalid connection</b>
						<br />
						Nodes can only have one parent!
					</span>,
					{
						position: "bottom-center",
						id: "invalid-connection-toast",
					},
				);
				return false;
			}
			return true;
		},
		[instance],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: registerOtherDataGetter is stable
	useEffect(() => {
		registerOtherDataGetter(() => ({
			violations: violationInfo.violationsPerNode,
		}));
	}, [violationInfo]);
	const initialized = useRef<boolean>(false);

	const selectedRef = useRef<{
		nodes: Node<EventTypeNodeData | GateNodeData>[];
		edges: Edge<EventTypeLinkData>[];
	}>({ nodes: [], edges: [] });

	const evaluateButton = useRef<HTMLButtonElement>(null);
	// Ctrl/⌘+Enter evaluates from anywhere in the window, with Shift to measure performance. It
	// clicks the button to keep one code path. Not while a dialog is open, as its edits are not in
	// the query yet.
	useEffect(() => {
		const onKeyDown = (ev: KeyboardEvent) => {
			if (ev.key !== "Enter" || !(ev.ctrlKey || ev.metaKey) || ev.repeat) return;
			if (document.querySelector('[role="dialog"], [role="alertdialog"]') !== null) return;
			const button = evaluateButton.current;
			if (button === null || button.disabled) return;
			ev.preventDefault();
			button.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: ev.shiftKey }));
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
	const mousePos = useRef<{
		x: number;
		y: number;
	}>({ x: 0, y: 0 });

	const getAvailableVars = useCallback(
		(nodeID: string | undefined, type: "event" | "object"): (EventVariable | ObjectVariable)[] => {
			if (nodeID === undefined) {
				return [];
			}
			const node = instance.getNode(nodeID) as Node<EventTypeNodeData | GateNodeData> | null;
			let ret: (EventVariable | ObjectVariable)[] = [];
			if (node == null) {
				return ret;
			}
			if ("box" in node.data) {
				ret = [
					...Object.keys(
						type === "event" ? node.data.box.newEventVars : node.data.box.newObjectVars,
					).map((n) => Number.parseInt(n, 10)),
					...getAvailableVars(getParentNodeID(nodeID, instance.getEdges()), type),
				];
			} else {
				ret = getAvailableVars(getParentNodeID(nodeID, instance.getEdges()), type);
			}
			ret.sort((a, b) => a - b);
			return ret;
		},
		[instance],
	);

	const getAvailableChildNames = useCallback(
		(nodeID: string): string[] =>
			getAvailableChildNamesWithEdges(instance.getEdges() as any, nodeID),
		[instance],
	);

	const getNamesInConnectedTree = useCallback(
		(nodeID: string): string[] =>
			getNamesInConnectedTreeWithEdges(instance.getEdges() as any, nodeID),
		[instance],
	);

	const getTypesForVariable = useCallback(
		(nodeID: string, variable: number, type: "event" | "object"): OCELType[] => {
			const edges = instance.getEdges();
			let node = instance.getNode(nodeID) as Node<EventTypeNodeData | GateNodeData> | undefined;
			while (
				node != null &&
				(!("box" in node.data) ||
					!(
						variable in
						(type === "event" ? node.data.box.newEventVars : node.data.box.newObjectVars)
					))
			) {
				node = instance.getNode(getParentNodeID(node.id, edges) ?? "-");
			}
			if (node != null && "box" in node.data) {
				if (type === "event") {
					const etypes = node.data.box.newEventVars[variable];
					return props.ocelInfo.event_types.filter((et) => etypes.includes(et.name));
				}
				const otypes = node.data.box.newObjectVars[variable];
				return props.ocelInfo.object_types.filter((et) => otypes.includes(et.name));
			}
			return [];
		},
		[instance, props.ocelInfo.event_types, props.ocelInfo.object_types],
	);

	const getNodeIDByName = useCallback(
		(name: string): string | undefined => {
			const edge = (instance.getEdges() as Edge<EventTypeLinkData>[]).find(
				(e) => e.data?.name === name,
			);
			if (edge !== undefined) {
				return edge.target;
			}
			return undefined;
		},
		[instance],
	);

	const autoLayout = useCallback(async () => {
		const origEdges = [...instance.getEdges()];
		const origNodes = [...instance.getNodes()];
		const isSelectionEmpty =
			selectedRef.current.nodes.length <= 1 && selectedRef.current.edges.length <= 1;
		const nodes = isSelectionEmpty ? origNodes : origNodes.filter((n) => n.selected);
		const edges = (isSelectionEmpty ? origEdges : origEdges).filter(
			(e) =>
				nodes.find((n) => n.id === e.source) !== undefined &&
				nodes.find((n) => n.id === e.target) !== undefined,
		);
		const { x: beforeX, y: beforeY } = nodes.length > 0 ? nodes[0].position : { x: 0, y: 0 };
		await applyLayoutToNodes(nodes, edges);
		if (!isSelectionEmpty) {
			const { x: afterX, y: afterY } = nodes.length > 0 ? nodes[0].position : { x: 0, y: 0 };
			const diffX = beforeX - afterX;
			const diffY = beforeY - afterY;
			nodes.forEach((n) => {
				n.position.x += diffX;
				n.position.y += diffY;
			});
		}
		instance.setNodes(origNodes);
		if (isSelectionEmpty) {
			instance?.fitView({ duration: 200 });
		}
	}, [instance]);

	const addNewNode = useCallback(
		(x: number | undefined = undefined, y: number | undefined = undefined) => {
			const pos =
				x === undefined || y === undefined
					? instance.screenToFlowPosition({
							x: window.innerWidth / 2,
							y: window.innerHeight / 1.5,
						})
					: { x, y };
			// Built before the update so the id can be returned synchronously; `onConnectEnd` wires
			// an edge to it straight away.
			const node = emptyBoxNode({
				x: pos.x - NODE_TYPE_SIZE[EVENT_TYPE_NODE_TYPE].width / 2,
				y: pos.y - NODE_TYPE_SIZE[EVENT_TYPE_NODE_TYPE].minHeight / 2,
			});
			instance.setNodes((nodes) => [...nodes, node]);
			return node.id;
		},
		[instance],
	);

	const onConnectEnd = useCallback<OnConnectEnd>(
		(event, connectionState) => {
			// Only when the connection line was dropped on empty canvas (not on a handle)
			if (
				connectionState.isValid ||
				connectionState.fromNode == null ||
				connectionState.fromHandle == null
			) {
				return;
			}
			const evt = "changedTouches" in event ? event.changedTouches[0] : event;
			if (!(evt.target instanceof Element) || evt.target.closest(".react-flow__node")) {
				return;
			}
			const fromIsSource = connectionState.fromHandle.type === "source";
			// Dragging from a target handle creates a new parent node; forbidden if one exists
			if (
				!fromIsSource &&
				instance.getEdges().some((e) => e.target === connectionState.fromNode?.id)
			) {
				toast.error(
					<span>
						<b>Invalid connection</b>
						<br />
						Nodes can only have one parent!
					</span>,
					{
						position: "bottom-center",
						id: "invalid-connection-toast",
					},
				);
				return;
			}
			const { x, y } = instance.screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
			const newNodeID = addNewNode(x, y);
			instance.addEdges({
				id: v4(),
				source: fromIsSource ? connectionState.fromNode.id : newNodeID,
				sourceHandle: fromIsSource ? connectionState.fromHandle.id : `${newNodeID}-source`,
				target: fromIsSource ? newNodeID : connectionState.fromNode.id,
				targetHandle: fromIsSource ? `${newNodeID}-target` : connectionState.fromHandle.id,
				...DEFAULT_EDGE_OPTIONS,
			});
		},
		[instance, addNewNode],
	);

	const addPastedData = useCallback(
		(nodes: Node<EventTypeNodeData | GateNodeData>[], edges: Edge<EventTypeLinkData>[]) => {
			const idPrefix = `${v4()}-`;

			const nodeRect = nodes.length > 0 ? nodes[0].position : { x: 0, y: 0 };
			const { x, y } = instance.screenToFlowPosition(mousePos.current);
			const firstNodeSize =
				NODE_TYPE_SIZE[
					nodes[0].type === EVENT_TYPE_NODE_TYPE ? EVENT_TYPE_NODE_TYPE : GATE_NODE_TYPE
				];
			const xOffset = x - nodeRect.x - firstNodeSize.width / 2;
			const yOffset = y - nodeRect.y - firstNodeSize.minHeight / 2;
			// Mutate nodes to update position and IDs (+ select them)
			const newNodes = nodes.map((n) => ({
				id: idPrefix + n.id,
				position: { x: n.position.x + xOffset, y: n.position.y + yOffset },
				selected: true,
				data: n.data,
				type: n.type,
			}));
			// Update nodes
			instance.setNodes((prevNodes) => {
				return [
					// Unselect all existing nodes
					...prevNodes.map((n) => ({ ...n, selected: false })),
					// ...and add pasted nodes
					...newNodes,
				];
			});
			// Update edges
			instance.setEdges((prevEdges) => {
				return [
					// Unselect all exisiting edges
					...prevEdges.map((e) => ({ ...e, selected: false })),
					// ...and add new pasted edges (mutating the ID, and source/target (handle) + selecting them)
					...edges
						.map((e) => ({
							id: idPrefix + e.id,
							type: e.type,
							source: idPrefix + e.source,
							target: idPrefix + e.target,
							sourceHandle: idPrefix + e.sourceHandle,
							targetHandle: idPrefix + e.targetHandle,
							selected: true,
							data: e.data,
						}))
						.filter(
							(e) =>
								newNodes.find((n) => n.id === e.source) !== undefined &&
								newNodes.find((n) => n.id === e.target) !== undefined,
						),
				];
			});
		},
		[instance],
	);

	useEffect(() => {
		async function keyPressListener(ev: KeyboardEvent) {
			if (!isEditorElementTarget(ev.target)) {
				return;
			}
			if (ev.altKey && ev.key === "n") {
				const { x, y } = instance.screenToFlowPosition(mousePos.current);
				addNewNode(x, y);
			} else if (ev.altKey && ev.key === "l") {
				await autoLayout();
				toast("Applied Auto-Layout");
			} else if (ev.altKey && ev.key === "c") {
				ev.preventDefault();
				try {
					await navigator.clipboard.writeText(JSON.stringify(selectedRef.current));
					toast("Copied selection!", {
						icon: <LuClipboardCopy />,
					});
				} catch (_e) {
					// Clipboard access may fail silently
				}
			} else if ((ev.ctrlKey || ev.metaKey || ev.altKey) && ev.key === "a") {
				ev.preventDefault();
				ev.stopPropagation();
				instance.setNodes((nodes) => nodes.map((n) => ({ ...n, selected: true })));
				instance.setEdges((edges) => edges.map((e) => ({ ...e, selected: true })));
				return false;
			}
		}

		function mouseListener(ev: MouseEvent) {
			mousePos.current = { x: ev.x, y: ev.y };
		}

		async function copyListener(ev: ClipboardEvent) {
			if (!isEditorElementTarget(ev.target)) {
				return;
			}
			ev.preventDefault();
			if (ev.clipboardData !== null) {
				await navigator.clipboard.writeText(JSON.stringify(selectedRef.current));
			}
			toast("Copied selection!", { icon: <LuClipboardCopy /> });
		}

		function pasteListener(ev: ClipboardEvent) {
			if (!isEditorElementTarget(ev.target)) {
				return;
			}
			if (ev.clipboardData != null) {
				let pastedNodesAndEdges = ev.clipboardData.getData("application/json+ocpq-flow");
				if (pastedNodesAndEdges === "") {
					pastedNodesAndEdges = ev.clipboardData.getData("text/plain");
				}
				try {
					const { nodes, edges }: typeof selectedRef.current = JSON.parse(pastedNodesAndEdges);
					addPastedData(nodes, edges);
					toast("Pasted selection!", { icon: <LuClipboardPaste /> });
				} catch (_e) {
					toast("Failed to parse pasted data. Try using Alt+C to copy nodes.");
				}
				ev.preventDefault();
			}
		}
		document.addEventListener("copy", copyListener);
		document.addEventListener("paste", pasteListener);
		document.addEventListener("keydown", keyPressListener);
		document.addEventListener("mousemove", mouseListener);
		return () => {
			document.removeEventListener("copy", copyListener);
			document.removeEventListener("paste", pasteListener);
			document.removeEventListener("keydown", keyPressListener);
			document.removeEventListener("mousemove", mouseListener);
		};
	}, [instance, addNewNode, addPastedData, autoLayout]);

	const onEdgeContextMenu = useCallback((ev: ReactMouseEvent, e: Edge) => {
		const ctxBtn = document.getElementById(`edge-context-menu-${e.id}`);
		if (!ev.isDefaultPrevented()) {
			ctxBtn!.dispatchEvent(
				new MouseEvent("contextmenu", {
					bubbles: true,
					clientX: ev.clientX,
					clientY: ev.clientY,
				}),
			);
			ev.preventDefault();
		}
	}, []);
	const [filterMode, setFilterMode] = useState<"shown" | "hidden">("hidden");

	const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);
	const contextMenuPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

	const { showElementInfo, openElementSearch } = useContext(ElementInfoContext);
	return (
		<VisualEditorContext.Provider
			value={{
				ocelInfo: props.ocelInfo,
				violationsPerNode: violationInfo.violationsPerNode,
				showViolationsFor,
				getAvailableVars,
				getAvailableChildNames,
				getNamesInConnectedTree,
				getTypesForVariable,
				getNodeIDByName,
				filterMode,
				showElementInfo,
				getVarName: variableDisplay,
				onNodeDataChange: (id, newData) => {
					if (newData === undefined) {
						instance.deleteElements({ nodes: [{ id }] });
					} else {
						instance.updateNodeData(id, newData);
					}
				},
				onEdgeDataChange: (id, newData) => {
					if (newData !== undefined) {
						instance.updateEdgeData(id, newData);
						// instance.setEdges((es) => {
						//   const newEdges = [...es];
						//   const changedEdge = newEdges.find((e) => e.id === id);
						//   if (changedEdge !== undefined) {
						//     changedEdge.data = { ...changedEdge.data, ...newData };
						//   } else {
						//     console.warn("Did not find changed edge data for id: " + id);
						//   }
						//   return newEdges;
						// });
					} else {
						instance.setEdges((edges) => {
							const newEdges = edges.filter((e) => e.id !== id);
							return newEdges;
						});
					}
				},
			}}
		>
			<ContextMenu>
				<ContextMenuTrigger
					className="pointer-events-auto hidden "
					asChild
					ref={contextMenuTriggerRef}
				>
					<button />
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem
						onClick={() => {
							const { x, y } = instance.screenToFlowPosition(contextMenuPos.current);
							addNewNode(x, y);
						}}
					>
						Add Node
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<ReactFlow<Node<EventTypeNodeData | GateNodeData>, Edge<EventTypeLinkData>>
				className="react-flow"
				tabIndex={0}
				onInit={(flow) => {
					initialized.current = true;
					if (initialized.current) {
						setInstance(flow);
					}
				}}
				defaultViewport={otherData?.viewport}
				maxZoom={3.5}
				minZoom={0.05}
				edgeTypes={edgeTypes}
				nodeTypes={nodeTypes}
				connectionLineStyle={{ stroke: "#646464", strokeWidth: 3 }}
				defaultNodes={otherData?.nodes ?? ([] as Node<EventTypeNodeData | GateNodeData>[])}
				defaultEdges={otherData?.edges ?? ([] as Edge<EventTypeLinkData>[])}
				isValidConnection={isValidConnection}
				onContextMenu={(ev) => {
					const trigger = !ev.isDefaultPrevented();
					ev.stopPropagation();
					ev.preventDefault();
					if (trigger && contextMenuTriggerRef.current) {
						contextMenuPos.current = { x: ev.clientX, y: ev.clientY };
						const newEv = new MouseEvent("contextmenu", {
							bubbles: true,
							cancelable: true,
							clientX: ev.clientX,
							clientY: ev.clientY,
						});
						contextMenuTriggerRef.current.dispatchEvent(newEv);
					}
				}}
				defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
				onConnectEnd={onConnectEnd}
				onEdgeContextMenu={onEdgeContextMenu}
				proOptions={{ hideAttribution: true }}
				onSelectionChange={(sel) => {
					selectedRef.current = sel;
				}}
				onNodesChange={scheduleAutoSave}
				onEdgesChange={scheduleAutoSave}
				onMoveEnd={scheduleAutoSave}
			>
				<QueryContextPublisher />
				<Controls onInteractiveChange={() => {}} />
				{/* The panel's box spans the gaps between and below the buttons. Only the buttons take
				    clicks, so clicks in those gaps reach the canvas. */}
				<Panel
					position="top-right"
					className="flex flex-row-reverse gap-x-2 pointer-events-none [&_button]:pointer-events-auto"
				>
					<div className="flex flex-col items-center gap-y-1">
						<Button
							ref={evaluateButton}
							disabled={isEvaluationLoading}
							variant="outline"
							title={`Evaluate (${MOD_KEY}+Enter). Hold Shift to measure performance.`}
							className="relative bg-fuchsia-100 disabled:bg-fuchsia-200 border-fuchsia-300 hover:bg-fuchsia-200 hover:border-fuchsia-300"
							onClick={async (ev) => {
								setEvaluationLoading(true);
								const { tree, nodesOrder } = mergeSubTrees(
									evaluateConstraints(instance.getNodes(), instance.getEdges()),
								);
								const measurePerformance = ev.shiftKey;
								if (measurePerformance) {
									toast(
										"Measuring performance by evaluating constraint 10+1 times. The first 10 execution times in seconds will be saved as a JSON file in your Downloads folder.",
									);
								}
								try {
									const res = await toast.promise(
										backend["ocel/check-constraints-box"](tree, measurePerformance, evalSlot),
										{
											loading: "Evaluating...",
											success: (res) => (
												<span>
													<b>Evaluation finished</b>
													<br />
													<span>
														Situations per step:
														<br />
														<span className="font-mono">
															{res.nodeSummaries.map((r) => r.situationCount).join(", ")}
														</span>
														<br />
														Violations per step:
														<br />
														<span className="font-mono">
															{res.nodeSummaries.map((r) => r.situationViolatedCount).join(", ")}
														</span>
													</span>
												</span>
											),
											error: (e) => (
												<>
													Evaluation failed
													<br />
													{String(e)}
												</>
											),
										},
									);
									if (res.bindingsSkipped) {
										toast.error(
											(x) => (
												<>
													<div className="">
														<b className="text-red-600">Some bindings were skipped!</b>
														<br />
														<p className="text-sm">
															The query yielded too many results and could not be fully computed.
															<br />
															The returned counts and results represent just a small sample.
															<br />
														</p>
														<div className="text-right">
															<Button onClick={() => toast.dismiss(x.id)} variant="destructive">
																Understood
															</Button>
														</div>
													</div>
												</>
											),
											{
												duration: Number.POSITIVE_INFINITY,
												position: "top-center",
											},
										);
									}
									const evalRes: Record<string, EvaluationRes> = {};
									const evalNodes: Record<string, BindingBoxTreeNode> = {};
									const nodeIdtoIndex: Record<string, number> = {};
									res.nodeSummaries.forEach((summary, i) => {
										evalRes[nodesOrder[i].id] = summary;
									});
									tree.nodes.forEach((node, i) => {
										evalNodes[nodesOrder[i].id] = node;
										nodeIdtoIndex[nodesOrder[i].id] = i;
									});
									const childSets: Record<string, { name: string; nodeId: string }[]> = {};
									for (const [[parent, child], name] of tree.edgeNames) {
										const id = nodesOrder[parent].id;
										childSets[id] = [
											...(childSets[id] ?? []),
											{ name, nodeId: nodesOrder[child].id },
										];
									}
									const evaluated = {
										evalRes,
										evalVersion: res.evalVersion,
										evalNodes,
										nodeIdtoIndex,
										childSets,
									};
									setLatestEvaluation(evalSlot, evaluated);
									setViolationInfo((vi) => ({ ...vi, violationsPerNode: evaluated }));
									flushData({ violations: evaluated });
								} finally {
									setEvaluationLoading(false);
								}
							}}
						>
							{isEvaluationLoading && (
								<div className="w-7 h-7 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
									<Spinner className="w-7 h-7 text-purple-600" />
								</div>
							)}
							<PiPlayFill
								size={20}
								className={clsx(
									!isEvaluationLoading && "text-fuchsia-700",
									isEvaluationLoading && "text-gray-600",
								)}
							/>
						</Button>
						{filterMode === "shown" && (
							<AlertHelper
								trigger={
									<Button
										variant="outline"
										size="sm"
										className="bg-white"
										title="Export filtered OCEL"
									>
										<TbFileExport size={22} />
									</Button>
								}
								mode="promise"
								title="Export Filtered OCEL"
								initialData={{
									exportFormat: "JSON" as "JSON" | "XML" | "SQLITE",
								}}
								content={({ data, setData }) => {
									return (
										<div>
											<Label>OCEL Export Format</Label>
											<br />
											<Combobox
												value={data.exportFormat}
												options={[
													{ value: "JSON", label: "JSON" },
													{ value: "XML", label: "XML" },
													{ value: "SQLITE", label: "SQLite" },
												]}
												name="Export format"
												onChange={(v) => {
													setData({ ...data, exportFormat: v as any });
												}}
											/>
										</div>
									);
								}}
								submitAction={"Export"}
								onSubmit={async (cfg, ev) => {
									if ((cfg.exportFormat as any) === "") {
										ev.preventDefault();
										ev.stopPropagation();
										toast("Please select a valid export format!");
										throw new Error("Invalid Option");
									}
									setEvaluationLoading(true);
									const { tree } = mergeSubTrees(
										evaluateConstraints(instance.getNodes(), instance.getEdges()),
									);
									const type: "JSON" | "XML" | "SQLITE" = cfg.exportFormat;
									try {
										const res = await toast.promise(backend["ocel/export-filter-box"](tree, type), {
											success: "Exported!",
											loading: "Exporting...",
											error: "Failed to export!",
										});
										if (res) {
											backend["download-blob"](res, `${queryName}-export.${type.toLowerCase()}`);
										}
									} finally {
										setEvaluationLoading(false);
									}
								}}
							/>
						)}

						{violationInfo.violationsPerNode !== undefined && (
							<Button
								size="icon"
								variant="outline"
								title={"Clear evaluation"}
								className=""
								onClick={async () => {
									setViolationInfo({});
									flushData({ violations: undefined });
								}}
							>
								<RxReset size={16} />
							</Button>
						)}
						<div className="flex flex-col gap-y-1 mt-1">
							<Button
								variant="outline"
								size="icon"
								title="Auto layout (Alt+L)"
								className="bg-white"
								onClick={async () => await autoLayout()}
							>
								<LuLayoutDashboard />
							</Button>

							<Button
								variant="outline"
								size="icon"
								title="Save as Image (PNG, hold Shift for SVG)"
								className="bg-white"
								onClick={(ev) => {
									const button = ev.currentTarget;
									button.disabled = true;
									const scaleFactor = 2.0;
									const viewPort = document.querySelector(".react-flow__viewport") as HTMLElement;
									const useSVG = ev.shiftKey;
									void (useSVG ? toSvg : toBlob)(viewPort, {
										canvasHeight: viewPort.clientHeight * scaleFactor,
										canvasWidth: viewPort.clientWidth * scaleFactor,
										filter: (node) =>
											node.classList === undefined || !node.classList.contains("hide-in-image"),
									})
										.then(async (dataURLOrBlob) => {
											let blob = dataURLOrBlob;
											if (typeof blob === "string") {
												blob = await (await fetch(blob)).blob();
											}
											if (blob) {
												backend["download-blob"](blob, `${queryName}.${useSVG ? "svg" : "png"}`);
											}
										})
										.finally(() => {
											button.disabled = false;
										});
								}}
							>
								<ImageIcon />
							</Button>
							<DatabaseTranslationButton instance={instance} />
						</div>
					</div>
					{props.children}
					<div className="flex  gap-1">
						<div className="flex flex-col items-center gap-y-1 ">
							<Toggle
								title="OCEL Filtering (For Export)"
								pressed={filterMode === "shown"}
								onPressedChange={(pressed) => {
									setFilterMode(pressed ? "shown" : "hidden");
								}}
							>
								<TbFilter />{" "}
							</Toggle>
						</div>
						<Button
							variant="outline"
							title="Add Node (Alt+N)"
							className="bg-white relative"
							onClick={() => {
								addNewNode();
							}}
						>
							<TbSquare size={16} className="mr-0.5" />
							<TbPlus strokeWidth={"3px"} size={12} className="absolute right-1.5 bottom-1.5" />
						</Button>
						<AlertHelper
							// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
							initialData={{ type: "not" } as GateNodeData}
							trigger={
								<Button
									variant="outline"
									title="Add Gate"
									className="bg-white relative"
									onClick={() => {}}
								>
									<TbLogicAnd size={20} />
									<TbPlus strokeWidth={"3px"} size={12} className="absolute right-1.5 bottom-1.5" />
								</Button>
							}
							title={"Add Gate"}
							submitAction={"Submit"}
							onSubmit={(data) => {
								instance.setNodes((nodes) => {
									const center =
										instance != null
											? instance.screenToFlowPosition({
													x: window.innerWidth / 2,
													y: window.innerHeight / 2,
												})
											: { x: 0, y: 0 };
									return [
										...nodes,
										{
											id: `gate${Date.now()}`,
											type: GATE_NODE_TYPE,
											position: center,
											data: {
												type: data.type,
											},
										},
									];
								});
							}}
							content={({ data, setData }) => {
								const sortedOcelEventTypes = [...props.ocelInfo.event_types];
								sortedOcelEventTypes.sort((a, b) => a.name.localeCompare(b.name));
								return (
									<>
										<p className="mb-2">Please select the type of gate to add below.</p>
										<Combobox
											value={data.type}
											onChange={(v) => {
												setData({ ...data, type: v as GateNodeData["type"] });
											}}
											name="Gate Type"
											options={ALL_GATE_TYPES.map((t) => ({
												label: t,
												value: t,
											}))}
										/>
									</>
								);
							}}
						/>
					</div>
				</Panel>
				<Background />
			</ReactFlow>
			<Button
				className="absolute right-0 bottom-0 m-1"
				size="icon"
				title="Find an event or object"
				onClick={openElementSearch}
			>
				<LuFileSearch />
			</Button>
		</VisualEditorContext.Provider>
	);
}
