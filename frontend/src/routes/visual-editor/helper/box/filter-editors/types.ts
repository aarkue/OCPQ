import type { Constraint } from "@/types/generated/Constraint";
import type { Filter } from "@/types/generated/Filter";
import type { SizeFilter } from "@/types/generated/SizeFilter";

export interface FilterEditorProps<
	T extends Filter | SizeFilter | Constraint = Filter | SizeFilter | Constraint,
> {
	value: T;
	updateValue: (value: T) => unknown;
	availableObjectVars: number[];
	availableEventVars: number[];
	availableChildSets: string[];
	availableLabels?: string[];
	nodeID: string;
}

export interface FilterDisplayProps<
	T extends Filter | SizeFilter | Constraint = Filter | SizeFilter | Constraint,
> {
	value: T;
	compact?: boolean;
}
