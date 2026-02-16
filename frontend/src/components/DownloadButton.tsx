import { useContext, useState } from "react";
import toast from "react-hot-toast";
import { LuDownload } from "react-icons/lu";
import { BackendProviderContext } from "@/BackendProviderContext";
import { useBackend } from "@/hooks";
import { Button } from "./ui/button";

export function DownloadButton({ fileName, value }: { fileName: string; value: string | Blob }) {
	const [showConfirmation, setShowConfirmation] = useState(false);
	const backend = useBackend();
	return (
		<Button
			className="h-7"
			variant="ghost"
			size="icon"
			title="Download"
			onClick={() => {
				backend["download-blob"](
					typeof value === "string" ? new Blob([value], { type: "text/plain" }) : value,
					fileName,
				);
				toast.success(`Downloaded ${fileName}`, { id: "download-button" });
				setShowConfirmation(true);
				setTimeout(() => setShowConfirmation(false), 400);
			}}
		>
			{showConfirmation && <LuDownload className="text-green-600" />}
			{!showConfirmation && <LuDownload />}
		</Button>
	);
}
