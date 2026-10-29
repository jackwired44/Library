// Smart rules: one saved description of "which leads", used three ways.
//
// Per Jack: "pull up and create a list of all uncontacted leads around
// dynamics for the last 30 days", "automatically generate strong signal
// based leads that havent been contacted in x amount of days so i can throw
// them in email sequences", and "they will be stored as a list and option
// to download as csv just like from main scanner".
//
//   - The lead chat in All leads turns Jack's words into a SmartRule (Claude
//     reads it when the page can ask Claude; the phrase parser below when
//     it cannot) and shows the rule as chips before anything happens.
//   - All leads filters by it (one more filter, test key "rule").
//   - A smart list is a LeadList that carries a rule and is re-run against
//     the current leads, so it refreshes as uploads and Apollo checks land.
//
// Every field is optional; an empty rule matches everything. Nothing here
// reads or writes Apollo: it only reads what the platform already holds.

import type { LeadSource, StoredLead } from "./leadStore";
import { verdictOf, wasReached, contactStateOf, statusOf, VERDICT_META, type Verdict } from "./leadStatus";
import { arrivalOf, localDay, viewMonthKey } from "./leadFiling";
import { matchesKeywords, parseKeywords } from "./keywords";
import { ownersOf } from "./reps";
import { apolloHitFor, type ApolloHit, type RosterIndex } from "./apolloRoster";
import { employeeCountOf, normalizeCompanyKey, profileForCompany, type CompanyProfile } from "./companyProfiles";
import { engagementOf } from "./engagements";

export type ProductKey = "dynamics" | "m365" | "none";
export const PRODUCT_LABEL: Record<ProductKey, string> = {
  dynamics: "Dynamics 365",
  m365: "M365 / Azure",
  none: "No product line",
};

export interface SmartRule {
  product?: ProductKey[];
  grades?: Verdict[];
  /** "never": no call, email or sequence on record, ever.
   *  "stale": not active in a sequence and nothing on record for staleDays. */
  contact?: "never" | "stale";
  staleDays?: number;
  /** The CSV's own date (else upload date) is within the last N days. */
  arrivedWithinDays?: number;
  /** A month ("2026-09") or a quarter ("2026-Q3") of arrival. */
  period?: { kind: "month" | "quarter"; key: string };
  scanners?: LeadSource[];
  industries?: string[];
  excludeIndustries?: string[];
  minEmployees?: number;
  maxEmployees?: number;
  reps?: string[];
  excludeActive?: boolean;
  /** Keywords over the scanned note, company and title (same syntax as the
   *  "Keywords in notes" box: word, "phrase", -word, a OR b). */
  keywords?: string;
  partnerAsk?: boolean;
  visited?: boolean;
}

/** What a rule reads about one lead, resolved once. */
export interface RuleFacts {
  verdict: Verdict;
  product: ProductKey;
  /** YYYY-MM-DD and YYYY-MM (an estimated Sheet month keeps no "~" here). */
  arrivalDate: string;
  arrivalMonth: string;
  industry: string;
  employees: number | null;
  owners: string[];
  active: boolean;
  /** Ever in a sequence, by live check, sync or the pulled Apollo uploads. */
  sequenced: boolean;
  /** Any call, email or real conversation on record. */
  touched: boolean;
  /** Newest dated outreach of any kind, "" when none is dated. */
  lastTouch: string;
  /** Meeting booked, or do not contact / not interested on record. */
  closedOut: boolean;
  /** A deal or meeting on file: account manager only. */
  engaged: boolean;
  /** A successful conversation on record: info requested, pending review,
   *  replied, talked, call back, meeting booked — from call outcomes, Apollo's
   *  own end-of-sequence reason (live check or pulled uploads), or a status
   *  set by hand. Optional so a facts object built before this reads false. */
  reached?: boolean;
}

export const productOf = (line: string): ProductKey =>
  /dynamics|d365|business central/i.test(line) ? "dynamics"
    : /m365|azure|microsoft 365|office 365|o365|licens/i.test(line) ? "m365"
    : "none";

export const quarterOf = (month: string): string => {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  return m ? `${m[1]}-Q${Math.floor((Number(m[2]) - 1) / 3) + 1}` : "";
};
export const quarterLabel = (q: string) => {
  const m = /^(\d{4})-Q([1-4])$/.exec(q);
  return m ? `Q${m[2]} ${m[1]}` : q;
};

const PARTNER_NOTE_RE = /\bwants?\s+(?:to\s+work\s+with\s+)?a?\s*partner\b|⚑\s*wants\s+partner/i;
const MEETING_RE = /meeting/i;
const CLOSED_RE = /do\s*not\s*contact|not\s*interested|opted?\s*out|unsubscribe/i;
/** A sequence ended on a real conversation (same reading as lib/leadStatus.ts). */
const TALKED_RE = /meeting\s*booked|replied|talked|spoke|conversation|info(?:rmation)?\s*requested|pending\s*review|call\s*back/i;
const NOT_REACHED_RE = /no\s*answer|voicemail|wrong\s*number|gatekeeper|not\s*interested/i;

const maxIso = (a: string, b: string | undefined) => (b && b > a ? b : a);

/** Build the facts for one lead. `hit` is the pulled-uploads match, if any. */
export function factsForLead(
  l: StoredLead,
  extra: { industry: string; employees: number | null; hit: ApolloHit | null; engaged: boolean },
): RuleFacts {
  const a = l.apollo;
  const seqs = a?.sequences ?? [];
  const hitStates = extra.hit?.seqStates ?? [];
  let last = "";
  last = maxIso(last, a?.lastCallAt);
  last = maxIso(last, a?.live?.lastActivityAt);
  for (const s of [...seqs, ...hitStates]) {
    last = maxIso(last, s.addedAt); last = maxIso(last, s.lastDoneAt); last = maxIso(last, s.finishedAt);
  }
  for (const t of a?.tasks ?? []) if (t.status === "completed") last = maxIso(last, t.at);
  last = maxIso(last, extra.hit?.uploadedAt);
  const state = contactStateOf(l);
  const reasons = seqs.map((s) => s.reason || "").join(" ");
  const arr = arrivalOf(l);
  const active = seqs.some((s) => s.status === "active") || hitStates.some((s) => s.status === "active");
  return {
    verdict: verdictOf(l.tier),
    product: productOf(l.productArea || ""),
    arrivalDate: arr.date,
    arrivalMonth: viewMonthKey(arr.month),
    industry: extra.industry,
    employees: extra.employees,
    owners: ownersOf([...seqs.map((s) => s.name), ...(extra.hit?.sequences ?? [])], a?.live?.owner),
    active,
    sequenced: seqs.length > 0 || (extra.hit?.sequences.length ?? 0) > 0,
    touched: (a?.callCount ?? 0) > 0 || (a?.emailCount ?? 0) > 0 || wasReached(a) || state === "meeting" || state === "no",
    lastTouch: localDay(last),
    closedOut: state === "meeting" || state === "no" || MEETING_RE.test(reasons) || CLOSED_RE.test(reasons),
    engaged: extra.engaged,
    reached: wasReached(a) || ["meeting", "reached"].includes(statusOf(l))
      || [...seqs, ...hitStates].some((s) => !!s.reason && TALKED_RE.test(s.reason) && !NOT_REACHED_RE.test(s.reason)),
  };
}

/** Facts for every lead, company data looked up once per company. */
export function buildFactsMap(leads: StoredLead[], profiles: CompanyProfile[], index: RosterIndex | null): Map<string, RuleFacts> {
  const byCompany = new Map<string, { industry: string; employees: number | null }>();
  const out = new Map<string, RuleFacts>();
  for (const l of leads) {
    const ck = normalizeCompanyKey(l.company);
    let c = byCompany.get(ck);
    if (!c) {
      const p = profiles.length ? profileForCompany(profiles, ck, [l.email]) : null;
      c = { industry: (p?.industry || "").trim(), employees: employeeCountOf(p) };
      byCompany.set(ck, c);
    }
    out.set(l.key, factsForLead(l, {
      industry: c.industry, employees: c.employees,
      hit: apolloHitFor({ email: l.email, contact: l.contact, company: l.company }, index),
      engaged: !!engagementOf(l),
    }));
  }
  return out;
}

/** Every lead the rule matches, best first: Strong Signal, then score, then newest. */
export function leadsForRule(rule: SmartRule, leads: StoredLead[], facts: Map<string, RuleFacts>, today = new Date(), rawNotes?: Map<string, string> | null): StoredLead[] {
  const rank: Record<Verdict, number> = { strong: 0, review: 1, bad: 2 };
  return leads
    .filter((l) => { const f = facts.get(l.key); return !!f && ruleMatches(rule, l, f, today, rawNotes?.get(l.key) ?? ""); })
    .sort((a, b) => {
      const fa = facts.get(a.key)!, fb = facts.get(b.key)!;
      return rank[fa.verdict] - rank[fb.verdict] || (b.score ?? -1) - (a.score ?? -1) || fb.arrivalDate.localeCompare(fa.arrivalDate);
    });
}

function daysAgo(n: number, today: Date): string {
  const d = new Date(today.getTime());
  d.setDate(d.getDate() - n);
  return localDay(d.toISOString());
}

/** Does this lead match the rule? `hay` is lowercased note + company + title. */
export function ruleMatches(rule: SmartRule, l: StoredLead, f: RuleFacts, today = new Date(), rawNote = ""): boolean {
  if (rule.grades?.length && !rule.grades.includes(f.verdict)) return false;
  if (rule.product?.length && !rule.product.includes(f.product)) return false;
  if (rule.scanners?.length && !rule.scanners.includes(l.source)) return false;
  if (rule.arrivedWithinDays && rule.arrivedWithinDays > 0 && f.arrivalDate < daysAgo(rule.arrivedWithinDays, today)) return false;
  if (rule.period) {
    if (rule.period.kind === "month" ? f.arrivalMonth !== rule.period.key : quarterOf(f.arrivalMonth) !== rule.period.key) return false;
  }
  if (rule.industries?.length && !rule.industries.some((i) => i.toLowerCase() === f.industry.toLowerCase())) return false;
  if (rule.excludeIndustries?.length && f.industry && rule.excludeIndustries.some((i) => i.toLowerCase() === f.industry.toLowerCase())) return false;
  // A size filter only passes a company whose size is known; never guessed.
  if (rule.minEmployees != null && (f.employees == null || f.employees < rule.minEmployees)) return false;
  if (rule.maxEmployees != null && (f.employees == null || f.employees > rule.maxEmployees)) return false;
  if (rule.reps?.length && !rule.reps.some((r) => f.owners.includes(r))) return false;
  if (rule.excludeActive && f.active) return false;
  if (rule.partnerAsk && !PARTNER_NOTE_RE.test(l.notes || "")) return false;
  if (rule.visited && !l.webVisits?.visited) return false;
  if (rule.contact === "never") {
    // Uncontacted: nothing on record, ever, and nobody else owns the account.
    if (f.touched || f.sequenced || f.engaged) return false;
  } else if (rule.contact === "stale") {
    // Not worked for N days. A lead someone is working now, a booked or
    // closed-out lead, and an account-manager account never come back here.
    if (f.active || f.closedOut || f.engaged) return false;
    const n = rule.staleDays && rule.staleDays > 0 ? rule.staleDays : 30;
    if (f.lastTouch) { if (f.lastTouch > daysAgo(n, today)) return false; }
    // Touched but with no date on record: cannot prove it has been N days.
    else if (f.touched || f.sequenced) return false;
  }
  if (rule.keywords?.trim()) {
    const kq = parseKeywords(rule.keywords);
    // The original note is searched too (it is only ever filtered on, never
    // shown here); a lead's scanned note is one line and misses most words.
    if (!kq.empty && !matchesKeywords(`${l.company} \u0001${l.title} \u0001${l.notes || ""} \u0001${rawNote}`.toLowerCase(), kq)) return false;
  }
  return true;
}

export const isEmptyRule = (r: SmartRule) => describeRule(r).length === 0;

/** The rule as plain chips, in the order Jack reads a request. */
export function describeRule(r: SmartRule): string[] {
  return ruleParts(r).map((p) => p.label);
}

/** Each chip with the rule fields it stands for, so a chip can be removed. */
export function ruleParts(r: SmartRule): { label: string; keys: (keyof SmartRule)[] }[] {
  const out: { label: string; keys: (keyof SmartRule)[] }[] = [];
  const add = (label: string, ...keys: (keyof SmartRule)[]) => out.push({ label, keys });
  if (r.grades?.length) add(r.grades.map((g) => VERDICT_META[g].label).join(" or "), "grades");
  if (r.product?.length) add(r.product.map((p) => PRODUCT_LABEL[p]).join(" or "), "product");
  if (r.contact === "never") add("Never contacted", "contact", "staleDays");
  if (r.contact === "stale") add(`Not contacted in ${r.staleDays && r.staleDays > 0 ? r.staleDays : 30} days`, "contact", "staleDays");
  if (r.arrivedWithinDays) add(`Received in the last ${r.arrivedWithinDays} days`, "arrivedWithinDays");
  if (r.period) add(r.period.kind === "month" ? `Received ${monthName(r.period.key)}` : `Received ${quarterLabel(r.period.key)}`, "period");
  if (r.scanners?.length) add(r.scanners.map((s) => ({ main: "Main Scanner", smc: "Custom Scanner", csp: "CSP Scanner" })[s]).join(" or "), "scanners");
  if (r.industries?.length) add(`Industry: ${r.industries.join(" or ")}`, "industries");
  if (r.excludeIndustries?.length) add(`Not ${r.excludeIndustries.join(", ")}`, "excludeIndustries");
  if (r.minEmployees != null && r.maxEmployees != null) add(`${r.minEmployees.toLocaleString()}–${r.maxEmployees.toLocaleString()} employees`, "minEmployees", "maxEmployees");
  else if (r.minEmployees != null) add(`${r.minEmployees.toLocaleString()}+ employees`, "minEmployees");
  else if (r.maxEmployees != null) add(`Up to ${r.maxEmployees.toLocaleString()} employees`, "maxEmployees");
  if (r.reps?.length) add(`${r.reps.join(" or ")}'s sequences`, "reps");
  if (r.excludeActive) add("Not active in a sequence", "excludeActive");
  if (r.partnerAsk) add("Wants a partner", "partnerAsk");
  if (r.visited) add("Visited wiredcio.com", "visited");
  if (r.keywords?.trim()) {
    let rest = r.keywords.trim();
    const named: string[] = [];
    for (const x of RULE_TOPICS) if (rest.includes(x.terms)) { named.push(x.label); rest = rest.replace(x.terms, " "); }
    rest = rest.replace(/\s+/g, " ").trim();
    add(`Notes: ${[...named.map((n) => `about ${n}`), ...(rest ? [rest] : [])].join(" + ")}`, "keywords");
  }
  return out;
}

export function withoutKeys(r: SmartRule, keys: (keyof SmartRule)[]): SmartRule {
  const next = { ...r };
  for (const k of keys) delete next[k];
  return next;
}

function monthName(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return new Date(Number(m[1]), Number(m[2]) - 1, 15).toLocaleString("en-US", { month: "long", year: "numeric" });
}

/* ------------------------------------------------------- reading a request */

export interface RuleContext {
  industries: string[];
  today?: Date;
}

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Built-in reading of a request, used when the page cannot ask Claude.
 * Covers the words Jack uses; anything it does not recognise is simply not
 * in the rule, and the chips show exactly what was understood.
 */
export function parseRuleText(text: string, ctx: RuleContext): SmartRule {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'")} `;
  const today = ctx.today ?? new Date();
  const r: SmartRule = {};

  const product: ProductKey[] = [];
  if (/\b(dynamics|d365|business central|bc|crm|erp|f&o)\b/.test(t)) product.push("dynamics");
  if (/\b(m365|microsoft 365|office 365|o365|azure|licens\w*|copilot|tenant)\b/.test(t)) product.push("m365");
  if (product.length) r.product = product;

  const grades: Verdict[] = [];
  if (/\bstrong\b|high priority|hot\b/.test(t)) grades.push("strong");
  if (/needs? review|\breview\b|medium/.test(t)) grades.push("review");
  if (/\bbad\b/.test(t)) grades.push("bad");
  if (grades.length) r.grades = grades;

  const unit = (n: number, u: string) => (u.startsWith("week") ? n * 7 : u.startsWith("month") ? n * 30 : n);
  const stale = /(?:not|n'?t|never)\s+(?:been\s+)?(?:contacted|touched|called|reached|worked)\s+(?:in|for|within)\s+(?:the\s+)?(?:last\s+|past\s+)?(\d+)\s*(day|week|month)s?/.exec(t)
    || /no\s+(?:contact|touch|outreach)\s+(?:in|for)\s+(?:the\s+)?(?:last\s+|past\s+)?(\d+)\s*(day|week|month)s?/.exec(t);
  let consumed = "";
  if (stale) {
    r.contact = "stale";
    r.staleDays = unit(Number(stale[1]), stale[2]);
    consumed = stale[0];
  } else if (/uncontacted|un-contacted|never (?:been )?(?:contacted|touched|called|reached|worked)|not (?:been )?(?:contacted|touched|called|worked)|untouched|no outreach|fresh leads?/.test(t)) {
    r.contact = "never";
  }

  const rest = consumed ? t.replace(consumed, " ") : t;
  const window = /(?:last|past|previous)\s+(\d+)\s*(day|week|month)s?/.exec(rest);
  if (window) r.arrivedWithinDays = unit(Number(window[1]), window[2]);
  else if (/(?:last|past) (?:30 days|month)\b/.test(rest) && !/last month\b/.test(rest)) r.arrivedWithinDays = 30;
  else if (/\bthis month\b/.test(rest)) r.period = { kind: "month", key: ymOf(today) };
  else if (/\blast month\b/.test(rest)) r.period = { kind: "month", key: ymOf(new Date(today.getFullYear(), today.getMonth() - 1, 15)) };
  else if (/\bthis quarter\b/.test(rest)) r.period = { kind: "quarter", key: quarterOf(ymOf(today)) };
  else if (/\blast quarter\b/.test(rest)) r.period = { kind: "quarter", key: quarterOf(ymOf(new Date(today.getFullYear(), today.getMonth() - 3, 15))) };
  else {
    const q = /\bq([1-4])\s*(?:of\s*)?(20\d\d)?\b/.exec(rest);
    if (q) r.period = { kind: "quarter", key: `${q[2] || today.getFullYear()}-Q${q[1]}` };
    else {
      const mm = new RegExp(`\\b(${MONTHS.join("|")})\\s*(20\\d\\d)?\\b`).exec(rest);
      if (mm) {
        const mi = MONTHS.indexOf(mm[1]);
        let y = mm[2] ? Number(mm[2]) : today.getFullYear();
        if (!mm[2] && mi > today.getMonth()) y -= 1; // "september" said in October means this year's
        r.period = { kind: "month", key: `${y}-${String(mi + 1).padStart(2, "0")}` };
      }
    }
  }

  const scanners: LeadSource[] = [];
  if (/\bcsp\b|renewal/.test(t)) scanners.push("csp");
  if (/\bcustom\b|\bsmc\b|september leads/.test(t)) scanners.push("smc");
  if (/main scanner/.test(t)) scanners.push("main");
  if (scanners.length) r.scanners = scanners;

  const reps = ["Carly", "Jack"].filter((n) => new RegExp(`\\b${n.toLowerCase()}('s)?\\b`).test(t));
  if (reps.length) r.reps = reps;

  if (/not (?:active )?in (?:a|any) sequence|not active|no active sequence|not being worked/.test(t)) r.excludeActive = true;
  if (/wants? (?:a |to work with a )?partner|partner ask|looking for a partner/.test(t)) r.partnerAsk = true;
  if (/visited|website visit/.test(t)) r.visited = true;

  const between = /(\d[\d,]*)\s*(?:-|to|and)\s*(\d[\d,]*)\s*(?:employees|people|staff|emp)/.exec(t);
  const over = /(?:over|more than|at least|above|\bmin(?:imum)?)\s*(\d[\d,]*)\s*(?:employees|people|staff|emp)|(\d[\d,]*)\+\s*(?:employees|people|staff|emp)/.exec(t);
  const under = /(?:under|less than|fewer than|below|up to|at most)\s*(\d[\d,]*)\s*(?:employees|people|staff|emp)/.exec(t);
  const num = (s: string) => Number(s.replace(/,/g, ""));
  if (between) { r.minEmployees = num(between[1]); r.maxEmployees = num(between[2]); }
  else {
    if (over) r.minEmployees = num(over[1] || over[2]);
    if (under) r.maxEmployees = num(under[1]);
  }

  const inds: string[] = [];
  const excl: string[] = [];
  for (const ind of ctx.industries) {
    const w = ind.toLowerCase().trim();
    if (w.length < 4 || !t.includes(w)) continue;
    const before = t.slice(0, t.indexOf(w));
    (/(?:not|no|exclude|excluding|except|without)\s+(?:in\s+)?(?:the\s+)?$/.test(before.slice(-24)) ? excl : inds).push(ind);
  }
  if (inds.length) r.industries = inds;
  if (excl.length) r.excludeIndustries = excl;

  const quoted = [...text.matchAll(/"([^"]+)"/g)].map((m) => `"${m[1]}"`);
  const about = /(?:mention(?:ing|s)?|about|notes? (?:say|with|containing))\s+([a-z][\w\s-]{2,40}?)(?:\s+(?:in|for|from|over|that|who|and)\b|[,.]|$)/.exec(t);
  const kw = [...quoted];
  // Topics: plain words for something the notes say many ways. Per Jack:
  // "leads that indicate ongoing support" read as nothing at all.
  const topics = RULE_TOPICS.filter((x) => x.when.test(t));
  for (const x of topics) kw.push(x.terms);
  if (!topics.length && about && !/dynamics|m365|azure|licens|partner/.test(about[1])) kw.push(about[1].trim());
  // Nothing recognised at all: the request's own words become the search,
  // rather than "nothing to filter on".
  if (!kw.length && isEmptyRule(r)) {
    const words = text.toLowerCase().replace(/[^a-z0-9&+\s-]/g, " ").split(/\s+/)
      .filter((w) => w.length >= 3 && !RULE_STOPWORDS.has(w));
    if (words.length) kw.push(...words.slice(0, 6));
  }
  if (kw.length) r.keywords = kw.join(" ");
  return r;
}

/** What a few common asks mean in a note, as keyword OR-groups. */
export const RULE_TOPICS: { label: string; when: RegExp; terms: string }[] = [
  { label: "ongoing support", when: /\b(ongoing support|ongoing it|managed\s+(?:it|services?)|msps?|it support|help\s?desk|co-?managed|outsourc\w*|support partner)\b/,
    terms: '"ongoing support" OR "managed service" OR msp OR "co-managed" OR "it support" OR "help desk" OR helpdesk OR "support partner" OR outsourc OR "managed it" OR "full engagement" OR "partner engagement"' },
  { label: "security", when: /\b(security|secure|intune|defender|entra|purview|mfa|compliance|conditional access)\b/,
    terms: 'security OR intune OR defender OR entra OR purview OR "conditional access" OR mfa OR compliance' },
  { label: "migration", when: /\b(migrat\w*|lift and shift|on-?prem\w*|move to (?:the )?cloud)\b/,
    terms: 'migrat OR "lift and shift" OR on-prem OR "on prem"' },
  { label: "Google", when: /\b(google|gmail|g suite|gsuite|workspace)\b/,
    terms: 'google OR gmail OR "g suite" OR gsuite' },
  { label: "Copilot", when: /\bcopilot\b/, terms: "copilot" },
  { label: "reporting", when: /\b(power bi|reporting|dashboards?|fabric|analytics)\b/,
    terms: '"power bi" OR fabric OR reporting OR dashboard OR analytics' },
  { label: "app builds", when: /\b(document intelligence|app build|custom app|power apps|automation)\b/,
    terms: '"document intelligence" OR "app build" OR "custom app" OR "power apps" OR automat' },
];
const RULE_STOPWORDS = new Set(("leads lead that which who whom whose indicate indicates indicating show shows find me all any the and for with from about mention mentions mentioning notes note "
  + "companies company people contacts contact give list pull get please some there their they them want wants wanted need needs looking are is was were have has had been "
  + "this these those into onto over under than then also just only more most can could would should will our your you its it's not "
  + "hello hey thanks thank what how why when where").split(" "));

/** Accept only what a SmartRule can hold; drop everything else. */
export function ruleFromJson(v: unknown, ctx: RuleContext): SmartRule | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const r: SmartRule = {};
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : []);
  const pos = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.round(x) : undefined);
  const prod = strs(o.product).filter((p): p is ProductKey => p === "dynamics" || p === "m365" || p === "none");
  if (prod.length) r.product = prod;
  const g = strs(o.grades).filter((x): x is Verdict => x === "strong" || x === "review" || x === "bad");
  if (g.length) r.grades = g;
  if (o.contact === "never" || o.contact === "stale") r.contact = o.contact;
  if (r.contact === "stale") r.staleDays = pos(o.staleDays) ?? 30;
  const within = pos(o.arrivedWithinDays);
  if (within) r.arrivedWithinDays = within;
  const p = o.period as Record<string, unknown> | undefined;
  if (p && typeof p === "object" && typeof p.key === "string") {
    if (p.kind === "month" && /^\d{4}-\d{2}$/.test(p.key)) r.period = { kind: "month", key: p.key };
    if (p.kind === "quarter" && /^\d{4}-Q[1-4]$/.test(p.key)) r.period = { kind: "quarter", key: p.key };
  }
  const sc = strs(o.scanners).filter((s): s is LeadSource => s === "main" || s === "smc" || s === "csp");
  if (sc.length) r.scanners = sc;
  // Industries must be ones the platform actually holds, matched by name.
  const known = new Map(ctx.industries.map((i) => [i.toLowerCase(), i]));
  const ind = strs(o.industries).map((i) => known.get(i.toLowerCase())).filter((i): i is string => !!i);
  if (ind.length) r.industries = ind;
  const ex = strs(o.excludeIndustries).map((i) => known.get(i.toLowerCase())).filter((i): i is string => !!i);
  if (ex.length) r.excludeIndustries = ex;
  const mn = pos(o.minEmployees); if (mn) r.minEmployees = mn;
  const mx = pos(o.maxEmployees); if (mx) r.maxEmployees = mx;
  const reps = strs(o.reps).map((x) => (/^carly$/i.test(x) ? "Carly" : /^jack$/i.test(x) ? "Jack" : "")).filter(Boolean);
  if (reps.length) r.reps = reps;
  if (o.excludeActive === true) r.excludeActive = true;
  if (o.partnerAsk === true) r.partnerAsk = true;
  if (o.visited === true) r.visited = true;
  if (typeof o.keywords === "string" && o.keywords.trim()) r.keywords = o.keywords.trim().slice(0, 200);
  return r;
}

/** The prompt that asks Claude to turn Jack's words into a rule. */
export function rulePrompt(request: string, ctx: RuleContext): string {
  const today = localDay((ctx.today ?? new Date()).toISOString());
  const industries = ctx.industries.slice(0, 120).join(" | ");
  return [
    "You turn a sales director's request for a lead list into a JSON filter rule.",
    `Today is ${today}. Reply with ONLY one JSON object, no prose, no code fence.`,
    "",
    "Allowed keys (omit any key the request does not ask for):",
    '- product: array of "dynamics" | "m365" | "none". Dynamics 365, Business Central, CRM, ERP are "dynamics". Microsoft 365, Office 365, Azure, licensing, Copilot are "m365".',
    '- grades: array of "strong" (Strong Signal / high priority) | "review" (Needs Review) | "bad" (Bad Lead).',
    '- contact: "never" = never contacted at all (uncontacted, untouched, fresh). "stale" = not contacted in N days; then also set staleDays.',
    "- staleDays: number.",
    '- arrivedWithinDays: number. Use for "from the last 30 days", "received this week", "new leads in the past 2 months" (60).',
    '- period: {"kind":"month","key":"YYYY-MM"} or {"kind":"quarter","key":"YYYY-Q1".."YYYY-Q4"} for a named month or quarter.',
    '- scanners: array of "main" | "smc" (Custom / September leads) | "csp" (CSP renewals).',
    "- industries / excludeIndustries: arrays, ONLY exact names from this list: " + (industries || "(none on file)"),
    "- minEmployees / maxEmployees: numbers.",
    '- reps: array of "Carly" | "Jack" (whose sequences).',
    "- excludeActive: true to leave out leads active in a sequence now.",
    "- partnerAsk: true for leads that said they want a partner.",
    "- visited: true for companies that visited wiredcio.com.",
    '- keywords: a short string searched in the notes. Syntax: word, "exact phrase", -exclude, a OR b.',
    "",
    'Example: "all uncontacted leads around dynamics for the last 30 days" -> {"product":["dynamics"],"contact":"never","arrivedWithinDays":30}',
    'Example: "strong signal leads not contacted in 45 days, no one in a sequence" -> {"grades":["strong"],"contact":"stale","staleDays":45,"excludeActive":true}',
    "",
    `Request: ${request.slice(0, 1000)}`,
  ].join("\n");
}

/** Read Claude's reply: the first JSON object in it, validated. */
export function ruleFromCompletion(text: string, ctx: RuleContext): SmartRule | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return ruleFromJson(JSON.parse(text.slice(start, end + 1)), ctx); } catch { return null; }
}
