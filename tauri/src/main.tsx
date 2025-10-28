import {
  type BackendProvider,
  BackendProviderContext,
} from "$/BackendProviderContext";
import "$/index.css";
import { MainRouterProvider } from "$/router";
import type { DiscoverConstraintsResponse } from "$/routes/visual-editor/helper/types";
import { BindingBoxTree } from "$/types/generated/BindingBoxTree";
import { OCPQJobOptions } from "$/types/generated/OCPQJobOptions";
import { ConnectionConfig, JobStatus } from "$/types/hpc-backend";
import type {
  EventTypeQualifiers,
  OCELInfo,
  ObjectTypeQualifiers,
} from "$/types/ocel";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app"
import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as dialog from "@tauri-apps/plugin-dialog";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import React from "react";
import ReactDOM from "react-dom/client";

import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { EvaluateBoxTreeResult } from "$/types/generated/EvaluateBoxTreeResult";


const tauriBackend: BackendProvider = {
  "ocel/info": async () => {
    const ocelInfo: OCELInfo | undefined = await invoke("get_current_ocel_info");
    return ocelInfo;
  },
  "ocel/picker": async (givenPath) => {
    let path: string | undefined | null = givenPath;
    if (path === undefined) {
      path = await dialog.open({
        title: "Select an OCEL2 file",
        filters: [{ name: "OCEL2", extensions: ["json", "xml", "sqlite", "sqlite3", "db"] }, { name: "XES", extensions: ["xes", "xes.gz"] }],
      });
    }
    if (typeof path === "string") {
      if (path.endsWith(".xes") || path.endsWith(".xes.gz")) {
        const ocelInfo: OCELInfo = await invoke("import_xes_path_as_ocel", { path });
        return ocelInfo;
      } else {

        const ocelInfo: OCELInfo = await invoke("import_ocel", { path });
        return ocelInfo;
      }
    }
    throw new Error("No file selected");
  },
  "ocel/upload": async (ocelFile) => {
    if (ocelFile.name.endsWith(".xes") || ocelFile.name.endsWith(".xes.gz")) {
      const bytes = await ocelFile.arrayBuffer();
      const ocelInfo: OCELInfo = await new Promise((res, _rej) => setTimeout(async () => {
        const ocelInfo: OCELInfo = await invoke("import_xes_slice_as_ocel", { data: bytes, format: ocelFile.name.endsWith(".xes.gz") ? ".xes.gz" : ".xes" });
        res(ocelInfo);
      }, 100));
      return ocelInfo;
    } else {
      const format = ocelFile.name.endsWith(".json")
        ? "json"
        : ocelFile.name.endsWith(".xml")
          ? "xml"
          : "sqlite";
      const bytes = await ocelFile.arrayBuffer();
      const ocelInfo: OCELInfo = await new Promise((res, _rej) => setTimeout(async () => {
        const ocelInfo: OCELInfo = await invoke("import_ocel_slice", { data: bytes, format });
        res(ocelInfo);
      }, 100));
      return ocelInfo;
    }
  },

  "ocel/check-constraints-box": (tree, measurePerformance) => {
    console.log("Called once");
    return new Promise(async (res, rej) => {
      try {
        const r = await invoke<EvaluateBoxTreeResult>("check_with_box_tree", { req: { tree, measurePerformance } });
        res(r);
      } catch (e) {
        console.log(e);
        rej(e);
      }
    })
  },
  "ocel/event-qualifiers": async () => {
    return await invoke<EventTypeQualifiers>("get_event_qualifiers");
  },
  "ocel/object-qualifiers": async () => {
    return await invoke<ObjectTypeQualifiers>("get_object_qualifiers");
  },
  "ocel/discover-constraints": async (options) => {
    return await invoke<DiscoverConstraintsResponse>(
      "auto_discover_constraints",
      { options }
    );
  },
  "ocel/discover-oc-declare": async (options) => {
    return await invoke(
      "auto_discover_oc_declare",
      { options }
    );
  },
  "ocel/evaluate-oc-declare-arcs": async (arcs) => {
    return await invoke("evaluate_oc_declare_arcs",{arcs})
  },
  "ocel/export-bindings": async (nodeIndex, options) => {
    const res: undefined = await invoke("export_bindings_table", { nodeIndex, options });
    return undefined;
  },
  "ocel/graph": async (options) => {
    return await invoke("ocel_graph", { options });
  },
  "ocel/get-event": async (req) => {
    return await invoke("get_event", { req });
  },
  "ocel/get-object": async (req) => {
    return await invoke("get_object", { req });
  },
  "ocel/export-filter-box": async (tree: BindingBoxTree, format: "XML" | "JSON" | "SQLITE") => {
    const res: undefined = await invoke("export_filter_box", { req: { tree, exportFormat: format } });
    //  const blob = new Blob([res],{type: format === "JSON" ? 
    //   "application/json" : (format === "XML" ? "text/xml" : "application/vnd.sqlite3")})
    //  return blob;
    return undefined;
  },
  "hpc/login": async (connectionConfig: ConnectionConfig): Promise<void> => {
    return await invoke("login_to_hpc_tauri", { cfg: connectionConfig });
  },
  "hpc/start": async (jobOptions: OCPQJobOptions): Promise<string> => {
    return await invoke("start_hpc_job_tauri", { options: jobOptions });
  },
  "hpc/job-status": async (jobID: string): Promise<JobStatus> => {
    return await invoke("get_hpc_job_status_tauri", { jobId: jobID });
  },
  "download-blob": async (blob, fileName) => {
    const filePath = await save({ defaultPath: fileName });
    if (filePath) {
      await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
    }
  },
  "drag-drop-listener": async (f) => {
    const unregister = await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter") {
        f({ type: "enter", path: event.payload.paths[0] })
      } else if (event.payload.type === "leave") {
        f({ type: "leave" })
      } else if (event.payload.type === "drop") {
        f({ type: "drop", path: event.payload.paths[0] })
      }
    });
    return unregister;
  },
  "ocel/get-initial-files": () => {
    return invoke("get_initial_files")
  },
  "check-for-updates": async () => {
    const update = await check();
    if (update === null) {
      return update;
    }
    return update
  },
  "restart": () => {
    return relaunch()
  },
  "get-version": () => {
    return getVersion()
  }
};

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BackendProviderContext.Provider value={tauriBackend}>
      <MainRouterProvider />
    </BackendProviderContext.Provider>
  </React.StrictMode>,
);
