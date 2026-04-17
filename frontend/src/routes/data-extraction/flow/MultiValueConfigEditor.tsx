import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { MultiValueConfig } from "@/types/generated/MultiValueConfig";

const COMMON_DELIMITERS = [
	{ value: ",", label: "Comma (,)" },
	{ value: ";", label: "Semicolon (;)" },
	{ value: "/", label: "Slash (/)" },
	{ value: "|", label: "Pipe (|)" },
	{ value: "\t", label: "Tab" },
	{ value: " ", label: "Space" },
];

const CUSTOM_DELIMITER_VALUE = "__custom__";

export const DEFAULT_MULTI_VALUE_CONFIG: MultiValueConfig = {
	enabled: false,
	delimiter: ",",
	trim_values: true,
	regex_pattern: null,
};

interface MultiValueConfigEditorProps {
	label?: string;
	/** null means "not configured" (equivalent to disabled). */
	value: MultiValueConfig | null;
	onChange: (v: MultiValueConfig | null) => void;
	/** Optional preview: the raw string from a sample cell. */
	previewValue?: string;
}

/**
 * Compact editor for MultiValueConfig: lets the user enable multi-value splitting,
 * pick delimiter (preset or custom), or switch to regex extraction.
 */
export function MultiValueConfigEditor({
	label = "Multiple values per cell",
	value,
	onChange,
	previewValue,
}: MultiValueConfigEditorProps) {
	const enabled = value?.enabled ?? false;
	const mode: "delimiter" | "regex" = value?.regex_pattern != null ? "regex" : "delimiter";
	const delimiter = value?.delimiter ?? ",";
	const trim = value?.trim_values ?? true;
	const regex = value?.regex_pattern ?? "";

	const presetMatch = COMMON_DELIMITERS.find((d) => d.value === delimiter);
	// Once the user has explicitly chosen "Custom...", stay in custom mode even if the
	// typed delimiter happens to match a preset value. Reset when they pick a preset.
	const [customSticky, setCustomSticky] = useState(() => !presetMatch);
	const inCustomMode = customSticky || !presetMatch;
	const delimiterSelectValue = inCustomMode ? CUSTOM_DELIMITER_VALUE : delimiter;

	const update = (patch: Partial<MultiValueConfig>) => {
		const next: MultiValueConfig = {
			enabled: value?.enabled ?? true,
			delimiter: value?.delimiter ?? ",",
			trim_values: value?.trim_values ?? true,
			regex_pattern: value?.regex_pattern ?? null,
			...patch,
		};
		onChange(next);
	};

	const toggleEnabled = (on: boolean) => {
		if (!on) {
			onChange(null);
			return;
		}
		onChange({
			enabled: true,
			delimiter: delimiter || ",",
			trim_values: trim,
			regex_pattern: mode === "regex" ? regex : null,
		});
	};

	return (
		<div className="space-y-2">
			<label className="flex items-center gap-2 cursor-pointer">
				<input
					type="checkbox"
					checked={enabled}
					onChange={(e) => toggleEnabled(e.target.checked)}
					className="rounded border-slate-300 text-sky-500 focus:ring-sky-500"
				/>
				<span className="text-xs font-medium text-slate-600">{label}</span>
			</label>

			{enabled && (
				<div className="pl-5 space-y-2">
					{/* Mode switch */}
					<div className="flex rounded-md border border-slate-200 text-[10px] overflow-hidden w-fit">
						<button
							type="button"
							onClick={() => update({ regex_pattern: null })}
							className={`px-2 py-0.5 transition-colors ${
								mode === "delimiter"
									? "bg-sky-500 text-white"
									: "bg-white text-slate-500 hover:bg-slate-50"
							}`}
						>
							Delimiter
						</button>
						<button
							type="button"
							onClick={() =>
								update({
									regex_pattern: regex || "",
								})
							}
							className={`px-2 py-0.5 transition-colors ${
								mode === "regex"
									? "bg-sky-500 text-white"
									: "bg-white text-slate-500 hover:bg-slate-50"
							}`}
						>
							Regex
						</button>
					</div>

					{mode === "delimiter" && (
						<>
							<div className="flex items-center gap-2">
								<Label className="text-xs text-slate-500 whitespace-nowrap">Delimiter:</Label>
								<Select
									value={delimiterSelectValue}
									onValueChange={(v) => {
										if (v === CUSTOM_DELIMITER_VALUE) {
											setCustomSticky(true);
											// Clear if we were on a preset so the user sees an empty input.
											update({ delimiter: presetMatch ? "" : delimiter });
										} else {
											setCustomSticky(false);
											update({ delimiter: v });
										}
									}}
								>
									<SelectTrigger className="h-7 text-xs flex-1 min-w-0">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{COMMON_DELIMITERS.map((d) => (
											<SelectItem key={d.value} value={d.value} className="text-xs">
												{d.label}
											</SelectItem>
										))}
										<SelectItem value={CUSTOM_DELIMITER_VALUE} className="text-xs">
											Custom...
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{inCustomMode && (
								<input
									className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
									placeholder="Enter custom delimiter"
									value={delimiter}
									onChange={(e) => update({ delimiter: e.target.value })}
								/>
							)}
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={trim}
									onChange={(e) => update({ trim_values: e.target.checked })}
									className="rounded border-slate-300 text-sky-500 focus:ring-sky-500"
								/>
								<span className="text-xs text-slate-500">Trim whitespace from values</span>
							</label>
						</>
					)}

					{mode === "regex" && (
						<div className="space-y-1">
							<Label className="text-xs text-slate-500">Regex pattern</Label>
							<input
								className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
								placeholder={"e.g. (?:^|/)([\\w-]+)"}
								value={regex}
								onChange={(e) => update({ regex_pattern: e.target.value })}
							/>
							<div className="text-[10px] text-slate-500 space-y-1">
								<p className="text-slate-400">
									Each capture group becomes one value. If no groups, the full match is used.
								</p>
								<details className="group">
									<summary className="cursor-pointer text-slate-500 hover:text-slate-700 select-none">
										Examples
									</summary>
									<ul className="mt-1 ml-2 space-y-1 font-mono">
										<li>
											<span className="text-slate-500">Input:</span>{" "}
											<span className="text-slate-700">
												i1#part-of&#123;...&#125;/i2#part-of&#123;...&#125;
											</span>
											<br />
											<span className="text-slate-500">Pattern:</span>{" "}
											<code className="px-1 bg-slate-100 rounded">(?:^|/)([\w-]+)</code>{" "}
											<span className="text-slate-500">→ i1, i2</span>
										</li>
										<li>
											<span className="text-slate-500">Input:</span>{" "}
											<span className="text-slate-700">o1</span>
											<br />
											<span className="text-slate-500">Pattern:</span>{" "}
											<code className="px-1 bg-slate-100 rounded">(?:^|/)([\w-]+)</code>{" "}
											<span className="text-slate-500">→ o1</span>{" "}
											<span className="text-slate-400">(same pattern, single element)</span>
										</li>
										<li>
											<span className="text-slate-500">Input:</span>{" "}
											<span className="text-slate-700">ORD-1, ORD-2, ORD-3</span>
											<br />
											<span className="text-slate-500">Pattern:</span>{" "}
											<code className="px-1 bg-slate-100 rounded">ORD-\d+</code>{" "}
											<span className="text-slate-500">-&gt; ORD-1, ORD-2, ORD-3</span>
										</li>
										<li>
											<span className="text-slate-500">Input:</span>{" "}
											<span className="text-slate-700">id=42; id=57</span>
											<br />
											<span className="text-slate-500">Pattern:</span>{" "}
											<code className="px-1 bg-slate-100 rounded">id=(\d+)</code>{" "}
											<span className="text-slate-500">-&gt; 42, 57</span>
										</li>
									</ul>
								</details>
							</div>
						</div>
					)}

					{previewValue && (
						<MultiValuePreview
							raw={previewValue}
							delimiter={delimiter}
							trim={trim}
							regex={mode === "regex" ? regex : null}
						/>
					)}
				</div>
			)}
		</div>
	);
}

function MultiValuePreview({
	raw,
	delimiter,
	trim,
	regex,
}: {
	raw: string;
	delimiter: string;
	trim: boolean;
	regex: string | null;
}) {
	let values: string[] = [];
	let error: string | null = null;

	if (regex != null) {
		if (!regex) {
			error = "No pattern";
		} else {
			try {
				const re = new RegExp(regex, "g");
				const out: string[] = [];
				for (const m of raw.matchAll(re)) {
					if (m.length > 1) {
						for (let i = 1; i < m.length; i++) {
							const g = m[i];
							if (g != null) {
								const v = trim ? g.trim() : g;
								if (v) out.push(v);
							}
						}
					} else {
						const v = trim ? m[0].trim() : m[0];
						if (v) out.push(v);
					}
				}
				values = out;
			} catch (e) {
				error = e instanceof Error ? e.message : String(e);
			}
		}
	} else if (delimiter) {
		values = raw
			.split(delimiter)
			.map((v) => (trim ? v.trim() : v))
			.filter((v) => v);
	} else {
		values = [raw];
	}

	return (
		<div className="text-[10px] bg-slate-50 rounded p-2 space-y-1">
			<div className="text-slate-500">
				Preview splitting "<span className="font-mono">{raw}</span>":
			</div>
			{error ? (
				<div className="text-red-500 font-mono">{error}</div>
			) : (
				<div className="flex flex-wrap gap-1">
					{values.map((val, idx) => (
						<span
							key={idx}
							className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-mono"
						>
							{val}
						</span>
					))}
				</div>
			)}
		</div>
	);
}
