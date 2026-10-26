import { useSyncExternalStore } from "react";
import type { EvaluationResPerNodes } from "@/routes/visual-editor/helper/types";

// Outside React state so result cards of queries that are not open keep their data.
const latest = new Map<string, EvaluationResPerNodes>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function setLatestEvaluation(slot: string, evaluation: EvaluationResPerNodes) {
	latest.set(slot, evaluation);
	for (const l of listeners) l();
}

export function clearLatestEvaluations() {
	latest.clear();
	for (const l of listeners) l();
}

/** The most recent evaluation stored under `slot`, if any. */
export function useLatestEvaluation(slot: string): EvaluationResPerNodes | undefined {
	return useSyncExternalStore(subscribe, () => latest.get(slot));
}
