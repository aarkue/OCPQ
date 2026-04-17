export function isEditorElementTarget(
	el: HTMLElement | EventTarget | null,
	isInitial = true,
): boolean {
	if (el !== null && "contentEditable" in el && el.contentEditable === "true") {
		return false;
	}
	return (
		(isInitial && el === document.body) ||
		(el !== null &&
			"className" in el &&
			el.className !== undefined &&
			typeof el.className.includes === "function" &&
			(el.className?.includes("react-flow") || isEditorElementTarget(el.parentElement, false)))
	);
}
