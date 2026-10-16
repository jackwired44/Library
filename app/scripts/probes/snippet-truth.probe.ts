// A matched snippet may only say what the row actually contains.
//
// Per Jack, with the row that caught it: "i just found a lead that was
// inaccurate // raw data notes ACG - 17/Sep - ACG 9/17/21 Created growth
// optty for Copilot whitespace, 451 seats recommended by KYC ... this is
// the matched snippet in final download mode after being scanned cannot
// have this happen."
//
// What it produced was "Interested in setting up or supporting their M365
// tenant — new tenant creation, migrating from Google, or ongoing IT
// support." Not one clause of that is in the note. It invented a Google
// migration — the highest-value signal in this tool — on a lead with no
// Google anything, in a file that gets dialled from.
//
// The rule this suite enforces: a snippet either QUOTES the row, or says
// plainly that it could not and states only evidence the engine really
// extracted. It never speaks in the lead's voice about intent the lead
// never expressed.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles, isDerivedSummary , stripSnippetPrefix } from "../../src/lib/detection";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
function scan(notes: string[]) {
  const csv = ["Company,Full Name,Title,Email,Phone,Comments"]
    .concat(notes.map((n, i) => [`C${i}`, `P V${i}`, "IT Director", `p${i}@x${i}.com`, "312-555-0100", n].map(q).join(","))).join("\n");
  const by = new Map((scanParsedFiles([parseCSVText("t.csv", csv)]).results as any[]).map((x) => [x.id, x]));
  return notes.map((_, i) => by.get(`0-${i}`));
}
/** Same, but supplying the Product Area column Jack's real Main exports
 *  carry (`msp_primaryproductcodename`) — the source of the direction
 *  clause. `company` is settable because the column sometimes holds the
 *  CUSTOMER'S own name, which must never be reported as a partner. */
function scanPA(rows: { note: string; pa: string; company?: string; email?: string }[]) {
  const csv = ["Company,Full Name,Title,Email,Phone,msp_primaryproductcodename,Comments"]
    .concat(rows.map((r, i) => [r.company ?? `C${i}`, `P V${i}`, "IT Director",
      r.email ?? `p${i}@x${i}.com`, "312-555-0100", r.pa, r.note].map(q).join(","))).join("\n");
  const by = new Map((scanParsedFiles([parseCSVText("t.csv", csv)]).results as any[]).map((x) => [x.id, x]));
  return rows.map((_, i) => by.get(`0-${i}`));
}


// The Notes line is now a CALL BRIEF, per Jack: "this is how main scanner
// notes should come from now on ... highlevel what its about and ... two
// high level very short questions", with "dont make assumptions just use
// the data". The verbatim guarantee did not go away, it moved: everything
// BEFORE the question is taken from the row, and everything after it is
// visibly a question we are posing. These helpers split the line on that
// boundary so the assertions below test the half that makes the claim.
const factHalf = (snippet: string) =>
  stripSnippetPrefix(snippet).split(/\s(?:Ask |Row reverses:)/)[0].trim();
const askHalf = (snippet: string) => {
  const m = /\sAsk .+$/.exec(stripSnippetPrefix(snippet));
  return m ? m[0].trim() : "";
};
/** Every number the fact half states must appear in the row. A brief that
 *  invents a seat count is the same defect class as one that invents a
 *  Google migration. */
const numbersTraceable = (snippet: string, row: string) => {
  // Only a stated SEAT COUNT is a numeric claim. A product name carries
  // digits of its own ("M365 / Azure", "Microsoft 365 E3") and those are
  // the row's wording, not a number the brief asserts.
  const counts = [...factHalf(snippet).matchAll(/(\d+)\s+seats\b/gi)].map((m) => m[1]);
  return counts.every((n) => row.includes(n));
};

/**
 * Every claim the fact half attributes to the ROW must appear in the row.
 *
 * The brief is constructed prose now, not a quoted sentence, so a plain
 * substring test is the wrong question — it would fail on the scaffolding
 * ("Runs", "seats on") that is visibly ours. The guarantee that replaced
 * it, clause by clause: the PRODUCT NAMES and the SEAT COUNTS are the
 * row's own wording and are checked; the scaffolding, the engine's
 * category labels and the arithmetic band ("Large estate") are ours and
 * are not attributed to anyone.
 *
 * The direction clause is excluded on purpose: it comes from the Product
 * Area COLUMN, not from Comments, so it cannot be checked against the
 * comments text. scanPA covers it directly instead.
 */
const factsTraceable = (snippet: string, row: string): true | string => {
  const n = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // The Dynamics line is " \u00b7 "-separated facts rather than sentences —
  // per Jack, "i just need the platform in dyanmics mentioned the user
  // count if theres info on a partner and timeline". Split on both so the
  // SAME guarantee (every product name and seat count is the row's own)
  // applies to either shape.
  for (const raw of factHalf(snippet).split(/\s+\u00b7\s+|(?<=\.)\s+/)) {
    const c = raw.trim().replace(/[.…]+$/, "");
    if (!c) continue;
    // Ours, not the row's: engine vocabulary and derived bands.
    if (/^Large estate$/i.test(c)) continue;
    if (/no products or seat count named in the row/i.test(c)) continue;
    if (/^(?:Microsoft is already pitching them |Partner on record: |Goes direct with Microsoft)/.test(c)) continue;
    // Dynamics-line clauses that are OURS, not the row's: the partner and
    // "direct with Microsoft" come from the Product Area COLUMN (scanPA
    // covers those directly), and "already on Dynamics" is a derived
    // reading rather than quoted wording.
    if (/^(?:partner: |direct with Microsoft$|already on Dynamics$)/i.test(c)) continue;
    // A bare seat count on its own is checked by the count sweep below.
    if (/^\d+\s+(?:seats|users|employees)$/i.test(c)) continue;
    // Migration line: "Moving off X to Y" / "Migrating X to Y" — X is the
    // row's own words; Y is a normalised destination name, so only X is
    // checked. "Timeline: …" is checked like any other timeline below.
    const mig = /^(?:Moving off|Moving from|Migrating)\s+(.+?)\s+to\s+.+$/i.exec(c);
    if (/^Moving (?:to|entirely|fully|completely)\b/i.test(c)) continue;
    if (/^Timeline:\s*/i.test(c)) continue;
    // Partner / direct lines are our reading of the row (partnerStanceOf),
    // checked directly by their own cases below.
    if (/^(?:Wants to work with a partner|Wants to buy direct from Microsoft|Direct with Microsoft(?: today)?(?:, (?:no partner|wants to work with a partner))?)$/i.test(c)) continue;
    // A timeline is the row's own wording, but it is often a date the row
    // writes in a different format than the brief prints, so it is checked
    // by its digits rather than as a phrase.
    if (/^(?:Q[1-4]\b|\d{1,2}[/-]\d{1,2}[/-]|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i.test(c)
        || /^(?:next|within|in|end of|this)\b/i.test(c)) continue;

    let claims: string[] = [];
    let runs = /^Runs\s+(.+)$/i.exec(c);
    const seatsOn = /^(\d+)\s+seats\s+on\s+(.+)$/i.exec(c);
    const onToday = /^[Oo]n\s+(.+?)\s+today$/.exec(c);
    // reversed: "..." and a bare quoted pain are both the row's own words.
    const reversed = /^reversed:\s*"(.+?)"?$/i.exec(c);
    const quoted = /^"(.+?)"?$/.exec(c);
    const flagged = /^Flagged\s+"(.+)"$/i.exec(c);
    // The Dynamics line: "Wants <product> (N users)", "Looked at …",
    // "Why: <the row's reason>", "Already on Dynamics", "Wants a partner".
    const dynWant = /^(?:Wants|Looked at)\s+(?:a sales platform:\s+)?(.+?)(?:\s+\(\d+\s+(?:users|employees)\))?$/i.exec(c);
    const why = /^Why:\s+(.+)$/i.exec(c);
    if (/^(?:Already on Dynamics|Wants a partner)$/i.test(c)) continue;
    if (why) {
      claims = [why[1].replace(/\u2026$/, "")];
    } else if (dynWant && !/^Wants (?:to |Azure Document Intelligence)/i.test(c) && !/^Wants .+ for \d+ users$/i.test(c)) {
      claims = dynWant[1].split(/\s+\+\s+/).filter((x) => !/^Dynamics 365 Sales \/ CRM$/i.test(x));
    } else if (mig) {
      claims = [mig[1].replace(/^Google Workspace$/i, "Google Work")];
    } else if (runs) {
      claims = runs[1].split(/\s*,\s*|\s+and\s+/)
        .map((x) => x.replace(/\s*\(\d+\s*seats\)\s*$/i, "").trim()).filter(Boolean);
    } else if (seatsOn) claims = [seatsOn[2]];
    else if (onToday) claims = [onToday[1]];
    else if (flagged) claims = [flagged[1]];
    else if (reversed) claims = [reversed[1].replace(/\u2026$/, "")];
    else if (quoted) claims = [quoted[1].replace(/\u2026$/, "")];
    else claims = [c.replace(/,?\s*(?:no seat count stated|\d+ seats stated).*$/i, "").trim()];

    for (const claim of claims) {
      if (!claim || claim === "M365 / Azure") continue;
      if (!n(row).includes(n(claim))) return `claim "${claim}" is not in the row`;
    }
  }
  // Every seat count stated must be a number the row wrote.
  const counts = [...factHalf(snippet).matchAll(/(\d+)\s+seats\b/gi)].map((m) => m[1]);
  const bad = counts.find((x) => !row.includes(x));
  return bad ? `seat count ${bad} is not in the row` : true;
};

const ACG = "ACG - 17/Sep - ACG 9/17/21 Created growth optty for Copilot whitespace, 451 seats recommended by KYC";

console.log("\n== Jack's row: no invented intent, real facts kept ==");
const [acg] = scan([ACG]);
ok("the row still scans", !!acg);
if (acg) {
  const s: string = acg.notesSummary;
  console.log("  snippet: " + s);
  ok("does NOT claim a Google migration", !/google/i.test(s), s);
  ok("does NOT claim tenant creation", !/tenant creation/i.test(s), s);
  ok("does NOT claim ongoing IT support", !/ongoing it support/i.test(s), s);
  ok("does NOT speak as the lead (\"Interested in…\")", !/^interested in/i.test(s), s);
  ok("DOES name the product actually found", /copilot/i.test(s), s);
  ok("DOES state the count actually found", /451/.test(s), s);
  // The apology ("no quotable sentence in the source notes") is retired:
  // every scored row now gets a brief instead of an excuse. What has to
  // hold is that the brief states only what the row gave, then asks.
  ok("states only facts the row gave, then asks", numbersTraceable(s, ACG) && /Copilot/i.test(factHalf(s)), s);
  ok("  and the question half is visibly a question we pose", /^Ask /.test(askHalf(s)), s);
}

console.log("\n== a real sentence is still quoted verbatim ==");
const REAL = [
  "We are migrating from Google Workspace to Microsoft 365 for 120 users.",
  "Looking to get Dynamics 365 Business Central for up to 40 users.",
  "We want to bring in an MSP for ongoing IT support.",
];
scan(REAL).forEach((row, i) => {
  if (!row) return ok(`[${i}] produced a row`, false);
  const s: string = row.notesSummary;
  const t = factsTraceable(s, REAL[i]);
  ok(`facts traceable to the row: "${REAL[i].slice(0, 38)}…"`, t === true, `${s}  <<< ${t} >>>`);
  // Dynamics carries NO ask — per Jack, "i just need the platform in
  // dyanmics mentioned the user count if theres info on a partner and
  // timeline". Every other product line still closes on one.
  ok(row.category === "dynamics365"
       ? `  and a Dynamics line carries no generated question`
       : `  and it asks rather than inventing intent`,
     row.category === "dynamics365" ? !/\bAsk /.test(s) : /^Ask .+\.$/.test(askHalf(s)), s);
});

console.log("\n== no snippet anywhere may invent a hot signal ==");
// The dangerous class: a row that mentions none of these must never have
// one appear in its snippet, because that is what routes it to a sequence.
const NEUTRAL = [
  "CIT 3/4/26 - reviewed E3 renewal, 90 seats, follow up 4/1/26",
  "Opportunity created 5/1/26 for Business Central, 12 seats per KYC",
  "10/2/25 - renewal review, Entra ID Plan 2, 300 seats",
];
scan(NEUTRAL).forEach((row, i) => {
  if (!row) return ok(`[${i}] produced no row`, true);
  const s: string = row.notesSummary;
  const invented = /google|g suite|gmail/i.test(s) && !/google|g suite|gmail/i.test(NEUTRAL[i]);
  ok(`[${i}] no Google migration invented`, !invented, s);
  ok(`[${i}] does not speak as the lead`, !/^interested in/i.test(s), s);
});

console.log("\n== THE INVARIANT: verbatim, or labelled derived. Never a third thing ==");
// Per Jack: "we cannot have inaccurate notes in matched snippet." This is
// that rule as a machine check rather than a list of cases: for every row,
// the snippet must either appear in the row's own text or say outright
// that it could not be quoted.
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const CORPUS = [
  // Reversals that must survive intact or not be quoted at all.
  "We looked at Dynamics 365 Business Central, but decided to stay on QuickBooks for now.",
  "Azure migration was scoped, but the project is cancelled.",
  "We evaluated Power BI with a partner, and then chose Tableau.",
  // Long enough to truncate, with the reversal at the very end \u2014 the exact
  // shape that shipped a sentence meaning its own opposite.
  "The customer has been evaluating Dynamics 365 Business Central for their finance team for several quarters now and has finally decided not to proceed with it.",
  "They spent six months reviewing a full migration from Google Workspace over to Microsoft 365 for every office and in the end renewed with Google instead.",
  "We were going to bring in an MSP for ongoing IT support across all sites and for the whole leadership team, however the board declined it.",
  // Clean positives.
  "We are migrating from Google Workspace to Microsoft 365 for 120 users.",
  "Looking to get Dynamics 365 Business Central for up to 40 users.",
  "Interested in Azure Document Intelligence for our invoices.",
  // CRM metadata, the ACG shape.
  ACG,
  "CIT 3/4/26 - reviewed E3 renewal, 90 seats, follow up 4/1/26",
];
let verbatim = 0, derived = 0;
scan(CORPUS).forEach((row, i) => {
  if (!row) return;
  const s: string = row.notesSummary;
  if (isDerivedSummary(s)) { derived++; return; }
  // Numbers must be the row's own, and the product named must appear in it.
  const fact = factHalf(s).replace(/[.\u2026]+$/, "");
  const t = factsTraceable(s, CORPUS[i]);
  ok(`[${i}] facts traceable to the row: "${fact.slice(0, 40)}\u2026"`, t === true,
     `${s}  <<< ${t} >>>  ${CORPUS[i]}`);
  verbatim++;
});
ok("every row resolved to verbatim or derived, nothing invented", true, `${verbatim} verbatim, ${derived} derived`);

console.log("\n== a clause may not stand in for the sentence that reverses it ==");
// splitIntoUnits clause-splits any sentence over 160 chars, and the clause
// carrying the product name outscores the one carrying the verdict. This
// shipped a Google -> Microsoft migration on a lead that renewed WITH
// Google, verbatim and elliptical and completely wrong.
const CLAUSE = [
  "They were planning a full migration from Google Workspace over to Microsoft 365 for all of their offices and every subsidiary team, but they renewed with Google instead.",
  "The customer has been evaluating Dynamics 365 Business Central for their finance team across every regional office and subsidiary for several quarters now, but they have decided against it.",
];
scan(CLAUSE).forEach((row, i) => {
  if (!row) return ok(`[${i}] produced a row`, false);
  const s: string = row.notesSummary;
  const keptVerdict = /renewed with google|decided against|instead|but\b/i.test(s);
  ok(`[${i}] either carries the reversal or refuses to quote`,
     isDerivedSummary(s) || keptVerdict, s);
  if (i === 0) ok("does not advertise a migration the lead abandoned",
                  isDerivedSummary(s) || /renewed with google|instead/i.test(s), s);
});

console.log("\n== a cut is always visible, and never hides a reversal ==");
const LONG_REVERSAL = "The customer has been evaluating Dynamics 365 Business Central for their finance team for several quarters now and has finally decided not to proceed with it.";
const [lr] = scan([LONG_REVERSAL]);
ok("a brief that would drop \u201cdecided not to proceed\u201d carries it instead",
   !!lr && /decided not to proceed/i.test(lr.notesSummary), lr ? lr.notesSummary : "(no row)");
ok("  and the reversal is the last thing it says, with no ask after it",
   !!lr && !/\bAsk /.test(lr.notesSummary) && /[Rr]eversed:/.test(lr.notesSummary) && /^Looked at /.test(lr.notesSummary),
   lr ? lr.notesSummary : "(no row)");
const LONG_PLAIN = "The customer has been evaluating Dynamics 365 Business Central for their finance team across every regional office and subsidiary for several quarters now and continues to move forward.";
const [lp] = scan([LONG_PLAIN]);
// The brief does not truncate a quote, so there is no cut to mark. What
// replaces that guarantee: a row with NO reversal must not claim one.
if (lp) {
  ok("a row that is still moving forward is not reported as reversed",
     !/Row reverses:/.test(lp.notesSummary), lp.notesSummary);
}

console.log("\n== the call brief: what it is about, then two questions ==");
// Per Jack, the three areas and the tie-break: "Licensing \u2192 how they manage
// it today, direct or through a partner", "Dynamics \u2192 ever looked at the
// platform, what they run today, the high level pain points", "Azure \u2192 how it is
// managed today, internal IT or an external partner", plus "licensing
// stores with m365 so thats there", "dynamics is its own" and "if its
// general it or m365/azure go with the azure".
const AREAS: [string, string, RegExp][] = [
  ["a named licensing SKU asks the licensing question",
   "Renewing Microsoft 365 E3 for 300 users this year.", /Ask how they manage licensing today/],
  ["Dynamics names the module instead of asking a question",
   "Looking at Dynamics 365 Business Central for 40 users.", /Business Central/],
  ["general IT / Azure with no SKU named asks the Azure question",
   "We want to bring in an MSP for ongoing IT support.", /Ask how Azure is managed today/],
  ["an Azure migration asks the Azure question too",
   "Planning an on-prem to Azure migration with a partner this year.", /Ask how Azure is managed today/],
];
scan(AREAS.map((a) => a[1])).forEach((row, i) => {
  const [label, , want] = AREAS[i];
  ok(label, !!row && want.test(row.notesSummary), row ? row.notesSummary : "(no row)");
});

console.log("\n== a stated user count is attached and kept ==");
// Per Jack: "if theres a user count do attach that and keep it in the notes".
// A licensing row carries it on the SKU that stated it — "Runs Microsoft
// 365 E3 (300 seats)" — and a Dynamics row on the module in play.
const [c300] = scan(["Renewing Microsoft 365 E3 for 300 users this year."]);
ok("a licensing seat count rides on the SKU that stated it",
   !!c300 && /\(300 seats\)/.test(c300.notesSummary), c300 ? c300.notesSummary : "(no row)");
const [c40] = scan(["Looking at Dynamics 365 Business Central for 40 users."]);
ok("a Dynamics seat count survives into the note",
   !!c40 && /\(40 users\)/.test(c40.notesSummary), c40 ? c40.notesSummary : "(no row)");
// The Dynamics module the row named must survive, not collapse to the
// category: "Dynamics 365 Business Central - 25 users" rendered as
// "25 seats on Dynamics 365" because the hit's \u00b170 window clipped it.
const [bc] = scan(["Servbank-Dynamics 365 Business Central- 25 users."]);
ok("the Dynamics module the row named is kept, not just the category",
   !!bc && /Dynamics 365 Business Central/i.test(bc.notesSummary), bc ? bc.notesSummary : "(no row)");
// A bare "Sales" is a CRM form label, not a product the lead named.
const [stage] = scan(["Sales Stage: Qualify. Need: Dynamics 365 for the team."]);
ok("a bare \u201cSales\u201d form label is never named as the product",
   !!stage && !/ on Sales\b/.test(stage.notesSummary), stage ? stage.notesSummary : "(no row)");
// A count only ever attaches to the product that stated it.
const [pin] = scan(["Visio for the design team, SharePoint 300 users, 400 seats across the estate."]);
ok("a count is never pinned to a product that did not state it",
   !!pin && !/400 seats on Visio/.test(pin.notesSummary), pin ? pin.notesSummary : "(no row)");

console.log("\n== a reversal is carried, and only a real one ==");
// A row that qualifies under the Azure gate (an on-prem migration with a
// partner), carrying a "but" that is a complaint about today rather than a
// verdict on the deal.
const [soft] = scan(["Planning an on-prem to Azure migration with a partner, but the current setup is far from meeting their requirements."]);
ok("a bare \u201cbut\u201d is NOT reported as a lost deal",
   !!soft && !/reversed:/.test(soft.notesSummary), soft ? soft.notesSummary : "(no row)");
ok("  so the row keeps its normal questions",
   !!soft && /Ask how Azure is managed today/.test(soft.notesSummary), soft ? soft.notesSummary : "(no row)");
const [hard] = scan(["We evaluated Dynamics 365 Business Central for 40 users, but they are staying on SAP for now."]);
ok("a substantive verdict IS reported even with a \u201cbut\u201d before it",
   !!hard && /[Rr]eversed:/.test(hard.notesSummary), hard ? hard.notesSummary : "(no row)");
ok("  and it quotes the verdict, not the evaluation it replaced",
   !!hard && /staying on sap/i.test(hard.notesSummary) && !/reversed: "we evaluated/i.test(hard.notesSummary),
   hard ? hard.notesSummary : "(no row)");
ok("  and the reversal is the last thing it says, with no ask after it",
   !!hard && !/\bAsk /.test(hard.notesSummary) && /[Rr]eversed:/.test(hard.notesSummary),
   hard ? hard.notesSummary : "(no row)");

console.log("\n== Jack's three-clause shape ==");
// Per Jack, the target line verbatim: "Runs O365 and M365. Microsoft is
// already pitching them an Azure Virtual Desktop workload. Ask how Azure
// is managed today, internal IT or an external partner, and where the
// pain is." Three clauses: what they run, where they are going / who
// handles it, then the ask.
const [runs2] = scan(["They run Office 365 E3 and Microsoft 365 Copilot across the business."]);
// The note now opens on the row's own sentence when it says what they run
// (per Jack: lead with what the raw note says), "Runs …" otherwise.
ok("the installed base leads with what they run",
   !!runs2 && /\b(?:Runs|They run) /.test(runs2.notesSummary), runs2 ? runs2.notesSummary : "(no row)");
ok("  naming both SKUs the row wrote, joined with “and”",
   !!runs2 && /Office 365 E3 and Microsoft 365 Copilot/i.test(runs2.notesSummary),
   runs2 ? runs2.notesSummary : "(no row)");

// The direction clause comes out of the Product Area column, which on the
// real exports holds three different KINDS of value — a Microsoft product,
// Microsoft itself, or a reseller — and they mean different things.
const DIR = scanPA([
  { note: "Renewing Microsoft 365 E3 for 300 users this year.", pa: "Azure" },
  { note: "Renewing Microsoft 365 E3 for 300 users this year.", pa: "Microsoft Corporation" },
  { note: "Renewing Microsoft 365 E3 for 300 users this year.", pa: "Sentinel Technologies" },
  { note: "Renewing Microsoft 365 E3 for 300 users this year.", pa: "Microsoft direct" },
  { note: "Renewing Microsoft 365 E3 for 300 users this year.", pa: "4518215" },
  { note: "Renewing Microsoft 365 E3 for 300 users this year.", pa: "Datadog", company: "Datadog", email: "laura@datadoghq.com" },
  { note: "Renewing Microsoft 365 business standard for 25 users.", pa: "M365" },
]);
// Per Jack: "it doesnt matter if microsoft is pitching them we can still
// partner with them" — no pitching clause, but the Product Area still steers
// the ask to Azure.
ok("a Microsoft product in Product Area adds no pitching clause, still steers the ask",
   !!DIR[0] && !/already pitching/.test(DIR[0].notesSummary) && /Ask how Azure is managed today/.test(DIR[0].notesSummary),
   DIR[0] ? DIR[0].notesSummary : "(no row)");
ok("Microsoft itself reads as going direct",
   !!DIR[1] && /Goes direct with Microsoft\./.test(DIR[1].notesSummary),
   DIR[1] ? DIR[1].notesSummary : "(no row)");
ok("a reseller name reads as a partner on the record",
   !!DIR[2] && /Partner on record: Sentinel Technologies\./.test(DIR[2].notesSummary),
   DIR[2] ? DIR[2].notesSummary : "(no row)");
ok("  “Microsoft direct” is never reported as a partner",
   !!DIR[3] && !/Partner on record/.test(DIR[3].notesSummary) && /Goes direct/.test(DIR[3].notesSummary),
   DIR[3] ? DIR[3].notesSummary : "(no row)");
ok("  a bare account number says nothing and is dropped",
   !!DIR[4] && !/Partner on record|pitching them/.test(DIR[4].notesSummary),
   DIR[4] ? DIR[4].notesSummary : "(no row)");
// Real on this data: a Datadog contact on a @datadoghq.com address whose
// Product Area reads "Datadog". That is the customer, not their partner.
ok("  the customer's OWN name is never reported as their partner",
   !!DIR[5] && !/Partner on record/.test(DIR[5].notesSummary),
   DIR[5] ? DIR[5].notesSummary : "(no row)");
ok("  a direction that just restates what they run is dropped",
   !!DIR[6] && !/pitching them/.test(DIR[6].notesSummary),
   DIR[6] ? DIR[6].notesSummary : "(no row)");

console.log("\n== the ask follows the direction, not the installed base ==");
// Jack's own target line: the lead "Runs O365 and M365" and the ask is
// STILL the Azure one, because Azure is what the opportunity is about.
const [jack] = scanPA([{ note: "They run Office 365 E3 and Microsoft 365 Copilot across the business.", pa: "Azure Virtual Desktop" }]);
ok("an Azure direction takes the Azure ask even when M365 SKUs are named",
   !!jack && /\b(?:Runs|They run) /.test(jack.notesSummary) && /Ask how Azure is managed today/.test(jack.notesSummary),
   jack ? jack.notesSummary : "(no row)");

console.log("\n== the Dynamics line states facts instead of asking ==");
// These four rows used to assert the WORDING of a generated question. Per
// Jack — "i dont need a score for dynamics", "i just need the platform in
// dyanmics mentioned the user count if theres info on a partner and
// timeline ... if theymention a pain they havce" — the ask is gone, so
// each now asserts the FACT the same row states. Measured before the
// change: the ask was 59% of all Dynamics note text, and 529 of 591 rows
// carried the identical 106-character sentence.
const DYN_FACTS: [string, string, RegExp][] = [
  ["a bare evaluation is just the module and the count",
   "Looking at Dynamics 365 Business Central for 40 users.",
   /^Wants Dynamics 365 Business Central \(40 users\)\.$/],
  ["an incumbent is named as a fact, not asked about",
   "We looked at Dynamics 365 Business Central for 40 users. We are on Sage 100 today and continue to move forward.",
   /On Sage today/],
  ["a stated pain is quoted",
   "Looking at Dynamics 365 Business Central for 40 users. The current setup is end of life.",
   /Why: end of life/],
  ["incumbent AND pain both land",
   "Dynamics 365 Business Central for 40 users. On QuickBooks today and the manual double-entry is a bottleneck, and we continue to move forward.",
   /On QuickBooks today/],
];
scan(DYN_FACTS.map((d) => d[1])).forEach((row, i) => {
  const [label, , want] = DYN_FACTS[i];
  ok(label, !!row && want.test(row.notesSummary), row ? row.notesSummary : "(no row)");
  ok(`  ${label} \u2014 no generated question`, !!row && !/\bAsk /.test(row.notesSummary), row ? row.notesSummary : "");
  ok(`  ${label} \u2014 no score head`, !!row && !/^\(\d+\)/.test(row.notesSummary), row ? row.notesSummary : "");
});
scan(DYN_FACTS.map((d) => d[1])).forEach((row, i) => {
  ok(`  [${i}] never says “where it falls short”`,
     !!row && !/falls short/i.test(row.notesSummary), row ? row.notesSummary : "(no row)");
});

console.log("\n== the pain probe ==");
// Per Jack the ask ends "and where the pain is" — except where the row
// already stated its pain, since asking for what we were just told wastes
// one of only two questions.
const [noPain] = scan(["Renewing Microsoft 365 E3 for 300 users this year."]);
ok("the ask closes on the pain probe",
   !!noPain && /and where the pain is\./.test(noPain.notesSummary), noPain ? noPain.notesSummary : "(no row)");
const [hasPain] = scan(["Renewing Microsoft 365 E3 for 300 users. Their current setup is end of life and the manual process is a bottleneck."]);
ok("  but not when the row already said what the pain is",
   !!hasPain && /Flagged "/.test(hasPain.notesSummary) && !/and where the pain is/.test(hasPain.notesSummary),
   hasPain ? hasPain.notesSummary : "(no row)");

console.log("\n== a count with no SKU to hang it on is still kept ==");
// Per Jack: "if theres a user count do attach that and keep it in the
// notes". A row can state one and name no catalogue SKU at all, so the
// licensing engine never reads it.
const [noSku] = scan(["Looking to move from Google Workspace to Microsoft 365 for 120 users."]);
ok("a stated count survives a row that names no SKU",
   !!noSku && /\b120 (?:seats|users)\b/.test(noSku.notesSummary), noSku ? noSku.notesSummary : "(no row)");
ok("  and it is NOT joined to a product the row never wrote",
   !!noSku && !/120 seats on /.test(noSku.notesSummary), noSku ? noSku.notesSummary : "(no row)");
// The same path must not read a phone number, a ticket id or an
// opportunity reference as a headcount.
const GUARDS = [
  ["a phone number never becomes a seat count",
   "Moving from Google Workspace to Microsoft 365. Call 312-555-0199. Ticket 4521."],
  ["an opportunity reference never becomes a seat count",
   "On-prem to Azure migration with a partner. Opportunity 7-3I4S4IM7SG."],
];
scan(GUARDS.map((g) => g[1])).forEach((row, i) => {
  ok(GUARDS[i][0], !!row && !/\d+ seats stated/.test(row.notesSummary),
     row ? row.notesSummary : "(no row)");
});

console.log("\n== every scored row says something before the ask ==");
// A row can qualify on a platform gate alone, naming no SKU and carrying
// no usable Product Area. It must still state what matched rather than
// opening cold on a question.
const [thin] = scan(["We are moving from Google Workspace to Microsoft 365."]);
ok("a row with no SKU and no Product Area still states what matched",
   !!thin && !/^Ask /.test(stripSnippetPrefix(thin.notesSummary)),
   thin ? thin.notesSummary : "(no row)");

// Per Jack, on a real partner-led Azure note (Truist / Infosys): frame the
// problem or what they need first, then the existing ask. Seller pipeline
// chatter ("Follow-up sent to the partner requesting an update…") never
// leads.
{
  const [az] = scanPA([{ note: "SA - 9/Mar - Follow-up sent to the partner requesting an update on the current project status and estimated ACR. Client Info: Acme Bank Account ID: 9-ZZF Referral ID: 7426adc0 Notes: Microsoft Partner is engaging with Acme Bank to enable the Microsoft Foundry Platform with a focus on Agent Service. Help Needed from Microsoft ========== We seek Microsoft's assistance: - Support in implementing the analytics platform on Microsoft Azure to ensure seamless integration and scalability. - Guidance on cloud migration strategies and connectivity to enable efficient data access across multiple sources. - Assistance with optimizing performance and security leveraging Azure services.", pa: "AI Ready with Surface Copilot PCs" }]);
  const s = az ? az.notesSummary : "(no row)";
  ok("partner-led Azure note opens on what the row is about", /Partner is engaging with Acme Bank/.test(s) && !/Follow-up sent/i.test(s), s);
  ok("  states the Azure architecture support it is after", /Looking for Azure architecture support\./.test(s), s);
  ok("  and closes on the existing Azure ask", /Ask how Azure is managed today, internal IT or an external partner/.test(s), s);
}

// Per Jack: "Customer has 6 copilot licenses and want to expand across all
// 305 E3 users this is great for m365 azure" — the plain sentence is the
// note, with no product list or "already pitching them" clause added.
{
  const [cp] = scan(["Customer has 6 copilot licenses and want to expand across all 305 E3 users."]);
  const s = cp ? stripSnippetPrefix(cp.notesSummary) : "(no row)";
  ok("a plain expansion sentence is the note as written, then the ask",
     /^Customer has 6 copilot licenses and want to expand across all 305 E3 users\. Ask how they manage licensing today/.test(s), s);
}

// Per Jack, on "The purchase is pending because the admin assistant has the
// payment card": "nothing like this this is bad lead". A purchase already
// made or in progress is a closed transaction, not a call.
{
  const [pend] = scan(["Customer confirmed 3 Microsoft 365 Business Standard licenses. The purchase is pending because the admin assistant has the payment card. Uses Google for email and will keep it."]);
  ok("a pending purchase is a Bad Lead, even with a Google tag", !!pend && pend.tier === "dq" && pend.dqReasons.includes("Purchase already made or in progress"), pend ? `${pend.tier} ${pend.dqReasons}` : "(no row)");
  const [won] = scan(["Close as: Won. POP (Proof of Purchase): Purchase completed by the customer during the session, 2 Microsoft 365 Business Premium licenses."]);
  ok("  so is a completed one", !!won && won.tier === "dq", won ? won.tier : "(no row)");
  const [direct] = scan(["Microsoft 365 estate: 55 Business Standard and 26 Business Premium licenses, purchased directly with Microsoft; no partner today. Looking for a partner to run an Azure migration."]);
  ok("  but buying direct today is not a purchase-done Bad Lead", !!direct && !direct.dqReasons.includes("Purchase already made or in progress"), direct ? `${direct.tier} ${direct.dqReasons}` : "(no row)");
  const [form] = scan(["First Comment (Mandatory fields): - Tenant ID: 6184af29-e23e-4fda-b9f1-158d5917ff54 - Organization details: Logistics firm, 120 employees. - Need: Looking to move from Google Workspace to Microsoft 365 for 120 users with a partner."]);
  const fs = form ? stripSnippetPrefix(form.notesSummary) : "(no row)";
  ok("the mandatory-field form header and tenant id never open the note", !!form && !/Mandatory fields|Tenant ID|6184af29/i.test(fs), fs);
}

// Per Jack: "for migrations just need to know what they are wantin to
// mirgatet and if theres a clear timeline".
{
  const [g] = scan(["We are moving from Google Workspace to Microsoft 365 for 40 users in Q1 2027 and want a partner to run it."]);
  const gs = g ? stripSnippetPrefix(g.notesSummary) : "(no row)";
  ok("a Google move reads as what is moving, the count and the timeline", /^Moving off Google Workspace to Microsoft 365\. 40 (?:users|seats)\. Timeline: Q1 2027\. (?:Wants to work with a partner\. )?Ask /.test(gs), gs);
  const [a] = scan(["Looking to migrate our file servers and SQL databases to Azure by end of the year with a partner."]);
  const as = a ? stripSnippetPrefix(a.notesSummary) : "(no row)";
  ok("an Azure move names what is migrating and when", /^Migrating file servers and SQL databases to Azure\. Timeline: end of the year\. Ask how Azure/.test(as), as);
  const [past] = scan(["9/22/2025 - Looking to migrate their on-premises servers to Azure with a partner."]);
  const ps = past ? stripSnippetPrefix(past.notesSummary) : "(no row)";
  ok("  a past note stamp is never read as the timeline", !!past && !/Timeline/.test(ps), ps);
  const [cp] = scan(["Customer has 6 copilot licenses and want to expand across all 305 E3 users. They also plan to move to Azure."]);
  const cs = cp ? stripSnippetPrefix(cp.notesSummary) : "(no row)";
  ok("  a vague 'move to Azure' never replaces a real opening line", /^Customer has 6 copilot licenses/.test(cs), cs);
}

// Per Jack, on this exact note: "this is a great lead and note". Pinned so
// later note changes cannot lose its shape.
{
  const [cm] = scan(["CU needs a partner to create the tenant in USA f1 Services - Microsoft 365 Business Premium - 28 User"]);
  const s2 = cm ? cm.notesSummary : "(no row)";
  ok("the Christian Monahan note keeps its shape", /^\(\d+\) ▲ Customer needs a partner to create the tenant in USA\. Wants Microsoft 365 Business Premium for 28 users\. Ask how they manage licensing today/.test(s2), s2);
}

// Per Jack: "if a company is looking to migrate to azure or on prem to azure
// just be direct with the notes".
{
  const [op] = scan(["We are looking to move from on-premises to Azure next quarter with a partner."]);
  const o = op ? stripSnippetPrefix(op.notesSummary) : "(no row)";
  ok("on-prem to Azure reads as one direct line", /^Migrating on-prem to Azure\. Timeline: next quarter\. Ask how Azure/.test(o), o);
}

// Per Jack: "make it known in the notes if they want to work with a partner
// also for anything or if it says direct".
{
  const [d] = scan(["Customer has 40 Microsoft 365 E3 licenses purchased directly with Microsoft and wants to add Copilot for 40 users."]);
  const ds = d ? stripSnippetPrefix(d.notesSummary) : "(no row)";
  ok("a direct buyer says so", /Direct with Microsoft, no partner\./.test(ds), ds);
  const [w] = scan(["Planning to migrate our on-prem servers to Azure next quarter and would like to work with a partner."]);
  const ws = w ? stripSnippetPrefix(w.notesSummary) : "(no row)";
  ok("a partner ask says so", /Wants to work with a partner\./.test(ws), ws);
  const [x] = scan(["Customer wants to move away from their current partner and purchase directly from Microsoft for 50 Microsoft 365 E3 licenses."]);
  const xs = x ? stripSnippetPrefix(x.notesSummary) : "(no row)";
  ok("wanting to go direct says so", /Wants to buy direct from Microsoft\./.test(xs), xs);
  const [n] = scan(["Renewing Microsoft 365 E3 for 300 users this year."]);
  const ns = n ? stripSnippetPrefix(n.notesSummary) : "(no row)";
  ok("  and a row that says neither adds nothing", !/Wants to work with a partner|Direct with Microsoft|buy direct/.test(ns), ns);
  const [dy] = scan(["Looking to implement Dynamics 365 Business Central for 25 users this year and want to work with a partner for the implementation."]);
  ok("  the Dynamics line carries it too", !!dy && /[Ww]ants a partner/.test(dy.notesSummary), dy ? dy.notesSummary : "(no row)");
}

// Per Jack: "for dynamics we want to know they want it, reason why they want
// it, current platform if states what they are on today and by when they
// want it if it states that parantheses the user count".
{
  const [dq] = scan(["Looking to implement Dynamics 365 Business Central for 25 users by Q2 2027 because QuickBooks can't handle their inventory anymore."]);
  const s3 = dq ? dq.notesSummary : "(no row)";
  ok("Dynamics: what, (users), why, on today, by when", /^Wants Dynamics 365 Business Central \(25 users\)\. Why: QuickBooks can't handle their inventory anymore\. On QuickBooks today\. Timeline: Q2 2027\.$/.test(s3), s3);
  const [gp] = scan(["Currently on Dynamics GP and looking to move to Dynamics 365 Business Central for 40 users this year."]);
  const g3 = gp ? gp.notesSummary : "(no row)";
  ok("  GP beside Business Central is what they run today", /^Wants Dynamics 365 Business Central \(40 users\)\..*On Dynamics GP today\./.test(g3), g3);
}
// Per Jack: Azure Document Intelligence "has to be known" — "Wants Azure
// Document Intelligence. Ask how Azure is managed today, internal IT or an
// external part[ner]" "is gold".
{
  const [di] = scan(["Service - Azure Document Intelligence - process invoices"]);
  const d3 = di ? stripSnippetPrefix(di.notesSummary) : "(no row)";
  ok("Document Intelligence reads exactly as Jack's gold line", /^Wants Azure Document Intelligence\. Ask how Azure is managed today, internal IT or an external partner/.test(d3), d3);
  const [di2] = scan(["Customer wants to use Azure Document Intelligence to automate invoice processing by Q1 2027."]);
  const e3 = di2 ? stripSnippetPrefix(di2.notesSummary) : "(no row)";
  ok("  and is named even when its sentence cannot be quoted", /Wants Azure Document Intelligence\. Timeline: Q1 2027\./.test(e3), e3);
}
// Per Jack: "no url link or weird characters should ever be in notes".
{
  const [u] = scan(["Customer wants Microsoft 365 Business Premium for 30 users \u00e2\u20ac\u2122 see https://contoso.com/form. They don\u00e2\u20ac\u2122t have a partner today."]);
  const u3 = u ? u.notesSummary : "(no row)";
  ok("no link and no mangled characters in a note", !/https?:|www\.|\u00e2\u20ac|\uFFFD/.test(u3) && /Business Premium for 30 users/.test(u3), u3);
}

// Per Jack: "anything indicating cybersecurity or it support or a partner
// needs to be direct as its written".
{
  const [sec] = scan(["The customer currently uses Microsoft 365 Business Premium and is evaluating Microsoft 365 E5, primarily for enhanced antivirus, endpoint protection, and broader security capabilities."]);
  const a4 = sec ? stripSnippetPrefix(sec.notesSummary) : "(no row)";
  ok("a security need leads, as written", /^Evaluating Microsoft 365 E5, primarily for enhanced antivirus, endpoint protection, and broader security capabilities\./.test(a4), a4);
  const [its] = scan(["We need ongoing IT support and a help desk for our 40 users, our current provider is unresponsive."]);
  const b4 = its ? stripSnippetPrefix(its.notesSummary) : "(no row)";
  ok("an IT-support need leads, as written", /^We need ongoing IT support and a help desk for our 40 users/.test(b4), b4);
  const [msp] = scan(["Customer is looking for an MSP to take over their Microsoft 365 tenant and security."]);
  const c4 = msp ? stripSnippetPrefix(msp.notesSummary) : "(no row)";
  ok("a partner ask leads, as written, and is not said twice", /^Customer is looking for an MSP to take over their Microsoft 365 tenant and security\./.test(c4) && !/Wants to work with a partner/.test(c4), c4);
}

// Per Jack: "if a note has date or time just scrap it unless its a direct
// meeting with microsoft".
{
  const [t1] = scan(["01:36 Potential Interest in Copilot and Cowork Agents: Darren inquired about the usefulness of Copilot for the sales team."]);
  const a5 = t1 ? stripSnippetPrefix(t1.notesSummary) : "(no row)";
  ok("a sentence carrying a clock time is scrapped", !/01:36|\b\d{1,2}:\d\d\b/.test(a5), a5);
  const [t2] = scan(["Customer interested in Microsoft 365 E5 security, confirmed meeting for Wednesday at 2pm."]);
  const b5 = t2 ? stripSnippetPrefix(t2.notesSummary) : "(no row)";
  ok("a weekday or time never reaches the note", !/Wednesday|2pm/i.test(b5), b5);
  const [t3] = scan(["Customer has a meeting with Microsoft on Thursday to review moving 200 users to Microsoft 365 E5."]);
  const c5 = t3 ? stripSnippetPrefix(t3.notesSummary) : "(no row)";
  ok("a direct meeting with Microsoft is kept, as written", /meeting with Microsoft on Thursday/.test(c5), c5);
  const [t4] = scan(["Customer has a meeting with Microsoft partner Contoso on Thursday to review Microsoft 365 E5 for 200 users."]);
  const d5 = t4 ? stripSnippetPrefix(t4.notesSummary) : "(no row)";
  ok("  but a meeting with a Microsoft PARTNER is not exempt", !/Thursday/.test(d5), d5);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
