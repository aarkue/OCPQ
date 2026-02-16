import clsx from "clsx";
import toast from "react-hot-toast";
import { useBackend } from "@/hooks/useBackend";
import type { OCELInfo } from "@/types/ocel";

interface OcelDropzoneProps {
	loading: boolean;
	onFileSelect: (file: File) => void;
	onOcelLoaded: (info: OCELInfo) => void;
	setLoading: (loading: boolean) => void;
}

export function OcelDropzone({
	loading,
	onFileSelect,
	onOcelLoaded,
	setLoading,
}: OcelDropzoneProps) {
	const backend = useBackend();

	const handleDrop = (ev: React.DragEvent) => {
		ev.preventDefault();
		if (loading) return;

		const files = ev.dataTransfer.items;
		for (let i = 0; i < files.length; i++) {
			const file = files[i].getAsFile();
			if (file !== null) {
				setTimeout(() => onFileSelect(file), 500);
				return;
			}
		}
	};

	const handleInputChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
		const file = ev.currentTarget.files?.[0];
		if (file) {
			onFileSelect(file);
		}
	};

	const handleClick = (ev: React.MouseEvent<HTMLInputElement>) => {
		if (backend["ocel/picker"]) {
			ev.preventDefault();
			setLoading(true);
			toast
				.promise(backend["ocel/picker"](), {
					loading: "Loading OCEL2...",
					success: "Imported OCEL2",
					error: (e) => `Failed to load OCEL2\n${String(e)}`,
				})
				.then(onOcelLoaded)
				.finally(() => setLoading(false));
		}
	};

	return (
		<div className="my-4">
			<div
				className="flex items-center justify-center w-full max-w-2xl mx-auto"
				onDragOver={(ev) => ev.preventDefault()}
				onDrop={handleDrop}
			>
				<label
					htmlFor="dropzone-ocel-file"
					className={clsx(
						"flex flex-col items-center justify-center w-full h-64 border-2 border-gray-400 border-dashed rounded-lg cursor-pointer",
						!loading && "bg-blue-50/20 hover:bg-blue-100/30",
						loading && "bg-gray-200/30",
					)}
				>
					<div className="flex flex-col items-center justify-center pt-5 pb-6">
						<p className="mb-2 text-sm text-gray-500">
							<span className="font-semibold">Click to select an OCEL file</span> or drag a file
							here
						</p>
						<p className="text-xs text-gray-500">
							Supported: OCEL2-JSON, OCEL2-XML, OCEL2-SQLITE, XES/XES.GZ (Interpreted as OCEL)
						</p>
					</div>
					<input
						disabled={loading}
						onClickCapture={handleClick}
						onChange={handleInputChange}
						id="dropzone-ocel-file"
						type="file"
						className="hidden"
						accept=".json, .xml, .sqlite, .xes, .xes.gz"
					/>
				</label>
			</div>
		</div>
	);
}
