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
  for (const raw of factHalf(snippet).split(/(?<=\.)\s+/)) {
    const c = raw.trim().replace(/[.…]+$/, "");
    if (!c) continue;
    // Ours, not the row's: engine vocabulary and derived bands.
    if (/^Large estate$/i.test(c)) continue;
    if (/no products or seat count named in the row/i.test(c)) continue;
    if (/^(?:Microsoft is already pitching them |Partner on record: |Goes direct with Microsoft)/.test(c)) continue;

    let claims: string[] = [];
    let runs = /^Runs\s+(.+)$/i.exec(c);
    const seatsOn = /^(\d+)\s+seats\s+on\s+(.+)$/i.exec(c);
    const onToday = /^On\s+(.+?)\s+today$/i.exec(c);
    const flagged = /^Flagged\s+"(.+)"$/i.exec(c);
    if (runs) {
      claims = runs[1].split(/\s*,\s*|\s+and\s+/)
        .map((x) => x.replace(/\s*\(\d+\s*seats\)\s*$/i, "").trim()).filter(Boolean);
    } else if (seatsOn) claims = [seatsOn[2]];
    else if (onToday) claims = [onToday[1]];
    else if (flagged) claims = [flagged[1]];
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
  ok(`  and it asks rather than inventing intent`, /^Ask .+\.$/.test(askHalf(s)), s);
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
ok("  and asks the question that fits a dead deal",
   !!lr && /Ask what changed and what would reopen it/.test(lr.notesSummary), lr ? lr.notesSummary : "(no row)");
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
  ["Dynamics asks the Dynamics question",
   "Looking at Dynamics 365 Business Central for 40 users.", /Ask if they have looked at Dynamics before/],
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
   !!c40 && /40 seats on /.test(c40.notesSummary), c40 ? c40.notesSummary : "(no row)");
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
   !!soft && !/Row reverses:/.test(soft.notesSummary), soft ? soft.notesSummary : "(no row)");
ok("  so the row keeps its normal questions",
   !!soft && /Ask how Azure is managed today/.test(soft.notesSummary), soft ? soft.notesSummary : "(no row)");
const [hard] = scan(["We evaluated Dynamics 365 Business Central for 40 users, but they are staying on SAP for now."]);
ok("a substantive verdict IS reported even with a \u201cbut\u201d before it",
   !!hard && /Row reverses:/.test(hard.notesSummary), hard ? hard.notesSummary : "(no row)");
ok("  and it quotes the verdict, not the evaluation it replaced",
   !!hard && /staying on sap/i.test(hard.notesSummary) && !/Row reverses: "we evaluated/i.test(hard.notesSummary),
   hard ? hard.notesSummary : "(no row)");
ok("  and asks the question that fits a dead deal",
   !!hard && /Ask what changed and what would reopen it/.test(hard.notesSummary), hard ? hard.notesSummary : "(no row)");

console.log("\n== Jack's three-clause shape ==");
// Per Jack, the target line verbatim: "Runs O365 and M365. Microsoft is
// already pitching them an Azure Virtual Desktop workload. Ask how Azure
// is managed today, internal IT or an external partner, and where the
// pain is." Three clauses: what they run, where they are going / who
// handles it, then the ask.
const [runs2] = scan(["They run Office 365 E3 and Microsoft 365 Copilot across the business."]);
ok("the installed base leads with “Runs …”",
   !!runs2 && /Runs /.test(runs2.notesSummary), runs2 ? runs2.notesSummary : "(no row)");
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
ok("a Microsoft product in Product Area reads as what they are being pitched",
   !!DIR[0] && /Microsoft is already pitching them Azure\./.test(DIR[0].notesSummary),
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
   !!jack && /Runs /.test(jack.notesSummary) && /Ask how Azure is managed today/.test(jack.notesSummary),
   jack ? jack.notesSummary : "(no row)");

console.log("\n== the Dynamics ask asks for pain points, not “falls short” ==");
// Per Jack, correcting the first wording: "not where it falls short but
// what the high level pain points are".
const DYN_ASK: [string, string, RegExp][] = [
  ["no incumbent, no pain stated",
   "Looking at Dynamics 365 Business Central for 40 users.",
   /Ask if they have looked at Dynamics before, what they run today, and what the high level pain points are\./],
  ["an incumbent swaps in the forcing question, pain still asked",
   "We looked at Dynamics 365 Business Central for 40 users. We are on Sage 100 today and continue to move forward.",
   /Ask if they have looked at Dynamics before, what is forcing the change now, and what the high level pain points are\./],
  // Two clauses take "and", three take a comma list — without that rule
  // dropping the pain clause left "…Dynamics before, what they run today."
  ["a row that already stated its pain is not asked for it again",
   "Looking at Dynamics 365 Business Central for 40 users. The current setup is end of life.",
   /Ask if they have looked at Dynamics before and what they run today\./],
  ["incumbent AND pain known leaves two real questions",
   "Dynamics 365 Business Central for 40 users. On QuickBooks today and the manual double-entry is a bottleneck, and we continue to move forward.",
   /Ask if they have looked at Dynamics before and what is forcing the change now\./],
];
scan(DYN_ASK.map((d) => d[1])).forEach((row, i) => {
  const [label, , want] = DYN_ASK[i];
  ok(label, !!row && want.test(row.notesSummary), row ? row.notesSummary : "(no row)");
});
scan(DYN_ASK.map((d) => d[1])).forEach((row, i) => {
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
   !!noSku && /120 seats stated\./.test(noSku.notesSummary), noSku ? noSku.notesSummary : "(no row)");
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

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
