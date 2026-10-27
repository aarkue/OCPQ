import type { GraphRequest, Layout, VizTransport } from "@r4pm/components";
import type { Edge, Node } from "@xyflow/react";
import type { EventTypeLinkData, EventTypeNodeData, GateNodeData } from "./types";

const ROW_GAP = 80;
const SIBLING_GAP = 65;

/** A gate's left output goes first. graphlay's tree keeps the order of the edges, so its left
 *  child ends up on the left. */
const handleOrder = (e: Edge) =>
	e.sourceHandle?.endsWith("-left-source") ? 0 : e.sourceHandle?.endsWith("-right-source") ? 2 : 1;

/** Moves `nodes` into a top-down tree, each box or gate centred over its children. The editor
 *  allows no second parent and no loop, so a query is a tree or a forest of them. */
export async function applyLayoutToNodes(
	viz: VizTransport,
	nodes: Node<EventTypeNodeData | GateNodeData>[],
	edges: Edge<EventTypeLinkData>[],
) {
	const index = new Map(nodes.map((n, i) => [n.id, i]));
	const graph: GraphRequest["graph"] = {
		nodes: nodes.map((n) => ({
			size: {
				width: n.measured?.width ?? n.width ?? ("box" in n.data ? 240 : 128),
				height: n.measured?.height ?? n.height ?? ("box" in n.data ? 180 : 80),
			},
		})),
		edges: [...edges]
			.sort((a, b) => handleOrder(a) - handleOrder(b))
			.flatMap((e) => {
				const source = index.get(e.source);
				const target = index.get(e.target);
				return source === undefined || target === undefined || source === target
					? []
					: [{ source, target }];
			}),
	};
	const layout = (await viz.call("layout_tree", {
		request: {
			graph,
			options: { row_gap: ROW_GAP, sibling_gap: SIBLING_GAP, subtree_gap: SIBLING_GAP },
		},
	})) as Layout;
	// graphlay places node centres, React Flow positions are top-left corners.
	layout.nodes.forEach(({ center, size }, i) => {
		nodes[i].position = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
	});
}
