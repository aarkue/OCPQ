import type { ReactNode } from "react";
import { BsDatabase } from "react-icons/bs";
import { CgArrowsExpandUpRight } from "react-icons/cg";
import { PiGraphFill } from "react-icons/pi";
import { TbBinaryTree, TbTable } from "react-icons/tb";
import { useLocation } from "react-router-dom";
import MenuLink from "@/components/MenuLink";
import { UpdateButton } from "@/components/UpdateButton";
import type { OCELInfo } from "@/types/ocel";

interface SidebarProps {
	ocelInfo: OCELInfo | undefined;
	backendAvailable: boolean;
	children?: ReactNode;
}

export function Sidebar({ ocelInfo, backendAvailable, children }: SidebarProps) {
	const location = useLocation();
	const isAtRoot = location.pathname === "/";

	return (
		<div className="border-r border-r-slate-300 px-2 overflow-auto">
			<img src="/favicon.png" className="w-28 h-28 mx-auto mt-4 mb-2" alt="OCPQ Logo" />
			<h2 className="font-black text-3xl bg-clip-text text-transparent bg-linear-to-r from-slate-800 to-sky-600 tracking-tighter">
				OCPQ
			</h2>
			<div className="flex flex-col gap-2 mt-1 text-xs">
				{ocelInfo != null && <OcelInfoSummary ocelInfo={ocelInfo} />}
				<NavigationLinks ocelInfo={ocelInfo} />
				<br />
				{!isAtRoot && (
					<MenuLink
						to="/"
						classNames="text-xs text-center bg-transparent border-transparent justify-center hover:bg-sky-50"
					>
						Load another dataset
					</MenuLink>
				)}
				<UpdateButton />
				{children}
			</div>
			<BackendStatus available={backendAvailable} />
		</div>
	);
}

function OcelInfoSummary({ ocelInfo }: { ocelInfo: OCELInfo }) {
	return (
		<span className="flex flex-col items-center mx-auto text-sm leading-tight">
			<span className="font-semibold text-green-700">OCEL loaded</span>
			<span className="text-xs grid grid-cols-[auto_1fr] text-right gap-x-2 leading-tight items-baseline">
				<span className="font-mono">{ocelInfo.num_events}</span>
				<span className="text-left">Events</span>
				<span className="font-mono">{ocelInfo.num_objects}</span>
				<span className="text-left">Objects</span>
			</span>
		</span>
	);
}

function NavigationLinks({ ocelInfo }: { ocelInfo: OCELInfo | undefined }) {
	return (
		<div className="flex flex-col gap-y-1 w-48 mx-auto">
			<MenuLink
				to="/data-extraction"
				classNames="bg-sky-300/20 border-sky-300/30 hover:bg-sky-300/60 [.active]:border-sky-400 [.active]:bg-sky-300/70 mb-2 relative"
			>
				<div className="absolute -top-4 text-xs font-semibold text-pink-900 bg-pink-300 p-0.5 px-1 right-1 rounded-md border border-pink-400">
					Beta
				</div>
				Extraction Blueprints
				<BsDatabase className="ml-2" />
			</MenuLink>
			{ocelInfo != null && (
				<>
					<MenuLink
						to="/ocel-info"
						classNames="bg-blue-300/10 border-blue-300/20 hover:bg-blue-300/50 [.active]:border-blue-400 [.active]:bg-blue-300/70"
					>
						OCEL Info
						<TbTable className="ml-2" />
					</MenuLink>
					<MenuLink
						to="/graph"
						classNames="bg-sky-300/10 border-sky-300/20 hover:bg-sky-300/50 [.active]:border-sky-400 [.active]:bg-sky-300/70"
					>
						Relationship Graph
						<PiGraphFill className="ml-2" />
					</MenuLink>
					<br className="my-1" />
					<MenuLink
						classNames="bg-purple-300/20 border-purple-300/30 hover:bg-purple-300/70 [.active]:border-purple-400 [.active]:bg-purple-300/80"
						to="/constraints"
					>
						OCPQ (Queries)
						<TbBinaryTree className="ml-2" />
					</MenuLink>
					<MenuLink
						to="/oc-declare"
						classNames="bg-emerald-300/20 border-emerald-300/30 hover:bg-emerald-300/60 [.active]:border-emerald-400 [.active]:bg-emerald-300/70"
					>
						OC-DECLARE
						<CgArrowsExpandUpRight className="ml-2 rotate-45" />
					</MenuLink>
				</>
			)}
		</div>
	);
}

function BackendStatus({ available }: { available: boolean }) {
	return (
		<div className="text-xs">
			{available ? (
				<span className="text-green-700 font-semibold bg-green-200 w-fit mx-auto p-1 rounded">
					Backend online
				</span>
			) : (
				<span className="text-red-700 font-semibold bg-red-200 w-fit mx-auto p-1 rounded">
					Backend offline
				</span>
			)}
		</div>
	);
}
