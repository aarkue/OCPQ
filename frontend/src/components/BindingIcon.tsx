import type { SVGProps } from "react";

/** A row with a lens, for opening one result row. Drawn like the lucide icons next to it. */
export function BindingIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			viewBox="0 0 24 24"
			width="1em"
			height="1em"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			{...props}
		>
			<rect x="2" y="8" width="13" height="8" rx="2" />
			<circle cx="18" cy="15" r="3" />
			<path d="m22 19-1.8-1.8" />
		</svg>
	);
}
