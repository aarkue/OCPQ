import { Handle, type NodeProps, Position, useConnection, useReactFlow } from "@xyflow/react";
import clsx from "clsx";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { MdBarChart } from "react-icons/md";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useOcelInfo } from "@/hooks/useOcelInfo";
import { InfoSheetContext } from "@/InfoSheet";
import { getRandomStringColor } from "@/lib/random-colors";
import type { ActivityNodeType } from "./oc-declare-flow-types";

const OBJECT_INIT = "<init>";
const OBJECT_EXIT = "<exit>";
export function OCDeclareFlowNode({ id, data, selected }: NodeProps<ActivityNodeType>) {
	const [editMode, setEditMode] = useState(false);
	const { setNodes } = useReactFlow();
	const contentEditableDiv = useRef<HTMLDivElement>(null);

	const connection = useConnection();
	const flow = useReactFlow();
	const { setInfoSheetState } = useContext(InfoSheetContext);

	const isTarget = connection.inProgress && connection.fromNode.id !== id;
	function applyNameEdit(
		ev: React.FocusEvent<HTMLDivElement, Element> | React.MouseEvent<HTMLDivElement, MouseEvent>,
	) {
		// Use innerHTML instead of innerText to avoid stripping whitespaces
		const newName = ev.currentTarget.innerHTML.includes("&")
			? ev.currentTarget.innerText
			: ev.currentTarget.innerHTML;
		const objectMode = newName.includes(OBJECT_INIT)
			? "init"
			: ev.currentTarget.innerText.includes(OBJECT_EXIT)
				? "exit"
				: undefined;
		const newLabel = newName
			.replace("\n", "")
			.replace(`${OBJECT_INIT} `, "")
			.replace(`${OBJECT_EXIT} `, "");
		setEditMode(false);
		setNodes((nodes) => {
			const newNodes = [...nodes];
			newNodes.map((n) => {
				if (n.id === id) {
					n.data = { type: newLabel || "-", isObject: objectMode };
				}
				return n;
			});
			return newNodes;
		});
	}

	useEffect(() => {
		if (editMode && contentEditableDiv.current) {
			contentEditableDiv.current.focus();
			const range = document.createRange();
			const sel = window.getSelection();
			range.selectNodeContents(contentEditableDiv.current);
			if (sel) {
				sel.removeAllRanges();
				sel.addRange(range);
				contentEditableDiv.current.focus();
			}
			setTimeout(() => {
				contentEditableDiv.current!.focus();
			}, 200);
		}
	}, [editMode]);

	const objectColor = useMemo(() => {
		return data.isObject ? getRandomStringColor(data.type) : undefined;
	}, [data.isObject, data.type]);
	const contextMenuTriggerRef = useRef<HTMLButtonElement>(null);
	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger className="pointer-events-auto hidden" asChild>
					<button ref={contextMenuTriggerRef} />
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem
						className=""
						onClick={(ev) => {
							ev.stopPropagation();
							setInfoSheetState({
								type: "activity-frequencies",
								activity:
									data.isObject === "init"
										? `<init> ${data.type}`
										: data.isObject === "exit"
											? `<exit> ${data.type}`
											: data.type,
							});
						}}
					>
						<MdBarChart className="size-4 mr-1" />
						View Statistics
					</ContextMenuItem>
					<ContextMenuItem
						className=""
						onClick={(ev) => {
							ev.stopPropagation();
							setEditMode(true);
						}}
					>
						Edit Type
					</ContextMenuItem>
					<ContextMenuItem
						className="text-red-600 hover:focus:text-red-500"
						onClick={(ev) => {
							ev.stopPropagation();
							flow.deleteElements({ nodes: [{ id }] });
						}}
					>
						Delete Node
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<div
				onContextMenuCapture={(ev) => {
					if (contextMenuTriggerRef.current && !editMode) {
						contextMenuTriggerRef.current.dispatchEvent(
							new MouseEvent("contextmenu", {
								bubbles: true,
								cancelable: true,
								clientX: ev.clientX,
								clientY: ev.clientY,
							}),
						);
						ev.preventDefault();
						// ev.stopPropagation();
					}
				}}
				// w-16 and h-8 for small demo images
				className={clsx(
					false && "h-8! min-h-8! w-16! hidden",
					"group border-2  w-28 py-1 px-1 flex items-center justify-center relative min-h-[3.66rem] h-fit bg-white rounded group",
					!data.isObject && "border-(--arrow-primary)",
					selected && "shadow-lg",
				)}
				style={{ borderColor: objectColor }}
			>
				<div
					className={clsx(
						"border text-center border-transparent flex items-center min-h-8 w-[calc(100%-1rem)]  drag-handle__custom group-hover:border-dashed group-hover:border-gray-300/50 z-2",
						connection.inProgress && "pointer-events-none",
					)}
				>
					<div
						contentEditable={editMode}
						ref={contentEditableDiv}
						className="w-full text-xs pointer-events-auto leading-tight h-full min-h-8 content-center"
						suppressContentEditableWarning={true}
						onKeyDownCapture={(ev) => {
							if (ev.key === "Enter") {
								ev.preventDefault();
								ev.stopPropagation();
								ev.currentTarget.blur();
							}
						}}
						onMouseDownCapture={(ev) => {
							if (editMode) {
								ev.stopPropagation();
							}
						}}
						onDoubleClick={(ev) => {
							if (editMode) {
								// ev.preventDefault();
								// applyNameEdit(ev);
								ev.stopPropagation();
							} else {
								setEditMode(true);
							}
						}}
						onBlur={(ev) => {
							if (ev.relatedTarget?.role === "menuitem") {
								ev.preventDefault();
								ev.stopPropagation();
								contentEditableDiv.current!.focus();
								return;
							}
							applyNameEdit(ev);
						}}
						spellCheck="false"
						style={{
							overflowWrap: "break-word",
							cursor: editMode ? "text" : undefined,
							overflowY: "hidden",
							// maxWidth: "6rem",
							// minWidth: "4rem",
							// minHeight: "1.5rem",
							display: "block",
							marginInline: "auto",
							textAlign: "center",
							zIndex: 10,
							position: "relative",
						}}
					>
						{(data.isObject === "init" ? "<init> " : data.isObject === "exit" ? "<exit> " : "") +
							data.type}
					</div>
				</div>
				{!connection.inProgress && (
					<Handle className="fullHandle" position={Position.Right} type="source" />
				)}
				{/* We want to disable the target handle, if the connection was started from this node */}
				{(!connection.inProgress || isTarget) && (
					<Handle
						className="fullHandle z-10"
						position={Position.Left}
						type="target"
						isConnectableStart={false}
					/>
				)}
				{selected && (
					<ObjectInvolvementHelper activity={data.type} isObject={data.isObject !== undefined} />
				)}
			</div>
		</>
	);
}

function ObjectInvolvementHelper({ activity, isObject }: { activity: string; isObject: boolean }) {
	const ocelInfo = useOcelInfo();

	const actInfo = isObject ? { [activity]: [1, {}] as const } : ocelInfo?.e2o_types[activity];
	if (actInfo === undefined) {
		return null;
	}
	return (
		<div className="absolute -right-0.5 translate-x-full text-[5pt] bg-white z-99 px-1 rounded-sm border">
			<ul className="list-disc ml-2 leading-tight list-inside">
				{Object.keys(actInfo)
					.filter((object) => actInfo[object][0] > 0)
					.map((object) => (
						<li key={object} className="-ml-2" style={{ color: getRandomStringColor(object) }}>
							<span>{object}</span>
						</li>
					))}
			</ul>
		</div>
	);
}
