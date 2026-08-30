import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  /** Scoped fallback. When omitted, the full-screen app-level error page is used. */
  fallback?: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown): void {
    // Privacy-first: log locally only, never report to an external service.
    console.error("MyFileKit render error", error, info);
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // A nested boundary (e.g. around one lazy tool) renders its own fallback so a
    // single failing pane does not replace the whole shell.
    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem",
          textAlign: "center",
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
          color: "var(--foreground)",
          background: "var(--card)"
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>Something went wrong</h1>
        <p style={{ margin: 0, color: "var(--muted-foreground)", maxWidth: "28rem" }}>
          MyFileKit hit an unexpected error. Your files stay on this device; reloading starts a fresh
          session.
        </p>
        <button
          type="button"
          onClick={() => location.reload()}
          style={{
            appearance: "none",
            border: "1px solid var(--primary)",
            borderRadius: "8px",
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            padding: "0.5rem 1.25rem",
            fontSize: "0.95rem",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
