import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { LuCheck } from "react-icons/lu";
import { cn } from "@/lib/utils";

export interface CardTypeSelectorOption<T extends string> {
	value: T;
	title: string;
	description?: string;
	icon?: React.ReactNode;
	/** If true, the option is greyed out but still selectable */
	softDisabled?: boolean;
}

interface CardTypeSelectorProps<T extends string> {
	options: CardTypeSelectorOption<T>[];
	value: T;
	onValueChange: (value: T) => void;
	children?: React.ReactNode;
	className?: string;
	/** Number of columns for the card grid (default: auto based on count) */
	columns?: 2 | 3 | 4;
}

function CardTypeSelector<T extends string>({
	options,
	value,
	onValueChange,
	children,
	className,
	columns,
}: CardTypeSelectorProps<T>) {
	const gridCols = columns ?? (options.length <= 3 ? options.length : 3);

	return (
		<TabsPrimitive.Root
			value={value}
			onValueChange={(v) => onValueChange(v as T)}
			className={cn("w-full", className)}
		>
			<TabsPrimitive.List
				className={cn(
					"grid gap-2 mb-4",
					gridCols === 2 && "grid-cols-2",
					gridCols === 3 && "grid-cols-3",
					gridCols === 4 && "grid-cols-4",
				)}
			>
				{options.map((option) => (
					<TabsPrimitive.Trigger
						key={option.value}
						value={option.value}
						className={cn(
							"relative flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-all",
							"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
							option.softDisabled
								? "opacity-50 border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300"
								: [
										"hover:bg-slate-50 hover:border-slate-300",
										"data-[state=active]:border-sky-500 data-[state=active]:bg-sky-50/50",
										"data-[state=inactive]:border-slate-200 data-[state=inactive]:bg-white",
									],
						)}
					>
						<div className="flex items-center gap-2 w-full">
							{option.icon && (
								<span
									className={cn(
										"shrink-0",
										option.softDisabled ? "text-slate-400" : "text-slate-600",
									)}
								>
									{option.icon}
								</span>
							)}
							<span
								className={cn(
									"font-medium text-sm truncate",
									option.softDisabled ? "text-slate-500" : "text-slate-900",
								)}
							>
								{option.title}
							</span>
							<span
								className={cn(
									"ml-auto shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
									value === option.value
										? option.softDisabled
											? "border-slate-400 bg-slate-400"
											: "border-sky-500 bg-sky-500"
										: option.softDisabled
											? "border-slate-300 bg-slate-100"
											: "border-slate-300 bg-white",
								)}
							>
								{value === option.value && <LuCheck className="w-2.5 h-2.5 text-white" />}
							</span>
						</div>
						{option.description && (
							<span
								className={cn(
									"text-xs line-clamp-2",
									option.softDisabled ? "text-slate-400" : "text-slate-500",
								)}
							>
								{option.description}
							</span>
						)}
					</TabsPrimitive.Trigger>
				))}
			</TabsPrimitive.List>
			{children}
		</TabsPrimitive.Root>
	);
}

const CardTypeSelectorContent = React.forwardRef<
	React.ElementRef<typeof TabsPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Content
		ref={ref}
		className={cn(
			"rounded-lg border border-slate-200 bg-slate-50/50 p-4",
			"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
			className,
		)}
		{...props}
	/>
));
CardTypeSelectorContent.displayName = "CardTypeSelectorContent";

export { CardTypeSelector, CardTypeSelectorContent };
