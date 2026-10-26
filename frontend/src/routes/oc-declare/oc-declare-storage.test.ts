import { describe, expect, it } from "vitest";
import { removeOrphanedOCDeclareData } from "./oc-declare-storage";

function fakeStorage(keys: string[]) {
	const items = new Map(keys.map((k) => [k, "{}"]));
	return {
		get length() {
			return items.size;
		},
		key: (i: number) => [...items.keys()][i] ?? null,
		removeItem: (k: string) => void items.delete(k),
		keys: () => [...items.keys()],
	};
}

describe("removeOrphanedOCDeclareData", () => {
	it("removes flows of models that no longer exist and keeps everything else", () => {
		const storage = fakeStorage([
			"oced-ocdeclare-meta",
			"oced-ocdeclare-dataa",
			"oced-ocdeclare-datagone",
			"oced-ocdeclare-dataalso-gone",
			"oced-declare-data",
			"ocpq-inspector",
		]);
		expect(removeOrphanedOCDeclareData(["a"], storage)).toBe(2);
		expect(storage.keys()).toEqual([
			"oced-ocdeclare-meta",
			"oced-ocdeclare-dataa",
			"oced-declare-data",
			"ocpq-inspector",
		]);
	});

	it("removes every flow once all models are gone", () => {
		const storage = fakeStorage([
			"oced-ocdeclare-datax",
			"oced-ocdeclare-datay",
			"oced-ocdeclare-meta",
		]);
		removeOrphanedOCDeclareData([], storage);
		expect(storage.keys()).toEqual(["oced-ocdeclare-meta"]);
	});
});
