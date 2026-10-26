const ISO_PARTS = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?/;

/** Date and time of an OCEL timestamp as written in the log, so no time zone shifts it. Seconds
 *  only show when they are not zero. */
export function formatEventTime(iso: string): string {
	const m = ISO_PARTS.exec(iso);
	if (m === null) return iso;
	const seconds = m[3] !== undefined && m[3] !== ":00" ? m[3] : "";
	return `${m[1]} ${m[2]}${seconds}`;
}

/** The time from one event to the next, in its two largest units: `+1 d 4 h`, `+12 min`. */
export function formatGap(fromIso: string, toIso: string): string {
	const ms = Date.parse(toIso) - Date.parse(fromIso);
	if (Number.isNaN(ms)) return "";
	if (ms <= 0) return "same time";
	const s = Math.round(ms / 1000);
	if (s < 60) return `+${s} s`;
	const min = Math.floor(s / 60);
	if (min < 60) return `+${min} min`;
	const h = Math.floor(min / 60);
	if (h < 24) return min % 60 === 0 ? `+${h} h` : `+${h} h ${min % 60} min`;
	const d = Math.floor(h / 24);
	return h % 24 === 0 ? `+${d} d` : `+${d} d ${h % 24} h`;
}
