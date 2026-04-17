import { Toaster } from "react-hot-toast";
import { createBrowserRouter, RouterProvider, useSearchParams } from "react-router-dom";
import App from "./App.tsx";
import ErrorPage from "./ErrorPage.tsx";
import DataExtractionBlueprintEditor from "./routes/data-extraction/DataExtractionBlueprintEditor.tsx";
import DataExtractionRoot from "./routes/data-extraction/DataExtractionRoot.tsx";
import OcelElementViewer from "./routes/OcelElementViewer.tsx";
import OcelGraphViewer from "./routes/OcelGraphViewer.tsx";
import OCDeclareListPage from "./routes/oc-declare/OCDeclareListPage.tsx";
import OCDeclareViewer from "./routes/oc-declare/OCDeclareViewer.tsx";
import OcelInfoViewer from "./routes/ocel-info/OcelInfoViewer.tsx";
import OuterVisualEditor from "./routes/visual-editor/outer-visual-editor/OuterVisualEditor.tsx";

/** Dev-only route that throws during render so the errorElement is exercised.
 *  Accepts `?msg=...` to customise the error, and `?kind=stack` to throw an
 *  Error with a stack trace (default) or `?kind=string` to throw a plain string. */
function DebugErrorRoute(): JSX.Element {
	const [params] = useSearchParams();
	const msg = params.get("msg") ?? "Synthetic test error (triggered via /__debug/error)";
	const kind = params.get("kind") ?? "stack";
	if (kind === "string") {
		throw msg;
	}
	throw new Error(msg);
}

const router = createBrowserRouter([
	{
		path: "/",
		element: <App />,
		errorElement: <ErrorPage />,
		children: [
			{ path: "/constraints", element: <OuterVisualEditor /> },
			{ path: "/ocel-info", element: <OcelInfoViewer /> },
			{ path: "/graph", element: <OcelGraphViewer /> },
			{ path: "/ocel-element", element: <OcelElementViewer /> },
			{ path: "/oc-declare", element: <OCDeclareListPage /> },
			{ path: "/oc-declare/:id", element: <OCDeclareViewer /> },
			{ path: "/data-extraction", element: <DataExtractionRoot /> },
			{
				path: "/data-extraction/:id",
				element: <DataExtractionBlueprintEditor />,
			},
			...(import.meta.env.DEV ? [{ path: "/__debug/error", element: <DebugErrorRoute /> }] : []),
		],
	},
]);

export const MainRouterProvider = () => (
	<>
		<Toaster position="top-right" />
		<RouterProvider router={router} />
	</>
);
