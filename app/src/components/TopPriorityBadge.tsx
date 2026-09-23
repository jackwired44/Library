import { TOP_PRIORITY_META, type TopPriorityReason } from "../lib/detection";

/**
 * Top priority, with the reason on it. Per Jack: "google migrations to
 * microsoft need to be flagged as top priority for leads in main scanner"
 * and "anyone looking specifically to work with a partner also to be
 * included with that."
 *
 * The reason is on the badge rather than a generic "TOP" mark because the
 * two are worked differently — a Google migration is a project, a
 * partner-seeker is a relationship — and a rep scanning the table should
 * know which before they dial.
 *
 * Solid fill rather than the tinted chip every other badge uses, because
 * this one is a rank marker and has to win the row at a glance; a second
 * pale pill beside the category and tier chips would read as just another
 * attribute. The colour is PRIORITY_META.high's teal, so a pinned lead
 * here looks like a High priority lead on the CSP and Custom scanners.
 *
 * Shared by Scanner.tsx and Library.tsx — the same one-component-many-call-
 * sites pattern as BookedStamp and OnCrmBadge, so the two views cannot
 * drift on what a pinned lead is called.
 */
export default function TopPriorityBadge({ reason }: { reason: TopPriorityReason }) {
  const meta = TOP_PRIORITY_META[reason];
  return (
    <span
      title={meta.hint}
      style={{
        display: "inline-block",
        fontSize: 10.5,
        fontWeight: 800,
        color: "#FFFFFF",
        background: "#0E7A72",
        borderRadius: 20,
        padding: "2px 8px",
        letterSpacing: 0.2,
        whiteSpace: "nowrap",
      }}
    >
      ★ {meta.label}
    </span>
  );
}
