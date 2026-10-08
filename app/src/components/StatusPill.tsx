// A lead's status, the same way on every screen. A hand-set status carries
// a small ✎ so it never reads as something the platform worked out.
import { STATUS_META, statusOf, derivedStatus } from "../lib/leadStatus";
import type { StoredLead } from "../lib/leadStore";

export default function StatusPill({ lead }: { lead: StoredLead }) {
  const s = statusOf(lead);
  const m = STATUS_META[s];
  const manual = !!lead.statusOverride;
  return (
    <span
      title={manual
        ? `Set by hand on ${lead.statusOverride!.at.slice(0, 10)}. The evidence alone says: ${STATUS_META[derivedStatus(lead)].label}.`
        : m.hint}
      style={{
        display: "inline-block", fontSize: 11, fontWeight: 600, padding: "2px 8px",
        borderRadius: 999, color: m.color, background: m.bg, whiteSpace: "nowrap",
      }}
    >
      {m.label}{manual ? " ✎" : ""}
    </span>
  );
}
