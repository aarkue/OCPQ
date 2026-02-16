import type { EvaluationResultWithCount } from "@/types/generated/EvaluationResultWithCount";

export function getViolationStyles(
	violations: Omit<EvaluationResultWithCount, "situations"> | undefined,
	hasNoConstraints?: boolean,
) {
	if (violations === undefined) {
		return "bg-gray-50  border-slate-500 shadow-gray-50";
	}
	if (
		violations.situationCount === 0 ||
		(violations.situationViolatedCount === 0 && hasNoConstraints === true)
	) {
		return "bg-sky-50 border-sky-300 shadow-sky-300";
	}
	const violationFraction = violations.situationViolatedCount / violations.situationCount;

	if (violationFraction >= 0.75) {
		return "bg-rose-50 border-rose-300 shadow-rose-300";
	}
	if (violationFraction >= 0.5) {
		return "bg-orange-50 border-orange-300 shadow-orange-300";
	}
	if (violationFraction >= 0.25) {
		return "bg-yellow-50 border-yellow-300 shadow-yellow-300";
	}
	if (violationFraction >= 0.05) {
		return "bg-lime-50 border-lime-300 shadow-lime-300";
	}
	if (violationFraction > 0) {
		return "bg-emerald-50 border-emerald-300 shadow-emerald-300";
	}
	return "bg-emerald-50 border-emerald-400 shadow-emerald-400";
}

export function getViolationTextColor(
	violations: Omit<EvaluationResultWithCount, "situations"> | undefined,
	hasNoConstraints?: boolean,
) {
	if (violations === undefined) {
		return "text-slate-500";
	}
	if (
		violations.situationCount === 0 ||
		(violations.situationViolatedCount === 0 && hasNoConstraints === true)
	) {
		return "text-sky-500";
	}
	const violationFraction = violations.situationViolatedCount / violations.situationCount;
	if (violationFraction >= 0.75) {
		return "text-rose-500";
	}
	if (violationFraction >= 0.5) {
		return "text-orange-500";
	}
	if (violationFraction >= 0.25) {
		return "text-yellow-500";
	}
	if (violationFraction >= 0.05) {
		return "text-lime-500";
	}
	return "text-emerald-500";
}
