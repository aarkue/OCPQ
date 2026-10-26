import { type Edge, type Node, type ReactFlowInstance, ReactFlowProvider } from "@xyflow/react";
import clsx from "clsx";
import { startTransition, useEffect, useRef, useState } from "react";
import { LuPlus } from "react-icons/lu";
import AlertHelper from "@/components/AlertHelper";
import { AreaEmptyState, AreaPageHeader, BackButton } from "@/components/layout/AreaPage";
import { areaFor } from "@/components/layout/areas";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOcelInfo } from "@/hooks";
import {
	parseLocalStorageValue,
	QUERY_LOCALSTORAGE_OPEN_INDEX,
	QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META,
	QUERY_LOCALSTORAGE_SAVE_KEY_DATA,
} from "@/lib/local-storage";
import type { FlowAndViolationData } from "@/types/misc";
import { emptyBoxNode } from "../helper/constructNodes";
import { FlowContext } from "../helper/FlowContext";
import { DescriptionOrSentence } from "../helper/QuerySentenceView";
import type {
	ConstraintInfo,
	EvaluationResPerNodes,
	EventTypeLinkData,
	EventTypeNodeData,
	GateNodeData,
} from "../helper/types";
import TotalViolationInfo from "../TotalViolationInfo";
import VisualEditor from "../VisualEditor";
import AutoDiscoveryButton from "./AutoDiscovery";
import { QueryList, QueryTagsEditor } from "./QueryList";
import { queryItems, tagCounts, tagsOf, withTags } from "./query-list";

/** Where the box a new query starts with is placed. The editor fits the view when a query is opened,
 *  so this only decides the box's flow coordinates, not where it ends up on screen. */
const SEED_NODE_POSITION = { x: 40, y: 30 };
const SEED_VIEWPORT = { x: 0, y: 0, zoom: 1 };

export default function VisualEditorOuter() {
	const ocelInfo = useOcelInfo();
	const [constraints, setConstraints] = useState<ConstraintInfo[]>(() =>
		parseLocalStorageValue<ConstraintInfo[]>(
			localStorage.getItem(QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META) ?? "[]",
		),
	);
	const [showConstraintSelection, setShowConstraintSelection] = useState(false);
	const [currentInstanceAndData, setCurrentInstanceAndData] = useState<{
		instance?:
			| ReactFlowInstance<Node<EventTypeNodeData | GateNodeData>, Edge<EventTypeLinkData>>
			| undefined;
		getter?: () =>
			| {
					violations?: EvaluationResPerNodes;
			  }
			| undefined;
	}>({});

	const [activeIndex, setActiveIndex] = useState<number>();
	const [deletePromptForIndex, setDeletePromptForIndex] = useState<number>();
	const [savedFlows] = useState(() =>
		parseLocalStorageValue<FlowAndViolationData[]>(
			localStorage.getItem(QUERY_LOCALSTORAGE_SAVE_KEY_DATA) ?? "[]",
		),
	);
	const prevDataRef = useRef<FlowAndViolationData[]>(savedFlows);

	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once, for the list read above
	useEffect(() => {
		// Honor a cross-route request to open a specific constraint (e.g. from Path Schemas).
		const openIdxRaw = localStorage.getItem(QUERY_LOCALSTORAGE_OPEN_INDEX);
		if (openIdxRaw !== null) {
			localStorage.removeItem(QUERY_LOCALSTORAGE_OPEN_INDEX);
			const openIdx = Number.parseInt(openIdxRaw, 10);
			if (!Number.isNaN(openIdx) && openIdx >= 0 && openIdx < constraints.length) {
				setActiveIndex(openIdx);
			}
		}
	}, []);

	const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>();
	// The timer calls the latest saveData, which sees the latest queries.
	const saveRef = useRef(saveData);
	saveRef.current = saveData;
	function scheduleAutoSave() {
		if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
		autoSaveTimer.current = setTimeout(() => {
			autoSaveTimer.current = undefined;
			saveRef.current();
		}, 400);
	}
	// Names, descriptions and adding or deleting queries are saved like edits in the editor.
	const savedConstraints = useRef(constraints);
	useEffect(() => {
		if (constraints !== savedConstraints.current) {
			savedConstraints.current = constraints;
			scheduleAutoSave();
		}
	});
	// A change made right before leaving the page or closing the app is still written.
	useEffect(() => {
		const flush = () => {
			if (autoSaveTimer.current === undefined) return;
			clearTimeout(autoSaveTimer.current);
			autoSaveTimer.current = undefined;
			saveRef.current();
		};
		window.addEventListener("pagehide", flush);
		return () => {
			window.removeEventListener("pagehide", flush);
			flush();
		};
	}, []);

	function saveData() {
		if (
			currentInstanceAndData.instance !== undefined &&
			activeIndex !== undefined &&
			currentInstanceAndData.getter !== undefined
		) {
			// First, save current data
			const prevOtherData = currentInstanceAndData.getter();
			prevDataRef.current[activeIndex] = {
				flowJson: currentInstanceAndData.instance.toObject(),
				violations: prevOtherData?.violations,
			};
		}

		localStorage.setItem(
			QUERY_LOCALSTORAGE_SAVE_KEY_DATA,
			JSON.stringify(prevDataRef.current.map((x) => ({ ...x, violations: undefined }))),
		);
		localStorage.setItem(QUERY_LOCALSTORAGE_SAVE_KEY_CONSTRAINTS_META, JSON.stringify(constraints));
	}

	function changeIndex(newIndex: number | undefined, length = constraints.length) {
		if (
			currentInstanceAndData.instance !== undefined &&
			activeIndex !== undefined &&
			currentInstanceAndData.getter !== undefined
		) {
			const dataFromPrevIndex = currentInstanceAndData.instance.toObject();
			const prevOtherData = currentInstanceAndData.getter();
			prevDataRef.current[activeIndex] = {
				flowJson: dataFromPrevIndex,
				violations: prevOtherData?.violations,
			};
		}
		if (newIndex === undefined || (!Number.isNaN(newIndex) && newIndex >= 0 && newIndex < length)) {
			setActiveIndex(newIndex);
		}
	}

	if (!ocelInfo) {
		return null;
	}

	const area = areaFor("/constraints");
	const activeQuery = activeIndex !== undefined ? constraints[activeIndex] : undefined;
	const activeFlow =
		activeIndex !== undefined ? prevDataRef.current[activeIndex]?.flowJson : undefined;

	const items = queryItems(constraints, prevDataRef.current, ocelInfo);

	function seedNewQuery(index: number) {
		// Start with one box, so the query opens with something to drag a child out of.
		prevDataRef.current[index] = {
			flowJson: {
				nodes: [emptyBoxNode(SEED_NODE_POSITION)],
				edges: [],
				viewport: SEED_VIEWPORT,
			},
		};
	}

	/** `Query <n>` with n one past the number of queries, skipped ahead past names in use. */
	function nextQueryName(queries: { name: string }[]) {
		let n = queries.length + 1;
		while (queries.some((q) => q.name === `Query ${n}`)) n++;
		return `Query ${n}`;
	}

	function createFirstQuery() {
		seedNewQuery(constraints.length);
		changeIndex(constraints.length, constraints.length + 1);
		setConstraints((cs) => [...cs, { name: nextQueryName(cs), description: "" }]);
	}

	function addQuery() {
		prevDataRef.current.splice(constraints.length, 1);
		seedNewQuery(constraints.length);
		setConstraints((cs) => [...cs, { name: nextQueryName(cs), description: "" }]);
		startTransition(() => {
			changeIndex(constraints.length, constraints.length + 1);
		});
	}

	const newQueryButton = (
		<Button className={area.buttonClass} onClick={addQuery}>
			<LuPlus className="mr-1.5" />
			New query
		</Button>
	);
	const discoverButton = (
		<AutoDiscoveryButton
			ocelInfo={ocelInfo}
			constraints={constraints}
			setConstraints={setConstraints}
			prevDataRef={prevDataRef}
		/>
	);
	return (
		<div className="w-full h-full">
			<FlowContext.Provider
				value={{
					flushData: (data) => {
						if (
							data !== undefined &&
							activeIndex !== undefined &&
							currentInstanceAndData.instance !== undefined
						) {
							prevDataRef.current[activeIndex] = {
								flowJson: currentInstanceAndData.instance.toObject(),
								violations: data?.violations,
							};
							setConstraints([...constraints]);
						}
					},
					instance: currentInstanceAndData?.instance,
					setInstance: (i) => {
						setCurrentInstanceAndData((ci) => ({
							...ci,
							instance: i,
						}));
					},
					registerOtherDataGetter: (getter) => {
						setCurrentInstanceAndData((ci) => ({ ...ci, getter }));
					},
					otherData:
						activeIndex !== undefined
							? {
									violations: prevDataRef.current[activeIndex]?.violations,
									nodes: prevDataRef.current[activeIndex]?.flowJson?.nodes,
									edges: prevDataRef.current[activeIndex]?.flowJson?.edges,
									viewport: prevDataRef.current[activeIndex]?.flowJson?.viewport,
								}
							: undefined,
					scheduleAutoSave,
				}}
			>
				<div className="flex flex-col justify-start items-center mb-2 h-full">
					{ocelInfo !== undefined && (
						<>
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
										<AlertDialogTitle>Delete query</AlertDialogTitle>
									</AlertDialogHeader>
									<div className="text-base text-gray-700 max-h-full overflow-auto px-2">
										{deletePromptForIndex !== undefined && (
											<>
												<span className="">
													Query:{" "}
													<span className="font-semibold">
														{(constraints[deletePromptForIndex]?.name ?? "").length > 0
															? constraints[deletePromptForIndex]?.name
															: `Query ${deletePromptForIndex + 1}`}
													</span>
												</span>
												<br />
												<br />
											</>
										)}
										This deletes the query with all its boxes. It cannot be undone.
									</div>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											onClick={() => {
												const deleted = deletePromptForIndex;
												if (deleted === undefined) return;
												// Saves the open query under its index before the later ones shift down.
												changeIndex(activeIndex);
												prevDataRef.current.splice(deleted, 1);
												if (activeIndex !== undefined && deleted <= activeIndex) {
													setActiveIndex(deleted === activeIndex ? undefined : activeIndex - 1);
												}
												setConstraints((constraints) => {
													const newConstraints = [...constraints];
													newConstraints.splice(deleted, 1);
													return newConstraints;
												});
											}}
										>
											Delete
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>

							<ReactFlowProvider>
								<div className="w-full h-full flex flex-col">
									<Dialog open={showConstraintSelection} onOpenChange={setShowConstraintSelection}>
										<DialogContent className="flex flex-col max-h-full max-w-2xl">
											<DialogHeader>
												<DialogTitle>Open a query</DialogTitle>
											</DialogHeader>
											<div className="h-[50vh] w-full flex flex-col">
												<QueryList
													compact
													area={area}
													items={items}
													activeIndex={activeIndex}
													onOpen={(index) => {
														changeIndex(index);
														setShowConstraintSelection(false);
													}}
													onDelete={setDeletePromptForIndex}
												/>
											</div>
										</DialogContent>
									</Dialog>
									{activeQuery === undefined || activeIndex === undefined ? (
										<div className="flex h-full w-full flex-col">
											<AreaPageHeader
												actions={
													<>
														{discoverButton}
														{constraints.length > 0 && newQueryButton}
													</>
												}
											/>
											{constraints.length === 0 ? (
												<AreaEmptyState
													area={area}
													title="No queries yet"
													action={
														<Button className={area.buttonClass} onClick={createFirstQuery}>
															<LuPlus className="mr-1.5" />
															Create your first query
														</Button>
													}
												>
													A query binds events and objects to variables in boxes, filters them, and
													checks constraints on every binding. Its results show which bindings
													violate them.
												</AreaEmptyState>
											) : (
												<QueryList
													area={area}
													items={items}
													onOpen={(index) => changeIndex(index)}
													onDelete={setDeletePromptForIndex}
													footer={
														<>
															<span>
																{constraints.length}{" "}
																{constraints.length === 1 ? "query" : "queries"}
															</span>
															<AlertHelper
																trigger={
																	<button
																		type="button"
																		className="font-medium hover:text-red-700 underline-offset-4 hover:underline"
																	>
																		Delete all…
																	</button>
																}
																title={"Delete all queries"}
																initialData={undefined}
																content={() => (
																	<p>This deletes every query. It cannot be undone.</p>
																)}
																submitAction={"Delete all"}
																onSubmit={() => {
																	prevDataRef.current = [];
																	setConstraints([]);
																	setActiveIndex(undefined);
																}}
															/>
														</>
													}
												/>
											)}
										</div>
									) : (
										<>
											<div
												className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3 text-left"
												key={activeIndex}
											>
												<BackButton
													label="Back to queries"
													onClick={() => changeIndex(undefined)}
												/>
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
														aria-label="Query name"
														className="w-full rounded-md border border-transparent bg-transparent px-1.5 text-lg font-bold tracking-tight text-slate-900 outline-none hover:border-slate-200 focus:border-slate-300 focus-visible:ring-2 focus-visible:ring-purple-500"
														defaultValue={
															activeQuery.name !== ""
																? activeQuery.name
																: `Query ${activeIndex + 1}`
														}
														onBlur={(ev) => {
															const name = ev.currentTarget.value;
															setConstraints((cs) => {
																const newCs = [...cs];
																newCs[activeIndex].name = name;
																return newCs;
															});
														}}
													/>
													<DescriptionOrSentence
														description={activeQuery.description}
														onChange={(description) =>
															setConstraints((cs) => {
																const newCs = [...cs];
																newCs[activeIndex].description = description;
																return newCs;
															})
														}
													/>
													<QueryTagsEditor
														tags={tagsOf(activeQuery)}
														suggestions={tagCounts(items).map(([t]) => t)}
														onChange={(tags) =>
															setConstraints((cs) => {
																const newCs = [...cs];
																newCs[activeIndex] = withTags(newCs[activeIndex], tags);
																return newCs;
															})
														}
													/>
												</div>
												<div className="flex flex-col items-end gap-1 text-xs text-slate-600">
													<span className="tabular-nums">
														{plural(activeFlow?.nodes.length ?? 0, "node")} ·{" "}
														{plural(activeFlow?.edges.length ?? 0, "edge")}
													</span>
													<TotalViolationInfo
														violations={prevDataRef.current[activeIndex]?.violations}
														flowJSON={activeFlow}
													/>
												</div>
												<span aria-hidden="true" className="h-8 w-px bg-slate-200" />
												<Button variant="outline" onClick={() => setShowConstraintSelection(true)}>
													{constraints.length} {constraints.length === 1 ? "query" : "queries"}
												</Button>
												{discoverButton}
												{newQueryButton}
											</div>
											<div className="relative w-full flex-1 min-h-0">
												<div className="xl:w-full min-h-140 h-full border border-slate-200 rounded-xl p-2 bg-white">
													{ocelInfo !== undefined && (
														<VisualEditor
															constraintInfo={activeQuery}
															queryKey={activeIndex}
															ocelInfo={ocelInfo}
														/>
													)}
												</div>
											</div>
										</>
									)}
								</div>
							</ReactFlowProvider>
						</>
					)}
				</div>
			</FlowContext.Provider>
		</div>
	);
}

function plural(count: number, noun: string) {
	return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
