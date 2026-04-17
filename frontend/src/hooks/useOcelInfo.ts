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

export function useInvalidateOcel() {
	const queryClient = useQueryClient();

	return useCallback(() => queryClient.invalidateQueries({ queryKey: ["ocel"] }), [queryClient]);
}
