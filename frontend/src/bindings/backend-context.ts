import type { OCPQJobOptions } from "@/types/generated/OCPQJobOptions";
import type { TableExportOptions } from "@/types/generated/TableExportOptions";
import type { ConnectionConfig, JobStatus } from "@/types/hpc-backend";
import type { CallBinding } from "./generated";

/** Which transport an active backend speaks. */
export type BackendKind = "http" | "tauri" | "wasm";

/** Lineage of an object produced by a binding call; absent for imports. */
export type Provenance = {
	sources: string[];
	/** `{fn, args}` for a binding call, or a `"convert:<Kind>"` string for a kind conversion. */
	op: unknown;
	source_gen: number;
};

/** A loaded registry object, referenced by handle id. */
export type LoadedObject = {
	id: string;
	kind: string;
	label?: string | null;
	provenance?: Provenance | null;
};

/** Metadata for an engine-stored artifact (a non-registry value, e.g. a Petri net). */
export type ArtifactInfo = LoadedObject;

/** Metadata for a registered binding function (mirrors the engine's `BindingMeta`). */
export type FunctionMeta = {
	id: string;
	name: string;
	docs: string[];
	module: string;
	source_path: string;
	source_line: number;
	/** JSON schema. */
	return_type: unknown;
	/** `[name, JSON schema]` per argument. */
	args: [string, unknown][];
	required_args: string[];
};

/** One import/export format a registry kind advertises. */
export type FormatInfo = { extension: string; mime: string };

/** A registry item kind plus the formats the engine can import it from / export it to. */
export type ItemKindInfo = {
	kind: string;
	import_formats: FormatInfo[];
	export_formats: FormatInfo[];
	convertible_to: string[];
};

export type FileFilter = { name: string; extensions: string[] };

/** A native drag/drop event over the app window. */
export type DragDropEvent =
	| { type: "enter"; path: string }
	| { type: "leave" }
	| { type: "drop"; path: string };

export type UpdateProgress =
	| { event: "Started"; data: { contentLength?: number } }
	| { event: "Progress"; data: { chunkLength: number } }
	| { event: "Finished" };

export type UpdateInfo = {
	currentVersion: string;
	version: string;
	date?: string;
	body?: string;
	download: (onEvent: (progress: UpdateProgress) => void) => Promise<void>;
	install: () => Promise<void>;
	close: () => Promise<void>;
};

/** The single backend surface the UI talks to, implemented once per transport (http/tauri/wasm).
 *  All async so wasm's synchronous calls fit alongside http/tauri without special-casing. */
export interface BackendContext {
	readonly kind: BackendKind;
	/** Resolves once the backend can accept calls (wasm module init, etc). */
	readonly ready: Promise<void>;

	callBinding: CallBinding;
	listObjects(): Promise<LoadedObject[]>;
	listFunctions(): Promise<FunctionMeta[]>;
	listItemKinds(): Promise<ItemKindInfo[]>;

	loadItem(id: string, kind: string, data: Uint8Array, format: string): Promise<void>;
	exportObject(name: string, format: string): Promise<Uint8Array>;
	/** Render one evaluation node's situations as CSV/XLSX via `ocpq_core::table_export`. */
	exportBindingsTable(
		ocelId: string,
		evalId: string,
		nodeIndex: number,
		options: TableExportOptions,
	): Promise<Uint8Array>;
	unloadObject(name: string): Promise<void>;
	/** Move `from` onto `to`, replacing it; fails if `from` is absent. Lets a caller build under a
	 *  scratch id and adopt it only once the work succeeded. */
	renameObject(from: string, to: string): Promise<void>;
	/** Set (or, with an empty string, clear) an object's display label; persists engine-side. */
	setLabel(id: string, label: string): Promise<void>;

	loadArtifactBytes(id: string, kind: string, data: Uint8Array, format: string): Promise<void>;
	listArtifacts(): Promise<ArtifactInfo[]>;
	getArtifact(id: string): Promise<unknown>;
	unloadArtifact(id: string): Promise<void>;
	exportArtifact(id: string, format: string): Promise<Uint8Array>;

	/** Save bytes to the user's disk (browser anchor-download or native save dialog). */
	saveBytes(data: Uint8Array, filename: string, mime?: string): Promise<void>;
	/** Subscribe to a backend-emitted engine event. Returns an unsubscribe fn. */
	registerListener?<T>(event: string, listener: (data: T) => void): Promise<() => void>;

	/** Desktop-only: native read of a registry item from a path, keeping a large log out of IPC. */
	loadItemPath?(id: string, kind: string, path: string): Promise<void>;
	/** Desktop-only: native read of an artifact from a path. */
	loadArtifactPath?(id: string, kind: string, path: string): Promise<void>;
	/** Desktop-only: write the export straight to `path`, keeping a large log out of IPC. */
	exportObjectToPath?(name: string, format: string, path: string): Promise<void>;
	/** Desktop-only: native file picker; returns the selected paths, or null if cancelled. */
	pickFiles?(opts: { filters?: FileFilter[]; multiple?: boolean }): Promise<string[] | null>;
	/** Desktop-only: paths the app was launched with (file association / CLI args). Drained on read. */
	getInitialFiles?(): Promise<string[]>;
	/** Desktop-only: native window drag/drop. Returns an unsubscribe fn. */
	onDragDrop?(listener: (event: DragDropEvent) => unknown): Promise<() => unknown>;
	/** Desktop-only updater trio. */
	checkForUpdates?(): Promise<UpdateInfo | null>;
	restart?(): Promise<void>;
	getVersion?(): Promise<string>;

	/** Logs sitting next to the checkout, loadable without an upload. Server-side, so http only. */
	listLocalItems?(): Promise<string[]>;
	loadLocalItem?(id: string, kind: string, name: string): Promise<void>;

	/** HPC job control; http and tauri only, the wasm build has no SSH client. */
	hpcLogin?(config: ConnectionConfig): Promise<void>;
	hpcStart?(options: OCPQJobOptions): Promise<string>;
	hpcJobStatus?(jobId: string): Promise<JobStatus>;
}
