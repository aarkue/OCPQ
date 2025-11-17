import clsx from "clsx";
import type {
  EvaluationResPerNodes,
  EventTypeLinkData,
  EventTypeNodeData,
  GateNodeData,
} from "./helper/types";
import {
  getViolationStyles,
  getViolationTextColor,
} from "./helper/violation-styles";
import { PiPlayFill } from "react-icons/pi";
import type { ReactFlowJsonObject, Node, Edge } from "@xyflow/react";

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
          .filter(
            (n) => flowJSON.edges.find((e) => e.target === n.id) === undefined,
          )
          .map((n) => n.id);
  const [situationViolatedCount, situationCount] = Object.entries(
    violations?.evalRes ?? {},
  )
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
        isNaN(percentage) && "text-gray-700",
        !isNaN(percentage) && "font-bold border-2",
        !isNaN(percentage) &&
          getViolationStyles({ situationViolatedCount, situationCount }),
        !isNaN(percentage) &&
          getViolationTextColor({ situationViolatedCount, situationCount }),
      )}
    >
      {!isNaN(percentage) && (
        <>{Math.round(100 * percentage) / 100}% ⌀ Violations </>
      )}
      {isNaN(percentage) && (
        <span className="text-sm">No evaluation result available</span>
      )}
      <br />
      {!isNaN(percentage) && (
        <>
          ({situationViolatedCount} of {situationCount})
        </>
      )}
      {isNaN(percentage) && (
        <div className="inline-flex items-center gap-x-1 text-xs">
          Evaluate using the <PiPlayFill className="text-purple-600" /> button
          below
        </div>
      )}
    </div>
  );
}
