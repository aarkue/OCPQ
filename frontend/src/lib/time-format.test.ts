import { describe, expect, it } from "vitest";
import { formatEventTime, formatGap } from "./time-format";

describe("formatEventTime", () => {
	it("keeps the logged wall time and drops zero seconds", () => {
		expect(formatEventTime("2023-04-03T10:08:00+02:00")).toBe("2023-04-03 10:08");
		expect(formatEventTime("2023-04-03T10:08:41.123Z")).toBe("2023-04-03 10:08:41");
	});
	it("returns anything else unchanged", () => {
		expect(formatEventTime("yesterday")).toBe("yesterday");
	});
});

describe("formatGap", () => {
	it("uses the two largest units", () => {
		expect(formatGap("2023-04-03T10:08:00Z", "2023-04-04T14:34:00Z")).toBe("+1 d 4 h");
		expect(formatGap("2023-04-03T10:08:00Z", "2023-04-03T11:20:00Z")).toBe("+1 h 12 min");
		expect(formatGap("2023-04-03T10:08:00Z", "2023-04-03T10:20:30Z")).toBe("+12 min");
		expect(formatGap("2023-04-03T10:08:00Z", "2023-04-03T10:08:09Z")).toBe("+9 s");
		expect(formatGap("2023-04-03T10:00:00Z", "2023-04-05T10:00:00Z")).toBe("+2 d");
	});
	it("compares instants, not wall times", () => {
		expect(formatGap("2023-04-03T10:00:00+02:00", "2023-04-03T09:00:00Z")).toBe("+1 h");
	});
	it("names simultaneous events", () => {
		expect(formatGap("2023-04-03T10:08:00Z", "2023-04-03T10:08:00Z")).toBe("same time");
	});
});
