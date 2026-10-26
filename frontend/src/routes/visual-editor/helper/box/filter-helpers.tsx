import { AttributeValueStats } from "@r4pm/components";
import { Cross2Icon } from "@radix-ui/react-icons";
import clsx from "clsx";
import { type ReactNode, useMemo, useState } from "react";
import { RxCheck, RxChevronUp } from "react-icons/rx";
import { R4pmIsland } from "@/components/r4pm/R4pmIsland";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Command, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { DateTimeRangeInput } from "@/components/ui/date-time-range-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { matchQualifiers } from "@/lib/variable-hints";
import type { OcelAttributeStats } from "@/types/generated/OcelAttributeStats";
import type { ValueFilter } from "@/types/generated/ValueFilter";

// Default Time value filter: "after" the start of the current year (UTC).
export function defaultTimeValueFilter(): ValueFilter & { type: "Time" } {
	const year = new Date().getFullYear();
	return { type: "Time", from: new Date(Date.UTC(year, 0, 1)).toISOString(), to: null };
}

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

const MAX_SHOWN_QUALIFIERS = 50;

/** `null` matches any qualifier. Free text stays possible because the suggestions only cover what
 *  the OCEL records for the variables' current types. `getSuggestions` runs once per opening. */
export function QualifierSelector({
	value,
	onChange,
	getSuggestions,
}: {
	value: string | null;
	onChange: (value: string | null) => unknown;
	getSuggestions: () => string[];
}) {
	const [suggestions, setSuggestions] = useState<string[]>();
	const [search, setSearch] = useState("");
	const open = suggestions !== undefined;
	const typed = search.trim();
	const { matches, more } = useMemo(
		() => matchQualifiers(suggestions ?? [], typed, MAX_SHOWN_QUALIFIERS),
		[suggestions, typed],
	);
	const setOpen = (o: boolean) => {
		if (o) {
			const all = getSuggestions();
			setSuggestions(value !== null && !all.includes(value) ? [...all, value] : all);
		} else {
			setSuggestions(undefined);
		}
		setSearch("");
	};
	const select = (qualifier: string | null) => {
		onChange(qualifier);
		setOpen(false);
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					title="Qualifier"
					className="w-full min-w-24 justify-between font-normal"
				>
					<span className={clsx("truncate", value === null && "text-muted-foreground")}>
						{value ?? "Any qualifier"}
					</span>
					<RxChevronUp className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-full min-w-fit p-0 max-h-[40vh] overflow-auto"
				side="bottom"
				align="start"
			>
				<Command shouldFilter={false}>
					<CommandInput
						placeholder="Search or enter qualifier..."
						value={search}
						onValueChange={setSearch}
					/>
					{more && (
						<p className="px-3 pt-2 text-xs text-muted-foreground">
							Showing the first {MAX_SHOWN_QUALIFIERS} matches. Keep typing to narrow them down.
						</p>
					)}
					<CommandGroup>
						{typed === "" && (
							<CommandItem value="any:" onSelect={() => select(null)}>
								<RxCheck className={clsx("mr-2 h-4 w-4", value !== null && "opacity-0")} />
								<span className="text-muted-foreground">Any qualifier</span>
							</CommandItem>
						)}
						{matches.map((q, i) => (
							// cmdk lowercases values, which would merge "Order" and "order".
							<CommandItem key={q} value={`q:${i}`} onSelect={() => select(q)}>
								<RxCheck className={clsx("mr-2 h-4 w-4", value !== q && "opacity-0")} />
								{q}
							</CommandItem>
						))}
						{typed !== "" && !(suggestions ?? []).includes(typed) && (
							<CommandItem value={`use:${typed}`} onSelect={() => select(typed)}>
								<RxCheck className="mr-2 h-4 w-4 opacity-0" />
								Use "{typed}"
							</CommandItem>
						)}
					</CommandGroup>
				</Command>
			</PopoverContent>
		</Popover>
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
	stat,
}: {
	value: ValueFilter | undefined;
	onChange: (value: ValueFilter | undefined) => unknown;
	/** Value distribution for the chosen attribute; renders an interactive histogram/selector. */
	stat?: OcelAttributeStats;
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
				return onChange(defaultTimeValueFilter());
		}
	};

	// When the numeric stats view is shown it already owns the min/max selection (histogram + slider
	// + inputs), so the standalone NumberRangeInput below would duplicate it.
	const statNumeric = stat && (stat.kind === "Float" || stat.kind === "Integer");

	return (
		<div className="flex w-full flex-col items-start gap-2">
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
			{stat && stat.kind !== "Empty" && (
				<R4pmIsland className="w-full">
					<div style={{ width: "100%", minWidth: 300 }}>
						<AttributeValueStats
							stat={stat}
							value={value as Parameters<typeof AttributeValueStats>[0]["value"]}
							onChange={(sel) => onChange(sel as ValueFilter)}
						/>
					</div>
				</R4pmIsland>
			)}
			{value?.type === "Boolean" && (
				<Label className="flex h-9 items-center gap-x-2">
					<Checkbox
						checked={value.is_true}
						onCheckedChange={(c) => onChange({ ...value, is_true: Boolean(c) })}
					/>
					Should be {value.is_true ? "True" : "False"}
				</Label>
			)}
			{(value?.type === "Float" || value?.type === "Integer") && !statNumeric && (
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
	const [text, setText] = useState("");
	const values = value.is_in.filter((v) => v !== "");

	const commit = (raw: string) => {
		const v = raw.trim();
		setText("");
		if (!v || values.includes(v)) return;
		onChange({ ...value, is_in: [...values, v] });
	};
	const removeAt = (i: number) => {
		onChange({ ...value, is_in: values.filter((_, idx) => idx !== i) });
	};

	return (
		<div className="flex w-72 flex-col gap-1">
			<span className="text-xs text-muted-foreground">Value is one of</span>
			<div className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-within:border-gray-500">
				{values.map((v, i) => (
					<Badge key={`${v}-${i}`} variant="secondary" className="gap-1 pr-1 font-normal">
						<span className="max-w-[12rem] truncate">{v}</span>
						<button
							type="button"
							aria-label={`Remove ${v}`}
							className="rounded-sm opacity-60 hover:opacity-100"
							onClick={() => removeAt(i)}
						>
							<Cross2Icon className="size-3" />
						</button>
					</Badge>
				))}
				<input
					type="text"
					className="min-w-[6rem] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
					placeholder={values.length === 0 ? "Type a value, press Enter" : ""}
					value={text}
					onChange={(ev) => setText(ev.currentTarget.value)}
					onKeyDown={(ev) => {
						if (ev.key === "Enter" || ev.key === ",") {
							ev.preventDefault();
							commit(text);
						} else if (ev.key === "Backspace" && text === "" && values.length > 0) {
							removeAt(values.length - 1);
						}
					}}
					onBlur={() => commit(text)}
				/>
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
		<DateTimeRangeInput
			from={value.from}
			to={value.to}
			onChange={({ from, to }) => onChange({ ...value, from, to })}
		/>
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
