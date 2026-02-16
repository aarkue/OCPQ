import { useQuery } from "@tanstack/react-query";
import { useBackend } from "./useBackend";

/**
 * Hook to fetch the list of available OCEL files.
 * Only works if the backend supports the ocel/available endpoint.
 */
export function useOcelAvailable() {
	const backend = useBackend();
	const hasEndpoint = backend["ocel/available"] !== undefined;

	return useQuery({
		queryKey: ["ocel", "available"],
		queryFn: () => backend["ocel/available"]!(),
		enabled: hasEndpoint,
		staleTime: 60 * 1000, // 1 minute
	});
}
