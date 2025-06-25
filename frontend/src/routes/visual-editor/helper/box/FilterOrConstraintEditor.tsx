import TimeDurationInput, {
  formatSeconds,
} from "@/components/TimeDurationInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Constraint } from "@/types/generated/Constraint";
import type { Filter } from "@/types/generated/Filter";
import type { SizeFilter } from "@/types/generated/SizeFilter";
import type { ValueFilter } from "@/types/generated/ValueFilter";
import { lazy, type ReactNode, Suspense, useContext } from "react";
import { LuArrowRight, LuDelete, LuEqual, LuLink, LuPlus, LuTrash } from "react-icons/lu";
import { VisualEditorContext } from "../VisualEditorContext";
import {
  EventVarSelector,
  ObjectOrEventVarSelector,
  ObjectVarSelector,
} from "./FilterChooser";
import { EvOrObVarName, EvVarName, ObVarName } from "./variable-names";
// import CELEditor from "@/components/CELEditor";
import Spinner from "@/components/Spinner";
import clsx from "clsx";
import { PiCodeFill } from "react-icons/pi";

const CELEditor = lazy(async () => await import("@/components/CELEditor"));
export default function FilterOrConstraintEditor<
  T extends Filter | SizeFilter | Constraint,
>({
  value,
  updateValue,
  availableObjectVars,
  availableEventVars,
  availableChildSets,
  availableLabels,
  nodeID,
}: {
  value: T;
  updateValue: (value: T) => unknown;
  availableObjectVars: number[];
  availableEventVars: number[];
  availableChildSets: string[];
  availableLabels?: string[];
  nodeID: string;
}) {
  const { getAvailableVars, getNodeIDByName, getTypesForVariable, getAvailableChildNames } =
    useContext(VisualEditorContext);
const childVars = getAvailableChildNames(nodeID);
  switch (value.type) {
    case "O2E":
      return (
        <>
          <EventVarSelector
            eventVars={availableEventVars}
            value={value.event}
            onChange={(newV) => {
              if (newV !== undefined) {
                value.event = newV;
                updateValue({ ...value });
              }
            }}
          />
          <ObjectVarSelector
            objectVars={availableObjectVars}
            value={value.object}
            onChange={(newV) => {
              if (newV !== undefined) {
                value.object = newV;
                updateValue({ ...value });
              }
            }}
          />
          <Input
            className="w-full"
            placeholder="Qualifier"
            value={value.qualifier ?? ""}
            onChange={(ev) => {
              const newVal = ev.currentTarget.value;
              if (newVal !== null && newVal !== "") {
                value.qualifier = newVal;
                updateValue({ ...value });
              } else {
                value.qualifier = null;
                updateValue({ ...value });
              }
            }}
          />
        </>
      );
    case "O2O":
      return (
        <>
          <ObjectVarSelector
            objectVars={availableObjectVars}
            value={value.object}
            onChange={(newV) => {
              if (newV !== undefined) {
                value.object = newV;
                updateValue({ ...value });
              }
            }}
          />
          <ObjectVarSelector
            objectVars={availableObjectVars}
            value={value.other_object}
            onChange={(newV) => {
              if (newV !== undefined) {
                value.other_object = newV;
                updateValue({ ...value });
              }
            }}
          />
          <Input
            className="w-full"
            placeholder="Qualifier"
            value={value.qualifier ?? ""}
            onChange={(ev) => {
              const newVal = ev.currentTarget.value;
              if (newVal !== null && newVal !== "") {
                value.qualifier = newVal;
                updateValue({ ...value });
              } else {
                value.qualifier = null;
                updateValue({ ...value });
              }
            }}
          />
        </>
      );
    case "NotEqual":
      return (
        <>
          <ObjectOrEventVarSelector
            objectVars={availableObjectVars}
            eventVars={availableEventVars}
            value={
              "Event" in value.var_1
                ? { type: "event", value: value.var_1.Event }
                : { type: "object", value: value.var_1.Object }
            }
            onChange={(v) => {
              if (v !== undefined) {
                value.var_1 =
                  v.type === "event" ? { Event: v.value } : { Object: v.value };
                updateValue({ ...value });
              }
            }}
          />
          ≠
          <ObjectOrEventVarSelector
            objectVars={availableObjectVars}
            eventVars={availableEventVars}
            value={
              "Event" in value.var_2
                ? { type: "event", value: value.var_2.Event }
                : { type: "object", value: value.var_2.Object }
            }
            onChange={(v) => {
              if (v !== undefined) {
                value.var_2 =
                  v.type === "event" ? { Event: v.value } : { Object: v.value };
                updateValue({ ...value });
              }
            }}
          />
        </>
      );
    case "BasicFilterCEL":
      return (
        <>
          <Suspense
            fallback={
              <div>
                Loading editor... <Spinner />
              </div>
            }
          >
            <CELEditor
              key="basic"
              cel={value.cel}
              onChange={(newCel) => {
                value.cel = newCel ?? "true";
                updateValue({ ...value });
              }}
              availableEventVars={availableEventVars}
              availableObjectVars={availableObjectVars}
              nodeID={nodeID}
            />
          </Suspense>
        </>
      );
    case "AdvancedCEL":
      return (
        <>
          <Suspense
            fallback={
              <div>
                Loading editor... <Spinner />
              </div>
            }
          >
            <CELEditor
              key="advanced"
              cel={value.cel}
              onChange={(newCel) => {
                value.cel = newCel ?? "true";
                updateValue({ ...value });
              }}
              availableEventVars={availableEventVars}
              availableObjectVars={availableObjectVars}
              availableChildSets={availableChildSets}
              availableLabels={availableLabels}
              nodeID={nodeID}
            />
          </Suspense>
        </>
      );
    case "TimeBetweenEvents":
      return (
        <>
          <EventVarSelector
            eventVars={availableEventVars}
            value={value.from_event}
            onChange={(newV) => {
              if (newV !== undefined) {
                value.from_event = newV;
                updateValue({ ...value });
              }
            }}
          />
          <EventVarSelector
            eventVars={availableEventVars}
            value={value.to_event}
            onChange={(newV) => {
              if (newV !== undefined) {
                value.to_event = newV;
                updateValue({ ...value });
              }
            }}
          />
          <TimeDurationInput
            placeholder="Minimum Duration/Delay (Optional)"
            durationSeconds={value.min_seconds ?? -Infinity}
            onChange={(newVal) => {
              if (newVal !== undefined && isFinite(newVal)) {
                value.min_seconds = newVal;
                updateValue({ ...value });
              } else {
                value.min_seconds = null;
                updateValue({ ...value });
              }
            }}
          />
          <TimeDurationInput
            placeholder="Maximum Duration/Delay (Optional)"
            durationSeconds={value.max_seconds ?? Infinity}
            onChange={(newVal) => {
              if (newVal !== undefined && isFinite(newVal)) {
                value.max_seconds = newVal;
                updateValue({ ...value });
              } else {
                value.max_seconds = null;
                updateValue({ ...value });
              }
            }}
          />
        </>
      );
    case "NumChilds":
      return (
        <>
          <ChildSetSelector
            availableChildSets={availableChildSets}
            value={value.child_name}
            onChange={(v) => {
              if (v !== undefined) {
                value.child_name = v;
                updateValue({ ...value });
              }
            }}
          />
          <Input
            placeholder="Minimal Count (Optional)"
            type="number"
            value={value.min ?? ""}
            onChange={(ev) => {
              const val = ev.currentTarget.valueAsNumber;
              if (isFinite(val)) {
                value.min = val;
              } else {
                value.min = null;
              }
              updateValue({ ...value });
            }}
          />

          <Input
            placeholder="Maximal Count (Optional)"
            type="number"
            value={value.max ?? ""}
            onChange={(ev) => {
              const val = ev.currentTarget.valueAsNumber;
              if (isFinite(val)) {
                value.max = val;
              } else {
                value.max = null;
              }
              updateValue({ ...value });
            }}
          />
        </>
      );
    case "BindingSetEqual":
      return (
        <>
          {value.child_names.map((c, i) => (
            <div key={i} className="flex gap-0.5 items-center justify-center">
              <ChildSetSelector
                availableChildSets={availableChildSets}
                value={c}
                onChange={(v) => {
                  if (v !== undefined) {
                    value.child_names[i] = v;
                    updateValue({ ...value });
                  }
                }}
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  value.child_names.splice(i, 1);
                  updateValue({ ...value });
                }}
              >
                <LuTrash />
              </Button>
              {(i < value.child_names.length - 1)  && <LuEqual  className="ml-1"/>}
            </div>
          ))}
          <Button
            onClick={() => {
              value.child_names.push(childVars[0] ?? "A");
              updateValue({ ...value });
            }}
          >
            Add
          </Button>
        </>
      );
    case "BindingSetProjectionEqual":
      return (
        <>
          {value.child_name_with_var_name.map(([c, variable], i) => (
            <div key={i} className="flex gap-0.5 items-center justify-center relative pb-9">
              <ChildSetSelector
                availableChildSets={availableChildSets}
                value={c[0]}
                onChange={(v) => {
                  if (v !== undefined) {
                    value.child_name_with_var_name[i][0] = v;
                    updateValue({ ...value });
                  }
                }}
              />
              <ObjectOrEventVarSelector
                objectVars={getAvailableVars(
                  getNodeIDByName(c) ?? "-",
                  "object",
                )}
                eventVars={getAvailableVars(getNodeIDByName(c) ?? "-", "event")}
                value={
                  "Event" in variable
                    ? { type: "event", value: variable.Event }
                    : { type: "object", value: variable.Object }
                }
                onChange={(v) => {
                  if (v !== undefined) {
                    value.child_name_with_var_name[i][1] =
                      v.type === "event"
                        ? { Event: v.value }
                        : { Object: v.value };
                    updateValue({ ...value });
                  }
                }}
              />
              <Button className="absolute top-9 left-0"
                size="icon"
                variant="ghost"
                onClick={() => {
                  value.child_name_with_var_name.splice(i, 1);
                  updateValue({ ...value });
                }}
              >
                <LuTrash className="stroke-red-500" />
              </Button>


              {(i < value.child_name_with_var_name.length - 1)  && <LuEqual  className="ml-1"/>}
            </div>
          ))}
          <Button
            onClick={() => {
              value.child_name_with_var_name.push([childVars[0] ?? "A", { Object: 0 }]);
              updateValue({ ...value });
            }}
          >
            Add
          </Button>
        </>
      );
    case "NumChildsProj":
      return (
        <>
          <ChildSetSelector
            availableChildSets={availableChildSets}
            value={value.child_name}
            onChange={(v) => {
              if (v !== undefined) {
                value.child_name = v;
                updateValue({ ...value });
              }
            }}
          />
          <ObjectOrEventVarSelector
            objectVars={getAvailableVars(
              getNodeIDByName(value.child_name) ?? "-",
              "object",
            )}
            eventVars={getAvailableVars(
              getNodeIDByName(value.child_name) ?? "-",
              "event",
            )}
            value={
              "Event" in value.var_name
                ? { type: "event", value: value.var_name.Event }
                : { type: "object", value: value.var_name.Object }
            }
            onChange={(v) => {
              if (v !== undefined) {
                value.var_name =
                  v.type === "event" ? { Event: v.value } : { Object: v.value };
                updateValue({ ...value });
              }
            }}
          />
          <Input
            type="number"
            value={value.min ?? ""}
            onChange={(ev) => {
              const val = ev.currentTarget.valueAsNumber;
              if (isFinite(val)) {
                value.min = val;
              } else {
                value.min = null;
              }
              updateValue({ ...value });
            }}
          />

          <Input
            type="number"
            value={value.max ?? ""}
            onChange={(ev) => {
              const val = ev.currentTarget.valueAsNumber;
              if (isFinite(val)) {
                value.max = val;
              } else {
                value.max = null;
              }
              updateValue({ ...value });
            }}
          />
        </>
      );
    case "Filter":
      return (
        <FilterOrConstraintEditor
          value={value.filter}
          updateValue={(newValue) =>
            updateValue({
              type: "Filter",
              filter: newValue,
            } satisfies Constraint as T)
          }
          availableEventVars={availableEventVars}
          availableObjectVars={availableObjectVars}
          availableChildSets={availableChildSets}
          nodeID={nodeID}
        />
      );
    case "SizeFilter":
      return (
        <FilterOrConstraintEditor
          value={value.filter}
          updateValue={(newValue) =>
            updateValue({
              type: "SizeFilter",
              filter: newValue,
            } satisfies Constraint as T)
          }
          availableEventVars={availableEventVars}
          availableObjectVars={availableObjectVars}
          availableChildSets={availableChildSets}
          availableLabels={availableLabels}
          nodeID={nodeID}
        />
      );
    case "SAT":
    case "ANY":
      return (
        <>
          {value.child_names.map((c, i) => (
            <div key={i} className="flex gap-0.5 mr-2">
              <ChildSetSelector
                availableChildSets={availableChildSets}
                value={c}
                onChange={(v) => {
                  if (v !== undefined) {
                    value.child_names[i] = v;
                    updateValue({ ...value });
                  }
                }}
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  value.child_names.splice(i, 1);
                  updateValue({ ...value });
                }}
              >
                <LuTrash />
              </Button>
            </div>
          ))}
          <Button
            onClick={() => {
              value.child_names.push(childVars[0] ?? "A");
              updateValue({ ...value });
            }}
          >
            Add
          </Button>
        </>
      );

    case "NOT":
      return (
        <>
          {value.child_names.map((c, i) => (
            <div key={i} className="flex gap-0.5 mr-2">
              <ChildSetSelector
                availableChildSets={availableChildSets}
                value={c}
                onChange={(v) => {
                  if (v !== undefined) {
                    value.child_names[i] = v;
                    updateValue({ ...value });
                  }
                }}
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  value.child_names.splice(i, 1);
                  updateValue({ ...value });
                }}
              >
                <LuTrash />
              </Button>
            </div>
          ))}
          <Button
            onClick={() => {
              value.child_names.push(childVars[0] ?? "A");
              updateValue({ ...value });
            }}
          >
            Add
          </Button>
        </>
      );
    case "OR":
      return (
        <>
          {value.child_names.map((c, i) => (
            <div key={i} className="flex gap-0.5 mr-2">
              <ChildSetSelector
                availableChildSets={availableChildSets}
                value={c}
                onChange={(v) => {
                  if (v !== undefined) {
                    value.child_names[i] = v;
                    updateValue({ ...value });
                  }
                }}
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  value.child_names.splice(i, 1);
                  updateValue({ ...value });
                }}
              >
                <LuTrash />
              </Button>
            </div>
          ))}
          <Button
            onClick={() => {
              value.child_names.push(childVars[0] ?? "A");
              updateValue({ ...value });
            }}
          >
            Add
          </Button>
        </>
      );
    case "AND":
      return (
        <>
          {value.child_names.map((c, i) => (
            <div key={i} className="flex gap-0.5 mr-2">
              <ChildSetSelector
                availableChildSets={availableChildSets}
                value={c}
                onChange={(v) => {
                  if (v !== undefined) {
                    value.child_names[i] = v;
                    updateValue({ ...value });
                  }
                }}
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  value.child_names.splice(i, 1);
                  updateValue({ ...value });
                }}
              >
                <LuTrash />
              </Button>
            </div>
          ))}
          <Button
            onClick={() => {
              value.child_names.push(childVars[0] ?? "A");
              updateValue({ ...value });
            }}
          >
            Add
          </Button>
        </>
      );
    case "EventAttributeValueFilter":
      return (
        <>
          <EventVarSelector
            eventVars={availableEventVars}
            value={value.event}
            onChange={(newV) => {
              if (newV !== undefined) {
                value.event = newV;
                updateValue({ ...value });
              }
            }}
          />
          <AttributeNameSelector
            availableAttributes={["ocel:id","ocel:time",...deDupe(
              getTypesForVariable(nodeID, value.event, "event")
                .map((t) => t.attributes)
                .flat()
                .map((at) => at.name),
            )]}
            value={value.attribute_name}
            onChange={(newV) => {
              const newAttrName = getTypesForVariable(
                nodeID,
                value.event,
                "event",
              )
                .map((t) => t.attributes)
                .flat()
                .find((at) => at.name === newV);
              console.log({ newAttrName });
              if (newV !== undefined) {
                value.attribute_name = newV;
                updateValue({ ...value });
              }
            }}
          />
          <AttributeValueFilterSelector
            value={value.value_filter}
            onChange={(valueFilter) => {
              if (valueFilter !== undefined) {
                value.value_filter = valueFilter;
                updateValue({ ...value });
              }
            }}
          />
        </>
      );
    case "ObjectAttributeValueFilter":
      return (
        <>
          <ObjectVarSelector
            objectVars={availableObjectVars}
            value={value.object}
            onChange={(newV) => {
              if (newV !== undefined) {
                value.object = newV;
                updateValue({ ...value });
              }
            }}
          />
          <AttributeNameSelector
            availableAttributes={["ocel:id",...deDupe(
              getTypesForVariable(nodeID, value.object, "object")
                .map((t) => t.attributes)
                .flat()
                .map((at) => at.name),
            )]}
            value={value.attribute_name}
            onChange={(newV) => {
              const newAttrName = getTypesForVariable(
                nodeID,
                value.object,
                "object",
              )
                .map((t) => t.attributes)
                .flat()
                .find((at) => at.name === newV);
              console.log({ newAttrName });

              if (newV !== undefined) {
                value.attribute_name = newV;
                updateValue({ ...value });
              }
            }}
          />
          <Combobox
            value={value.at_time.type}
            options={[
              { label: "Always", value: "Always" },
              { label: "Sometime", value: "Sometime" },
              { label: "At event", value: "AtEvent" },
            ]}
            name="At time"
            onChange={(ev) => {
              switch (
              ev as (Filter & {
                type: "ObjectAttributeValueFilter";
              })["at_time"]["type"]
              ) {
                case "Always":
                  value.at_time = { type: "Always" };
                  updateValue({ ...value });
                  break;

                case "Sometime":
                  value.at_time = { type: "Sometime" };
                  updateValue({ ...value });
                  break;
                case "AtEvent":
                  value.at_time = { type: "AtEvent", event: 0 };
                  updateValue({ ...value });
                  break;
              }
            }}
          />
          {value.at_time.type === "AtEvent" && (
            <EventVarSelector
              eventVars={availableEventVars}
              value={value.at_time.event}
              onChange={(newV) => {
                if (newV !== undefined && value.at_time.type === "AtEvent") {
                  value.at_time.event = newV;
                  updateValue({ ...value });
                }
              }}
            />
          )}
          <AttributeValueFilterSelector
            value={value.value_filter}
            onChange={(valueFilter) => {
              if (valueFilter !== undefined) {
                value.value_filter = valueFilter;
                updateValue({ ...value });
              }
            }}
          />
        </>
      );
  }
}

export function FilterOrConstraintDisplay<
  T extends Filter | SizeFilter | Constraint,
>({ value, compact }: { value: T; compact?: boolean }) {
  switch (value.type) {
    case "O2E":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm">
          <EvVarName eventVar={value.event} /> <LuLink />{" "}
          <ObVarName obVar={value.object} />
          {value.qualifier != null ? `@${value.qualifier}` : ""}
        </div>
      );
    case "O2O":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm">
          <ObVarName obVar={value.object} /> <LuLink />{" "}
          <ObVarName obVar={value.other_object} />{" "}
          {value.qualifier != null ? `@${value.qualifier}` : ""}
        </div>
      );
    case "TimeBetweenEvents":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          <EvVarName eventVar={value.from_event} /> <LuArrowRight />{" "}
          <EvVarName eventVar={value.to_event} />{" "}
          <div className="ml-2 flex items-center gap-x-1 text-xs w-fit">
            {formatSeconds(value.min_seconds ?? -Infinity)}{" "}
            <span className="mx-1">-</span>{" "}
            {formatSeconds(value.max_seconds ?? Infinity)}
          </div>
        </div>
      );
    case "NotEqual":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm">
          <EvOrObVarName varName={value.var_1} />
          ≠
          <EvOrObVarName varName={value.var_2} />
        </div>
      );
    case "BasicFilterCEL":
    case "AdvancedCEL":
      return (
        <div className="flex items-center text-xs w-full bg-white/50 text-slate-800 border border-slate-600/10 text-[0.5rem] px-0.5 rounded-sm ">
          {/* CEL */}
          <PiCodeFill
            className={clsx(
              "inline mr-1 pr-1 ml-0.5 border-r shrink-0",
              value.type === "BasicFilterCEL" && "text-blue-600",
              value.type !== "BasicFilterCEL" && "text-purple-600",
            )}
            size={20}
          />
          <pre
            className={clsx(
              "text-[0.5rem] overflow-ellipsis overflow-hidden leading-tight font-semibold",
              !(compact ?? false) && " break-all whitespace-normal",
              compact === true && "whitespace-nowrap max-w-[5rem]",
            )}
            title={value.cel}
          >
            {value.cel}
          </pre>
        </div>
      );
    case "NumChilds":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          <MinMaxDisplayWithSugar min={value.min} max={value.max}>
            |{value.child_name}|
          </MinMaxDisplayWithSugar>
        </div>
      );
    case "BindingSetEqual":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          {value.child_names.join(" = ") ?? 0}
        </div>
      );
    case "BindingSetProjectionEqual":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          {value.child_name_with_var_name.map(([n, v], i) => (
            <div key={i}>
              {n}
              <span className="">
                {"["}
                {"Event" in v ? (
                  <EvVarName eventVar={v.Event} />
                ) : (
                  <ObVarName obVar={v.Object} />
                )}
                {"]"}
              </span>
              {i < value.child_name_with_var_name.length - 1 ? "=" : ""}
            </div>
          ))}
        </div>
      );
    case "NumChildsProj":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          <MinMaxDisplayWithSugar min={value.min} max={value.max}>
            |{value.child_name}
            <span className="-mx-1">
              {"["}
              {"Event" in value.var_name ? (
                <EvVarName eventVar={value.var_name.Event} />
              ) : (
                <ObVarName obVar={value.var_name.Object} />
              )}
              {"]"}
            </span>
            |
          </MinMaxDisplayWithSugar>
        </div>
      );
    case "Filter":
      return (
        <FilterOrConstraintDisplay value={value.filter} compact={compact} />
      );
    case "SizeFilter":
      return (
        <FilterOrConstraintDisplay value={value.filter} compact={compact} />
      );
    case "SAT":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          SAT({value.child_names.map((i) => i).join(",")})
        </div>
      );
    case "ANY":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          ANY({value.child_names.map((i) => i).join(",")})
        </div>
      );
    case "NOT":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          NOT({value.child_names.map((i) => i).join(",")})
        </div>
      );
    case "OR":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          OR({value.child_names.map((i) => i).join(",")})
        </div>
      );
    case "AND":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          AND({value.child_names.map((i) => i).join(",")})
        </div>
      );
    case "EventAttributeValueFilter":
      return (
        <div className="font-normal text-sm whitespace-nowrap max-w-full w-full overflow-hidden overflow-ellipsis">
          <EvVarName eventVar={value.event} />
          <span className="font-light">
            .
            {value.attribute_name.length > 0
              ? value.attribute_name
              : "Unknown Attribute"}{" "}
            {": "}
            <AttributeValueFilterDisplay value={value.value_filter} />
          </span>
        </div>
      );
    case "ObjectAttributeValueFilter":
      return (
        <div className="font-normal text-sm whitespace-nowrap max-w-full w-full overflow-hidden overflow-ellipsis">
          <ObVarName obVar={value.object} />
          <span className="whitespace-nowrap font-light text-xs w-full">
            .
            {value.attribute_name.length > 0
              ? value.attribute_name
              : "Unknown Attribute"}{" "}
            {/* {": "} */}
            <AttributeValueFilterDisplay value={value.value_filter} /> (
            {value.at_time.type === "Sometime" && "sometime"}
            {value.at_time.type === "Always" && "always"}
            {value.at_time.type === "AtEvent" && (
              <span>
                at <EvVarName eventVar={value.at_time.event} />
              </span>
            )}
            )
          </span>
        </div>
      );
  }
}

function MinMaxDisplayWithSugar({
  min,
  max,
  children,
  rangeMode,
}: {
  min: number | null;
  max: number | null;
  children?: ReactNode;
  rangeMode?: boolean;
}) {
  const value = { min, max };
  return (
    <>
      {value.max === value.min && value.min !== null && (
        <>
          {children} = {value.min}
        </>
      )}
      {value.max === null && value.min !== null && (
        <>
          {children} ≥ {value.min}
        </>
      )}
      {value.min === null && value.max !== null && (
        <>
          {children} ≤ {value.max}
        </>
      )}
      {((value.min === null && value.max === null) ||
        (value.min !== value.max &&
          value.min !== null &&
          value.max !== null)) && (
          <>
            {rangeMode === true && (
              <>
                {value.min ?? 0} - {value.max ?? "∞"}
              </>
            )}
            {rangeMode !== true && (
              <>
                {value.min ?? 0} ≤ {children} ≤ {value.max ?? "∞"}
              </>
            )}
          </>
        )}
      { }
    </>
  );
}

function AttributeValueFilterDisplay({ value }: { value: ValueFilter }) {
  switch (value.type) {
    case "Float":
      return (
        <MinMaxDisplayWithSugar
          min={value.min}
          max={value.max}
          rangeMode
        ></MinMaxDisplayWithSugar>
      );
    case "Integer":
      return (
        <MinMaxDisplayWithSugar
          min={value.min}
          max={value.max}
        ></MinMaxDisplayWithSugar>
      );
    case "Boolean":
      return <span>{value.is_true ? "true" : "false"}</span>;
    case "String":
      return (
        <span className="text-xs tracking-tighter">
          {value.is_in.length > 1 ? "in" : ""} {value.is_in.join(", ")}
        </span>
      );
    case "Time":
      return (
        <span>
          {value.from} - {value.to}
        </span>
      );
  }
}

function ChildSetSelector({
  value,
  onChange,
  availableChildSets,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => unknown;
  availableChildSets: string[];
}) {
  availableChildSets = [...new Set(availableChildSets)];
  availableChildSets.sort();
  return (
    <Combobox
      options={availableChildSets.map((v) => ({
        label: v,
        value: v,
      }))}
      onChange={(val) => {
        if (val !== "") {
          onChange(val);
        } else {
          onChange(undefined);
        }
      }}
      name={"Child Set"}
      title="Child Set"
      value={value ?? ""}
    />
  );
}

function AttributeNameSelector({
  value,
  onChange,
  availableAttributes,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => unknown;
  availableAttributes: string[];
}) {
  return (
    <Combobox
      title="Attribute Name"
      options={availableAttributes.map((v) => ({
        label: v,
        value: v,
      }))}
      onChange={(val) => {
        if (val !== "") {
          onChange(val);
        } else {
          onChange(undefined);
        }
      }}
      name={"Attribute Name"}
      value={value ?? ""}
    />
  );
}

function AttributeValueFilterSelector({
  value,
  onChange,
}: {
  value: ValueFilter | undefined;
  onChange: (value: ValueFilter | undefined) => unknown;
}) {
  return (
    <div className="flex items-start gap-x-2">
      <Combobox
        options={["Float", "Integer", "Boolean", "String", "Time"].map((v) => ({
          label: v,
          value: v,
        }))}
        onChange={(val) => {
          if (val !== "") {
            switch (val as ValueFilter["type"]) {
              case "Float":
                return onChange({ type: "Float", min: null, max: null });
              case "Integer":
                return onChange({ type: "Integer", min: null, max: null });
              case "Boolean":
                return onChange({ type: "Boolean", is_true: true });
              case "String":
                return onChange({ type: "String", is_in: [""] });
              case "Time":
                return onChange({ type: "Time", from: null, to: null });
            }
          } else {
            onChange(undefined);
          }
        }}
        name={"Attribute Type"}
        title="Attribute Type"
        value={value?.type ?? "String"}
      />
      {value?.type === "Boolean" && (
        <Label className="flex gap-x-2 items-center justify-center">
          <Checkbox
            checked={value.is_true}
            onCheckedChange={(c) => {
              onChange({ ...value, is_true: Boolean(c) });
            }}
          />
          Should be {value.is_true ? "True" : "False"}
        </Label>
      )}
      {(value?.type === "Float" || value?.type === "Integer") && (
        <div className="flex items-center gap-x-2">
          <Input
            title="Minimum (Optional)"
            placeholder="Minimum (Optional)"
            type="number"
            step={value.type === "Integer" ? 1 : undefined}
            value={value.min + ""}
            onChange={(ev) => {
              const val = ev.currentTarget.valueAsNumber;
              if (isFinite(val)) {
                value.min = val;
              } else {
                value.min = null;
              }
              onChange({ ...value });
            }}
          />
          {"-"}

          <Input
            title="Maximum (Optional)"
            placeholder="Maximum (Optional)"
            type="number"
            step={value.type === "Integer" ? 1 : undefined}
            value={value.max + ""}
            onChange={(ev) => {
              const val = ev.currentTarget.valueAsNumber;
              if (isFinite(val)) {
                value.max = val;
              } else {
                value.max = null;
              }
              onChange({ ...value });
            }}
          />
        </div>
      )}
      {value?.type === "String" && (
        <div className="flex flex-col w-full -mt-6">
          <div className="h-6">Value should be in:</div>
          <div className="flex flex-col w-full gap-2 mb-2">
            {value.is_in.map((v, i) => (
              <div key={i} className="w-full flex items-center gap-x-2">
                <Input
                  className=""
                  type="text"
                  value={v}
                  onChange={(ev) => {
                    value.is_in[i] = ev.currentTarget.value;
                    onChange({ ...value });
                  }}
                />
                <Button
                  className="shrink-0 w-[1.5rem] h-[1.5rem]"
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    const values = [...value.is_in];
                    values.splice(i, 1);
                    onChange({ ...value, is_in: values });
                  }}
                >
                  <LuDelete />
                </Button>
              </div>
            ))}
          </div>
          <div className="text-right">
            <Button
              variant="outline"
              onClick={() => {
                onChange({ ...value, is_in: [...value.is_in, ""] });
              }}
            >
              Add Option
            </Button>
          </div>
        </div>
      )}
      {value?.type === "Time" && (
        <div>
          <Input
            type="datetime-local"
            value={value.from?.slice(0, 16) ?? ""}
            onChange={(ev) => {
              const iso = ev.currentTarget.valueAsDate?.toISOString();
              console.log({ iso });
              if (iso !== undefined) {
                onChange({ ...value, from: iso });
              } else {
                onChange({ ...value, from: null });
              }
            }}
          />
          <Input
            type="datetime-local"
            value={value.to?.slice(0, 16) ?? ""}
            onChange={(ev) => {
              const iso = ev.currentTarget.valueAsDate?.toISOString();
              if (iso !== undefined) {
                onChange({ ...value, to: iso });
              } else {
                onChange({ ...value, to: null });
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

function deDupe<T>(values: T[]): T[] {
  return [...new Set(values).values()];
}
