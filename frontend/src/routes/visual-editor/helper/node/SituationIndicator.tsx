import clsx from "clsx";
import { useContext } from "react";
import { RiHashtag } from "react-icons/ri";
import type { EvaluationRes } from "../types";
import { VisualEditorContext } from "../VisualEditorContext";

export default function SituationIndicator({
  violationsPerNode,
  nodeID,
}: {
  violationsPerNode: EvaluationRes;
  hasNoConstraints?: boolean;
  nodeID: string;
}) {
  const { showViolationsFor } = useContext(VisualEditorContext);
  return (
    <button
      onClick={() => {
        if (
          violationsPerNode !== undefined &&
          showViolationsFor !== undefined
        ) {
          showViolationsFor(nodeID, "situations");
        }
      }}
      className={`absolute right-1 top-1 text-xs flex flex-col items-center gap-x-1 border border-transparent px-0.5 py-0.5 rounded-sm hover:bg-blue-100/70 hover:border-blue-400/50`}
      title={`${violationsPerNode.situationCount} Total Bindings`}
    >
      <div className={clsx("flex items-center justify-center text-sm")}>
        <RiHashtag
          className={clsx("h-4 mt-px block text-muted-foreground")}
        />
        {violationsPerNode.situationCount}
      </div>
    </button>
  );
}
