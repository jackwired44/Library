// A seat count must come from the notes, never from a phone number.
//
// Per Jack, originally: "Service - Copilot Studio - 2 users. bad lead for
// main scanner." He has since refined that — "this is low anything like
// this is low, the only reason it could be worth engaging still if the
// company is large enough and a right industry but dont filter that here"
// — so a sub-threshold count now demotes to Low (`mention`) rather than
// disqualifying. The COUNT assertions below are the real subject of this
// file and are unchanged. Testing it surfaced why its
// neighbours did not: scanRowLicensing joins EVERY column into one string,
// so Phone and Email sit inside the +/-65 char window the count is read
// from, and bestCount takes Math.max over everything it finds. On one
// identical note ("Business Standard-2 users", true count 2) the phone
// alone decided the verdict:
//
//   312-555-0100 -> 100    Strong Signal
//   312-555-7777 -> 7777   Strong Signal
//
// A two-seat lead qualified because of the digits in its phone number.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
function scan(rows: { note: string; phone?: string; email?: string }[]) {
  const csv = ["Company,Full Name,Title,Email,Phone,Comments"]
    .concat(rows.map((r, i) => [`C${i}`, `P V${i}`, "IT Director",
      r.email ?? `p${i}@x${i}.com`, r.phone ?? "312-555-0100", r.note].map(q).join(","))).join("\n");
  const by = new Map((scanParsedFiles([parseCSVText("t.csv", csv)]).results as Record<string, unknown>[])
    .map((x) => [x.id as string, x]));
  return rows.map((_, i) => by.get(`0-${i}`) as never as { licensing?: { count: number | null }; tier: string } | undefined);
}

console.log("\n== the phone number cannot decide the seat count ==");
const NOTE = "Service-Microsoft 365 Business Standard-2 users";
const PHONES = ["312-555-0100", "312-555-0199", "312-555-7777", "212-555-0042", "(312) 555 0100 x9812", ""];
scan(PHONES.map((phone) => ({ note: NOTE, phone }))).forEach((row, i) => {
  ok(`phone ${PHONES[i] || "(none)"} still reads 2 seats`,
     !!row && row.licensing?.count === 2 && row.tier === "mention",
     `count=${row?.licensing?.count} tier=${row?.tier}`);
});

console.log("\n== nor can the email ==");
const EMAILS = ["ops2024@acme.com", "info500@acme.com", "a@b.co"];
scan(EMAILS.map((email) => ({ note: NOTE, email, phone: "" }))).forEach((row, i) => {
  ok(`email ${EMAILS[i]} still reads 2 seats`,
     !!row && row.licensing?.count === 2, `count=${row?.licensing?.count}`);
});

console.log("\n== real counts still extract, and still decide the tier ==");
const REAL: [string, number, string][] = [
  ["Service - Copilot Studio - 2 users", 2, "mention"],
  ["Service - Copilot Studio - 40 users", 40, "signal"],
  ["Service-Microsoft 365 Business Standard-50 users", 50, "signal"],
  ["Service - M365 Copilot - 2 users", 2, "mention"],
  ["Looking at E3 licensing for 40 users", 40, "signal"],
  ["Entra ID Plan 2, 300 seats", 300, "signal"],
  ["Microsoft 365 E5 x 25", 25, "signal"],
  ["Renewing 9 Business Premium licenses", 9, "mention"],
  ["Teams Phone for 12 people", 12, "signal"],
  // The case from CLAUDE.md's own notes: a number separated from its unit
  // by a product name must still read as the count, not as the SKU digits.
  ["Renewal for 348 Microsoft 365 G3 licenses", 348, "signal"],
];
scan(REAL.map(([note]) => ({ note }))).forEach((row, i) => {
  const [note, wantCount, wantTier] = REAL[i];
  ok(`${wantCount} seats, ${wantTier}: "${note.slice(0, 46)}"`,
     !!row && row.licensing?.count === wantCount && row.tier === wantTier,
     `count=${row?.licensing?.count} tier=${row?.tier}`);
});

// THE COUNT MUST NOT DEPEND ON SENTENCE ORDER.
//
// extractCountNear used a non-global `.match()`, so it saw only the
// LEFTMOST count in its +/-65 window. Two counts in one window therefore
// gave opposite verdicts depending purely on which sentence came first:
//
//   "Copilot Studio - 2 users. ...Copilot to 40 users."  -> 2  -> Needs Review
//   "...Copilot to 40 users. Copilot Studio - 2 users."  -> 40 -> Strong Signal
//
// Jack hit the second and reported it as "(50) High" on a 2-user row.
// The count is now the one written NEAREST its own product, so both
// orderings agree. If someone reverts that, these two fail as a pair.
console.log("\n== the count is order-independent ==");
const A = "Service - Copilot Studio - 2 users. Expanding Microsoft 365 Copilot to 40 users.";
const B = "Expanding Microsoft 365 Copilot to 40 users. Service - Copilot Studio - 2 users.";
const [rowA, rowB] = scan([{ note: A }, { note: B }]);
ok("small count written first  -> 40", rowA?.licensing?.count === 40, `got ${rowA?.licensing?.count}`);
ok("large count written first  -> 40", rowB?.licensing?.count === 40, `got ${rowB?.licensing?.count}`);
ok("both orderings agree on the tier", !!rowA && rowA.tier === rowB?.tier, `${rowA?.tier} vs ${rowB?.tier}`);

// AND THE SNIPPET MUST SHOW THE NUMBER THAT QUALIFIED THE ROW.
//
// Per Jack, three times: "the matched snippets are not good." A row that
// cleared the bar on 40 seats was still quoting "Service - Copilot Studio
// - 2 users." as its reason to call -- evidence for the opposite verdict.
console.log("\n== the snippet shows the qualifying count, never a smaller one ==");
[["order A", rowA], ["order B", rowB]].forEach(([label, r]: [any, any]) => {
  const snip = String(r?.notesSummary ?? "");
  ok(`${label}: snippet does not quote the 2-user sentence`,
     !/\b2\s*users?\b/i.test(snip), snip.slice(0, 90));
  ok(`${label}: snippet states the qualifying 40`, /\b40\b/.test(snip), snip.slice(0, 90));
});

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
