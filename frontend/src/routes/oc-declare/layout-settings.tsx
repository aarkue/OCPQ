import { LuSettings2 } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useLocalStorageState } from "@/hooks";

export type OCDeclareLayoutSettings = {
	/** Let the graph re-lay-out by itself: after a drop, and when a display toggle or a paste changes
	 *  what the arcs need. The Layout button runs regardless. */
	relayoutOnChange: boolean;
	/** Plain activities: near-white fill with a dark border, instead of per-activity colours. */
	oldschoolColors: boolean;
};

const STORAGE_KEY = "oced-ocdeclare-layout-settings";
const DEFAULTS: OCDeclareLayoutSettings = {
	relayoutOnChange: true,
	oldschoolColors: false,
};

/**
 * Plain boxes. The fill is resolved separately from the border, which makes this a real white and
 * not a tint of the border colour. `Canvas`/`CanvasText` follow the light/dark theme. The border
 * needs a hex, because the node appends an alpha suffix to it.
 */
type ActivityColor = (name: string, mode?: "normal" | "foreground" | "light" | "surface") => string;
const oldschoolActivityColor: ActivityColor = (_name, mode) => {
	if (mode === "surface") return "Canvas";
	if (mode === "foreground") return "CanvasText";
	return "#374151";
};

export function useOCDeclareLayoutSettings() {
	const [settings, setSettings] = useLocalStorageState<OCDeclareLayoutSettings>(
		STORAGE_KEY,
		DEFAULTS,
	);
	const { relayoutOnChange, oldschoolColors } = { ...DEFAULTS, ...settings };
	return {
		settings: { relayoutOnChange, oldschoolColors },
		setSettings,
		activityColor: oldschoolColors ? oldschoolActivityColor : undefined,
	};
}

export function OCDeclareLayoutSettingsPopover({
	settings,
	setSettings,
}: {
	settings: OCDeclareLayoutSettings;
	setSettings: (update: (prev: OCDeclareLayoutSettings) => OCDeclareLayoutSettings) => void;
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button size="icon" variant="outline" title="Layout settings" className="bg-white">
					<LuSettings2 />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-72 flex flex-col gap-y-3">
				<h3 className="font-semibold text-sm">Layout</h3>
				<div className="flex items-start justify-between gap-x-3">
					<div>
						<Label htmlFor="oc-declare-oldschool">Plain activities</Label>
						<p className="text-xs text-muted-foreground">
							White boxes with dark borders instead of per-activity colours.
						</p>
					</div>
					<Switch
						id="oc-declare-oldschool"
						checked={settings.oldschoolColors}
						onCheckedChange={(v) => setSettings((p) => ({ ...p, oldschoolColors: v }))}
					/>
				</div>
				<div className="flex items-start justify-between gap-x-3">
					<div>
						<Label htmlFor="oc-declare-relayout-on-change">Automatic re-layout</Label>
						<p className="text-xs text-muted-foreground">
							Runs after moving nodes and changing settings. The Layout button always works.
						</p>
					</div>
					<Switch
						id="oc-declare-relayout-on-change"
						checked={settings.relayoutOnChange}
						onCheckedChange={(v) => setSettings((p) => ({ ...p, relayoutOnChange: v }))}
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}
