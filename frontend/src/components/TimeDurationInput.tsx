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

export function formatSeconds(seconds: number, inftysymbol = "∞", minusinftysymbol = "-∞") {
	if (seconds === Number.POSITIVE_INFINITY) return inftysymbol;
	if (seconds === Number.NEGATIVE_INFINITY) return minusinftysymbol;
	if (seconds === 0) return "0";
	const reversedUnits = [...TIME_DURATION_UNITS];
	reversedUnits.reverse();
	for (const unit of reversedUnits) {
		const val = Math.abs(seconds / unitFactorFromSeconds(unit));
		if (val >= 1.0) {
			return (Math.sign(seconds) * Math.round(val * 100)) / 100.0 + unit.substring(0, 1);
		}
	}
	return `${Math.round(seconds * 100) / 100.0}s`;
}

export default function TimeDurationInput({
	durationSeconds,
	onChange,
	placeholder,
}: {
	durationSeconds: number;
	onChange: (newSeconds: number | undefined) => unknown;
	placeholder?: string;
}) {
	const [unit, setUnit] = useState<(typeof TIME_DURATION_UNITS)[number]>(
		getFittingUnit(durationSeconds),
	);

	const [value, setValue] = useState(durationSeconds / unitFactorFromSeconds(unit));
	const [valueString, setValueString] = useState(
		value === Number.POSITIVE_INFINITY
			? "∞"
			: value === Number.NEGATIVE_INFINITY
				? "-∞"
				: value.toString(),
	);

	useEffect(() => {
		const value = durationSeconds / unitFactorFromSeconds(unit);
		setValue(value);
		setValueString(
			value === Number.POSITIVE_INFINITY
				? "∞"
				: value === Number.NEGATIVE_INFINITY
					? "-∞"
					: value.toString(),
		);
	}, [durationSeconds, unit]);

	function handleValueChange(inputValue: string, useUnit = unit) {
		inputValue = inputValue.toLowerCase();
		if (inputValue === "∞" || inputValue === "inf" || inputValue === "infinity") {
			setValue(Number.POSITIVE_INFINITY);
			onChange(Number.POSITIVE_INFINITY);
			setValueString("∞");
			return;
		}
		if (inputValue === "-∞" || inputValue === "-inf" || inputValue === "-infinity") {
			setValue(Number.NEGATIVE_INFINITY);
			onChange(Number.NEGATIVE_INFINITY);
			setValueString("-∞");
			return;
		}
		const val = Number.parseFloat(inputValue);
		if (!Number.isNaN(val)) {
			setValue(val);
			onChange(val * unitFactorFromSeconds(useUnit));
			setValueString(val.toString());
		} else {
			setValueString("");
			onChange(undefined);
		}
	}

	return (
		<div className="flex gap-x-2 items-center">
			<Input
				placeholder={placeholder}
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
					console.log({ newUnit, value, unit });
					// const convertedValue =
					//   value *
					//   (unitFactorFromSeconds(unit) / unitFactorFromSeconds(newUnit));
					// setValue(convertedValue);
					// setValueString(convertedValue.toString());
					setUnit(newUnit);
					handleValueChange(value.toString(), newUnit);
				}}
				name={"Unit"}
				value={unit}
			/>
		</div>
	);
}
