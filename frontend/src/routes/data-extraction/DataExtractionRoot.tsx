import { useState } from "react";
import { LuPlus } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { v4 } from "uuid";
import {
	AreaEmptyState,
	AreaList,
	AreaListRow,
	AreaPageHeader,
} from "@/components/layout/AreaPage";
import { areaFor } from "@/components/layout/areas";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA,
	DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_META,
	parseLocalStorageValue,
} from "@/lib/local-storage";
import type { DataExtractionBlueprintMeta } from "./data-extraction-types";

export default function DataExtractionRoot() {
	const [blueprints, setBlueprints] = useState<DataExtractionBlueprintMeta[]>(
		parseLocalStorageValue(
			localStorage.getItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_META) ?? "[]",
		),
	);
	const [deletePromptFor, setDeletePromptFor] = useState<{ index: number } | "ALL" | undefined>();

	function saveData(meta = blueprints) {
		localStorage.setItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_META, JSON.stringify(meta));
	}

	const navigate = useNavigate();

	const area = areaFor("/data-extraction");
	const addBlueprint = () => {
		const newID = v4();
		const newBlueprints: DataExtractionBlueprintMeta[] = [
			...blueprints,
			{
				name: `Blueprint ${blueprints.length + 1}`,
				id: newID,
				createdAt: new Date().toISOString(),
			},
		];
		saveData(newBlueprints);
		setBlueprints(newBlueprints);
		navigate(`/data-extraction/${newID}`);
	};
	const newButton = (
		<Button className={area.buttonClass} onClick={addBlueprint}>
			<LuPlus className="mr-1.5" />
			New blueprint
		</Button>
	);

	return (
		<div className="text-left h-full w-full overflow-hidden flex flex-col">
			<AreaPageHeader
				description="Extract OCEL from databases or files"
				actions={blueprints.length > 0 ? newButton : undefined}
			/>
			<AlertDialog
				open={deletePromptFor !== undefined}
				onOpenChange={(o) => {
					if (!o) {
						setDeletePromptFor(undefined);
					}
				}}
			>
				<AlertDialogContent className="flex flex-col max-h-full justify-between">
					<AlertDialogHeader>
						<AlertDialogTitle>Are you sure?</AlertDialogTitle>
						<AlertDialogDescription className="hidden">
							Are you sure you want to delete {deletePromptFor === "ALL" ? "all " : ""}the selected
							blueprint
							{deletePromptFor === "ALL" ? "s" : ""}? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="text-base text-gray-700 max-h-full overflow-auto px-2">
						{deletePromptFor !== undefined && deletePromptFor !== "ALL" && (
							<>
								<span>
									Blueprint:{" "}
									<span className="font-semibold">
										{blueprints[deletePromptFor.index]?.name ||
											`Blueprint ${deletePromptFor.index + 1}`}
									</span>
								</span>
								<br />
								<br />
							</>
						)}
						This deletes the blueprint and its sources. This cannot be undone.
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (deletePromptFor === undefined) return;
								if (deletePromptFor === "ALL") {
									blueprints.forEach((p) => {
										localStorage.removeItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA + p.id);
									});
									setBlueprints([]);
									saveData([]);
									return;
								}
								const deleted = blueprints[deletePromptFor.index];
								const next = [...blueprints];
								next.splice(deletePromptFor.index, 1);
								setBlueprints(next);
								saveData(next);
								if (deleted) {
									localStorage.removeItem(DATA_EXTRACTION_LOCALSTORAGE_SAVE_KEY_DATA + deleted.id);
								}
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			{blueprints.length === 0 ? (
				<AreaEmptyState area={area} title="No blueprints yet" action={newButton}>
					A blueprint maps tables from databases (SQLite, PostgreSQL, DuckDB) or files (CSV, XLSX,
					Parquet) to events, objects and their relations, and builds an OCEL from them that you can
					query here.
				</AreaEmptyState>
			) : (
				<AreaList
					itemCount={blueprints.length}
					renderRow={(index) => {
						const p = blueprints[index];
						return (
							<AreaListRow
								area={area}
								title={p.name || `Blueprint ${index + 1}`}
								description={p.description}
								meta={formatCreated(p.createdAt)}
								to={`/data-extraction/${p.id}`}
								onDelete={() => setDeletePromptFor({ index })}
							/>
						);
					}}
					footer={
						<>
							<span>
								{blueprints.length} {blueprints.length === 1 ? "blueprint" : "blueprints"}
							</span>
							<button
								type="button"
								className="font-medium hover:text-red-700 underline-offset-4 hover:underline"
								onClick={() => setDeletePromptFor("ALL")}
							>
								Delete all…
							</button>
						</>
					}
				/>
			)}
		</div>
	);
}

function formatCreated(createdAt: string | undefined) {
	const date = createdAt !== undefined ? new Date(createdAt) : undefined;
	if (date === undefined || Number.isNaN(date.getTime())) return undefined;
	return `Created ${date.toLocaleDateString(undefined, { dateStyle: "medium" })}`;
}
