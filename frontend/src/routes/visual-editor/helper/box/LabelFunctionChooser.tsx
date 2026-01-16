import Spinner from "@/components/Spinner";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type BindingBox } from "@/types/generated/BindingBox";
import { type LabelFunction } from "@/types/generated/LabelFunction";
import clsx from "clsx";
import { lazy, Suspense, useContext, useState } from "react";
import { IoPricetagOutline } from "react-icons/io5";
import { LuPlus } from "react-icons/lu";
import { VisualEditorContext } from "../VisualEditorContext";
const CELEditor = lazy(async () => await import("@/components/CELEditor"));

export default function FilterChooser({
  id,
  box,
  updateBox,
}: {
  id: string;
  box: BindingBox;
  updateBox: (box: BindingBox) => unknown;
}) {
  const { getAvailableVars, getAvailableChildNames } =
    useContext(VisualEditorContext);
  const availableObjectVars = getAvailableVars(id, "object");
  const availableEventVars = getAvailableVars(id, "event");
  const availableChildSets = getAvailableChildNames(id);
  const [alertState, setAlertState] = useState<
    { value: LabelFunction } & (
      | { mode: "add" }
      | { mode: "edit"; editIndex: number }
    )
  >();
  // return null;
  return (
    <div className="w-full text-left border-t border-t-slate-700 mt-1 pt-1">
      <div className="flex items-center gap-x-1">
        <Label>Labels</Label>
        <Button
          size="icon"
          variant="ghost"
          className="h-4 w-4 hover:bg-blue-400/50 hover:border-blue-500/50 mt-1 rounded-full"
          onClick={() => {
            setAlertState({
              mode: "add",
              value: { label: "label" + (box.labels?.length ?? 0), cel: "0.0" },
            });
          }}
        >
          <LuPlus size={10} />
        </Button>
      </div>
      {box.labels !== undefined && (
        <ol>
          {box.labels.map((l, i) => (
            <LabelFunctionItem
              key={l.label}
              labelFun={l}
              onEdit={() => {
                setAlertState({ mode: "edit", editIndex: i, value: l });
              }}
            />
          ))}
        </ol>
      )}
      <AlertDialog
        open={alertState !== undefined}
        onOpenChange={(o) => {
          if (!o) {
            setAlertState(undefined);
          }
        }}
      >
        {alertState !== undefined && (
          <AlertDialogContent
            className="max-w-3xl"
            onContextMenuCapture={(ev) => {
              ev.stopPropagation();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {alertState?.mode === "add" ? "Add " : "Edit "} Label Function
              </AlertDialogTitle>
              <AlertDialogDescription className="hidden">
                {alertState?.mode === "add" ? "Add " : "Edit "} Label Function
              </AlertDialogDescription>
            </AlertDialogHeader>
            {alertState.value !== undefined && (
              <div className=" flex flex-col">
                <Label className="mb-1">Label</Label>
                <Input
                  className="mb-2"
                  value={alertState.value.label}
                  onChange={(ev) => {
                    setAlertState({
                      ...alertState,
                      value: {
                        ...alertState.value,
                        label: ev.currentTarget.value,
                      },
                    });
                  }}
                />
                <Label className="mb-1">CEL Script</Label>
                <div className="max-h-40">
                  <Suspense
                    fallback={
                      <div>
                        Loading editor... <Spinner />
                      </div>
                    }
                  >
                    <CELEditor
                      key="advanced"
                      cel={alertState.value.cel}
                      onChange={(newCel) => {
                        const newVal = {
                          ...alertState,
                          value: { ...alertState.value, cel: newCel ?? "" },
                        };
                        setAlertState(newVal);
                      }}
                      availableEventVars={availableEventVars}
                      availableObjectVars={availableObjectVars}
                      availableChildSets={availableChildSets}
                      availableLabels={(box.labels ?? []).map((l) => l.label)}
                      nodeID={id}
                    />
                  </Suspense>
                </div>
              </div>
            )}
            <AlertDialogFooter>
              {" "}
              {alertState.mode === "edit" && (
                <Button
                  className="mr-auto"
                  variant="destructive"
                  onClick={() => {
                    const newBox = { ...box };
                    newBox.labels = [...(newBox.labels ?? [])];
                    newBox.labels?.splice(alertState.editIndex, 1);
                    updateBox(newBox);
                    setAlertState(undefined);
                  }}
                >
                  Delete
                </Button>
              )}
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const newBox = { ...box };
                  if (!newBox.labels) {
                    newBox.labels = [];
                  }
                  if (alertState.mode === "edit") {
                    newBox.labels[alertState.editIndex] = alertState.value;
                  } else {
                    newBox.labels.push(alertState.value);
                  }
                  updateBox(newBox);
                  setAlertState(undefined);
                }}
              >
                {alertState.mode === "add" ? "Add" : "Save"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}

const compact = true;
function LabelFunctionItem({
  onEdit,
  labelFun,
}: {
  onEdit: () => unknown;
  labelFun: LabelFunction;
}) {
  return (
    <li>
      <button
        onClick={() => onEdit()}
        className="flex items-baseline gap-x-1 hover:bg-blue-200/50 rounded-sm text-left w-fit px-0.5 max-w-full"
        onContextMenuCapture={(ev) => {
          ev.stopPropagation();
        }}
      >
        <LabelLabel label={labelFun.label} className="text-[0.5rem]" />
        <pre
          className={clsx(
            " text-[0.5rem] text-ellipsis overflow-hidden leading-tight font-medium text-muted-foreground",
            !(compact ?? false) && " break-all whitespace-normal",
            compact && "whitespace-nowrap max-w-20",
          )}
          title={labelFun.cel}
        >
          {labelFun.cel}
        </pre>
      </button>
    </li>
  );
}
export function LabelLabel({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span className={clsx("font-bold text-indigo-500", className)}>
      <IoPricetagOutline className="inline" /> {label}
    </span>
  );
}
