import { useSearchParams } from "react-router-dom";

import OcelElementInfo from "@/components/OcelElementInfo";

export default function OcelElementViewer() {
	const [s] = useSearchParams();
	const id: string | null = s.get("id");
	const type: "object" | "event" | string | null = s.get("type");
	if (type !== "object" && type !== "event") {
		return <div>Error: No Type provided.</div>;
	}
	if (id == null) {
		return <div>Error: No ID provided.</div>;
	}
	return <OcelElementInfo type={type} req={{ id }} />;
}
