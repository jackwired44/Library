// Deals and sales meetings logged outside this platform — HubSpot, Notion
// and Echo — and which leads they cover.
//
// Per Jack: "for any lead in here that has ever been logged in notion or
// hubspot as a deal mark them as so and they are not to be contacted", then
// "we need to have a meetings column in here to manage the leads that means
// we arent to reach out again and the account manager should only".
//
// So a lead that matches one of these is ACCOUNT MANAGER ONLY: it stays
// visible, carries the deal or meeting in a Meetings column, and is left out
// of every download and every "needs a sequence" list. Nothing is copied in
// beyond what the match needs — company, domain, contact email, the stage or
// date, and a link back. Next steps, values and summaries stay where they
// live (Switchboard, Notion, Echo).
//
// It arrives as a file, imported in All leads: Source, Company, Domain,
// Email, Contact, Stage, Date, Link. Importing a file replaces every record
// of the sources it carries, so a re-pull drops deals that were deleted.
import { STORE_ENGAGEMENTS, dbBulkPut, dbDelete, dbGetAll } from "./db";
import { getEmailDomain, guessColumn, isFreeEmailDomain } from "./detection";
import { normCompany, normEmail, type StoredLead } from "./leadStore";

export type EngagementSource = "hubspot" | "notion" | "echo";

export const ENGAGEMENT_SOURCE_META: Record<EngagementSource, { label: string; kind: string }> = {
  hubspot: { label: "HubSpot", kind: "deal" },
  notion: { label: "Notion", kind: "deal" },
  echo: { label: "Echo", kind: "meeting" },
};
export const ENGAGEMENT_SOURCES: EngagementSource[] = ["hubspot", "notion", "echo"];

export interface Engagement {
  id: string;
  source: EngagementSource;
  company: string;
  /** Company web domain, lower case, no www. "" when unknown. */
  domain: string;
  /** A contact on the deal or in the meeting, lower case. "" when unknown. */
  email: string;
  contact: string;
  /** Deal stage ("Discovery", "Lost - Nurture", "Won"), or the meeting type
   *  for Echo ("Discovery", "Demo/Q&A"). */
  stage: string;
  /** Deal created / meeting held, YYYY-MM-DD. "" when unknown. */
  at: string;
  url: string;
}

/** A won deal is a customer, not a prospect. */
export const isWon = (e: Engagement) => /^(closed\s*)?won\b/i.test(e.stage.trim());

/* ----------------------------------------------------------------- parse */

const SOURCE_RE: [RegExp, EngagementSource][] = [[/hub\s*spot/i, "hubspot"], [/notion/i, "notion"], [/echo|meeting/i, "echo"]];

export function normDomain(v: unknown): string {
  return String(v || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "").replace(/\s+/g, "");
}

/** Rows of an engagements file. A row with no source it can name, or with
 *  no company, domain or email to match on, is skipped and counted. */
export function parseEngagements(fields: string[], data: Record<string, unknown>[]): { rows: Engagement[]; skipped: number } {
  const col = (cands: string[]) => guessColumn(fields, cands);
  const c = {
    source: col(["source", "system"]),
    company: col(["company", "companyname", "account", "organization"]),
    domain: col(["domain", "website", "companydomain"]),
    email: col(["email", "contactemail", "emailaddress"]),
    contact: col(["contact", "contactname", "name", "fullname"]),
    stage: col(["stage", "dealstage", "type", "meetingtype"]),
    at: col(["date", "createdate", "created", "meetingdate", "startedat"]),
    url: col(["link", "url"]),
  };
  const get = (r: Record<string, unknown>, k: string | null) => (k ? String(r[k] ?? "").trim() : "");
  const rows: Engagement[] = [];
  let skipped = 0;
  for (const r of data) {
    const rawSource = get(r, c.source);
    const source = SOURCE_RE.find(([re]) => re.test(rawSource))?.[1];
    const company = get(r, c.company);
    const domain = normDomain(get(r, c.domain));
    const email = normEmail(get(r, c.email));
    if (!source || (!normCompany(company) && !domain && !email.includes("@"))) { skipped++; continue; }
    const at = get(r, c.at).slice(0, 10);
    const stage = get(r, c.stage);
    rows.push({
      id: `${source}:${email || domain || normCompany(company)}:${stage}:${at}`,
      source, company, domain, email: email.includes("@") ? email : "",
      contact: get(r, c.contact), stage, at, url: get(r, c.url),
    });
  }
  // The same deal named twice in one file is one record.
  const seen = new Map<string, Engagement>();
  for (const e of rows) seen.set(e.id, e);
  return { rows: [...seen.values()], skipped };
}

/* ----------------------------------------------------------------- match */

export interface EngagementIndex {
  byEmail: Map<string, Engagement[]>;
  byDomain: Map<string, Engagement[]>;
  byCompany: Map<string, Engagement[]>;
  size: number;
}

function push(m: Map<string, Engagement[]>, k: string, e: Engagement) {
  if (!k) return;
  const a = m.get(k);
  if (a) a.push(e); else m.set(k, [e]);
}

/** Company names shorter than this are too generic to block a whole
 *  company on ("abc", "us"). They still match by email or domain. */
const MIN_COMPANY_KEY = 4;

export function buildEngagementIndex(list: Engagement[]): EngagementIndex {
  const idx: EngagementIndex = { byEmail: new Map(), byDomain: new Map(), byCompany: new Map(), size: list.length };
  for (const e of list) {
    push(idx.byEmail, e.email, e);
    // A contact's work domain stands in for the company's own.
    const d = e.domain || getEmailDomain(e.email) || "";
    if (d && !isFreeEmailDomain(d)) push(idx.byDomain, d, e);
    const c = normCompany(e.company);
    if (c.length >= MIN_COMPANY_KEY) push(idx.byCompany, c, e);
  }
  return idx;
}

export type EngagementMatchHow = "email" | "domain" | "company";
export interface EngagementMatch { how: EngagementMatchHow; items: Engagement[] }

/** Every deal or meeting covering this lead: the lead's own email, else its
 *  work domain, else its company name. Company-wide on purpose — per Jack,
 *  once a company is in a deal, nobody there is cold-called again. */
export function engagementsFor(l: Pick<StoredLead, "email" | "company">, idx: EngagementIndex | null): EngagementMatch | null {
  if (!idx || !idx.size) return null;
  const e = normEmail(l.email);
  const byEmail = e.includes("@") ? idx.byEmail.get(e) : undefined;
  if (byEmail?.length) return { how: "email", items: sortNewest(byEmail) };
  const d = getEmailDomain(e);
  const byDomain = d && !isFreeEmailDomain(d) ? idx.byDomain.get(d) : undefined;
  if (byDomain?.length) return { how: "domain", items: sortNewest(byDomain) };
  const c = normCompany(l.company);
  const byCompany = c.length >= MIN_COMPANY_KEY ? idx.byCompany.get(c) : undefined;
  if (byCompany?.length) return { how: "company", items: sortNewest(byCompany) };
  return null;
}

function sortNewest(list: Engagement[]): Engagement[] {
  return list.slice().sort((a, b) => b.at.localeCompare(a.at));
}

/** One line for a table cell: "HubSpot deal · Discovery · 2026-10-16 (+2)". */
export function engagementLabel(m: EngagementMatch): string {
  const top = m.items[0];
  const meta = ENGAGEMENT_SOURCE_META[top.source];
  const parts = [`${meta.label} ${meta.kind}`, top.stage, top.at].filter(Boolean);
  return parts.join(" · ") + (m.items.length > 1 ? ` (+${m.items.length - 1})` : "");
}

export const isCustomer = (m: EngagementMatch | null) => !!m && m.items.some(isWon);

/* ------------------------------------------------- module-level index */
// Set by App whenever the records change, the same way leadStatus's roster
// is, so every "where does this lead stand" answer agrees without the index
// being threaded through each caller.
let current: EngagementIndex | null = null;
export function setEngagementIndex(idx: EngagementIndex | null): void { current = idx; }
export function engagementOf(l: Pick<StoredLead, "email" | "company">): EngagementMatch | null {
  return engagementsFor(l, current);
}

/* --------------------------------------------------------------- persist */

export function loadEngagements(): Promise<Engagement[]> {
  return dbGetAll<Engagement>(STORE_ENGAGEMENTS);
}

/** Replace every stored record of the sources this import carries. */
export async function replaceEngagements(existing: Engagement[], incoming: Engagement[]): Promise<Engagement[]> {
  const sources = new Set(incoming.map((e) => e.source));
  const drop = existing.filter((e) => sources.has(e.source));
  const keep = existing.filter((e) => !sources.has(e.source));
  const ids = new Set(incoming.map((e) => e.id));
  for (const e of drop) if (!ids.has(e.id)) await dbDelete(STORE_ENGAGEMENTS, e.id);
  if (incoming.length) await dbBulkPut(STORE_ENGAGEMENTS, incoming);
  return [...keep, ...incoming];
}
