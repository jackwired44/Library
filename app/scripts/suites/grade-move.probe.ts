// Per Jack: "in all leads i want to be able to move needs review to strong
// signal or bad lead". A hand-moved grade sticks through a re-upload, the
// note refresh and requalify, and "back to scanner's grade" restores it.
import { mergeLeads, moveGrade, clearGrade, keepHandGrade, gradeOfTier, newestNote, type StoredLead, type LeadInput } from "../../src/lib/leadStore";
import { verdictOf } from "../../src/lib/leadStatus";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };

const input = (over: Partial<LeadInput> = {}): LeadInput => ({
  source: "main", company: "Acme Co", contact: "Dana Lee", title: "CFO", email: "dana@acme.com",
  phone: "", mobilePhone: "", productArea: "Dynamics 365", tier: "Needs Review",
  notes: "(30) ▸ Wants Dynamics 365 Business Central. Ask what they run today.", score: 30,
  sourceFile: "Book8-20.csv", ...over,
} as LeadInput);
const T0 = "2026-11-05T15:00:00.000Z";
const lead: StoredLead = mergeLeads([], [input()], T0).leads[0];
ok("starts as Needs Review", verdictOf(lead.tier) === "review");

// --- move up
const up = moveGrade(lead, "Strong Signal", T0);
ok("moved to Strong Signal", up.tier === "Strong Signal" && verdictOf(up.tier) === "strong");
ok("records the scanner's grade", up.gradeOverride?.was === "Needs Review");
ok("note mark becomes ▲, score kept", newestNote(up.notes).startsWith("(30) ▲ Wants"), newestNote(up.notes));
ok("note text otherwise unchanged", newestNote(up.notes).slice(7) === newestNote(lead.notes).slice(7));
ok("score unchanged", up.score === 30);

// --- survives a re-upload that grades it Needs Review again
const re = mergeLeads([up], [input({ sourceFile: "Book9-10.csv", notes: "(32) ▸ Wants Dynamics 365 Business Central for 20 users. Ask what they run today.", score: 32 })], "2026-11-06T15:00:00.000Z");
const r1 = re.leads[0];
ok("re-upload keeps the hand grade", r1.tier === "Strong Signal", r1.tier);
ok("re-upload's new note carries the hand mark", newestNote(r1.notes).startsWith("(32) ▲"), newestNote(r1.notes));
ok("scanner's grade still recorded", r1.gradeOverride?.was === "Needs Review");
ok("score follows the scan", r1.score === 32);

// --- the scanner later grades it Bad: undo returns to THAT
const re2 = mergeLeads([r1], [input({ sourceFile: "Book9-30.csv", tier: "Bad Lead", notes: "(10) ✕ Not interested.", score: 10 })], "2026-11-07T15:00:00.000Z").leads[0];
ok("still Strong after a scan that says Bad", re2.tier === "Strong Signal");
ok("was updates to the newest scan", re2.gradeOverride?.was === "Bad Lead");
const back = clearGrade(re2);
ok("back to scanner's grade = Bad Lead", back.tier === "Bad Lead" && !back.gradeOverride);
ok("its mark comes back too", newestNote(back.notes).startsWith("(10) ✕"), newestNote(back.notes));

// --- move down with a reason
const down = moveGrade(lead, "Bad Lead", T0, "Already a customer");
ok("moved to Bad Lead with reason", down.tier === "Bad Lead" && down.gradeOverride?.reason === "Already a customer");
ok("mark ✕", newestNote(down.notes).startsWith("(30) ✕"));

// --- moving to the scanner's own grade clears instead of pinning
ok("moving back to the scanner's grade clears", !moveGrade(up, "Needs Review", T0).gradeOverride);
ok("moving an untouched lead to its own grade is a no-op", moveGrade(lead, "Needs Review", T0) === lead || !moveGrade(lead, "Needs Review", T0).gradeOverride);
ok("CSP High priority counts as Strong Signal", gradeOfTier("High priority") === "Strong Signal");
const csp = { ...lead, source: "csp" as const, tier: "High priority" };
ok("CSP High priority to Strong Signal pins nothing", !moveGrade(csp, "Strong Signal", T0).gradeOverride);

// --- automatic requalify (company data) can't override it
const auto = keepHandGrade(up, { ...up, tier: "Bad Lead", notFit: "Competitor" });
ok("requalify keeps the hand grade", auto.tier === "Strong Signal" && auto.gradeOverride?.was === "Bad Lead");

// --- a lead with no override is untouched by keepHandGrade
const plain = { ...lead, tier: "Bad Lead" };
ok("no override: keepHandGrade passes the change through", keepHandGrade(lead, plain) === plain);

// --- a note with no mark is left alone
const bare = { ...lead, notes: "2026-11-05 · Just some text" };
ok("unmarked note is not given a mark", moveGrade(bare, "Strong Signal", T0).notes === bare.notes);

console.log(`${pass} / ${pass + fail}`);
if (fail) process.exit(1);
