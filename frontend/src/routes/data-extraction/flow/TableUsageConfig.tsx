import clsx from "clsx";
import { useState } from "react";
import { LuCalendar, LuChevronDown, LuHash, LuLink } from "react-icons/lu";
import { RxCheck } from "react-icons/rx";
import { TbAlertTriangle } from "react-icons/tb";
import {
	CardTypeSelector,
	CardTypeSelectorContent,
	type CardTypeSelectorOption,
} from "@/components/ui/card-type-selector";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { DataSourceColumnInfo } from "@/types/generated/DataSourceColumnInfo";
import type { DataSourceTableInfo } from "@/types/generated/DataSourceTableInfo";
import { AttributeConfigEditor } from "./AttributeConfigEditor";
import {
	ALL_TABLE_USAGE_MODES,
	DEFAULT_VALUE_EXPR,
	getDefaultUsageDataForMode,
	MODE_REGISTRY,
	type ObjectTypeSpec,
	type TableUsageData,
	type TableUsageType,
	type TimestampFormat,
	type TimestampSource,
	type ValueExpression,
} from "./blueprint-flow-types";
import { EventRulesEditor } from "./EventRulesEditor";
import { InlineObjectReferencesEditor } from "./InlineObjectReferencesEditor";
import { MultiValueConfigEditor } from "./MultiValueConfigEditor";

// ---- Card options for the mode selector (derived from MODE_REGISTRY) ----
const TABLE_USAGE_OPTIONS: CardTypeSelectorOption<TableUsageType>[] = ALL_TABLE_USAGE_MODES.map(
	(mode) => {
		const entry = MODE_REGISTRY[mode];
		const Icon = entry.icon;
		return {
			value: mode,
			title: entry.label,
			description: entry.description,
			icon: <Icon className={clsx("w-4 h-4", entry.iconColor)} />,
		};
	},
);

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

export function ColumnSelector({
	label,
	value,
	onChange,
	columns,
	previewData,
	allowEmpty,
	placeholder = `Select column${allowEmpty ? " (optional)" : ""}`,
	typeHint,
}: ColumnSelectorProps) {
	const [open, setOpen] = useState(false);
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
		<div className="space-y-1 w-full">
			{label && <Label className="font-medium text-slate-700 w-full">{label}</Label>}
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="flex items-center w-full bg-white border border-slate-200 rounded-md px-3 h-12 text-left hover:bg-slate-50 transition-colors max-w-sm"
					>
						<div className="flex-1 min-w-0">
							<ColumnSelectorItem
								isOptionalPlaceHolder={allowEmpty && !value}
								colName={value || placeholder}
								colInfo={columns[value] || { colType: "" }}
								samples={getSampleValues(value)}
							/>
						</div>
						<LuChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
					</button>
				</PopoverTrigger>
				<PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
					<Command>
						<CommandInput placeholder="Search columns..." />
						<CommandEmpty>No column found.</CommandEmpty>
						<CommandGroup className="max-h-64 overflow-auto">
							{allowEmpty && (
								<CommandItem
									value={SPECIAL_NONE_VALUE}
									onSelect={() => {
										onChange(undefined);
										setOpen(false);
									}}
								>
									<RxCheck
										className={clsx("mr-2 h-4 w-4 shrink-0", !value ? "opacity-100" : "opacity-0")}
									/>
									<span className="text-slate-500 italic">None</span>
								</CommandItem>
							)}
							{sortedColumns.map(([colName, colInfo]) => {
								const samples = getSampleValues(colName);
								return (
									<CommandItem
										key={colName}
										value={colName}
										onSelect={() => {
											onChange(colName);
											setOpen(false);
										}}
									>
										<RxCheck
											className={clsx(
												"mr-2 h-4 w-4 shrink-0",
												value === colName ? "opacity-100" : "opacity-0",
											)}
										/>
										<ColumnSelectorItem colName={colName} colInfo={colInfo} samples={samples} />
									</CommandItem>
								);
							})}
						</CommandGroup>
					</Command>
				</PopoverContent>
			</Popover>
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

// ---- Prefix ID with type checkbox ----

function PrefixIdCheckbox({
	checked,
	onChange,
	objectType,
	idExpr,
	previewData,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	objectType: string;
	idExpr?: ValueExpression;
	previewData?: Array<Record<string, string>>;
}) {
	// Build a preview of what the prefixed ID looks like
	let preview: string | undefined;
	if (checked && objectType && idExpr) {
		const sampleId =
			idExpr.type === "column" && idExpr.column && previewData?.[0]
				? previewData[0][idExpr.column]
				: "123";
		if (sampleId) preview = `${objectType}-${sampleId}`;
	}

	return (
		<div className="space-y-1">
			<label className="flex items-center gap-2 cursor-pointer">
				<input
					type="checkbox"
					checked={checked}
					onChange={(e) => onChange(e.target.checked)}
					className="rounded border-slate-300 text-indigo-500 focus:ring-indigo-500"
				/>
				<span className="text-xs font-medium text-slate-600">Prefix ID with object type</span>
				{preview && <span className="text-[10px] text-slate-400 font-mono ml-1">→ {preview}</span>}
			</label>
			{checked && (
				<p className="text-[10px] text-indigo-500 pl-5">
					All references to this type (inline object references, E2O/O2O relations) must specify the
					object type to enable automatic prefix resolution. Without the type, lookups will fail.
				</p>
			)}
		</div>
	);
}

// ---- Object Type Spec editor (for E2O/O2O target/source type) ----

function ObjectTypeSpecEditor({
	label,
	value,
	onChange,
	columns,
	previewData,
}: {
	label: string;
	value: ObjectTypeSpec | null;
	onChange: (v: ObjectTypeSpec | null) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
}) {
	// Normalize: ObjectTypeSpec is string | ValueExpression, or null for "not set"
	// We map it to a ValueExpression for the editor:
	// - null → not set (None)
	// - string → Constant ValueExpression
	// - ValueExpression → as-is
	const exprValue: ValueExpression | null =
		value == null ? null : typeof value === "string" ? { type: "constant", value } : value;

	const handleChange = (v: ValueExpression | null) => {
		if (v == null) {
			onChange(null);
		} else if (v.type === "constant") {
			// Store as plain string (ObjectTypeSpec.Fixed)
			onChange(v.value);
		} else {
			// Store as ValueExpression (ObjectTypeSpec.Expression)
			onChange(v);
		}
	};

	return (
		<div className="space-y-1">
			<ValueExpressionEditor
				label={label}
				value={exprValue ?? { ...DEFAULT_VALUE_EXPR }}
				onChange={handleChange}
				columns={columns}
				previewData={previewData}
				typeHint="type"
				allowEmpty
			/>
			{exprValue == null ? (
				<p className="text-[10px] text-amber-600 flex items-start gap-1">
					<TbAlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
					<span>
						No type specified. If the referenced objects use "Prefix ID with type", the lookup will
						fail. Set the type to enable automatic prefix resolution.
					</span>
				</p>
			) : (
				<p className="text-[10px] text-slate-400">
					If the referenced objects use "Prefix ID with type", the ID will be prefixed automatically
					during extraction.
				</p>
			)}
		</div>
	);
}

// ---- Event ID editor with Auto option ----

function EventIdEditor({
	value,
	onChange,
	columns,
	previewData,
}: {
	value: ValueExpression | null;
	onChange: (v: ValueExpression | null) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
}) {
	const isAuto = value == null;
	type IdMode = "auto" | "column" | "template" | "constant";
	const currentMode: IdMode = isAuto ? "auto" : value.type;

	const switchMode = (mode: IdMode) => {
		if (mode === currentMode) return;
		if (mode === "auto") {
			onChange(null);
		} else if (mode === "column") {
			onChange({ type: "column", column: "" });
		} else if (mode === "template") {
			onChange({ type: "template", template: "" });
		} else {
			onChange({ type: "constant", value: "" });
		}
	};

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between">
				<Label className="font-medium text-slate-700">Event ID</Label>
				<div className="flex rounded-md border border-slate-200 text-[10px] overflow-hidden">
					{(["auto", "column", "template", "constant"] as const).map((m) => (
						<button
							key={m}
							type="button"
							onClick={() => switchMode(m)}
							className={`px-1.5 py-0.5 transition-colors ${
								currentMode === m
									? "bg-sky-500 text-white"
									: "bg-white text-slate-500 hover:bg-slate-50"
							}`}
						>
							{m === "auto" ? "Auto" : m.charAt(0).toUpperCase() + m.slice(1)}
						</button>
					))}
				</div>
			</div>

			{isAuto && (
				<div className="text-xs text-slate-400 italic py-1">
					UUID will be auto-generated for each event
				</div>
			)}

			{!isAuto && value.type === "column" && (
				<ColumnSelector
					value={value.column}
					onChange={(v: string | undefined) => onChange({ type: "column", column: v ?? "" })}
					columns={columns}
					previewData={previewData}
					typeHint="id"
					allowEmpty
				/>
			)}

			{!isAuto && value.type === "constant" && (
				<input
					className="w-full bg-white border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					placeholder="Constant value"
					value={value.value}
					onChange={(e) => onChange({ type: "constant", value: e.target.value })}
				/>
			)}

			{!isAuto && value.type === "template" && (
				<div className="space-y-1.5">
					<input
						className="w-full bg-white border border-slate-300 rounded px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						placeholder="e.g. EVT-{order_id}"
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

/** Pick a non-empty sample cell value for a column-based ValueExpression. */
function getSampleForExpr(
	expr: ValueExpression,
	previewData?: Array<Record<string, string>>,
): string | undefined {
	if (expr.type !== "column" || !expr.column || !previewData) return undefined;
	for (const row of previewData) {
		const v = row[expr.column];
		if (v) return v;
	}
	return undefined;
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

	const modeBtn = (mode: string, lbl: string) => (
		<button
			type="button"
			onClick={() => {
				if (mode === "column") onChange({ type: "column", column: "", format: { type: "auto" } });
				else if (mode === "components")
					onChange({
						type: "components",
						date_column: null,
						time_column: null,
					});
				else
					onChange({
						type: "constant",
						value: "1970-01-01T00:00:00+00:00",
						format: { type: "auto" },
					});
			}}
			className={`px-1.5 py-0.5 transition-colors ${
				value.type === mode ? "bg-sky-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
			}`}
		>
			{lbl}
		</button>
	);

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between">
				<Label className="font-medium text-slate-700">{label}</Label>
				<div className="flex rounded-md border border-slate-200 text-[10px] overflow-hidden">
					{modeBtn("column", "Column")}
					{modeBtn("components", "Date + Time")}
					{modeBtn("constant", "Constant")}
				</div>
			</div>

			{value.type === "column" && (
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
											format: { type: "format-string", format: e.target.value },
										})
									}
								/>
							)}
						</div>
					)}
				</>
			)}

			{value.type === "components" && (
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

			{value.type === "constant" && (
				<div className="space-y-1">
					<input
						className="w-full bg-white border border-slate-300 rounded px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						placeholder="1970-01-01T00:00:00+00:00"
						value={value.value}
						onChange={(e) => onChange({ ...value, value: e.target.value })}
					/>
					<p className="text-[10px] text-slate-400">Fixed timestamp used for all rows.</p>
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
	/** When true, only show the config panel for the current mode (no card selector) */
	hideSelector?: boolean;
}

export function TableUsageConfig({
	data,
	setData,
	tableInfo,
	previewData,
	hideSelector,
}: TableUsageConfigProps) {
	const currentMode = data?.mode ?? ("event" as TableUsageType);
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

	/** Render the config panel for the current mode (shared between hideSelector and full form) */
	const configPanel = data ? (
		<>
			{data.mode === "event" && (
				<div className="space-y-4">
					<div className="grid grid-cols-2 gap-3">
						<ValueExpressionEditor
							label="Event Type"
							value={data.event_type}
							onChange={(v) => updateExpr("event_type", v)}
							columns={columns}
							previewData={previewData}
							typeHint="type"
						/>
						<TimestampSourceEditor
							label="Timestamp"
							value={data.timestamp}
							onChange={(v) => updateTimestamp("timestamp", v)}
							columns={columns}
							previewData={previewData}
						/>
						<EventIdEditor
							value={data.id}
							onChange={(v) => setData({ ...data, id: v })}
							columns={columns}
							previewData={previewData}
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
			{data.mode === "object" && (
				<div className="space-y-4">
					<div className="grid grid-cols-2 gap-3">
						<ValueExpressionEditor
							label="Object Type"
							value={data.object_type}
							onChange={(v) => updateExpr("object_type", v)}
							columns={columns}
							previewData={previewData}
							typeHint="type"
						/>
						<ValueExpressionEditor
							label="Object ID"
							value={data.id}
							onChange={(v) => updateExpr("id", v)}
							columns={columns}
							previewData={previewData}
							typeHint="id"
						/>
					</div>
					<PrefixIdCheckbox
						checked={data.prefix_id_with_type}
						onChange={(v) => setData({ ...data, prefix_id_with_type: v })}
						objectType={
							data.object_type.type === "constant"
								? data.object_type.value
								: data.object_type.type === "column"
									? `{${data.object_type.column}}`
									: "type"
						}
						idExpr={data.id}
						previewData={previewData}
					/>
					<div className="border rounded-md">
						<button
							type="button"
							className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
							onClick={() => {
								if (data.attribute_config != null) {
									setData({ ...data, timestamp: null, attribute_config: null });
								} else {
									setData({
										...data,
										timestamp: {
											type: "column",
											column: "",
											format: { type: "auto" },
										},
										attribute_config: { mode: "static", mappings: [] },
									});
								}
							}}
						>
							<span>
								<LuChevronDown
									className={clsx(
										"w-4 h-4 inline mr-1.5 transition-transform",
										data.attribute_config == null && "-rotate-90",
									)}
								/>{" "}
								Object Changes (Attribute Tracking)
							</span>
							<span className="text-xs text-slate-400">
								{data.attribute_config != null ? "enabled" : "disabled"}
							</span>
						</button>
						{data.attribute_config != null && data.timestamp != null && (
							<div className="px-3 pb-3 space-y-3 border-t">
								<TimestampSourceEditor
									label="Timestamp"
									value={data.timestamp}
									onChange={(v) => updateTimestamp("timestamp", v)}
									columns={columns}
									previewData={previewData}
								/>
								<AttributeConfigEditor
									config={data.attribute_config}
									onChange={(config) => setData({ ...data, attribute_config: config })}
									columns={columns}
									previewData={previewData}
									ColumnSelector={ColumnSelector}
									TextInputConfig={TextInputConfig}
								/>
							</div>
						)}
					</div>
				</div>
			)}
			{data.mode === "e2o-relation" && (
				<div className="space-y-4">
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
							value={data.qualifier ?? { type: "constant" as const, value: "" }}
							onChange={(v) => updateExpr("qualifier", v)}
							columns={columns}
							previewData={previewData}
							typeHint="string"
							allowEmpty
						/>
					</div>
					<ObjectTypeSpecEditor
						label="Target Object Type"
						value={data.target_object_type}
						onChange={(v) => setData({ ...data, target_object_type: v })}
						columns={columns}
						previewData={previewData}
					/>
					<MultiValueConfigEditor
						label="Multiple target objects per cell"
						value={data.target_object_multi}
						onChange={(mv) => setData({ ...data, target_object_multi: mv })}
						previewValue={getSampleForExpr(data.target_object, previewData)}
					/>
				</div>
			)}
			{data.mode === "o2o-relation" && (
				<div className="space-y-4">
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
							value={data.qualifier ?? { type: "constant" as const, value: "" }}
							onChange={(v) => updateExpr("qualifier", v)}
							columns={columns}
							previewData={previewData}
							typeHint="string"
							allowEmpty
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<ObjectTypeSpecEditor
							label="Source Object Type"
							value={data.source_object_type ?? null}
							onChange={(v) => setData({ ...data, source_object_type: v })}
							columns={columns}
							previewData={previewData}
						/>
						<ObjectTypeSpecEditor
							label="Target Object Type"
							value={data.target_object_type ?? null}
							onChange={(v) => setData({ ...data, target_object_type: v })}
							columns={columns}
							previewData={previewData}
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<MultiValueConfigEditor
							label="Multiple source objects per cell"
							value={data.source_object_multi}
							onChange={(mv) => setData({ ...data, source_object_multi: mv })}
							previewValue={getSampleForExpr(data.source_object, previewData)}
						/>
						<MultiValueConfigEditor
							label="Multiple target objects per cell"
							value={data.target_object_multi}
							onChange={(mv) => setData({ ...data, target_object_multi: mv })}
							previewValue={getSampleForExpr(data.target_object, previewData)}
						/>
					</div>
				</div>
			)}
			{data.mode === "change-table-events" && (
				<div className="space-y-4">
					<div className="grid grid-cols-2 gap-3">
						<TimestampSourceEditor
							label="Timestamp"
							value={data.timestamp}
							onChange={(v) => updateTimestamp("timestamp", v)}
							columns={columns}
							previewData={previewData}
						/>
						<EventIdEditor
							value={data.id}
							onChange={(v) => setData({ ...data, id: v })}
							columns={columns}
							previewData={previewData}
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
		</>
	) : null;

	if (hideSelector) {
		return <div className="w-full">{configPanel}</div>;
	}

	return (
		<div className="w-full min-w-[400px]">
			<CardTypeSelector
				options={TABLE_USAGE_OPTIONS}
				value={currentMode}
				onValueChange={handleModeChange}
				columns={3}
			>
				<CardTypeSelectorContent value={currentMode}>{configPanel}</CardTypeSelectorContent>
			</CardTypeSelector>
		</div>
	);
}
