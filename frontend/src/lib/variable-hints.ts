import type { VisualEditorContextValue } from "@/routes/visual-editor/helper/VisualEditorContext";
import type { BindingBox } from "@/types/generated/BindingBox";
import type { EventVariable } from "@/types/generated/EventVariable";
import type { Filter } from "@/types/generated/Filter";
import type { ObjectVariable } from "@/types/generated/ObjectVariable";
import type { OCELInfo } from "@/types/ocel";

export function deDupe<T>(values: T[]): T[] {
	return [...new Set(values).values()];
}

export function getNodeRelationshipSupport(
	ocelInfo: OCELInfo,
	getTypesForVariable: VisualEditorContextValue["getTypesForVariable"],
	nodeID: string,
	var1: ObjectVariable | EventVariable,
	var2: ObjectVariable,
	isE2O: boolean,
): number {
	const types1 = getTypesForVariable(nodeID, var1, isE2O ? "event" : "object");
	const types2 = getTypesForVariable(nodeID, var2, "object");
	return getTypesRelationshipSupport(
		ocelInfo,
		types1.map((t) => t.name),
		types2.map((t) => t.name),
		isE2O,
	);
}

export function getTypesRelationshipSupport(
	ocelInfo: OCELInfo,
	firstTypes: string[],
	secondTypes: string[],
	isE2O: boolean,
): number {
	let support = 0;
	for (const type1 of firstTypes) {
		for (const type2 of secondTypes) {
			const types = isE2O ? ocelInfo?.e2o_types : ocelInfo?.o2o_types;
			support += types?.[type1]?.[type2]?.[0] ?? 0;
		}
	}
	return support;
}

export function getTypesRelationshipQualifiers(
	ocelInfo: OCELInfo,
	firstTypes: string[],
	secondTypes: string[],
	isE2O: boolean,
): string[] {
	const types = isE2O ? ocelInfo.e2o_types : ocelInfo.o2o_types;
	const qualifiers = new Set<string>();
	for (const type1 of firstTypes) {
		for (const type2 of secondTypes) {
			for (const q of types?.[type1]?.[type2]?.[1] ?? []) {
				qualifiers.add(q);
			}
		}
	}
	return [...qualifiers];
}

/** Scans in list order and stops after `limit` matches, so a log with millions of distinct
 *  qualifiers stays cheap to search. A qualifier equal to `search` comes first, then the other
 *  returned matches, sorted. */
export function matchQualifiers(
	qualifiers: string[],
	search: string,
	limit: number,
): { matches: string[]; more: boolean } {
	const needle = search.toLowerCase();
	// Comes first, so it can be picked even with more matches than the limit.
	const exact = search !== "" && qualifiers.includes(search) ? search : undefined;
	const room = exact === undefined ? limit : limit - 1;
	const matches: string[] = [];
	let more = false;
	for (const q of qualifiers) {
		if (q === exact || !q.toLowerCase().includes(needle)) continue;
		if (matches.length === room) {
			more = true;
			break;
		}
		matches.push(q);
	}
	matches.sort((a, b) => a.localeCompare(b));
	return { matches: exact === undefined ? matches : [exact, ...matches], more };
}

export function getNodeRelationshipQualifiers(
	ocelInfo: OCELInfo,
	getTypesForVariable: VisualEditorContextValue["getTypesForVariable"],
	nodeID: string,
	var1: ObjectVariable | EventVariable,
	var2: ObjectVariable,
	isE2O: boolean,
): string[] {
	const types1 = getTypesForVariable(nodeID, var1, isE2O ? "event" : "object");
	const types2 = getTypesForVariable(nodeID, var2, "object");
	return getTypesRelationshipQualifiers(
		ocelInfo,
		types1.map((t) => t.name),
		types2.map((t) => t.name),
		isE2O,
	);
}

/** Events only relate to objects (E2O). Objects relate to events (E2O) and to objects (O2O, either direction). */
export function getTypesRelatedToBound(
	ocelInfo: OCELInfo,
	variant: "object" | "event",
	boundObjectTypes: string[],
	boundEventTypes: string[],
): string[] {
	if (variant === "event") {
		return ocelInfo.event_types
			.map((t) => t.name)
			.filter((et) => getTypesRelationshipSupport(ocelInfo, [et], boundObjectTypes, true) > 0);
	}
	return ocelInfo.object_types
		.map((t) => t.name)
		.filter(
			(ot) =>
				getTypesRelationshipSupport(ocelInfo, boundEventTypes, [ot], true) > 0 ||
				getTypesRelationshipSupport(ocelInfo, boundObjectTypes, [ot], false) > 0 ||
				getTypesRelationshipSupport(ocelInfo, [ot], boundObjectTypes, false) > 0,
		);
}

export function getPossibleE2OVariables(
	ocelInfo: OCELInfo | undefined,
	getTypesForVariable: VisualEditorContextValue["getTypesForVariable"],
	nodeID: string,
	objectVariables: ObjectVariable[],
	eventVariables: EventVariable[],
	allBoxes: BindingBox[] | undefined = undefined,
): { object: ObjectVariable; event: EventVariable } | Record<string, never> {
	if (ocelInfo === undefined) {
		return {};
	}
	let backup: { object: ObjectVariable; event: EventVariable } | undefined;
	for (const evVar of eventVariables) {
		for (const obVar of objectVariables) {
			const support = getNodeRelationshipSupport(
				ocelInfo,
				getTypesForVariable,
				nodeID,
				evVar,
				obVar,
				true,
			);
			if (support > 0) {
				if (allBoxes !== undefined) {
					const existingE2OFilter = allBoxes
						.flatMap((b) => b.filters)
						.find((f) => f.type === "O2E" && f.event === evVar && f.object === obVar);
					if (existingE2OFilter !== undefined) {
						if (backup === undefined) {
							backup = { object: obVar, event: evVar };
						}
						continue;
					}
				}
				return { object: obVar, event: evVar };
			}
		}
	}
	// Every supported pair is already filtered on somewhere in the tree. Reuse one anyway: a sibling
	// box scopes its own variables and needs the same pair. Returning nothing leaves the editor with
	// unset variables and a disabled submit, with nothing saying why.
	return backup ?? {};
}

export function getPossibleO2OVariables(
	ocelInfo: OCELInfo | undefined,
	getTypesForVariable: VisualEditorContextValue["getTypesForVariable"],
	nodeID: string,
	objectVariables: ObjectVariable[],
	allBoxes: BindingBox[] | undefined = undefined,
): { object: ObjectVariable; other_object: ObjectVariable } | Record<string, never> {
	if (ocelInfo === undefined) {
		return {};
	}
	let backup: { object: ObjectVariable; other_object: ObjectVariable } | undefined;
	for (const obVar1 of objectVariables) {
		for (const obVar2 of objectVariables) {
			if (obVar1 === obVar2) {
				continue;
			}
			const support = getNodeRelationshipSupport(
				ocelInfo,
				getTypesForVariable,
				nodeID,
				obVar1,
				obVar2,
				false,
			);
			if (support > 0) {
				if (allBoxes !== undefined) {
					const existingO2OFilter = allBoxes
						.flatMap((b) => b.filters)
						.find((f) => f.type === "O2O" && f.object === obVar1 && f.other_object === obVar2);
					if (existingO2OFilter !== undefined) {
						if (backup === undefined) {
							backup = { object: obVar1, other_object: obVar2 };
						}
						continue;
					}
				}
				return { object: obVar1, other_object: obVar2 };
			}
			const reverseSupport = getNodeRelationshipSupport(
				ocelInfo,
				getTypesForVariable,
				nodeID,
				obVar2,
				obVar1,
				false,
			);
			if (reverseSupport > 0) {
				if (allBoxes !== undefined) {
					// TODO: Also check parent nodes?!
					const existingO2OFilter = allBoxes
						.flatMap((b) => b.filters)
						.find((f) => f.type === "O2O" && f.object === obVar2 && f.other_object === obVar1);
					if (existingO2OFilter !== undefined) {
						if (backup === undefined) {
							backup = { object: obVar2, other_object: obVar1 };
						}
						continue;
					}
				}
				return { object: obVar2, other_object: obVar1 };
			}
		}
	}
	// Same fallback as the E2O case: an already-used pair beats leaving the editor unusable.
	return backup ?? {};
}

export type VariableWithTypes = { kind: "object" | "event"; variable: number; types: string[] };

export type ConnectionCandidate = {
	key: string;
	filter: Filter & ({ type: "O2E" } | { type: "O2O" });
	/** Relations between the two variables' types in the OCEL. */
	support: number;
	/** Computed on demand, since a log can record millions of distinct qualifiers. */
	suggestQualifiers: () => string[];
};

/** E2O and O2O filters that would connect a newly added variable to one already in scope, the
 *  best supported first. Events relate to objects only. Objects relate to events and, in either
 *  direction, to other objects. */
export function getConnectionCandidates(
	ocelInfo: OCELInfo,
	added: VariableWithTypes,
	bound: VariableWithTypes[],
): ConnectionCandidate[] {
	const candidates: ConnectionCandidate[] = [];
	const consider = (
		filter: ConnectionCandidate["filter"],
		firstTypes: string[],
		secondTypes: string[],
		isE2O: boolean,
	) => {
		const support = getTypesRelationshipSupport(ocelInfo, firstTypes, secondTypes, isE2O);
		if (support === 0) return;
		const other = filter.type === "O2E" ? `e${filter.event}` : `o${filter.other_object}`;
		candidates.push({
			key: `${filter.type}:o${filter.object}:${other}`,
			filter,
			support,
			suggestQualifiers: () =>
				getTypesRelationshipQualifiers(ocelInfo, firstTypes, secondTypes, isE2O),
		});
	};
	for (const b of bound) {
		if (added.kind === "event" && b.kind === "object") {
			consider(
				{ type: "O2E", object: b.variable, event: added.variable, qualifier: null },
				added.types,
				b.types,
				true,
			);
		} else if (added.kind === "object" && b.kind === "event") {
			consider(
				{ type: "O2E", object: added.variable, event: b.variable, qualifier: null },
				b.types,
				added.types,
				true,
			);
		} else if (added.kind === "object" && b.kind === "object" && b.variable !== added.variable) {
			consider(
				{ type: "O2O", object: b.variable, other_object: added.variable, qualifier: null },
				b.types,
				added.types,
				false,
			);
			consider(
				{ type: "O2O", object: added.variable, other_object: b.variable, qualifier: null },
				added.types,
				b.types,
				false,
			);
		}
	}
	// Array.sort is stable, so equally supported candidates keep the order of `bound`.
	return candidates.sort((a, b) => b.support - a.support);
}
