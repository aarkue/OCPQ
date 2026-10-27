/** Wheel events less than this far apart belong to one gesture. */
const GESTURE_GAP_MS = 200;

/** Tells whether a wheel event zooms or scrolls, by the keys held when its gesture started. So
 *  pressing Ctrl in the middle of a scroll does not zoom the graph while the scroll keeps moving
 *  the panel. */
export function wheelGesture() {
	let last = Number.NEGATIVE_INFINITY;
	let zoom = false;
	return (ev: Pick<WheelEvent, "timeStamp" | "ctrlKey" | "metaKey">): "zoom" | "scroll" => {
		if (ev.timeStamp - last > GESTURE_GAP_MS) zoom = ev.ctrlKey || ev.metaKey;
		last = ev.timeStamp;
		return zoom ? "zoom" : "scroll";
	};
}

/** Scrolls the nearest scrollable ancestor of `el` by the event's delta. For a scroll gesture that
 *  goes on with Ctrl held, where the browser would zoom the page instead. */
export function scrollAncestor(el: Element, ev: WheelEvent) {
	const line = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? window.innerHeight : 1;
	for (let p = el.parentElement; p !== null; p = p.parentElement) {
		const { overflowY } = getComputedStyle(p);
		if ((overflowY === "auto" || overflowY === "scroll") && p.scrollHeight > p.clientHeight) {
			p.scrollBy({ left: ev.deltaX * line, top: ev.deltaY * line });
			return;
		}
	}
	window.scrollBy({ left: ev.deltaX * line, top: ev.deltaY * line });
}
