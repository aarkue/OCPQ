import { type EditorBlueprint, newBlueprint } from "@r4pm/components/extraction-blueprint";
import { useCallback, useMemo, useRef, useState } from "react";
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
 *
 *  Connections sit beside the blueprint rather than inside it, mirroring the backend's API
 *  boundary -- a blueprint carries no connection details, so an exported one can never leak a
 *  password. */
interface StoredBlueprint {
	blueprint: EditorBlueprint;
	connections: Record<string, string>;
}

const storageKey = (id: string) => `${DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA}v2-${id}`;

/** Where the pre-upstream editor saved. Its documents were ReactFlow node/edge state plus a source
 *  list, not an `EditorBlueprint`, so there is no mechanical conversion into the current model --
 *  which is why the key changed rather than the payload being migrated in place. */
const legacyStorageKey = (id: string) => `${DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA}${id}`;

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
 *
 *  Read as text, never parsed into the current model: the point is to let the user keep it, not to
 *  guess a conversion. Without this the editor opened empty over an unread payload and the first
 *  edit made that permanent, with nothing on screen saying so. */
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

	// The value `persist` builds on, kept in a ref as well as in state. Two updates in one tick --
	// `onConnectionsChange` then `onChange`, which `BlueprintGraph` does after a catalog discovery
	// adds a source and rewrites the document -- both read the render-time `stored` otherwise, so the
	// second silently reverts the first.
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
				// A document past the quota is the expected failure here, and it must not escape the
				// React update: the edit itself is already applied in memory, so the only thing to
				// report is that it will not survive a reload.
				toast.error(
					`Failed to save blueprint changes locally, so they will be lost on reload: ${String(e)}`,
					{ id: "blueprint-persist" },
				);
			}
		},
		[id],
	);

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
						This blueprint was saved by an older editor whose documents cannot be converted to the
						current format, so it opens empty. The old version is still on disk until you save.
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
