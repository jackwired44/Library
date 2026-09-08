// Call dispositions manager — per Jack: "lets start building out a
// disposition section i can manully add new ones for caling and remove
// them." Built-ins are read-only (they drive real behavior); customs are
// add/remove, and each custom carries the one flag that matters: did we
// actually REACH the person. See lib/dispositions.ts.
import { useState } from "react";
import { dispositionOptions, type CustomDisposition } from "../lib/dispositions";
import { DISPOSITION_GROUP_LABEL } from "../lib/detection";

interface DispositionManagerProps {
  dispositions: CustomDisposition[];
  onAdd: (label: string, connected: boolean) => boolean;
  onRemove: (id: string) => void;
}

export default function DispositionManager({ dispositions, onAdd, onRemove }: DispositionManagerProps) {
  const [draft, setDraft] = useState("");
  const [draftConnected, setDraftConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = dispositionOptions(dispositions);
  const builtIns = options.filter((o) => !o.custom && o.key !== "none");
  const customs = options.filter((o) => o.custom);
  const reached = builtIns.filter((o) => o.connected);
  const notReached = builtIns.filter((o) => !o.connected);

  function submit() {
    if (!draft.trim()) return;
    const ok = onAdd(draft, draftConnected);
    if (!ok) {
      setError("That name is already in use (or isn't a usable name) — pick another.");
      return;
    }
    setDraft("");
    setDraftConnected(false);
    setError(null);
  }

  return (
    <div>
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
        Call outcomes are split by whether you actually <strong style={{ color: "var(--ink)" }}>reached the
        person</strong>. That split is not cosmetic:{" "}
        <strong style={{ color: "var(--ink)" }}>any "reached them" outcome ends that contact's active
        sequences</strong>, because once you have had a real conversation the cadence has to stop rather
        than keep working at them. Everything here shows up in every disposition dropdown and in the
        checkbox filters on Contacts, Calls and Emails.
        <br />
        Two built-ins carry extra behavior on top: "Not interested" also crosses the lead out, "Meeting
        booked" tints the row and stamps it BOOKED, and "Do not contact" additionally blocks any future
        sequence enrollment. Your own dispositions never do those three things — but they do respect the
        reached/not-reached flag you set below.
      </p>

      <div className="rd-label">{DISPOSITION_GROUP_LABEL.reached} · built in</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {reached.map((o) => (
          <span
            key={o.key}
            style={{ fontSize: 11, fontWeight: 700, color: o.color, background: o.bg, borderRadius: 999, padding: "3px 10px" }}
          >
            {o.label}
          </span>
        ))}
      </div>

      <div className="rd-label">{DISPOSITION_GROUP_LABEL["not-reached"]} · built in</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {notReached.map((o) => (
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
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)" }}>
                {o.connected ? DISPOSITION_GROUP_LABEL.reached : DISPOSITION_GROUP_LABEL["not-reached"]}
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
        <select
          value={draftConnected ? "reached" : "not-reached"}
          onChange={(e) => setDraftConnected(e.target.value === "reached")}
          className="field"
          title="Does this outcome mean you actually spoke to the person? A 'reached them' outcome ends their active sequences."
        >
          <option value="not-reached">{DISPOSITION_GROUP_LABEL["not-reached"]}</option>
          <option value="reached">{DISPOSITION_GROUP_LABEL.reached}</option>
        </select>
        <button onClick={submit} disabled={!draft.trim()} className="btn btn-primary">
          Add disposition
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#B5443B", marginTop: 6 }}>{error}</div>}
    </div>
  );
}
