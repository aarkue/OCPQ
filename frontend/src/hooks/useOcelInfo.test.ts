import { describe, expect, it } from "vitest";
import { createBackendProvider } from "@/BackendProviderContext";
import type { BackendContext, LoadedObject } from "@/bindings/backend-context";

/** The sidebar reads `ocelInfoQuery.isSuccess` as "backend online", so `ocel/info` has to keep
 *  three cases apart: a loaded log, a reachable backend with nothing loaded, and an unreachable
 *  backend. Exercised through the real provider, since a fake that stands in for `ocel/info` itself
 *  would skip the very logic under test. */
function backendWith({
	objects,
	info,
}: {
	objects: () => Promise<LoadedObject[]>;
	info?: () => Promise<unknown>;
}): BackendContext {
	return {
		kind: "http",
		ready: async () => undefined,
		callBinding: (async (id: string) => {
			if (id === "app_bindings::ocel::ocel_info") return await (info ?? (async () => ({})))();
			throw new Error(`unexpected binding ${id}`);
		}) as unknown as BackendContext["callBinding"],
		listObjects: objects,
	} as unknown as BackendContext;
}

const ocelObject = { id: "ocel", kind: "SlimLinkedOCEL" } as unknown as LoadedObject;

/** What the query layer does, and why: react-query fails a query resolving `undefined`. */
const asQueryFn = (p: ReturnType<typeof createBackendProvider>) => async () =>
	(await p["ocel/info"]()) ?? null;

describe("ocel/info as a liveness signal", () => {
	it("returns the info when a log is loaded", async () => {
		const provider = createBackendProvider(
			backendWith({ objects: async () => [ocelObject], info: async () => ({ num_events: 3 }) }),
		);
		expect(await asQueryFn(provider)()).toEqual({ num_events: 3 });
	});

	it("resolves null -- not undefined -- when reachable but nothing is loaded", async () => {
		const provider = createBackendProvider(backendWith({ objects: async () => [] }));
		const result = await asQueryFn(provider)();
		expect(result).toBeNull();
		expect(result).not.toBeUndefined();
	});

	it("REJECTS when the backend is unreachable, so offline stays detectable", async () => {
		const provider = createBackendProvider(
			backendWith({
				objects: async () => {
					throw new TypeError("Failed to fetch");
				},
			}),
		);
		await expect(asQueryFn(provider)()).rejects.toThrow("Failed to fetch");
	});
});
