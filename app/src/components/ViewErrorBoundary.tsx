import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches a render error inside one view so it shows a message instead of
 * blanking the whole app, sidebar included. Without it, an error caused by
 * one stored lead would blank the page on every reload, since the data that
 * triggers it lives in this browser. Keyed on the view by the caller, so
 * moving to another view clears the error.
 */
export class ViewErrorBoundary extends Component<{ children: ReactNode; onHome?: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("View error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="panel" role="alert" aria-label="View error" style={{ padding: 20, maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}>This view hit an error</h2>
        <p className="page-sub" style={{ marginBottom: 8 }}>
          Your leads are safe: nothing was deleted, and the rest of the Vault still works from the sidebar.
        </p>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "var(--surface-sunken)", padding: 10, borderRadius: 6 }}>
          {error.message || String(error)}
        </pre>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
          {this.props.onHome && <button className="btn btn-secondary" onClick={() => { this.setState({ error: null }); this.props.onHome?.(); }}>Go to Home</button>}
        </div>
      </div>
    );
  }
}
