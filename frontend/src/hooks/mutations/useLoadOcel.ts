import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useBackend } from "../useBackend";

/**
 * Mutation hook for loading an OCEL from the available list.
 * Automatically invalidates OCEL queries on success.
 */
export function useLoadOcel() {
	const backend = useBackend();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (name: string) => {
			if (backend["ocel/load"] === undefined) {
				throw new Error("Load not supported by this backend");
			}
			return backend["ocel/load"](name);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["ocel"] });
			toast.success("Loaded OCEL");
		},
		onError: (error) => {
			toast.error(`Failed to load OCEL: ${String(error)}`);
		},
	});
}
