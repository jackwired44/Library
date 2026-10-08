// The Apollo sequence funnel import, against the real 16-sequence snapshot.
import { readFileSync } from "node:fs";
import { parseCSVText } from "../../src/lib/csv";
import { parseFunnelCSV, rollUpSequences, realSteps, stepsInSequence } from "../../src/lib/apolloFunnel";
import type { StoredLead } from "../../src/lib/leadStore";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };

const text = readFileSync(`${process.cwd()}/../apollo-sequences-2026-10-08.csv`, "utf8");
const { funnels, unmapped, skipped } = parseFunnelCSV([parseCSVText("snap.csv", text) as any]);
const by = new Map(funnels.map((f) => [f.name, f]));

ok("16 sequences", funnels.length === 16, String(funnels.length));
ok("no unmapped columns", unmapped.length === 0, unmapped.join(","));
ok("nothing skipped", skipped === 0, String(skipped));
ok("Russell's Wired sequence present", by.has("Email only campaign - Wired"));
ok("both Carly sequences present", by.has("Carly Main Sequence") && by.has("Carly Main Sequence Recycled"));

// Steps vs summary: the summary row must never become a step.
const jm = by.get("Jack Main Sequence")!;
ok("Jack Main has 6 real steps", realSteps(jm).length === 6);
ok("no position-0 step stored", funnels.every((f) => f.steps.every((s) => s.position > 0)));
ok("stepsInSequence reads 6", stepsInSequence(funnels, "Jack Main Sequence") === 6);
ok("step 5 is where Jack Main dies", realSteps(jm)[4].finished === 416);
ok("Jack Main live", jm.live === true);
ok("AI Outreach off", by.get("AI Outreach")!.live === false);

// "loading" is unknown, not zero.
ok("loading calls read as null", realSteps(jm)[2].callsCompleted === null);
ok("real calls read as numbers", realSteps(jm)[0].callsCompleted === 1020);

// Summary totals: blank is unknown, not zero.
const ew = by.get("Email only campaign - Wired")!;
ok("summary-only sequence has no steps", ew.steps.length === 0);
ok("delivered carried", ew.totals?.delivered === 719);
ok("finished UNKNOWN, not 0", ew.totals?.finished === null);
ok("on-sequence UNKNOWN, not 0", ew.totals?.onSequence === null);
ok("active+paused combined", jm.totals?.onSequence === 171);
ok("paused-only sequence counts as on sequence",
   by.get("Signal-based targeting: Job postings")!.totals?.onSequence === 1308);

// The rollup.
const rows = rollUpSequences([], funnels);
const r = (n: string) => rows.find((x) => x.name === n)!;
ok("rollup finished stays null when unknown", r("Email only campaign - Wired").apolloFinished === null);
ok("rollup delivered from totals", r("Email only campaign - Wired").apolloDelivered === 719);
ok("live sequences sort first", rows.slice(0, 6).every((x) => x.funnel?.live === true),
   rows.slice(0, 6).map((x) => x.name).join(" | "));
ok("a sequence created today with no traffic sorts below a live one",
   rows.findIndex((x) => x.name === "Church IT Leaders - Megachurch Outbound") > rows.findIndex((x) => x.name === "CSP Leads"));

// The join to held leads.
const lead = (key: string, seq: string, status: string, step: number | null): StoredLead => ({
  key, source: "main", company: "C", contact: "N", title: "", email: key, phone: "", mobilePhone: "",
  productArea: "", tier: "", notes: "", score: null, firstSeenAt: "", lastSeenAt: "", sourceFiles: [], timesSeen: 1,
  apollo: { syncedAt: "", sequences: [{ name: seq, status, step }], callCount: 0, outcomes: {}, lastOutcome: "", lastCallAt: "" },
});
const rows2 = rollUpSequences([
  lead("a", "Jack Main Sequence", "finished", 5),
  lead("b", "Jack Main Sequence", "active", 2),
  lead("c", "Jack Main Sequence", "finished", null),
], funnels);
const j2 = rows2.find((x) => x.name === "Jack Main Sequence")!;
ok("held count", j2.held === 3);
ok("held active/finished split", j2.heldActive === 1 && j2.heldFinished === 2);
ok("held lead placed at its step", j2.heldByStep.get(5) === 1);
ok("stepless lead NOT assigned to step 1", j2.heldByStep.get(1) === undefined && j2.heldByStep.get(0) === 1);
ok("held leads sort that sequence to the top", rows2[0].name === "Jack Main Sequence");

console.log(`apollo-funnel ${fail ? "FAIL" : "PASS"} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
