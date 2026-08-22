/* ================================================================== */
/* Wired CIO Unified Lead Scanner                                      */
/* One scan, one tool. Every uploaded row runs through BOTH detection   */
/* engines (Microsoft licensing seat-count scan + Dynamics/Power BI/    */
/* Fabric/Azure/Migration project-signal scan) in a single pass. Each   */
/* lead lands in exactly ONE of three product lines (auto-detected, but */
/* always reassignable by hand), each rolling up into its own            */
/* downloadable CSV:                                                    */
/*   - M365 Tenant (licensing seats + tenant support/creation +          */
/*     migration/modernization, grouped)                                */
/*   - Dynamics                                                         */
/*   - Power BI / Azure / Fabric (grouped)                              */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/* PART 1 — Licensing (Microsoft SKU / seat-count) detection engine.   */
/* Ported from the original CSP Licensing Lead Finder.                 */
/* ------------------------------------------------------------------ */
const SKU_CATALOGUE = [
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
const COUNT_PATTERNS = [
  /(\d{1,4})\s*\+?\s*(users?|seats?|licenses?|licences?|employees?|people|mailboxes?)\b/i,
  /\b(users?|seats?|licenses?|licences?)\s*[:\-]?\s*(\d{1,4})\b/i,
  /\bx\s*(\d{1,4})\b/i,
  /(\d{1,4})\s*x\b/i,
];
const WINDOW = 65;
const QUALIFY_THRESHOLD = 15; // seats/users below this auto-DQ as "Low seat count" — lowered from 20 per Jack
function extractCountNear(haystack, matchIndex, matchLength) {
  const start = Math.max(0, matchIndex - WINDOW);
  const end = Math.min(haystack.length, matchIndex + matchLength + WINDOW);
  const win = haystack.slice(start, end);
  let best = null;
  for (const re of COUNT_PATTERNS) {
    const m = win.match(re);
    if (m) {
      const num = parseInt(m[1] && /^\d+$/.test(m[1]) ? m[1] : m[2], 10);
      if (!Number.isNaN(num)) {
        if (best === null || num > best) best = num;
      }
    }
  }
  return { count: best, window: win.trim(), start, end };
}
// Returns null if nothing found. If a confirmed count comes in under the
// seat threshold (QUALIFY_THRESHOLD), the row still comes back (status:
// "dq") rather than vanishing — it always meant "not really an
// opportunity", but per Jack it should land in the visible, reportable Bad
// Leads bucket instead of being silently dropped with no trace.
function scanRowLicensing(row, columns) {
  const fields = columns.map((c) => String(row[c] ?? ""));
  const combined = fields.join("   ");
  const hits = [];
  for (const sku of SKU_CATALOGUE) {
    const re = new RegExp(sku.pattern.source, sku.pattern.flags.includes("g") ? sku.pattern.flags : sku.pattern.flags + "g");
    let m;
    while ((m = re.exec(combined)) !== null) {
      const { count, window } = extractCountNear(combined, m.index, m[0].length);
      hits.push({ sku: sku.label, matchText: m[0], count, snippet: window });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  if (hits.length === 0) return null;
  const skuSet = [...new Set(hits.map((h) => h.sku))];
  const countsFound = hits.map((h) => h.count).filter((c) => c !== null);
  const bestCount = countsFound.length ? Math.max(...countsFound) : null;
  const bestSnippetHit = hits.find((h) => h.count === bestCount && bestCount !== null) || hits[0];
  const status = bestCount === null ? "review" : bestCount < QUALIFY_THRESHOLD ? "dq" : "qualified";
  return { skus: skuSet, count: bestCount, snippet: bestSnippetHit.snippet, status };
}

/* ------------------------------------------------------------------ */
/* PART 2 — Platform (Dynamics / Power BI / Fabric / Azure / Migration) */
/* project-signal detection engine. Ported from the Dynamics & Data     */
/* Platform Lead Finder.                                                */
/* ------------------------------------------------------------------ */
// "MSP / Ongoing Support" and "Google to Microsoft Migration" are grouped
// together under one combined label/pattern per Jack's request — leads in
// this cluster are really all "who handles our tenant and ongoing IT
// support" leads (new tenant creation, tenant migration, or just wanting an
// ongoing support relationship), so it's tracked and described as one thing
// rather than two separate labels. The generic Migration/Modernization
// pattern below is untouched and stays its own separate signal.
const TENANT_SUPPORT_CATEGORY_LABEL = "Tenant Support";
const MIGRATION_CATEGORY_LABEL = "Migration / Modernization";
const PLATFORM_CATALOGUE = [
  {
    label: "Dynamics 365",
    pattern:
      /\b(dynamics\s*365|d\s*365|dyn\s*365|dynamics\s*crm|dynamics\s*ax|dynamics\s*nav|dynamics\s*gp|business\s*central|finance\s*(?:and|&)\s*operations|customer\s*engagement|supply\s*chain(?:\s*management)?|erp)\b/i,
  },
  {
    // Broadened per Jack's request: catch leads describing a data/reporting
    // need in their own words, not just leads that name "Power BI" directly
    // (e.g. "we want an analytical dashboard" or "trying to leverage our
    // data" — someone trying to get more out of their data, generally).
    label: "Power BI",
    pattern:
      /\bpower\s*bi\b|\b(analytic(?:al|s)?\s*dashboards?|data\s*dashboards?|reporting\s*dashboards?|kpi\s*dashboards?|real-?time\s*dashboards?|business\s*intelligence|bi\s*(?:tool|platform|solution)|data\s*visuali[sz]ations?|data\s*viz|analytics\s*platform|leverage\w*\s*(?:our|their|my)?\s*data|make\s*sense\s*of\s*(?:our|their|the|my)?\s*data|data[\s-]?driven\s*decisions?|self-?service\s*(?:bi|reporting)|data\s*insights?)\b/i,
  },
  { label: "Microsoft Fabric", pattern: /\b(microsoft\s*fabric|onelake)\b/i },
  { label: "Azure", pattern: /\bazure\b/i },
  {
    label: MIGRATION_CATEGORY_LABEL,
    pattern:
      /\b(data\s*migration|cloud\s*migration|legacy\s*system|migrating(?:\s*(?:off|from|to))?|moving\s*(?:off|away\s*from)|re-?platform(?:ing)?|lift\s*and\s*shift|moderniz\w+|on-?prem\s*to\s*cloud)\b/i,
  },
  {
    // Combined "Tenant Support" pattern — formerly two separate signals
    // (Google-to-Microsoft Migration + MSP/Ongoing Support), now grouped
    // together and broadened to also catch plain new-tenant-creation and
    // general IT-support-seeking language, not just the partner-relationship
    // phrasing that was there before.
    label: TENANT_SUPPORT_CATEGORY_LABEL,
    pattern:
      /\b(google\s*workspace|g\s*suite|gmail\s*for\s*(?:work|business))\b.{0,60}\b(microsoft(?:\s*365)?|office\s*365|m365)\b|\b(microsoft(?:\s*365)?|office\s*365|m365)\b.{0,60}\b(google\s*workspace|g\s*suite)\b|\bgoogle\s*to\s*microsoft\b|\bmigrat\w*\s*(?:off|from|away\s*from)?\s*google\b|\btenant\s*(?:creation|setup|set\s*up|provisioning|onboarding|migration|support)\b|\b(?:create|creating|set(?:ting)?\s*up|stand(?:ing)?\s*up|provision(?:ing)?)\s*(?:a\s*)?(?:new\s*)?tenant\b|\bnew\s*tenant\b|\b(msp|managed\s*(?:it\s*)?services?|managed\s*service\s*providers?|co-?managed\s*it|outsourced?\s*it|it\s*outsourcing|long[\s-]?term\s*(?:partner|relationship)|ongoing\s*(?:it\s*)?support|dedicated\s*(?:it\s*)?partner|trusted\s*(?:it\s*)?partner|strategic\s*(?:it\s*)?partner|extension\s*of\s*(?:our|their|my)\s*team|third[\s-]?party\s*(?:support|help|it)|3rd[\s-]?party\s*(?:support|help|it)|committed\s*(?:it\s*)?relationship|it\s*support|technical\s*support|help\s*desk|helpdesk|support\s*(?:contract|plan|request|ticket|team)|need(?:s|ing)?\s*(?:it\s*)?support|looking\s*for\s*(?:it\s*)?support)\b/i,
  },
];
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
function hasBareTrailingCount(afterText) {
  const snippet = afterText.slice(0, 80);
  const terminatorIdx = snippet.search(/[.!?\n]/);
  const clause = (terminatorIdx === -1 ? snippet : snippet.slice(0, terminatorIdx + 1)).trim();
  return /^[a-z\s\-:,/&]*(?:^|[\s\-:,])(?!1\s*[.,]?$)(?!(?:19|20)\d{2}\s*[.,]?$)\d{1,4}\s*[.,]?$/i.test(clause);
}
function hasBareLeadingCount(beforeText) {
  const snippet = beforeText.slice(-80);
  const terminatorIdx = snippet.search(/[.!?\n](?=[^.!?\n]*$)/);
  const clause = (terminatorIdx === -1 ? snippet : snippet.slice(terminatorIdx + 1)).trim();
  const m = /^(\d{1,4})\b(?:[\s\-:,/&]|[a-z])*$/i.exec(clause);
  if (!m) return false;
  if (m[1] === "1") return false;
  if (/^(?:19|20)\d{2}$/.test(m[1])) return false;
  return true;
}
// Rule (per Jack): anything phrased as an Azure migration, or as moving from
// on-prem to the cloud, should stay in the Power BI/Azure/Fabric product
// line — not fall into the generic Migration/Modernization signal, which
// now rolls up into M365 Tenant instead — even though the generic migration
// pattern above would otherwise also match that same phrase.
const AZURE_MIGRATION_OVERRIDE_RE =
  /\bazure\b[^.!?\n]{0,80}\bmigrat\w*\b|\bmigrat\w*\b[^.!?\n]{0,80}\bazure\b|\bon-?prem\w*\s*(?:to|into|→)\s*(?:the\s*)?cloud\b|\bon-?prem\w*\b[^.!?\n]{0,80}\bazure\b|\bazure\b[^.!?\n]{0,80}\bon-?prem\w*\b|\blift\s*and\s*shift\b[^.!?\n]{0,80}\bazure\b|\bazure\b[^.!?\n]{0,80}\blift\s*and\s*shift\b/i;
const DATE_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*\d{0,2}(?:st|nd|rd|th)?,?\s*\d{0,4}\b|\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b(?:19|20)\d{2}\b|\bQ[1-4]\b|\b(?:this|next|last)\s+(?:year|quarter|month|week)\b/i;
const BILLING_BANT_RE =
  /\$\s?\d[\d,]*(?:\.\d{1,2})?\b|\b\d+\s*(?:k|thousand|million)\b|\b(budget|pricing|price|quote|quoted|cost|contract|renewal|renew\w*|invoice|deadline|timeline|decision[\s-]?maker|approv\w*|procurement|purchase\s*order|\bpo\b|per\s*(?:seat|user|month|year))\b/i;
const SERIAL_RE =
  /\b(?:serial|order|invoice|case|ticket|ref(?:erence)?)\s*#?\s*[:\-]?\s*[a-z0-9-]{4,}\b|\b[a-z]{1,3}-?\d{4,}\b|\b\d{5,}\b/i;
function hasForbiddenContent(s) {
  return DATE_RE.test(s) || BILLING_BANT_RE.test(s) || SERIAL_RE.test(s);
}
const CATEGORY_BLURBS = {
  "Dynamics 365": "modernizing their CRM/ERP setup",
  "Power BI": "improving reporting and analytics",
  "Microsoft Fabric": "consolidating their data platform",
  Azure: "evaluating cloud infrastructure",
  [MIGRATION_CATEGORY_LABEL]: "migrating off their current systems",
  [TENANT_SUPPORT_CATEGORY_LABEL]: "setting up or supporting their M365 tenant — new tenant creation, migrating from Google, or ongoing IT support",
};
function fallbackSummary(categories) {
  if (!categories || categories.length === 0) return "";
  const blurbs = categories.map((c) => CATEGORY_BLURBS[c] || c.toLowerCase());
  return `Interested in ${blurbs.join(" and ")}.`;
}
const SIGNAL_WINDOW = 70;
function collapseAbbreviations(text) {
  return text.replace(/\b(?:[A-Z]\.){2,}/g, (match, offset, full) => {
    const letters = match.replace(/\./g, "");
    const after = full.slice(offset + match.length);
    const looksLikeSentenceEnd = /^\s+[A-Z]/.test(after) || after.trim() === "";
    return looksLikeSentenceEnd ? `${letters}.` : letters;
  });
}
function cleanText(raw) {
  if (!raw) return "";
  let t = String(raw);
  t = t.replace(/<[^>]*>/g, " ");
  t = t.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/g, "'").replace(/&quot;/gi, '"');
  t = collapseAbbreviations(t);
  t = t.replace(/\s+/g, " ").trim();
  return t;
}
function normalizeSentence(s) {
  let t = s.trim();
  t = t.replace(/^(and|but|so|because|which|who|that)\s+/i, "");
  if (!t) return "";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t.replace(/[,;:\-\s]+$/, "");
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}
function truncateAtWord(s, maxLen) {
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
  return safe.trim().replace(/[,;:\-\s]+$/, "") + ".";
}
function splitSentences(text) {
  return (text.match(/[^.!?;\n]+[.!?;]*/g) || []).map((s) => s.trim()).filter(Boolean);
}
function splitIntoUnits(text) {
  let units = splitSentences(text);
  if (units.length <= 1 && text.length > 160) {
    let clauses = text
      .split(/,\s+(?:and|but|so|because|who|which|that)\s+|,\s+/i)
      .map((c) => c.trim())
      .filter(Boolean);
    if (clauses.length <= 1) {
      clauses = text
        .split(/\s+and\s+|\s+but\s+|\s+so\s+/i)
        .map((c) => c.trim())
        .filter(Boolean);
    }
    if (clauses.length > 1) units = clauses;
  }
  return units;
}
function scoreSentence(s) {
  let score = 0;
  if (TRIGGER_WORDS_RE.test(s)) score += 3;
  for (const cat of PLATFORM_CATALOGUE) if (cat.pattern.test(s)) score += 2;
  if (/\d/.test(s)) score += 1;
  score += Math.min(s.length, 120) / 120;
  return score;
}
const SUMMARY_MAX_LEN = 130;
function summarizeNotes(raw, categories, maxLen = SUMMARY_MAX_LEN) {
  const text = cleanText(raw);
  if (!text) return fallbackSummary(categories);
  const clean = splitIntoUnits(text)
    .map((s) => s.trim())
    .filter((s) => s && !hasForbiddenContent(s));
  if (clean.length === 0) return fallbackSummary(categories);
  const ranked = clean.map((s, idx) => ({ s, idx, score: scoreSentence(s) })).sort((a, b) => b.score - a.score);
  const fitting = ranked.find((c) => normalizeSentence(c.s).length <= maxLen);
  const sentence = normalizeSentence((fitting || ranked[0]).s);
  return sentence.length <= maxLen ? sentence : truncateAtWord(sentence, maxLen);
}
function summarizeFromSnippets(hits, categories) {
  const unique = [...new Set(hits.map((h) => cleanText(h.snippet)))].filter((s) => !hasForbiddenContent(s));
  if (unique.length === 0) return fallbackSummary(categories);
  const sentence = normalizeSentence(unique[0]);
  return sentence.length <= SUMMARY_MAX_LEN ? sentence : truncateAtWord(sentence, SUMMARY_MAX_LEN);
}
// Returns null, or { categories: [rawLabels], tier, snippet, notesSummary, hits }.
// `hits` (each { category, matchText, snippet, hasTrigger }) is exposed so the
// unified scanner can apply the Azure-migration override rule per-hit.
function scanRowPlatform(row, columns, commentsValue, productAreaValue) {
  const fields = columns.map((c) => String(row[c] ?? ""));
  const combined = fields.join("   ");
  const hits = [];
  for (const cat of PLATFORM_CATALOGUE) {
    const re = new RegExp(cat.pattern.source, cat.pattern.flags.includes("g") ? cat.pattern.flags : cat.pattern.flags + "g");
    let m;
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
        matchText: m[0],
        snippet: win,
        hasTrigger:
          TRIGGER_WORDS_RE.test(win) ||
          LICENSE_COUNT_RE.test(win) ||
          // Growth/overload language ("stretched thin", "overwhelmed", "no IT
          // staff") is an M365 Tenant signal, not an Azure one — per Jack,
          // that phrasing is about wanting a support relationship, which
          // belongs to Tenant Support, not to an infrastructure/platform
          // decision like Azure. Azure's own bonus is scale language only
          // (VMs, usage, consumption, adoption) below.
          (cat.label === TENANT_SUPPORT_CATEGORY_LABEL && GROWTH_OVERLOAD_RE.test(win)) ||
          (cat.label === "Azure" && AZURE_SCALE_RE.test(win)) ||
          (cat.label === "Dynamics 365" &&
            (DYNAMICS_MULTI_MODULE_RE.test(win) ||
              (DYNAMICS_SPECIFIC_INSTANCE_RE.test(win) && (LICENSE_COUNT_RE.test(win) || DYNAMICS_ESTIMATED_COUNT_RE.test(win))))) ||
          hasBareTrailingCount(combined.slice(m.index + m[0].length, m.index + m[0].length + 80)) ||
          hasBareLeadingCount(combined.slice(Math.max(0, m.index - 80), m.index)),
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  if (productAreaValue) {
    const paText = String(productAreaValue);
    for (const cat of PLATFORM_CATALOGUE) {
      if (cat.pattern.test(paText)) {
        hits.push({ category: cat.label, matchText: cat.label, snippet: cleanText(paText), hasTrigger: true, fromProductArea: true });
      }
    }
  }
  if (hits.length === 0) return null;
  const categories = [...new Set(hits.map((h) => h.category))];
  const tier = hits.some((h) => h.hasTrigger) ? "signal" : "mention";
  const bestHit = hits.find((h) => h.fromProductArea) || hits.find((h) => h.hasTrigger) || hits[0];
  const notesRaw = commentsValue || null;
  const notesSummary = notesRaw ? summarizeNotes(notesRaw, categories) : summarizeFromSnippets(hits, categories);
  return { categories, tier, snippet: bestHit.snippet, notesSummary, hits };
}

/* ------------------------------------------------------------------ */
/* PART 2.5 — Auto-DQ ("Bad Leads"). Cross-cutting: applies on top of    */
/* whatever category/tier the row already earned, and always wins — a   */
/* row that trips any of these never lands in Strong Signal or Needs    */
/* Review, no matter what else it matched. Still fully visible and      */
/* manually reversible (the tier badge cycles Strong Signal → Needs     */
/* review → Bad lead → back), and still keeps its detected product      */
/* line, so Bad Leads can be reported on per product line just like     */
/* everything else. Per Jack's rules, in order added:                   */
/*   1. Single seat/user, or a freelancer/solo operator — not a real     */
/*      account-level opportunity regardless of what else it mentions.  */
/*   2. Explicit rejection / "not interested" language.                 */
/*   3. Already happy with / locked into their current provider.        */
/*   4. Stated personal/non-business use.                                */
/*   5. A basic support or account-login problem, not an IT need — this  */
/*      overrides even Tenant Support's own "help desk"/"support"        */
/*      wording, since wanting an ongoing IT relationship (good) and     */
/*      having a one-off login problem (bad) can use similar words.      */
/*   6. Wants Microsoft's own direct support, not a reseller/MSP.        */
/* Plus two data-hygiene checks below (missing company, placeholder      */
/* email) and the sub-threshold (QUALIFY_THRESHOLD) licensing seat count  */
/* folded in from PART 1.                                                */
/* ------------------------------------------------------------------ */
const DQ_RULES = [
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
    pattern:
      /\bhappy\s*with\s*(?:our|their|my|the)?\s*current\b|\bsatisfied\s*with\s*(?:our|their|my|the)?\s*current\b|\bjust\s*renewed\b|\bjust\s*signed\b|\blocked\s*in(?:to)?\b|\bunder\s*contract\b/i,
  },
  {
    label: "Personal / non-business use",
    pattern: /\bfor\s*personal\s*use\b|\bhome\s*use\b|\bhobby\s*project\b|\bfor\s*school\b|\bstudent\s*project\b/i,
  },
  {
    label: "Basic support / login issue",
    pattern:
      /\bpassword\s*reset\b|\bforgot(?:ten)?\s*(?:my\s*)?password\b|\bcan'?t\s*log\s*in\b|\bcannot\s*log\s*in\b|\blocked\s*out\s*of\s*(?:my|our|their)?\s*account\b|\blog-?in\s*(?:issue|problem|trouble)\b|\busername\s*(?:issue|problem|reset|recovery)\b|\baccount\s*login\b|\bhow\s*do\s*i\s*(?:log\s*in|reset\s*my\s*password)\b/i,
  },
  {
    label: "Wants direct Microsoft support",
    pattern:
      /\bcontact\s*microsoft\s*support\b|\bmicrosoft\s*support\s*(?:ticket|case|line)\b|\bopen\s*a\s*case\s*with\s*microsoft\b|\bcall\s*microsoft\b|\bmicrosoft\s*technical\s*support\b/i,
  },
];
const PLACEHOLDER_EMAIL_RE = /^(?:test|noemail|none|na|asdf|example|foo|bar|sample|placeholder|xxx+)@|@(?:test|example)\.(?:com|org|net)$/i;
function getDQReasons(combinedText, resolved, licensing) {
  const reasons = [];
  for (const rule of DQ_RULES) {
    if (rule.pattern.test(combinedText)) reasons.push(rule.label);
  }
  if (licensing && licensing.status === "dq") reasons.push(`Low seat count (under ${QUALIFY_THRESHOLD})`);
  if (!resolved.company || !String(resolved.company).trim()) reasons.push("Missing company name");
  if (resolved.email && PLACEHOLDER_EMAIL_RE.test(String(resolved.email).trim())) reasons.push("Placeholder/invalid email");
  return reasons;
}

/* ------------------------------------------------------------------ */
/* PART 3 — Unified scan: runs BOTH engines over one row, resolves the  */
/* result down to exactly one of three product lines (auto-assigned,   */
/* but always reassignable), which in turn always roll up into exactly */
/* three download buckets, one-to-one with the three product lines.    */
/* ------------------------------------------------------------------ */
// Power BI / Microsoft Fabric / Azure are grouped together into one combined
// product line, per Jack's request — each still has its own detection
// pattern and hit-level trigger logic underneath (nothing about matching
// changed), only the downstream product-line/download they roll up into is
// now shared. Generic Migration/Modernization moves in with M365 Tenant
// (rather than staying with the Power BI/Fabric/Azure group), since a plain
// "migrating off our current systems" mention is closer in spirit to the
// licensing/tenant-support cluster than to a specific platform evaluation.
const PLATFORM_LABEL_TO_KEY = {
  "Dynamics 365": "dynamics365",
  "Power BI": "dataPlatform",
  "Microsoft Fabric": "dataPlatform",
  Azure: "dataPlatform",
  [MIGRATION_CATEGORY_LABEL]: "m365Tenant",
  [TENANT_SUPPORT_CATEGORY_LABEL]: "m365Tenant",
};
// Three product lines the platform tracks and shows broken out, each rolling
// up 1:1 into its own download:
//   - M365 Tenant: licensing seats + Tenant Support (Google-to-Microsoft
//     migration, new tenant creation, ongoing IT support) + generic
//     Migration/Modernization — all grouped as one, since they're all
//     really "who owns/supports/moves this client's M365 tenant" leads.
//   - Dynamics 365 — its own sales motion, unchanged.
//   - Power BI / Azure / Fabric — the three platform/data signals grouped
//     into one combined product line.
// Category accent colors are drawn from wiredcio.com's own pillar palette
// (Protect = blue, Automate = purple) so the badges read as "ours" rather
// than generic UI colors — deliberately NOT reusing the brand green here,
// since that's already the tier-level "Strong Signal" color elsewhere and
// reusing it for a category too would blur the two meanings together.
const CATEGORY_META = {
  m365Tenant: { label: "M365 Tenant", color: "#B34A1F", bg: "#FBE7DB", bucket: "m365Tenant" },
  dynamics365: { label: "Dynamics 365", color: "#5B3FC4", bg: "#EEEAFC", bucket: "dynamics" },
  dataPlatform: { label: "Power BI / Azure / Fabric", color: "#1470A0", bg: "#E1F1FA", bucket: "dataPlatform" },
};
// Priority order used ONLY to pick the single default category when a row
// trips more than one signal (e.g. Dynamics 365 + Azure in the same note).
// Dynamics wins first since it's its own sales motion; the Power BI/Azure/
// Fabric group next; and finally M365 Tenant (licensing + tenant support +
// generic migration combined), which is the most generic of the three. This
// is a default only — every row can be moved to any of the three product
// lines by hand regardless of what auto-assigned it.
const CATEGORY_PRIORITY = ["dynamics365", "dataPlatform", "m365Tenant"];
const BUCKET_META = {
  m365Tenant: { label: "M365 Tenant", slug: "m365-tenant" },
  dynamics: { label: "Dynamics", slug: "dynamics" },
  dataPlatform: { label: "Power BI / Azure / Fabric", slug: "power-bi-azure-fabric" },
};
function scanRowUnified(row, columns, resolved) {
  const licensing = scanRowLicensing(row, columns);
  const platform = scanRowPlatform(row, columns, resolved.comments || null, resolved.productArea || null);
  if (!licensing && !platform) return null;
  const categorySet = new Set();
  if (platform) {
    platform.hits.forEach((h) => {
      const key = PLATFORM_LABEL_TO_KEY[h.category];
      if (h.category === MIGRATION_CATEGORY_LABEL && AZURE_MIGRATION_OVERRIDE_RE.test(h.snippet)) {
        categorySet.add("dataPlatform");
      } else if (key) {
        categorySet.add(key);
      }
    });
  }
  let licensingTier = null;
  if (licensing) {
    categorySet.add("m365Tenant");
    licensingTier = licensing.status === "qualified" ? "signal" : "mention";
  }
  if (categorySet.size === 0) return null;
  const categories = [...categorySet];
  const autoCategory = CATEGORY_PRIORITY.find((k) => categorySet.has(k)) || categories[0];
  let tier = (platform && platform.tier === "signal") || licensingTier === "signal" ? "signal" : "mention";
  let notesSummary;
  if (platform) notesSummary = platform.notesSummary;
  else {
    // Licensing-only row: try to summarize the matched snippet same as
    // everywhere else; if the scrubbing pipeline strips it entirely (e.g. it
    // was full of renewal/billing language), fall back to the detected SKU
    // name(s) rather than a generic line with no useful detail.
    const scrubbed = summarizeFromSnippets([{ snippet: licensing.snippet }], []);
    notesSummary = scrubbed || `Interested in ${licensing.skus.join(", ")}${licensing.count ? ` (~${licensing.count} seats)` : ""}.`;
  }

  // Auto-DQ overlay — always wins over whatever tier was just computed above,
  // regardless of category. Fully visible (not dropped) and fully
  // overridable by hand via the tier badge/bulk actions, same as any other
  // auto-assignment in this tool.
  const combinedForDQ = columns.map((c) => String(row[c] ?? "")).join("   ");
  const dqReasons = getDQReasons(combinedForDQ, resolved, licensing);
  if (dqReasons.length > 0) tier = "dq";

  return {
    categories,
    autoCategory,
    category: autoCategory, // mutable — this is what manual reassignment changes
    tier,
    dqReasons, // [] unless tier === "dq", in which case one or more reason labels
    licensing, // { skus, count, snippet, status } | null
    platform: platform ? { snippet: platform.snippet } : null,
    notesSummary,
  };
}

/* ------------------------------------------------------------------ */
/* PART 4 — Column resolution. Every field is resolved PER FILE against */
/* that file's own headers before rows are merged, so two files in the  */
/* same upload naming the same field differently (e.g. "Phone" vs.      */
/* "Work Direct Phone") both still populate correctly.                  */
/* ------------------------------------------------------------------ */
function normalizeKey(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
}
function guessColumn(columns, candidates) {
  const normCols = columns.map((c) => ({ raw: c, norm: normalizeKey(c) }));
  for (const cand of candidates) {
    const normCand = normalizeKey(cand);
    const found = normCols.find((c) => c.norm === normCand) || normCols.find((c) => c.norm.includes(normCand));
    if (found) return found.raw;
  }
  return null;
}
const FIELD_DEFS = [
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
const EXPORT_LABELS = ["First Name", "Last Name", "Title", "Company Name", "Email", "Work Direct Phone", "Mobile Phone", "Number of Employees", "Product Area", "Notes"];
function getFullName(f) {
  const combined = `${f.firstName || ""} ${f.lastName || ""}`.trim();
  if (combined) return combined;
  return String(f.fullName || "").trim();
}
function buildExportRow(r) {
  const f = r.row.__f || {};
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
function toCSV(rows, columns) {
  return Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? "")) });
}
function downloadCSV(filename, rows, columns) {
  const csv = toCSV(rows, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Inline icon set                                                      */
/* ------------------------------------------------------------------ */
const ICON = {
  upload: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 21h14"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5.5"/></svg>',
  circleDot: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>',
  warning: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 16H3z"/><path d="M12 9v4"/><circle cx="12" cy="16.2" r="0.6" fill="currentColor" stroke="none"/></svg>',
  gauge: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#EAF2ED" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="7"/><path d="M12 14l3.2-4"/><path d="M8 5h8"/></svg>',
  book: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17z"/><path d="M20 19H6.5a2.5 2.5 0 0 0-2.5 2.5"/><path d="M8 7h8"/><path d="M8 11h8"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.5l2 2.5h8A1.5 1.5 0 0 1 20.5 9v9A1.5 1.5 0 0 1 19 19.5H4.5A1.5 1.5 0 0 1 3 18V6.5z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><path d="M7 5.5v13l11-6.5-11-6.5z"/></svg>',
  strike: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="M8.5 7.5C8.5 6 10 5 12 5s3.5 1.2 3.5 2.8c0 .9-.5 1.6-1.3 2.1"/><path d="M9.3 16.5c.3 1.3 1.6 2.5 3.2 2.5 1.8 0 3.3-1.1 3.3-2.6 0-.9-.5-1.6-1.3-2"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
};
function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ */
/* PART 5 — State + upload handling                                     */
/* ------------------------------------------------------------------ */
const state = {
  view: "scanner", // scanner | history | library
  rawRows: null,
  results: [],
  uploadedFiles: [], // [{name, rows}]
  categoryFilter: "all", // all | one of CATEGORY_META keys
  tierFilter: "signal", // signal | mention | all
  // Quick filter: when true, only show rows flagged as a duplicate (same
  // exact full name + company as an earlier row in this same import). Off by
  // default so the normal view is untouched; toggled from the "Duplicates"
  // pill next to the tier tabs, which only appears when this batch actually
  // has any. See markDuplicateLeads() for the detection rule itself.
  duplicatesOnly: false,
  search: "",
  dragOver: false,
  error: null,
  selected: [], // ids currently checked, for bulk reassignment
  bulkTarget: "dynamics365",
  page: 1,
  history: [], // { id, fileName, importedAt, rowsScanned, results }
  historyLoading: true, // IndexedDB-backed like the Library — see loadLibraryFromDB()
  historyError: null,
  historySearch: "", // matches file names AND company/contact text, across ALL weeks (not just the active tab)
  historySelected: [], // ids currently checked, for "combine into Scanner"
  historyVisibleCount: 20, // "Show more" reveal — avoids rendering hundreds of full cards at once
  selectedWeek: null,
  viewingHistoryId: null,
  combinedHistoryIds: [], // set when multiple History entries are combined into one Scanner working view
  backupNotice: null, // transient success message after "Backup everything" / "Restore backup"
  showCheatSheet: false, // "Detected" column cheat sheet, opened from the corner button
  // Library — the permanent, IndexedDB-backed archive (survives reloads
  // without a manual save/load file, unlike History) so qualified leads
  // always have a copy living somewhere other than "another system." Only
  // saved when Jack opts in (the "Save this batch to the Library"
  // checkbox); only Strong Signal leads are kept, one file per category per
  // month (at most 3 per month folder — see fileSignalRowsIntoGroup). Each
  // entry: { id, fileName, rawText, rows, rowCount, uploadedAt, receivedAt,
  // groupId, bucketKey }. `rows` is the structured export-row data `rawText`
  // is generated from (each with a hidden __historyEntryId so a specific
  // batch's contribution can be found/removed later); uploadedAt is when
  // the file was first created (NOT bumped on later appends); receivedAt is
  // blank until typed in by hand; fileName is editable after the fact;
  // groupId links to a libraryGroups entry (the month folder); bucketKey is
  // which of the 3 categories this file is (m365Tenant | dynamics |
  // dataPlatform).
  library: [],
  libraryLoading: true,
  libraryError: null,
  librarySearch: "",
  librarySelected: [],
  // Which Library entries (files) currently have their individual leads
  // expanded open for inline view/edit/delete — "under folders, I want to
  // be able to edit and delete the files at will." A file here is really a
  // shared, ongoing export (up to 3 per month), so "editable" means each
  // individual lead ROW inside it can be corrected or removed by hand, not
  // just the file's name/group/received-date as before.
  libraryExpandedEntryIds: [],
  // Groups: { id, name, notes, createdAt }. Purely organizational — never
  // affects scanning/detection, just how the Library is browsed/filtered.
  libraryGroups: [],
  libraryGroupFilter: "all", // all | ungrouped | a group id
  libraryCategoryFilter: "all", // all | m365Tenant | dynamics365 | dataPlatform
  showNewGroupForm: false,
  libraryBulkGroupTarget: "",
  // Which month/year to file a NEW upload under, picked right on the
  // dropzone before scanning — "the three downloadable categories should be
  // properly stored with that given month's csv files uploaded fully
  // scanned," per Jack. Defaults to the current month so day-to-day uploads
  // behave exactly as before with zero extra clicks; changed only when
  // backfilling an older month. Reset back to the current month by reset()
  // after each batch, so a backfill pick can't silently leak into the next,
  // unrelated upload.
  uploadMonthKey: monthKeyFromDate(new Date()),
  // Whether the NEXT upload should be saved/filed to the Library at all.
  // Off by default, per Jack: "the ability to select if that is what i want
  // to do or just upload a one-off file just to scan review and do as i
  // please." Checking it also reveals the month picker above (filing a
  // month only makes sense once you've said you want to save it). Reset to
  // false by reset() after every batch — an explicit, deliberate choice
  // each time, not a setting that quietly stays on.
  saveToLibrary: false,
};
const PAGE_SIZE = 25;
const MAX_FILES = 5;
function setState(patch) {
  Object.assign(state, patch);
  render();
}
function parseFileAsync(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => resolve({ name: file.name, fields: parsed.meta.fields || [], data: parsed.data }),
      error: (err) => reject(new Error(`${file.name}: ${err.message || "could not be parsed"}`)),
    });
  });
}
const PHONE_LIKE_RE = /phone|mobile|\bcell\b|\btel\b|direct\s*dial/i;
/* ------------------------------------------------------------------ */
/* PART 2.6 — Duplicate detection. Jack's rule: the same exact contact  */
/* (full name) at the same exact company should never silently appear  */
/* twice out of one import — he was looking at a real import with at    */
/* least 4 duplicate rows in it. Scoped to just the batch being scanned */
/* right now (NOT cross-checked against the Library or past History     */
/* batches — that's a separate, bigger ask he explicitly didn't pick).   */
/* Matching is exact after trimming/lowercasing/collapsing whitespace — */
/* not fuzzy, not typo-tolerant — on purpose, so Jack can see the real   */
/* hit rate before deciding whether to tighten it. Rows are FLAGGED,     */
/* never auto-removed, per Jack: "flag for now then we will decide, i    */
/* want to see the accuracy."                                           */
/* ------------------------------------------------------------------ */
function normalizeDupKey(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function markDuplicateLeads(combinedResults) {
  const firstSeenId = new Map(); // "name|||company" -> id of the first row seen with this key
  const groupSize = new Map(); // same key -> how many rows in this batch share it
  combinedResults.forEach((r) => {
    const f = r.row.__f || {};
    const nameKey = normalizeDupKey(getFullName(f));
    const companyKey = normalizeDupKey(f.company);
    r.isDuplicate = false;
    r.duplicateOfId = null;
    r.dupKey = null;
    // Can't confidently call two rows the same lead without both a name and
    // a company to compare — rows missing either just never enter the check.
    if (!nameKey || !companyKey) return;
    const key = `${nameKey}|||${companyKey}`;
    r.dupKey = key;
    groupSize.set(key, (groupSize.get(key) || 0) + 1);
    if (firstSeenId.has(key)) {
      r.isDuplicate = true;
      r.duplicateOfId = firstSeenId.get(key);
    } else {
      firstSeenId.set(key, r.id);
    }
  });
  // Second pass: stamp the total group size onto every row sharing a key
  // (including the first occurrence), so the UI can show "3 rows with this
  // exact name + company in this import" no matter which one you're looking at.
  combinedResults.forEach((r) => { if (r.dupKey) r.duplicateGroupSize = groupSize.get(r.dupKey); });
}
// The actual mapping + scan pass, pulled out on its own so it can run ONCE
// per upload and feed both the Library save (needs just the Strong Signal
// rows) and the Scanner/History entry (needs everything, every tier) —
// instead of scanning twice or duplicating the column-guessing logic.
function scanParsedFiles(parsedFiles) {
  let rowsScanned = 0;
  const combinedResults = [];
  parsedFiles.forEach((pf, fileIdx) => {
    rowsScanned += pf.data.length;
    const fileMapping = {};
    FIELD_DEFS.forEach((f) => { fileMapping[f.key] = guessColumn(pf.fields, f.candidates) || ""; });
    const claimedCols = new Set(Object.values(fileMapping).filter(Boolean));
    const unclaimedPhoneCols = pf.fields.filter((c) => !claimedCols.has(c) && PHONE_LIKE_RE.test(c));
    if (!fileMapping.workPhone && unclaimedPhoneCols.length > 0) fileMapping.workPhone = unclaimedPhoneCols.shift();
    if (!fileMapping.mobilePhone && unclaimedPhoneCols.length > 0) fileMapping.mobilePhone = unclaimedPhoneCols.shift();
    pf.data.forEach((row, i) => {
      const resolved = {};
      FIELD_DEFS.forEach((f) => { resolved[f.key] = fileMapping[f.key] ? row[fileMapping[f.key]] ?? "" : ""; });
      const scan = scanRowUnified(row, pf.fields, resolved);
      if (!scan) return;
      combinedResults.push({ id: `${fileIdx}-${i}`, row: { ...row, __f: resolved }, sourceFile: pf.name, crossedOut: false, ...scan });
    });
  });
  markDuplicateLeads(combinedResults);
  return { combinedResults, rowsScanned };
}
// Shared by both a fresh file upload (handleFiles) and re-running a file
// already sitting in the Library back through the Scanner
// (loadLibraryEntryIntoScanner/loadSelectedLibraryIntoScanner) — same
// mapping + scan + History-entry logic either way, just a different source
// for `parsedFiles`. `precomputedScan`/`historyEntryId`, when given, skip
// re-scanning and reuse the id handleFiles already generated (it needs the
// id up front to tag which Library rows belong to this exact batch).
function applyParsedFiles(parsedFiles, libraryEntryIds, monthKey, precomputedScan, historyEntryId) {
  const { combinedResults, rowsScanned: combinedRawCount } = precomputedScan || scanParsedFiles(parsedFiles);
  const historyEntry = {
    id: historyEntryId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    // Kept for backward compatibility with history files saved before
    // `files` existed — display code prefers `files` and falls back to
    // splitting this string when reading an older saved history file.
    fileName: parsedFiles.map((pf) => pf.name).join(", "),
    files: parsedFiles.map((pf) => ({ name: pf.name, rows: pf.data.length })),
    importedAt: new Date().toISOString(),
    rowsScanned: combinedRawCount,
    results: combinedResults,
    // Auto-filed the moment the month is known (picked on the dropzone
    // before scanning, or carried over from the Library folder a reloaded
    // file already sits in) — categorization is unchanged, this just means
    // the scanned/categorized batch is ALREADY properly stored under that
    // month, not waiting on a separate "File this batch" click. Still a
    // short manual label editable from the History card either way.
    tag: monthKey ? `${monthLabelFromKey(monthKey)} Leads` : "",
    notes: "", // free-text note on the batch, e.g. why it performed the way it did
    // The (up to 3) Library category files this batch's Strong Signal leads
    // were merged into (see fileSignalRowsIntoGroup, called just before this
    // in handleFiles). Lets "File this batch to [month]" pull this batch's
    // own rows back out and re-file them elsewhere without disturbing any
    // other batch's rows sharing the same monthly file. Empty for a
    // one-off scan that was never filed, or an entry that predates this link.
    libraryEntryIds: Array.isArray(libraryEntryIds) ? libraryEntryIds : [],
  };
  setState({
    view: "scanner",
    rawRows: new Array(combinedRawCount),
    results: combinedResults,
    uploadedFiles: parsedFiles.map((pf) => ({ name: pf.name, rows: pf.data.length })),
    history: [historyEntry, ...state.history],
    page: 1,
    selected: [],
    viewingHistoryId: null,
    combinedHistoryIds: [],
  });
  historyDBPut(historyEntry).catch(() => {
    state.historyError = "Couldn't save this import to local storage — it'll still work this session, but may not survive a reload.";
    render();
  });
}
async function handleFiles(fileListLike) {
  const all = Array.from(fileListLike || []).filter((f) => f && /\.csv$/i.test(f.name));
  if (!all.length) return;
  let files = all;
  let notice = null;
  if (all.length > MAX_FILES) {
    files = all.slice(0, MAX_FILES);
    notice = `You dropped ${all.length} files — only the first ${MAX_FILES} were scanned. Upload the rest in a second batch.`;
  }
  setState({ error: notice, viewingHistoryId: null });
  try {
    const parsedFiles = await Promise.all(files.map(parseFileAsync));
    // Scan once, share the result: the Scanner/History entry gets every row,
    // every tier (unchanged); the Library save (only when Jack has opted in
    // via the "Save this batch to the Library" checkbox) gets just the
    // Strong Signal rows, merged into that month's 3 category files. Nothing
    // is saved to the Library by default — a one-off scan is just that,
    // review and download as you please, nothing archived, per Jack's ask.
    const scan = scanParsedFiles(parsedFiles);
    const historyEntryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filingMonthKey = state.saveToLibrary ? state.uploadMonthKey : null;
    let touchedLibraryEntries = [];
    if (state.saveToLibrary) {
      const groupId = getOrCreateGroupByName(monthLabelFromKey(filingMonthKey));
      const signalRows = scan.combinedResults.filter((r) => r.tier === "signal");
      touchedLibraryEntries = fileSignalRowsIntoGroup(groupId, signalRows, historyEntryId);
    }
    applyParsedFiles(parsedFiles, touchedLibraryEntries.map((e) => e.id), filingMonthKey, scan, historyEntryId);
  } catch (err) {
    setState({ error: (err && err.message) || "Could not parse one or more of these files." });
  }
}
function reset() {
  setState({ rawRows: null, results: [], uploadedFiles: [], error: null, search: "", categoryFilter: "all", tierFilter: "signal", duplicatesOnly: false, dragOver: false, viewingHistoryId: null, combinedHistoryIds: [], page: 1, selected: [], uploadMonthKey: monthKeyFromDate(new Date()), saveToLibrary: false });
}

/* ------------------------------------------------------------------ */
/* PART 5.5 — Library: a permanent, browser-local archive of every       */
/* uploaded CSV, backed by IndexedDB so it survives reloads without a    */
/* manual save/load step (unlike History, which is in-memory unless      */
/* explicitly saved to a JSON file). This is separate from History:      */
/* History is "what did a given scan/import look like," Library is "give */
/* me the original file back, and let me reprocess it later."            */
/* Storage caveat, worth knowing: this is a real IndexedDB database       */
/* scoped to the browser profile viewing this file (as a file:// page,   */
/* Chromium shares one such origin across every copy of this file on     */
/* disk), not a folder on disk — clearing browser data, using a different */
/* browser, or opening on a different computer starts a fresh, empty      */
/* Library. It is NOT a substitute for a real backend/database, which is  */
/* still item #1 on the CRM roadmap.                                      */
/* ------------------------------------------------------------------ */
const LIBRARY_DB_NAME = "wiredCioUnifiedLeadScannerLibrary_v1";
const LIBRARY_STORE = "files";
// Added alongside the "groups" feature — a second store, same database. The
// version bump (1 -> 2) triggers onupgradeneeded even for browsers that
// already have a v1 database from before groups existed, so existing saved
// files are never touched/lost; the groups store is just added alongside.
const LIBRARY_GROUPS_STORE = "groups";
// Added so History can auto-persist the same way Library already does —
// running ~100 files through in one sitting shouldn't ride entirely on
// browser memory with only a manual "Save history file" as a safety net.
// Same version-bump pattern as the groups store: existing v1/v2 databases
// upgrade in place, nothing already saved is touched or lost.
const HISTORY_STORE = "history";
const LIBRARY_DB_VERSION = 3;
function openLibraryDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("This browser doesn't support local file storage.")); return; }
    const req = indexedDB.open(LIBRARY_DB_NAME, LIBRARY_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LIBRARY_STORE)) db.createObjectStore(LIBRARY_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(LIBRARY_GROUPS_STORE)) db.createObjectStore(LIBRARY_GROUPS_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(HISTORY_STORE)) db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Could not open local file storage."));
  });
}
async function dbGetAll(storeName) {
  const db = await openLibraryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(storeName, entry) {
  const db = await openLibraryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDelete(storeName, id) {
  const db = await openLibraryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
const libraryDBGetAll = () => dbGetAll(LIBRARY_STORE);
const libraryDBPut = (entry) => dbPut(LIBRARY_STORE, entry);
const libraryDBDelete = (id) => dbDelete(LIBRARY_STORE, id);
const libraryGroupsDBGetAll = () => dbGetAll(LIBRARY_GROUPS_STORE);
const libraryGroupsDBPut = (group) => dbPut(LIBRARY_GROUPS_STORE, group);
const libraryGroupsDBDelete = (id) => dbDelete(LIBRARY_GROUPS_STORE, id);
const historyDBGetAll = () => dbGetAll(HISTORY_STORE);
const historyDBPut = (entry) => dbPut(HISTORY_STORE, entry);
const historyDBDelete = (id) => dbDelete(HISTORY_STORE, id);
// Boot sequence note: the very first render() is deliberately held until
// this resolves (see the DOMContentLoaded handler below), rather than
// rendering immediately and re-rendering again once the Library loads. An
// early version did the latter, and it created a real race: render() always
// does a full `root.innerHTML = html` replace, so a second render firing
// asynchronously shortly after boot could silently detach a DOM node (like
// #file-input) out from under an in-flight interaction — e.g. a fast user
// who opens the tool and immediately drops a file before the async
// IndexedDB read resolves. Awaiting it first (with a generous but bounded
// timeout, so a broken/slow browser storage layer can't block boot forever)
// removes that window entirely for the realistic case.
// Loads Library files, Library groups, AND History in one pass — all three
// live in the same IndexedDB database, and History rides along on the same
// boot-sequence await/timeout described above (rather than getting its own
// separate race) since a slow/broken storage layer affects all three
// equally in practice.
function loadLibraryFromDB() {
  return Promise.all([libraryDBGetAll(), libraryGroupsDBGetAll(), historyDBGetAll()])
    .then(([entries, groups, historyEntries]) => {
      // Newest upload first, same convention as History.
      state.library = entries.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      state.libraryGroups = groups.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      state.libraryLoading = false;
      state.history = historyEntries.sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
      state.historyLoading = false;
      // One-time backfill for files saved before month-folders existed:
      // sort anything still sitting "Ungrouped" into the month it was
      // actually uploaded, so the full archive reads as organized from day
      // one, not just for uploads going forward.
      state.library.forEach((entry) => {
        if (entry.groupId) return;
        entry.groupId = getOrCreateMonthGroupId(entry.uploadedAt);
        libraryDBPut(entry).catch(() => {
          state.libraryError = "Couldn't save the month-folder backfill for one or more files to local storage.";
          render();
        });
      });
      render();
    })
    .catch(() => {
      state.library = [];
      state.libraryGroups = [];
      state.libraryLoading = false;
      state.libraryError = "Couldn't load previously saved files from this browser's local storage.";
      state.history = [];
      state.historyLoading = false;
      state.historyError = "Couldn't load previous import history from this browser's local storage.";
      render();
    });
}
// Month folders — "properly stored with dates" per Jack's ask, built on
// top of the existing Groups mechanism rather than a new hierarchy: every
// newly-saved Library file is auto-dropped into a group named for the
// month it was uploaded (e.g. "August 2026"), created on first use. Files
// can still be manually reassigned to a different (or additional-in-spirit,
// though a file only holds one groupId today) group afterward — this just
// sets a sane default instead of leaving everything "Ungrouped."
function getMonthLabel(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}
function monthKeyFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabelFromKey(key) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}
// Best-effort reverse of monthLabelFromKey — used when re-scanning a Library
// file that's already sitting in a month folder (e.g. "October 2025"), so
// re-running it through the Scanner keeps tagging it under that same month
// instead of going blank. Returns null for anything that isn't a plain
// "Month Year" name (a manually-named group like "Fully contacted"), so
// those correctly fall back to the old, unfiled behavior.
function monthKeyFromGroupName(name) {
  if (!name) return null;
  const d = new Date(`1 ${name}`);
  if (isNaN(d.getTime())) return null;
  return monthKeyFromDate(d);
}
// Range for the "File this batch to..." month picker — Jack backfills leads
// that actually came in earlier than the upload date (as far back as
// October 2025 at time of writing), so this can't just default-and-lock to
// the current month. 36 months back is a dynamic range (not a hardcoded
// cutoff tied to today's date) so it keeps covering "every month since we
// started" with margin as time moves forward, without needing another edit.
function getMonthOptionsForFiling() {
  const now = new Date();
  const options = [];
  for (let i = 35; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKeyFromDate(d);
    options.push({ key, label: monthLabelFromKey(key) });
  }
  return options;
}
// Shared by both the automatic "assign a new upload to this month" path and
// the manual "file this batch to a chosen month" path below — one place that
// creates (or reuses) a month folder by its display name, so the two paths
// can never end up with two different groups for the same month.
function getOrCreateGroupByName(label) {
  let group = state.libraryGroups.find((g) => g.name === label);
  if (!group) {
    group = {
      id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: label,
      notes: "",
      createdAt: new Date().toISOString(),
    };
    state.libraryGroups = [...state.libraryGroups, group];
    libraryGroupsDBPut(group).catch(() => {
      state.libraryError = "Couldn't save the new month group to local storage.";
      render();
    });
  }
  return group.id;
}
function getOrCreateMonthGroupId(isoString) {
  const label = getMonthLabel(isoString);
  return getOrCreateGroupByName(label);
}
// Reverse lookup from a BUCKET_META key to its full display label — reuses
// CATEGORY_META's (more descriptive) labels rather than BUCKET_META's own
// ("Dynamics 365" instead of just "Dynamics") for anything user-facing.
const BUCKET_LABEL = {};
Object.keys(CATEGORY_META).forEach((catKey) => {
  BUCKET_LABEL[CATEGORY_META[catKey].bucket] = CATEGORY_META[catKey].label;
});

// Library storage, take 2 — Jack's refinement: "It should move the strong
// signal leads into the file... I want to be able to go into each monthly
// folder and then click into each strong signal category, given there's
// three, there should be a total of 3 stored per month." So a month folder
// no longer holds one entry per uploaded CSV; it holds AT MOST 3 entries —
// one per downloadable category (M365 Tenant, Dynamics 365, Power BI/Azure/
// Fabric) — each a running export of every Strong Signal lead ever filed
// into that month, across however many separate uploads/batches. Filing a
// second batch into an already-used month APPENDS onto the existing 3
// files rather than creating new ones (no dedup against what's already
// there, same "just concatenate" convention the rest of the archive uses —
// see "Select entire archive").
//
// Each stored row keeps a hidden `__historyEntryId` tag (never part of the
// exported CSV columns — toCSV only ever pulls the named EXPORT_LABELS
// columns) so a specific batch's contribution can be found and pulled back
// out later if it needs to be re-filed under a different month.
function getOrCreateMonthCategoryEntry(groupId, bucketKey) {
  let entry = state.library.find((e) => e.groupId === groupId && e.bucketKey === bucketKey);
  if (!entry) {
    const group = state.libraryGroups.find((g) => g.id === groupId);
    entry = {
      id: `lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: `${BUCKET_LABEL[bucketKey]} — ${group ? group.name : "Unfiled"}.csv`,
      rawText: "",
      rows: [], // export-shaped row objects (see buildExportRow) plus a hidden __historyEntryId per row
      rowCount: 0,
      uploadedAt: new Date().toISOString(),
      receivedAt: null,
      groupId,
      bucketKey, // which of the 3 categories this file is — m365Tenant | dynamics | dataPlatform
    };
    state.library = [entry, ...state.library];
  }
  return entry;
}
function appendSignalRowsToMonthCategory(groupId, bucketKey, exportRows) {
  const entry = getOrCreateMonthCategoryEntry(groupId, bucketKey);
  entry.rows = [...(entry.rows || []), ...exportRows];
  entry.rowCount = entry.rows.length;
  entry.rawText = toCSV(entry.rows, EXPORT_LABELS);
  libraryCategoryCountCache.delete(entry.id); // rawText just changed — stale cached counts would undercount this file
  libraryDBPut(entry).catch(() => {
    state.libraryError = "Couldn't save Strong Signal leads to the Library (browser storage may be full or unavailable). Scanning still worked normally.";
    render();
  });
  return entry;
}
// Splits this batch's Strong Signal rows by category and merges each group
// into that month's matching category file (creating it on first use).
// Returns the (up to 3) touched entries, handed back so the caller can
// stamp the batch's History entry with exactly which files it landed in.
function fileSignalRowsIntoGroup(groupId, signalResultRows, historyEntryId) {
  const byBucket = new Map();
  signalResultRows.forEach((r) => {
    const bk = CATEGORY_META[r.category].bucket;
    if (!byBucket.has(bk)) byBucket.set(bk, []);
    byBucket.get(bk).push(r);
  });
  const touchedEntries = [];
  byBucket.forEach((rows, bk) => {
    // __rowKey is a stable per-row id (independent of array position) so an
    // individual lead can be edited/deleted/moved later without relying on
    // its current index in entry.rows, which shifts as other rows are added
    // or removed — see findLibraryRowIndex below.
    const exportRows = rows.map((r) => ({ ...buildExportRow(r), __historyEntryId: historyEntryId, __rowKey: `${historyEntryId}-${r.id}` }));
    touchedEntries.push(appendSignalRowsToMonthCategory(groupId, bk, exportRows));
  });
  return touchedEntries;
}
// The inverse — pulls one batch's own rows back out of whichever category
// files it was previously filed into (used when re-filing a batch under a
// DIFFERENT month via the manual picker, so its rows move rather than
// duplicate). Deletes a category file entirely if removing this batch
// empties it out; otherwise just shrinks it and re-serializes.
function removeBatchSignalRows(historyEntryId, libraryEntryIds) {
  (libraryEntryIds || []).forEach((libId) => {
    const entry = state.library.find((e) => e.id === libId);
    if (!entry || !Array.isArray(entry.rows)) return;
    entry.rows = entry.rows.filter((r) => r.__historyEntryId !== historyEntryId);
    libraryCategoryCountCache.delete(entry.id);
    if (entry.rows.length === 0) {
      state.library = state.library.filter((e) => e.id !== entry.id);
      return;
    }
    entry.rowCount = entry.rows.length;
    entry.rawText = toCSV(entry.rows, EXPORT_LABELS);
    libraryDBPut(entry).catch(() => {
      state.libraryError = "Couldn't update the Library after re-filing a batch.";
      render();
    });
  });
}
// Per-lead editing inside a folder's category file — Jack: "under folders,
// i want to be able to edit and delete the files at will, need to build
// this out fully so it is fully editable." A Library entry is a shared,
// ongoing export now (up to 3 per month), not a single uploaded file, so
// "editable" means each individual lead row inside it, not just the file's
// own name/group/received-date (which were already editable). This is also
// the fix for a real gap: reassigning a lead's category or promoting/
// demoting its tier in the Scanner AFTER a batch has already auto-filed
// never used to update the archived copy — now Jack can correct or remove
// the archived lead directly, and "Move to" re-files it into the correct
// category's file within the same month folder.
function findLibraryRowIndex(entry, rowKey) {
  if (!entry || !Array.isArray(entry.rows)) return -1;
  const byKey = entry.rows.findIndex((r) => r.__rowKey && r.__rowKey === rowKey);
  if (byKey !== -1) return byKey;
  // Rows saved before __rowKey existed fall back to being addressed by
  // their current array position (still safe: this UI always re-renders
  // synchronously after every mutation before another click can land).
  const asIndex = Number(rowKey);
  return Number.isInteger(asIndex) && asIndex >= 0 && asIndex < entry.rows.length ? asIndex : -1;
}
function toggleLibraryEntryExpanded(id) {
  const set = new Set(state.libraryExpandedEntryIds);
  if (set.has(id)) set.delete(id); else set.add(id);
  setState({ libraryExpandedEntryIds: [...set] });
}
function updateLibraryRowField(entryId, rowKey, field, value) {
  const entry = state.library.find((e) => e.id === entryId);
  const idx = findLibraryRowIndex(entry, rowKey);
  if (!entry || idx === -1 || !EXPORT_LABELS.includes(field)) return;
  entry.rows[idx][field] = value;
  entry.rawText = toCSV(entry.rows, EXPORT_LABELS);
  libraryCategoryCountCache.delete(entry.id);
  render();
  libraryDBPut(entry).catch(() => {
    state.libraryError = "Couldn't save that lead edit to local storage.";
    render();
  });
}
function deleteLibraryRow(entryId, rowKey) {
  const entry = state.library.find((e) => e.id === entryId);
  const idx = findLibraryRowIndex(entry, rowKey);
  if (!entry || idx === -1) return;
  entry.rows.splice(idx, 1);
  libraryCategoryCountCache.delete(entry.id);
  // Deleting the last lead in a category file removes the file itself,
  // same as the existing "empties out" rule in removeBatchSignalRows —
  // an empty archive file isn't worth keeping around as a placeholder.
  if (entry.rows.length === 0) {
    state.library = state.library.filter((e) => e.id !== entry.id);
    state.libraryExpandedEntryIds = state.libraryExpandedEntryIds.filter((id) => id !== entry.id);
    render();
    libraryDBDelete(entry.id).catch(() => {
      state.libraryError = "Couldn't remove that now-empty file from local storage — it may reappear after a reload.";
      render();
    });
    return;
  }
  entry.rowCount = entry.rows.length;
  entry.rawText = toCSV(entry.rows, EXPORT_LABELS);
  render();
  libraryDBPut(entry).catch(() => {
    state.libraryError = "Couldn't save that lead removal to local storage.";
    render();
  });
}
// Moves one lead from its current category file into a DIFFERENT category
// within the same month folder — e.g. correcting a miscategorized lead
// after the fact. Pulls it out of the source file (deleting the file if
// that empties it, same rule as deleteLibraryRow) and appends it into the
// target category's file for that same groupId, creating it if it doesn't
// exist yet (getOrCreateMonthCategoryEntry — the same helper filing uses).
function moveLibraryRowToBucket(entryId, rowKey, newBucketKey) {
  const sourceEntry = state.library.find((e) => e.id === entryId);
  const idx = findLibraryRowIndex(sourceEntry, rowKey);
  if (!sourceEntry || idx === -1 || !BUCKET_LABEL[newBucketKey] || newBucketKey === sourceEntry.bucketKey) return;
  const [row] = sourceEntry.rows.splice(idx, 1);
  row["Product Area"] = BUCKET_LABEL[newBucketKey];
  libraryCategoryCountCache.delete(sourceEntry.id);
  const targetEntry = getOrCreateMonthCategoryEntry(sourceEntry.groupId, newBucketKey);
  targetEntry.rows = [...(targetEntry.rows || []), row];
  targetEntry.rowCount = targetEntry.rows.length;
  targetEntry.rawText = toCSV(targetEntry.rows, EXPORT_LABELS);
  libraryCategoryCountCache.delete(targetEntry.id);
  let sourceDeleted = false;
  if (sourceEntry.rows.length === 0) {
    state.library = state.library.filter((e) => e.id !== sourceEntry.id);
    state.libraryExpandedEntryIds = state.libraryExpandedEntryIds.filter((id) => id !== sourceEntry.id);
    sourceDeleted = true;
  } else {
    sourceEntry.rowCount = sourceEntry.rows.length;
    sourceEntry.rawText = toCSV(sourceEntry.rows, EXPORT_LABELS);
  }
  render();
  libraryDBPut(targetEntry).catch(() => {
    state.libraryError = "Couldn't save the moved lead to local storage.";
    render();
  });
  if (sourceDeleted) {
    libraryDBDelete(sourceEntry.id).catch(() => {
      state.libraryError = "Couldn't remove the now-empty file from local storage after moving a lead out of it.";
      render();
    });
  } else {
    libraryDBPut(sourceEntry).catch(() => {
      state.libraryError = "Couldn't save the source file to local storage after moving a lead out of it.";
      render();
    });
  }
}
function toggleLibrarySelectRow(id) {
  const set = new Set(state.librarySelected);
  if (set.has(id)) set.delete(id); else set.add(id);
  setState({ librarySelected: [...set] });
}
function updateLibraryReceivedDate(id, value) {
  const entry = state.library.find((e) => e.id === id);
  if (!entry) return;
  entry.receivedAt = value || null;
  libraryDBPut(entry).catch(() => {
    state.libraryError = "Couldn't save that date change to local storage.";
    render();
  });
  // No full render needed — the date input already reflects the typed value.
}
function renameLibraryEntry(id, newName) {
  const entry = state.library.find((e) => e.id === id);
  if (!entry) return;
  const trimmed = (newName || "").trim();
  if (!trimmed || trimmed === entry.fileName) { render(); return; } // blank edit reverts to the existing name on blur
  entry.fileName = trimmed;
  render();
  libraryDBPut(entry).catch(() => {
    state.libraryError = "Couldn't save that name change to local storage.";
    render();
  });
}

/* ------------------------------------------------------------------ */
/* Library groups — purely organizational, e.g. "Fully contacted" vs     */
/* "Not yet contacted." Never affects scanning/detection or exports;     */
/* just how files are browsed/filtered within the Library tab.           */
/* ------------------------------------------------------------------ */
function createLibraryGroup(name, notes) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) return;
  const group = {
    id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmedName,
    notes: (notes || "").trim(),
    createdAt: new Date().toISOString(),
  };
  state.libraryGroups = [...state.libraryGroups, group];
  state.showNewGroupForm = false;
  render();
  libraryGroupsDBPut(group).catch(() => {
    state.libraryError = "Couldn't save that group to local storage.";
    render();
  });
}
function renameLibraryGroup(id, name, notes) {
  const group = state.libraryGroups.find((g) => g.id === id);
  if (!group) return;
  const trimmedName = (name || "").trim();
  if (trimmedName) group.name = trimmedName; // blank name edit is ignored, keeps the existing name
  if (notes != null) group.notes = notes.trim();
  render();
  libraryGroupsDBPut(group).catch(() => {
    state.libraryError = "Couldn't save that group change to local storage.";
    render();
  });
}
// Deleting a group only ungroups its files — it never deletes or touches
// the underlying saved files themselves.
function deleteLibraryGroup(id) {
  state.libraryGroups = state.libraryGroups.filter((g) => g.id !== id);
  const affected = state.library.filter((e) => e.groupId === id);
  affected.forEach((e) => { e.groupId = null; });
  if (state.libraryGroupFilter === id) state.libraryGroupFilter = "all";
  render();
  libraryGroupsDBDelete(id).catch(() => {
    state.libraryError = "Couldn't remove that group from local storage — it may reappear after a reload.";
    render();
  });
  affected.forEach((e) => {
    libraryDBPut(e).catch(() => {
      state.libraryError = "Couldn't save the ungrouping for one or more files to local storage.";
      render();
    });
  });
}
function assignLibraryEntryToGroup(id, groupId) {
  const entry = state.library.find((e) => e.id === id);
  if (!entry) return;
  entry.groupId = groupId || null;
  render();
  libraryDBPut(entry).catch(() => {
    state.libraryError = "Couldn't save that group assignment to local storage.";
    render();
  });
}
function assignSelectedLibraryToGroup(groupId) {
  const ids = new Set(state.librarySelected);
  const affected = state.library.filter((e) => ids.has(e.id));
  affected.forEach((e) => { e.groupId = groupId || null; });
  render();
  affected.forEach((e) => {
    libraryDBPut(e).catch(() => {
      state.libraryError = "Couldn't save the group assignment for one or more files to local storage.";
      render();
    });
  });
}
function deleteLibraryEntry(id) {
  state.library = state.library.filter((e) => e.id !== id);
  state.librarySelected = state.librarySelected.filter((sid) => sid !== id);
  state.libraryExpandedEntryIds = state.libraryExpandedEntryIds.filter((eid) => eid !== id);
  libraryCategoryCountCache.delete(id);
  render();
  libraryDBDelete(id).catch(() => {
    state.libraryError = "Couldn't remove that file from local storage — it may reappear after a reload.";
    render();
  });
}
function deleteSelectedLibrary() {
  const ids = new Set(state.librarySelected);
  state.library = state.library.filter((e) => !ids.has(e.id));
  state.librarySelected = [];
  state.libraryExpandedEntryIds = state.libraryExpandedEntryIds.filter((eid) => !ids.has(eid));
  ids.forEach((id) => libraryCategoryCountCache.delete(id));
  render();
  ids.forEach((id) => {
    libraryDBDelete(id).catch(() => {
      state.libraryError = "Couldn't remove one or more files from local storage — they may reappear after a reload.";
      render();
    });
  });
}
function downloadBlobAs(text, fileName, mime) {
  const blob = new Blob([text], { type: mime || "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function downloadLibraryEntry(id) {
  const entry = state.library.find((e) => e.id === id);
  if (!entry || entry.rawText == null) return;
  downloadBlobAs(entry.rawText, entry.fileName);
}
function downloadSelectedLibrary() {
  state.librarySelected.forEach((id) => downloadLibraryEntry(id));
}
// Re-parses a Library entry's saved raw text (not the File object — the
// original File handle is long gone) through the exact same CSV parser used
// on first upload, then feeds it through the shared applyParsedFiles so it's
// scanned/categorized identically to a fresh upload.
function parseLibraryEntry(entry) {
  const parsed = Papa.parse(entry.rawText, { header: true, skipEmptyLines: true });
  return { name: entry.fileName, fields: parsed.meta.fields || [], data: parsed.data };
}
// If the Library file being reloaded is already sitting in a month folder
// (e.g. "October 2025"), keep tagging it under that same month when it's
// re-scanned — consistent with how a fresh upload now files itself.
function monthKeyForLibraryEntry(entry) {
  const group = entry.groupId ? state.libraryGroups.find((g) => g.id === entry.groupId) : null;
  return group ? monthKeyFromGroupName(group.name) : null;
}
// Note: reloading from the Library does NOT pass a libraryEntryIds link.
// Under the "3 files per month" model a Library entry is a shared, ongoing
// export for a whole month/category — not one specific batch's own file —
// so there's nothing meaningful for this fresh re-scan to "already be
// linked to." It still inherits the month as a tag (so it reads as
// "October 2025 Leads" rather than unfiled), but clicking "File this
// batch" again would re-append these same rows — a known, accepted
// tradeoff consistent with the archive's existing no-dedup convention
// (see "Select entire archive"), not something this reload path guards
// against.
function loadLibraryEntryIntoScanner(id) {
  const entry = state.library.find((e) => e.id === id);
  if (!entry || entry.rawText == null) return;
  applyParsedFiles([parseLibraryEntry(entry)], [], monthKeyForLibraryEntry(entry));
}
function loadSelectedLibraryIntoScanner() {
  let entries = state.library.filter((e) => state.librarySelected.includes(e.id) && e.rawText != null);
  if (!entries.length) return;
  let notice = null;
  if (entries.length > MAX_FILES) {
    // Same cap the Scanner enforces on a direct upload — kept consistent
    // rather than letting a bulk Library load quietly bypass it.
    notice = `You selected ${entries.length} files — only the first ${MAX_FILES} were sent to the Scanner. Load the rest in a second batch.`;
    entries = entries.slice(0, MAX_FILES);
  }
  // Only auto-tag when every selected file agrees on the same month —
  // a mixed-month bulk load is genuinely ambiguous, so it's left unfiled
  // (same as before) rather than guessing.
  const monthKeys = entries.map(monthKeyForLibraryEntry);
  const sharedMonthKey = monthKeys.every((k) => k && k === monthKeys[0]) ? monthKeys[0] : undefined;
  applyParsedFiles(entries.map(parseLibraryEntry), [], sharedMonthKey);
  if (notice) setState({ error: notice });
}
// Category filtering for the Library — "filter in the library for leads in
// each category," per Jack's ask. Library only ever stored a file's raw
// text, never its detected categories (that's History's job, and not
// every Library file has a matching History entry — e.g. one re-uploaded
// after being edited elsewhere). So this runs the exact same
// column-guessing + detection pipeline applyParsedFiles uses, just against
// one Library entry's rawText, to get a per-category lead count. Cached by
// entry id since re-parsing + scanning full CSV text on every render, for
// every visible file, would get slow once the archive is at the "leads
// Wired CIO has ever received" scale Jack's building toward. A month's
// category file's rawText DOES change over time now (appended to as more
// batches get filed into that month) — appendSignalRowsToMonthCategory and
// removeBatchSignalRows both invalidate this entry's cache slot whenever
// they touch it, so a stale count is never shown after filing.
const libraryCategoryCountCache = new Map();
function getLibraryEntryCategoryCounts(entry) {
  if (entry.rawText == null) return null;
  if (libraryCategoryCountCache.has(entry.id)) return libraryCategoryCountCache.get(entry.id);
  const counts = { m365Tenant: 0, dynamics365: 0, dataPlatform: 0 };
  try {
    const pf = parseLibraryEntry(entry);
    const fileMapping = {};
    FIELD_DEFS.forEach((f) => { fileMapping[f.key] = guessColumn(pf.fields, f.candidates) || ""; });
    pf.data.forEach((row) => {
      const resolved = {};
      FIELD_DEFS.forEach((f) => { resolved[f.key] = fileMapping[f.key] ? row[fileMapping[f.key]] ?? "" : ""; });
      const scan = scanRowUnified(row, pf.fields, resolved);
      if (scan && counts.hasOwnProperty(scan.category)) counts[scan.category]++;
    });
  } catch (e) {
    // A malformed/unparseable file just contributes zero counts rather than
    // breaking the whole Library view.
  }
  libraryCategoryCountCache.set(entry.id, counts);
  return counts;
}
function getLibraryCategoryCounts(list) {
  const counts = { all: list.length, m365Tenant: 0, dynamics365: 0, dataPlatform: 0 };
  list.forEach((e) => {
    const c = getLibraryEntryCategoryCounts(e);
    if (!c) return;
    Object.keys(counts).forEach((k) => { if (k !== "all" && c[k] > 0) counts[k]++; });
  });
  return counts;
}
function getLibraryGroupCounts() {
  const counts = { all: state.library.length, ungrouped: 0 };
  state.libraryGroups.forEach((g) => { counts[g.id] = 0; });
  state.library.forEach((e) => {
    // A groupId pointing at a group that no longer exists shouldn't happen
    // (deleteLibraryGroup ungroups its files first) but is treated as
    // ungrouped defensively rather than silently miscounted.
    if (e.groupId && counts.hasOwnProperty(e.groupId)) counts[e.groupId]++;
    else counts.ungrouped++;
  });
  return counts;
}
function getFilteredLibrary() {
  let list = state.library;
  if (state.libraryGroupFilter === "ungrouped") list = list.filter((e) => !e.groupId);
  else if (state.libraryGroupFilter !== "all") list = list.filter((e) => e.groupId === state.libraryGroupFilter);
  if (state.libraryCategoryFilter !== "all") {
    list = list.filter((e) => {
      const counts = getLibraryEntryCategoryCounts(e);
      return counts && counts[state.libraryCategoryFilter] > 0;
    });
  }
  if (state.librarySearch.trim()) {
    const q = state.librarySearch.toLowerCase();
    list = list.filter((e) => {
      const group = e.groupId ? state.libraryGroups.find((g) => g.id === e.groupId) : null;
      return e.fileName.toLowerCase().includes(q) || (group && group.name.toLowerCase().includes(q));
    });
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* History — grouped by week, mirrors the original Licensing Scrubber.  */
/* ------------------------------------------------------------------ */
function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + diff);
  return date;
}
function weekKeyOf(d) { return startOfWeek(d).toISOString().slice(0, 10); }
function weekLabelOf(key) {
  const start = new Date(`${key}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${fmt(start)} – ${fmt(end)}${sameYear ? `, ${end.getFullYear()}` : ""}`;
}
function getWeeks() {
  const map = new Map();
  state.history.forEach((h) => {
    const k = weekKeyOf(new Date(h.importedAt));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(h);
  });
  const keys = [...map.keys()].sort((a, b) => b.localeCompare(a));
  return keys.map((k) => ({ key: k, label: weekLabelOf(k), entries: map.get(k).sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt)) }));
}
function loadHistoryEntry(id) {
  const entry = state.history.find((h) => h.id === id);
  if (!entry) return;
  setState({ view: "scanner", viewingHistoryId: entry.id, combinedHistoryIds: [], results: entry.results, rawRows: new Array(entry.rowsScanned), categoryFilter: "all", tierFilter: "signal", duplicatesOnly: false, search: "", error: null, page: 1, selected: [] });
}
function deleteHistoryEntry(id) {
  setState({
    history: state.history.filter((h) => h.id !== id),
    viewingHistoryId: state.viewingHistoryId === id ? null : state.viewingHistoryId,
    historySelected: state.historySelected.filter((sid) => sid !== id),
  });
  historyDBDelete(id).catch(() => {
    state.historyError = "Couldn't remove that import from local storage — it may reappear after a reload.";
    render();
  });
}
function saveHistoryFile() {
  const payload = { exportedAt: new Date().toISOString(), history: state.history };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `unified-lead-scanner-history-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function loadHistoryFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      const incoming = Array.isArray(payload) ? payload : payload.history;
      if (!Array.isArray(incoming)) throw new Error("File doesn't contain a recognizable history list.");
      const map = new Map(state.history.map((h) => [h.id, h]));
      const validIncoming = incoming.filter((h) => h && h.id);
      validIncoming.forEach((h) => { map.set(h.id, h); });
      const merged = [...map.values()].sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
      setState({ history: merged, error: null });
      // A manually-loaded history file is a backup/transfer path, not the
      // primary save mechanism anymore — but whatever it brings in should
      // still end up in local storage so it survives the next reload too,
      // same as anything scanned directly.
      validIncoming.forEach((h) => {
        historyDBPut(h).catch(() => {
          state.historyError = "Couldn't save the loaded history file to local storage — it'll work this session, but may not survive a reload.";
          render();
        });
      });
    } catch (err) {
      setState({ error: `Could not load history file: ${err.message}` });
    }
  };
  reader.readAsText(file);
}
// Import-level tag + notes — e.g. tag a batch "March cold list" or leave a
// note on why it performed the way it did. Purely descriptive metadata on
// the History entry itself (not on individual leads), editable inline on
// the card and persisted the same way every other History edit is.
function updateHistoryTag(id, value) {
  const entry = state.history.find((h) => h.id === id);
  if (!entry) return;
  entry.tag = (value || "").trim();
  render();
  historyDBPut(entry).catch(() => {
    state.historyError = "Couldn't save that tag to local storage.";
    render();
  });
}
function updateHistoryNotes(id, value) {
  const entry = state.history.find((h) => h.id === id);
  if (!entry) return;
  entry.notes = value || "";
  render();
  historyDBPut(entry).catch(() => {
    state.historyError = "Couldn't save that note to local storage.";
    render();
  });
}
// "Move to a folder titled by the month the leads came in" — a one-click
// shortcut, right from the Final Downloads section, that tags the CURRENT
// scan batch's History entry with a month label (e.g. "January 2026
// Leads"), reusing the exact same tag field already on the History card
// (updateHistoryTag) rather than a second, parallel storage system. The
// point, per Jack: when the pipeline is light, come back to an old month,
// see what's still sitting un-actioned (cross-out marks what's been
// worked), and pick it back up — same download buttons, same "View / edit"
// reload, just found by name instead of hunting through History by date.
// Only meaningful for a single, identifiable batch — a combined view
// spans multiple original imports, so there's no one entry to file.
function getCurrentBatchHistoryEntry() {
  if (state.combinedHistoryIds.length > 0) return null;
  return state.history.find((h) => h.results === state.results) || null;
}
// Filing a batch does two things, not just one: it tags the History entry
// (so it shows up by name in History/search — unchanged from before), AND
// it merges this batch's Strong Signal leads into that month's (up to 3)
// category files in the Library — creating them on first use, appending if
// they already exist. If this exact batch was already filed somewhere
// (auto-filed at upload, or filed once before), its rows are pulled back
// out of the OLD month's files first (removeBatchSignalRows) so re-filing
// moves them rather than duplicating them across two months. Covers both
// a genuine correction (wrong month picked originally) and a one-off scan
// that Jack decides, after reviewing it, he actually wants archived.
function fileCurrentBatchToMonthFolder(monthKey) {
  const entry = getCurrentBatchHistoryEntry();
  if (!entry) return;
  const label = monthKey ? monthLabelFromKey(monthKey) : getMonthLabel(entry.importedAt);
  const groupId = getOrCreateGroupByName(label);
  removeBatchSignalRows(entry.id, entry.libraryEntryIds);
  const signalRows = entry.results.filter((r) => r.tier === "signal");
  const touchedEntries = fileSignalRowsIntoGroup(groupId, signalRows, entry.id);
  entry.libraryEntryIds = touchedEntries.map((e) => e.id);
  updateHistoryTag(entry.id, `${label} Leads`);
}

/* ------------------------------------------------------------------ */
/* Full backup/restore — Phase 1 of improving the data architecture.    */
/* Everything the tool stores (Library files + raw content, Library      */
/* groups, and History) still lives in one browser's IndexedDB — no      */
/* backend, so it's gone if browser data is cleared, a different browser */
/* or machine is used, or a teammate needs to see the same data. This is */
/* a deliberately small, low-risk first step: a single portable file      */
/* Jack controls (save it to Drive, email it, whatever), not a new         */
/* storage layer. Restore is a MERGE (upsert by id), same pattern as       */
/* loadHistoryFile above — restoring an old/partial backup can only add    */
/* or update entries, never silently wipe out newer local data, and in    */
/* the primary "browser data got cleared" case a merge into an empty       */
/* state produces the exact same result a full replace would anyway.       */
/* ------------------------------------------------------------------ */
function backupEverything() {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    library: state.library,
    libraryGroups: state.libraryGroups,
    history: state.history,
  };
  downloadBlobAs(JSON.stringify(payload, null, 2), `wired-cio-lead-scanner-full-backup-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8;");
  setState({ backupNotice: `Backup downloaded — ${state.library.length} Library file${state.library.length === 1 ? "" : "s"}, ${state.libraryGroups.length} group${state.libraryGroups.length === 1 ? "" : "s"}, ${state.history.length} History import${state.history.length === 1 ? "" : "s"}.` });
}
function restoreBackupFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!payload || typeof payload !== "object") throw new Error("File doesn't contain a recognizable backup.");
      const incomingLibrary = Array.isArray(payload.library) ? payload.library.filter((e) => e && e.id) : [];
      const incomingGroups = Array.isArray(payload.libraryGroups) ? payload.libraryGroups.filter((g) => g && g.id) : [];
      const incomingHistory = Array.isArray(payload.history) ? payload.history.filter((h) => h && h.id) : [];
      if (!incomingLibrary.length && !incomingGroups.length && !incomingHistory.length) {
        throw new Error("File doesn't contain any Library files, groups, or History to restore.");
      }
      const libraryMap = new Map(state.library.map((e) => [e.id, e]));
      incomingLibrary.forEach((e) => { libraryMap.set(e.id, e); });
      const mergedLibrary = [...libraryMap.values()].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

      const groupsMap = new Map(state.libraryGroups.map((g) => [g.id, g]));
      incomingGroups.forEach((g) => { groupsMap.set(g.id, g); });
      const mergedGroups = [...groupsMap.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const historyMap = new Map(state.history.map((h) => [h.id, h]));
      incomingHistory.forEach((h) => { historyMap.set(h.id, h); });
      const mergedHistory = [...historyMap.values()].sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));

      setState({
        library: mergedLibrary,
        libraryGroups: mergedGroups,
        history: mergedHistory,
        error: null,
        backupNotice: `Restored ${incomingLibrary.length} Library file${incomingLibrary.length === 1 ? "" : "s"}, ${incomingGroups.length} group${incomingGroups.length === 1 ? "" : "s"}, ${incomingHistory.length} History import${incomingHistory.length === 1 ? "" : "s"} from the backup file.`,
      });

      // Write every restored entry through to IndexedDB too, same as a
      // fresh scan/upload would — otherwise a restore would only "stick"
      // until the next reload, defeating the point of restoring at all.
      incomingLibrary.forEach((e) => {
        libraryDBPut(e).catch(() => {
          state.libraryError = "Couldn't save one or more restored files to local storage — they'll work this session, but may not survive a reload.";
          render();
        });
      });
      incomingGroups.forEach((g) => {
        libraryGroupsDBPut(g).catch(() => {
          state.libraryError = "Couldn't save one or more restored groups to local storage — they'll work this session, but may not survive a reload.";
          render();
        });
      });
      incomingHistory.forEach((h) => {
        historyDBPut(h).catch(() => {
          state.historyError = "Couldn't save one or more restored imports to local storage — they'll work this session, but may not survive a reload.";
          render();
        });
      });
    } catch (err) {
      setState({ error: `Could not restore backup file: ${err.message}` });
    }
  };
  reader.readAsText(file);
}

/* ------------------------------------------------------------------ */
/* PART 6 — Filtering, counts, manual reassignment, and the exactly-3   */
/* CSV exports.                                                         */
/* ------------------------------------------------------------------ */
function getFiltered() {
  let list = state.results;
  if (state.tierFilter !== "all") list = list.filter((r) => r.tier === state.tierFilter);
  if (state.categoryFilter !== "all") list = list.filter((r) => r.category === state.categoryFilter);
  if (state.duplicatesOnly) list = list.filter((r) => r.isDuplicate);
  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    list = list.filter((r) => {
      const f = r.row.__f || {};
      const company = String(f.company || "");
      const contact = getFullName(f);
      return company.toLowerCase().includes(q) || contact.toLowerCase().includes(q) || r.categories.join(" ").toLowerCase().includes(q) || (r.notesSummary || "").toLowerCase().includes(q);
    });
  }
  return list;
}
// Scoped to whichever tier tab is currently active — this is what lets you
// see Strong Signal broken down by product line, or switch to Needs Review
// and see THAT broken down by product line, so you can work a review queue
// one product line at a time and promote the ones that meet your bar.
function getCategoryCounts() {
  const base = state.tierFilter === "all" ? state.results : state.results.filter((r) => r.tier === state.tierFilter);
  const counts = { all: base.length };
  Object.keys(CATEGORY_META).forEach((k) => { counts[k] = 0; });
  base.forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
  return counts;
}
function getTierCounts() {
  let signal = 0, mention = 0, dq = 0;
  state.results.forEach((r) => { if (r.tier === "signal") signal++; else if (r.tier === "dq") dq++; else mention++; });
  return { signal, mention, dq, total: state.results.length };
}
// Total duplicate-flagged rows in the current batch, independent of whatever
// tier/category tab is active — the "Duplicates" pill needs the real total
// so it doesn't look like it's under- or over-counting depending on filters.
function getDuplicateCount() {
  return state.results.filter((r) => r.isDuplicate).length;
}
// DQ reasons breakdown for the current view, scoped to whichever rows are
// currently in the Bad Leads tier — a row can carry more than one reason
// (e.g. missing company name AND a rejection phrase), so counts can sum to
// more than the number of Bad Lead rows. This is the "know the metrics" view.
function getDQReasonCounts() {
  const counts = {};
  state.results.forEach((r) => {
    if (r.tier !== "dq") return;
    (r.dqReasons || []).forEach((reason) => { counts[reason] = (counts[reason] || 0) + 1; });
  });
  return counts;
}
// If the results currently on screen belong to a saved import (state.results
// IS that entry's own results array/objects, by reference — see
// loadHistoryEntry), any in-place edit below already lands inside
// state.history automatically. This just makes sure that edit also reaches
// IndexedDB, not only in-memory state, so it survives a reload too.
function persistViewedHistoryEntryIfNeeded() {
  if (!state.viewingHistoryId) return;
  const entry = state.history.find((h) => h.id === state.viewingHistoryId);
  if (!entry) return;
  historyDBPut(entry).catch(() => {
    state.historyError = "Couldn't save that edit to the saved import in local storage — it'll hold for this session, but may not survive a reload.";
    render();
  });
}
function reassignRow(id, newCategory) {
  const row = state.results.find((r) => r.id === id);
  if (!row) return;
  row.category = newCategory;
  render();
  persistViewedHistoryEntryIfNeeded();
  syncCombinedRowEditBack(row);
}
// Manual tier promotion/demotion — a "Needs review" lead only ever reaches
// one of the three final downloads (which pull Strong Signal only) once a
// human bumps it here. Mirrors the original Licensing Scrubber's
// approve/unapprove flow and the Platform Lead Finder's move-to-tier action,
// folded into one toggle since this tool only has two tiers.
const TIER_CYCLE = ["signal", "mention", "dq"];
function toggleTier(id) {
  const row = state.results.find((r) => r.id === id);
  if (!row) return;
  const idx = TIER_CYCLE.indexOf(row.tier);
  row.tier = TIER_CYCLE[(idx + 1) % TIER_CYCLE.length];
  render();
  persistViewedHistoryEntryIfNeeded();
  syncCombinedRowEditBack(row);
}
function setTierForSelected(tier) {
  if (!state.selected.length) return;
  const idSet = new Set(state.selected);
  state.results.forEach((r) => { if (idSet.has(r.id)) { r.tier = tier; syncCombinedRowEditBack(r); } });
  setState({ selected: [] });
  persistViewedHistoryEntryIfNeeded();
}
// "Cross out" — a purely visual, manual marker (line-through on the row's
// name/contact cells) for "I've handled this one, but keep it right where
// it is." Deliberately does NOT touch tier, category, filtering, counts, or
// exports — Jack asked to keep a crossed-out lead on its list/group exactly
// as before, just visibly struck through, not moved or hidden.
function toggleCrossedOut(id) {
  const row = state.results.find((r) => r.id === id);
  if (!row) return;
  row.crossedOut = !row.crossedOut;
  render();
  persistViewedHistoryEntryIfNeeded();
  syncCombinedRowEditBack(row);
}
function setCrossedOutForSelected(value) {
  if (!state.selected.length) return;
  const idSet = new Set(state.selected);
  state.results.forEach((r) => { if (idSet.has(r.id)) { r.crossedOut = value; syncCombinedRowEditBack(r); } });
  setState({ selected: [] });
  persistViewedHistoryEntryIfNeeded();
}
function toggleSelectRow(id) {
  const selected = state.selected.includes(id) ? state.selected.filter((x) => x !== id) : [...state.selected, id];
  setState({ selected });
}
function moveSelectedTo(newCategory) {
  if (!state.selected.length) return;
  const idSet = new Set(state.selected);
  state.results.forEach((r) => { if (idSet.has(r.id)) { r.category = newCategory; syncCombinedRowEditBack(r); } });
  setState({ selected: [] });
  persistViewedHistoryEntryIfNeeded();
}
// Exactly three CSV downloads, every time — every row's CURRENT category
// (auto-detected or manually reassigned) determines which single bucket it
// goes out in, so the three files together never repeat a lead and always
// add up to the full Strong Signal set.
function bucketRowsFor(results, bucketKey) {
  return results.filter((r) => r.tier === "signal" && CATEGORY_META[r.category].bucket === bucketKey).map(buildExportRow);
}
function exportBucket(bucketKey) {
  downloadCSV(`wired-cio-${BUCKET_META[bucketKey].slug}-leads.csv`, bucketRowsFor(state.results, bucketKey), EXPORT_LABELS);
}
// Redownload straight from a past import — same 3 buckets, same Strong
// Signal scope, pulled from that entry's own saved results rather than the
// live scanner. Reflects any reassignments/promotions made while that entry
// was open in the Scanner (same object reference), same as "View" does.
function exportHistoryBucket(entryId, bucketKey) {
  const entry = state.history.find((h) => h.id === entryId);
  if (!entry) return;
  const rows = bucketRowsFor(entry.results, bucketKey);
  const dateSlug = entry.importedAt ? entry.importedAt.slice(0, 10) : "import";
  downloadCSV(`wired-cio-${BUCKET_META[bucketKey].slug}-leads-${dateSlug}.csv`, rows, EXPORT_LABELS);
}
// `files` is the modern shape; falls back to splitting the older `fileName`
// string for history entries saved before `files` existed.
function entryFileList(entry) {
  if (entry.files && entry.files.length) return entry.files;
  if (entry.fileName) return entry.fileName.split(", ").filter(Boolean).map((name) => ({ name, rows: null }));
  return [];
}
// Search across ALL of History, not just the currently-selected week — the
// point is finding one batch out of potentially ~100, regardless of when it
// ran. Matches file names first (cheap), then falls back to checking each
// entry's own scanned rows for a company/contact match.
function getFilteredHistory() {
  let list = state.history;
  if (state.historySearch.trim()) {
    const q = state.historySearch.toLowerCase();
    list = list.filter((h) => {
      if ((h.tag || "").toLowerCase().includes(q)) return true;
      if (entryFileList(h).some((f) => f.name.toLowerCase().includes(q))) return true;
      return h.results.some((r) => {
        const f = r.row.__f || {};
        const company = String(f.company || "").toLowerCase();
        const contact = getFullName(f).toLowerCase();
        return company.includes(q) || contact.includes(q);
      });
    });
  }
  return [...list].sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt));
}
function toggleHistorySelectRow(id) {
  const historySelected = state.historySelected.includes(id) ? state.historySelected.filter((x) => x !== id) : [...state.historySelected, id];
  setState({ historySelected });
}
// Whatever's actually on screen right now — the search results if a search
// is active, otherwise the active week's entries. Shared by render() (to
// decide what to list) and the "Select all" button (to decide what "all"
// means), so the two can never disagree about what's currently shown.
function getCurrentHistoryViewList() {
  if (state.historySearch.trim()) return getFilteredHistory();
  const weeks = getWeeks();
  const selectedKey = state.selectedWeek && weeks.some((w) => w.key === state.selectedWeek) ? state.selectedWeek : (weeks[0] ? weeks[0].key : null);
  const activeWeek = weeks.find((w) => w.key === selectedKey);
  return activeWeek ? activeWeek.entries : [];
}
function toggleSelectAllVisibleHistory() {
  const ids = getCurrentHistoryViewList().map((h) => h.id);
  const allSelected = ids.length > 0 && ids.every((id) => state.historySelected.includes(id));
  setState({ historySelected: allSelected ? [] : ids });
}
// "Select all" only grabs what's currently visible — the active week tab
// (or the active search match). That's fine for tidying up one batch, but
// Jack's ask ("download a certain product line or search a lead on demand"
// across the WHOLE archive, not one week) needs a way to combine
// literally everything at once, regardless of week/search filter. This is
// step 1 toward that: combining every entry reuses the Scanner's existing
// search bar and Final Downloads exports unchanged — no new search/export
// system, just a way to get everything into the one that already works.
function selectEntireHistoryArchive() {
  setState({ historySelected: state.history.map((h) => h.id) });
}
// Rows scanned across every currently-checked History entry — just for the
// bulk bar's "you're about to combine N rows from M imports" preview.
function getHistorySelectedTotals() {
  const idSet = new Set(state.historySelected);
  let entryCount = 0;
  let rowCount = 0;
  state.history.forEach((h) => {
    if (!idSet.has(h.id)) return;
    entryCount++;
    rowCount += h.results.length;
  });
  return { entryCount, rowCount };
}
// "Condense into a strong lead list, then run deep filtering to place them
// accordingly" — the whole point of combining. Rather than a flat CSV dump,
// this pulls every checked import's rows into the Scanner as ONE working
// set, so the full existing toolkit (category tabs, tier cycling, search,
// per-row and bulk reassignment, and the exactly-3-bucket export) works
// across all of them together instead of one batch of ~5 files at a time.
// Rows are shallow copies, not the original shared objects — each carries
// __sourceEntryId/__sourceRowId so an edit made here can be written back to
// the correct original import (see syncCombinedRowEditBack) without risking
// an id collision between two different imports that happened to reuse the
// same per-file row id (e.g. two imports both having a row "0-0").
function combineSelectedHistoryIntoScanner() {
  if (!state.historySelected.length) return;
  const idSet = new Set(state.historySelected);
  const entries = state.history.filter((h) => idSet.has(h.id));
  if (!entries.length) return;
  const combinedResults = [];
  let combinedRawCount = 0;
  entries.forEach((h) => {
    h.results.forEach((r) => { combinedResults.push({ ...r, id: `${h.id}::${r.id}`, __sourceEntryId: h.id, __sourceRowId: r.id }); });
    combinedRawCount += h.rowsScanned;
  });
  setState({
    view: "scanner",
    results: combinedResults,
    rawRows: new Array(combinedRawCount),
    categoryFilter: "all",
    tierFilter: "all", // deep filtering across everything combined is the point — don't hide Needs review/Bad leads by default here
    duplicatesOnly: false,
    search: "",
    error: null,
    page: 1,
    selected: [],
    viewingHistoryId: null,
    combinedHistoryIds: [...idSet],
    historySelected: [],
  });
}
// Writes a category/tier edit made on a combined-view row back to the row it
// was copied from inside state.history, and persists that one entry. No-op
// for ordinary Scanner rows (they never carry __sourceEntryId).
function syncCombinedRowEditBack(row) {
  if (!row || !row.__sourceEntryId) return;
  const entry = state.history.find((h) => h.id === row.__sourceEntryId);
  if (!entry) return;
  const sourceRow = entry.results.find((r) => r.id === row.__sourceRowId);
  if (!sourceRow) return;
  sourceRow.category = row.category;
  sourceRow.tier = row.tier;
  sourceRow.crossedOut = row.crossedOut;
  historyDBPut(entry).catch(() => {
    state.historyError = "Couldn't save that edit back to the original import in local storage.";
    render();
  });
}

/* END-OF-LOGIC — render()/event-delegation deliberately NOT ported here.
   Per the app/ rebuild direction (CLAUDE.md), the UI layer for this tool
   is being rebuilt directly as React components in app/src, using this
   file's logic + the Playwright test expectations as the spec — not by
   porting the vanilla-JS render()/innerHTML/event-delegation pattern
   line-by-line. If a standalone legacy HTML build is ever needed again,
   the render()/DOMContentLoaded block from the original source will need
   to be added back here; until then this file is a logic-only reference
   module (licensing/platform detection, Library/History/backup CRUD,
   filtering/export helpers), not a runnable standalone app on its own. */

