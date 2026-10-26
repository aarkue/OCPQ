import { describe, expect, it } from "vitest";
import {
	boundsOf,
	endsAtSameTime,
	formatDuration,
	switchTiming,
	type Timing,
	timingLabel,
	timingOf,
	timingSentence,
	unitFor,
} from "./time-between";

const H = 3600;
const D = 24 * H;

describe("timingOf and boundsOf", () => {
	const cases: [string, number | null, number | null, Timing][] = [
		["any time after", 0, null, { kind: "any", direction: "after" }],
		["any time before", null, 0, { kind: "any", direction: "before" }],
		["at least after", H, null, { kind: "atLeast", direction: "after", seconds: H }],
		["at least before", null, -H, { kind: "atLeast", direction: "before", seconds: H }],
		["at most after", 0, 14 * D, { kind: "atMost", direction: "after", seconds: 14 * D }],
		["at most before", -2 * D, 0, { kind: "atMost", direction: "before", seconds: 2 * D }],
		["between after", H, 14 * D, { kind: "between", direction: "after", from: H, to: 14 * D }],
		["between before", -3 * D, -D, { kind: "between", direction: "before", from: D, to: 3 * D }],
		["within", -2 * D, 2 * D, { kind: "within", seconds: 2 * D }],
		["asymmetric range", -D, 5 * D, { kind: "range", min: -D, max: 5 * D }],
		["only a maximum", null, 14 * D, { kind: "range", min: null, max: 14 * D }],
		["only a negative minimum", -D, null, { kind: "range", min: -D, max: null }],
		["no bounds", null, null, { kind: "range", min: null, max: null }],
	];
	for (const [name, min, max, timing] of cases) {
		it(`reads and writes ${name}`, () => {
			expect(timingOf(min, max)).toEqual(timing);
			expect(boundsOf(timing)).toEqual({ min_seconds: min, max_seconds: max });
		});
	}

	it("accepts the two durations of between in either order", () => {
		expect(boundsOf({ kind: "between", direction: "after", from: 14 * D, to: H })).toEqual({
			min_seconds: H,
			max_seconds: 14 * D,
		});
	});

	it("never writes negative zero", () => {
		const { min_seconds, max_seconds } = boundsOf({
			kind: "atMost",
			direction: "before",
			seconds: 0,
		});
		expect(Object.is(min_seconds, -0)).toBe(false);
		expect(Object.is(max_seconds, -0)).toBe(false);
	});
});

describe("switchTiming", () => {
	const between: Timing = { kind: "between", direction: "before", from: H, to: 14 * D };

	it("keeps the durations and direction that still apply", () => {
		expect(switchTiming(between, "atLeast")).toEqual({
			kind: "atLeast",
			direction: "before",
			seconds: H,
		});
		expect(switchTiming(between, "atMost")).toEqual({
			kind: "atMost",
			direction: "before",
			seconds: 14 * D,
		});
		expect(switchTiming(between, "within")).toEqual({ kind: "within", seconds: 14 * D });
		expect(switchTiming({ kind: "within", seconds: D }, "any")).toEqual({
			kind: "any",
			direction: "after",
		});
	});

	it("keeps the meaning when switching to a custom range", () => {
		expect(switchTiming(between, "range")).toEqual({ kind: "range", min: -14 * D, max: -H });
	});

	it("makes a valid between from a single bound", () => {
		expect(
			switchTiming({ kind: "atMost", direction: "after", seconds: 30 * 60 }, "between"),
		).toEqual({
			kind: "between",
			direction: "after",
			from: H,
			to: H + D,
		});
	});
});

describe("formatting", () => {
	it("picks the largest unit that shows a whole number", () => {
		expect(formatDuration(14 * D)).toBe("2 w");
		expect(formatDuration(10 * D)).toBe("10 d");
		expect(formatDuration(36 * H)).toBe("36 h");
		expect(formatDuration(90 * 60)).toBe("90 min");
		expect(formatDuration(0)).toBe("0 s");
		expect(unitFor(1.5).unit).toBe("seconds");
	});

	it("draws an arrow the way time runs", () => {
		expect(timingLabel(timingOf(0, 14 * D))).toEqual({
			kind: "arrow",
			arrow: "right",
			label: "≤ 2 w",
		});
		expect(timingLabel(timingOf(-3 * D, -D))).toEqual({
			kind: "arrow",
			arrow: "left",
			label: "1 d to 3 d",
		});
		expect(timingLabel(timingOf(-2 * D, 2 * D))).toEqual({
			kind: "arrow",
			arrow: "both",
			label: "≤ 2 d",
		});
		expect(timingLabel(timingOf(0, null))).toEqual({ kind: "arrow", arrow: "right" });
		expect(timingLabel(timingOf(null, null))).toEqual({ kind: "arrow", arrow: "both" });
	});

	it("names the bounded side of a range with one open end", () => {
		expect(timingLabel(timingOf(null, 14 * D))).toEqual({
			kind: "arrow",
			arrow: "both",
			label: "≤ 2 w after",
		});
		expect(timingLabel(timingOf(-D, null))).toEqual({
			kind: "arrow",
			arrow: "both",
			label: "≤ 1 d before",
		});
	});

	it("shows a range on both sides as a window around from_event", () => {
		expect(timingLabel(timingOf(-H, D))).toEqual({ kind: "window", before: "1 h", after: "1 d" });
	});

	it("flags a range that cannot match", () => {
		expect(timingLabel(timingOf(5 * D, D))).toEqual({
			kind: "arrow",
			arrow: "both",
			label: "never",
		});
	});

	it("says what the filter keeps", () => {
		expect(timingSentence(timingOf(H, 10 * D), "e2", "e1")).toBe("e2 1 h to 10 d after e1");
		expect(timingSentence(timingOf(null, -H), "e2", "e1")).toBe("e2 at least 1 h before e1");
		expect(timingSentence(timingOf(null, 14 * D), "e2", "e1")).toBe(
			"e2 from any time before to 2 w after e1",
		);
		expect(timingSentence(timingOf(null, null), "e2", "e1")).toBe("e2 any time around e1");
		expect(timingSentence(timingOf(0, null), "e2", "e1")).toBe("e2 at or after e1");
	});

	it("knows when the same time counts without the sentence saying so", () => {
		expect(endsAtSameTime(timingOf(0, null))).toBe(true);
		expect(endsAtSameTime(timingOf(-2 * D, 0))).toBe(true);
		expect(endsAtSameTime(timingOf(H, D))).toBe(false);
		expect(endsAtSameTime(timingOf(-D, D))).toBe(false);
	});
});
