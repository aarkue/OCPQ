import { Theme } from "@r4pm/components/ui";
import type React from "react";
import type { ReactNode } from "react";

function usePrefersDark(): boolean {
	// Currently no support for dark mode in OCPQ
	return false;
}

/** Scopes propel @r4pm/components (radix Themes based) inside OCPQ's own (shadcn) UI.
 *  Wrap each propel-component usage so its radix tokens apply locally, not app-wide.
 *  `minHeight: 0` overrides radix's `.radix-themes { min-height: 100vh }`, which otherwise
 *  stretches the island to full viewport height inside dialogs/panels. */
export function R4pmIsland({
	children,
	className,
	style,
}: {
	children: ReactNode;
	className?: string;
	style?: React.CSSProperties;
}) {
	const dark = usePrefersDark();
	return (
		<Theme
			appearance={dark ? "dark" : "light"}
			hasBackground={false}
			className={className}
			style={{ minHeight: 0, ...style }}
		>
			{children}
		</Theme>
	);
}
