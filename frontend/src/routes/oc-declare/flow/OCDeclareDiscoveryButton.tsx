import { useRef } from "react";
import toast from "react-hot-toast";
import { RiRobot2Line } from "react-icons/ri";
import AlertHelper from "@/components/AlertHelper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MultiSelect from "@/components/ui/multi-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useBackend, useOcelInfo } from "@/hooks";
import type { OCDeclareArc } from "../types/OCDeclareArc";
import type { OCDeclareArcType } from "../types/OCDeclareArcType";

export type OCDeclareDiscoveryOptions = {
	noise_threshold: number;
	o2o_mode: "None" | "Direct" | "Reversed" | "Bidirectional";
	acts_to_use?: string[] | undefined;
	counts_for_generation: [number | null, number | null];
	counts_for_filter: [number | null, number | null];
	reduction: "None" | "Lossless" | "Lossy";
	considered_arrow_types: OCDeclareArcType[];
	refinement: boolean;
};
const DEFAULT_OC_DECLARE_DISCOVERY_OPTIONS: OCDeclareDiscoveryOptions = {
	noise_threshold: 0.2,
	o2o_mode: "None",
	counts_for_generation: [1, 20],
	counts_for_filter: [1, 20],
	reduction: "Lossless",
	refinement: true,
	considered_arrow_types: ["AS", "EF", "EP"],
};
export default function OCDeclareDiscoveryButton({
	onConstraintsDiscovered,
}: {
	onConstraintsDiscovered: (arcs: OCDeclareArc[]) => unknown;
}) {
	const backend = useBackend();
	const ocelInfo = useOcelInfo();
	const wasCancelledRef = useRef(false);
	return (
		<AlertHelper
			onCancel={() => {
				wasCancelledRef.current = true;
				toast.dismiss("oc-declare-discovery");
			}}
			trigger={
				<Button size="default" className="font-semibold">
					{" "}
					<RiRobot2Line className="mr-1" /> Auto Discover...
				</Button>
			}
			initialData={{ ...DEFAULT_OC_DECLARE_DISCOVERY_OPTIONS }}
			title="Auto-Discover OC-DECLARE Constraints"
			content={({ data, setData }) => (
				<div className="flex flex-col gap-y-4">
					<Label className="flex flex-col gap-y-1">
						O2O Mode
						<Select
							value={data.o2o_mode}
							defaultValue={data.o2o_mode}
							onValueChange={(v) =>
								setData({
									...data,
									o2o_mode: v as OCDeclareDiscoveryOptions["o2o_mode"],
								})
							}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(
									[
										"None",
										"Direct",
										"Reversed",
										"Bidirectional",
									] satisfies OCDeclareDiscoveryOptions["o2o_mode"][]
								).map((v) => (
									<SelectItem key={v} value={v}>
										{v}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Label>
					<Label className="flex flex-col gap-y-1">
						Noise Threshold
						<Input
							type="number"
							min={0}
							max={1}
							step={0.05}
							value={data.noise_threshold}
							onChange={(ev) =>
								setData({
									...data,
									noise_threshold: ev.currentTarget.valueAsNumber,
								})
							}
						/>
					</Label>
					<Label className="flex flex-col gap-y-1">
						Maximal Count Filters
						<Select
							value={
								data.counts_for_filter[1] === null
									? "no-max-counts"
									: data.counts_for_generation[1] === null
										? "after-discovery"
										: "during-discovery"
							}
							onValueChange={(mode) => {
								if (mode === "no-max-counts") {
									setData({
										...data,
										counts_for_filter: [1, null],
										counts_for_generation: [1, null],
										refinement: false,
									});
								} else if (mode === "after-discovery") {
									setData({
										...data,
										counts_for_filter: [1, 20],
										counts_for_generation: [1, null],
										refinement: false,
									});
								} else if (mode === "during-discovery") {
									setData({
										...data,
										counts_for_filter: [1, 20],
										counts_for_generation: [1, 20],
									});
								}
							}}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="no-max-counts">
									No max counts{" "}
									<span className="text-xs text-muted-foreground">
										Discover all maximal constraints.
									</span>
								</SelectItem>
								<SelectItem value="after-discovery">
									After Discovery{" "}
									<span className="text-xs text-muted-foreground">
										Discover all but filter constraints <b className="font-bold">only</b> supported
										by resource-like objects.
									</span>
								</SelectItem>
								<SelectItem value="during-discovery">
									During Discovery{" "}
									<span className="text-xs text-muted-foreground">
										Filter out constraints during discovery, likely not including resource-like
										object types in constraints.
									</span>
								</SelectItem>
							</SelectContent>
						</Select>
					</Label>
					<Label className="flex flex-col gap-y-1">
						Reduction
						<Select
							value={data.reduction}
							defaultValue={data.reduction}
							onValueChange={(v) =>
								setData({
									...data,
									reduction: v as OCDeclareDiscoveryOptions["reduction"],
								})
							}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(
									["None", "Lossless", "Lossy"] satisfies OCDeclareDiscoveryOptions["reduction"][]
								).map((v) => (
									<SelectItem key={v} value={v}>
										{v}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Label>
					<Label className="flex flex-col gap-y-1">
						Refinement
						<Select
							disabled={data.counts_for_filter[1] == null || data.counts_for_generation[1] == null}
							value={data.refinement ? "true" : "false"}
							onValueChange={(mode) => {
								setData({ ...data, refinement: mode === "true" });
							}}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="false">
									Disabled{" "}
									<span className="text-xs text-muted-foreground">
										Do not refine discovered constraints.
									</span>
								</SelectItem>
								<SelectItem value="true">
									Enabled{" "}
									<span className="text-xs text-muted-foreground">
										Refine discovered constraints after discovery and reduction.
									</span>
								</SelectItem>
							</SelectContent>
						</Select>
					</Label>
					<Label className="flex flex-col gap-y-1">
						Arrow Types
						<MultiSelect
							options={
								[
									{ value: "AS", label: "AS" },
									{ value: "EF", label: "EF" },
									{ value: "EP", label: "EP" },
									{ value: "DF", label: "DF" },
									{ value: "DP", label: "DP" },
								] satisfies { value: OCDeclareArcType; label: any }[]
							}
							placeholder={""}
							defaultValue={data.considered_arrow_types}
							onValueChange={(value: string[]) => {
								setData({
									...data,
									considered_arrow_types: value as OCDeclareArcType[],
								});
							}}
						/>
					</Label>
					{ocelInfo?.event_types && (
						<div className="flex flex-col gap-y-1">
							<Label>Activities</Label>
							<div className="flex items-center gap-x-1">
								<Switch
									checked={data.acts_to_use === undefined}
									onCheckedChange={(checked) => {
										if (checked) {
											setData({ ...data, acts_to_use: undefined });
										} else {
											// setData({ ...data, acts_to_use: ["W_Shortened completion ", "A_Denied", "O_Refused"] })
											setData({
												...data,
												acts_to_use: ocelInfo.event_types.slice(0, 3).map((t) => t.name),
											});
										}
									}}
								/>
								<Label>Use {data.acts_to_use === undefined ? "all" : "selected"} activities</Label>
							</div>
							{data.acts_to_use !== undefined && (
								<MultiSelect
									options={ocelInfo.event_types.map((t) => ({
										label: t.name,
										value: t.name,
									}))}
									placeholder={""}
									defaultValue={data.acts_to_use}
									onValueChange={(value: string[]) => {
										setData({ ...data, acts_to_use: value });
									}}
								/>
							)}
						</div>
					)}
				</div>
			)}
			submitAction={<>Run</>}
			mode="promise"
			onSubmit={async (data) => {
				wasCancelledRef.current = false;
				const res = await toast.promise(
					backend["ocel/discover-oc-declare"](data),
					{
						loading: "Discovering...",
						error: "Discovery failed.",
						success: (e) => `Discovery finished!\nFound ${e.length} constraints.`,
					},
					{ id: "oc-declare-discovery" },
				);
				if (!wasCancelledRef.current) {
					onConstraintsDiscovered(res);
				} else {
					toast.dismiss("oc-declare-discovery");
				}
			}}
		/>
	);
}
