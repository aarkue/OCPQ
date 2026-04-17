import { LuPlus, LuTrash } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { DataSourceColumnInfo } from "@/types/generated/DataSourceColumnInfo";
import type { ChangeTableEventRule } from "./blueprint-flow-types";
import { ConditionBuilder } from "./ConditionBuilder";

interface EventRulesEditorProps {
	rules: ChangeTableEventRule[];
	onChange: (rules: ChangeTableEventRule[]) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
}

export function EventRulesEditor({ rules, onChange, columns, previewData }: EventRulesEditorProps) {
	const addRule = () => {
		onChange([
			...rules,
			{
				id: crypto.randomUUID(),
				event_type: "",
				conditions: {
					type: "AND",
					conditions: [{ type: "column-equals", column: "", value: "" }],
				},
			},
		]);
	};

	const updateRule = (index: number, patch: Partial<ChangeTableEventRule>) => {
		const updated = [...rules];
		updated[index] = { ...updated[index], ...patch };
		onChange(updated);
	};

	const removeRule = (index: number) => {
		onChange(rules.filter((_, i) => i !== index));
	};

	return (
		<div className="space-y-3">
			<Label className="font-bold text-slate-700">Event Rules</Label>
			{rules.length === 0 && (
				<p className="text-xs text-slate-400 italic">
					No rules yet. Add a rule to define how rows become events.
				</p>
			)}
			{rules.map((rule, i) => (
				<div key={rule.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
					<div className="flex items-center gap-2">
						<div className="flex-1">
							<label className="text-[11px] font-medium text-slate-500 mb-1 block">
								Event Type
							</label>
							<input
								className="w-full bg-white border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
								placeholder='e.g. "Pay Order"'
								value={rule.event_type}
								onChange={(e) => updateRule(i, { event_type: e.target.value })}
							/>
						</div>
						<Button
							title="Delete rule"
							size="icon"
							variant="ghost"
							className="h-7 w-7 shrink-0 text-red-400 hover:text-red-600 mt-4"
							onClick={() => removeRule(i)}
						>
							<LuTrash className="w-3.5 h-3.5" />
						</Button>
					</div>

					<div>
						<p className="text-[11px] font-medium text-slate-500 mb-1 block">Conditions</p>
						<ConditionBuilder
							condition={rule.conditions}
							onChange={(c) => updateRule(i, { conditions: c })}
							columns={columns}
							previewData={previewData}
						/>
					</div>
				</div>
			))}
			<Button size="sm" variant="outline" onClick={addRule} className="w-full">
				<LuPlus className="w-3.5 h-3.5 mr-1" />
				Add Rule
			</Button>
		</div>
	);
}
