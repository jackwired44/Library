import { useEffect, useState } from "react";
import FollowUps from "./components/FollowUps";
import { storageMode } from "./lib/store";

// No sign-in screen, per Jack. The artifact is private to his claude.ai
// account, and that account login is the access control.
export default function App() {
  const [mode, setMode] = useState<"cloud" | "browser" | null>(null);

  useEffect(() => {
    storageMode().then(setMode).catch(() => setMode("browser"));
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-mark" aria-hidden="true">W</span>
          <span className="topbar-name">Call Follow-ups</span>
          <span className="topbar-sub">Wired CIO</span>
        </div>
        <div className="topbar-right">
          {mode && (
            <span className="topbar-hint" title={mode === "cloud" ? "Statuses and drafts are saved to your claude.ai account." : "Statuses and drafts are saved in this browser only."}>
              {mode === "cloud" ? "Saved to your account" : "Saved in this browser"}
            </span>
          )}
        </div>
      </header>
      <main className="main">
        <FollowUps />
      </main>
    </div>
  );
}
