const INFINITY_STRINGS = ["infty", "infinity", "inf", "∞"];
export function parseIntAllowInfinity(s: string, allowMinusInf = false) {
	if (INFINITY_STRINGS.includes(s)) {
		return Number.POSITIVE_INFINITY;
	}
	if (allowMinusInf && s.startsWith("-") && INFINITY_STRINGS.includes(s.substring(1))) {
		return Number.NEGATIVE_INFINITY;
	}
	const num = Number.parseInt(s, 10);
	if (Number.isNaN(num)) {
		return undefined;
	}
	return num;
}
