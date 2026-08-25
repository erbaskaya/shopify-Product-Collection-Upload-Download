import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import WebAuth from "./WebAuth";
import "./webAuth.css";
import "./readability.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WebAuth><App /></WebAuth>
  </React.StrictMode>,
);
