import "./globals.css";
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  BackendProviderContext,
  DEFAULT_BACKEND_URL,
  getAPIServerBackendProvider,
} from "./BackendProviderContext.ts";
import { MainRouterProvider } from "./router.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BackendProviderContext.Provider
      value={getAPIServerBackendProvider(DEFAULT_BACKEND_URL)}
    >
      <MainRouterProvider />
    </BackendProviderContext.Provider>
  </React.StrictMode>,
);
