#!/usr/bin/env node
// Company Overview Agent — the research half of the "Export missing info"
// loop in Engage → Companies (see CLAUDE.md, "Company overview agent").
//
// WHY THIS RUNS HERE AND NOT INSIDE THE APP: the published page can only
// reach the viewer's claude.ai connectors (Apollo), never an arbitrary
// company website — the Artifact sandbox blocks all other outbound
// requests. So the loop is: Companies → "⬇ Export missing info" (a CSV of
// every company with no Apollo data) → run THIS script on it → "⬆ Import
// Apollo export" the result (the importer is header-driven, so this
// output maps straight in; a merge only ever fills blanks, so anything
// Apollo already supplied is never overwritten).
//
// WHAT IT DOES, per company with a website:
//   - fetches the homepage (and an /about-style page when the homepage
//     links one), via curl so the OS proxy/CA settings apply;
//   - reads <title>, <meta name="description">, og:description, and any
//     JSON-LD Organization block (description, numberOfEmployees);
//   - looks for an explicit employee-count phrase ("250+ employees",
//     "team of 40", "1,200 staff");
//   - guesses an Industry from a fixed keyword table — printed with the
//     word "(guess)" in the Source column so it's never mistaken for a
//     stated fact.
// Anything it can't find stays BLANK. Nothing is fabricated.
//
// WHAT IT DOES NOT DO: read LinkedIn. LinkedIn company pages sit behind a
// login wall and its terms forbid scraping; this script never requests
// linkedin.com. Employee counts come only from the company's own site or
// from Apollo.
//
// Usage:
//   npm run company-overview -- companies-missing-info.csv [out.csv]
//   (default output: companies-overview.csv next to the input)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const [, , inputArg, outputArg] = process.argv;
if (!inputArg) {
  console.error("Usage: npm run company-overview -- <companies-missing-info.csv> [output.csv]");
  process.exit(1);
}
const inputPath = path.resolve(inputArg);
const outputPath = path.resolve(outputArg || path.join(path.dirname(inputPath), "companies-overview.csv"));

// --- minimal RFC-4180 CSV in/out (no dependency so this runs anywhere Node does) ---
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(rows, cols) {
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

// --- fetching ---
const UA = "Mozilla/5.0 (compatible; WiredSalesOutbound-CompanyOverview/1.0)";
function fetchHtml(url) {
  try {
    const out = execFileSync(
      "curl",
      ["-sL", "--max-time", "20", "--max-filesize", "2000000", "-A", UA, "-H", "Accept: text/html", url],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
    );
    return out && /<\s*(html|head|body|title|meta)\b/i.test(out) ? out : null;
  } catch {
    return null;
  }
}
function normalizeUrl(website) {
  let w = (website || "").trim();
  if (!w) return "";
  if (!/^https?:\/\//i.test(w)) w = `https://${w}`;
  return w.replace(/\/+$/, "");
}

// --- extraction ---
const decode = (s) =>
  s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ").trim();
function metaContent(html, matcher) {
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const name = (tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    if (matcher.test(name)) {
      const content = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
      if (content && content.trim()) return decode(content);
    }
  }
  return "";
}
function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1]) : "";
}
function jsonLdOrgs(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed];
      nodes.forEach((n) => {
        const t = String(n && n["@type"] || "");
        if (/Organization|Corporation|LocalBusiness|Company/i.test(t)) out.push(n);
      });
    } catch { /* malformed JSON-LD is common; skip it */ }
  }
  return out;
}
function visibleText(html) {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}
// Explicit headcount phrasing only. Never reads a bare number as a count.
function employeeCount(text) {
  const pats = [
    /\b(\d{1,3}(?:,\d{3})+|\d{1,6})\s*\+?\s*(?:employees|team members|staff members|staff|people|professionals|associates)\b/i,
    /\b(?:team|staff|workforce)\s+of\s+(?:over|more than|nearly|about|approximately)?\s*(\d{1,3}(?:,\d{3})+|\d{1,6})\b/i,
    /\b(?:over|more than|nearly|approximately)\s+(\d{1,3}(?:,\d{3})+|\d{1,6})\s+(?:employees|team members|staff|people)\b/i,
  ];
  for (const p of pats) {
    const m = text.match(p);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (n >= 2 && n <= 2000000) return String(n);
    }
  }
  return "";
}
function aboutLink(html, base) {
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const label = decode(m[2]);
    if (/about|who-we-are|our-story|company/i.test(href) || /^about( us)?$|who we are|our story|our company/i.test(label)) {
      try { return new URL(href, base).toString(); } catch { /* skip bad href */ }
    }
  }
  return "";
}

// A deliberately small, legible table. A hit here is a GUESS (labeled as
// such in Source) — it's meant to get the row to a first read, not to
// stand in for a stated industry.
const INDUSTRY_TABLE = [
  ["Healthcare", /\b(hospital|clinic|health ?care|medical|physician|dental|hospice|palliative|pharma|patients?)\b/i],
  ["Manufacturing", /\b(manufactur\w*|fabricat\w*|machin\w*|industrial|factory|oem|cnc|foundry)\b/i],
  ["Construction & Engineering", /\b(construction|contractor|general contractor|civil engineering|hvac|plumbing|electrical contractor|roofing)\b/i],
  ["Logistics & Transportation", /\b(logistics|freight|trucking|shipping|supply chain|warehous\w*|3pl|fleet)\b/i],
  ["Financial Services", /\b(bank|banking|credit union|lending|mortgage|wealth management|investment|insurance|accounting|cpa)\b/i],
  ["Legal", /\b(law firm|attorneys?|legal services|litigation|counsel)\b/i],
  ["Non-profit", /\b(non-?profit|501\(c\)|foundation|charity|ministry|church|association)\b/i],
  ["Education", /\b(school|university|college|academy|k-12|students?|education)\b/i],
  ["Government", /\b(county|city of|municipal|government|public sector|department of)\b/i],
  ["Software & Technology", /\b(software|saas|platform|app development|it services|technology company|cloud|cybersecurity)\b/i],
  ["Real Estate & Property", /\b(real estate|property management|realt\w*|commercial properties|apartments)\b/i],
  ["Hospitality & Food", /\b(restaurant|hotel|hospitality|catering|resort|brewery|food service)\b/i],
  ["Retail & E-commerce", /\b(retail\w*|e-?commerce|store|shop online|wholesale)\b/i],
  ["Energy & Utilities", /\b(energy|utility|utilities|solar|oil and gas|electric cooperative)\b/i],
  ["Professional Services", /\b(consulting|consultants?|advisory|staffing|marketing agency|agency)\b/i],
];
function guessIndustry(text) {
  const head = text.slice(0, 6000);
  let best = null;
  for (const [label, re] of INDUSTRY_TABLE) {
    const hits = (head.match(new RegExp(re.source, "gi")) || []).length;
    if (hits && (!best || hits > best.hits)) best = { label, hits };
  }
  return best ? best.label : "";
}
function trimDesc(s) {
  const t = (s || "").trim();
  if (t.length <= 400) return t;
  const cut = t.slice(0, 400);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(". "), 250) + 1).trim()}…`;
}

// --- main ---
const rows = parseCSV(fs.readFileSync(inputPath, "utf8"));
const companyCol = Object.keys(rows[0] || {}).find((k) => /^company$/i.test(k)) || "Company";
const websiteCol = Object.keys(rows[0] || {}).find((k) => /^website$/i.test(k)) || "Website";
const OUT_COLS = ["Company", "Website", "Industry", "# Employees", "Short Description", "Source"];
const out = [];
let researched = 0;
let unreachable = 0;
let noWebsite = 0;

for (const r of rows) {
  const company = r[companyCol] || "";
  if (!company) continue;
  const website = normalizeUrl(r[websiteCol]);
  const row = {
    Company: company,
    Website: website,
    Industry: r["Industry"] || "",
    "# Employees": r["# Employees"] || "",
    "Short Description": r["Short Description"] || "",
    Source: "",
  };
  if (!website) {
    row.Source = "no website on file — add one in the app (Contact detail → Company website) and re-export";
    noWebsite++;
    out.push(row);
    continue;
  }
  process.stderr.write(`→ ${company} (${website}) … `);
  const home = fetchHtml(website);
  if (!home) {
    row.Source = "website unreachable (blocked, offline, or not HTML)";
    unreachable++;
    process.stderr.write("unreachable\n");
    out.push(row);
    continue;
  }
  const about = aboutLink(home, website);
  const aboutHtml = about && about !== website ? fetchHtml(about) : null;
  const pages = [home, aboutHtml].filter(Boolean);
  const text = pages.map(visibleText).join(" ");
  const orgs = pages.flatMap(jsonLdOrgs);
  const sources = [];

  if (!row["Short Description"]) {
    const ld = orgs.map((o) => (typeof o.description === "string" ? o.description : "")).find(Boolean);
    const desc = ld || metaContent(home, /^(description|og:description|twitter:description)$/i) || (aboutHtml ? metaContent(aboutHtml, /^(description|og:description)$/i) : "");
    if (desc) {
      row["Short Description"] = trimDesc(desc);
      sources.push(ld ? "description: site JSON-LD" : "description: site meta tag");
    } else {
      // Title-only fallback, and only when the title actually says
      // something beyond the company's own name ("Acme | Precision CNC
      // Machining" yes, "Vertex Health" no).
      const t = titleOf(home);
      const beyondName = t.replace(new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "").replace(/[|\-–—:]/g, " ").trim();
      if (t && beyondName.length > 12) { row["Short Description"] = trimDesc(t); sources.push("description: page title only"); }
    }
  }
  if (!row["# Employees"]) {
    const ld = orgs.map((o) => o.numberOfEmployees).find(Boolean);
    const ldVal = ld && typeof ld === "object" ? ld.value || ld.minValue : ld;
    const n = ldVal ? String(ldVal) : employeeCount(text);
    if (n) { row["# Employees"] = n; sources.push(ldVal ? "employees: site JSON-LD" : "employees: stated on site"); }
  }
  if (!row.Industry) {
    const g = guessIndustry(`${row["Short Description"]} ${text}`);
    if (g) { row.Industry = g; sources.push("industry: keyword guess from site text (guess)"); }
  }
  row.Source = sources.length ? sources.join("; ") : "site reached, nothing usable found";
  researched++;
  process.stderr.write(`${sources.length ? sources.length + " field(s)" : "nothing found"}\n`);
  out.push(row);
}

fs.writeFileSync(outputPath, toCSV(out, OUT_COLS));
console.error(`\n${out.length} companies · ${researched} researched · ${unreachable} unreachable · ${noWebsite} without a website`);
console.error(`Wrote ${outputPath} — import it via Engage → Companies → "⬆ Import Apollo export".`);
console.error(`LinkedIn was not consulted (login wall / terms); employee counts come only from the company's own site or Apollo.`);
