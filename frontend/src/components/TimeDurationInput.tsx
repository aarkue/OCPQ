export const TIME_DURATION_UNITS = [
	"seconds",
	"minutes",
	"hours",
	"days",
	"weeks",
	// "months",
	"years",
] as const;

function unitFactorFromSeconds(unit: (typeof TIME_DURATION_UNITS)[number]) {
	if (unit === "seconds") return 1;
	if (unit === "minutes") return 60;
	if (unit === "hours") return 60 * 60;
	if (unit === "days") return 24 * 60 * 60;
	if (unit === "weeks") return 7 * 24 * 60 * 60;
	// if (unit === "months") return 30 * 24 * 60 * 60;
	if (unit === "years") return 365 * 24 * 60 * 60;
	return 1;
}

export function formatSeconds(seconds: number, inftysymbol = "∞", minusinftysymbol = "-∞") {
	if (seconds === Number.POSITIVE_INFINITY) return inftysymbol;
	if (seconds === Number.NEGATIVE_INFINITY) return minusinftysymbol;
	if (seconds === 0) return "0";
	const reversedUnits = [...TIME_DURATION_UNITS];
	reversedUnits.reverse();
	for (const unit of reversedUnits) {
		const val = Math.abs(seconds / unitFactorFromSeconds(unit));
		if (val >= 1.0) {
			return (Math.sign(seconds) * Math.round(val * 100)) / 100.0 + unit.substring(0, 1);
		}
	}
	return `${Math.round(seconds * 100) / 100.0}s`;
}
