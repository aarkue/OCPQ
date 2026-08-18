import type { OCPQJobOptions } from "@/types/generated/OCPQJobOptions";
import type { ConnectionConfig, JobStatus } from "@/types/hpc-backend";
import type {
	ArtifactInfo,
	BackendContext,
	FunctionMeta,
	ItemKindInfo,
	LoadedObject,
} from "./backend-context";
import type { CallBinding } from "./generated";

/**
 * Remote backend: the engine runs in the `web-server` (axum) process; this talks to it over HTTP.
 *
 * `base` is the API root -- "/api" when axum also serves the built UI, or a full origin when the
 * UI is served separately.
 */
export function createHttpBackend(base = "/api"): BackendContext {
	const root = base.replace(/\/$/, "");

	// One shared SSE connection for engine events, opened lazily on the first registerListener so
	// the server holds no connection until something subscribes. Subscriptions are tracked so a
	// reconnect can re-attach the same listeners to a fresh stream.
	let es: EventSource | undefined;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	const subs = new Set<{ event: string; handler: EventListener }>();

	const BACKOFF_BASE_MS = 1000;
	const BACKOFF_CAP_MS = 30000;
	let backoffMs = BACKOFF_BASE_MS;

	const openStream = (): void => {
		const next = new EventSource(`${root}/events`);
		es = next;
		next.onopen = () => {
			backoffMs = BACKOFF_BASE_MS;
		};
		next.onerror = () => {
			// Native EventSource retry can stall in CLOSED; take over. Ignore a replaced stream.
			if (es === next) scheduleReconnect();
		};
		for (const sub of subs) next.addEventListener(sub.event, sub.handler);
	};

	const scheduleReconnect = (): void => {
		if (reconnectTimer !== undefined) return;
		es?.close();
		es = undefined;
		const delay = backoffMs + Math.random() * 250;
		backoffMs = Math.min(backoffMs * 2, BACKOFF_CAP_MS);
		reconnectTimer = setTimeout(() => {
			reconnectTimer = undefined;
			openStream();
		}, delay);
	};

	async function fail(res: Response): Promise<never> {
		throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
	}

	async function getJson<T>(path: string): Promise<T> {
		const res = await fetch(`${root}${path}`);
		if (!res.ok) return fail(res);
		return (await res.json()) as T;
	}

	async function postJson<T>(path: string, body: unknown): Promise<T> {
		const res = await fetch(`${root}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) return fail(res);
		return (await res.json()) as T;
	}

	const callBinding = (async (
		id: string,
		args: unknown,
		opts?: { outputName?: string },
	): Promise<unknown> => {
		const res = await fetch(`${root}/call`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id, args, output_name: opts?.outputName }),
		});
		if (!res.ok) return fail(res);
		return await res.json();
	}) as CallBinding;

	return {
		kind: "http",
		ready: Promise.resolve(),
		callBinding,
		listObjects: () => getJson<LoadedObject[]>("/objects"),
		listFunctions: () => getJson<FunctionMeta[]>("/functions"),
		listItemKinds: () => getJson<ItemKindInfo[]>("/item-kinds"),
		async loadItem(id, kind, data, format) {
			const q = new URLSearchParams({ id, kind, format });
			const res = await fetch(`${root}/load?${q}`, {
				method: "POST",
				headers: { "content-type": "application/octet-stream" },
				body: data as BodyInit,
			});
			if (!res.ok) await fail(res);
		},
		async exportObject(name, format) {
			const q = new URLSearchParams({ name, format });
			const res = await fetch(`${root}/export?${q}`);
			if (!res.ok) return fail(res);
			return new Uint8Array(await res.arrayBuffer());
		},
		async unloadObject(name) {
			const res = await fetch(`${root}/unload?${new URLSearchParams({ name })}`, {
				method: "POST",
			});
			if (!res.ok) await fail(res);
		},
		async renameObject(from, to) {
			const res = await fetch(`${root}/rename?${new URLSearchParams({ from, to })}`, {
				method: "POST",
			});
			if (!res.ok) await fail(res);
		},
		async setLabel(id, label) {
			const res = await fetch(`${root}/set-label?${new URLSearchParams({ id, label })}`, {
				method: "POST",
			});
			if (!res.ok) await fail(res);
		},
		async loadArtifactBytes(id, kind, data, format) {
			const q = new URLSearchParams({ id, kind, format });
			const res = await fetch(`${root}/load-artifact?${q}`, {
				method: "POST",
				headers: { "content-type": "application/octet-stream" },
				body: data as BodyInit,
			});
			if (!res.ok) await fail(res);
		},
		listArtifacts: () => getJson<ArtifactInfo[]>("/artifacts"),
		getArtifact: (id) => getJson<unknown>(`/artifact?${new URLSearchParams({ id })}`),
		async unloadArtifact(id) {
			const res = await fetch(`${root}/unload-artifact?${new URLSearchParams({ id })}`, {
				method: "POST",
			});
			if (!res.ok) await fail(res);
		},
		async exportArtifact(id, format) {
			const q = new URLSearchParams({ id, format });
			const res = await fetch(`${root}/export-artifact?${q}`);
			if (!res.ok) return fail(res);
			return new Uint8Array(await res.arrayBuffer());
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
			const handler = ((e: MessageEvent) => listener(JSON.parse(e.data) as T)) as EventListener;
			const sub = { event, handler };
			subs.add(sub);
			// openStream attaches every sub, including this one.
			if (es !== undefined) es.addEventListener(event, handler);
			else if (reconnectTimer === undefined) openStream();
			return () => {
				subs.delete(sub);
				es?.removeEventListener(event, handler);
			};
		},
		listLocalItems: () => getJson<string[]>("/available-local"),
		async loadLocalItem(id, kind, name) {
			const res = await fetch(`${root}/load-local`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id, kind, name }),
			});
			if (!res.ok) await fail(res);
		},
		async hpcLogin(config: ConnectionConfig) {
			const res = await fetch(`${root}/hpc/login`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(config),
			});
			if (!res.ok) await fail(res);
		},
		hpcStart: (options: OCPQJobOptions) => postJson<string>("/hpc/start", options),
		hpcJobStatus: (jobId: string) =>
			getJson<JobStatus>(`/hpc/job-status/${encodeURIComponent(jobId)}`),
	};
}
