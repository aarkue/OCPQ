import { useContext, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { BackendProviderContext, UpdateInfo } from "@/BackendProviderContext";
import toast, { LoaderIcon } from "react-hot-toast";
import { LuLoader } from "react-icons/lu";
import Spinner from "./Spinner";
import { CgSpinner } from "react-icons/cg";
import { BsCheckCircle } from "react-icons/bs";
import { Progress } from "./ui/progress";

export function UpdateButton() {
  const backend = useContext(BackendProviderContext);
  const [updateState, setUpdateState] = useState<UpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>();
  const [status, setStatus] = useState<{ contentLength?: number, downloaded: number, state: "initial" | "downloading" | "downloaded" | "installing" | "installed" | "restarting", error?: string }>({ downloaded: 0, state: "initial" });
  useEffect(() => {
    if (backend['check-for-updates']) {
      backend['check-for-updates']!().then((res) => {
        console.log({ update: res });
        setUpdateState(res)
      });
    }

    if (backend['get-version']) {
      backend['get-version']().then(setCurrentVersion);
    }

    // async function wait(sec: number, data: any, fail?: false) {
    //     await new Promise((res, rej) => setTimeout(() => {
    //         if (fail) {
    //             rej(data)
    //         } else {
    //             res(data)
    //         }
    //     }, sec * 1000))
    // }

    // setUpdateState({
    //     version: "v0.4.4",
    //     currentVersion: "v0.4.3",
    //     close: async () => {

    //     },
    //     download: async (listener) => {
    //         listener({ event: "Started", data: { contentLength: 100 } });
    //         await wait(2, {})
    //         for (let i = 0; i < 10; i++) {
    //             listener({ event: "Progress", data: { chunkLength: 10 } });
    //             await wait(1, {});
    //         }
    //         await wait(2, {})
    //         listener({ event: "Finished" })
    //     },
    //     install: async () => {
    //         await wait(1, {})
    //     }
    // });
  }, [])

  if(updateState == null && currentVersion === undefined){
    return null;
  }
  if(updateState == null && currentVersion !== undefined){
   return <p className="rounded-lg bg-blue-200 border-blue-300 w-fit p-1 mx-auto text-blue-500 font-bold">v{currentVersion}</p>
    
  }
  return <div className="border p-1 rounded-md shadow-inner shadow-sky-200/50">
    {updateState &&
      <>
        <h2 className="text-lg font-bold mt-1 text-sky-600">Update available
          {updateState.version !== undefined && <span className="text-sm ml-1">{updateState.version}</span>}
        </h2>
        <p className="mb-1 text-sm">Current version: {updateState.currentVersion}</p>
        {status.error == undefined && <>
          {(status.state === "initial" || status.state === "downloading") && <><Button disabled={status.state === "downloading"} onClick={() => {
            setStatus((status) => ({ ...status, state: "downloading" }));
            updateState?.download((ev) => {
              if (ev.event === "Started") {
                setStatus((status) => ({ ...status, contentLength: ev.data.contentLength, state: "downloading" }));
              } else if (ev.event === "Progress") {
                setStatus((status => ({ ...status, downloaded: status.downloaded + ev.data.chunkLength })));
              } else if (ev.event === "Finished") {
                setStatus((status => ({ ...status, state: "downloaded" })));
              }
            }).catch((e) => {
              setStatus((status) => ({ ...status, error: String(e) }))
            });
          }}>Download {updateState?.version ?? ""} {status.state === "downloading" && <CgSpinner className="ml-2 animate-spin" />} </Button>
            {status.contentLength  &&
            <Progress className="mt-1 w-32 mx-auto h-1" value={Math.floor(100*status.downloaded / status.contentLength)}/>
          }
          </>
        }
          {(status.state === "downloaded" || status.state === "installing") && <>
            <p className="text-sm text-green-600 my-1">Update {updateState?.version ?? ""} downloaded.</p>
            <Button disabled={status.state === "installing"} onClick={() => {
              setStatus((status) => ({ ...status, state: "installing" }));
              updateState?.install().then(() => {
                setStatus((status) => ({ ...status, state: "installed", downloaded: 0 }));
              }).catch((r) => {
                toast.error("Failed to install update.");
                setStatus((status) => ({ ...status, state: "initial", error: String(r), downloaded: 0 }));
              });
            }}>Install Update {status.state === "installing" && <CgSpinner className="ml-2 animate-spin" />} </Button>
          </>
          }
          {status.state === "installed" &&
            <>
              <p className="text-sm text-green-600 my-1 flex gap-x-1 justify-center items-center"><BsCheckCircle /> Installed successfully.</p>
              {backend["restart"] && <Button className="bg-green-500 hover:bg-green-400" onClick={async () => {
                setStatus({ state: "restarting", downloaded: 0 });
                backend['restart']!().then((res) => {
                  // The application should be gone soon :D
                }).catch((e) => {
                  setStatus((s) => ({ ...s, error: String(e) }))

                })
              }}>Restart OCPQ</Button>}
              {!backend["restart"] && <p>Please restart OCPQ!</p>}
            </>
          }</>}
        {status.error && <p className="text-red-500 text-xs">Error: {status.error}
          <br />
          <Button size="sm" variant="ghost" onClick={() => setStatus({ state: "initial", downloaded: 0 })}>Reset</Button></p>}
      </>
    }
  </div>

}
