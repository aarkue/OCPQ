import type { ParentRow } from "@/types/generated/ParentRow";

export type PinTarget =
	| { kind: "log-overview" }
	| { kind: "type-graph" }
	| { kind: "type"; isEvent: boolean; name: string }
	| { kind: "element"; type: "event" | "object"; id: string }
	| {
			kind: "result";
			/** The evaluation slot of the query, see `ocel/check-constraints-box`. */
			slot: string;
			nodeId: string;
			title: string;
			mode?: "violations" | "situations" | "satisfied-situations";
			/** Only the child rows of one row of the parent box. */
			parent?: { row: ParentRow; label: string; nodeId: string; title: string; childSet: string };
	  }
	/** One result row, shown as a graph and a timeline of what it binds. */
	| { kind: "row"; slot: string; nodeId: string; title: string; row: ParentRow };

export type Pin = { target: PinTarget; collapsed: boolean };

export type InspectorState = {
	pins: Pin[];
	/** Whether the panel is open, per page (keyed by the page's path, e.g., `/constraints`). */
	openOn: Record<string, boolean>;
	/** Unset, meaning `DEFAULT_INSPECTOR_WIDTH`, until the panel is first resized. */
	width?: number;
	/** The card pinned last, for the panel to scroll to. `seq` tells repeated pins apart. Not saved. */
	reveal?: { key: string; seq: number };
};

export type InspectorAction =
	/** Pinning opens the panel on `page`, so the pinned thing is in view. */
	| { type: "pin"; target: PinTarget; page?: string }
	| { type: "unpin"; key: string }
	| { type: "toggle-collapsed"; key: string }
	| { type: "set-open"; open: boolean; page: string }
	| { type: "set-width"; width: number }
	| { type: "reset-pins" }
	/** Unpins every card that can be unpinned, leaving the overview cards as they are. */
	| { type: "clear" };

const MIN_WIDTH = 280;
const MAX_WIDTH = 720;

/** The log overview and the type graph can be collapsed but not unpinned. */
export const DEFAULT_PINS: Pin[] = [
	{ target: { kind: "type-graph" }, collapsed: false },
	{ target: { kind: "log-overview" }, collapsed: false },
];

export const DEFAULT_INSPECTOR_WIDTH = 460;

export const INITIAL_INSPECTOR: InspectorState = { pins: DEFAULT_PINS, openOn: {} };

/** Pages where the panel starts closed. OCEL Info already shows what its default cards show, and
 *  the others have side panels of their own or no use for it. */
const CLOSED_BY_DEFAULT = new Set([
	"/",
	"/ocel-info",
	"/graph",
	"/path-schemas",
	"/data-extraction",
]);

export function isInspectorOpen(state: InspectorState, page: string): boolean {
	return state.openOn[page] ?? !CLOSED_BY_DEFAULT.has(page);
}

export function pinKey(target: PinTarget): string {
	switch (target.kind) {
		case "type":
			return `type:${target.isEvent ? "e" : "o"}:${target.name}`;
		case "element":
			return `element:${target.type}:${target.id}`;
		case "result":
			return `result:${target.slot}:${target.nodeId}`;
		case "row":
			return `row:${target.slot}:${target.nodeId}`;
		default:
			return target.kind;
	}
}

export function isDefaultPin(target: PinTarget): boolean {
	const key = pinKey(target);
	return DEFAULT_PINS.some((p) => pinKey(p.target) === key);
}

export function inspectorReducer(state: InspectorState, action: InspectorAction): InspectorState {
	switch (action.type) {
		case "pin": {
			const key = pinKey(action.target);
			const openOn =
				action.page === undefined ? state.openOn : { ...state.openOn, [action.page]: true };
			const reveal = { key, seq: (state.reveal?.seq ?? 0) + 1 };
			if (state.pins.some((p) => pinKey(p.target) === key)) {
				return {
					...state,
					openOn,
					reveal,
					pins: state.pins.map((p) =>
						pinKey(p.target) === key ? { target: action.target, collapsed: false } : p,
					),
				};
			}
			return {
				...state,
				openOn,
				reveal,
				pins: [{ target: action.target, collapsed: false }, ...state.pins],
			};
		}
		case "unpin":
			if (DEFAULT_PINS.some((p) => pinKey(p.target) === action.key)) return state;
			return { ...state, pins: state.pins.filter((p) => pinKey(p.target) !== action.key) };
		case "toggle-collapsed":
			return {
				...state,
				pins: state.pins.map((p) =>
					pinKey(p.target) === action.key ? { ...p, collapsed: !p.collapsed } : p,
				),
			};
		case "set-open":
			return { ...state, openOn: { ...state.openOn, [action.page]: action.open } };
		case "set-width":
			return { ...state, width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, action.width)) };
		case "reset-pins":
			return { ...state, pins: DEFAULT_PINS };
		case "clear":
			return { ...state, pins: state.pins.filter((p) => isDefaultPin(p.target)) };
	}
}

function isPinTarget(t: unknown): t is PinTarget {
	if (typeof t !== "object" || t === null) return false;
	const o = t as Record<string, unknown>;
	switch (o.kind) {
		case "log-overview":
		case "type-graph":
			return true;
		case "type":
			return typeof o.isEvent === "boolean" && typeof o.name === "string";
		case "element":
			return (o.type === "event" || o.type === "object") && typeof o.id === "string";
		default:
			return false;
	}
}

/** Leaves out result and row pins, as evaluations live in backend memory and are gone after a
 *  reload. */
export function saveInspector(state: InspectorState): string {
	return JSON.stringify({
		pins: state.pins.filter((p) => p.target.kind !== "result" && p.target.kind !== "row"),
		openOn: state.openOn,
		width: state.width,
	});
}

/** Reads a board saved by an earlier session. It drops pins it cannot read and returns the initial
 *  board for anything else unexpected. */
export function loadInspector(raw: string | null): InspectorState {
	if (raw === null) return INITIAL_INSPECTOR;
	try {
		const parsed = JSON.parse(raw) as Partial<InspectorState>;
		if (!Array.isArray(parsed.pins)) {
			return INITIAL_INSPECTOR;
		}
		const read = parsed.pins.filter(
			(p): p is Pin => isPinTarget(p?.target) && typeof p.collapsed === "boolean",
		);
		// The default cards always come last and in their default order, keeping whether they were
		// collapsed. Missing ones come back.
		const isDefault = (p: Pin) => DEFAULT_PINS.some((d) => pinKey(d.target) === pinKey(p.target));
		const pins = [
			...read.filter((p) => !isDefault(p)),
			...DEFAULT_PINS.map((d) => read.find((p) => pinKey(p.target) === pinKey(d.target)) ?? d),
		];
		return {
			pins,
			openOn: Object.fromEntries(
				Object.entries(parsed.openOn ?? {}).filter(([, v]) => typeof v === "boolean"),
			),
			width:
				typeof parsed.width === "number"
					? inspectorReducer(INITIAL_INSPECTOR, { type: "set-width", width: parsed.width }).width
					: undefined,
		};
	} catch {
		return INITIAL_INSPECTOR;
	}
}

export type PinGroupId = "results" | "elements" | "types" | "overview";

const PIN_GROUPS: { id: PinGroupId; title: string; kinds: PinTarget["kind"][] }[] = [
	{ id: "results", title: "Query results", kinds: ["result", "row"] },
	{ id: "elements", title: "Events & objects", kinds: ["element"] },
	{ id: "types", title: "Types", kinds: ["type"] },
	{ id: "overview", title: "Overview", kinds: ["log-overview", "type-graph"] },
];

export function pinGroupOf(target: PinTarget): PinGroupId {
	return PIN_GROUPS.find((g) => g.kinds.includes(target.kind))?.id ?? "overview";
}

/** Pins in display order: grouped by kind, newest first within a group, empty groups left out. */
export function groupPins(pins: Pin[]): { id: PinGroupId; title: string; pins: Pin[] }[] {
	return PIN_GROUPS.map((g) => ({
		id: g.id,
		title: g.title,
		pins: pins.filter((p) => g.kinds.includes(p.target.kind)),
	})).filter((g) => g.pins.length > 0);
}
