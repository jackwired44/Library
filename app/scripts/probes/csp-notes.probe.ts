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
  CSP_NOTE_MAX_WORDS, CSP_NOTE_MAX_WORDS_ASK, type CspLead,
} from "../../src/lib/cspRenewal";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`));
};
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
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
   /Held: Encore/.test(heldNote) && !/Business Solutions/.test(heldNote), heldNote);
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
ok("  and the note says \"renews\"", /renews end of August/i.test(noteOf(REN)), noteOf(REN));

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

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
