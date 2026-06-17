/** Small letter badge marking a type as an event (E, blue square) or object (O, orange
 *  round), matching the type-graph node shapes so the kind reads at a glance. */
export default function KindBadge({ isEvent }: { isEvent: boolean }) {
	return (
		<span
			title={isEvent ? "Event type" : "Object type"}
			className={`shrink-0 px-1 text-[9px] font-bold leading-[14px] text-white ${
				isEvent ? "rounded-sm bg-blue-500" : "rounded-full bg-orange-500"
			}`}
		>
			{isEvent ? "E" : "O"}
		</span>
	);
}
