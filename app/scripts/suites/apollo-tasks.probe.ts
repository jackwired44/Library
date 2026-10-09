// Apollo task feed -> sync file -> All leads. Per Jack: "see when a lead is
// added and when a task is completed in a sequence."
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseCSVText } from "../../src/lib/csv";
import { parseApolloSync, applyApolloSync, parseTaskCell, parseSequenceCell } from "../../src/lib/apolloSync";
import type { StoredLead } from "../../src/lib/leadStore";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };

const dir = mkdtempSync(join(tmpdir(), "at-"));
const T = (id: string, cid: string, name: string, seq: string, step: number, type: string, st: string, at: string) =>
  [id, cid, name, "s" + seq.length, seq, String(step), type, st, at].join("\t");
const tsv = [
  T("t1", "c1", "Dana Diaz", "Jack Main Sequence", 1, "call", "completed", "2026-09-01"),
  T("t2", "c1", "Dana Diaz", "Jack Main Sequence", 3, "call", "completed", "2026-09-03"),
  T("t3", "c1", "Dana Diaz", "Jack Main Sequence", 5, "call", "scheduled", "2026-10-10"),
  T("t4", "c1", "Dana Diaz", "Carly Main Sequence", 1, "call", "skipped", "2026-07-01"),
  T("t4", "c1", "Dana Diaz", "Carly Main Sequence", 1, "call", "skipped", "2026-07-01"), // duplicate task id
  T("t5", "c2", "Lee Park", "Carly (Azure, Fabric + Power Bi)", 6, "linkedin_step_message", "completed", "2026-08-05"),
  T("t6", "c3", "Sam Fox", "Jack Main Sequence", 1, "call", "completed", "2026-09-02"),
  "garbage line",
].join("\n");
const inF = join(dir, "in.tsv"); const outF = join(dir, "out.csv");
writeFileSync(inF, tsv);
const summary = JSON.parse(execFileSync("node", ["scripts/apollo-tasks-to-sync.cjs", outF, inF]).toString());
ok("converter: dedupes task ids", summary.duplicateTasks === 1, JSON.stringify(summary));
ok("converter: counts a bad line, never invents a row", summary.badLines === 1);
ok("converter: one row per person", summary.people === 3);

const parsed = parseCSVText("out.csv", readFileSync(outF, "utf8"));
const { rows, unmapped, skipped } = parseApolloSync([parsed as never]);
ok("sync: every row read", rows.length === 3 && skipped === 0, `rows ${rows.length} skipped ${skipped}`);
ok("sync: only the contact id column is unmapped", unmapped.length === 1 && /contact id/i.test(unmapped[0]), unmapped.join("|"));
const dana = rows.find((r) => r.contact === "Dana Diaz")!;
const jm = dana.sequences.find((s) => s.name === "Jack Main Sequence")!;
ok("active sequence: open task -> active", jm.status === "active");
ok("active sequence: step is the next due task", jm.step === 5);
ok("added = first task's due date", jm.addedAt === "2026-09-01");
ok("last done = newest COMPLETED task", jm.lastDoneAt === "2026-09-03");
const cm = dana.sequences.find((s) => s.name === "Carly Main Sequence")!;
ok("no open task -> finished", cm.status === "finished");
ok("finished with nothing completed has no last-done date", cm.lastDoneAt === undefined);
ok("calls = completed call tasks only", dana.callCount === 2, String(dana.callCount));
ok("tasks newest first", dana.tasks![0].at === "2026-10-10" && dana.tasks![0].status === "scheduled");
ok("tasks carry sequence + step", dana.tasks![0].sequence === "Jack Main Sequence" && dana.tasks![0].step === 5);
ok("a sequence name with commas and a plus survives", rows.some((r) => r.sequences.some((s) => s.name === "Carly (Azure, Fabric + Power Bi)")));

// Cell parsers on their own.
ok("sequence cell: dates optional", parseSequenceCell("A:active:2")[0].addedAt === undefined);
ok("sequence cell: a non-date is never stored", parseSequenceCell("A:active:2:soon:2026-01-02")[0].addedAt === undefined);
ok("task cell: undated segment skipped", parseTaskCell("call completed @X; 2026-01-02 call completed").length === 1);

// Matching on name alone.
const lead = (key: string, contact: string, company: string, extra: Partial<StoredLead> = {}): StoredLead => ({
  key, source: "main", company, contact, title: "", email: "", phone: "", mobilePhone: "", productArea: "",
  tier: "Strong Signal", notes: "", score: 50, firstSeenAt: "2026-09-01", lastSeenAt: "2026-09-01",
  sourceFiles: ["f.csv"], timesSeen: 1, ...extra,
});
const prior = { syncedAt: "2026-09-01", sequences: [], callCount: 9, emailCount: 4,
  outcomes: { "No Answer": 8, "Meeting Booked": 1 }, lastOutcome: "Meeting Booked", lastCallAt: "2026-08-30",
  history: [{ at: "2026-08-30", outcome: "Meeting Booked" }] };
const leads = [
  lead("e:dana@x.com", "Dana Diaz", "Diaz Co", { email: "dana@x.com", apollo: prior }),
  lead("e:sam1@a.com", "Sam Fox", "A Co", { email: "sam1@a.com" }),
  lead("e:sam2@b.com", "Sam Fox", "B Co", { email: "sam2@b.com" }),
];
const res = applyApolloSync(leads, rows);
ok("unique full name matches", res.matchedByName === 1 && res.matched === 1, JSON.stringify({ m: res.matched, n: res.matchedByName }));
ok("a name shared by two leads is never guessed", res.ambiguous === 1);
ok("unknown name stays unmatched", res.unmatched.length === 2);
const d2 = res.leads.find((l) => l.key === "e:dana@x.com")!.apollo!;
ok("task sync replaces sequences", d2.sequences.length === 2);
ok("task sync keeps prior outcomes (absent is not zero)", d2.outcomes["Meeting Booked"] === 1);
ok("task sync keeps prior email count", d2.emailCount === 4);
ok("task sync keeps prior call history", d2.history?.length === 1);
ok("call count never drops below the real call log", d2.callCount === 9);
ok("tasks stored", d2.tasks?.length === 4);
// A one-word name is too weak to match on.
const res2 = applyApolloSync([lead("e:c@c.com", "Cher", "C Co", { email: "c@c.com" })],
  [{ email: "", contact: "Cher", company: "", sequences: [], callCount: 0, outcomes: {}, lastOutcome: "", lastCallAt: "" }]);
ok("single-word name never matches", res2.matched === 0);

console.log(`apollo-tasks ${fail ? "FAIL" : "PASS"} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
