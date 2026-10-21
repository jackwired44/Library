// The Refresher: lists the platform suggests on its own, and the hand-off
// of each accepted list into an Apollo sequence.
//
// Per Jack: "create a refresher mechanism here under all leads that can auto
// generate lists that seem likely and action them into sequences once pushed
// to apollo this will help with managing email campaigns and who we are
// contacting i will still build how i have been". Approved choices: the
// sequence is picked when a list is accepted, a list holds at most 100
// leads, and only emails that are green-lit go on one.
//
// Read-only toward Apollo, like the rest of the platform: "pushed to Apollo"
// is the CSV Jack imports there. The list then reads Downloaded until an
// Apollo check or pull shows its leads in the sequence picked, which is
// worked out from data the platform already holds, never written anywhere.
//
// Every suggestion is fresh or went nowhere. Per Jack: "this action checks
// the leads are fresh have not really gone anywhere or gone nowhere and are
// not in hubspot as a deal have not been info requested pending review or
// meeting booked". So it leaves out anyone active in a sequence, a deal or
// meeting on file (HubSpot / Notion / Echo: account manager only), anyone
// with a successful conversation (info requested, pending review, replied,
// talked, meeting booked), a not-interested / do-not-contact lead, and
// anyone already on a live campaign list, so nobody is worked twice.
//
// Per Jack: "i will choose certain files to do this from and then you
// generate the list around strong signals but also company or eventually
// industry". The component scopes `leads` to the files he picks; GroupBy
// decides whether the lists are cut by product line and hot signal, by
// company, or by industry (enriched company data only).
import type { StoredLead } from "./leadStore";
import type { RuleFacts, ProductKey } from "./smartRules";
import { PRODUCT_LABEL } from "./smartRules";
import { apolloHitFor, type RosterIndex } from "./apolloRoster";
import { parseKeywords, matchesKeywords } from "./keywords";

export const REFRESH_CAP = 100;
/** A suggestion smaller than this is not worth a campaign; it is not shown. */
export const REFRESH_MIN = 5;
export const STALE_DAYS = 45;
export const FRESH_DAYS = 30;
export const DISMISS_DAYS = 14;
/** A company list needs at least this many people at the company. */
export const COMPANY_MIN = 2;
/** At most this many company lists at once, biggest first. */
export const COMPANY_LISTS = 20;

export type GroupBy = "product" | "company" | "industry";
export const GROUP_BY_LABEL: Record<GroupBy, string> = {
  product: "Product line & hot signals",
  company: "Company",
  industry: "Industry",
};

export type EmailReadiness = "ready" | "unchecked" | "flagged";

export interface RefreshContext {
  leads: StoredLead[];
  facts: Map<string, RuleFacts>;
  /** Green-lit email → ready; never checked by Apollo or a verifier →
   *  unchecked; anything else Apollo or a verifier flagged → flagged. */
  email: (l: StoredLead) => EmailReadiness;
  /** On a live campaign list already. */
  onLiveCampaign: (l: StoredLead) => boolean;
  /** Recycle stage, from lib/recycle.ts. */
  recycleReady: (l: StoredLead) => boolean;
  today?: Date;
}

export interface RefreshSuggestion {
  id: string;
  title: string;
  why: string;
  product: ProductKey | null;
  /** Green-lit leads, best first, capped at REFRESH_CAP. */
  ready: StoredLead[];
  /** All green-lit matches, before the cap. */
  readyTotal: number;
  /** Matches whose email no one has checked yet: an Apollo check settles them. */
  unchecked: StoredLead[];
  /** Matches whose email Apollo or a verifier flagged. Left for calling. */
  flagged: number;
}

const GOOGLE_RE = /google\s*workspace|g\s*suite|\bgsuite\b|moving off google|on google|google\s*(?:mail|email|chat)/i;
const PARTNER_RE = /\bwants?\s+(?:to\s+work\s+with\s+)?a?\s*partner\b|⚑\s*wants\s+partner/i;

const daysAgo = (n: number, today: Date) => {
  const d = new Date(today.getTime()); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10);
};

interface Generator {
  id: string;
  title: string;
  why: string;
  product: ProductKey | null;
  /** Recycle-ready leads have been worked before; every other generator
   *  wants leads nobody is working now and nobody closed out. */
  recycle?: boolean;
  test: (l: StoredLead, f: RuleFacts, today: Date) => boolean;
  /** Company / industry lists: drawn from the fresh-or-went-nowhere pool. */
  pool?: boolean;
  /** Smallest list worth showing; REFRESH_MIN when unset. */
  min?: number;
}

const strong = (f: RuleFacts) => f.verdict === "strong";
/** Out of every suggestion, whatever it is about: being worked now, an
 *  account-manager account, or a conversation that already went somewhere. */
export const blocked = (f: RuleFacts) => f.engaged || f.active || !!f.reached;
const untouched = (f: RuleFacts) => !f.touched && !f.sequenced;

function generators(): Generator[] {
  const list: Generator[] = [
    {
      id: "google", title: "Google → Microsoft", product: "m365",
      why: "Their notes say they are on Google or moving off it, and nobody has worked them yet. The hottest M365 lead there is.",
      test: (l, f) => untouched(f) && f.verdict !== "bad" && GOOGLE_RE.test(l.notes || ""),
    },
    {
      id: "partner", title: "Asked for a partner", product: null,
      why: "They said they want to work with a partner, and they are not in a sequence.",
      test: (l, f) => untouched(f) && f.verdict !== "bad" && PARTNER_RE.test(l.notes || ""),
    },
    {
      id: "visited", title: "Visited wiredcio.com", product: null,
      why: "Their company visited the site, and nobody has worked them yet.",
      test: (l, f) => untouched(f) && f.verdict !== "bad" && !!l.webVisits?.visited,
    },
    {
      id: "recycle", title: "Recycle-ready", product: null, recycle: true,
      why: "Worked, never answered, and rested long enough under the recycle rules. A fresh sequence is the next step.",
      test: () => true,
    },
  ];
  for (const p of ["dynamics", "m365"] as const) {
    list.push(
      {
        id: `fresh-${p}`, title: `Fresh ${PRODUCT_LABEL[p]}`, product: p,
        why: `Strong Signal ${PRODUCT_LABEL[p]} leads received in the last ${FRESH_DAYS} days that nobody has contacted.`,
        test: (_l, f, today) => strong(f) && f.product === p && untouched(f) && f.arrivalDate >= daysAgo(FRESH_DAYS, today),
      },
      {
        id: `backlog-${p}`, title: `${PRODUCT_LABEL[p]} backlog`, product: p,
        why: `Strong Signal ${PRODUCT_LABEL[p]} leads older than ${FRESH_DAYS} days that were never contacted at all.`,
        test: (_l, f, today) => strong(f) && f.product === p && untouched(f) && f.arrivalDate < daysAgo(FRESH_DAYS, today),
      },
      {
        id: `reengage-${p}`, title: `Re-engage ${PRODUCT_LABEL[p]}`, product: p,
        why: `Strong Signal ${PRODUCT_LABEL[p]} leads worked before, with nothing on record for ${STALE_DAYS}+ days.`,
        test: (_l, f, today) => strong(f) && f.product === p && (f.touched || f.sequenced) && !!f.lastTouch && f.lastTouch <= daysAgo(STALE_DAYS, today),
      },
    );
  }
  return list;
}

const RANK = { strong: 0, review: 1, bad: 2 } as const;

function best(a: StoredLead, b: StoredLead, facts: Map<string, RuleFacts>): number {
  const fa = facts.get(a.key)!, fb = facts.get(b.key)!;
  return RANK[fa.verdict] - RANK[fb.verdict] || (b.score ?? -1) - (a.score ?? -1) || fb.arrivalDate.localeCompare(fa.arrivalDate);
}

/** Every suggestion with at least REFRESH_MIN matches, hot ones first, plus
 *  one per enriched industry that holds enough never-contacted Strong
 *  Signal leads. Dismissed ids are left out. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A Strong Signal lead that is fresh (never worked) or went nowhere
 *  (worked, never answered, rested under the recycle rules). The pool the
 *  company and industry lists are cut from. */
function freshOrNowhere(l: StoredLead, f: RuleFacts, ctx: RefreshContext): boolean {
  if (!strong(f)) return false;
  if (ctx.recycleReady(l)) return true;
  return !f.closedOut && untouched(f);
}

function groupGenerators(ctx: RefreshContext, by: "company" | "industry"): Generator[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const l of ctx.leads) {
    const f = ctx.facts.get(l.key);
    if (!f || blocked(f) || !freshOrNowhere(l, f, ctx)) continue;
    const label = by === "company" ? (l.company || "").trim() : f.industry;
    if (!label) continue;
    const k = label.toLowerCase();
    const c = counts.get(k);
    if (c) c.n++; else counts.set(k, { label, n: 1 });
  }
  const min = by === "company" ? COMPANY_MIN : REFRESH_MIN;
  let groups = [...counts.values()].filter((c) => c.n >= min).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  if (by === "company") groups = groups.slice(0, COMPANY_LISTS);
  return groups.map(({ label }) => {
    const k = label.toLowerCase();
    return {
      id: `${by}-${slug(label)}`, title: label, product: null, min,
      why: by === "company"
        ? `Strong Signal people at ${label} who are fresh or went nowhere: one account, several ways in.`
        : `Strong Signal leads at ${label} companies, fresh or went nowhere (from enriched company data).`,
      test: (l: StoredLead, f: RuleFacts) => (by === "company" ? (l.company || "").trim().toLowerCase() === k : f.industry.toLowerCase() === k),
      pool: true,
    };
  });
}

/** How many Strong Signal leads in scope have no industry yet: an industry
 *  list can only come from enriched company data, so these need enriching. */
export function strongWithoutIndustry(ctx: RefreshContext): number {
  let n = 0;
  for (const l of ctx.leads) {
    const f = ctx.facts.get(l.key);
    if (f && !blocked(f) && !f.industry && freshOrNowhere(l, f, ctx)) n++;
  }
  return n;
}

export function buildSuggestions(ctx: RefreshContext, dismissed: Set<string> = new Set(), groupBy: GroupBy = "product"): RefreshSuggestion[] {
  const today = ctx.today ?? new Date();
  const gens = groupBy === "product" ? generators() : groupGenerators(ctx, groupBy);

  const out: RefreshSuggestion[] = [];
  for (const g of gens) {
    if (dismissed.has(g.id)) continue;
    const ready: StoredLead[] = [];
    const unchecked: StoredLead[] = [];
    let flagged = 0;
    for (const l of ctx.leads) {
      const f = ctx.facts.get(l.key);
      if (!f || blocked(f) || ctx.onLiveCampaign(l)) continue;
      if (g.pool ? !(freshOrNowhere(l, f, ctx) && g.test(l, f, today))
        : g.recycle ? !ctx.recycleReady(l)
        : (f.closedOut || !g.test(l, f, today))) continue;
      const e = ctx.email(l);
      if (e === "ready") ready.push(l);
      else if (e === "unchecked") unchecked.push(l);
      else flagged++;
    }
    if (ready.length + unchecked.length + flagged < (g.min ?? REFRESH_MIN)) continue;
    ready.sort((a, b) => best(a, b, ctx.facts));
    unchecked.sort((a, b) => best(a, b, ctx.facts));
    out.push({ id: g.id, title: g.title, why: g.why, product: g.product, ready: ready.slice(0, REFRESH_CAP), readyTotal: ready.length, unchecked, flagged });
  }
  return out;
}

/* ---- draft from keywords ----
 * Per Jack: "i want to enter keywords basiclly and then have it auto draft a
 * list off those keyword industry words or title even", "this is going to
 * help ensure all leads are being hit". Commas separate alternatives (any
 * one matches); within one part the All leads keyword syntax applies (words
 * all present, "an exact phrase", -leave out). Same eligibility, cap and
 * email rule as every other suggestion. */
export type DraftField = "all" | "title" | "industry" | "company" | "note";
export const DRAFT_FIELD_LABEL: Record<DraftField, string> = { all: "Anywhere", title: "Title", industry: "Industry", company: "Company", note: "Note" };

export function draftMatcher(text: string): ((hay: string) => boolean) | null {
  const parts = text.split(",").map((p) => parseKeywords(p)).filter((k) => !k.empty);
  if (!parts.length) return null;
  return (hay) => parts.some((k) => matchesKeywords(hay, k));
}

/** The text a draft searches, lower-cased. The note is the scanned note;
 *  the raw CSV note stays behind its own lock. */
export function draftHaystack(l: StoredLead, f: RuleFacts, field: DraftField): string {
  const parts = field === "title" ? [l.title] : field === "industry" ? [f.industry] : field === "company" ? [l.company]
    : field === "note" ? [l.notes] : [l.title, f.industry, l.company, l.notes, l.productArea];
  return parts.filter(Boolean).join(" \n ").toLowerCase();
}

export function draftFromKeywords(ctx: RefreshContext, text: string, field: DraftField = "all", strongOnly = true): RefreshSuggestion | null {
  const match = draftMatcher(text);
  if (!match) return null;
  const today = ctx.today ?? new Date();
  const label = text.trim().replace(/\s+/g, " ");
  const g: Generator = {
    id: `keywords-${slug(`${field}-${label}`)}`, title: `"${label}"${field === "all" ? "" : ` in ${DRAFT_FIELD_LABEL[field].toLowerCase()}`}`, product: null,
    why: `${strongOnly ? "Strong Signal" : "Strong Signal and Needs Review"} leads whose ${field === "all" ? "title, industry, company or note" : DRAFT_FIELD_LABEL[field].toLowerCase()} matches, fresh or went nowhere.`,
    test: (l, f) => (strongOnly ? strong(f) : f.verdict !== "bad") && match(draftHaystack(l, f, field)),
  };
  const ready: StoredLead[] = [];
  const unchecked: StoredLead[] = [];
  let flagged = 0;
  for (const l of ctx.leads) {
    const f = ctx.facts.get(l.key);
    if (!f || blocked(f) || ctx.onLiveCampaign(l) || !g.test(l, f, today)) continue;
    if (!ctx.recycleReady(l) && (f.closedOut || !untouched(f))) continue;
    const e = ctx.email(l);
    if (e === "ready") ready.push(l); else if (e === "unchecked") unchecked.push(l); else flagged++;
  }
  ready.sort((a, b) => best(a, b, ctx.facts));
  unchecked.sort((a, b) => best(a, b, ctx.facts));
  return { id: g.id, title: g.title, why: g.why, product: null, ready: ready.slice(0, REFRESH_CAP), readyTotal: ready.length, unchecked, flagged };
}

/** The sequence a list most likely goes to, from the names Jack uses. He
 *  confirms or changes it when accepting. */
export function defaultSequenceFor(s: Pick<RefreshSuggestion, "id" | "product">, sequences: string[], lastPicked?: string): string {
  if (lastPicked && sequences.includes(lastPicked)) return lastPicked;
  const find = (re: RegExp) => sequences.find((n) => re.test(n));
  if (s.id === "recycle") return find(/recycled|backup/i) ?? find(/jack main/i) ?? sequences[0] ?? "";
  if (s.product === "dynamics") return find(/dynamics/i) ?? find(/jack main sequence/i) ?? sequences[0] ?? "";
  return find(/jack main sequence/i) ?? sequences[0] ?? "";
}

/** Is this lead in the named sequence, per a live check, a sync, or the
 *  pulled Apollo uploads? Any status counts: they were added. */
export function inSequence(l: StoredLead, sequence: string, index: RosterIndex | null): boolean {
  const want = sequence.trim().toLowerCase();
  if (!want) return false;
  if ((l.apollo?.sequences ?? []).some((s) => s.name.trim().toLowerCase() === want)) return true;
  const hit = apolloHitFor({ email: l.email, contact: l.contact, company: l.company }, index);
  return !!hit && hit.sequences.some((n) => n.trim().toLowerCase() === want);
}

export type HandoffStage = "downloaded" | "partly" | "in-sequence";
export const HANDOFF_META: Record<HandoffStage, { label: string; color: string; bg: string; hint: string }> = {
  downloaded: { label: "Downloaded", color: "#0A66C2", bg: "#EAF3FC", hint: "The CSV was handed over. No Apollo check has seen these leads in the sequence yet." },
  partly: { label: "Partly in sequence", color: "#9A5B22", bg: "#FBF0E2", hint: "Some leads now show in the sequence. Check the rest in Apollo." },
  "in-sequence": { label: "In sequence", color: "#3B6E22", bg: "#E8F3E1", hint: "Every lead an Apollo check can find shows in the sequence." },
};
export function handoffStage(confirmed: number, total: number): HandoffStage {
  if (!confirmed) return "downloaded";
  return confirmed >= total ? "in-sequence" : "partly";
}

/* ---- dismissals: a per-browser preference, never data ---- */
const DISMISS_KEY = "refresherDismissed";
export function loadDismissed(now = Date.now()): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}") as Record<string, number>;
    return new Set(Object.entries(v).filter(([, until]) => until > now).map(([k]) => k));
  } catch { return new Set(); }
}
export function dismissSuggestion(id: string, now = Date.now()): void {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}") as Record<string, number>;
    v[id] = now + DISMISS_DAYS * 86_400_000;
    localStorage.setItem(DISMISS_KEY, JSON.stringify(v));
  } catch { /* preference only */ }
}
export function clearDismissed(): void { try { localStorage.removeItem(DISMISS_KEY); } catch { /* preference only */ } }
