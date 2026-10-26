import { type PinTarget, pinKey } from "./inspector-state";

/** What a card can show inline below its own content. */
export type InspectTarget = Extract<PinTarget, { kind: "type" | "element" | "row" }>;

/** Unlike `pinKey`, which keeps one row card per box, this tells two rows of one box apart. */
export function inspectKey(target: InspectTarget): string {
	return target.kind === "row" ? `${pinKey(target)}:${JSON.stringify(target.row)}` : pinKey(target);
}

export type InspectHistory = { entries: InspectTarget[]; pos: number };

export type InspectAction =
	| { type: "show"; target: InspectTarget }
	| { type: "back" }
	| { type: "forward" }
	| { type: "close" };

export const EMPTY_INSPECT: InspectHistory = { entries: [], pos: -1 };

export function inspectReducer(state: InspectHistory, action: InspectAction): InspectHistory {
	switch (action.type) {
		case "show": {
			const current = state.entries[state.pos];
			if (current !== undefined && inspectKey(current) === inspectKey(action.target)) {
				return state;
			}
			const entries = [...state.entries.slice(0, state.pos + 1), action.target];
			return { entries, pos: entries.length - 1 };
		}
		case "back":
			return state.pos > 0 ? { ...state, pos: state.pos - 1 } : state;
		case "forward":
			return state.pos < state.entries.length - 1 ? { ...state, pos: state.pos + 1 } : state;
		case "close":
			return EMPTY_INSPECT;
	}
}

export function currentInspected(state: InspectHistory): InspectTarget | undefined {
	return state.entries[state.pos];
}
