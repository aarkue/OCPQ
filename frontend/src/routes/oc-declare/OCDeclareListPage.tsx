import { useCallback, useEffect, useState } from "react";
import { LuPlus } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { v4 } from "uuid";
import { AreaEmptyState, AreaPageHeader } from "@/components/layout/AreaPage";
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
import { useOcelInfo } from "@/hooks";
import {
	OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META,
	OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA,
	parseLocalStorageValue,
} from "@/lib/local-storage";
import { QueryList } from "@/routes/visual-editor/outer-visual-editor/QueryList";
import {
	fitOf,
	type QueryItem,
	type QueryTypes,
	tagsOf,
} from "@/routes/visual-editor/outer-visual-editor/query-list";
import type { OCDeclareMetaData } from "./flow/oc-declare-flow-data";
import type { PersistedFlow } from "./OCDeclareEditor";
import { removeOrphanedOCDeclareData } from "./oc-declare-storage";
import { typesOfOCDeclareFlow } from "./oc-declare-types";

export default function OCDeclareListPage() {
	const [constraints, setConstraints] = useState<OCDeclareMetaData[]>(
		parseLocalStorageValue(
			localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META) ?? "[]",
		),
	);
	const [deletePromptForIndex, setDeletePromptForIndex] = useState<{ index: number } | "ALL">();

	const saveData = useCallback(
		(constraintsMeta = constraints) => {
			localStorage.setItem(
				OC_DECLARE_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META,
				JSON.stringify(constraintsMeta),
			);
		},
		[constraints],
	);

	useEffect(() => {
		saveData();
	}, [saveData]);

	const navigate = useNavigate();
	const area = areaFor("/oc-declare");
	const ocelInfo = useOcelInfo();
	const items: QueryItem[] = constraints.map((c, index) => {
		let types: QueryTypes = { events: [], objects: [] };
		// One unreadable save must not take the whole list down. Its model shows without types.
		try {
			const flow = parseLocalStorageValue<{ flowJson?: PersistedFlow }>(
				localStorage.getItem(OC_DECLARE_LOCALSTORAGE_SAVE_KEY_DATA + c.id) ?? "{}",
			);
			types = typesOfOCDeclareFlow(flow?.flowJson);
		} catch (e) {
			console.warn(`Could not read the types of OC-DECLARE model ${c.id}`, e);
		}
		return {
			index,
			name: c.name !== "" ? c.name : `Constraint ${index + 1}`,
			description: c.description ?? "",
			tags: tagsOf(c),
			types,
			fit: fitOf(types, ocelInfo),
		};
	});
	const addConstraint = () => {
		const newID = v4();
		let n = constraints.length + 1;
		while (constraints.some((c) => c.name === `Constraint ${n}`)) n++;
		const next = [...constraints, { name: `Constraint ${n}`, id: newID }];
		saveData(next);
		removeOrphanedOCDeclareData(next.map((c) => c.id));
		navigate(`/oc-declare/${newID}`);
	};
	const newButton = (
		<Button className={area.buttonClass} onClick={addConstraint}>
			<LuPlus className="mr-1.5" />
			New constraint
		</Button>
	);

	return (
		<div className="text-left h-full w-full overflow-hidden flex flex-col">
			<AreaPageHeader
				description="Object-Centric Declarative Constraints"
				actions={constraints.length > 0 ? newButton : undefined}
			/>
			<AlertDialog
				open={deletePromptForIndex !== undefined}
				onOpenChange={(o) => {
					if (!o) {
						setDeletePromptForIndex(undefined);
					}
				}}
			>
				<AlertDialogContent className="flex flex-col max-h-full justify-between">
					<AlertDialogHeader>
						<AlertDialogTitle>
							{deletePromptForIndex === "ALL"
								? "Delete all OC-DECLARE constraints"
								: "Delete OC-DECLARE constraint"}
						</AlertDialogTitle>
						<AlertDialogDescription className="hidden">
							Are you sure you want to delete {deletePromptForIndex === "ALL" ? "all " : ""}the
							selected OC-DECLARE constraint{deletePromptForIndex === "ALL" ? "s" : ""}? This action
							cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="text-base text-gray-700 max-h-full overflow-auto px-2">
						{deletePromptForIndex !== undefined && deletePromptForIndex !== "ALL" && (
							<>
								<span className="">
									Constraint:{" "}
									<span className="font-semibold">
										{(constraints[deletePromptForIndex.index]?.name ?? "").length > 0
											? constraints[deletePromptForIndex.index]?.name
											: `Constraint ${deletePromptForIndex.index + 1}`}
									</span>
								</span>
								<br />
								<br />
							</>
						)}
						Deleting this constraint cannot be undone.
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (deletePromptForIndex === undefined) return;
								const next =
									deletePromptForIndex === "ALL"
										? []
										: constraints.filter((_, i) => i !== deletePromptForIndex.index);
								setConstraints(next);
								removeOrphanedOCDeclareData(next.map((c) => c.id));
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			{constraints.length === 0 ? (
				<AreaEmptyState area={area} title="No constraints yet" action={newButton}>
					OC-DECLARE constraints describe how activities relate through shared objects, e.g., that
					every order is paid after it was placed. Discover them from the loaded log or draw them by
					hand.
				</AreaEmptyState>
			) : (
				<QueryList
					area={area}
					items={items}
					tone="emerald"
					groupingKey="ocpq-ocdeclare-list-grouping"
					noMatch="No constraint matches."
					onOpen={(index) => navigate(`/oc-declare/${constraints[index].id}`)}
					onDelete={(index) => setDeletePromptForIndex({ index })}
					footer={
						<>
							<span>
								{constraints.length} {constraints.length === 1 ? "constraint" : "constraints"}
							</span>
							<button
								type="button"
								className="font-medium hover:text-red-700 underline-offset-4 hover:underline"
								onClick={() => setDeletePromptForIndex("ALL")}
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
