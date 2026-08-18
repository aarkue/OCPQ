import "$/globals.css";
import "$/index.css";
import "@r4pm/components/ui/styles.css";
import { check } from "@tauri-apps/plugin-updater";
import React from "react";
import ReactDOM from "react-dom/client";
import { BackendProviderContext, createBackendProvider } from "$/BackendProviderContext";
import { createTauriBackend } from "$/bindings/tauri-backend";
import { MainRouterProvider } from "$/router";

/** The desktop backend is the shared tauri transport, plus the updater.
 *
 *  The updater stays here rather than in `bindings/tauri-backend.ts` because
 *  `@tauri-apps/plugin-updater` is a dependency of this project only: the shared transport reaches
 *  tauri through `__TAURI_INTERNALS__` so that `frontend/` typechecks without any tauri package,
 *  and the updater's `Update` object cannot be reconstructed that way. */
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
