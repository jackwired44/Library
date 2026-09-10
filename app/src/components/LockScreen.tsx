import { useState } from "react";
import { checkCredentials, setUnlocked } from "../lib/auth";

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [email, setEmail] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function tryUnlock() {
    setChecking(true);
    const ok = await checkCredentials(email, value);
    setChecking(false);
    if (ok) {
      setUnlocked(true);
      onUnlock();
    } else {
      // Deliberately does not say WHICH field was wrong — naming it would
      // confirm a valid email to anyone guessing.
      setError("Wrong email or password.");
      setValue("");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(140deg, #0C4651 0%, #081E22 78%)",
        padding: 24,
      }}
    >
      <div style={{ background: "#fff", borderRadius: 16, padding: "32px 28px", width: "100%", maxWidth: 340, textAlign: "center" }}>
        <div style={{ fontSize: 19, fontWeight: 700, color: "#081E22" }}>Wired CIO Lead Scanner</div>
        <div style={{ fontSize: 13, color: "#6b7480", marginTop: 6 }}>Sign in to continue.</div>
        <input
          type="email"
          autoFocus
          autoComplete="username"
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
          placeholder="Email"
          style={{ width: "100%", marginTop: 10, padding: "11px 13px", fontSize: 15, border: "1px solid var(--border)", borderRadius: 9, boxSizing: "border-box" }}
        />
        <input
          type="password"
          autoComplete="current-password"
          aria-label="Password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
          placeholder="Password"
          style={{ width: "100%", marginTop: 16, padding: "11px 13px", fontSize: 15, border: "1px solid var(--border)", borderRadius: 9, boxSizing: "border-box" }}
        />
        <button
          onClick={tryUnlock}
          disabled={checking}
          style={{ width: "100%", marginTop: 12, padding: 11, fontSize: 14, fontWeight: 700, background: "#2CC295", color: "#081E22", border: "none", borderRadius: 9 }}
        >
          {checking ? "Checking…" : "Unlock"}
        </button>
        <div style={{ color: "#B5443B", fontSize: 12.5, marginTop: 10, minHeight: 16 }}>{error}</div>
      </div>
    </div>
  );
}
