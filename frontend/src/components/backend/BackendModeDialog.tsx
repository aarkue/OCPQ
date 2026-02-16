import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { BsCheckCircleFill } from "react-icons/bs";
import ConnectionConfigForm from "@/components/hpc/HPCConnectionConfigForm";
import Spinner from "@/components/Spinner";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBackend } from "@/hooks/useBackend";
import type { OCPQJobOptions } from "@/types/generated/OCPQJobOptions";
import type { ConnectionConfig, JobStatus } from "@/types/hpc-backend";

interface BackendModeDialogProps {
	backendMode: "local" | "hpc";
	setBackendMode: (mode: "local" | "hpc") => void;
	hpcOptions: OCPQJobOptions;
	setHpcOptions: (options: OCPQJobOptions) => void;
}

const NUMBER_OF_STEPS = 3;

export function BackendModeDialog({
	backendMode,
	setBackendMode,
	hpcOptions,
	setHpcOptions,
}: BackendModeDialogProps) {
	const backend = useBackend();
	const [step, setStep] = useState<number | undefined>(undefined);
	const [loading, setLoading] = useState(false);
	const [jobStatus, setJobStatus] = useState<{ id: string; status?: JobStatus }>();
	const connectionFormRef = useRef<{ getConfig: () => ConnectionConfig }>(null);

	useEffect(() => {
		setStep(undefined);
	}, []);

	useEffect(() => {
		if (jobStatus?.id && jobStatus.status?.status !== "ENDED") {
			const interval = setInterval(() => {
				backend["hpc/job-status"](jobStatus.id).then((status) =>
					setJobStatus((_j) => ({ id: jobStatus.id, status })),
				);
			}, 3000);
			return () => clearInterval(interval);
		}
	}, [jobStatus?.id, jobStatus?.status, backend]);

	const handleNext = async (ev: React.MouseEvent) => {
		if (step === undefined) return;

		if (backendMode !== "hpc" && step < NUMBER_OF_STEPS) {
			ev.preventDefault();

			if (step === 1) {
				setLoading(true);
				const cfg = connectionFormRef.current?.getConfig();
				if (!cfg) {
					toast.error("Invalid configuration!");
					setLoading(false);
					return;
				}
				try {
					await backend["hpc/login"](cfg);
					setStep(2);
				} catch (e) {
					toast.error(`Could not connect: ${String(e)}`);
				} finally {
					setLoading(false);
				}
			} else if (step === 2) {
				setLoading(true);
				try {
					const jobId = await backend["hpc/start"](hpcOptions);
					toast.success(`Submitted job with ID: ${jobId}`);
					setJobStatus({ id: jobId });
					setStep(3);
				} catch (e) {
					toast.error(`Could not connect: ${String(e)}`);
				} finally {
					setLoading(false);
				}
			} else {
				setStep((s) => (s ?? 0) + 1);
			}
		} else {
			setStep(0);
			setBackendMode(backendMode === "local" ? "hpc" : "local");
		}
	};

	return (
		<AlertDialog open={step !== undefined} onOpenChange={(open) => setStep(open ? 0 : undefined)}>
			<AlertDialogTrigger asChild>
				<Button className="mt-8 mb-1 text-xs" size="sm" variant="ghost">
					<span className="mr-1">{backendMode === "local" ? "Local" : "HPC"}</span>
					Backend
				</Button>
			</AlertDialogTrigger>
			{step !== undefined && (
				<AlertDialogContent className="flex flex-col max-h-full justify-between">
					<AlertDialogHeader>
						<AlertDialogTitle>Backend Mode</AlertDialogTitle>
					</AlertDialogHeader>
					<div className="text-sm text-gray-700 max-h-full overflow-auto px-2">
						{backendMode === "local" && (
							<>
								{step === 0 && (
									<StepZeroContent
										hpcOptions={hpcOptions}
										setHpcOptions={setHpcOptions}
										setBackendMode={setBackendMode}
									/>
								)}
								{step === 1 && <ConnectionConfigForm ref={connectionFormRef} onSubmit={() => {}} />}
								{step === 2 && (
									<StepTwoContent hpcOptions={hpcOptions} setHpcOptions={setHpcOptions} />
								)}
								{step === 3 && <StepThreeContent jobStatus={jobStatus} />}
							</>
						)}
					</div>
					<AlertDialogFooter className="justify-between!">
						<AlertDialogCancel disabled={loading} className="mr-full! ml-0!">
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
							<AlertDialogAction disabled={loading} onClick={handleNext}>
								{loading && <Spinner />}
								{backendMode === "local" && (
									<>
										{step < NUMBER_OF_STEPS && (
											<>
												Next {step + 1}/{NUMBER_OF_STEPS + 1}
											</>
										)}
										{step >= NUMBER_OF_STEPS && "Switch to HPC"}
									</>
								)}
								{backendMode === "hpc" && "Switch to Local"}
							</AlertDialogAction>
						</div>
					</AlertDialogFooter>
				</AlertDialogContent>
			)}
		</AlertDialog>
	);
}

function StepZeroContent({
	hpcOptions,
	setHpcOptions,
	setBackendMode,
}: {
	hpcOptions: OCPQJobOptions;
	setHpcOptions: (options: OCPQJobOptions) => void;
	setBackendMode: (mode: "local" | "hpc") => void;
}) {
	return (
		<div>
			<p>
				Currently, all queries and constraints are executed on a locally provided backend (most
				likely the device you are reading this on).
				<br />
				<br />
				You can also run the backend on an HPC (High-performance computing) cluster, if you have the
				appropriate access credentials for such a cluster (i.e., student or employee at a larger
				university).
			</p>
			<Accordion type="single" collapsible>
				<AccordionItem value="item-1">
					<AccordionTrigger>Overwrite</AccordionTrigger>
					<AccordionContent>
						If you already have a backend running on another port, you can use this option to
						manually overwrite the used backend port.
						<Input
							type="text"
							value={hpcOptions.port}
							onChange={(ev) => setHpcOptions({ ...hpcOptions, port: ev.currentTarget.value })}
						/>
						<Button onClick={() => setBackendMode("hpc")}>Overwrite</Button>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</div>
	);
}

function StepTwoContent({
	hpcOptions,
	setHpcOptions,
}: {
	hpcOptions: OCPQJobOptions;
	setHpcOptions: (options: OCPQJobOptions) => void;
}) {
	return (
		<>
			<div className="bg-green-200 p-2 rounded font-semibold text-base w-fit flex items-center mb-2">
				<BsCheckCircleFill className="inline-block mr-1 size-4" />
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
						setHpcOptions({ ...hpcOptions, cpus: ev.currentTarget.valueAsNumber ?? 1 })
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
						setHpcOptions({ ...hpcOptions, hours: ev.currentTarget.valueAsNumber ?? 1 })
					}
				/>
				<Label>Port</Label>
				<Input
					value={hpcOptions.port}
					onChange={(ev) =>
						setHpcOptions({ ...hpcOptions, port: ev.currentTarget.value ?? "3300" })
					}
				/>
				<Label>Relay Address</Label>
				<Input
					value={hpcOptions.relayAddr}
					onChange={(ev) =>
						setHpcOptions({ ...hpcOptions, relayAddr: ev.currentTarget.value ?? "" })
					}
				/>
				<Label>Path to compatible Server Binary</Label>
				<Input
					value={hpcOptions.binaryPath}
					onChange={(ev) =>
						setHpcOptions({ ...hpcOptions, binaryPath: ev.currentTarget.value ?? "" })
					}
				/>
			</div>
		</>
	);
}

function StepThreeContent({
	jobStatus,
}: {
	jobStatus: { id: string; status?: JobStatus } | undefined;
}) {
	if (!jobStatus) return null;

	return (
		<>
			<div className="bg-green-200 p-2 rounded font-semibold text-base w-fit flex items-center mb-2">
				<BsCheckCircleFill className="inline-block mr-1 size-4" />
				Submitted job with ID {jobStatus.id}
			</div>
			{jobStatus.status && (
				<div
					className={clsx("block w-fit mx-auto p-2 rounded", {
						"bg-gray-300/20": jobStatus.status.status === "PENDING",
						"bg-green-400/20": jobStatus.status.status === "RUNNING",
						"bg-fuchsia-400/20": jobStatus.status.status === "ENDED",
						"bg-gray-100/20": jobStatus.status.status === "NOT_FOUND",
					})}
				>
					<div
						className={clsx("block w-fit mx-auto p-2 rounded font-extrabold text-xl", {
							"text-gray-500":
								jobStatus.status.status === "PENDING" || jobStatus.status.status === "NOT_FOUND",
							"text-green-500": jobStatus.status.status === "RUNNING",
							"text-fuchsia-500": jobStatus.status.status === "ENDED",
						})}
					>
						{jobStatus.status.status}
					</div>
					<div className="grid grid-cols-[auto_1fr] gap-x-1">
						{jobStatus.status.status === "RUNNING" && (
							<>
								<span>Start:</span>
								<span>{jobStatus.status.start_time}</span>
								<span>End:</span>
								<span>{jobStatus.status.end_time}</span>
							</>
						)}
						{jobStatus.status.status === "PENDING" && (
							<>
								<span>Start:</span>
								<span>{jobStatus.status.start_time}</span>
							</>
						)}
						{jobStatus.status.status === "ENDED" && (
							<>
								<span>State:</span>
								<span>{jobStatus.status.state}</span>
							</>
						)}
					</div>
				</div>
			)}
		</>
	);
}
