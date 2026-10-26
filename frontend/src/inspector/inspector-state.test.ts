import { describe, expect, it } from "vitest";
import {
	DEFAULT_PINS,
	INITIAL_INSPECTOR,
	type InspectorAction,
	type InspectorState,
	inspectorReducer,
	isInspectorOpen,
	loadInspector,
	pinKey,
	saveInspector,
} from "./inspector-state";

const orders = { kind: "type", isEvent: false, name: "orders" } as const;
const o1 = { kind: "element", type: "object", id: "o1" } as const;

const run = (...actions: InspectorAction[]): InspectorState =>
	actions.reduce(inspectorReducer, INITIAL_INSPECTOR);

describe("inspectorReducer", () => {
	it("starts with the type graph and the log overview", () => {
		expect(INITIAL_INSPECTOR.pins.map((p) => pinKey(p.target))).toEqual([
			"type-graph",
			"log-overview",
		]);
	});

	it("adds new pins on top", () => {
		const s = run({ type: "pin", target: orders }, { type: "pin", target: o1 });
		expect(s.pins.map((p) => pinKey(p.target))).toEqual([
			"element:object:o1",
			"type:o:orders",
			"type-graph",
			"log-overview",
		]);
	});

	it("does not pin the same thing twice, and expands it instead", () => {
		const s = run(
			{ type: "pin", target: orders },
			{ type: "toggle-collapsed", key: pinKey(orders) },
			{ type: "pin", target: { ...orders } },
		);
		expect(s.pins.filter((p) => pinKey(p.target) === pinKey(orders))).toEqual([
			{ target: orders, collapsed: false },
		]);
	});

	it("asks to reveal what was pinned last, also when it was pinned before", () => {
		const s = run({ type: "pin", target: orders }, { type: "pin", target: o1 });
		expect(s.reveal).toEqual({ key: "element:object:o1", seq: 2 });
		expect(run({ type: "pin", target: orders }, { type: "pin", target: orders }).reveal).toEqual({
			key: "type:o:orders",
			seq: 2,
		});
	});

	it("keeps the type graph and the log overview pinned", () => {
		const s = run({ type: "unpin", key: "log-overview" }, { type: "unpin", key: "type-graph" });
		expect(s.pins).toEqual(DEFAULT_PINS);
	});

	it("unpins by key", () => {
		const s = run({ type: "pin", target: orders }, { type: "unpin", key: "type:o:orders" });
		expect(s.pins).toEqual(DEFAULT_PINS);
	});

	it("keys event and object types apart", () => {
		expect(pinKey({ kind: "type", isEvent: true, name: "x" })).not.toBe(
			pinKey({ kind: "type", isEvent: false, name: "x" }),
		);
	});

	it("is the default width until resized", () => {
		expect(INITIAL_INSPECTOR.width).toBeUndefined();
		expect(loadInspector(saveInspector(INITIAL_INSPECTOR)).width).toBeUndefined();
	});

	it("clamps the width", () => {
		expect(run({ type: "set-width", width: 10 }).width).toBe(280);
		expect(run({ type: "set-width", width: 5000 }).width).toBe(720);
	});

	it("goes back to the default pins on reset, keeping the panel layout", () => {
		const s = run(
			{ type: "set-width", width: 400 },
			{ type: "pin", target: o1 },
			{ type: "reset-pins" },
		);
		expect(s.pins).toEqual(DEFAULT_PINS);
		expect(s.width).toBe(400);
	});

	it("clears every card that can be unpinned and keeps how the overview cards are folded", () => {
		const s = run(
			{ type: "pin", target: o1 },
			{ type: "toggle-collapsed", key: "type-graph" },
			{ type: "clear" },
		);
		expect(s.pins).toEqual([
			{ target: { kind: "type-graph" }, collapsed: true },
			{ target: { kind: "log-overview" }, collapsed: false },
		]);
	});
});

describe("isInspectorOpen", () => {
	it("starts closed on OCEL Info, which shows the same overview, and open on Queries", () => {
		expect(isInspectorOpen(INITIAL_INSPECTOR, "/ocel-info")).toBe(false);
		expect(isInspectorOpen(INITIAL_INSPECTOR, "/constraints")).toBe(true);
	});

	it("remembers opening and closing per page", () => {
		const s = run(
			{ type: "set-open", open: true, page: "/ocel-info" },
			{ type: "set-open", open: false, page: "/constraints" },
		);
		expect(isInspectorOpen(s, "/ocel-info")).toBe(true);
		expect(isInspectorOpen(s, "/constraints")).toBe(false);
		expect(isInspectorOpen(s, "/oc-declare")).toBe(true);
	});

	it("opens on the page something is pinned from", () => {
		const s = run(
			{ type: "set-open", open: false, page: "/constraints" },
			{ type: "pin", target: orders, page: "/constraints" },
		);
		expect(isInspectorOpen(s, "/constraints")).toBe(true);
	});
});

describe("loadInspector", () => {
	it("restores a saved board", () => {
		const saved = run(
			{ type: "pin", target: orders },
			{ type: "set-open", open: false, page: "/constraints" },
		);
		expect(loadInspector(saveInspector(saved))).toEqual({ ...saved, reveal: undefined });
	});

	it("falls back to the initial board on missing or broken data", () => {
		expect(loadInspector(null)).toEqual(INITIAL_INSPECTOR);
		expect(loadInspector("{not json")).toEqual(INITIAL_INSPECTOR);
	});

	it("brings back the type graph and the log overview if a saved board lacks them", () => {
		const raw = JSON.stringify({ pins: [{ target: orders, collapsed: false }], width: 360 });
		expect(loadInspector(raw).pins.map((p) => pinKey(p.target))).toEqual([
			"type:o:orders",
			"type-graph",
			"log-overview",
		]);
	});

	it("puts the default cards last and in their default order", () => {
		const raw = JSON.stringify({
			pins: [
				{ target: { kind: "log-overview" }, collapsed: true },
				{ target: orders, collapsed: false },
				{ target: { kind: "type-graph" }, collapsed: false },
			],
		});
		expect(loadInspector(raw).pins).toEqual([
			{ target: orders, collapsed: false },
			{ target: { kind: "type-graph" }, collapsed: false },
			{ target: { kind: "log-overview" }, collapsed: true },
		]);
	});

	it("drops pins it cannot read and keeps the rest", () => {
		const raw = JSON.stringify({
			pins: [
				{ target: { kind: "nope" }, collapsed: false },
				{ target: orders, collapsed: true },
			],
			openOn: { "/constraints": true, "/graph": "yes" },
			width: 360,
		});
		expect(loadInspector(raw).pins).toEqual([{ target: orders, collapsed: true }, ...DEFAULT_PINS]);
		expect(loadInspector(raw).openOn).toEqual({ "/constraints": true });
	});
});

describe("result pins", () => {
	const result = {
		kind: "result",
		slot: "q0",
		nodeId: "n1",
		title: "Late payments · Box 1",
		mode: "violations",
	} as const;

	it("are keyed by slot and box, so re-pinning updates the mode instead of duplicating", () => {
		const s = run(
			{ type: "pin", target: result },
			{ type: "pin", target: { ...result, mode: "situations" } },
		);
		const results = s.pins.filter((p) => p.target.kind === "result");
		expect(results).toEqual([{ target: { ...result, mode: "situations" }, collapsed: false }]);
	});

	it("are not saved, since evaluations do not survive a reload", () => {
		const s = run({ type: "pin", target: result }, { type: "pin", target: orders });
		expect(loadInspector(saveInspector(s)).pins.map((p) => pinKey(p.target))).toEqual([
			"type:o:orders",
			"type-graph",
			"log-overview",
		]);
	});
});
