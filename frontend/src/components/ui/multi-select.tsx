/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { LuCheck, LuChevronDown, LuCircleX } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const multiSelectVariants = cva("m-1 transition ease-in-out delay-150 duration-300 py-1", {
	variants: {
		variant: {
			default: "border-foreground/10 drop-shadow-sm text-foreground bg-card hover:bg-card/80",
			secondary:
				"border-foreground/10 bg-secondary text-secondary-foreground hover:bg-secondary/80",
			destructive:
				"border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
			inverted: "inverted",
		},
	},
	defaultVariants: {
		variant: "default",
	},
});

interface MultiSelectFormFieldProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof multiSelectVariants> {
	asChild?: boolean;
	options: {
		label: string | React.ReactNode;
		value: string;
		icon?: React.ComponentType<{ className?: string }>;
	}[];
	defaultValue?: string[];
	disabled?: boolean;
	placeholder: string;
	className?: string;
	onValueChange: (value: string[]) => void;
}

const MultiSelect = React.forwardRef<HTMLButtonElement, MultiSelectFormFieldProps>(
	({ className, variant, options, defaultValue, onValueChange, placeholder, ...props }, ref) => {
		const [selectedValues, setSelectedValues] = React.useState<string[]>(defaultValue ?? []);
		const selectedValuesSet = React.useRef(new Set(selectedValues));
		const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);

		React.useEffect(() => {
			setSelectedValues(defaultValue ?? []);
			selectedValuesSet.current = new Set(defaultValue);
		}, [defaultValue]);

		const handleInputKeyDown = (event: any) => {
			if (event.key === "Enter") {
				setIsPopoverOpen(true);
			}
		};

		const toggleOption = (value: string) => {
			if (selectedValuesSet.current.has(value)) {
				selectedValuesSet.current.delete(value);
				setSelectedValues(selectedValues.filter((v) => v !== value));
			} else {
				selectedValuesSet.current.add(value);
				setSelectedValues([...selectedValues, value]);
			}
			onValueChange([...selectedValuesSet.current]);
		};

		return (
			<Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
				<PopoverTrigger asChild>
					<Button
						ref={ref}
						{...props}
						onClick={() => {
							setIsPopoverOpen(!isPopoverOpen);
						}}
						className="flex w-full max-w-120 px-1 py-1 rounded-md border min-h-8 h-auto items-center justify-between bg-card hover:bg-card"
					>
						{selectedValues.length > 0 ? (
							<div className="flex justify-between items-center w-full max-h-60 overflow-y-scroll p-4 ">
								<div className="flex flex-wrap items-center">
									{selectedValues.map((value) => {
										const option = options.find((o) => o.value === value);
										const IconComponent = option?.icon;
										return (
											<Badge key={value} className={multiSelectVariants({ variant, className })}>
												{IconComponent && <IconComponent className="h-4 w-4 mr-2" />}
												<div className="max-w-[16rem] truncate">{option?.label}</div>
												<LuCircleX
													className="ml-2 h-4 w-4 cursor-pointer"
													onClick={(event: React.MouseEvent<SVGElement, MouseEvent>) => {
														event.stopPropagation();
														toggleOption(value);
													}}
												/>
											</Badge>
										);
									})}
								</div>
								<div className="flex items-center justify-between">
									<LuChevronDown className="h-4 mx-2 cursor-pointer text-muted-foreground" />
								</div>
							</div>
						) : (
							<div className="flex items-center justify-between w-full mx-auto">
								<span className="text-sm text-muted-foreground mx-3">{placeholder}</span>
								<LuChevronDown className="h-4 cursor-pointer text-muted-foreground" />
							</div>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent
					className="w-full p-0 drop-shadow-sm"
					align="start"
					onEscapeKeyDown={() => {
						setIsPopoverOpen(false);
					}}
					onInteractOutside={(event) => {
						if (!event.defaultPrevented) {
							setIsPopoverOpen(false);
						}
					}}
				>
					<Command>
						<CommandInput placeholder="Search..." onKeyDown={handleInputKeyDown} />
						<CommandList>
							<CommandEmpty>No results found.</CommandEmpty>
							<CommandGroup>
								{options.length > 0 && (
									<CommandItem
										onSelect={() => {
											if (selectedValues.length === options.length) {
												setSelectedValues([]);
												selectedValuesSet.current.clear();
												onValueChange([]);
											} else {
												const allOptions = options.map((o) => o.value);
												selectedValuesSet.current = new Set(allOptions);
												setSelectedValues(allOptions);
												onValueChange(allOptions);
											}
										}}
									>
										<div
											className={cn(
												"mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
												selectedValues.length === options.length
													? "bg-primary text-primary-foreground"
													: "opacity-50 [&_svg]:invisible",
											)}
										>
											<LuCheck className="h-4 w-4" />
										</div>
										<span className="font-semibold">Select All</span>
									</CommandItem>
								)}
								{options.map((option) => {
									const isSelected = selectedValuesSet.current.has(option.value);
									return (
										<CommandItem
											key={option.value}
											onSelect={() => toggleOption(option.value)}
											style={{
												pointerEvents: "auto",
												opacity: 1,
											}}
											className="cursor-pointer"
										>
											<div
												className={cn(
													"mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
													isSelected
														? "bg-primary text-primary-foreground"
														: "opacity-50 [&_svg]:invisible",
												)}
											>
												<LuCheck className="h-4 w-4" />
											</div>
											{option.icon && (
												<option.icon className="mr-2 h-4 w-4 text-muted-foreground" />
											)}
											<span>{option.label}</span>
										</CommandItem>
									);
								})}
							</CommandGroup>
							<CommandSeparator />
							<CommandGroup>
								<div className="flex items-center justify-between">
									{selectedValues.length > 0 && (
										<>
											<CommandItem
												onSelect={() => {
													setSelectedValues([]);
													selectedValuesSet.current.clear();
													onValueChange([]);
												}}
												style={{
													pointerEvents: "auto",
													opacity: 1,
												}}
												className="flex-1 justify-center cursor-pointer"
											>
												Clear
											</CommandItem>
											<Separator orientation="vertical" className="flex min-h-6 h-full" />
										</>
									)}
									<CommandSeparator />
									<CommandItem
										onSelect={() => setIsPopoverOpen(false)}
										style={{
											pointerEvents: "auto",
											opacity: 1,
										}}
										className="flex-1 justify-center cursor-pointer"
									>
										Close
									</CommandItem>
								</div>
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		);
	},
);

MultiSelect.displayName = "MultiSelectFormField";

export default MultiSelect;
