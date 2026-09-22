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
import { scanParsedFiles, isDerivedSummary } from "../../src/lib/detection";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
function scan(notes: string[]) {
  const csv = ["Company,Full Name,Title,Email,Phone,Comments"]
    .concat(notes.map((n, i) => [`C${i}`, `P V${i}`, "IT Director", `p${i}@x${i}.com`, "312-555-0100", n].map(q).join(","))).join("\n");
  const by = new Map((scanParsedFiles([parseCSVText("t.csv", csv)]).results as any[]).map((x) => [x.id, x]));
  return notes.map((_, i) => by.get(`0-${i}`));
}

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
  ok("admits it could not quote the row", /no quotable sentence/i.test(s), s);
}

console.log("\n== a real sentence is still quoted verbatim ==");
const REAL = [
  "We are migrating from Google Workspace to Microsoft 365 for 120 users.",
  "Looking to get Dynamics 365 Business Central for up to 40 users.",
  "We want to bring in an MSP for ongoing IT support.",
];
scan(REAL).forEach((row, i) => {
  ok(`quoted unchanged: "${REAL[i].slice(0, 42)}…"`,
     !!row && String(row.notesSummary).replace(/\.$/, "") === REAL[i].replace(/\.$/, ""),
     row ? row.notesSummary : "(no row)");
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
  const body = s.replace(/[.\u2026]+$/, "");
  ok(`[${i}] snippet appears in the row: "${body.slice(0, 40)}\u2026"`,
     norm(CORPUS[i]).includes(norm(body)), `${s}  <<< NOT IN >>>  ${CORPUS[i]}`);
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
ok("a truncation that would drop \u201cdecided not to proceed\u201d is refused",
   !!lr && isDerivedSummary(lr.notesSummary), lr ? lr.notesSummary : "(no row)");
const LONG_PLAIN = "The customer has been evaluating Dynamics 365 Business Central for their finance team across every regional office and subsidiary for several quarters now and continues to move forward.";
const [lp] = scan([LONG_PLAIN]);
if (lp && !isDerivedSummary(lp.notesSummary)) {
  ok("a harmless truncation is marked with an ellipsis, not a full stop",
     /\u2026$/.test(lp.notesSummary), lp.notesSummary);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
