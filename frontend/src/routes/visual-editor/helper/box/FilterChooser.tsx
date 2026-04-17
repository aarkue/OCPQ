import { useContext } from "react";
import { Combobox } from "@/components/ui/combobox";
import type { EventVariable } from "@/types/generated/EventVariable";
import type { ObjectVariable } from "@/types/generated/ObjectVariable";
import { VisualEditorContext } from "../VisualEditorContext";
import { getEvVarName, getObVarName } from "./variable-names";

export const INVALID_VARIABLE_PLACEHOLDER = 99999;

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
