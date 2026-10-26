import clsx from "clsx";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BackButton } from "@/components/layout/AreaPage";
import { areaFor } from "@/components/layout/areas";
import { Button } from "@/components/ui/button";
import {
	OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META,
	OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA,
	parseLocalStorageValue,
} from "@/lib/local-storage";
import { QueryTagsEditor } from "@/routes/visual-editor/outer-visual-editor/QueryList";
import { tagCounts, tagsOf, withTags } from "@/routes/visual-editor/outer-visual-editor/query-list";
import type { OCDeclareMetaData } from "./flow/oc-declare-flow-data";
import OCDeclareEditor, { type PersistedFlow } from "./OCDeclareEditor";

type OCDeclareFlowData = { flowJson: PersistedFlow };

export default function OCDeclareViewer() {
	const { id } = useParams();

	const meta = parseLocalStorageValue<OCDeclareMetaData[]>(
		localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META) ?? "[]",
	);
	const data = parseLocalStorageValue<OCDeclareFlowData>(
		localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA + id) ?? "[]",
	);
	const metaIndex = meta.findIndex((x) => x.id === id);
	const [metaInfo, setMetaInfo] = useState(metaIndex !== undefined ? meta[metaIndex] : undefined);

	if (id == null || metaInfo === undefined) {
		return (
			<div className=" text-left">
				<h2 className="font-black text-2xl text-red-500">Unknown OC-DECLARE Model</h2>
				<p className="mt-2 mb-4">
					The requested OC-DECLARE model does not exist. Maybe it was deleted?
					<br />
					Go back to see an overview over all existing models.
				</p>
				<Link to="/oc-declare">
					<Button size="lg">Back</Button>
				</Link>
			</div>
		);
	}
	function updateMetaInfo(newMetaInfo: typeof metaInfo) {
		setMetaInfo(newMetaInfo);
		if (newMetaInfo && metaIndex !== null) {
			meta[metaIndex] = newMetaInfo;
			localStorage.setItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META, JSON.stringify(meta));
		}
	}
	const area = areaFor("/oc-declare");
	return (
		<div className="text-left w-full h-full flex flex-col">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3">
				<BackButton label="Back to OC-DECLARE models" to="/oc-declare" />
				<span
					aria-hidden="true"
					className={clsx(
						"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&>svg]:size-4",
						area.activeClass,
					)}
				>
					{area.icon}
				</span>
				<div className="flex min-w-64 flex-1 flex-col">
					<input
						aria-label="Model name"
						className="w-full rounded-md border border-transparent bg-transparent px-1.5 text-lg font-bold tracking-tight text-slate-900 outline-none hover:border-slate-200 focus:border-slate-300 focus-visible:ring-2 focus-visible:ring-emerald-500"
						defaultValue={metaInfo.name}
						onBlur={(ev) => updateMetaInfo({ ...metaInfo, name: ev.currentTarget.value })}
						onKeyDown={(ev) => ev.key === "Enter" && ev.currentTarget.blur()}
					/>
					<input
						aria-label="Model description"
						placeholder="Add a description"
						className="w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm text-slate-600 placeholder:text-slate-500 outline-none hover:border-slate-200 focus:border-slate-300 focus-visible:ring-2 focus-visible:ring-emerald-500"
						defaultValue={metaInfo.description ?? ""}
						onBlur={(ev) => updateMetaInfo({ ...metaInfo, description: ev.currentTarget.value })}
						onKeyDown={(ev) => ev.key === "Enter" && ev.currentTarget.blur()}
					/>
					<QueryTagsEditor
						tone="emerald"
						tags={tagsOf(metaInfo)}
						suggestions={tagCounts(meta.map((m) => ({ tags: tagsOf(m) }))).map(([t]) => t)}
						onChange={(tags) => updateMetaInfo(withTags(metaInfo, tags))}
					/>
				</div>
			</div>
			<div className="w-full h-full border">
				<OCDeclareEditor
					initialFlowJson={data.flowJson}
					onChange={(value) => {
						localStorage.setItem(
							OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA + id,
							JSON.stringify({ flowJson: value } satisfies OCDeclareFlowData),
						);
					}}
				/>
			</div>
		</div>
	);
}
