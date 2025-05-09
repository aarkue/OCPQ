import { OcelInfoContext } from "@/App";
import { BackendProviderContext } from "@/BackendProviderContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { LuClipboardCopy } from "react-icons/lu";
import { MdOutlineZoomInMap } from "react-icons/md";
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
  initialGrapOptions?: { type?: "event" | "object"; id?: string };
}) {
  const ocelInfo = useContext(OcelInfoContext);
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    links: [],
  });
  const backend = useContext(BackendProviderContext);

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
  if (ocelInfo === undefined) {
    return <div>No Info!</div>;
  }
  return (
    <div className="text-lg text-left w-full h-full flex flex-col">
      <h2 className="text-4xl font-semibold my-4">OCEL Graph</h2>
      <GraphOptions
        initialGrapOptions={initialGrapOptions}
        setGraphData={(gd) => {
          console.log(graphRef.current?.d3Force);
          graphRef.current!.d3Force("link")!.distance(10);

          if (gd === undefined) {
            setGraphData({ nodes: [], links: [] });
          } else {
            setGraphData(gd);
          }
        }}
      />
      <div className="border w-full h-full my-4 overflow-hidden relative">
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
              const url = canvas.toBlob((blob) => {
                if (blob !== null) {
                  backend["download-blob"](blob, "force-graph.png");
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
                nodeAutoColorBy={"type"}
                linkColor={() => "#d6d6d6"}
                backgroundColor="white"
                linkWidth={(link) => (highlightLinks.has(link) ? 5 : 2)}
                linkDirectionalParticleColor={() => "#556166"}
                linkDirectionalParticles={4}
                linkDirectionalParticleWidth={(link) =>
                  highlightLinks.has(link) ? 4 : 0
                }
                onNodeHover={handleNodeHover}
                onLinkHover={handleLinkHover}
                linkLabel={(x) =>
                  `<div style="color: #3f3f3f; font-weight: 500; font-size: 12pt; background: #fef4f4b5; padding: 4px; border-radius: 8px;display: block; text-align: center;width: fit-content; white-space:nowrap; font-style: italic">${x.qualifier}</div>`
                }
                nodeLabel={(x) =>
                  `<div style="color: #3f3f3f; font-weight: bold; font-size: 12pt; background: #fef4f4b5; padding: 4px; border-radius: 8px;display: block; text-align: center;width: fit-content;white-space:nowrap">${
                    x.id
                  }<br/><span style="font-weight: normal; font-size: 12pt;">${
                    x.type
                  } (${"time" in x ? "Event" : "Object"})</span></div>`
                }
                nodeCanvasObject={(node, ctx) => {
                  if (node.x === undefined || node.y === undefined) {
                    return;
                  }
                  const isFirstNode = node.id === graphData?.nodes[0].id;
                  let width = 4;
                  let height = 4;
                  const fillStyle = isFirstNode
                    ? node.color
                    : node.color + "a4";
                  ctx.lineWidth = isFirstNode ? 0.4 : 0.2;
                  ctx.strokeStyle = highlightNodes.has(node)
                    ? "black"
                    : isFirstNode
                    ? "#515151"
                    : node.color;
                  if ("time" in node) {
                    width = 7;
                    height = 7;
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
                  let fontSize = 1;
                  ctx.font = `${fontSize}px Sans-Serif`;
                  const label = node.id;
                  const maxLength = 13;
                  const text =
                    label.length > maxLength
                      ? label.substring(0, maxLength - 3) + "..."
                      : label;
                  ctx.fillStyle = "black";

                  ctx.textAlign = "center";
                  ctx.textBaseline = "bottom";
                  ctx.fillText(text, node.x, node.y);
                  fontSize = 0.8;
                  ctx.font = `${fontSize}px Sans-Serif`;
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
                onNodeClick={async (node) => {
                  await navigator.clipboard.writeText(node.id);
                  toast("Copied ID to clipboard!", {
                    icon: <LuClipboardCopy />,
                  });
                }}
              />
            )}
          </AutoSizer>
        )}
      </div>
    </div>
  );
}

function GraphOptions({
  setGraphData,
  initialGrapOptions,
}: {
  setGraphData: (data: GraphData | undefined) => unknown;
  initialGrapOptions?: { type?: "event" | "object"; id?: string };
}) {
  const ocelInfo = useContext(OcelInfoContext)!;
  const backend = useContext(BackendProviderContext);
  const [options, setOptions] = useState<OCELGraphOptions>({
    maxDistance: 2,
    relsSizeIgnoreThreshold: 10,
    rootIsObject: initialGrapOptions?.type !== "event",
    root: initialGrapOptions?.id ?? ocelInfo.object_ids[0],
    spanningTree: false,
  });

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
    <div>
      <div className="flex flex-col gap-y-2 mb-4">
        <div className="flex gap-x-1 items-center">
          <Label className="w-[12ch]">Root ID</Label>
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
            placeholder="Root Object/Event ID"
            type="text"
            value={options.root}
            onChange={(ev) =>
              setOptions({ ...options, root: ev.currentTarget.value })
            }
          />
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
          <Label className="w-[12ch]">Max Distance</Label>
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
          <Label className="w-[12ch]">Maximum Neighbors</Label>
          <Input
            type="number"
            placeholder="Max. Distance"
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
        <div className="flex gap-x-1 items-center">
          <Label className="w-[12ch]">Spanning Tree</Label>
          <Checkbox
            checked={options.spanningTree}
            onCheckedChange={(checked) =>
              setOptions({ ...options, spanningTree: Boolean(checked) })
            }
          />
        </div>
      </div>
      <Button
        size="lg"
        disabled={loading}
        onClick={() => {
          setLoading(true);
          void toast
            .promise(backend["ocel/graph"](options), {
              loading: "Loading graph...",
              success: "Graph loaded!",
              error: "Failed to load Graph",
            })
            .then((gd) => {
              if (gd != null) {
                setGraphData(gd);
              } else {
                setGraphData(undefined);
              }
            })
            .catch(() => {
              setGraphData(undefined);
            })
            .finally(() => setLoading(false));
        }}
      >
        Apply
      </Button>
    </div>
  );
}
