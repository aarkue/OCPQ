import clsx from "clsx";
import { LuPlus, LuTrash } from "react-icons/lu";
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
import type { BaseChangeTableCondition, ChangeTableCondition } from "./blueprint-flow-types";
import { ColumnSelector } from "./TableUsageConfig";

// ---- Operator metadata ----

type ConditionOperator = BaseChangeTableCondition["type"];

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
	"column-equals": "equals",
	"column-not-equals": "does not equal",
	"column-not-empty": "is not empty",
	"column-matches": "matches regex",
};

function makeDefaultCondition(op: ConditionOperator): BaseChangeTableCondition {
	switch (op) {
		case "column-equals":
			return { type: "column-equals", column: "", value: "" };
		case "column-not-equals":
			return { type: "column-not-equals", column: "", value: "" };
		case "column-not-empty":
			return { type: "column-not-empty", column: "" };
		case "column-matches":
			return { type: "column-matches", column: "", regex: "" };
	}
}

// ---- Props ----

interface ConditionBuilderProps {
	condition: ChangeTableCondition;
	onChange: (c: ChangeTableCondition) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
	/** Whether this is a nested group (shows delete button) */
	isNested?: boolean;
	onDelete?: () => void;
}

// ---- ConditionBuilder (group or leaf) ----

export function ConditionBuilder({
	condition,
	onChange,
	columns,
	previewData,
	isNested,
	onDelete,
}: ConditionBuilderProps) {
	if (condition.type === "AND" || condition.type === "OR") {
		return (
			<ConditionGroup
				type={condition.type}
				conditions={condition.conditions}
				onChange={onChange}
				columns={columns}
				previewData={previewData}
				isNested={isNested}
				onDelete={onDelete}
			/>
		);
	}

	return (
		<BaseConditionRow
			condition={condition}
			onChange={(c) => onChange(c)}
			onDelete={onDelete}
			columns={columns}
			previewData={previewData}
		/>
	);
}

// ---- Group (AND / OR) ----

function ConditionGroup({
	type,
	conditions,
	onChange,
	columns,
	previewData,
	isNested,
	onDelete,
}: {
	type: "AND" | "OR";
	conditions: ChangeTableCondition[];
	onChange: (c: ChangeTableCondition) => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
	isNested?: boolean;
	onDelete?: () => void;
}) {
	const borderColor = type === "AND" ? "border-blue-300" : "border-amber-300";
	const bgColor = type === "AND" ? "bg-blue-50/50" : "bg-amber-50/50";

	const updateChild = (index: number, child: ChangeTableCondition) => {
		const updated = [...conditions];
		updated[index] = child;
		onChange({ type, conditions: updated });
	};

	const removeChild = (index: number) => {
		const updated = conditions.filter((_, i) => i !== index);
		// If only one child left in a nested group, collapse it
		if (updated.length === 1 && isNested) {
			onChange(updated[0]);
		} else {
			onChange({ type, conditions: updated });
		}
	};

	const addCondition = () => {
		onChange({
			type,
			conditions: [...conditions, { type: "column-equals", column: "", value: "" }],
		});
	};

	const addGroup = () => {
		onChange({
			type,
			conditions: [
				...conditions,
				{
					type: type === "AND" ? "OR" : "AND",
					conditions: [{ type: "column-equals", column: "", value: "" }],
				},
			],
		});
	};

	const toggleType = () => {
		const newType = type === "AND" ? "OR" : "AND";
		onChange({ type: newType, conditions });
	};

	return (
		<div className={clsx("rounded-md border-l-3 border", borderColor, bgColor)}>
			{/* Group header */}
			<div className="flex items-center gap-2 px-2 py-1.5">
				<button
					type="button"
					onClick={toggleType}
					className={clsx(
						"px-2 py-0.5 rounded text-xs font-bold tracking-wide transition-colors",
						type === "AND"
							? "bg-blue-100 text-blue-700 hover:bg-blue-200"
							: "bg-amber-100 text-amber-700 hover:bg-amber-200",
					)}
				>
					{type}
				</button>
				<span className="text-[10px] text-slate-400">
					{type === "AND" ? "all conditions must match" : "any condition must match"}
				</span>
				{isNested && onDelete && (
					<Button
						size="icon"
						variant="ghost"
						className="h-5 w-5 ml-auto text-red-400 hover:text-red-600"
						onClick={onDelete}
						title="Remove group"
					>
						<LuTrash className="w-3 h-3" />
					</Button>
				)}
			</div>

			{/* Children */}
			<div className="px-2 pb-2 space-y-1.5">
				{conditions.length === 0 && (
					<p className="text-[11px] text-slate-400 italic px-1">No conditions. Add one below.</p>
				)}
				{conditions.map((child, i) => (
					<ConditionBuilder
						key={i}
						condition={child}
						onChange={(c) => updateChild(i, c)}
						onDelete={() => removeChild(i)}
						columns={columns}
						previewData={previewData}
						isNested
					/>
				))}

				{/* Add buttons */}
				<div className="flex items-center gap-1.5 pt-0.5">
					<Button
						size="sm"
						variant="ghost"
						className="h-6 text-[11px] text-slate-500 hover:text-slate-700 px-2"
						onClick={addCondition}
					>
						<LuPlus className="w-3 h-3 mr-0.5" />
						Condition
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="h-6 text-[11px] text-slate-500 hover:text-slate-700 px-2"
						onClick={addGroup}
					>
						<LuPlus className="w-3 h-3 mr-0.5" />
						Group ({type === "AND" ? "OR" : "AND"})
					</Button>
				</div>
			</div>
		</div>
	);
}

// ---- Base condition row ----

function BaseConditionRow({
	condition,
	onChange,
	onDelete,
	columns,
	previewData,
}: {
	condition: BaseChangeTableCondition;
	onChange: (c: BaseChangeTableCondition) => void;
	onDelete?: () => void;
	columns: Record<string, DataSourceColumnInfo>;
	previewData?: Array<Record<string, string>>;
}) {
	const changeOperator = (op: ConditionOperator) => {
		if (op === condition.type) return;
		const base = makeDefaultCondition(op);
		if ("column" in condition && condition.column) {
			base.column = condition.column;
		}
		onChange(base);
	};

	const getSampleValues = (colName: string): string[] => {
		if (!previewData || previewData.length === 0 || !colName) return [];
		const values = previewData
			.slice(0, 3)
			.map((row) => row[colName])
			.filter((v) => v !== undefined && v !== null && v !== "");
		return [...new Set(values)];
	};

	const samples = condition.column ? getSampleValues(condition.column) : [];

	return (
		<div className="bg-white border border-slate-200 rounded-md p-2.5 space-y-2.5">
			<div className="flex items-start gap-2">
				{/* Column + operator */}
				<div className="flex-1 grid grid-cols-2 gap-2">
					<ColumnSelector
						label="Column"
						value={condition.column}
						onChange={(col) => {
							const updated = { ...condition, column: col };
							onChange(updated as BaseChangeTableCondition);
						}}
						columns={columns}
						previewData={previewData}
					/>
					<div className="space-y-1">
						<Label className="font-medium text-slate-700">Operator</Label>
						<Select
							value={condition.type}
							onValueChange={(v) => changeOperator(v as ConditionOperator)}
						>
							<SelectTrigger className="w-full bg-white h-12">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(Object.entries(OPERATOR_LABELS) as [ConditionOperator, string][]).map(
									([op, label]) => (
										<SelectItem key={op} value={op}>
											{label}
										</SelectItem>
									),
								)}
							</SelectContent>
						</Select>
					</div>
				</div>

				{/* Delete */}
				{onDelete && (
					<Button
						size="icon"
						variant="ghost"
						className="h-8 w-8 shrink-0 text-red-400 hover:text-red-600 mt-6"
						onClick={onDelete}
						title="Remove condition"
					>
						<LuTrash className="w-4 h-4" />
					</Button>
				)}
			</div>

			{/* Value input (only for equals / regex) */}
			{(condition.type === "column-equals" || condition.type === "column-not-equals") && (
				<div className="space-y-1">
					<Label className="font-medium text-slate-700">Value</Label>
					<input
						className="w-full bg-white border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						placeholder={samples.length > 0 ? `e.g. ${samples[0]}` : "Value..."}
						value={condition.value}
						onChange={(e) => onChange({ ...condition, value: e.target.value })}
					/>
				</div>
			)}
			{condition.type === "column-matches" && (
				<div className="space-y-1">
					<Label className="font-medium text-slate-700">Regex Pattern</Label>
					<input
						className="w-full bg-white border border-slate-200 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						placeholder="e.g. ^ORD-\d+$"
						value={condition.regex}
						onChange={(e) => onChange({ ...condition, regex: e.target.value })}
					/>
				</div>
			)}
		</div>
	);
}
