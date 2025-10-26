import { BackendProviderContext } from "@/BackendProviderContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ImageIcon } from "@radix-ui/react-icons";
import { toBlob, toSvg } from "html-to-image";
import { useCallback, useContext, useRef } from "react";
import { ReactFlow, Node, EdgeTypes, NodeTypes, OnConnect, ReactFlowInstance, useEdgesState, Edge, Background, Controls, Panel, ConnectionLineType, ReactFlowJsonObject } from "@xyflow/react";;
import { OCDeclareArcLabel } from "../types/OCDeclareArcLabel";
import { Input } from "@/components/ui/input";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { v4 as uuidv4 } from 'uuid';
import { ActivityNodeType, CustomEdgeType, CustomEdgeData, EdgeType } from "./oc-declare-flow-types";
import { OCDeclareFlowNode } from "./OCDeclareFlowNode";
import OCDeclareFlowEdge from "./OCDeclareFlowEdge";
import { addArcsToFlow } from "./oc-declare-flow-type-conversions";
import debounce from "lodash.debounce";

export const nodeTypes = {
    'activity': OCDeclareFlowNode,
} satisfies NodeTypes;


export const edgeTypes = {
    "default": OCDeclareFlowEdge
} satisfies EdgeTypes;




const STROKE_WIDTH = 2.5;

export function getMarkersForEdge(edgeType: EdgeType, id?: string): { markerStart: string, markerEnd: string | undefined, style: React.CSSProperties } {
    if (edgeType === "ef") {
        return {
            markerStart: `start-${id}`,
            markerEnd: "single-arrow-marker",
            style: { stroke: "var(--arrow-primary)", strokeWidth: STROKE_WIDTH }
        }
    }
    if (edgeType === "ass") {
        return {
            markerStart: `start-${id}`,
            markerEnd: undefined,
            style: {
                stroke: "var(--arrow-primary)", strokeWidth: STROKE_WIDTH,
                //  strokeDasharray: "5 5" 
            }
        }
    }
    if (edgeType === "nef") {
        return {
            markerStart: `start-${id}`,
            markerEnd: "single-not-arrow-marker",
            style: { stroke: "var(--arrow-primary)", strokeWidth: STROKE_WIDTH }

        }
    }
    if (edgeType === "nef-rev") {
        return {

            markerStart: `start-${id}`,
            // markerStart: "single-not-arrow-marker-rev",
            markerEnd: undefined,
            style: { stroke: "var(--arrow-primary)", strokeWidth: STROKE_WIDTH }

        }
    }
    if (edgeType === "ef-rev") {
        return {
            markerStart: `start-${id}`,
            // markerStart: "single-arrow-marker-rev",
            markerEnd: undefined,
            style: { stroke: "var(--arrow-primary)", strokeWidth: STROKE_WIDTH }

        }
    }
    if (edgeType === "df") {
        return {
            markerStart: `start-${id}`,
            // markerStart: "single-arrow-marker-rev",
            markerEnd: "single-arrow-direct-marker",
            style: { stroke: "var(--arrow-primary)", strokeWidth: STROKE_WIDTH }
        }
    }
    if (edgeType === "df-rev" || edgeType === "ndf-rev") {
        return {
            markerStart: `start-${id}`,
            // markerStart: "single-arrow-marker-rev",
            markerEnd: undefined,
            style: { stroke: "var(--arrow-primary)", strokeWidth: STROKE_WIDTH }

        }
    }
    if (edgeType === "ndf") {
        return {
            markerStart: `start-${id}`,
            // markerStart: "single-arrow-marker-rev",
            markerEnd: "single-not-arrow-direct-marker",
            style: { stroke: "var(--arrow-primary)", strokeWidth: STROKE_WIDTH }

        }
    }
    return {
        markerStart: `start-${id}`,
        markerEnd: undefined,
        style: { stroke: "purple", strokeWidth: 2, strokeDasharray: "5 5" }
    }
}

export default function OCDeclareFlowEditor({ initialFlowJson, onChange }: { initialFlowJson: ReactFlowJsonObject<ActivityNodeType, CustomEdgeType>, onChange?: (json: ReactFlowJsonObject<ActivityNodeType, CustomEdgeType>) => unknown }) {
    const backend = useContext(BackendProviderContext);
    const flowRef = useRef<ReactFlowInstance<ActivityNodeType, CustomEdgeType>>();
    const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);

    const onConnect = useCallback<OnConnect>((connection) => {
        const source = flowRef.current!.getNode(connection.source!)!;
        const target = flowRef.current!.getNode(connection.target!)!;
        let objectTypes: OCDeclareArcLabel = { "each": [{ type: "Simple", object_type: "orders" }], any: [], all: [] };
        if (source.data.isObject && !target.data.isObject) {
            objectTypes = { "each": [], any: [{ type: "Simple", object_type: source.data.type }], all: [] };
        } else if (target.data.isObject && !source.data.isObject) {
            objectTypes = { "each": [], any: [{ type: "Simple", object_type: target.data.type }], all: [] };
        } else if (target.data.isObject && source.data.isObject) {
            objectTypes = { "each": [], any: [{ type: "O2O", first: source.data.type, second: target.data.type, reversed: false }], all: [] };
        }
        return flowRef.current?.setEdges((edges) => {
            const edgeType: EdgeType = source.data.isObject || target.data.isObject ? "ass" : "ef";
            const id = Math.random() + connection.source! + "@" + connection.sourceHandle + "-" + connection.target + "@" + connection.targetHandle;
            const newEdge: Edge<CustomEdgeData> = {
                source: connection.source!,
                target: connection.target!,
                type: "default",
                id,
                data: { type: edgeType, objectTypes },
                ...getMarkersForEdge(edgeType, id)
            };
            return [...edges, newEdge]
        })

    }, [])

    const [edges, setEdges, onEdgesChange] = useEdgesState<CustomEdgeType>([]);
    const selectedRef = useRef<{
        nodes: ActivityNodeType[];
        edges: CustomEdgeData[];
    }>({ nodes: [], edges: [] });
    const mousePos = useRef<{
        x: number;
        y: number;
    }>({ x: 0, y: 0 });

    const onModelChange = debounce(() => {
        if (onChange) {
            onChange(flowRef.current!.toObject())
        }
    },250);

    return <>
        <ContextMenu>
            <ContextMenuTrigger className='pointer-events-auto hidden' asChild>
                <button ref={contextMenuTriggerRef}></button>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem onClick={(ev) => {
                    ev.stopPropagation();
                    flowRef.current?.addNodes({ id: uuidv4(), type: "activity", data: { type: "pay order" }, position: flowRef.current.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }) })
                }}>Add Node</ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu><ReactFlow className='react-flow w-full h-full border'
            onInit={(i) => {
                i.setNodes(initialFlowJson.nodes);
                i.setEdges(initialFlowJson.edges);
                i.setViewport(initialFlowJson.viewport);
                flowRef.current = i
            }}
            defaultNodes={[] as ActivityNodeType[]}
            nodeTypes={nodeTypes}
            edges={edges}
            onEdgesChange={(change) => {
                onEdgesChange(change);
                onModelChange();
            }}
            edgeTypes={edgeTypes}
            maxZoom={12}
            minZoom={0.3}
            onNodesChange={() => {
                onModelChange();
            }}
            onConnect={onConnect}
            connectionLineType={ConnectionLineType.Straight}
            onContextMenu={(ev) => {
                if (!ev.isDefaultPrevented() && contextMenuTriggerRef.current) {
                    contextMenuTriggerRef.current.dispatchEvent(new MouseEvent("contextmenu", {
                        bubbles: true,
                        clientX: ev.clientX,
                        clientY: ev.clientY,
                    }),);
                }
                ev.preventDefault()
            }}
            onSelectionChange={(sel) => {
                const addedEdges: Set<string> = new Set();
                for (const n of sel.nodes) {
                    for (const n2 of sel.nodes) {
                        flowRef.current?.getEdges().filter(e => e.source === n.id && e.target === n2.id && sel.edges.find(e2 => e2.id === e.id) == null).map(e => e.id).forEach(e => addedEdges.add(e))
                    }
                }
                if (addedEdges.size > 0) {
                    flowRef.current?.setEdges(edges => [...edges].map(e => ({ ...e, selected: e.selected || addedEdges.has(e.id) })))
                }
                selectedRef.current = sel as any;
            }}
            proOptions={{ hideAttribution: true }}
        >
            <Background className='hide-in-image' />
            <Controls className='hide-in-image' />
            <Panel position="top-right" className='flex gap-x-1 hide-in-image'>
                <div>
                    <details className='flex flex-col items-center gap-y-1.5 bg-white border rounded p-0.5 m-0.5 pl-4'>
                        <summary>

                            <Label>
                                Load Save
                            </Label>
                        </summary>

                        <Input type="file" className="max-w-[7rem]" onChange={async (ev) => {
                            if (ev.currentTarget.files && ev.currentTarget.files.length >= 1) {
                                const file = ev.currentTarget.files[0];
                                const jsonText = await file.text();
                                const json = JSON.parse(jsonText);
                                addArcsToFlow(json, flowRef.current!)
                            }

                        }} />
                    </details>
                </div>
                {/* const flow = loadData();
              if (flow && flowRef.current) {
                const { x = 0, y = 0, zoom = 1 } = flow.viewport;
                flowRef.current.setNodes(flow.nodes || []);
                setEdges(flow.edges || []);
                flowRef.current.setViewport({ x, y, zoom });
              }
            }}>Load JSON</Button> */}
                <Button title="Delete all" onClick={() => { flowRef.current?.setNodes([]); flowRef.current?.setEdges([]); }} variant="destructive">Delete all</Button>

                <Button variant="outline" title="Download Image" onClick={(ev) => {
                    const button = ev.currentTarget;
                    button.disabled = true;
                    const scaleFactor = 2.0;
                    const viewPort = document.querySelector(
                        ".outer-flow",
                    ) as HTMLElement;
                    const useSVG = ev.shiftKey;
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {

                            void (useSVG ? toSvg : toBlob)(viewPort, {
                                canvasHeight: viewPort.clientHeight * scaleFactor * 1,
                                canvasWidth: viewPort.clientWidth * scaleFactor * 1,
                                filter: (node) => {
                                    return node.classList === undefined ||
                                        !node.classList.contains("hide-in-image")
                                }
                            }).catch(e => console.error("Failed to get image:", e))
                                .then(async (dataURLOrBlob) => {
                                    let blob = dataURLOrBlob;
                                    if (typeof blob === 'string') {
                                        blob = await (await fetch(blob)).blob()
                                    }
                                    backend["download-blob"](blob as Blob, "oc-DECLARE" + (useSVG ? ".svg" : ".png"))
                                }).finally(() =>
                                    button.disabled = false);
                        })
                    })
                }}><ImageIcon /></Button>
                {/* <Button title="Auto Layout" onClick={() => autoLayout()} variant="outline"><AlignStartVerticalIcon /></Button> */}
                {/* <BackendButton /> */}
            </Panel>
        </ReactFlow>
                <svg width="0" height="0">
            <defs>
              <marker
                className="react-flow__arrowhead"
                id="dot-marker"
                markerWidth="10"
                markerHeight="10"
                viewBox="-20 -20 40 40"
                orient="auto"
                refX="0"
                refY="0"
              >
                <circle cx="0" cy="0" r="10" fill="var(--arrow-primary,black)" />
              </marker>
              <marker
                className="react-flow__arrowhead"
                id="double-arrow-marker"
                markerWidth="10"
                markerHeight="10"
                viewBox="-20 -20 40 40"
                orient="auto"
                refX="17.3"
                refY="10"
              >
                <path d="M-16,0 L4,10 L-16,20 Z" fill="var(--arrow-primary,black)" />
                <path d="M0,0 L20,9.5 L20,10 L20,10.5 L0,20 Z " fill="var(--arrow-primary,black)" />
              </marker>
              <marker
                className="react-flow__arrowhead"
                id="single-arrow-marker"
                markerWidth="10"
                markerHeight="10"
                viewBox="-20 -20 40 40"
                orient="auto"
                refX="16.9"
                refY="10"
              >

                {/* Directly: */}
                {/* <path d="M13.5,0 L13.5,20 L16.5,20 L16.5,0 Z " fill="var(--arrow-primary,black)" /> */}
                <path d="M0,0 L20,9.5 L20,10 L20,10.5 L0,20 Z " fill="var(--arrow-primary,black)" />
              </marker>
              <marker
                className="react-flow__arrowhead"
                id="single-arrow-direct-marker"
                markerWidth="10"
                markerHeight="10"
                viewBox="-20 -20 40 40"
                orient="auto"
                refX="16.9"
                refY="10"
              >

                {/* Directly: */}
                <path d="M13.5,0 L13.5,20 L16.5,20 L16.5,0 Z " fill="var(--arrow-primary,black)" />
                <path d="M0,0 L20,9.5 L20,10 L20,10.5 L0,20 Z " fill="var(--arrow-primary,black)" />
              </marker>
              <marker
                className="react-flow__arrowhead"
                id="single-not-arrow-marker"
                markerWidth="10"
                markerHeight="10"
                viewBox="-20 -20 40 40"
                orient="auto"
                refX="16.9"
                refY="10"
              >
                <path d="M-15,0 L-13,20 L-10,20 L-12,0 Z" fill="var(--arrow-primary,black)" />
                <path d="M-10,0 L-8,20 L-5,20 L-7,0 Z" fill="var(--arrow-primary,black)" />
                <path d="M0,0 L20,9.5 L20,10 L20,10.5 L0,20 Z " fill="var(--arrow-primary,black)" />
              </marker>
              <marker
                className="react-flow__arrowhead"
                id="single-not-arrow-direct-marker"
                markerWidth="10"
                markerHeight="10"
                viewBox="-20 -20 40 40"
                orient="auto"
                refX="16.9"
                refY="10"
              >
                <path d="M13.5,0 L13.5,20 L16.5,20 L16.5,0 Z " fill="var(--arrow-primary,black)" />
                <path d="M-15,0 L-13,20 L-10,20 L-12,0 Z" fill="var(--arrow-primary,black)" />
                <path d="M-10,0 L-8,20 L-5,20 L-7,0 Z" fill="var(--arrow-primary,black)" />
                <path d="M0,0 L20,9.5 L20,10 L20,10.5 L0,20 Z " fill="var(--arrow-primary,black)" />
              </marker>
            </defs>
          </svg></>
}