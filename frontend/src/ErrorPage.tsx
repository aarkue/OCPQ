import { LightningBoltIcon } from "@radix-ui/react-icons";
import { useMemo, useState } from "react";
import { LuBug, LuCopy, LuHouse } from "react-icons/lu";
import { Link, useRouteError } from "react-router-dom";
import { Button, buttonVariants } from "./components/ui/button";

const ISSUE_REPO = "aarkue/ocpq";
const ISSUE_URL = `https://github.com/${ISSUE_REPO}/issues/new`;

interface RouteErrorShape {
	statusText?: string;
	message?: string;
	stack?: string;
	status?: number;
}

function buildIssueUrl(error: RouteErrorShape, location: string, userAgent: string): string {
	const title = error.message
		? `Error: ${error.message.slice(0, 80)}`
		: error.statusText
			? `Error: ${error.statusText}`
			: "Unexpected error";
	const body = [
		"### What happened",
		"",
		"<!-- Briefly describe what you were doing when the error appeared. -->",
		"",
		"### Error details",
		"",
		"```",
		error.message ?? error.statusText ?? "Unknown error",
		"```",
		"",
		error.stack ? `### Stack trace\n\n\`\`\`\n${error.stack}\n\`\`\`\n` : "",
		"### Environment",
		"",
		`- URL: ${location}`,
		`- User agent: ${userAgent}`,
	]
		.filter(Boolean)
		.join("\n");
	return `${ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

export default function ErrorPage() {
	const routeError = useRouteError();
	const error: RouteErrorShape = (routeError ?? {}) as RouteErrorShape;
	const [copied, setCopied] = useState(false);

	const issueUrl = useMemo(
		() => buildIssueUrl(error, window.location.href, navigator.userAgent),
		[error],
	);

	const copyDetails = async () => {
		const text = [
			`Error: ${error.message ?? error.statusText ?? "Unknown"}`,
			error.stack ? `\nStack:\n${error.stack}` : "",
			`\nURL: ${window.location.href}`,
			`User agent: ${navigator.userAgent}`,
		].join("\n");
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard unavailable, no-op
		}
	};

	const headline = error.message ?? error.statusText ?? "Something went wrong.";

	return (
		<div
			id="error-page"
			className="mx-auto max-w-xl flex flex-col min-h-screen items-center justify-center px-4 py-8"
		>
			<div className="w-full text-center">
				<LightningBoltIcon className="mx-auto my-2 text-orange-400 w-12 h-12" />
				<h1 className="text-4xl font-bold">Something broke</h1>
				<p className="mt-1 text-lg text-muted-foreground">Sorry about that.</p>

				<div className="mt-6 rounded-md border bg-slate-50 p-4 text-left">
					<p className="text-sm font-medium text-slate-700">Error</p>
					<p className="mt-1 text-sm text-red-700 font-mono break-words">{headline}</p>
					{error.stack && (
						<details className="mt-3">
							<summary className="text-xs text-slate-600 cursor-pointer select-none">
								Stack trace
							</summary>
							<pre className="mt-1 text-[11px] text-slate-600 whitespace-pre-wrap break-all max-h-48 overflow-auto">
								{error.stack}
							</pre>
						</details>
					)}
				</div>

				<p className="mt-6 text-sm text-muted-foreground">
					If this keeps happening, please file a bug report. The link below opens a GitHub issue
					pre-filled with the details above.
				</p>

				<div className="mt-4 flex flex-wrap justify-center gap-2">
					<a
						href={issueUrl}
						target="_blank"
						rel="noopener noreferrer"
						className={buttonVariants({ variant: "default" })}
					>
						<LuBug className="w-4 h-4 mr-1.5" />
						Report on GitHub
					</a>
					<Button type="button" variant="outline" onClick={copyDetails}>
						<LuCopy className="w-4 h-4 mr-1.5" />
						{copied ? "Copied!" : "Copy error details"}
					</Button>
					<Link className={buttonVariants({ variant: "outline" })} to="/">
						<LuHouse className="w-4 h-4 mr-1.5" />
						Back to start
					</Link>
				</div>

				<p className="mt-6 text-xs text-muted-foreground">
					Repository:{" "}
					<a
						href={`https://github.com/${ISSUE_REPO}`}
						target="_blank"
						rel="noopener noreferrer"
						className="underline"
					>
						github.com/{ISSUE_REPO}
					</a>
				</p>
			</div>
		</div>
	);
}
