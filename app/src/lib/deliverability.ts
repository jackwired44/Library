// Email deliverability — pre-qualifying a contact before it goes to Apollo.
//
// Per Jack: "best way to run catch all domains before adding them since
// apollo screens it", "we need to pull that in so we can more so pre
// qualify contacts", and the rule that shapes everything below: "catch all
// domains hurt but the numbers are great they have so i need a middle
// ground here".
//
// So a catch-all address is NEVER dropped. It gets its own LANE, decided by
// the verifier's score: a strong catch-all is emailed from a secondary
// domain at a capped volume, a weak or unscored one leads with the phone.
// Only a verifier-confirmed invalid address loses its email step.
//
// The platform cannot test an address itself (it runs in the browser, with
// no server to hold a verifier's API key — same reason SendGrid isn't wired
// in). It owns both ends of the hand-off instead: export the emails it has
// never seen a result for, import whatever the verifier returns. Results are
// stored PER EMAIL and kept, so an address is paid for once; a result older
// than STALE_DAYS is due again because a domain can switch catch-all on/off.
import { STORE_DELIVERABILITY, dbBulkPut, dbGetAll } from "./db";
import { getEmailDomain, isFreeEmailDomain, type ParsedFile } from "./detection";

export type Deliverability = "valid" | "catch-all" | "risky" | "invalid" | "unknown";

export interface EmailCheck {
  /** Normalised email — the key. */
  email: string;
  domain: string;
  status: Deliverability;
  /** 0–100, from the verifier, when it gives one. Null = none given. */
  score: number | null;
  /** The verifier's own words, kept verbatim for the hover. */
  raw: string;
  checkedAt: string;
  sourceFile: string;
}

/** Days before a stored result is due for a re-check. */
export const STALE_DAYS = 90;
/** Default catch-all score that earns the email lane. Adjustable in the UI. */
export const DEFAULT_CATCH_ALL_MIN = 70;

/**
 * Where a lead goes. The middle ground lives in the two catch-all lanes:
 * both stay in play, neither is allowed near the main sending domain.
 */
export type Lane = "send" | "catch-all-send" | "catch-all-call" | "personal" | "call-only" | "unverified" | "no-email";

export const LANE_META: Record<Lane, { label: string; short: string; hint: string; color: string; bg: string; green: boolean }> = {
  send: { label: "Verified — send", short: "✓ Verified", color: "#1F7A4D", bg: "#E5F4EC", green: true,
    hint: "Apollo (or the verifier) confirmed the mailbox. Normal sequence, main sending domain." },
  "catch-all-send": { label: "Catch-all, green-lit — email lane", short: "✓ Catch-all", color: "#0E7A72", bg: "#E3F3F1", green: true,
    hint: "Catch-all domain, but Apollo's verdict is allow (or the verifier scores it high). Email it from a secondary warmed domain, capped at about 10–15% of daily sends; pause the lane if bounces pass 2%." },
  "catch-all-call": { label: "Catch-all, screened — call first", short: "Catch-all ▼", color: "#9A5B22", bg: "#FBF0E2", green: false,
    hint: "Catch-all domain that Apollo screens (or a low verifier score). Kept in play: call and LinkedIn first, email only as the last step, from the secondary domain." },
  personal: { label: "Personal email — Apollo flags", short: "Personal", color: "#7A5AC8", bg: "#F1ECFB", green: false,
    hint: "A personal address (Gmail, Yahoo, Outlook…). Apollo flags these when you add to a sequence, same as catch-alls. Call or LinkedIn, or find a work address." },
  "call-only": { label: "Bad email — call only", short: "Bad email", color: "#B5443B", bg: "#FBEAE8", green: false,
    hint: "Apollo or the verifier says the mailbox does not exist, bounced, or is disposable. Drop the email step; call or find a better address." },
  unverified: { label: "Not verified yet", short: "Not verified", color: "#4C6167", bg: "#EEF1F2", green: false,
    hint: "No verdict on file. Run the Apollo check (free) — Apollo verifies every address it holds. Not in Apollo? Export it to a verifier and import the result." },
  "no-email": { label: "No email", short: "No email", color: "#8A9A9D", bg: "#F5F7F7", green: false,
    hint: "No email address on the lead. Phone or LinkedIn only." },
};
export const LANE_ORDER: Lane[] = ["send", "catch-all-send", "catch-all-call", "personal", "call-only", "unverified", "no-email"];
export const isGreenLit = (lane: Lane) => LANE_META[lane].green;

export function normEmailKey(e: unknown): string {
  return String(e ?? "").trim().toLowerCase();
}

/** What Apollo's live check said about the address (lead.apollo.live). */
export interface ApolloEmailVerdict { emailStatus?: string; catchAll?: boolean; catchAllVerdict?: string; freeDomain?: boolean }

const APOLLO_BAD_RE = /^(unavailable|bounced|invalid|undeliverable|do_not_contact|spam)/i;
const APOLLO_VERIFIED_RE = /^(verified|valid)$/i;

/**
 * The lane a lead's email sits in. Two sources, and they combine rather
 * than compete:
 *   1. Apollo's own verdict, from the free live check. This IS what Apollo
 *      screens on, so "allow" on a catch-all is a green light by definition.
 *   2. A verifier result (optional). A verifier is the tie-breaker Apollo
 *      can't be: a high score lifts a catch-all Apollo screens into the
 *      email lane; a verifier "invalid" or Apollo "unavailable" means the
 *      mailbox is bad.
 * `risky`/`unknown` from a verifier are scored on the catch-all rule —
 * unproven, so neither trusted nor thrown away.
 */
export function laneOf(email: string, check: EmailCheck | undefined, catchAllMin = DEFAULT_CATCH_ALL_MIN, apollo?: ApolloEmailVerdict): Lane {
  if (!normEmailKey(email).includes("@")) return "no-email";
  const a = apollo ?? {};
  const apolloBad = !!a.emailStatus && APOLLO_BAD_RE.test(a.emailStatus);
  const apolloAllowsCatchAll = a.catchAll === true && /^allow/i.test(a.catchAllVerdict ?? "");
  if (check?.status === "invalid" || apolloBad) return "call-only";
  // Per Jack: Apollo "flags to not add" personal-domain addresses when they
  // go into a sequence, the same as catch-alls. A verified Gmail is still a
  // Gmail, so this outranks every green light.
  if (a.freeDomain === true || isFreeEmailDomain(getEmailDomain(email) ?? "")) return "personal";
  if (check?.status === "valid") return "send";
  if (a.catchAll === true || check) {
    const scored = check && check.score !== null && check.score >= catchAllMin;
    return apolloAllowsCatchAll || scored ? "catch-all-send" : "catch-all-call";
  }
  if (a.emailStatus && APOLLO_VERIFIED_RE.test(a.emailStatus)) return "send";
  return "unverified";
}

export function isStale(check: EmailCheck | undefined, now = Date.now()): boolean {
  if (!check) return true;
  const t = Date.parse(check.checkedAt);
  return !Number.isFinite(t) || now - t > STALE_DAYS * 86_400_000;
}

/* ------------------------------------------------------------- import */

const CATCH_ALL_RE = /accept[\s_-]?all|catch[\s_-]?all|catchall/i;
const INVALID_RE = /^(invalid|undeliverable|rejected?|bad|bounce\w*|do[\s_-]?not[\s_-]?mail|spam[\s_-]?trap|abuse|disposable|toxic|syntax\w*|mailbox[\s_-]?not[\s_-]?found|no[\s_-]?mx)$|rejected_email|invalid_(email|domain|smtp)|mailbox_not_found|no_mx/i;
const VALID_RE = /^(valid|deliverable|ok|safe|good|verified|accepted?)$|accepted_email/i;
const UNKNOWN_RE = /^(unknown|timeout|unverifiable|error|failed)$/i;

/**
 * One verifier row → a status. Reads the status AND the reason, because
 * several tools put "catch-all" in the reason: Bouncer and Kickbox return
 * status "risky" with reason "accept_all"; ZeroBounce says "catch-all";
 * NeverBounce says "catchall". Catch-all is checked first so a "risky /
 * accept_all" row is never read as plain risky.
 */
export function normaliseStatus(status: string, reason = ""): Deliverability | null {
  const s = status.trim(), r = reason.trim();
  if (!s && !r) return null;
  if (CATCH_ALL_RE.test(s) || CATCH_ALL_RE.test(r)) return "catch-all";
  if (VALID_RE.test(s)) return "valid";
  if (INVALID_RE.test(s) || INVALID_RE.test(r)) return "invalid";
  if (/^risky$/i.test(s)) return "risky";
  if (UNKNOWN_RE.test(s)) return "unknown";
  return null;
}

/** A score column on 0–1 (Kickbox Sendex) or 0–100 (Bouncer, ZeroBounce). */
export function normaliseScore(v: unknown): number | null {
  const s = String(v ?? "").trim().replace(/%$/, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n <= 1 && s.includes(".") ? n * 100 : Math.min(n, 100));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
function findCol(cols: string[], exact: string[], contains: string[] = []): string | null {
  for (const want of exact) { const c = cols.find((x) => norm(x) === want); if (c) return c; }
  for (const want of contains) { const c = cols.find((x) => norm(x).includes(want)); if (c) return c; }
  return null;
}

export interface VerifierMapping { email: string | null; status: string | null; reason: string | null; score: string | null }

/** Header detection, tolerant of every verifier's naming. */
export function mapVerifierColumns(cols: string[]): VerifierMapping {
  return {
    email: findCol(cols, ["email", "emailaddress", "address", "emailid"], ["email"]),
    status: findCol(cols, ["status", "result", "verificationstatus", "emailstatus", "zbstatus", "verdict", "state", "deliverability"], ["status", "result", "verdict"]),
    reason: findCol(cols, ["reason", "substatus", "zbsubstatus", "subresult", "flags"], ["reason", "substatus"]),
    score: findCol(cols, ["score", "zbscore", "sendex", "deliverabilityscore", "qualityscore", "aiscore"], ["score", "sendex"]),
  };
}

export interface VerifierImport {
  checks: EmailCheck[];
  rows: number;
  skipped: number;
  mapping: VerifierMapping;
  byStatus: Record<Deliverability, number>;
}

export function readVerifierFiles(files: ParsedFile[], now = new Date().toISOString()): VerifierImport {
  const byEmail = new Map<string, EmailCheck>();
  const byStatus: Record<Deliverability, number> = { valid: 0, "catch-all": 0, risky: 0, invalid: 0, unknown: 0 };
  let rows = 0, skipped = 0;
  let mapping: VerifierMapping = { email: null, status: null, reason: null, score: null };
  for (const f of files) {
    const cols = f.fields?.length ? f.fields : Object.keys(f.data[0] ?? {});
    mapping = mapVerifierColumns(cols);
    // Score scale, per file: ZeroBounce's AI score runs 0–10, Bouncer and
    // most others 0–100, Kickbox's Sendex 0–1. Read off the file's own
    // values rather than assumed from the vendor, so a 9 from ZeroBounce is
    // 90, not 9.
    const raws = mapping.score
      ? (f.data as Record<string, unknown>[]).map((r) => String(r[mapping.score!] ?? "").trim().replace(/%$/, "")).filter(Boolean).map(Number).filter(Number.isFinite)
      : [];
    const max = raws.length ? Math.max(...raws) : 0;
    const scale = max > 1 && max <= 10 ? 10 : 1;
    for (const row of f.data as Record<string, unknown>[]) {
      rows++;
      const email = normEmailKey(mapping.email ? row[mapping.email] : "");
      const status = normaliseStatus(String(mapping.status ? row[mapping.status] ?? "" : ""), String(mapping.reason ? row[mapping.reason] ?? "" : ""));
      if (!email.includes("@") || !status) { skipped++; continue; }
      const raw = [mapping.status && row[mapping.status], mapping.reason && row[mapping.reason]].filter(Boolean).join(" / ");
      byEmail.set(email, {
        email, domain: email.split("@")[1] ?? "", status,
        score: mapping.score ? scaled(normaliseScore(row[mapping.score]), scale) : null,
        raw: String(raw), checkedAt: now, sourceFile: f.name,
      });
    }
  }
  const checks = [...byEmail.values()];
  for (const c of checks) byStatus[c.status]++;
  return { checks, rows, skipped, mapping, byStatus };
}

function scaled(n: number | null, scale: number): number | null {
  return n === null ? null : Math.min(100, Math.round(n * scale));
}

/* ------------------------------------------------------------ storage */

export async function loadEmailChecks(): Promise<EmailCheck[]> {
  return dbGetAll<EmailCheck>(STORE_DELIVERABILITY);
}
export async function saveEmailChecks(checks: EmailCheck[]): Promise<void> {
  if (checks.length) await dbBulkPut(STORE_DELIVERABILITY, checks);
}
export function indexChecks(checks: EmailCheck[]): Map<string, EmailCheck> {
  return new Map(checks.map((c) => [c.email, c]));
}

/** Unique emails among these leads with no result, or a stale one. */
export function emailsToVerify<T extends { email: string; contact: string; company: string }>(
  leads: T[], index: Map<string, EmailCheck>, now = Date.now(),
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const l of leads) {
    const e = normEmailKey(l.email);
    if (!e.includes("@") || seen.has(e)) continue;
    seen.add(e);
    if (isStale(index.get(e), now)) out.push(l);
  }
  return out;
}
