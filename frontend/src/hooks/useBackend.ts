import { useContext } from "react";
import { type BackendProvider, BackendProviderContext } from "@/BackendProviderContext";

/**
 * Hook to access the BackendProvider from context.
 * Provides type-safe access to all backend methods.
 */
export function useBackend(): BackendProvider {
	return useContext(BackendProviderContext);
}
