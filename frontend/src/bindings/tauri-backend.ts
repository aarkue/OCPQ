import type { OCPQJobOptions } from "@/types/generated/OCPQJobOptions";
import type { ConnectionConfig, JobStatus } from "@/types/hpc-backend";
import type {
	ArtifactInfo,
	BackendContext,
	DragDropEvent,
	FunctionMeta,
	ItemKindInfo,
	LoadedObject,
} from "./backend-context";
import type { CallBinding } from "./generated";

/** Tauri's IPC via webview globals, not `@tauri-apps/api`: this file also compiles into browser
 *  builds, which can't depend on desktop-only npm packages. */
type TauriInternals = {
	invoke<T>(cmd: string, args?: unknown, options?: unknown): Promise<T>;
	transformCallback(callback: (payload: unknown) => void, once?: boolean): number;
};

type TauriEventPayload<T> = { event: string; id: number; payload: T };

type TauriEventInternals = { unregisterListener(event: string, eventId: number): void };

function internals(): TauriInternals {
	const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
	if (w.__TAURI_INTERNALS__ === undefined) {
		throw new Error("Not running inside a Tauri webview");
	}
	return w.__TAURI_INTERNALS__;
}

function invoke<T>(cmd: string, args?: unknown, options?: unknown): Promise<T> {
	return internals().invoke<T>(cmd, args ?? {}, options);
}

async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
	const eventId = await invoke<number>("plugin:event|listen", {
		event,
		target: { kind: "Any" },
		handler: internals().transformCallback((e) => handler((e as TauriEventPayload<T>).payload)),
	});
	return () => {
		// Frees the webview-side callback slot; `unlisten` alone only drops the host-side registration.
		const w = window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__?: TauriEventInternals };
		w.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener(event, eventId);
		void invoke("plugin:event|unlisten", { event, eventId });
	};
}

/** Base64, not raw `Vec<u8>` JSON (tauri would serialize that as a decimal-integer array, ~3.3x
 *  the bytes and unusable for a real log). `atob` decodes it exactly, byte for byte. */
function decodeBase64(b64: string): Uint8Array {
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Desktop backend: the engine runs in the tauri process, reached via `#[tauri::command]`s. */
export function createTauriBackend(): BackendContext {
	const callBinding = ((id: string, args: unknown, opts?: { outputName?: string }) =>
		invoke<number[]>("execute_binding", {
			id,
			args,
			outputName: opts?.outputName,
		}).then((bytes) => JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))))) as CallBinding;

	return {
		kind: "tauri",
		ready: Promise.resolve(),
		callBinding,
		listObjects: () => invoke<LoadedObject[]>("get_all_objects_with_type"),
		listFunctions: () => invoke<FunctionMeta[]>("list_functions"),
		listItemKinds: () => invoke<ItemKindInfo[]>("get_all_item_kinds"),
		async loadItem(id, kind, data, format) {
			await invoke("load_item_bytes", { id, kind, data: Array.from(data), format });
		},
		async exportObject(name, format) {
			return decodeBase64(await invoke<string>("export_object", { name, format }));
		},
		async exportBindingsTable(ocelId, evalId, nodeIndex, options) {
			return decodeBase64(
				await invoke<string>("export_bindings_table", { ocelId, evalId, nodeIndex, options }),
			);
		},
		async unloadObject(name) {
			await invoke("unload_object", { name });
		},
		async renameObject(from, to) {
			await invoke("rename_object", { from, to });
		},
		async setLabel(id, label) {
			await invoke("set_object_label", { id, label });
		},
		async loadArtifactBytes(id, kind, data, format) {
			await invoke("load_artifact_bytes", { id, kind, data: Array.from(data), format });
		},
		listArtifacts: () => invoke<ArtifactInfo[]>("list_artifacts"),
		getArtifact: (id) => invoke<unknown>("get_artifact", { id }),
		async unloadArtifact(id) {
			await invoke("unload_artifact", { id });
		},
		async exportArtifact(id, format) {
			return decodeBase64(await invoke<string>("export_artifact", { id, format }));
		},
		async saveBytes(data, filename) {
			const path = await invoke<string | null>("plugin:dialog|save", {
				options: { defaultPath: filename },
			});
			if (path === null) return;
			await invoke("plugin:fs|write_file", data, {
				headers: { path: encodeURIComponent(path), options: JSON.stringify({}) },
			});
		},
		registerListener: <T>(event: string, listener: (data: T) => void) => listen<T>(event, listener),
		async loadItemPath(id, kind, path) {
			await invoke("load_item_path", { id, kind, path });
		},
		async loadArtifactPath(id, kind, path) {
			await invoke("load_artifact_path", { id, kind, path });
		},
		async exportObjectToPath(name, format, path) {
			await invoke("export_object_to_path", { name, format, path });
		},
		async pickFiles(opts) {
			const res = await invoke<string | string[] | null>("plugin:dialog|open", {
				options: { multiple: opts.multiple ?? false, filters: opts.filters },
			});
			if (res === null) return null;
			return Array.isArray(res) ? res : [res];
		},
		getInitialFiles: () => invoke<string[]>("get_initial_files"),
		async onDragDrop(f: (event: DragDropEvent) => unknown) {
			const unlisteners = await Promise.all([
				listen<{ paths: string[] }>("tauri://drag-enter", (p) =>
					f({ type: "enter", path: p.paths[0] }),
				),
				listen<{ paths: string[] }>("tauri://drag-drop", (p) =>
					f({ type: "drop", path: p.paths[0] }),
				),
				listen<unknown>("tauri://drag-leave", () => f({ type: "leave" })),
			]);
			return () => {
				for (const un of unlisteners) un();
			};
		},
		// `checkForUpdates` stays absent: the updater plugin hands back a stateful `Update` object
		// over a channel, which raw IPC cannot reconstruct.
		async restart() {
			await invoke("plugin:process|restart");
		},
		getVersion: () => invoke<string>("plugin:app|version"),
		hpcLogin: async (config: ConnectionConfig) => {
			await invoke("hpc_login", { config });
		},
		hpcStart: (options: OCPQJobOptions) => invoke<string>("hpc_start", { options }),
		hpcJobStatus: (jobId: string) => invoke<JobStatus>("hpc_job_status", { jobId }),
	};
}
