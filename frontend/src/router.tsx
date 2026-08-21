import { lazy, Suspense } from "react";
import { Toaster } from "react-hot-toast";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App.tsx";
import ErrorPage from "./ErrorPage.tsx";
import DataExtractionBlueprintEditor from "./routes/data-extraction/DataExtractionBlueprintEditor.tsx";
import DataExtractionRoot from "./routes/data-extraction/DataExtractionRoot.tsx";
import OcelElementViewer from "./routes/OcelElementViewer.tsx";
import OcelGraphViewer from "./routes/OcelGraphViewer.tsx";
import OCDeclareListPage from "./routes/oc-declare/OCDeclareListPage.tsx";
import OCDeclareViewer from "./routes/oc-declare/OCDeclareViewer.tsx";
import OcelInfoViewer from "./routes/ocel-info/OcelInfoViewer.tsx";
import PathSchemasViewer from "./routes/path-schemas/PathSchemasViewer.tsx";
import OuterVisualEditor from "./routes/visual-editor/outer-visual-editor/OuterVisualEditor.tsx";

/** Dev-only smoke page for the propel components. Lazy plus a `DEV` guard keeps it out of the
 *  production bundle. */
const ComponentsSmoke = lazy(() => import("./routes/_smoke/ComponentsSmoke.tsx"));

const smokeRoutes = import.meta.env.DEV
	? [
			{
				path: "/_smoke",
				element: (
					<Suspense fallback={null}>
						<ComponentsSmoke />
					</Suspense>
				),
			},
		]
	: [];

const router = createBrowserRouter([
	{
		path: "/",
		element: <App />,
		errorElement: <ErrorPage />,
		children: [
			{ path: "/constraints", element: <OuterVisualEditor /> },
			{ path: "/ocel-info", element: <OcelInfoViewer /> },
			{ path: "/graph", element: <OcelGraphViewer /> },
			{ path: "/path-schemas", element: <PathSchemasViewer /> },
			{ path: "/ocel-element", element: <OcelElementViewer /> },
			{ path: "/oc-declare", element: <OCDeclareListPage /> },
			{ path: "/oc-declare/:id", element: <OCDeclareViewer /> },
			{ path: "/data-extraction", element: <DataExtractionRoot /> },
			{
				path: "/data-extraction/:id",
				element: <DataExtractionBlueprintEditor />,
			},
			...smokeRoutes,
		],
	},
]);

export const MainRouterProvider = () => (
	<>
		<Toaster position="top-right" />
		<RouterProvider router={router} />
	</>
);
