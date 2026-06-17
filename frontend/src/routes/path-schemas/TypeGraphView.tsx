import {
	Background,
	type Edge,
	type EdgeProps,
	type EdgeTypes,
	Handle,
	type Node,
	type NodeTypes,
	Position,
	ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { PathSchemaStep } from "@/types/generated/PathSchemaStep";
import type { PathTypeGraph } from "@/types/generated/PathTypeGraph";
import type { PathTypeRef } from "@/types/generated/PathTypeRef";
import { type LayoutResult, layoutTypeGraph } from "./elk-layout";
import { blendHexColors, typeColor, typeKey } from "./lib";

const NODE_WIDTH = 150;
const NODE_HEIGHT = 38;
const MAX_LABEL = 20;

const HIDDEN_HANDLE: React.CSSProperties = {
	width: 0,
	height: 0,
	minWidth: 0,
	minHeight: 0,
	border: 0,
	background: "transparent",
};

interface TypeNodeData {
	label: string;
	kind: "event" | "object";
	isSource: boolean;
	isTarget: boolean;
	[key: string]: unknown;
}

function TypeNode({ data }: { data: TypeNodeData }) {
	const isEvent = data.kind === "event";
	const colors = typeColor(data.label, data.kind);
	const truncated =
		data.label.length > MAX_LABEL ? `${data.label.slice(0, MAX_LABEL - 1)}...` : data.label;
	let shadow = "none";
	if (data.isSource) shadow = "0 0 0 7px #10b98180";
	else if (data.isTarget) shadow = "0 0 0 7px #f43f5e80";
	return (
		<div
			title={data.label}
			style={{
				backgroundColor: colors.bg,
				border: `2.5px solid ${colors.border}`,
				borderRadius: isEvent ? "2px" : "10px",
				padding: "6px 12px",
				minHeight: `${NODE_HEIGHT}px`,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
				fontSize: "11.5px",
				fontWeight: 600,
				color: colors.text,
				whiteSpace: "nowrap",
				boxShadow: shadow,
				cursor: "pointer",
			}}
		>
			<Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
			<Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} />
			{truncated}
		</div>
	);
}

const nodeTypes: NodeTypes = { typeNode: TypeNode };

interface TypeEdgeData {
	routedPath?: string;
	label?: string;
	highlightColor?: string;
	isO2O?: boolean;
	hasActiveSchema?: boolean;
	[key: string]: unknown;
}

function TypeEdge({ id, data }: EdgeProps) {
	const d = data as TypeEdgeData | undefined;
	const path = d?.routedPath;
	if (!path) return null;
	const highlightColor = d?.highlightColor;
	const isHighlighted = !!highlightColor;
	const hasActive = d?.hasActiveSchema ?? false;
	let stroke: string;
	let strokeWidth: number;
	let opacity: number;
	if (isHighlighted) {
		stroke = highlightColor as string;
		strokeWidth = 3;
		opacity = 1;
	} else if (hasActive) {
		stroke = "#cbd5e1";
		strokeWidth = 1;
		opacity = 0.35;
	} else {
		stroke = "#94a3b8";
		strokeWidth = 1.4;
		opacity = 1;
	}
	const labelId = `elabel-${id}`;
	return (
		<g opacity={opacity}>
			<defs>
				<marker
					id={`arrow-${id}`}
					markerWidth={isHighlighted ? 12 : 10}
					markerHeight={isHighlighted ? 9 : 7}
					refX={isHighlighted ? 11 : 9}
					refY={isHighlighted ? 4.5 : 3.5}
					orient="auto"
				>
					<path
						d={isHighlighted ? "M0,0.5 L11,4.5 L0,8.5" : "M0,0.5 L9,3.5 L0,6.5"}
						fill="none"
						stroke={stroke}
						strokeWidth={1.2}
						strokeLinejoin="round"
					/>
				</marker>
			</defs>
			<path d={path} fill="none" stroke="transparent" strokeWidth={12} />
			<path
				d={path}
				style={{ fill: "none", stroke, strokeWidth, strokeDasharray: d?.isO2O ? "6 3" : undefined }}
				markerEnd={`url(#arrow-${id})`}
			/>
			{d?.label && (
				<>
					<path id={labelId} d={path} fill="none" stroke="none" />
					<text
						dy={-5}
						fontSize={isHighlighted ? 13 : 9}
						fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
						stroke="white"
						strokeWidth={3}
						paintOrder="stroke"
						fill={highlightColor ?? (hasActive ? "#cbd5e1" : "#64748b")}
						fontWeight={isHighlighted ? 700 : 400}
					>
						<textPath href={`#${labelId}`} startOffset="50%" textAnchor="middle">
							{d.label}
						</textPath>
					</text>
				</>
			)}
		</g>
	);
}

const edgeTypes: EdgeTypes = { typeEdge: TypeEdge };

interface Props {
	typeGraph: PathTypeGraph;
	shownTypes: PathTypeRef[];
	selectedSource: PathTypeRef | null;
	selectedTarget: PathTypeRef | null;
	highlightedSchemas: { source: PathTypeRef; steps: PathSchemaStep[]; color: string }[];
	onNodeClick: (ref: PathTypeRef) => void;
}

export default function TypeGraphView({
	typeGraph,
	shownTypes,
	selectedSource,
	selectedTarget,
	highlightedSchemas,
	onNodeClick,
}: Props) {
	// Nodes are keyed by a composite (kind + name), since event and object type names
	// are not disjoint in OCEL.
	const nodeByKey = useMemo(() => {
		const map = new Map<string, PathTypeRef>();
		for (const n of typeGraph.nodes) map.set(typeKey(n), { name: n.name, is_event: n.is_event });
		return map;
	}, [typeGraph]);

	const sourceKey = selectedSource ? typeKey(selectedSource) : null;
	const targetKey = selectedTarget ? typeKey(selectedTarget) : null;

	// Visible types: shown set, plus anything on a highlighted schema, plus source/target.
	// Only keys present in the current graph are kept, so refs left over from a prior
	// dataset can never fall through to a raw composite-key label.
	const visibleTypes = useMemo(() => {
		const set = new Set<string>();
		const add = (k: string) => {
			if (nodeByKey.has(k)) set.add(k);
		};
		for (const t of shownTypes) add(typeKey(t));
		if (sourceKey) add(sourceKey);
		if (targetKey) add(targetKey);
		for (const { source, steps } of highlightedSchemas) {
			add(typeKey(source));
			for (const s of steps) add(typeKey(s.reverse ? s.source : s.target));
		}
		return set;
	}, [shownTypes, sourceKey, targetKey, highlightedSchemas, nodeByKey]);

	const visibleEdges = useMemo(
		() =>
			typeGraph.edges.filter(
				(e) => visibleTypes.has(typeKey(e.source)) && visibleTypes.has(typeKey(e.target)),
			),
		[typeGraph, visibleTypes],
	);

	const [layout, setLayout] = useState<LayoutResult | null>(null);
	const [layoutDone, setLayoutDone] = useState(false);
	// Key the layout on the visible structure so it reruns only when needed.
	const structureKey = useMemo(
		() =>
			`${[...visibleTypes].sort().join(",")}|${visibleEdges.map((e) => `${typeKey(e.source)}>${typeKey(e.target)}`).join(",")}`,
		[visibleTypes, visibleEdges],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: structureKey captures the visible nodes/edges; reruns only on structural change.
	useEffect(() => {
		if (visibleTypes.size === 0) return;
		setLayoutDone(false);
		const layoutNodes = [...visibleTypes].map((id) => ({
			id,
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
		}));
		const layoutEdges = visibleEdges.map((e, i) => ({
			id: `edge-${i}`,
			source: typeKey(e.source),
			target: typeKey(e.target),
		}));
		let cancelled = false;
		layoutTypeGraph(layoutNodes, layoutEdges).then((res) => {
			if (cancelled) return;
			setLayout(res);
			setLayoutDone(true);
		});
		return () => {
			cancelled = true;
		};
	}, [structureKey]);

	const { rfNodes, rfEdges } = useMemo(() => {
		if (!layout) return { rfNodes: [] as Node[], rfEdges: [] as Edge[] };

		const highlightColors = new Map<string, string[]>();
		const schemaNodeKeys = new Set<string>();
		const hasActive = highlightedSchemas.length > 0;
		for (const { source, steps, color } of highlightedSchemas) {
			schemaNodeKeys.add(typeKey(source));
			for (const s of steps) {
				schemaNodeKeys.add(typeKey(s.reverse ? s.source : s.target));
				// The step carries the real edge endpoints, so the key matches the graph edge.
				const key = `${typeKey(s.source)}|${s.qualifier}|${typeKey(s.target)}`;
				const ex = highlightColors.get(key);
				if (ex) {
					if (!ex.includes(color)) ex.push(color);
				} else {
					highlightColors.set(key, [color]);
				}
			}
		}

		const nodes: Node[] = [...visibleTypes].map((key) => {
			const ref = nodeByKey.get(key);
			const isSource = key === sourceKey;
			const isTarget = key === targetKey;
			const dimmed = hasActive && !schemaNodeKeys.has(key) && !isSource && !isTarget;
			return {
				id: key,
				type: "typeNode",
				position: layout.nodes.get(key) ?? { x: 0, y: 0 },
				data: {
					label: ref?.name ?? key,
					kind: ref?.is_event ? "event" : "object",
					isSource,
					isTarget,
				} satisfies TypeNodeData,
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
				style: { opacity: dimmed ? 0.35 : 1 },
			};
		});

		const edges: Edge[] = visibleEdges.map((e, i) => {
			const edgeId = `edge-${i}`;
			const key = `${typeKey(e.source)}|${e.qualifier}|${typeKey(e.target)}`;
			const colors = highlightColors.get(key);
			return {
				id: edgeId,
				source: typeKey(e.source),
				target: typeKey(e.target),
				type: "typeEdge",
				data: {
					routedPath: layout.edges.get(edgeId)?.path,
					label: e.qualifier,
					highlightColor: colors ? blendHexColors(colors) : undefined,
					isO2O: !e.source.is_event,
					hasActiveSchema: hasActive,
				} satisfies TypeEdgeData,
			};
		});

		return { rfNodes: nodes, rfEdges: edges };
	}, [layout, visibleTypes, visibleEdges, sourceKey, targetKey, highlightedSchemas, nodeByKey]);

	return (
		<ReactFlow
			nodes={rfNodes}
			edges={rfEdges}
			nodeTypes={nodeTypes}
			edgeTypes={edgeTypes}
			onNodeClick={(_e, node) => {
				const ref = nodeByKey.get(node.id);
				if (ref) onNodeClick(ref);
			}}
			fitView={layoutDone}
			fitViewOptions={{ padding: 0.15 }}
			minZoom={0.1}
			maxZoom={3}
			panOnScroll
			selectionOnDrag={false}
			elementsSelectable={false}
			proOptions={{ hideAttribution: true }}
		>
			<Background gap={20} size={0.8} color="rgba(128,128,128,0.12)" />
		</ReactFlow>
	);
}
