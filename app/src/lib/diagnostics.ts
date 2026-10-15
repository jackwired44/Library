// Platform diagnostic. Per Jack: "make sure a diagnostic is ran so i can
// see where inefficiencies are to improve metrics … need to all flow
// together and we need numericals to match and be mapped properly".
//
// Pure: takes what the app already holds and returns two things —
//   checks:  invariants that must hold, so every view's numbers agree.
//            A failure is a bug, and says which numbers disagree.
//   gaps:    where work is leaking — leads you cannot act on, or have not
//            acted on yet — each with a count and the view that fixes it.
// Nothing here writes anything.
import type { StoredLead } from "./leadStore";
import type { LeadList } from "./leadLists";
import { apolloHitFor, type RosterIndex } from "./apolloRoster";
import { verdictOf, statusOf, STATUS_ORDER, countByStatus } from "./leadStatus";
import { apolloStandingOf, STATUS_ORDER as STANDING_ORDER, NEEDS, type Status as Standing } from "../components/ApolloStatus";

export interface DiagCheck { id: string; label: string; ok: boolean; detail: string }
export interface DiagGap {
  id: string; label: string; count: number; of: number; hint: string;
  /** Where to fix it. */
  view: "allleads" | "queue" | "lists" | "scanner";
  severity: "high" | "medium" | "low";
}
export interface FileHealth {
  file: string; leads: number; strong: number; known: number; needs: number; noContact: number;
}
export interface Diagnostics {
  ranAt: string;
  totals: { leads: number; strong: number; review: number; bad: number; files: number; lists: number; listRows: number };
  standing: Record<Standing, number>;
  checks: DiagCheck[];
  gaps: DiagGap[];
  files: FileHealth[];
  ms: number;
}

const STALE_DAYS = 30;

export function runDiagnostics(leads: StoredLead[], apolloIndex: RosterIndex | null, lists: LeadList[] = [], now = Date.now()): Diagnostics {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const checks: DiagCheck[] = [];
  const check = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, ok, detail });
  const n = (x: number) => x.toLocaleString();

  const verdict = { strong: 0, review: 0, bad: 0 };
  const standing = Object.fromEntries(STANDING_ORDER.map((k) => [k, 0])) as Record<Standing, number>;
  const keys = new Map<string, number>();
  const files = new Map<string, FileHealth>();
  let noContact = 0, noCompany = 0, noFile = 0, nameOnly = 0, stale = 0, strongUnchecked = 0, strongNeeds = 0;
  let liveWithoutCheck = 0, badKey = 0, bounced = 0;
  const staleCut = new Date(now - STALE_DAYS * 86_400_000).toISOString();

  for (const l of leads) {
    const v = verdictOf(l.tier);
    verdict[v]++;
    const st = apolloStandingOf(l, apolloIndex);
    standing[st]++;
    keys.set(l.key, (keys.get(l.key) || 0) + 1);
    if (!l.key || !/^[a-z]+:./.test(l.key)) badKey++;
    const reachable = !!(l.email || l.phone || l.mobilePhone);
    if (!reachable) noContact++;
    if (!(l.company || "").trim()) noCompany++;
    if (!l.sourceFiles?.length) noFile++;
    if (l.apollo?.live && !l.apolloCheckedAt) liveWithoutCheck++;
    if (l.apolloCheckedAt && l.apolloCheckedAt < staleCut) stale++;
    if (!l.apollo) {
      const hit = apolloHitFor({ email: l.email, contact: l.contact }, apolloIndex);
      if (hit && hit.how === "name") nameOnly++;
    }
    if ((l.apollo?.sequences ?? []).some((s) => /bounc/i.test(s.reason || ""))) bounced++;
    if (v === "strong") {
      if (st === "unchecked") strongUnchecked++;
      if (NEEDS.has(st)) strongNeeds++;
    }
    for (const f of l.sourceFiles ?? []) {
      let h = files.get(f);
      if (!h) { h = { file: f, leads: 0, strong: 0, known: 0, needs: 0, noContact: 0 }; files.set(f, h); }
      h.leads++;
      if (v === "strong") h.strong++;
      if (st !== "unchecked") h.known++;
      if (NEEDS.has(st)) h.needs++;
      if (!reachable) h.noContact++;
    }
  }
  const total = leads.length;

  /* ---- invariants: the numbers every view shows must add up ---- */
  const vSum = verdict.strong + verdict.review + verdict.bad;
  check("verdict-sum", "Strong + Needs Review + Bad = All leads", vSum === total,
    `${n(verdict.strong)} + ${n(verdict.review)} + ${n(verdict.bad)} = ${n(vSum)} of ${n(total)}`);
  const sSum = STANDING_ORDER.reduce((a, k) => a + standing[k], 0);
  check("standing-sum", "Every lead has exactly one Apollo standing", sSum === total,
    `${STANDING_ORDER.map((k) => n(standing[k])).join(" + ")} = ${n(sSum)} of ${n(total)}`);
  const byStatus = countByStatus(leads);
  const stSum = STATUS_ORDER.reduce((a, k) => a + byStatus[k], 0);
  check("status-sum", "Home's pipeline statuses add up to All leads", stSum === total, `${n(stSum)} of ${n(total)}`);
  const dupKeys = [...keys.values()].filter((c) => c > 1).length;
  check("unique-keys", "No lead is stored twice", dupKeys === 0, dupKeys ? `${n(dupKeys)} keys appear more than once` : `${n(keys.size)} unique keys`);
  check("keys-valid", "Every lead has a usable match key", badKey === 0, badKey ? `${n(badKey)} leads have a blank or malformed key` : "all keyed");
  check("live-stamped", "Every live Apollo result carries a check date", liveWithoutCheck === 0,
    liveWithoutCheck ? `${n(liveWithoutCheck)} live results with no check date — they count as checked but can't be re-checked on schedule` : "all dated");
  check("files-linked", "Every lead knows which CSV it came from", noFile === 0, noFile ? `${n(noFile)} leads with no source file` : "all linked");
  // In Apollo's "Active" and Home's pipeline must agree: a lead Apollo
  // has live in a sequence should never read as untouched on Home.
  const WORKING = new Set(["in-sequence", "called", "reached", "meeting", "not-interested", "finished"]);
  let disagree = 0;
  for (const l of leads) {
    if (l.statusOverride) continue;
    if (apolloStandingOf(l, apolloIndex) === "active" && !WORKING.has(statusOf(l))) disagree++;
  }
  check("pipeline-vs-apollo", "Home's pipeline agrees with In Apollo on who is in a sequence", disagree === 0,
    disagree ? `${n(disagree)} leads are active in an Apollo sequence (matched from Apollo uploads) but Home's pipeline still shows them as not worked` : "they agree");
  const listRows = lists.reduce((a, l) => a + l.rows.length, 0);
  check("lists-shaped", "Every list row has a name or company", lists.every((l) => l.rows.every((r) => (r["Company Name"] || r["First Name"] || r.Email))),
    `${n(lists.length)} lists, ${n(listRows)} rows`);

  /* ---- gaps: where work leaks ---- */
  const gaps: DiagGap[] = [
    { id: "strong-unchecked", label: "Strong Signal leads never checked against Apollo", count: strongUnchecked, of: verdict.strong, view: "allleads", severity: "high",
      hint: "You can't know if they're already being worked. All leads → Tier: Strong Signal → Check in Apollo (400 an hour)." },
    { id: "strong-needs", label: "Strong Signal leads that need a sequence", count: strongNeeds, of: verdict.strong, view: "queue", severity: "high",
      hint: "Checked: never reached, never sequenced, or not in Apollo at all. In Apollo → Needs a sequence → Add to list → download for Apollo." },
    { id: "unchecked", label: "Leads with no Apollo standing yet (any tier)", count: standing.unchecked, of: total, view: "allleads", severity: "medium",
      hint: "Run checks in batches of 400 an hour, Strong Signal first." },
    { id: "no-contact", label: "Leads with no email and no phone", count: noContact, of: total, view: "allleads", severity: "medium",
      hint: "Can't be dialled or emailed, and Apollo can only match them by name. Enrich or drop them." },
    { id: "name-only", label: "Apollo matches on name only (unconfirmed)", count: nameOnly, of: total, view: "queue", severity: "medium",
      hint: "Matched to a pulled Apollo upload by full name, not email. Check them live to confirm." },
    { id: "stale", label: `Apollo checks older than ${STALE_DAYS} days`, count: stale, of: total, view: "allleads", severity: "low",
      hint: "Sequences move. Tick Re-check and run them again." },
    { id: "bounced", label: "Sequences that ended on a bounce", count: bounced, of: total, view: "queue", severity: "low",
      hint: "The email on file is bad. Find a new one before re-sequencing." },
    { id: "no-company", label: "Leads with no company", count: noCompany, of: total, view: "allleads", severity: "low",
      hint: "No company means no company roll-up and no account match." },
  ];

  const fileList = [...files.values()].sort((a, b) => (b.strong - b.known) - (a.strong - a.known) || b.leads - a.leads);

  return {
    ranAt: new Date(now).toISOString(),
    totals: { leads: total, strong: verdict.strong, review: verdict.review, bad: verdict.bad, files: files.size, lists: lists.length, listRows },
    standing, checks, gaps, files: fileList,
    ms: typeof performance !== "undefined" ? Math.round(performance.now() - t0) : 0,
  };
}
