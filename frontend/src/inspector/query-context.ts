import { useSyncExternalStore } from "react";
import type { BindingBox } from "@/types/generated/BindingBox";

/** A node of the open query. Boxes carry variables and filters, and gates only pass scope on. */
export type QueryNode = { id: string; parentId?: string; box?: BindingBox };
export type QueryContext = { nodes: QueryNode[]; selectedId?: string };

// The editor and the inspector are separate trees, so they meet in this store.
let current: QueryContext | undefined;
let currentKey = "";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Set by the open query editor, `undefined` once it closes. Moving nodes does not notify. */
export function publishQueryContext(ctx: QueryContext | undefined) {
	const key = ctx === undefined ? "" : JSON.stringify(ctx);
	if (key === currentKey) return;
	currentKey = key;
	current = ctx;
	for (const l of listeners) l();
}

export function useQueryContext(): QueryContext | undefined {
	return useSyncExternalStore(subscribe, () => current);
}

export type AddVariableRequest = {
	nodeId: string;
	kind: "object" | "event";
	type: string;
	/** Tells repeated requests for the same type apart. */
	at: number;
};

let addRequest: AddVariableRequest | undefined;
const addListeners = new Set<() => void>();

/** Asks the box `nodeId` to open its add-variable dialog with `type` chosen. */
export function requestAddVariable(req: Omit<AddVariableRequest, "at">) {
	addRequest = { ...req, at: Date.now() };
	for (const l of addListeners) l();
}

export function useAddVariableRequest(): AddVariableRequest | undefined {
	return useSyncExternalStore(
		(l) => {
			addListeners.add(l);
			return () => addListeners.delete(l);
		},
		() => addRequest,
	);
}
