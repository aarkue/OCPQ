import { type EditorBlueprint, newBlueprint } from "@r4pm/components/extraction-blueprint";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { IoArrowBack } from "react-icons/io5";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA,
	DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_META,
	parseLocalStorageValue,
} from "@/lib/local-storage";
import DataExtractionEditor from "./DataExtractionEditor";
import type { DataExtractionBlueprintMeta } from "./data-extraction-types";

/** What one blueprint persists: the editor document plus the connections it was last run against.
 *  Kept separate so an exported blueprint never carries a password. */
interface StoredBlueprint {
	blueprint: EditorBlueprint;
	connections: Record<string, string>;
}

const storageKey = (id: string) => `${DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA}v2-${id}`;

/** Where the pre-upstream editor saved; its documents can't be mechanically converted into the
 *  current `EditorBlueprint` model, so the key changed instead of migrating in place. */
const legacyStorageKey = (id: string) => `${DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA}${id}`;

/** First id of `base`, `base-2`, `base-3`, ... not already in `taken`. */
function freshConnectionId(base: string, taken: Iterable<string>): string {
	const set = new Set(taken);
	if (!set.has(base)) return base;
	for (let i = 2; ; i++) {
		if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
	}
}

/** A `dbcon` connection string for a data-source file, given the kind detected from its extension. */
function connectionStringForDataSource(path: string, type: "csv" | "sqlite"): string {
	return type === "csv" ? path : `sqlite://${path}`;
}

function loadStored(id: string): StoredBlueprint {
	const raw = localStorage.getItem(storageKey(id));
	const stored = raw
		? parseLocalStorageValue<Partial<StoredBlueprint> | undefined>(raw)
		: undefined;
	return {
		blueprint: stored?.blueprint ?? newBlueprint(),
		connections: stored?.connections ?? {},
	};
}

/** The old document for `id`, if one is on disk and nothing has been saved under the new key yet.
 *  Kept as raw text (never parsed) so the user can recover it instead of losing it silently. */
function unmigratedLegacy(id: string): string | undefined {
	if (localStorage.getItem(storageKey(id)) !== null) return undefined;
	return localStorage.getItem(legacyStorageKey(id)) ?? undefined;
}

export default function DataExtractionBlueprintEditor() {
	const { id } = useParams<{ id: string }>();
	const [stored, setStored] = useState<StoredBlueprint>(() =>
		id ? loadStored(id) : { blueprint: newBlueprint(), connections: {} },
	);
	const [legacy, setLegacy] = useState<string | undefined>(() =>
		id ? unmigratedLegacy(id) : undefined,
	);

	// Mirrors `stored` so two same-tick updates (onConnectionsChange then onChange, as
	// `BlueprintGraph` does after catalog discovery) don't have the second revert the first.
	const storedRef = useRef(stored);

	const meta = useMemo(() => {
		const all = parseLocalStorageValue<DataExtractionBlueprintMeta[]>(
			localStorage.getItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_META) ?? "[]",
		);
		return all.find((m) => m.id === id);
	}, [id]);

	const persist = useCallback(
		(update: (previous: StoredBlueprint) => StoredBlueprint) => {
			const next = update(storedRef.current);
			storedRef.current = next;
			setStored(next);
			if (!id) return;
			try {
				localStorage.setItem(storageKey(id), JSON.stringify(next));
			} catch (e) {
				// Storage quota errors are expected here and must not throw; the edit stays in memory.
				toast.error(`Couldn't save changes locally — they'll be lost on reload: ${String(e)}`, {
					id: "blueprint-persist",
				});
			}
		},
		[id],
	);

	// Tauri's window-level drag-drop listener (App.tsx) routes file drops here instead of loading
	// them as an OCEL dataset while a blueprint is open.
	useEffect(() => {
		const handler = (e: Event) => {
			const detail = (e as CustomEvent<{ path: string; type: "csv" | "sqlite" }>).detail;
			if (!detail) return;
			const connection = connectionStringForDataSource(detail.path, detail.type);
			const base =
				(detail.path.split(/[\\/]/).pop() ?? "source").replace(/\.[^.]*$/, "") || "source";
			persist((previous) => {
				const sourceId = freshConnectionId(base, Object.keys(previous.connections));
				return { ...previous, connections: { ...previous.connections, [sourceId]: connection } };
			});
			toast.success(`Added "${base}" as a data source`);
		};
		window.addEventListener("data-source-file-drop", handler);
		return () => window.removeEventListener("data-source-file-drop", handler);
	}, [persist]);

	const onChange = useCallback(
		(blueprint: EditorBlueprint) => persist((previous) => ({ ...previous, blueprint })),
		[persist],
	);
	const onConnectionsChange = useCallback(
		(connections: Record<string, string>) => persist((previous) => ({ ...previous, connections })),
		[persist],
	);

	/** Hand the old document back as a file, then stop warning about it. */
	const downloadLegacy = useCallback(() => {
		if (!legacy || !id) return;
		const url = URL.createObjectURL(new Blob([legacy], { type: "application/json" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = `${meta?.name ?? id}-old-format.json`;
		a.click();
		URL.revokeObjectURL(url);
	}, [legacy, id, meta]);

	if (!id) {
		return (
			<div className="flex flex-col items-start gap-2 p-4">
				<p>No blueprint selected.</p>
				<Button asChild variant="outline">
					<Link to="/data-extraction">Back to blueprints</Link>
				</Button>
			</div>
		);
	}

	// A route to an id no entry describes: the blueprint was deleted, or the link is stale. Editing
	// here would create a document under an id nothing lists.
	if (!meta) {
		return (
			<div className="flex flex-col items-start gap-2 p-4">
				<p className="font-semibold">Unknown blueprint</p>
				<p className="text-sm text-muted-foreground">
					No blueprint with id <code>{id}</code> is saved in this browser.
				</p>
				<Button asChild variant="outline">
					<Link to="/data-extraction">Back to blueprints</Link>
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col w-full h-full">
			<div className="flex items-center gap-2 px-2 py-1 border-b">
				<Button asChild variant="ghost" size="sm">
					<Link to="/data-extraction">
						<IoArrowBack className="mr-1" /> Blueprints
					</Link>
				</Button>
				<span className="font-semibold">{meta.name}</span>
			</div>
			{legacy !== undefined && (
				<div className="flex items-center gap-2 px-3 py-2 text-sm border-b bg-amber-50 text-amber-900">
					<span className="flex-1">
						This blueprint is in an old format and can't be loaded. Download it before you save, or
						it will be lost.
					</span>
					<Button variant="outline" size="sm" onClick={downloadLegacy}>
						Download old version
					</Button>
					<Button variant="ghost" size="sm" onClick={() => setLegacy(undefined)}>
						Dismiss
					</Button>
				</div>
			)}
			<div className="flex-1 min-h-0">
				<DataExtractionEditor
					value={stored.blueprint}
					onChange={onChange}
					connections={stored.connections}
					onConnectionsChange={onConnectionsChange}
				/>
			</div>
		</div>
	);
}
