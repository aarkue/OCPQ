import { OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA } from "@/lib/local-storage";

type KeyedStorage = Pick<Storage, "length" | "key" | "removeItem">;

/** Removes every saved OC-DECLARE flow whose model is not in `ids`, including flows that older
 *  versions left behind on delete. Returns how many were removed. */
export function removeOrphanedOCDeclareData(
	ids: string[],
	storage: KeyedStorage = localStorage,
): number {
	const keep = new Set(ids.map((id) => OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA + id));
	const orphans: string[] = [];
	for (let i = 0; i < storage.length; i++) {
		const key = storage.key(i);
		if (key?.startsWith(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA) && !keep.has(key)) orphans.push(key);
	}
	// Removing inside the loop above would shift the indices.
	for (const key of orphans) storage.removeItem(key);
	return orphans.length;
}
