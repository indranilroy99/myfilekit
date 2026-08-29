import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { installMyFileKit } from "./api/myfilekit.js";
import "./styles.css";
// Desktop-application shell. Loaded last: deliberately overrides the older
// marketing-page styling with application chrome (see app-shell.css header).
import "./app-shell.css";

// Expose the local, client-side programmatic API on window.MyFileKit. It wraps
// the same services the UI uses and never opens a network connection.
installMyFileKit();

// Privacy-first: surface unexpected errors to the local console only.
window.addEventListener("error", (event) => {
  console.error("MyFileKit uncaught error", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("MyFileKit unhandled rejection", event.reason);
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
