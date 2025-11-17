import { Link, NavLink } from "react-router-dom";
import { buttonVariants } from "./ui/button";
import { type ReactNode } from "react";
import clsx, { type ClassValue } from "clsx";
type MenuLinkProps = {
  to: string;
  children: ReactNode;
  classNames?: string;
  onClick?: (ev: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => any;
};
export default function MenuLink(props: MenuLinkProps) {
  return (
    <NavLink
      className={({ isActive }) => clsx("rounded text-sm bg-blue-100/50 hover:border-blue-400   border-sky-200  border flex items-center justify-between px-2 py-1",
         !isActive && "font-medium", isActive && "font-bold", props.classNames)}
      onClick={props.onClick}
      to={props.to}
    >
      {props.children}
    </NavLink>
  );
}
