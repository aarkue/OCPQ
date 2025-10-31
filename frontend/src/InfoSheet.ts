import { createContext } from "react";
import { OCDeclareArc } from "./routes/oc-declare/types/OCDeclareArc";

export type InfoSheetState = {type: "activity-frequencies", activity: string} | {type: "edge-duration-statistics", edge: OCDeclareArc};

type InfoSheetContextValue = {infoSheetState: InfoSheetState|undefined, setInfoSheetState: (newState: InfoSheetState|undefined) => unknown};
export const InfoSheetContext = createContext<InfoSheetContextValue>({infoSheetState: undefined, setInfoSheetState: () => {}})
