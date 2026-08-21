import { afterEach, describe, expect, it } from "vitest";
import { createTauriBackend } from "./tauri-backend";

type Invocation = { cmd: string; args: unknown };

/**
 * Stand in for the globals the tauri webview injects, which this transport reaches directly rather
 * than through `@tauri-apps/api`.
 */
function stubInternals(respond: (cmd: string, args: unknown) => unknown): Invocation[] {
	const seen: Invocation[] = [];
	(globalThis as unknown as { window?: unknown }).window = {
		__TAURI_INTERNALS__: {
			invoke: async (cmd: string, args: unknown) => {
				seen.push({ cmd, args });
				return respond(cmd, args);
			},
			transformCallback: () => 0,
		},
	};
	return seen;
}

/** Mirrors the Rust `to_base64`, so these tests pin the same wire format the command produces. */
function encode(bytes: Uint8Array): string {
	let latin1 = "";
	for (const b of bytes) latin1 += String.fromCharCode(b);
	return btoa(latin1);
}

afterEach(() => {
	(globalThis as unknown as { window?: unknown }).window = undefined;
});

describe("export byte encoding", () => {
	// Tauri serialises a `Vec<u8>` result as a JSON array of decimal integers, ~3.3 bytes per
	// byte, which fails outright on a real log, so the commands hand back base64 instead.
	const CASES: [string, Uint8Array][] = [
		["empty", new Uint8Array()],
		["one byte, two pad chars", new Uint8Array([0x66])],
		["two bytes, one pad char", new Uint8Array([0x66, 0x6f])],
		["three bytes, no padding", new Uint8Array([0x66, 0x6f, 0x6f])],
		["bytes that are not valid utf-8", new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x80, 0xc0])],
		["every byte value", new Uint8Array(Array.from({ length: 256 }, (_v, i) => i))],
	];

	for (const [name, bytes] of CASES) {
		it(`round-trips ${name} through exportObject`, async () => {
			const seen = stubInternals(() => encode(bytes));
			const backend = createTauriBackend();

			const got = await backend.exportObject("ocel", "json");
			expect(Array.from(got)).toEqual(Array.from(bytes));
			expect(seen).toEqual([{ cmd: "export_object", args: { name: "ocel", format: "json" } }]);
		});

		it(`round-trips ${name} through exportArtifact`, async () => {
			stubInternals(() => encode(bytes));
			const got = await createTauriBackend().exportArtifact("net", "pnml");
			expect(Array.from(got)).toEqual(Array.from(bytes));
		});
	}

	// Pins the alphabet against the engine's, not just against this file's own encoder.
	it("decodes the standard alphabet, padding and all", async () => {
		stubInternals(() => "Zm9vYmFy");
		const got = await createTauriBackend().exportObject("ocel", "json");
		expect(new TextDecoder().decode(got)).toBe("foobar");
	});

	// The whole point: the payload has to stay proportional to the export, not ~3.3x it.
	it("carries one wire character per 0.75 exported bytes", async () => {
		const bytes = new Uint8Array(3000).fill(0xa5);
		let wire = "";
		stubInternals(() => {
			wire = encode(bytes);
			return wire;
		});

		const got = await createTauriBackend().exportObject("ocel", "json");
		expect(got.length).toBe(3000);
		expect(wire.length).toBe(4000);
	});

	it("returns a Uint8Array, so the BackendContext signature is unchanged", async () => {
		stubInternals(() => encode(new Uint8Array([1, 2, 3])));
		expect(await createTauriBackend().exportObject("ocel", "json")).toBeInstanceOf(Uint8Array);
	});

	it("round-trips through exportBindingsTable, with the ids and options as command args", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const seen = stubInternals(() => encode(bytes));
		const options = {
			includeViolationStatus: true,
			includeIds: true,
			omitHeader: false,
			labels: [],
			format: "CSV" as const,
		};

		const got = await createTauriBackend().exportBindingsTable("ocel", "eval", 0, options);

		expect(Array.from(got)).toEqual(Array.from(bytes));
		expect(seen).toEqual([
			{
				cmd: "export_bindings_table",
				args: { ocelId: "ocel", evalId: "eval", nodeIndex: 0, options },
			},
		]);
	});
});

describe("renameObject", () => {
	it("passes both ids to the rename command", async () => {
		const seen = stubInternals(() => null);
		await createTauriBackend().renameObject("extraction-scratch", "ocel");
		expect(seen).toEqual([
			{ cmd: "rename_object", args: { from: "extraction-scratch", to: "ocel" } },
		]);
	});
});
