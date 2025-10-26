import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import clsx from "clsx";
import { memo, useContext, useState } from "react";
import { LuTrash } from "react-icons/lu";
import { Handle, Position, type NodeProps, Node } from "@xyflow/react";
import { VisualEditorContext } from "../VisualEditorContext";
import FilterChooser from "../box/FilterChooser";
import LabelFunctionChooser from "../box/LabelFunctionChooser";
import NewVariableChooser from "../box/NewVariablesChooser";
import type { EventTypeNodeData } from "../types";
import { getViolationStyles } from "../violation-styles";
import SituationIndicator from "./SituationIndicator";
import ViolationIndicator from "./ViolationIndicator";
export default memo(EventTypeNode);
function EventTypeNode({ data, id, selected }: NodeProps<Node<EventTypeNodeData>>) {
  const { violationsPerNode, onNodeDataChange } =
    useContext(VisualEditorContext);

  const violations =
    violationsPerNode === undefined || data.hideViolations === true
      ? undefined
      : violationsPerNode.evalRes[id];

  const [deleteAlertOpen, setDeleteAlertOpen] = useState(false);
  return (
    <ContextMenu>
      <ContextMenuTrigger onContextMenu={(ev) => {
        ev.stopPropagation();
      }}>
        <div
          className={clsx(
            "border-2 shadow-lg z-10 flex flex-col py-1 pb-2 px-0.5 rounded-md relative min-h-[5rem] w-[15rem]",
            getViolationStyles(violations, data.box.constraints.length === 0),
            selected && "border-dashed",
          )}
        >
          {violations !== undefined && (
            <SituationIndicator
              violationsPerNode={violations}
              hasNoConstraints={data.box.constraints.length === 0}
              nodeID={id}
            />
          )}
          {violations !== undefined &&
            (violations.situationViolatedCount > 0 ||
              data.box.constraints.length >= 1) && (
              <ViolationIndicator violationsPerNode={violations} nodeID={id} />
            )}
          <div className="text-large font-semibold mx-4 flex flex-col justify-center items-center">
            <NewVariableChooser
              id={id}
              box={data.box}
              updateBox={(box) => onNodeDataChange(id, { box })}
            />
            <FilterChooser
              type="filter"
              id={id}
              box={data.box}
              updateBox={(box) => onNodeDataChange(id, { box })}
            />
            <LabelFunctionChooser
              id={id}
              box={data.box}
              updateBox={(box) => onNodeDataChange(id, { box })}
            />
            <FilterChooser
              type="constraint"
              id={id}
              box={data.box}
              updateBox={(box) => onNodeDataChange(id, { box })}
            />
          </div>
          <div>
            <Handle
              className="!w-3 !h-3"
              position={Position.Top}
              type="target"
              id={id + "-target"}
            />

            <Handle
              className="!w-3 !h-3"
              position={Position.Bottom}
              type="source"
              id={id + "-source"}
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <AlertDialog
        open={deleteAlertOpen}
        onOpenChange={(op) => setDeleteAlertOpen(op)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This node and all contained variables, filters, and constraints
              will be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onNodeDataChange(id, undefined);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ContextMenuPortal>
        <ContextMenuContent>
          <ContextMenuItem>Cancel</ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setTimeout(() => {
                setDeleteAlertOpen(true);
              }, 100);
            }}
            className="font-semibold text-red-400 focus:text-red-500"
          >
            <LuTrash className="mr-1" /> Delete Node
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
