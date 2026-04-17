import { useQuery } from "@tanstack/react-query";
import { useBackend } from "./useBackend";

export function useOcelSampleIds(limit = 100) {
	const backend = useBackend();
	return useQuery({
		queryKey: ["ocel", "sample-ids", limit],
		queryFn: () => backend["ocel/sample-ids"](limit),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}
