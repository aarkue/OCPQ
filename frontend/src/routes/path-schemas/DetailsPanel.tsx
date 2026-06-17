import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { LuExternalLink } from "react-icons/lu";
import Plot from "react-plotly.js";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useBackend } from "@/hooks";
import type { PathSchemaDetail } from "@/types/generated/PathSchemaDetail";
import type { PathSchemaInfo } from "@/types/generated/PathSchemaInfo";
import type { PathSchemaRow } from "@/types/generated/PathSchemaRow";
import type { PathTypeRef } from "@/types/generated/PathTypeRef";
import type { SelectionMode } from "@/types/generated/SelectionMode";
import type { TemporalMode } from "@/types/generated/TemporalMode";
import DistributionChart from "./DistributionChart";
import { binValues, eqLabel, formatDuration, lerpRgba } from "./lib";
import SchemaPathDiagram from "./SchemaPathDiagram";
import StatCard from "./StatCard";
import { openSchemaAsQuery } from "./toQuery";

const ORANGE_LIGHT: [number, number, number] = [253, 186, 116];
const ORANGE_DARK: [number, number, number] = [194, 65, 12];
const CARD_BG: [number, number, number] = [251, 146, 60];
const CARD_FG: [number, number, number] = [194, 65, 12];

function durationTicks(values: number[], count = 6) {
	if (values.length === 0) return { tickvals: [] as number[], ticktext: [] as string[] };
	const min = Math.min(...values);
	const max = Math.max(...values);
	if (min === max) return { tickvals: [min], ticktext: [formatDuration(min)] };
	const step = (max - min) / (count - 1);
	const tickvals = Array.from({ length: count }, (_, i) => min + step * i);
	return { tickvals, ticktext: tickvals.map(formatDuration) };
}

function ThroughputHistogram({ durations }: { durations: number[] }) {
	const { data, layout } = useMemo(() => {
		if (durations.length === 0)
			return { data: [] as Plotly.Data[], layout: {} as Partial<Plotly.Layout> };
		const { centers, heights, binWidth } = binValues(durations);
		const total = heights.reduce((a, b) => a + b, 0) || 1;
		const pct = heights.map((h) => (h / total) * 100);
		const minC = Math.min(...centers);
		const maxC = Math.max(...centers);
		const range = maxC - minC || 1;
		const barColors = centers.map((c) =>
			lerpRgba(ORANGE_LIGHT, ORANGE_DARK, (c - minC) / range, 0.75),
		);
		const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
		const ticks = durationTicks(centers);
		return {
			data: [
				{
					type: "bar",
					x: centers,
					y: pct,
					customdata: heights,
					width: binWidth * 0.95,
					marker: { color: barColors, line: { color: "#c2410c", width: 0.5 } },
					hovertemplate: "%{y:.1f}% (%{customdata} connections)<extra></extra>",
				},
			] as Plotly.Data[],
			layout: {
				xaxis: {
					title: { text: "Throughput time" },
					tickvals: ticks.tickvals,
					ticktext: ticks.ticktext,
					tickfont: { size: 10 },
				},
				yaxis: { ticksuffix: "%", tickfont: { size: 10 } },
				margin: { t: 26, r: 8, b: 42, l: 40 },
				height: 190,
				paper_bgcolor: "rgba(0,0,0,0)",
				plot_bgcolor: "rgba(0,0,0,0)",
				bargap: 0.05,
				shapes: [
					{
						type: "line",
						x0: mean,
						x1: mean,
						y0: 0,
						y1: 1,
						xref: "x",
						yref: "paper",
						line: { color: "#c2410c", width: 1.5, dash: "dash" },
					},
				],
				annotations: [
					{
						x: mean,
						y: 1.02,
						xref: "x",
						yref: "paper",
						text: `Mean: ${formatDuration(mean)}`,
						showarrow: false,
						font: { size: 11, color: "#c2410c" },
						yanchor: "bottom",
					},
				],
			} as Partial<Plotly.Layout>,
		};
	}, [durations]);

	if (durations.length === 0) {
		return (
			<p className="text-xs text-gray-400 italic p-2">
				No throughput data (target type has no event timestamps).
			</p>
		);
	}
	return (
		<Plot
			data={data}
			layout={layout}
			config={{ displayModeBar: false, responsive: true, scrollZoom: false }}
			style={{ width: "100%" }}
			useResizeHandler
		/>
	);
}

function MetricCard({
	label,
	value,
	className,
}: {
	label: string;
	value: string;
	className?: string;
}) {
	return (
		<div
			className={`basis-[17%] grow min-w-0 rounded-lg px-2 py-1.5 text-center ${className ?? "bg-gray-50"}`}
		>
			<p className="text-[10px] uppercase tracking-wider leading-tight text-gray-500">{label}</p>
			<p className="text-sm font-semibold font-mono text-gray-800 truncate">{value}</p>
		</div>
	);
}

function exportConnectionsCsv(
	detail: PathSchemaDetail,
	download: (blob: Blob, fileName: string) => unknown,
) {
	const header = "source_id,target_id,source_time,target_time\n";
	const body = detail.connections
		.map((c) => `${c.source_id},${c.target_id},${c.source_time ?? ""},${c.target_time ?? ""}`)
		.join("\n");
	const blob = new Blob([header + body], { type: "text/csv" });
	download(blob, "connections.csv");
}

interface Props {
	source: PathTypeRef;
	target: PathTypeRef | null;
	maxLength: number;
	allowedTypes: PathTypeRef[] | null;
	focusedRow: PathSchemaRow;
	schemaInfo: PathSchemaInfo;
	defaultBoundedSeconds: number;
}

export default function DetailsPanel({
	source,
	target,
	maxLength,
	allowedTypes,
	focusedRow,
	schemaInfo,
	defaultBoundedSeconds,
}: Props) {
	const backend = useBackend();
	const navigate = useNavigate();

	const [temporal, setTemporal] = useState<TemporalMode>("Forward");
	const [selection, setSelection] = useState<SelectionMode>("Last");
	const [boundedSeconds, setBoundedSeconds] = useState(defaultBoundedSeconds);
	const [detail, setDetail] = useState<PathSchemaDetail | null>(null);
	const [loading, setLoading] = useState(false);
	// Monotonic id so a slow request whose schema/options were superseded is ignored.
	const requestId = useRef(0);

	async function openAsQuery() {
		try {
			await openSchemaAsQuery(schemaInfo, temporal, boundedSeconds);
			navigate("/constraints");
		} catch {
			toast.error("Failed to create query");
		}
	}

	const fetchDetail = useCallback(
		async (t: TemporalMode, s: SelectionMode, w: number) => {
			const reqId = ++requestId.current;
			setLoading(true);
			try {
				const d = await backend["ocel/path-schemas/schema-detail"]({
					source,
					target,
					max_length: maxLength,
					schema_index: focusedRow.index,
					temporal: t,
					selection: s,
					bounded_seconds: t === "Bounded" ? w : null,
					max_connections: null,
					allowed_types: allowedTypes,
				});
				if (requestId.current === reqId) setDetail(d);
			} catch {
				if (requestId.current === reqId) toast.error("Failed to load schema detail");
			} finally {
				if (requestId.current === reqId) setLoading(false);
			}
		},
		[backend, source, target, maxLength, allowedTypes, focusedRow.index],
	);

	// Reset controls on schema change; do NOT auto-compute (can hang on large logs).
	// Bumping requestId invalidates any in-flight fetch for the previous schema.
	// biome-ignore lint/correctness/useExhaustiveDependencies: react only to schema change.
	useEffect(() => {
		requestId.current++;
		setTemporal("Forward");
		setSelection("Last");
		setBoundedSeconds(defaultBoundedSeconds);
		setDetail(null);
		setLoading(false);
	}, [focusedRow.index]);

	return (
		<div className="flex flex-col gap-3 p-3 text-left">
			<div className="flex items-center justify-between gap-2">
				<p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Schema</p>
				<Button
					size="sm"
					variant="outline"
					className="h-7 gap-1.5"
					onClick={() => void openAsQuery()}
					title="Create an editable OCPQ query (binding box) from this schema"
				>
					<LuExternalLink size={13} /> Open as OCPQ query
				</Button>
			</div>
			<SchemaPathDiagram source={schemaInfo.source} steps={schemaInfo.steps} />

			<div>
				<p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">
					Base metrics · all connections · eq. class {eqLabel(focusedRow.equivalence_class)}
				</p>
				<div className="flex gap-1.5 flex-wrap">
					<MetricCard label="Support" value={String(focusedRow.support)} />
					<MetricCard label="Coverage" value={focusedRow.coverage.toFixed(3)} />
					<MetricCard label="Selectivity" value={focusedRow.selectivity.toFixed(3)} />
					<MetricCard label="Reach" value={focusedRow.reach.toFixed(3)} />
					<MetricCard label="Exclusivity" value={focusedRow.exclusivity.toFixed(3)} />
				</div>
			</div>

			<div className="border rounded-lg p-2 bg-gray-50/70 flex flex-col gap-2">
				<div className="flex items-end gap-2 flex-wrap">
					<div className="flex flex-col gap-0.5">
						<Label className="text-[11px]">Temporal</Label>
						<Select value={temporal} onValueChange={(v) => setTemporal(v as TemporalMode)}>
							<SelectTrigger className="w-[13ch] h-8">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="None">None</SelectItem>
								<SelectItem value="Forward">Forward</SelectItem>
								<SelectItem value="Bounded">Bounded</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{temporal === "Bounded" && (
						<div className="flex flex-col gap-0.5">
							<Label className="text-[11px]">Window (s)</Label>
							<Input
								type="number"
								className="w-[12ch] h-8"
								value={boundedSeconds}
								onChange={(e) => setBoundedSeconds(e.currentTarget.valueAsNumber || 0)}
							/>
						</div>
					)}
					<div className="flex flex-col gap-0.5">
						<Label className="text-[11px]">Selection</Label>
						<Select value={selection} onValueChange={(v) => setSelection(v as SelectionMode)}>
							<SelectTrigger className="w-[13ch] h-8">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="All">All</SelectItem>
								<SelectItem value="First">First</SelectItem>
								<SelectItem value="Last">Last</SelectItem>
								<SelectItem value="Closest">Closest</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<Button
						size="sm"
						disabled={loading}
						onClick={() => void fetchDetail(temporal, selection, boundedSeconds)}
					>
						{loading ? "..." : detail ? "Recompute" : "Compute"}
					</Button>
				</div>

				{detail && (
					<div className="border-t border-gray-200 pt-2 flex flex-col gap-2">
						<div className="flex items-center justify-between">
							<p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Result</p>
							<div className="flex gap-1 shrink-0">
								<Button
									size="sm"
									variant="outline"
									className="h-6 text-xs"
									onClick={() => exportConnectionsCsv(detail, backend["download-blob"])}
								>
									Download connections
								</Button>
							</div>
						</div>

						<div className="flex gap-1.5 flex-wrap">
							<MetricCard label="Support" value={String(detail.support)} className="bg-gray-100" />
							<MetricCard
								label="Coverage"
								value={detail.coverage.toFixed(3)}
								className="bg-gray-100"
							/>
							<MetricCard
								label="Selectivity"
								value={detail.selectivity.toFixed(3)}
								className="bg-gray-100"
							/>
							<MetricCard label="Reach" value={detail.reach.toFixed(3)} className="bg-gray-100" />
							<MetricCard
								label="Exclusivity"
								value={detail.exclusivity.toFixed(3)}
								className="bg-gray-100"
							/>
						</div>

						<div className="bg-gray-50 rounded-lg p-2.5">
							<p className="text-xs font-medium uppercase tracking-wider text-gray-600 mb-1.5">
								Throughput time ({detail.throughput_seconds.length}
								{detail.connection_count > detail.throughput_seconds.length
									? ` of ${detail.connection_count}`
									: ""}{" "}
								connections)
							</p>
							{detail.throughput && (
								<div className="flex gap-1 mb-1.5">
									{(() => {
										const t = detail.throughput;
										const absMax = Math.max(
											Math.abs(t.min),
											Math.abs(t.median),
											Math.abs(t.mean),
											Math.abs(t.max),
											1,
										);
										return (
											<>
												<StatCard
													label="Min"
													value={formatDuration(t.min)}
													intensity={Math.abs(t.min) / absMax}
													bg={CARD_BG}
													fg={CARD_FG}
												/>
												<StatCard
													label="Median"
													value={formatDuration(t.median)}
													intensity={Math.abs(t.median) / absMax}
													bg={CARD_BG}
													fg={CARD_FG}
												/>
												<StatCard
													label="Mean"
													value={formatDuration(t.mean)}
													intensity={Math.abs(t.mean) / absMax}
													bg={CARD_BG}
													fg={CARD_FG}
												/>
												<StatCard
													label="Max"
													value={formatDuration(t.max)}
													intensity={Math.abs(t.max) / absMax}
													bg={CARD_BG}
													fg={CARD_FG}
												/>
											</>
										);
									})()}
								</div>
							)}
							<ThroughputHistogram durations={detail.throughput_seconds} />
						</div>

						<DistributionChart
							targetsPerSource={detail.targets_per_source}
							sourcesPerTarget={detail.sources_per_target}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
