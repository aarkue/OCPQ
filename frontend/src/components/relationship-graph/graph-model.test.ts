import { describe, expect, it } from "vitest";
import { pinchDeltaY } from "@/lib/pinch-bridge";
import {
	boxExitFraction,
	fitView,
	type GraphState,
	hopRings,
	mergeGraphs,
	mixHex,
	neighbourhood,
	typeCounts,
	wheelZoomFactor,
	withoutTypes,
} from "./graph-model";

const order = { id: "o1", type: "orders", attributes: [] };
const item = { id: "i1", type: "items", attributes: [] };
const place = { id: "e1", type: "place order", time: "2023-04-03T10:08:00Z", attributes: [] };

const base: GraphState = {
	nodes: [order, place],
	links: [{ source: "e1", target: "o1", qualifier: "order" }],
	expanded: ["o1"],
};

describe("mergeGraphs", () => {
	it("adds only what is new", () => {
		const merged = mergeGraphs(base, {
			nodes: [order, item],
			links: [
				{ source: "e1", target: "o1", qualifier: "order" },
				{ source: "o1", target: "i1", qualifier: "comprises" },
			],
			expanded: ["o1", "e1"],
		});
		expect(merged.nodes.map((n) => n.id)).toEqual(["o1", "e1", "i1"]);
		expect(merged.links).toHaveLength(2);
		expect(merged.expanded).toEqual(["o1", "e1"]);
	});
	it("keeps a second qualifier between the same two nodes", () => {
		const merged = mergeGraphs(base, {
			nodes: [],
			links: [{ source: "e1", target: "o1", qualifier: "billed" }],
			expanded: [],
		});
		expect(merged.links).toHaveLength(2);
	});
});

describe("withoutTypes", () => {
	it("drops the nodes of hidden types and their links", () => {
		const g = withoutTypes(base, new Set(["place order"]));
		expect(g.nodes.map((n) => n.id)).toEqual(["o1"]);
		expect(g.links).toEqual([]);
	});
});

describe("typeCounts", () => {
	it("lists object types before event types", () => {
		expect(typeCounts([place, order, item, { ...item, id: "i2" }]).map((t) => t.type)).toEqual([
			"items",
			"orders",
			"place order",
		]);
	});
});

describe("neighbourhood", () => {
	it("follows links in both directions", () => {
		expect([...neighbourhood(base.links, "o1")].sort()).toEqual(["e1", "o1"]);
	});
});

describe("boxExitFraction", () => {
	it("hits the side the segment crosses first", () => {
		expect(boxExitFraction(100, 0, 20, 10)).toBeCloseTo(0.2);
		expect(boxExitFraction(0, 50, 20, 10)).toBeCloseTo(0.2);
		expect(boxExitFraction(100, 100, 20, 10)).toBeCloseTo(0.1);
	});
});

describe("mixHex", () => {
	it("blends channel by channel", () => {
		expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
		expect(mixHex("#d48a5c", "#ffffff", 1)).toBe("#d48a5c");
	});
});

describe("wheelZoomFactor", () => {
	it("zooms a mouse wheel notch by about 15%, with or without Ctrl", () => {
		expect(wheelZoomFactor(-100, 0, false)).toBeCloseTo(1.149, 3);
		expect(wheelZoomFactor(-100, 0, true)).toBeCloseTo(1.149, 3);
		expect(wheelZoomFactor(100, 0, true)).toBeCloseTo(1 / 1.149, 3);
		expect(wheelZoomFactor(-3, 1, false)).toBeCloseTo(1.11, 2);
	});

	it("follows a pinch exactly", () => {
		expect(wheelZoomFactor(pinchDeltaY(1.05), 0, true)).toBeCloseTo(1.05, 9);
		expect(wheelZoomFactor(pinchDeltaY(0.97), 0, true)).toBeCloseTo(0.97, 9);
	});
});

describe("fitView", () => {
	const none = { top: 0, right: 0, bottom: 0, left: 0 };
	it("zooms so the boxes fill the view", () => {
		const v = fitView([{ x: 0, y: 0, halfW: 50, halfH: 25 }], 400, 400, none, 10);
		expect(v).toEqual({ x: 0, y: 0, k: 4 });
	});
	it("stops at the maximum zoom", () => {
		expect(fitView([{ x: 0, y: 0, halfW: 50, halfH: 25 }], 400, 400, none, 1.5)?.k).toBe(1.5);
	});
	it("centers the boxes in the space the overlays leave", () => {
		const v = fitView([{ x: 0, y: 0, halfW: 50, halfH: 50 }], 200, 300, { ...none, top: 100 }, 10);
		// A 100px bar leaves 200x200 free, so zoom 2 puts the box center 50px below the middle.
		expect(v?.k).toBe(2);
		expect(v?.y).toBe(-25);
	});
	it("needs at least one box", () => {
		expect(fitView([], 100, 100, none, 1)).toBeUndefined();
	});
});

describe("hopRings", () => {
	const links = [
		{ source: "e1", target: "o1", qualifier: "" },
		{ source: "o1", target: "i1", qualifier: "" },
		{ source: "o1", target: "i2", qualifier: "" },
		{ source: "e1", target: "i1", qualifier: "" },
		{ source: "i1", target: "p1", qualifier: "" },
	];
	it("puts each node on the ring of its hop count", () => {
		const rings = hopRings(["o1", "e1", "i1", "i2", "p1", "lost"], links, "o1", 100, 200);
		expect(Object.fromEntries(rings.dist)).toEqual({ o1: 0, e1: 1, i1: 1, i2: 1, p1: 2 });
		expect(rings.parent.get("p1")).toBe("i1");
		expect(rings.order[0]).toBe("o1");
		expect(rings.dist.has("lost")).toBe(false);
	});
	it("widens a ring that holds more nodes than the gap leaves room for", () => {
		expect(hopRings(["o1", "e1", "i1", "i2", "p1"], links, "o1", 100, 200).radii).toEqual([
			0, 200, 400,
		]);
		const crowded = hopRings(["o1", "e1", "i1", "i2", "p1"], links, "o1", 1000, 200).radii;
		expect(crowded[1]).toBeCloseTo((3 * 1000) / (2 * Math.PI));
	});
	it("has no rings when the root is not shown", () => {
		expect(hopRings(["e1"], links, "o1", 100, 200).dist.size).toBe(0);
	});
	it("counts hops from the nearest of several roots, which share a ring of their own", () => {
		const rings = hopRings(["o1", "e1", "i1", "i2", "p1"], links, ["o1", "p1"], 100, 200);
		expect(Object.fromEntries(rings.dist)).toEqual({ o1: 0, p1: 0, e1: 1, i1: 1, i2: 1 });
		expect(rings.radii).toEqual([100, 300]);
	});
});
