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
import OuterVisualEditor from "./routes/visual-editor/outer-visual-editor/OuterVisualEditor.tsx";

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
		],
	},
]);

export const MainRouterProvider = () => (
	<>
		<Toaster position="top-right" />
		<RouterProvider router={router} />
	</>
);
