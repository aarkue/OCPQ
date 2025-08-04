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
import * as dialog from "@tauri-apps/plugin-dialog";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebview } from "@tauri-apps/api/webview";

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
        filters: [{ name: "OCEL2", extensions: ["json", "xml", "sqlite", "sqlite3", "db"] }],
      });
    }
    if (typeof path === "string") {
      const ocelInfo: OCELInfo = await invoke("import_ocel", { path });
      return ocelInfo;
    }
    throw new Error("No file selected");
  },
  "ocel/upload": async (ocelFile) => {
    const format = ocelFile.name.endsWith(".json")
      ? "json"
      : ocelFile.name.endsWith(".xml")
        ? "xml"
        : "sqlite";
    const bytes = await ocelFile.arrayBuffer();
    const ocelInfo: OCELInfo = await new Promise((res, rej) => setTimeout(async () => {
      const ocelInfo: OCELInfo = await invoke("import_ocel_slice", { data: bytes, format });
      res(ocelInfo);
    }, 100));
    return ocelInfo;

  },

  "ocel/check-constraints-box": async (tree, measurePerformance) => {
    return await invoke("check_with_box_tree", { req: { tree, measurePerformance } });
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
    return await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter") {
        f({ type: "enter", path: event.payload.paths[0] })
      } else if (event.payload.type === "leave") {
        f({ type: "leave" })
      } else if (event.payload.type === "drop") {
        f({ type: "drop", path: event.payload.paths[0] })
      }
    })
  },
  "ocel/get-initial-files": () => {
    return invoke("get_initial_files")
  }
};

// const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
//  if (event.payload.type === 'over') {
//    console.log('User hovering', event.payload.position);
//  } else if (event.payload.type === 'drop') {
//    console.log('User dropped', event.payload.paths);
//  } else {
//    console.log('File drop cancelled');
//  }
// });

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BackendProviderContext.Provider value={tauriBackend}>
      <MainRouterProvider />
    </BackendProviderContext.Provider>
  </React.StrictMode>,
);
