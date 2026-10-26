import { describe, expect, it } from "vitest";
import {
	currentInspected,
	EMPTY_INSPECT,
	type InspectAction,
	type InspectHistory,
	inspectReducer,
} from "./inspect";

const orders = { kind: "type", isEvent: false, name: "orders" } as const;
const o1 = { kind: "element", type: "object", id: "o1" } as const;
const e1 = { kind: "element", type: "event", id: "e1" } as const;

const run = (...actions: InspectAction[]): InspectHistory =>
	actions.reduce(inspectReducer, EMPTY_INSPECT);

describe("inspectReducer", () => {
	it("shows the latest target", () => {
		expect(currentInspected(run({ type: "show", target: orders }))).toEqual(orders);
		expect(currentInspected(EMPTY_INSPECT)).toBeUndefined();
	});

	it("goes back and forward", () => {
		let s = run({ type: "show", target: orders }, { type: "show", target: o1 }, { type: "back" });
		expect(currentInspected(s)).toEqual(orders);
		s = inspectReducer(s, { type: "forward" });
		expect(currentInspected(s)).toEqual(o1);
		expect(inspectReducer(s, { type: "forward" })).toBe(s);
	});

	it("drops the forward entries when showing something new after going back", () => {
		const s = run(
			{ type: "show", target: orders },
			{ type: "show", target: o1 },
			{ type: "back" },
			{ type: "show", target: e1 },
		);
		expect(s.entries).toEqual([orders, e1]);
	});

	it("does not record the current target twice", () => {
		expect(run({ type: "show", target: o1 }, { type: "show", target: { ...o1 } }).entries).toEqual([
			o1,
		]);
	});

	it("forgets everything on close", () => {
		expect(run({ type: "show", target: o1 }, { type: "close" })).toEqual(EMPTY_INSPECT);
	});
});
