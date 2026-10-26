import { createContext } from "react";
import type { PinTarget } from "./inspector-state";

type InspectorContextValue = {
	pin: (target: PinTarget) => unknown;
	unpin: (key: string) => unknown;
};

export const InspectorContext = createContext<InspectorContextValue>({
	pin: () => {},
	unpin: () => {},
});
