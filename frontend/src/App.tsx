import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient
} from "@tanstack/react-query";
import clsx from "clsx";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import { BsCheckCircleFill, BsFileEarmarkBreak, BsFiletypeJson, BsFiletypeSql, BsFiletypeXml } from "react-icons/bs";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import "./App.css";
import {
  type BackendProvider,
  BackendProviderContext,
  getAPIServerBackendProvider
} from "./BackendProviderContext";
import ConnectionConfigForm from "./components/hpc/HPCConnectionConfigForm";
import MenuLink from "./components/MenuLink";
import Spinner from "./components/Spinner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { UpdateButton } from "./components/UpdateButton";
import { type OCPQJobOptions } from "./types/generated/OCPQJobOptions";
import {
  type ConnectionConfig,
  type JobStatus
} from "./types/hpc-backend";
import { type OCELInfo } from "./types/ocel";
import { InfoSheetContext, InfoSheetState } from "./InfoSheet";
import InfoSheetViewer from "./InfoSheetViewer";
import { TbBinaryTree, TbTable } from "react-icons/tb";
import { PiGraphFill } from "react-icons/pi";
import { CgArrowsExpandUpRight } from "react-icons/cg";
const VALID_OCEL_MIME_TYPES = [
  "application/json",
  "text/json",
  "text/xml",
  "application/xml",
  "application/vnd.sqlite3",
  "application/vnd.sqlite",
];

export const OcelInfoContext = createContext<OCELInfo | undefined>(undefined);

const queryClient = new QueryClient()

function App() {
  const [backendMode, setBackendMode] = useState<"local" | "hpc">("local");
  const [jobStatus, setJobStatus] = useState<{
    id: string;
    status?: JobStatus;
  }>();
  const numberOfSteps = 3;
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<number>();
  const ownBackend = useContext(BackendProviderContext);
  const connectionFormRef = useRef<{ getConfig: () => ConnectionConfig }>(null);
  const [hpcOptions, setHpcOptions] = useState<OCPQJobOptions>({
    cpus: 4,
    hours: 0.5,
    port: "3300",
    binaryPath:
      "/home/aarkue/doc/projects/OCPQ/backend/target/x86_64-unknown-linux-gnu/release/ocpq-web-server",
    relayAddr: "login23-1.hpc.itc.rwth-aachen.de",
  });
  useEffect(() => {
    setStep(undefined);
  }, []);

  useEffect(() => {
    if (jobStatus?.id && jobStatus.status?.status !== "ENDED") {
      const t = setInterval(() => {
        ownBackend["hpc/job-status"](jobStatus.id).then((status) =>
          setJobStatus((j) => ({ id: jobStatus.id, status })),
        );
      }, 3000);
      return () => {
        clearInterval(t);
      };
    }
  }, [jobStatus?.id, jobStatus?.status]);
  const innerBackend = useMemo<BackendProvider>(() => {
    if (backendMode === "local") {
      return ownBackend;
    } else {
      return {
        ...getAPIServerBackendProvider("http://localhost:" + hpcOptions.port),
        "hpc/login": ownBackend["hpc/login"],
        "hpc/start": ownBackend["hpc/start"],
        "hpc/job-status": ownBackend["hpc/job-status"],
        "download-blob": ownBackend["download-blob"],
      } satisfies BackendProvider;
    }
  }, [backendMode]);
  return (

    <QueryClientProvider client={queryClient}>
      <BackendProviderContext.Provider value={innerBackend}>
        <InnerApp>
          <AlertDialog
            open={step !== undefined}
            onOpenChange={(o) => {
              if (!o) {
                setStep(undefined);
              } else {
                setStep(0);
              }
            }}
          >
            <AlertDialogTrigger asChild>
              <Button className="mt-8 mb-1 text-xs" size="sm" variant="ghost">
                <span className="mr-1">
                  {backendMode === "local" ? "Local" : "HPC"}
                </span>
                Backend
              </Button>
            </AlertDialogTrigger>
            {step !== undefined && (
              <AlertDialogContent className="flex flex-col max-h-full justify-between">
                <AlertDialogHeader>
                  <AlertDialogTitle>Backend Mode</AlertDialogTitle>
                </AlertDialogHeader>
                <div className="text-sm text-gray-700 max-h-full overflow-auto px-2">
                  <div>
                    {backendMode === "local" && (
                      <>
                        {step === 0 && (
                          <p>
                            Currently, all queries and constraints are executed on
                            a locally provided backend (most likely the device you
                            are reading this on).
                            <br />
                            <br />
                            You can also run the backend on an HPC
                            (High-performance computing) cluster, if you have the
                            appropriate access credentials for such a cluster
                            (i.e., student or employee at a larger university).
                          </p>
                        )}

                        {step === 0 && (
                          <div>
                            <Accordion type="single" collapsible>
                              <AccordionItem value="item-1">
                                <AccordionTrigger>Overwrite</AccordionTrigger>
                                <AccordionContent>
                                  If you already have a backend running on another
                                  port, you can use this option to manually
                                  overwrite the used backend port.
                                  {backendMode === "local" && (
                                    <Input
                                      type="text"
                                      value={hpcOptions.port}
                                      onChange={(ev) => {
                                        setHpcOptions({
                                          ...hpcOptions,
                                          port: ev.currentTarget.value,
                                        });
                                      }}
                                    />
                                  )}
                                  <Button
                                    onClick={(e) =>
                                      setBackendMode((m) =>
                                        m === "local" ? "hpc" : "local",
                                      )
                                    }
                                  >
                                    Overwrite
                                  </Button>
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>
                          </div>
                        )}
                        {step === 1 && (
                          <>
                            <ConnectionConfigForm
                              ref={connectionFormRef}
                              onSubmit={(e) => {
                                console.log(e);
                              }}
                            />
                          </>
                        )}
                        {step === 2 && (
                          <>
                            <div className="bg-green-200 p-2 rounded font-semibold text-base w-fit flex items-center mb-2">
                              <BsCheckCircleFill className="inline-block mr-1 size-4 " />
                              Logged in successfully!
                            </div>
                            <div className="grid grid-cols-[7rem_1fr] gap-1 items-center">
                              <Label>CPUs</Label>
                              <Input
                                type="number"
                                value={hpcOptions.cpus}
                                step={1}
                                min={1}
                                onChange={(ev) =>
                                  setHpcOptions({
                                    ...hpcOptions,
                                    cpus: ev.currentTarget.valueAsNumber ?? 1,
                                  })
                                }
                              />
                              <Label>Time (hours)</Label>
                              <Input
                                type="number"
                                value={hpcOptions.hours}
                                step={0.25}
                                min={0.1}
                                max={3}
                                onChange={(ev) =>
                                  setHpcOptions({
                                    ...hpcOptions,
                                    hours: ev.currentTarget.valueAsNumber ?? 1,
                                  })
                                }
                              />
                              <Label>Port</Label>
                              <Input
                                value={hpcOptions.port}
                                onChange={(ev) =>
                                  setHpcOptions({
                                    ...hpcOptions,
                                    port: ev.currentTarget.value ?? "3300",
                                  })
                                }
                              />
                              <Label>Relay Address</Label>
                              <Input
                                value={hpcOptions.relayAddr}
                                onChange={(ev) =>
                                  setHpcOptions({
                                    ...hpcOptions,
                                    relayAddr: ev.currentTarget.value ?? "",
                                  })
                                }
                              />
                              <Label>Path to compatible Server Binary</Label>
                              <Input
                                value={hpcOptions.binaryPath}
                                onChange={(ev) =>
                                  setHpcOptions({
                                    ...hpcOptions,
                                    binaryPath: ev.currentTarget.value ?? "",
                                  })
                                }
                              />
                            </div>
                          </>
                        )}
                        {step === 3 && (
                          <>
                            <div className="bg-green-200 p-2 rounded font-semibold text-base w-fit flex items-center mb-2">
                              <BsCheckCircleFill className="inline-block mr-1 size-4 " />
                              Submitted job with ID {jobStatus?.id ?? "-"}
                            </div>
                            {jobStatus?.status !== undefined && (
                              <div
                                className={clsx(
                                  "block w-fit mx-auto p-2 rounded",
                                  {
                                    PENDING: "bg-gray-300/20",
                                    RUNNING: "bg-green-400/20",
                                    ENDED: "bg-fuchsia-400/20",
                                    NOT_FOUND: "bg-gray-100/20",
                                  }[jobStatus.status.status],
                                )}
                              >
                                <div
                                  className={clsx(
                                    "block w-fit mx-auto p-2 rounded font-extrabold text-xl ",
                                    {
                                      PENDING: "text-gray-500",
                                      RUNNING: "text-green-500",
                                      ENDED: "text-fuchsia-500",
                                      NOT_FOUND: "text-gray-500",
                                    }[jobStatus.status.status],
                                  )}
                                >
                                  {jobStatus.status.status}
                                </div>
                                <div className="grid grid-cols-[auto_1fr] gap-x-1">
                                  {jobStatus.status.status === "RUNNING" && (
                                    <>
                                      <span>Start:</span>{" "}
                                      <span>{jobStatus.status.start_time}</span>
                                      <span>End:</span>{" "}
                                      <span>{jobStatus.status.end_time}</span>
                                    </>
                                  )}
                                  {jobStatus.status.status === "PENDING" && (
                                    <>
                                      <span>Start:</span>{" "}
                                      <span>{jobStatus.status.start_time}</span>
                                    </>
                                  )}

                                  {jobStatus.status.status === "ENDED" && (
                                    <>
                                      <span>State:</span>{" "}
                                      <span>{jobStatus.status.state}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <AlertDialogFooter className="justify-between!">
                  <AlertDialogCancel
                    disabled={loading}
                    className="!mr-full ml-0!"
                  >
                    Cancel
                  </AlertDialogCancel>
                  <div className="flex gap-x-2">
                    {step > 0 && (
                      <AlertDialogAction
                        variant="outline"
                        disabled={loading}
                        onClick={(ev) => {
                          ev.preventDefault();
                          setStep((s) => (s === undefined || s <= 1 ? 0 : s - 1));
                        }}
                      >
                        Back
                      </AlertDialogAction>
                    )}
                    <AlertDialogAction
                      disabled={loading}
                      onClick={(ev) => {
                        if (step == undefined) {
                          return;
                        }
                        if (backendMode !== "hpc" && step < numberOfSteps) {
                          ev.preventDefault();
                          if (step === 1) {
                            setLoading(true);
                            const cfg = connectionFormRef.current?.getConfig();
                            console.log(cfg);
                            if (!cfg) {
                              toast.error("Invalid configuration!");
                              return;
                            }
                            ownBackend["hpc/login"](cfg)
                              .then((res) => {
                                setStep(2);
                              })
                              .catch((e) =>
                                toast.error("Could not connect: " + String(e)),
                              )
                              .finally(() => setLoading(false));
                          } else if (step === 2) {
                            setLoading(true);
                            ownBackend["hpc/start"](hpcOptions)
                              .then((res) => {
                                console.log(res);
                                toast.success("Submitted job with ID: " + res);
                                setJobStatus({ id: res });
                                setStep(3);
                              })
                              .catch((e) =>
                                toast.error("Could not connect: " + String(e)),
                              )
                              .finally(() => setLoading(false));
                          } else {
                            setStep((s) => (s ?? 0) + 1);
                          }
                        } else {
                          setStep(0);
                          setBackendMode((b) =>
                            b === "local" ? "hpc" : "local",
                          );
                        }
                      }}
                    >
                      {loading && <Spinner />}
                      {backendMode === "local" && (
                        <>
                          {step < numberOfSteps && (
                            <>
                              Next {step + 1}/{numberOfSteps + 1}
                            </>
                          )}
                          {step >= numberOfSteps && <>Switch to HPC</>}
                        </>
                      )}
                      {backendMode === "hpc" && <>Switch to Local</>}
                    </AlertDialogAction>
                  </div>
                </AlertDialogFooter>
              </AlertDialogContent>
            )}
          </AlertDialog>
          {/* <AlertHelper mode="promise" title="Backend Mode" trigger={<Button className="mt-8">Backend Mode: <span className="font-bold ml-1">{backendMode === "local" ? "local" : "HPC"}</span></Button>}
        initialData={{}}
        content={() => <div>
        {backendMode === "local" &&
        <>
        {step === 0 &&
        <p>Currently, all queries and constraints are executed on a locally provided backend (most likely the device you are reading this on).
        <br />
        <br />
        You can also run the backend on an HPC (High-performance computing) cluster, if you have the appropriate access credentials for such a cluster (i.e., student or employee at a larger university).</p>}
                  {step === 1 && <>
                  <ConnectionConfigForm ref={connectionFormRef} onSubmit={(e) => {
                    console.log(e);
                  }}/>
                  </>}
            </>}
        </div>
        }
        onCancel={() => {
          setStep(0);
        }}
        submitAction={<>
          {backendMode === "local" && <>
            {step < numberOfSteps && <>Next {step + 1}/{numberOfSteps + 1}</>}
            {step >= numberOfSteps && <>Switch to HPC</>}
          </>}
          {backendMode === "hpc" && <>Switch to Local</>}
        </>}
        onSubmit={(d, ev) => {

        }}
      /> */}
        </InnerApp>
      </BackendProviderContext.Provider>
    </QueryClientProvider>
  );
}

function InnerApp({ children }: { children?: ReactNode }) {
  const [loading, setLoading] = useState(false);
  const [ocelInfo, setOcelInfo] = useState<OCELInfo>();
  const [backendAvailable, setBackendAvailable] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isAtRoot = location.pathname === "/";
  const [availableOcels, setAvailableOcels] = useState<string[]>([]);
  const [selectedOcel, setSelectedOcel] = useState<string>();
  const backend = useContext(BackendProviderContext);

  const [infoSheet, setInfoSheet] = useState<InfoSheetState>();
  useEffect(() => {
    console.log({ backend });
    void backend["ocel/info"]()
      .then((info) => {
        setBackendAvailable(true);
        if (info !== undefined) {
          setOcelInfo(info);
        } else {
          setOcelInfo(undefined);
        }
      })
      .catch((e) => {
        console.error(e);
        setBackendAvailable(false);
        setOcelInfo(undefined);
      });
    if (backend["ocel/available"] !== undefined) {
      void toast
        .promise(backend["ocel/available"](), {
          loading: "Loading available OCEL",
          success: "Got available OCEL",
          error: "Failed to load available OCEL",
        })
        .then((res) => {
          setAvailableOcels(res);
        });
    }

    if (backend["ocel/get-initial-files"] !== undefined) {
      backend["ocel/get-initial-files"]().then((res) => {
        if (res.length > 0) {
          const path = res[0];
          setLoading(true);
          void toast
            .promise(backend['ocel/picker']!(path), {
              loading: "Loading OCEL2...",
              success: "Imported OCEL2",
              error: (e) => "Failed to load OCEL2\n" + String(e),
            })
            .then((ocelInfo) => {
              setOcelInfoAndNavigate(ocelInfo);
            })
            .finally(() => setLoading(false));
        }
      })
    }

  }, [backend]);

  const initRef = useRef(false);
  useEffect(() => {

    let dragDropUnregister: (() => unknown) | undefined | true = undefined;

    if (initRef.current === false && backend['drag-drop-listener'] !== undefined && backend['ocel/picker'] !== undefined) {
      initRef.current = true;
      backend['drag-drop-listener']((e) => {
        if (loading) {
          return;
        }
        if (e.type === "enter") {
          if (e.path.endsWith(".json") || e.path.endsWith(".xml") || e.path.endsWith(".sqlite")) {
            const Icon = e.path.endsWith(".json") ? BsFiletypeJson : e.path.endsWith(".xml") ? BsFiletypeXml : BsFiletypeSql;
            toast(<p className="text-md font-medium flex items-center gap-x-1"><Icon size={24} className="text-green-600" />Drop to load as OCEL dataset</p>, { position: "bottom-center", style: { marginBottom: "1rem" }, id: "ocel-drop-hint" });
          }
          if (e.path.endsWith(".xes") || e.path.endsWith(".xes.gz")) {
            const Icon = BsFileEarmarkBreak;
            toast(<p className="text-md font-medium flex items-center gap-x-1"><Icon size={24} className="text-green-600" />Drop to load XES as OCEL dataset</p>, { position: "bottom-center", style: { marginBottom: "1rem" }, id: "ocel-drop-hint" });
          }
        }
        if (e.type === "drop") {
          setLoading(true);
          void toast
            .promise(backend['ocel/picker']!(e.path), {
              loading: "Loading OCEL2...",
              success: "Imported OCEL2",
              error: (e) => "Failed to load OCEL2\n" + String(e),
            })
            .then((ocelInfo) => {
              setOcelInfoAndNavigate(ocelInfo);
            })
            .finally(() => setLoading(false));
        }
      }).then(unregister => {
        if (dragDropUnregister === true) {
          // Immediately unregister, because cleanup already happened....
          unregister()
        } else {
          dragDropUnregister = unregister;
        }
      })
    }
    return () => {
      if (typeof dragDropUnregister === "function") {
        dragDropUnregister();
      }
      dragDropUnregister = true;
    }
  }, [backend, loading])

  async function loadOcel() {
    if (selectedOcel == null) {
      console.warn("No valid OCEL selected");
      return;
    }
    if (backend["ocel/load"] === undefined) {
      console.warn("ocel/load is not supported by this backend.");
      return;
    }
    await toast.promise(
      backend["ocel/load"](selectedOcel).then((ocelInfo) => {
        setOcelInfoAndNavigate(ocelInfo);
      }),
      {
        loading: "Importing OCEL...",
        success: "Imported OCEL",
        error: "Failed to import OCEL",
      },
    );
  }

  function handleFileUpload(file: File | null) {
    if (backend["ocel/upload"] === undefined) {
      console.warn("No ocel/upload available!");
      return;
    }
    if (file != null) {
      setLoading(true);
      if (backend['ocel/upload-from-xes'] && (file.name.endsWith(".xes") || file.name.endsWith(".xes.gz"))) {
        void toast
          .promise(backend["ocel/upload-from-xes"](file), {
            loading: "Importing XES as OCEL...",
            success: "Imported XES as OCEL",
            error: "Failed to import XES as OCEL",
          })
          .then((ocelInfo) => {
            if (ocelInfo != null) {
              setOcelInfoAndNavigate(ocelInfo);
            } else {
              setOcelInfo(undefined);
            }
          }).finally(() => setLoading(false));
      } else {
        void toast
          .promise(backend["ocel/upload"](file), {
            loading: "Importing OCEL...",
            success: "Imported OCEL",
            error: "Failed to import OCEL",
          })
          .then((ocelInfo) => {
            if (ocelInfo != null) {
              setOcelInfoAndNavigate(ocelInfo);
            } else {
              setOcelInfo(undefined);
            }
          }).finally(() => setLoading(false));
      }
    }
  }

  const showAvailableOcels =
    availableOcels.length > 0 && backend["ocel/available"] !== undefined;
  const filePickerAvailable = backend["ocel/picker"] !== undefined;


  const queryClient = useQueryClient();

  function setOcelInfoAndNavigate(info: OCELInfo | undefined) {
    setOcelInfo(info);
    queryClient.invalidateQueries({ queryKey: ['ocel'] });
    if (info !== null) {
      navigate("/ocel-info");
    }
  }

  return (
    <OcelInfoContext.Provider value={ocelInfo}>
      <InfoSheetContext.Provider value={{ infoSheetState: infoSheet, setInfoSheetState: setInfoSheet }}>
        <div className="max-w-full overflow-hidden h-screen text-center grid grid-cols-[12rem_auto]">
          <div className="border-r border-r-slate-300 px-2 overflow-auto">
            <img
              src="/favicon.png"
              className="w-24 h-24 mx-auto mt-4 mb-2"
            />
            <h2 className="font-black text-3xl bg-clip-text text-transparent bg-linear-to-r from-slate-800 to-sky-600 tracking-tighter">
              OCPQ
            </h2>
            <div className="flex flex-col gap-2 mt-1 text-xs">
              {ocelInfo != null && (
                <span className="flex flex-col items-center mx-auto text-sm leading-tight">
                  <span className=" font-semibold text-green-700">
                    OCEL loaded
                  </span>
                  <span className="text-xs grid grid-cols-[auto_1fr] text-right gap-x-2 leading-tight items-baseline">
                    <span className="font-mono">{ocelInfo.num_events}</span> <span className="text-left">Events</span>
                    <span className="font-mono">{ocelInfo.num_objects}</span> <span className="text-left">Objects</span>
                  </span>
                </span>
              )}
              {ocelInfo != null && (
                <div className="flex flex-col gap-y-1 w-[11rem] mx-auto">
                  <MenuLink to="/ocel-info" classNames="bg-blue-300/10 border-blue-300/20 hover:bg-blue-300/50 [.active]:border-blue-400 [.active]:bg-blue-300/70">OCEL Info

                    <TbTable className="ml-2" />
                  </MenuLink>
                  <MenuLink to="/graph" classNames="bg-sky-300/10 border-sky-300/20 hover:bg-sky-300/50 [.active]:border-sky-400 [.active]:bg-sky-300/70">Relationship Graph

                    <PiGraphFill className="ml-2" />
                  </MenuLink>
                  <br className="my-1" />
                  <MenuLink classNames="bg-purple-300/20 border-purple-300/30 hover:bg-purple-300/70 [.active]:border-purple-400 [.active]:bg-purple-300/80"
                    to="/constraints"
                  >
                    OCPQ (Queries)
                    <TbBinaryTree className="ml-2" />
                  </MenuLink>
                  <MenuLink to={"/oc-declare"} classNames="bg-emerald-300/20 border-emerald-300/30 hover:bg-emerald-300/60 [.active]:border-emerald-400 [.active]:bg-emerald-300/70">OC-DECLARE

                    <CgArrowsExpandUpRight className="ml-2 rotate-45" />
                  </MenuLink>
                </div>
              )}
              <br />
              {!isAtRoot && (
                <>
                  <MenuLink to={"/"} classNames="text-xs text-center bg-transparent border-transparent justify-center hover:bg-sky-50">Load another dataset</MenuLink>
                </>
              )}
              <UpdateButton />
              {children}
            </div>
            <div className="text-xs">
              {backendAvailable && (
                <span className="text-green-700 font-semibold bg-green-200 w-fit mx-auto p-1 rounded">
                  Backend online
                </span>
              )}
              {!backendAvailable && (
                <span className="text-red-700 font-semibold bg-red-200 w-fit mx-auto p-1 rounded">
                  Backend offline
                </span>
              )}
            </div>
          </div>
          <div className="px-4 overflow-auto my-4">
            {isAtRoot && (
              <>
                <h2 className="text-4xl font-black mb-2">Load a Dataset</h2>
                <p className="text-xl text-muted-foreground mb-1 ">OCPQ supports all OCEL 2.0 file formats (XML, JSON, SQLite)</p>
                <p className="text-sm text-muted-foreground mb-2">XES/XES.GZ files are also supported and are interpreted with the single object type <span className="font-mono italic">Case</span>.</p>
              </>
            )}
            {isAtRoot &&
              filePickerAvailable &&
              backend["ocel/picker"] !== undefined && (
                <>
                  <Button size="lg"
                    disabled={loading}
                    onClick={() => {
                      setLoading(true);
                      void toast
                        .promise(backend["ocel/picker"]!(), {
                          loading: "Loading OCEL2...",
                          success: "Imported OCEL2",
                          error: (e) => "Failed to load OCEL2\n" + String(e),
                        })
                        .then((ocelInfo) => {
                          setOcelInfoAndNavigate(ocelInfo);
                        })
                        .finally(() => setLoading(false));
                    }}
                  >
                    {loading && <Spinner />}
                    Select a file...
                  </Button>
                  <div className="mt-2 italic">
                    or
                  </div>
                </>
              )}
            {isAtRoot &&
              showAvailableOcels &&
              backend["ocel/load"] !== undefined && (
                <div className="">
                  <Select
                    name="Select available OCEL"
                    value={selectedOcel}
                    onValueChange={(v) => {
                      setSelectedOcel(v);
                    }}
                  >
                    <SelectTrigger className={"w-[180px] mx-auto my-2"}>
                      <SelectValue placeholder="Select an OCEL" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableOcels.map((ocelName) => (
                        <SelectItem key={ocelName} value={ocelName}>
                          {ocelName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={loading || selectedOcel === undefined}
                    size="default"
                    onClick={async () => {
                      setLoading(true);
                      await toast
                        .promise(loadOcel(), {
                          loading: "Loading OCEL...",
                          success: "Loaded OCEL",
                          error: (e) => "Failed to load OCEL\n" + String(e),
                        })
                        .finally(() => {
                          setLoading(false);
                        });
                    }}
                  >
                    {loading && <Spinner />}
                    <span>Load Selected OCEL</span>
                  </Button>
                </div>
              )}

            {isAtRoot && (
              <div className="my-4">
                {showAvailableOcels && <div className="w-full">OR</div>}
                <div
                  className="flex items-center justify-center w-full max-w-2xl mx-auto"
                  onDragOver={(ev) => {
                    ev.preventDefault();
                    if (loading) {
                      return;
                    }
                    // const items = ev.dataTransfer.items;
                    // const invalidTypes = [];
                    // let atLeastOnceValidType = false;
                    // for (let i = 0; i < items.length; i++) {
                    //   const fileMimeType = items[i].type;
                    //   if (!VALID_OCEL_MIME_TYPES.includes(fileMimeType)) {
                    //     // invalidTypes.push(fileMimeType);
                    //   } else {
                    //     atLeastOnceValidType = true;
                    //   }
                    // }
                    // if (!atLeastOnceValidType && items.length > 0 && invalidTypes.length > 0) {
                    //   console.log(atLeastOnceValidType,items.length,invalidTypes)
                    //   toast(
                    //     `Files of type ${invalidTypes.join(", ")} are not supported!\n\nIf you are sure that this is an valid OCEL2 file, please select it manually by clicking on the dropzone.`,
                    //     { id: "unsupported-file" },
                    //   );
                    // }
                  }}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    if (loading) {
                      return;
                    }
                    const invalidTypes: string[] = [];
                    const files = ev.dataTransfer.items;
                    for (let i = 0; i < files.length; i++) {
                      const fileWrapper = files[i];
                      const file = fileWrapper.getAsFile();
                      console.log(file?.webkitRelativePath);
                      if (file !== null) {
                        console.log(file.type)
                        // if (file?.type === undefined || VALID_OCEL_MIME_TYPES.includes(file?.type ?? "")) {
                        setTimeout(() => {
                          handleFileUpload(file);
                        }, 500);
                        return;
                        // } else {
                        //   invalidTypes.push(file?.type ?? "unknown");
                        // }
                      }
                    }
                    if (invalidTypes.length > 0) {
                      toast(
                        `Files of this type ${invalidTypes.join(", ")} are not supported!\n\nIf you are sure that this is an valid OCEL2 file, please select it manually by clicking on the dropzone.`,
                        { id: "unsupported-file" },
                      );
                    }
                  }}
                >
                  <label
                    htmlFor="dropzone-ocel-file"
                    className={clsx("flex flex-col items-center justify-center w-full h-64 border-2 border-gray-400 border-dashed rounded-lg cursor-pointer", !loading && " bg-blue-50/20 hover:bg-blue-100/30", loading && "bg-gray-200/30")}
                  >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <p className="mb-2 text-sm text-gray-500">
                        <span className="font-semibold">
                          Click to select an OCEL file
                        </span>{" "}
                        or drag a file here
                      </p>
                      <p className="text-xs text-gray-500">
                        Supported: OCEL2-JSON, OCEL2-XML, OCEL2-SQLITE, XES/XES.GZ (Interpreted as OCEL)
                      </p>
                    </div>
                    <input disabled={loading}
                      onClickCapture={(ev) => {
                        if (backend['ocel/picker']) {
                          ev.preventDefault();
                          void toast
                            .promise(backend["ocel/picker"]!(), {
                              loading: "Loading OCEL2...",
                              success: "Imported OCEL2",
                              error: (e) => "Failed to load OCEL2\n" + String(e),
                            })
                            .then((ocelInfo) => {
                              setOcelInfoAndNavigate(ocelInfo);
                            })
                            .finally(() => setLoading(false));
                        }

                      }}
                      onChange={(ev) => {
                        if (ev.currentTarget.files !== null) {
                          handleFileUpload(ev.currentTarget.files[0]);
                        }
                      }}
                      id="dropzone-ocel-file"
                      type="file"
                      className="hidden"
                      accept=".json, .xml"
                    />
                  </label>
                </div>
              </div>
            )}
            <Outlet />
          </div>
        </div>
        <InfoSheetViewer />
      </InfoSheetContext.Provider>
    </OcelInfoContext.Provider>
  );
}

export default App;
