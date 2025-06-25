import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Panel,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "reactflow";

import { BackendProviderContext } from "@/BackendProviderContext";
import AlertHelper from "@/components/AlertHelper";
import ElementInfoSheet from "@/components/ElementInfoSheet";
import Spinner from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import "@/lib/editor-loader";
import type { BindingBoxTreeNode } from "@/types/generated/BindingBoxTreeNode";
import type { EventVariable } from "@/types/generated/EventVariable";
import type { ObjectVariable } from "@/types/generated/ObjectVariable";
import { ImageIcon } from "@radix-ui/react-icons";
import clsx from "clsx";
import { toBlob, toSvg } from "html-to-image";
import toast from "react-hot-toast";
import {
  LuClipboardCopy,
  LuClipboardPaste,
  LuFileSearch,
  LuLayoutDashboard,
} from "react-icons/lu";
import { PiPlayFill } from "react-icons/pi";
import { RxReset } from "react-icons/rx";
import { TbFileExport, TbLogicAnd, TbPlus, TbSquare } from "react-icons/tb";
import "reactflow/dist/style.css";
import type { EventTypeQualifiers, OCELInfo, OCELType } from "../../types/ocel";
import ViolationDetailsSheet from "./ViolationDetailsSheet";
import { FlowContext } from "./helper/FlowContext";
import { applyLayoutToNodes } from "./helper/LayoutFlow";
import { VisualEditorContext } from "./helper/VisualEditorContext";
import {
  EVENT_TYPE_LINK_TYPE,
  EVENT_TYPE_NODE_TYPE,
  GATE_NODE_TYPE,
  NODE_TYPE_SIZE,
  edgeTypes,
  nodeTypes,
} from "./helper/const";
import {
  evaluateConstraints,
  getParentNodeID,
  getParentsNodeIDs,
} from "./helper/evaluation/evaluate-constraints";
import {
  ALL_GATE_TYPES,
  type ConstraintInfo,
  type EvaluationRes,
  type EvaluationResPerNodes,
  type EventTypeLinkData,
  type EventTypeNodeData,
  type GateNodeData,
} from "./helper/types";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { getAvailableChildNamesWithEdges } from "./helper/child-names";

function isEditorElementTarget(el: HTMLElement | EventTarget | null) {
  return (
    el === document.body ||
    (el !== null && "className" in el && el.className?.includes("react-flow"))
  );
}

interface VisualEditorProps {
  ocelInfo: OCELInfo;
  eventTypeQualifiers: EventTypeQualifiers;
  children?: ReactNode;
  constraintInfo: ConstraintInfo;
}

export default function VisualEditor(props: VisualEditorProps) {
  const { setInstance, registerOtherDataGetter, otherData, flushData } =
    useContext(FlowContext);
  const instance = useReactFlow();

  const [violationDetails, setViolationDetails] = useState<{
    id: string;
    initialMode?: "violations" | "situations" | "satisfied-situations";
    node: BindingBoxTreeNode;
  }>();

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
  function showViolationsFor(
    nodeID: string,
    im?: "violations" | "situations" | "satisfied-situations",
  ) {
    if (
      violationInfo.violationsPerNode != null &&
      nodeID in violationInfo.violationsPerNode.evalRes &&
      violationInfo.violationsPerNode.evalNodes != null &&
      nodeID in violationInfo.violationsPerNode.evalNodes
    ) {
      setViolationDetails({
        id: nodeID,
        initialMode: im,
        node: violationInfo.violationsPerNode.evalNodes[nodeID],
      });
    }
  }

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
  }, [
    otherData?.edges,
    otherData?.nodes,
    otherData?.viewport,
    otherData?.violations,
    instance,
  ]);

  const backend = useContext(BackendProviderContext);

  const [isEvaluationLoading, setEvaluationLoading] = useState(false);

  const isValidConnection = useCallback(
    ({ source, sourceHandle, target, targetHandle }: Edge | Connection) => {
      const edges = instance.getEdges();
      if (
        source === null ||
        target === null ||
        sourceHandle === null ||
        targetHandle === null
      ) {
        return false;
      } else {
        const parents = getParentsNodeIDs(source, edges);
        if (source === target || parents.includes(target)) {
          toast.error(
            <>
              <span>
                <b>Invalid connection</b>
                <br />
                Loops are forbidden!
              </span>
            </>,
            {
              position: "bottom-center",
              id: "invalid-connection-toast",
            },
          );
          console.warn("Loop connection attempted!");
          return false;
        }
      }
      return true;
    },
    [instance],
  );

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

  const mousePos = useRef<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });

  const getAvailableVars = useCallback(
    (
      nodeID: string | undefined,
      type: "event" | "object",
    ): (EventVariable | ObjectVariable)[] => {
      if (nodeID === undefined) {
        return [];
      }
      const node = instance.getNode(nodeID) as Node<
        EventTypeNodeData | GateNodeData
      > | null;
      let ret: (EventVariable | ObjectVariable)[] = [];
      if (node == null) {
        console.warn("getAvailableVars for unknown id: " + nodeID, instance);
        return ret;
      }
      if ("box" in node.data) {
        ret = [
          ...Object.keys(
            type === "event"
              ? node.data.box.newEventVars
              : node.data.box.newObjectVars,
          ).map((n) => parseInt(n)),
          ...getAvailableVars(
            getParentNodeID(nodeID, instance.getEdges()),
            type,
          ),
        ];
      } else {
        ret = getAvailableVars(
          getParentNodeID(nodeID, instance.getEdges()),
          type,
        );
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

  const getTypesForVariable = useCallback(
    (
      nodeID: string,
      variable: number,
      type: "event" | "object",
    ): OCELType[] => {
      const edges = instance.getEdges();
      let node = instance.getNode(nodeID) as
        | Node<EventTypeNodeData>
        | undefined;
      while (
        node != null &&
        !(
          variable in
          (type === "event"
            ? node.data.box.newEventVars
            : node.data.box.newObjectVars)
        )
      ) {
        node = instance.getNode(getParentNodeID(node.id, edges) ?? "-");
      }
      if (node != null) {
        if (type === "event") {
          const etypes = node.data.box.newEventVars[variable];
          return props.ocelInfo.event_types.filter((et) =>
            etypes.includes(et.name),
          );
        } else {
          const otypes = node.data.box.newObjectVars[variable];
          return props.ocelInfo.object_types.filter((et) =>
            otypes.includes(et.name),
          );
        }
      }
      return [];
    },
    [instance],
  );

  const getNodeIDByName = useCallback(
    (name: string): string | undefined => {
      const edge = (instance.getEdges() as Edge<EventTypeLinkData>[]).find(
        (e) => e.data?.name === name,
      );
      if (edge !== undefined) {
        return edge.target;
      } else {
        return undefined;
      }
    },
    [instance],
  );

  const autoLayout = useCallback(async () => {
    const origEdges = [...instance.getEdges()];
    const origNodes = [...instance.getNodes()];
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
    instance.setNodes(origNodes);
    if (isSelectionEmpty) {
      instance?.fitView({ duration: 200 });
    }
  }, [instance]);

  function addPastedData(
    nodes: Node<EventTypeNodeData | GateNodeData>[],
    edges: Edge<EventTypeLinkData>[],
  ) {
    const idPrefix = Date.now() + `-p-${Math.floor(Math.random() * 1000)}-`;

    const nodeRect = nodes.length > 0 ? nodes[0].position : { x: 0, y: 0 };
    const { x, y } = instance.screenToFlowPosition(mousePos.current);
    const firstNodeSize =
      NODE_TYPE_SIZE[
        nodes[0].type === EVENT_TYPE_NODE_TYPE
          ? EVENT_TYPE_NODE_TYPE
          : GATE_NODE_TYPE
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
  }

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
          await navigator.clipboard.writeText(
            JSON.stringify(selectedRef.current),
          );
          toast("Copied selection as plain JSON!", {
            icon: <LuClipboardCopy />,
          });
        } catch (e) {
          console.error(e);
        }
      } else if ((ev.ctrlKey || ev.altKey) && ev.key === "a") {
        ev.preventDefault();
        ev.stopPropagation();
        instance.setNodes((nodes) =>
          nodes.map((n) => ({ ...n, selected: true })),
        );
        instance.setEdges((edges) =>
          edges.map((e) => ({ ...e, selected: true })),
        );
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
        const data = JSON.stringify(selectedRef.current);
        ev.clipboardData.setData("application/json+ocpq-flow", data);
      }
      toast("Copied selection!", { icon: <LuClipboardCopy /> });
    }

    // TODO: Decide if we really want cut functionality. Copy + delete is also very easy
    // + currently there is no way to undo
    // async function cutListener(ev: ClipboardEvent) {
    //   if (!isEditorElementTarget(ev.target)) {
    //     return;
    //   }
    //   ev.preventDefault();
    //   if (ev.clipboardData !== null) {
    //     const data = JSON.stringify(selectedRef.current);
    //     ev.clipboardData.setData("application/json+ocpq-flow", data);
    //     const nodeIDSet = new Set(selectedRef.current.nodes.map((n) => n.id));
    //     const edgeIDSet = new Set(selectedRef.current.edges.map((e) => e.id));
    //     instance.setNodes((ns) => ns.filter((n) => !nodeIDSet.has(n.id)));
    //     instance.setEdges((es) =>
    //       es.filter(
    //         (e) =>
    //           !edgeIDSet.has(e.id) &&
    //           !edgeIDSet.has(e.source) &&
    //           !edgeIDSet.has(e.target),
    //       ),
    //     );
    //   }
    //   toast("Cut selection!", { icon: <LuClipboardCopy /> });
    // }

    function pasteListener(ev: ClipboardEvent) {
      if (!isEditorElementTarget(ev.target)) {
        return;
      }
      console.log(ev);
      if (ev.clipboardData != null) {
        // For debugging: Print all clipboard data items
        // [...ev.clipboardData.items].forEach((ci) =>
        //   ci.getAsString((s) => console.log(`- ${ci.type} - ${ci.kind}: ${s}`)),
        // );
        let pastedNodesAndEdges = ev.clipboardData.getData(
          "application/json+ocpq-flow",
        );
        if (pastedNodesAndEdges === "") {
          pastedNodesAndEdges = ev.clipboardData.getData("text/plain");
          // const domParser = new DOMParser();
          // try {
          //   const parsedDom = domParser.parseFromString(
          //     pastedNodesAndEdges,
          //     "text/html",
          //   );
          //   const el = parsedDom.getElementById("ocpq-json");
          //   console.log({ el });
          //   if (el !== null) {
          //     pastedNodesAndEdges = el.getAttribute("data-json");
          //   }
          // } catch (e) {
          //   console.log("Failed to parse JSON in HTML", e);
          // }
        }
        try {
          const { nodes, edges }: typeof selectedRef.current =
            JSON.parse(pastedNodesAndEdges);
          addPastedData(nodes, edges);
          toast("Pasted selection!", { icon: <LuClipboardPaste /> });
        } catch (e) {
          toast("Failed to parse pasted data. Try using Alt+C to copy nodes.");
          console.error("Failed to parse JSON on paste: ", pastedNodesAndEdges);
        }
        ev.preventDefault();
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
  }, [instance]);

  const addNewNode = useCallback(
    (x: number | undefined = undefined, y: number | undefined = undefined) => {
      instance.setNodes((nodes) => {
        const pos =
          x === undefined || y === undefined
            ? instance.screenToFlowPosition({
                x: window.innerWidth / 2,
                y: window.innerHeight / 1.5,
              })
            : { x, y };
        return [
          ...nodes,
          {
            id: Math.random() + "-" + Date.now(),
            type: EVENT_TYPE_NODE_TYPE,
            position: {
              x: pos.x - NODE_TYPE_SIZE[EVENT_TYPE_NODE_TYPE].width / 2,
              y: pos.y - NODE_TYPE_SIZE[EVENT_TYPE_NODE_TYPE].minHeight / 2,
            },
            data: {
              box: {
                newEventVars: {},
                newObjectVars: {},
                filters: [],
                sizeFilters: [],
                constraints: [],
                evVarLabels: {},
                obVarLabels: {},
              },
            } satisfies EventTypeNodeData,
          },
        ];
      });
    },
    [instance],
  );

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

  const COLORS = {
    // https://colordesigner.io/color-scheme-builder?mode=lch#0067A6-FA9805-CE2727-00851D-A90A76-E0F20D-e9488f-0481cc-16cc9d-080999
    object: [
      "#0067A6",
      "#FA9805",
      "#CE2727",
      "#00851D",
      "#A90A76",
      "#E0F20D",
      "#e9488f",
      "#0481cc",
      "#16cc9d",
      "#080999",
    ],
    event: [
      "#01425e",
      "#53077f",
      "#db11c3",
      "#b76b00",
      "#506b01",
      "#aa082b",
      "#006289",
      "#758406",
    ],
  } as const;
  const [elementInfo, setElementInfo] = useState<{
    type: "event" | "object";
    req: { id: string } | { index: number };
  }>();
  return (
    <VisualEditorContext.Provider
      value={{
        ocelInfo: props.ocelInfo,
        violationsPerNode: violationInfo.violationsPerNode,
        showViolationsFor,
        getAvailableVars,
        getAvailableChildNames,
        getTypesForVariable,
        getNodeIDByName,
        filterMode,
        showElementInfo: (elInfo) => {
          setElementInfo(elInfo);
        },
        getVarName: (variable, type) => {
          return {
            name: type.substring(0, 1) + (variable + 1),
            // name: type.substring(0, 2) + "_" + variable,
            color: COLORS[type][variable % COLORS[type].length],
          };
        },
        onNodeDataChange: (id, newData) => {
          instance.setNodes((ns) => {
            // setNodes((ns) => {
            const newNodes = [...ns];
            const changedNodeIndex = newNodes.findIndex((n) => n.id === id);
            if (newData === undefined) {
              newNodes.splice(changedNodeIndex, 1);
              // instance.setEdges((edges) =>
              //   [...edges].filter((e) => e.source !== id && e.target !== id),
              // );
              return newNodes;
            }
            const changedNode = newNodes[changedNodeIndex];
            if (changedNode?.data !== undefined) {
              changedNode.data = {
                ...changedNode.data,
                ...newData,
              };
            } else {
              console.warn("Did not find changed node data");
            }
            return newNodes;
          });
          if (newData === undefined) {
            instance.setEdges((edges) =>
              edges.filter((e) => e.source !== id && e.target !== id),
            );
          }
        },
        onEdgeDataChange: (id, newData) => {
          if (newData !== undefined) {
            instance.setEdges((es) => {
              const newEdges = [...es];
              const changedEdge = newEdges.find((e) => e.id === id);
              if (changedEdge !== undefined) {
                changedEdge.data = { ...changedEdge.data, ...newData };
              } else {
                console.warn("Did not find changed edge data for id: " + id);
              }
              return newEdges;
            });
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
        <ContextMenuTrigger className="pointer-events-auto hidden" asChild>
          <button ref={contextMenuTriggerRef}></button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onClick={(ev) => {
              ev.stopPropagation();
              const { x, y } = instance.screenToFlowPosition({
                x: ev.clientX,
                y: ev.clientY,
              });
              addNewNode(x, y);
            }}
          >
            Add Node
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <ReactFlow
        className="react-flow"
        onInit={(flow) => {
          initialized.current = true;
          if (initialized.current) {
            setInstance(flow);
          }
        }}
        defaultViewport={otherData?.viewport}
        maxZoom={3.5}
        minZoom={0.33}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        defaultNodes={otherData?.nodes ?? []}
        defaultEdges={otherData?.edges ?? []}
        isValidConnection={isValidConnection}
        onContextMenu={(ev) => {
          if (!ev.isDefaultPrevented() && contextMenuTriggerRef.current) {
            contextMenuTriggerRef.current.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                clientX: ev.clientX,
                clientY: ev.clientY,
              }),
            );
          }
          ev.preventDefault();
        }}
        defaultEdgeOptions={{
          type: EVENT_TYPE_LINK_TYPE,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 15,
            height: 12,
            color: "#000000ff",
          },
          style: {
            strokeWidth: 2,
            stroke: "#969696",
          },
        }}
        onEdgeContextMenu={onEdgeContextMenu}
        proOptions={{ hideAttribution: true }}
        onSelectionChange={(sel) => {
          selectedRef.current = sel;
        }}
      >
        <Controls onInteractiveChange={() => {}} />
        <Panel position="top-right" className="flex gap-x-2">
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
              const viewPort = document.querySelector(
                ".react-flow__viewport",
              ) as HTMLElement;
              const useSVG = ev.shiftKey;
              void (useSVG ? toSvg : toBlob)(viewPort, {
                canvasHeight: viewPort.clientHeight * scaleFactor,
                canvasWidth: viewPort.clientWidth * scaleFactor,
                filter: (node) =>
                  node.classList === undefined ||
                  !node.classList.contains("hide-in-image"),
              })
                .then(async (dataURLOrBlob) => {
                  let blob = dataURLOrBlob;
                  if (typeof blob === "string") {
                    blob = await (await fetch(blob)).blob();
                  }
                  if (blob) {
                    backend["download-blob"](
                      blob,
                      `${props.constraintInfo.name}.${useSVG ? "svg" : "png"}`,
                    );
                  }
                })
                .finally(() => {
                  button.disabled = false;
                });
            }}
          >
            <ImageIcon />
          </Button>
          {props.children}
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
                <TbPlus
                  strokeWidth={"3px"}
                  size={12}
                  className="absolute right-1.5 bottom-1.5"
                />
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
                    id: "gate" + Date.now(),
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
                  <p className="mb-2">
                    Please select the type of gate to add below.
                  </p>
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
                  ></Combobox>
                </>
              );
            }}
          />
          <Button
            variant="outline"
            title="Add Node (Alt+N)"
            className="bg-white relative"
            onClick={() => {
              addNewNode();
            }}
          >
            <TbSquare size={16} className="mr-0.5" />
            <TbPlus
              strokeWidth={"3px"}
              size={12}
              className="absolute right-1.5 bottom-1.5"
            />
          </Button>
          <div className="flex flex-col items-center gap-y-1 min-w-[3rem] min-h-[5rem]">
            <label className="flex flex-col text-sm">
              Filter
              <Switch
                checked={filterMode === "shown"}
                onCheckedChange={(checked) => {
                  setFilterMode(checked ? "shown" : "hidden");
                }}
              />
            </label>
          </div>
          <div className="flex flex-col items-center gap-y-1">
            <Button
              disabled={isEvaluationLoading}
              variant="outline"
              title="Evaluate (Hold Shift for Performance Evaluation)"
              className="relative bg-fuchsia-100 disabled:bg-fuchsia-200 border-fuchsia-300 hover:bg-fuchsia-200 hover:border-fuchsia-300"
              onClick={async (ev) => {
                setEvaluationLoading(true);
                const subTrees = evaluateConstraints(
                  instance.getNodes(),
                  instance.getEdges(),
                );
                const evalRes: Record<string, EvaluationRes> = {};
                const evalNodes: Record<string, BindingBoxTreeNode> = {};
                const measurePerformance = ev.shiftKey;
                let objectIDs: string[] = [];
                let eventIDs: string[] = [];
                const nodeIdtoIndex: Record<string, number> = {};
                if (measurePerformance) {
                  toast(
                    "Measuring performance by evaluating constraint 10+1 times. The first 10 execution times in seconds will be saved as a JSON file in your Downloads folder.",
                  );
                }
                await Promise.allSettled(
                  subTrees.map(async ({ tree, nodesOrder }) => {
                    const res = await toast.promise(
                      backend["ocel/check-constraints-box"](
                        tree,
                        measurePerformance,
                      ),
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
                                {res.evaluationResults
                                  .map((r) => r.situationCount)
                                  .join(", ")}
                              </span>
                              <br />
                              Violations per step:
                              <br />
                              <span className="font-mono">
                                {res.evaluationResults
                                  .map((r) => r.situationViolatedCount)
                                  .join(", ")}
                              </span>
                            </span>
                          </span>
                        ),
                        error: "Evaluation failed",
                      },
                    );
                    if (res.bindingsSkipped) {
                      toast.error(
                        (x) => (
                          <>
                            <div className="">
                              <b className="text-red-600">
                                Some bindings were skipped!
                              </b>
                              <br />
                              <p className="text-sm">
                                The query yielded too many results and could not
                                be fully computed.
                                <br />
                                The returned counts and results represent just a
                                small sample.
                                <br />
                              </p>
                              <div className="text-right">
                                <Button
                                  onClick={() => toast.dismiss(x.id)}
                                  variant="destructive"
                                >
                                  Understood
                                </Button>
                              </div>
                            </div>
                          </>
                        ),
                        { duration: Infinity, position: "top-center" },
                      );
                    }
                    res.evaluationResults.forEach((evRes, i) => {
                      evalRes[nodesOrder[i].id] = evRes;
                    });
                    tree.nodes.forEach((node, i) => {
                      evalNodes[nodesOrder[i].id] = node;
                      nodeIdtoIndex[nodesOrder[i].id] = i;
                    });
                    objectIDs = res.objectIds;
                    eventIDs = res.eventIds;
                    setViolationInfo((vi) => ({
                      ...vi,
                      violationsPerNode: {
                        evalRes,
                        objectIds: res.objectIds,
                        eventIds: res.eventIds,
                        evalNodes,
                        nodeIdtoIndex,
                      },
                    }));
                  }),
                ).then(() => {
                  setEvaluationLoading(false);
                  flushData({
                    violations: {
                      evalRes,
                      objectIds: objectIDs,
                      eventIds: eventIDs,
                      evalNodes,
                      nodeIdtoIndex,
                    },
                  });
                });
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
                  const subTrees = evaluateConstraints(
                    instance.getNodes(),
                    instance.getEdges(),
                  );
                  await Promise.allSettled(
                    subTrees.map(async ({ tree, nodesOrder }) => {
                      const type: "JSON" | "XML" | "SQLITE" = cfg.exportFormat;
                      await toast
                        .promise(
                          backend["ocel/export-filter-box"](tree, type),
                          {
                            success: "Exported!",
                            loading: "Exporting...",
                            error: "Failed to export!",
                          },
                        )
                        .then((res) => {
                          // Otherwise, it might be tauri export
                          if (res) {
                            backend["download-blob"](
                              res,
                              `${
                                props.constraintInfo.name
                              }-export.${type.toLowerCase()}`,
                            );
                          }
                        });
                    }),
                  ).then(() => setEvaluationLoading(false));
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
          </div>
        </Panel>
        <Background />
      </ReactFlow>
      {violationDetails !== undefined &&
        violationInfo.violationsPerNode !== undefined && (
          <ViolationDetailsSheet
            initialMode={violationDetails.initialMode}
            nodeID={violationDetails.id}
            reset={() => setViolationDetails(undefined)}
            violationResPerNodes={violationInfo.violationsPerNode}
            node={violationDetails.node}
          />
        )}
      <ElementInfoSheet elInfo={elementInfo} />
      <Button
        className="absolute right-0 bottom-0 m-1"
        size="icon"
        onClick={() => setElementInfo({ type: "object", req: { index: 0 } })}
      >
        <LuFileSearch />
      </Button>
    </VisualEditorContext.Provider>
  );
}
