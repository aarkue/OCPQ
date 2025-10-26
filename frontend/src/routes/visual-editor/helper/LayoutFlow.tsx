import ELK, {
  type LayoutOptions,
  type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import { useCallback } from "react";
import { type Edge, useReactFlow, type Node } from "@xyflow/react";
import type { EventTypeLinkData, EventTypeNodeData, GateNodeData } from "./types";
const elk = new ELK();
// void (async () => {
//   console.log(
//     await elk.knownLayoutAlgorithms(),
//     await elk.knownLayoutCategories(),
//     await elk.knownLayoutOptions(),
//   );
// })();

const defaultOptions = {
  "elk.layered.spacing.nodeNodeBetweenLayers": "100",
  "elk.direction": "DOWN",

  "elk.algorithm": "mrtree",
  "elk.spacing.nodeNode": "100",
};

export const useLayoutedElements = () => {
  const { getNodes, setNodes, getEdges, fitView } = useReactFlow<Node<EventTypeNodeData | GateNodeData>,Edge<EventTypeLinkData>>();

  const getLayoutedElements = useCallback(
    (options: any, fitViewAfter: boolean = true) => {
      const nodes: Node<EventTypeNodeData | GateNodeData>[] = [...getNodes()];
      const edges = getEdges();
      void applyLayoutToNodes(nodes, edges, options).then(() => {
        setNodes(nodes);
        if (fitViewAfter) {
          setTimeout(() => {
            fitView();
          }, 50);
        }
      });
    },
    [],
  );

  return { getLayoutedElements };
};

// Apply layout in place
export async function applyLayoutToNodes(
  nodes: Node<EventTypeNodeData | GateNodeData>[],
  edges: Edge<any>[],
  options: Partial<LayoutOptions> = {},
) {
  const layoutOptions = { ...defaultOptions, ...options };
  const graph = {
    id: "root",
    layoutOptions,
    children: nodes.map((n) => {
      const targetPorts = [
        { id: n.id + "-target", properties: { side: "NORTH" } },
      ];

      const sourcePorts =
        "box" in n.data || ("type" in n.data && n.data.type === "not")
          ? [{ id: n.id + "-source", properties: { side: "SOUTH" } }]
          : [
              { id: n.id + "-left-source", properties: { side: "WEST" } },
              { id: n.id + "-right-source", properties: { side: "EAST" } },
            ];
      return {
        id: n.id,
        width: n.width ?? ("box" in n.data ? 240 : 128),
        height: n.height ?? ("box" in n.data ? 180 : 80),
        properties: { "org.eclipse.elk.portConstraints": "FIXED_SIDE" },
        //  also pass plain id to handle edges without a sourceHandle or targetHandle
        ports: [
          { id: n.id, properties: { side: "EAST" } },
          ...targetPorts,
          ...sourcePorts,
        ],
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.sourceHandle ?? e.source],
      targets: [e.targetHandle ?? e.target],
    })),
  };
  await elk.layout(graph).then(({ children }: ElkNode) => {
    if (children !== undefined) {
      children.forEach((node) => {
        const n = nodes.find((n) => n.id === node.id);
        if (n !== undefined) {
          n.position = { x: node.x ?? 0, y: node.y ?? 0 };
        } else {
          console.warn("[Layout] Node not found: " + node.id);
        }
      });
    }
  });
}
