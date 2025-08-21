import { useContext } from "react";
import { VisualEditorContext } from "../VisualEditorContext";
import { MdEvent } from "react-icons/md";
import { LuBox } from "react-icons/lu";
import type { Variable } from "@/types/generated/Variable";
import clsx from "clsx";

export function getEvVarName(eventVar: number) {
  return function GetEvVarName() {
    return <EvVarName eventVar={eventVar} />;
  };
}

export function EvVarName({ eventVar }: { eventVar: number }) {
  const { getVarName } = useContext(VisualEditorContext);
  const varInfo = getVarName(eventVar, "event");
  return (
    <span className="font-mono font-semibold" style={{ color: varInfo.color }}>
      <MdEvent className="inline-block -mr-1.5" /> {varInfo.name}
    </span>
  );
}

export function getObVarName(obVar: number, disabledStyle: boolean = false) {
  return function GetObVarName() {
    return <ObVarName obVar={obVar} disabledStyle={disabledStyle} />;
  };
}

export function ObVarName({ obVar, disabledStyle }: { obVar: number, disabledStyle?: boolean }) {
  const { getVarName } = useContext(VisualEditorContext);
  const varInfo = getVarName(obVar, "object");
  return (
    <span className={clsx("font-mono font-semibold", disabledStyle === true && "text-stone-400")} style={{ color: disabledStyle === true ? undefined : varInfo.color }}>
      <LuBox className="inline-block -mr-1.5" /> {varInfo.name}
    </span>
  );
}

export function EvOrObVarName({ varName }: { varName: Variable }) {
  if ("Event" in varName) {
    return <EvVarName eventVar={varName.Event} />;
  }
  return <ObVarName obVar={varName.Object} />;
}
