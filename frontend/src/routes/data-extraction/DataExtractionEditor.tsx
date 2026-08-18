import {
	type BlueprintEditCallbacks,
	BlueprintGraph,
	type EditorBlueprint,
} from "@r4pm/components/extraction-blueprint";
import { useMemo } from "react";
import { R4pmIsland } from "@/components/r4pm/R4pmIsland";
import { useBackend, useInvalidateOcel } from "@/hooks";

/** OCPQ host for propel's `BlueprintGraph`: injects the backend callbacks and keeps connections
 *  outside the blueprint, exactly as the backend's API boundary does (`ExecuteExtractionRequest`
 *  takes `blueprint` and `connections` as two fields).
 *
 *  There is one OCEL loaded at a time on OCPQ's backend, so a run replaces it rather than minting
 *  a handle; `onRun`'s `ocelHandle` is therefore a fixed label, not an identifier to look up. */
export default function DataExtractionEditor({
	value,
	onChange,
	connections,
	onConnectionsChange,
}: {
	value: EditorBlueprint;
	onChange: (next: EditorBlueprint) => void;
	connections: Record<string, string>;
	onConnectionsChange: (next: Record<string, string>) => void;
}) {
	const backend = useBackend();
	const invalidateOcel = useInvalidateOcel();

	const callbacks = useMemo<BlueprintEditCallbacks>(
		() => ({
			// Which kinds this build can actually open. Without it every kind the picker knows about
			// is offered, and a source the backend cannot connect to only fails once the user has
			// filled the form in. OCPQ discovers through `extraction_dbcon_bindings`, so it reaches
			// exactly what its `extraction-dbcon*` features enable: csv, sqlite, parquet, xlsx and
			// postgres. DuckDB has a dbcon backend but needs `extraction-dbcon-duckdb`, which links
			// a native library and is not enabled on any OCPQ target.
			connectionKindAvailability: { duckdb: "not enabled in this build" },
			onValidate: (blueprint, catalog) => backend["data-extraction/validate"](blueprint, catalog),
			onDiscoverCatalog: (conns) => backend["data-extraction/discover-catalog"](conns),
			onColumnDomain: (conns, sourceId, table, column) =>
				backend["data-extraction/column-domain"](conns, sourceId, table, column),
			// Native "Browse..." for file-backed sources (sqlite/csv/parquet/xlsx)
			onPickFile: backend["pick-file"]
				? async (extensions) => {
						const path = await backend["pick-file"]!(
							extensions.length ? [{ name: "Data source", extensions }] : undefined,
						);
						return path ?? undefined;
					}
				: undefined,
			onRun: async (blueprint, conns) => {
				const { report } = await backend["data-extraction/execute"](blueprint, conns);
				// The run replaced the backend's loaded OCEL; drop every cached view of the old one.
				await invalidateOcel();
				return { ocelHandle: "loaded OCEL", report };
			},
		}),
		[backend, invalidateOcel],
	);

	return (
		<R4pmIsland className="w-full h-full">
			<BlueprintGraph
				value={value}
				onChange={onChange}
				connections={connections}
				onConnectionsChange={onConnectionsChange}
				callbacks={callbacks}
			/>
		</R4pmIsland>
	);
}
