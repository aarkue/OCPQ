import { useMemo, useState } from "react";
import { LuCheck, LuSlidersHorizontal } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { PathTypeRef } from "@/types/generated/PathTypeRef";
import KindBadge from "./KindBadge";
import { typeKey } from "./lib";

interface TypeItem {
	name: string;
	is_event: boolean;
	count: number;
}

interface Props {
	types: TypeItem[];
	shownTypes: PathTypeRef[];
	setShownTypes: (v: PathTypeRef[]) => void;
	onResetAuto: () => void;
	onAddNeighbors: () => void;
	onSelectAll: () => void;
	isAuto: boolean;
}

const asRef = (t: TypeItem): PathTypeRef => ({ name: t.name, is_event: t.is_event });

function sortItems(items: TypeItem[], by: "count" | "name"): TypeItem[] {
	const arr = [...items];
	arr.sort((a, b) => (by === "name" ? a.name.localeCompare(b.name) : b.count - a.count));
	return arr;
}

export default function TypeFilterPopover({
	types,
	shownTypes,
	setShownTypes,
	onResetAuto,
	onAddNeighbors,
	onSelectAll,
	isAuto,
}: Props) {
	const [sortBy, setSortBy] = useState<"count" | "name">("count");
	const shownKeys = useMemo(() => new Set(shownTypes.map(typeKey)), [shownTypes]);

	const events = useMemo(
		() =>
			sortItems(
				types.filter((t) => t.is_event),
				sortBy,
			),
		[types, sortBy],
	);
	const objects = useMemo(
		() =>
			sortItems(
				types.filter((t) => !t.is_event),
				sortBy,
			),
		[types, sortBy],
	);
	const shownEvents = events.filter((t) => shownKeys.has(typeKey(t))).length;
	const shownObjects = objects.filter((t) => shownKeys.has(typeKey(t))).length;

	const toggle = (t: TypeItem) => {
		const k = typeKey(t);
		if (shownKeys.has(k)) setShownTypes(shownTypes.filter((r) => typeKey(r) !== k));
		else setShownTypes([...shownTypes, asRef(t)]);
	};

	const renderRow = (t: TypeItem) => {
		const on = shownKeys.has(typeKey(t));
		return (
			<CommandItem
				key={typeKey(t)}
				value={t.name}
				onSelect={() => toggle(t)}
				className="cursor-pointer gap-2"
			>
				<div
					className={cn(
						"flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
						on ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible",
					)}
				>
					<LuCheck className="h-3.5 w-3.5" />
				</div>
				<KindBadge isEvent={t.is_event} />
				<span className="truncate" title={t.name}>
					{t.name}
				</span>
				<span className="ml-auto text-[10px] text-gray-400 tabular-nums">{t.count}</span>
			</CommandItem>
		);
	};

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm" className="h-7 gap-1.5 bg-white/90 shadow-sm">
					<LuSlidersHorizontal size={14} />
					Scope: {shownTypes.length}/{types.length}
					{isAuto && <span className="text-[10px] text-gray-400">(auto)</span>}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" side="bottom" className="w-80 p-0">
				<div className="flex items-center justify-between border-b px-2 py-1.5">
					<Label className="text-xs font-semibold">Types in scope</Label>
					<div className="flex items-center gap-1 text-[10px]">
						<span className="text-gray-400">sort</span>
						<button
							type="button"
							onClick={() => setSortBy("count")}
							className={cn(
								"rounded px-1",
								sortBy === "count"
									? "bg-indigo-100 text-indigo-700 font-semibold"
									: "text-gray-500",
							)}
						>
							count
						</button>
						<button
							type="button"
							onClick={() => setSortBy("name")}
							className={cn(
								"rounded px-1",
								sortBy === "name" ? "bg-indigo-100 text-indigo-700 font-semibold" : "text-gray-500",
							)}
						>
							A-Z
						</button>
					</div>
				</div>
				<Command>
					<CommandInput placeholder="Search types..." />
					<CommandList className="max-h-72">
						<CommandEmpty>No type found.</CommandEmpty>
						<CommandGroup heading={`Events (${shownEvents}/${events.length})`}>
							{events.map(renderRow)}
						</CommandGroup>
						<CommandGroup heading={`Objects (${shownObjects}/${objects.length})`}>
							{objects.map(renderRow)}
						</CommandGroup>
					</CommandList>
				</Command>
				<div className="flex items-center gap-1.5 border-t px-2 py-1.5">
					<Button
						size="sm"
						variant="outline"
						className="h-7 text-[11px]"
						onClick={onAddNeighbors}
						title="Add types directly connected to the current scope (bounded)"
					>
						+ neighbors
					</Button>
					<Button
						size="sm"
						variant="outline"
						className="h-7 text-[11px]"
						onClick={onResetAuto}
						disabled={isAuto}
					>
						Reset to auto
					</Button>
					<div className="flex-1" />
					<Button
						size="sm"
						variant="ghost"
						className="h-7 text-[11px]"
						onClick={onSelectAll}
						title="Select all types (capped on large logs)"
					>
						All
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="h-7 text-[11px]"
						onClick={() => setShownTypes([])}
					>
						Clear
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
