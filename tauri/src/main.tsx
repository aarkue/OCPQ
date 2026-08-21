import "$/globals.css";
import "$/index.css";
import "@r4pm/components/ui/styles.css";
import { check } from "@tauri-apps/plugin-updater";
import React from "react";
import ReactDOM from "react-dom/client";
import { BackendProviderContext, createBackendProvider } from "$/BackendProviderContext";
import { createTauriBackend } from "$/bindings/tauri-backend";
import { MainRouterProvider } from "$/router";

/** The desktop backend is the shared tauri transport plus the updater. The updater stays here
 *  (not in `bindings/tauri-backend.ts`) since `frontend/` typechecks without the tauri package. */
const backend = {
	...createBackendProvider(createTauriBackend()),
	"check-for-updates": () => check(),
};

const root = document.getElementById("root");
if (root === null) {
	throw new Error("no #root element to mount into");
}

ReactDOM.createRoot(root).render(
	<React.StrictMode>
		<BackendProviderContext.Provider value={backend}>
			<MainRouterProvider />
		</BackendProviderContext.Provider>
	</React.StrictMode>,
);
