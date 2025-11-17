import json5 from "json5";


export const QUERY_LOCALSTORAGE_SAVE_KEY_DATA = "oced-declare-data";
export const QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META = "oced-declare-meta";


export const OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA = "oced-ocdeclare-data";
export const OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META = "oced-ocdeclare-meta";
export function parseLocalStorageValue<T>(s: string): T {
    try {
        return JSON.parse(s);
    } catch (e) {
        console.warn("trying to use json5 instead");
        return json5.parse(s);
    }
}
