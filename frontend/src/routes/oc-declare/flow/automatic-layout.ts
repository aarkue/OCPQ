import ELK, {
    type LayoutOptions,
    type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import { useCallback } from "react";
import { useReactFlow, type Node } from "@xyflow/react";
import { CustomEdgeType } from "./oc-declare-flow-types";
const elk = new ELK();
// void (async () => {
//   console.log(
//     await elk.knownLayoutAlgorithms(),
//     await elk.knownLayoutCategories(),
//     await elk.knownLayoutOptions(),
//   );
// })();

const defaultOptions = {
    // "elk.stress.desiredEdgeLength": "200.0",
    "elk.direction": "RIGHT",
    // "elk.algorithm": "stress",
    "elk.algorithm": "mrtree",
    "elk.spacing.nodeNode": "200",
};

export function useLayoutedElements<N extends Record<string, unknown>>() {
    const { getNodes, setNodes, getEdges, fitView } = useReactFlow<Node<N>, CustomEdgeType>();

    const getLayoutedElements = useCallback(
        (options: any, fitViewAfter: boolean = true) => {
            const nodes: Node<N>[] = [...getNodes()];
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
export async function applyLayoutToNodes<N extends Record<string, unknown>>(
    nodes: Node<N>[],
    edges: CustomEdgeType[],
    options: Partial<LayoutOptions> = {},
) {
    const layoutOptions = { ...defaultOptions, ...options };
    console.log(edges,nodes);
    const graph = {
        id: "root",
        layoutOptions,
        children: nodes.map((n) => {
            // const targetPorts = [
            //   { id: n.id + "-target", properties: { side: "NORTH" } },
            // ];

            // const sourcePorts =
            //   "box" in n.data || ("type" in n.data && n.data.type === "not")
            //     ? [{ id: n.id + "-source", properties: { side: "SOUTH" } }]
            //     : [
            //         { id: n.id + "-left-source", properties: { side: "WEST" } },
            //         { id: n.id + "-right-source", properties: { side: "EAST" } },
            //       ];
            return {
                id: n.id,
                width: n.width ?? 120,
                height: n.height ?? 120,
                properties: {
                },
                layoutOptions: {
                },
                //  also pass plain id to handle edges without a sourceHandle or targetHandle
                //   ports: [
                //     { id: n.id, properties: { side: "EAST" } },
                //     // ...targetPorts,
                //     // ...sourcePorts,
                //   ],
            };
        }),
        edges: edges.map((e) => ({
            id: e.id,
            sources: [e.data?.type.includes("rev") ? (e.targetHandle ?? e.target) : (e.sourceHandle ?? e.source)],
            targets: [e.data?.type.includes("rev") ?  (e.sourceHandle ?? e.source) : (e.targetHandle ?? e.target)],
            properties: {
            },
            layoutOptions: {
                "org.eclipse.elk.stress.desiredEdgeLength": 120+6*((e.data?.objectTypes.all.length ? 10 * e.data?.objectTypes.all.length + 10 : 0) + (e.data?.objectTypes.any.length ? 10 * e.data?.objectTypes.any.length + 10 : 0)
                    + (e.data?.objectTypes.each.length ? 10 * e.data?.objectTypes.each.length + 10 : 0)),
            },
        })),
    };
    await elk.layout(graph as any).then(({ children }: ElkNode) => {
        if (children !== undefined) {
            children.forEach((node: any) => {
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
