import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { LuSearch } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { useBackend, useOcelInfo, useOcelStats } from "@/hooks";
import { InspectorContext } from "@/inspector/InspectorContext";
import { ElementKindIcon } from "./ElementKindIcon";
import { AREAS } from "./layout/areas";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

const MAX_PER_GROUP = 8;

type PaletteItem = {
	key: string;
	group: string;
	icon: ReactNode;
	label: string;
	detail?: string;
	open: () => unknown;
};

/** Ctrl/⌘ K: pin types, events and objects, or go to an area. */
export default function CommandPalette({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => unknown;
}) {
	const backend = useBackend();
	const ocelInfo = useOcelInfo();
	const stats = useOcelStats();
	const navigate = useNavigate();
	const { pin } = useContext(InspectorContext);
	const [text, setText] = useState("");
	const [query, setQuery] = useState("");
	// By key, so element hits that arrive after an arrow key press keep the same item active.
	const [activeKey, setActiveKey] = useState<string>();

	useEffect(() => {
		const t = setTimeout(() => setQuery(text.trim()), 150);
		return () => clearTimeout(t);
	}, [text]);

	const { data: hits, isFetching } = useQuery({
		queryKey: ["ocel", "search-elements", query],
		queryFn: () => backend["ocel/search-elements"](query, MAX_PER_GROUP),
		enabled: open && query !== "" && ocelInfo !== undefined,
		staleTime: Number.POSITIVE_INFINITY,
	});

	const items = useMemo<PaletteItem[]>(() => {
		const needle = text.trim().toLowerCase();
		const result: PaletteItem[] = [];
		if (ocelInfo !== undefined && needle !== "") {
			const types = [
				...ocelInfo.object_types.map((t) => ({ isEvent: false, name: t.name })),
				...ocelInfo.event_types.map((t) => ({ isEvent: true, name: t.name })),
			].filter((t) => t.name.toLowerCase().includes(needle));
			for (const t of types.slice(0, MAX_PER_GROUP)) {
				const count = (t.isEvent ? stats?.event_type_counts : stats?.object_type_counts)?.[t.name];
				result.push({
					key: `type:${t.isEvent}:${t.name}`,
					group: "Types",
					icon: <ElementKindIcon isEvent={t.isEvent} />,
					label: t.name,
					detail: `${t.isEvent ? "event" : "object"} type${count !== undefined ? ` · ${count.toLocaleString()}` : ""}`,
					open: () => pin({ kind: "type", isEvent: t.isEvent, name: t.name }),
				});
			}
		}
		if (query !== "" && query === text.trim()) {
			for (const hit of hits ?? []) {
				const type = hit.is_event ? "event" : "object";
				result.push({
					key: `el:${type}:${hit.id}`,
					group: "Events & objects",
					icon: <ElementKindIcon isEvent={hit.is_event} />,
					label: hit.id,
					detail: hit.type_name,
					open: () => pin({ kind: "element", type, id: hit.id }),
				});
			}
		}
		for (const area of AREAS) {
			if (
				(area.needsOcel && ocelInfo === undefined) ||
				!area.label.toLowerCase().includes(needle)
			) {
				continue;
			}
			result.push({
				key: `area:${area.to}`,
				group: "Go to",
				icon: area.icon,
				label: area.label,
				open: () => navigate(area.to),
			});
		}
		return result;
	}, [text, query, hits, ocelInfo, stats, pin, navigate]);

	const active = Math.max(
		0,
		items.findIndex((item) => item.key === activeKey),
	);
	const move = (by: number) =>
		setActiveKey(items[Math.min(Math.max(active + by, 0), items.length - 1)]?.key);
	const close = () => {
		onOpenChange(false);
		setText("");
		setQuery("");
		setActiveKey(undefined);
	};
	const run = (item: PaletteItem | undefined) => {
		if (item === undefined) return;
		item.open();
		close();
	};
	const searching = text.trim() !== "" && (isFetching || query !== text.trim());

	return (
		<Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
			<DialogContent className="top-[12%] translate-y-0 data-[state=open]:slide-in-from-top-[10%] p-0 gap-0 max-w-xl overflow-hidden">
				<DialogTitle className="sr-only">Search</DialogTitle>
				<DialogDescription className="sr-only">
					Find types, events, objects and areas
				</DialogDescription>
				<label className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200">
					<LuSearch className="text-slate-600 shrink-0" />
					<input
						autoFocus
						role="combobox"
						aria-expanded={items.length > 0}
						aria-controls="palette-results"
						aria-activedescendant={items.length > 0 ? `palette-option-${active}` : undefined}
						aria-label="Search types, events, objects and areas"
						placeholder="Search types, events, objects, areas…"
						className="flex-1 min-w-0 outline-none text-base bg-transparent"
						value={text}
						onChange={(ev) => {
							setText(ev.currentTarget.value);
							setActiveKey(undefined);
						}}
						onKeyDown={(ev) => {
							if (ev.key === "ArrowDown") {
								ev.preventDefault();
								move(1);
							} else if (ev.key === "ArrowUp") {
								ev.preventDefault();
								move(-1);
							} else if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey) {
								// Ctrl/⌘+Enter is the evaluate shortcut, not a pick.
								ev.preventDefault();
								run(items[active]);
							}
						}}
					/>
				</label>
				<div
					id="palette-results"
					role="listbox"
					aria-label="Results"
					className="max-h-[50vh] overflow-auto p-1.5 text-sm"
				>
					{items.map((item, i) => (
						<div key={item.key} role="presentation">
							{(i === 0 || items[i - 1].group !== item.group) && (
								<div
									aria-hidden="true"
									className="px-2 pt-2 pb-1 text-xs font-semibold text-slate-600"
								>
									{item.group}
								</div>
							)}
							<div
								id={`palette-option-${i}`}
								role="option"
								aria-selected={i === active}
								tabIndex={-1}
								className={clsx(
									"flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer",
									i === active && "bg-slate-100",
								)}
								onMouseEnter={() => setActiveKey(item.key)}
								onMouseDown={(ev) => {
									ev.preventDefault();
									run(item);
								}}
							>
								<span className="text-slate-600 shrink-0 flex">{item.icon}</span>
								<span className="font-medium truncate">{item.label}</span>
								{item.detail !== undefined && (
									<span className="text-slate-600 truncate">{item.detail}</span>
								)}
							</div>
						</div>
					))}
					{searching && (
						<div className="px-2 py-1.5 text-slate-600">Searching events and objects…</div>
					)}
					{items.length === 0 && !searching && (
						<div className="px-2 py-1.5 text-slate-600">Nothing found.</div>
					)}
				</div>
				<div className="flex gap-4 px-3 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
					<span>↑↓ move</span>
					<span>↵ pin or go to</span>
					<span>esc close</span>
				</div>
			</DialogContent>
		</Dialog>
	);
}
