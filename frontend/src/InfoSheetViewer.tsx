import { useContext, useMemo } from "react";
import { InfoSheetContext } from "./InfoSheet";
import { Sheet, SheetContent } from "./components/ui/sheet";
import { BackendProviderContext } from "./BackendProviderContext";
import { useQuery } from "@tanstack/react-query";
import Spinner from "./components/Spinner";

export default function InfoSheetViewer() {
  const { infoSheetState, setInfoSheetState } = useContext(InfoSheetContext);
  if (infoSheetState === undefined) {
    return null;
  }
  return <Sheet
    open={true}
    // open={elInfo !== undefined}
    onOpenChange={(o) => { if (!o) { setInfoSheetState(undefined) } }}
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
      {infoSheetState.type === "activity-frequencies" &&
        <ActivityFrequenciesSheet activity={infoSheetState.activity} />}
      {infoSheetState.type === "edge-duration-statistics" && <EdgeDurationSheet edge={infoSheetState.edge} />}

    </SheetContent>
  </Sheet>
}

import Plot, { PlotParams } from "react-plotly.js";
import { OCDeclareArc } from "./routes/oc-declare/types/OCDeclareArc";

const PLOT_COLORS = [
  '#636EFA', // Plotly blue
  '#EF553B', // Plotly orange
  '#00CC96', // Plotly green
  '#AB63FA', // Plotly purple
  '#FFA15A', // Plotly light orange
  '#19D3F3', // Plotly cyan
];
function ActivityFrequenciesSheet({ activity }: { activity: string }) {
  const backend = useContext(BackendProviderContext);
  const activityStats = useQuery({ queryKey: ["ocel", "activity-stats", activity], queryFn: () => backend["ocel/get-activity-statistics"](activity) });
  const sortedObjectTypes = useMemo(() => {
    const ots = Object.keys(activityStats.data?.num_evs_per_ot_type ?? {});
    ots.sort();
    return ots
  }, [activityStats.data])
  const maxObCount = useMemo(() => {
    return Math.max(...Object.values(activityStats.data?.num_obs_of_ot_per_ev ?? {}).flat())

  }, [activityStats.data]);

  const maxEvCount = useMemo(() => {
    return Math.max(...Object.values(activityStats.data?.num_evs_per_ot_type ?? {}).flat())

  }, [activityStats.data]);
  const commonLayout: Partial<Plotly.Layout> =
  {
    font: {
      family: 'system-ui, Inter, sans-serif',
      size: 12,
      color: '#555'
    },
    yaxis: {
      ticksuffix: '%',
      rangemode: 'tozero',
      range: [0, 100],
    },
    xaxis: {
      range: [0, null],
      rangemode: "tozero",
      // dtick: 1,
      // autorange: false,
      // autorange: "max",
    },
    barmode: 'overlay',
    legend: {
      orientation: 'h',
      yanchor: 'bottom',
      y: 0.9,
      xanchor: 'right',
      x: 1,
      bgcolor: 'rgba(255, 255, 255, 0.8)',
      bordercolor: '#fafafa',
      borderwidth: 1,
    },
    margin: {
      l: 40,
      r: 0,
      b: 55,
      t: 45,
      pad: 4
    },
    hovermode: 'x',
  };
  const commonConfig: Partial<Plotly.Config> = { responsive: true, displaylogo: false, displayModeBar: false };
  return <div className="w-full h-full">
    <h2 className="font-semibold text-2xl">Statistics for <span className="bg-gray-400/40 px-2 -mx-0.5 rounded-sm ">{activity}</span></h2>
    {activityStats.isLoading && <Spinner />}
    {activityStats.data !== undefined && <>
      <div className="flex w-full h-full gap-x-4">
        <Plot useResizeHandler className="h-full w-full"
          data={sortedObjectTypes.map((ot, index) =>
          ({
            type: "histogram", marker: { color: PLOT_COLORS[index % PLOT_COLORS.length], line: { width: 0.5 } },
            opacity: 0.4, histnorm: "percent", name: ot, x: activityStats.data.num_obs_of_ot_per_ev[ot]
          }))}
          layout={{
            ...commonLayout,
            title: {
              text: 'Number of Objects per Event',
            },
            xaxis: {
              ...commonLayout.xaxis,
              dtick: maxObCount > 100 ? undefined : 1,
            }
          }}
          config={commonConfig}
        />
        <Plot useResizeHandler className="h-full w-full"
          data={sortedObjectTypes.map((ot, index) => ({
            type: "histogram", marker: { color: PLOT_COLORS[index % PLOT_COLORS.length], line: { width: 0.5 } }, autobinx: false,
            opacity: 0.4, histnorm: "percent", name: ot, x: activityStats.data.num_evs_per_ot_type[ot]
          }))}
          layout={{
            ...commonLayout,
            title: {
              text: 'Number of Events per Object',
            },
            xaxis: {
              ...commonLayout.xaxis,
              dtick: maxEvCount > 100 ? undefined : 1,
            }
          }}
          config={commonConfig}
        />
      </div>
    </>}
  </div>
}


function binData(data: number[], targetBinCount: number = 25) {
  if (data.length === 0) {
    return { x: [], y: [], binEdges: [] };
  }

  const dataMin = Math.min(...data);
  const dataMax = Math.max(...data);

  if (dataMin === dataMax) {
    const range = Math.abs(dataMin * 0.1) || 0.5;
    return {
      x: [dataMin],
      y: [100],
      binEdges: [`[${(dataMin - range).toFixed(2)}, ${(dataMin + range).toFixed(2)})`]
    };
  }

  const dataRange = dataMax - dataMin;
  const roughBinSize = dataRange / targetBinCount;

  const exponent = Math.floor(Math.log10(roughBinSize));
  const powerOf10 = Math.pow(10, exponent);
  const mantissa = roughBinSize / powerOf10;

  let niceMantissa;
  if (mantissa < 1.5) {
    niceMantissa = 1;
  } else if (mantissa < 3) {
    niceMantissa = 2;
  } else if (mantissa < 7) {
    niceMantissa = 5;
  } else {
    niceMantissa = 10;
  }

  const binSize = niceMantissa * powerOf10;

  const chartMin = Math.floor(dataMin / binSize) * binSize;
  const chartMax = Math.ceil(dataMax / binSize) * binSize;

  const epsilon = binSize * 0.001;
  const binCount = Math.max(1, Math.round((chartMax - chartMin) / binSize));
  const bins = new Array(binCount).fill(0);
  const totalPoints = data.length;

  for (const val of data) {
    if (val >= chartMax - epsilon) {
      bins[binCount - 1]++;
    } else {
      const binIndex = Math.floor((val - chartMin) / binSize);
      if (binIndex >= 0 && binIndex < binCount) {
        bins[binIndex]++;
      }
    }
  }

  const x: number[] = [];
  const y: number[] = [];
  const binEdges: string[] = [];
  const precision = Math.max(0, -exponent);

  for (let i = 0; i < binCount; i++) {
    const binStart = chartMin + i * binSize;
    const binEnd = binStart + binSize;

    if (bins[i] > 0) {
      x.push(binStart + binSize / 2);
      y.push((bins[i] / totalPoints) * 100);
      binEdges.push(`[${binStart.toFixed(precision)}, ${binEnd.toFixed(precision)})`);
    }
  }

  return { x, y, binEdges };
}


function EdgeDurationSheet({ edge }: { edge: OCDeclareArc }) {
  const backend = useContext(BackendProviderContext);
  const durationStats = useQuery({
    queryKey: ["ocel", "edge-durations", JSON.stringify(edge)],
    queryFn: () => backend["ocel/get-oc-declare-edge-statistics"](edge)
  });

  const { plotData, unit, hovertemplate } = useMemo(() => {
    if (!durationStats.data || durationStats.data.length === 0) {
      return { plotData: { x: [], y: [], binEdges: [] }, unit: 'Hours', hovertemplate: '' };
    }

    const maxDurationMs = Math.max(...durationStats.data.map(v => Math.abs(v)));
    let unit = 'Hours';
    let divisor = 1000 * 60 * 60;

    const MINUTE_MS = 1000 * 60;
    const HOUR_MS = MINUTE_MS * 60;
    const DAY_MS = HOUR_MS * 24;
    const MONTH_MS = DAY_MS * 30;
    const YEAR_MS = MONTH_MS * 12;

    if (maxDurationMs < MINUTE_MS * 5) {
      unit = 'Seconds';
      divisor = 1000;
    } else if (maxDurationMs < HOUR_MS * 3) {
      unit = 'Minutes';
      divisor = MINUTE_MS;
    } else if (maxDurationMs < DAY_MS * 5) {
      unit = 'Hours';
      divisor = HOUR_MS;
    } else if (maxDurationMs < MONTH_MS * 5) {
      unit = 'Days';
      divisor = DAY_MS;
    } else if (maxDurationMs < YEAR_MS * 5) {
      unit = 'Months';
      divisor = MONTH_MS;
    } else {
      unit = 'Years'
      divisor = YEAR_MS;
    }

    const scaledData = durationStats.data.map(v => v / divisor);
    const plotData = binData(scaledData, 25);
    const hovertemplate = `<b>Range:</b> %{customdata} ${unit}<br><b>Frequency:</b> %{y:.2f}%<extra></extra>`;

    return { plotData, unit, hovertemplate };
  }, [durationStats.data]);


  const commonLayout: Partial<Plotly.Layout> =
  {
    title: {
      text: 'Distribution of Durations',
      x: 0
    },
    font: {
      family: 'system-ui, Inter, sans-serif',
      size: 12,
      color: '#555'
    },
    yaxis: {
      ticksuffix: '%',
      rangemode: 'tozero',
      range: [0, null],
      // fixedrange: true,
    },
    xaxis: {
      // title: { text: `Duration (${unit})` },
      ticksuffix: ` ${unit}`
    },
    bargap: 0,
    margin: {
      l: 40,
      r: 40,
      b: 60,
      t: 45,
      pad: 4
    },
    hovermode: 'x unified',
  };
  const commonConfig: Partial<Plotly.Config> = { responsive: true, displaylogo: false, displayModeBar: false };

  const isReversed = plotData.x.length > 0 && plotData.x[plotData.x.length - 1] >= 0;

  return <div className="w-full h-full">
    <h2 className="font-semibold text-2xl">Time between <span className="bg-green-400/40 px-2 -mx-0.5 rounded-sm ">{edge.from}</span> and <span className="bg-orange-400/40 px-2 -mx-0.5 rounded-sm ">{edge.to}</span></h2>
    {durationStats.isLoading && <Spinner />}
    {durationStats.data !== undefined && <>
      <div className="flex w-full h-full gap-x-4">
        <Plot useResizeHandler className="h-full w-full"
          data={[{
            type: "bar",
            x: plotData.x,
            y: plotData.y,
            customdata: plotData.binEdges,
            hovertemplate: hovertemplate,
            name: "Duration",
            marker: {
              color: plotData.x,
              colorscale: 'YlOrRd',
              // showscale: true,
              reversescale: isReversed,
              colorbar: {
                orientation: 'v',
                outlinewidth: 0,
                title: {
                  text: unit,
                  side: 'right'
                }
              }
            }
          }]}
          layout={commonLayout}
          config={commonConfig}
        />
      </div>
    </>}
  </div>
}

