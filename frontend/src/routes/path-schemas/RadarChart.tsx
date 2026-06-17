import { useMemo } from "react";
import Plot from "react-plotly.js";
import type { PathSchemaRow } from "@/types/generated/PathSchemaRow";
import { schemaColorAt } from "./lib";

const METRICS: { key: keyof PathSchemaRow; label: string }[] = [
	{ key: "selectivity", label: "Selectivity" },
	{ key: "coverage", label: "Coverage" },
	{ key: "reach", label: "Reach" },
	{ key: "exclusivity", label: "Exclusivity" },
	{ key: "support", label: "Support" },
];

const RADAR_LAYOUT: Partial<Plotly.Layout> = {
	polar: {
		bgcolor: "rgba(0,0,0,0)",
		radialaxis: {
			visible: true,
			range: [0, 1],
			tickfont: { size: 7 },
			gridcolor: "rgba(128,128,128,0.12)",
		},
		angularaxis: { tickfont: { size: 10 }, gridcolor: "rgba(128,128,128,0.15)" },
	},
	margin: { t: 22, r: 50, b: 22, l: 50 },
	autosize: true,
	paper_bgcolor: "rgba(0,0,0,0)",
	showlegend: false,
};

interface Props {
	rows: PathSchemaRow[];
	/** Indices of explicitly selected schemas (drive color + emphasis). */
	selected: number[];
	onSelect: (index: number) => void;
}

export default function RadarChart({ rows, selected, onSelect }: Props) {
	const alive = useMemo(() => rows.filter((r) => !r.is_dead), [rows]);

	const supportRange = useMemo(() => {
		if (alive.length === 0) return { min: 0, max: 1 };
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const r of alive) {
			if (r.support < min) min = r.support;
			if (r.support > max) max = r.support;
		}
		return { min, max: max === min ? min + 1 : max };
	}, [alive]);

	// Show selected schemas (palette-colored); if none selected, show the top 6 by selectivity.
	const shown = useMemo(() => {
		if (selected.length > 0) {
			return selected
				.map((idx, i) => {
					const r = alive.find((a) => a.index === idx);
					return r ? { r, color: schemaColorAt(i) } : null;
				})
				.filter((x): x is { r: PathSchemaRow; color: string } => x !== null);
		}
		return [...alive]
			.sort((a, b) => b.selectivity - a.selectivity)
			.slice(0, 6)
			.map((r, i) => ({ r, color: schemaColorAt(i) }));
	}, [alive, selected]);

	const traces = useMemo<Plotly.Data[]>(() => {
		const theta = METRICS.map((m) => m.label);
		const norm = (r: PathSchemaRow, key: keyof PathSchemaRow) =>
			key === "support"
				? (r.support - supportRange.min) / (supportRange.max - supportRange.min)
				: (r[key] as number);
		return shown.map(({ r, color }) => ({
			type: "scatterpolar",
			r: [...METRICS.map((m) => norm(r, m.key)), norm(r, METRICS[0].key)],
			theta: [...theta, theta[0]],
			fill: "toself",
			fillcolor: `${color}14`,
			line: { color, width: 2 },
			marker: { size: 4, color },
			name: r.schema,
			customdata: new Array(METRICS.length + 1).fill(r.index),
			hovertext: new Array(METRICS.length + 1).fill(r.schema),
			hoverinfo: "text",
		})) as Plotly.Data[];
	}, [shown, supportRange]);

	if (alive.length === 0) {
		return (
			<p className="text-xs text-gray-400 italic p-3">
				Compute metrics first, then select schemas (click table rows) to compare their profiles
				here.
			</p>
		);
	}

	return (
		<Plot
			data={traces}
			layout={RADAR_LAYOUT}
			config={{ displayModeBar: false, responsive: true }}
			style={{ width: "100%", height: "100%" }}
			useResizeHandler
			onClick={(e: Plotly.PlotMouseEvent) => {
				const idx = e.points?.[0]?.customdata as number | undefined;
				if (idx !== undefined) onSelect(idx);
			}}
		/>
	);
}
