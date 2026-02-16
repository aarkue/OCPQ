import clsx from "clsx";
import { type ComponentType, lazy, Suspense, useContext } from "react";
import { LuArrowRight, LuEqual, LuLink, LuTrash } from "react-icons/lu";
import { MdSwapHoriz } from "react-icons/md";
import { PiCodeFill } from "react-icons/pi";
import Spinner from "@/components/Spinner";
import TimeDurationInput, { formatSeconds } from "@/components/TimeDurationInput";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { deDupe, getNodeRelationshipSupport } from "@/lib/variable-hints";
import type { Constraint } from "@/types/generated/Constraint";
import type { Filter } from "@/types/generated/Filter";
import type { SizeFilter } from "@/types/generated/SizeFilter";
import { VisualEditorContext } from "../../VisualEditorContext";
import { EventVarSelector, ObjectOrEventVarSelector, ObjectVarSelector } from "../FilterChooser";
import {
	AbsolutePositionedSupportDisplay,
	AttributeNameSelector,
	AttributeValueFilterDisplay,
	AttributeValueFilterSelector,
	ChildSetSelector,
	MinMaxDisplayWithSugar,
} from "../filter-helpers";
import { EvOrObVarName, EvVarName, ObVarName } from "../variable-names";
import type { FilterDisplayProps, FilterEditorProps } from "./types";

const CELEditor = lazy(async () => await import("@/components/CELEditor"));

type AnyFilterType = (Filter | SizeFilter | Constraint)["type"];

// Registry of editor components
export const FILTER_EDITORS: Partial<Record<AnyFilterType, ComponentType<FilterEditorProps<any>>>> =
	{};

// Registry of display components
export const FILTER_DISPLAYS: Partial<
	Record<AnyFilterType, ComponentType<FilterDisplayProps<any>>>
> = {};

// Helper to create and register an editor
function registerEditor<T extends Filter | SizeFilter | Constraint>(
	type: T["type"],
	Editor: ComponentType<FilterEditorProps<T>>,
	Display: ComponentType<FilterDisplayProps<T>>,
) {
	FILTER_EDITORS[type] = Editor as ComponentType<FilterEditorProps<any>>;
	FILTER_DISPLAYS[type] = Display as ComponentType<FilterDisplayProps<any>>;
}

// O2E Filter
registerEditor<Filter & { type: "O2E" }>(
	"O2E",
	function O2EEditor({ value, updateValue, availableObjectVars, availableEventVars, nodeID }) {
		const { getTypesForVariable, ocelInfo } = useContext(VisualEditorContext);
		const support =
			ocelInfo !== undefined
				? getNodeRelationshipSupport(
						ocelInfo,
						getTypesForVariable,
						nodeID,
						value.event,
						value.object,
						true,
					)
				: null;

		return (
			<div className="flex items-center gap-x-1 pb-7 relative">
				<EventVarSelector
					eventVars={availableEventVars}
					value={value.event}
					onChange={(newV) => newV !== undefined && updateValue({ ...value, event: newV })}
				/>
				<AbsolutePositionedSupportDisplay support={support} />
				<ObjectVarSelector
					objectVars={availableObjectVars}
					disabledStyleObjectVars={availableObjectVars.filter((v) => {
						const s =
							ocelInfo !== undefined
								? getNodeRelationshipSupport(
										ocelInfo,
										getTypesForVariable,
										nodeID,
										value.event,
										v,
										true,
									)
								: null;
						return s !== null ? s === 0 : true;
					})}
					value={value.object}
					onChange={(newV) => newV !== undefined && updateValue({ ...value, object: newV })}
				/>
				<Input
					className="w-full"
					placeholder="Qualifier"
					value={value.qualifier ?? ""}
					onChange={(ev) => updateValue({ ...value, qualifier: ev.currentTarget.value || null })}
				/>
			</div>
		);
	},
	function O2EDisplay({ value }) {
		return (
			<div className="flex items-center gap-x-1 font-normal text-sm">
				<EvVarName eventVar={value.event} /> <LuLink /> <ObVarName obVar={value.object} />
				{value.qualifier != null ? `@${value.qualifier}` : ""}
			</div>
		);
	},
);

// O2O Filter
registerEditor<Filter & { type: "O2O" }>(
	"O2O",
	function O2OEditor({ value, updateValue, availableObjectVars, nodeID }) {
		const { getTypesForVariable, ocelInfo } = useContext(VisualEditorContext);
		const support =
			ocelInfo !== undefined
				? getNodeRelationshipSupport(
						ocelInfo,
						getTypesForVariable,
						nodeID,
						value.object,
						value.other_object,
						false,
					)
				: null;

		return (
			<div className="flex items-center gap-x-1 pb-7 relative">
				<ObjectVarSelector
					objectVars={availableObjectVars}
					value={value.object}
					onChange={(newV) => newV !== undefined && updateValue({ ...value, object: newV })}
				/>
				<div className="relative -ml-1 -mr-3">
					<Button
						variant="ghost"
						size="icon"
						title="Swap relation"
						onClick={() =>
							updateValue({
								...value,
								object: value.other_object,
								other_object: value.object,
							})
						}
					>
						<MdSwapHoriz />
					</Button>
				</div>
				<AbsolutePositionedSupportDisplay support={support} />
				<ObjectVarSelector
					objectVars={availableObjectVars}
					disabledStyleObjectVars={availableObjectVars.filter((v) => {
						const s =
							ocelInfo !== undefined
								? getNodeRelationshipSupport(
										ocelInfo,
										getTypesForVariable,
										nodeID,
										value.object,
										v,
										false,
									)
								: null;
						return s !== null ? s === 0 : true;
					})}
					value={value.other_object}
					onChange={(newV) => newV !== undefined && updateValue({ ...value, other_object: newV })}
				/>
				<Input
					className="w-full"
					placeholder="Qualifier"
					value={value.qualifier ?? ""}
					onChange={(ev) => updateValue({ ...value, qualifier: ev.currentTarget.value || null })}
				/>
			</div>
		);
	},
	function O2ODisplay({ value }) {
		return (
			<div className="flex items-center gap-x-1 font-normal text-sm">
				<ObVarName obVar={value.object} /> <LuLink /> <ObVarName obVar={value.other_object} />
				{value.qualifier != null ? `@${value.qualifier}` : ""}
			</div>
		);
	},
);

// NotEqual Filter
registerEditor<Filter & { type: "NotEqual" }>(
	"NotEqual",
	function NotEqualEditor({ value, updateValue, availableObjectVars, availableEventVars }) {
		return (
			<>
				<ObjectOrEventVarSelector
					objectVars={availableObjectVars}
					eventVars={availableEventVars}
					value={
						"Event" in value.var_1
							? { type: "event", value: value.var_1.Event }
							: { type: "object", value: value.var_1.Object }
					}
					onChange={(v) =>
						v !== undefined &&
						updateValue({
							...value,
							var_1: v.type === "event" ? { Event: v.value } : { Object: v.value },
						})
					}
				/>
				≠
				<ObjectOrEventVarSelector
					objectVars={availableObjectVars}
					eventVars={availableEventVars}
					value={
						"Event" in value.var_2
							? { type: "event", value: value.var_2.Event }
							: { type: "object", value: value.var_2.Object }
					}
					onChange={(v) =>
						v !== undefined &&
						updateValue({
							...value,
							var_2: v.type === "event" ? { Event: v.value } : { Object: v.value },
						})
					}
				/>
			</>
		);
	},
	function NotEqualDisplay({ value }) {
		return (
			<div className="flex items-center gap-x-1 font-normal text-sm">
				<EvOrObVarName varName={value.var_1} /> ≠ <EvOrObVarName varName={value.var_2} />
			</div>
		);
	},
);

// CEL Filters
function CELEditorComponent({
	value,
	updateValue,
	availableEventVars,
	availableObjectVars,
	availableChildSets,
	availableLabels,
	nodeID,
	advanced,
}: FilterEditorProps<any> & { advanced?: boolean }) {
	return (
		<Suspense
			fallback={
				<div>
					Loading editor... <Spinner />
				</div>
			}
		>
			<CELEditor
				cel={value.cel}
				onChange={(newCel) => updateValue({ ...value, cel: newCel ?? "true" })}
				availableEventVars={availableEventVars}
				availableObjectVars={availableObjectVars}
				availableChildSets={advanced ? availableChildSets : undefined}
				availableLabels={advanced ? availableLabels : undefined}
				nodeID={nodeID}
			/>
		</Suspense>
	);
}

function CELDisplay({ value, compact }: FilterDisplayProps<any>) {
	return (
		<div className="flex items-center text-xs w-full bg-white/50 text-slate-800 border border-slate-600/10 text-[0.5rem] px-0.5 rounded-sm">
			<PiCodeFill
				className={clsx(
					"inline mr-1 pr-1 ml-0.5 border-r shrink-0",
					value.type === "BasicFilterCEL" ? "text-blue-600" : "text-purple-600",
				)}
				size={20}
			/>
			<pre
				className={clsx(
					"text-[0.5rem] text-ellipsis overflow-hidden leading-tight font-semibold",
					!(compact ?? false) && "break-all whitespace-normal",
					compact === true && "whitespace-nowrap max-w-20",
				)}
				title={value.cel}
			>
				{value.cel}
			</pre>
		</div>
	);
}

registerEditor<Filter & { type: "BasicFilterCEL" }>(
	"BasicFilterCEL",
	(props) => <CELEditorComponent {...props} />,
	CELDisplay,
);
registerEditor<SizeFilter & { type: "AdvancedCEL" }>(
	"AdvancedCEL",
	(props) => <CELEditorComponent {...props} advanced />,
	CELDisplay,
);

// TimeBetweenEvents
registerEditor<Filter & { type: "TimeBetweenEvents" }>(
	"TimeBetweenEvents",
	function TimeBetweenEventsEditor({ value, updateValue, availableEventVars }) {
		return (
			<>
				<EventVarSelector
					eventVars={availableEventVars}
					value={value.from_event}
					onChange={(newV) => newV !== undefined && updateValue({ ...value, from_event: newV })}
				/>
				<EventVarSelector
					eventVars={availableEventVars}
					value={value.to_event}
					onChange={(newV) => newV !== undefined && updateValue({ ...value, to_event: newV })}
				/>
				<TimeDurationInput
					placeholder="Minimum Duration/Delay (Optional)"
					durationSeconds={value.min_seconds ?? Number.NEGATIVE_INFINITY}
					onChange={(newVal) =>
						updateValue({
							...value,
							min_seconds: newVal !== undefined && Number.isFinite(newVal) ? newVal : null,
						})
					}
				/>
				<TimeDurationInput
					placeholder="Maximum Duration/Delay (Optional)"
					durationSeconds={value.max_seconds ?? Number.POSITIVE_INFINITY}
					onChange={(newVal) =>
						updateValue({
							...value,
							max_seconds: newVal !== undefined && Number.isFinite(newVal) ? newVal : null,
						})
					}
				/>
			</>
		);
	},
	function TimeBetweenEventsDisplay({ value }) {
		return (
			<div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
				<EvVarName eventVar={value.from_event} /> <LuArrowRight />{" "}
				<EvVarName eventVar={value.to_event} />
				<div className="ml-2 flex items-center gap-x-1 text-xs w-fit">
					{formatSeconds(value.min_seconds ?? Number.NEGATIVE_INFINITY)}{" "}
					<span className="mx-1">-</span>{" "}
					{formatSeconds(value.max_seconds ?? Number.POSITIVE_INFINITY)}
				</div>
			</div>
		);
	},
);

// NumChilds
registerEditor<SizeFilter & { type: "NumChilds" }>(
	"NumChilds",
	function NumChildsEditor({ value, updateValue, availableChildSets }) {
		return (
			<div className="flex items-center gap-x-2">
				<ChildSetSelector
					availableChildSets={availableChildSets}
					value={value.child_name}
					onChange={(v) => v !== undefined && updateValue({ ...value, child_name: v })}
				/>
				<Input
					placeholder="Minimal Count (Optional)"
					type="number"
					value={value.min ?? ""}
					onChange={(ev) =>
						updateValue({
							...value,
							min: Number.isFinite(ev.currentTarget.valueAsNumber)
								? ev.currentTarget.valueAsNumber
								: null,
						})
					}
				/>
				<Input
					placeholder="Maximal Count (Optional)"
					type="number"
					value={value.max ?? ""}
					onChange={(ev) =>
						updateValue({
							...value,
							max: Number.isFinite(ev.currentTarget.valueAsNumber)
								? ev.currentTarget.valueAsNumber
								: null,
						})
					}
				/>
			</div>
		);
	},
	function NumChildsDisplay({ value }) {
		return (
			<div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
				<MinMaxDisplayWithSugar min={value.min} max={value.max}>
					|{value.child_name}|
				</MinMaxDisplayWithSugar>
			</div>
		);
	},
);

// BindingSetEqual
registerEditor<SizeFilter & { type: "BindingSetEqual" }>(
	"BindingSetEqual",
	function BindingSetEqualEditor({ value, updateValue, availableChildSets, nodeID }) {
		const { getAvailableChildNames } = useContext(VisualEditorContext);
		const childVars = getAvailableChildNames(nodeID);
		return (
			<>
				{value.child_names.map((c, i) => (
					<div key={i} className="flex gap-0.5 items-center justify-center">
						<ChildSetSelector
							availableChildSets={availableChildSets}
							value={c}
							onChange={(v) => {
								if (v !== undefined) {
									const newNames = [...value.child_names];
									newNames[i] = v;
									updateValue({ ...value, child_names: newNames });
								}
							}}
						/>
						<Button
							size="icon"
							variant="outline"
							onClick={() => {
								const newNames = value.child_names.filter((_, idx) => idx !== i);
								updateValue({ ...value, child_names: newNames });
							}}
						>
							<LuTrash />
						</Button>
						{i < value.child_names.length - 1 && <LuEqual className="ml-1" />}
					</div>
				))}
				<Button
					onClick={() =>
						updateValue({
							...value,
							child_names: [...value.child_names, childVars[0] ?? "A"],
						})
					}
				>
					Add
				</Button>
			</>
		);
	},
	function BindingSetEqualDisplay({ value }) {
		return (
			<div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
				{value.child_names.join(" = ")}
			</div>
		);
	},
);

// Child names constraints (SAT, ANY, NOT, OR, AND)
function ChildNamesEditor({
	value,
	updateValue,
	availableChildSets,
	nodeID,
}: FilterEditorProps<any>) {
	const { getAvailableChildNames } = useContext(VisualEditorContext);
	const childVars = getAvailableChildNames(nodeID);
	return (
		<>
			{value.child_names.map((c: string, i: number) => (
				<div key={i} className="flex gap-0.5 mr-2">
					<ChildSetSelector
						availableChildSets={availableChildSets}
						value={c}
						onChange={(v) => {
							if (v !== undefined) {
								const newNames = [...value.child_names];
								newNames[i] = v;
								updateValue({ ...value, child_names: newNames });
							}
						}}
					/>
					<Button
						size="icon"
						variant="outline"
						onClick={() => {
							const newNames = value.child_names.filter((_: string, idx: number) => idx !== i);
							updateValue({ ...value, child_names: newNames });
						}}
					>
						<LuTrash />
					</Button>
				</div>
			))}
			<Button
				onClick={() =>
					updateValue({
						...value,
						child_names: [...value.child_names, childVars[0] ?? "A"],
					})
				}
			>
				Add
			</Button>
		</>
	);
}

function ChildNamesDisplay({ value, prefix }: FilterDisplayProps<any> & { prefix: string }) {
	return (
		<div className="flex items-center gap-x-1 font-normal text-sm whitespace-nowrap">
			{prefix}({value.child_names.join(",")})
		</div>
	);
}

registerEditor<Constraint & { type: "SAT" }>("SAT", ChildNamesEditor, (props) => (
	<ChildNamesDisplay {...props} prefix="SAT" />
));
registerEditor<Constraint & { type: "ANY" }>("ANY", ChildNamesEditor, (props) => (
	<ChildNamesDisplay {...props} prefix="ANY" />
));
registerEditor<Constraint & { type: "NOT" }>("NOT", ChildNamesEditor, (props) => (
	<ChildNamesDisplay {...props} prefix="NOT" />
));
registerEditor<Constraint & { type: "OR" }>("OR", ChildNamesEditor, (props) => (
	<ChildNamesDisplay {...props} prefix="OR" />
));
registerEditor<Constraint & { type: "AND" }>("AND", ChildNamesEditor, (props) => (
	<ChildNamesDisplay {...props} prefix="AND" />
));

// EventAttributeValueFilter
registerEditor<Filter & { type: "EventAttributeValueFilter" }>(
	"EventAttributeValueFilter",
	function EventAttributeValueFilterEditor({ value, updateValue, availableEventVars, nodeID }) {
		const { getTypesForVariable } = useContext(VisualEditorContext);
		return (
			<div className="flex items-start gap-x-2 pt-4">
				<EventVarSelector
					eventVars={availableEventVars}
					value={value.event}
					onChange={(newV) => newV !== undefined && updateValue({ ...value, event: newV })}
				/>
				<AttributeNameSelector
					availableAttributes={[
						"ocel:id",
						"ocel:time",
						...deDupe(
							getTypesForVariable(nodeID, value.event, "event").flatMap((t) =>
								t.attributes.map((at) => at.name),
							),
						),
					]}
					value={value.attribute_name}
					onChange={(newV) => newV !== undefined && updateValue({ ...value, attribute_name: newV })}
				/>
				<AttributeValueFilterSelector
					value={value.value_filter}
					onChange={(vf) => vf !== undefined && updateValue({ ...value, value_filter: vf })}
				/>
			</div>
		);
	},
	function EventAttributeValueFilterDisplay({ value }) {
		return (
			<div className="font-normal text-sm whitespace-nowrap max-w-full w-full overflow-hidden text-ellipsis">
				<EvVarName eventVar={value.event} />
				<span className="font-light">
					.{value.attribute_name.length > 0 ? value.attribute_name : "Unknown Attribute"}:{" "}
					<AttributeValueFilterDisplay value={value.value_filter} />
				</span>
			</div>
		);
	},
);

// ObjectAttributeValueFilter
registerEditor<Filter & { type: "ObjectAttributeValueFilter" }>(
	"ObjectAttributeValueFilter",
	function ObjectAttributeValueFilterEditor({
		value,
		updateValue,
		availableObjectVars,
		availableEventVars,
		nodeID,
	}) {
		const { getTypesForVariable } = useContext(VisualEditorContext);
		return (
			<div className="flex items-start gap-x-2 pt-4">
				<ObjectVarSelector
					objectVars={availableObjectVars}
					value={value.object}
					onChange={(newV) => newV !== undefined && updateValue({ ...value, object: newV })}
				/>
				<AttributeNameSelector
					availableAttributes={[
						"ocel:id",
						...deDupe(
							getTypesForVariable(nodeID, value.object, "object").flatMap((t) =>
								t.attributes.map((at) => at.name),
							),
						),
					]}
					value={value.attribute_name}
					onChange={(newV) => newV !== undefined && updateValue({ ...value, attribute_name: newV })}
				/>
				<Combobox
					value={value.at_time.type}
					options={[
						{ label: "Always", value: "Always" },
						{ label: "Sometime", value: "Sometime" },
						{ label: "At event", value: "AtEvent" },
					]}
					name="At time"
					onChange={(ev) => {
						switch (ev) {
							case "Always":
								updateValue({ ...value, at_time: { type: "Always" } });
								break;
							case "Sometime":
								updateValue({ ...value, at_time: { type: "Sometime" } });
								break;
							case "AtEvent":
								updateValue({
									...value,
									at_time: { type: "AtEvent", event: 0 },
								});
								break;
						}
					}}
				/>
				{value.at_time.type === "AtEvent" && (
					<EventVarSelector
						eventVars={availableEventVars}
						value={value.at_time.event}
						onChange={(newV) =>
							newV !== undefined &&
							value.at_time.type === "AtEvent" &&
							updateValue({
								...value,
								at_time: { ...value.at_time, event: newV },
							})
						}
					/>
				)}
				<AttributeValueFilterSelector
					value={value.value_filter}
					onChange={(vf) => vf !== undefined && updateValue({ ...value, value_filter: vf })}
				/>
			</div>
		);
	},
	function ObjectAttributeValueFilterDisplay({ value }) {
		return (
			<div className="font-normal text-sm whitespace-nowrap max-w-full w-full overflow-hidden text-ellipsis">
				<ObVarName obVar={value.object} />
				<span className="whitespace-nowrap font-light text-xs w-full">
					.{value.attribute_name.length > 0 ? value.attribute_name : "Unknown Attribute"}{" "}
					<AttributeValueFilterDisplay value={value.value_filter} />(
					{value.at_time.type === "Sometime" && "sometime"}
					{value.at_time.type === "Always" && "always"}
					{value.at_time.type === "AtEvent" && (
						<span>
							at <EvVarName eventVar={value.at_time.event} />
						</span>
					)}
					)
				</span>
			</div>
		);
	},
);
