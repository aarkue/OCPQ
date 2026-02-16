import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBackend } from "./useBackend";

/**
 * Hook to fetch OCEL info using React Query.
 * Returns cached data and handles loading/error states automatically.
 */
export function useOcelInfo() {
	const backend = useBackend();

	return useQuery({
		queryKey: ["ocel", "info"],
		queryFn: () => backend["ocel/info"](),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	}).data;
}

/**
 * Hook to fetch OCEL info using React Query.
 * Returns cached data and handles loading/error states automatically.
 */
export function useOcelInfoQuery() {
	const backend = useBackend();

	return useQuery({
		queryKey: ["ocel", "info"],
		queryFn: () => backend["ocel/info"](),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}


/**
 * Hook to get a function that invalidates all OCEL-related queries.
 * Call this after uploading/loading a new OCEL.
 */
export function useInvalidateOcel() {
	const queryClient = useQueryClient();

	return () => queryClient.invalidateQueries({ queryKey: ["ocel"] });
}
