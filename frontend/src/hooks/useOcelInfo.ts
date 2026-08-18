import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useBackend } from "./useBackend";

/** `null` is the query layer's way of saying "reachable, nothing loaded"; callers only care that
 *  there is no log, so it is normalised back to `undefined` here. */
export function useOcelInfo() {
	return useOcelInfoQuery().data ?? undefined;
}

export function useOcelInfoQuery() {
	const backend = useBackend();

	return useQuery({
		queryKey: ["ocel", "info"],
		// `?? null` because react-query rejects an `undefined` result and fails the query rather
		// than succeeding, and `isSuccess` here is what the sidebar reads as "backend online" --
		// so "no log loaded yet" would otherwise render as an offline backend.
		queryFn: async () => (await backend["ocel/info"]()) ?? null,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

export function useOcelStats() {
	return useOcelStatsQuery().data ?? undefined;
}

export function useOcelStatsQuery() {
	const backend = useBackend();

	return useQuery({
		queryKey: ["ocel", "stats"],
		queryFn: async () => (await backend["ocel/stats"]()) ?? null,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

export function useAttributeStats(
	scope: "event" | "object",
	type: string | undefined,
	attribute: string | undefined,
) {
	const backend = useBackend();

	return useQuery({
		queryKey: ["ocel", "attr-stats", scope, type, attribute],
		queryFn: () => backend["ocel/attribute-stats"](scope, type ?? "", attribute ?? ""),
		enabled: !!type && !!attribute,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

export function useInvalidateOcel() {
	const queryClient = useQueryClient();

	return useCallback(() => queryClient.invalidateQueries({ queryKey: ["ocel"] }), [queryClient]);
}
