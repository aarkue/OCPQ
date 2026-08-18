import "./globals.css";
import "./index.css";
import "@r4pm/components/ui/styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import {
	BackendProviderContext,
	createBackendProvider,
	DEFAULT_BACKEND_URL,
	getAPIServerBackendProvider,
} from "./BackendProviderContext.ts";
import { createWasmBackend } from "./bindings/wasm-backend.ts";
import { MainRouterProvider } from "./router.tsx";

/** `?backend=wasm` runs the engine in the page instead of talking to the axum server. Needs the
 *  wasm package built into `public/wasm` first (`pnpm build:wasm`). */
const useWasm = new URLSearchParams(window.location.search).get("backend") === "wasm";

const backend = useWasm
	? createBackendProvider(createWasmBackend())
	: getAPIServerBackendProvider(DEFAULT_BACKEND_URL);

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<BackendProviderContext.Provider value={backend}>
			<MainRouterProvider />
		</BackendProviderContext.Provider>
	</React.StrictMode>,
);
