import clsx from "clsx";
import { type ReactNode, useContext, useState } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { Filter } from "@/types/generated/Filter";
import { VisualEditorContext } from "../../VisualEditorContext";
import { EventVarSelector } from "../FilterChooser";
import { EvVarName } from "../variable-names";
import {
	boundsOf,
	type Direction,
	DURATION_UNITS,
	endsAtSameTime,
	switchTiming,
	type Timing,
	type TimingKind,
	timingLabel,
	timingOf,
	timingSentence,
	unitFor,
} from "./time-between";
import type { FilterDisplayProps, FilterEditorProps } from "./types";

type TBE = Filter & { type: "TimeBetweenEvents" };

const KIND_LABELS: Record<TimingKind, string> = {
	any: "any time",
	atLeast: "at least",
	atMost: "at most",
	between: "between",
	within: "within",
	range: "from ... to",
};

const triggerClass =
	"h-9 w-auto gap-1.5 border-slate-300 bg-white px-2.5 font-semibold text-slate-900 shadow-xs";

function WordSelect<T extends string>({
	label,
	value,
	options,
	onChange,
	shown,
}: {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
	shown?: ReactNode;
}) {
	return (
		<Select value={value} onValueChange={(v) => onChange(v as T)}>
			<SelectTrigger aria-label={label} className={triggerClass}>
				<SelectValue>{shown}</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{options.map((o) => (
					<SelectItem key={o.value} value={o.value}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

const DIRECTIONS: { value: Direction; label: string }[] = [
	{ value: "after", label: "after" },
	{ value: "before", label: "before" },
];

/** A duration as a number and a unit. With `nullable`, an empty field means no limit. */
function DurationField({
	label,
	seconds,
	onChange,
	nullable = false,
}: {
	label: string;
	seconds: number | null;
	onChange: (seconds: number | null) => void;
	nullable?: boolean;
}) {
	const [unit, setUnit] = useState(() =>
		seconds === null || seconds === 0 ? DURATION_UNITS[3] : unitFor(seconds),
	);
	const [text, setText] = useState(() =>
		seconds === null ? "" : String(Math.round((Math.abs(seconds) / unit.seconds) * 1000) / 1000),
	);
	const emit = (t: string, u: typeof unit) => {
		const n = Math.abs(Number.parseFloat(t));
		if (Number.isNaN(n)) onChange(nullable ? null : 0);
		else onChange(n * u.seconds);
	};
	const singular = Number.parseFloat(text) === 1;
	return (
		<span className="flex h-9 items-center rounded-md border border-slate-300 bg-white shadow-xs focus-within:ring-2 focus-within:ring-sky-500">
			<input
				type="number"
				min={0}
				step="any"
				inputMode="decimal"
				aria-label={label}
				placeholder={nullable ? "no limit" : "0"}
				className="h-full w-16 rounded-l-md bg-transparent px-2 text-right text-sm tabular-nums text-slate-900 outline-none placeholder:text-slate-500"
				value={text}
				onChange={(ev) => {
					// The direction select gives the sign, so a typed minus is dropped from the field too.
					const t = ev.currentTarget.value.replace(/^-/, "");
					setText(t);
					emit(t, unit);
				}}
			/>
			<Select
				value={unit.unit}
				onValueChange={(v) => {
					const next = DURATION_UNITS.find((u) => u.unit === v) ?? unit;
					setUnit(next);
					emit(text, next);
				}}
			>
				<SelectTrigger
					aria-label={`${label} unit`}
					className="h-full w-auto gap-1 rounded-none rounded-r-md border-0 border-l border-slate-200 bg-slate-50 px-2 text-slate-700 shadow-none focus:ring-0"
				>
					<SelectValue>{singular ? unit.unit.slice(0, -1) : unit.unit}</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{DURATION_UNITS.map((u) => (
						<SelectItem key={u.unit} value={u.unit}>
							{u.unit}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</span>
	);
}

/** One end of a custom range: a duration before or after `from_event`, or no limit. */
function RangeBound({
	label,
	seconds,
	open,
	onChange,
}: {
	label: string;
	seconds: number | null;
	/** The side of `from_event` an empty bound leaves open, "before" for the earliest end. */
	open: Direction;
	onChange: (seconds: number | null) => void;
}) {
	const [direction, setDirection] = useState<Direction>(
		seconds === null ? open : seconds < 0 ? "before" : "after",
	);
	const [magnitude, setMagnitude] = useState(seconds === null ? null : Math.abs(seconds));
	const emit = (m: number | null, d: Direction) =>
		onChange(m === null ? null : d === "before" && m !== 0 ? -m : m);
	return (
		<>
			<DurationField
				label={label}
				nullable
				seconds={magnitude}
				onChange={(m) => {
					setMagnitude(m);
					emit(m, direction);
				}}
			/>
			<WordSelect
				label={`${label} direction`}
				value={direction}
				options={DIRECTIONS}
				onChange={(d) => {
					setDirection(d);
					emit(magnitude, d);
				}}
			/>
		</>
	);
}

export function TimeBetweenEventsEditor({
	value,
	updateValue,
	availableEventVars,
	nodeID,
}: FilterEditorProps<TBE>) {
	const { getVarName } = useContext(VisualEditorContext);
	// The sentence is kept as picked: "between 0 h and 2 d" stays a between even though it means
	// the same as "at most 2 d".
	const [timing, setTiming] = useState(() => timingOf(value.min_seconds, value.max_seconds));
	const set = (t: Timing) => {
		setTiming(t);
		updateValue({ ...value, ...boundsOf(t) });
	};
	const direction =
		"direction" in timing ? (
			<WordSelect
				label="Direction"
				value={timing.direction}
				options={DIRECTIONS}
				onChange={(d) => set({ ...timing, direction: d })}
			/>
		) : null;

	let middle: ReactNode;
	switch (timing.kind) {
		case "any":
			middle = direction;
			break;
		case "atLeast":
		case "atMost":
			middle = (
				<>
					<DurationField
						label={timing.kind === "atLeast" ? "Minimum" : "Maximum"}
						seconds={timing.seconds}
						onChange={(s) => set({ ...timing, seconds: s ?? 0 })}
					/>
					{direction}
				</>
			);
			break;
		case "between":
			middle = (
				<>
					<DurationField
						label="Shorter duration"
						seconds={timing.from}
						onChange={(s) => set({ ...timing, from: s ?? 0 })}
					/>
					<span>and</span>
					<DurationField
						label="Longer duration"
						seconds={timing.to}
						onChange={(s) => set({ ...timing, to: s ?? 0 })}
					/>
					{direction}
				</>
			);
			break;
		case "within":
			middle = (
				<>
					<DurationField
						label="Maximum"
						seconds={timing.seconds}
						onChange={(s) => set({ ...timing, seconds: s ?? 0 })}
					/>
					<span>of</span>
				</>
			);
			break;
		case "range":
			middle = (
				<>
					<RangeBound
						label="Earliest"
						open="before"
						seconds={timing.min}
						onChange={(min) => set({ ...timing, min })}
					/>
					<span>to</span>
					<RangeBound
						label="Latest"
						open="after"
						seconds={timing.max}
						onChange={(max) => set({ ...timing, max })}
					/>
				</>
			);
			break;
	}

	return (
		<div className="flex w-full flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
				<EventVarSelector
					nodeID={nodeID}
					eventVars={availableEventVars}
					value={value.to_event}
					onChange={(v) => v !== undefined && updateValue({ ...value, to_event: v })}
				/>
				<span>happens</span>
				<WordSelect
					label="Timing"
					value={timing.kind}
					options={(Object.keys(KIND_LABELS) as TimingKind[]).map((k) => ({
						value: k,
						label: KIND_LABELS[k],
					}))}
					onChange={(k) => set(switchTiming(timing, k))}
					shown={timing.kind === "range" ? "from" : KIND_LABELS[timing.kind]}
				/>
				{/* Remounts the fields on a kind switch, so their local text and unit start from what
				    switchTiming kept. */}
				<span key={timing.kind} className="contents">
					{middle}
				</span>
				<EventVarSelector
					nodeID={nodeID}
					eventVars={availableEventVars}
					value={value.from_event}
					onChange={(v) => v !== undefined && updateValue({ ...value, from_event: v })}
				/>
			</div>
			{endsAtSameTime(timing) && (
				<p className="text-xs text-slate-500">
					Includes {getVarName(value.to_event, "event").name} at the same time as{" "}
					{getVarName(value.from_event, "event").name}.
				</p>
			)}
			<div className="flex items-center gap-3 text-xs text-slate-500">
				Shown as
				<TimeBetweenEventsDisplay value={value} />
			</div>
		</div>
	);
}

function ArrowHead({ left = false }: { left?: boolean }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 6 8"
			className={clsx("h-2 w-1.5 fill-current", left && "-scale-x-100")}
		>
			<path d="M0 0 6 4 0 8z" />
		</svg>
	);
}

export function TimeBetweenEventsDisplay({ value }: FilterDisplayProps<TBE>) {
	const { getVarName } = useContext(VisualEditorContext);
	const timing = timingOf(value.min_seconds, value.max_seconds);
	const shown = timingLabel(timing);
	const sentence = timingSentence(
		timing,
		getVarName(value.to_event, "event").name,
		getVarName(value.from_event, "event").name,
	);
	if (shown.kind === "window") {
		return (
			<div
				className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap"
				title={sentence}
			>
				<EvVarName eventVar={value.to_event} />
				<span className="text-xs text-slate-500">in</span>
				<span className="flex items-center gap-x-0.5 rounded bg-slate-200/80 px-1 text-slate-400">
					<span className="text-xs font-semibold text-slate-700">{shown.before}</span>
					<ArrowHead left />
					<EvVarName eventVar={value.from_event} />
					<ArrowHead />
					<span className="text-xs font-semibold text-slate-700">{shown.after}</span>
				</span>
			</div>
		);
	}
	const { arrow, label } = shown;
	return (
		<div
			className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap"
			title={sentence}
		>
			<EvVarName eventVar={value.from_event} />
			<span className="flex items-center text-slate-400">
				{arrow !== "right" && <ArrowHead left />}
				<span
					aria-hidden="true"
					className={clsx("h-[1.5px] bg-current", label === undefined ? "w-5" : "w-1.5")}
				/>
				{label !== undefined && (
					<>
						<span className="rounded bg-slate-200/80 px-1 text-xs font-semibold text-slate-700">
							{label}
						</span>
						<span aria-hidden="true" className="h-[1.5px] w-1.5 bg-current" />
					</>
				)}
				{arrow !== "left" && <ArrowHead />}
			</span>
			<EvVarName eventVar={value.to_event} />
		</div>
	);
}
