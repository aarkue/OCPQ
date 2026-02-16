import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";
import { useContext, useState } from "react";
import toast from "react-hot-toast";
import { LuClipboard } from "react-icons/lu";
import { TbArrowRight, TbDatabaseEdit } from "react-icons/tb";
import { BackendProviderContext } from "@/BackendProviderContext";
import AlertHelper from "@/components/AlertHelper";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useBackend, useOcelInfo } from "@/hooks";
import { OcelInfoContext } from "@/lib/ocel-info-context";
import { evaluateConstraints } from "./evaluation/evaluate-constraints";
import type { EventTypeLinkData, EventTypeNodeData, GateNodeData } from "./types";

function getTranslationValue(
	typeNames: string[],
	replaceSpace = " ",
	capitalizeAfterSplit = false,
	lowercase = false,
): Record<string, string> {
	const ret: Record<string, string> = {};
	for (const type of typeNames) {
		let s = type;
		if (lowercase) {
			s = s.toLowerCase();
		}
		const splits = s.split(" ");
		if (capitalizeAfterSplit) {
			for (let i = 0; i < splits.length; i++) {
				splits[i] = String(splits[i][0]).toUpperCase() + String(splits[i]).slice(1);
			}
		}
		ret[type] = splits.join(replaceSpace);
	}

	return ret;
}
export default function DatabaseTranslationButton({
	instance,
}: {
	instance: ReactFlowInstance<Node<EventTypeNodeData | GateNodeData>, Edge<EventTypeLinkData>>;
}) {
	const [result, setResult] = useState<string>();

	const ocelInfo = useOcelInfo();

	const backend = useBackend();

	if (ocelInfo === undefined) {
		return null;
	}
	return (
		<AlertHelper
			trigger={
				<Button
					variant="outline"
					size="icon"
					title="Generate database query..."
					className="bg-white"
				>
					<TbDatabaseEdit />
				</Button>
			}
			title="Generate Database Query"
			initialData={{
				dialect: "SQLite" as "SQLite" | "DuckDB",
				objectMapping: getTranslationValue(ocelInfo.object_types.map((ot) => ot.name)),
				eventMapping: getTranslationValue(ocelInfo.event_types.map((et) => et.name)),
			}}
			content={({ data, setData }) => {
				return (
					<div>
						<p className="mb-2">
							Currently, some assumptions on the database schema are made. For example, each object
							and event type is mapped to a single table, and certain attributes are expected exist
							as columns (e.g., ocel:id). The table mappings can be adjusted below.
						</p>
						<div className="grid grid-cols-2 items-center font-semibold mb-2">
							SQL Dialect
							<Select
								value={data.dialect}
								onValueChange={(x) => setData({ ...data, dialect: x as any })}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="SQLite">SQLite</SelectItem>
									<SelectItem value="DuckDB">DuckDB</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<h3 className="font-semibold text-base">Type to Table Mapping</h3>
						<div className="ml-3 mt-1">
							<h4 className="font-medium text-sm">Apply a Preset</h4>
							<div className="text-xs flex flex-wrap gap-1 mt-1 ml-2">
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										setData({
											...data,
											eventMapping: getTranslationValue(ocelInfo.event_types.map((t) => t.name)),
											objectMapping: getTranslationValue(ocelInfo.object_types.map((t) => t.name)),
										})
									}
								>
									Aa bb
									<TbArrowRight />
									Aa bb
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										setData({
											...data,
											eventMapping: getTranslationValue(
												ocelInfo.event_types.map((t) => t.name),
												" ",
												true,
											),
											objectMapping: getTranslationValue(
												ocelInfo.object_types.map((t) => t.name),
												" ",
												true,
											),
										})
									}
								>
									Aa bb
									<TbArrowRight />
									Aa Bb
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										setData({
											...data,
											eventMapping: getTranslationValue(
												ocelInfo.event_types.map((t) => t.name),
												" ",
												false,
												true,
											),
											objectMapping: getTranslationValue(
												ocelInfo.object_types.map((t) => t.name),
												" ",
												false,
												true,
											),
										})
									}
								>
									Aa bb
									<TbArrowRight />
									aa bb
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										setData({
											...data,
											eventMapping: getTranslationValue(
												ocelInfo.event_types.map((t) => t.name),
												"",
												true,
											),
											objectMapping: getTranslationValue(
												ocelInfo.object_types.map((t) => t.name),
												"",
												true,
											),
										})
									}
								>
									Aa bb
									<TbArrowRight />
									AaBb
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										setData({
											...data,
											eventMapping: getTranslationValue(
												ocelInfo.event_types.map((t) => t.name),
												"",
											),
											objectMapping: getTranslationValue(
												ocelInfo.object_types.map((t) => t.name),
												"",
											),
										})
									}
								>
									Aa bb
									<TbArrowRight />
									Aabb
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										setData({
											...data,
											eventMapping: getTranslationValue(
												ocelInfo.event_types.map((t) => t.name),
												"",
												false,
												true,
											),
											objectMapping: getTranslationValue(
												ocelInfo.object_types.map((t) => t.name),
												"",
												false,
												true,
											),
										})
									}
								>
									Aa bb
									<TbArrowRight />
									aabb
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										setData({
											...data,
											eventMapping: getTranslationValue(
												ocelInfo.event_types.map((t) => t.name),
												"_",
												false,
											),
											objectMapping: getTranslationValue(
												ocelInfo.object_types.map((t) => t.name),
												"_",
												false,
											),
										})
									}
								>
									Aa bb
									<TbArrowRight />
									Aa_bb
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										setData({
											...data,
											eventMapping: getTranslationValue(
												ocelInfo.event_types.map((t) => t.name),
												"_",
												true,
											),
											objectMapping: getTranslationValue(
												ocelInfo.object_types.map((t) => t.name),
												"_",
												true,
											),
										})
									}
								>
									Aa bb
									<TbArrowRight />
									Aa_Bb
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										setData({
											...data,
											eventMapping: getTranslationValue(
												ocelInfo.event_types.map((t) => t.name),
												"_",
												false,
												true,
											),
											objectMapping: getTranslationValue(
												ocelInfo.object_types.map((t) => t.name),
												"_",
												false,
												true,
											),
										})
									}
								>
									Aa bb
									<TbArrowRight />
									aa_bb
								</Button>
							</div>
							<Accordion
								type="multiple"
								defaultValue={result === undefined ? ["objects", "events"] : []}
							>
								<AccordionItem value="objects">
									<AccordionTrigger>Objects</AccordionTrigger>
									<AccordionContent className="flex flex-col gap-1 max-h-32 overflow-auto px-2">
										{Object.keys(data.objectMapping).map((ot) => (
											<div key={ot} className="flex gap-x-1 items-center">
												<Input value={ot} readOnly disabled /> <TbArrowRight className="size-8" />{" "}
												<Input
													key={data.objectMapping[ot]}
													defaultValue={data.objectMapping[ot]}
													onBlur={(ev) => {
														data.objectMapping[ot] = ev.currentTarget.value;
														setData({ ...data });
													}}
												/>
											</div>
										))}
									</AccordionContent>
								</AccordionItem>
								<AccordionItem value="events">
									<AccordionTrigger>Events</AccordionTrigger>
									<AccordionContent className="flex flex-col gap-1 max-h-32 overflow-auto px-2">
										{Object.keys(data.eventMapping).map((ot) => (
											<div key={ot} className="flex gap-x-1 items-center">
												<Input value={ot} readOnly disabled /> <TbArrowRight className="size-8" />{" "}
												<Input
													key={data.eventMapping[ot]}
													defaultValue={data.eventMapping[ot]}
													onBlur={(ev) => {
														data.eventMapping[ot] = ev.currentTarget.value;
														setData({ ...data });
													}}
												/>
											</div>
										))}
									</AccordionContent>
								</AccordionItem>
							</Accordion>
						</div>

						{result !== undefined && (
							<div className="mt-4 relative">
								<Button
									size="sm"
									title="Copy to clipboard"
									className="absolute top-0 right-0"
									onClick={() => {
										navigator.clipboard.writeText(result);
										toast.success("Copied Query");
									}}
								>
									<LuClipboard className="size-4" />
								</Button>
								<h3 className="font-semibold text-base mb-2">Generated Query</h3>
								<pre className="bg-gray-100 p-2 rounded-md overflow-x-auto">
									<code>{result}</code>
								</pre>
							</div>
						)}
					</div>
				);
			}}
			submitAction={result === undefined ? "Generate" : "Regenerate"}
			onCancel={() => setResult(undefined)}
			mode="promise"
			onSubmit={async (mapping) => {
				const treeRes = evaluateConstraints(instance.getNodes(), instance.getEdges());
				if (treeRes.length === 0 || treeRes[0].tree.nodes.length === 0) {
					toast.error("No query to translate!");
				}
				const query = treeRes[0].tree;
				const res = await backend["ocel/create-db-query"]({
					table_mappings: {
						event_tables: mapping.eventMapping,
						object_tables: mapping.objectMapping,
					},
					tree: query,
					database: mapping.dialect,
				});
				setResult(res);
				return false;
			}}
		/>
	);
}
