import clsx from "clsx";
import type { ReactNode } from "react";
import { LuDelete } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ValueFilter } from "@/types/generated/ValueFilter";

export function ChildSetSelector({
	value,
	onChange,
	availableChildSets,
}: {
	value: string | undefined;
	onChange: (value: string | undefined) => unknown;
	availableChildSets: string[];
}) {
	const uniqueSorted = [...new Set(availableChildSets)].sort();
	return (
		<Combobox
			options={uniqueSorted.map((v) => ({ label: v, value: v }))}
			onChange={(val) => onChange(val !== "" ? val : undefined)}
			name="Child Set"
			title="Child Set"
			value={value ?? ""}
		/>
	);
}

export function AttributeNameSelector({
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
			options={availableAttributes.map((v) => ({ label: v, value: v }))}
			onChange={(val) => onChange(val !== "" ? val : undefined)}
			name="Attribute Name"
			value={value ?? ""}
		/>
	);
}

export function AttributeValueFilterSelector({
	value,
	onChange,
}: {
	value: ValueFilter | undefined;
	onChange: (value: ValueFilter | undefined) => unknown;
}) {
	const handleTypeChange = (val: string) => {
		if (val === "") {
			onChange(undefined);
			return;
		}
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
	};

	return (
		<div className="flex items-start gap-x-2">
			<Combobox
				options={["Float", "Integer", "Boolean", "String", "Time"].map((v) => ({
					label: v,
					value: v,
				}))}
				onChange={handleTypeChange}
				name="Attribute Type"
				title="Attribute Type"
				value={value?.type ?? "String"}
			/>
			{value?.type === "Boolean" && (
				<Label className="flex gap-x-2 items-center justify-center">
					<Checkbox
						checked={value.is_true}
						onCheckedChange={(c) => onChange({ ...value, is_true: Boolean(c) })}
					/>
					Should be {value.is_true ? "True" : "False"}
				</Label>
			)}
			{(value?.type === "Float" || value?.type === "Integer") && (
				<NumberRangeInput value={value} onChange={onChange} />
			)}
			{value?.type === "String" && <StringListInput value={value} onChange={onChange} />}
			{value?.type === "Time" && <TimeRangeInput value={value} onChange={onChange} />}
		</div>
	);
}

function NumberRangeInput({
	value,
	onChange,
}: {
	value: ValueFilter & { type: "Float" | "Integer" };
	onChange: (value: ValueFilter) => void;
}) {
	return (
		<div className="flex items-center gap-x-2">
			<Input
				title="Minimum (Optional)"
				placeholder="Minimum (Optional)"
				type="number"
				step={value.type === "Integer" ? 1 : undefined}
				value={value.min ?? ""}
				onChange={(ev) => {
					const val = ev.currentTarget.valueAsNumber;
					onChange({ ...value, min: Number.isFinite(val) ? val : null });
				}}
			/>
			{"-"}
			<Input
				title="Maximum (Optional)"
				placeholder="Maximum (Optional)"
				type="number"
				step={value.type === "Integer" ? 1 : undefined}
				value={value.max ?? ""}
				onChange={(ev) => {
					const val = ev.currentTarget.valueAsNumber;
					onChange({ ...value, max: Number.isFinite(val) ? val : null });
				}}
			/>
		</div>
	);
}

function StringListInput({
	value,
	onChange,
}: {
	value: ValueFilter & { type: "String" };
	onChange: (value: ValueFilter) => void;
}) {
	return (
		<div className="flex flex-col w-full -mt-6">
			<div className="h-6">Value should be in:</div>
			<div className="flex flex-col w-full gap-2 mb-2">
				{value.is_in.map((v, i) => (
					<div key={i} className="w-full flex items-center gap-x-2">
						<Input
							type="text"
							value={v}
							onChange={(ev) => {
								const newValues = [...value.is_in];
								newValues[i] = ev.currentTarget.value;
								onChange({ ...value, is_in: newValues });
							}}
						/>
						<Button
							className="shrink-0 w-6 h-6"
							size="icon"
							variant="outline"
							onClick={() => {
								const newValues = value.is_in.filter((_, idx) => idx !== i);
								onChange({ ...value, is_in: newValues });
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
					onClick={() => onChange({ ...value, is_in: [...value.is_in, ""] })}
				>
					Add Option
				</Button>
			</div>
		</div>
	);
}

function TimeRangeInput({
	value,
	onChange,
}: {
	value: ValueFilter & { type: "Time" };
	onChange: (value: ValueFilter) => void;
}) {
	return (
		<div>
			<Input
				type="datetime-local"
				value={value.from?.slice(0, 16) ?? ""}
				onChange={(ev) => {
					const iso = ev.currentTarget.valueAsDate?.toISOString();
					onChange({ ...value, from: iso ?? null });
				}}
			/>
			<Input
				type="datetime-local"
				value={value.to?.slice(0, 16) ?? ""}
				onChange={(ev) => {
					const iso = ev.currentTarget.valueAsDate?.toISOString();
					onChange({ ...value, to: iso ?? null });
				}}
			/>
		</div>
	);
}

export function MinMaxDisplayWithSugar({
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
	if (max === min && min !== null) {
		return (
			<>
				{children} = {min}
			</>
		);
	}
	if (max === null && min !== null) {
		return (
			<>
				{children} ≥ {min}
			</>
		);
	}
	if (min === null && max !== null) {
		return (
			<>
				{children} ≤ {max}
			</>
		);
	}
	if (rangeMode) {
		return (
			<>
				{min ?? 0} - {max ?? "∞"}
			</>
		);
	}
	return (
		<>
			{min ?? 0} ≤ {children} ≤ {max ?? "∞"}
		</>
	);
}

export function AttributeValueFilterDisplay({ value }: { value: ValueFilter }) {
	switch (value.type) {
		case "Float":
		case "Integer":
			return <MinMaxDisplayWithSugar min={value.min} max={value.max} rangeMode />;
		case "Boolean":
			return <span>{value.is_true ? "true" : "false"}</span>;
		case "String":
			return (
				<span className="text-xs tracking-tighter">
					{value.is_in.length > 1 ? "in " : ""}
					{value.is_in.join(", ")}
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

export function AbsolutePositionedSupportDisplay({
	support,
	text,
}: {
	support: number | null;
	text?: string;
}) {
	return (
		<div className="relative">
			<div className="absolute left-1/2 -translate-x-1/2 -bottom-12">
				<SupportDisplay support={support} text={text} />
			</div>
		</div>
	);
}

export function SupportDisplay({ support, text }: { support: number | null; text?: string }) {
	if (support === null) return null;

	return (
		<div
			className={clsx(
				"p-0.5 rounded text-sm w-fit whitespace-nowrap",
				support > 0 && "bg-green-200 text-green-800",
				support === 0 && "bg-red-200 text-red-800",
			)}
		>
			{support} {text ?? "Supporting Relations"}
		</div>
	);
}
