type PinchDetail = { phase: "begin" | "update" | "end"; scale: number; x: number; y: number };

/** The wheel delta browsers report for one step of a trackpad pinch that scales by `ratio`. */
export const pinchDeltaY = (ratio: number) => -100 * Math.log(ratio);

/**
 * The desktop app on Linux hands touchpad pinches to the page as `ocpq:pinch` events, since
 * WebKitGTK would otherwise zoom the whole window. Browsers report a pinch as wheel events with Ctrl
 * held, so each step is replayed as one, and the graphs and the query editor zoom as they do there.
 */
export function installPinchBridge() {
	let last = 1;
	window.addEventListener("ocpq:pinch", (ev) => {
		const { phase, scale, x, y } = (ev as CustomEvent<PinchDetail>).detail;
		if (phase === "begin") {
			last = 1;
			return;
		}
		if (phase !== "update" || scale <= 0) return;
		document.elementFromPoint(x, y)?.dispatchEvent(
			new WheelEvent("wheel", {
				deltaY: pinchDeltaY(scale / last),
				ctrlKey: true,
				clientX: x,
				clientY: y,
				bubbles: true,
				cancelable: true,
			}),
		);
		last = scale;
	});
}
