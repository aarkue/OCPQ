import { describe, expect, it } from "vitest";
import { wheelGesture } from "./wheel-gesture";

describe("wheelGesture", () => {
	it("keeps the mode a gesture started in until a pause", () => {
		const gesture = wheelGesture();
		const at = (timeStamp: number, ctrlKey: boolean) =>
			gesture({ timeStamp, ctrlKey, metaKey: false });
		expect([at(0, false), at(50, true), at(100, true)]).toEqual(["scroll", "scroll", "scroll"]);
		expect([at(400, true), at(450, false)]).toEqual(["zoom", "zoom"]);
	});
});
