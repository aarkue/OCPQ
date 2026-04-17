import { useQuery } from "@tanstack/react-query";
import { useBackend } from "./useBackend";

export function useOcelAvailable() {
	const backend = useBackend();
	const hasEndpoint = backend["ocel/available"] !== undefined;

	return useQuery({
		queryKey: ["ocel", "available"],
		queryFn: () => backend["ocel/available"]!(),
		enabled: hasEndpoint,
		staleTime: 60 * 1000,
	});
}
