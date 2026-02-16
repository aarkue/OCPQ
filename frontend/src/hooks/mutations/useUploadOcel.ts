import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useBackend } from "../useBackend";

/**
 * Mutation hook for uploading OCEL files.
 * Handles both standard OCEL and XES file formats.
 * Automatically invalidates OCEL queries on success.
 */
export function useUploadOcel() {
	const backend = useBackend();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (file: File) => {
			// Check if this is an XES file
			if (file.name.endsWith(".xes") || file.name.endsWith(".xes.gz")) {
				if (backend["ocel/upload-from-xes"] === undefined) {
					throw new Error("XES upload not supported by this backend");
				}
				return backend["ocel/upload-from-xes"](file);
			}

			// Standard OCEL upload
			if (backend["ocel/upload"] === undefined) {
				throw new Error("Upload not supported by this backend");
			}
			return backend["ocel/upload"](file);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["ocel"] });
			toast.success("Imported OCEL");
		},
		onError: (error) => {
			toast.error(`Failed to import OCEL: ${String(error)}`);
		},
	});
}
