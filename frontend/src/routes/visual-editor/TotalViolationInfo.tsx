import type { Edge, Node, ReactFlowJsonObject } from "@xyflow/react";
import clsx from "clsx";
import { PiPlayFill } from "react-icons/pi";
import type {
	EvaluationResPerNodes,
	EventTypeLinkData,
	EventTypeNodeData,
	GateNodeData,
} from "./helper/types";
import { getViolationStyles, getViolationTextColor } from "./helper/violation-styles";

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
	const percentage = (100 * situationViolatedCount) / situationCount;

	return (
		<div
			className={clsx(
				"rounded w-full h-14 overflow-hidden",
				Number.isNaN(percentage) && "text-gray-700",
				!Number.isNaN(percentage) && "font-bold border-2",
				!Number.isNaN(percentage) && getViolationStyles({ situationViolatedCount, situationCount }),
				!Number.isNaN(percentage) &&
					getViolationTextColor({ situationViolatedCount, situationCount }),
			)}
		>
			{!Number.isNaN(percentage) && <>{Math.round(100 * percentage) / 100}% ⌀ Violations </>}
			{Number.isNaN(percentage) && <span className="text-sm">No evaluation result available</span>}
			<br />
			{!Number.isNaN(percentage) && (
				<>
					({situationViolatedCount} of {situationCount})
				</>
			)}
			{Number.isNaN(percentage) && (
				<div className="inline-flex items-center gap-x-1 text-xs">
					Evaluate using the <PiPlayFill className="text-purple-600" /> button below
				</div>
			)}
		</div>
	);
}
