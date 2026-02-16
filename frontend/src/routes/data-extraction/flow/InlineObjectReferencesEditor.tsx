import { useState } from "react";
import { LuChevronDown, LuLink, LuPlus, LuSettings, LuTrash } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { DataSourceColumnInfo } from "@/types/generated/DataSourceColumnInfo";
import {
	DEFAULT_VALUE_EXPR,
	type InlineObjectReference,
	type ValueExpression,
} from "./blueprint-flow-types";

interface InlineObjectReferencesEditorProps {
	references: InlineObjectReference[];
	onChange: (refs: InlineObjectReference[]) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
	ValueExpressionEditor: React.ComponentType<{
		label: string;
		value: ValueExpression;
		onChange: (v: ValueExpression) => void;
		columns: Record<string, DataSourceColumnInfo>;
		previewData?: Array<Record<string, string>>;
		typeHint?: "id" | "timestamp" | "type" | "string";
		allowEmpty?: boolean;
	}>;
}

const COMMON_DELIMITERS = [
	{ value: ",", label: "Comma (,)" },
	{ value: ";", label: "Semicolon (;)" },
	{ value: "/", label: "Slash (/)" },
	{ value: "|", label: "Pipe (|)" },
	{ value: "\\t", label: "Tab" },
	{ value: " ", label: "Space" },
];

export function InlineObjectReferencesEditor({
	references,
	onChange,
	columns,
	previewData,
	ValueExpressionEditor,
}: InlineObjectReferencesEditorProps) {
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const [showAdvancedIds, setShowAdvancedIds] = useState<Set<string>>(new Set());

	const addReference = () => {
		const newRef: InlineObjectReference = {
			id: crypto.randomUUID(),
			object_id: { ...DEFAULT_VALUE_EXPR },
			object_type: null,
			qualifier: null,
			multi_value_config: {
				enabled: false,
				delimiter: ",",
				trim_values: true,
			},
		};
		onChange([...references, newRef]);
		setExpandedIds((prev) => new Set([...prev, newRef.id]));
	};

	const updateReference = (index: number, patch: Partial<InlineObjectReference>) => {
		const updated = [...references];
		updated[index] = { ...updated[index], ...patch };
		onChange(updated);
	};

	const removeReference = (index: number) => {
		onChange(references.filter((_, i) => i !== index));
	};

	const toggleExpanded = (id: string) => {
		setExpandedIds((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(id)) {
				newSet.delete(id);
			} else {
				newSet.add(id);
			}
			return newSet;
		});
	};

	const toggleAdvanced = (id: string) => {
		setShowAdvancedIds((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(id)) {
				newSet.delete(id);
			} else {
				newSet.add(id);
			}
			return newSet;
		});
	};

	const getReferenceSummary = (ref: InlineObjectReference): string => {
		const idLabel = ref.object_id.type === "column" ? ref.object_id.column || "?" : "...";
		return idLabel;
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<Label className="font-bold text-slate-700 flex items-center gap-1.5">
					<LuLink className="w-3.5 h-3.5 text-purple-500" />
					Inline Object References
				</Label>
			</div>

			{references.length === 0 && (
				<p className="text-xs text-slate-400 italic">
					No inline references. Add one to link objects from columns in the same row.
				</p>
			)}

			{references.map((ref, i) => {
				const isExpanded = expandedIds.has(ref.id);
				const showAdvanced = showAdvancedIds.has(ref.id);
				const hasObjectType = ref.object_type != null && ref.object_type !== "";
				const isObjectTypeString = typeof ref.object_type === "string";

				return (
					<div key={ref.id} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
						{/* Header */}
						<div
							className="flex items-center gap-2 px-3 py-2 bg-slate-50 cursor-pointer hover:bg-slate-100"
							onClick={() => toggleExpanded(ref.id)}
						>
							<LuChevronDown
								className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
							/>
							<span className="flex-1 text-sm font-medium text-slate-700">
								{getReferenceSummary(ref)}
							</span>
							{ref.multi_value_config?.enabled && (
								<span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-600">
									Multi-value
								</span>
							)}
							<Button
								title="Delete reference"
								size="icon"
								variant="ghost"
								className="h-6 w-6 shrink-0 text-red-400 hover:text-red-600"
								onClick={(e) => {
									e.stopPropagation();
									removeReference(i);
								}}
							>
								<LuTrash className="w-3 h-3" />
							</Button>
						</div>

						{/* Content */}
						{isExpanded && (
							<div className="p-3 space-y-3 border-t border-slate-100">
								{/* Object ID */}
								<ValueExpressionEditor
									label="Object ID Column"
									value={ref.object_id}
									onChange={(v) => updateReference(i, { object_id: v })}
									columns={columns}
									previewData={previewData}
									typeHint="id"
								/>

								{/* Multi-value configuration */}
								<div className="space-y-2">
									<label className="flex items-center gap-2 cursor-pointer">
										<input
											type="checkbox"
											checked={ref.multi_value_config?.enabled ?? false}
											onChange={(e) =>
												updateReference(i, {
													multi_value_config: {
														enabled: e.target.checked,
														delimiter: ref.multi_value_config?.delimiter ?? ",",
														trim_values: ref.multi_value_config?.trim_values ?? true,
													},
												})
											}
											className="rounded border-slate-300 text-sky-500 focus:ring-sky-500"
										/>
										<span className="text-xs font-medium text-slate-600">
											Multiple objects per cell
										</span>
									</label>

									{ref.multi_value_config?.enabled && (
										<div className="pl-5 space-y-2">
											<div className="flex items-center gap-2">
												<Label className="text-xs text-slate-500 whitespace-nowrap">
													Delimiter:
												</Label>
												<Select
													value={ref.multi_value_config.delimiter}
													onValueChange={(v) =>
														updateReference(i, {
															multi_value_config: {
																enabled: ref.multi_value_config?.enabled ?? false,
																trim_values: ref.multi_value_config?.trim_values ?? true,
																delimiter: v === "\\t" ? "\t" : v,
															},
														})
													}
												>
													<SelectTrigger className="h-7 text-xs flex-1">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{COMMON_DELIMITERS.map((d) => (
															<SelectItem key={d.value} value={d.value} className="text-xs">
																{d.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</div>

											<label className="flex items-center gap-2 cursor-pointer">
												<input
													type="checkbox"
													checked={ref.multi_value_config.trim_values}
													onChange={(e) =>
														updateReference(i, {
															multi_value_config: {
																...ref.multi_value_config!,
																trim_values: e.target.checked,
															},
														})
													}
													className="rounded border-slate-300 text-sky-500 focus:ring-sky-500"
												/>
												<span className="text-xs text-slate-500">Trim whitespace from values</span>
											</label>

											{/* Preview */}
											{previewData &&
												previewData.length > 0 &&
												ref.object_id.type === "column" &&
												ref.object_id.column && (
													<MultiValuePreview
														column={ref.object_id.column}
														delimiter={ref.multi_value_config.delimiter}
														trim={ref.multi_value_config.trim_values}
														previewData={previewData}
													/>
												)}
										</div>
									)}
								</div>

								{/* Advanced options toggle */}
								<button
									type="button"
									className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 pt-1"
									onClick={() => toggleAdvanced(ref.id)}
								>
									<LuSettings className="w-3 h-3" />
									<LuChevronDown
										className={`w-3 h-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
									/>
									Advanced options
								</button>

								{showAdvanced && (
									<div className="space-y-3 pl-2 border-l-2 border-slate-200">
										{/* Qualifier (optional) */}
										<ValueExpressionEditor
											label="Qualifier (optional)"
											value={ref.qualifier ?? { ...DEFAULT_VALUE_EXPR }}
											onChange={(v) => updateReference(i, { qualifier: v })}
											columns={columns}
											previewData={previewData}
											typeHint="string"
											allowEmpty
										/>

										{/* Object Type (optional) */}
										<div className="space-y-1">
											<div className="flex items-center justify-between">
												<Label className="text-xs font-medium text-slate-600">
													Object Type (optional)
												</Label>
												<div className="flex rounded-md border border-slate-200 text-[10px] overflow-hidden">
													<button
														type="button"
														onClick={() => updateReference(i, { object_type: null })}
														className={`px-1.5 py-0.5 transition-colors ${
															!hasObjectType
																? "bg-sky-500 text-white"
																: "bg-white text-slate-500 hover:bg-slate-50"
														}`}
													>
														None
													</button>
													<button
														type="button"
														onClick={() => updateReference(i, { object_type: "" })}
														className={`px-1.5 py-0.5 transition-colors ${
															hasObjectType && isObjectTypeString
																? "bg-sky-500 text-white"
																: "bg-white text-slate-500 hover:bg-slate-50"
														}`}
													>
														Fixed
													</button>
													<button
														type="button"
														onClick={() =>
															updateReference(i, {
																object_type: { ...DEFAULT_VALUE_EXPR },
															})
														}
														className={`px-1.5 py-0.5 transition-colors ${
															hasObjectType && !isObjectTypeString
																? "bg-sky-500 text-white"
																: "bg-white text-slate-500 hover:bg-slate-50"
														}`}
													>
														Column
													</button>
												</div>
											</div>

											{hasObjectType && isObjectTypeString && (
												<input
													className="w-full bg-white border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
													placeholder='e.g. "Customer"'
													value={ref.object_type as string}
													onChange={(e) => updateReference(i, { object_type: e.target.value })}
												/>
											)}

											{hasObjectType && !isObjectTypeString && (
												<ValueExpressionEditor
													label=""
													value={ref.object_type as ValueExpression}
													onChange={(v) => updateReference(i, { object_type: v })}
													columns={columns}
													previewData={previewData}
													typeHint="type"
												/>
											)}

											<p className="text-[10px] text-slate-400">
												If set, objects will be created with this type. Otherwise, only E2O
												relations are added.
											</p>
										</div>
									</div>
								)}
							</div>
						)}
					</div>
				);
			})}

			<Button size="sm" variant="outline" onClick={addReference} className="w-full">
				<LuPlus className="w-3.5 h-3.5 mr-1" />
				Add Object Reference
			</Button>
		</div>
	);
}

function MultiValuePreview({
	column,
	delimiter,
	trim,
	previewData,
}: {
	column: string;
	delimiter: string;
	trim: boolean;
	previewData: Array<Record<string, string>>;
}) {
	const sampleRow = previewData.find((row) => row[column]?.includes(delimiter));
	if (!sampleRow) return null;

	const rawValue = sampleRow[column];
	const splitValues = rawValue.split(delimiter).map((v) => (trim ? v.trim() : v));

	return (
		<div className="text-[10px] bg-slate-50 rounded p-2 space-y-1">
			<div className="text-slate-500">
				Preview splitting "<span className="font-mono">{rawValue}</span>":
			</div>
			<div className="flex flex-wrap gap-1">
				{splitValues.map((val, idx) => (
					<span key={idx} className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-mono">
						{val}
					</span>
				))}
			</div>
		</div>
	);
}
