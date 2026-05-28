import React, { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Trash2 } from "lucide-react";

const C = {
  base: "#0c0c10", s1: "#12121a", s2: "#1a1a24", s3: "#22222e",
  accent: "#6366f1", t1: "#e8e8ec", t2: "#94949c", t3: "#6b6b73", t4: "#4a4a52",
  ok: "#10b981", wrn: "#f59e0b", err: "#ef4444", inf: "#60a5fa"
};
const ff = '"Geist Mono", "JetBrains Mono", monospace';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetState = () => {
    // Clear all localStorage
    try {
      localStorage.clear();
    } catch {
      // Ignore localStorage errors
    }
    // Reload the app
    window.location.reload();
  };

  override render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.DEV;

      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            background: C.base,
            padding: "32px",
            fontFamily: ff,
          }}
        >
          <div
            style={{
              background: C.s2,
              border: `1px solid ${C.s3}`,
              borderRadius: "0px",
              padding: "32px",
              maxWidth: "512px",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* Icon */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "0px",
                    background: "rgba(239,68,68,0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <AlertTriangle style={{ width: "32px", height: "32px", color: "#f87171" }} />
                </div>
              </div>

              {/* Message */}
              <div style={{ textAlign: "center" }}>
                <h2
                  style={{
                    fontSize: "16px",
                    fontWeight: 600,
                    color: C.t1,
                    margin: "0 0 8px 0",
                  }}
                >
                  Something went wrong
                </h2>
                <p
                  style={{
                    fontSize: "12px",
                    color: C.t2,
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  Construct encountered an unexpected error. You can try reloading the app or resetting the application state.
                </p>
              </div>

              {/* Error details in dev mode */}
              {isDev && this.state.error && (
                <div
                  style={{
                    background: C.s1,
                    border: `1px solid ${C.s3}`,
                    borderRadius: "0px",
                    padding: "16px",
                    overflow: "hidden",
                  }}
                >
                  <p
                    style={{
                      fontSize: "11px",
                      fontFamily: ff,
                      color: "#f87171",
                      wordBreak: "break-all",
                      margin: "0 0 8px 0",
                    }}
                  >
                    {this.state.error.toString()}
                  </p>
                  {this.state.errorInfo && (
                    <pre
                      style={{
                        fontSize: "10px",
                        fontFamily: ff,
                        color: C.t2,
                        overflow: "auto",
                        maxHeight: "128px",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        margin: 0,
                      }}
                    >
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              )}

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  justifyContent: "center",
                }}
              >
                <button
                  onClick={this.handleReload}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 16px",
                    borderRadius: "0px",
                    background: "rgba(99,102,241,0.1)",
                    color: C.accent,
                    fontSize: "12px",
                    fontWeight: 500,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: ff,
                    transition: "background 100ms ease",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.2)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.1)";
                  }}
                >
                  <RotateCcw style={{ width: "16px", height: "16px" }} />
                  Reload App
                </button>
                <button
                  onClick={this.handleResetState}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 16px",
                    borderRadius: "0px",
                    background: "rgba(239,68,68,0.1)",
                    color: "#f87171",
                    fontSize: "12px",
                    fontWeight: 500,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: ff,
                    transition: "background 100ms ease",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.2)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.1)";
                  }}
                >
                  <Trash2 style={{ width: "16px", height: "16px" }} />
                  Reset State
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
