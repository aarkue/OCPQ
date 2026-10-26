import { type Edge, type Node, useEdges, useReactFlow } from "@xyflow/react";
import clsx from "clsx";
import type { ReactNode } from "react";
import { useCallback, useContext, useMemo, useState } from "react";
import {
	LuArrowLeftRight,
	LuBraces,
	LuCheck,
	LuCheckCheck,
	LuClock,
	LuHash,
	LuInfo,
	LuLink,
	LuPlus,
	LuTags,
} from "react-icons/lu";
import { PiCodeFill } from "react-icons/pi";
import FilterLabelIcon from "@/components/FilterLabelIcon";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CardTypeSelector, type CardTypeSelectorOption } from "@/components/ui/card-type-selector";
import { Label } from "@/components/ui/label";
import { useOcelInfo } from "@/hooks";
import { getPossibleE2OVariables, getPossibleO2OVariables } from "@/lib/variable-hints";
import type { BindingBox } from "@/types/generated/BindingBox";
import type { Constraint } from "@/types/generated/Constraint";
import type { Filter } from "@/types/generated/Filter";
import type { FilterLabel } from "@/types/generated/FilterLabel";
import type { SizeFilter } from "@/types/generated/SizeFilter";
import { getParentsNodeIDs } from "../evaluation/evaluate-constraints";
import type { EventTypeLinkData, EventTypeNodeData, GateNodeData } from "../types";
import { VisualEditorContext } from "../VisualEditorContext";
import { INVALID_VARIABLE_PLACEHOLDER } from "./FilterChooser";
import FilterOrConstraintEditor, { FilterOrConstraintDisplay } from "./FilterOrConstraintEditor";

type FilterType = Filter["type"];
type SizeFilterType = SizeFilter["type"];
type ConstraintType = Constraint["type"];
type AllFilterTypes = FilterType | SizeFilterType | ConstraintType;

// All filter types in a flat list for single-click selection
const ALL_FILTER_TYPES: AllFilterTypes[] = [
	"O2E",
	"O2O",
	"TimeBetweenEvents",
	"EventAttributeValueFilter",
	"ObjectAttributeValueFilter",
	"NotEqual",
	"BasicFilterCEL",
	"AdvancedCEL",
	"NumChilds",
	"BindingSetEqual",
	"NumChildsProj",
	"BindingSetProjectionEqual",
	"SAT",
	"ANY",
	"NOT",
	"OR",
	"AND",
];

// Filter type metadata with icons
const FILTER_TYPE_INFO: Record<
	AllFilterTypes,
	{ label: string; shortLabel: string; description: string; icon: ReactNode }
> = {
	O2E: {
		label: "Event-To-Object",
		shortLabel: "E2O",
		description: "Link event to related object",
		icon: <LuLink className="w-4 h-4" />,
	},
	O2O: {
		label: "Object-To-Object",
		shortLabel: "O2O",
		description: "Link two objects together",
		icon: <LuLink className="w-4 h-4" />,
	},
	TimeBetweenEvents: {
		label: "Time Between Events",
		shortLabel: "TBE",
		description: "Duration between two events",
		icon: <LuClock className="w-4 h-4" />,
	},
	NotEqual: {
		label: "Not Equal",
		shortLabel: "NEQ",
		description: "Variables must differ",
		icon: <span className="w-4 h-4 font-bold text-xs">≠</span>,
	},
	EventAttributeValueFilter: {
		label: "Event Attribute",
		shortLabel: "EAE/EAR",
		description: "Filter by event attribute",
		icon: <LuTags className="w-4 h-4" />,
	},
	ObjectAttributeValueFilter: {
		label: "Object Attribute",
		shortLabel: "OAE/OAR",
		description: "Filter by object attribute",
		icon: <LuTags className="w-4 h-4" />,
	},
	BasicFilterCEL: {
		label: "CEL Expression",
		shortLabel: "CEL",
		description: "Custom expression filter",
		icon: <PiCodeFill className="w-4 h-4" />,
	},
	AdvancedCEL: {
		label: "Advanced CEL",
		shortLabel: "CEL+",
		description: "CEL with child set access",
		icon: <LuBraces className="w-4 h-4" />,
	},
	NumChilds: {
		label: "Child Count",
		shortLabel: "CBS",
		description: "Number of child bindings",
		icon: <LuHash className="w-4 h-4" />,
	},
	BindingSetEqual: {
		label: "Sets Equal",
		shortLabel: "CBE",
		description: "Child binding sets must match",
		icon: <LuArrowLeftRight className="w-4 h-4" />,
	},
	NumChildsProj: {
		label: "Projected Count",
		shortLabel: "CBPS",
		description: "Projected child bindings size",
		icon: <LuHash className="w-4 h-4" />,
	},
	BindingSetProjectionEqual: {
		label: "Projected Equal",
		shortLabel: "CBPE",
		description: "Projected child sets equal",
		icon: <LuArrowLeftRight className="w-4 h-4" />,
	},
	SAT: {
		label: "All Satisfied",
		shortLabel: "SAT",
		description: "All child bindings satisfied",
		icon: <LuCheckCheck className="w-4 h-4" />,
	},
	ANY: {
		label: "Any Satisfied",
		shortLabel: "ANY",
		description: "At least one child satisfied",
		icon: <LuCheck className="w-4 h-4" />,
	},
	NOT: {
		label: "Not",
		shortLabel: "NOT",
		description: "Negate child constraint",
		icon: <span className="w-4 h-4 font-bold text-xs">!</span>,
	},
	OR: {
		label: "Or",
		shortLabel: "OR",
		description: "Any child constraint holds",
		icon: <span className="w-4 h-4 font-bold text-xs">∨</span>,
	},
	AND: {
		label: "And",
		shortLabel: "AND",
		description: "All child constraints hold",
		icon: <span className="w-4 h-4 font-bold text-xs">∧</span>,
	},
	Filter: {
		label: "Filter Wrapper",
		shortLabel: "Filter",
		description: "Wraps a filter",
		icon: null,
	},
	SizeFilter: {
		label: "Size Filter Wrapper",
		shortLabel: "SizeFilter",
		description: "Wraps a size filter",
		icon: null,
	},
};

type Role = "filter" | "constraint";
type Predicate = Filter | SizeFilter | Constraint;

const SIZE_FILTER_TYPES: AllFilterTypes[] = [
	"NumChilds",
	"BindingSetEqual",
	"BindingSetProjectionEqual",
	"NumChildsProj",
	"AdvancedCEL",
];
const LOGIC_TYPES: AllFilterTypes[] = ["SAT", "ANY", "NOT", "OR", "AND"];

const ROLE_EFFECT: Record<Role, string> = {
	filter: "Bindings that do not match are removed.",
	constraint: "Bindings stay, and the ones that do not match count as violations.",
};

type AlertState = {
	/** The section the dialog was opened from. */
	openedAs: Role;
	role: Role;
	value?: Predicate;
	/** The entry being edited, absent while adding. */
	origin?: { list: "filters" | "sizeFilters" | "constraints"; index: number };
	showTypes: boolean;
};

/** Constraints wrap plain filters. The editor works on the unwrapped filter. */
function unwrap(c: Predicate): Predicate {
	return c.type === "Filter" || c.type === "SizeFilter" ? c.filter : c;
}

interface FilterChooserDialogProps {
	id: string;
	box: BindingBox;
	updateBox: (box: BindingBox) => unknown;
	type: "filter" | "constraint";
}

export default function FilterChooserDialog({
	id,
	box,
	updateBox,
	type,
}: FilterChooserDialogProps) {
	const { getAvailableVars, getAvailableChildNames, filterMode, getTypesForVariable } =
		useContext(VisualEditorContext);
	const edges = useEdges();
	const { getNode } = useReactFlow<
		Node<EventTypeNodeData | GateNodeData>,
		Edge<EventTypeLinkData>
	>();
	const availableObjectVars = getAvailableVars(id, "object");
	const availableEventVars = getAvailableVars(id, "event");
	const availableChildSets = getAvailableChildNames(id);
	const parentIDs = getParentsNodeIDs(id, edges);
	const ocelInfo = useOcelInfo();

	const allBoxes = useMemo(() => {
		const parentBoxes = parentIDs
			.map((pid) => {
				const node = getNode(pid);
				if (node?.data !== undefined && "box" in node.data) {
					return node.data.box;
				}
				return undefined;
			})
			.filter((b): b is BindingBox => b !== undefined);
		return [...parentBoxes, box];
	}, [parentIDs, getNode, box]);

	const [alertState, setAlertState] = useState<AlertState | undefined>();

	const role = alertState?.role;
	const availableTypes = useMemo(
		() => ALL_FILTER_TYPES.filter((t) => role === "constraint" || !LOGIC_TYPES.includes(t)),
		[role],
	);

	// Check if a filter type has the required variables to be useful
	const hasRequiredVariables = useCallback(
		(filterType: AllFilterTypes): boolean => {
			const numEvents = availableEventVars.length;
			const numObjects = availableObjectVars.length;
			const numChildSets = availableChildSets.length;

			switch (filterType) {
				case "O2E":
					// Requires at least 1 event AND 1 object
					return numEvents >= 1 && numObjects >= 1;
				case "O2O":
					// Requires at least 2 objects
					return numObjects >= 2;
				case "TimeBetweenEvents":
					// Requires at least 2 events
					return numEvents >= 2;
				case "EventAttributeValueFilter":
					// Requires at least 1 event
					return numEvents >= 1;
				case "ObjectAttributeValueFilter":
					// Requires at least 1 object
					return numObjects >= 1;
				case "NotEqual":
					// Requires at least 2 variables (any combination)
					return numEvents + numObjects >= 2;
				case "NumChilds":
				case "NumChildsProj":
				case "SAT":
				case "ANY":
				case "NOT":
					// Requires at least 1 child set
					return numChildSets >= 1;
				case "BindingSetEqual":
				case "BindingSetProjectionEqual":
				case "OR":
				case "AND":
					return numChildSets >= 2;
				case "BasicFilterCEL":
				case "AdvancedCEL":
					// Always available
					return true;
				default:
					return true;
			}
		},
		[availableEventVars.length, availableObjectVars.length, availableChildSets.length],
	);

	// Get current filter type
	const getCurrentType = (): AllFilterTypes | undefined => {
		if (!alertState?.value) return undefined;
		if (alertState.value.type === "Filter") return alertState.value.filter.type;
		if (alertState.value.type === "SizeFilter") return alertState.value.filter.type;
		return alertState.value.type;
	};

	// Create options for CardTypeSelector, sorted with available options first
	const typeOptions: CardTypeSelectorOption<string>[] = useMemo(() => {
		const options = availableTypes.map((filterType) => {
			const info = FILTER_TYPE_INFO[filterType];
			const hasVars = hasRequiredVariables(filterType);
			return {
				value: filterType,
				title: `${info.label} (${info.shortLabel})`,
				description: info.description,
				icon: info.icon,
				softDisabled: !hasVars,
			};
		});
		// Sort: available options first, then soft-disabled ones
		return options.sort((a, b) => {
			if (a.softDisabled === b.softDisabled) return 0;
			return a.softDisabled ? 1 : -1;
		});
	}, [availableTypes, hasRequiredVariables]);

	// Create default value for a filter type
	const createDefaultValue = (filterType: AllFilterTypes): Filter | SizeFilter | Constraint => {
		const childVars = getAvailableChildNames(id);
		const objectVariables = getAvailableVars(id, "object");
		const eventVariables = getAvailableVars(id, "event");

		switch (filterType) {
			case "O2E": {
				const possibleVars = getPossibleE2OVariables(
					ocelInfo,
					getTypesForVariable,
					id,
					objectVariables,
					eventVariables,
					allBoxes,
				);
				return {
					type: "O2E",
					object: "object" in possibleVars ? possibleVars.object : INVALID_VARIABLE_PLACEHOLDER,
					event: "event" in possibleVars ? possibleVars.event : INVALID_VARIABLE_PLACEHOLDER,
					qualifier: null,
				};
			}
			case "O2O": {
				const possibleVars = getPossibleO2OVariables(
					ocelInfo,
					getTypesForVariable,
					id,
					objectVariables,
					allBoxes,
				);
				return {
					type: "O2O",
					object: "object" in possibleVars ? possibleVars.object : INVALID_VARIABLE_PLACEHOLDER,
					other_object:
						"other_object" in possibleVars
							? possibleVars.other_object
							: INVALID_VARIABLE_PLACEHOLDER,
					qualifier: null,
				};
			}
			case "TimeBetweenEvents":
				return {
					type: "TimeBetweenEvents",
					from_event: eventVariables[0] ?? 0,
					to_event: eventVariables[1] ?? eventVariables[0] ?? 1,
					min_seconds: 0,
					max_seconds: null,
				};
			case "NotEqual":
				return { type: "NotEqual", var_1: { Object: 0 }, var_2: { Object: 1 } };
			case "BasicFilterCEL":
				return { type: "BasicFilterCEL", cel: "true" };
			case "AdvancedCEL":
				return { type: "AdvancedCEL", cel: "true" };
			case "NumChilds":
				return {
					type: "NumChilds",
					child_name: childVars[0] ?? "A",
					min: null,
					max: null,
				};
			case "BindingSetEqual":
				return {
					type: "BindingSetEqual",
					child_names: [childVars[0] ?? "A", childVars[1] ?? "B"],
				};
			case "BindingSetProjectionEqual":
				return {
					type: "BindingSetProjectionEqual",
					child_name_with_var_name: [[childVars[0] ?? "A", { Object: 0 }]],
				};
			case "NumChildsProj":
				return {
					type: "NumChildsProj",
					child_name: childVars[0] ?? "A",
					var_name: { Object: 0 },
					min: 1,
					max: 10,
				};
			case "SAT":
				return { type: "SAT", child_names: [childVars[0] ?? "A"] };
			case "ANY":
				return { type: "ANY", child_names: [childVars[0] ?? "A"] };
			case "NOT":
				return { type: "NOT", child_names: [childVars[0] ?? "A"] };
			case "AND":
				return {
					type: "AND",
					child_names: [childVars[0] ?? "A", childVars[1] ?? "B"],
				};
			case "OR":
				return {
					type: "OR",
					child_names: [childVars[0] ?? "A", childVars[1] ?? "B"],
				};
			case "EventAttributeValueFilter":
				return {
					type: "EventAttributeValueFilter",
					event: 0,
					attribute_name: "",
					value_filter: { type: "String", is_in: [""] },
				};
			case "ObjectAttributeValueFilter":
				return {
					type: "ObjectAttributeValueFilter",
					object: 0,
					attribute_name: "",
					value_filter: { type: "String", is_in: [""] },
					at_time: { type: "Sometime" },
				};
			default:
				return { type: "BasicFilterCEL", cel: "true" };
		}
	};

	// Handle type selection
	const handleTypeChange = (filterType: string) => {
		if (alertState) {
			setAlertState({
				...alertState,
				value: createDefaultValue(filterType as AllFilterTypes),
			});
		}
	};

	const handleSave = () => {
		if (alertState?.value === undefined) return;
		const value = unwrap(alertState.value);
		const isSize = SIZE_FILTER_TYPES.includes(value.type);
		const target =
			alertState.role === "constraint" ? "constraints" : isSize ? "sizeFilters" : "filters";
		const lists = {
			filters: [...box.filters],
			sizeFilters: [...box.sizeFilters],
			constraints: [...box.constraints],
		};
		const { origin } = alertState;
		const at = origin?.list === target ? origin.index : undefined;
		if (origin !== undefined && at === undefined) lists[origin.list].splice(origin.index, 1);
		const place = <T,>(list: T[], item: T) => {
			if (at === undefined) list.push(item);
			else list[at] = item;
		};
		if (target === "filters") place(lists.filters, value as Filter);
		else if (target === "sizeFilters") place(lists.sizeFilters, value as SizeFilter);
		else if (LOGIC_TYPES.includes(value.type)) place(lists.constraints, value as Constraint);
		else if (isSize) place(lists.constraints, { type: "SizeFilter", filter: value as SizeFilter });
		else place(lists.constraints, { type: "Filter", filter: value as Filter });
		updateBox({ ...box, ...lists });
		setAlertState(undefined);
	};

	const handleDelete = () => {
		const origin = alertState?.origin;
		if (origin === undefined) return;
		const list = [...box[origin.list]];
		list.splice(origin.index, 1);
		updateBox({ ...box, [origin.list]: list });
		setAlertState(undefined);
	};

	// Check if save should be disabled
	const isSaveDisabled = () => {
		if (!alertState?.value) return true;
		if (
			alertState.value.type === "O2E" &&
			(alertState.value.event >= INVALID_VARIABLE_PLACEHOLDER ||
				alertState.value.object >= INVALID_VARIABLE_PLACEHOLDER)
		) {
			return true;
		}
		if (
			alertState.value.type === "O2O" &&
			(alertState.value.other_object >= INVALID_VARIABLE_PLACEHOLDER ||
				alertState.value.object >= INVALID_VARIABLE_PLACEHOLDER)
		) {
			return true;
		}
		return false;
	};

	const currentType = getCurrentType();

	return (
		<div className="w-full text-left border-t border-t-slate-700 mt-1 pt-1">
			<div className="flex items-center gap-x-1">
				<Label>{type === "filter" ? "Filters" : "Constraints"}</Label>
				<Button
					size="icon"
					variant="ghost"
					className="h-4 w-4 hover:bg-blue-400/50 hover:border-blue-500/50 mt-1 rounded-full"
					onClick={() => setAlertState({ openedAs: type, role: type, showTypes: true })}
				>
					<LuPlus size={10} />
				</Button>
			</div>

			{/* Existing filters/constraints list */}
			<ul className="w-full">
				{type === "filter" &&
					box.filters.map((fc, i) => (
						<li key={`filter-${fc.type}-${i}`} className="flex items-baseline gap-x-1">
							{(fc.type === "O2E" || fc.type === "O2O") && filterMode === "shown" && (
								<button
									type="button"
									onClick={() => {
										const prevFilterLabel = fc.filterLabel ?? "IGNORED";
										let newFilterLabel: FilterLabel = "IGNORED";
										if (prevFilterLabel === "IGNORED") newFilterLabel = "INCLUDED";
										else if (prevFilterLabel === "INCLUDED") newFilterLabel = "EXCLUDED";
										const newFilters = [...box.filters];
										newFilters[i] = { ...fc, filterLabel: newFilterLabel };
										updateBox({ ...box, filters: newFilters });
									}}
								>
									<FilterLabelIcon label={fc.filterLabel ?? "IGNORED"} />
								</button>
							)}
							<button
								type="button"
								className="hover:bg-blue-200/50 rounded-sm text-left w-full max-w-full"
								onContextMenuCapture={(ev) => ev.stopPropagation()}
								onClick={() =>
									setAlertState({
										openedAs: "filter",
										role: "filter",
										value: structuredClone(fc),
										origin: { list: "filters", index: i },
										showTypes: false,
									})
								}
							>
								<FilterOrConstraintDisplay value={fc} />
							</button>
						</li>
					))}
				{type === "filter" &&
					box.sizeFilters.map((sf, i) => (
						<li key={`sizeFilter-${sf.type}-${i}`}>
							<button
								type="button"
								className="hover:bg-blue-200/50 rounded-sm text-left w-fit max-w-full"
								onContextMenuCapture={(ev) => ev.stopPropagation()}
								onClick={() =>
									setAlertState({
										openedAs: "filter",
										role: "filter",
										value: structuredClone(sf),
										origin: { list: "sizeFilters", index: i },
										showTypes: false,
									})
								}
							>
								<FilterOrConstraintDisplay value={sf} />
							</button>
						</li>
					))}
				{type === "constraint" &&
					box.constraints.map((c, i) => (
						<li key={`constraint-${c.type}-${i}`} className="w-full pr-[2.33rem]">
							<button
								type="button"
								onContextMenuCapture={(ev) => ev.stopPropagation()}
								className="hover:bg-blue-200/50 rounded-sm text-left w-fit max-w-full"
								onClick={() =>
									setAlertState({
										openedAs: "constraint",
										role: "constraint",
										value: unwrap(structuredClone(c)),
										origin: { list: "constraints", index: i },
										showTypes: false,
									})
								}
							>
								<FilterOrConstraintDisplay value={c} />
							</button>
						</li>
					))}
			</ul>

			{/* Edit/Add Dialog */}
			<AlertDialog
				open={alertState !== undefined}
				onOpenChange={(o) => !o && setAlertState(undefined)}
			>
				{alertState !== undefined && (
					<AlertDialogContent
						className="max-w-[min(56rem,95vw)] max-h-[85vh] overflow-y-auto"
						onContextMenuCapture={(ev) => ev.stopPropagation()}
					>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{alertState.origin === undefined
									? `Add ${alertState.role}`
									: `Edit ${alertState.openedAs}`}
							</AlertDialogTitle>
							<AlertDialogDescription className="hidden">
								{ROLE_EFFECT[alertState.role]}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<div className="space-y-4">
							{!alertState.showTypes && currentType !== undefined ? (
								<div className="flex items-center gap-2.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
									<span className="text-sky-700">{FILTER_TYPE_INFO[currentType].icon}</span>
									<span className="font-semibold text-slate-900">
										{FILTER_TYPE_INFO[currentType].label}
									</span>
									<span className="min-w-0 truncate text-slate-600">
										{FILTER_TYPE_INFO[currentType].description}
									</span>
									<span className="flex-1" />
									<Button
										variant="link"
										size="sm"
										className="h-auto p-0 text-sky-700"
										onClick={() => setAlertState({ ...alertState, showTypes: true })}
									>
										Change
									</Button>
								</div>
							) : (
								<>
									<Label className="block">Type</Label>
									<CardTypeSelector
										className="max-h-64 px-2 overflow-auto"
										options={typeOptions}
										value={currentType ?? ""}
										onValueChange={handleTypeChange}
										columns={3}
									/>
								</>
							)}

							{alertState.value !== undefined && (
								<div>
									<Label className="mb-2 block">Configuration</Label>
									<div className="flex flex-wrap gap-2 p-4 rounded-lg border border-slate-200 bg-slate-50/50">
										<FilterOrConstraintEditor
											value={alertState.value}
											updateValue={(val) =>
												setAlertState({
													...alertState,
													value: val as Predicate,
												})
											}
											availableEventVars={availableEventVars}
											availableObjectVars={availableObjectVars}
											availableChildSets={availableChildSets}
											availableLabels={box.labels?.map((l) => l.label)}
											nodeID={id}
										/>
									</div>
								</div>
							)}
						</div>

						{alertState.role !== alertState.openedAs && (
							<p className="flex items-start gap-2 text-sm text-slate-600">
								<LuInfo className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
								<span>
									{alertState.origin === undefined ? "Adding puts it in " : "Saving moves it to "}
									{alertState.role === "constraint" ? "Constraints" : "Filters"}.{" "}
									{ROLE_EFFECT[alertState.role]}
								</span>
							</p>
						)}
						<div className="flex flex-wrap items-center gap-2">
							{alertState.origin !== undefined && (
								<>
									<Button variant="destructive" onClick={handleDelete}>
										Delete
									</Button>
									<span aria-hidden="true" className="mx-1 h-6 w-px bg-slate-200" />
								</>
							)}
							<span className="text-sm font-semibold text-slate-600">Use as</span>
							<div role="group" aria-label="Use as" className="flex rounded-md bg-slate-100 p-0.5">
								{(["filter", "constraint"] as const).map((r) => {
									const blocked =
										r === "filter" &&
										alertState.value !== undefined &&
										LOGIC_TYPES.includes(alertState.value.type);
									return (
										<button
											key={r}
											type="button"
											aria-pressed={alertState.role === r}
											disabled={blocked}
											title={
												blocked
													? "Combining child results only works as a constraint."
													: ROLE_EFFECT[r]
											}
											onClick={() => setAlertState({ ...alertState, role: r })}
											className={clsx(
												"h-7 rounded px-2.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50",
												alertState.role === r
													? "bg-white text-slate-900 shadow-sm"
													: "text-slate-600 hover:text-slate-900",
											)}
										>
											{r === "filter" ? "Filter" : "Constraint"}
										</button>
									);
								})}
							</div>
							<span className="flex-1" />
							<AlertDialogCancel className="mt-0">Cancel</AlertDialogCancel>
							<AlertDialogAction disabled={isSaveDisabled()} onClick={handleSave}>
								{submitLabel(alertState)}
							</AlertDialogAction>
						</div>
					</AlertDialogContent>
				)}
			</AlertDialog>
		</div>
	);
}

function submitLabel({ origin, role, openedAs }: AlertState) {
	if (role === openedAs) return origin === undefined ? "Add" : "Save";
	if (origin === undefined) return role === "constraint" ? "Add as constraint" : "Add as filter";
	return role === "constraint" ? "Move to constraints" : "Move to filters";
}

// Re-export selectors for use in filter editors
export {
	EventVarSelector,
	INVALID_VARIABLE_PLACEHOLDER,
	ObjectOrEventVarSelector,
	ObjectVarSelector,
} from "./FilterChooser";
