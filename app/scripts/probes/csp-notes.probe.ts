// The CSP Notes line, rewritten for a rep who is about to dial.
//
// Per Jack, against a real row he pasted back: "too much", and "our rep is
// just calling the lead and talking they dont need super detailed
// specifics". Measured on his 9,265-row file the old line ran a median of
// 150 characters and a p90 of 315, and 30% of all that text was the
// seller's own internal next step — 99.9% of which ended mid-sentence.
//
// The rules this locks in:
//   - a hard word cap, 20 normally and 26 on a row that states a partner
//     ask, because clipping that ask to six words made every one of them
//     read as an unfinished thought;
//   - the ask is dated to the ENTRY IT WAS WRITTEN IN, never the row's own
//     last-touch date;
//   - the score rides at the end as "(46)" and the band is gone, because
//     every download is already split by band.
import {
  cspNote, partnerAskFrom, nextStepFrom, allEntries, shortAskDate,
  readCspLead, classifyCsp, DEFAULT_CSP_RULES, guessCspColumns,
  CSP_NOTE_MAX_WORDS, CSP_NOTE_MAX_WORDS_ASK, noteWordCount, type CspLead,
} from "../../src/lib/cspRenewal";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`));
};
// The engine's own counter, imported rather than re-implemented: the cap
// does not count the · separator (punctuation is not a word), and a
// second local definition of that would silently drift from the rule.
const words = noteWordCount;
const TODAY = "2026-09-30";

// A row in the real export's shape.
const COLS = ["customeridname", "estimatedvalue", "msp_forecastcomments", "msp_licensingprogramname", "msp_partneraccountidname"];
const mk = (notes: string, over: Record<string, string> = {}): CspLead => {
  const raw: Record<string, string> = {
    customeridname: "Test Co", estimatedvalue: "102000",
    msp_forecastcomments: notes,
    msp_licensingprogramname: "CSP | Annual New Upfront Billing",
    msp_partneraccountidname: "NULL", ...over,
  };
  return readCspLead(raw, guessCspColumns(COLS), notes, TODAY);
};
const noteOf = (lead: CspLead) =>
  classifyCsp(lead, DEFAULT_CSP_RULES, { hasPhone: true, hasEmail: true }).why;
// Dates relative to this probe's fixed TODAY, so the grammar cases below
// land on a known side of the window however long the file sits here.
const MONS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const shift = (n: number) => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d; };
const plus = (n: number) => shift(n).toISOString().slice(0, 10);
const mdy = (k: string) => { const [y, m, d] = k.split("-"); return `${Number(m)}/${Number(d)}/${y}`; };
const dMon = (k: string) => { const [, m, d] = k.split("-"); return `${Number(d)}/${MONS[Number(m) - 1]}`; };

console.log("\n== the seller's internal next step is gone from the line ==");
// The exact row Jack pasted back: `next:` ran through two later dated
// entries and ended on the CRM's own "Show less" chrome.
const SWALLOW = "LDH - 2/Jun - Next Steps: alignment and decision LDH - 18/Jun - Following up with partner to understand next steps LDH - 18/Jun - Partner's response: \"Hi Luis, I had a call with this customer and currently working on Show less";
const step = nextStepFrom(SWALLOW);
ok("the next-step parser stops at the following dated entry",
   !/18\/Jun/.test(step), step);
ok("  and never carries the CRM's \"Show less\" chrome", !/Show less/i.test(step), step);
ok("  while still reading the step itself", /alignment and decision/i.test(step), step);
const plain = mk("MA - 3/Sep - Next Steps: send the renewal quote this week.");
ok("no note carries a \"next:\" clause any more", !/next:/i.test(noteOf(plain)), noteOf(plain));

console.log("\n== the band and the shouting are gone ==");
const n1 = noteOf(plain);
for (const gone of ["Score ", "TOP QUALITY", "High priority", "Medium priority", "Low priority"])
  ok(`"${gone.trim()}" no longer appears`, !n1.includes(gone), n1);
ok("the score rides at the end in parentheses", /\(\d{1,3}\)$/.test(n1), n1);

console.log("\n== the word cap holds ==");
const long = mk("MA - 3/Sep - Customer running M365 E5, Copilot, Azure, Entra ID and Defender, evaluating a renewal.");
ok(`a dense row fits ${CSP_NOTE_MAX_WORDS} words`, words(noteOf(long)) <= CSP_NOTE_MAX_WORDS,
   `${words(noteOf(long))}w: ${noteOf(long)}`);
// A pinned lead prepends a star OUTSIDE cspNote, so the budget has to
// account for it or the cap silently goes to 21.
const pinned = mk("RZ - 16/Sep - Customer is looking for a partner to take over licensing and support.");
ok("a pinned (★) row still fits the ask cap",
   words(noteOf(pinned)) <= CSP_NOTE_MAX_WORDS_ASK, `${words(noteOf(pinned))}w: ${noteOf(pinned)}`);
ok("  and really is pinned", noteOf(pinned).startsWith("★"), noteOf(pinned));

console.log("\n== a partner ask: that they want one, when, and why ==");
const ASK = "RZG - 23/Jun - During the conversation, the customer confirmed they are open to partner support for D365 deployment and licensing. RZG - 11/May - Intro call held.";
const ask = partnerAskFrom(ASK, TODAY);
ok("an ask is found", !!ask);
ok("  dated to the entry it was written in, not the newest one",
   ask?.when?.endsWith("-06-23") === true, String(ask?.when));
ok("  with the seller's filler stripped off the front",
   /^Open to partner support/.test(ask?.why ?? ""), ask?.why);
ok("  and it does not start with \"During the conversation\"",
   !/^during the/i.test(ask?.why ?? ""), ask?.why);
const askNote = noteOf(mk(ASK));
ok("the note leads with the flag", /^[★⚑] Wants partner/.test(askNote), askNote);
ok("  carries the date", /\(23 Jun\)/.test(askNote), askNote);
ok("  carries the reason", /Open to partner support/.test(askNote), askNote);
ok(`  and fits ${CSP_NOTE_MAX_WORDS_ASK} words`, words(askNote) <= CSP_NOTE_MAX_WORDS_ASK,
   `${words(askNote)}w`);

console.log("\n== the ask date is the ask's own, not the row's ==");
// Asked in March, touched last week. Saying "5d" next to the ask would be
// a lie about a six-month-old ask.
const STALE = "MA - 28/Sep - Left a voicemail. GD - 11/Mar - Customer is looking for a new reseller for their renewal.";
const stale = mk(STALE);
ok("the row's own last touch is the September entry", stale.lastTouch?.endsWith("-09-28") === true, String(stale.lastTouch));
ok("  but the ask is dated March", stale.partnerAsk?.when?.endsWith("-03-11") === true, String(stale.partnerAsk?.when));
ok("  and the note shows the ask's date", /\(11 Mar\)/.test(noteOf(stale)), noteOf(stale));

console.log("\n== guards still apply — a template mention is not an ask ==");
const TEMPLATE = "MA - 3/Sep - Partner: Not discovered — recommend initiating partner discovery.";
ok("Microsoft's own partner-discovery boilerplate is not an ask",
   partnerAskFrom(TEMPLATE, TODAY) === null, JSON.stringify(partnerAskFrom(TEMPLATE, TODAY)));
const NEG = "MA - 3/Sep - Customer does not want a partner involved.";
ok("a negated ask is not an ask", partnerAskFrom(NEG, TODAY) === null,
   JSON.stringify(partnerAskFrom(NEG, TODAY)));

console.log("\n== held-and-still-asking is stated, not hidden ==");
const HELD = mk("RZ - 12/Jun - Customer is unhappy with their current reseller and wants a new partner.",
                { msp_partneraccountidname: "Encore Business Solutions Inc." });
const heldNote = noteOf(HELD);
ok("a named partner reads as one word, not a CRM string",
   /via partner: Encore/.test(heldNote) && !/Business Solutions/.test(heldNote), heldNote);
ok("  and the ask is still shown beside it", /⚑ Wants partner/.test(heldNote), heldNote);

console.log("\n== supporting helpers ==");
ok("allEntries splits a multi-entry blob", allEntries(ASK).length === 2, String(allEntries(ASK).length));
ok("allEntries returns the whole text when undated", allEntries("no entries here").length === 1);
ok("allEntries returns nothing for an empty blob", allEntries("").length === 0);
ok("shortAskDate formats without a timezone shift", shortAskDate("2026-06-12") === "12 Jun", shortAskDate("2026-06-12"));
ok("cspNote is callable directly for a row with no ask",
   !cspNote(plain, 62, []).includes("⚑"), cspNote(plain, 62, []));

console.log("\n== renewals: their contract date, and the seller's guess, kept apart ==");
// Per Jack: "Renewals are important." The export has no renewal-date
// column at all, so this can only come out of the seller's notes.
const REN = mk("MA - 3/Sep - Customer renewal is up end of August, wants to review licensing.");
ok("a customer renewal date is read", REN.renewal?.kind === "renewal", JSON.stringify(REN.renewal));
ok("  verbatim from the notes", /end of august/i.test(REN.renewal?.when ?? ""), REN.renewal?.when);
// "end of August" carries no year, so it rests on the next-occurrence
// assumption and the note marks it with "~" rather than presenting a guess
// as a confirmed contract date.
ok("  and the note says \"renews\"", /renews ~end of August/i.test(noteOf(REN)), noteOf(REN));

const FC = mk("MA - 3/Sep - Estimated Close Date: September 30, 2026. Reviewing options.");
ok("a seller forecast is read as a forecast, not a renewal", FC.renewal?.kind === "forecast", JSON.stringify(FC.renewal));
ok("  and the note says \"close\", never \"renews\"",
   /close September 30, 2026/.test(noteOf(FC)) && !/renews/.test(noteOf(FC)), noteOf(FC));

const BOTH = mk("MA - 3/Sep - Estimated Close Date: July 2026. Their term end is January 2027.");
ok("with both present the CONTRACT date wins", BOTH.renewal?.kind === "renewal", JSON.stringify(BOTH.renewal));
ok("  and it is the January one", /january/i.test(BOTH.renewal?.when ?? ""), BOTH.renewal?.when);

console.log("\n== a stated absence is not a date ==");
// 693 real rows carry a label whose value says there is no date.
for (const [label, txt] of [
  ["not explicitly mentioned", "MA - 3/Sep - Estimated Close Date: Not explicitly mentioned in the notes."],
  ["TBD", "MA - 3/Sep - Renewal date: TBD pending procurement."],
  ["unknown", "MA - 3/Sep - Close date: unknown at this stage."],
] as [string, string][]) {
  const lead = mk(txt);
  ok(`"${label}" yields no date`, lead.renewal === null, JSON.stringify(lead.renewal));
}
// The nastiest real shape: the absence message itself contains a month.
const TRAP = mk("MA - 3/Sep - Estimated Close Date: Not available — ECD DATES file not found in June.");
ok("a month inside a 'not available' message is NOT printed as a date",
   TRAP.renewal === null, JSON.stringify(TRAP.renewal));

console.log("\n== a high-level window counts, per the ask ==");
for (const [label, txt, want] of [
  ["a quarter", "MA - 3/Sep - Timeline: Q3 2026 for the licensing decision.", /q3\s*2026/i],
  ["a relative window", "MA - 3/Sep - Timeline: next 3 months for the renewal decision.", /next 3 months/i],
  ["end of a period", "MA - 3/Sep - Renewal expires end of the quarter.", /end of the quarter/i],
] as [string, string, RegExp][]) {
  const lead = mk(txt);
  ok(`${label} is read`, want.test(lead.renewal?.when ?? ""), JSON.stringify(lead.renewal));
}

console.log("\n== the renewal is never shed to make room ==");
const DENSE = mk("MA - 3/Sep - Renewal is January 2027. Running M365 E5, Copilot, Azure, Entra ID and Defender, reviewing options.");
const dn = noteOf(DENSE);
ok("a dense row still fits the cap", words(dn) <= CSP_NOTE_MAX_WORDS, `${words(dn)}w: ${dn}`);
ok("  and the renewal survived it", /renews January 2027/i.test(dn), dn);
const DENSE_ASK = mk("RZ - 3/Sep - Customer is looking for a partner to take over licensing. Renewal is January 2027. Running M365 E5, Copilot, Azure and Defender.");
const dan = noteOf(DENSE_ASK);
ok("an ask row with a renewal fits too", words(dan) <= CSP_NOTE_MAX_WORDS_ASK, `${words(dan)}w: ${dan}`);
ok("  keeping both the ask and the renewal",
   /Wants partner/.test(dan) && /renews January 2027/i.test(dan), dan);

console.log("\n== Jack's four: the renewal date, the size, what it is about, the lane ==");
// "i want the notes to have the date they renewal is for if they go direct
// or through a partner size of the opp and what it is about like which
// licneses or azure" — these four lead the line and are never shed.
const FOUR = mk("MA - 3/Sep - Renewal date: 15 Nov 2026. Looking at M365 E5 and Copilot across the business.", {
  msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "90000", msp_partneraccountidname: "NULL",
});
const fn = noteOf(FOUR);
ok("the renewal date leads the line", /^(\u25c6 )?\u23f0? ?Renews /.test(fn), fn);
ok("  the size of the opp and what it is about read as ONE clause", /\$90k on M365 E5/.test(fn), fn);
ok("  and the lane says direct / partner / neither in words",
   /no partner yet|direct with Microsoft|via partner: /.test(fn), fn);

const HELD2 = mk("TH - 3/Sep - Renewal date: 15 Nov 2026. Reviewing M365 E5.", {
  msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "90000", msp_partneraccountidname: "CDW Logistics LLC",
});
ok("a held row names the partner they go through", /via partner: CDW/.test(noteOf(HELD2)), noteOf(HELD2));
const MSD = mk("GD - 3/Sep - Reviewing M365 E5.", {
  msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "90000", msp_partneraccountidname: "Microsoft",
});
ok("a Microsoft-direct row says so in words", /direct with Microsoft/.test(noteOf(MSD)), noteOf(MSD));

console.log("\n== the flow defects that prompted the rewrite ==");
// 279 real rows read "Open lane \u00b7 SHI on record" — two clauses stating the
// opposite. One clause with the caveat inside it is one fact.
const CONFLICT = mk("MA - 3/Sep - SHI is handling their licensing today. Reviewing M365 E5.", {
  msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "90000", msp_partneraccountidname: "NULL",
});
const cf = noteOf(CONFLICT);
ok("the record-says-nobody / notes-name-someone case is ONE clause",
   /no partner yet \(SHI in notes\)/.test(cf), cf);
ok("  and never reads as two clauses contradicting each other",
   !/(no partner yet|direct with Microsoft) \u00b7 \w+ in notes/.test(cf), cf);

// 189 real rows read "annual new, monthly", which contradicts itself.
for (const [prog, want] of [
  ["CSP | Annual New Monthly Billing", "annual new, paid monthly"],
  ["CSP | Annual New Upfront Billing", "annual new, paid upfront"],
  ["CSP | Monthly New", "month-to-month"],
] as [string, string][]) {
  const n = noteOf(mk("MA - 3/Sep - Reviewing M365 E5.", { msp_licensingprogramname: prog, estimatedvalue: "9000", msp_partneraccountidname: "NULL" }));
  ok(`billing reads as English: "${want}"`, n.includes(want), n);
}
ok("no note can say 'annual ..., monthly'",
   ![ "CSP | Annual New Monthly Billing", "CSP | Annual Renewal Monthly Billing" ]
     .some((prog) => /annual \w+, monthly/.test(noteOf(mk("MA - 3/Sep - Reviewing M365 E5.", { msp_licensingprogramname: prog, estimatedvalue: "9000", msp_partneraccountidname: "NULL" })))));

// One renewal grammar, the verb carrying the tense.
const grammar: [string, string, RegExp][] = [
  ["an upcoming contract renewal", `MA - ${dMon(plus(-3))} - Renewal date: ${mdy(plus(40))}.`, /\u23f0 Renews .*\(\d+d\)/],
  ["a passed contract renewal", `MA - ${dMon(plus(-3))} - Renewal date: ${mdy(plus(-40))}.`, /Renewed /],
  ["an upcoming forecast close", `MA - ${dMon(plus(-3))} - Estimated Close Date: ${mdy(plus(40))}.`, /\u23f0 Forecast close .*\(\d+d\)/],
  ["a passed forecast close", `MA - ${dMon(plus(-3))} - Estimated Close Date: ${mdy(plus(-40))}.`, /Forecast close .*, passed/],
];
for (const [label, txt, want] of grammar) {
  const n = noteOf(mk(txt, { msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "9000", msp_partneraccountidname: "NULL" }));
  ok(`${label} has its own verb`, want.test(n), n);
}
const lowerMonth = noteOf(mk("MA - 3/Sep - Renewal expires end of may.", { estimatedvalue: "9000", msp_partneraccountidname: "NULL" }));
ok("a month the seller typed lowercase is capitalised", /May/.test(lowerMonth) && !/ may/.test(lowerMonth), lowerMonth);
const notAMonth = noteOf(mk("MA - 3/Sep - Renewal expires end of the quarter.", { estimatedvalue: "9000", msp_partneraccountidname: "NULL" }));
ok("  but a word that is NOT a month keeps its own casing", /end of the quarter/.test(notAMonth), notAMonth);

// 18 of 109 real ask quotes opened on a CRM form label, not on a reason.
for (const junk of [
  "Context: Company: RCS (small logistics company) wants a partner to handle licensing",
  "1st Comment: Engagement type: Meeting. Customer is looking for a partner to handle licensing",
  "Last Action STU presentation to CFO. Customer is looking for a partner to handle licensing",
]) {
  const n = noteOf(mk(`MA - ${dMon(plus(-3))} - ${junk}.`, { msp_partneraccountidname: "NULL", estimatedvalue: "9000" }));
  ok(`an ask quote never opens on "${junk.slice(0, 18)}…"`,
     !/: (Context|1st Comment|Last Action|Engagement type)\b/.test(n), n);
}

// The separator is punctuation, so the cap counts words, not tokens.
ok("the word cap does not count the \u00b7 separator",
   noteWordCount("a \u00b7 b \u00b7 c") === 3, String(noteWordCount("a \u00b7 b \u00b7 c")));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
