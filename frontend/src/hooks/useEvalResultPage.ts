import { useQuery } from "@tanstack/react-query";
import type { EvalPageRequest } from "../types/generated/EvalPageRequest";
import type { EvalPageResponse } from "../types/generated/EvalPageResponse";
import { useBackend } from "./useBackend";

export function useEvalResultPage(req: EvalPageRequest | null) {
	const backend = useBackend();
	return useQuery<EvalPageResponse, Error>({
		queryKey: [
			"eval-results",
			req?.evalVersion,
			req?.nodeIndex,
			req?.offset,
			req?.limit,
			req?.violated ?? null,
		],
		queryFn: () => backend["ocel/eval-results/page"](req!),
		enabled: req !== null,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}
