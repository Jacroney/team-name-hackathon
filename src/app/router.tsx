import { createBrowserRouter, Navigate } from "react-router-dom";
import { App } from "./App";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/incidents" replace /> },
  { path: "/incidents", element: <App /> },
  { path: "/incidents/:incidentId", element: <App /> },
  { path: "*", element: <Navigate to="/incidents" replace /> },
]);
