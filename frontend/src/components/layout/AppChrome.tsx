import clsx from "clsx";
import type { ReactNode } from "react";
import { LuSearch } from "react-icons/lu";
import { Link, NavLink, useLocation } from "react-router-dom";
import { UpdateButton } from "@/components/UpdateButton";
import { MOD_KEY } from "@/lib/platform";
import type { OCELInfo } from "@/types/ocel";
import { AREAS, areaOfPathname } from "./areas";

export function TopBar({
	ocelInfo,
	backendAvailable,
	onOpenSearch,
	children,
}: {
	ocelInfo: OCELInfo | undefined;
	backendAvailable: boolean;
	onOpenSearch: () => unknown;
	children?: ReactNode;
}) {
	const { pathname } = useLocation();
	const isAtRoot = pathname === "/";
	const area = areaOfPathname(pathname);
	return (
		<header className="h-14 shrink-0 bg-white border-b border-slate-200 flex items-center gap-5 px-4 text-sm">
			<div className="flex items-center gap-3 shrink-0">
				<Link
					to="/"
					className="flex items-center gap-2.5 shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
					title="Load a dataset"
				>
					<img src="/favicon.png" className="w-9 h-9" alt="" />
					<span className="font-black text-2xl tracking-tight text-slate-900">OCPQ</span>
				</Link>
				{area !== undefined && (
					<>
						<span aria-hidden="true" className="text-2xl font-light text-slate-300">
							/
						</span>
						<h2
							className={clsx(
								"truncate pb-0.5 text-2xl leading-tight font-black tracking-tight bg-clip-text text-transparent",
								area.gradientClass,
							)}
						>
							{area.title}
						</h2>
					</>
				)}
			</div>
			{ocelInfo !== undefined && (
				<div className="flex items-center gap-4 min-w-0 h-8 pl-5 border-l border-slate-200">
					<span className="flex items-center gap-2 shrink-0">
						<span className="w-2 h-2 rounded-full bg-green-600" />
						<span>
							<span className="font-semibold tabular-nums text-slate-900">
								{ocelInfo.num_events.toLocaleString()}
							</span>{" "}
							<span className="text-slate-600">events</span>
						</span>
					</span>
					<span className="shrink-0">
						<span className="font-semibold tabular-nums text-slate-900">
							{ocelInfo.num_objects.toLocaleString()}
						</span>{" "}
						<span className="text-slate-600">objects</span>
					</span>
					{!isAtRoot && (
						<Link
							to="/"
							className="hidden 2xl:inline text-sky-700 font-medium underline-offset-4 hover:underline shrink-0"
						>
							Load another
						</Link>
					)}
				</div>
			)}
			<span className="flex-1" />
			{ocelInfo !== undefined && (
				<button
					type="button"
					onClick={onOpenSearch}
					className="flex items-center gap-2.5 h-9 w-96 max-w-[28vw] min-w-0 shrink rounded-lg border border-slate-200 bg-slate-50 px-3 text-slate-600 text-left transition-colors hover:bg-white hover:border-slate-300 outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
				>
					<LuSearch className="shrink-0 text-slate-700" />
					<span className="flex-1 truncate">Search types, events, objects…</span>
					<kbd className="rounded border border-slate-200 bg-white px-1.5 text-[11px] font-medium text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.06)]">
						{MOD_KEY} K
					</kbd>
				</button>
			)}
			<span className="flex-1" />
			<UpdateButton />
			{children}
			<span
				className={clsx(
					"flex items-center gap-1.5 text-xs font-semibold shrink-0",
					backendAvailable ? "text-green-700" : "text-red-700",
				)}
			>
				<span
					className={clsx("w-2 h-2 rounded-full", backendAvailable ? "bg-green-600" : "bg-red-600")}
				/>
				{backendAvailable ? "Backend online" : "Backend offline"}
			</span>
		</header>
	);
}

export function AreaRail({ ocelLoaded }: { ocelLoaded: boolean }) {
	return (
		<nav
			aria-label="Areas"
			className="w-[76px] shrink-0 bg-white border-r border-slate-200 flex flex-col items-center gap-1.5 py-3"
		>
			{AREAS.filter((a) => ocelLoaded || !a.needsOcel).map((area) => (
				<NavLink
					key={area.to}
					to={area.to}
					className={({ isActive }) =>
						clsx(
							"w-16 flex flex-col items-center gap-1.5 rounded-xl py-2.5 text-[11px] leading-none transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
							isActive ? `${area.activeClass} font-semibold` : `text-slate-600 ${area.hoverClass}`,
						)
					}
				>
					{({ isActive }) => (
						<>
							<span className={clsx("flex", !isActive && area.iconClass)}>{area.icon}</span>
							{area.label}
						</>
					)}
				</NavLink>
			))}
		</nav>
	);
}
