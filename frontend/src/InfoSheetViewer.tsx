import { useQuery } from "@tanstack/react-query";
import { useContext, useMemo } from "react";
import Spinner from "./components/Spinner";
import { Sheet, SheetContent } from "./components/ui/sheet";
import { useBackend } from "./hooks/useBackend";
import { InfoSheetContext } from "./InfoSheet";

export default function InfoSheetViewer() {
	const { infoSheetState, setInfoSheetState } = useContext(InfoSheetContext);
	if (infoSheetState === undefined) {
		return null;
	}
	return (
		<Sheet
			open={true}
			onOpenChange={(o) => {
				if (!o) {
					setInfoSheetState(undefined);
				}
			}}
			modal={false}
		>
			<SheetContent
				side="bottom"
				className="h-[40vh] flex flex-col pb-1"
				overlay={false}
				onInteractOutside={(ev) => {
					ev.preventDefault();
				}}
			>
				{infoSheetState.type === "activity-frequencies" && (
					<ActivityFrequenciesSheet activity={infoSheetState.activity} />
				)}
				{infoSheetState.type === "edge-duration-statistics" && (
					<EdgeDurationSheet edge={infoSheetState.edge} />
				)}
			</SheetContent>
		</Sheet>
	);
}

import { DialogTitle } from "@radix-ui/react-dialog";
import Plot from "react-plotly.js";
import { getRandomStringColor } from "./lib/random-colors";
import type { OCDeclareArc } from "./routes/oc-declare/types/OCDeclareArc";

function ActivityFrequenciesSheet({ activity }: { activity: string }) {
	const backend = useBackend();
	const activityStats = useQuery({
		queryKey: ["ocel", "activity-stats", activity],
		queryFn: () => backend["ocel/get-activity-statistics"](activity),
	});
	const sortedObjectTypes = useMemo(() => {
		const ots = Object.keys(activityStats.data?.num_evs_per_ot_type ?? {});
		ots.sort();
		return ots;
	}, [activityStats.data]);
	const maxObCount = useMemo(() => {
		return Math.max(...Object.values(activityStats.data?.num_obs_of_ot_per_ev ?? {}).flat());
	}, [activityStats.data]);

	const maxEvCount = useMemo(() => {
		return Math.max(...Object.values(activityStats.data?.num_evs_per_ot_type ?? {}).flat());
	}, [activityStats.data]);
	const commonLayout: Partial<Plotly.Layout> = {
		font: {
			family: "system-ui, Inter, sans-serif",
			size: 12,
			color: "#555",
		},
		yaxis: {
			ticksuffix: "%",
			rangemode: "tozero",
			range: [0, 100],
		},
		xaxis: {
			range: [0, null],
			rangemode: "tozero",
			// dtick: 1,
			// autorange: false,
			// autorange: "max",
		},
		barmode: "overlay",
		legend: {
			orientation: "h",
			yanchor: "bottom",
			y: 0.9,
			xanchor: "right",
			x: 1,
			bgcolor: "rgba(255, 255, 255, 0.8)",
			bordercolor: "#fafafa",
			borderwidth: 1,
		},
		margin: {
			l: 40,
			r: 0,
			b: 55,
			t: 45,
			pad: 4,
		},
		hovermode: "x",
	};
	const commonConfig: Partial<Plotly.Config> = {
		responsive: true,
		displaylogo: false,
		displayModeBar: false,
	};
	return (
		<div className="w-full h-full">
			<h2 className="font-semibold text-2xl">
				Statistics for <span className="bg-gray-400/40 px-2 -mx-0.5 rounded-sm ">{activity}</span>
			</h2>
			{activityStats.isPending && <Spinner />}
			{activityStats.data !== undefined && (
				<div className="flex w-full h-full gap-x-4">
					<Plot
						useResizeHandler
						className="h-full w-full"
						data={sortedObjectTypes.map((ot) => ({
							type: "histogram",
							marker: { color: getRandomStringColor(ot), line: { width: 0.5 } },
							opacity: 0.4,
							histnorm: "percent",
							name: ot,
							x: activityStats.data.num_obs_of_ot_per_ev[ot],
						}))}
						layout={{
							...commonLayout,
							title: {
								text: "Number of Objects per Event",
							},
							xaxis: {
								...commonLayout.xaxis,
								dtick: maxObCount > 100 ? undefined : 1,
							},
						}}
						config={commonConfig}
					/>
					<Plot
						useResizeHandler
						className="h-full w-full"
						data={sortedObjectTypes.map((ot) => ({
							type: "histogram",
							marker: { color: getRandomStringColor(ot), line: { width: 0.5 } },
							autobinx: false,
							opacity: 0.4,
							histnorm: "percent",
							name: ot,
							x: activityStats.data.num_evs_per_ot_type[ot],
						}))}
						layout={{
							...commonLayout,
							title: {
								text: "Number of Events per Object",
							},
							xaxis: {
								...commonLayout.xaxis,
								dtick: maxEvCount > 100 ? undefined : 1,
							},
						}}
						config={commonConfig}
					/>
				</div>
			)}
		</div>
	);
}

function EdgeDurationSheet({ edge }: { edge: OCDeclareArc }) {
	const backend = useBackend();
	const durationStats = useQuery({
		queryKey: ["ocel", "edge-durations", JSON.stringify(edge)],
		queryFn: () => backend["ocel/get-oc-declare-edge-statistics"](edge),
	});
	const { plotX, plotY, plotLabels, unit, hovertemplate } = useMemo(() => {
		if (!durationStats.data || durationStats.data.bin_centers_ms.length === 0) {
			return { plotX: [], plotY: [], plotLabels: [], unit: "Hours", hovertemplate: "" };
		}

		const maxDurationMs = Math.max(
			Math.abs(durationStats.data.min_ms),
			Math.abs(durationStats.data.max_ms),
		);

		const MINUTE_MS = 1000 * 60;
		const HOUR_MS = MINUTE_MS * 60;
		const DAY_MS = HOUR_MS * 24;
		const MONTH_MS = DAY_MS * 30;
		const YEAR_MS = MONTH_MS * 12;

		let unit = "Hours";
		let divisor = HOUR_MS;

		if (maxDurationMs < MINUTE_MS * 5) {
			unit = "Seconds";
			divisor = 1000;
		} else if (maxDurationMs < HOUR_MS * 3) {
			unit = "Minutes";
			divisor = MINUTE_MS;
		} else if (maxDurationMs < DAY_MS * 5) {
			unit = "Hours";
			divisor = HOUR_MS;
		} else if (maxDurationMs < MONTH_MS * 5) {
			unit = "Days";
			divisor = DAY_MS;
		} else if (maxDurationMs < YEAR_MS * 5) {
			unit = "Months";
			divisor = MONTH_MS;
		} else {
			unit = "Years";
			divisor = YEAR_MS;
		}

		const plotX = durationStats.data.bin_centers_ms.map((v) => v / divisor);
		const plotY = durationStats.data.percentages;
		const plotLabels = durationStats.data.bin_labels.map((label) => {
			const nums = label.match(/-?[\d.]+/g);
			if (nums && nums.length === 2) {
				return `[${(parseFloat(nums[0]) / divisor).toFixed(2)}, ${(parseFloat(nums[1]) / divisor).toFixed(2)})`;
			}
			return label;
		});
		const hovertemplate = `<b>Range:</b> %{customdata} ${unit}<br><b>Frequency:</b> %{y:.2f}%<extra></extra>`;

		return { plotX, plotY, plotLabels, unit, hovertemplate };
	}, [durationStats.data]);

	const commonLayout: Partial<Plotly.Layout> = {
		title: {
			text: "Distribution of Durations",
			x: 0,
		},
		font: {
			family: "system-ui, Inter, sans-serif",
			size: 12,
			color: "#555",
		},
		yaxis: {
			ticksuffix: "%",
			rangemode: "tozero",
			range: [0, null],
			// fixedrange: true,
		},
		xaxis: {
			// title: { text: `Duration (${unit})` },
			ticksuffix: ` ${unit}`,
		},
		bargap: 0,
		margin: {
			l: 40,
			r: 40,
			b: 60,
			t: 45,
			pad: 4,
		},
		hovermode: "x unified",
	};
	const commonConfig: Partial<Plotly.Config> = {
		responsive: true,
		displaylogo: false,
		displayModeBar: false,
	};

	const isReversed = plotX.length > 0 && plotX[plotX.length - 1] >= 0;

	return (
		<div className="w-full h-full">
			<DialogTitle asChild>
				<h2 className="font-semibold text-2xl">
					Time between <span className="bg-green-400/40 px-2 -mx-0.5 rounded-sm ">{edge.from}</span>{" "}
					and <span className="bg-orange-400/40 px-2 -mx-0.5 rounded-sm ">{edge.to}</span>
				</h2>
			</DialogTitle>
			{durationStats.isPending && <Spinner />}
			{durationStats.data !== undefined && (
				<div className="flex w-full h-full gap-x-4">
					<Plot
						useResizeHandler
						className="h-full w-full"
						data={[
							{
								type: "bar",
								x: plotX,
								y: plotY,
								customdata: plotLabels,
								hovertemplate: hovertemplate,
								name: "Duration",
								marker: {
									color: plotX,
									colorscale: "YlOrRd",
									reversescale: isReversed,
									colorbar: {
										orientation: "v",
										outlinewidth: 0,
										title: {
											text: unit,
											side: "right",
										},
									},
								},
							},
						]}
						layout={commonLayout}
						config={commonConfig}
					/>
				</div>
			)}
		</div>
	);
}
