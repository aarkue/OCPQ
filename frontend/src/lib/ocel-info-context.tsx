import { createContext } from "react";
import type { OCELInfo } from "@/types/ocel";

export const OcelInfoContext = createContext<OCELInfo | undefined>(undefined);
