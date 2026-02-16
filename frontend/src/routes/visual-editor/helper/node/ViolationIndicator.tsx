import { CheckCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import clsx from "clsx";
import { useContext } from "react";
import type { EvaluationRes } from "../types";
import { VisualEditorContext } from "../VisualEditorContext";
import { getViolationTextColor } from "../violation-styles";

export default function ViolationIndicator({
	violationsPerNode,
	hasNoConstraints,
	nodeID,
}: {
	violationsPerNode: EvaluationRes;
	hasNoConstraints?: boolean;
	nodeID: string;
}) {
	const { showViolationsFor } = useContext(VisualEditorContext);
	return (
		<button
			type="button"
			onClick={() => {
				if (violationsPerNode !== undefined && showViolationsFor !== undefined) {
					showViolationsFor(nodeID, "violations");
				}
			}}
			className={
				"absolute right-1 bottom-1 text-xs flex flex-col items-center gap-x-1 border border-transparent px-1 py-0.5 rounded-sm hover:bg-blue-100/70 hover:border-blue-400/50"
			}
			title={`Found ${violationsPerNode.situationViolatedCount} Violations of ${violationsPerNode.situationCount} Situations`}
		>
			{violationsPerNode.situationViolatedCount > 0 && (
				<ExclamationTriangleIcon
					className={clsx("h-4 mt-1", getViolationTextColor(violationsPerNode, hasNoConstraints))}
				/>
			)}
			{violationsPerNode.situationViolatedCount === 0 && (
				<CheckCircledIcon
					className={clsx("h-4", getViolationTextColor(violationsPerNode, hasNoConstraints))}
				/>
			)}
			<div className="flex flex-col items-center justify-center">
				<div className="leading-none font-semibold">
					{Math.round(
						100 *
							100 *
							(violationsPerNode.situationViolatedCount / violationsPerNode.situationCount),
					) / 100.0}
					%
				</div>
				<span className="text-muted-foreground font-semibold text-xs">
					{violationsPerNode.situationViolatedCount}
				</span>
			</div>
		</button>
	);
}
