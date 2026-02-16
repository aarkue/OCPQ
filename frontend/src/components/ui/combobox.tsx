/* eslint-disable @typescript-eslint/strict-boolean-expressions */

import { PopoverPortal } from "@radix-ui/react-popover";
import * as React from "react";
import { RxCheck, RxChevronUp } from "react-icons/rx";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ComboboxProps {
	options: { value: string; label: string | React.FC }[];
	onChange: (value: string) => unknown;
	name: string;
	value: string;
	disabled?: boolean | undefined;
	title?: string | undefined;
}
export function Combobox({ options, onChange, name, value, disabled, title }: ComboboxProps) {
	const [open, setOpen] = React.useState(false);
	const SelOption = value ? options.find((o) => o.value === value)?.label : name;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild disabled={disabled}>
				<Button
					title={title}
					disabled={disabled}
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className="w-fit min-w-fit justify-between"
				>
					{typeof SelOption === "string" ? SelOption : null}
					{typeof SelOption === "function" && <SelOption />}
					<RxChevronUp className="ml-2 h-4 w-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverPortal>
				<PopoverContent
					className="w-full min-w-fit p-0 max-h-[40vh] overflow-auto"
					side="bottom"
					align="start"
				>
					<Command>
						<CommandInput placeholder="Search..." />
						<CommandEmpty>No option found.</CommandEmpty>
						<CommandGroup>
							{options.map((o) => (
								<CommandItem
									key={o.value}
									value={o.value.toLowerCase()}
									onSelect={() => {
										onChange(o.value === value ? "" : o.value);
										setOpen(false);
									}}
								>
									<RxCheck
										className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")}
									/>
									{typeof o.label === "string" && o.label}
									{typeof o.label === "function" && <o.label />}
								</CommandItem>
							))}
						</CommandGroup>
					</Command>
				</PopoverContent>
			</PopoverPortal>
		</Popover>
	);
}
