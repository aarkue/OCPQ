import { useMemo, useState } from "react";
import Plot from "react-plotly.js";
import { binValues, lerpRgba } from "./lib";
import StatCard from "./StatCard";

const BLUE_LIGHT: [number, number, number] = [165, 180, 252];
const BLUE_DARK: [number, number, number] = [67, 56, 202];
const CARD_BG: [number, number, number] = [99, 102, 241];
const CARD_FG: [number, number, number] = [67, 56, 202];

interface Props {
	targetsPerSource: number[];
	sourcesPerTarget: number[];
}

export default function DistributionChart({ targetsPerSource, sourcesPerTarget }: Props) {
	const [mode, setMode] = useState<"targets" | "sources">("targets");
	const [scope, setScope] = useState<"all" | "active">("all");
	const base = mode === "targets" ? targetsPerSource : sourcesPerTarget;
	const counts = useMemo(
		() => (scope === "active" ? base.filter((c) => c > 0) : base),
		[base, scope],
	);
	const label = mode === "targets" ? "Targets per source" : "Sources per target";
	const entityLabel = `${scope === "active" ? "active " : ""}${mode === "targets" ? "sources" : "targets"}`;

	const stats = useMemo(() => {
		if (counts.length === 0) return null;
		const sorted = [...counts].sort((a, b) => a - b);
		const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
		const median =
			sorted.length % 2 === 0
				? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
				: sorted[Math.floor(sorted.length / 2)];
		return { min: sorted[0], max: sorted[sorted.length - 1], mean, median };
	}, [counts]);

	const { data, layout } = useMemo(() => {
		if (counts.length === 0)
			return { data: [] as Plotly.Data[], layout: {} as Partial<Plotly.Layout> };
		const { centers, heights, binWidth } = binValues(counts, true);
		const minC = Math.min(...centers);
		const maxC = Math.max(...centers);
		const range = maxC - minC || 1;
		const colors = centers.map((c) => lerpRgba(BLUE_LIGHT, BLUE_DARK, (c - minC) / range, 0.75));
		return {
			data: [
				{
					type: "bar",
					x: centers,
					y: heights,
					width: binWidth * 0.92,
					marker: { color: colors },
					hovertemplate: `%{x}: %{y} ${entityLabel}<extra></extra>`,
				},
			] as Plotly.Data[],
			layout: {
				xaxis: { title: { text: label }, tickfont: { size: 10 } },
				yaxis: { title: { text: `# ${entityLabel}` }, tickfont: { size: 10 } },
				margin: { t: 8, r: 8, b: 40, l: 44 },
				height: 170,
				paper_bgcolor: "rgba(0,0,0,0)",
				plot_bgcolor: "rgba(0,0,0,0)",
				bargap: 0.05,
			} as Partial<Plotly.Layout>,
		};
	}, [counts, label, entityLabel]);

	if (counts.length === 0) {
		return null;
	}

	const absMax = Math.max(stats?.max ?? 1, 1);
	return (
		<div className="bg-gray-50 rounded-lg p-2.5">
			<div className="flex items-center justify-between mb-1.5">
				<p className="text-xs font-medium uppercase tracking-wider text-gray-600">
					{label}
					<br />({counts.length} {entityLabel})
				</p>
				<div className="flex gap-1.5">
					<div className="flex rounded overflow-hidden border text-[11px]">
						<button
							type="button"
							onClick={() => setMode("targets")}
							className={`px-2 py-0.5 ${mode === "targets" ? "bg-indigo-100 text-indigo-800 font-medium" : "bg-white text-gray-500"}`}
						>
							per source
						</button>
						<button
							type="button"
							onClick={() => setMode("sources")}
							className={`px-2 py-0.5 ${mode === "sources" ? "bg-indigo-100 text-indigo-800 font-medium" : "bg-white text-gray-500"}`}
						>
							per target
						</button>
					</div>
					<div className="flex rounded overflow-hidden border text-[11px]">
						<button
							type="button"
							onClick={() => setScope("all")}
							className={`px-2 py-0.5 ${scope === "all" ? "bg-indigo-100 text-indigo-800 font-medium" : "bg-white text-gray-500"}`}
						>
							all
						</button>
						<button
							type="button"
							onClick={() => setScope("active")}
							title="Only entities with at least one connection"
							className={`px-2 py-0.5 ${scope === "active" ? "bg-indigo-100 text-indigo-800 font-medium" : "bg-white text-gray-500"}`}
						>
							active
						</button>
					</div>
				</div>
			</div>
			{stats && (
				<div className="flex gap-1 mb-1.5">
					<StatCard
						label="Min"
						value={String(stats.min)}
						intensity={stats.min / absMax}
						bg={CARD_BG}
						fg={CARD_FG}
					/>
					<StatCard
						label="Median"
						value={stats.median.toFixed(1)}
						intensity={stats.median / absMax}
						bg={CARD_BG}
						fg={CARD_FG}
					/>
					<StatCard
						label="Mean"
						value={stats.mean.toFixed(2)}
						intensity={stats.mean / absMax}
						bg={CARD_BG}
						fg={CARD_FG}
					/>
					<StatCard
						label="Max"
						value={String(stats.max)}
						intensity={stats.max / absMax}
						bg={CARD_BG}
						fg={CARD_FG}
					/>
				</div>
			)}
			<Plot
				data={data}
				layout={layout}
				config={{ displayModeBar: false, responsive: true, scrollZoom: false }}
				style={{ width: "100%" }}
				useResizeHandler
			/>
		</div>
	);
}
