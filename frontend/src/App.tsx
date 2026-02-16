import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { BsFileEarmarkBreak, BsFiletypeJson, BsFiletypeSql, BsFiletypeXml } from "react-icons/bs";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import "./App.css";
import {
	type BackendProvider,
	BackendProviderContext,
	getAPIServerBackendProvider,
} from "./BackendProviderContext";
import { BackendModeDialog } from "./components/backend/BackendModeDialog";
import { Sidebar } from "./components/layout/Sidebar";
import { OcelDropzone } from "./components/ocel/OcelDropzone";
import { OcelFilePicker } from "./components/ocel/OcelFilePicker";
import { OcelSelector } from "./components/ocel/OcelSelector";
import { useBackend } from "./hooks/useBackend";
import { useOcelAvailable } from "./hooks/useOcelAvailable";
import { useInvalidateOcel, useOcelInfo, useOcelInfoQuery } from "./hooks/useOcelInfo";
import { InfoSheetContext, type InfoSheetState } from "./InfoSheet";
import InfoSheetViewer from "./InfoSheetViewer";
import { OcelInfoContext } from "./lib/ocel-info-context";
import type { OCPQJobOptions } from "./types/generated/OCPQJobOptions";
import type { OCELInfo } from "./types/ocel";

const queryClient = new QueryClient();

function App() {
	const [backendMode, setBackendMode] = useState<"local" | "hpc">("local");
	const ownBackend = useContext(BackendProviderContext);
	const [hpcOptions, setHpcOptions] = useState<OCPQJobOptions>({
		cpus: 4,
		hours: 0.5,
		port: "3300",
		binaryPath:
			"/home/aarkue/doc/projects/OCPQ/backend/target/x86_64-unknown-linux-gnu/release/ocpq-web-server",
		relayAddr: "login23-1.hpc.itc.rwth-aachen.de",
	});

	const innerBackend = useMemo<BackendProvider>(() => {
		if (backendMode === "local") {
			return ownBackend;
		}
		return {
			...getAPIServerBackendProvider(`http://localhost:${hpcOptions.port}`),
			"hpc/login": ownBackend["hpc/login"],
			"hpc/start": ownBackend["hpc/start"],
			"hpc/job-status": ownBackend["hpc/job-status"],
			"download-blob": ownBackend["download-blob"],
		} satisfies BackendProvider;
	}, [backendMode, ownBackend, hpcOptions.port]);

	return (
		<QueryClientProvider client={queryClient}>
			<BackendProviderContext.Provider value={innerBackend}>
				<InnerApp>
					<BackendModeDialog
						backendMode={backendMode}
						setBackendMode={setBackendMode}
						hpcOptions={hpcOptions}
						setHpcOptions={setHpcOptions}
					/>
				</InnerApp>
			</BackendProviderContext.Provider>
		</QueryClientProvider>
	);
}

function InnerApp({ children }: { children?: React.ReactNode }) {
	const [loading, setLoading] = useState(false);
	const [ocelInfo, setOcelInfo] = useState<OCELInfo>();
	const location = useLocation();
	const navigate = useNavigate();
	const isAtRoot = location.pathname === "/";
	const backend = useBackend();
	const invalidateOcel = useInvalidateOcel();

	const setOcelInfoAndNavigate = useCallback(
		(info: OCELInfo | undefined) => {
			setOcelInfo(info);
			invalidateOcel();
			if (info !== undefined) {
				navigate("/ocel-info");
			}
		},
		[invalidateOcel, navigate],
	);

	const [infoSheet, setInfoSheet] = useState<InfoSheetState>();

	// Fetch OCEL info and available OCELs using React Query
	const ocelInfoQuery = useOcelInfoQuery();
	const availableOcelsQuery = useOcelAvailable();

	const backendAvailable = ocelInfoQuery.isSuccess;
	const availableOcels = availableOcelsQuery.data ?? [];

	// Sync query data to local state (for context)
	useEffect(() => {
		if (ocelInfoQuery.data !== undefined) {
			setOcelInfo(ocelInfoQuery.data);
		}
	}, [ocelInfoQuery]);

	// Handle initial files (Tauri)
	useEffect(() => {
		if (backend["ocel/get-initial-files"]) {
			backend["ocel/get-initial-files"]().then((res) => {
				if (res.length > 0 && backend["ocel/picker"]) {
					const path = res[0];
					setLoading(true);
					toast
						.promise(backend["ocel/picker"](path), {
							loading: "Loading OCEL2...",
							success: "Imported OCEL2",
							error: (e) => `Failed to load OCEL2\n${String(e)}`,
						})
						.then(setOcelInfoAndNavigate)
						.finally(() => setLoading(false));
				}
			});
		}
	}, [backend, setOcelInfoAndNavigate]);

	// Drag-drop listener for Tauri
	const initRef = useRef(false);
	useEffect(() => {
		let dragDropUnregister: (() => unknown) | undefined | true;

		if (!initRef.current && backend["drag-drop-listener"] && backend["ocel/picker"]) {
			initRef.current = true;
			backend["drag-drop-listener"]((e) => {
				if (loading) return;

				if (e.type === "enter") {
					const isOcel =
						e.path.endsWith(".json") || e.path.endsWith(".xml") || e.path.endsWith(".sqlite");
					const isXes = e.path.endsWith(".xes") || e.path.endsWith(".xes.gz");

					if (isOcel || isXes) {
						const Icon = e.path.endsWith(".json")
							? BsFiletypeJson
							: e.path.endsWith(".xml")
								? BsFiletypeXml
								: e.path.endsWith(".sqlite")
									? BsFiletypeSql
									: BsFileEarmarkBreak;

						toast(
							<p className="text-md font-medium flex items-center gap-x-1">
								<Icon size={24} className="text-green-600" />
								Drop to load {isXes ? "XES " : ""}as OCEL dataset
							</p>,
							{
								position: "bottom-center",
								style: { marginBottom: "1rem" },
								id: "ocel-drop-hint",
							},
						);
					}
				}

				if (e.type === "drop") {
					setLoading(true);
					toast
						.promise(backend["ocel/picker"]!(e.path), {
							loading: "Loading OCEL2...",
							success: "Imported OCEL2",
							error: (e) => `Failed to load OCEL2\n${String(e)}`,
						})
						.then(setOcelInfoAndNavigate)
						.finally(() => setLoading(false));
				}
			}).then((unregister) => {
				if (dragDropUnregister === true) {
					unregister();
				} else {
					dragDropUnregister = unregister;
				}
			});
		}

		return () => {
			if (typeof dragDropUnregister === "function") {
				dragDropUnregister();
			}
			dragDropUnregister = true;
		};
	}, [backend, loading, setOcelInfoAndNavigate]);

	function handleFileUpload(file: File) {
		if (!backend["ocel/upload"]) {
			console.warn("No ocel/upload available!");
			return;
		}

		setLoading(true);
		const isXes = file.name.endsWith(".xes") || file.name.endsWith(".xes.gz");

		if (isXes && backend["ocel/upload-from-xes"]) {
			toast
				.promise(backend["ocel/upload-from-xes"](file), {
					loading: "Importing XES as OCEL...",
					success: "Imported XES as OCEL",
					error: "Failed to import XES as OCEL",
				})
				.then((info) => setOcelInfoAndNavigate(info ?? undefined))
				.finally(() => setLoading(false));
		} else {
			toast
				.promise(backend["ocel/upload"](file), {
					loading: "Importing OCEL...",
					success: "Imported OCEL",
					error: "Failed to import OCEL",
				})
				.then((info) => setOcelInfoAndNavigate(info ?? undefined))
				.finally(() => setLoading(false));
		}
	}

	const showAvailableOcels = availableOcels.length > 0 && backend["ocel/available"] !== undefined;

	return (
		<OcelInfoContext.Provider value={ocelInfo}>
			<InfoSheetContext.Provider
				value={{ infoSheetState: infoSheet, setInfoSheetState: setInfoSheet }}
			>
				<div className="max-w-full overflow-hidden h-screen text-center grid grid-cols-[13rem_auto]">
					<Sidebar ocelInfo={ocelInfo} backendAvailable={backendAvailable}>
						{children}
					</Sidebar>
					<div className="px-4 overflow-auto my-4">
						{isAtRoot && (
							<>
								<h2 className="text-4xl font-black mb-2">Load a Dataset</h2>
								<p className="text-xl text-muted-foreground mb-1">
									OCPQ supports all OCEL 2.0 file formats (XML, JSON, SQLite)
								</p>
								<p className="text-sm text-muted-foreground mb-2">
									XES/XES.GZ files are also supported and are interpreted with the single object
									type <span className="font-mono italic">Case</span>.
								</p>
							</>
						)}
						{isAtRoot && (
							<OcelFilePicker
								loading={loading}
								setLoading={setLoading}
								onOcelLoaded={setOcelInfoAndNavigate}
							/>
						)}
						{isAtRoot && showAvailableOcels && (
							<OcelSelector
								availableOcels={availableOcels}
								loading={loading}
								setLoading={setLoading}
								onOcelLoaded={setOcelInfoAndNavigate}
							/>
						)}
						{isAtRoot && (
							<>
								{showAvailableOcels && <div className="w-full">OR</div>}
								<OcelDropzone
									loading={loading}
									setLoading={setLoading}
									onFileSelect={handleFileUpload}
									onOcelLoaded={setOcelInfoAndNavigate}
								/>
							</>
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
