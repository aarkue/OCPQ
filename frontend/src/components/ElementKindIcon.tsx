import clsx from "clsx";
import { LuBox } from "react-icons/lu";
import { MdEvent } from "react-icons/md";

export function ElementKindIcon({ isEvent, className }: { isEvent: boolean; className?: string }) {
	return isEvent ? (
		<MdEvent className={clsx("shrink-0 text-muted-foreground", className)} title="Event" />
	) : (
		<LuBox className={clsx("shrink-0 text-muted-foreground", className)} title="Object" />
	);
}
