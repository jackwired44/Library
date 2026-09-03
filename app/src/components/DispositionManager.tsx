// Call dispositions manager — per Jack: "lets start building out a
// disposition section i can manully add new ones for caling and remove
// them." Lists the six built-ins (read-only, because three of them drive
// real behavior) followed by his own, with add/remove for the customs.
// See lib/dispositions.ts for the data model and why a custom disposition
// is deliberately just a label + color.
import { useState } from "react";
import { dispositionOptions, type CustomDisposition } from "../lib/dispositions";

interface DispositionManagerProps {
  dispositions: CustomDisposition[];
  onAdd: (label: string) => boolean;
  onRemove: (id: string) => void;
}

export default function DispositionManager({ dispositions, onAdd, onRemove }: DispositionManagerProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const options = dispositionOptions(dispositions);
  const builtIns = options.filter((o) => !o.custom);
  const customs = options.filter((o) => o.custom);

  function submit() {
    if (!draft.trim()) return;
    const ok = onAdd(draft);
    if (!ok) {
      setError("That name is already in use (or isn't a usable name) — pick another.");
      return;
    }
    setDraft("");
    setError(null);
  }

  return (
    <div>
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
        Add your own call outcomes here — they show up in every disposition dropdown (Scanner, Lead
        Library, Contacts) and in the checkbox filters on Contacts, Calls and Emails.
        <br />
        <strong style={{ color: "var(--ink)" }}>A custom disposition is a label and a color only.</strong> The
        built-ins below are the ones wired into behavior: "Not interested" also crosses the lead out, and
        "Meeting booked" tints the row, stamps it BOOKED and ends that contact's active sequences. Your own
        dispositions deliberately do none of that.
      </p>

      <div className="rd-label">Built in</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {builtIns.map((o) => (
          <span
            key={o.key}
            style={{ fontSize: 11, fontWeight: 700, color: o.color, background: o.bg, borderRadius: 999, padding: "3px 10px" }}
          >
            {o.label}
          </span>
        ))}
      </div>

      <div className="rd-label">Yours</div>
      {customs.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 9, padding: "10px 12px", marginBottom: 12 }}>
          None yet — add one below (e.g. "Left voicemail", "Gatekeeper", "Callback scheduled", "Wrong number").
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
          {customs.map((o) => (
            <div
              key={o.key}
              style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--surface-sunken)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px" }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: o.color, background: o.bg, borderRadius: 999, padding: "3px 10px" }}>
                {o.label}
              </span>
              <span style={{ flex: 1 }} />
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove "${o.label}"? Any lead already set to it keeps the value — it just shows as "${o.label} (removed)" until you change it.`
                    )
                  ) {
                    onRemove(o.key);
                  }
                }}
                className="btn btn-sm btn-danger"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="New call disposition (e.g. Left voicemail)"
          className="field"
          style={{ flex: "1 1 220px" }}
        />
        <button onClick={submit} disabled={!draft.trim()} className="btn btn-primary">
          Add disposition
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#B5443B", marginTop: 6 }}>{error}</div>}
    </div>
  );
}
