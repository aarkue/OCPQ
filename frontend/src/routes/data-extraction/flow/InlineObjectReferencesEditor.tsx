import { useState } from "react";
import { LuChevronDown, LuLink, LuPlus, LuSettings, LuTrash } from "react-icons/lu";
import { TbAlertTriangle } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { DataSourceColumnInfo } from "@/types/generated/DataSourceColumnInfo";
import {
	DEFAULT_VALUE_EXPR,
	type InlineObjectReference,
	type ObjectTypeSpec,
	type ValueExpression,
} from "./blueprint-flow-types";
import { MultiValueConfigEditor } from "./MultiValueConfigEditor";

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
			multi_value_config: null,
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

	const getSampleForExpr = (expr: ValueExpression): string | undefined => {
		if (expr.type !== "column" || !expr.column || !previewData) return undefined;
		for (const row of previewData) {
			const v = row[expr.column];
			if (v) return v;
		}
		return undefined;
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

								<MultiValueConfigEditor
									label="Multiple objects per cell"
									value={ref.multi_value_config}
									onChange={(mv) => updateReference(i, { multi_value_config: mv })}
									previewValue={getSampleForExpr(ref.object_id)}
								/>

								{/* Object Type: needed for prefix resolution and auto-creation */}
								<ObjectTypeEditor
									value={ref.object_type}
									onChange={(v) => updateReference(i, { object_type: v })}
									columns={columns}
									previewData={previewData}
									ValueExpressionEditor={ValueExpressionEditor}
								/>

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
											value={ref.qualifier ?? { type: "constant" as const, value: "" }}
											onChange={(v) => updateReference(i, { qualifier: v })}
											columns={columns}
											previewData={previewData}
											typeHint="string"
											allowEmpty
										/>
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

function ObjectTypeEditor({
	value,
	onChange,
	columns,
	previewData,
	ValueExpressionEditor,
}: {
	value: ObjectTypeSpec | null;
	onChange: (v: ObjectTypeSpec | null) => void;
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
}) {
	// Map ObjectTypeSpec (string | ValueExpression | null) -> ValueExpression for the editor
	const exprValue: ValueExpression | null =
		value == null ? null : typeof value === "string" ? { type: "constant", value } : value;

	const handleChange = (v: ValueExpression | null | undefined) => {
		if (v == null) {
			onChange(null);
		} else if (v.type === "constant") {
			onChange(v.value); // Store as plain string (ObjectTypeSpec.Fixed)
		} else {
			onChange(v); // Store as ValueExpression (ObjectTypeSpec.Expression)
		}
	};

	return (
		<div className="space-y-1">
			<ValueExpressionEditor
				label="Object Type"
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
						fail. Set the type to enable automatic prefix resolution. Objects will only be
						auto-created if a type is set.
					</span>
				</p>
			) : (
				<p className="text-[10px] text-slate-400">
					If the referenced objects use "Prefix ID with type", the ID will be prefixed
					automatically. Objects will be created with this type if they don't exist yet.
				</p>
			)}
		</div>
	);
}
