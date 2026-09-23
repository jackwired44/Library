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
  // Seen bleeding into Timeline on real rows ("timeline 4/2/2027 Partner
  // Name: SISL Infotech Comments Copilot") — field() only stops at a label
  // it knows about, so an unknown one swallows every field after it.
  "Partner Name", "Partner Account", "Comments", "Next Step", "Next Steps",
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
  // A BANT value ends where the next FIELD begins. field() can only stop
  // at labels it knows about, so an unlisted one ("Partner Name:",
  // "Comments", "Next Step:") swallows every field after it and the value
  // ships as "4/2/2027 Partner Name: SISL Infotech Comments Copilot".
  // Cutting at anything that looks like a new label catches the whole
  // class rather than one name at a time. Requires a capitalised word or
  // two followed by a colon, so a value containing a plain colon
  // ("ratio 3:1") is untouched.
  const nextField = /\s(?=(?:[A-Z][A-Za-z&/]*(?:\s[A-Z][A-Za-z&/]*){0,2})\s*:\s)/.exec(v);
  if (nextField && nextField.index > 0) v = v.slice(0, nextField.index).trim();
  v = v.replace(/^[•\-–—\s]+/, "").replace(/[•\s;,]+$/, "").trim();
  // A value that was nothing but scaffolding is no value at all.
  if (/^(tbd|none|n\/a|unknown|confirmed|unverified)$/i.test(v)) return "";
  return v;
}

/**
 * A "Partner:" value is a company name, but the seller often keeps typing
 * after it — call attempts ("F2 - Comp"), a TCR code, a POC block with a
 * phone and two emails. None of that is the partner, and leaving it in
 * makes the field unusable for anything but eyeballing. Cut at the first
 * marker that is clearly no longer part of a name.
 *
 * Deliberately keeps prose: "No partner identified yet. Opportunity to
 * introduce a migration partner" is the single most useful thing this
 * field ever says, and truncating it to a name would throw it away.
 */
const PARTNER_NOISE_RE = /\s(?:F\s*[1-9]\s*[-–:]|TCR\s*\d|POC\s*:|Call\s*\d|Attempt\s*\d|[\u2022\u00b7\u2023\u25aa]|[\r\n])/i;
export function cleanPartner(raw: string): string {
  let v = (raw || "").replace(/\s+/g, " ").trim();
  if (!v) return "";
  const noise = PARTNER_NOISE_RE.exec(v);
  if (noise) v = v.slice(0, noise.index);
  // An email or a phone number is contact detail, never part of the name.
  const contact = /\s(?:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4})/.exec(v);
  if (contact) v = v.slice(0, contact.index);
  v = v.replace(/[\s,;:\-–]+$/, "").trim();
  // A bare TPID trailing the name ("3RT Networks 6647767") is an id, not
  // part of what the partner is called.
  v = v.replace(/\s+\d{6,}$/, "").trim();
  // A GUID or a placeholder is not a partner. Dropping these to "" keeps
  // them out of the posture model entirely rather than reading as held,
  // which would cost a real lead points for a data-entry artefact.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return "";
  if (/^(?:tbd|pending|pendiente(?:\s+confirmar)?|unknown|desconocido|\?+|-+)$/i.test(v)) return "";
  return v;
}

/** Who holds this customer today, as far as the blob states it.
 *  "unknown" is the honest answer for 97% of rows — see partnerPostureOf. */
export type SmcPartnerPosture = "open" | "held" | "unknown";
export const SMC_PARTNER_META: Record<SmcPartnerPosture, { label: string; hint: string }> = {
  open: { label: "Open lane", hint: "Direct with Microsoft, or the notes say no partner is on it — nobody to displace." },
  held: { label: "Partner held", hint: "A reseller or MSP is named on the account. Workable, but you are displacing someone." },
  unknown: { label: "Not stated", hint: "The blob states no partner either way. Most rows. Scored neutral, never penalised." },
};

/** Direct / nobody-on-it language. Matched against the cleaned value. */
const PARTNER_OPEN_RE = /^(?:web\s*)?(?:microsoft(?:\s+(?:corp\.?|corporation\.?|direct))?\.?|direct|none|n\/?a|unassigned|no\s+partner\b.*)$|\bno\s+partner\s+(?:identified|assigned|involved|in\s+place|selected|yet)|\bno\s+partner\s+involved\b|\bpartner\s+not\s+(?:identified|assigned)/i;

/**
 * The Custom scanner's partner lane. Deliberately NOT modelled on CSP's
 * four-way posture: CSP reads a dedicated column that is ~70% filled, so
 * it can afford a 30-point factor. This reads a "Partner:" label out of a
 * free-text blob that states one on 2.7% of rows, so "unknown" is the
 * common case and has to cost nothing — see the adjustment in
 * scoreSmcLead rather than a weighted factor.
 */
export function partnerPostureOf(lead: SmcLead): SmcPartnerPosture {
  const v = (lead.bant.partner || "").trim();
  if (!v) return "unknown";
  return PARTNER_OPEN_RE.test(v) ? "open" : "held";
}

/** A BANT label with ANY content after it. Used only to decide whether a
 *  blob is truly empty — never for scoring, where a value that cleans
 *  down to nothing correctly counts for nothing. */
const ANY_BANT_LABEL_RE = /(?:^|[^A-Za-z])(?:Budget|Authority|Need|Timeline|Time|Partner)\s*:\s*\S/i;

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
  out.partner = cleanPartner(long("Partner")) || undefined;

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
  // "Nothing usable" has to be a fact about the TEXT, not about whether one
  // junk field survived cleaning. Without the last clause, tightening
  // cleanPartner turned a real row into a blank one: MORGAN COUNTY's blob
  // reads "Partner: - POC: Trevor, Giddens 7063429541 ..." and four named
  // people with emails, and its ONLY parsed field was the junk captured
  // after "Partner:". Cleaning that away made the lead read as empty, which
  // is plainly wrong about a 691-character blob.
  lead.empty = !lead.tpids.length && !lead.company && !lead.contacts.length &&
               !lead.propensity.length && !Object.keys(lead.bant).length &&
               !ANY_BANT_LABEL_RE.test(text);
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
  // The whitespace gap and the stated Need both moved into callAngle,
  // which says them in plain English at the FRONT of the note. Repeating
  // them here in Cloud Ascent's own vocabulary made every export state the
  // same two facts twice and roughly doubled the Notes column.
  const hi = opportunities(lead).filter((o) => o.index === "High");
  if (hi.length) bits.push(`High prioritization: ${hi.map((h) => h.product).join(", ")}`);
  if (lead.smcType) bits.push(/^smc\b/i.test(lead.smcType) ? lead.smcType : `SMC ${lead.smcType}`);
  if (lead.contacts.length) bits.push(`${lead.contacts.length} contact${lead.contacts.length === 1 ? "" : "s"}`);
  if (!bits.length) {
    // Nothing else worth saying: fall back to the gap in the old
    // vocabulary rather than going silent.
    const gaps = salesGaps(lead, r);
    if (gaps.length) {
      const stage = r.stages.length === 1 ? r.stages[0] : r.stages.join("/");
      bits.push(`${stage} + ${r.minFit}+ Fit: ${gaps.map((g) => g.product).join(", ")}`);
    }
  }
  return bits.join(" · ") || "Parsed, no propensity or contacts";
}

/**
 * What to actually say when you ring them.
 *
 * Per Jack: "matched snippet for custom scanner needs to show what it is
 * to call them about aside from being a match." The note used to open with
 * classification metadata — "Score 83 — High priority — Act Now + High+
 * Fit, not owned: Azure — High prioritization: Azure — SMC Medium" — which
 * says why the ENGINE liked the row and nothing about the conversation.
 *
 * Everything here is lifted from the blob's own fields. Nothing is
 * inferred about what the customer wants beyond what Cloud Ascent states,
 * and a stated Need is quoted rather than paraphrased, for the same reason
 * the Main Scanner's snippets are: a note a rep reads down the phone has
 * to be true.
 *
 * Order is by how useful it is on a call:
 *  1. A Need somebody actually wrote down. Rare (~5% of rows) and by far
 *     the best opener when it is there.
 *  2. What they are ready to buy and do not own yet. This is the pitch on
 *     the other 95%, said in English rather than in Cloud Ascent's
 *     stage/fit/index vocabulary.
 *  3. What they already run, because that is the foot in the door.
 *  4. Budget / authority / timeline where stated — who to ask for and when.
 *  5. What Microsoft is already pitching them, which is the pretext.
 */
export function callAngle(lead: SmcLead, rules?: SmcRules): string {
  if (lead.empty) return "";
  const r = rules ?? DEFAULT_SMC_RULES;
  const bits: string[] = [];
  const pitch = salesGaps(lead, r)[0] ?? bestOpportunity(lead, r);

  // 1. WHY CALL. A need somebody actually typed is the only real pain this
  //    data ever carries \u2014 86 of 1,114 High rows, and only 30 of those are
  //    a sentence rather than a product name. Quote it whole: per Jack,
  //    these are the rows where a human wrote why they care, so they get
  //    the room. The ceiling only exists so one pathological value cannot
  //    reproduce the 2,010-character note this replaces.
  //    On the other 92% there IS no stated pain, and inventing one is the
  //    defect just fixed twice on the Main Scanner. The honest "why now" is
  //    Microsoft's own read: they are modelled ready for something they do
  //    not own.
  if (lead.bant.need) bits.push(`Needs: "${clip(lead.bant.need, NEED_MAX)}"`);
  else if (pitch) bits.push(`${pitch.stage} on ${pitch.product}`);

  // 2. WHAT TO PITCH. One product, never a list \u2014 an SDR pitching "Azure,
  //    M365, D365 BC and Surface" is pitching nothing. Only needed when
  //    their own words led, since a need does not say which product.
  if (lead.bant.need && pitch) bits.push(`${pitch.product} whitespace`);

  // 3. WHAT THEY RUN. The foot in the door, and the reason the pitch is
  //    plausible. Present on 92% of High rows.
  const owns = (Object.keys(lead.owns) as (keyof SmcLead["owns"])[]).filter((k) => lead.owns[k] === true);
  if (owns.length) bits.push(`already on ${owns.join(", ")}`);

  // 4. WHERE THEY GO NEXT, per Jack: "maybe where they may go direction
  //    wise." The next workload they do not own, after the one being
  //    pitched. Present on 88%.
  const next = opportunities(lead)
    .filter((o) => !o.owned && (!pitch || o.product !== pitch.product))
    .sort((a, b) => STAGE_RANK.indexOf(a.stage) - STAGE_RANK.indexOf(b.stage))[0];
  if (next) bits.push(`then ${next.product} (${next.stage})`);

  return bits.join(" \u00b7 ");
}

/** A safety valve, not a style: one row in the real export carried a
 *  2,010-character note. Everything short of that is quoted whole. */
const NEED_MAX = 240;

/** Clip to a length, visibly. An SDR must never read a cut value as whole
 *  \u2014 same rule the Main Scanner's snippets follow. */
function clip(v: string, max: number): string {
  const s = (v || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-]+$/, "") + "\u2026";
}

/** Most-advanced stage first, for picking the best thing to lead with. */
const STAGE_RANK: SmcStage[] = ["Act Now", "Evaluate", "Nurture", "Educate", "Unknown"];

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
    // A hot word in the CAMPAIGN TITLE is not this customer's intent, per
    // Jack. Measured on his real export: 173 of 197 hot-signal Strong rows
    // fired on a campaign name, and there are only 81 distinct campaign
    // names across 12,863 rows because these are bulk Microsoft campaigns.
    // 364 accounts share "Microsoft Azure Virtual Training Day: Migrate and
    // Secure Windows Server" alone — a webinar invite list, scoring as
    // buying intent. 122 of the 197 had no propensity data at all, so the
    // campaign title was the ONLY reason they qualified.
    //
    // The title still shows on the row as context (see hotWordContext); it
    // just cannot qualify a lead by itself. Only the BANT need and the
    // notes — where a human wrote something about THIS account — can.
    if (where === "campaign") continue;
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

// ==========================================================================
// Scoring — 0–100, the same shape the CSP scanner uses
// ==========================================================================
//
// Per Jack: "lets build out the custom scanner september more and qualify
// tighter more so like we did in the csp scanner."
//
// Two things the audit of his real 13,106-row export found first, because
// they change what "tighter" even means here:
//
//  1. STAGE AND FIT ARE THE SAME SIGNAL. Across all 16,865 propensity rows
//     on a sold line the cross-tab is perfectly 1:1, zero exceptions:
//     Act Now ⟺ High (7,021), Evaluate ⟺ Medium (4,132),
//     Educate ⟺ Very Low (3,519), Nurture ⟺ Low (2,193). So requiring
//     "Act Now AND High fit" was ONE requirement wearing two hats, and the
//     old rule set looked stricter than it was. The score reads stage and
//     ignores fit; `minFit` survives only so a saved rule set still loads.
//
//  2. THE PRIORITIZATION INDEX IS INDEPENDENT, AND WAS SWITCHED OFF.
//     Within Act Now it splits High 36% / Very Low 55%. That is the real
//     discriminator in this data and `highIndexPushesStrong` defaulted to
//     false — and even when true it was an ALTERNATIVE route to Strong
//     rather than an additional requirement. It is now a scored factor,
//     second only to the stage itself.
//
// Weights are deliberately grounded in what the file actually carries:
// BANT is present on only 6% of rows, so it cannot be a main lever, but it
// is the closest thing to a customer saying something and is weighted to
// matter when it IS there. Employees (0%) and industry (0%) are not
// scored at all — inventing a factor out of an empty column would just add
// noise with a confident-looking number on it.

export interface SmcWeights {
  /** Cloud Ascent's own verdict on where the account is. */
  stage: number;
  /** Prioritization index — the independent signal, see note 2 above. */
  index: number;
  /** They do not already own it: the whole point of a whitespace play. */
  whitespace: number;
  /** A real BANT line. Rare, but it is a human saying something. */
  bant: number;
  /** Can you actually work it — phone, email, a name. */
  reach: number;
  /** How fresh the campaign behind the lead is. */
  recency: number;
}

export const DEFAULT_SMC_WEIGHTS: SmcWeights = {
  stage: 30, index: 25, whitespace: 15, bant: 15, reach: 10, recency: 5,
};

export const SMC_WEIGHT_META: Record<keyof SmcWeights, { label: string; hint: string }> = {
  stage: { label: "Propensity stage", hint: "Act Now / Evaluate / Nurture / Educate, best row on a line Wired CIO sells. Fit is the same signal and is not scored twice." },
  index: { label: "Prioritization index", hint: "Microsoft's own priority on the account. Independent of the stage — within Act Now it is High only 36% of the time." },
  whitespace: { label: "Whitespace", hint: "They do not already own the product. Owning it scores nothing here." },
  bant: { label: "BANT on file", hint: "A stated Need counts most, then Authority, Budget, Timeline. Present on only 6% of rows, so it lifts the ones that have it." },
  reach: { label: "Reachable", hint: "A phone and an email you can work it with. A job title adds a little." },
  recency: { label: "Campaign recency", hint: "FY26 full marks, FY25 half, older nothing. A stale campaign is excluded outright before scoring." },
};

/** Stage → how much of the stage weight it earns. Act Now is the only one
 *  that earns it all; Educate is barely a lead. */
const STAGE_FRACTION: Record<SmcStage, number> = {
  "Act Now": 1, Evaluate: 0.55, Nurture: 0.25, Educate: 0.1, Unknown: 0,
};
/** Index → fraction. Very Low earns nothing: over half of Act Now rows sit
 *  there, so treating it as partial credit would defeat the tightening. */
const INDEX_FRACTION: Record<SmcLevel, number> = {
  High: 1, Medium: 0.5, Low: 0.2, "Very Low": 0, Unknown: 0,
};
/** BANT fields are not equal. A Need is the customer's own problem stated
 *  out loud; a Timeline without one is a date attached to nothing. */
const BANT_FRACTION: { key: keyof SmcLead["bant"]; share: number }[] = [
  { key: "need", share: 0.4 }, { key: "authority", share: 0.25 },
  { key: "budget", share: 0.2 }, { key: "timeline", share: 0.15 },
];

export interface SmcScoreRules {
  /** At or above this, High priority. */
  strongAt: number;
  /** At or above this, Medium priority. Below it, Low. */
  reviewAt: number;
  /**
   * Points added when the blob states nobody holds the account, and taken
   * away when it names a reseller. A flat adjustment rather than a seventh
   * weighted factor ON PURPOSE: a weighted factor divides every row by a
   * bigger denominator, so the 97% of rows that state no partner either
   * way would silently lose points for saying nothing. This moves only the
   * rows that actually state something, and leaves every other score
   * exactly where Jack already tuned it.
   */
  partnerAdjust: number;
}
export const DEFAULT_SMC_SCORE_RULES: SmcScoreRules = { strongAt: 60, reviewAt: 25, partnerAdjust: 8 };

export interface SmcScore {
  score: number;
  breakdown: string[];
  factorPoints: Record<keyof SmcWeights, number>;
  /** The best qualifying opportunity the score was built from, if any. */
  best: Opportunity | null;
  /** Jack's top-quality flag here, the analogue of "wants a partner" on
   *  CSP: a stated BANT Need on an Act Now whitespace account. The only
   *  place in this data where a human wrote down what the customer wants. */
  statedNeed: boolean;
  /** All of it at once: stated Need, Act Now, High index, whitespace. */
  perfect: boolean;
  /** Who holds the account, per the blob. "unknown" on most rows. */
  partnerPosture: SmcPartnerPosture;
  /** The cleaned partner value, "" when none was stated. */
  partnerName: string;
  /** The points the posture moved the score by: +n, -n, or 0. */
  partnerAdjust: number;
}

/** The opportunity the score is built from: the best row on a sold line,
 *  ranked by stage first and then by index, so a High-index Act Now row
 *  beats a Very-Low-index one on the same account. */
export function bestOpportunity(lead: SmcLead, rules: SmcRules): Opportunity | null {
  const ops = opportunities(lead).filter((o) => {
    const line = PRODUCT_LINE_OF[o.product];
    return !!line && rules.lines.includes(line);
  });
  if (!ops.length) return null;
  return ops.slice().sort((a, b) =>
    (STAGE_FRACTION[b.stage] - STAGE_FRACTION[a.stage])
    || (INDEX_FRACTION[b.index] - INDEX_FRACTION[a.index])
    || (Number(a.owned) - Number(b.owned)))[0];
}

export function bantDepth(lead: SmcLead): number {
  return BANT_FRACTION.reduce((n, f) => n + (lead.bant[f.key] ? f.share : 0), 0);
}

export function scoreSmcLead(
  lead: SmcLead,
  campaign: Campaign | undefined,
  rules: SmcRules,
  weights: SmcWeights = DEFAULT_SMC_WEIGHTS,
  reach: { hasPhone: boolean; hasEmail: boolean; hasTitle: boolean } = { hasPhone: false, hasEmail: false, hasTitle: false },
  partnerAdjust: number = DEFAULT_SMC_SCORE_RULES.partnerAdjust,
): SmcScore {
  const w = weights;
  const total = w.stage + w.index + w.whitespace + w.bant + w.reach + w.recency || 1;
  const breakdown: string[] = [];
  const raw: Record<keyof SmcWeights, number> = { stage: 0, index: 0, whitespace: 0, bant: 0, reach: 0, recency: 0 };
  const add = (k: keyof SmcWeights, label: string, fraction: number) => {
    const pts = w[k] * Math.max(0, Math.min(1, fraction));
    raw[k] = pts;
    if (pts > 0) breakdown.push(`${label} +${Math.round((100 * pts) / total)}`);
    return pts;
  };

  const best = bestOpportunity(lead, rules);
  const fy = campaign && !campaign.empty ? fiscalYearNumber(campaign) : -1;

  // The "Stage counts" checkboxes still mean what they always meant: a
  // stage you have unticked does not count. Under scoring that is zero
  // points on the stage factor rather than an outright disqualification —
  // the lead can still earn its index, whitespace, BANT, reach and recency
  // points, so unticking a stage demotes it instead of hiding it. Without
  // this the checkboxes would have become decoration, which is exactly the
  // trap the removed "Also push Strong" boxes fell into.
  const stageCounts = !!best && rules.stages.includes(best.stage);
  add("stage",
      !best ? "no propensity on a sold line"
        : stageCounts ? `${best.stage} on ${best.product}`
        : `${best.stage} on ${best.product} (stage not counted)`,
      stageCounts ? STAGE_FRACTION[best.stage] : 0);
  add("index", best ? `${best.index} prioritization index` : "no index", best ? INDEX_FRACTION[best.index] : 0);
  add("whitespace", best && !best.owned ? "does not own it yet" : "already owned", best && !best.owned ? 1 : 0);
  const depth = bantDepth(lead);
  add("bant", depth > 0 ? `BANT: ${BANT_FRACTION.filter((f) => lead.bant[f.key]).map((f) => f.key).join(", ")}` : "no BANT stated", depth);
  add("reach", reach.hasPhone && reach.hasEmail ? "phone + email" : reach.hasPhone ? "phone only" : reach.hasEmail ? "email only" : "no phone or email",
      (reach.hasPhone ? 0.65 : 0) + (reach.hasEmail ? 0.35 : 0));
  add("recency", fy >= 26 ? `${campaign?.fiscalYear} campaign` : fy === 25 ? `${campaign?.fiscalYear} campaign` : "older or undated campaign",
      fy >= 26 ? 1 : fy === 25 ? 0.5 : 0);

  const sum = (Object.keys(raw) as (keyof SmcWeights)[]).reduce((n, k) => n + raw[k], 0);
  const base = Math.round((100 * sum) / total);

  // Partner lane, applied after the weighted score rather than inside it —
  // see SmcScoreRules.partnerAdjust for why. A row that states nothing is
  // untouched, which is the whole point.
  const partnerPosture = partnerPostureOf(lead);
  const partnerName = (lead.bant.partner || "").trim();
  const adj = Math.max(0, Math.round(partnerAdjust));
  const partnerDelta = partnerPosture === "open" ? adj : partnerPosture === "held" ? -adj : 0;
  const score = Math.max(0, Math.min(100, base + partnerDelta));
  if (partnerDelta > 0) breakdown.push(`no partner on it +${partnerDelta}`);
  else if (partnerDelta < 0) breakdown.push(`${partnerName} already holds it ${partnerDelta}`);
  const factorPoints = Object.fromEntries(
    (Object.keys(raw) as (keyof SmcWeights)[]).map((k) => [k, Math.round((100 * raw[k]) / total)]),
  ) as Record<keyof SmcWeights, number>;

  const actNowWhitespace = !!best && best.stage === "Act Now" && rules.stages.includes("Act Now") && !best.owned;
  const statedNeed = !!lead.bant.need && actNowWhitespace;
  const perfect = statedNeed && !!best && best.index === "High";
  if (perfect) breakdown.unshift("★ stated need, Act Now, High index, not owned — pinned to the top");
  else if (statedNeed) breakdown.unshift("⚑ a stated need on an Act Now whitespace account — top quality");

  return { score, breakdown, factorPoints, best, statedNeed, perfect, partnerPosture, partnerName, partnerAdjust: partnerDelta };
}

/** Rank for the table and the downloads: pinned, then top quality, then
 *  score. Mirrors compareCspLeads so the two scanners sort alike. */
export function compareSmcScores(a: SmcScore | undefined, b: SmcScore | undefined): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  if (a.perfect !== b.perfect) return a.perfect ? -1 : 1;
  if (a.statedNeed !== b.statedNeed) return a.statedNeed ? -1 : 1;
  return b.score - a.score;
}

/** A hot word in the campaign title. Context for the row, never a
 *  qualifier — see the note in hotWordHit for why. */
export function hotWordContext(campaignName: string, rules: SmcRules = DEFAULT_SMC_RULES): string {
  const stems = stemsOf(rules.hotWords);
  const low = (campaignName || "").toLowerCase();
  return stems.find((st) => low.includes(st)) ?? "";
}

/** The factor list in display order, same shape as the CSP tab's
 *  WEIGHT_META so both scanners feed the one breakdown panel. */
export const SMC_FACTOR_META: { key: keyof SmcWeights; label: string; hint: string }[] =
  (["stage", "index", "whitespace", "bant", "reach", "recency"] as const)
    .map((key) => ({ key, ...SMC_WEIGHT_META[key] }));
