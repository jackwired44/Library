// "We've seen this one before" — the per-row marker on a freshly scanned
// lead. Per Jack: after a scan, say whether these companies and contacts
// have been in sequences, been contacted, or turned up in past uploads.
//
// Three independent facts, shown in order of how much they should change
// what you do with the lead:
//   1. already in one of our sequences  — do not enroll again
//   2. contacted before                 — someone has already worked them
//   3. seen in a past upload            — a duplicate of earlier lead data
//
// A lead with none of these gets no badge at all: a clean row should read
// clean, and stamping "new" on the overwhelming majority would be noise.
// Same shared-component pattern as BookedStamp/OnCrmBadge.
import type { ResultRow } from "../lib/detection";

type History = NonNullable<ResultRow["leadHistory"]>;

const pill: React.CSSProperties = {
  display: "inline-block",
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: 0.2,
  borderRadius: 4,
  padding: "1px 5px",
  marginRight: 4,
  marginBottom: 2,
  whiteSpace: "nowrap",
};

export default function LeadHistoryBadge({ history }: { history?: History }) {
  if (!history) return null;

  const inSeq = history.apolloStanding === "in-sequence";
  const finished = history.apolloStanding === "finished";
  const out: React.ReactNode[] = [];

  if (inSeq || finished) {
    const names = history.apolloSequences.map((s) =>
      `${s.name}${s.step ? ` (step ${s.step})` : ""} — ${s.status}`).join("\n");
    out.push(
      <span
        key="seq"
        title={`Already in a sequence. Enrolling again would double the cadence.\n\n${names}`}
        style={{
          ...pill,
          color: inSeq ? "#0A66C2" : "#4C6167",
          background: inSeq ? "#EAF3FC" : "#EEF1F2",
        }}
      >
        {inSeq ? "IN SEQUENCE" : "SEQUENCE DONE"}
      </span>
    );
  } else if (history.apolloStanding === "other-owner") {
    out.push(
      <span key="other" title="In a sequence owned by someone else on the team — not one of Jack's or Carly's." style={{ ...pill, color: "#4C6167", background: "#EEF1F2" }}>
        OTHER CADENCE
      </span>
    );
  }

  if (history.contactedBefore && !inSeq) {
    out.push(
      <span key="cont" title="A call, an email or a disposition is already on record for this person." style={{ ...pill, color: "#96600a", background: "#FBF3E7" }}>
        CONTACTED
      </span>
    );
  }

  if (history.seenBefore) {
    const seen = history.timesSeen > 1 ? ` ×${history.timesSeen}` : "";
    const files = history.priorFiles.length ? `\n\nPreviously in:\n${history.priorFiles.join("\n")}` : "";
    out.push(
      <span
        key="seen"
        title={`Appeared in an earlier upload${history.firstSeenAt ? ` — first seen ${history.firstSeenAt.slice(0, 10)}` : ""}.${files}`}
        style={{ ...pill, color: "#7A3E8C", background: "#F4EAF7" }}
      >
        SEEN BEFORE{seen}
      </span>
    );
  }

  // Only worth saying when the person themselves is new — otherwise the
  // row already carries a stronger badge and this is just clutter.
  if (!history.seenBefore && !inSeq && !finished && history.companyPriorContacts > 0) {
    out.push(
      <span
        key="co"
        title={`${history.companyPriorContacts} other contact${history.companyPriorContacts === 1 ? "" : "s"} at this company already on file${history.companyInSequence ? ", and the company is already in a sequence" : ""}.`}
        style={{ ...pill, color: "#0F7A72", background: "#DFF3F1" }}
      >
        COMPANY KNOWN
      </span>
    );
  }

  if (!out.length) return null;
  return <div style={{ marginBottom: 2 }}>{out}</div>;
}
