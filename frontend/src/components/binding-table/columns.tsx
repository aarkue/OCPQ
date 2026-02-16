import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { FilterOrConstraintDisplay } from "@/routes/visual-editor/helper/box/FilterOrConstraintEditor";
import { LabelLabel } from "@/routes/visual-editor/helper/box/LabelFunctionChooser";
import { EvVarName, ObVarName } from "@/routes/visual-editor/helper/box/variable-names";
import type { EvaluationRes } from "@/routes/visual-editor/helper/types";
import type { Binding } from "@/types/generated/Binding";
import type { BindingBoxTreeNode } from "@/types/generated/BindingBoxTreeNode";
import type { EventVariable } from "@/types/generated/EventVariable";
import type { LabelValue } from "@/types/generated/LabelValue";
import type { ObjectVariable } from "@/types/generated/ObjectVariable";
import { Checkbox } from "../ui/checkbox";

function getLabelValuePrimitive(l: LabelValue | null) {
	if (l == null) {
		return "null";
	}
	if (l.type === "string") {
		return l.value;
	}
	if (l.type === "bool") {
		return String(l.value);
	}
	if (l.type === "float") {
		return String(l.value);
	}
	if (l.type === "int") {
		return String(l.value);
	}
	return "null";
}
type BindingInfo = EvaluationRes["situations"][number];

export function columnsForBinding(
	binding: Binding,
	objectIds: string[],
	eventIds: string[],
	showElementInfo: (
		elInfo: { req: { id: string } | { index: number }; type: "object" | "event" } | undefined,
	) => unknown,
	node: BindingBoxTreeNode,
	addViolationStatus: boolean,
): ColumnDef<BindingInfo>[] {
	// Use labels if they are present in (sample) binding
	const labels = binding.labelMap.map((b) => b[0]);

	return [
		...binding.objectMap.map(
			([obVarName, __obIndex]) =>
				({
					id: `o${obVarName + 1}`,
					cell: (c) => (
						<Link
							to={{
								pathname: "/ocel-element",
								search: `?id=${encodeURIComponent(c.getValue<string>())}&type=object`,
							}}
							target="_blank"
							onClick={(ev) => {
								ev.preventDefault();
								showElementInfo({
									type: "object",
									req: { id: c.getValue<string>() },
								});
							}}
							rel="noreferrer"
							className="max-w-40 w-fit align-top whitespace-nowrap inline-block text-ellipsis overflow-hidden underline decoration decoration-blue-500/60 hover:decoration-blue-500"
						>
							{c.getValue<string>()}
						</Link>
					),
					header: () => <ObVarName obVar={obVarName} />,
					accessorFn: ([b, _]) =>
						objectIds[b.objectMap.find((om: [ObjectVariable, number]) => om[0] === obVarName)![1]],
				}) satisfies ColumnDef<BindingInfo>,
		),
		...binding.eventMap.map(
			([evVarName, _evIndex]) =>
				({
					id: `e${evVarName + 1}`,
					cell: (c) => (
						<Link
							to={{
								pathname: "/ocel-element",
								search: `?id=${encodeURIComponent(c.getValue<string>())}&type=event`,
							}}
							target="_blank"
							onClick={(ev) => {
								ev.preventDefault();
								showElementInfo({
									type: "event",
									req: { id: c.getValue<string>() },
								});
							}}
							rel="noreferrer"
							className="max-w-[7.66rem] w-fit align-top whitespace-nowrap inline-block text-ellipsis overflow-hidden underline decoration decoration-blue-500/60 hover:decoration-blue-500"
						>
							{c.getValue<string>()}
						</Link>
					),
					header: () => <EvVarName eventVar={evVarName} />,
					accessorFn: ([b, _]) =>
						eventIds[b.eventMap.find((om: [EventVariable, number]) => om[0] === evVarName)![1]],
				}) satisfies ColumnDef<BindingInfo>,
		),
		...labels.map(
			(label) =>
				({
					id: label,
					cell: (c) => (
						<span
							title={c.getValue<string>()}
							className="max-w-[7.66rem] w-fit align-top whitespace-nowrap inline-block text-ellipsis overflow-hidden"
						>
							{c.getValue<string>()}
						</span>
					),
					header: () => <LabelLabel label={label} />,
					accessorFn: ([b, _x]) =>
						getLabelValuePrimitive(b.labelMap.find((lm) => lm[0] === label)![1]),
				}) satisfies ColumnDef<BindingInfo>,
		),
		...(addViolationStatus
			? [
					{
						id: "Violation",
						accessorFn: ([_b, r]) => (r !== null ? "VIOLATED" : "SATISFIED"),
						cell: (c) => {
							const r = c.row.original[1];
							const v =
								r !== null && typeof r === "object" && "ConstraintNotSatisfied" in r
									? r.ConstraintNotSatisfied
									: undefined;
							return (
								<div className="flex items-center gap-x-2 w-[7.66rem]">
									{v === undefined && (
										<div className="h-4 w-full flex items-center gap-x-2">
											<Checkbox disabled title="Satisfied" />
										</div>
									)}
									{v !== undefined && (
										<div className="h-4 w-full flex items-center gap-x-2 pr-1">
											<Checkbox disabled checked title="Violated" />
											{(node as BindingBoxTreeNode & { Box: any })?.Box[0].constraints[v] !=
												null && (
												<FilterOrConstraintDisplay
													compact={true}
													value={(node as BindingBoxTreeNode & { Box: any }).Box[0].constraints[v]}
												/>
											)}
										</div>
									)}
								</div>
							);
						},
					} satisfies ColumnDef<BindingInfo>,
				]
			: []),
	];
}
