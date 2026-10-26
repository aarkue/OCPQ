import { colorForKey } from "@r4pm/components";
import { cn } from "@/lib/utils";

/** The color r4pm gives an event or object type, so charts, graphs and lists agree. */
export function typeColor(isEvent: boolean, name: string) {
	return colorForKey(isEvent ? "activity" : "objectType", name) ?? "#64748b";
}

export function TypeDot({
	isEvent,
	name,
	className,
}: {
	isEvent: boolean;
	name: string;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn("w-2.5 h-2.5 rounded-full shrink-0", className)}
			style={{ backgroundColor: typeColor(isEvent, name) }}
		/>
	);
}
