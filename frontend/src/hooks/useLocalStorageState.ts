import { useCallback, useEffect, useState } from "react";

/**
 * Hook that syncs state with localStorage.
 * Similar to useState but persists across browser sessions.
 *
 * @param key - The localStorage key to use
 * @param initialValue - Default value if nothing is stored
 */
export function useLocalStorageState<T>(
	key: string,
	initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
	const [state, setState] = useState<T>(() => {
		try {
			const stored = localStorage.getItem(key);
			if (stored !== null) {
				return JSON.parse(stored) as T;
			}
		} catch {
			// Ignore parse errors, use initial value
		}
		return initialValue;
	});

	const setValue = useCallback(
		(value: T | ((prev: T) => T)) => {
			setState((prev) => {
				const nextValue = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
				try {
					localStorage.setItem(key, JSON.stringify(nextValue));
				} catch {
					// Ignore storage errors (quota exceeded, etc.)
				}
				return nextValue;
			});
		},
		[key],
	);

	// Sync with other tabs/windows
	useEffect(() => {
		const handleStorage = (e: StorageEvent) => {
			if (e.key === key && e.newValue !== null) {
				try {
					setState(JSON.parse(e.newValue) as T);
				} catch {
					// Ignore parse errors
				}
			}
		};

		window.addEventListener("storage", handleStorage);
		return () => window.removeEventListener("storage", handleStorage);
	}, [key]);

	return [state, setValue];
}
