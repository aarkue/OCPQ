import clsx from "clsx";
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { LuArrowLeft } from "react-icons/lu";
import { TbTrash } from "react-icons/tb";
import { Link, useNavigate } from "react-router-dom";
import AutoSizer from "react-virtualized-auto-sizer";
import { FixedSizeList, VariableSizeList } from "react-window";
import type { Area } from "./areas";

/** The page's one-line description and its actions. The title itself is in the top bar. */
export function AreaPageHeader({
	description,
	actions,
}: {
	description?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2 pb-4 text-left">
			<p className="min-w-0 flex-1 text-base font-semibold tracking-tight text-slate-900">
				{description}
			</p>
			{actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
		</header>
	);
}

const backButtonClass =
	"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-xs outline-none hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-sky-500";

/** Leaves a detail view for its list. Sized like the area icon tile it sits next to. */
export function BackButton({
	label,
	to,
	onClick,
}: {
	label: string;
	to?: string;
	onClick?: () => void;
}) {
	const icon = <LuArrowLeft className="size-4" aria-hidden="true" />;
	return to !== undefined ? (
		<Link to={to} aria-label={label} title={label} className={backButtonClass}>
			{icon}
		</Link>
	) : (
		<button
			type="button"
			aria-label={label}
			title={label}
			className={backButtonClass}
			onClick={onClick}
		>
			{icon}
		</button>
	);
}

const ROW_HEIGHT = 52;
const FOOTER_HEIGHT = 33;

/** Height of a section header row in an AreaList. */
export const SECTION_ROW_HEIGHT = 36;

/** A bordered, virtualized list that is only as tall as its rows, up to the space available. With
 *  `rowHeight`, rows can differ in height, e.g., for section headers between the entries. */
export function AreaList({
	itemCount,
	renderRow,
	footer,
	initialIndex,
	rowHeight,
}: {
	itemCount: number;
	renderRow: (index: number) => ReactNode;
	footer?: ReactNode;
	initialIndex?: number;
	/** Undefined for an index means the usual entry height. */
	rowHeight?: (index: number) => number | undefined;
}) {
	const heights = Array.from({ length: itemCount }, (_, i) => rowHeight?.(i) ?? ROW_HEIGHT);
	const total = heights.reduce((a, b) => a + b, 0);
	const offsetOf = (index: number) => heights.slice(0, index).reduce((a, b) => a + b, 0);
	// The variable list caches heights by index, so rows that change kind (a section collapsing)
	// need the cache cleared.
	const variableList = useRef<VariableSizeList>(null);
	const heightsKey = heights.join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: heightsKey stands for the heights
	useEffect(() => variableList.current?.resetAfterIndex(0), [heightsKey]);
	return (
		<div className="min-h-0 flex-1">
			<AutoSizer>
				{({ height, width }) => {
					const listHeight = Math.min(
						Math.max(ROW_HEIGHT, height - (footer !== undefined ? FOOTER_HEIGHT : 0) - 2),
						total,
					);
					const initialScrollOffset =
						initialIndex !== undefined
							? Math.max(0, offsetOf(initialIndex) - listHeight / 2)
							: undefined;
					const row = ({ index, style }: { index: number; style: CSSProperties }) => (
						<div style={style}>{renderRow(index)}</div>
					);
					return (
						<div
							className="@container overflow-hidden rounded-xl border border-slate-200 bg-white text-left"
							style={{ width }}
						>
							{rowHeight === undefined ? (
								<FixedSizeList
									height={listHeight}
									width={width - 2}
									itemCount={itemCount}
									itemSize={ROW_HEIGHT}
									initialScrollOffset={initialScrollOffset}
								>
									{row}
								</FixedSizeList>
							) : (
								<VariableSizeList
									ref={variableList}
									height={listHeight}
									width={width - 2}
									itemCount={itemCount}
									itemSize={(i) => heights[i] ?? ROW_HEIGHT}
									initialScrollOffset={initialScrollOffset}
								>
									{row}
								</VariableSizeList>
							)}
							{footer !== undefined && (
								<div className="flex h-8 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3.5 text-xs text-slate-600">
									{footer}
								</div>
							)}
						</div>
					);
				}}
			</AutoSizer>
		</div>
	);
}

/** One entry of an AreaList. A click anywhere on the row opens the entry, except on a button or
 *  link of its own. Delete shows on hover or focus. */
export function AreaListRow({
	area,
	title,
	description,
	fallbackDescription,
	meta,
	extra,
	active,
	to,
	onOpen,
	onDelete,
}: {
	area: Area;
	title: string;
	description?: string;
	/** Shown in place of a missing description, e.g. a generated summary. */
	fallbackDescription?: string;
	/** Shown between the description and `meta`. It may hold its own buttons, which keep their
	 *  clicks. */
	extra?: ReactNode;
	meta?: ReactNode;
	active?: boolean;
	to?: string;
	onOpen?: () => unknown;
	onDelete?: () => unknown;
}) {
	const body = (
		<>
			<span
				aria-hidden="true"
				className={clsx(
					"flex h-7 w-7 shrink-0 items-center justify-center rounded-md [&>svg]:size-3.5",
					area.activeClass,
				)}
			>
				{area.icon}
			</span>
			<span className="flex min-w-0 flex-1 flex-col @3xl:grid @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @3xl:items-center @3xl:gap-6">
				<span className="truncate text-sm font-semibold text-slate-900">{title}</span>
				{description !== undefined && description.trim() !== "" ? (
					<span className="truncate text-xs text-slate-600 @3xl:text-[13px]">{description}</span>
				) : fallbackDescription !== undefined ? (
					<span
						title={fallbackDescription}
						className="truncate text-xs text-slate-500 @3xl:text-[13px]"
					>
						{fallbackDescription}
					</span>
				) : (
					<span className="truncate text-xs text-slate-500 italic @3xl:text-[13px]">
						No description
					</span>
				)}
			</span>
		</>
	);
	const bodyClass =
		"flex min-w-0 flex-1 items-center gap-3 self-stretch text-left outline-none focus-visible:underline";
	const navigate = useNavigate();
	const open = onOpen ?? (to !== undefined ? () => navigate(to) : undefined);
	return (
		<div
			className={clsx(
				"group flex h-full cursor-pointer items-center gap-3 border-b border-slate-100 pl-3 pr-1.5 transition-colors",
				active ? area.tintClass : area.hoverClass,
			)}
			// The types, tags and gaps next to the name open the entry too.
			onClick={(ev) => {
				if (!(ev.target as Element).closest("button, a, input")) open?.();
			}}
		>
			{to !== undefined ? (
				<Link to={to} className={bodyClass}>
					{body}
				</Link>
			) : (
				<button type="button" onClick={onOpen} className={bodyClass}>
					{body}
				</button>
			)}
			{extra !== undefined && <span className="flex min-w-0 shrink items-center">{extra}</span>}
			{meta !== undefined && (
				<span className="shrink-0 text-xs tabular-nums text-slate-600">{meta}</span>
			)}
			{onDelete !== undefined && (
				<button
					type="button"
					aria-label={`Delete ${title}`}
					title="Delete"
					onClick={onDelete}
					className="shrink-0 rounded-md p-1.5 text-slate-500 opacity-0 outline-none transition-opacity hover:bg-red-50 hover:text-red-700 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-red-500 group-hover:opacity-100"
				>
					<TbTrash />
				</button>
			)}
		</div>
	);
}

/** Shown instead of an empty list: what the area is for, and how to start. */
export function AreaEmptyState({
	area,
	title,
	children,
	action,
}: {
	area: Area;
	title: string;
	children: ReactNode;
	action: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
			<span
				aria-hidden="true"
				className={clsx(
					"mb-4 flex h-12 w-12 items-center justify-center rounded-xl [&>svg]:size-6",
					area.activeClass,
				)}
			>
				{area.icon}
			</span>
			<h3 className="text-lg font-semibold text-slate-900">{title}</h3>
			<p className="mt-1 max-w-md text-sm text-slate-600">{children}</p>
			<div className="mt-5">{action}</div>
		</div>
	);
}
