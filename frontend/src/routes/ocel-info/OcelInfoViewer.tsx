import { AttributeValueStats, OCELCountInfo } from "@r4pm/components";
import { useState } from "react";
import toast from "react-hot-toast";
import { LuDownload, LuTrash2 } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { R4pmIsland } from "@/components/r4pm/R4pmIsland";
import { Button } from "@/components/ui/button";
import { useBackend } from "@/hooks";
import { useAttributeStats, useClearOcel, useOcelInfo, useOcelStats } from "@/hooks/useOcelInfo";

function AttrStatsDetail({
	scope,
	type,
	attr,
}: {
	scope: "event" | "object";
	type: string;
	attr: string;
}) {
	const stat = useAttributeStats(scope, type, attr).data;
	return (
		<div className="mt-2 border-t pt-3">
			<div className="text-sm font-semibold mb-1">
				{type} - {attr}
			</div>
			{stat ? (
				<AttributeValueStats stat={stat} />
			) : (
				<div className="text-sm text-muted-foreground">Loading...</div>
			)}
		</div>
	);
}

export default function OcelInfoViewer() {
	const ocelInfo = useOcelInfo();
	const ocelStats = useOcelStats();
	if (ocelInfo == null || ocelInfo === undefined) {
		return <div>No Info!</div>;
	}
	return (
		<div className="my-4 text-lg text-left">
			<h2 className="text-4xl font-black">OCEL Info</h2>
			<p className="text-muted-foreground flex flex-col leading-tight mt-2">
				<span>{ocelInfo.event_types.length} Event Types</span>
				<span>{ocelInfo.object_types.length} Object Types</span>
			</p>
			{ocelStats && (
				<div className="mt-4 mb-3">
					<R4pmIsland>
						<OCELCountInfo
							data={ocelStats}
							attributes={{
								event: Object.fromEntries(ocelInfo.event_types.map((t) => [t.name, t.attributes])),
								object: Object.fromEntries(
									ocelInfo.object_types.map((t) => [t.name, t.attributes]),
								),
							}}
							renderAttributeDetail={(scope, type, attr) => (
								<AttrStatsDetail scope={scope} type={type} attr={attr} />
							)}
						/>
					</R4pmIsland>
				</div>
			)}
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
	const clearOcel = useClearOcel();
	const navigate = useNavigate();

	const handleUnload = async () => {
		if (!backend["ocel/unload"]) return;
		try {
			await backend["ocel/unload"]();
			clearOcel();
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
