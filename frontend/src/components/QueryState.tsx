import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import Spinner from "./Spinner";

interface QueryStateProps<T> {
	query: UseQueryResult<T>;
	children: (data: T) => ReactNode;
	loadingMessage?: string;
	errorMessage?: string;
}

/**
 * Helper component for rendering consistent loading/error states for React Query results.
 *
 * @example
 * <QueryState query={ocelInfoQuery}>
 *   {(data) => <OcelInfo data={data} />}
 * </QueryState>
 */
export function QueryState<T>({
	query,
	children,
	loadingMessage = "Loading...",
	errorMessage,
}: QueryStateProps<T>): ReactNode {
	if (query.isPending) {
		return (
			<div className="flex items-center justify-center gap-2 p-4 text-muted-foreground">
				<Spinner />
				<span>{loadingMessage}</span>
			</div>
		);
	}

	if (query.isError) {
		return (
			<div className="flex flex-col items-center justify-center p-4 text-center">
				<p className="text-sm text-red-600">
					{errorMessage || query.error?.message || "An error occurred"}
				</p>
			</div>
		);
	}

	if (query.data === undefined) {
		return null;
	}

	return children(query.data);
}
