import toast from "react-hot-toast";
import { TbTableExport } from "react-icons/tb";
import AlertHelper from "@/components/AlertHelper";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import MultiSelect from "@/components/ui/multi-select";
import { Switch } from "@/components/ui/switch";
import { useBackend } from "@/hooks";
import { LabelLabel } from "@/routes/visual-editor/helper/box/LabelFunctionChooser";
import type { TableExportOptions } from "@/types/generated/TableExportOptions";

/** Exports one box's situation table of an evaluation as CSV or XLSX. */
export default function BindingsExportButton({
	nodeIndex,
	evalVersion,
	labels,
	hasConstraints,
}: {
	nodeIndex: number;
	evalVersion: number;
	labels: string[];
	hasConstraints: boolean;
}) {
	const backend = useBackend();
	return (
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
				<Button size="icon" variant="outline" title="Export as CSV/XLSX (Situation Table)">
					<TbTableExport />
				</Button>
			}
			content={({ data, setData }) => (
				<div>
					<p className="mb-4">
						All event or object attributes will be included as an extra column. The object/event ID
						can also be included as a column (on by default).
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
									setData({ ...data, format: f });
								}
							}}
						/>
						<Label>Include IDs</Label>
						<Switch
							checked={data.includeIds}
							onCheckedChange={(b) => setData({ ...data, includeIds: b })}
						/>
						<Label>Include Headers</Label>
						<Switch
							checked={!data.omitHeader}
							onCheckedChange={(b) => setData({ ...data, omitHeader: !b })}
						/>
						{labels.length >= 1 && (
							<>
								<Label>Labels to Include</Label>
								<MultiSelect
									options={labels.map((l) => ({ value: l, label: <LabelLabel label={l} /> }))}
									onValueChange={(value: string[]) => setData({ ...data, labels: value })}
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
									onCheckedChange={(b) => setData({ ...data, includeViolationStatus: b })}
								/>
							</>
						)}
					</div>
				</div>
			)}
			submitAction="Export"
			onSubmit={async (data) => {
				const res = await toast.promise(
					backend["ocel/export-bindings"](nodeIndex, data, evalVersion),
					{
						loading: "Exporting the table...",
						error: (e) => (
							<p>
								Could not export the table
								<br />
								{String(e)}
							</p>
						),
						success: "Exported the table",
					},
				);
				if (res !== undefined) {
					backend["download-blob"](
						res,
						`situation-table.${data.format === "CSV" ? "csv" : "xlsx"}`,
					);
				}
			}}
		/>
	);
}
