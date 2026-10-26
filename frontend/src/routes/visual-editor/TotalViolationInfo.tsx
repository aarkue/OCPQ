import type { Edge, Node, ReactFlowJsonObject } from "@xyflow/react";
import clsx from "clsx";
import type {
	EvaluationResPerNodes,
	EventTypeLinkData,
	EventTypeNodeData,
	GateNodeData,
} from "./helper/types";
import { getViolationStyles } from "./helper/violation-styles";

/** One-line summary of the violations in the root boxes. */
export default function TotalViolationInfo({
	violations,
	flowJSON,
}: {
	violations: EvaluationResPerNodes | undefined;
	flowJSON:
		| ReactFlowJsonObject<Node<EventTypeNodeData | GateNodeData>, Edge<EventTypeLinkData>>
		| undefined;
}) {
	const rootNodes =
		flowJSON === undefined
			? []
			: flowJSON.nodes
					.filter((n) => flowJSON.edges.find((e) => e.target === n.id) === undefined)
					.map((n) => n.id);
	const [situationViolatedCount, situationCount] = Object.entries(violations?.evalRes ?? {})
		.filter(([id, _val]) => rootNodes.includes(id))
		.map(([_id, val]) => val)
		.reduce(
			([violationCount, situationCount], val) => [
				violationCount + val.situationViolatedCount,
				situationCount + val.situationCount,
			],
			[0, 0],
		);
	if (violations === undefined) {
		return <span className="text-xs text-slate-600">Not evaluated yet</span>;
	}
	if (situationCount === 0) {
		return <span className="text-xs text-slate-600">No bindings</span>;
	}
	const percentage = (100 * situationViolatedCount) / situationCount;
	return (
		<span
			className={clsx(
				"inline-flex items-center gap-1 rounded-full border px-2 py-px text-xs text-slate-900",
				getViolationStyles({ situationViolatedCount, situationCount }),
			)}
		>
			<span className="font-semibold">{Math.round(10 * percentage) / 10}% violated</span>
			<span className="tabular-nums text-slate-700">
				({situationViolatedCount} of {situationCount})
			</span>
		</span>
	);
}
