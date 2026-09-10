import { useState } from "react";
import { checkScannerPassword } from "../lib/auth";

// The Scanner's own gate. Deliberately NOT the full-screen lock the
// sign-in uses — the rest of the platform stays visible and usable behind
// it, because the point is to close off one screen, not the app.
export default function ScannerGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function tryUnlock() {
    setChecking(true);
    const ok = await checkScannerPassword(value);
    setChecking(false);
    if (ok) {
      // Nothing is stored — App holds the unlock in state only, so it is
      // gone on reload or on leaving the tab.
      onUnlock();
    } else {
      setError("Wrong password.");
      setValue("");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Scanner</h2>
          <div className="panel-sub">This screen is locked.</div>
        </div>
      </div>
      <div className="panel" style={{ maxWidth: 420 }}>
        <div className="panel-body" style={{ padding: "18px 18px 20px" }}>
          <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 12 }}>
            Enter the Scanner password to upload and process lead files. Everything else in the platform stays open.
          </div>
          <input
            type="password"
            autoFocus
            aria-label="Scanner password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
            placeholder="Scanner password"
            className="field"
            style={{ width: "100%", boxSizing: "border-box", height: 38 }}
          />
          {error && <div style={{ marginTop: 8, color: "#B5443B", fontSize: 12.5 }}>{error}</div>}
          <button onClick={tryUnlock} disabled={checking || !value} className="btn btn-primary" style={{ marginTop: 12 }}>
            {checking ? "Checking…" : "Unlock scanner"}
          </button>
        </div>
      </div>
    </div>
  );
}
