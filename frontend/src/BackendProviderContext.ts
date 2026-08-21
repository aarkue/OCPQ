import type {
	Blueprint as ExtractionBlueprint,
	ExtractionCatalog,
	ExtractionReport,
	ValidationError as ExtractionValidationError,
} from "@r4pm/components/extraction-blueprint";
import { createContext } from "react";
import type { BackendContext, UpdateInfo } from "./bindings/backend-context";
import type {
	AutoDiscoverConstraintsRequest as BindingAutoDiscoverRequest,
	Blueprint as BindingBlueprint,
	ExtractionCatalog as BindingCatalog,
	EvalPageRequest as BindingEvalPageRequest,
	OCDeclareDiscoveryOptions as BindingOCDeclareDiscoveryOptions,
	OCELGraphOptions as BindingOCELGraphOptions,
	PathEnumerateOptions as BindingPathEnumerateOptions,
	PathSchemaDetailOptions as BindingPathSchemaDetailOptions,
	PathSchemaOptions as BindingPathSchemaOptions,
	EvaluateBoxTreeResultHandle,
	SlimLinkedOCELHandle,
} from "./bindings/generated";
import { createHttpBackend } from "./bindings/http-backend";
import type { OCDeclareDiscoveryOptions } from "./routes/oc-declare/flow/OCDeclareDiscoveryButton";
import type { OCDeclareArc } from "./routes/oc-declare/types/OCDeclareArc";
import type {
	DiscoverConstraintsRequest,
	DiscoverConstraintsResponse,
} from "./routes/visual-editor/helper/types";
import type { DBTranslationInput } from "./types/DBTranslationInput";
import type { ActivityStatistics } from "./types/generated/ActivityStatistics";
import type { AttrScope } from "./types/generated/AttrScope";
import type { BindingBoxTree } from "./types/generated/BindingBoxTree";
import type { BinnedEdgeDurationStats } from "./types/generated/BinnedEdgeDurationStats";
import type { EvalPageRequest } from "./types/generated/EvalPageRequest";
import type { EvalPageResponse } from "./types/generated/EvalPageResponse";
import type { EvaluateBoxTreeSummary } from "./types/generated/EvaluateBoxTreeSummary";
import type { OCELGraphOptions } from "./types/generated/OCELGraphOptions";
import type { OCELTypeStats } from "./types/generated/OCELTypeStats";
import type { OCPQJobOptions } from "./types/generated/OCPQJobOptions";
import type { OcelAttributeStats } from "./types/generated/OcelAttributeStats";
import type { PathEnumerateOptions } from "./types/generated/PathEnumerateOptions";
import type { PathSchemaDetail } from "./types/generated/PathSchemaDetail";
import type { PathSchemaDetailOptions } from "./types/generated/PathSchemaDetailOptions";
import type { PathSchemaInfo } from "./types/generated/PathSchemaInfo";
import type { PathSchemaOptions } from "./types/generated/PathSchemaOptions";
import type { PathSchemaResult } from "./types/generated/PathSchemaResult";
import type { PathTypeGraph } from "./types/generated/PathTypeGraph";
import type { TableExportOptions } from "./types/generated/TableExportOptions";
import type { ConnectionConfig, JobStatus } from "./types/hpc-backend";
import type { OCELEvent, OCELInfo, OCELObject, SampleIds } from "./types/ocel";

export type { UpdateInfo } from "./bindings/backend-context";

/** Derive the OCEL import format token (backend suffix match) from a file name. CSV gets an
 *  "ocel." prefix to avoid colliding with the data-extraction blueprint's raw-table CSV format. */
export function ocelUploadFormat(fileName: string): string {
	const name = fileName.toLowerCase();
	if (name.endsWith(".sqlite") || name.endsWith(".sqlite3") || name.endsWith(".db")) {
		return "sqlite";
	}
	if (name.endsWith(".csv.gz")) {
		return "ocel.csv.gz";
	}
	if (name.endsWith(".csv")) {
		return "ocel.csv";
	}
	const suffix = name.endsWith(".gz")
		? name.split(".").slice(-2).join(".")
		: (name.split(".").pop() ?? "");
	return suffix;
}

/** Source id -> `dbcon` connection string. Never part of a blueprint, always a separate argument. */
export type ExtractionConnections = Record<string, string>;

/** `ocpq_shared::extraction::ExecuteExtractionResponse`, hand-written since `ExtractionReport` is
 *  `Serialize`-only and its TS shape already comes from `@r4pm/components`. */
export type ExecuteExtractionResponse = { report: ExtractionReport };

export type BackendProvider = {
	"ocel/info": () => Promise<OCELInfo | undefined>;
	"ocel/stats": () => Promise<OCELTypeStats | undefined>;
	"ocel/attribute-stats": (
		scope: AttrScope,
		type: string,
		attribute: string,
	) => Promise<OcelAttributeStats | undefined>;
	"ocel/sample-ids": (limit: number) => Promise<SampleIds | null>;
	"ocel/upload"?: (file: File) => Promise<OCELInfo>;
	"ocel/upload-from-xes"?: (file: File) => Promise<OCELInfo>;
	"ocel/available"?: () => Promise<string[]>;
	"ocel/load"?: (name: string) => Promise<OCELInfo>;
	"ocel/unload"?: () => Promise<void>;
	"ocel/picker"?: (path?: string) => Promise<OCELInfo>;
	"ocel/check-constraints-box": (
		tree: BindingBoxTree,
		measurePerformance?: boolean,
	) => Promise<EvaluateBoxTreeSummary>;
	"ocel/eval-results/page": (req: EvalPageRequest) => Promise<EvalPageResponse>;
	"ocel/export": (format: "XML" | "JSON" | "SQLITE") => Promise<Blob | undefined>;
	"ocel/export-filter-box": (
		tree: BindingBoxTree,
		format: "XML" | "JSON" | "SQLITE",
	) => Promise<Blob | undefined>;
	"ocel/discover-constraints": (
		autoDiscoveryOptions: DiscoverConstraintsRequest,
	) => Promise<DiscoverConstraintsResponse>;
	"ocel/export-bindings": (
		nodeIndex: number,
		options: TableExportOptions,
	) => Promise<Blob | undefined>;
	"ocel/graph": (options: OCELGraphOptions) => Promise<{
		nodes: (OCELEvent | OCELObject)[];
		links: { source: string; target: string; qualifier: string }[];
	}>;
	"ocel/path-schemas/type-graph": () => Promise<PathTypeGraph>;
	"ocel/path-schemas/enumerate": (options: PathEnumerateOptions) => Promise<PathSchemaInfo[]>;
	"ocel/path-schemas/discover": (options: PathSchemaOptions) => Promise<PathSchemaResult>;
	"ocel/path-schemas/schema-detail": (
		options: PathSchemaDetailOptions,
	) => Promise<PathSchemaDetail>;
	"ocel/get-object": (
		specifier: { id: string } | { index: number },
	) => Promise<{ index: number; object: OCELObject }>;
	"ocel/get-event": (
		specifier: { id: string } | { index: number },
	) => Promise<{ index: number; event: OCELEvent }>;
	"hpc/login": (connectionConfig: ConnectionConfig) => Promise<void>;
	"hpc/start": (jobOptions: OCPQJobOptions) => Promise<string>;
	"hpc/job-status": (jobID: string) => Promise<JobStatus>;
	"download-blob": (blob: Blob, fileName: string) => unknown;
	"ocel/create-db-query": (req: DBTranslationInput) => Promise<string>;
	// Register drag/drop listener, returns unregister function
	"drag-drop-listener"?: (
		f: (
			args: { type: "enter"; path: string } | { type: "leave" } | { type: "drop"; path: string },
		) => unknown,
	) => Promise<() => unknown>;
	"ocel/get-initial-files"?: () => Promise<string[]>;
	/** Open a native file picker dialog, returns selected path or null */
	"pick-file"?: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>;
	"oc-declare/template-string": (arcs: OCDeclareArc[]) => Promise<string>;
	"check-for-updates"?: () => Promise<UpdateInfo | null>;
	restart?: () => Promise<void>;
	"get-version"?: () => Promise<string>;
	"ocel/discover-oc-declare": (options: OCDeclareDiscoveryOptions) => Promise<OCDeclareArc[]>;
	"ocel/evaluate-oc-declare-arcs": (arcs: OCDeclareArc[]) => Promise<number[]>;
	/** Lossless projection of arcs onto a subset of activities (folds removed activities' constraints
	 *  into the survivors). */
	"ocel/project-oc-declare-arcs": (
		arcs: OCDeclareArc[],
		activities: string[],
	) => Promise<OCDeclareArc[]>;
	"ocel/get-activity-statistics": (activity: string) => Promise<ActivityStatistics>;
	"ocel/get-oc-declare-edge-statistics": (edge: OCDeclareArc) => Promise<BinnedEdgeDurationStats>;
	/** The source kinds this build's connector can open (`dbcon` backend ids). */
	"data-extraction/connection-kinds": () => Promise<string[]>;
	/** Connect to every source in `connections` and merge the discovered schemas into one catalog. */
	"data-extraction/discover-catalog": (
		connections: ExtractionConnections,
	) => Promise<ExtractionCatalog>;
	/** The distinct values of one column, for the editor's value pickers. */
	"data-extraction/column-domain": (
		connections: ExtractionConnections,
		sourceId: string,
		table: string,
		column: string,
	) => Promise<string[]>;
	/** Check a blueprint against a catalog. Touches no connection. */
	"data-extraction/validate": (
		blueprint: ExtractionBlueprint,
		catalog: ExtractionCatalog,
	) => Promise<ExtractionValidationError[]>;
	/** Run a blueprint and load the result as the current log. `connections` is separate so a saved
	 *  or exported blueprint can never contain a secret. */
	"data-extraction/execute": (
		blueprint: ExtractionBlueprint,
		connections: ExtractionConnections,
	) => Promise<ExecuteExtractionResponse>;
};

export async function warnForNoBackendProvider<T>(): Promise<T> {
	console.warn("No BackendProviderContext!");
	return await new Promise<T>((_resolve, reject) => {
		reject(Error("No BackendProviderContext"));
	});
}

export const ErrorBackendContext: BackendProvider = {
	"ocel/info": warnForNoBackendProvider,
	"ocel/stats": warnForNoBackendProvider,
	"ocel/attribute-stats": warnForNoBackendProvider,
	"ocel/sample-ids": warnForNoBackendProvider,
	"ocel/check-constraints-box": warnForNoBackendProvider,
	"ocel/eval-results/page": warnForNoBackendProvider,
	"ocel/create-db-query": warnForNoBackendProvider,
	"ocel/export": warnForNoBackendProvider,
	"ocel/export-filter-box": warnForNoBackendProvider,
	"oc-declare/template-string": warnForNoBackendProvider,
	"ocel/discover-constraints": warnForNoBackendProvider,
	"ocel/export-bindings": warnForNoBackendProvider,
	"ocel/graph": warnForNoBackendProvider,
	"ocel/path-schemas/type-graph": warnForNoBackendProvider,
	"ocel/path-schemas/enumerate": warnForNoBackendProvider,
	"ocel/path-schemas/discover": warnForNoBackendProvider,
	"ocel/path-schemas/schema-detail": warnForNoBackendProvider,
	"ocel/get-event": warnForNoBackendProvider,
	"ocel/get-object": warnForNoBackendProvider,
	"hpc/login": warnForNoBackendProvider,
	"hpc/start": warnForNoBackendProvider,
	"hpc/job-status": warnForNoBackendProvider,
	"download-blob": warnForNoBackendProvider,
	"ocel/discover-oc-declare": warnForNoBackendProvider,
	"ocel/evaluate-oc-declare-arcs": warnForNoBackendProvider,
	"ocel/project-oc-declare-arcs": warnForNoBackendProvider,
	"ocel/get-activity-statistics": warnForNoBackendProvider,
	"ocel/get-oc-declare-edge-statistics": warnForNoBackendProvider,
	"data-extraction/connection-kinds": warnForNoBackendProvider,
	"data-extraction/discover-catalog": warnForNoBackendProvider,
	"data-extraction/column-domain": warnForNoBackendProvider,
	"data-extraction/validate": warnForNoBackendProvider,
	"data-extraction/execute": warnForNoBackendProvider,
};

export const BackendProviderContext = createContext<BackendProvider>(ErrorBackendContext);

export const DEFAULT_BACKEND_URL = "http://localhost:3000";

/** Registry handle of the log the whole UI works on. OCPQ has exactly one "current" OCEL, so it
 *  gets one fixed id instead of a handle threaded through every call site. */
export const OCEL_ID = "ocel";
const OCEL = OCEL_ID as SlimLinkedOCELHandle;

/** The registry kind the current log is stored as. */
const OCEL_KIND = "SlimLinkedOCEL";

/** Where an extraction run builds its log, so a failed run cannot destroy the loaded one. */
const EXTRACTION_SCRATCH_ID = "extraction-scratch";

/** Registry handle of the latest evaluation, keyed like the log: the UI holds exactly one. */
const EVAL_ID = "eval";
const EVAL = EVAL_ID as EvaluateBoxTreeResultHandle;

const EXPORT_FORMAT = { XML: "xml", JSON: "json", SQLITE: "sqlite" } as const;

const TABLE_MIME: Record<TableExportOptions["format"], string> = {
	CSV: "text/csv",
	XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const MIME: Record<"XML" | "JSON" | "SQLITE", string> = {
	XML: "text/xml",
	JSON: "application/json",
	SQLITE: "application/vnd.sqlite3",
};

/** ts-rs (app) and schemars (bindings) generate structurally different types for the same Rust
 *  structs, so the boundary needs a cast rather than a conversion. */
function twin<T>(value: unknown): T {
	return value as T;
}

/** Implement the UI-facing provider on top of one transport. */
export function createBackendProvider(backend: BackendContext): BackendProvider {
	const call = backend.callBinding;

	/** Check via `listObjects()` rather than try/catch around the read: a caught transport error
	 *  would be indistinguishable from "no log loaded" and falsely report the backend as offline. */
	const ifLoaded = async <T>(f: () => Promise<T>): Promise<T | undefined> => {
		const loaded = (await backend.listObjects()).some((o) => o.id === OCEL_ID);
		return loaded ? await f() : undefined;
	};

	const info = async (): Promise<OCELInfo> =>
		twin(await call("app_bindings::ocel::ocel_info", { ocel: OCEL }));

	const loadFile = async (file: File, format: string): Promise<OCELInfo> => {
		const bytes = new Uint8Array(await file.arrayBuffer());
		await backend.loadItem(OCEL_ID, OCEL_KIND, bytes, format);
		return await info();
	};

	const provider: BackendProvider = {
		"ocel/info": () => ifLoaded(info),
		"ocel/stats": () =>
			ifLoaded(async () =>
				twin<OCELTypeStats>(await call("app_bindings::ocel::ocel_stats", { ocel: OCEL })),
			),
		"ocel/attribute-stats": async (scope, type, attribute) =>
			twin(
				await call("app_bindings::ocel::ocel_attribute_stats", {
					ocel: OCEL,
					scope,
					type_name: type,
					attribute,
				}),
			),
		"ocel/sample-ids": async (limit) =>
			twin(await call("app_bindings::ocel::ocel_sample_ids", { ocel: OCEL, limit })),
		"ocel/unload": () => backend.unloadObject(OCEL_ID),
		"ocel/upload": (file) => loadFile(file, ocelUploadFormat(file.name)),
		"ocel/upload-from-xes": (file) => loadFile(file, file.name.endsWith(".gz") ? "xes.gz" : "xes"),
		"ocel/check-constraints-box": async (tree, measurePerformance) => {
			const evaluation = await call("app_bindings::query::check_constraints_box", {
				ocel: OCEL,
				tree: twin(tree),
				measure_performance: measurePerformance,
				output_id: EVAL_ID,
			});
			return twin(
				await call("app_bindings::query::eval_summary", { ocel: OCEL, eval: evaluation }),
			);
		},
		"ocel/eval-results/page": async (req) => {
			try {
				return twin(
					await call("app_bindings::query::eval_results_page", {
						ocel: OCEL,
						eval: EVAL,
						request: twin<BindingEvalPageRequest>(req),
					}),
				);
			} catch (e) {
				// `PaginatedBindingTable` matches this exact message to offer a re-run.
				if (String(e).includes("stale eval_version")) throw new Error("STALE_EVAL_VERSION");
				throw e;
			}
		},
		"ocel/export": async (format) => {
			const bytes = await backend.exportObject(OCEL_ID, EXPORT_FORMAT[format]);
			return new Blob([bytes as BlobPart], { type: MIME[format] });
		},
		"ocel/export-filter-box": async (tree, format) => {
			const handle = await call("app_bindings::query::export_filter_box", {
				ocel: OCEL,
				tree: twin(tree),
			});
			try {
				const bytes = await backend.exportObject(handle, EXPORT_FORMAT[format]);
				return new Blob([bytes as BlobPart], { type: MIME[format] });
			} finally {
				await backend.unloadObject(handle).catch(() => undefined);
			}
		},
		"ocel/discover-constraints": async (options) =>
			twin(
				await call("app_bindings::query::discover_constraints", {
					ocel: OCEL,
					options: twin<BindingAutoDiscoverRequest>(options),
				}),
			),
		"ocel/export-bindings": async (nodeIndex, options) => {
			const bytes = await backend.exportBindingsTable(OCEL_ID, EVAL_ID, nodeIndex, options);
			return new Blob([bytes as BlobPart], { type: TABLE_MIME[options.format] });
		},
		"ocel/graph": async (options) => {
			const graph = await call("app_bindings::ocel::ocel_graph", {
				ocel: OCEL,
				options: twin<BindingOCELGraphOptions>(options),
			});
			if (graph === null) {
				throw new Error("OCEL graph could not be built");
			}
			return twin(graph);
		},
		"ocel/path-schemas/type-graph": async () =>
			twin(await call("app_bindings::path_schemas::ocpq_path_schema_type_graph", { ocel: OCEL })),
		"ocel/path-schemas/enumerate": async (options) =>
			twin(
				await call("app_bindings::path_schemas::ocpq_path_schema_enumerate", {
					ocel: OCEL,
					options: twin<BindingPathEnumerateOptions>(options),
				}),
			),
		"ocel/path-schemas/discover": async (options) =>
			twin(
				await call("app_bindings::path_schemas::ocpq_path_schema_discover", {
					ocel: OCEL,
					options: twin<BindingPathSchemaOptions>(options),
				}),
			),
		"ocel/path-schemas/schema-detail": async (options) => {
			const detail = await call("app_bindings::path_schemas::ocpq_path_schema_detail", {
				ocel: OCEL,
				options: twin<BindingPathSchemaDetailOptions>(options),
			});
			if (detail === null) {
				throw new Error("Path schema not found");
			}
			return twin(detail);
		},
		"ocel/get-object": async (specifier) => {
			const res = await call("app_bindings::ocel::ocel_get_object", {
				ocel: OCEL,
				specifier,
			});
			if (res === null) {
				throw new Error("Object not found");
			}
			return twin(res);
		},
		"ocel/get-event": async (specifier) => {
			const res = await call("app_bindings::ocel::ocel_get_event", { ocel: OCEL, specifier });
			if (res === null) {
				throw new Error("Event not found");
			}
			return twin(res);
		},
		"hpc/login": async (connectionConfig) => {
			if (backend.hpcLogin === undefined) throw new Error("HPC is not available on this backend");
			await backend.hpcLogin(connectionConfig);
		},
		"hpc/start": async (jobOptions) => {
			if (backend.hpcStart === undefined) throw new Error("HPC is not available on this backend");
			return await backend.hpcStart(jobOptions);
		},
		"hpc/job-status": async (jobID) => {
			if (backend.hpcJobStatus === undefined) {
				throw new Error("HPC is not available on this backend");
			}
			return await backend.hpcJobStatus(jobID);
		},
		"download-blob": async (blob, fileName) => {
			const bytes = new Uint8Array(await blob.arrayBuffer());
			await backend.saveBytes(bytes, fileName, blob.type === "" ? undefined : blob.type);
		},
		"ocel/create-db-query": async (req) =>
			await call("app_bindings::query::create_db_query", { input: twin(req) }),
		"oc-declare/template-string": async (arcs) =>
			await call("app_bindings::oc_declare::oc_declare_template_string", { arcs: twin(arcs) }),
		"ocel/discover-oc-declare": async (options) =>
			twin(
				await call("app_bindings::oc_declare::oc_declare_discover", {
					ocel: OCEL,
					options: twin<BindingOCDeclareDiscoveryOptions>(options),
				}),
			),
		"ocel/evaluate-oc-declare-arcs": async (arcs) =>
			await call("app_bindings::oc_declare::oc_declare_evaluate_arcs", {
				ocel: OCEL,
				arcs: twin(arcs),
			}),
		"ocel/project-oc-declare-arcs": async (arcs, activities) =>
			twin(
				await call("app_bindings::oc_declare::oc_declare_project_arcs", {
					arcs: twin(arcs),
					activities,
				}),
			),
		"ocel/get-activity-statistics": async (activity) =>
			twin(
				await call("app_bindings::oc_declare::oc_declare_activity_statistics", {
					ocel: OCEL,
					activity,
				}),
			),
		"ocel/get-oc-declare-edge-statistics": async (edge) =>
			twin(
				await call("app_bindings::oc_declare::oc_declare_edge_statistics", {
					ocel: OCEL,
					arc: twin(edge),
				}),
			),
		"data-extraction/connection-kinds": async () =>
			(await call(
				"process_mining::bindings::extraction_dbcon_bindings::extraction_connection_kinds",
				{},
			)) as string[],
		"data-extraction/discover-catalog": async (connections) =>
			twin(
				await call(
					"process_mining::bindings::extraction_dbcon_bindings::extraction_discover_catalog",
					{ connections },
				),
			),
		"data-extraction/column-domain": async (connections, sourceId, table, column) =>
			await call("process_mining::bindings::extraction_dbcon_bindings::extraction_column_domain", {
				connections,
				source_id: sourceId,
				table,
				column,
			}),
		"data-extraction/validate": async (blueprint, catalog) =>
			twin(
				await call("process_mining::bindings::extraction_bindings::extraction_validate", {
					blueprint: twin<BindingBlueprint>(blueprint),
					catalog: twin<BindingCatalog>(catalog),
				}),
			),
		"data-extraction/execute": async (blueprint, connections) => {
			// Run into a scratch id, not OCEL_ID: a failed run must not overwrite the current log.
			const scratch = await call("process_mining::bindings::slim_ocel_bindings::locel_new", {
				output_id: EXTRACTION_SCRATCH_ID,
			});
			let report: unknown;
			try {
				report = await call("process_mining::bindings::extraction_dbcon_bindings::extraction_run", {
					ocel: scratch,
					blueprint: twin<BindingBlueprint>(blueprint),
					connections,
				});
			} catch (e) {
				await backend.unloadObject(scratch).catch(() => undefined);
				throw e;
			}
			await backend.renameObject(scratch, OCEL_ID);
			return { report: twin<ExtractionReport>(report) };
		},
	};

	if (backend.listLocalItems !== undefined && backend.loadLocalItem !== undefined) {
		const listLocal = backend.listLocalItems;
		const loadLocal = backend.loadLocalItem;
		provider["ocel/available"] = () => listLocal();
		provider["ocel/load"] = async (name) => {
			await loadLocal(OCEL_ID, OCEL_KIND, name);
			return await info();
		};
	}

	if (backend.loadItemPath !== undefined) {
		const loadPath = backend.loadItemPath;
		const pick = backend.pickFiles;
		provider["ocel/picker"] = async (path) => {
			let target = path;
			if (target === undefined && pick !== undefined) {
				const picked = await pick({
					filters: [
						{
							name: "OCEL2",
							extensions: [
								"json",
								"xml",
								"jsonocel",
								"xmlocel",
								"sqlite",
								"sqlite3",
								"db",
								"json.gz",
								"xml.gz",
								"csv",
								"csv.gz",
								// `.ocel.zip` bundle, or an `ocel-meta.json` manifest (imports its whole folder).
								"zip",
							],
						},
						{ name: "XES", extensions: ["xes", "xes.gz"] },
					],
				});
				target = picked?.[0];
			}
			if (target === undefined) {
				throw new Error("No file selected");
			}
			await loadPath(OCEL_ID, OCEL_KIND, target);
			return await info();
		};
	}

	if (backend.pickFiles !== undefined) {
		const pick = backend.pickFiles;
		provider["pick-file"] = async (filters) => {
			const picked = await pick({ filters: filters ?? [{ name: "All", extensions: ["*"] }] });
			return picked?.[0] ?? null;
		};
	}

	if (backend.onDragDrop !== undefined) provider["drag-drop-listener"] = backend.onDragDrop;
	if (backend.getInitialFiles !== undefined) {
		provider["ocel/get-initial-files"] = backend.getInitialFiles;
	}
	if (backend.checkForUpdates !== undefined)
		provider["check-for-updates"] = backend.checkForUpdates;
	if (backend.restart !== undefined) provider.restart = backend.restart;
	if (backend.getVersion !== undefined) provider["get-version"] = backend.getVersion;

	return provider;
}

export function getAPIServerBackendProvider(localBackendURL: string): BackendProvider {
	return createBackendProvider(createHttpBackend(`${localBackendURL}/api`));
}
