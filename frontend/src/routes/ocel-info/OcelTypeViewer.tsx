import type { OCELType } from "@/types/ocel";
import {
  Tb123,
  TbCalendar,
  TbDecimal,
  TbLetterCase,
  TbQuestionMark,
  TbToggleLeft,
} from "react-icons/tb";

interface OcelTypeViewerProps {
  typeInfo: OCELType;
  type: "event" | "object";
  clickable?: boolean;
}

export function IconForDataType({ dtype }: { dtype: string }) {
  const size = 24;
  if (dtype === "float") {
    return <TbDecimal className="text-sky-400" size={size + 6} />;
  } else if (dtype === "integer") {
    return <Tb123 className="text-blue-600" size={size + 6} />;
  } else if (dtype === "string") {
    return <TbLetterCase className="text-gray-400" size={size} />;
  } else if (dtype === "time") {
    return <TbCalendar className="text-purple-400" size={size} />;
  } else if (dtype === "boolean") {
    return <TbToggleLeft className="text-sky-400" size={size} />;
  } else {
    return <TbQuestionMark className="text-red-400" size={size} />;
  }
}

export default function OcelTypeViewer(props: OcelTypeViewerProps) {
  return (
    <div className={"block p-2 bg-white m-2 border rounded-lg shadow-md"}>
      <h4 className="font-semibold text-xl">{props.typeInfo.name}</h4>
      <ul className="text-left">
        {props.typeInfo.attributes.map((attr) => (
          <li key={attr.name}>
            <div className="flex gap-x-1 items-center">
              <span className="flex justify-center -mt-1 w-8">
                <IconForDataType dtype={attr.type} />
              </span>
              <span className="font-mono">{attr.name}</span>{" "}
              <span className="text-gray-500">({attr.type})</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
