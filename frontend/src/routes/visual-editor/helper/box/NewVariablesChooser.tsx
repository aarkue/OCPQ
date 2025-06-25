import FilterLabelIcon from "@/components/FilterLabelIcon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import MultiSelect from "@/components/ui/multi-select";
import type { BindingBox } from "@/types/generated/BindingBox";
import type { EventVariable } from "@/types/generated/EventVariable";
import { type FilterLabel } from "@/types/generated/FilterLabel";
import type { ObjectVariable } from "@/types/generated/ObjectVariable";
import { useContext, useState } from "react";
import { LuAsterisk, LuPlus } from "react-icons/lu";
import { VisualEditorContext } from "../VisualEditorContext";
import {
  EvVarName,
  ObVarName,
  getEvVarName,
  getObVarName,
} from "./variable-names";

export default function NewVariableChooser({
  id,
  box,
  updateBox,
}: {
  id: string;
  box: BindingBox;
  updateBox: (box: BindingBox) => unknown;
}) {
  const { ocelInfo, getAvailableVars, getVarName } =
    useContext(VisualEditorContext);
  const [alertState, setAlertState] = useState<
    {
      variant: "event" | "object";
      key: ObjectVariable | EventVariable;
      value: string[];
    } & (
      | { mode: "add" }
      | { mode: "edit"; editKey: ObjectVariable | EventVariable }
    )
  >();
  const availableObjectVars = getAvailableVars(id, "object");
  const availableEventVars = getAvailableVars(id, "event");

  function getAvailableObjVars(allowObjectVar?: ObjectVariable | undefined) {
    return Array(100)
      .fill(0)
      .map((_, i) => i)
      .filter((i) => i === allowObjectVar || !availableObjectVars.includes(i))
      .filter((i, index) => index < 10);
  }

  function getAvailableEvVars(allowedEventVar?: EventVariable | undefined) {
    return Array(100)
      .fill(0)
      .map((_, i) => i)
      .filter((i) => i === allowedEventVar || !availableEventVars.includes(i))
      .filter((i, index) => index < 10);
  }

  if (ocelInfo === undefined) {
    return <div>No OCEL Info available. Check backend and reload.</div>;
  }
  return (
    <div className="font-normal text-left w-full">
      <div className="flex items-center gap-x-1 -mb-0.5">
        <Label>Object Variables</Label>
        <Button
          size="icon"
          variant="ghost"
          className="h-4 w-4 hover:bg-blue-400/50 hover:border-blue-500/50 mt-1 rounded-full"
          onClick={() =>
            setAlertState({
              mode: "add",
              variant: "object",
              key: getAvailableObjVars()[0],
              value:
                ocelInfo.object_types.length > 0
                  ? [ocelInfo.object_types[0].name]
                  : [],
            })
          }
        >
          <LuPlus size={10} />
        </Button>
      </div>
      <ul className="w-full text-left text-sm min-h-[0.5rem]">
        {Object.entries(box.newObjectVars).map(([obVar, obTypes]) => (
          <li key={obVar} className="flex items-baseline gap-x-0.5">
            <VariableLabelToggle
              labels={box.obVarLabels}
              variable={obVar}
              onChange={(newLabels) => {
                updateBox({ ...box, obVarLabels: newLabels });
              }}
            />
            <button
              className="hover:bg-blue-200/50 px-0.5 rounded-sm flex items-baseline w-fit max-w-full"
              onContextMenuCapture={(ev) => {
                ev.stopPropagation();
              }}
              onClick={() =>
                setAlertState({
                  mode: "edit",
                  variant: "object",
                  key: parseInt(obVar),
                  editKey: parseInt(obVar),
                  value: obTypes,
                })
              }
            >
              <ObVarName obVar={parseInt(obVar)} />
              <span className="text-muted-foreground">:</span>
              {ocelInfo.object_types.length === obTypes.length && (
                <LuAsterisk
                  className="self-center size-4 text-gray-600"
                  title="Any object type included in the OCEL"
                />
              )}
              {ocelInfo.object_types.length !== obTypes.length && (
                <span
                  className="ml-1 max-w-[13ch] shrink overflow-ellipsis overflow-hidden inline-block whitespace-pre text-left"
                  title={obTypes.join(",\n")}
                >
                  {obTypes.join(",\n")}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-x-1 mt-1">
        <Label>Event Variables</Label>
        <Button
          size="icon"
          variant="ghost"
          className="h-4 w-4 hover:bg-blue-400/50 hover:border-blue-500/50 mt-1 rounded-full"
          onClick={() =>
            setAlertState({
              mode: "add",
              variant: "event",
              key: getAvailableEvVars()[0],
              value:
                ocelInfo.event_types.length >= 1
                  ? [ocelInfo.event_types[0].name]
                  : [],
            })
          }
        >
          <LuPlus size={10} />
        </Button>
      </div>
      <ul className="w-full text-left text-sm min-h-[0.5rem]">
        {Object.entries(box.newEventVars).map(([evVar, evTypes]) => (
          <li key={evVar} className="flex items-baseline gap-x-0.5">
            <VariableLabelToggle
              labels={box.evVarLabels}
              variable={evVar}
              onChange={(newLabels) => {
                updateBox({ ...box, evVarLabels: newLabels });
              }}
            />
            <button
              className="hover:bg-blue-200/50 px-0.5 rounded-sm flex items-baseline"
              onContextMenuCapture={(ev) => {
                ev.stopPropagation();
              }}
              onClick={() =>
                setAlertState({
                  mode: "edit",
                  variant: "event",
                  key: parseInt(evVar),
                  editKey: parseInt(evVar),
                  value: evTypes,
                })
              }
            >
              <EvVarName eventVar={parseInt(evVar)} />
              <span className="text-muted-foreground">:</span>
              {ocelInfo.event_types.length === evTypes.length && (
                <LuAsterisk
                  className="self-center size-4 text-gray-600"
                  title="Any event type included in the OCEL"
                />
              )}
              {ocelInfo.event_types.length !== evTypes.length && (
                <span
                  className="ml-1 max-w-full shrink overflow-ellipsis overflow-hidden inline-block whitespace-pre text-left"
                  title={evTypes.join(",\n")}
                >
                  {evTypes.join(",\n")}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

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
            className="max-w-2xl"
            onContextMenuCapture={(ev) => {
              ev.stopPropagation();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {alertState?.mode === "add" ? "Add " : "Edit "}
                {alertState?.variant === "event"
                  ? "Event Variable"
                  : "Object Variable"}
              </AlertDialogTitle>
              <div className="text-sm text-gray-700 pt-4 grid grid-cols-[1fr,2fr] gap-x-2 gap-y-1.5">
                <Label>Variable</Label>
                <Label>
                  {alertState?.variant === "event" ? "Event" : "Object"} Types
                </Label>
                <Combobox
                  options={
                    alertState?.variant === "object"
                      ? getAvailableObjVars(
                          alertState.mode === "edit"
                            ? alertState.key
                            : undefined,
                        ).map((i) => ({
                          value:
                            i.toString() +
                            " --- " +
                            getVarName(i, "object").name,
                          label: getObVarName(i),
                        }))
                      : getAvailableEvVars(
                          alertState.mode === "edit"
                            ? alertState.key
                            : undefined,
                        ).map((i) => ({
                          value:
                            i.toString() +
                            " --- " +
                            getVarName(i, "event").name,
                          label: getEvVarName(i),
                        }))
                  }
                  onChange={(value: string) => {
                    const variableKey = parseInt(value.split(" --- ")[0]);
                    if (!isNaN(variableKey) && variableKey >= 0) {
                      setAlertState({ ...alertState, key: variableKey });
                    }
                  }}
                  name={""}
                  value={
                    alertState.key.toString() +
                    " --- " +
                    (alertState?.variant === "object"
                      ? getVarName(alertState.key, "object").name
                      : getVarName(alertState.key, "event").name)
                  }
                />
                <MultiSelect
                  options={(alertState?.variant === "object"
                    ? ocelInfo.object_types
                    : ocelInfo.event_types
                  ).map((t) => ({
                    label: t.name,
                    value: t.name,
                  }))}
                  placeholder={""}
                  defaultValue={alertState.value}
                  onValueChange={(value: string[]) => {
                    setAlertState({ ...alertState, value });
                  }}
                />
              </div>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {" "}
              {alertState.mode === "edit" && (
                <Button
                  className="mr-auto"
                  variant="destructive"
                  onClick={() => {
                    const newBox = { ...box };
                    if (alertState.variant === "object") {
                      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                      delete newBox.newObjectVars[alertState.editKey];
                    } else {
                      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                      delete newBox.newEventVars[alertState.editKey];
                    }
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
                  if (alertState.mode === "edit") {
                    if (alertState.variant === "object") {
                      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                      delete newBox.newObjectVars[alertState.editKey];
                    } else {
                      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                      delete newBox.newEventVars[alertState.editKey];
                    }
                  }
                  if (alertState.variant === "object") {
                    newBox.newObjectVars[alertState.key] = alertState.value;
                  } else {
                    newBox.newEventVars[alertState.key] = alertState.value;
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

function getVariableLabel(
  labels: BindingBox["evVarLabels"] | BindingBox["obVarLabels"],
  variable: EventVariable | ObjectVariable | string,
) {
  if (typeof variable === "string") {
    variable = parseInt(variable);
  }
  const val: FilterLabel | undefined = (labels ?? {})[variable];
  return val ?? "IGNORED";
}

function VariableLabelToggle({
  variable,
  labels,
  onChange,
}: {
  labels: BindingBox["evVarLabels"] | BindingBox["obVarLabels"];
  variable: EventVariable | ObjectVariable | string;
  onChange: (
    newLabels: BindingBox["evVarLabels"] | BindingBox["obVarLabels"],
  ) => unknown;
}) {
  const ctx = useContext(VisualEditorContext);
  if (ctx.filterMode !== "shown") {
    return null;
  }
  if (typeof variable === "string") {
    variable = parseInt(variable);
  }
  return (
    <button
      onClick={() => {
        const prevLabels = labels ?? {};
        const prevLabel = prevLabels[variable as number] ?? "IGNORED";
        let newLabel: FilterLabel = "IGNORED";
        if (prevLabel === "IGNORED") {
          newLabel = "INCLUDED";
        } else if (prevLabel === "INCLUDED") {
          newLabel = "EXCLUDED";
        }
        const newLabels = { ...prevLabels, [variable]: newLabel };
        onChange(newLabels);
      }}
    >
      <FilterLabelIcon label={getVariableLabel(labels, variable)} />
    </button>
  );
}
