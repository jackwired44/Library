// Refresher — lib/refresher.ts. Per Jack: "create a refresher mechanism here
// under all leads that can auto generate lists that seem likely", then "this
// action checks the leads are fresh have not really gone anywhere or gone
// nowhere and are not in hubspot as a deal have not been info reuqested
// pending review or meeting booked", and "i will choose certain files to do
// this from and then you generate the list around strong signals but also
// company or eventually industry".
import { factsForLead, type RuleFacts } from "../../src/lib/smartRules";
import {
  buildSuggestions, defaultSequenceFor, draftFromKeywords, draftMatcher, inSequence, handoffStage, strongWithoutIndustry, blocked,
  REFRESH_CAP, COMPANY_MIN, type RefreshContext, type EmailReadiness,
} from "../../src/lib/refresher";
import type { StoredLead } from "../../src/lib/leadStore";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };

const TODAY = new Date("2026-10-21T12:00:00Z");
let seq = 0;
type Apollo = { outcomes?: Record<string, number>; sequences?: { name: string; status: string; reason?: string; addedAt?: string }[]; calls?: number; lastCallAt?: string };
const lead = (o: Partial<StoredLead> & { ap?: Apollo } = {}): StoredLead => {
  const n = ++seq;
  const { ap, ...rest } = o;
  return {
    key: `k${n}`, source: "main", company: `Co ${n}`, contact: `Person ${n}`, title: "CFO", email: `p${n}@co${n}.com`, phone: "", mobilePhone: "",
    productArea: "Dynamics 365", tier: "Strong Signal", notes: "(70) ▲ Wants Dynamics 365 Business Central (25 users).", score: 70,
    firstSeenAt: "2026-10-10T12:00:00Z", lastSeenAt: "2026-10-10T12:00:00Z", sourceFiles: ["Book10-10.csv"], timesSeen: 1, receivedOn: "2026-10-10",
    ...(ap ? { apollo: { syncedAt: "2026-10-19", sequences: (ap.sequences ?? []).map((s) => ({ step: null, ...s })), callCount: ap.calls ?? 0, emailCount: 0, outcomes: ap.outcomes ?? {}, lastOutcome: "", lastCallAt: ap.lastCallAt ?? "" } } : {}),
    ...rest,
  } as StoredLead;
};

interface Opts { industry?: Record<string, string>; engaged?: Set<string>; email?: Record<string, EmailReadiness>; live?: Set<string>; recycle?: Set<string> }
function context(leads: StoredLead[], o: Opts = {}): RefreshContext {
  const facts = new Map<string, RuleFacts>();
  for (const l of leads) facts.set(l.key, factsForLead(l, { industry: o.industry?.[l.key] ?? "", employees: null, hit: null, engaged: !!o.engaged?.has(l.key) }));
  return {
    leads, facts, today: TODAY,
    email: (l) => o.email?.[l.key] ?? "ready",
    onLiveCampaign: (l) => !!o.live?.has(l.key),
    recycleReady: (l) => !!o.recycle?.has(l.key),
  };
}
const get = (ctx: RefreshContext, id: string, g: "product" | "company" | "industry" = "product") => buildSuggestions(ctx, new Set(), g).find((s) => s.id === id);
const keys = (ls: StoredLead[]) => ls.map((l) => l.key).sort().join(",");

console.log("\n== fresh Strong Signal leads make a list ==");
const fresh = Array.from({ length: 6 }, () => lead());
let s = get(context(fresh), "fresh-dynamics");
ok("six untouched Dynamics leads → Fresh Dynamics 365", s?.ready.length === 6, JSON.stringify(s?.ready.length));
ok("fewer than five → no suggestion", !get(context(fresh.slice(0, 4)), "fresh-dynamics"));

console.log("\n== anything that went somewhere is left out ==");
const deal = lead();
const active = lead({ ap: { sequences: [{ name: "Jack Main Sequence", status: "active" }] } });
const infoReq = lead({ ap: { outcomes: { "Info Requested": 1 }, calls: 1 } });
const pending = lead({ ap: { sequences: [{ name: "Jack Main Sequence", status: "finished", reason: "Pending review" }] } });
const booked = lead({ ap: { outcomes: { "Meeting Booked": 1 }, calls: 1 } });
const replied = lead({ ap: { sequences: [{ name: "Carly Main Sequence", status: "finished", reason: "Replied" }] } });
const byHand = lead({ statusOverride: { status: "reached", at: "2026-10-15" } } as Partial<StoredLead>);
const notInt = lead({ ap: { outcomes: { "Not Interested": 1 }, calls: 1 } });
const onList = lead();
const all = [...fresh, deal, active, infoReq, pending, booked, replied, byHand, notInt, onList];
const ctx1 = context(all, { engaged: new Set([deal.key]), live: new Set([onList.key]) });
s = get(ctx1, "fresh-dynamics");
const got = new Set((s?.ready ?? []).map((l) => l.key));
ok("only the six fresh leads survive", s?.ready.length === 6, keys(s?.ready ?? []));
ok("  a HubSpot / Notion / Echo deal is out", !got.has(deal.key));
ok("  active in a sequence is out", !got.has(active.key));
ok("  info requested is out", !got.has(infoReq.key));
ok("  pending review is out", !got.has(pending.key));
ok("  meeting booked is out", !got.has(booked.key));
ok("  replied is out", !got.has(replied.key));
ok("  a status set by hand to reached is out", !got.has(byHand.key));
ok("  not interested is out", !got.has(notInt.key));
ok("  already on a live campaign list is out", !got.has(onList.key));
ok("reached is a fact: info requested", ctx1.facts.get(infoReq.key)!.reached === true);
ok("reached is a fact: pending review", ctx1.facts.get(pending.key)!.reached === true);
ok("a no-answer lead is not reached", factsForLead(lead({ ap: { outcomes: { "No Answer": 3 }, calls: 3 } }), { industry: "", employees: null, hit: null, engaged: false }).reached === false);
ok("blocked() covers deal, active, reached", blocked(ctx1.facts.get(deal.key)!) && blocked(ctx1.facts.get(active.key)!) && blocked(ctx1.facts.get(pending.key)!));

console.log("\n== went nowhere: recycle-ready ==");
const nowhere = Array.from({ length: 5 }, () => lead({ ap: { outcomes: { "No Answer": 3 }, calls: 3, lastCallAt: "2026-09-01" } }));
const ctxR = context(nowhere, { recycle: new Set(nowhere.map((l) => l.key)) });
ok("five recycle-ready leads → Recycle-ready", get(ctxR, "recycle")?.ready.length === 5);
const ctxR2 = context([...nowhere, infoReq], { recycle: new Set([...nowhere, infoReq].map((l) => l.key)) });
ok("a reached lead never recycles here, even if marked ready", get(ctxR2, "recycle")?.ready.length === 5);

console.log("\n== email readiness and the cap ==");
const many = Array.from({ length: 130 }, () => lead());
const email: Record<string, EmailReadiness> = {};
many.forEach((l, i) => { email[l.key] = i < 115 ? "ready" : i < 125 ? "unchecked" : "flagged"; });
s = get(context(many, { email }), "fresh-dynamics");
ok(`capped at ${REFRESH_CAP}`, s?.ready.length === REFRESH_CAP && s.readyTotal === 115, `${s?.ready.length}/${s?.readyTotal}`);
ok("unchecked kept apart for an Apollo check", s?.unchecked.length === 10);
ok("flagged counted, left for calling", s?.flagged === 5);
const scored = [lead({ score: 40 }), lead({ score: 90 }), lead({ score: 60 }), lead(), lead()];
s = get(context(scored), "fresh-dynamics");
ok("best score first", s?.ready[0].score === 90, String(s?.ready[0].score));

console.log("\n== picked files: the component scopes leads, the rules follow ==");
const fileA = Array.from({ length: 5 }, () => lead({ sourceFiles: ["A.csv"] }));
const fileB = Array.from({ length: 5 }, () => lead({ sourceFiles: ["B.csv"] }));
const scoped = [...fileA, ...fileB].filter((l) => l.sourceFiles.includes("A.csv"));
ok("only the picked file's leads are listed", keys(get(context(scoped), "fresh-dynamics")?.ready ?? []) === keys(fileA));

console.log("\n== by company ==");
const acme = [lead({ company: "Acme" }), lead({ company: "acme " }), lead({ company: "Acme", tier: "Needs Review" })];
const solo = lead({ company: "Solo Inc" });
const beta = [lead({ company: "Beta" }), lead({ company: "Beta", ap: { outcomes: { "Info Requested": 1 }, calls: 1 } })];
const went = [lead({ company: "Gamma" }), lead({ company: "Gamma", ap: { outcomes: { "No Answer": 3 }, calls: 3 } })];
const ctxC = context([...acme, solo, ...beta, ...went], { recycle: new Set([went[1].key]) });
const comp = buildSuggestions(ctxC, new Set(), "company");
const acmeS = comp.find((x) => x.id === "company-acme");
ok(`${COMPANY_MIN}+ Strong Signal people at one company → a company list`, acmeS?.ready.length === 2, JSON.stringify(acmeS?.ready.length));
ok("  company names match case and space blind; Needs Review left out", keys(acmeS?.ready ?? []) === keys(acme.slice(0, 2)));
ok("one person at a company → no company list", !comp.some((x) => x.id === "company-solo-inc"));
ok("a reached colleague does not count toward the company", !comp.some((x) => x.id === "company-beta"));
ok("a went-nowhere (recycle-ready) colleague does count", comp.find((x) => x.id === "company-gamma")?.ready.length === 2);
ok("company mode shows only company lists", comp.every((x) => x.id.startsWith("company-")));
ok("product mode shows no company lists", !buildSuggestions(ctxC).some((x) => x.id.startsWith("company-")));

console.log("\n== by industry (enriched data only) ==");
const mfg = Array.from({ length: 5 }, () => lead());
const bare = Array.from({ length: 3 }, () => lead());
const ind: Record<string, string> = {};
mfg.forEach((l) => { ind[l.key] = "Manufacturing"; });
const ctxI = context([...mfg, ...bare], { industry: ind });
const indS = buildSuggestions(ctxI, new Set(), "industry");
ok("five fresh Strong Signal leads in an industry → an industry list", indS.find((x) => x.id === "industry-manufacturing")?.ready.length === 5);
ok("no industry → no made-up list", indS.length === 1);
ok("leads without an industry are counted for enriching", strongWithoutIndustry(ctxI) === 3);

console.log("\n== sequence and hand-off ==");
const seqs = ["Jack Main Sequence", "Carly Main Sequence Recycled", "Dynamics Sequence"];
ok("Dynamics → Dynamics Sequence", defaultSequenceFor({ id: "fresh-dynamics", product: "dynamics" }, seqs) === "Dynamics Sequence");
ok("recycle → a recycled sequence", defaultSequenceFor({ id: "recycle", product: null }, seqs) === "Carly Main Sequence Recycled");
ok("M365 → Jack Main Sequence", defaultSequenceFor({ id: "fresh-m365", product: "m365" }, seqs) === "Jack Main Sequence");
ok("the last pick wins", defaultSequenceFor({ id: "fresh-m365", product: "m365" }, seqs, "Dynamics Sequence") === "Dynamics Sequence");
const inSeq = lead({ ap: { sequences: [{ name: "Jack Main Sequence", status: "active" }] } });
ok("in sequence when a check shows it there", inSequence(inSeq, "jack main sequence", null));
ok("not in another sequence", !inSequence(inSeq, "Dynamics Sequence", null));
ok("stages", handoffStage(0, 5) === "downloaded" && handoffStage(2, 5) === "partly" && handoffStage(5, 5) === "in-sequence");

console.log("\n== draft from keywords ==");
const ctl = lead({ title: "Controller", company: "Northwind" });
const cfoMfg = lead({ title: "CFO", company: "Ironworks" });
const itDir = lead({ title: "IT Director", company: "Plain Co" });
const bcNote = lead({ title: "Owner", notes: "(70) ▲ Moving off QuickBooks to Business Central." });
const reviewCtl = lead({ title: "Controller", tier: "Needs Review" });
const reachedCtl = lead({ title: "Controller", ap: { outcomes: { "Info Requested": 1 }, calls: 1 } });
const dctx = context([ctl, cfoMfg, itDir, bcNote, reviewCtl, reachedCtl], { industry: { [cfoMfg.key]: "Machinery Manufacturing" } });
let d = draftFromKeywords(dctx, "controller");
ok("a title word finds the Strong Signal controller", keys(d?.ready ?? []) === keys([ctl]), keys(d?.ready ?? []));
ok("  Needs Review left out by default, a reached one always", !d?.ready.some((l) => l.key === reviewCtl.key || l.key === reachedCtl.key));
d = draftFromKeywords(dctx, "controller", "all", false);
ok("  'Strong Signal only' off brings Needs Review in", keys(d?.ready ?? []) === keys([ctl, reviewCtl]));
d = draftFromKeywords(dctx, "controller, manufacturing");
ok("commas mean any of these (title or enriched industry)", keys(d?.ready ?? []) === keys([ctl, cfoMfg]), keys(d?.ready ?? []));
d = draftFromKeywords(dctx, '"off quickbooks"');
ok("an exact phrase finds it in the note", keys(d?.ready ?? []) === keys([bcNote]));
d = draftFromKeywords(dctx, "manufacturing", "title");
ok("limited to Title, an industry word finds nothing", d?.ready.length === 0);
d = draftFromKeywords(dctx, "director -plain");
ok("-word leaves out", d?.ready.length === 0);
ok("blank or only commas → no draft", draftFromKeywords(dctx, " , ") === null && draftMatcher("") === null);
ok("no minimum size: one match is still a draft", draftFromKeywords(dctx, "northwind")?.ready.length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
