import { useContext } from "react";
import { type BackendProvider, BackendProviderContext } from "@/BackendProviderContext";

export function useBackend(): BackendProvider {
	return useContext(BackendProviderContext);
}
