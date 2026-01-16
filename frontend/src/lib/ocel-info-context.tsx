import { OCELInfo } from "@/types/ocel";
import { createContext } from "react";

export const OcelInfoContext = createContext<OCELInfo | undefined>(undefined);
