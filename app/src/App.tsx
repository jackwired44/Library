import { useState } from "react";
import Scanner from "./components/Scanner";

type View = "scanner" | "history" | "library";

// Assembled incrementally as each view component lands (see PROGRESS.md).
// Scanner is first per CLAUDE.md's suggested build order; History/Library
// tabs render a "not built yet" placeholder until their own tasks land.
export default function App() {
  const [view, setView] = useState<View>("scanner");

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "36px 28px 60px" }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Wired CIO Lead Scanner</h1>
        <nav style={{ display: "flex", gap: 6 }}>
          {(["scanner", "history", "library"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                border: "none",
                borderRadius: 8,
                padding: "8px 14px",
                fontWeight: 700,
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: view === v ? "#081e22" : "#e9ebef",
                color: view === v ? "#fff" : "#4c6167",
              }}
            >
              {v}
            </button>
          ))}
        </nav>
      </header>

      {view === "scanner" && <Scanner />}
      {view === "history" && <p style={{ color: "#9aa1ac" }}>History view — not built yet.</p>}
      {view === "library" && <p style={{ color: "#9aa1ac" }}>Library view — not built yet.</p>}
    </div>
  );
}
