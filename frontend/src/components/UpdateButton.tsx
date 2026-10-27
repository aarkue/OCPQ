import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { BsCheckCircle } from "react-icons/bs";
import { CgSpinner } from "react-icons/cg";
import type { UpdateInfo } from "@/BackendProviderContext";
import { useBackend } from "@/hooks";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Progress } from "./ui/progress";

export function UpdateButton() {
	const backend = useBackend();
	const [updateState, setUpdateState] = useState<UpdateInfo | null>(null);
	const [currentVersion, setCurrentVersion] = useState<string>();
	const [status, setStatus] = useState<{
		contentLength?: number;
		downloaded: number;
		state: "initial" | "downloading" | "downloaded" | "installing" | "installed" | "restarting";
		error?: string;
	}>({ downloaded: 0, state: "initial" });
	useEffect(() => {
		if (backend["check-for-updates"]) {
			backend["check-for-updates"]!().then((res) => {
				setUpdateState(res);
			});
		}

		if (backend["get-version"]) {
			backend["get-version"]().then(setCurrentVersion);
		}
	}, [backend["check-for-updates"], backend["get-version"]]);

	if (updateState == null && currentVersion === undefined) {
		return null;
	}
	if (updateState == null && currentVersion !== undefined) {
		return (
			<span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
				v{currentVersion}
			</span>
		);
	}
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-sky-600 px-3 text-xs font-semibold text-white outline-none hover:bg-sky-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
				>
					{status.state === "installed" ? "Restart to update" : "Update available"}
					{updateState?.version !== undefined && (
						<span className="font-medium tabular-nums opacity-80">{updateState.version}</span>
					)}
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="flex w-72 flex-col items-center gap-2 text-center">
				{updateState && (
					<>
						<h2 className="text-sm font-semibold text-slate-900">
							Update available
							{updateState.version !== undefined && (
								<span className="ml-1 font-medium tabular-nums text-sky-700">
									{updateState.version}
								</span>
							)}
						</h2>
						<p className="text-xs text-slate-600">Current version: {updateState.currentVersion}</p>
						{status.error === undefined && (
							<>
								{(status.state === "initial" || status.state === "downloading") && (
									<>
										<Button
											disabled={status.state === "downloading"}
											onClick={() => {
												setStatus((status) => ({
													...status,
													state: "downloading",
												}));
												updateState
													?.download((ev) => {
														if (ev.event === "Started") {
															setStatus((status) => ({
																...status,
																contentLength: ev.data.contentLength,
																state: "downloading",
															}));
														} else if (ev.event === "Progress") {
															setStatus((status) => ({
																...status,
																downloaded: status.downloaded + ev.data.chunkLength,
															}));
														} else if (ev.event === "Finished") {
															setStatus((status) => ({
																...status,
																state: "downloaded",
															}));
														}
													})
													.catch((e) => {
														setStatus((status) => ({
															...status,
															error: String(e),
														}));
													});
											}}
										>
											Download {updateState?.version ?? ""}{" "}
											{status.state === "downloading" && (
												<CgSpinner className="ml-2 animate-spin" />
											)}{" "}
										</Button>
										{status.contentLength && (
											<Progress
												className="mt-1 w-32 mx-auto h-1"
												value={Math.floor((100 * status.downloaded) / status.contentLength)}
											/>
										)}
									</>
								)}
								{(status.state === "downloaded" || status.state === "installing") && (
									<>
										<p className="text-sm text-green-600 my-1">
											Update {updateState?.version ?? ""} downloaded.
										</p>
										<Button
											disabled={status.state === "installing"}
											onClick={() => {
												setStatus((status) => ({
													...status,
													state: "installing",
												}));
												updateState
													?.install()
													.then(() => {
														setStatus((status) => ({
															...status,
															state: "installed",
															downloaded: 0,
														}));
													})
													.catch((r) => {
														toast.error("Failed to install update.");
														setStatus((status) => ({
															...status,
															state: "initial",
															error: String(r),
															downloaded: 0,
														}));
													});
											}}
										>
											Install Update{" "}
											{status.state === "installing" && (
												<CgSpinner className="ml-2 animate-spin" />
											)}{" "}
										</Button>
									</>
								)}
								{status.state === "installed" && (
									<>
										<p className="text-sm text-green-600 my-1 flex gap-x-1 justify-center items-center">
											<BsCheckCircle /> Installed successfully.
										</p>
										{backend.restart && (
											<Button
												className="bg-green-500 hover:bg-green-400"
												onClick={async () => {
													setStatus({ state: "restarting", downloaded: 0 });
													backend.restart!()
														.then((_res) => {
															// The application should be gone soon :D
														})
														.catch((e) => {
															setStatus((s) => ({ ...s, error: String(e) }));
														});
												}}
											>
												Restart OCPQ
											</Button>
										)}
										{!backend.restart && <p>Please restart OCPQ!</p>}
									</>
								)}
							</>
						)}
						{status.error && (
							<p className="text-red-500 text-xs">
								Error: {status.error}
								<br />
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setStatus({ state: "initial", downloaded: 0 })}
								>
									Reset
								</Button>
							</p>
						)}
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}
