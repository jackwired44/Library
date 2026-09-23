// Top priority: which Main Scanner leads get pinned, and what pinning may
// and may not change.
//
// Per Jack, in two messages: "google migrations to microsoft need to be
// flagged as top priority for leads in main scanner", then "anyone looking
// specifically to work with a partner also to be included with that."
//
// The trap this suite exists to guard: isGoogleToMicrosoft is NOT a Google
// signal any more. It was widened to cover every migration-flavored hit —
// generic legacy-modernization and Azure lift-and-shift included — because
// it drives the "Google → Microsoft" VIEW TAB, which Jack asked to be a
// migrations tab. Pinning on it would have pinned roughly three times what
// he asked for. isGoogleWorkspaceMigration is the narrow one, and the two
// must never be collapsed back together.
//
// The other half: a pin is a BADGE and a SORT. It must never move a lead
// between categories, tiers, buckets or download files.
import { parseCSVText } from "../../src/lib/csv";
import {
  scanParsedFiles, topPriorityReason, sortTopPriorityFirst, exportRowsForBucket,
  m365SubViewOf, M365_SUB_VIEWS, CATEGORY_META, type ResultRow,
} from "../../src/lib/detection";
import { sortStoredTopPriorityFirst, storedTopPriorityReason, storedM365SubView } from "../../src/lib/library";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
function scan(notes: string[]): ResultRow[] {
  const csv = ["Company,Full Name,Title,Email,Phone,Comments"]
    .concat(notes.map((n, i) => [`C${i}`, `P V${i}`, "IT Director", `p${i}@x${i}.com`, "312-555-0100", n].map(q).join(","))).join("\n");
  const by = new Map(scanParsedFiles([parseCSVText("t.csv", csv)]).results.map((x) => [x.id, x]));
  return notes.map((_, i) => by.get(`0-${i}`) as ResultRow);
}
const why = (n: string) => { const r = scan([n])[0]; return r ? topPriorityReason(r) : "NO ROW"; };

console.log("\n== a real Google Workspace move is pinned ==");
for (const n of [
  "Currently on Google Workspace and want to move to Microsoft 365 for 80 users.",
  "Looking to migrate off Google this quarter.",
  "Evaluating Office 365 to replace G Suite across the business.",
  "Google to Microsoft migration, budget approved.",
]) ok(JSON.stringify(n.slice(0, 44)), why(n) === "google", String(why(n)));

console.log("\n== the WIDER migrations flag does NOT pin ==");
// These are all isGoogleToMicrosoft: true — they still show under the
// Google → Microsoft view tab, exactly as before. They are not Google.
for (const n of [
  "Modernizing a legacy system and bringing in a partner this year.",
  "Lift and shift our on-prem servers to Azure with a partner.",
]) {
  const r = scan([n])[0];
  ok(`still in the migrations tab: ${JSON.stringify(n.slice(0, 36))}`, !!r?.isGoogleToMicrosoft, JSON.stringify(r?.isGoogleToMicrosoft));
  ok(`but not pinned as Google: ${JSON.stringify(n.slice(0, 36))}`, !r?.isGoogleWorkspaceMigration, JSON.stringify(topPriorityReason(r)));
}

console.log("\n== shopping for a partner is pinned ==");
for (const n of [
  "Want to bring in an MSP for ongoing IT support.",
  "Interested in co-managed IT alongside our internal team.",
  "Need a CSP to route our Azure billing through.",
  "Looking to hire a consultant to run the Business Central rollout.",
]) ok(JSON.stringify(n.slice(0, 44)), why(n) === "partner", String(why(n)));

// The boundary, measured and deliberate rather than an oversight. Partner
// language is a GATE — it decides whether other patterns count — but it
// creates no category hit of its own, so a note that says nothing except
// that they want a partner never becomes a row and therefore cannot be
// pinned. ONGOING_PARTNER_SRC ("MSP", "co-managed IT", "ongoing IT
// support", "partner engagement", "outsourced IT") IS part of the Tenant
// Support pattern and does qualify, which is why the block above passes.
// Widening this would change what counts as a lead in the Main Scanner —
// a product decision for Jack, not a bug fix. See the session notes.
console.log("\n== partner language alone does not create a lead (known boundary) ==");
for (const n of [
  "Looking for a Microsoft partner.",
  "Need an implementation partner for this project.",
  "Want to work with a reseller going forward.",
]) ok(`no row, so nothing to pin: ${JSON.stringify(n.slice(0, 34))}`, why(n) === "NO ROW", String(why(n)));
ok("but the same ask with any product named does qualify and pin",
   why("Looking for a Microsoft partner for our Azure migration.") === "partner",
   String(why("Looking for a Microsoft partner for our Azure migration.")));

console.log("\n== neither signal, no pin ==");
for (const n of [
  "Renewing 40 Microsoft 365 E3 licenses next month.",
  "Interested in Dynamics 365 Business Central for 25 users.",
]) ok(JSON.stringify(n.slice(0, 44)), why(n) === null, String(why(n)));

console.log("\n== both signals reads as the rarer one ==");
ok("Google wins over partner",
   why("On Google Workspace, moving to Microsoft 365, and looking for a partner to run it.") === "google",
   String(why("On Google Workspace, moving to Microsoft 365, and looking for a partner to run it.")));

console.log("\n== a pin changes ORDER ONLY, never where a lead files ==");
const NOTES = [
  "Interested in Dynamics 365 Business Central for 25 users.",                 // 0 unpinned, dynamics
  "Want to bring in an MSP for ongoing IT support.",                           // 1 partner, m365
  "Renewing 40 Microsoft 365 E3 licenses next month.",                         // 2 unpinned, m365
  "Currently on Google Workspace and want to move to Microsoft 365, 80 seats.",// 3 google, m365
];
const rows = scan(NOTES);
ok("every row scanned", rows.every(Boolean), JSON.stringify(rows.map((r) => !!r)));
const before = rows.map((r) => `${r.category}/${r.tier}`);
const sorted = sortTopPriorityFirst(rows);
ok("pinned first, Google above partner",
   sorted.map((r) => topPriorityReason(r)).join(",") === "google,partner,,",
   sorted.map((r) => topPriorityReason(r) ?? "-").join(","));
ok("unpinned keep their original relative order",
   sorted.filter((r) => !topPriorityReason(r)).map((r) => r.id).join(",") === "0-0,0-2",
   sorted.filter((r) => !topPriorityReason(r)).map((r) => r.id).join(","));
ok("category and tier untouched by sorting",
   rows.map((r) => `${r.category}/${r.tier}`).join("|") === before.join("|"));
ok("a pinned lead stays in its own bucket, not a new one",
   CATEGORY_META[rows[3].category].bucket === CATEGORY_META[rows[2].category].bucket,
   `${rows[3].category} vs ${rows[2].category}`);

console.log("\n== the download leads with the pinned rows ==");
const m365 = exportRowsForBucket(rows, "m365Tenant");
ok("same leads as before, just reordered", m365.length === 3, String(m365.length));
ok("Google migration is the first row of the CSV", /C3/.test(String(m365[0]["Company Name"])), String(m365[0]["Company Name"]));
ok("partner-seeker is second", /C1/.test(String(m365[1]["Company Name"])), String(m365[1]["Company Name"]));
const dyn = exportRowsForBucket(rows, "dynamics");
ok("the Dynamics file is untouched", dyn.length === 1 && /C0/.test(String(dyn[0]["Company Name"])), JSON.stringify(dyn.map((d) => d["Company Name"])));

console.log("\n== a filed Library row ranks exactly as it did in the Scanner ==");
type S = { __isGoogleWorkspaceMigration?: boolean; __isPartnerSeeking?: boolean; n: string };
const stored = [
  { n: "plain" },
  { n: "partner", __isPartnerSeeking: true },
  { n: "legacy" },                                    // filed before the flags existed
  { n: "google", __isGoogleWorkspaceMigration: true },
] as S[];
const ranked = sortStoredTopPriorityFirst(stored as never) as unknown as S[];
ok("same order rule as the Scanner", ranked.map((r) => r.n).join(",") === "google,partner,plain,legacy", ranked.map((r) => r.n).join(","));
ok("a row filed before the flags existed is simply unpinned",
   storedTopPriorityReason({ n: "legacy" } as never) === null);
ok("and the stored reason matches the live one",
   storedTopPriorityReason(stored[3] as never) === "google" && storedTopPriorityReason(stored[1] as never) === "partner");


// Per Jack: "where is the google to microsoft tab under m365azure i want it
// to be more specific for those migrations." The tab was filtering on the
// WIDE flag, so a tab named after Google was mostly generic modernization
// and Azure lift-and-shift. Now four tabs, and they are exclusive.
console.log("\n== M365 / Azure View tabs: Google is Google, migrations are their own ==");
const TABS: [string, string][] = [
  ["Currently on Google Workspace and want to move to Microsoft 365 for 80 users.", "google"],
  ["Looking to migrate off Google this quarter.", "google"],
  ["Modernizing a legacy system and bringing in a partner this year.", "migration"],
  ["Lift and shift our on-prem servers to Azure with a partner.", "migration"],
  ["Renewing 40 Microsoft 365 E3 licenses next month.", "other"],
  ["Need a CSP to route our Azure billing through.", "other"],
];
const tabRows = scan(TABS.map(([n]) => n));
TABS.forEach(([n, want], i) => {
  const got = tabRows[i] ? m365SubViewOf(tabRows[i]) : "NO ROW";
  ok(`${want.padEnd(9)} <- ${JSON.stringify(n.slice(0, 40))}`, got === want, String(got));
});
ok("every lead lands in exactly one tab",
   tabRows.filter(Boolean).every((r) => M365_SUB_VIEWS.filter((k) => m365SubViewOf(r) === k).length === 1));
ok("the three tabs cover every lead", tabRows.filter(Boolean).every((r) => M365_SUB_VIEWS.includes(m365SubViewOf(r))));

console.log("\n== the Lead Library puts a filed lead in the same tab ==");
ok("a filed Google move", storedM365SubView({ __isGoogleWorkspaceMigration: true, __isGoogleToMicrosoft: true } as never) === "google");
ok("a filed generic migration", storedM365SubView({ __isGoogleToMicrosoft: true } as never) === "migration");
ok("a filed licensing lead", storedM365SubView({} as never) === "other");
// A row filed before the narrow flag existed reads as a migration rather
// than vanishing - honest, since the narrow flag was never recorded for it.
ok("a pre-existing filed row still lands in exactly one tab",
   storedM365SubView({ __isGoogleToMicrosoft: true, __isGoogleWorkspaceMigration: undefined } as never) === "migration");

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
