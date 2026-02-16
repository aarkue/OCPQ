import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import clsx from "clsx";
import { useContext } from "react";
import { TbTrash } from "react-icons/tb";
import AlertHelper from "@/components/AlertHelper";
import { Combobox } from "@/components/ui/combobox";
import type { GateNodeData } from "../types";
import { VisualEditorContext } from "../VisualEditorContext";
import { getViolationStyles } from "../violation-styles";
import ViolationIndicator from "./ViolationIndicator";

export default function EventTypeNode({ data, id, selected }: NodeProps<Node<GateNodeData>>) {
	const { violationsPerNode, onNodeDataChange } = useContext(VisualEditorContext);

	const hideViolations: boolean | undefined = false;
	const violations = hideViolations ? undefined : violationsPerNode?.evalRes[id];

	return (
		<div
			title={data.type}
			className={clsx(
				"border-2 shadow-lg z-10 flex flex-col items-center justify-center pt-1.5 py-0.5 px-0.5 rounded-md relative min-w-32 min-h-20 font-mono text-4xl font-bold",
				getViolationStyles(violations),
				selected && "border-dashed",
			)}
		>
			{violations !== undefined && (
				<ViolationIndicator violationsPerNode={violations} nodeID={id} />
			)}
			<div className="">
				<AlertHelper
					title="Change Gate Type"
					trigger={
						<button type="button" className="bg-transparent hover:bg-blue-400/40 w-8 h-8 rounded">
							{data.type === "not" && "¬"}
							{data.type === "or" && "∨"}
							{data.type === "and" && "∧"}
						</button>
					}
					initialData={data}
					content={({ data: d, setData: setD }) => (
						<div>
							<Combobox
								options={
									data.type === "not"
										? [{ value: "not", label: "not (¬)" }]
										: [
												{ value: "and", label: "and (∧)" },
												{ value: "or", label: "or (∨)" },
											]
								}
								onChange={(value: string) => {
									setD({
										...d,
										type: value === "not" ? "not" : value === "or" ? "or" : "and",
									});
								}}
								name={"Gate Type"}
								value={d.type}
							/>
						</div>
					)}
					submitAction="Save"
					onSubmit={(d) => {
						onNodeDataChange(id, d);
					}}
				/>

				<Handle className="w-3! h-3!" position={Position.Top} type="target" id={`${id}-target`} />
				{data.type === "not" && (
					<Handle
						className="w-3! h-3!"
						position={Position.Bottom}
						type="source"
						id={`${id}-source`}
					/>
				)}

				{data.type !== "not" && (
					<>
						<Handle
							className="w-3! h-3! mt-9"
							position={Position.Left}
							type="source"
							id={`${id}-left-source`}
						/>
						<Handle
							className="w-3! h-3! mt-9"
							position={Position.Right}
							type="source"
							id={`${id}-right-source`}
						/>
					</>
				)}
			</div>
			<AlertHelper
				trigger={
					<button
						type="button"
						className="absolute -top-3.5 right-1 opacity-10 hover:opacity-100 hover:text-red-500"
						title="Delete node"
					>
						<TbTrash size={12} />
					</button>
				}
				title="Are you sure?"
				initialData={undefined}
				content={() => <>This node and all contained constraints will be deleted.</>}
				submitAction="Delete"
				onSubmit={() => {
					onNodeDataChange(id, undefined);
				}}
			/>
		</div>
	);
}
