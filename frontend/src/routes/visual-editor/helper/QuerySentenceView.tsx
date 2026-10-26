import { type Edge, type Node, useEdges, useNodes } from "@xyflow/react";
import clsx from "clsx";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { LuInfo, LuMessageSquareText, LuPencil } from "react-icons/lu";
import { TypeDot } from "@/components/TypeDot";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { evaluateConstraints } from "./evaluation/evaluate-constraints";
import {
	describeQuery,
	type QuerySentence,
	type SentencePart,
	sentenceText,
	varName,
} from "./query-sentence";
import type { EventTypeLinkData, EventTypeNodeData, GateNodeData } from "./types";

function Part({ part: p }: { part: SentencePart }) {
	switch (p.kind) {
		case "text":
			return p.text;
		case "type":
			return (
				<span title={p.type} className="whitespace-nowrap font-semibold text-slate-900">
					<TypeDot
						isEvent={p.isEvent}
						name={p.type}
						className={clsx("mr-1 inline-block h-2 w-2 align-middle", p.isEvent && "rounded-[2px]")}
					/>
					{p.label}
				</span>
			);
		case "var":
			return (
				<span className="font-mono text-[0.92em] font-semibold text-slate-500">
					{varName(p.variable)}
				</span>
			);
		case "code":
			return (
				<code className="rounded bg-slate-100 px-1 font-mono text-[0.9em] text-slate-800">
					{p.text}
				</code>
			);
	}
}

export function SentenceParts({ parts }: { parts: SentencePart[] }) {
	return parts.map((p, i) => <Part key={i} part={p} />);
}

/** The open query in words, one sentence per top-level box, kept in step with the editor. */
function useLiveSentences(): QuerySentence[] {
	const nodes = useNodes<Node<EventTypeNodeData | GateNodeData>>();
	const edges = useEdges<Edge<EventTypeLinkData>>();
	// Moving a box changes the nodes but not what the query says.
	const key = JSON.stringify([
		nodes.map((n) => [n.id, n.data]),
		edges.map((e) => [e.source, e.target, e.data?.name]),
	]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: key stands for nodes and edges
	return useMemo(
		() =>
			evaluateConstraints(nodes, edges)
				.map(({ tree }) => describeQuery(tree))
				.filter((s) => s.parts.length > 0),
		[key],
	);
}

function Sentences({ sentences }: { sentences: QuerySentence[] }) {
	return sentences.map((s, i) => (
		// Two identical boxes give the same sentence twice.
		<Fragment key={`${i}:${sentenceText(s.parts)}`}>
			{i > 0 && " "}
			<SentenceParts parts={s.parts} />
		</Fragment>
	));
}

/** The whole sentence and its notes, opened from `trigger`. */
function SentencePopover({
	sentences,
	trigger,
}: {
	sentences: QuerySentence[];
	trigger: ReactNode;
}) {
	// Two boxes can raise the same note, which needs saying once.
	const notes = [
		...new Map(sentences.flatMap((s) => s.notes).map((n) => [sentenceText(n), n])).values(),
	];
	return (
		<Popover>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent align="start" className="w-[min(34rem,90vw)] text-sm">
				<p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
					<LuMessageSquareText aria-hidden="true" />
					Automatic description of the query
				</p>
				<p className="leading-relaxed text-slate-800">
					<Sentences sentences={sentences} />
				</p>
				{notes.map((n) => (
					<p key={sentenceText(n)} className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
						<LuInfo aria-hidden="true" className="mt-0.5 shrink-0" />
						<span>
							<SentenceParts parts={n} />
						</span>
					</p>
				))}
			</PopoverContent>
		</Popover>
	);
}

/** The description line under a query's name. Without a description it shows the query as a
 *  one-line sentence that opens in full on click. With one, the sentence moves behind an icon. */
export function DescriptionOrSentence({
	description,
	onChange,
}: {
	description: string;
	onChange: (description: string) => unknown;
}) {
	const sentences = useLiveSentences();
	const [editing, setEditing] = useState(false);
	const hasNotes = sentences.some((s) => s.notes.length > 0);
	if (description.trim() === "" && !editing && sentences.length > 0) {
		return (
			<div className="group/desc flex min-w-0 items-center gap-1 px-1.5">
				<LuMessageSquareText
					aria-label="Automatic description of the query"
					className="shrink-0 text-slate-400"
				/>
				<SentencePopover
					sentences={sentences}
					trigger={
						<button
							type="button"
							title="Automatic description of the query. Click to read it in full."
							className="min-w-0 truncate rounded text-left text-sm text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
						>
							<Sentences sentences={sentences} />
						</button>
					}
				/>
				{hasNotes && <LuInfo aria-label="Has notes" className="shrink-0 text-amber-600" />}
				<button
					type="button"
					title="Write a description"
					aria-label="Write a description"
					className="shrink-0 rounded p-0.5 text-slate-500 opacity-0 outline-none group-hover/desc:opacity-100 hover:bg-slate-100 hover:text-slate-800 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-purple-500"
					onClick={() => setEditing(true)}
				>
					<LuPencil />
				</button>
			</div>
		);
	}
	return (
		<div className="flex min-w-0 items-center gap-1">
			<input
				aria-label="Query description"
				placeholder="Add a description"
				// biome-ignore lint/a11y/noAutofocus: opened on purpose from the pencil button
				autoFocus={editing}
				className="w-full rounded-md border border-transparent bg-transparent px-1.5 text-sm text-slate-600 placeholder:text-slate-500 outline-none hover:border-slate-200 focus:border-slate-300 focus-visible:ring-2 focus-visible:ring-purple-500"
				defaultValue={description}
				onBlur={(ev) => {
					onChange(ev.currentTarget.value);
					setEditing(false);
				}}
			/>
			{sentences.length > 0 && (
				<SentencePopover
					sentences={sentences}
					trigger={
						<button
							type="button"
							title="Automatic description of the query"
							aria-label="Automatic description of the query"
							className={clsx(
								"shrink-0 rounded p-1 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-purple-500",
								hasNotes ? "text-amber-600" : "text-slate-500 hover:text-slate-800",
							)}
						>
							<LuMessageSquareText />
						</button>
					}
				/>
			)}
		</div>
	);
}
