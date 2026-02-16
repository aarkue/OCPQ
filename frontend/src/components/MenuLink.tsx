import clsx from "clsx";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

type MenuLinkProps = {
	to: string;
	children: ReactNode;
	classNames?: string;
	onClick?: (ev: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => any;
};
export default function MenuLink(props: MenuLinkProps) {
	return (
		<NavLink
			className={({ isActive }) =>
				clsx(
					"rounded text-sm   border flex items-center justify-between px-2 py-1",
					!isActive && "font-medium",
					isActive && "font-bold active",
					props.classNames,
				)
			}
			onClick={props.onClick}
			to={props.to}
		>
			{props.children}
		</NavLink>
	);
}
