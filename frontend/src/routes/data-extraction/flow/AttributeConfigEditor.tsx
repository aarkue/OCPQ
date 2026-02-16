import { LuPlus, LuTrash } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { DataSourceColumnInfo } from "@/types/generated/DataSourceColumnInfo";
import type { AttributeConfig, AttributeMapping } from "./blueprint-flow-types";

interface AttributeConfigEditorProps {
	config: AttributeConfig;
	onChange: (config: AttributeConfig) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
	/** ColumnSelector from TableUsageConfig — passed to avoid circular imports */
	ColumnSelector: React.ComponentType<{
		label?: string;
		value: string;
		onChange: (value: string) => void;
		columns: Record<string, DataSourceColumnInfo>;
		previewData?: Array<Record<string, string>>;
		typeHint?: "id" | "timestamp" | "type" | "string";
	}>;
	/** TextInputConfig from TableUsageConfig */
	TextInputConfig: React.ComponentType<{
		label: string;
		value: string;
		onChange: (value: string) => void;
		placeholder?: string;
	}>;
}

export function AttributeConfigEditor({
	config,
	onChange,
	columns,
	previewData,
	ColumnSelector,
	TextInputConfig,
}: AttributeConfigEditorProps) {
	const isStatic = config.mode === "static";

	const switchMode = (mode: "static" | "dynamic") => {
		if (mode === config.mode) return;
		if (mode === "static") {
			onChange({ mode: "static", mappings: [] });
		} else {
			onChange({ mode: "dynamic", name_column: "", value_column: "" });
		}
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<Label className="font-medium text-slate-700">Attributes</Label>
				<div className="flex rounded-md border border-slate-200 text-[10px] overflow-hidden">
					<button
						type="button"
						onClick={() => switchMode("static")}
						className={`px-1.5 py-0.5 transition-colors ${
							isStatic ? "bg-sky-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
						}`}
					>
						Static
					</button>
					<button
						type="button"
						onClick={() => switchMode("dynamic")}
						className={`px-1.5 py-0.5 transition-colors ${
							!isStatic ? "bg-sky-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50"
						}`}
					>
						Dynamic
					</button>
				</div>
			</div>

			{isStatic && config.mode === "static" && (
				<StaticAttributeEditor
					mappings={config.mappings}
					onChange={(mappings) => onChange({ mode: "static", mappings })}
					columns={columns}
					previewData={previewData}
					ColumnSelector={ColumnSelector}
					TextInputConfig={TextInputConfig}
				/>
			)}

			{!isStatic && config.mode === "dynamic" && (
				<DynamicAttributeEditor
					config={config}
					onChange={onChange}
					columns={columns}
					previewData={previewData}
					ColumnSelector={ColumnSelector}
				/>
			)}
		</div>
	);
}

// ---- Static mode: explicit column -> attribute name mappings ----

function StaticAttributeEditor({
	mappings,
	onChange,
	columns,
	previewData,
	ColumnSelector,
	TextInputConfig,
}: {
	mappings: AttributeMapping[];
	onChange: (mappings: AttributeMapping[]) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
	ColumnSelector: AttributeConfigEditorProps["ColumnSelector"];
	TextInputConfig: AttributeConfigEditorProps["TextInputConfig"];
}) {
	const addMapping = () => {
		onChange([...mappings, { id: crypto.randomUUID(), source_column: "", attribute_name: "" }]);
	};

	const updateMapping = (index: number, patch: Partial<AttributeMapping>) => {
		const updated = [...mappings];
		updated[index] = { ...updated[index], ...patch };
		onChange(updated);
	};

	const removeMapping = (index: number) => {
		onChange(mappings.filter((_, i) => i !== index));
	};

	return (
		<div className="space-y-2">
			<p className="text-[11px] text-slate-400">Map specific columns to OCEL attribute names.</p>
			{mappings.length === 0 && (
				<p className="text-xs text-slate-400 italic">
					No attributes mapped. Add columns to track as object attributes.
				</p>
			)}
			{mappings.map((attr, i) => (
				<div
					key={attr.id}
					className="flex items-end gap-2 rounded border border-slate-200 bg-white p-2"
				>
					<div className="flex-1">
						<ColumnSelector
							label="Source Column"
							value={attr.source_column}
							onChange={(v) => {
								const patch: Partial<AttributeMapping> = {
									source_column: v,
								};
								if (!attr.attribute_name || attr.attribute_name === attr.source_column) {
									patch.attribute_name = v;
								}
								updateMapping(i, patch);
							}}
							columns={columns}
							previewData={previewData}
						/>
					</div>
					<div className="flex-1">
						<TextInputConfig
							label="Attribute Name"
							value={attr.attribute_name}
							onChange={(v) => updateMapping(i, { attribute_name: v })}
							placeholder="Attribute name in OCEL"
						/>
					</div>
					<Button
						size="icon"
						variant="ghost"
						className="h-7 w-7 shrink-0 text-red-400 hover:text-red-600"
						onClick={() => removeMapping(i)}
					>
						<LuTrash className="w-3.5 h-3.5" />
					</Button>
				</div>
			))}
			<Button size="sm" variant="outline" onClick={addMapping} className="w-full">
				<LuPlus className="w-3.5 h-3.5 mr-1" />
				Add Attribute
			</Button>
		</div>
	);
}

// ---- Dynamic mode: attribute name and value come from columns (EAV) ----

function DynamicAttributeEditor({
	config,
	onChange,
	columns,
	previewData,
	ColumnSelector,
}: {
	config: { mode: "dynamic"; name_column: string; value_column: string };
	onChange: (config: AttributeConfig) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
	ColumnSelector: AttributeConfigEditorProps["ColumnSelector"];
}) {
	return (
		<div className="space-y-3">
			<p className="text-[11px] text-slate-400">
				Each row contains the attribute name in one column and the value in another (EAV pattern).
				The attribute name is determined dynamically per row.
			</p>
			<div className="grid grid-cols-2 gap-3">
				<ColumnSelector
					label="Attribute Name Column"
					value={config.name_column}
					onChange={(v) => onChange({ ...config, name_column: v })}
					columns={columns}
					previewData={previewData}
					typeHint="string"
				/>
				<ColumnSelector
					label="Attribute Value Column"
					value={config.value_column}
					onChange={(v) => onChange({ ...config, value_column: v })}
					columns={columns}
					previewData={previewData}
				/>
			</div>
		</div>
	);
}
