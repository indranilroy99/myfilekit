import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

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
