/** The modifier key of shortcuts as the keyboard labels it: ⌘ on Apple devices, Ctrl elsewhere. */
export const MOD_KEY =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
