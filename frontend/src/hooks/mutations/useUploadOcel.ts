import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useBackend } from "../useBackend";

export function useUploadOcel() {
	const backend = useBackend();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (file: File) => {
			if (file.name.endsWith(".xes") || file.name.endsWith(".xes.gz")) {
				if (backend["ocel/upload-from-xes"] === undefined) {
					throw new Error("XES upload not supported by this backend");
				}
				return backend["ocel/upload-from-xes"](file);
			}

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
