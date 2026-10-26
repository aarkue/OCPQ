/** Where `to_event` lies relative to `from_event`. */
export type Direction = "after" | "before";

/**
 * A TBE filter as the editor's sentence: "e2 happens <timing> e1". The filter itself stores signed
 * bounds on `time(to_event) - time(from_event)`, which the sentence never shows.
 */
export type Timing =
	| { kind: "any"; direction: Direction }
	| { kind: "atLeast"; direction: Direction; seconds: number }
	| { kind: "atMost"; direction: Direction; seconds: number }
	| { kind: "between"; direction: Direction; from: number; to: number }
	| { kind: "within"; seconds: number }
	| { kind: "range"; min: number | null; max: number | null };

export type TimingKind = Timing["kind"];

const negate = (x: number) => (x === 0 ? 0 : -x);

export function timingOf(min: number | null, max: number | null): Timing {
	if (min !== null && min >= 0) {
		if (max === null) {
			return min === 0
				? { kind: "any", direction: "after" }
				: { kind: "atLeast", direction: "after", seconds: min };
		}
		if (max >= min) {
			return min === 0
				? { kind: "atMost", direction: "after", seconds: max }
				: { kind: "between", direction: "after", from: min, to: max };
		}
	}
	if (max !== null && max <= 0) {
		if (min === null) {
			return max === 0
				? { kind: "any", direction: "before" }
				: { kind: "atLeast", direction: "before", seconds: -max };
		}
		if (min <= max) {
			return max === 0
				? { kind: "atMost", direction: "before", seconds: -min }
				: { kind: "between", direction: "before", from: -max, to: -min };
		}
	}
	if (min !== null && max !== null && min < 0 && min === -max) {
		return { kind: "within", seconds: max };
	}
	return { kind: "range", min, max };
}

export function boundsOf(t: Timing): { min_seconds: number | null; max_seconds: number | null } {
	const signed = (
		after: [number | null, number | null],
		before: [number | null, number | null],
	) => {
		const [min_seconds, max_seconds] =
			"direction" in t && t.direction === "before" ? before : after;
		return { min_seconds, max_seconds };
	};
	switch (t.kind) {
		case "any":
			return signed([0, null], [null, 0]);
		case "atLeast":
			return signed([t.seconds, null], [null, negate(t.seconds)]);
		case "atMost":
			return signed([0, t.seconds], [negate(t.seconds), 0]);
		case "between": {
			const lo = Math.min(t.from, t.to);
			const hi = Math.max(t.from, t.to);
			return signed([lo, hi], [negate(hi), negate(lo)]);
		}
		case "within":
			return { min_seconds: negate(t.seconds), max_seconds: t.seconds };
		case "range":
			return { min_seconds: t.min, max_seconds: t.max };
	}
}

const HOUR = 3600;
const DAY = 24 * HOUR;

/** The same filter as another kind, keeping the durations that still make sense. */
export function switchTiming(t: Timing, kind: TimingKind): Timing {
	if (kind === t.kind) return t;
	if (kind === "range") {
		const { min_seconds, max_seconds } = boundsOf(t);
		return { kind, min: min_seconds, max: max_seconds };
	}
	const direction: Direction = "direction" in t ? t.direction : "after";
	const shorter =
		t.kind === "atLeast" ? t.seconds : t.kind === "between" ? Math.min(t.from, t.to) : undefined;
	const longer =
		t.kind === "atMost" || t.kind === "within"
			? t.seconds
			: t.kind === "between"
				? Math.max(t.from, t.to)
				: undefined;
	switch (kind) {
		case "any":
			return { kind, direction };
		case "atLeast":
			return { kind, direction, seconds: shorter ?? HOUR };
		case "atMost":
			return { kind, direction, seconds: longer ?? DAY };
		case "between": {
			const from = shorter ?? HOUR;
			return {
				kind,
				direction,
				from,
				to: longer !== undefined && longer > from ? longer : from + DAY,
			};
		}
		case "within":
			return { kind, seconds: longer ?? DAY };
	}
}

export const DURATION_UNITS = [
	{ unit: "years", short: "y", seconds: 365 * DAY },
	{ unit: "weeks", short: "w", seconds: 7 * DAY },
	{ unit: "days", short: "d", seconds: DAY },
	{ unit: "hours", short: "h", seconds: HOUR },
	{ unit: "minutes", short: "min", seconds: 60 },
	{ unit: "seconds", short: "s", seconds: 1 },
] as const;

export type DurationUnit = (typeof DURATION_UNITS)[number];

/** The largest unit that shows `seconds` as a whole number, so 10 days stay "10 d" and not "1.43 w". */
export function unitFor(seconds: number): DurationUnit {
	const abs = Math.abs(seconds);
	const whole = DURATION_UNITS.find((u) => {
		const n = abs / u.seconds;
		return n >= 1 && Math.abs(n - Math.round(n)) < 1e-9;
	});
	return (
		whole ??
		DURATION_UNITS.find((u) => abs >= u.seconds) ??
		DURATION_UNITS[DURATION_UNITS.length - 1]
	);
}

export function formatDuration(seconds: number): string {
	const u = unitFor(seconds);
	return `${Math.round((seconds / u.seconds) * 100) / 100} ${u.short}`;
}

export type TimingLabel =
	| { kind: "arrow"; arrow: "right" | "left" | "both"; label?: string }
	/** `to_event` in a window around `from_event`, reaching `before` back and `after` ahead. */
	| { kind: "window"; before: string; after: string };

/** How a box shows the filter: an arrow from `from_event` to `to_event` that points the way time
 *  runs, or a window around `from_event` when `to_event` may fall on both sides of it. */
export function timingLabel(t: Timing): TimingLabel {
	const arrow = "direction" in t ? (t.direction === "after" ? "right" : "left") : "both";
	switch (t.kind) {
		case "any":
			return { kind: "arrow", arrow };
		case "atLeast":
			return { kind: "arrow", arrow, label: `≥ ${formatDuration(t.seconds)}` };
		case "atMost":
		case "within":
			return { kind: "arrow", arrow, label: `≤ ${formatDuration(t.seconds)}` };
		case "between":
			return {
				kind: "arrow",
				arrow,
				label: `${formatDuration(Math.min(t.from, t.to))} to ${formatDuration(Math.max(t.from, t.to))}`,
			};
		case "range":
			// timingOf gives every one-sided range another kind. Here an open end has its bound on the
			// other side of from_event, and two bounds lie on both sides of it or contradict each other.
			if (t.min !== null && t.max !== null) {
				return t.min < 0 && t.max > 0
					? { kind: "window", before: formatDuration(-t.min), after: formatDuration(t.max) }
					: { kind: "arrow", arrow, label: "never" };
			}
			if (t.max !== null)
				return { kind: "arrow", arrow, label: `≤ ${formatDuration(t.max)} after` };
			if (t.min !== null)
				return { kind: "arrow", arrow, label: `≤ ${formatDuration(-t.min)} before` };
			return { kind: "arrow", arrow };
	}
}

/** Whether the allowed range ends exactly at zero, so events at the same time count without the
 *  sentence saying so. */
export function endsAtSameTime(t: Timing): boolean {
	const { min_seconds, max_seconds } = boundsOf(t);
	return min_seconds === 0 || max_seconds === 0;
}

/** The filter in words, e.g., "e2 at most 10 d after e1". */
export function timingSentence(t: Timing, to: string, from: string): string {
	const rel = (d: Direction) => `${d} ${from}`;
	switch (t.kind) {
		case "any":
			return `${to} at or ${rel(t.direction)}`;
		case "atLeast":
			return `${to} at least ${formatDuration(t.seconds)} ${rel(t.direction)}`;
		case "atMost":
			return `${to} at most ${formatDuration(t.seconds)} ${rel(t.direction)}`;
		case "between":
			return `${to} ${formatDuration(Math.min(t.from, t.to))} to ${formatDuration(Math.max(t.from, t.to))} ${rel(t.direction)}`;
		case "within":
			return `${to} within ${formatDuration(t.seconds)} of ${from}`;
		case "range": {
			if (t.min === null && t.max === null) return `${to} any time around ${from}`;
			const bound = (s: number) => `${formatDuration(Math.abs(s))} ${s < 0 ? "before" : "after"}`;
			const lo = t.min === null ? "any time before" : bound(t.min);
			const hi = t.max === null ? "any time after" : bound(t.max);
			return `${to} from ${lo} to ${hi} ${from}`;
		}
	}
}
