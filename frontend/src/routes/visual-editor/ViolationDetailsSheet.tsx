import { lazy, memo, Suspense, useContext, useMemo } from "react";
import toast from "react-hot-toast";
import { TbTableExport } from "react-icons/tb";
import AlertHelper from "@/components/AlertHelper";
import type PaginatedBindingTable from "@/components/binding-table/PaginatedBindingTable";
import Spinner from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import MultiSelect from "@/components/ui/multi-select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useBackend } from "@/hooks";
import type { BindingBoxTreeNode } from "@/types/generated/BindingBoxTreeNode";
import type { TableExportOptions } from "@/types/generated/TableExportOptions";
import { LabelLabel } from "./helper/box/LabelFunctionChooser";
import type { EvaluationResPerNodes } from "./helper/types";
import { VisualEditorContext } from "./helper/VisualEditorContext";

const DataTablePaginationLazy = lazy(
	async () => await import("@/components/binding-table/PaginatedBindingTable"),
) as typeof PaginatedBindingTable;

const ViolationDetailsSheet = memo(function ViolationDetailsSheet({
	violationResPerNodes: _violationResPerNodes,
	reset,
	initialMode,
	node,
	nodeID,
}: {
	violationResPerNodes: EvaluationResPerNodes;
	initialMode: "violations" | "situations" | "satisfied-situations" | undefined;
	node: BindingBoxTreeNode;
	nodeID: string;
	reset: () => unknown;
}) {
	const backend = useBackend();
	const hasConstraints = "Box" in node ? node.Box[0].constraints.length > 0 : true;

	const { showElementInfo, violationsPerNode } = useContext(VisualEditorContext);
	const labels = useMemo(
		() => ("Box" in node ? (node.Box[0].labels?.map((l) => l.label) ?? []) : []),
		[node],
	);

	const summary = violationsPerNode?.evalRes[nodeID];
	const nodeIndex = violationsPerNode?.nodeIdtoIndex[nodeID];
	const evalVersion = violationsPerNode?.evalVersion;
	const numBindings = summary?.situationCount ?? 0;
	const numViolations = summary?.situationViolatedCount ?? 0;

	return (
		<Sheet
			modal={false}
			open={summary !== undefined}
			onOpenChange={(o) => {
				if (!o) {
					reset();
					showElementInfo(undefined);
				}
			}}
		>
			{summary !== undefined && (
				<SheetContent
					side="left"
					className="h-screen flex flex-col w-[50vw] min-w-fit"
					overlay={false}
					onInteractOutside={(ev) => {
						ev.preventDefault();
					}}
				>
					<SheetHeader>
						<SheetTitle className="flex items-center justify-between pr-4">
							Output Bindings
						</SheetTitle>
						<SheetDescription asChild>
							<div>
								<div className="flex justify-between">
									<p className="text-primary text-base">
										{numBindings} Bindings
										<br />
										{numViolations} Violations
									</p>
									<AlertHelper
										title="Export Situation Table CSV/XLSX"
										mode="promise"
										initialData={
											{
												includeIds: true,
												includeViolationStatus: hasConstraints,
												omitHeader: false,
												labels,
												format: "CSV",
											} satisfies TableExportOptions as TableExportOptions
										}
										trigger={
											<Button
												size="icon"
												variant="outline"
												title="Export as CSV/XLSX (Situation Table)"
											>
												<TbTableExport />
											</Button>
										}
										content={({ data, setData }) => (
											<div>
												<p className="mb-4">
													All event or object attributes will be included as an extra column. The
													object/event ID can also be included as a column (on by default).
												</p>
												<div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-2 items-center">
													<Label>Format</Label>
													<Combobox
														options={[
															{ label: "CSV (Basic)", value: "CSV" },
															{ label: "XLSX (Formatted)", value: "XLSX" },
														]}
														name="Export Format"
														value={data.format}
														onChange={(f) => {
															if (f === "CSV" || f === "XLSX") {
																setData({
																	...data,
																	format: f as "CSV" | "XLSX",
																});
															}
														}}
													/>
													<Label>Include IDs</Label>
													<Switch
														checked={data.includeIds}
														onCheckedChange={(b) => {
															setData({ ...data, includeIds: b });
														}}
													/>
													<Label>Include Headers</Label>
													<Switch
														checked={!data.omitHeader}
														onCheckedChange={(b) => {
															setData({ ...data, omitHeader: !b });
														}}
													/>
													{labels.length >= 1 && (
														<>
															<Label>Labels to Include</Label>
															<MultiSelect
																options={labels.map((l) => ({
																	value: l,
																	label: <LabelLabel label={l} />,
																}))}
																onValueChange={(value: string[]) => {
																	setData({ ...data, labels: value });
																}}
																name={"Labels"}
																defaultValue={data.labels}
																placeholder={""}
															/>
														</>
													)}
													{hasConstraints && (
														<>
															<Label>Include Violation Status</Label>
															<Switch
																checked={data.includeViolationStatus}
																onCheckedChange={(b) => {
																	setData({
																		...data,
																		includeViolationStatus: b,
																	});
																}}
															/>
														</>
													)}
												</div>
											</div>
										)}
										submitAction="Export"
										onSubmit={async (data, _ev) => {
											try {
												if (nodeIndex !== undefined) {
													const res = await toast.promise(
														backend["ocel/export-bindings"](nodeIndex, data),
														{
															loading: "Exporting to CSV...",
															error: (e) => (
																<p>
																	Failed to export to CSV!
																	<br />
																	{String(e)}
																</p>
															),
															success: "Finished CSV Export!",
														},
													);
													if (res !== undefined) {
														backend["download-blob"](
															res,
															`situation-table.${data.format === "CSV" ? "csv" : "xlsx"}`,
														);
													}
												}
											} catch (e) {
												toast.error(String(e));
												throw e;
											}
										}}
									/>
								</div>
							</div>
						</SheetDescription>
					</SheetHeader>

					{evalVersion !== undefined && nodeIndex !== undefined && numBindings > 0 && (
						<Suspense
							fallback={
								<div className="flex items-center gap-x-2">
									Loading binding table... <Spinner />
								</div>
							}
						>
							<DataTablePaginationLazy
								key={JSON.stringify(node)}
								evalVersion={evalVersion}
								nodeIndex={nodeIndex}
								totalCount={numBindings}
								totalViolatedCount={numViolations}
								node={node}
								addViolationStatus={hasConstraints}
								showElementInfo={showElementInfo}
								initialMode={initialMode}
							/>
						</Suspense>
					)}
				</SheetContent>
			)}
		</Sheet>
	);
});
export default ViolationDetailsSheet;
