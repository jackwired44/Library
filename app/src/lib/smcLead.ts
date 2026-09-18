// Parser for the Microsoft SMC / Cloud Ascent lead blob.
//
// The Custom Scanner's real input is not a tidy CSV: the whole lead lives
// as ONE run-on text blob inside description / campaignidname, e.g.
//
//   "#PROFILED Customer TPID: 4059815 Company Name: New Leaf Publishing
//    Group Website: https://... First Name: Christopher Last Name: Hallski
//    Job Title: IT Manager ... SMC Type: Medium Product Propensity Details
//    (as pulled from Cloud Ascent on 2026-02-25): - Azure: Act Now (High
//    Fit; Very Low Prioritization Index) - M365: Educate (...) ...
//    Product Ownership Details ...: - Has O365: Yes - Has Azure: No"
//
// There are no line breaks and no delimiters — labels run straight into
// the next label. So every field is read as "everything between MY label
// and the NEXT known label", which is the only approach that survives
// values containing spaces (company names, job titles) without guessing.
//
// Nothing here is shared with the Main Scanner: this is a different
// vendor's format with its own vocabulary.

// ------------------------------------------------------------------ types

export const SMC_PRODUCTS = ["Azure", "M365", "D365 BC", "D365 F&O", "D365 Sales Pro", "Surface"] as const;
export type SmcProduct = (typeof SMC_PRODUCTS)[number];

/** Cloud Ascent's recommended motion, strongest first. */
export const SMC_STAGES = ["Act Now", "Evaluate", "Nurture", "Educate", "Unknown"] as const;
export type SmcStage = (typeof SMC_STAGES)[number];

export type SmcLevel = "High" | "Medium" | "Low" | "Very Low" | "Unknown";

export interface Propensity { product: SmcProduct; stage: SmcStage; fit: SmcLevel; index: SmcLevel }

export interface SmcContact {
  firstName: string; lastName: string; title: string;
  phone: string; email: string; linkedin: string;
}

export interface SmcLead {
  tpids: string[];
  company: string;
  website: string;
  mainPhone: string;
  smcType: string;
  contacts: SmcContact[];
  propensity: Propensity[];
  /** Has O365 / M365 / Azure / D365 — true, false, or absent if not stated. */
  owns: Partial<Record<"O365" | "M365" | "Azure" | "D365", boolean>>;
  bant: { budget?: string; authority?: string; need?: string; timeline?: string; partner?: string };
  leadId: string;
  msxAccount: string;
  tags: string[];
  employeesMin: number | null;
  employeesMax: number | null;
  industry: string;
  /** True when the blob carried nothing usable (empty, or literally NULL). */
  empty: boolean;
  /** The whitespace-normalised source text, for word-level checks. */
  rawText: string;
  /** ISO date the Cloud Ascent data behind this lead was pulled — "(as
   *  pulled from Cloud Ascent on 2026-06-27)". The closest thing these
   *  blobs carry to "when did this lead arrive", so it is what Received
   *  sorts and filters on. Null when the blob does not state one. */
  pulledOn: string | null;
}

// -------------------------------------------------------------- utilities

// Every label the format uses. A value ends where the next one begins.
const LABELS = [
  "Customer TPIDs", "Customer TPID", "TPID", "AdditionalTPIDs",
  "Company Name", "Business Name", "Website", "Main Phone Number",
  "First Name", "Last Name", "Job Title", "Phone", "Email", "Linkedin", "LinkedIn profile",
  "FirstName", "LastName", "JobTitle", "PhoneNumber", "EmailAddress", "ContactSource",
  "SMC Type", "Product Propensity Details", "Product Ownership Details",
  "Budget", "Authority", "Need", "Timeline", "Time", "Partner",
  "Lead ID", "Lead Id", "MSX Account", "Profiler comment", "Domain",
  "Min # of employees", "Max # of employees", "Industry", "Comment",
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NEXT_LABEL = LABELS.map(esc).join("|");

// Section headers that end a value WITHOUT a colon straight after them —
// the real text reads "Product Propensity Details (as pulled from Cloud
// Ascent on 2026-02-25):", so the colon sits past a parenthetical and a
// plain "Label:" lookahead never matches.
const STOP_PHRASES = ["Product Propensity Details", "Product Ownership Details", "Profiler comment"];
const NEXT_STOP = STOP_PHRASES.map(esc).join("|");

/** Read one label's value: everything up to the next known label. */
function field(text: string, label: string): string {
  const re = new RegExp(
    `(?:^|[^A-Za-z])${esc(label)}\\s*:\\s*(.*?)` +
    `(?=\\s*(?:${NEXT_LABEL})\\s*:|\\s*(?:${NEXT_STOP})|\\s*-\\s*Has\\s|$)`,
    "i",
  );
  const m = re.exec(text);
  if (!m) return "";
  return m[1].replace(/\s+/g, " ").trim();
}

const LEVELS: Record<string, SmcLevel> = {
  high: "High", medium: "Medium", low: "Low", "very low": "Very Low", unknown: "Unknown",
};
const level = (s: string): SmcLevel => LEVELS[s.trim().toLowerCase()] ?? "Unknown";

// ------------------------------------------------------------------ parse

/** Contact blocks repeat within one blob — one company, several people. */
function parseContacts(text: string): SmcContact[] {
  const out: SmcContact[] = [];

  // Each contact's fields must be read from ITS OWN block only. Slicing to
  // the end of the blob let the first person inherit the second person's
  // phone and email — the export then addressed Christopher and dialled
  // Dana's number. The block ends where the next contact begins.
  const blockEnd = (from: number, nextLabel: RegExp): number => {
    nextLabel.lastIndex = from;
    const n = nextLabel.exec(text);
    return n ? n.index : text.length;
  };

  // Form A: "First Name: X Last Name: Y Job Title: Z Phone: .. Email: .. Linkedin: .."
  const reA = /First\s+Name\s*:\s*(.*?)\s*Last\s+Name\s*:\s*(.*?)(?=\s*(?:Job Title|Phone|Email|Linkedin|First Name|Company Name|SMC Type)\s*:|$)/gi;
  const nextA = /First\s+Name\s*:/gi;
  let m: RegExpExecArray | null;
  while ((m = reA.exec(text))) {
    const after = text.slice(m.index, blockEnd(m.index + m[0].length, nextA));
    out.push({
      firstName: m[1].replace(/[,\s]+$/, "").replace(/\s+/g, " ").trim(),
      lastName: m[2].replace(/[,\s]+$/, "").replace(/\s+/g, " ").trim(),
      title: field(after, "Job Title"),
      phone: field(after, "Phone"),
      email: field(after, "Email"),
      linkedin: field(after, "Linkedin"),
    });
  }

  // Form B, from [PPA] blocks: "FirstName: joe, LastName: hoeme JobTitle: ..."
  const reB = /FirstName\s*:\s*(.*?),?\s*LastName\s*:\s*(.*?)(?=\s*(?:JobTitle|PhoneNumber|EmailAddress|LinkedIn profile|ContactSource|FirstName)\s*:|$)/gi;
  const nextB = /FirstName\s*:/gi;
  while ((m = reB.exec(text))) {
    const after = text.slice(m.index, blockEnd(m.index + m[0].length, nextB));
    out.push({
      firstName: m[1].replace(/[,\s]+$/, "").replace(/\s+/g, " ").trim(),
      lastName: m[2].replace(/[,\s]+$/, "").replace(/\s+/g, " ").trim(),
      title: field(after, "JobTitle"),
      phone: field(after, "PhoneNumber"),
      email: field(after, "EmailAddress"),
      linkedin: field(after, "LinkedIn profile"),
    });
  }

  // Same person can appear twice when a blob repeats a block; keep first.
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.firstName}|${c.lastName}|${c.email}`.toLowerCase();
    if (!c.firstName && !c.lastName) return false;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parsePropensity(text: string): Propensity[] {
  const out: Propensity[] = [];
  for (const product of SMC_PRODUCTS) {
    const re = new RegExp(`-\\s*${esc(product)}\\s*:\\s*([A-Za-z ]+?)\\s*\\(\\s*([A-Za-z ]+?)\\s*Fit\\s*;\\s*([A-Za-z ]+?)\\s*Prioritization Index\\s*\\)`, "i");
    const m = re.exec(text);
    if (!m) continue;
    const stageRaw = m[1].trim().toLowerCase();
    const stage = (SMC_STAGES.find((s) => s.toLowerCase() === stageRaw) ?? "Unknown") as SmcStage;
    out.push({ product, stage, fit: level(m[2]), index: level(m[3]) });
  }
  return out;
}

function parseOwnership(text: string): SmcLead["owns"] {
  const owns: SmcLead["owns"] = {};
  for (const [key, label] of [["O365", "O365"], ["M365", "M365"], ["Azure", "Azure"], ["D365", "D365"]] as const) {
    const m = new RegExp(`-\\s*Has\\s+${esc(label)}\\s*:\\s*(Yes|No)`, "i").exec(text);
    if (m) owns[key] = /yes/i.test(m[1]);
  }
  return owns;
}

function parseTags(text: string): string[] {
  const tags = new Set<string>();
  for (const m of text.matchAll(/#([A-Za-z0-9]+)/g)) tags.add(`#${m[1]}`);
  for (const m of text.matchAll(/\[([A-Z]{2,4})\]/g)) tags.add(`[${m[1]}]`);
  return [...tags];
}

/**
 * A BANT value as a person would read it.
 *
 * The raw values carry their own scaffolding, which the Notes column then
 * quoted verbatim and it read as nonsense:
 *
 *   "Solution: Data & Analytics Modernization"  ->  Need: Solution: Data...
 *   "Confirmed – secure, native AI integrated"  ->  Need: Confirmed – secure...
 *   "Assumed minimum value: $10,000 placeholder"
 *
 * A leading status word and a short leading sub-label are scaffolding, not
 * content. The sub-label strip is capped at three words so a real value
 * containing a colon is not eaten.
 */
const BANT_QUALIFIER_RE = /^(confirmed|unverified|assumed|likely|probable|estimated|tbd|unknown|n\/a)\b[\s:–—-]*/i;
const BANT_SUBLABEL_RE = /^([A-Za-z][A-Za-z/&' ]{0,28}?)\s*:\s*(?=\S)/;
export function tidyBantValue(raw: string): string {
  let v = (raw || "").replace(/\s+/g, " ").trim();
  if (!v) return "";
  v = v.replace(BANT_QUALIFIER_RE, "").trim();
  const sub = BANT_SUBLABEL_RE.exec(v);
  if (sub && sub[1].trim().split(/\s+/).length <= 3) v = v.slice(sub[0].length).trim();
  v = v.replace(BANT_QUALIFIER_RE, "").trim();
  v = v.replace(/\s*\bplaceholder\b\s*$/i, "").trim();
  // "34200 - Unverified – existing Microsoft budget; prefers reallocation"
  // is a value followed by commentary. Keep the value.
  v = v.replace(/\s*[-–—]\s*(?:confirmed|unverified|assumed|likely|probable|estimated)\b[\s\S]*$/i, "").trim();
  v = v.replace(/^[•\-–—\s]+/, "").replace(/[•\s;,]+$/, "").trim();
  // A value that was nothing but scaffolding is no value at all.
  if (/^(tbd|none|n\/a|unknown|confirmed|unverified)$/i.test(v)) return "";
  return v;
}

/** BANT appears three ways: "Budget: X", "B: X", and "B – Label: X". */
function parseBant(text: string): SmcLead["bant"] {
  const out: SmcLead["bant"] = {};
  const long = (label: string) => {
    const v = field(text, label);
    return v && !/^:/.test(v) ? v : "";
  };
  out.budget = long("Budget") || undefined;
  out.authority = long("Authority") || undefined;
  out.need = long("Need") || undefined;
  out.timeline = long("Timeline") || long("Time") || undefined;
  out.partner = long("Partner") || undefined;

  // Short form: B: 200 A: Naveen Sathiya N: Cloud and Security T: 2 months
  const short = /(?:^|\s)B\s*[:–-]\s*(.*?)\s*A\s*[:–-]\s*(.*?)\s*N\s*[:–-]\s*(.*?)\s*T\s*[:–-]\s*(.*?)(?=\s*(?:P\s*[:–-]|•|Customer TPID|Lead I[dD]|$))/i.exec(text);
  if (short) {
    out.budget = out.budget || short[1].trim();
    out.authority = out.authority || short[2].trim();
    out.need = out.need || short[3].trim();
    out.timeline = out.timeline || short[4].trim();
  }
  for (const k of Object.keys(out) as (keyof SmcLead["bant"])[]) {
    const v = out[k];
    if (v) out[k] = tidyBantValue(v);
    if (!out[k]) delete out[k];
  }
  return out;
}

/** "(as pulled from Cloud Ascent on 2026-06-27)" / "(as pulled on …)".
 *  The earliest date stated wins when a blob carries several: the
 *  propensity and ownership blocks are pulled together, and taking the
 *  earliest never overstates how fresh a lead is. */
export function parsePulledOn(text: string): string | null {
  const found = [...text.matchAll(/as pulled(?:\s+from\s+Cloud\s+Ascent)?\s+on\s+(\d{4}-\d{2}-\d{2})/gi)].map((m) => m[1]);
  if (!found.length) return null;
  return found.sort()[0];
}

export function parseSmcLead(raw: string): SmcLead {
  const text = (raw || "").replace(/\s+/g, " ").trim();
  const blank: SmcLead = {
    tpids: [], company: "", website: "", mainPhone: "", smcType: "", contacts: [],
    propensity: [], owns: {}, bant: {}, leadId: "", msxAccount: "", tags: [],
    employeesMin: null, employeesMax: null, industry: "", empty: true, rawText: text, pulledOn: null,
  };
  if (!text || /^null$/i.test(text)) return blank;

  const tpidRaw = field(text, "Customer TPIDs") || field(text, "Customer TPID") || field(text, "TPID");
  const tpids = (tpidRaw.match(/\d{4,}/g) || []);

  // "rCompany Name:" appears in real rows — a stray character from the
  // export, stripped rather than allowed to corrupt the company name.
  const company = (field(text, "Company Name") || field(text, "Business Name")).replace(/^r(?=[A-Z])/, "").trim();

  const industry = field(text, "Industry");
  const minE = /Min # of employees\s*:\s*(\d+)/i.exec(text);
  const maxE = /Max # of employees\s*:\s*(\d+)/i.exec(text);

  const lead: SmcLead = {
    tpids,
    company,
    website: field(text, "Website"),
    mainPhone: field(text, "Main Phone Number"),
    smcType: field(text, "SMC Type"),
    contacts: parseContacts(text),
    propensity: parsePropensity(text),
    owns: parseOwnership(text),
    bant: parseBant(text),
    leadId: field(text, "Lead ID") || field(text, "Lead Id"),
    msxAccount: field(text, "MSX Account"),
    tags: parseTags(text),
    employeesMin: minE ? Number(minE[1]) : null,
    employeesMax: maxE ? Number(maxE[1]) : null,
    industry: /^unknown$/i.test(industry) ? "" : industry,
    empty: false,
    rawText: text,
    pulledOn: parsePulledOn(text),
  };
  lead.empty = !lead.tpids.length && !lead.company && !lead.contacts.length &&
               !lead.propensity.length && !Object.keys(lead.bant).length;
  return lead;
}

// ----------------------------------------------------------------- scoring

export interface Opportunity { product: SmcProduct; stage: SmcStage; fit: SmcLevel; index: SmcLevel; owned: boolean }

/** Which product a propensity row implies they already own. Surface and
 *  the two D365 lines both map onto the single "Has D365" flag, which is
 *  the most specific answer the data actually gives. */
function ownedFlagFor(p: SmcProduct): keyof SmcLead["owns"] | null {
  if (p === "Azure") return "Azure";
  if (p === "M365") return "M365";
  if (p === "D365 BC" || p === "D365 F&O" || p === "D365 Sales Pro") return "D365";
  return null; // Surface — ownership is not reported
}

/**
 * The whitespace play: Cloud Ascent says Act Now with High Fit, and they
 * do NOT already own that product. That combination is the strongest
 * thing in this data set, and it is what makes this scanner different
 * from the Main Scanner — nobody has written a sentence about wanting
 * anything, so intent has to be read from the propensity matrix instead.
 */
export function opportunities(lead: SmcLead): Opportunity[] {
  return lead.propensity
    .filter((p) => p.stage !== "Unknown")
    .map((p) => {
      const flag = ownedFlagFor(p.product);
      return { ...p, owned: flag ? lead.owns[flag] === true : false };
    });
}

export function actNowGaps(lead: SmcLead): Opportunity[] {
  return opportunities(lead).filter((o) => o.stage === "Act Now" && o.fit === "High" && !o.owned);
}

/**
 * Last resort: an email or a phone sitting loose in the lead text, with no
 * labelled contact block around it. If a reachable detail is present in the
 * row it must reach the download — losing it because the vendor did not
 * wrap it in a label is the worst kind of silent gap.
 *
 * Both are deliberately strict. A Customer TPID is a long run of digits and
 * must never be mistaken for a phone number, so a bare digit run does not
 * qualify: the value has to carry real phone punctuation or a country code.
 */
const LOOSE_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const LOOSE_PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]?\d{4}\b/;
export function looseEmail(text: string): string {
  const m = LOOSE_EMAIL_RE.exec(text || "");
  return m ? m[0] : "";
}
export function loosePhone(text: string): string {
  const m = LOOSE_PHONE_RE.exec(text || "");
  return m ? m[0].trim() : "";
}

/**
 * Many SMC rows carry no "First Name:" block at all, yet still name the
 * person — in the BANT Authority field:
 *
 *   "A – Owner: Eric Wells"
 *   "Authority: Richard Folkedahl"
 *   "Authority: Confirmed – George Morris (President / CISO)"
 *
 * Per Jack, every lead has a contact at the company, and this is where it
 * lives for these rows. Treated as a real contact rather than left blank.
 * Deliberately conservative: a value that does not read like a person's
 * name is ignored rather than guessed at.
 */
const AUTHORITY_QUALIFIER_RE = /^(confirmed|unverified|assumed|likely|probable|tbd|unknown|n\/a)\b[\s:–—-]*/i;
export function contactFromAuthority(lead: SmcLead): SmcContact | undefined {
  let v = (lead.bant.authority || "").trim();
  if (!v) return undefined;
  // The value often carries its own sub-label — "A – Owner: Eric Wells"
  // parses to "Owner: Eric Wells". The person is whatever follows the last
  // colon.
  const lastColon = v.lastIndexOf(":");
  if (lastColon >= 0) v = v.slice(lastColon + 1).trim();
  v = v.replace(AUTHORITY_QUALIFIER_RE, "").trim();
  // A parenthesised or dash-suffixed role is the job title.
  let title = "";
  const paren = v.match(/^(.*?)\s*[([]([^)\]]+)[)\]]\s*$/);
  if (paren) { v = paren[1].trim(); title = paren[2].trim(); }
  else {
    const dash = v.match(/^(.*?)\s+[–—-]\s+(.+)$/);
    if (dash && /[A-Za-z]/.test(dash[2])) { v = dash[1].trim(); title = dash[2].trim(); }
  }
  v = v.replace(/[.,;]+$/, "").trim();
  // Must read like a name: two to four words, letters (apostrophes and
  // hyphens allowed), no digits, no @, and not a sentence.
  const words = v.split(/\s+/);
  if (words.length < 2 || words.length > 4) return undefined;
  if (!/^[A-Za-z][A-Za-z'’.-]*(\s+[A-Za-z][A-Za-z'’.-]*){1,3}$/.test(v)) return undefined;
  const [firstName, ...rest] = words;
  return { firstName, lastName: rest.join(" "), title, phone: "", email: "", linkedin: "" };
}

/**
 * The contact whose details are worth putting on the lead.
 *
 * A blob often lists several people and the FIRST is not always the one with
 * an email or a phone — taking contacts[0] blindly showed a blank email for a
 * lead whose second contact had one. Prefer the most reachable person:
 * email and phone, then email, then phone, then whoever is first.
 */
export function bestContact(lead: SmcLead): SmcContact | undefined {
  const c = lead.contacts;
  // No contact block: the BANT Authority is the person on these rows.
  if (!c.length) return contactFromAuthority(lead);
  return (
    c.find((x) => x.email && x.phone) ??
    c.find((x) => x.email) ??
    c.find((x) => x.phone) ??
    c[0]
  );
}

/** A compact, readable reason a lead scored the way it did. */
export function describeLead(lead: SmcLead, rules?: SmcRules): string {
  if (lead.empty) return "No usable lead content";
  const bits: string[] = [];
  const r = rules ?? DEFAULT_SMC_RULES;
  const gaps = salesGaps(lead, r);
  if (gaps.length) {
    const stage = r.stages.length === 1 ? r.stages[0] : r.stages.join("/");
    const owned = r.requireNotOwned ? ", not owned" : "";
    bits.push(`${stage} + ${r.minFit}+ Fit${owned}: ${gaps.map((g) => g.product).join(", ")}`);
  }
  const hi = opportunities(lead).filter((o) => o.index === "High");
  if (hi.length) bits.push(`High prioritization: ${hi.map((h) => h.product).join(", ")}`);
  if (lead.smcType) bits.push(/^smc\b/i.test(lead.smcType) ? lead.smcType : `SMC ${lead.smcType}`);
  if (lead.contacts.length) bits.push(`${lead.contacts.length} contact${lead.contacts.length === 1 ? "" : "s"}`);
  if (lead.bant.need) bits.push(`Need: ${lead.bant.need}`);
  return bits.join(" · ") || "Parsed, no propensity or contacts";
}

// ---------------------------------------------------------- campaign code
//
// campaignidname is a SEPARATE, much simpler field from the description
// blob above — a tilde-delimited Microsoft campaign code:
//
//   US~US~FY26~CMP~Fabric as Next Logical Workload - VDS~SRAIM638026_6
//   US~FY24~CMP~COE True Up 1~SRAIM419760          (no second geo segment)
//   Concentrix - Manila - Dev Tools - Button Chat  (free text, no tildes)
//
// The 5th-from-start / 2nd-from-end segment is the human-readable play,
// and it is the most directly useful thing in the whole row: it says what
// Microsoft was selling, which is the conversation to open with.

export interface Campaign {
  raw: string;
  /** Fiscal year as stated, e.g. "FY26". Recency matters — FY24 bulk
   *  campaigns are years stale next to an FY26 one. */
  fiscalYear: string;
  /** The readable play, e.g. "Expand M365 Copilot". */
  name: string;
  /** Microsoft's campaign id, e.g. "SRAIM638026_6". */
  id: string;
  geo: string;
  empty: boolean;
}

export function parseCampaign(raw: string): Campaign {
  const text = (raw || "").replace(/\s+/g, " ").trim();
  const blank: Campaign = { raw: text, fiscalYear: "", name: "", id: "", geo: "", empty: true };
  if (!text || /^null$/i.test(text)) return blank;

  const parts = text.split("~").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) {
    // Free-text campaign with no code structure — keep it as the name
    // rather than dropping it; it is still what the lead came from.
    return { ...blank, name: text, empty: false };
  }
  const fy = parts.find((p) => /^FY\d{2}$/i.test(p)) ?? "";
  const id = parts[parts.length - 1];
  // " - VDS" is a routing suffix on the campaign name, not part of the play.
  const name = (parts[parts.length - 2] ?? "").replace(/\s*-\s*VDS$/i, "").trim();
  return { raw: text, fiscalYear: fy.toUpperCase(), name, id, geo: parts[0], empty: false };
}

/** Fiscal year as a sortable number ("FY26" -> 26); -1 when absent. */
export function fiscalYearNumber(c: Campaign): number {
  const m = /^FY(\d{2})$/i.exec(c.fiscalYear);
  return m ? Number(m[1]) : -1;
}

// ------------------------------------------------ Wired CIO product lines
//
// Per Jack: this scanner qualifies on the SAME things the Main Scanner
// does — Dynamics 365 and M365 / Azure — it just reads them out of
// different notes. So the six Cloud Ascent products collapse onto those
// two lines, with two deliberate exclusions that still show in the
// propensity table for context but can never be the reason a lead is
// Strong Signal:
//   - Surface: hardware, not something Wired CIO sells.
//   - D365 F&O: per Jack, "Dynamics FNO finance and operations or supply
//     chain is not qualified, we cannot support those platforms." The
//     Dynamics platforms Wired CIO strongly supports are Sales/CRM,
//     Business Central/ERP and Project Operations — so of Cloud Ascent's
//     Dynamics rows, only D365 BC and D365 Sales Pro qualify.

export type ProductLine = "Dynamics 365" | "M365 / Azure";

export const PRODUCT_LINE_OF: Record<SmcProduct, ProductLine | null> = {
  "D365 BC": "Dynamics 365",
  "D365 F&O": null,
  "D365 Sales Pro": "Dynamics 365",
  Azure: "M365 / Azure",
  M365: "M365 / Azure",
  Surface: null,
};

/**
 * A product line for a lead that qualified WITHOUT a propensity gap (a hot
 * word in the campaign name, say) — so every Strong Signal row carries a
 * line and the two line counts always add up to the Strong Signal total.
 * Reads only the free text: the propensity table names every product, so
 * it would always look like Dynamics. Generic migration / modernization
 * language is M365 / Azure, the same default the Main Scanner uses.
 */
const DYNAMICS_TEXT_RE = /\b(d365|dynamics|business central|bus central|crm|erp|sales pro|project operations|customer engagement)\b/i;
export function inferProductLine(lead: SmcLead, campaignName: string): ProductLine {
  const free = lead.rawText.split(/Product Propensity Details/i)[0];
  const text = `${campaignName} ${lead.bant.need ?? ""} ${free}`;
  return DYNAMICS_TEXT_RE.test(text) ? "Dynamics 365" : "M365 / Azure";
}

/** Act-Now gaps that are on a product line Wired CIO actually sells. */
export function salesGaps(lead: SmcLead, rules?: SmcRules): Opportunity[] {
  return qualifyingGaps(lead, rules ?? DEFAULT_SMC_RULES);
}

/**
 * Which product line the lead points at. Gaps decide it when there are
 * any (that is what makes it Strong Signal); otherwise any non-Unknown
 * propensity on a sold product. Dynamics 365 wins a tie, matching the
 * Main Scanner's CATEGORY_PRIORITY.
 */
export function productLineFor(lead: SmcLead, rules?: SmcRules): ProductLine | null {
  const pick = (rows: { product: SmcProduct }[]): ProductLine | null => {
    const lines = new Set(rows.map((r) => PRODUCT_LINE_OF[r.product]).filter((l): l is ProductLine => l !== null));
    if (lines.has("Dynamics 365")) return "Dynamics 365";
    if (lines.has("M365 / Azure")) return "M365 / Azure";
    return null;
  };
  const fromGaps = pick(salesGaps(lead, rules));
  if (fromGaps) return fromGaps;
  return pick(lead.propensity.filter((p) => p.stage !== "Unknown"));
}

// ------------------------------------------------- tunable Strong Signal
//
// Per Jack: "tweak some rules for scanning and pushing strong signals."
// What makes an SMC lead Strong Signal is HIS call, so the knobs live on
// the rule set and are edited in the app. The defaults below are exactly
// the behaviour that shipped first — Act Now, High Fit, not already owned,
// on a Wired CIO product line — so an existing rule set with no saved
// knobs classifies identically.

export interface SmcRules {
  /** Cloud Ascent stages that can qualify. */
  stages: SmcStage[];
  /** Weakest Fit that still qualifies (High is strictest). */
  minFit: Exclude<SmcLevel, "Unknown">;
  /** Only count a product they do NOT already own (the whitespace test). */
  requireNotOwned: boolean;
  /** Which Wired CIO lines count. Surface is never a line. */
  lines: ProductLine[];
  /** A High Prioritization Index on a sold line is enough on its own. */
  highIndexPushesStrong: boolean;
  /** Real BANT (a Need or an Authority named) is enough on its own. */
  bantPushesStrong: boolean;
  /** Per Jack: "modernize or migrate/migration are strong indicators of
   *  great opps." Word stems looked for in the campaign name, the BANT
   *  Need and the notes; a hit pushes Strong Signal. Editable. */
  hotWordsPushStrong: boolean;
  hotWords: string[];
  /** Per Jack: "we dont do fabric anymore." Products Wired CIO does not
   *  sell. A hot word sitting next to one does not count, and a campaign
   *  or BANT need aimed at one is a Bad Lead. Editable. */
  notSupported: string[];
  /** Per Jack: "unless its a large power bi opp no." Never auto-Strong; a
   *  campaign or need aimed at one lands in Needs Review so a human judges
   *  the size — Cloud Ascent carries no seat count to judge it by. */
  largeOnly: string[];
}

export const DEFAULT_SMC_RULES: SmcRules = {
  stages: ["Act Now"],
  minFit: "High",
  requireNotOwned: true,
  lines: ["Dynamics 365", "M365 / Azure"],
  highIndexPushesStrong: false,
  bantPushesStrong: false,
  hotWordsPushStrong: true,
  hotWords: ["modernize", "modernization", "migrate", "migration"],
  notSupported: ["fabric"],
  largeOnly: ["power bi", "powerbi"],
};

const FIT_RANK: Record<SmcLevel, number> = { High: 4, Medium: 3, Low: 2, "Very Low": 1, Unknown: 0 };

/** Fill in anything a rule set saved before a knob existed. */
export function resolveSmcRules(r: Partial<SmcRules> | undefined): SmcRules {
  return { ...DEFAULT_SMC_RULES, ...(r ?? {}) };
}

/** The propensity rows that qualify under the given rules. */
export function qualifyingGaps(lead: SmcLead, rules: SmcRules = DEFAULT_SMC_RULES): Opportunity[] {
  return opportunities(lead).filter((o) => {
    const line = PRODUCT_LINE_OF[o.product];
    if (!line || !rules.lines.includes(line)) return false;
    if (!rules.stages.includes(o.stage)) return false;
    if (FIT_RANK[o.fit] < FIT_RANK[rules.minFit]) return false;
    if (rules.requireNotOwned && o.owned) return false;
    return true;
  });
}

/** Rows with a High Prioritization Index on a sold line, any real stage. */
export function highIndexRows(lead: SmcLead, rules: SmcRules = DEFAULT_SMC_RULES): Opportunity[] {
  return opportunities(lead).filter((o) => {
    const line = PRODUCT_LINE_OF[o.product];
    return !!line && rules.lines.includes(line) && o.index === "High";
  });
}

export type WordWhere = "campaign" | "need" | "notes";
export interface WordHit { word: string; where: WordWhere }

const stemsOf = (words: string[] | undefined) => (words ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean);

/** The three places a word can sit, in the order they are trusted. */
function places(lead: SmcLead, campaignName: string): [string, WordWhere][] {
  return [[campaignName, "campaign"], [lead.bant.need ?? "", "need"], [lead.rawText, "notes"]];
}

/** First place any of `words` appears — campaign name, then BANT need,
 *  then the notes — or null. Stem-matched, same as the hot words. */
export function wordHit(lead: SmcLead, campaignName: string, words: string[] | undefined): WordHit | null {
  const stems = stemsOf(words);
  if (!stems.length) return null;
  for (const [text, where] of places(lead, campaignName)) {
    const low = text.toLowerCase();
    const hit = stems.find((st) => low.includes(st));
    if (hit) return { word: hit, where };
  }
  return null;
}

/** How far (chars) a not-supported word can sit from a hot word in the
 *  notes and still be what the hot word is about. The campaign name and
 *  the BANT need are short enough to be judged whole. */
const TAINT_WINDOW = 120;

/** Which hot word fired, and where — or null. Stem-matched so "migrating"
 *  and "modernization" both count; the UI shows the list being applied.
 *  A hot word does NOT count when the text it sits in is about a product
 *  Wired CIO does not sell, or only sells large: "Data & Analytics
 *  Modernization / Fabric" is a Fabric lead, not a modernization lead. */
export function hotWordHit(
  lead: SmcLead,
  campaignName: string,
  rules: SmcRules = DEFAULT_SMC_RULES,
): WordHit | null {
  if (!rules.hotWordsPushStrong) return null;
  const stems = stemsOf(rules.hotWords);
  if (!stems.length) return null;
  const taints = stemsOf([...(rules.notSupported ?? []), ...(rules.largeOnly ?? [])]);
  const tainted = (text: string) => taints.some((t) => text.includes(t));
  for (const [text, where] of places(lead, campaignName)) {
    const low = text.toLowerCase();
    for (const st of stems) {
      let at = low.indexOf(st);
      while (at >= 0) {
        const ctx = where === "notes" ? low.slice(Math.max(0, at - TAINT_WINDOW), at + st.length + TAINT_WINDOW) : low;
        if (!tainted(ctx)) return { word: st, where };
        at = low.indexOf(st, at + 1);
      }
    }
  }
  return null;
}

/**
 * Per Jack: disregard COE / EA renewal campaigns. These are Microsoft
 * agreement-admin campaigns (COE true-ups, EA renewals) — they say when a
 * contract comes up, never that the customer wants anything — so naming
 * one next to a verdict adds noise. The lead's own reason stands alone.
 * A stale-campaign Bad Lead still names it, because there the campaign IS
 * the reason.
 */
const RENEWAL_CAMPAIGN_RE = /\b(coe|ea\s*renewal|true[\s-]?up|renewals?)\b/i;
export function isRenewalCampaign(name: string | undefined): boolean {
  return !!name && RENEWAL_CAMPAIGN_RE.test(name);
}

export function hasRealBant(lead: SmcLead): boolean {
  return Boolean(lead.bant.need || lead.bant.authority);
}
