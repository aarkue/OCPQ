import { memo, useMemo } from "react";
import { IoChevronBack, IoChevronForward } from "react-icons/io5";
import type { PathSchemaStep } from "@/types/generated/PathSchemaStep";
import type { PathTypeRef } from "@/types/generated/PathTypeRef";
import { typeColor } from "./lib";

interface Props {
	source: PathTypeRef;
	steps: PathSchemaStep[];
	compact?: boolean;
}

/** One node on the rendered path: the reached type plus the relation that reaches it. */
interface PathNode {
	type: PathTypeRef;
	qualifier?: string;
	reverse?: boolean;
}

function pathNodes(source: PathTypeRef, steps: PathSchemaStep[]): PathNode[] {
	const nodes: PathNode[] = [{ type: source }];
	for (const s of steps) {
		nodes.push({
			type: s.reverse ? s.source : s.target,
			qualifier: s.qualifier,
			reverse: s.reverse,
		});
	}
	return nodes;
}

function abbreviate(name: string, maxLen = 12): string {
	return name.length <= maxLen ? name : `${name.slice(0, maxLen)}...`;
}

function stepColors(isFirst: boolean, isLast: boolean, colors: ReturnType<typeof typeColor>) {
	if (isFirst)
		return { bg: "hsl(155, 40%, 88%)", text: "hsl(155, 55%, 25%)", border: "hsl(155, 45%, 55%)" };
	if (isLast)
		return { bg: "hsl(350, 40%, 90%)", text: "hsl(350, 55%, 30%)", border: "hsl(350, 45%, 60%)" };
	return colors;
}

function CompactPath({ nodes }: { nodes: PathNode[] }) {
	return (
		<span className="inline-flex items-center gap-0.5 overflow-hidden">
			{nodes.map((step, i) => {
				const kind = step.type.is_event ? "event" : "object";
				const { bg, text, border } = stepColors(
					i === 0,
					i === nodes.length - 1,
					typeColor(step.type.name, kind),
				);
				return (
					<span key={`${step.type.name}-${i}`} className="inline-flex items-center shrink-0">
						{i > 0 &&
							(step.reverse ? (
								<IoChevronBack
									className="text-gray-400 w-4 h-4 shrink-0"
									title={step.qualifier || undefined}
								/>
							) : (
								<IoChevronForward
									className="text-gray-400 w-4 h-4 shrink-0"
									title={step.qualifier || undefined}
								/>
							))}
						<span
							className="inline-block px-1.5 py-0.5 text-[13px] font-semibold leading-tight"
							style={{
								backgroundColor: bg,
								color: text,
								border: `1px solid ${border}`,
								borderRadius: kind === "event" ? "3px" : "9px",
							}}
						>
							{abbreviate(step.type.name)}
						</span>
					</span>
				);
			})}
		</span>
	);
}

function FullPath({ nodes }: { nodes: PathNode[] }) {
	return (
		<div className="flex items-center gap-0 overflow-x-auto py-1">
			{nodes.map((step, i) => {
				const kind = step.type.is_event ? "event" : "object";
				const { bg, text, border } = stepColors(
					i === 0,
					i === nodes.length - 1,
					typeColor(step.type.name, kind),
				);
				return (
					<div key={`${step.type.name}-${i}`} className="flex items-center gap-0 shrink-0">
						{i > 0 && (
							<div className="flex flex-col items-center mx-1">
								{step.qualifier && (
									<span className="text-[8px] text-gray-400 leading-tight font-mono">
										{step.qualifier}
									</span>
								)}
								<svg width="28" height="10" viewBox="0 0 28 10" className="shrink-0">
									<line
										x1={step.reverse ? 6 : 0}
										y1="5"
										x2={step.reverse ? 28 : 22}
										y2="5"
										stroke="#9ca3af"
										strokeWidth="1.5"
									/>
									{step.reverse ? (
										<polygon points="6,2 0,5 6,8" fill="#9ca3af" />
									) : (
										<polygon points="22,2 28,5 22,8" fill="#9ca3af" />
									)}
								</svg>
							</div>
						)}
						<div
							className="px-2.5 py-1 text-[11px] font-semibold leading-tight whitespace-nowrap"
							style={{
								backgroundColor: bg,
								color: text,
								border: `2px solid ${border}`,
								borderRadius: kind === "event" ? "3px" : "10px",
							}}
						>
							{step.type.name}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function SchemaPathDiagramInner({ source, steps, compact = false }: Props) {
	const nodes = useMemo(() => pathNodes(source, steps), [source, steps]);
	return compact ? <CompactPath nodes={nodes} /> : <FullPath nodes={nodes} />;
}

const SchemaPathDiagram = memo(SchemaPathDiagramInner);
export default SchemaPathDiagram;
