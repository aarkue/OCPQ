import { Fragment, useContext, useEffect, useRef, useState } from "react";
import { BsArrowsCollapse, BsArrowsExpand } from "react-icons/bs";
import { BackendProviderContext } from "@/BackendProviderContext";
import { useBackend, useOcelInfo } from "@/hooks";
import { OcelInfoContext } from "@/lib/ocel-info-context";
import OcelGraphViewer from "@/routes/OcelGraphViewer";
import { IconForDataType } from "@/routes/ocel-info/OcelTypeViewer";
import { VisualEditorContext } from "@/routes/visual-editor/helper/VisualEditorContext";
import type { OCELEvent, OCELObject, OCELRelationship, OCELType } from "@/types/ocel";
import { ClipboardButton } from "./ClipboardButton";
import { Button } from "./ui/button";

export default function OcelElementInfo({
	type,
	req,
}: {
	type: "event" | "object";
	req: { id: string; index?: undefined } | { index: number; id?: undefined };
}) {
	const backend = useBackend();
	const [info, setInfo] = useState<
		| {
				index: number;
				object: OCELObject;
				event?: undefined;
		  }
		| { index: number; event: OCELEvent; object?: undefined }
		| null
		| undefined
	>(undefined);
	useEffect(() => {
		if (type === "object" && req != null) {
			void backend["ocel/get-object"](req)
				.then((res) => {
					setInfo(res);
				})
				.catch(() => setInfo(null));
		} else if (type === "event" && req != null) {
			void backend["ocel/get-event"](req)
				.then((res) => {
					setInfo(res);
				})
				.catch(() => setInfo(null));
		}
	}, [req, type, backend["ocel/get-event"], backend["ocel/get-object"]]);

	const ocelInfo = useOcelInfo();
	const overflowDiv = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (overflowDiv.current !== null) {
			overflowDiv.current.scrollTop = 0;
		}
	}, []);

	return (
		<div className="text-lg text-left h-full">
			<div className="grid grid-cols-[1fr_2fr] justify-center gap-x-4 w-full h-full">
				<div className="w-full h-full border-r-2 overflow-auto" ref={overflowDiv}>
					{info?.object != null && (
						<OcelObjectViewer
							object={info.object}
							type={ocelInfo?.object_types.find((t) => t.name === info.object.type)}
						/>
					)}
					{info?.event != null && (
						<OcelEventViewer
							event={info.event}
							type={ocelInfo?.event_types.find((t) => t.name === info.event.type)}
						/>
					)}

					{info === null && <div className="text-4xl font-bold text-red-700">Not Found</div>}
				</div>
				<div className="w-full h-full overflow-hidden">
					{info !== null && (
						<OcelGraphViewer
							initialGrapOptions={{
								type,
								id: (type === "event" ? info?.event : info?.object)?.id ?? req.id,
							}}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

function RelationshipViewer({ rels }: { rels?: OCELRelationship[] }) {
	const [showAll, setShowAll] = useState(false);
	const { showElementInfo } = useContext(VisualEditorContext);
	return (
		<Fragment>
			{(rels === undefined || rels.length === 0) && (
				<Fragment>
					<span className="text-xs">No relationships found.</span>
					<span />
				</Fragment>
			)}
			{rels?.slice(0, showAll ? undefined : 20).map((rel, i) => (
				<Fragment key={i}>
					<span className="italic text-large ml-2 max-w-36 truncate">{rel.qualifier}</span>
					<div className="flex items-center gap-x-0.5">
						<Button
							className="h-7"
							variant="outline"
							size="sm"
							onClick={() => {
								showElementInfo({ type: "object", req: { id: rel.objectId } });
							}}
						>
							<span className="w-20 truncate">{rel.objectId}</span>
						</Button>
						<ClipboardButton name="ID" value={rel.objectId} />
					</div>
				</Fragment>
			))}
			{rels?.length !== undefined && rels.length > 20 && (
				<Fragment>
					<div className="overflow-visible w-32 flex ml-3 gap-x-2">
						<Button
							variant="ghost"
							className="w-fit"
							size="sm"
							onClick={() => setShowAll((t) => !t)}
						>
							{showAll ? "Collapse relationships" : "... Expand all relationships"}
							{showAll ? (
								<BsArrowsCollapse className="ml-1" />
							) : (
								<BsArrowsExpand className="ml-1" />
							)}
						</Button>
					</div>
					<span />
				</Fragment>
			)}
		</Fragment>
	);
}

function OcelObjectViewer({ object, type }: { object: OCELObject; type?: OCELType }) {
	return (
		<div className={"block h-full p-1 bg-white text-left"}>
			<div className="text-xl grid grid-cols-[fit-content(50%)_1fr] gap-x-2 gap-y-0.5">
				<h4 className="font-bold">ID</h4>
				<h4 className="font-bold">
					{object.id}
					<ClipboardButton name="ID" value={object.id} />
				</h4>
				<h4>Object Type</h4>
				<h4>
					{object.type}
					<ClipboardButton name="Type" value={object.type} />
				</h4>
				<hr className="mt-1.5" /> <hr className="mt-1.5" />
				<h4 className="font-bold">Attributes</h4> <div />
				{(type?.attributes === undefined || type.attributes.length === 0) && (
					<Fragment>
						<span className="text-xs">No attributes found.</span>
						<span />
					</Fragment>
				)}
				{type?.attributes.map((attr) => (
					<Fragment key={attr.name}>
						<div className="flex self-start gap-x-1">
							<IconForDataType dtype={attr.type} />
							<div className="self-start max-w-34 truncate" title={attr.name}>
								{attr.name}
							</div>
						</div>
						<div className="font-mono text-blue-700 w-full flex flex-wrap overflow-hidden gap-x-4 ">
							{object.attributes
								.filter((a) => a.name === attr.name)
								.map((a) => (
									<div
										key={a.time}
										className="w-fit max-w-full truncate"
										title={`${a.value} at ${a.time}`}
									>
										{String(a.value)}
									</div>
								))}
						</div>
					</Fragment>
				))}
				<hr className="mt-1.5" /> <hr className="mt-1.5" />
				<h4 className="font-bold">Relationships</h4> <div />
				<RelationshipViewer rels={object.relationships} />
			</div>
		</div>
	);
}

function OcelEventViewer({ event, type }: { event: OCELEvent; type?: OCELType }) {
	return (
		<div className={"block h-full p-1 bg-white text-left"}>
			<div className="text-xl grid grid-cols-[fit-content(50%)_1fr] gap-x-2 gap-y-0.5">
				<h4 className="font-bold">ID</h4>
				<h4 className="font-bold">
					{event.id}
					<ClipboardButton name="ID" value={event.id} />
				</h4>
				<h4>Event Type</h4>
				<h4>
					{event.type}
					<ClipboardButton name="Type" value={event.type} />
				</h4>
				<h4>Timestamp</h4>
				<h4>
					{event.time}
					<ClipboardButton name="Timestamp" value={event.time} />
				</h4>
				<hr className="mt-1.5" /> <hr className="mt-1.5" />
				<h4 className="font-bold">Attributes</h4> <div />
				{(type?.attributes === undefined || type.attributes.length === 0) && (
					<Fragment>
						<span className="text-xs">No attributes found.</span>
						<span />
					</Fragment>
				)}
				{type?.attributes.map((attr) => (
					<Fragment key={attr.name}>
						<div className="flex self-start gap-x-1">
							<IconForDataType dtype={attr.type} />
							<div className="self-start max-w-34 truncate" title={attr.name}>
								{attr.name}
							</div>
						</div>
						<div className="font-mono text-blue-700 w-full flex flex-wrap overflow-hidden gap-x-4 ">
							{event.attributes
								.filter((a) => a.name === attr.name)
								.map((a, i) => (
									<div key={i} className="w-fit max-w-full truncate" title={`${a.value}`}>
										{String(a.value)}
									</div>
								))}
						</div>
					</Fragment>
				))}
				<hr className="mt-1.5" /> <hr className="mt-1.5" />
				<h4 className="font-bold">Relationships</h4> <div />
				<RelationshipViewer rels={event.relationships} />
			</div>
		</div>
	);
}
