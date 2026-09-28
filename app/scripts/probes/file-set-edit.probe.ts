// Adding/removing a file post-scan re-scans the batch.
//
// Two things have to hold, and they are the reason this is a re-scan
// rather than a filter over `sourceFile`:
//   1. A lead merged away as a duplicate against a file you then DROP has
//      to come back. Filtering would make it disappear entirely.
//   2. Manual per-row work carries across, keyed on name + company.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles, carryRowEdits, countUncarryableEdits, type ResultRow } from "../../src/lib/detection";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const csv = (rows: [string, string, string][]) =>
  ["Company,Full Name,Title,Email,Phone,Comments"]
    .concat(rows.map(([co, name, note], i) =>
      [co, name, "IT Director", `p${i}@${co.replace(/\W/g, "")}.com`, "312-555-0100", note].map(q).join(","))).join("\n");

const NOTE = "Looking at Dynamics 365 Business Central for 40 users.";
const OTHER = "Moving off Google Workspace to Microsoft 365 for 80 staff.";
// Dana Ross at Acme is in BOTH files — file A wins, file B's copy is merged away.
const fileA = () => parseCSVText("a.csv", csv([["Acme Co", "Dana Ross", NOTE], ["Borden Ltd", "Sam Vale", OTHER]]));
const fileB = () => parseCSVText("b.csv", csv([["Acme Co", "Dana Ross", NOTE], ["Crane Inc", "Jo Park", OTHER]]));

console.log("\n== the setup really does merge a cross-file duplicate ==");
const both = scanParsedFiles([fileA(), fileB()]);
ok("3 rows survive, not 4", both.results.length === 3, String(both.results.length));
ok("one duplicate was merged", both.duplicatesRemoved === 1, String(both.duplicatesRemoved));
const danaBoth = both.results.filter((r) => /Dana Ross/.test(r.row.__f.fullName || ""));
ok("only one Dana Ross row", danaBoth.length === 1, String(danaBoth.length));
ok("the surviving Dana came from file a.csv", danaBoth[0]?.sourceFile === "a.csv", danaBoth[0]?.sourceFile);

console.log("\n== dropping the file the duplicate was merged INTO brings it back ==");
// This is the case a sourceFile filter gets wrong: filtering out a.csv's
// rows would leave b.csv's Dana already merged away, so she would vanish.
const afterDrop = scanParsedFiles([fileB()]);
const danaAfter = afterDrop.results.filter((r) => /Dana Ross/.test(r.row.__f.fullName || ""));
ok("Dana Ross is still present after dropping a.csv", danaAfter.length === 1, String(danaAfter.length));
ok("...and now comes from b.csv", danaAfter[0]?.sourceFile === "b.csv", danaAfter[0]?.sourceFile);
ok("no duplicates left to merge", afterDrop.duplicatesRemoved === 0, String(afterDrop.duplicatesRemoved));
const filtered = both.results.filter((r) => r.sourceFile !== "a.csv");
ok("a sourceFile FILTER would have lost her (why this is a re-scan)",
   !filtered.some((r) => /Dana Ross/.test(r.row.__f.fullName || "")), JSON.stringify(filtered.map((r) => r.row.__f.fullName)));

console.log("\n== manual work carries across a re-scan ==");
const before = scanParsedFiles([fileA(), fileB()]).results;
const dana = before.find((r) => /Dana Ross/.test(r.row.__f.fullName || ""))!;
const sam = before.find((r) => /Sam Vale/.test(r.row.__f.fullName || ""))!;
dana.disposition = "meeting-booked";
dana.dispositionNote = "booked for Tuesday";
dana.crossedOut = true;
dana.priority = true;
dana.priorityMonth = "2026-09";
sam.category = sam.category === "dynamics365" ? "m365Tenant" : "dynamics365";
sam.tier = "dq";
const freshRows = scanParsedFiles([fileB()]).results;
const carried = carryRowEdits(freshRows, before);
const dana2 = freshRows.find((r) => /Dana Ross/.test(r.row.__f.fullName || ""))!;
ok("disposition carried", dana2.disposition === "meeting-booked", dana2.disposition);
ok("disposition note carried", dana2.dispositionNote === "booked for Tuesday", dana2.dispositionNote);
ok("cross-out carried", dana2.crossedOut === true);
ok("priority + its month carried", dana2.priority === true && dana2.priorityMonth === "2026-09", String(dana2.priorityMonth));
ok("carried count is reported", carried >= 1, String(carried));
// Sam was only in the dropped file, so he is gone — not silently wrong,
// just absent, and his edits go with him.
ok("a lead only in the dropped file is simply gone",
   !freshRows.some((r) => /Sam Vale/.test(r.row.__f.fullName || "")));

console.log("\n== the engine's own verdict still flows through ==");
const untouchedBefore = scanParsedFiles([fileA(), fileB()]).results;
const untouchedAfter = scanParsedFiles([fileA(), fileB()]).results;
carryRowEdits(untouchedAfter, untouchedBefore);
ok("carrying from an UNEDITED batch changes nothing",
   untouchedAfter.every((r, i) =>
     r.tier === untouchedBefore[i].tier &&
     r.category === untouchedBefore[i].category &&
     r.disposition === untouchedBefore[i].disposition &&
     r.crossedOut === untouchedBefore[i].crossedOut));
// A manual tier promotion outranks a re-derived one, deliberately. The
// fixture has to be a lead the engine does NOT already call Strong
// Signal, or the assertion passes without testing anything.
const weak = () => parseCSVText("w.csv", csv([["Delta Group", "Kim Ray", "We use Power BI across finance."]]));
const promoBefore = scanParsedFiles([weak()]).results;
const target = promoBefore.find((r) => /Kim Ray/.test(r.row.__f.fullName || ""))!;
const engineTier = target.tier;
ok("the fixture starts below Strong Signal, so the promotion is real", engineTier !== "signal", engineTier);
target.tier = "signal";
const promoAfter = scanParsedFiles([weak()]).results;
ok("a fresh scan of it still reads the engine's tier", promoAfter[0].tier === engineTier, promoAfter[0].tier);
carryRowEdits(promoAfter, promoBefore);
ok(`a hand-promoted tier wins over the engine's "${engineTier}"`, promoAfter[0].tier === "signal", promoAfter[0].tier);

console.log("\n== rows that cannot be keyed are counted, not silently dropped ==");
// No company name => no dupKey => nothing to match on.
const noKey = scanParsedFiles([parseCSVText("c.csv", csv([["", "Pat Lee", NOTE]]))]).results;
ok("an unkeyable row really has no dupKey", noKey.length > 0 && !noKey[0].dupKey, JSON.stringify(noKey[0]?.dupKey));
ok("with no edits on it, nothing is reported at risk", countUncarryableEdits(noKey) === 0, String(countUncarryableEdits(noKey)));
noKey[0].disposition = "not-interested";
ok("once edited, it is counted as at risk", countUncarryableEdits(noKey) === 1, String(countUncarryableEdits(noKey)));
const keyed: ResultRow[] = scanParsedFiles([fileA()]).results;
keyed[0].disposition = "not-interested";
ok("a keyable edited row is NOT counted at risk", countUncarryableEdits(keyed) === 0, String(countUncarryableEdits(keyed)));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
