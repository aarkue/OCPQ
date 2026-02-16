import clsx from "clsx";
import { useState } from "react";
import { LuBox, LuCalendar, LuChevronDown, LuDatabase, LuHash, LuLink } from "react-icons/lu";
import { MdEvent, MdTableChart } from "react-icons/md";
import { TbRelationManyToMany } from "react-icons/tb";
import {
	CardTypeSelector,
	CardTypeSelectorContent,
	type CardTypeSelectorOption,
} from "@/components/ui/card-type-selector";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { DataSourceColumnInfo } from "@/types/generated/DataSourceColumnInfo";
import type { DataSourceTableInfo } from "@/types/generated/DataSourceTableInfo";
import { AttributeConfigEditor } from "./AttributeConfigEditor";
import {
	type AttributeConfig,
	type AttributeMapping,
	DEFAULT_VALUE_EXPR,
	getDefaultUsageDataForMode,
	type TableUsageData,
	type TableUsageType,
	type TimestampFormat,
	type TimestampSource,
	type ValueExpression,
} from "./blueprint-flow-types";
import { EventRulesEditor } from "./EventRulesEditor";
import { InlineObjectReferencesEditor } from "./InlineObjectReferencesEditor";

/** Handle legacy data that may have `attributes` instead of `attribute_config` */
function migrateAttributeConfig(data: Record<string, unknown>): AttributeConfig {
	if (data.attribute_config != null) return data.attribute_config as AttributeConfig;
	if (data.attributeConfig != null) return data.attributeConfig as AttributeConfig;
	if (Array.isArray(data.attributes))
		return { mode: "static", mappings: data.attributes as AttributeMapping[] };
	return { mode: "static", mappings: [] };
}

// ---- Card options for the mode selector ----
const TABLE_USAGE_OPTIONS: CardTypeSelectorOption<TableUsageType>[] = [
	{
		value: "none",
		title: "Unused",
		description: "This table will not be used in extraction",
		icon: <LuDatabase className="w-4 h-4 text-slate-400" />,
	},
	{
		value: "single-object",
		title: "Object (Single Type)",
		description: "Each row represents an object of one type",
		icon: <LuBox className="w-4 h-4 text-blue-500" />,
	},
	{
		value: "multi-object",
		title: "Object (Multi Type)",
		description: "Rows represent objects with type column",
		icon: <LuBox className="w-4 h-4 text-blue-500" />,
	},
	{
		value: "single-event",
		title: "Event (Single Type)",
		description: "Each row is an event of one type",
		icon: <MdEvent className="w-4 h-4 text-pink-500" />,
	},
	{
		value: "multi-event",
		title: "Event (Multi Type)",
		description: "Rows are events with type column",
		icon: <MdEvent className="w-4 h-4 text-pink-500" />,
	},
	{
		value: "e2o-relation",
		title: "E2O Relation",
		description: "Event-to-Object relationship table",
		icon: <TbRelationManyToMany className="w-4 h-4 text-purple-500" />,
	},
	{
		value: "o2o-relation",
		title: "O2O Relation",
		description: "Object-to-Object relationship table",
		icon: <TbRelationManyToMany className="w-4 h-4 text-indigo-500" />,
	},
	{
		value: "change-table-events",
		title: "Events (Change Table)",
		description: "Derive events from change rows via rules",
		icon: <MdTableChart className="w-4 h-4 text-orange-500" />,
	},
	{
		value: "change-table-object-changes",
		title: "Object Changes",
		description: "Track object attribute changes over time",
		icon: <MdTableChart className="w-4 h-4 text-teal-500" />,
	},
];

function ColumnSelectorItem({
	colName,
	colInfo,
	samples,
	isOptionalPlaceHolder = false,
}: {
	colName: string;
	colInfo: DataSourceColumnInfo;
	samples: string[];
	isOptionalPlaceHolder?: boolean;
}) {
	return (
		<div className="flex items-center gap-2 w-full">
			<ColumnTypeIcon type={colInfo.colType} />
			<div className="flex flex-col items-start w-full overflow-hidden">
				<span className={clsx("font-medium", isOptionalPlaceHolder && "text-slate-500")}>
					{colName}
				</span>
				<div className="flex items-center text-xs text-slate-400 w-full">
					{colInfo.colType}
					{samples.length > 0 && (
						<span className="ml-2 text-slate-500 text-left truncate w-full inline-block max-w-sm">
							e.g. {samples.slice(0, 2).join(", ")}
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

function ColumnTypeIcon({ type }: { type: string }) {
	const typeLower = type.toLowerCase();
	if (typeLower.includes("int") || typeLower.includes("numeric") || typeLower.includes("float")) {
		return <LuHash className="w-3.5 h-3.5 text-blue-400" />;
	}
	if (typeLower.includes("time") || typeLower.includes("date")) {
		return <LuCalendar className="w-3.5 h-3.5 text-orange-400" />;
	}
	if (typeLower.includes("uuid") || typeLower.includes("id")) {
		return <LuLink className="w-3.5 h-3.5 text-purple-400" />;
	}
	return <span className="w-3.5 h-3.5 text-[10px] text-slate-400 font-mono">Aa</span>;
}

type ColumnSelectorProps = {
	label?: string;
	value: string;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
	placeholder?: string;
	typeHint?: "id" | "timestamp" | "type" | "string";
	allowEmpty?: boolean;
} & (
	| { allowEmpty: true; onChange: (value: string | undefined) => void }
	| { allowEmpty?: false; onChange: (value: string) => void }
);

const SPECIAL_NONE_VALUE = "|@NONE-no-selection!";

function ColumnSelector({
	label,
	value,
	onChange,
	columns,
	previewData,
	allowEmpty,
	placeholder = `Select column${allowEmpty ? " (optional)" : ""}`,
	typeHint,
}: ColumnSelectorProps) {
	const columnEntries = Object.entries(columns);

	const sortedColumns = [...columnEntries].sort(([nameA, infoA], [nameB, infoB]) => {
		if (!typeHint) return 0;
		const scoreColumn = (name: string, info: DataSourceColumnInfo): number => {
			const nameLower = name.toLowerCase();
			const typeLower = info.colType.toLowerCase();
			if (typeHint === "id") {
				if (nameLower === "id" || nameLower.endsWith("_id")) return 3;
				if (nameLower.includes("id")) return 2;
				if (typeLower.includes("int") || typeLower.includes("uuid")) return 1;
			} else if (typeHint === "timestamp") {
				if (nameLower.includes("timestamp") || nameLower.includes("time")) return 3;
				if (nameLower.includes("date") || nameLower.includes("created")) return 2;
				if (typeLower.includes("time") || typeLower.includes("date")) return 1;
			} else if (typeHint === "type") {
				if (nameLower === "type" || nameLower.endsWith("_type")) return 3;
				if (nameLower.includes("type") || nameLower.includes("kind")) return 2;
				if (typeLower.includes("varchar") || typeLower.includes("text")) return 1;
			} else if (typeHint === "string") {
				if (typeLower.includes("char") || typeLower.includes("text")) return 1;
			}
			return 0;
		};
		return scoreColumn(nameB, infoB) - scoreColumn(nameA, infoA);
	});

	const getSampleValues = (colName: string): string[] => {
		if (!previewData || previewData.length === 0) return [];
		const values = previewData
			.slice(0, 3)
			.map((row) => row[colName])
			.filter((v) => v !== undefined && v !== null && v !== "");
		return [...new Set(values)];
	};

	return (
		<div className="space-y-1">
			{label && <Label className="font-medium text-slate-700">{label}</Label>}
			<Select
				value={value || undefined}
				onValueChange={(s) => {
					if (allowEmpty && s === SPECIAL_NONE_VALUE) {
						onChange(undefined);
					} else {
						onChange(s);
					}
				}}
			>
				<SelectTrigger className="w-full bg-white truncate h-12">
					<ColumnSelectorItem
						isOptionalPlaceHolder={allowEmpty && !value}
						colName={value || placeholder}
						colInfo={columns[value] || { colType: "" }}
						samples={getSampleValues(value)}
					/>
				</SelectTrigger>
				<SelectContent>
					{allowEmpty && (
						<SelectItem value={SPECIAL_NONE_VALUE} className="py-2">
							<span className="text-slate-500 italic">None</span>
						</SelectItem>
					)}
					{sortedColumns.map(([colName, colInfo]) => {
						const samples = getSampleValues(colName);
						return (
							<SelectItem key={colName} value={colName} className="py-2">
								<ColumnSelectorItem colName={colName} colInfo={colInfo} samples={samples} />
							</SelectItem>
						);
					})}
				</SelectContent>
			</Select>
		</div>
	);
}

function TextInputConfig({
	label,
	value,
	onChange,
	placeholder,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}) {
	return (
		<div className="space-y-2 flex flex-col">
			<Label className="font-medium text-slate-700">{label}</Label>
			<input
				className="w-full bg-white border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				placeholder={placeholder ?? "Enter text"}
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
		</div>
	);
}

const EXPR_TYPE_LABELS: Record<ValueExpression["type"], string> = {
	column: "Column",
	constant: "Constant",
	template: "Template",
};

function ValueExpressionEditor({
	label,
	value,
	onChange,
	columns,
	previewData,
	typeHint,
	allowEmpty,
}: {
	label: string;
	value: ValueExpression;
	onChange: (v: ValueExpression) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
	typeHint?: "id" | "timestamp" | "type" | "string";
	allowEmpty?: boolean;
}) {
	const exprType = value.type;

	const switchType = (newType: ValueExpression["type"]) => {
		if (newType === exprType) return;
		switch (newType) {
			case "column":
				onChange({ type: "column", column: "" });
				break;
			case "constant":
				onChange({ type: "constant", value: "" });
				break;
			case "template":
				onChange({
					type: "template",
					template:
						exprType === "column" && value.type === "column" && value.column
							? `{${value.column}}`
							: "",
				});
				break;
		}
	};

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between">
				<Label className="font-medium text-slate-700">{label}</Label>
				<div className="flex rounded-md border border-slate-200 text-[10px] overflow-hidden">
					{(["column", "template", "constant"] as const).map((t) => (
						<button
							key={t}
							type="button"
							onClick={() => switchType(t)}
							className={`px-1.5 py-0.5 transition-colors ${
								exprType === t
									? "bg-sky-500 text-white"
									: "bg-white text-slate-500 hover:bg-slate-50"
							}`}
						>
							{EXPR_TYPE_LABELS[t]}
						</button>
					))}
				</div>
			</div>

			{exprType === "column" && value.type === "column" && (
				<ColumnSelector
					value={value.column}
					onChange={(v: string | undefined) => onChange({ type: "column", column: v ?? "" })}
					columns={columns}
					previewData={previewData}
					typeHint={typeHint}
					allowEmpty={allowEmpty}
				/>
			)}

			{exprType === "constant" && value.type === "constant" && (
				<input
					className="w-full bg-white border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					placeholder="Constant value"
					value={value.value}
					onChange={(e) => onChange({ type: "constant", value: e.target.value })}
				/>
			)}

			{exprType === "template" && value.type === "template" && (
				<div className="space-y-1.5">
					<input
						className="w-full bg-white border border-slate-300 rounded px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						placeholder="e.g. ORD-{order_id}-{region}"
						value={value.template}
						onChange={(e) => onChange({ type: "template", template: e.target.value })}
					/>
					<div className="flex flex-wrap gap-1 max-h-20 overflow-auto">
						{Object.keys(columns).map((col) => (
							<button
								key={col}
								type="button"
								className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 font-mono"
								onClick={() =>
									onChange({
										type: "template",
										template: `${value.template}{${col}}`,
									})
								}
							>
								{`{${col}}`}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

const TIMESTAMP_FORMAT_LABELS: Record<TimestampFormat["type"], string> = {
	auto: "Auto-detect",
	"format-string": "Format string",
	"unix-seconds": "Unix (seconds)",
	"unix-millis": "Unix (milliseconds)",
};

function TimestampSourceEditor({
	label,
	value,
	onChange,
	columns,
	previewData,
}: {
	label: string;
	value: TimestampSource;
	onChange: (v: TimestampSource) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
}) {
	const [showFormat, setShowFormat] = useState(
		value.type === "column" && value.format.type !== "auto",
	);
	const isComponents = value.type === "components";

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between">
				<Label className="font-medium text-slate-700">{label}</Label>
				<div className="flex rounded-md border border-slate-200 text-[10px] overflow-hidden">
					<button
						type="button"
						onClick={() =>
							onChange({
								type: "column",
								column: "",
								format: { type: "auto" },
							})
						}
						className={`px-1.5 py-0.5 transition-colors ${
							!isComponents ? "bg-sky-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
						}`}
					>
						Datetime
					</button>
					<button
						type="button"
						onClick={() => onChange({ type: "components", date_column: null, time_column: null })}
						className={`px-1.5 py-0.5 transition-colors ${
							isComponents ? "bg-sky-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
						}`}
					>
						Date + Time
					</button>
				</div>
			</div>

			{!isComponents && value.type === "column" && (
				<>
					<ColumnSelector
						value={value.column}
						onChange={(v) => onChange({ type: "column", column: v, format: value.format })}
						columns={columns}
						previewData={previewData}
						typeHint="timestamp"
					/>
					<button
						type="button"
						className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700"
						onClick={() => setShowFormat((v) => !v)}
					>
						<LuChevronDown
							className={`w-3 h-3 transition-transform ${showFormat ? "rotate-180" : ""}`}
						/>
						Format options
					</button>
					{showFormat && (
						<div className="space-y-1.5 pl-2 border-l-2 border-slate-200">
							<Select
								value={value.format.type}
								onValueChange={(v) => {
									const ft = v as TimestampFormat["type"];
									const format: TimestampFormat =
										ft === "format-string"
											? { type: "format-string", format: "%Y-%m-%d %H:%M:%S" }
											: ({ type: ft } as TimestampFormat);
									onChange({ ...value, format });
								}}
							>
								<SelectTrigger className="w-full bg-white h-8 text-xs">
									{TIMESTAMP_FORMAT_LABELS[value.format.type]}
								</SelectTrigger>
								<SelectContent>
									{(
										Object.entries(TIMESTAMP_FORMAT_LABELS) as [TimestampFormat["type"], string][]
									).map(([k, label]) => (
										<SelectItem key={k} value={k} className="text-xs">
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{value.format.type === "format-string" && (
								<input
									className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
									placeholder="%Y-%m-%d %H:%M:%S"
									value={value.format.format}
									onChange={(e) =>
										onChange({
											...value,
											format: {
												type: "format-string",
												format: e.target.value,
											},
										})
									}
								/>
							)}
						</div>
					)}
				</>
			)}

			{isComponents && value.type === "components" && (
				<div className="grid grid-cols-2 gap-2">
					{(
						[
							["date_column", "Date"],
							["time_column", "Time"],
						] as const
					).map(([key, lbl]) => (
						<ColumnSelector
							key={key}
							label={lbl}
							value={(value[key] as string) ?? ""}
							onChange={(v) => onChange({ ...value, [key]: v })}
							columns={columns}
							previewData={previewData}
						/>
					))}
				</div>
			)}
		</div>
	);
}

interface TableUsageConfigProps {
	data: TableUsageData | undefined;
	setData: (data: TableUsageData) => void;
	tableInfo: DataSourceTableInfo;
	previewData?: Array<Record<string, string>>;
}

export function TableUsageConfig({ data, setData, tableInfo, previewData }: TableUsageConfigProps) {
	const currentMode = data?.mode ?? "none";
	const columns = tableInfo.columns;

	const handleModeChange = (mode: TableUsageType) => {
		setData(getDefaultUsageDataForMode(mode));
	};

	// Typed updater for ValueExpression fields
	const updateExpr = (field: string, expr: ValueExpression) => {
		if (!data) return;
		setData({ ...data, [field]: expr } as TableUsageData);
	};

	// Typed updater for TimestampSource fields
	const updateTimestamp = (field: string, ts: TimestampSource) => {
		if (!data) return;
		setData({ ...data, [field]: ts } as TableUsageData);
	};

	// Typed updater for plain string fields
	const updateString = (field: string, value: string) => {
		if (!data) return;
		setData({ ...data, [field]: value } as TableUsageData);
	};

	return (
		<div className="w-full min-w-[400px]">
			<CardTypeSelector
				options={TABLE_USAGE_OPTIONS}
				value={currentMode}
				onValueChange={handleModeChange}
				columns={3}
			>
				{/* ---- Unused ---- */}
				<CardTypeSelectorContent value="none">
					<p className="text-sm text-slate-500 text-center py-2">
						This table will not be included in the extraction blueprint.
					</p>
				</CardTypeSelectorContent>

				{/* ---- Single Object ---- */}
				<CardTypeSelectorContent value="single-object">
					{data?.mode === "single-object" && (
						<div className="space-y-4">
							<p className="text-sm text-slate-600">
								Each row in this table represents a single object. Configure which column contains
								the unique object identifier.
							</p>
							<div className="grid grid-cols-2 gap-3">
								<ValueExpressionEditor
									label="Object ID"
									value={data.id}
									onChange={(v) => updateExpr("id", v)}
									columns={columns}
									previewData={previewData}
									typeHint="id"
								/>
								<TextInputConfig
									label="Object Type"
									value={data.object_type}
									onChange={(v) => updateString("object_type", v)}
								/>
							</div>
						</div>
					)}
				</CardTypeSelectorContent>

				{/* ---- Multi Object ---- */}
				<CardTypeSelectorContent value="multi-object">
					{data?.mode === "multi-object" && (
						<div className="space-y-4">
							<p className="text-sm text-slate-600">
								Rows represent objects of different types. Specify the ID and the column/expression
								that determines the object type.
							</p>
							<div className="grid grid-cols-2 gap-3">
								<ValueExpressionEditor
									label="Object ID"
									value={data.id}
									onChange={(v) => updateExpr("id", v)}
									columns={columns}
									previewData={previewData}
									typeHint="id"
								/>
								<ValueExpressionEditor
									label="Object Type"
									value={data.object_type}
									onChange={(v) => updateExpr("object_type", v)}
									columns={columns}
									previewData={previewData}
									typeHint="type"
								/>
							</div>
						</div>
					)}
				</CardTypeSelectorContent>

				{/* ---- Single Event ---- */}
				<CardTypeSelectorContent value="single-event">
					{data?.mode === "single-event" && (
						<div className="space-y-4">
							<p className="text-sm text-slate-600">
								Each row is an event of a single type. Configure the ID, timestamp, and type.
							</p>
							<div className="grid grid-cols-2 gap-3">
								<ValueExpressionEditor
									label="Event ID"
									value={data.id}
									onChange={(v) => updateExpr("id", v)}
									columns={columns}
									previewData={previewData}
									typeHint="id"
								/>
								<TimestampSourceEditor
									label="Timestamp"
									value={data.timestamp}
									onChange={(v) => updateTimestamp("timestamp", v)}
									columns={columns}
									previewData={previewData}
								/>
								<TextInputConfig
									label="Event Type"
									value={data.event_type}
									onChange={(v) => updateString("event_type", v)}
								/>
							</div>
							<InlineObjectReferencesEditor
								references={data.inline_object_references}
								onChange={(refs) => setData({ ...data, inline_object_references: refs })}
								columns={columns}
								previewData={previewData}
								ValueExpressionEditor={ValueExpressionEditor}
							/>
						</div>
					)}
				</CardTypeSelectorContent>

				{/* ---- Multi Event ---- */}
				<CardTypeSelectorContent value="multi-event">
					{data?.mode === "multi-event" && (
						<div className="space-y-4">
							<p className="text-sm text-slate-600">
								Rows are events with different types. Specify ID, timestamp, and type column or
								expression.
							</p>
							<div className="grid grid-cols-2 gap-3">
								<ValueExpressionEditor
									label="Event ID"
									value={data.id}
									onChange={(v) => updateExpr("id", v)}
									columns={columns}
									previewData={previewData}
									typeHint="id"
								/>
								<TimestampSourceEditor
									label="Timestamp"
									value={data.timestamp}
									onChange={(v) => updateTimestamp("timestamp", v)}
									columns={columns}
									previewData={previewData}
								/>
								<ValueExpressionEditor
									label="Event Type"
									value={data.event_type}
									onChange={(v) => updateExpr("event_type", v)}
									columns={columns}
									previewData={previewData}
									typeHint="type"
								/>
							</div>
							<InlineObjectReferencesEditor
								references={data.inline_object_references}
								onChange={(refs) => setData({ ...data, inline_object_references: refs })}
								columns={columns}
								previewData={previewData}
								ValueExpressionEditor={ValueExpressionEditor}
							/>
						</div>
					)}
				</CardTypeSelectorContent>

				{/* ---- E2O Relation ---- */}
				<CardTypeSelectorContent value="e2o-relation">
					{data?.mode === "e2o-relation" && (
						<div className="space-y-4">
							<p className="text-sm text-slate-600">
								This table links events to objects. Specify which columns reference the event and
								object.
							</p>
							<div className="grid grid-cols-2 gap-3">
								<ValueExpressionEditor
									label="Source Event"
									value={data.source_event}
									onChange={(v) => updateExpr("source_event", v)}
									columns={columns}
									previewData={previewData}
									typeHint="id"
								/>
								<ValueExpressionEditor
									label="Target Object"
									value={data.target_object}
									onChange={(v) => updateExpr("target_object", v)}
									columns={columns}
									previewData={previewData}
									typeHint="id"
								/>
								<ValueExpressionEditor
									label="Qualifier (optional)"
									value={data.qualifier ?? { ...DEFAULT_VALUE_EXPR }}
									onChange={(v) => updateExpr("qualifier", v)}
									columns={columns}
									previewData={previewData}
									typeHint="string"
									allowEmpty
								/>
							</div>
						</div>
					)}
				</CardTypeSelectorContent>

				{/* ---- O2O Relation ---- */}
				<CardTypeSelectorContent value="o2o-relation">
					{data?.mode === "o2o-relation" && (
						<div className="space-y-4">
							<p className="text-sm text-slate-600">
								This table links objects to other objects. Specify the source and target object
								columns.
							</p>
							<div className="grid grid-cols-2 gap-3">
								<ValueExpressionEditor
									label="Source Object"
									value={data.source_object}
									onChange={(v) => updateExpr("source_object", v)}
									columns={columns}
									previewData={previewData}
									typeHint="id"
								/>
								<ValueExpressionEditor
									label="Target Object"
									value={data.target_object}
									onChange={(v) => updateExpr("target_object", v)}
									columns={columns}
									previewData={previewData}
									typeHint="id"
								/>
								<ValueExpressionEditor
									label="Qualifier (optional)"
									value={data.qualifier ?? { ...DEFAULT_VALUE_EXPR }}
									onChange={(v) => updateExpr("qualifier", v)}
									columns={columns}
									previewData={previewData}
									typeHint="string"
									allowEmpty
								/>
							</div>
						</div>
					)}
				</CardTypeSelectorContent>

				{/* ---- Change Table Events ---- */}
				<CardTypeSelectorContent value="change-table-events">
					{data?.mode === "change-table-events" && (
						<div className="space-y-4">
							<p className="text-sm text-slate-600">
								Derive events from change/log table rows. Define rules that map rows to event types
								based on column conditions.
							</p>
							<div className="grid grid-cols-2 gap-3">
								<TimestampSourceEditor
									label="Timestamp"
									value={data.timestamp}
									onChange={(v) => updateTimestamp("timestamp", v)}
									columns={columns}
									previewData={previewData}
								/>
								<ValueExpressionEditor
									label="Event ID (or generate)"
									value={data.id ?? { ...DEFAULT_VALUE_EXPR }}
									onChange={(v) => updateExpr("id", v)}
									columns={columns}
									previewData={previewData}
									typeHint="id"
									allowEmpty
								/>
							</div>
							<EventRulesEditor
								rules={data.event_rules}
								onChange={(rules) => setData({ ...data, event_rules: rules })}
								columns={columns}
								previewData={previewData}
							/>
							<InlineObjectReferencesEditor
								references={data.inline_object_references}
								onChange={(refs) => setData({ ...data, inline_object_references: refs })}
								columns={columns}
								previewData={previewData}
								ValueExpressionEditor={ValueExpressionEditor}
							/>
						</div>
					)}
				</CardTypeSelectorContent>

				{/* ---- Change Table Object Changes ---- */}
				<CardTypeSelectorContent value="change-table-object-changes">
					{data?.mode === "change-table-object-changes" && (
						<div className="space-y-4">
							<p className="text-sm text-slate-600">
								Track object attribute changes over time. Each row records attribute values at a
								point in time for an object.
							</p>
							<div className="grid grid-cols-1 gap-3">
								<ValueExpressionEditor
									label="Object ID"
									value={data.object_id}
									onChange={(v) => updateExpr("object_id", v)}
									columns={columns}
									previewData={previewData}
									typeHint="id"
								/>
								<TextInputConfig
									label="Object Type"
									value={data.object_type}
									onChange={(v) => updateString("object_type", v)}
								/>
								<TimestampSourceEditor
									label="Timestamp"
									value={data.timestamp}
									onChange={(v) => updateTimestamp("timestamp", v)}
									columns={columns}
									previewData={previewData}
								/>
							</div>
							<AttributeConfigEditor
								config={migrateAttributeConfig(data as unknown as Record<string, unknown>)}
								onChange={(config) => setData({ ...data, attribute_config: config })}
								columns={columns}
								previewData={previewData}
								ColumnSelector={ColumnSelector}
								TextInputConfig={TextInputConfig}
							/>
						</div>
					)}
				</CardTypeSelectorContent>
			</CardTypeSelector>
		</div>
	);
}
