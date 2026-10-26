import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { useEvalResultPage } from "@/hooks/useEvalResultPage";
import type { BindingBoxTreeNode } from "@/types/generated/BindingBoxTreeNode";
import type { BindingRow } from "@/types/generated/BindingRow";
import type { EvalPageRequest } from "@/types/generated/EvalPageRequest";
import type { ParentRow } from "@/types/generated/ParentRow";
import Spinner from "../Spinner";
import { Button } from "../ui/button";
import { IndeterminateCheckbox } from "../ui/intermediate-checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { columnsForBindingRow, type RowActions } from "./columns";

type Mode = "violations" | "situations" | "satisfied-situations" | undefined;

interface ServerPaginatedBindingTableProps {
	evalVersion: number;
	nodeIndex: number;
	totalCount: number;
	totalViolatedCount: number;
	node: BindingBoxTreeNode;
	addViolationStatus: boolean;
	showElementInfo: (
		elInfo: { req: { id: string } | { index: number }; type: "object" | "event" } | undefined,
	) => unknown;
	initialMode: Mode;
	/** Shorter table and a minimal footer, for narrow panels. */
	compact?: boolean;
	/** Only the child rows of this row of the parent box. */
	parent?: ParentRow;
	childSets?: { name: string; nodeIndex: number }[];
	onShowRow?: RowActions["onShowRow"];
	onOpenChildren?: RowActions["onOpenChildren"];
}

function modeToFilter(mode: Mode): boolean | null {
	if (mode === "violations") return true;
	if (mode === "satisfied-situations") return false;
	return null;
}

export function DataTablePagination({
	evalVersion,
	nodeIndex,
	totalCount,
	totalViolatedCount,
	node,
	addViolationStatus,
	showElementInfo,
	initialMode,
	compact,
	parent,
	childSets,
	onShowRow,
	onOpenChildren,
}: ServerPaginatedBindingTableProps) {
	const [pageSize, setPageSize] = useState(compact ? 10 : 20);
	// Filter changes reset pagination; keep both in the same state object so
	// there's no stale-page round-trip while a useEffect catches up.
	const [{ pageIndex, violated }, setPage] = useState<{
		pageIndex: number;
		violated: boolean | null;
	}>(() => ({ pageIndex: 0, violated: modeToFilter(initialMode) }));

	const childNodes = childSets?.map((c) => c.nodeIndex);
	const childKey = childNodes?.join();
	// biome-ignore lint/correctness/useExhaustiveDependencies: childKey stands for childNodes
	const req: EvalPageRequest = useMemo(
		() => ({
			evalVersion,
			nodeIndex,
			offset: pageIndex * pageSize,
			limit: pageSize,
			violated,
			parent,
			childNodes: childNodes?.length ? childNodes : undefined,
		}),
		[evalVersion, nodeIndex, pageIndex, pageSize, violated, parent, childKey],
	);

	const { data, isLoading, error } = useEvalResultPage(req);

	const rows = data?.rows ?? [];
	const filteredCount =
		data?.filteredCount ??
		(violated === null
			? totalCount
			: violated
				? totalViolatedCount
				: totalCount - totalViolatedCount);
	const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize));

	const columns: ColumnDef<BindingRow>[] = useMemo(() => {
		if (rows.length === 0) return [];
		return columnsForBindingRow(rows[0], showElementInfo, node, addViolationStatus, {
			onShowRow,
			childSets,
			onOpenChildren,
		});
	}, [rows, showElementInfo, node, addViolationStatus, onShowRow, childSets, onOpenChildren]);

	const table = useReactTable({
		data: rows,
		columns,
		getCoreRowModel: getCoreRowModel(),
		manualPagination: true,
		pageCount,
		state: {
			pagination: { pageIndex, pageSize },
		},
	});

	if (error && error.message === "STALE_EVAL_VERSION") {
		return (
			<div className="p-4 text-sm text-destructive">
				These results have expired. Evaluate the query again to see them.
			</div>
		);
	}

	return (
		<div className="w-full">
			<div
				className={clsx(
					// Room for the row button left of the border, taken from the card's padding to keep margins even.
					onShowRow !== undefined ? "-ml-3 pl-5" : "w-full",
					// Compact tables sit in a scrolling panel and show one page, so they only scroll sideways.
					compact ? "overflow-x-auto" : "overflow-auto max-h-[73vh]",
				)}
			>
				<div className="w-fit min-w-full rounded-md border">
					{/* The Table component's own scroll box would clip the row buttons. */}
					<table className="w-full caption-bottom text-sm">
						<TableHeader>
							{table.getHeaderGroups().map((headerGroup) => (
								<TableRow key={headerGroup.id} className="divide-x">
									{headerGroup.headers.map((header) => (
										<TableHead key={header.id} className="py-1 px-2 mx-4">
											{header.isPlaceholder
												? null
												: flexRender(header.column.columnDef.header, header.getContext())}
											{header.id === "Violation" && (
												<div className="flex items-center gap-x-1 w-fit">
													<IndeterminateCheckbox
														title={
															violated === false
																? "Only show satisfied bindings"
																: violated === true
																	? "Only show violated bindings"
																	: "Show both satisfied and violated bindings"
														}
														state={
															violated === false
																? "unchecked"
																: violated === true
																	? "checked"
																	: "indeterminate"
														}
														newState={(newChecked) => {
															const next =
																newChecked === "indeterminate" ? null : newChecked !== "unchecked";
															setPage({ pageIndex: 0, violated: next });
														}}
													/>
													{violated === null ? "any" : violated ? "viol." : "sat."}
												</div>
											)}
										</TableHead>
									))}
								</TableRow>
							))}
						</TableHeader>
						<TableBody className="text-xs">
							{isLoading ? (
								<TableRow>
									<TableCell colSpan={columns.length || 1} className="h-24 text-center">
										<div className="flex items-center justify-center gap-x-2">
											Loading… <Spinner />
										</div>
									</TableCell>
								</TableRow>
							) : rows.length > 0 ? (
								table.getRowModel().rows.map((row) => (
									<TableRow key={row.id} className="group/row divide-x w-fit">
										{row.getVisibleCells().map((cell) => (
											<TableCell
												key={cell.id}
												className={cell.column.getIndex() === 0 ? "relative" : undefined}
											>
												{flexRender(cell.column.columnDef.cell, cell.getContext())}
											</TableCell>
										))}
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell colSpan={columns.length || 1} className="h-24 text-center">
										No results.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</table>
				</div>
			</div>
			<div
				className={clsx(
					"grid space-x-2 items-center justify-between px-2 text-xs mt-2 w-full",
					compact ? "grid-cols-[1fr_auto]" : "grid-cols-[1fr_1fr_auto]",
				)}
			>
				<div className={clsx("flex items-center justify-center space-x-2", compact && "hidden")}>
					<p className="font-medium">Rows per page</p>
					<Select
						value={`${pageSize}`}
						onValueChange={(value) => {
							setPageSize(Number(value));
							setPage((prev) => ({ ...prev, pageIndex: 0 }));
						}}
					>
						<SelectTrigger className="h-8 w-[70px]">
							<SelectValue placeholder={pageSize} />
						</SelectTrigger>
						<SelectContent side="top">
							{[10, 20, 30, 40, 50].map((n) => (
								<SelectItem key={n} value={`${n}`}>
									{n}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-center justify-center">
					Page {pageIndex + 1} of {pageCount}
				</div>
				<div className="flex items-center space-x-2 justify-end">
					<Button
						variant="outline"
						className="h-8 w-8 p-0"
						onClick={() =>
							setPage((prev) => ({ ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }))
						}
						disabled={pageIndex === 0}
					>
						<span className="sr-only">Go to previous page</span>
						<ChevronLeftIcon className="h-4 w-4" />
					</Button>
					<Button
						variant="outline"
						className="h-8 w-8 p-0"
						onClick={() =>
							setPage((prev) => ({
								...prev,
								pageIndex: Math.min(pageCount - 1, prev.pageIndex + 1),
							}))
						}
						disabled={pageIndex >= pageCount - 1}
					>
						<span className="sr-only">Go to next page</span>
						<ChevronRightIcon className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	);
}

export default DataTablePagination;
