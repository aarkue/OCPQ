import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { FilterOrConstraintDisplay } from "@/routes/visual-editor/helper/box/FilterOrConstraintEditor";
import { LabelLabel } from "@/routes/visual-editor/helper/box/LabelFunctionChooser";
import { EvVarName, ObVarName } from "@/routes/visual-editor/helper/box/variable-names";
import type { BindingBoxTreeNode } from "@/types/generated/BindingBoxTreeNode";
import type { BindingRow } from "@/types/generated/BindingRow";
import type { LabelValue } from "@/types/generated/LabelValue";
import { Checkbox } from "../ui/checkbox";

type ElementKind = "object" | "event";
type ElementInfo = { req: { id: string } | { index: number }; type: ElementKind };
type ShowElementInfo = (info: ElementInfo | undefined) => unknown;

function formatLabel(v: LabelValue): string {
	switch (v.type) {
		case "null":
			return "null";
		case "string":
			return v.value;
		default:
			return String(v.value);
	}
}

function ElementLink({ id, type, show }: { id: string; type: ElementKind; show: ShowElementInfo }) {
	const maxW = type === "object" ? "max-w-40" : "max-w-[7.66rem]";
	return (
		<Link
			to={{ pathname: "/ocel-element", search: `?id=${encodeURIComponent(id)}&type=${type}` }}
			target="_blank"
			rel="noreferrer"
			onClick={(ev) => {
				ev.preventDefault();
				show({ type, req: { id } });
			}}
			className={`${maxW} w-fit align-top whitespace-nowrap inline-block text-ellipsis overflow-hidden underline decoration decoration-blue-500/60 hover:decoration-blue-500`}
		>
			{id}
		</Link>
	);
}

export function columnsForBindingRow(
	sample: BindingRow,
	showElementInfo: ShowElementInfo,
	node: BindingBoxTreeNode,
	addViolationStatus: boolean,
): ColumnDef<BindingRow>[] {
	const idColumn = (kind: ElementKind, i: number, variable: number): ColumnDef<BindingRow> => ({
		id: `${kind[0]}:${variable}`,
		header: () =>
			kind === "object" ? <ObVarName obVar={variable} /> : <EvVarName eventVar={variable} />,
		accessorFn: (row) => (kind === "object" ? row.objects : row.events)[i]?.[1] ?? "",
		cell: (c) => <ElementLink id={c.getValue<string>()} type={kind} show={showElementInfo} />,
	});

	const cols: ColumnDef<BindingRow>[] = [
		...sample.objects.map(([v], i) => idColumn("object", i, v)),
		...sample.events.map(([v], i) => idColumn("event", i, v)),
		...sample.labels.map(
			([name], i): ColumnDef<BindingRow> => ({
				id: `l:${name}`,
				header: () => <LabelLabel label={name} />,
				accessorFn: (row) => (row.labels[i] ? formatLabel(row.labels[i][1]) : ""),
				cell: (c) => {
					const v = c.getValue<string>();
					return (
						<span
							title={v}
							className="max-w-[7.66rem] w-fit align-top whitespace-nowrap inline-block text-ellipsis overflow-hidden"
						>
							{v}
						</span>
					);
				},
			}),
		),
	];

	if (addViolationStatus && "Box" in node) {
		const constraints = node.Box[0].constraints;
		cols.push({
			id: "Violation",
			accessorFn: (row) => (row.violation !== null ? "VIOLATED" : "SATISFIED"),
			cell: (c) => {
				const r = c.row.original.violation;
				const constraintIdx =
					r !== null && typeof r === "object" && "ConstraintNotSatisfied" in r
						? r.ConstraintNotSatisfied
						: undefined;
				if (constraintIdx === undefined) {
					return (
						<div className="h-4 flex items-center gap-x-2 w-[7.66rem]">
							<Checkbox disabled title="Satisfied" />
						</div>
					);
				}
				return (
					<div className="h-4 flex items-center gap-x-2 w-[7.66rem] pr-1">
						<Checkbox disabled checked title="Violated" />
						{constraints[constraintIdx] != null && (
							<FilterOrConstraintDisplay compact={true} value={constraints[constraintIdx]} />
						)}
					</div>
				);
			},
		});
	}

	return cols;
}
