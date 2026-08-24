// Detection engine — ported from legacy/unified-tool.js PARTs 1-4. Same
// rules, same regexes, now typed. See ../../../CLAUDE.md "Detection
// engine" for the human-readable rule summary; this is the source of truth.

export type Tier = "signal" | "mention" | "dq";
// "dataPlatform" is kept as a valid key/bucket ONLY so anything already
// filed under the old "Power BI / Azure / Fabric" category (Library files,
// History entries saved before this merge) keeps rendering correctly —
// see CLAUDE.md "Category merge". No new scan ever produces it: Power
// BI/Azure/Fabric hits now route into "m365Tenant" (relabeled "M365 /
// Azure") alongside Tenant Support/Migration/Licensing. ACTIVE_CATEGORY_KEYS
// / ACTIVE_BUCKET_KEYS below are what new UI (filters, bulk-move, Final
// Downloads) should iterate over — exactly the two live categories.
export type CategoryKey = "m365Tenant" | "dynamics365" | "dataPlatform";
export type BucketKey = "m365Tenant" | "dynamics" | "dataPlatform";
export const ACTIVE_CATEGORY_KEYS: CategoryKey[] = ["dynamics365", "m365Tenant"];
export const ACTIVE_BUCKET_KEYS: BucketKey[] = ["dynamics", "m365Tenant"];

export interface CategoryMeta {
  label: string;
  color: string;
  bg: string;
  bucket: BucketKey;
}

export const CATEGORY_META: Record<CategoryKey, CategoryMeta> = {
  m365Tenant: { label: "M365 / Azure", color: "#B34A1F", bg: "#FBE7DB", bucket: "m365Tenant" },
  dynamics365: { label: "Dynamics 365", color: "#5B3FC4", bg: "#EEEAFC", bucket: "dynamics" },
  // Legacy only — see the type comment above.
  dataPlatform: { label: "Power BI / Azure / Fabric (legacy)", color: "#1470A0", bg: "#E1F1FA", bucket: "dataPlatform" },
};

export const BUCKET_META: Record<BucketKey, { label: string; slug: string }> = {
  m365Tenant: { label: "M365 / Azure", slug: "m365-azure" },
  dynamics: { label: "Dynamics", slug: "dynamics" },
  // Legacy only — see the CategoryKey type comment above.
  dataPlatform: { label: "Power BI / Azure / Fabric (legacy)", slug: "power-bi-azure-fabric" },
};

export const BUCKET_LABEL: Record<BucketKey, string> = {
  m365Tenant: CATEGORY_META.m365Tenant.label,
  dynamics: CATEGORY_META.dynamics365.label,
  dataPlatform: CATEGORY_META.dataPlatform.label,
};

// Default-category priority when a row trips more than one bucket — a
// default only, every row stays manually reassignable regardless.
const CATEGORY_PRIORITY: CategoryKey[] = ["dynamics365", "m365Tenant"];

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

// User-editable layer on top of the rules above (see CLAUDE.md and the
// Cheat Sheet) — a per-installation override, never a change to the base
// rules themselves. Jack can raise/lower the qualify threshold and add
// extra plain-text trigger words per category; a custom keyword match
// always counts as a Strong Signal trigger for that category, same as a
// built-in one. Persisted via lib/ruleOverrides.ts; every scan call below
// defaults to DEFAULT_RULE_OVERRIDES when none is supplied, so nothing
// here behaves differently until Jack actually sets an override.
export interface RuleOverrides {
  qualifyThreshold: number;
  customKeywords: Record<CategoryKey, string[]>;
}
export const DEFAULT_RULE_OVERRIDES: RuleOverrides = {
  qualifyThreshold: QUALIFY_THRESHOLD,
  customKeywords: { dynamics365: [], dataPlatform: [], m365Tenant: [] },
};

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

// Returns null if nothing found. A confirmed count under the qualify
// threshold still comes back (status: "dq") rather than vanishing —
// visible in Bad Leads, not silently dropped. `qualifyThreshold` defaults
// to the built-in QUALIFY_THRESHOLD; pass RuleOverrides.qualifyThreshold to
// use Jack's own override instead.
export function scanRowLicensing(row: Record<string, unknown>, columns: string[], qualifyThreshold: number = QUALIFY_THRESHOLD): LicensingResult | null {
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
  const status: LicensingResult["status"] = bestCount === null ? "review" : bestCount < qualifyThreshold ? "dq" : "qualified";
  return { skus: skuSet, count: bestCount, snippet: bestSnippetHit.snippet, status };
}

/* ------------------------------------------------------------------ */
/* Platform (Dynamics / Power BI / Fabric / Azure / Migration) engine   */
/* ------------------------------------------------------------------ */
const TENANT_SUPPORT_LABEL = "Tenant Support";
const MIGRATION_LABEL = "Migration / Modernization";
// Shared with TENANT_SUPPORT_LABEL's Strong Signal boost below — see
// GOOGLE_TO_MICROSOFT_RE/ONGOING_PARTNER_RE.
const GOOGLE_TO_MICROSOFT_SRC =
  "\\b(google\\s*workspace|g\\s*suite|gmail\\s*for\\s*(?:work|business))\\b.{0,60}\\b(microsoft(?:\\s*365)?|office\\s*365|m365)\\b|\\b(microsoft(?:\\s*365)?|office\\s*365|m365)\\b.{0,60}\\b(google\\s*workspace|g\\s*suite)\\b|\\bgoogle\\s*to\\s*microsoft\\b|\\bmigrat\\w*\\s*(?:off|from|away\\s*from)?\\s*google\\b";
const ONGOING_PARTNER_SRC =
  "\\b(msp|managed\\s*(?:it\\s*)?services?|managed\\s*service\\s*providers?|co-?managed\\s*it|outsourced?\\s*it|it\\s*outsourcing|long[\\s-]?term\\s*(?:partner|relationship)|ongoing\\s*(?:it\\s*)?support|dedicated\\s*(?:it\\s*)?partner|trusted\\s*(?:it\\s*)?partner|strategic\\s*(?:it\\s*)?partner|extension\\s*of\\s*(?:our|their|my)\\s*team|third[\\s-]?party\\s*(?:support|help|it)|3rd[\\s-]?party\\s*(?:support|help|it)|committed\\s*(?:it\\s*)?relationship|(?:full|deep)\\s*(?:partner\\s*)?engagement|partner\\s*engagement)\\b";
// Security design/hardening work — hot per Jack's ask, part of the
// original "security measures" scope named when M365/Azure was merged.
const SECURITY_DESIGN_SRC =
  "\\bsecurity\\s*(?:design|architecture|hardening|posture|assessment|audit|review)\\b|\\bharden(?:ing)?\\s*(?:our|their|my)?\\s*security\\b";

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
    pattern: new RegExp(
      `${GOOGLE_TO_MICROSOFT_SRC}|\\btenant\\s*(?:creation|setup|set\\s*up|provisioning|onboarding|migration|support)\\b|\\b(?:create|creating|set(?:ting)?\\s*up|stand(?:ing)?\\s*up|provision(?:ing)?)\\s*(?:a\\s*)?(?:new\\s*)?tenant\\b|\\bnew\\s*tenant\\b|${ONGOING_PARTNER_SRC}|${SECURITY_DESIGN_SRC}|\\bit\\s*support\\b|\\btechnical\\s*support\\b|\\bhelp\\s*desk\\b|\\bhelpdesk\\b|\\bsupport\\s*(?:contract|plan|request|ticket|team)\\b|\\bneed(?:s|ing)?\\s*(?:it\\s*)?support\\b|\\blooking\\s*for\\s*(?:it\\s*)?support\\b`,
      "i"
    ),
  },
];
// Power BI/Microsoft Fabric/Azure now roll into "m365Tenant" ("M365 /
// Azure") alongside Tenant Support/Migration/Licensing — see the
// CategoryKey comment above and CLAUDE.md "Category merge". Nothing here
// still routes to "dataPlatform"; that key only survives for rendering
// data filed before this merge.
const PLATFORM_LABEL_TO_KEY: Record<string, CategoryKey> = {
  "Dynamics 365": "dynamics365",
  "Power BI": "m365Tenant",
  "Microsoft Fabric": "m365Tenant",
  Azure: "m365Tenant",
  [MIGRATION_LABEL]: "m365Tenant",
  [TENANT_SUPPORT_LABEL]: "m365Tenant",
};

const TRIGGER_WORDS_RE =
  /\b(migrat\w+|implement\w+|replac\w+|upgrad\w+|evaluat\w+|rfp|roll\s*out|go[\s-]?live|deploy\w+|modern\w+|switch\w+|outgrow\w+|budget|timeline|planning\s*to|looking\s*to|considering|this\s*year|next\s*quarter|q[1-4]\b)/i;
const LICENSE_COUNT_RE = /\b(?!1\s*(?:users?|seats?|licenses?|licences?|suers)\b)\d+\s*(?:users?|seats?|licenses?|licences?|suers)\b/i;
const GROWTH_OVERLOAD_RE =
  /\b(growing\s*(?:fast|rapidly|quickly)?|growth|scaling\s*(?:up|fast)?|too\s*much\s*on\s*(?:our|my|their)\s*plate|stretched\s*(?:too\s*)?thin|wearing\s*too\s*many\s*hats|understaffed|short[\s-]?staffed|overwhelmed|can'?t\s*keep\s*up|need(?:s|ing)?\s*(?:extra|additional|outside|external|more)\s*help|no\s*(?:internal\s*)?it\s*(?:staff|team|department)|don'?t\s*have\s*(?:an\s*)?it\s*(?:staff|team|department)|outgrow\w+)\b/i;
// M365 Tenant Strong Signal boost, per Jack's ask: an actual Google->
// Microsoft migration, or MSP/CSP/partner-being-brought-in language, is a
// real buying-intent signal on its own — unlike a bare "IT support"/"help
// desk" mention (still part of the category match above, just not
// promoted to Strong Signal by itself).
const GOOGLE_TO_MICROSOFT_RE = new RegExp(GOOGLE_TO_MICROSOFT_SRC, "i");
const ONGOING_PARTNER_RE = new RegExp(ONGOING_PARTNER_SRC, "i");
// Security design/hardening work is also a Strong Signal boost, same
// footing as the Google->Microsoft/ongoing-partner language above.
const SECURITY_DESIGN_RE = new RegExp(SECURITY_DESIGN_SRC, "i");
// Power BI/Azure qualification, tightened per Jack's rules audit: a bare
// product mention no longer counts on its own for either bucket — see
// CLAUDE.md "Power BI / Azure — tightened qualification".
// Power BI only counts when there's language about actually bringing in a
// partner/vendor/consultant/reseller/CSP for it — generic "we want better
// dashboards" text alone no longer qualifies.
const PARTNER_ENGAGEMENT_RE =
  /\b(looking\s*for\s*(?:a\s*)?(?:partner|vendor|consultant|provider|reseller|msp|csp)|bring(?:ing)?\s*in\s*(?:a\s*)?(?:partner|vendor|consultant)|need(?:s|ing)?\s*(?:a\s*)?(?:partner|vendor|consultant|reseller|csp)|hire(?:ing)?\s*(?:a\s*)?(?:consultant|vendor|partner)|outsourc\w*|work(?:ing)?\s*with\s*a\s*partner|engage\s*(?:a\s*)?(?:partner|vendor|consultant)|\bcsp\b|cloud\s*solution\s*provider)\b/i;
// Azure Document Intelligence and full custom-app builds are hot per
// Jack's ask — shared sub-patterns so Azure's own gate and Fabric's project
// gate below both recognize them the same way.
const DOCUMENT_INTELLIGENCE_RE = /\bdocument\s*intelligence\b/i;
const APP_BUILD_RE =
  /\b(?:build(?:ing)?|develop(?:ing)?|creat(?:e|ing))\s*(?:an?\s*)?(?:app|application|custom\s*app|custom\s*application|custom\s*solution)\b|\bapp\s*development\b|\bfull\s*(?:app|application)\s*build\b/i;
// Azure now qualifies on: on-prem-to-cloud migration (AZURE_MIGRATION_
// OVERRIDE_RE below), Azure billing/cost language, looking for a partner/
// CSP to route that billing through, Azure Document Intelligence, or a
// full custom-app build on Azure — all hot per Jack's ask. Generic
// "usage/VMs/adoption" scale language still doesn't qualify by itself.
const AZURE_BILLING_RE =
  /\b(azure\s*(?:billing|invoic\w*|cost\s*management|spend|bill)|billing\s*(?:for|on|through|via)\s*azure|route\s*(?:our|their|my)?\s*(?:azure\s*)?billing|billing\s*(?:to\s*)?(?:go|run)\s*through)\b/i;
// Microsoft Fabric, per Jack's ask: a bare "Microsoft Fabric"/"OneLake"
// mention no longer counts on its own — it only qualifies when it ties
// into a larger project: an Azure tie-in, custom app/solution development,
// or (Azure) Document Intelligence specifically.
const FABRIC_PROJECT_RE = new RegExp(`\\bazure\\b|${DOCUMENT_INTELLIGENCE_RE.source}|${APP_BUILD_RE.source}`, "i");
const DYNAMICS_SPECIFIC_INSTANCE_RE =
  /\b(business\s*central|finance\s*(?:and|&)\s*operations|customer\s*engagement|customer\s*insights|contact\s*center|supply\s*chain(?:\s*management)?|dynamics\s*crm|dynamics\s*ax|dynamics\s*nav|dynamics\s*gp|dynamics\s*365\s*sales|dynamics\s*365\s*field\s*service|dynamics\s*365\s*project\s*operations|dynamics\s*365\s*customer\s*service|dynamics\s*365\s*marketing|dynamics\s*365\s*human\s*resources)\b/i;
// Dynamics 365 leads rank in three blocks (see CLAUDE.md "Dynamics 365
// module-type ranking"): Business Central/ERP first, Sales/CRM next, then
// everything else (a bare "Dynamics 365"/"D365" mention with no specific
// module named) — seat count still breaks ties within each block.
const DYNAMICS_ERP_RE = /\b(business\s*central|finance\s*(?:and|&)\s*operations|supply\s*chain(?:\s*management)?|dynamics\s*ax|dynamics\s*nav|dynamics\s*gp|erp)\b/i;
const DYNAMICS_CRM_RE =
  /\b(dynamics\s*365\s*sales|dynamics\s*crm|customer\s*engagement|customer\s*insights|contact\s*center|dynamics\s*365\s*customer\s*service|dynamics\s*365\s*marketing|dynamics\s*365\s*field\s*service|dynamics\s*365\s*project\s*operations|dynamics\s*365\s*human\s*resources|crm)\b/i;
const DYNAMICS_ESTIMATED_COUNT_RE =
  /\b(?:estimated|approx(?:imately)?|roughly|about|around|a\s*handful\s*of|a\s*few|several|dozens?\s*of|hundreds?\s*of)\b.{0,25}\b(?:users?|seats?|licenses?|licences?|suers|employees?|people|staff)\b/i;
const DYNAMICS_MULTI_MODULE_RE = /\berp\b.{0,30}\bcrm\b|\bcrm\b.{0,30}\berp\b/i;
// Business Central / ERP tab trigger — per Jack, exactly three keywords:
// "Business Central," "ERP," "erp" (the last two are just case variants,
// already covered by the /i flag). Deliberately narrower than
// DYNAMICS_ERP_RE's whole ERP tier — a lead that only says "Finance and
// Operations" or "Supply Chain Management" with no "Business Central" or
// bare "ERP" wording doesn't trigger this tab, even though it shares the
// same module-tier ranking block. Drives the Scanner's separate Business
// Central / ERP tab within the Dynamics 365 category (see CLAUDE.md
// "Business Central view"), same pattern as isGoogleToMicrosoft within
// M365/Azure — this is one of a growing set of these keyword-triggered
// sub-filters, meant to make filed leads easier to slice once stored.
const BUSINESS_CENTRAL_RE = /\b(business\s*central|erp)\b/i;
// Sales / CRM tab trigger — same pattern, exactly three keywords per
// Jack: "Sales," "CRM," "crm" (the last two just case variants). Also
// narrower than the full DYNAMICS_CRM_RE tier (which also covers Customer
// Engagement/Insights/Contact Center/Field Service/Marketing/Project
// Operations/Human Resources) — a lead that only says "Customer
// Engagement" with no bare "Sales" or "CRM" wording doesn't trigger this
// tab, even though it shares the same module-tier ranking block.
const SALES_CRM_RE = /\b(sales|crm)\b/i;

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
// Email/phone already have their own dedicated export columns — see
// CLAUDE.md — so a candidate summary sentence carrying either is dropped
// here rather than shown a second time in the Matched snippet/Notes text.
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i;
const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
function hasForbiddenContent(s: string) {
  return DATE_RE.test(s) || BILLING_BANT_RE.test(s) || SERIAL_RE.test(s) || EMAIL_RE.test(s) || PHONE_RE.test(s);
}
const CATEGORY_BLURBS: Record<string, string> = {
  "Dynamics 365": "modernizing their CRM/ERP setup",
  "Power BI": "bringing in a partner for Power BI",
  "Microsoft Fabric": "a Microsoft Fabric project tied to Azure or custom app development",
  Azure: "an on-prem-to-Azure migration or routing their Azure billing through a partner/CSP",
  [MIGRATION_LABEL]: "bringing in a partner to migrate off their current systems",
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
  // 0 = Business Central/ERP, 1 = Sales/CRM, 2 = no specific module named.
  moduleTier?: number;
  // Google Workspace/G Suite -> Microsoft 365 migration language, OR any
  // other migration-flavored hit already qualifying as Strong Signal
  // within M365/Azure (generic Migration/Modernization, Azure's own
  // on-prem-to-cloud migration hits) — see CLAUDE.md "Google -> Microsoft
  // view". Drives the Scanner's separate Google->Microsoft tab within the
  // M365/Azure category; doesn't change category/bucket/export.
  isGoogleToMicrosoft?: boolean;
  // "Business Central" specifically, within a Dynamics 365 hit — same
  // pattern as isGoogleToMicrosoft, drives the Scanner's separate
  // Business Central tab within the Dynamics 365 category.
  isBusinessCentral?: boolean;
  // "Sales"/"CRM" specifically, within a Dynamics 365 hit — same pattern,
  // drives the Scanner's separate Sales / CRM tab.
  isSalesCrm?: boolean;
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
  // The most specific Dynamics module block this row belongs in (lowest
  // wins if more than one is named) — see DYNAMICS_ERP_RE/DYNAMICS_CRM_RE
  // above. Defaults to 2 ("the rest") when no Dynamics hit exists at all.
  dynamicsModuleTier: number;
  // True if any hit is Google->Microsoft migration language specifically.
  isGoogleToMicrosoft: boolean;
  // True if any hit is "Business Central" specifically.
  isBusinessCentral: boolean;
  // True if any hit is "Sales"/"CRM" specifically.
  isSalesCrm: boolean;
}

// Jack's own custom trigger words (see RuleOverrides), plain text — not
// regex — matched as a simple case-insensitive substring so a typo-prone
// UI field can never produce a broken/catastrophic pattern. A match always
// counts as hasTrigger: true, since the entire point of adding one is "if
// you see this, treat it as a real signal."
const CUSTOM_KEYWORD_LABEL: Record<CategoryKey, string> = { dynamics365: "Dynamics 365", dataPlatform: "Power BI", m365Tenant: TENANT_SUPPORT_LABEL };
function escapeForLiteralMatch(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function matchCustomKeywords(combined: string, customKeywords: Record<CategoryKey, string[]> | undefined): PlatformHit[] {
  if (!customKeywords) return [];
  const hits: PlatformHit[] = [];
  (Object.keys(customKeywords) as CategoryKey[]).forEach((key) => {
    customKeywords[key].forEach((raw) => {
      const word = raw.trim();
      if (!word) return;
      const re = new RegExp(escapeForLiteralMatch(word), "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(combined)) !== null) {
        const start = Math.max(0, m.index - SIGNAL_WINDOW);
        const end = Math.min(combined.length, m.index + m[0].length + SIGNAL_WINDOW);
        hits.push({ category: CUSTOM_KEYWORD_LABEL[key], snippet: combined.slice(start, end).trim(), hasTrigger: true });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });
  });
  return hits;
}

export function scanRowPlatform(
  row: Record<string, unknown>,
  columns: string[],
  commentsValue: unknown,
  productAreaValue: unknown,
  customKeywords?: Record<CategoryKey, string[]>
): PlatformResult | null {
  const fields = columns.map((c) => String(row[c] ?? ""));
  const combined = fields.join("   ");
  const hits: PlatformHit[] = matchCustomKeywords(combined, customKeywords);
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

      // Power BI and Azure no longer qualify on a bare product mention —
      // see PARTNER_ENGAGEMENT_RE/AZURE_BILLING_RE above. Skip the hit
      // entirely (not just its Strong Signal trigger) if the window
      // doesn't clear the tightened bar for that specific bucket.
      if (cat.label === "Power BI" && !PARTNER_ENGAGEMENT_RE.test(win)) {
        if (m.index === re.lastIndex) re.lastIndex++;
        continue;
      }
      if (
        cat.label === "Azure" &&
        !(AZURE_MIGRATION_OVERRIDE_RE.test(win) || AZURE_BILLING_RE.test(win) || PARTNER_ENGAGEMENT_RE.test(win) || DOCUMENT_INTELLIGENCE_RE.test(win) || APP_BUILD_RE.test(win))
      ) {
        if (m.index === re.lastIndex) re.lastIndex++;
        continue;
      }
      if (cat.label === "Microsoft Fabric" && !FABRIC_PROJECT_RE.test(win)) {
        if (m.index === re.lastIndex) re.lastIndex++;
        continue;
      }
      // Migration/Modernization, tightened per Jack's ask, same bar as
      // Power BI: "legacy system"/"re-platforming"/"lift and shift" alone
      // no longer counts — needs partner/vendor/consultant/MSP/CSP
      // language nearby to prove it's a real engagement, not just
      // background color in the notes.
      if (cat.label === MIGRATION_LABEL && !PARTNER_ENGAGEMENT_RE.test(win)) {
        if (m.index === re.lastIndex) re.lastIndex++;
        continue;
      }

      hits.push({
        category: cat.label,
        snippet: win,
        hasTrigger:
          // Power BI/Azure/Fabric/Migration hits already cleared the
          // strict gate above — by definition that's a real opportunity,
          // not just a mention.
          cat.label === "Power BI" ||
          cat.label === "Azure" ||
          cat.label === "Microsoft Fabric" ||
          cat.label === MIGRATION_LABEL ||
          // Generic trigger words ("upgrade," "budget," "this year," etc.)
          // still promote Dynamics 365 on their own (an original, documented
          // rule) but no longer Tenant Support — "we need support on
          // upgrade from our current version" is generic IT-support
          // language, not real M365/Azure buying intent, and shouldn't
          // auto-promote just because it contains the word "upgrade."
          // Tenant Support's own tightened boost list right below is its
          // only path to Strong Signal now, on top of a real license count.
          (cat.label !== TENANT_SUPPORT_LABEL && TRIGGER_WORDS_RE.test(win)) ||
          LICENSE_COUNT_RE.test(win) ||
          (cat.label === TENANT_SUPPORT_LABEL &&
            (GROWTH_OVERLOAD_RE.test(win) || GOOGLE_TO_MICROSOFT_RE.test(win) || ONGOING_PARTNER_RE.test(win) || PARTNER_ENGAGEMENT_RE.test(win) || SECURITY_DESIGN_RE.test(win))) ||
          // The "bare number sits next to the match" rule is Dynamics-365-
          // specific by design (see CLAUDE.md) — it used to run for every
          // category, so a support-ticket number, a software version
          // ("...current version which is 15."), or any other stray digit
          // near a generic "support"/"legacy system" mention got misread
          // as a seat count and wrongly promoted to Strong Signal. Real
          // seat/user/license counts elsewhere still count via
          // LICENSE_COUNT_RE above, which requires an actual unit word.
          (cat.label === "Dynamics 365" &&
            (DYNAMICS_MULTI_MODULE_RE.test(win) ||
              (DYNAMICS_SPECIFIC_INSTANCE_RE.test(win) && (LICENSE_COUNT_RE.test(win) || DYNAMICS_ESTIMATED_COUNT_RE.test(win))) ||
              hasBareTrailingCount(combined.slice(m.index + m[0].length, m.index + m[0].length + 80)) ||
              hasBareLeadingCount(combined.slice(Math.max(0, m.index - 80), m.index)))),
        // Same seat/user/license number extraction the licensing engine
        // uses, reused here so a Dynamics lead's real count (not just
        // "a count was mentioned") survives into the result for ranking.
        seatCount: cat.label === "Dynamics 365" ? extractCountNear(combined, m.index, m[0].length).count : null,
        moduleTier: cat.label === "Dynamics 365" ? (DYNAMICS_ERP_RE.test(win) ? 0 : DYNAMICS_CRM_RE.test(win) ? 1 : 2) : undefined,
        // Per Jack: the Google->Microsoft tab should also pick up any
        // other migration-flavored lead that's already qualifying as
        // Strong Signal within M365/Azure — generic Migration/
        // Modernization hits (already gated behind partner-engagement
        // language, so any hit here is already Strong Signal) and
        // Azure's own on-prem-to-cloud migration hits specifically (not
        // Azure hits that qualified via billing/partner language instead).
        isGoogleToMicrosoft:
          (cat.label === TENANT_SUPPORT_LABEL && GOOGLE_TO_MICROSOFT_RE.test(win)) ||
          cat.label === MIGRATION_LABEL ||
          (cat.label === "Azure" && AZURE_MIGRATION_OVERRIDE_RE.test(win)),
        isBusinessCentral: cat.label === "Dynamics 365" && BUSINESS_CENTRAL_RE.test(win),
        isSalesCrm: cat.label === "Dynamics 365" && SALES_CRM_RE.test(win),
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  if (productAreaValue) {
    const paText = String(productAreaValue);
    for (const cat of PLATFORM_CATALOGUE) {
      if (!cat.pattern.test(paText)) continue;
      // A Product Area column tagged "Power BI"/"Azure"/"Microsoft Fabric"
      // is still just a category label, not proof of partner/billing/
      // project intent — check the WHOLE row's text (Product Area rarely
      // carries that language itself) before letting it through under the
      // same tightened bar.
      if (cat.label === "Power BI" && !PARTNER_ENGAGEMENT_RE.test(combined)) continue;
      if (
        cat.label === "Azure" &&
        !(AZURE_MIGRATION_OVERRIDE_RE.test(combined) || AZURE_BILLING_RE.test(combined) || PARTNER_ENGAGEMENT_RE.test(combined) || DOCUMENT_INTELLIGENCE_RE.test(combined) || APP_BUILD_RE.test(combined))
      )
        continue;
      if (cat.label === "Microsoft Fabric" && !FABRIC_PROJECT_RE.test(combined)) continue;
      if (cat.label === MIGRATION_LABEL && !PARTNER_ENGAGEMENT_RE.test(combined)) continue;
      hits.push({
        category: cat.label,
        snippet: cleanText(paText),
        hasTrigger: true,
        fromProductArea: true,
        moduleTier: cat.label === "Dynamics 365" ? (DYNAMICS_ERP_RE.test(paText) ? 0 : DYNAMICS_CRM_RE.test(paText) ? 1 : 2) : undefined,
        isGoogleToMicrosoft:
          (cat.label === TENANT_SUPPORT_LABEL && GOOGLE_TO_MICROSOFT_RE.test(paText)) ||
          cat.label === MIGRATION_LABEL ||
          (cat.label === "Azure" && AZURE_MIGRATION_OVERRIDE_RE.test(paText)),
        isBusinessCentral: cat.label === "Dynamics 365" && BUSINESS_CENTRAL_RE.test(paText),
        isSalesCrm: cat.label === "Dynamics 365" && SALES_CRM_RE.test(paText),
      });
    }
  }
  if (hits.length === 0) return null;
  const categories = [...new Set(hits.map((h) => h.category))];
  const tier: "signal" | "mention" = hits.some((h) => h.hasTrigger) ? "signal" : "mention";
  const bestHit = hits.find((h) => h.fromProductArea) || hits.find((h) => h.hasTrigger) || hits[0];
  const notesSummary = commentsValue ? summarizeNotes(commentsValue, categories) : summarizeFromSnippets(hits.map((h) => h.snippet), categories);
  const isGoogleToMicrosoft = hits.some((h) => h.isGoogleToMicrosoft);
  // Business Central/ERP and Sales/CRM are mutually exclusive at the row
  // level, Business Central/ERP taking priority — same precedence as the
  // module-tier ranking (tier 0 beats tier 1). A lead whose text hits both
  // keyword sets (e.g. "Business Central for finance, and also want to
  // grow our CRM side") used to show under both View tabs; per Jack that's
  // wrong — it should only ever show as Business Central/ERP. This also
  // covers a row with two separate hits (one BC-flavored, one Sales/CRM-
  // flavored, from different sentences), not just one hit matching both
  // keywords in its own signal window.
  const isBusinessCentral = hits.some((h) => h.isBusinessCentral);
  const isSalesCrm = !isBusinessCentral && hits.some((h) => h.isSalesCrm);
  const dynamicsCounts = hits.filter((h) => h.category === "Dynamics 365" && h.seatCount != null).map((h) => h.seatCount as number);
  const dynamicsSeatCount = dynamicsCounts.length ? Math.max(...dynamicsCounts) : null;
  const dynamicsModuleTiers = hits.filter((h) => h.category === "Dynamics 365" && h.moduleTier != null).map((h) => h.moduleTier as number);
  const dynamicsModuleTier = dynamicsModuleTiers.length ? Math.min(...dynamicsModuleTiers) : 2;
  return { categories, tier, snippet: bestHit.snippet, notesSummary, hits, dynamicsSeatCount, dynamicsModuleTier, isGoogleToMicrosoft, isBusinessCentral, isSalesCrm };
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
  // Per Jack: the goal is a longer-term partner engagement, not a one-off
  // job or free advice — added when tightening M365/Azure.
  {
    label: "Small one-off project / free consultancy request",
    pattern:
      /\bone[\s-]?off\s*(?:project|job|gig)\b|\bsmall\s*project\b|\bone[\s-]?time\s*project\b|\bquick\s*(?:project|job|gig)\b|\bshort[\s-]?term\s*project\b|\bfree\s*consult(?:ation|ing)?\b|\bpick\s*(?:your|someone'?s|my)\s*brain\b|\bjust\s*(?:need|want)(?:s|ing)?\s*(?:some\s*)?(?:free\s*)?advice\b|\bquick\s*question\b|\bno\s*budget\b|\bnot\s*looking\s*to\s*(?:hire|engage|pay)\b/i,
  },
  // Per Jack, with real examples: "Nicole Vargas is the owner of this
  // opportunity and Partner: SIS LLC" / "...key to advancing the sales
  // cycle." This is internal CRM/Dynamics 365 Opportunity-record notes
  // describing a deal someone else is ALREADY tracking — third-person
  // pipeline-management language, not a fresh lead's own expressed
  // interest. Excluded regardless of what platform/licensing language
  // happens to also be nearby (e.g. "security posture").
  {
    label: "Existing CRM opportunity notes, not a fresh lead",
    pattern:
      /\bowner\s*of\s*this\s*opportunity\b|\bopportunity\s*owner\b|\badvancing\s*the\s*sales\s*cycle\b|\bexecutive\s*engagement\b|\bpartner\s*:\s*[a-z]/i,
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

function getDQReasons(combinedText: string, resolved: ResolvedFields, licensing: LicensingResult | null, qualifyThreshold: number): string[] {
  const reasons: string[] = [];
  for (const rule of DQ_RULES) if (rule.pattern.test(combinedText)) reasons.push(rule.label);
  if (licensing && licensing.status === "dq") reasons.push(`Low seat count (under ${qualifyThreshold})`);
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
  // 0 = Business Central/ERP, 1 = Sales/CRM, 2 = no specific module named —
  // see "Dynamics 365 module-type ranking" in CLAUDE.md.
  dynamicsModuleTier: number;
  // True for a Google Workspace/G Suite -> Microsoft 365 migration lead,
  // or any other migration-flavored lead already qualifying as Strong
  // Signal within M365/Azure — drives the Scanner's separate Google->
  // Microsoft tab within the M365/Azure category (see "Google -> Microsoft
  // view" in CLAUDE.md). Doesn't change category/bucket/export — still
  // exactly one of the two active categories, still one of the two
  // download files.
  isGoogleToMicrosoft: boolean;
  // True for a Business Central lead — drives the Scanner's separate
  // Business Central tab within the Dynamics 365 category (see "Business
  // Central view" in CLAUDE.md). Doesn't change category/bucket/export.
  isBusinessCentral: boolean;
  // True for a "Sales"/"CRM" Dynamics 365 lead — drives the Scanner's
  // separate Sales / CRM tab, same pattern as isBusinessCentral.
  isSalesCrm: boolean;
}

export function scanRowUnified(row: Record<string, unknown>, columns: string[], resolved: ResolvedFields, overrides: RuleOverrides = DEFAULT_RULE_OVERRIDES): ScanResult | null {
  const licensing = scanRowLicensing(row, columns, overrides.qualifyThreshold);
  const platform = scanRowPlatform(row, columns, resolved.comments || null, resolved.productArea || null, overrides.customKeywords);
  if (!licensing && !platform) return null;

  const categorySet = new Set<CategoryKey>();
  if (platform) {
    // Azure-flavored migration language used to get redirected into the
    // separate Power BI/Azure/Fabric bucket instead of the generic
    // Migration one — now a no-op, since both roll into "m365Tenant"
    // either way after the category merge (see CLAUDE.md).
    platform.hits.forEach((h) => {
      const key = PLATFORM_LABEL_TO_KEY[h.category];
      if (key) categorySet.add(key);
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
  const dqReasons = getDQReasons(combinedForDQ, resolved, licensing, overrides.qualifyThreshold);
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
    dynamicsModuleTier: platform ? platform.dynamicsModuleTier : 2,
    isGoogleToMicrosoft: platform ? platform.isGoogleToMicrosoft : false,
    isBusinessCentral: platform ? platform.isBusinessCentral : false,
    isSalesCrm: platform ? platform.isSalesCrm : false,
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

// Manual, per-lead status tracking — entirely separate from the detection
// engine above (nothing here is auto-set). See CLAUDE.md "Lead status".
export type Disposition = "none" | "meeting-booked" | "not-interested" | "no-contact" | "other";
export const DISPOSITION_META: Record<Disposition, { label: string; color: string; bg: string }> = {
  none: { label: "No disposition", color: "#9aa1ac", bg: "#F4F6F7" },
  "meeting-booked": { label: "Meeting booked", color: "#2CC295", bg: "#E7F1EA" },
  "not-interested": { label: "Not interested", color: "#B5443B", bg: "#FBEAE8" },
  "no-contact": { label: "No contact made", color: "#8A5A00", bg: "#FBF3E7" },
  other: { label: "Other", color: "#3A4B8C", bg: "#EEF2FF" },
};
export const DISPOSITION_ORDER: Disposition[] = ["none", "meeting-booked", "not-interested", "no-contact", "other"];

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
  dynamicsModuleTier: number;
  isGoogleToMicrosoft: boolean;
  isBusinessCentral: boolean;
  isSalesCrm: boolean;
  // Manual status tracking (see DISPOSITION_META above) — never set by the
  // scan itself, always "none"/false/null until someone sets it by hand.
  disposition: Disposition;
  dispositionNote: string;
  priority: boolean;
  // A priority lead can be tagged with a month/year that's NOT necessarily
  // when it was uploaded — e.g. backfiling an older lead as "a priority for
  // September 2025" — see CLAUDE.md. Format: YYYY-MM. Only meaningful when
  // priority is true; left alone (not auto-cleared) if priority toggles off,
  // so re-enabling remembers the last month picked.
  priorityMonth: string | null;
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
export function scanParsedFiles(
  parsedFiles: ParsedFile[],
  overrides: RuleOverrides = DEFAULT_RULE_OVERRIDES
): { results: ResultRow[]; rowsScanned: number; duplicatesRemoved: number } {
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
      const scan = scanRowUnified(row, pf.fields, resolved, overrides);
      if (!scan) return;
      results.push({
        id: `${fileIdx}-${i}`,
        row: { ...row, __f: resolved },
        sourceFile: pf.name,
        crossedOut: false,
        isDuplicate: false,
        duplicateOfId: null,
        disposition: "none",
        dispositionNote: "",
        priority: false,
        priorityMonth: null,
        ...scan,
      });
    });
  });
  markDuplicateLeads(results);
  // Per Jack: a duplicate (exact name+company match within this same
  // upload) should never be possible in the uploaded leads at all, not
  // just flagged and excluded from downloads — the first-seen row of a
  // duplicate group is kept, every repeat is dropped here so it never
  // reaches the Scanner table, History, or the Library to begin with.
  const deduped = results.filter((r) => !r.isDuplicate);
  const duplicatesRemoved = results.length - deduped.length;
  return { results: deduped, rowsScanned, duplicatesRemoved };
}

// Dynamics 365 ranking, top to bottom: Business Central/ERP leads first,
// then Sales/CRM, then everything else with no specific module named (see
// CLAUDE.md "Dynamics 365 module-type ranking") — and WITHIN each of those
// three blocks, a stated seat/user/license count wins over one that isn't,
// higher count outranking lower ("21 User" outranks "15 users"). A lead
// with no stated count is never treated as a count of 0; it just sinks
// below every counted lead in its own block, in whatever order it was
// already in (stable sort). Applies only where the caller chooses to use
// it (Dynamics 365 views specifically).
// `desc` flips which end of the seat-count secondary key comes first
// (greatest-to-least by default, per Jack's standing rule) — an uncounted
// lead stays pinned below every counted lead in its own block either way;
// the toggle never promotes "no count" above a real one.
export function sortByDynamicsSeatCount<T extends { dynamicsSeatCount?: number | null; dynamicsModuleTier?: number }>(rows: T[], desc: boolean = true): T[] {
  return [...rows].sort((a, b) => {
    const tierDiff = (a.dynamicsModuleTier ?? 2) - (b.dynamicsModuleTier ?? 2);
    if (tierDiff !== 0) return tierDiff;
    const aCount = a.dynamicsSeatCount ?? null;
    const bCount = b.dynamicsSeatCount ?? null;
    if (aCount === null && bCount === null) return 0;
    if (aCount === null) return 1;
    if (bCount === null) return -1;
    return desc ? bCount - aCount : aCount - bCount;
  });
}

// Shared by the Scanner's "Final downloads" buttons and History's per-entry
// redownload buttons, so the two never diverge on what counts as a bucket's
// export rows (Strong Signal only, Dynamics ranked by seat count). A
// duplicate (per markDuplicateLeads — exact name+company match within this
// same batch) is excluded here the same way a Bad Lead already is: still
// fully visible and flagged in the Scanner table, just never downloaded
// twice. The first-seen row of a duplicate group (isDuplicate: false)
// still exports normally — only the repeat(s) get pulled.
export function exportRowsForBucket(results: ResultRow[], bucketKey: BucketKey): ExportRow[] {
  let rows = results.filter((r) => r.tier === "signal" && !r.isDuplicate && CATEGORY_META[r.category].bucket === bucketKey);
  if (bucketKey === "dynamics") rows = sortByDynamicsSeatCount(rows);
  return rows.map(buildExportRow);
}
