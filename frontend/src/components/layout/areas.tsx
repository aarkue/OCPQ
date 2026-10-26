import type { ReactNode } from "react";
import { BsDatabase } from "react-icons/bs";
import { CgArrowsExpandUpRight } from "react-icons/cg";
import { PiGraphFill } from "react-icons/pi";
import { TbBinaryTree, TbRoute, TbTable } from "react-icons/tb";

export type Area = {
	to: string;
	label: string;
	icon: ReactNode;
	/** Only reachable once a log is loaded. */
	needsOcel: boolean;
	/** The area's color on an otherwise neutral surface: icons and small marks. */
	iconClass: string;
	/** Light fill for hover and for content that belongs to the area. */
	tintClass: string;
	hoverClass: string;
	/** The selected rail entry, or a badge in the area's color. */
	activeClass: string;
	/** Filled primary action of the area's pages. */
	buttonClass: string;
	/** Background of the area's gradient page title, clipped to the text. */
	gradientClass: string;
	/** Page title, shown in the top bar next to the logo. */
	title: string;
};

export const AREAS: Area[] = [
	{
		to: "/data-extraction",
		label: "Extraction",
		title: "Data Extraction Blueprints",
		icon: <BsDatabase size={18} />,
		needsOcel: false,
		iconClass: "text-sky-700",
		tintClass: "bg-sky-50",
		hoverClass: "hover:bg-sky-50",
		activeClass: "bg-sky-100 text-sky-900",
		buttonClass: "bg-sky-700 text-white hover:bg-sky-800 focus-visible:ring-sky-500",
		gradientClass: "bg-linear-to-t from-sky-500 to-blue-700",
	},
	{
		to: "/ocel-info",
		label: "OCEL Info",
		title: "OCEL Info",
		icon: <TbTable size={20} />,
		needsOcel: true,
		iconClass: "text-blue-700",
		tintClass: "bg-blue-50",
		hoverClass: "hover:bg-blue-50",
		activeClass: "bg-blue-100 text-blue-900",
		buttonClass: "bg-blue-700 text-white hover:bg-blue-800 focus-visible:ring-blue-500",
		gradientClass: "bg-linear-to-t from-blue-500 to-indigo-700",
	},
	{
		to: "/graph",
		label: "Graph",
		title: "Relationship Graph",
		icon: <PiGraphFill size={20} />,
		needsOcel: true,
		iconClass: "text-sky-700",
		tintClass: "bg-sky-50",
		hoverClass: "hover:bg-sky-50",
		activeClass: "bg-sky-100 text-sky-900",
		buttonClass: "bg-sky-700 text-white hover:bg-sky-800 focus-visible:ring-sky-500",
		gradientClass: "bg-linear-to-t from-cyan-500 to-sky-700",
	},
	{
		to: "/path-schemas",
		label: "Paths",
		title: "Path Schemas",
		icon: <TbRoute size={20} />,
		needsOcel: true,
		iconClass: "text-amber-700",
		tintClass: "bg-amber-50",
		hoverClass: "hover:bg-amber-50",
		activeClass: "bg-amber-100 text-amber-900",
		buttonClass: "bg-amber-700 text-white hover:bg-amber-800 focus-visible:ring-amber-500",
		gradientClass: "bg-linear-to-t from-amber-500 to-orange-700",
	},
	{
		to: "/constraints",
		label: "Queries",
		title: "Queries",
		icon: <TbBinaryTree size={20} />,
		needsOcel: true,
		iconClass: "text-purple-700",
		tintClass: "bg-purple-50",
		hoverClass: "hover:bg-purple-50",
		activeClass: "bg-purple-100 text-purple-900",
		buttonClass: "bg-purple-700 text-white hover:bg-purple-800 focus-visible:ring-purple-500",
		gradientClass: "bg-linear-to-t from-violet-500 to-purple-700",
	},
	{
		to: "/oc-declare",
		label: "Declare",
		title: "OC-DECLARE",
		icon: <CgArrowsExpandUpRight size={20} className="rotate-45" />,
		needsOcel: true,
		iconClass: "text-emerald-700",
		tintClass: "bg-emerald-50",
		hoverClass: "hover:bg-emerald-50",
		activeClass: "bg-emerald-100 text-emerald-900",
		buttonClass: "bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-500",
		gradientClass: "bg-linear-to-t from-emerald-500 to-teal-700",
	},
];

export function areaFor(path: string): Area {
	return AREAS.find((a) => a.to === path) ?? AREAS[1];
}

/** The area a route belongs to, if any. */
export function areaOfPathname(pathname: string): Area | undefined {
	return AREAS.find((a) => pathname === a.to || pathname.startsWith(`${a.to}/`));
}
