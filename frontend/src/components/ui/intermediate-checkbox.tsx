import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Cross1Icon } from "@radix-ui/react-icons";
import * as React from "react";
import { LuMinus } from "react-icons/lu";
import { cn } from "@/lib/utils";

const IndeterminateCheckbox = React.forwardRef<
	React.ElementRef<typeof CheckboxPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
		state: "unchecked" | "checked" | "indeterminate";
		newState: (newState: "unchecked" | "checked" | "indeterminate") => unknown;
	}
>(({ className, ...props }, ref) => (
	<CheckboxPrimitive.Root
		ref={ref}
		className={cn(
			"peer h-4 w-4 shrink-0 rounded-sm border border-gray-500 shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 bg-green-200 data-[state=checked]:bg-red-400 data-[state=checked]:border-red-500 data-[state=checked]:text-primary-foreground",
			props.state === "indeterminate" && "bg-gray-200",
			className,
		)}
		checked={props.state === "checked"}
		onCheckedChange={() => {
			if (props.state === "unchecked") {
				props.newState("indeterminate");
			} else if (props.state === "checked") {
				props.newState("unchecked");
			} else {
				props.newState("checked");
			}
		}}
		title={props.title}
		// {...props}
	>
		{props.state === "indeterminate" && <LuMinus />}
		<CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
			<Cross1Icon className="h-4 w-4" />
		</CheckboxPrimitive.Indicator>
	</CheckboxPrimitive.Root>
));
IndeterminateCheckbox.displayName = `${CheckboxPrimitive.Root.displayName}IndeterminateCheckbox`;

export { IndeterminateCheckbox };
