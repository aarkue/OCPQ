import type {
	ArtifactInfo,
	BackendContext,
	FunctionMeta,
	ItemKindInfo,
	LoadedObject,
} from "./backend-context";
import type { CallBinding } from "./generated";

/** The wasm-bindgen exports of `backend/wasm`. */
type WasmModule = {
	default: (opts?: unknown) => Promise<unknown>;
	execute_binding(functionId: string, args: unknown, outputName?: string): Uint8Array;
	list_functions(): FunctionMeta[];
	get_all_item_kinds(): ItemKindInfo[];
	load_item_bytes(id: string, itemKind: string, data: Uint8Array, format: string): void;
	get_all_objects_with_type(): LoadedObject[];
	set_object_label(id: string, label: string | undefined): void;
	rename_object(from: string, to: string): void;
	unload_object(name: string): void;
	export_object(name: string, format: string): Uint8Array;
	export_bindings_table(
		ocelId: string,
		evalId: string,
		nodeIndex: number,
		options: unknown,
	): Uint8Array;
	load_artifact_bytes(id: string, kind: string, data: Uint8Array, format: string): void;
	list_artifacts(): ArtifactInfo[];
	get_artifact(id: string): unknown;
	unload_artifact(id: string): void;
	export_artifact(id: string, format: string): Uint8Array;
};

/** Where wasm-pack's output is served from. Passed as a variable to `import()` below so tsc and
 *  the bundler don't try to resolve the not-yet-built package at build time. */
export const WASM_MODULE_URL = "/wasm/ocpq_wasm.js";

/** In-browser backend: the engine runs as a wasm module on the page. Calls are synchronous once
 *  initialised; the promises only exist to fit the shared {@link BackendContext} shape. */
export function createWasmBackend(moduleUrl: string = WASM_MODULE_URL): BackendContext {
	const listeners = new Map<string, Set<(data: unknown) => void>>();

	let modP: Promise<WasmModule> | undefined;
	const load = (): Promise<WasmModule> => {
		if (modP === undefined) {
			// The engine calls `wasmSpace.emit` for every event, so this must exist before it runs.
			(globalThis as { wasmSpace?: unknown }).wasmSpace = {
				emit: (name: string, data: unknown) => {
					for (const l of listeners.get(name) ?? []) l(data);
				},
			};
			modP = (import(/* @vite-ignore */ moduleUrl) as Promise<WasmModule>).then(async (m) => {
				await m.default();
				return m;
			});
		}
		return modP;
	};

	const callBinding = (async (id: string, args: unknown, opts?: { outputName?: string }) => {
		const m = await load();
		return JSON.parse(new TextDecoder().decode(m.execute_binding(id, args, opts?.outputName)));
	}) as CallBinding;

	return {
		kind: "wasm",
		ready: load().then(() => undefined),
		callBinding,
		async listObjects() {
			return (await load()).get_all_objects_with_type();
		},
		async listFunctions() {
			return (await load()).list_functions();
		},
		async listItemKinds() {
			return (await load()).get_all_item_kinds();
		},
		async loadItem(id, kind, data, format) {
			(await load()).load_item_bytes(id, kind, data, format);
		},
		async exportObject(name, format) {
			return (await load()).export_object(name, format);
		},
		async exportBindingsTable(ocelId, evalId, nodeIndex, options) {
			return (await load()).export_bindings_table(ocelId, evalId, nodeIndex, options);
		},
		async unloadObject(name) {
			(await load()).unload_object(name);
		},
		async renameObject(from, to) {
			(await load()).rename_object(from, to);
		},
		async setLabel(id, label) {
			(await load()).set_object_label(id, label === "" ? undefined : label);
		},
		async loadArtifactBytes(id, kind, data, format) {
			(await load()).load_artifact_bytes(id, kind, data, format);
		},
		async listArtifacts() {
			return (await load()).list_artifacts();
		},
		async getArtifact(id) {
			return (await load()).get_artifact(id);
		},
		async unloadArtifact(id) {
			(await load()).unload_artifact(id);
		},
		async exportArtifact(id, format) {
			return (await load()).export_artifact(id, format);
		},
		async saveBytes(data, filename, mime) {
			const url = URL.createObjectURL(
				new Blob([data as BlobPart], mime ? { type: mime } : undefined),
			);
			const a = document.createElement("a");
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(() => URL.revokeObjectURL(url), 2000);
		},
		async registerListener<T>(event: string, listener: (data: T) => void) {
			const fn = listener as (data: unknown) => void;
			let set = listeners.get(event);
			if (set === undefined) {
				set = new Set();
				listeners.set(event, set);
			}
			set.add(fn);
			return () => {
				set.delete(fn);
			};
		},
	};
}
