import { useState } from "react";
import toast from "react-hot-toast";
import Spinner from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useBackend } from "@/hooks/useBackend";
import type { OCELInfo } from "@/types/ocel";

interface OcelSelectorProps {
	availableOcels: string[];
	loading: boolean;
	setLoading: (loading: boolean) => void;
	onOcelLoaded: (info: OCELInfo) => void;
}

export function OcelSelector({
	availableOcels,
	loading,
	setLoading,
	onOcelLoaded,
}: OcelSelectorProps) {
	const backend = useBackend();
	const [selectedOcel, setSelectedOcel] = useState<string>();

	const handleLoad = async () => {
		if (!selectedOcel || !backend["ocel/load"]) return;

		setLoading(true);
		try {
			await toast.promise(backend["ocel/load"](selectedOcel).then(onOcelLoaded), {
				loading: "Loading OCEL...",
				success: "Loaded OCEL",
				error: (e) => `Failed to load OCEL\n${String(e)}`,
			});
		} finally {
			setLoading(false);
		}
	};

	if (availableOcels.length === 0 || !backend["ocel/load"]) {
		return null;
	}

	return (
		<div>
			<Select value={selectedOcel} onValueChange={setSelectedOcel}>
				<SelectTrigger className="w-[180px] mx-auto my-2">
					<SelectValue placeholder="Select an OCEL" />
				</SelectTrigger>
				<SelectContent>
					{availableOcels.map((ocelName) => (
						<SelectItem key={ocelName} value={ocelName}>
							{ocelName}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Button disabled={loading || !selectedOcel} size="default" onClick={handleLoad}>
				{loading && <Spinner />}
				<span>Load Selected OCEL</span>
			</Button>
		</div>
	);
}
