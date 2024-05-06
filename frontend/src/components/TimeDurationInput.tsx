import { useEffect, useState } from "react";
import { Combobox } from "./ui/combobox";
import { Input } from "./ui/input";
export const TIME_DURATION_UNITS = [
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
  // "months",
  "years",
] as const;

function unitFactorFromSeconds(unit: (typeof TIME_DURATION_UNITS)[number]) {
  if (unit === "seconds") return 1;
  if (unit === "minutes") return 60;
  if (unit === "hours") return 60 * 60;
  if (unit === "days") return 24 * 60 * 60;
  if (unit === "weeks") return 7 * 24 * 60 * 60;
  // if (unit === "months") return 30 * 24 * 60 * 60;
  if (unit === "years") return 365 * 24 * 60 * 60;
  return 1;
}

export function getFittingUnit(seconds: number) {
  const reversedUnits = [...TIME_DURATION_UNITS];
  reversedUnits.reverse();
  for (const unit of reversedUnits) {
    const val = Math.abs(seconds / unitFactorFromSeconds(unit));
    if (val >= 1.0) {
      return unit;
    }
  }
  return "seconds";
}

export function formatSeconds(seconds: number) {
  if (seconds === Infinity) return "∞";
  if (seconds === -Infinity) return "-∞";
  if (seconds === 0) return "0";
  const reversedUnits = [...TIME_DURATION_UNITS];
  reversedUnits.reverse();
  for (const unit of reversedUnits) {
    const val = Math.abs(seconds / unitFactorFromSeconds(unit));
    if (val >= 1.0) {
      return (
        (Math.sign(seconds) * Math.round(val * 100)) / 100.0 +
        unit.substring(0, 1)
      );
    }
  }
  return Math.round(seconds * 100) / 100.0 + "s";
}

export default function TimeDurationInput({
  durationSeconds,
  onChange,
}: {
  durationSeconds: number;
  onChange: (newSeconds: number) => unknown;
}) {
  const [unit, setUnit] = useState<(typeof TIME_DURATION_UNITS)[number]>(
    getFittingUnit(durationSeconds),
  );

  const [value, setValue] = useState(
    durationSeconds / unitFactorFromSeconds(unit),
  );
  const [valueString, setValueString] = useState(
    value === Infinity ? "∞" : value === -Infinity ? "-∞" : value.toString(),
  );

  useEffect(() => {
    const value = durationSeconds / unitFactorFromSeconds(unit);
    setValue(value);
    setValueString(
      value === Infinity ? "∞" : value === -Infinity ? "-∞" : value.toString(),
    );
  }, [durationSeconds]);

  function handleValueChange(inputValue: string) {
    if (
      inputValue === "∞" ||
      inputValue === "inf" ||
      inputValue === "infinity"
    ) {
      setValue(Infinity);
      onChange(Infinity);
      setValueString("∞");
      return;
    }
    if (
      inputValue === "-∞" ||
      inputValue === "-inf" ||
      inputValue === "-infinity"
    ) {
      setValue(-Infinity);
      onChange(-Infinity);
      setValueString("-∞");
      return;
    }
    const val = parseFloat(inputValue);
    if (!isNaN(val)) {
      setValue(val);
      onChange(val * unitFactorFromSeconds(unit));
      setValueString(val.toString());
    }
  }

  return (
    <div className="flex gap-x-2 items-center">
      <Input
        className="w-full"
        onBlur={(ev) => {
          handleValueChange(ev.currentTarget.value);
        }}
        type="text"
        pattern="([0-9]|&#8734;)+"
        onChange={(ev) => {
          handleValueChange(ev.currentTarget.value);
          setValueString(ev.currentTarget.value);
        }}
        value={valueString}
      />
      <Combobox
        options={TIME_DURATION_UNITS.map((u) => ({ value: u, label: u }))}
        onChange={(newUnitIn) => {
          const newUnit = newUnitIn as (typeof TIME_DURATION_UNITS)[number];
          const convertedValue =
            value *
            (unitFactorFromSeconds(unit) / unitFactorFromSeconds(newUnit));
          setValue(convertedValue);
          setValueString(convertedValue.toString());
          setUnit(newUnit);
        }}
        name={"Unit"}
        value={unit}
      />
    </div>
  );
}
