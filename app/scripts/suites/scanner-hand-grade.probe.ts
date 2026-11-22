// Per Jack, 11/22: he moved 80 Dynamics leads from Needs Review to Strong
// Signal in the Main Scanner, saved, and All leads still had them as Needs
// Review: the save read the scanner's own band, not the moved grade.
import { scanParsedFiles } from "../../src/lib/detection";
import { leadInputsFromResults } from "../../src/lib/leadFiling";
import { mergeLeads, keepHandGrade } from "../../src/lib/leadStore";
import { verdictOf } from "../../src/lib/leadStatus";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };
const fields = ["First Name", "Last Name", "Company", "Email", "Comments"];
const rows = [
  { "First Name": "Ann", "Last Name": "Bee", Company: "Alpha Co", Email: "ann@alphaco.com", Comments: "They mentioned help desk support once." },
  { "First Name": "Cal", "Last Name": "Dee", Company: "Beta Co", Email: "cal@betaco.com", Comments: "Evaluating Dynamics 365 Business Central for 40 users, want a demo." },
];
const out = scanParsedFiles([{ name: "Book11-8.csv", fields, data: rows }]);
const review = out.results.find((r) => r.row.__f.company === "Alpha Co")!;
const strong = out.results.find((r) => r.row.__f.company === "Beta Co")!;
ok("fixture: Alpha is Needs Review, Beta Strong Signal", review?.tier === "mention" && strong?.tier === "signal", `${review?.tier} ${strong?.tier}`);
const before = mergeLeads([], leadInputsFromResults(out.results)).leads;
ok("unmoved: grades save as the scanner said", verdictOf(before.find((l) => l.company === "Alpha Co")!.tier) === "review" && verdictOf(before.find((l) => l.company === "Beta Co")!.tier) === "strong");
ok("unmoved: no hand grade recorded", before.every((l) => !l.gradeOverride));
review.tier = "signal"; strong.tier = "dq";
const saved = mergeLeads([], leadInputsFromResults(out.results)).leads;
const a = saved.find((l) => l.company === "Alpha Co")!, b = saved.find((l) => l.company === "Beta Co")!;
ok("moved up in the scanner: saved as Strong Signal", verdictOf(a.tier) === "strong", a.tier);
ok("  recorded as a hand move, scanner's grade kept as 'was'", a.gradeOverride?.grade === "Strong Signal" && verdictOf(a.gradeOverride!.was) === "review", JSON.stringify(a.gradeOverride));
ok("moved down in the scanner: saved as Bad Lead", verdictOf(b.tier) === "bad", b.tier);
// A later automatic re-grade (re-upload, note refresh) keeps the hand move.
const reup = mergeLeads(saved, leadInputsFromResults(scanParsedFiles([{ name: "Book11-17.csv", fields, data: rows }]).results)).leads;
ok("a re-upload with the scanner's grade keeps the hand move", verdictOf(reup.find((l) => l.company === "Alpha Co")!.tier) === "strong");
ok("keepHandGrade still applies", verdictOf(keepHandGrade(a, { ...a, tier: "Medium priority" }).tier) === "strong");
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
