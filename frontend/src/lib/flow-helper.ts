
export function isEditorElementTarget(el: HTMLElement | EventTarget | null,isInitial = true): boolean {
  return (
    (isInitial && el === document.body) ||
    (el !== null && "className" in el && (el.className?.includes("react-flow") || isEditorElementTarget(el.parentElement,false)))
  );
}

