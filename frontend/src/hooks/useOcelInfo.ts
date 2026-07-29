import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useBackend } from "./useBackend";

export function useOcelInfo() {
	return useOcelInfoQuery().data;
}

export function useOcelInfoQuery() {
	const backend = useBackend();

	return useQuery({
		queryKey: ["ocel", "info"],
		queryFn: () => backend["ocel/info"](),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

export function useOcelStats() {
	return useOcelStatsQuery().data;
}

export function useOcelStatsQuery() {
	const backend = useBackend();

	return useQuery({
		queryKey: ["ocel", "stats"],
		queryFn: () => backend["ocel/stats"](),
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
