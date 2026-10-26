import { useSearchParams } from "react-router-dom";

import OcelElementInfo from "@/components/OcelElementInfo";
import type { ElementRef } from "@/ElementInfo";

export default function OcelElementViewer() {
	const [s, setSearchParams] = useSearchParams();
	const id: string | null = s.get("id");
	const type: "object" | "event" | string | null = s.get("type");
	if (type !== "object" && type !== "event") {
		return <div>Error: No Type provided.</div>;
	}
	if (id == null) {
		return <div>Error: No ID provided.</div>;
	}
	const navigate = (el: ElementRef) => {
		if ("id" in el.req) {
			setSearchParams({ id: el.req.id, type: el.type });
		}
	};
	return <OcelElementInfo type={type} req={{ id }} onNavigate={navigate} />;
}
