/** Compact stat card whose background and label opacity scale with `intensity` (0..1). */
export default function StatCard({
	label,
	value,
	intensity,
	bg,
	fg,
}: {
	label: string;
	value: string;
	intensity: number;
	bg: [number, number, number];
	fg: [number, number, number];
}) {
	const t = Math.max(0, Math.min(1, intensity));
	return (
		<div
			className="flex-1 min-w-0 rounded px-1.5 py-1 text-center"
			style={{ backgroundColor: `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, ${0.06 + t * 0.2})` }}
		>
			<p
				className="text-[10px] uppercase tracking-wider leading-tight"
				style={{ color: `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, ${0.55 + t * 0.45})` }}
			>
				{label}
			</p>
			<p className="text-[12px] font-semibold font-mono text-gray-800 truncate">{value}</p>
		</div>
	);
}
