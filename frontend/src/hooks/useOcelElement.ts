import { useQuery } from "@tanstack/react-query";
import { useBackend } from "./useBackend";

type ElementSpecifier = { id: string } | { index: number };

/**
 * Hook to fetch a single OCEL event by ID or index.
 */
export function useOcelEvent(specifier: ElementSpecifier | undefined) {
	const backend = useBackend();

	return useQuery({
		queryKey: ["ocel", "event", specifier],
		queryFn: () => backend["ocel/get-event"](specifier!),
		enabled: specifier !== undefined,
	});
}

/**
 * Hook to fetch a single OCEL object by ID or index.
 */
export function useOcelObject(specifier: ElementSpecifier | undefined) {
	const backend = useBackend();

	return useQuery({
		queryKey: ["ocel", "object", specifier],
		queryFn: () => backend["ocel/get-object"](specifier!),
		enabled: specifier !== undefined,
	});
}
