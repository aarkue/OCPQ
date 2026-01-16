import { BackendProviderContext } from "@/BackendProviderContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { OcelInfoContext } from "@/lib/ocel-info-context";
import type { OCELGraphOptions } from "@/types/generated/OCELGraphOptions";
import type { OCELEvent, OCELObject } from "@/types/ocel";
import { ImageIcon } from "@radix-ui/react-icons";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import toast from "react-hot-toast";
import { LuClipboardCopy, LuUndo2 } from "react-icons/lu";
import { MdOutlineZoomInMap } from "react-icons/md";
import { PiInfoBold } from "react-icons/pi";
import { TbFocusCentered } from "react-icons/tb";

import AutoSizer from "react-virtualized-auto-sizer";

type GraphNode = (OCELEvent | OCELObject) & {
  neighbors?: GraphNode[];
  links?: GraphLink[];
};
type GraphLink = {
  source: string;
  target: string;
  qualifier: string;
};
type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};
export default function OcelGraphViewer({
  initialGrapOptions,
}: {
  initialGrapOptions?: { type: "event" | "object"; id?: string };
}) {
  const ocelInfo = useContext(OcelInfoContext);
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    links: [],
  });
  const backend = useContext(BackendProviderContext);
  const [options, setOptions] = useState<OCELGraphOptions>({
    maxDistance: 2,
    relsSizeIgnoreThreshold: 10,
    rootIsObject: initialGrapOptions?.type !== "event",
    root: initialGrapOptions?.id ?? ocelInfo?.object_ids[0] ?? "",
    spanningTree: false,
  });


  const data = useMemo(() => {
    const gData = graphData;
    if (gData !== undefined) {
      // Create cross-references between the node objects
      gData.links.forEach((link) => {
        const a = gData.nodes.find((n) => n.id === link.source);
        const b = gData.nodes.find((n) => n.id === link.target);
        if (a === undefined || b === undefined) {
          return;
        }
        a.neighbors == null && (a.neighbors = []);
        b.neighbors == null && (b.neighbors = []);
        a.neighbors.push(b);
        b.neighbors.push(a);

        a.links == null && (a.links = []);
        b.links == null && (b.links = []);
        a.links.push(link);
        b.links.push(link);
      });
    }

    return gData;
  }, [graphData]);

  useEffect(() => {
    setTimeout(() => {
      // graphRef.current?.zoomToFit();
      graphRef.current?.zoomToFit(200, 100);
    }, 300);
  }, [data]);

  const [highlightNodes, setHighlightNodes] = useState(new Set());
  const [highlightLinks, setHighlightLinks] = useState(new Set());

  const updateHighlight = () => {
    setHighlightNodes(highlightNodes);
    setHighlightLinks(highlightLinks);
  };

  const handleNodeHover = (node: GraphNode | null) => {
    highlightNodes.clear();
    highlightLinks.clear();
    if (node != null) {
      highlightNodes.add(node);
      if (node.neighbors != null) {
        node.neighbors.forEach((neighbor) => highlightNodes.add(neighbor));
      }

      if (node.links != null) {
        node.links.forEach((link) => highlightLinks.add(link));
      }
    }
    updateHighlight();
  };

  const handleLinkHover = (link: GraphLink | null) => {
    highlightNodes.clear();
    highlightLinks.clear();

    if (link != null) {
      highlightLinks.add(link);
      highlightNodes.add(link.source);
      highlightNodes.add(link.target);
    }

    updateHighlight();
  };

  const graphRef = useRef<
    | ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>>
    | undefined
  >();

  const containerRef = useRef<HTMLDivElement>(null);
  const prevGraphDataRef = useRef<GraphData | undefined>(undefined);
  function undoExpansion() {

    if (prevGraphDataRef.current) {
      toast("Reverted last expansion")
      setGraphData(prevGraphDataRef.current);
      prevGraphDataRef.current = undefined;
    }
  }
  useEffect(() => {
    if (containerRef.current) {
      const listener = (e: KeyboardEvent) => {
        if (e.key == "z" && (e.ctrlKey || e.metaKey)) {
          undoExpansion();
        }
        e.preventDefault();
      }
      containerRef.current.addEventListener("keydown", listener);
      return () => containerRef.current?.removeEventListener("keydown", listener);
    }
  }, [containerRef.current])
  if (ocelInfo === undefined) {
    return <div>No Info!</div>;
  }
  return (
    <div className="text-lg text-left w-full h-full">
      <div className="flex h-full w-full items-start gap-x-1">
        <GraphOptions options={options} setOptions={setOptions} initialGrapOptions={initialGrapOptions}
          setGraphData={(gd) => {
            prevGraphDataRef.current = undefined;
            const link = graphRef.current!.d3Force("link")!;
            const charge =
              graphRef.current!.d3Force("charge")!;

              // link.distance(100);
              // link.strength(0.6);
              charge.strength(-5000);
              // charge.distanceMax(500);
              // charge.distanceMin(10);

            // graphRef.current!.d3Force("link")!.distance(300);

            // graphRef.current!.d3Force('charge')!.strength(-1);
            // graphRef.current!.d3Force('charge')!.distanceMax(1010);
            // graphRef.current!.d3Force('charge')!.distanceMin(110);

            console.log(graphRef.current!.d3Force);

            if (gd === undefined) {
              setGraphData({ nodes: [], links: [] });
            } else {
              setGraphData(gd);
            }
          }}
        />
        <div className="border-2 border-dashed w-full h-full overflow-hidden relative" ref={containerRef} tabIndex={-1}>
          <Button disabled={prevGraphDataRef.current === undefined}
            title="Undo last expansion"
            size="icon"
            variant="outline"
            className="absolute top-1 right-1 z-10 -translate-x-[300%] mr-6"
            onClick={() => {
              undoExpansion();
            }}
          >
            <LuUndo2 size={24} />
          </Button>
          <Button
            title="Center Root Node"
            size="icon"
            variant="outline"
            className="absolute top-1 right-1 z-10 -translate-x-[200%] mr-4"
            onClick={() => {
              console.log(data.nodes[0]);
              if (data.nodes[0] !== undefined) {
                const { x, y } = data.nodes[0] as unknown as {
                  x: number | undefined;
                  y: number | undefined;
                };
                graphRef.current?.centerAt(x, y);
                graphRef.current?.zoom(12, 300);
              }
            }}
          >
            <TbFocusCentered size={24} />
          </Button>
          <Button
            title="Zoom to Fit"
            size="icon"
            variant="outline"
            className="absolute top-1 right-1 z-10 -translate-x-full mr-2"
            onClick={() => {
              graphRef.current?.zoomToFit(200);
            }}
          >
            <MdOutlineZoomInMap size={24} />
          </Button>
          <Button
            title="Download Graph as PNG Image"
            size="icon"
            variant="outline"
            className="absolute top-1 right-1 z-10"
            onClick={(ev) => {
              const canvas =
                ev.currentTarget.parentElement?.querySelector("canvas");
              if (canvas != null) {
                canvas.toBlob((blob) => {
                  if (blob !== null) {
                    backend["download-blob"](blob, "ocel-graph.png");
                  }
                }, "image/png");
              }
            }}
          >
            <ImageIcon width={24} height={24} />
          </Button>
          {data !== undefined && (
            <AutoSizer>
              {({ height, width }) => (
                <ForceGraph2D
                  ref={graphRef}
                  graphData={data}
                  width={width}
                  height={height}
                  // d3AlphaMin={0.01}
                  // d3AlphaDecay={0.025}
                  warmupTicks={5}
                  // cooldownTicks={100}
                  nodeAutoColorBy={"type"}
                  linkColor={() => "#d6d6d6"}
                  backgroundColor="white"
                  linkWidth={(link) => (highlightLinks.has(link) ? 4 : 3)}
                  linkDirectionalParticleColor={() => "#556166"}
                  linkDirectionalParticles={4}
                  linkDirectionalParticleWidth={(link) =>
                    highlightLinks.has(link) ? 8 : 0
                  }
                  onNodeHover={handleNodeHover}
                  onLinkHover={handleLinkHover}
                  linkLabel={(x) =>
                    `<div style="color: #3f3f3f; font-weight: 500; font-size: 12pt; background: #fef4f4b5; padding: 4px; border-radius: 8px;display: block; text-align: center;width: fit-content; white-space:nowrap; font-style: italic">${x.qualifier}</div>`
                  }
                  nodeLabel={(x) =>
                    `<div style="color: #3f3f3f; font-weight: bold; font-size: 12pt; background: #fef4f4b5; padding: 4px; border-radius: 8px;display: block; text-align: center;width: fit-content;white-space:nowrap">${x.id
                    }<br/><span style="font-weight: normal; font-size: 12pt;">${x.type
                    } (${"time" in x ? "Event" : "Object"})</span></div>`
                  }
                  nodeCanvasObject={(node, ctx) => {

                    if (node.x === undefined || node.y === undefined) {
                      return;
                    }
                    const isFirstNode = node.id === graphData?.nodes[0].id;
                    let width = 40;
                    let height = 40;
                    const fillStyle = isFirstNode
                      ? node.color
                      : node.color + "74";
                    ctx.lineWidth = 10 * (isFirstNode ? 0.4 : 0.2);
                    ctx.strokeStyle = highlightNodes.has(node)
                      ? "black"
                      : isFirstNode
                        ? "#515151"
                        : node.color;
                    if ("time" in node) {
                      width = 70;
                      height = 70;
                      ctx.beginPath();
                      ctx.fillStyle = "white";
                      ctx.roundRect(
                        node.x - width / 2,
                        node.y - height / 2,
                        width,
                        height,
                        0.2,
                      );
                      ctx.fill();
                      ctx.fillStyle = fillStyle;
                      ctx.roundRect(
                        node.x - width / 2,
                        node.y - height / 2,
                        width,
                        height,
                        0.2,
                      );
                      ctx.fill();
                      ctx.stroke();
                      node.__bckgDimensions = [width, height]; // save for nodePointerAreaPaint
                    } else {
                      ctx.beginPath();
                      ctx.fillStyle = "white";
                      ctx.arc(node.x, node.y, width, 0, 2 * Math.PI, false);
                      ctx.fill();
                      ctx.fillStyle = fillStyle;
                      ctx.arc(node.x, node.y, width, 0, 2 * Math.PI, false);
                      ctx.fill();
                      ctx.stroke();
                      node.__bckgDimensions = [2 * width, 2 * height]; // save for nodePointerAreaPaint
                    }

                    // Web browser used in Tauri under Linux butchers this text terribly >:(
                    // Maybe because of the very small font size?

                    // if ((window as any).__TAURI__ === undefined) {
                    let fontSize = 10;
                    ctx.font = `${fontSize}px Inter`;
                    const label = node.id;
                    const maxLength = 12;
                    const text =
                      label.length > maxLength
                        ? label.substring(0, maxLength - 3) + "..."
                        : label;
                    ctx.fillStyle = "black";

                    ctx.textAlign = "center";
                    ctx.textBaseline = "bottom";
                    ctx.fontKerning = "none";
                    ctx.fillText(text, node.x, node.y);
                    fontSize = 8;
                    ctx.font = `${fontSize}px Inter, system-ui, Avenir, Helvetica, Arial, sans-serif`;
                    ctx.fillStyle = "#3f3f3f";
                    const typeText =
                      node.type.length > maxLength
                        ? node.type.substring(0, maxLength - 3) + "..."
                        : node.type;
                    ctx.fillText(typeText, node.x, node.y + 1.5 * fontSize);
                    // }
                  }}
                  nodePointerAreaPaint={(node, color, ctx) => {
                    if (node.x === undefined || node.y === undefined) {
                      return;
                    }
                    ctx.fillStyle = color;
                    const bckgDimensions: [number, number] =
                      node.__bckgDimensions;
                    Boolean(bckgDimensions) &&
                      ctx.fillRect(
                        node.x - bckgDimensions[0] / 2,
                        node.y - bckgDimensions[1] / 2,
                        ...bckgDimensions,
                      );
                  }}
                  onNodeRightClick={async (node) => {
                    await navigator.clipboard.writeText(node.id);
                    toast("Copied ID to clipboard!", {
                      icon: <LuClipboardCopy />,
                    });
                  }}
                  onNodeClick={async (node) => {
                    // Expand graph
                    prevGraphDataRef.current = graphData;
                    void toast
                      .promise(backend["ocel/graph"]({ root: node.id, rootIsObject: !("time" in node), maxDistance: 1, relsSizeIgnoreThreshold: 100, spanningTree: false }), {
                        loading: `Expanding graph for ${node.id}...`,
                        success: `Graph expanded for ${node.id}!`,
                        error: "Failed to expand Graph",
                      })
                      .then((gd) => {
                        if (gd != null) {
                          setGraphData((prevGD) => {
                            if (gd.nodes.length > 500) {
                              gd.nodes.splice(500);
                              const nodeSet = new Set(gd.nodes.map(n => n.id));
                              gd.links = gd.links.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));
                              toast("Graph got too large!\nOnly rendering a subset.");
                            }
                            const nodes = [...prevGD.nodes];
                            for (const node of gd.nodes) {
                              if (prevGD.nodes.find(n => n.id === node.id && n.type === node.type) === undefined) {
                                nodes.push(node);
                              }
                            }
                            const links = [...prevGD.links];
                            for (const link of gd.links) {
                              if (prevGD.links.find(l => l.source === link.source && l.target === link.target && l.qualifier === link.qualifier) === undefined) {
                                links.push(link);
                              }
                            }
                            return { links: links, nodes: nodes };
                          });
                        }
                      })
                  }}
                />
              )}
            </AutoSizer>
          )}
        </div>
      </div>
    </div>
  );
}
function GraphOptions({
  setGraphData,
  options,
  setOptions,
  initialGrapOptions,
}: {
  setGraphData: (data: GraphData | undefined) => unknown;
  initialGrapOptions?: { type?: "event" | "object"; id?: string };
  options: OCELGraphOptions,
  setOptions: (newVal: OCELGraphOptions) => unknown;
}) {
  const ocelInfo = useContext(OcelInfoContext)!;
  const backend = useContext(BackendProviderContext);

  function applyGraph(graphOptions = options) {
    setLoading(true);
    void toast
      .promise(backend["ocel/graph"](graphOptions), {
        loading: "Loading graph...",
        success: "Graph loaded!",
        error: "Failed to load Graph",
      })
      .then((gd) => {
        if (gd != null) {
          if (gd.nodes.length > 500) {
            gd.nodes.splice(500);
            const nodeSet = new Set(gd.nodes.map(n => n.id));
            gd.links = gd.links.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));
            toast("Graph got too large!\nOnly rendering a subset.");
          }
          setGraphData(gd);
        } else {
          setGraphData(undefined);
        }
      })
      .catch(() => {
        setGraphData(undefined);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (initialGrapOptions?.id && initialGrapOptions?.type) {
      console.log("Graph got", JSON.stringify(initialGrapOptions), JSON.stringify(options))
      applyGraph({ ...options, root: initialGrapOptions.id, rootIsObject: initialGrapOptions.type !== "event" });
    }
  }, [initialGrapOptions?.id, initialGrapOptions?.type])
  useEffect(() => {
    if (
      initialGrapOptions?.id !== undefined &&
      initialGrapOptions?.type !== undefined
    ) {
      setOptions({
        ...options,
        rootIsObject: initialGrapOptions?.type !== "event",
        root: initialGrapOptions?.id,
      });
    }
  }, [initialGrapOptions]);
  const [loading, setLoading] = useState(false);
  return (
    <div className="max-h-full overflow-y-auto px-2">
      <div className="h-fit">
        <h3 className="mb-1 font-black"> Relationship Graph </h3>
        <div className="flex flex-col gap-y-1 mb-4">
          <div className="flex gap-x-1 items-center">
            <Label className="w-[9ch] cursor-help" title="Entity type (i.e., Object/Event) of the Object/Event to query">Root Type</Label>
            <ToggleGroup
              type="single"
              value={options.rootIsObject ? "object" : "event"}
              onValueChange={(val: string) => {
                setOptions({ ...options, rootIsObject: val === "object" });
              }}
            >
              <ToggleGroupItem value="object">Object</ToggleGroupItem>
              <ToggleGroupItem value="event">Event</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex gap-x-1 items-center">
            <Label className="w-[12ch] cursor-help" title="ID of the Object/Event to query">Root ID</Label>
            <datalist id="object-ids">
              {ocelInfo.object_ids.slice(0, 100).map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            <datalist id="event-ids">
              {ocelInfo.event_ids.slice(0, 100).map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            <Input
              list={options.rootIsObject ? "object-ids" : "event-ids"}
              className="max-w-[24ch]"

              onKeyDown={(ev) => {
                if (ev.key === "Enter") {

                  applyGraph()
                }
              }
              }
              placeholder="Root Object/Event ID"
              type="text"
              value={options.root}
              onChange={(ev) =>
                setOptions({ ...options, root: ev.currentTarget.value })
              }
            />
          </div>
          <div className="flex gap-x-1 items-center">
            <Label className="w-[12ch] cursor-help" title="Maximum distance (i.e., number of hops along E2O/O2O relationship edges) to view">Max. Distance</Label>
            <Input
              type="number"
              placeholder="Max. Distance"
              className="max-w-[24ch]"
              value={options.maxDistance}
              onChange={(ev) =>
                setOptions({
                  ...options,
                  maxDistance: ev.currentTarget.valueAsNumber,
                })
              }
            />
          </div>
          <div className="flex gap-x-1 items-center">
            <Label className="w-[12ch] cursor-help" title="Maximum number of neighbors (i.e., entities involved through E2O/O2O) to recursively expand. This option prevents polluting the graph with too many nodes.">Max. Neighbors</Label>
            <Input
              type="number"
              placeholder="Max. Expansion"
              className="max-w-[24ch]"
              value={options.relsSizeIgnoreThreshold}
              onChange={(ev) =>
                setOptions({
                  ...options,
                  relsSizeIgnoreThreshold: ev.currentTarget.valueAsNumber,
                })
              }
            />
          </div>
          <Button
            size="lg"
            disabled={loading}
            onClick={() => applyGraph()}
          >
            Apply
          </Button>
        </div>
        <p className="text-xs mt-2 border border-blue-200 px-2 py-1 rounded-sm bg-blue-50/80 text-wrap max-w-sm">
          <span className="font-bold inline-flex items-center gap-x-1 text-sm"><PiInfoBold className="inline text-blue-600" size={18} /> Legend & Hints</span><br />
          Events are shown as as squares and objects as circles in the graph.
          Hovering over an edge between two nodes reveals the direction of the relation as well as the qualifier.
          <br />
          Click on an node to expand its relations.
          Right-click a node to copy its ID to the clipboard.
        </p>
      </div>
    </div>
  );
}
