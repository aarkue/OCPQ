import AlertHelper from "@/components/AlertHelper";
import { useContext } from "react";
import { TbTrash } from "react-icons/tb";
import { Handle, Position, type NodeProps } from "reactflow";
import { VisualEditorContext } from "../VisualEditorContext";
import type { GateNodeData } from "../types";
import ViolationIndicator from "./ViolationIndicator";

export default function EventTypeNode({ data, id }: NodeProps<GateNodeData>) {
  const { violationsPerNode, onNodeDataChange } =
    useContext(VisualEditorContext);

  const hideViolations: boolean | undefined = false;
  const violations = hideViolations
    ? undefined
    : violationsPerNode?.evalRes.get(id);

  return (
    <div
      title={data.type}
      className={`border shadow z-10 backdrop-blur flex flex-col items-center justify-center pt-1.5 py-0.5 px-0.5 rounded-md relative min-w-[8rem] min-h-[5rem] font-mono text-4xl font-bold
      ${
        violations !== undefined && violations.situationViolatedCount > 0
          ? "bg-red-200 border-red-300"
          : violations?.situationViolatedCount === undefined
          ? "bg-blue-50 border-blue-100"
          : "bg-green-200 border-green-300"
      }`}
    >
      {violations !== undefined && (
        <ViolationIndicator violationsPerNode={violations} />
      )}
      <div className="">
        {data.type === "not" && "¬"}
        {data.type === "or" && "∨"}
        {data.type === "and" && "∧"}
        <Handle
          className="!w-3 !h-3"
          position={Position.Top}
          type="target"
          id={id + "-target"}
        />
        {data.type === "not" && (
          <>
            <Handle
              className="!w-3 !h-3"
              position={Position.Bottom}
              type="source"
              id={id + "-source"}
            />
          </>
        )}

        {data.type !== "not" && (
          <>
            <Handle
              className="!w-3 !h-3 mt-9"
              position={Position.Left}
              type="source"
              id={id + "-left-source"}
            />
            <Handle
              className="!w-3 !h-3 mt-9"
              position={Position.Right}
              type="source"
              id={id + "-right-source"}
            />
          </>
        )}
      </div>
      <AlertHelper
        trigger={
          <button
            className="absolute -top-3.5 right-1 opacity-10 hover:opacity-100 hover:text-red-500"
            title="Delete node"
          >
            <TbTrash size={12} />
          </button>
        }
        title="Are you sure?"
        initialData={undefined}
        content={() => (
          <>This node and all contained constraints will be deleted.</>
        )}
        submitAction="Delete"
        onSubmit={() => {
          onNodeDataChange(id, undefined);
        }}
      />
    </div>
  );
}
