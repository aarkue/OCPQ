import { TbFilterCheck, TbFilterOff, TbFilterX } from "react-icons/tb";
import type { FilterLabel } from "@/types/generated/FilterLabel";

export default function FilterLabelIcon({ label }: { label: FilterLabel }) {
	return (
		<span className="-mb-0.5 block">
			{label === "IGNORED" && (
				<TbFilterOff className="block size-3.5 mx-auto fill-neutral-200/50 hover:fill-neutral-300 text-neutral-300 hover:text-neutral-500" />
			)}
			{label === "INCLUDED" && (
				<TbFilterCheck className="block size-3.5 mx-auto fill-green-200 hover:fill-green-300 text-green-600" />
			)}
			{label === "EXCLUDED" && (
				<TbFilterX className="block size-3.5 mx-auto fill-red-200 hover:fill-red-300 text-red-600" />
			)}
		</span>
	);
}
