import { type Edge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { useContext, useEffect, useRef, useState } from "react";
import { LuPen, LuTrash } from "react-icons/lu";
import { Button } from "@/components/ui/button";

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuPortal,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import QuantifiedObjectEdge from "./QuantifiedObjectEdge";
import type { EventTypeLinkData } from "./types";
import { VisualEditorContext } from "./VisualEditorContext";

export default function EventTypeLink(props: EdgeProps<Edge<EventTypeLinkData>>) {
	const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
	// TODO: Fix, currently needs to be calculated twice
	const [_edgePath, labelX, labelY] = getBezierPath({
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
	});
	const initial = useRef(true);
	const { onEdgeDataChange, getAvailableChildNames } = useContext(VisualEditorContext);
	useEffect(() => {
		if (initial.current && data === undefined) {
			const namesUsedAlready = getAvailableChildNames(props.source ?? "");
			const baseCode = "A".charCodeAt(0);
			let i = 0;
			while (namesUsedAlready.includes(String.fromCharCode(baseCode + i)) && i < 25) {
				i++;
			}
			onEdgeDataChange(id, {
				color: "#969696",
				maxCount: null,
				minCount: null,
				name: String.fromCharCode(baseCode + i),
			});
		}
		initial.current = false;
	}, [data, getAvailableChildNames, id, onEdgeDataChange, props.source]);
	const [dialogOpen, setDialogOpen] = useState(false);
	return (
		<>
			<QuantifiedObjectEdge {...props} />
			<EdgeLabelRenderer>
				<ContextMenu>
					<ContextMenuTrigger id={`edge-context-menu-${id}`}>
						<div
							style={{
								position: "absolute",
								transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
								fontSize: 12,
								pointerEvents: "all",
							}}
							className="nodrag nopan flex flex-col items-center -mt-1"
						>
							{data !== undefined && (
								<NameChangeDialog
									open={dialogOpen}
									onOpenChange={(o) => setDialogOpen(o)}
									data={data}
									onChange={(name) => {
										onEdgeDataChange(id, { name });
									}}
								/>
							)}
						</div>
					</ContextMenuTrigger>
					<ContextMenuPortal>
						<ContextMenuContent>
							<ContextMenuItem>Cancel</ContextMenuItem>
							<ContextMenuItem
								onSelect={(_ev) => {
									// ev.preventDefault();
									// ev.stopPropagation();
									setTimeout(() => {
										setDialogOpen(true);
									}, 100);
								}}
							>
								<LuPen className="mr-1" /> Edit Name
							</ContextMenuItem>
							<ContextMenuItem
								onSelect={() => {
									onEdgeDataChange(id, undefined);
								}}
								className="font-semibold text-red-400 focus:text-red-500"
							>
								<LuTrash className="mr-1" /> Delete Edge
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenuPortal>
				</ContextMenu>
			</EdgeLabelRenderer>
		</>
	);
}

function NameChangeDialog({
	data,
	onChange,
	open,
	onOpenChange,
}: {
	data: EventTypeLinkData;
	onChange: (newName: string | undefined) => unknown;
	open: boolean;
	onOpenChange: (nowOpen: boolean) => unknown;
}) {
	const [name, setName] = useState(data.name);
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (open) {
			inputRef.current?.focus();
		}
	}, [open]);
	return (
		<Dialog open={open} onOpenChange={onOpenChange} modal={true}>
			<DialogTrigger asChild>
				<button
					className="w-fit min-w-6 h-6 flex items-center justify-center px-1 font-bold text-sm rounded-full bg-blue-50/60 hover:bg-blue-200/70"
					title="Update Name..."
				>
					{name ?? "-"}
				</button>
			</DialogTrigger>
			<DialogPortal>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Update Name</DialogTitle>
						<DialogDescription>Update the name of the edge.</DialogDescription>
					</DialogHeader>
					<h3>Name</h3>
					<Input
						autoFocus
						ref={inputRef}
						type="text"
						className="w-full"
						placeholder="Name"
						value={name ?? ""}
						onKeyDown={(ev) => {
							if (ev.key === "Enter") {
								onChange(name);
								onOpenChange(false);
							}
						}}
						onChange={(ev) => {
							if (ev.currentTarget.value === "") {
								setName(undefined);
							} else {
								setName(ev.currentTarget.value);
							}
						}}
					/>
					<DialogClose asChild>
						<Button
							type="button"
							variant="secondary"
							onClick={() => {
								onChange(name);
							}}
						>
							Save
						</Button>
					</DialogClose>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}
