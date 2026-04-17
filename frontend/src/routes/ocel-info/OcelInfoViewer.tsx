import { useState } from "react";
import toast from "react-hot-toast";
import { LuDownload, LuTrash2 } from "react-icons/lu";
import { RxArrowRight } from "react-icons/rx";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useBackend } from "@/hooks";
import { useInvalidateOcel, useOcelInfo } from "@/hooks/useOcelInfo";
import OcelTypeViewer from "./OcelTypeViewer";

export default function OcelInfoViewer() {
	const ocelInfo = useOcelInfo();
	if (ocelInfo == null || ocelInfo === undefined) {
		return <div>No Info!</div>;
	}
	return (
		<div className="my-4 text-lg text-left">
			<h2 className="text-4xl font-black">OCEL Info</h2>
			<p className="text-muted-foreground flex flex-col  leading-tight mt-2">
				<span>{ocelInfo.num_events} Events</span>
				<span>{ocelInfo.num_objects} Objects</span>
			</p>
			<div className="font-medium mt-4 mb-3 bg-fuchsia-50 p-3 rounded border border-fuchsia-100">
				<h3 className="font-black text-2xl">What do you want to do?</h3>
				<div className="ml-2">
					<p>
						Create custom queries to freely explore the dataset.
						<span className="text-sm italic font-normal mb-1 block">
							How many orders are delivered late? Which customers have the most payment reminders?
						</span>
					</p>
					<Link to="/constraints">
						<Button className=" h-12 text-xl  bg-purple-700 text-white font-bold cursor-pointer hover:bg-purple-600">
							{" "}
							<RxArrowRight className="mr-2" />
							OCPQ Query Editor
						</Button>
					</Link>
				</div>
				<div className="ml-2">
					<p className="mt-2">
						Discover and analyze behavioral patterns.
						<span className="text-sm italic font-normal mb-1 block">
							What happens after an order is placed? Is the same employee placing an order also
							confirming it?
						</span>
					</p>
					<Link to="/oc-declare">
						<Button className="h-12 text-xl bg-emerald-600 text-white font-bold cursor-pointer hover:bg-emerald-500">
							{" "}
							<RxArrowRight className="mr-2" /> OC-DECLARE
						</Button>
					</Link>
				</div>
			</div>
			<div className="grid grid-cols-[1fr_1fr] gap-x-2 mb-2">
				<div className="bg-green-100 py-2 px-2 rounded-lg shadow border border-emerald-200">
					<h3 className="text-2xl font-semibold">
						Event Types{" "}
						<span className="text-gray-600 text-xl ml-2">{ocelInfo.event_types.length}</span>
					</h3>
					<div className="flex flex-wrap">
						{ocelInfo.event_types.map((et) => (
							<OcelTypeViewer key={et.name} typeInfo={et} type="event" />
						))}
					</div>
				</div>
				<div className="bg-blue-100 py-2 px-2 rounded-lg shadow border border-sky-200">
					<h3 className="text-2xl font-semibold">
						Object Types{" "}
						<span className="text-gray-600 text-xl ml-2">{ocelInfo.object_types.length}</span>
					</h3>
					<div className="flex flex-wrap">
						{ocelInfo.object_types.map((et) => (
							<OcelTypeViewer key={et.name} typeInfo={et} type="object" />
						))}
					</div>
				</div>
			</div>
			<ExportOcelSection />
			<UnloadOcelSection />
		</div>
	);
}

const EXPORT_FORMATS = [
	{ format: "JSON" as const, ext: "json", label: "JSON" },
	{ format: "XML" as const, ext: "xml", label: "XML" },
	{ format: "SQLITE" as const, ext: "sqlite", label: "SQLite" },
];

function ExportOcelSection() {
	const backend = useBackend();
	const [exporting, setExporting] = useState<string | null>(null);

	const handleExport = async (format: "JSON" | "XML" | "SQLITE", ext: string) => {
		setExporting(format);
		try {
			const blob = await backend["ocel/export"](format);
			if (blob) {
				backend["download-blob"](blob, `ocel-export.${ext}`);
				toast.success(`Downloaded ocel-export.${ext}`);
			}
		} catch (e) {
			toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setExporting(null);
		}
	};

	return (
		<div className="mt-4 flex items-center gap-2">
			<span className="text-sm font-medium text-muted-foreground">Export OCEL:</span>
			{EXPORT_FORMATS.map(({ format, ext, label }) => (
				<Button
					key={format}
					size="sm"
					variant="outline"
					disabled={exporting !== null}
					onClick={() => handleExport(format, ext)}
				>
					<LuDownload className="w-3.5 h-3.5 mr-1.5" />
					{exporting === format ? "Exporting..." : label}
				</Button>
			))}
		</div>
	);
}

function UnloadOcelSection() {
	const backend = useBackend();
	const invalidateOcel = useInvalidateOcel();
	const navigate = useNavigate();

	const handleUnload = async () => {
		if (!backend["ocel/unload"]) return;
		try {
			await backend["ocel/unload"]();
			await invalidateOcel();
			toast.success("Dataset unloaded");
			navigate("/");
		} catch (e) {
			toast.error(`Unload failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	};

	return (
		<div className="mt-3">
			<Button
				size="sm"
				variant="outline"
				className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
				onClick={handleUnload}
				disabled={!backend["ocel/unload"]}
			>
				<LuTrash2 className="w-3.5 h-3.5 mr-1.5" />
				Unload Dataset
			</Button>
		</div>
	);
}
