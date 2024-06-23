import type { Constraint } from "@/types/generated/Constraint";
import type { Filter } from "@/types/generated/Filter";
import type { SizeFilter } from "@/types/generated/SizeFilter";
import { EventVarSelector, ObjectVarSelector } from "./FilterChooser";
import { Input } from "@/components/ui/input";
import TimeDurationInput, {
  formatSeconds,
} from "@/components/TimeDurationInput";
import { Combobox } from "@/components/ui/combobox";
import { EvVarName, ObVarName } from "./variable-names";
import { LuArrowRight, LuLink, LuTrash } from "react-icons/lu";
import { Button } from "@/components/ui/button";

export default function FilterOrConstraintEditor<
  T extends Filter | SizeFilter | Constraint,
>({
  value,
  updateValue,
  availableObjectVars,
  availableEventVars,
}: {
  value: T;
  updateValue: (value: T) => unknown;
  availableObjectVars: number[];
  availableEventVars: number[];
}) {
  switch (value.type) {
    case "O2E":
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
            durationSeconds={value.min_seconds ?? -Infinity}
            onChange={(newVal) => {
              if (isFinite(newVal)) {
                value.min_seconds = newVal;
                updateValue({ ...value });
              } else {
                value.min_seconds = null;
                updateValue({ ...value });
              }
            }}
          />
          <TimeDurationInput
            durationSeconds={value.max_seconds ?? Infinity}
            onChange={(newVal) => {
              if (isFinite(newVal)) {
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
            availableChildSets={[0, 1, 2, 3, 4, 5, 6,7,8,9,10,11,12,13,14]}
            value={value.child_index}
            onChange={(v) => {
              if (v !== undefined) {
                value.child_index = v;
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
        />
      );
    case "SAT":
      return <></>;
    case "NOT":
      return <></>;
    case "OR":
      return (
        <>
          {value.child_indices.map((c, i) => (
            <div key={i} className="flex gap-0.5 mr-2">
              <ChildSetSelector
                availableChildSets={[0, 1, 2, 3, 4, 5, 6,7,8,9,10,11,12,13,14]}
                value={c}
                onChange={(v) => {
                  if (v !== undefined) {
                    value.child_indices[i] = v;
                    updateValue({ ...value });
                  }
                }}
              />
            <Button size="icon" variant="outline" onClick={() => {
              value.child_indices.splice(i,1);
              updateValue({...value});
            }}><LuTrash/></Button>
            </div>
          ))}
          <Button
            onClick={() => {
              value.child_indices.push(0);
              updateValue({ ...value });
            }}
          >
            Add
          </Button>
        </>
      );
    case "AND":
      return <></>;
  }
}

export function FilterOrConstraintDisplay<
  T extends Filter | SizeFilter | Constraint,
>({ value }: { value: T }) {
  switch (value.type) {
    case "O2E":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm">
          <ObVarName obVar={value.object} /> <LuLink />{" "}
          <EvVarName eventVar={value.event} />{" "}
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
          <span className="ml-2 inline-flex items-center gap-x-1 text-xs">
            {formatSeconds(value.min_seconds ?? -Infinity)}{" "}
            <span className="mx-1">-</span>{" "}
            {formatSeconds(value.max_seconds ?? Infinity)}
          </span>
        </div>
      );
    case "NumChilds":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          {value.min ?? 0} ≤ |A{value.child_index}| ≤ {value.max ?? "∞"}
        </div>
      );
    case "Filter":
      return <FilterOrConstraintDisplay value={value.filter} />;
    case "SizeFilter":
      return <FilterOrConstraintDisplay value={value.filter} />;
    case "SAT":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          SAT({value.child_indices.map((i) => "A" + i).join(",")})
        </div>
      );
    case "NOT":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          NOT({value.child_indices.map((i) => "A" + i).join(",")})
        </div>
      );
    case "OR":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          OR({value.child_indices.map((i) => "A" + i).join(",")})
        </div>
      );
    case "AND":
      return (
        <div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
          AND({value.child_indices.map((i) => "A" + i).join(",")})
        </div>
      );
  }
}

function ChildSetSelector({
  value,
  onChange,
  availableChildSets,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => unknown;
  availableChildSets: number[];
}) {
  return (
    <Combobox
      options={availableChildSets.map((v) => ({
        label: "A" + v,
        value: `${v} --- A${v}}`,
      }))}
      onChange={(val) => {
        const newVar = parseInt(val.split(" --- ")[0]);
        if (isFinite(newVar)) {
          onChange(newVar);
        } else {
          onChange(undefined);
        }
      }}
      name={"Child Set"}
      value={value !== undefined ? `${value} --- A${value}}` : ""}
    />
  );
}