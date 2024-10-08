import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon, Cross1Icon } from "@radix-ui/react-icons";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    crossicon?: boolean;
  }
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50  data-[state=checked]:text-primary-foreground",
      props.crossicon !== true && "data-[state=checked]:bg-primary",
      props.crossicon === true &&
        "data-[state=checked]:bg-red-300 disabled:opacity-100 border-green-400 data-[state=checked]:border-red-400 bg-green-100",
      // props.crossIcon === true && props.checked !== true && "data-[state=checked]:bg-green-300 disabled:opacity-100 border-green-400",
      className,
    )}
    title={props.title}
    checked={props.checked}
    disabled={props.disabled}
    // {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      {props.crossicon === true && <Cross1Icon className="h-4 w-4" />}
      {props.crossicon !== true && <CheckIcon className="h-4 w-4" />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
