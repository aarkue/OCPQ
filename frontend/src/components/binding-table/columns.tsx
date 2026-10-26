import type { ColumnDef } from "@tanstack/react-table";
import clsx from "clsx";
import { LuChevronRight } from "react-icons/lu";
import { Link } from "react-router-dom";
import { InspectContextMenu } from "@/inspector/inspect-menu";
import { FilterOrConstraintDisplay } from "@/routes/visual-editor/helper/box/FilterOrConstraintEditor";
import { LabelLabel } from "@/routes/visual-editor/helper/box/LabelFunctionChooser";
import { EvVarName, ObVarName } from "@/routes/visual-editor/helper/box/variable-names";
import type { BindingBoxTreeNode } from "@/types/generated/BindingBoxTreeNode";
import type { BindingRow } from "@/types/generated/BindingRow";
import type { LabelValue } from "@/types/generated/LabelValue";
import { BindingIcon } from "../BindingIcon";
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
		<InspectContextMenu
			target={{ kind: "element", type, id }}
			inspect={(t) => t.kind === "element" && show({ type: t.type, req: { id: t.id } })}
		>
			{/* Fills the cell, so a right-click anywhere in it opens the menu. */}
			<div className="-m-2 p-2">
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
			</div>
		</InspectContextMenu>
	);
}

export type RowActions = {
	/** Show what the row binds as a graph and timeline. */
	onShowRow?: (row: BindingRow) => unknown;
	/** The named child sets of the box. Each gets a column with the child count of every row. */
	childSets?: { name: string }[];
	onOpenChildren?: (row: BindingRow, childSet: number) => unknown;
};

export function columnsForBindingRow(
	sample: BindingRow,
	showElementInfo: ShowElementInfo,
	node: BindingBoxTreeNode,
	addViolationStatus: boolean,
	actions: RowActions = {},
): ColumnDef<BindingRow>[] {
	const { onShowRow, childSets = [], onOpenChildren } = actions;
	const idColumn = (
		kind: ElementKind,
		i: number,
		variable: number,
		first: boolean,
	): ColumnDef<BindingRow> => ({
		id: `${kind[0]}:${variable}`,
		header: () =>
			kind === "object" ? <ObVarName obVar={variable} /> : <EvVarName eventVar={variable} />,
		accessorFn: (row) => (kind === "object" ? row.objects : row.events)[i]?.[1] ?? "",
		cell: (c) =>
			first && onShowRow !== undefined ? (
				<>
					<button
						type="button"
						title="Show binding details"
						aria-label="Show binding details"
						// In the room left of the table, next to the row.
						className="absolute top-1/2 right-full mr-0.5 flex size-4 -translate-y-1/2 items-center justify-center rounded text-slate-500 opacity-0 outline-none group-hover/row:opacity-100 hover:bg-sky-50 hover:text-sky-700 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sky-500"
						onClick={() => onShowRow(c.row.original)}
					>
						<BindingIcon className="size-4" />
					</button>
					<ElementLink id={c.getValue<string>()} type={kind} show={showElementInfo} />
				</>
			) : (
				<ElementLink id={c.getValue<string>()} type={kind} show={showElementInfo} />
			),
	});

	const cols: ColumnDef<BindingRow>[] = [
		...sample.objects.map(([v], i) => idColumn("object", i, v, i === 0)),
		...sample.events.map(([v], i) =>
			idColumn("event", i, v, i === 0 && sample.objects.length === 0),
		),
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

	cols.push(
		...childSets.map(
			(set, k): ColumnDef<BindingRow> => ({
				id: `c:${k}`,
				header: () => (
					<span title={`Child rows in ${set.name}`} className="font-semibold">
						{set.name}
					</span>
				),
				accessorFn: (row) => row.childCounts?.[k] ?? 0,
				cell: (c) => {
					const n = c.getValue<number>();
					if (c.row.original.childCounts === undefined) return null;
					return (
						<button
							type="button"
							disabled={n === 0 || onOpenChildren === undefined}
							title={
								n === 0
									? `No child rows in ${set.name}`
									: `Show the ${n} child ${n === 1 ? "row" : "rows"} in ${set.name}`
							}
							className={clsx(
								"-my-1 inline-flex h-6 items-center gap-0.5 rounded-md px-1.5 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
								n === 0
									? "text-slate-400"
									: "bg-slate-100 font-semibold text-slate-800 hover:bg-sky-100 hover:text-sky-800",
							)}
							onClick={() => onOpenChildren?.(c.row.original, k)}
						>
							{n.toLocaleString()}
							{n > 0 && <LuChevronRight aria-hidden="true" className="size-3" />}
						</button>
					);
				},
			}),
		),
	);

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
