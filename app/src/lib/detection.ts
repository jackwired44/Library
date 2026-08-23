// Detection engine — ported from legacy/unified-tool.js PARTs 1-4. Same
// rules, same regexes, now typed. See ../../../CLAUDE.md "Detection
// engine" for the human-readable rule summary; this is the source of truth.

export type Tier = "signal" | "mention" | "dq";
export type CategoryKey = "m365Tenant" | "dynamics365" | "dataPlatform";
export type BucketKey = "m365Tenant" | "dynamics" | "dataPlatform";

export interface CategoryMeta {
  label: string;
  color: string;
  bg: string;
  bucket: BucketKey;
}

export const CATEGORY_META: Record<CategoryKey, CategoryMeta> = {
  m365Tenant: { label: "M365 Tenant", color: "#B34A1F", bg: "#FBE7DB", bucket: "m365Tenant" },
  dynamics365: { label: "Dynamics 365", color: "#5B3FC4", bg: "#EEEAFC", bucket: "dynamics" },
  dataPlatform: { label: "Power BI / Azure / Fabric", color: "#1470A0", bg: "#E1F1FA", bucket: "dataPlatform" },
};

export const BUCKET_META: Record<BucketKey, { label: string; slug: string }> = {
  m365Tenant: { label: "M365 Tenant", slug: "m365-tenant" },
  dynamics: { label: "Dynamics", slug: "dynamics" },
  dataPlatform: { label: "Power BI / Azure / Fabric", slug: "power-bi-azure-fabric" },
};

export const BUCKET_LABEL: Record<BucketKey, string> = {
  m365Tenant: CATEGORY_META.m365Tenant.label,
  dynamics: CATEGORY_META.dynamics365.label,
  dataPlatform: CATEGORY_META.dataPlatform.label,
};

// Default-category priority when a row trips more than one bucket — a
// default only, every row stays manually reassignable regardless.
const CATEGORY_PRIORITY: CategoryKey[] = ["dynamics365", "dataPlatform", "m365Tenant"];

/* ------------------------------------------------------------------ */
/* Licensing (Microsoft SKU / seat-count) engine                        */
/* ------------------------------------------------------------------ */
// Exported (not just used internally) so the Cheat Sheet can list the exact
// SKUs/reasons this file matches instead of a hand-copied list that could
// drift from the real rules.
export const SKU_CATALOGUE: { label: string; pattern: RegExp }[] = [
  { label: "Microsoft 365 Business Basic", pattern: /\b(m(?:icrosoft)?\s*365\s*business\s*basic|biz\s*basic)\b/i },
  { label: "Microsoft 365 Business Standard", pattern: /\b(m(?:icrosoft)?\s*365\s*business\s*std|m(?:icrosoft)?\s*365\s*business\s*standard|business\s*standard)\b/i },
  { label: "Microsoft 365 Business Premium", pattern: /\b(m(?:icrosoft)?\s*365\s*business\s*prem(?:ium)?|business\s*premium|biz\s*prem)\b/i },
  { label: "Office 365 E1", pattern: /\bo(?:ffice)?\s*365\s*e1\b/i },
  { label: "Office 365 E3", pattern: /\bo(?:ffice)?\s*365\s*e3\b/i },
  { label: "Microsoft 365 E3", pattern: /\b(m(?:icrosoft)?\s*365\s*e3|spe[\s_-]?e3)\b/i },
  { label: "Microsoft 365 E5", pattern: /\b(m(?:icrosoft)?\s*365\s*e5|spe[\s_-]?e5)\b/i },
  { label: "Microsoft 365 E7", pattern: /\bm(?:icrosoft)?\s*365\s*e7\b/i },
  { label: "Microsoft 365 F1 / F3 (Frontline)", pattern: /\b(m(?:icrosoft)?\s*365\s*f1|m(?:icrosoft)?\s*365\s*f3|frontline\s*license)\b/i },
  { label: "Enterprise Mobility + Security (EMS)", pattern: /\b(ems\s*e[35]|enterprise\s*mobility\s*\+?\s*security)\b/i },
  { label: "Power BI Pro / Premium", pattern: /\bpower\s*bi\s*(pro|premium)?\b/i },
  { label: "Microsoft 365 Copilot", pattern: /\b(m(?:icrosoft)?\s*365\s*copilot|copilot\s*licens\w*|copilot\s*seats?)\b/i },
  { label: "Defender for Business / Office 365 / Endpoint", pattern: /\bdefender\s*for\s*(business|office\s*365|endpoint)\b/i },
  { label: "Entra ID P1 / P2", pattern: /\bentra\s*id\s*p[12]\b/i },
  { label: "Teams Phone", pattern: /\bteams\s*phone\b/i },
  { label: "Teams Calling Plan", pattern: /\bteams\s*calling\s*plan\b/i },
  { label: "Intune", pattern: /\bintune\b/i },
  { label: "Bare E3 / E5 mention", pattern: /(?<![a-z0-9])(e[35])(?![a-z0-9])/i },
];
const COUNT_PATTERNS: RegExp[] = [
  /(\d{1,4})\s*\+?\s*(users?|seats?|licenses?|licences?|employees?|people|mailboxes?)\b/i,
  /\b(users?|seats?|licenses?|licences?)\s*[:\-]?\s*(\d{1,4})\b/i,
  /\bx\s*(\d{1,4})\b/i,
  /(\d{1,4})\s*x\b/i,
];
const WINDOW = 65;
export const QUALIFY_THRESHOLD = 15; // seats/users below this auto-DQ — lowered from 20 per Jack's rules audit

function extractCountNear(haystack: string, matchIndex: number, matchLength: number) {
  const start = Math.max(0, matchIndex - WINDOW);
  const end = Math.min(haystack.length, matchIndex + matchLength + WINDOW);
  const win = haystack.slice(start, end);
  let best: number | null = null;
  for (const re of COUNT_PATTERNS) {
    const m = win.match(re);
    if (m) {
      const num = parseInt(m[1] && /^\d+$/.test(m[1]) ? m[1] : m[2], 10);
      if (!Number.isNaN(num)) {
        if (best === null || num > best) best = num;
      }
    }
  }
  return { count: best, window: win.trim() };
}

export interface LicensingResult {
  skus: string[];
  count: number | null;
  snippet: string;
  status: "qualified" | "review" | "dq";
}

// Returns null if nothing found. A confirmed count under QUALIFY_THRESHOLD
// still comes back (status: "dq") rather than vanishing — visible in Bad
// Leads, not silently dropped.
export function scanRowLicensing(row: Record<string, unknown>, columns: string[]): LicensingResult | null {
  const fields = columns.map((c) => String(row[c] ?? ""));
  const combined = fields.join("   ");
  const hits: { sku: string; count: number | null; snippet: string }[] = [];
  for (const sku of SKU_CATALOGUE) {
    const re = new RegExp(sku.pattern.source, sku.pattern.flags.includes("g") ? sku.pattern.flags : sku.pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(combined)) !== null) {
      const { count, window } = extractCountNear(combined, m.index, m[0].length);
      hits.push({ sku: sku.label, count, snippet: window });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  if (hits.length === 0) return null;
  const skuSet = [...new Set(hits.map((h) => h.sku))];
  const countsFound = hits.map((h) => h.count).filter((c): c is number => c !== null);
  const bestCount = countsFound.length ? Math.max(...countsFound) : null;
  const bestSnippetHit = hits.find((h) => h.count === bestCount && bestCount !== null) || hits[0];
  const status: LicensingResult["status"] = bestCount === null ? "review" : bestCount < QUALIFY_THRESHOLD ? "dq" : "qualified";
  return { skus: skuSet, count: bestCount, snippet: bestSnippetHit.snippet, status };
}

/* ------------------------------------------------------------------ */
/* Platform (Dynamics / Power BI / Fabric / Azure / Migration) engine   */
/* ------------------------------------------------------------------ */
const TENANT_SUPPORT_LABEL = "Tenant Support";
const MIGRATION_LABEL = "Migration / Modernization";

const PLATFORM_CATALOGUE: { label: string; pattern: RegExp }[] = [
  {
    label: "Dynamics 365",
    pattern:
      /\b(dynamics\s*365|d\s*365|dyn\s*365|dynamics\s*crm|dynamics\s*ax|dynamics\s*nav|dynamics\s*gp|business\s*central|finance\s*(?:and|&)\s*operations|customer\s*engagement|supply\s*chain(?:\s*management)?|erp)\b/i,
  },
  {
    label: "Power BI",
    pattern:
      /\bpower\s*bi\b|\b(analytic(?:al|s)?\s*dashboards?|data\s*dashboards?|reporting\s*dashboards?|kpi\s*dashboards?|real-?time\s*dashboards?|business\s*intelligence|bi\s*(?:tool|platform|solution)|data\s*visuali[sz]ations?|data\s*viz|analytics\s*platform|leverage\w*\s*(?:our|their|my)?\s*data|make\s*sense\s*of\s*(?:our|their|the|my)?\s*data|data[\s-]?driven\s*decisions?|self-?service\s*(?:bi|reporting)|data\s*insights?)\b/i,
  },
  { label: "Microsoft Fabric", pattern: /\b(microsoft\s*fabric|onelake)\b/i },
  { label: "Azure", pattern: /\bazure\b/i },
  {
    label: MIGRATION_LABEL,
    pattern:
      /\b(data\s*migration|cloud\s*migration|legacy\s*system|migrating(?:\s*(?:off|from|to))?|moving\s*(?:off|away\s*from)|re-?platform(?:ing)?|lift\s*and\s*shift|moderniz\w+|on-?prem\s*to\s*cloud)\b/i,
  },
  {
    label: TENANT_SUPPORT_LABEL,
    pattern:
      /\b(google\s*workspace|g\s*suite|gmail\s*for\s*(?:work|business))\b.{0,60}\b(microsoft(?:\s*365)?|office\s*365|m365)\b|\b(microsoft(?:\s*365)?|office\s*365|m365)\b.{0,60}\b(google\s*workspace|g\s*suite)\b|\bgoogle\s*to\s*microsoft\b|\bmigrat\w*\s*(?:off|from|away\s*from)?\s*google\b|\btenant\s*(?:creation|setup|set\s*up|provisioning|onboarding|migration|support)\b|\b(?:create|creating|set(?:ting)?\s*up|stand(?:ing)?\s*up|provision(?:ing)?)\s*(?:a\s*)?(?:new\s*)?tenant\b|\bnew\s*tenant\b|\b(msp|managed\s*(?:it\s*)?services?|managed\s*service\s*providers?|co-?managed\s*it|outsourced?\s*it|it\s*outsourcing|long[\s-]?term\s*(?:partner|relationship)|ongoing\s*(?:it\s*)?support|dedicated\s*(?:it\s*)?partner|trusted\s*(?:it\s*)?partner|strategic\s*(?:it\s*)?partner|extension\s*of\s*(?:our|their|my)\s*team|third[\s-]?party\s*(?:support|help|it)|3rd[\s-]?party\s*(?:support|help|it)|committed\s*(?:it\s*)?relationship|it\s*support|technical\s*support|help\s*desk|helpdesk|support\s*(?:contract|plan|request|ticket|team)|need(?:s|ing)?\s*(?:it\s*)?support|looking\s*for\s*(?:it\s*)?support)\b/i,
  },
];
const PLATFORM_LABEL_TO_KEY: Record<string, CategoryKey> = {
  "Dynamics 365": "dynamics365",
  "Power BI": "dataPlatform",
  "Microsoft Fabric": "dataPlatform",
  Azure: "dataPlatform",
  [MIGRATION_LABEL]: "m365Tenant",
  [TENANT_SUPPORT_LABEL]: "m365Tenant",
};

const TRIGGER_WORDS_RE =
  /\b(migrat\w+|implement\w+|replac\w+|upgrad\w+|evaluat\w+|rfp|roll\s*out|go[\s-]?live|deploy\w+|modern\w+|switch\w+|outgrow\w+|budget|timeline|planning\s*to|looking\s*to|considering|this\s*year|next\s*quarter|q[1-4]\b)/i;
const LICENSE_COUNT_RE = /\b(?!1\s*(?:users?|seats?|licenses?|licences?|suers)\b)\d+\s*(?:users?|seats?|licenses?|licences?|suers)\b/i;
const GROWTH_OVERLOAD_RE =
  /\b(growing\s*(?:fast|rapidly|quickly)?|growth|scaling\s*(?:up|fast)?|too\s*much\s*on\s*(?:our|my|their)\s*plate|stretched\s*(?:too\s*)?thin|wearing\s*too\s*many\s*hats|understaffed|short[\s-]?staffed|overwhelmed|can'?t\s*keep\s*up|need(?:s|ing)?\s*(?:extra|additional|outside|external|more)\s*help|no\s*(?:internal\s*)?it\s*(?:staff|team|department)|don'?t\s*have\s*(?:an\s*)?it\s*(?:staff|team|department)|outgrow\w+)\b/i;
const AZURE_SCALE_RE = /\b(virtual\s*machines?|\bvms?\b|user\s*count|usage|consumption|adoption)\b/i;
const DYNAMICS_SPECIFIC_INSTANCE_RE =
  /\b(business\s*central|finance\s*(?:and|&)\s*operations|customer\s*engagement|customer\s*insights|contact\s*center|supply\s*chain(?:\s*management)?|dynamics\s*crm|dynamics\s*ax|dynamics\s*nav|dynamics\s*gp|dynamics\s*365\s*sales|dynamics\s*365\s*field\s*service|dynamics\s*365\s*project\s*operations|dynamics\s*365\s*customer\s*service|dynamics\s*365\s*marketing|dynamics\s*365\s*human\s*resources)\b/i;
const DYNAMICS_ESTIMATED_COUNT_RE =
  /\b(?:estimated|approx(?:imately)?|roughly|about|around|a\s*handful\s*of|a\s*few|several|dozens?\s*of|hundreds?\s*of)\b.{0,25}\b(?:users?|seats?|licenses?|licences?|suers|employees?|people|staff)\b/i;
const DYNAMICS_MULTI_MODULE_RE = /\berp\b.{0,30}\bcrm\b|\bcrm\b.{0,30}\berp\b/i;

function hasBareTrailingCount(afterText: string) {
  const snippet = afterText.slice(0, 80);
  const terminatorIdx = snippet.search(/[.!?\n]/);
  const clause = (terminatorIdx === -1 ? snippet : snippet.slice(0, terminatorIdx + 1)).trim();
  return /^[a-z\s\-:,/&]*(?:^|[\s\-:,])(?!1\s*[.,]?$)(?!(?:19|20)\d{2}\s*[.,]?$)\d{1,4}\s*[.,]?$/i.test(clause);
}
function hasBareLeadingCount(beforeText: string) {
  const snippet = beforeText.slice(-80);
  const terminatorIdx = snippet.search(/[.!?\n](?=[^.!?\n]*$)/);
  const clause = (terminatorIdx === -1 ? snippet : snippet.slice(terminatorIdx + 1)).trim();
  const m = /^(\d{1,4})\b(?:[\s\-:,/&]|[a-z])*$/i.exec(clause);
  if (!m) return false;
  if (m[1] === "1") return false;
  if (/^(?:19|20)\d{2}$/.test(m[1])) return false;
  return true;
}
// Azure-flavored migration language always stays in Power BI/Azure/Fabric,
// never the generic Migration signal (which rolls up into M365 Tenant).
const AZURE_MIGRATION_OVERRIDE_RE =
  /\bazure\b[^.!?\n]{0,80}\bmigrat\w*\b|\bmigrat\w*\b[^.!?\n]{0,80}\bazure\b|\bon-?prem\w*\s*(?:to|into|→)\s*(?:the\s*)?cloud\b|\bon-?prem\w*\b[^.!?\n]{0,80}\bazure\b|\bazure\b[^.!?\n]{0,80}\bon-?prem\w*\b|\blift\s*and\s*shift\b[^.!?\n]{0,80}\bazure\b|\bazure\b[^.!?\n]{0,80}\blift\s*and\s*shift\b/i;

const DATE_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*\d{0,2}(?:st|nd|rd|th)?,?\s*\d{0,4}\b|\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b(?:19|20)\d{2}\b|\bQ[1-4]\b|\b(?:this|next|last)\s+(?:year|quarter|month|week)\b/i;
const BILLING_BANT_RE =
  /\$\s?\d[\d,]*(?:\.\d{1,2})?\b|\b\d+\s*(?:k|thousand|million)\b|\b(budget|pricing|price|quote|quoted|cost|contract|renewal|renew\w*|invoice|deadline|timeline|decision[\s-]?maker|approv\w*|procurement|purchase\s*order|\bpo\b|per\s*(?:seat|user|month|year))\b/i;
const SERIAL_RE = /\b(?:serial|order|invoice|case|ticket|ref(?:erence)?)\s*#?\s*[:\-]?\s*[a-z0-9-]{4,}\b|\b[a-z]{1,3}-?\d{4,}\b|\b\d{5,}\b/i;
function hasForbiddenContent(s: string) {
  return DATE_RE.test(s) || BILLING_BANT_RE.test(s) || SERIAL_RE.test(s);
}
const CATEGORY_BLURBS: Record<string, string> = {
  "Dynamics 365": "modernizing their CRM/ERP setup",
  "Power BI": "improving reporting and analytics",
  "Microsoft Fabric": "consolidating their data platform",
  Azure: "evaluating cloud infrastructure",
  [MIGRATION_LABEL]: "migrating off their current systems",
  [TENANT_SUPPORT_LABEL]: "setting up or supporting their M365 tenant — new tenant creation, migrating from Google, or ongoing IT support",
};
function fallbackSummary(categories: string[]) {
  if (!categories.length) return "";
  return `Interested in ${categories.map((c) => CATEGORY_BLURBS[c] || c.toLowerCase()).join(" and ")}.`;
}
const SIGNAL_WINDOW = 70;
function collapseAbbreviations(text: string) {
  return text.replace(/\b(?:[A-Z]\.){2,}/g, (match, offset: number, full: string) => {
    const letters = match.replace(/\./g, "");
    const after = full.slice(offset + match.length);
    const looksLikeSentenceEnd = /^\s+[A-Z]/.test(after) || after.trim() === "";
    return looksLikeSentenceEnd ? `${letters}.` : letters;
  });
}
function cleanText(raw: unknown): string {
  if (!raw) return "";
  let t = String(raw);
  t = t.replace(/<[^>]*>/g, " ");
  t = t.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/g, "'").replace(/&quot;/gi, '"');
  t = collapseAbbreviations(t);
  t = t.replace(/\s+/g, " ").trim();
  return t;
}
function normalizeSentence(s: string) {
  let t = s.trim();
  t = t.replace(/^(and|but|so|because|which|who|that)\s+/i, "");
  if (!t) return "";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t.replace(/[,;:\-\s]+$/, "");
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}
function truncateAtWord(s: string, maxLen: number) {
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
  return safe.trim().replace(/[,;:\-\s]+$/, "") + ".";
}
function splitSentences(text: string) {
  return (text.match(/[^.!?;\n]+[.!?;]*/g) || []).map((s) => s.trim()).filter(Boolean);
}
function splitIntoUnits(text: string) {
  let units = splitSentences(text);
  if (units.length <= 1 && text.length > 160) {
    let clauses = text.split(/,\s+(?:and|but|so|because|who|which|that)\s+|,\s+/i).map((c) => c.trim()).filter(Boolean);
    if (clauses.length <= 1) clauses = text.split(/\s+and\s+|\s+but\s+|\s+so\s+/i).map((c) => c.trim()).filter(Boolean);
    if (clauses.length > 1) units = clauses;
  }
  return units;
}
function scoreSentence(s: string) {
  let score = 0;
  if (TRIGGER_WORDS_RE.test(s)) score += 3;
  for (const cat of PLATFORM_CATALOGUE) if (cat.pattern.test(s)) score += 2;
  if (/\d/.test(s)) score += 1;
  score += Math.min(s.length, 120) / 120;
  return score;
}
const SUMMARY_MAX_LEN = 130;
function summarizeNotes(raw: unknown, categories: string[], maxLen = SUMMARY_MAX_LEN): string {
  const text = cleanText(raw);
  if (!text) return fallbackSummary(categories);
  const clean = splitIntoUnits(text).map((s) => s.trim()).filter((s) => s && !hasForbiddenContent(s));
  if (clean.length === 0) return fallbackSummary(categories);
  const ranked = clean.map((s) => ({ s, score: scoreSentence(s) })).sort((a, b) => b.score - a.score);
  const fitting = ranked.find((c) => normalizeSentence(c.s).length <= maxLen);
  const sentence = normalizeSentence((fitting || ranked[0]).s);
  return sentence.length <= maxLen ? sentence : truncateAtWord(sentence, maxLen);
}
function summarizeFromSnippets(snippets: string[], categories: string[]): string {
  const unique = [...new Set(snippets.map((s) => cleanText(s)))].filter((s) => !hasForbiddenContent(s));
  if (unique.length === 0) return fallbackSummary(categories);
  const sentence = normalizeSentence(unique[0]);
  return sentence.length <= SUMMARY_MAX_LEN ? sentence : truncateAtWord(sentence, SUMMARY_MAX_LEN);
}

interface PlatformHit {
  category: string;
  snippet: string;
  hasTrigger: boolean;
  fromProductArea?: boolean;
  seatCount?: number | null;
}
export interface PlatformResult {
  categories: string[];
  tier: "signal" | "mention";
  snippet: string;
  notesSummary: string;
  hits: PlatformHit[];
  // The highest seat/user/license count found near a Dynamics 365 match, if
  // any — used to rank Dynamics leads highest-count-first (see CLAUDE.md
  // "Dynamics 365 seat-count ranking"). null when no number was stated;
  // never guessed at or defaulted to 0.
  dynamicsSeatCount: number | null;
}

export function scanRowPlatform(
  row: Record<string, unknown>,
  columns: string[],
  commentsValue: unknown,
  productAreaValue: unknown
): PlatformResult | null {
  const fields = columns.map((c) => String(row[c] ?? ""));
  const combined = fields.join("   ");
  const hits: PlatformHit[] = [];
  for (const cat of PLATFORM_CATALOGUE) {
    const re = new RegExp(cat.pattern.source, cat.pattern.flags.includes("g") ? cat.pattern.flags : cat.pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(combined)) !== null) {
      let start = Math.max(0, m.index - SIGNAL_WINDOW);
      let end = Math.min(combined.length, m.index + m[0].length + SIGNAL_WINDOW);
      let extended = 0;
      while (end < combined.length && /\w/.test(combined[end]) && extended < 15) { end++; extended++; }
      extended = 0;
      while (start > 0 && /\w/.test(combined[start - 1]) && extended < 15) { start--; extended++; }
      const win = combined.slice(start, end).trim();
      hits.push({
        category: cat.label,
        snippet: win,
        hasTrigger:
          TRIGGER_WORDS_RE.test(win) ||
          LICENSE_COUNT_RE.test(win) ||
          (cat.label === TENANT_SUPPORT_LABEL && GROWTH_OVERLOAD_RE.test(win)) ||
          (cat.label === "Azure" && AZURE_SCALE_RE.test(win)) ||
          (cat.label === "Dynamics 365" &&
            (DYNAMICS_MULTI_MODULE_RE.test(win) ||
              (DYNAMICS_SPECIFIC_INSTANCE_RE.test(win) && (LICENSE_COUNT_RE.test(win) || DYNAMICS_ESTIMATED_COUNT_RE.test(win))))) ||
          hasBareTrailingCount(combined.slice(m.index + m[0].length, m.index + m[0].length + 80)) ||
          hasBareLeadingCount(combined.slice(Math.max(0, m.index - 80), m.index)),
        // Same seat/user/license number extraction the licensing engine
        // uses, reused here so a Dynamics lead's real count (not just
        // "a count was mentioned") survives into the result for ranking.
        seatCount: cat.label === "Dynamics 365" ? extractCountNear(combined, m.index, m[0].length).count : null,
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  if (productAreaValue) {
    const paText = String(productAreaValue);
    for (const cat of PLATFORM_CATALOGUE) {
      if (cat.pattern.test(paText)) hits.push({ category: cat.label, snippet: cleanText(paText), hasTrigger: true, fromProductArea: true });
    }
  }
  if (hits.length === 0) return null;
  const categories = [...new Set(hits.map((h) => h.category))];
  const tier: "signal" | "mention" = hits.some((h) => h.hasTrigger) ? "signal" : "mention";
  const bestHit = hits.find((h) => h.fromProductArea) || hits.find((h) => h.hasTrigger) || hits[0];
  const notesSummary = commentsValue ? summarizeNotes(commentsValue, categories) : summarizeFromSnippets(hits.map((h) => h.snippet), categories);
  const dynamicsCounts = hits.filter((h) => h.category === "Dynamics 365" && h.seatCount != null).map((h) => h.seatCount as number);
  const dynamicsSeatCount = dynamicsCounts.length ? Math.max(...dynamicsCounts) : null;
  return { categories, tier, snippet: bestHit.snippet, notesSummary, hits, dynamicsSeatCount };
}

/* ------------------------------------------------------------------ */
/* Auto-DQ ("Bad Leads") — cross-cutting, always wins over category/tier */
/* ------------------------------------------------------------------ */
export const DQ_RULES: { label: string; pattern: RegExp }[] = [
  {
    label: "Single seat/user or freelancer",
    pattern:
      /\b(?:1|one|single)\s*(?:seat|user|license|licence)\b|\bfor\s*(?:1|one)\s*person\b|\bjust\s*(?:me|myself)\b|\bfor\s*myself\b|\bsolo\b|\bone-?man\b|\bfreelance(?:r)?\b|\bindependent\s*contractor\b|\bsole\s*proprietor(?:ship)?\b|\bself-?employed\b|\bsolopreneur\b/i,
  },
  {
    label: "Not interested / explicit rejection",
    pattern:
      /\bnot\s*interested\b|\bno\s*thanks\b|\bnot\s*(?:right\s*)?now\b|\bdecided\s*against\b|\bwent\s*with\s*(?:a\s*)?competitor\b|\bdo\s*not\s*contact\b|\bunsubscribe\b|\bremove\s*me\b|\bstop\s*contacting\b|\bnot\s*a\s*fit\b/i,
  },
  {
    label: "Happy with current provider / locked in",
    pattern: /\bhappy\s*with\s*(?:our|their|my|the)?\s*current\b|\bsatisfied\s*with\s*(?:our|their|my|the)?\s*current\b|\bjust\s*renewed\b|\bjust\s*signed\b|\blocked\s*in(?:to)?\b|\bunder\s*contract\b/i,
  },
  { label: "Personal / non-business use", pattern: /\bfor\s*personal\s*use\b|\bhome\s*use\b|\bhobby\s*project\b|\bfor\s*school\b|\bstudent\s*project\b/i },
  {
    label: "Basic support / login issue",
    pattern:
      /\bpassword\s*reset\b|\bforgot(?:ten)?\s*(?:my\s*)?password\b|\bcan'?t\s*log\s*in\b|\bcannot\s*log\s*in\b|\blocked\s*out\s*of\s*(?:my|our|their)?\s*account\b|\blog-?in\s*(?:issue|problem|trouble)\b|\busername\s*(?:issue|problem|reset|recovery)\b|\baccount\s*login\b|\bhow\s*do\s*i\s*(?:log\s*in|reset\s*my\s*password)\b/i,
  },
  {
    label: "Wants direct Microsoft support",
    pattern: /\bcontact\s*microsoft\s*support\b|\bmicrosoft\s*support\s*(?:ticket|case|line)\b|\bopen\s*a\s*case\s*with\s*microsoft\b|\bcall\s*microsoft\b|\bmicrosoft\s*technical\s*support\b/i,
  },
];
const PLACEHOLDER_EMAIL_RE = /^(?:test|noemail|none|na|asdf|example|foo|bar|sample|placeholder|xxx+)@|@(?:test|example)\.(?:com|org|net)$/i;

export interface ResolvedFields {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  title?: string;
  company?: string;
  email?: string;
  workPhone?: string;
  mobilePhone?: string;
  employees?: string;
  productArea?: string;
  comments?: string;
}

function getDQReasons(combinedText: string, resolved: ResolvedFields, licensing: LicensingResult | null): string[] {
  const reasons: string[] = [];
  for (const rule of DQ_RULES) if (rule.pattern.test(combinedText)) reasons.push(rule.label);
  if (licensing && licensing.status === "dq") reasons.push(`Low seat count (under ${QUALIFY_THRESHOLD})`);
  if (!resolved.company || !String(resolved.company).trim()) reasons.push("Missing company name");
  if (resolved.email && PLACEHOLDER_EMAIL_RE.test(String(resolved.email).trim())) reasons.push("Placeholder/invalid email");
  return reasons;
}

/* ------------------------------------------------------------------ */
/* Unified scan — runs both engines, resolves to one product line       */
/* ------------------------------------------------------------------ */
export interface ScanResult {
  categories: CategoryKey[];
  autoCategory: CategoryKey;
  category: CategoryKey; // mutable — manual reassignment changes this
  tier: Tier;
  dqReasons: string[];
  licensing: LicensingResult | null;
  platform: { snippet: string } | null;
  notesSummary: string;
  // Highest Dynamics 365 seat/user/license count stated, if any — null
  // means none was stated, never a guessed 0. See "Dynamics 365 seat-count
  // ranking" in CLAUDE.md.
  dynamicsSeatCount: number | null;
}

export function scanRowUnified(row: Record<string, unknown>, columns: string[], resolved: ResolvedFields): ScanResult | null {
  const licensing = scanRowLicensing(row, columns);
  const platform = scanRowPlatform(row, columns, resolved.comments || null, resolved.productArea || null);
  if (!licensing && !platform) return null;

  const categorySet = new Set<CategoryKey>();
  if (platform) {
    platform.hits.forEach((h) => {
      if (h.category === MIGRATION_LABEL && AZURE_MIGRATION_OVERRIDE_RE.test(h.snippet)) {
        categorySet.add("dataPlatform");
      } else {
        const key = PLATFORM_LABEL_TO_KEY[h.category];
        if (key) categorySet.add(key);
      }
    });
  }
  let licensingTier: Tier | null = null;
  if (licensing) {
    categorySet.add("m365Tenant");
    licensingTier = licensing.status === "qualified" ? "signal" : "mention";
  }
  if (categorySet.size === 0) return null;
  const categories = [...categorySet];
  const autoCategory = CATEGORY_PRIORITY.find((k) => categorySet.has(k)) || categories[0];
  let tier: Tier = (platform && platform.tier === "signal") || licensingTier === "signal" ? "signal" : "mention";

  let notesSummary: string;
  if (platform) notesSummary = platform.notesSummary;
  else {
    const scrubbed = summarizeFromSnippets([licensing!.snippet], []);
    notesSummary = scrubbed || `Interested in ${licensing!.skus.join(", ")}${licensing!.count ? ` (~${licensing!.count} seats)` : ""}.`;
  }

  const combinedForDQ = columns.map((c) => String(row[c] ?? "")).join("   ");
  const dqReasons = getDQReasons(combinedForDQ, resolved, licensing);
  if (dqReasons.length > 0) tier = "dq";

  return {
    categories,
    autoCategory,
    category: autoCategory,
    tier,
    dqReasons,
    licensing,
    platform: platform ? { snippet: platform.snippet } : null,
    notesSummary,
    dynamicsSeatCount: platform ? platform.dynamicsSeatCount : null,
  };
}

/* ------------------------------------------------------------------ */
/* Column resolution                                                    */
/* ------------------------------------------------------------------ */
function normalizeKey(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
export function guessColumn(columns: string[], candidates: string[]): string | null {
  const normCols = columns.map((c) => ({ raw: c, norm: normalizeKey(c) }));
  for (const cand of candidates) {
    const normCand = normalizeKey(cand);
    const found = normCols.find((c) => c.norm === normCand) || normCols.find((c) => c.norm.includes(normCand));
    if (found) return found.raw;
  }
  return null;
}
export interface FieldDef {
  key: keyof ResolvedFields;
  label: string;
  candidates: string[];
}
export const FIELD_DEFS: FieldDef[] = [
  { key: "firstName", label: "First Name", candidates: ["firstname", "givenname"] },
  { key: "lastName", label: "Last Name", candidates: ["lastname", "surname", "familyname"] },
  { key: "fullName", label: "Full Name", candidates: ["fullname", "contactname", "leadname", "personname"] },
  { key: "title", label: "Title", candidates: ["title", "jobtitle"] },
  { key: "company", label: "Company Name", candidates: ["companyname", "company", "account", "organization"] },
  { key: "email", label: "Email", candidates: ["email", "emailaddress"] },
  {
    key: "workPhone",
    label: "Work Direct Phone",
    candidates: ["workdirectphone", "workphone", "directphone", "businessphone", "officephone", "primaryphone", "phonenumber", "directdial", "phone", "nocolumnname"],
  },
  { key: "mobilePhone", label: "Mobile Phone", candidates: ["mobilephone", "cellphone", "cellnumber", "mobilenumber", "mobile", "cell"] },
  { key: "employees", label: "Number of Employees", candidates: ["numberofemployees", "employees", "headcount", "companysize", "numemployees"] },
  { key: "productArea", label: "Product Area", candidates: ["mspsolutionareaname", "productarea", "solutionarea"] },
  { key: "comments", label: "Notes", candidates: ["notes", "comments", "notessummary", "description", "callnotes", "background", "details", "summary", "message", "about", "bio"] },
];
export const PHONE_LIKE_RE = /phone|mobile|\bcell\b|\btel\b|direct\s*dial/i;
export const EXPORT_LABELS = ["First Name", "Last Name", "Title", "Company Name", "Email", "Work Direct Phone", "Mobile Phone", "Number of Employees", "Product Area", "Notes"] as const;
export type ExportLabel = (typeof EXPORT_LABELS)[number];
export type ExportRow = Record<ExportLabel, string>;

export function getFullName(f: ResolvedFields): string {
  const combined = `${f.firstName || ""} ${f.lastName || ""}`.trim();
  return combined || String(f.fullName || "").trim();
}

export interface ResultRow {
  id: string;
  row: { __f: ResolvedFields } & Record<string, unknown>;
  sourceFile: string;
  crossedOut: boolean;
  isDuplicate: boolean;
  duplicateOfId: string | null;
  duplicateGroupSize?: number;
  dupKey?: string | null;
  category: CategoryKey;
  autoCategory: CategoryKey;
  categories: CategoryKey[];
  tier: Tier;
  dqReasons: string[];
  licensing: LicensingResult | null;
  platform: { snippet: string } | null;
  notesSummary: string;
  dynamicsSeatCount: number | null;
  // Present only on shallow copies made for a combined History view.
  __sourceEntryId?: string;
  __sourceRowId?: string;
}

export function buildExportRow(r: Pick<ResultRow, "row" | "category" | "notesSummary">): ExportRow {
  const f = r.row.__f;
  const fallbackFull = !f.firstName && !f.lastName ? f.fullName || "" : "";
  return {
    "First Name": f.firstName || fallbackFull,
    "Last Name": f.lastName || "",
    Title: f.title || "",
    "Company Name": f.company || "",
    Email: f.email || "",
    "Work Direct Phone": f.workPhone || "",
    "Mobile Phone": f.mobilePhone || "",
    "Number of Employees": f.employees || "",
    "Product Area": CATEGORY_META[r.category].label,
    Notes: r.notesSummary || "",
  };
}

/* ------------------------------------------------------------------ */
/* Duplicate detection — exact full-name + company match, batch-scoped  */
/* ------------------------------------------------------------------ */
function normalizeDupKey(s: unknown): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
export function markDuplicateLeads(results: ResultRow[]): void {
  const firstSeenId = new Map<string, string>();
  const groupSize = new Map<string, number>();
  results.forEach((r) => {
    const f = r.row.__f;
    const nameKey = normalizeDupKey(getFullName(f));
    const companyKey = normalizeDupKey(f.company);
    r.isDuplicate = false;
    r.duplicateOfId = null;
    r.dupKey = null;
    if (!nameKey || !companyKey) return;
    const key = `${nameKey}|||${companyKey}`;
    r.dupKey = key;
    groupSize.set(key, (groupSize.get(key) || 0) + 1);
    if (firstSeenId.has(key)) {
      r.isDuplicate = true;
      r.duplicateOfId = firstSeenId.get(key)!;
    } else {
      firstSeenId.set(key, r.id);
    }
  });
  results.forEach((r) => { if (r.dupKey) r.duplicateGroupSize = groupSize.get(r.dupKey); });
}

export interface ParsedFile {
  name: string;
  fields: string[];
  data: Record<string, unknown>[];
}

// The mapping + scan pass — runs once per upload/reload, feeds both the
// Scanner/History entry (every row, every tier) and the Library save (just
// the Strong Signal rows).
export function scanParsedFiles(parsedFiles: ParsedFile[]): { results: ResultRow[]; rowsScanned: number } {
  let rowsScanned = 0;
  const results: ResultRow[] = [];
  parsedFiles.forEach((pf, fileIdx) => {
    rowsScanned += pf.data.length;
    const fileMapping: Partial<Record<keyof ResolvedFields, string>> = {};
    FIELD_DEFS.forEach((f) => { fileMapping[f.key] = guessColumn(pf.fields, f.candidates) || undefined; });
    const claimedCols = new Set(Object.values(fileMapping).filter(Boolean) as string[]);
    const unclaimedPhoneCols = pf.fields.filter((c) => !claimedCols.has(c) && PHONE_LIKE_RE.test(c));
    if (!fileMapping.workPhone && unclaimedPhoneCols.length > 0) fileMapping.workPhone = unclaimedPhoneCols.shift();
    if (!fileMapping.mobilePhone && unclaimedPhoneCols.length > 0) fileMapping.mobilePhone = unclaimedPhoneCols.shift();
    pf.data.forEach((row, i) => {
      const resolved: ResolvedFields = {};
      FIELD_DEFS.forEach((f) => {
        const col = fileMapping[f.key];
        (resolved as Record<string, unknown>)[f.key] = col ? row[col] ?? "" : "";
      });
      const scan = scanRowUnified(row, pf.fields, resolved);
      if (!scan) return;
      results.push({
        id: `${fileIdx}-${i}`,
        row: { ...row, __f: resolved },
        sourceFile: pf.name,
        crossedOut: false,
        isDuplicate: false,
        duplicateOfId: null,
        ...scan,
      });
    });
  });
  markDuplicateLeads(results);
  return { results, rowsScanned };
}

// Dynamics 365 ranking, top to bottom: a stated seat/user/license count
// wins over one that isn't, and among stated counts, higher wins — "21
// User" outranks "15 users". A lead with no stated count is never treated
// as a count of 0; it just sinks below every counted lead as its own
// group, in whatever order it was already in (stable sort). Applies only
// where the caller chooses to use it (Dynamics 365 views specifically) —
// see CLAUDE.md "Dynamics 365 seat-count ranking".
export function sortByDynamicsSeatCount<T extends { dynamicsSeatCount?: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.dynamicsSeatCount ?? -Infinity) - (a.dynamicsSeatCount ?? -Infinity));
}

// Shared by the Scanner's "Final downloads" buttons and History's per-entry
// redownload buttons, so the two never diverge on what counts as a bucket's
// export rows (Strong Signal only, Dynamics ranked by seat count).
export function exportRowsForBucket(results: ResultRow[], bucketKey: BucketKey): ExportRow[] {
  let rows = results.filter((r) => r.tier === "signal" && CATEGORY_META[r.category].bucket === bucketKey);
  if (bucketKey === "dynamics") rows = sortByDynamicsSeatCount(rows);
  return rows.map(buildExportRow);
}
