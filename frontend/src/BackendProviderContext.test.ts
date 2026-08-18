import { describe, expect, it } from "vitest";
import { createBackendProvider, OCEL_ID, ocelUploadFormat } from "./BackendProviderContext";
import type { BackendContext, LoadedObject } from "./bindings/backend-context";
import type { BindingId } from "./bindings/generated";

type Call = { id: BindingId; args: Record<string, unknown>; outputName?: string };

type FakeOptions = {
	/** Handler per binding id; anything unlisted throws, like an engine with no such object. */
	bindings?: Partial<Record<string, (args: unknown) => unknown>>;
	objects?: LoadedObject[];
};

type Fake = {
	backend: BackendContext;
	calls: Call[];
	loaded: string[];
	unloaded: string[];
	renamed: [string, string][];
};

const OCEL_INFO = {
	num_objects: 3,
	num_events: 7,
	object_types: [],
	event_types: [],
	e2o_types: {},
	o2o_types: {},
};

function makeFake(options: FakeOptions = {}): Fake {
	const calls: Call[] = [];
	const loaded: string[] = [];
	const unloaded: string[] = [];
	const renamed: [string, string][] = [];
	const handlers = options.bindings ?? {};

	const backend: BackendContext = {
		kind: "http",
		ready: Promise.resolve(),
		callBinding: (async (id: BindingId, args: unknown, opts?: { outputName?: string }) => {
			calls.push({ id, args: args as Record<string, unknown>, outputName: opts?.outputName });
			const handler = handlers[id];
			if (handler === undefined) throw new Error(`no such binding: ${id}`);
			return handler(args);
		}) as BackendContext["callBinding"],
		listObjects: async () => options.objects ?? [],
		listFunctions: async () => [],
		listItemKinds: async () => [],
		loadItem: async (id, _kind, _data, format) => {
			loaded.push(`${id}:${format}`);
		},
		exportObject: async () => new Uint8Array(),
		unloadObject: async (name) => {
			unloaded.push(name);
		},
		renameObject: async (from, to) => {
			renamed.push([from, to]);
		},
		setLabel: async () => undefined,
		loadArtifactBytes: async () => undefined,
		listArtifacts: async () => [],
		getArtifact: async () => undefined,
		unloadArtifact: async () => undefined,
		exportArtifact: async () => new Uint8Array(),
		saveBytes: async () => undefined,
	};

	return { backend, calls, loaded, unloaded, renamed };
}

describe("ocelUploadFormat", () => {
	it("maps every sqlite spelling onto the one format token", () => {
		expect(ocelUploadFormat("log.sqlite")).toBe("sqlite");
		expect(ocelUploadFormat("log.sqlite3")).toBe("sqlite");
		expect(ocelUploadFormat("LOG.DB")).toBe("sqlite");
	});

	it("keeps the compression suffix so a gzipped log is not read as plain", () => {
		expect(ocelUploadFormat("log.json")).toBe("json");
		expect(ocelUploadFormat("log.json.gz")).toBe("json.gz");
		expect(ocelUploadFormat("log.xml.gz")).toBe("xml.gz");
	});
});

describe("ocel/info", () => {
	// A caller-named output keeps the default `Primary` role, so the listing does show a freshly
	// extracted log. It used to be stamped `Result`, which `get_objects_with_type` hides -- that is
	// what once made this report "nothing loaded" for a log that was right there.
	it("returns the info when the listing shows the log", async () => {
		const fake = makeFake({
			objects: [{ id: OCEL_ID, kind: "SlimLinkedOCEL" }],
			bindings: { "app_bindings::ocel::ocel_info": () => OCEL_INFO },
		});
		const provider = createBackendProvider(fake.backend);

		await expect(provider["ocel/info"]()).resolves.toEqual(OCEL_INFO);
		expect(fake.calls.map((c) => c.id)).toContain("app_bindings::ocel::ocel_info");
	});

	it("passes the fixed OCEL handle, so it asks about the log the rest of the UI uses", async () => {
		const fake = makeFake({
			objects: [{ id: OCEL_ID, kind: "SlimLinkedOCEL" }],
			bindings: { "app_bindings::ocel::ocel_info": () => OCEL_INFO },
		});
		await createBackendProvider(fake.backend)["ocel/info"]();
		expect(fake.calls[0].args).toEqual({ ocel: OCEL_ID });
	});

	it("reports undefined when nothing is loaded, without calling the binding", async () => {
		const fake = makeFake({ objects: [] });
		await expect(createBackendProvider(fake.backend)["ocel/info"]()).resolves.toBeUndefined();
		expect(fake.calls).toHaveLength(0);
	});

	it("softens the failure only for the presence-probing keys, not for the rest", async () => {
		const fake = makeFake({});
		await expect(createBackendProvider(fake.backend)["ocel/stats"]()).resolves.toBeUndefined();
		await expect(createBackendProvider(fake.backend)["ocel/sample-ids"](10)).rejects.toThrow();
	});
});

describe("ocel/upload-from-xes", () => {
	// The engine reads `xes` into the object-centric kinds itself, so this is one import and no
	// scratch handle: it used to load an `EventLog`, flatten it through a binding, link the result
	// and unload two intermediates, any of which could leave a stray object behind.
	it("imports the file straight into the fixed OCEL id and returns its info", async () => {
		const fake = makeFake({ bindings: { "app_bindings::ocel::ocel_info": () => OCEL_INFO } });
		const provider = createBackendProvider(fake.backend);

		await expect(
			provider["ocel/upload-from-xes"]?.(new File(["<log/>"], "log.xes")),
		).resolves.toEqual(OCEL_INFO);
		expect(fake.loaded).toEqual([`${OCEL_ID}:xes`]);
		expect(fake.calls.map((c) => c.id)).toEqual(["app_bindings::ocel::ocel_info"]);
		expect(fake.unloaded).toEqual([]);
	});

	it("keeps the compression suffix, so a gzipped log is not read as plain xml", async () => {
		const fake = makeFake({ bindings: { "app_bindings::ocel::ocel_info": () => OCEL_INFO } });
		await createBackendProvider(fake.backend)["ocel/upload-from-xes"]?.(
			new File(["<log/>"], "log.xes.gz"),
		);
		expect(fake.loaded).toEqual([`${OCEL_ID}:xes.gz`]);
	});
});

describe("ocel/check-constraints-box", () => {
	// `output_id` is the binding's own argument, so the evaluation lands under the id the reader
	// bindings are given without going through the transports' separate output-name channel.
	it("names the stored evaluation through the binding's own argument", async () => {
		const fake = makeFake({
			bindings: {
				"app_bindings::query::check_constraints_box": () => "eval",
				"app_bindings::query::eval_summary": () => ({ nodeSummaries: [] }),
			},
		});

		await createBackendProvider(fake.backend)["ocel/check-constraints-box"]({} as never);
		expect(fake.calls[0].args).toMatchObject({ ocel: OCEL_ID, output_id: "eval" });
		expect(fake.calls[0].outputName).toBeUndefined();
		// The OCEL rides along so the reader can refuse an evaluation produced from a different one.
		expect(fake.calls[1].args).toEqual({ ocel: OCEL_ID, eval: "eval" });
	});
});

describe("data-extraction/execute", () => {
	const SCRATCH = "extraction-scratch";
	const LOCEL_NEW = "process_mining::bindings::slim_ocel_bindings::locel_new";
	const RUN = "process_mining::bindings::extraction_dbcon_bindings::extraction_run";

	// `extraction_run` fills its `ocel` argument in place and rejects a non-empty log, so a fresh
	// one has to be minted before the run -- but under a scratch id, so the loaded log is only
	// replaced by a run that actually finished.
	it("runs into a scratch log and renames it onto the fixed id on success", async () => {
		const report = { object_types: [], event_types: [] };
		const fake = makeFake({
			bindings: { [LOCEL_NEW]: () => SCRATCH, [RUN]: () => report },
		});

		const result = await createBackendProvider(fake.backend)["data-extraction/execute"](
			{} as never,
			{ src: "sqlite:///x.sqlite" },
		);

		expect(result).toEqual({ report });
		expect(fake.calls.map((c) => c.id)).toEqual([LOCEL_NEW, RUN]);
		expect(fake.calls[0].args).toEqual({ output_id: SCRATCH });
		expect(fake.calls[1].args).toMatchObject({
			ocel: SCRATCH,
			connections: { src: "sqlite:///x.sqlite" },
		});
		expect(fake.renamed).toEqual([[SCRATCH, OCEL_ID]]);
		expect(fake.unloaded).toEqual([]);
	});

	// Regression: the run used to be minted straight over the fixed id, so a blueprint that failed
	// part-way left the app holding an empty log in place of the one the user had.
	it("leaves the loaded log alone and drops the scratch when the run fails", async () => {
		const fake = makeFake({
			bindings: {
				[LOCEL_NEW]: () => SCRATCH,
				[RUN]: () => {
					throw new Error("table not found");
				},
			},
		});

		await expect(
			createBackendProvider(fake.backend)["data-extraction/execute"]({} as never, {}),
		).rejects.toThrow("table not found");
		expect(fake.renamed).toEqual([]);
		expect(fake.unloaded).toEqual([SCRATCH]);
	});

	// The run's error is what the user needs to see, so a scratch that will not unload must not
	// replace it with a cleanup failure.
	it("reports the run's error even when the scratch cannot be unloaded", async () => {
		const fake = makeFake({
			bindings: {
				[LOCEL_NEW]: () => SCRATCH,
				[RUN]: () => {
					throw new Error("table not found");
				},
			},
		});
		fake.backend.unloadObject = async () => {
			throw new Error("unload failed");
		};

		await expect(
			createBackendProvider(fake.backend)["data-extraction/execute"]({} as never, {}),
		).rejects.toThrow("table not found");
	});

	it("does not run the blueprint when minting the scratch log fails", async () => {
		const fake = makeFake({ bindings: { [RUN]: () => ({}) } });

		await expect(
			createBackendProvider(fake.backend)["data-extraction/execute"]({} as never, {}),
		).rejects.toThrow();
		expect(fake.calls.map((c) => c.id)).not.toContain(RUN);
		expect(fake.renamed).toEqual([]);
	});
});

describe("optional provider keys", () => {
	it("omits what the transport cannot do, rather than exposing a key that throws", () => {
		const provider = createBackendProvider(makeFake().backend);
		expect(provider["ocel/available"]).toBeUndefined();
		expect(provider["ocel/picker"]).toBeUndefined();
		expect(provider["pick-file"]).toBeUndefined();
		expect(provider["check-for-updates"]).toBeUndefined();
	});

	it("exposes the local-log pair only when the transport has both halves", () => {
		const half = makeFake();
		half.backend.listLocalItems = async () => ["a.json"];
		expect(createBackendProvider(half.backend)["ocel/available"]).toBeUndefined();

		const full = makeFake({ bindings: { "app_bindings::ocel::ocel_info": () => OCEL_INFO } });
		full.backend.listLocalItems = async () => ["a.json"];
		full.backend.loadLocalItem = async (id) => {
			full.loaded.push(id);
		};
		expect(createBackendProvider(full.backend)["ocel/available"]).toBeDefined();
	});

	it("loads a local log under the fixed id and answers with its info", async () => {
		const fake = makeFake({ bindings: { "app_bindings::ocel::ocel_info": () => OCEL_INFO } });
		fake.backend.listLocalItems = async () => ["a.json"];
		fake.backend.loadLocalItem = async (id, _kind, name) => {
			fake.loaded.push(`${id}:${name}`);
		};

		const provider = createBackendProvider(fake.backend);
		await expect(provider["ocel/load"]?.("a.json")).resolves.toEqual(OCEL_INFO);
		expect(fake.loaded).toEqual([`${OCEL_ID}:a.json`]);
	});

	it("fails the picker instead of loading nothing when the dialog is cancelled", async () => {
		const fake = makeFake();
		fake.backend.loadItemPath = async (id) => {
			fake.loaded.push(id);
		};
		fake.backend.pickFiles = async () => null;

		await expect(createBackendProvider(fake.backend)["ocel/picker"]?.()).rejects.toThrow(
			"No file selected",
		);
		expect(fake.loaded).toEqual([]);
	});

	// A picked `.xes` used to take its own route through an `EventLog` and a flatten binding; the
	// engine reads it as an OCEL kind now, so there is one path for every file the picker offers.
	it("loads a picked xes path the same way as any other log", async () => {
		const fake = makeFake({ bindings: { "app_bindings::ocel::ocel_info": () => OCEL_INFO } });
		fake.backend.loadItemPath = async (id, kind, path) => {
			fake.loaded.push(`${id}:${kind}:${path}`);
		};

		const provider = createBackendProvider(fake.backend);
		await expect(provider["ocel/picker"]?.("/logs/a.xes")).resolves.toEqual(OCEL_INFO);
		await provider["ocel/picker"]?.("/logs/b.json");
		expect(fake.loaded).toEqual([
			`${OCEL_ID}:SlimLinkedOCEL:/logs/a.xes`,
			`${OCEL_ID}:SlimLinkedOCEL:/logs/b.json`,
		]);
		expect(fake.calls.map((c) => c.id)).toEqual([
			"app_bindings::ocel::ocel_info",
			"app_bindings::ocel::ocel_info",
		]);
	});
});

describe("ocel/eval-results/page", () => {
	// `PaginatedBindingTable` matches this exact message to offer a re-run, so the translation
	// from the engine's wording has to survive.
	it("translates a stale-version error into the sentinel the table matches on", async () => {
		const fake = makeFake({
			bindings: {
				"app_bindings::query::eval_results_page": () => {
					throw new Error("evaluation is out of date: stale eval_version 3 != 4");
				},
			},
		});

		await expect(
			createBackendProvider(fake.backend)["ocel/eval-results/page"]({} as never),
		).rejects.toThrow("STALE_EVAL_VERSION");
	});

	it("passes any other error through unchanged", async () => {
		const fake = makeFake({
			bindings: {
				"app_bindings::query::eval_results_page": () => {
					throw new Error("no such object: eval");
				},
			},
		});

		await expect(
			createBackendProvider(fake.backend)["ocel/eval-results/page"]({} as never),
		).rejects.toThrow("no such object: eval");
	});
});

describe("ocel/export-filter-box", () => {
	// The binding stores a `SlimLinkedOCEL`, which the registry exports through `construct_ocel`,
	// so the handle it yields is exported as-is with no follow-up link call.
	it("exports the handle the binding yields, with no second call", async () => {
		const fake = makeFake({
			bindings: { "app_bindings::query::export_filter_box": () => "filtered" },
		});
		fake.backend.exportObject = async (name, format) =>
			new TextEncoder().encode(`${name}:${format}`);

		const blob = await createBackendProvider(fake.backend)["ocel/export-filter-box"](
			{} as never,
			"JSON",
		);
		expect(await blob?.text()).toBe("filtered:json");
		expect(fake.calls.map((c) => c.id)).toEqual(["app_bindings::query::export_filter_box"]);
		expect(fake.unloaded).toEqual(["filtered"]);
	});

	it("unloads the filtered log even when the export throws", async () => {
		const fake = makeFake({
			bindings: { "app_bindings::query::export_filter_box": () => "filtered" },
		});
		fake.backend.exportObject = async () => {
			throw new Error("export failed");
		};

		await expect(
			createBackendProvider(fake.backend)["ocel/export-filter-box"]({} as never, "JSON"),
		).rejects.toThrow("export failed");
		expect(fake.unloaded).toEqual(["filtered"]);
	});
});
