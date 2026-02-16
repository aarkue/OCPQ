import toast from "react-hot-toast";
import Spinner from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { useBackend } from "@/hooks/useBackend";
import type { OCELInfo } from "@/types/ocel";

interface OcelFilePickerProps {
	loading: boolean;
	setLoading: (loading: boolean) => void;
	onOcelLoaded: (info: OCELInfo) => void;
}

export function OcelFilePicker({ loading, setLoading, onOcelLoaded }: OcelFilePickerProps) {
	const backend = useBackend();

	if (!backend["ocel/picker"]) {
		return null;
	}

	const handleClick = () => {
		setLoading(true);
		toast
			.promise(backend["ocel/picker"]!(), {
				loading: "Loading OCEL2...",
				success: "Imported OCEL2",
				error: (e) => `Failed to load OCEL2\n${String(e)}`,
			})
			.then(onOcelLoaded)
			.finally(() => setLoading(false));
	};

	return (
		<>
			<Button size="lg" disabled={loading} onClick={handleClick}>
				{loading && <Spinner />}
				Select a file...
			</Button>
			<div className="mt-2 italic">or</div>
		</>
	);
}
