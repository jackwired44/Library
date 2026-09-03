// Platform Notes — dated, titled internal notes about the platform/build
// itself, browsable back by calendar day. Per Jack: replaces the old
// single-scratchpad textarea; shares one modal shell with Cheat Sheet
// (a tab switch, not two separate popups) since the floating Cheat Sheet
// button and its own Settings-gear entry point were both removed. See
// CLAUDE.md "Cheat Sheet relocation + dated Platform Notes."
import { useEffect, useMemo, useState } from "react";
import { addPlatformNote, dayKeyOf, deletePlatformNote, loadPlatformNotes, type PlatformNoteEntry } from "../lib/platformNotes";

interface PlatformNotesProps {
  onClose: () => void;
  onSwitchToCheatSheet: () => void;
  onSwitchToDispositions?: () => void;
}

export default function PlatformNotes({ onClose, onSwitchToCheatSheet, onSwitchToDispositions }: PlatformNotesProps) {
  const [entries, setEntries] = useState<PlatformNoteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayFilter, setDayFilter] = useState("");
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    loadPlatformNotes().then((e) => {
      setEntries(e);
      setLoading(false);
    });
  }, []);

  const daysWithNotes = useMemo(() => [...new Set(entries.map((e) => dayKeyOf(e.createdAt)))].sort().reverse(), [entries]);
  const filtered = useMemo(() => (dayFilter ? entries.filter((e) => dayKeyOf(e.createdAt) === dayFilter) : entries), [entries, dayFilter]);

  async function submit() {
    if (!body.trim() && !title.trim()) return;
    const entry = await addPlatformNote(title, body);
    setEntries((prev) => [entry, ...prev]);
    setTitle("");
    setBody("");
    setComposing(false);
  }

  async function remove(id: string) {
    await deletePlatformNote(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,30,34,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", zIndex: 50, overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: 16, maxWidth: 640, width: "100%", padding: "24px 26px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <TabButton active label="Platform Notes" />
            <TabButton label="Cheat Sheet" onClick={onSwitchToCheatSheet} />
            {onSwitchToDispositions && <TabButton label="Dispositions" onClick={onSwitchToDispositions} />}
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, color: "var(--muted)", cursor: "pointer" }}>✕</button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 8, marginBottom: 18 }}>
          Internal notes about the platform/build itself — not tied to any lead. Saved locally on this device.
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          {!composing ? (
            <button onClick={() => setComposing(true)} style={{ border: "none", background: "var(--accent)", color: "#081E22", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 13 }}>
              + New note
            </button>
          ) : null}
          {daysWithNotes.length > 0 && (
            <>
              <select
                value={dayFilter}
                onChange={(e) => setDayFilter(e.target.value)}
                style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }}
              >
                <option value="">All days ({entries.length})</option>
                {daysWithNotes.map((d) => (
                  <option key={d} value={d}>{new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })} ({entries.filter((e) => dayKeyOf(e.createdAt) === d).length})</option>
                ))}
              </select>
              {dayFilter && <button onClick={() => setDayFilter("")} style={{ background: "none", border: "none", textDecoration: "underline", fontSize: 12 }}>Show all</button>}
            </>
          )}
        </div>

        {composing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              autoFocus
              style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", fontSize: 13, fontWeight: 600 }}
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Note…"
              rows={4}
              style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", fontSize: 13, resize: "vertical", font: "inherit" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={submit} disabled={!title.trim() && !body.trim()} style={{ border: "none", background: title.trim() || body.trim() ? "#2CC295" : "#CDEFE3", color: "#081E22", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: title.trim() || body.trim() ? "pointer" : "not-allowed" }}>
                Save
              </button>
              <button onClick={() => { setComposing(false); setTitle(""); setBody(""); }} style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600 }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)", padding: "16px 0" }}>
            {dayFilter ? "No notes on this day." : "No platform notes yet — use \"+ New note\" to start one."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "48vh", overflowY: "auto" }}>
            {filtered.map((e) => (
              <div key={e.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{e.title}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(e.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    <button onClick={() => remove(e.id)} title="Delete note" style={{ border: "none", background: "none", color: "#B5443B", fontSize: 12.5, cursor: "pointer" }}>✕</button>
                  </div>
                </div>
                {e.body && <div style={{ fontSize: 13, color: "var(--ink)", marginTop: 4, whiteSpace: "pre-wrap" }}>{e.body}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={active}
      style={{
        border: "none",
        borderRadius: 8,
        padding: "6px 12px",
        fontSize: 13,
        fontWeight: 700,
        background: active ? "var(--ink)" : "var(--surface-sunken)",
        color: active ? "#fff" : "var(--muted)",
        cursor: active ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}
