import { ActivityChooser, ObjectTypeChooser } from "@r4pm/components";
import clsx from "clsx";
import { useContext, useEffect, useRef, useState } from "react";
import { LuAsterisk, LuPlus } from "react-icons/lu";
import FilterLabelIcon from "@/components/FilterLabelIcon";
import { R4pmIsland } from "@/components/r4pm/R4pmIsland";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useOcelStats } from "@/hooks";
import { useAddVariableRequest } from "@/inspector/query-context";
import {
	type ConnectionCandidate,
	deDupe,
	getConnectionCandidates,
	getTypesRelatedToBound,
} from "@/lib/variable-hints";
import type { BindingBox } from "@/types/generated/BindingBox";
import type { EventVariable } from "@/types/generated/EventVariable";
import type { FilterLabel } from "@/types/generated/FilterLabel";
import type { ObjectVariable } from "@/types/generated/ObjectVariable";
import type { OCELInfo } from "@/types/ocel";
import { VisualEditorContext } from "../VisualEditorContext";
import { FilterOrConstraintDisplay } from "./FilterOrConstraintEditor";
import { QualifierSelector } from "./filter-helpers";
import { EvVarName, getEvVarName, getObVarName, ObVarName } from "./variable-names";

export default function NewVariableChooser({
	id,
	box,
	updateBox,
}: {
	id: string;
	box: BindingBox;
	updateBox: (box: BindingBox) => unknown;
}) {
	const { ocelInfo, getAvailableVars, getVarName, getTypesForVariable } =
		useContext(VisualEditorContext);
	const ocelStats = useOcelStats();
	const [alertState, setAlertState] = useState<
		{
			variant: "event" | "object";
			key: ObjectVariable | EventVariable;
			value: string[];
			showAllTypes?: boolean;
			/** Connections ticked by hand. Unset means only the best supported one is ticked. */
			connections?: { key: string; qualifier: string | null }[];
		} & ({ mode: "add" } | { mode: "edit"; editKey: ObjectVariable | EventVariable })
	>();
	const availableObjectVars = getAvailableVars(id, "object");
	const availableEventVars = getAvailableVars(id, "event");

	function getAvailableObjVars(allowObjectVar?: ObjectVariable | undefined) {
		return Array(100)
			.fill(0)
			.map((_, i) => i)
			.filter((i) => i === allowObjectVar || !availableObjectVars.includes(i))
			.filter((_i, index) => index < 10);
	}

	function getAvailableEvVars(allowedEventVar?: EventVariable | undefined) {
		return Array(100)
			.fill(0)
			.map((_, i) => i)
			.filter((i) => i === allowedEventVar || !availableEventVars.includes(i))
			.filter((_i, index) => index < 10);
	}

	// `getAvailableVars` reads the parent chain out of the flow instance, so this box recomputes what
	// is in scope only when it re-renders. A parent gaining a variable does not re-render its
	// children, which leaves the click handler below picking from a stale free list: a child created
	// before its parent had any variables offers o1, which the parent now owns. Opening the dialog
	// does re-render, the option list drops that key, and the combobox matches nothing. Snap back to
	// a variable that is genuinely free.
	const takenObjectVars = availableObjectVars.join(",");
	const takenEventVars = availableEventVars.join(",");
	useEffect(() => {
		if (alertState === undefined || alertState.mode !== "add") {
			return;
		}
		const taken = (alertState.variant === "object" ? takenObjectVars : takenEventVars)
			.split(",")
			.filter((s) => s !== "")
			.map((s) => Number.parseInt(s, 10));
		if (!taken.includes(alertState.key)) {
			return;
		}
		const firstFree = Array.from({ length: 100 }, (_, i) => i).find((i) => !taken.includes(i));
		if (firstFree !== undefined) {
			// Ticked connections name the variable, so they go with it.
			setAlertState({ ...alertState, key: firstFree, connections: undefined });
		}
	}, [alertState, takenObjectVars, takenEventVars]);

	// A type picked in the inspector's type graph opens this dialog with it chosen.
	const addRequest = useAddVariableRequest();
	const handledRequest = useRef(addRequest?.at);
	useEffect(() => {
		if (addRequest === undefined || addRequest.at === handledRequest.current) return;
		handledRequest.current = addRequest.at;
		if (addRequest.nodeId !== id) return;
		const free = addRequest.kind === "object" ? getAvailableObjVars() : getAvailableEvVars();
		setAlertState({
			mode: "add",
			variant: addRequest.kind,
			key: free[0],
			value: [addRequest.type],
		});
	});

	if (ocelInfo === undefined) {
		return <div>No OCEL Info available. Check backend and reload.</div>;
	}

	function getTypeChoices(state: NonNullable<typeof alertState>, ocelInfo: OCELInfo) {
		const boundTypes = (variant: "object" | "event") =>
			deDupe(
				(variant === "object" ? availableObjectVars : availableEventVars)
					.filter(
						(v) => !(state.mode === "edit" && state.variant === variant && v === state.editKey),
					)
					.flatMap((v) => getTypesForVariable(id, v, variant).map((t) => t.name)),
			);
		const allCounts =
			state.variant === "object"
				? (ocelStats?.object_type_counts ??
					Object.fromEntries(ocelInfo.object_types.map((t) => [t.name, 0])))
				: (ocelStats?.event_type_counts ??
					Object.fromEntries(ocelInfo.event_types.map((t) => [t.name, 0])));
		const related = getTypesRelatedToBound(
			ocelInfo,
			state.variant,
			boundTypes("object"),
			boundTypes("event"),
		);
		// No related types means nothing in scope can be joined against, so filtering would hide everything.
		if (related.length === 0) {
			return { counts: allCounts, related, total: Object.keys(allCounts).length, canFilter: false };
		}
		// Keep the variable's types visible while editing, even unrelated ones, so they can be deselected.
		const initial =
			state.mode === "edit"
				? ((state.variant === "object" ? box.newObjectVars : box.newEventVars)[state.editKey] ?? [])
				: [];
		const keep = new Set([...related, ...initial, ...state.value]);
		const counts =
			state.showAllTypes === true
				? allCounts
				: Object.fromEntries(Object.entries(allCounts).filter(([t]) => keep.has(t)));
		return { counts, related, total: Object.keys(allCounts).length, canFilter: true };
	}
	const typeChoices = alertState !== undefined ? getTypeChoices(alertState, ocelInfo) : undefined;

	const candidates: ConnectionCandidate[] =
		alertState?.mode === "add" && alertState.value.length > 0
			? getConnectionCandidates(
					ocelInfo,
					{ kind: alertState.variant, variable: alertState.key, types: alertState.value },
					(["object", "event"] as const).flatMap((kind) =>
						(kind === "object" ? availableObjectVars : availableEventVars).map((v) => ({
							kind,
							variable: v,
							types: getTypesForVariable(id, v, kind).map((t) => t.name),
						})),
					),
				)
			: [];
	const connections =
		alertState?.connections ??
		(candidates.length > 0 ? [{ key: candidates[0].key, qualifier: null }] : []);
	const setConnections = (next: { key: string; qualifier: string | null }[]) =>
		setAlertState((s) => (s ? { ...s, connections: next } : s));
	const connectionFilters = connections.flatMap((c) => {
		const candidate = candidates.find((cand) => cand.key === c.key);
		return candidate !== undefined ? [{ ...candidate.filter, qualifier: c.qualifier }] : [];
	});
	const addVariable = (connect: boolean) => {
		if (alertState === undefined) return;
		const newBox = { ...box };
		if (alertState.mode === "edit") {
			if (alertState.variant === "object") {
				// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
				delete newBox.newObjectVars[alertState.editKey];
			} else {
				// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
				delete newBox.newEventVars[alertState.editKey];
			}
		}
		if (alertState.variant === "object") {
			newBox.newObjectVars[alertState.key] = alertState.value;
		} else {
			newBox.newEventVars[alertState.key] = alertState.value;
		}
		if (connect) {
			newBox.filters = [...newBox.filters, ...connectionFilters];
		}
		updateBox(newBox);
		setAlertState(undefined);
	};
	return (
		<div className="font-normal text-left w-full">
			<div className="flex items-center gap-x-1 -mb-0.5">
				<Label>Object Variables</Label>
				<Button
					size="icon"
					variant="ghost"
					className="h-4 w-4 hover:bg-blue-400/50 hover:border-blue-500/50 mt-1 rounded-full"
					onClick={() =>
						setAlertState({
							mode: "add",
							variant: "object",
							key: getAvailableObjVars()[0],
							value: [],
						})
					}
				>
					<LuPlus size={10} />
				</Button>
			</div>
			<ul className="w-full text-left text-sm min-h-2">
				{Object.entries(box.newObjectVars).map(([obVar, obTypes]) => (
					<li key={obVar} className="flex items-baseline gap-x-0.5">
						<VariableLabelToggle
							labels={box.obVarLabels}
							variable={obVar}
							onChange={(newLabels) => {
								updateBox({ ...box, obVarLabels: newLabels });
							}}
						/>
						<button
							className="hover:bg-blue-200/50 px-0.5 rounded-sm flex items-baseline w-fit max-w-full"
							onContextMenuCapture={(ev) => {
								ev.stopPropagation();
							}}
							onClick={() =>
								setAlertState({
									mode: "edit",
									variant: "object",
									key: Number.parseInt(obVar, 10),
									editKey: Number.parseInt(obVar, 10),
									value: obTypes,
								})
							}
						>
							<ObVarName obVar={Number.parseInt(obVar, 10)} />
							<span className="text-muted-foreground">:</span>
							{ocelInfo.object_types.length > 1 &&
								ocelInfo.object_types.length === obTypes.length && (
									<LuAsterisk
										className="self-center size-4 text-gray-600"
										title="Any object type included in the OCEL"
									/>
								)}
							{(ocelInfo.object_types.length <= 1 ||
								ocelInfo.object_types.length !== obTypes.length) && (
								<span
									className="ml-1 max-w-[13ch] shrink text-ellipsis overflow-hidden inline-block whitespace-pre text-left"
									title={obTypes.join(",\n")}
								>
									{obTypes.join(",\n")}
								</span>
							)}
						</button>
					</li>
				))}
			</ul>
			<div className="flex items-center gap-x-1 mt-1">
				<Label>Event Variables</Label>
				<Button
					size="icon"
					variant="ghost"
					className="h-4 w-4 hover:bg-blue-400/50 hover:border-blue-500/50 mt-1 rounded-full"
					onClick={() =>
						setAlertState({
							mode: "add",
							variant: "event",
							key: getAvailableEvVars()[0],
							value: [],
						})
					}
				>
					<LuPlus size={10} />
				</Button>
			</div>
			<ul className="w-full text-left text-sm min-h-2">
				{Object.entries(box.newEventVars).map(([evVar, evTypes]) => (
					<li key={evVar} className="flex items-baseline gap-x-0.5">
						<VariableLabelToggle
							labels={box.evVarLabels}
							variable={evVar}
							onChange={(newLabels) => {
								updateBox({ ...box, evVarLabels: newLabels });
							}}
						/>
						<button
							className="hover:bg-blue-200/50 px-0.5 rounded-sm flex items-baseline"
							onContextMenuCapture={(ev) => {
								ev.stopPropagation();
							}}
							onClick={() =>
								setAlertState({
									mode: "edit",
									variant: "event",
									key: Number.parseInt(evVar, 10),
									editKey: Number.parseInt(evVar, 10),
									value: evTypes,
								})
							}
						>
							<EvVarName eventVar={Number.parseInt(evVar, 10)} />
							<span className="text-muted-foreground">:</span>
							{ocelInfo.event_types.length > 1 &&
								ocelInfo.event_types.length === evTypes.length && (
									<LuAsterisk
										className="self-center size-4 text-gray-600"
										title="Any event type included in the OCEL"
									/>
								)}
							{(ocelInfo.event_types.length <= 1 ||
								ocelInfo.event_types.length !== evTypes.length) && (
								<span
									className="ml-1 max-w-36 shrink text-ellipsis overflow-hidden inline-block whitespace-pre text-left"
									title={evTypes.join(",\n")}
								>
									{evTypes.join(",\n")}
								</span>
							)}
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
						className="max-w-2xl"
						onContextMenuCapture={(ev) => {
							ev.stopPropagation();
						}}
					>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{alertState?.mode === "add" ? "Add " : "Edit "}
								{alertState?.variant === "event" ? "Event Variable" : "Object Variable"}
							</AlertDialogTitle>
							<AlertDialogDescription className="hidden">
								{alertState?.mode === "add" ? "Add " : "Edit "}
								{alertState?.variant === "event" ? "Event Variable" : "Object Variable"}
							</AlertDialogDescription>
							<div className="text-sm text-gray-700 pt-4 grid grid-cols-[1fr_3fr] gap-x-2 gap-y-1.5">
								<Label>Variable</Label>
								<Label>
									{alertState?.variant === "event" ? "Event" : "Object"} Types
									<br />
									<span className="text-xs font-normal">
										Multiple types are considered with OR-semantics (e.g., an{" "}
										<span className="font-bold text-blue-600">A</span> or{" "}
										<span className="font-bold text-purple-600">B</span>{" "}
										{alertState.variant === "event" ? <>event</> : <>object</>}).
									</span>
								</Label>
								<Combobox
									options={
										alertState?.variant === "object"
											? getAvailableObjVars(
													alertState.mode === "edit" ? alertState.key : undefined,
												).map((i) => ({
													value: `${i.toString()} --- ${getVarName(i, "object").name}`,
													label: getObVarName(i),
												}))
											: getAvailableEvVars(
													alertState.mode === "edit" ? alertState.key : undefined,
												).map((i) => ({
													value: `${i.toString()} --- ${getVarName(i, "event").name}`,
													label: getEvVarName(i),
												}))
									}
									onChange={(value: string) => {
										const variableKey = Number.parseInt(value.split(" --- ")[0], 10);
										if (!Number.isNaN(variableKey) && variableKey >= 0) {
											setAlertState({ ...alertState, key: variableKey, connections: undefined });
										}
									}}
									name={""}
									value={`${alertState.key.toString()} --- ${
										alertState?.variant === "object"
											? getVarName(alertState.key, "object").name
											: getVarName(alertState.key, "event").name
									}`}
								/>
								<div className="flex flex-col gap-y-1.5">
									{typeChoices?.canFilter === true && (
										<Label className="flex items-center gap-x-2 font-normal text-xs">
											<Switch
												className="scale-75"
												checked={alertState.showAllTypes !== true}
												onCheckedChange={(checked) =>
													setAlertState((s) => (s ? { ...s, showAllTypes: !checked } : s))
												}
											/>
											Only types related to bound variables ({typeChoices.related.length} of{" "}
											{typeChoices.total})
										</Label>
									)}
									<R4pmIsland>
										{alertState?.variant === "object" ? (
											<ObjectTypeChooser
												counts={typeChoices?.counts ?? {}}
												value={new Set(alertState.value)}
												onChange={(next) =>
													setAlertState((s) =>
														s ? { ...s, value: [...next], connections: undefined } : s,
													)
												}
												mode="multi"
												searchable
												showCutoff={false}
											/>
										) : (
											<ActivityChooser
												counts={typeChoices?.counts ?? {}}
												value={new Set(alertState.value)}
												onChange={(next) =>
													setAlertState((s) =>
														s ? { ...s, value: [...next], connections: undefined } : s,
													)
												}
												mode="multi"
												searchable
												showCutoff={false}
											/>
										)}
									</R4pmIsland>
								</div>
							</div>
							{candidates.length > 0 && (
								<ConnectionChooser
									variant={alertState.variant}
									variable={alertState.key}
									candidates={candidates}
									connections={connections}
									onChange={setConnections}
								/>
							)}
						</AlertDialogHeader>
						<AlertDialogFooter>
							{" "}
							{alertState.mode === "edit" && (
								<Button
									className="mr-auto"
									variant="destructive"
									onClick={() => {
										const newBox = { ...box };
										if (alertState.variant === "object") {
											// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
											delete newBox.newObjectVars[alertState.editKey];
										} else {
											// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
											delete newBox.newEventVars[alertState.editKey];
										}
										updateBox(newBox);
										setAlertState(undefined);
									}}
								>
									Delete
								</Button>
							)}
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							{candidates.length > 0 ? (
								<>
									<Button variant="outline" onClick={() => addVariable(false)}>
										Add without connecting
									</Button>
									<Button
										disabled={connectionFilters.length === 0}
										onClick={() => addVariable(true)}
									>
										Add and connect
									</Button>
								</>
							) : (
								<AlertDialogAction
									disabled={alertState.value.length === 0}
									onClick={() => addVariable(false)}
								>
									{alertState.mode === "add" ? "Add" : "Save"}
								</AlertDialogAction>
							)}
						</AlertDialogFooter>
					</AlertDialogContent>
				)}
			</AlertDialog>
		</div>
	);
}

/** Which E2O/O2O filters to add with the new variable, shown the way the node will show them. */
function ConnectionChooser({
	variant,
	variable,
	candidates,
	connections,
	onChange,
}: {
	variant: "object" | "event";
	variable: number;
	candidates: ConnectionCandidate[];
	connections: { key: string; qualifier: string | null }[];
	onChange: (connections: { key: string; qualifier: string | null }[]) => unknown;
}) {
	const selected = new Map(connections.map((c) => [c.key, c.qualifier]));
	const toggle = (key: string, on: boolean) =>
		onChange(
			on
				? [...connections, { key, qualifier: selected.get(key) ?? null }]
				: connections.filter((c) => c.key !== key),
		);
	// Picking a qualifier for an unticked connection ticks it.
	const setQualifier = (key: string, qualifier: string | null) =>
		onChange(
			selected.has(key)
				? connections.map((c) => (c.key === key ? { key, qualifier } : c))
				: [...connections, { key, qualifier }],
		);
	return (
		<fieldset className="mt-4 rounded-lg border border-slate-200 px-3 pt-1 pb-2 text-left">
			<legend className="flex items-center gap-1 px-1.5 text-sm font-semibold text-slate-900">
				Connect{" "}
				{variant === "object" ? <ObVarName obVar={variable} /> : <EvVarName eventVar={variable} />}{" "}
				to
			</legend>
			<div className="flex max-h-56 flex-col gap-1 overflow-auto">
				{candidates.map((c) => {
					const on = selected.has(c.key);
					const qualifier = selected.get(c.key) ?? null;
					const id = `connect-${c.key}`;
					return (
						<div
							key={c.key}
							className={clsx(
								"flex items-center gap-3 rounded-md px-2 py-1",
								on && "bg-slate-100 ring-1 ring-inset ring-slate-300",
							)}
						>
							<Checkbox id={id} checked={on} onCheckedChange={(v) => toggle(c.key, v === true)} />
							<label htmlFor={id} className="min-w-0 cursor-pointer">
								<FilterOrConstraintDisplay value={{ ...c.filter, qualifier }} />
							</label>
							<span className="flex-1" />
							<div className="w-44 [&>button]:h-8">
								<QualifierSelector
									value={qualifier}
									onChange={(q) => setQualifier(c.key, q)}
									getSuggestions={c.suggestQualifiers}
								/>
							</div>
							<span className="w-28 shrink-0 text-right text-xs tabular-nums text-slate-600">
								{c.support.toLocaleString()} relations
							</span>
						</div>
					);
				})}
			</div>
		</fieldset>
	);
}

function getVariableLabel(
	labels: BindingBox["evVarLabels"] | BindingBox["obVarLabels"],
	variable: EventVariable | ObjectVariable | string,
) {
	if (typeof variable === "string") {
		variable = Number.parseInt(variable, 10);
	}
	const val: FilterLabel | undefined = labels?.[variable];
	return val ?? "IGNORED";
}

function VariableLabelToggle({
	variable,
	labels,
	onChange,
}: {
	labels: BindingBox["evVarLabels"] | BindingBox["obVarLabels"];
	variable: EventVariable | ObjectVariable | string;
	onChange: (newLabels: BindingBox["evVarLabels"] | BindingBox["obVarLabels"]) => unknown;
}) {
	const ctx = useContext(VisualEditorContext);
	if (ctx.filterMode !== "shown") {
		return null;
	}
	if (typeof variable === "string") {
		variable = Number.parseInt(variable, 10);
	}
	return (
		<button
			onClick={() => {
				const prevLabels = labels ?? {};
				const prevLabel = prevLabels[variable as number] ?? "IGNORED";
				let newLabel: FilterLabel = "IGNORED";
				if (prevLabel === "IGNORED") {
					newLabel = "INCLUDED";
				} else if (prevLabel === "INCLUDED") {
					newLabel = "EXCLUDED";
				}
				const newLabels = { ...prevLabels, [variable]: newLabel };
				onChange(newLabels);
			}}
		>
			<FilterLabelIcon label={getVariableLabel(labels, variable)} />
		</button>
	);
}
