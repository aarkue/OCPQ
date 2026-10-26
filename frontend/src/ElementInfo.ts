import { createContext } from "react";

export type ElementRef = {
	type: "event" | "object";
	req: { id: string } | { index: number };
};

type ElementInfoContextValue = {
	/** Pins an element, for places where no card can show it inline. */
	showElementInfo: (el: ElementRef | undefined) => unknown;
	/** Opens the search palette. */
	openElementSearch: () => unknown;
};

export const ElementInfoContext = createContext<ElementInfoContextValue>({
	showElementInfo: () => {},
	openElementSearch: () => {},
});
