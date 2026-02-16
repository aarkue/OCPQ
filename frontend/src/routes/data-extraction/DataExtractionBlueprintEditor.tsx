import { useContext, useState } from "react";
import toast from "react-hot-toast";
import { IoArrowBack } from "react-icons/io5";
import { LuDatabase, LuPencil, LuRefreshCw, LuTable2, LuWorkflow } from "react-icons/lu";
import { TbPlug, TbPlugOff, TbTrash } from "react-icons/tb";
import { Link, useParams } from "react-router-dom";
import { v4 } from "uuid";
import { BackendProviderContext } from "@/BackendProviderContext";
import AlertHelper from "@/components/AlertHelper";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBackend } from "@/hooks";
import {
	DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA,
	DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_META,
	parseLocalStorageValue,
} from "@/lib/local-storage";
import type { DataSourceMetadata } from "@/types/generated/DataSourceMetadata";
import type { DataSourceTableInfo } from "@/types/generated/DataSourceTableInfo";
import type {
	DataExtractionBlueprintData,
	DataExtractionBlueprintMeta,
	DataSource,
	DataSourceType,
} from "./data-extraction-types";
import type { BlueprintFlowState } from "./flow/blueprint-flow-types";
import DataBlueprintFlowEditor from "./flow/DataBlueprintFlowEditor";

const DATA_SOURCE_TYPES: { value: DataSourceType; label: string }[] = [
	{ value: "sqlite", label: "SQLite" },
	{ value: "csv", label: "CSV" },
	// MySQL is currently not supported
	// { value: "mysql", label: "MySQL" },
	{ value: "postgresql", label: "PostgreSQL" },
];

export default function DataExtractionBlueprintEditor() {
	const { id } = useParams();
	const backend = useBackend();
	const [activeTab, setActiveTab] = useState<"sources" | "blueprint">("sources");

	const allMeta = parseLocalStorageValue<DataExtractionBlueprintMeta[]>(
		localStorage.getItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_META) ?? "[]",
	);
	const metaIndex = allMeta.findIndex((x) => x.id === id);
	const [metaInfo, setMetaInfo] = useState(metaIndex !== -1 ? allMeta[metaIndex] : undefined);

	const [blueprintData, setBlueprintData] = useState<DataExtractionBlueprintData>(() => {
		const stored = localStorage.getItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA + id);
		if (stored) {
			return parseLocalStorageValue<DataExtractionBlueprintData>(stored);
		}
		return { sources: [] };
	});

	if (id == null || metaInfo === undefined) {
		return (
			<div className="text-left">
				<h2 className="font-black text-2xl text-red-500">Unknown Blueprint</h2>
				<p className="mt-2 mb-4">
					The requested blueprint does not exist. Maybe it was deleted?
					<br />
					Go back to see an overview over all existing blueprints.
				</p>
				<Link to="/data-extraction">
					<Button size="lg">Back</Button>
				</Link>
			</div>
		);
	}

	function updateMetaInfo(newMetaInfo: typeof metaInfo) {
		setMetaInfo(newMetaInfo);
		if (newMetaInfo && metaIndex !== -1) {
			allMeta[metaIndex] = newMetaInfo;
			localStorage.setItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_META, JSON.stringify(allMeta));
		}
	}

	function saveBlueprintData(data: DataExtractionBlueprintData) {
		setBlueprintData(data);
		localStorage.setItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA + id, JSON.stringify(data));
	}

	async function connectDataSource(source: DataSource): Promise<DataSource> {
		const connectionString =
			source.configMode === "connection-string"
				? (source.connectionString ?? "")
				: structuredToConnectionString(source);

		try {
			const metadata = await backend["data-source/connect"]({
				name: source.name,
				connectionString,
			});

			return {
				...source,
				cachedMetadata: metadata,
				connectionStatus: {
					status: "connected",
					lastConnected: new Date().toISOString(),
				},
			};
		} catch (err) {
			return {
				...source,
				connectionStatus: {
					status: "error",
					error: err instanceof Error ? err.message : String(err),
					lastAttempt: new Date().toISOString(),
				},
			};
		}
	}

	async function addSource(source: DataSource) {
		// Connect immediately when adding
		const connectedSource = await toast.promise(
			new Promise<DataSource>((resolve, reject) =>
				connectDataSource(source).then((result) => {
					if (result.connectionStatus?.status !== "connected") {
						if (result.connectionStatus?.status === "error") {
							reject(result.connectionStatus.error);
						}
						reject("Unknown error");
					}
					resolve(result);
				}),
			),
			{
				loading: "Connecting...",
				error: (e) => `Failed to connect!\n${String(e)}`,
				success: "Connected!",
			},
		);
		saveBlueprintData({
			...blueprintData,
			sources: [...blueprintData.sources, connectedSource],
		});
	}

	async function updateSource(sourceId: string, updates: Partial<DataSource>) {
		const existingSource = blueprintData.sources.find((s) => s.id === sourceId);

		if (!existingSource) return;

		const updatedSource = { ...existingSource, ...updates };

		// Check if connection-relevant fields changed
		const connectionFieldsChanged =
			updates.connectionString !== undefined ||
			updates.config !== undefined ||
			updates.configMode !== undefined ||
			updates.type !== undefined;

		if (connectionFieldsChanged) {
			// Reconnect with new settings
			const connectedSource = await connectDataSource(updatedSource);
			saveBlueprintData({
				...blueprintData,
				sources: blueprintData.sources.map((s) => (s.id === sourceId ? connectedSource : s)),
			});
		} else {
			saveBlueprintData({
				...blueprintData,
				sources: blueprintData.sources.map((s) => (s.id === sourceId ? updatedSource : s)),
			});
		}
	}

	async function refetchSource(sourceId: string) {
		const source = blueprintData.sources.find((s) => s.id === sourceId);
		if (!source) return;

		// Set connecting status first
		saveBlueprintData({
			...blueprintData,
			sources: blueprintData.sources.map((s) =>
				s.id === sourceId ? { ...s, connectionStatus: { status: "connecting" as const } } : s,
			),
		});

		const connectedSource = await connectDataSource(source);
		saveBlueprintData({
			...blueprintData,
			sources: blueprintData.sources.map((s) => (s.id === sourceId ? connectedSource : s)),
		});
	}

	function deleteSource(sourceId: string) {
		saveBlueprintData({
			...blueprintData,
			sources: blueprintData.sources.filter((s) => s.id !== sourceId),
		});
	}

	const connectedSourcesCount = blueprintData.sources.filter(
		(s) => s.cachedMetadata && Object.keys(s.cachedMetadata.tables).length > 0,
	).length;

	return (
		<div className="text-left w-full h-full flex flex-col">
			<div className="flex items-center gap-x-4">
				<Link to="/data-extraction">
					<Button title="Back to overview" size="icon" variant="outline">
						<IoArrowBack />
					</Button>
				</Link>
				<div>
					<h2 className="font-bold text-xl">Data Extraction Blueprint</h2>
					<div className="flex items-center gap-x-1">
						<h1 className="font-black text-2xl text-sky-600">{metaInfo.name}</h1>
						<AlertHelper
							trigger={
								<Button size="icon" variant="ghost">
									<LuPencil />
								</Button>
							}
							initialData={{ ...metaInfo }}
							title="Edit Blueprint"
							content={({ data, setData, close }) => (
								<div className="flex flex-col gap-2">
									<div>
										<Label>Name</Label>
										<Input
											value={data.name}
											autoFocus
											onKeyDown={(ev) => {
												if (ev.key === "Enter") {
													updateMetaInfo(data);
													close();
												}
											}}
											onChange={(ev) => setData({ ...data, name: ev.currentTarget.value })}
										/>
									</div>
									<div>
										<Label>Description</Label>
										<Input
											value={data.description ?? ""}
											onChange={(ev) =>
												setData({
													...data,
													description: ev.currentTarget.value,
												})
											}
										/>
									</div>
								</div>
							)}
							submitAction={<>Save</>}
							onSubmit={updateMetaInfo}
						/>
					</div>
				</div>
			</div>

			<Tabs
				value={activeTab}
				onValueChange={(v) => setActiveTab(v as "sources" | "blueprint")}
				className="mt-4 flex-1 flex flex-col overflow-hidden"
			>
				<TabsList className="w-fit">
					<TabsTrigger value="sources" className="gap-1">
						<LuDatabase className="w-4 h-4" />
						Data Sources
						{blueprintData.sources.length > 0 && (
							<span className="ml-1 text-xs bg-slate-200 px-1.5 rounded">
								{blueprintData.sources.length}
							</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="blueprint" className="gap-1">
						<LuWorkflow className="w-4 h-4" />
						Blueprint Editor
					</TabsTrigger>
				</TabsList>

				<TabsContent value="sources" className="flex-1 overflow-auto mt-4">
					<section>
						<div className="flex items-center justify-between mb-2">
							<h3 className="font-bold text-lg">Data Sources</h3>
							<AlertHelper
								trigger={<Button size="sm">Add Source</Button>}
								initialData={
									{
										id: v4(),
										type: "csv",
										name: `Source ${blueprintData.sources.length + 1}`,
										configMode: "structured",
										connectionString: "",
										config: {},
									} as DataSource
								}
								title="Add Data Source"
								content={({ data, setData }) => (
									<DataSourceEditForm data={data} setData={setData} />
								)}
								mode="promise"
								submitAction={<>Add &amp; Connect</>}
								onSubmit={addSource}
							/>
						</div>
						{blueprintData.sources.length === 0 && (
							<p className="text-sm text-muted-foreground">
								No data sources configured. Add a source to get started.
							</p>
						)}
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
							{blueprintData.sources.map((source) => (
								<DataSourceCard
									key={source.id}
									source={source}
									onEdit={(updates) => updateSource(source.id, updates)}
									onDelete={() => deleteSource(source.id)}
									onRefetch={() => refetchSource(source.id)}
								/>
							))}
						</div>
					</section>
				</TabsContent>

				<TabsContent value="blueprint" className="flex-1 overflow-hidden mt-0 flex h-full">
					{connectedSourcesCount === 0 && (
						<div className="flex flex-col items-center justify-center h-full text-center p-8">
							<LuDatabase className="w-12 h-12 text-slate-300 mb-4" />
							<h3 className="font-semibold text-lg text-slate-600">No connected data sources</h3>
							<p className="text-sm text-muted-foreground mt-1 max-w-md">
								Add at least one data source in the "Data Sources" tab to start building your
								blueprint.
							</p>
							<Button className="mt-4" onClick={() => setActiveTab("sources")}>
								Go to Data Sources
							</Button>
						</div>
					)}
					{connectedSourcesCount > 0 && (
						<DataBlueprintFlowEditor
							sources={blueprintData.sources}
							initialState={blueprintData.flowState as BlueprintFlowState | undefined}
							onChange={(flowState) => {
								saveBlueprintData({
									...blueprintData,
									flowState,
								});
							}}
						/>
					)}
				</TabsContent>
			</Tabs>
		</div>
	);
}

function DataSourceCard({
	source,
	onEdit,
	onDelete,
	onRefetch,
}: {
	source: DataSource;
	onEdit: (updates: Partial<DataSource>) => void;
	onDelete: () => void;
	onRefetch: () => void;
}) {
	const status = source.connectionStatus?.status ?? "idle";
	const isConnecting = status === "connecting";
	const hasError = status === "error";
	const tableCount = source.cachedMetadata ? Object.keys(source.cachedMetadata.tables).length : 0;

	return (
		<div className="border rounded-lg bg-slate-50 overflow-hidden">
			{/* Header */}
			<div className="p-3 border-b bg-white">
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<LuDatabase className="w-4 h-4 text-slate-500 shrink-0" />
							<h4 className="font-semibold text-sm truncate">{source.name}</h4>
						</div>
						<div className="flex items-center gap-2 mt-1">
							<span className="text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
								{DATA_SOURCE_TYPES.find((t) => t.value === source.type)?.label ?? source.type}
							</span>
							<ConnectionStatusBadge status={source.connectionStatus} />
						</div>
					</div>
					<div className="flex gap-1 shrink-0">
						<Button
							size="icon"
							variant="ghost"
							title="Refresh connection"
							onClick={onRefetch}
							disabled={isConnecting}
						>
							<LuRefreshCw className={`w-4 h-4 ${isConnecting ? "animate-spin" : ""}`} />
						</Button>
						<AlertHelper
							trigger={
								<Button size="icon" variant="ghost" title="Edit source">
									<LuPencil className="w-4 h-4" />
								</Button>
							}
							initialData={{ ...source }}
							title={`Edit: ${source.name}`}
							content={({ data, setData }) => <DataSourceEditForm data={data} setData={setData} />}
							submitAction={<>Save &amp; Reconnect</>}
							onSubmit={(data) => onEdit(data)}
						/>
						<Button
							size="icon"
							variant="ghost"
							className="text-red-600 hover:text-red-800"
							onClick={onDelete}
							title="Delete source"
						>
							<TbTrash className="w-4 h-4" />
						</Button>
					</div>
				</div>
				<p className="text-xs text-muted-foreground mt-1 break-all">{getSourceSummary(source)}</p>
			</div>

			{/* Tables section */}
			{source.cachedMetadata && tableCount > 0 && (
				<div className="p-2">
					<div className="flex items-center justify-between mb-1">
						<span className="text-xs font-medium text-slate-600">
							{tableCount} table{tableCount !== 1 ? "s" : ""} found
						</span>
						<TablePreviewDialog metadata={source.cachedMetadata} />
					</div>
					<div className="flex flex-wrap gap-1">
						{Object.keys(source.cachedMetadata.tables)
							.slice(0, 5)
							.map((tableName) => (
								<span
									key={tableName}
									className="text-xs px-1.5 py-0.5 bg-slate-200 rounded truncate max-w-[120px]"
									title={tableName}
								>
									{tableName}
								</span>
							))}
						{tableCount > 5 && (
							<span className="text-xs px-1.5 py-0.5 bg-slate-300 rounded">
								+{tableCount - 5} more
							</span>
						)}
					</div>
				</div>
			)}

			{/* Error message */}
			{hasError && source.connectionStatus?.status === "error" && (
				<div className="p-2 bg-red-50 border-t border-red-200">
					<p className="text-xs text-red-600 break-all">{source.connectionStatus.error}</p>
				</div>
			)}

			{/* Idle/no data state */}
			{!source.cachedMetadata && !hasError && !isConnecting && (
				<div className="p-2 text-center">
					<p className="text-xs text-muted-foreground">No schema data. Click refresh to connect.</p>
				</div>
			)}
		</div>
	);
}

function ConnectionStatusBadge({ status }: { status: DataSource["connectionStatus"] }) {
	if (!status || status.status === "idle") {
		return (
			<span className="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 flex items-center gap-1">
				<TbPlugOff className="w-3 h-3" />
				Not connected
			</span>
		);
	}

	if (status.status === "connecting") {
		return (
			<span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 flex items-center gap-1">
				<LuRefreshCw className="w-3 h-3 animate-spin" />
				Connecting...
			</span>
		);
	}

	if (status.status === "connected") {
		return (
			<span
				className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 flex items-center gap-1"
				title={`Last connected: ${new Date(status.lastConnected).toLocaleString()}`}
			>
				<TbPlug className="w-3 h-3" />
				Connected
			</span>
		);
	}

	if (status.status === "error") {
		return (
			<span
				className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 flex items-center gap-1"
				title={status.error}
			>
				<TbPlugOff className="w-3 h-3" />
				Error
			</span>
		);
	}

	return null;
}

function TablePreviewDialog({ metadata }: { metadata: DataSourceMetadata }) {
	const tables = Object.entries(metadata.tables);

	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline" className="h-6 text-xs">
					<LuTable2 className="w-3 h-3 mr-1" />
					View Tables
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle>Tables in {metadata.name}</DialogTitle>
				</DialogHeader>
				<div className="overflow-auto pr-2">
					{tables.map(([tableName, tableInfo]) => (
						<div className="gap-2 text-left border my-2 mx-1 p-2 rounded" key={tableName}>
							<div className="flex items-center gap-2">
								<LuTable2 className="w-4 h-4 text-slate-500" />
								<span className="font-medium">{tableName}</span>
								<span className="text-xs text-muted-foreground">
									({Object.keys(tableInfo.columns).length} columns)
								</span>
							</div>
							<TableInfoDisplay
								tableInfo={tableInfo}
								previewData={metadata.previewData[tableName]}
							/>
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function TableInfoDisplay({
	tableInfo,
	previewData,
}: {
	tableInfo: DataSourceTableInfo;
	previewData?: Array<Record<string, string>>;
}) {
	const [showPreview, setShowPreview] = useState(false);
	const columns = Object.entries(tableInfo.columns);

	return (
		<div className="space-y-3">
			{/* Columns */}
			<div>
				<h5 className="text-xs font-semibold text-slate-600 mb-1">Columns</h5>
				<div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
					{columns.map(([colName, colInfo]) => (
						<div
							key={colName}
							className="text-xs p-1.5 bg-slate-100 rounded flex items-center justify-between gap-1"
							title={`Type: ${colInfo.colType}${colInfo.isNullable ? " (nullable)" : ""}`}
						>
							<span className="truncate font-medium">{colName}</span>
							<span className="text-slate-500 shrink-0">{colInfo.colType}</span>
						</div>
					))}
				</div>
			</div>

			{/* Keys */}
			{(tableInfo.primaryKeys.length > 0 || tableInfo.foreignKeys.length > 0) && (
				<div className="flex gap-4 text-xs">
					{tableInfo.primaryKeys.length > 0 && (
						<div>
							<span className="font-semibold text-slate-600">Primary Keys: </span>
							{tableInfo.primaryKeys.map((pk) => pk.columns.join(", ")).join("; ")}
						</div>
					)}
					{tableInfo.foreignKeys.length > 0 && (
						<div>
							<span className="font-semibold text-slate-600">Foreign Keys: </span>
							{tableInfo.foreignKeys
								.map(
									(fk) => `${fk.fromColumns.join(",")} → ${fk.toTable}.${fk.toColumns.join("|")}`,
								)
								.join("; ")}
						</div>
					)}
				</div>
			)}

			{/* Preview data toggle */}
			{previewData && previewData.length > 0 && (
				<div>
					<Button
						size="sm"
						variant="outline"
						className="h-6 text-xs"
						onClick={() => setShowPreview(!showPreview)}
					>
						{showPreview ? "Hide" : "Show"} Preview ({previewData.length} rows)
					</Button>
					{showPreview && (
						<div className="mt-2 overflow-auto max-h-48 border rounded">
							<table className="w-full text-xs">
								<thead className="bg-slate-100 sticky top-0">
									<tr>
										{columns.map(([colName]) => (
											<th key={colName} className="px-2 py-1 text-left font-medium border-b">
												{colName}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{previewData.map((row, rowIndex) => (
										<tr
											key={`row-${rowIndex}-${Object.values(row).join("-").slice(0, 50)}`}
											className="border-b last:border-0"
										>
											{columns.map(([colName]) => (
												<td
													key={colName}
													className="px-2 py-1 truncate max-w-[150px]"
													title={row[colName] ?? ""}
												>
													{row[colName] ?? <span className="text-slate-400">NULL</span>}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function getSourceSummary(source: DataSource): string {
	if (source.configMode === "connection-string") {
		return source.connectionString || "(not configured)";
	}
	if (source.type === "csv" || source.type === "sqlite") {
		return source.config.path || "(not configured)";
	}
	const host = source.config.host || "localhost";
	const port = source.config.port;
	const db = source.config.database;
	return db ? `${host}${port ? `:${port}` : ""}/${db}` : "(not configured)";
}

function structuredToConnectionString(data: DataSource): string {
	const { type, config } = data;
	if (type === "csv" || type === "sqlite") {
		const path = config.path ?? "";
		const prefix = type === "csv" ? "csv://" : "sqlite://";
		return path.startsWith(prefix) ? path : `${prefix}${path}`;
	}
	const scheme = type === "postgresql" ? "postgres" : "mysql";
	const { user = "", password = "", host = "localhost", port = "", database = "" } = config;
	const auth = user ? (password ? `${user}:${password}@` : `${user}@`) : "";
	const portPart = port ? `:${port}` : "";
	return `${scheme}://${auth}${host}${portPart}/${database}`;
}

function connectionStringToStructured(data: DataSource): Record<string, string> {
	const cs = data.connectionString ?? "";
	if (data.type === "csv" || data.type === "sqlite") {
		const path = cs.replace(/^(csv|sqlite):\/\/\/?/, "");
		return { ...data.config, path };
	}
	try {
		const url = new URL(cs);
		return {
			...data.config,
			host: url.hostname || "",
			port: url.port || "",
			database: url.pathname.replace(/^\//, ""),
			user: decodeURIComponent(url.username || ""),
			password: decodeURIComponent(url.password || ""),
		};
	} catch {
		return data.config;
	}
}

function DataSourceEditForm({
	data,
	setData,
}: {
	data: DataSource;
	setData: (d: DataSource) => void;
}) {
	const isFile = data.type === "csv" || data.type === "sqlite";
	const isDb = data.type === "mysql" || data.type === "postgresql";

	const switchMode = (mode: DataSource["configMode"]) => {
		if (mode === data.configMode) return;
		setData({
			...data,
			configMode: mode,
			...(mode === "connection-string"
				? { connectionString: structuredToConnectionString(data) }
				: { config: connectionStringToStructured(data) }),
		});
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="grid grid-cols-[auto_1fr] gap-3 items-center">
				<Label>Name</Label>
				<Input value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} />
				<Label>Type</Label>
				<Select
					value={data.type}
					onValueChange={(v) => setData({ ...data, type: v as DataSourceType })}
				>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{DATA_SOURCE_TYPES.map((t) => (
							<SelectItem key={t.value} value={t.value}>
								{t.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<Tabs
				value={data.configMode ?? "connection-string"}
				onValueChange={(s) => switchMode(s as DataSource["configMode"])}
			>
				<TabsList className="w-full">
					<TabsTrigger value="connection-string" className="flex-1">
						Connection String
					</TabsTrigger>
					<TabsTrigger value="structured" className="flex-1">
						Structured
					</TabsTrigger>
				</TabsList>
			</Tabs>

			{data.configMode === "connection-string" && (
				<div>
					<Label className="text-xs text-muted-foreground mb-1 block">
						{isFile ? "File path or URI" : "Connection string"}
					</Label>
					<Input
						placeholder={
							data.type === "csv"
								? "/path/to/data.csv"
								: data.type === "sqlite"
									? "/path/to/database.sqlite"
									: data.type === "postgresql"
										? "postgres://user:pw@localhost:5432/db"
										: "mysql://user:pw@localhost:3306/db"
						}
						value={data.connectionString ?? ""}
						onChange={(e) => setData({ ...data, connectionString: e.target.value })}
					/>
				</div>
			)}

			{data.configMode === "structured" && (
				<div className="grid grid-cols-[auto_1fr] gap-3 items-center">
					{isFile && (
						<>
							<Label>File Path</Label>
							<Input
								placeholder={data.type === "csv" ? "/path/to/data.csv" : "/path/to/database.sqlite"}
								value={data.config.path ?? ""}
								onChange={(e) =>
									setData({
										...data,
										config: { ...data.config, path: e.target.value },
									})
								}
							/>
						</>
					)}
					{data.type === "csv" && (
						<>
							<Label>Delimiter</Label>
							<Input
								placeholder=","
								className="max-w-16"
								value={data.config.delimiter ?? ""}
								onChange={(e) =>
									setData({
										...data,
										config: { ...data.config, delimiter: e.target.value },
									})
								}
							/>
						</>
					)}
					{isDb && (
						<>
							<Label>Host</Label>
							<Input
								placeholder="localhost"
								value={data.config.host ?? ""}
								onChange={(e) =>
									setData({
										...data,
										config: { ...data.config, host: e.target.value },
									})
								}
							/>
							<Label>Port</Label>
							<Input
								placeholder={data.type === "mysql" ? "3306" : "5432"}
								className="max-w-32"
								value={data.config.port ?? ""}
								onChange={(e) =>
									setData({
										...data,
										config: { ...data.config, port: e.target.value },
									})
								}
							/>
							<Label>Database</Label>
							<Input
								placeholder="my_database"
								value={data.config.database ?? ""}
								onChange={(e) =>
									setData({
										...data,
										config: { ...data.config, database: e.target.value },
									})
								}
							/>
							<Label>User</Label>
							<Input
								placeholder="user"
								value={data.config.user ?? ""}
								onChange={(e) =>
									setData({
										...data,
										config: { ...data.config, user: e.target.value },
									})
								}
							/>
							<Label>Password</Label>
							<Input
								type="password"
								placeholder="password"
								value={data.config.password ?? ""}
								onChange={(e) =>
									setData({
										...data,
										config: { ...data.config, password: e.target.value },
									})
								}
							/>
						</>
					)}
				</div>
			)}
		</div>
	);
}
