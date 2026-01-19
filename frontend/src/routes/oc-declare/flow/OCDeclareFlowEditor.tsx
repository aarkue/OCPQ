import { BackendProviderContext } from "@/BackendProviderContext";
import AlertHelper from "@/components/AlertHelper";
import { ClipboardButton } from "@/components/ClipboardButton";
import { DownloadButton } from "@/components/DownloadButton";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isEditorElementTarget } from "@/lib/flow-helper";
import { OcelInfoContext } from "@/lib/ocel-info-context";
import { ImageIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { Background, ConnectionLineType, Controls, Edge, EdgeTypes, NodeTypes, OnConnect, Panel, ReactFlow, ReactFlowInstance, ReactFlowJsonObject, useEdgesState } from "@xyflow/react";
import { toBlob, toSvg } from "html-to-image";
import debounce from "lodash.debounce";
import { useCallback, useContext, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { LuAlignStartVertical, LuClipboardCopy, LuClipboardPaste, LuShare } from "react-icons/lu";
import { RxReset } from "react-icons/rx";
import { v4 as uuidv4, v4 } from 'uuid';
import { OCDeclareArcLabel } from "../types/OCDeclareArcLabel";
import { applyLayoutToNodes, useLayoutedElements } from "./automatic-layout";
import { addArcsToFlow, flowEdgeToOCDECLARE } from "./oc-declare-flow-type-conversions";
import { ActivityNodeType, CustomEdgeData, CustomEdgeType, EdgeType } from "./oc-declare-flow-types";
import OCDeclareFlowEdge from "./OCDeclareFlowEdge";
import { OCDeclareFlowNode } from "./OCDeclareFlowNode";
;

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
  if (edgeType === "as") {
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

export default function OCDeclareFlowEditor({ initialFlowJson, onChange, onInit, name }: { name: string, initialFlowJson?: ReactFlowJsonObject<ActivityNodeType, CustomEdgeType>, onInit?: (ref: ReactFlowInstance<ActivityNodeType, CustomEdgeType>) => unknown, onChange: (json: ReactFlowJsonObject<ActivityNodeType, CustomEdgeType>) => unknown }) {
  const backend = useContext(BackendProviderContext);
  const flowRef = useRef<ReactFlowInstance<ActivityNodeType, CustomEdgeType>>();
  const ocelInfo = useContext(OcelInfoContext);
  const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);

  const onConnect = useCallback<OnConnect>((connection) => {
    const source = flowRef.current!.getNode(connection.source!);
    const target = flowRef.current!.getNode(connection.target!);
    if (source === undefined || target === undefined || source.id === target.id) {
      return false;
    }
    const sourceIsObject = source.data.isObject !== undefined;
    const targetIsObject = target.data.isObject !== undefined;
    const sourceRelatedTypes = (sourceIsObject ? ocelInfo?.o2o_types : ocelInfo?.e2o_types)?.[source.data.type] ?? {};
    const targetRelatedTypes = (targetIsObject ? ocelInfo?.o2o_types : ocelInfo?.e2o_types)?.[target.data.type] ?? {};
    const commonTypes = Object.keys(sourceRelatedTypes).filter(k => targetRelatedTypes[k] !== undefined && targetRelatedTypes[k][0] > 0 && sourceRelatedTypes[k][0] > 0);



    let objectTypes: OCDeclareArcLabel = { all: commonTypes.map(t => ({ type: "Simple", object_type: t })), any: [], each: [] };
    if (source.data.isObject && !target.data.isObject) {
      objectTypes = { "each": [], any: [{ type: "Simple", object_type: source.data.type }], all: [] };
    } else if (target.data.isObject && !source.data.isObject) {
      objectTypes = { "each": [], any: [{ type: "Simple", object_type: target.data.type }], all: [] };
    } else if (target.data.isObject && source.data.isObject) {
      objectTypes = { "each": [], any: [{ type: "O2O", first: source.data.type, second: target.data.type, reversed: false }], all: [] };
    }
    return flowRef.current?.setEdges((edges) => {
      const edgeType: EdgeType = source.data.isObject || target.data.isObject ? "as" : "ef";
      const id = v4();
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
    edges: CustomEdgeType[];
  }>({ nodes: [], edges: [] });
  const mousePos = useRef<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });

  const onModelChange = debounce(() => {
    if (onChange) {
      onChange(flowRef.current!.toObject())
    }
  }, 250, { maxWait: 1000 });


  const autoLayout = useCallback(async () => {
    const origEdges = [...flowRef.current!.getEdges()];
    const origNodes = [...flowRef.current!.getNodes()];
    const isSelectionEmpty =
      selectedRef.current.nodes.length <= 1 &&
      selectedRef.current.edges.length <= 1;
    const nodes = isSelectionEmpty
      ? origNodes
      : origNodes.filter((n) => n.selected);
    const edges = (isSelectionEmpty ? origEdges : origEdges).filter(
      (e) =>
        nodes.find((n) => n.id === e.source) !== undefined &&
        nodes.find((n) => n.id === e.target) !== undefined,
    );
    const { x: beforeX, y: beforeY } =
      nodes.length > 0 ? nodes[0].position : { x: 0, y: 0 };
    await applyLayoutToNodes(nodes, edges);
    if (!isSelectionEmpty) {
      const { x: afterX, y: afterY } =
        nodes.length > 0 ? nodes[0].position : { x: 0, y: 0 };
      const diffX = beforeX - afterX;
      const diffY = beforeY - afterY;
      nodes.forEach((n) => {
        n.position.x += diffX;
        n.position.y += diffY;
      });
    }
    flowRef.current!.setNodes(origNodes);
    if (isSelectionEmpty) {
      setTimeout(() => {
        flowRef.current?.fitView({ duration: 200, padding: 0.2 });
      });
    }
  }, []);

  function createNewNodeAtPosition({ x, y }: { x: number, y: number }, activity: string | null = null, isObject: "init" | "exit" | undefined = undefined) {
    const act = activity || ocelInfo?.event_types?.[0]?.name || "new activity";
    flowRef.current?.addNodes({ id: uuidv4(), type: "activity", data: { type: act, isObject }, position: { x: x - 50, y: y - 25 } })
  }

  useEffect(() => {

    function mouseListener(ev: MouseEvent) {
      mousePos.current = { x: ev.x, y: ev.y };
    }


    async function copyListener(ev: ClipboardEvent) {
      if (!isEditorElementTarget(ev.target)) {
        return;
      }
      ev.preventDefault();
      if (ev.clipboardData !== null) {
        const data = JSON.stringify(selectedRef.current);
        ev.clipboardData.setData("application/json+oc-declare-flow", data);
        ev.clipboardData.setData("text/plain", data);
      }
      toast("Copied selection!", { icon: <LuClipboardCopy /> });
    }

    function addPastedData(
      nodes: ActivityNodeType[],
      edges: CustomEdgeType[],
    ) {
      const idPrefix = uuidv4();
      const instance = flowRef.current!;
      const nodeRect = nodes.length > 0 ? nodes[0].position : { x: 0, y: 0 };
      const { x, y } = instance.screenToFlowPosition(mousePos.current);
      const firstNodeSize = { width: 100, minHeight: 50 };
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
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
              selected: true,
              data: e.data,
              ...getMarkersForEdge(e.data!.type, e.id)
            }))
            .filter(
              (e) =>
                newNodes.find((n) => n.id === e.source) !== undefined &&
                newNodes.find((n) => n.id === e.target) !== undefined,
            ),
        ];
      });
    }

    function pasteListener(ev: ClipboardEvent) {
      if (!isEditorElementTarget(ev.target)) {
        return;
      }
      if (ev.clipboardData != null) {
        let pastedNodesAndEdges = ev.clipboardData.getData(
          "application/json+oc-declare-flow",
        );
        if (pastedNodesAndEdges === "") {
          pastedNodesAndEdges = ev.clipboardData.getData("text/plain");

        }
        try {
          const { nodes, edges }: typeof selectedRef.current =
            JSON.parse(pastedNodesAndEdges);
          addPastedData(nodes, edges);
          toast("Pasted selection!", { icon: <LuClipboardPaste /> });
        } catch (e) {
          try {
            const rustResult = JSON.parse(pastedNodesAndEdges);
            if (typeof rustResult === 'object' && 'length' in rustResult) {

              console.log({ rustResult });
              addArcsToFlow(rustResult, flowRef.current!);
            } else {
              throw new Error("Pasted is not an JSON array");
            }
          }
          catch (e) {

            toast("Failed to parse pasted data. Try using Alt+C to copy nodes.");
            console.error("Failed to parse JSON on paste: ", pastedNodesAndEdges);
          }
        }
        ev.preventDefault();
      }
    }
    async function keyPressListener(ev: KeyboardEvent) {
      if (!isEditorElementTarget(ev.target)) {
        return;
      }
      if (ev.altKey && ev.key === "n") {
        createNewNodeAtPosition(flowRef.current!.screenToFlowPosition(mousePos.current));
      } else if (ev.altKey && ev.key === "l") {
        await autoLayout();
        toast("Applied Auto-Layout");
      } else if (ev.altKey && ev.key === "c") {
        ev.preventDefault();
        try {
          await navigator.clipboard.writeText(
            JSON.stringify(selectedRef.current),
          );
          toast("Copied selection!", {
            icon: <LuClipboardCopy />,
          });
        } catch (e) {
          console.error(e);
        }
      } else if ((ev.ctrlKey || ev.metaKey || ev.altKey) && ev.key === "a") {
        ev.preventDefault();
        ev.stopPropagation();
        flowRef.current!.setNodes((nodes) =>
          nodes.map((n) => ({ ...n, selected: true })),
        );
        flowRef.current!.setEdges((edges) =>
          edges.map((e) => ({ ...e, selected: true })),
        );
        return false;
      }
    }
    document.addEventListener("copy", copyListener);
    // document.addEventListener("cut", cutListener);
    document.addEventListener("paste", pasteListener);
    document.addEventListener("keydown", keyPressListener);
    document.addEventListener("mousemove", mouseListener);
    return () => {
      document.removeEventListener("copy", copyListener);
      // document.removeEventListener("cut", cutListener);
      document.removeEventListener("paste", pasteListener);
      document.removeEventListener("keydown", keyPressListener);
      document.removeEventListener("mousemove", mouseListener);
    };
  }, [flowRef.current])

  return <>
    <ContextMenu>
      <ContextMenuTrigger className="pointer-events-auto hidden " asChild ref={contextMenuTriggerRef}>
        <button></button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            Add Activity
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="overflow-auto max-h-48">
            {ocelInfo?.event_types?.map((et) => <ContextMenuItem key={et.name} onClick={(ev) => {
              ev.stopPropagation();
              // Go up three levels to get the actual context menu position
              // Item -> SubContent -> SubTrigger -> Content
              const rect = ev.currentTarget.parentElement!.parentElement!.parentElement!.getBoundingClientRect()
              createNewNodeAtPosition(flowRef.current!.screenToFlowPosition(rect), et.name)
            }}>{et.name}</ContextMenuItem>)}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            Add Object Init
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="overflow-auto max-h-48">
            {ocelInfo?.object_types?.map((ot) => <ContextMenuItem key={ot.name} onClick={(ev) => {
              ev.stopPropagation();
              // Go up three levels to get the actual context menu position
              // Item -> SubContent -> SubTrigger -> Content
              const rect = ev.currentTarget.parentElement!.parentElement!.parentElement!.getBoundingClientRect()
              createNewNodeAtPosition(flowRef.current!.screenToFlowPosition(rect), ot.name, "init")
            }}>{ot.name}</ContextMenuItem>)}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            Add Object Exit
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="overflow-auto max-h-48">
            {ocelInfo?.object_types?.map((ot) => <ContextMenuItem key={ot.name} onClick={(ev) => {
              ev.stopPropagation();
              // Go up three levels to get the actual context menu position
              // Item -> SubContent -> SubTrigger -> Content
              const rect = ev.currentTarget.parentElement!.parentElement!.parentElement!.getBoundingClientRect()
              createNewNodeAtPosition(flowRef.current!.screenToFlowPosition(rect), ot.name, "exit")
            }}>{ot.name}</ContextMenuItem>)}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
    <div className="outer-flow w-full h-full select-none">
      <ReactFlow className='react-flow'
        onInit={(i) => {
          if (initialFlowJson && "nodes" in initialFlowJson && "edges" in initialFlowJson && "viewport" in initialFlowJson) {
            i.setNodes(initialFlowJson.nodes);
            i.setEdges(initialFlowJson.edges);
            i.setViewport(initialFlowJson.viewport);
          }
          flowRef.current = i
          if (onInit) {
            onInit(i);
          }
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
        minZoom={0.01}
        onNodesChange={onModelChange}
        onViewportChange={onModelChange}
        onConnect={onConnect}
        connectionLineType={ConnectionLineType.Straight}
        onContextMenu={(ev) => {
          if (!ev.isDefaultPrevented() && contextMenuTriggerRef.current) {
            let event =
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: ev.clientX,
                clientY: ev.clientY,
              });
            contextMenuTriggerRef.current.dispatchEvent(event);
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
          <AlertHelper initialData={{ format: "text" as "text" | "json" }}
          trigger={<Button title="Export model" variant="outline" size="icon"><LuShare/></Button>}
          mode="normal" title="Export OC-DECLARE" content={({ data, setData }) => {
            const result = useQuery({
              queryKey: ["export-oc-declare", data.format, edges],
              queryFn: async () => {
                if (data.format === "text") {
                  return await backend["oc-declare/template-string"](flowRef.current!.getEdges().map(e => flowEdgeToOCDECLARE(e, flowRef.current!)));
                } else {
                  return (JSON.stringify(flowRef.current!.getEdges().map(e => flowEdgeToOCDECLARE(e, flowRef.current!)), undefined, 2));
                }
              }
            });
            return <>
              <div className="mb-2">Export the current OC-DECLARE model as JSON or as text representation.</div>
              <div className="flex flex-col gap-y-2">
                <div className="mr-2 flex flex-col  items-start  gap-2">
                  <Label>Format
                  </Label>
                  <ToggleGroup type="single" value={data.format}>
                    <ToggleGroupItem value="text" onClick={() => setData({ ...data, format: "text" })}>Text</ToggleGroupItem>
                    <ToggleGroupItem value="json" onClick={() => setData({ ...data, format: "json" })}>JSON</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <div>
                  <pre className="h-96 w-full overflow-auto rounded-md border p-2 bg-muted"><code>{
                    result.data ? result.data : (result.isLoading ? "Loading..." : (result.isError ? "Error: " + (result.error as Error).message : "Unknown state"))
                  }</code></pre>
                  <div className="flex justify-end">

                  <ClipboardButton value={result.data ?? ""} name="OC-DECLARE Model" hideValueInToast />
                  <DownloadButton value={result.data ?? ""} fileName={`oc-declare.${data.format === "json" ? 'json' : 'txt'}`} />
                  </div>
                </div>
              </div>
            </>
          }} onSubmit={(data) => {

          }} />

          {/* const flow = loadData();
              if (flow && flowRef.current) {
                const { x = 0, y = 0, zoom = 1 } = flow.viewport;
                flowRef.current.setNodes(flow.nodes || []);
                setEdges(flow.edges || []);
                flowRef.current.setViewport({ x, y, zoom });
              }
            }}>Load JSON</Button>         <Button title="Delete all" size="sm" onClick={() => { flowRef.current?.setNodes([]); flowRef.current?.setEdges([]); }} variant="destructive">Delete all</Button>

*/}
          <div className="flex flex-row-reverse items-center gap-x-1">

            <Button onClick={async () => {
              const selectedEdges = flowRef.current!.getEdges().filter(e => e.selected);
              const edges = (selectedEdges.length > 0 ? selectedEdges : flowRef.current!.getEdges());
              const edgeIDs = edges.map(e => e.id);
              const edgesConverted = edges.map(e => flowEdgeToOCDECLARE(e, flowRef.current!));

              const res = await toast.promise(backend['ocel/evaluate-oc-declare-arcs'](edgesConverted), { loading: "Evaluating...", error: "Evaluation Failed", success: "Evaluated!" });
              for (let i = 0; i < edgeIDs.length; i++) {
                flowRef.current?.updateEdgeData(edgeIDs[i], { violationInfo: { violationPercentage: 100 * res[i] } })
              }
            }}>Evaluate</Button>
            {edges.find(e => e.data?.violationInfo) !== undefined && <Button
              size="icon"
              variant="outline"
              title={"Clear evaluation"}
              className=""
              onClick={async () => {
                flowRef!.current?.setEdges((eds) => eds.map(e => ({ ...e, data: { ...e.data!, violationInfo: undefined } })))
              }}
            >
              <RxReset size={16} />
            </Button>}
          </div>
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
                    backend["download-blob"](blob as Blob, name + (useSVG ? ".svg" : ".png"))
                  }).finally(() =>
                    button.disabled = false);
              })
            })
          }}><ImageIcon /></Button>

          <LayoutButton />
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
      </svg></div></>
}


function LayoutButton() {
  const { getLayoutedElements } = useLayoutedElements();
  return <Button title="Auto Layout" onClick={() => {

    getLayoutedElements({}, true)
  }} variant="outline"><LuAlignStartVertical /></Button>
}
