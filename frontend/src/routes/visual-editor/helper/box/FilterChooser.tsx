import { type Edge, type Node, useEdges, useReactFlow } from "@xyflow/react";
import { useContext, useState } from "react";
import { LuPlus } from "react-icons/lu";
import FilterLabelIcon from "@/components/FilterLabelIcon";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { useOcelInfo } from "@/hooks";
import { OcelInfoContext } from "@/lib/ocel-info-context";
import { getPossibleE2OVariables, getPossibleO2OVariables } from "@/lib/variable-hints";
import type { BindingBox } from "@/types/generated/BindingBox";
import type { Constraint } from "@/types/generated/Constraint";
import type { EventVariable } from "@/types/generated/EventVariable";
import type { Filter } from "@/types/generated/Filter";
import type { FilterLabel } from "@/types/generated/FilterLabel";
import type { ObjectVariable } from "@/types/generated/ObjectVariable";
import type { SizeFilter } from "@/types/generated/SizeFilter";
import { getParentsNodeIDs } from "../evaluation/evaluate-constraints";
import type { EventTypeLinkData, EventTypeNodeData, GateNodeData } from "../types";
import { VisualEditorContext } from "../VisualEditorContext";
import FilterOrConstraintEditor, { FilterOrConstraintDisplay } from "./FilterOrConstraintEditor";
import { getEvVarName, getObVarName } from "./variable-names";
export const INVALID_VARIABLE_PLACEHOLDER = 99999;
export default function FilterChooser({
	id,
	box,
	updateBox,
	type,
}: {
	id: string;
	box: BindingBox;
	updateBox: (box: BindingBox) => unknown;
	type: "filter" | "constraint";
}) {
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
	const allBoxes = [
		...parentIDs
			.map((pid) => {
				const node = getNode(pid);
				if (node?.data !== undefined && "box" in node.data) {
					return node.data.box;
				}
				return undefined;
			})
			.filter((b) => b !== undefined),
		box,
	];
	const ocelInfo = useOcelInfo();
	const [alertState, setAlertState] = useState<
		(
			| {
					type: "filter";
					value?: Filter | SizeFilter | Constraint;
			  }
			| { type: "sizeFilter"; value?: Filter | SizeFilter | Constraint }
			| { type: "constraint"; value?: Filter | SizeFilter | Constraint }
		) &
			({ mode: "add" } | { mode: "edit"; editIndex: number; wasSizeFilter: boolean })
	>();

	return (
		<div className="w-full text-left border-t border-t-slate-700 mt-1 pt-1">
			<div className="flex items-center gap-x-1">
				<Label>{type === "filter" ? "Filters" : "Constraints"}</Label>
				<Button
					size="icon"
					variant="ghost"
					className="h-4 w-4 hover:bg-blue-400/50 hover:border-blue-500/50 mt-1 rounded-full"
					onClick={() => {
						setAlertState({ mode: "add", type });
					}}
				>
					<LuPlus size={10} />
				</Button>
			</div>
			<ul className="w-full">
				{type === "filter" &&
					box.filters.map((fc, i) => (
						<li key={i} className="flex items-baseline gap-x-1">
							{(fc.type === "O2E" || fc.type === "O2O") && filterMode === "shown" && (
								<button
									onClick={() => {
										const prevFilterLabel = fc.filterLabel ?? "IGNORED";
										let newFilterLabel: FilterLabel = "IGNORED";
										if (prevFilterLabel === "IGNORED") {
											newFilterLabel = "INCLUDED";
										} else if (prevFilterLabel === "INCLUDED") {
											newFilterLabel = "EXCLUDED";
										}
										const newFilters = [...box.filters];
										newFilters[i] = { ...fc, filterLabel: newFilterLabel };
										updateBox({ ...box, filters: newFilters });
									}}
								>
									<FilterLabelIcon label={fc.filterLabel ?? "IGNORED"} />
								</button>
							)}
							<button
								className="hover:bg-blue-200/50 rounded-sm text-left w-full max-w-full"
								onContextMenuCapture={(ev) => {
									ev.stopPropagation();
								}}
								onClick={() => {
									setAlertState({
										editIndex: i,
										mode: "edit",
										type: "filter",
										value: JSON.parse(JSON.stringify(fc)),
										wasSizeFilter: false,
									});
								}}
							>
								<FilterOrConstraintDisplay value={fc} />
							</button>
						</li>
					))}
				{type === "filter" &&
					box.sizeFilters.map((sf, i) => (
						<li key={`sizeFilters${i}`}>
							<button
								className="hover:bg-blue-200/50 rounded-sm text-left w-fit max-w-full"
								onContextMenuCapture={(ev) => {
									ev.stopPropagation();
								}}
								onClick={() => {
									setAlertState({
										editIndex: i,
										mode: "edit",
										type: "filter",
										value: JSON.parse(JSON.stringify(sf)),
										wasSizeFilter: true,
									});
								}}
							>
								<FilterOrConstraintDisplay value={sf} />
							</button>
						</li>
					))}
				{type === "constraint" &&
					box.constraints.map((c, i) => (
						<li key={`constraints${i}`} className="w-full pr-[2.33rem]">
							<button
								onContextMenuCapture={(ev) => {
									ev.stopPropagation();
								}}
								className="hover:bg-blue-200/50 rounded-sm text-left w-fit max-w-full"
								onClick={() => {
									setAlertState({
										editIndex: i,
										mode: "edit",
										type: "constraint",
										value: JSON.parse(JSON.stringify(c)),
										wasSizeFilter: false,
									});
								}}
							>
								<FilterOrConstraintDisplay value={c} />
							</button>
						</li>
					))}
			</ul>
			<AlertDialog
				open={alertState !== undefined}
				onOpenChange={(o) => {
					if (!o) {
						setAlertState(undefined);
					}
				}}
			>
				{alertState !== undefined && (
					<AlertDialogContent
						className="max-w-3xl"
						onContextMenuCapture={(ev) => {
							ev.stopPropagation();
						}}
					>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{alertState?.mode === "add" ? "Add " : "Edit "}{" "}
								{alertState.type !== "constraint" ? "Filter" : "Constraint"}
							</AlertDialogTitle>
							<AlertDialogDescription className="hidden">
								{alertState?.mode === "add" ? "Add " : "Edit "}{" "}
								{alertState.type !== "constraint" ? "Filter" : "Constraint"}
							</AlertDialogDescription>
							<div className="text-sm text-gray-700 grid grid-cols-1 gap-y-1.5">
								<Label>Type</Label>
								<Combobox
									name="Type"
									value={
										alertState.value !== undefined
											? alertState.value.type === "Filter"
												? alertState.value.filter.type
												: alertState.value.type === "SizeFilter"
													? alertState.value.filter.type
													: alertState.value.type
											: ""
									}
									options={[
										{
											label: "E2O: Event-To-Object Relationship",
											value: "O2E",
										},
										{
											label: "O2O: Object-To-Object Relationship",
											value: "O2O",
										},
										{
											label: "TBE: Time between Events",
											value: "TimeBetweenEvents",
										},
										// {
										//   label: "Variables not equal",
										//   value: "NotEqual",
										// },
										{
											label: "EAE/EAR: Event Attribute Value",
											value: "EventAttributeValueFilter",
										},
										{
											label: "OAE/OAR: Object Attribute Value",
											value: "ObjectAttributeValueFilter",
										},
										{
											label: "BasicCEL: Basic CEL Script",
											value: "BasicFilterCEL",
										},
										...(alertState.type !== "filter" ||
										alertState.mode !== "edit" ||
										alertState.wasSizeFilter
											? [
													{
														label: "CBS: Child Bindings Set Size",
														value: "NumChilds",
													},
													{
														label: "CBE: Child Binding Sets Equal",
														value: "BindingSetEqual",
													},
													{
														label: "CBPS: Projected Child Bindings Set Size",
														value: "NumChildsProj",
													},
													{
														label: "CBPE: Projected Child Binding Sets Equal",
														value: "BindingSetProjectionEqual",
													},
													{
														label: "AdvCEL: Advanced CEL Script",
														value: "AdvancedCEL",
													},
												]
											: []),

										...(alertState.type === "constraint"
											? [
													{
														label: "SAT: All Child Bindings Satisfied",
														value: "SAT",
													},
													{
														label: "ANY: Any Child Binding Satisfied",
														value: "ANY",
													},
													{ label: "ALL NOT: Logic NOT (ALL)", value: "NOT" },
													{ label: "OR ALL: Logic OR (ALL)", value: "OR" },
													{ label: "AND ALL: Logic AND", value: "AND" },
												]
											: []),
									]}
									onChange={(val) => {
										const childVars = getAvailableChildNames(id);
										const objectVariables = getAvailableVars(id, "object");
										const eventVariables = getAvailableVars(id, "event");
										if (val === "O2E") {
											const possibleVars = getPossibleE2OVariables(
												ocelInfo,
												getTypesForVariable,
												id,
												objectVariables,
												eventVariables,
												allBoxes,
											);
											setAlertState({
												...alertState,
												value: {
													type: "O2E",
													object:
														"object" in possibleVars
															? possibleVars.object
															: INVALID_VARIABLE_PLACEHOLDER,
													event:
														"event" in possibleVars
															? possibleVars.event
															: INVALID_VARIABLE_PLACEHOLDER,
													qualifier: null,
												},
											});
										} else if (val === "O2O") {
											const possibleVars = getPossibleO2OVariables(
												ocelInfo,
												getTypesForVariable,
												id,
												objectVariables,
												allBoxes,
											);
											setAlertState({
												...alertState,
												value: {
													type: "O2O",
													object:
														"object" in possibleVars
															? possibleVars.object
															: INVALID_VARIABLE_PLACEHOLDER,
													other_object:
														"other_object" in possibleVars
															? possibleVars.other_object
															: INVALID_VARIABLE_PLACEHOLDER,
													qualifier: null,
												},
											});
										} else if (val === "TimeBetweenEvents") {
											setAlertState({
												...alertState,
												value: {
													type: "TimeBetweenEvents",
													from_event: 0,
													to_event: 1,
													min_seconds: null,
													max_seconds: null,
												},
											});
										} else if (val === "NotEqual") {
											setAlertState({
												...alertState,
												value: {
													type: "NotEqual",
													var_1: { Object: 0 },
													var_2: { Object: 1 },
												},
											});
										} else if (val === "BasicFilterCEL") {
											setAlertState({
												...alertState,
												value: {
													type: "BasicFilterCEL",
													cel: "true",
												},
											});
										} else if (val === "NumChilds") {
											setAlertState({
												...alertState,
												value: {
													type: "NumChilds",
													child_name: childVars[0] ?? "A",
													min: null,
													max: null,
												},
											});
										} else if (val === "BindingSetEqual") {
											setAlertState({
												...alertState,
												value: {
													type: "BindingSetEqual",
													child_names: [childVars[0] ?? "A", childVars[1] ?? "B"],
												},
											});
										} else if (val === "BindingSetProjectionEqual") {
											setAlertState({
												...alertState,
												value: {
													type: "BindingSetProjectionEqual",
													child_name_with_var_name: [[childVars[0] ?? "A", { Object: 0 }]],
												},
											});
										} else if (val === "NumChildsProj") {
											setAlertState({
												...alertState,
												value: {
													type: "NumChildsProj",
													child_name: childVars[0] ?? "A",
													var_name: { Object: 0 },
													min: 1,
													max: 10,
												},
											});
										} else if (val === "AdvancedCEL") {
											setAlertState({
												...alertState,
												value: {
													type: "AdvancedCEL",
													cel: "true",
												},
											});
										} else if (alertState.type === "constraint" && val === "SAT") {
											setAlertState({
												...alertState,
												value: {
													type: "SAT",
													child_names: [childVars[0] ?? "A"],
												},
											});
										} else if (alertState.type === "constraint" && val === "ANY") {
											setAlertState({
												...alertState,
												value: {
													type: "ANY",
													child_names: [childVars[0] ?? "A"],
												},
											});
										} else if (alertState.type === "constraint" && val === "NOT") {
											setAlertState({
												...alertState,
												value: {
													type: "NOT",
													child_names: [childVars[0] ?? "A"],
												},
											});
										} else if (alertState.type === "constraint" && val === "AND") {
											setAlertState({
												...alertState,
												value: {
													type: "AND",
													child_names: [childVars[0] ?? "A", childVars[1] ?? "B"],
												},
											});
										} else if (alertState.type === "constraint" && val === "OR") {
											setAlertState({
												...alertState,
												value: {
													type: "OR",
													child_names: [childVars[0] ?? "A", childVars[1] ?? "B"],
												},
											});
										} else if (val === "EventAttributeValueFilter") {
											setAlertState({
												...alertState,
												value: {
													type: "EventAttributeValueFilter",
													event: 0,
													attribute_name: "",
													value_filter: { type: "String", is_in: [""] },
												},
											});
										} else if (val === "ObjectAttributeValueFilter") {
											setAlertState({
												...alertState,
												value: {
													type: "ObjectAttributeValueFilter",
													object: 0,
													attribute_name: "",
													value_filter: { type: "String", is_in: [""] },
													at_time: { type: "Sometime" },
												},
											});
										}
									}}
								/>
							</div>
						</AlertDialogHeader>
						{alertState.value !== undefined && (
							<div className="flex gap-x-2 mb-6">
								<FilterOrConstraintEditor
									value={alertState.value}
									updateValue={(val) => {
										setAlertState({ ...alertState, value: val as any });
									}}
									availableEventVars={availableEventVars}
									availableObjectVars={availableObjectVars}
									availableChildSets={availableChildSets}
									availableLabels={box.labels?.map((l) => l.label)}
									nodeID={id}
								/>
							</div>
						)}
						<AlertDialogFooter>
							{" "}
							{alertState.mode === "edit" && (
								<Button
									className="mr-auto"
									variant="destructive"
									onClick={() => {
										const newBox = { ...box };
										if (alertState.type === "filter") {
											if (alertState.wasSizeFilter) {
												newBox.sizeFilters.splice(alertState.editIndex, 1);
											} else {
												newBox.filters.splice(alertState.editIndex, 1);
											}
										} else {
											newBox.constraints.splice(alertState.editIndex, 1);
										}
										updateBox(newBox);
										setAlertState(undefined);
									}}
								>
									Delete
								</Button>
							)}
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								disabled={
									(alertState.value?.type === "O2E" &&
										(alertState.value.event >= INVALID_VARIABLE_PLACEHOLDER ||
											alertState.value.object >= INVALID_VARIABLE_PLACEHOLDER)) ||
									(alertState.value?.type === "O2O" &&
										(alertState.value.other_object >= INVALID_VARIABLE_PLACEHOLDER ||
											alertState.value.object >= INVALID_VARIABLE_PLACEHOLDER))
								}
								onClick={() => {
									const newBox = { ...box };
									if (alertState.value !== undefined) {
										if (
											alertState.type !== "constraint" &&
											[
												"NumChilds",
												"BindingSetEqual",
												"BindingSetProjectionEqual",
												"NumChildsProj",
												"AdvancedCEL",
											].includes(alertState.value.type)
										) {
											alertState.type = "sizeFilter";
										}
										const index =
											alertState.mode === "edit"
												? alertState.editIndex
												: (alertState.type === "filter"
														? newBox.filters
														: alertState.type === "sizeFilter"
															? newBox.sizeFilters
															: newBox.constraints
													).length;
										console.log({ newBox, index, alertState }, alertState.type);
										if (alertState.type === "filter") {
											newBox.filters[index] = alertState.value as Filter;
										} else if (alertState.type === "sizeFilter") {
											newBox.sizeFilters[index] = alertState.value as SizeFilter;
										} else if (alertState.type === "constraint") {
											if (
												[
													"NumChilds",
													"BindingSetEqual",
													"BindingSetProjectionEqual",
													"NumChildsProj",
													"AdvancedCEL",
												].includes(alertState.value.type)
											) {
												newBox.constraints[index] = {
													type: "SizeFilter",
													filter: alertState.value as SizeFilter,
												};
											} else if (
												["SAT", "ANY", "NOT", "AND", "OR", "Filter", "SizeFilter"].includes(
													alertState.value.type,
												)
											) {
												newBox.constraints[index] = alertState.value as Constraint;
											} else if (
												[
													"O2E",
													"O2O",
													"TimeBetweenEvents",
													"NotEqual",
													"BasicFilterCEL",
													"ObjectAttributeValueFilter",
													"EventAttributeValueFilter",
												].includes(alertState.value.type)
											) {
												newBox.constraints[index] = {
													type: "Filter",
													filter: alertState.value as Filter,
												};
											} else {
												newBox.constraints[index] = alertState.value as Constraint;
											}
										}
									}
									updateBox(newBox);
									setAlertState(undefined);

									// if (alertState.mode === "edit") {
									//   if (alertState.value !== undefined) {
									//     if (alertState.type === "filter") {
									//       if ("NumChilds" in alertState.f) {
									//         newBox.sizeFilters[alertState.editIndex] =
									//           alertState.f;
									//       } else {
									//         newBox.filters[alertState.editIndex] = alertState.f;
									//       }
									//     } else {
									//       if ("NumChilds" in alertState.f) {
									//         newBox.constraints[alertState.editIndex] = {
									//           SizeFilter: alertState.f,
									//         };
									//       } else {
									//         newBox.constraints[alertState.editIndex] = {
									//           Filter: alertState.f,
									//         };
									//       }
									//     }
									//   } else if (
									//     alertState.type === "constraint" &&
									//     alertState.x !== undefined
									//   ) {
									//     newBox.constraints[alertState.editIndex] = alertState.x;
									//   }
									// } else {
									//   if (alertState.f !== undefined) {
									//     if (alertState.type === "filter") {
									//       if ("NumChilds" in alertState.f) {
									//         newBox.sizeFilters.push(alertState.f);
									//       } else {
									//         newBox.filters.push(alertState.f);
									//       }
									//     } else {
									//       if ("NumChilds" in alertState.f) {
									//         newBox.constraints.push({ SizeFilter: alertState.f });
									//       } else {
									//         newBox.constraints.push({ Filter: alertState.f });
									//       }
									//     }
									//   } else if (
									//     alertState.type === "constraint" &&
									//     alertState.x !== undefined
									//   ) {
									//     newBox.constraints.push(alertState.x);
									//   }
									// };
								}}
							>
								{alertState.mode === "add" ? "Add" : "Save"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				)}
			</AlertDialog>
		</div>
	);
}

export function ObjectOrEventVarSelector({
	objectVars,
	eventVars,
	value,
	onChange,
}: {
	objectVars: ObjectVariable[];
	eventVars: EventVariable[];
	value:
		| { type: "object"; value: ObjectVariable }
		| { type: "event"; value: EventVariable }
		| undefined;
	onChange: (
		value:
			| { type: "object"; value: ObjectVariable }
			| { type: "event"; value: EventVariable }
			| undefined,
	) => unknown;
}) {
	const { getVarName } = useContext(VisualEditorContext);
	return (
		<Combobox
			options={[
				...objectVars.map((v) => ({
					label: getObVarName(v),
					value: `${v} --- object --- ${getVarName(v, "object").name}`,
				})),
				...eventVars.map((v) => ({
					label: getEvVarName(v),
					value: `${v} --- event --- ${getVarName(v, "event").name}`,
				})),
			]}
			onChange={(val) => {
				const [newVarString, type] = val.split(" --- ");
				const newVar = Number.parseInt(newVarString, 10);
				if (!Number.isNaN(newVar)) {
					onChange({ type: type as "object" | "event", value: newVar });
				} else {
					onChange(undefined);
				}
			}}
			name={"Object/Event Variable"}
			value={
				value !== undefined
					? `${value.value} --- ${value.type} --- ${getVarName(value.value, value.type).name}`
					: ""
			}
		/>
	);
}

export function ObjectVarSelector({
	objectVars,
	value,
	onChange,
	disabledStyleObjectVars,
}: {
	objectVars: ObjectVariable[];
	disabledStyleObjectVars?: ObjectVariable[];
	value: ObjectVariable | undefined;
	onChange: (value: ObjectVariable | undefined) => unknown;
}) {
	const { getVarName } = useContext(VisualEditorContext);
	return (
		<Combobox
			options={objectVars.map((v) => ({
				label: getObVarName(
					v,
					disabledStyleObjectVars !== undefined ? disabledStyleObjectVars.includes(v) : undefined,
				),
				value: `${v} --- ${getVarName(v, "object").name}`,
			}))}
			onChange={(val) => {
				const newVar = Number.parseInt(val.split(" --- ")[0], 10);
				if (!Number.isNaN(newVar)) {
					onChange(newVar);
				} else {
					onChange(undefined);
				}
			}}
			name={"Object Variable"}
			value={`${value} --- ${value !== undefined ? getVarName(value, "object").name : ""}`}
		/>
	);
}

export function EventVarSelector({
	eventVars,
	value,
	onChange,
}: {
	eventVars: EventVariable[];
	value: EventVariable | undefined;
	onChange: (value: EventVariable | undefined) => unknown;
}) {
	const { getVarName } = useContext(VisualEditorContext);
	return (
		<Combobox
			options={eventVars.map((v) => ({
				label: getEvVarName(v),
				value: `${v} --- ${getVarName(v, "event").name}`,
			}))}
			onChange={(val) => {
				const newVar = Number.parseInt(val.split(" --- ")[0], 10);
				if (!Number.isNaN(newVar)) {
					onChange(newVar);
				} else {
					onChange(undefined);
				}
			}}
			name={"Event Variable"}
			value={`${value} --- ${value !== undefined ? getVarName(value, "event").name : ""}`}
		/>
	);
}
