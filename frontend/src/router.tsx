import { RouterProvider, createBrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import OuterVisualEditor from "./routes/visual-editor/outer-visual-editor/OuterVisualEditor.tsx";
import OcelInfoViewer from "./routes/ocel-info/OcelInfoViewer.tsx";
import ErrorPage from "./ErrorPage.tsx";
import OcelGraphViewer from "./routes/OcelGraphViewer.tsx";
import OcelElementViewer from "./routes/OcelElementViewer.tsx";

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
    ],
  },
]);

export const MainRouterProvider = () => <RouterProvider router={router} />;
