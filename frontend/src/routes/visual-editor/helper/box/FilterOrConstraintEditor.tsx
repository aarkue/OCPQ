import { useContext } from "react";
import { LuEqual, LuTrash } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Constraint } from "@/types/generated/Constraint";
import type { Filter } from "@/types/generated/Filter";
import type { SizeFilter } from "@/types/generated/SizeFilter";
import { VisualEditorContext } from "../VisualEditorContext";
import { ObjectOrEventVarSelector } from "./FilterChooser";
import { FILTER_DISPLAYS, FILTER_EDITORS, type FilterEditorProps } from "./filter-editors";
import { ChildSetSelector, MinMaxDisplayWithSugar } from "./filter-helpers";
import { EvVarName, ObVarName } from "./variable-names";

export default function FilterOrConstraintEditor<T extends Filter | SizeFilter | Constraint>({
	value,
	updateValue,
	availableObjectVars,
	availableEventVars,
	availableChildSets,
	availableLabels,
	nodeID,
}: FilterEditorProps<T>) {
	// Must call hooks unconditionally
	const { getAvailableVars, getNodeIDByName, getAvailableChildNames } =
		useContext(VisualEditorContext);
	const childVars = getAvailableChildNames(nodeID);

	// Check if we have a registered editor for this type
	const Editor = FILTER_EDITORS[value.type];
	if (Editor) {
		return (
			<Editor
				value={value}
				updateValue={updateValue}
				availableObjectVars={availableObjectVars}
				availableEventVars={availableEventVars}
				availableChildSets={availableChildSets}
				availableLabels={availableLabels}
				nodeID={nodeID}
			/>
		);
	}

	// Handle special recursive cases that need access to FilterOrConstraintEditor

	switch (value.type) {
		case "Filter":
			return (
				<FilterOrConstraintEditor
					value={value.filter}
					updateValue={(newValue) =>
						updateValue({ type: "Filter", filter: newValue } satisfies Constraint as T)
					}
					availableEventVars={availableEventVars}
					availableObjectVars={availableObjectVars}
					availableChildSets={availableChildSets}
					nodeID={nodeID}
				/>
			);

		case "SizeFilter":
			return (
				<FilterOrConstraintEditor
					value={value.filter}
					updateValue={(newValue) =>
						updateValue({ type: "SizeFilter", filter: newValue } satisfies Constraint as T)
					}
					availableEventVars={availableEventVars}
					availableObjectVars={availableObjectVars}
					availableChildSets={availableChildSets}
					availableLabels={availableLabels}
					nodeID={nodeID}
				/>
			);

		case "BindingSetProjectionEqual":
			return (
				<>
					{value.child_name_with_var_name.map(([c, variable], i) => (
						<div key={i} className="flex gap-0.5 items-center justify-center relative pb-9">
							<ChildSetSelector
								availableChildSets={availableChildSets}
								value={c[0]}
								onChange={(v) => {
									if (v !== undefined) {
										const newItems = [...value.child_name_with_var_name];
										newItems[i][0] = v;
										updateValue({ ...value, child_name_with_var_name: newItems } as T);
									}
								}}
							/>
							<ObjectOrEventVarSelector
								objectVars={getAvailableVars(getNodeIDByName(c) ?? "-", "object")}
								eventVars={getAvailableVars(getNodeIDByName(c) ?? "-", "event")}
								value={
									"Event" in variable
										? { type: "event", value: variable.Event }
										: { type: "object", value: variable.Object }
								}
								onChange={(v) => {
									if (v !== undefined) {
										const newItems = [...value.child_name_with_var_name];
										newItems[i][1] = v.type === "event" ? { Event: v.value } : { Object: v.value };
										updateValue({ ...value, child_name_with_var_name: newItems } as T);
									}
								}}
							/>
							<Button
								className="absolute top-9 left-0"
								size="icon"
								variant="ghost"
								onClick={() => {
									const newItems = value.child_name_with_var_name.filter(
										(_: unknown, idx: number) => idx !== i,
									);
									updateValue({ ...value, child_name_with_var_name: newItems } as T);
								}}
							>
								<LuTrash className="stroke-red-500" />
							</Button>
							{i < value.child_name_with_var_name.length - 1 && <LuEqual className="ml-1" />}
						</div>
					))}
					<Button
						onClick={() => {
							updateValue({
								...value,
								child_name_with_var_name: [
									...value.child_name_with_var_name,
									[childVars[0] ?? "A", { Object: 0 }],
								],
							} as T);
						}}
					>
						Add
					</Button>
				</>
			);

		case "NumChildsProj":
			return (
				<div className="flex items-center gap-2">
					<ChildSetSelector
						availableChildSets={availableChildSets}
						value={value.child_name}
						onChange={(v) => {
							if (v !== undefined) {
								updateValue({ ...value, child_name: v } as T);
							}
						}}
					/>
					<ObjectOrEventVarSelector
						objectVars={getAvailableVars(getNodeIDByName(value.child_name) ?? "-", "object")}
						eventVars={getAvailableVars(getNodeIDByName(value.child_name) ?? "-", "event")}
						value={
							"Event" in value.var_name
								? { type: "event", value: value.var_name.Event }
								: { type: "object", value: value.var_name.Object }
						}
						onChange={(v) => {
							if (v !== undefined) {
								updateValue({
									...value,
									var_name: v.type === "event" ? { Event: v.value } : { Object: v.value },
								} as T);
							}
						}}
					/>
					<Input
						placeholder="Minimal count (optional)"
						type="number"
						value={value.min ?? ""}
						onChange={(ev) => {
							const val = ev.currentTarget.valueAsNumber;
							updateValue({ ...value, min: Number.isFinite(val) ? val : null } as T);
						}}
					/>
					<Input
						placeholder="Maximal count (optional)"
						type="number"
						value={value.max ?? ""}
						onChange={(ev) => {
							const val = ev.currentTarget.valueAsNumber;
							updateValue({ ...value, max: Number.isFinite(val) ? val : null } as T);
						}}
					/>
				</div>
			);

		default:
			return <div className="text-red-500">Unknown filter type: {(value as any).type}</div>;
	}
}

export function FilterOrConstraintDisplay<T extends Filter | SizeFilter | Constraint>({
	value,
	compact,
}: {
	value: T;
	compact?: boolean;
}) {
	// Check if we have a registered display for this type
	const Display = FILTER_DISPLAYS[value.type];
	if (Display) {
		return <Display value={value} compact={compact} />;
	}

	// Handle special recursive cases
	switch (value.type) {
		case "Filter":
			return <FilterOrConstraintDisplay value={value.filter} compact={compact} />;

		case "SizeFilter":
			return <FilterOrConstraintDisplay value={value.filter} compact={compact} />;

		case "BindingSetProjectionEqual":
			return (
				<div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
					{value.child_name_with_var_name.map(([n, v], i) => (
						<div key={i}>
							{n}
							<span>
								[{"Event" in v ? <EvVarName eventVar={v.Event} /> : <ObVarName obVar={v.Object} />}]
							</span>
							{i < value.child_name_with_var_name.length - 1 ? "=" : ""}
						</div>
					))}
				</div>
			);

		case "NumChildsProj":
			return (
				<div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
					<MinMaxDisplayWithSugar min={value.min} max={value.max}>
						|{value.child_name}
						<span className="-mx-1">
							[
							{"Event" in value.var_name ? (
								<EvVarName eventVar={value.var_name.Event} />
							) : (
								<ObVarName obVar={value.var_name.Object} />
							)}
							]
						</span>
						|
					</MinMaxDisplayWithSugar>
				</div>
			);

		default:
			return <div className="text-red-500">Unknown: {(value as any).type}</div>;
	}
}

// Re-export for convenience
export { SupportDisplay } from "./filter-helpers";
