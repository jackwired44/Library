// Custom and CSP notes in the Main Scanner's format. Per Jack: "can we change
// all the notes from current form to the main scanner format", keeping the
// CSP facts in Main wording, and keeping each lead's own grade.
import { scan2, emptyRuleSet } from "../../src/lib/scanner2";
import { withRefreshedNoteOnly } from "../../src/lib/noteRefresh";
import { stripSnippetPrefix } from "../../src/lib/detection";
import type { StoredLead } from "../../src/lib/leadStore";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };
const HEAD = /^\(\d{1,3}\) [▲▸▼✕] /;

const cspHead = ["customeridname","estimatedvalue","msp_forecastcomments","msp_licensingprogramname","msp_partneraccountidname","fullname","telephone1","emailaddress1"];
const cspRows = [
  { customeridname: "NEW CO", estimatedvalue: "504000", msp_forecastcomments: "JS - 1/Oct - Customer wants a partner for licensing. Renewal date is 12/15/26. 285 users on M365 E5 and Copilot.", msp_licensingprogramname: "CSP | Annual New Upfront Billing", msp_partneraccountidname: "", fullname: "Zed Quinn", telephone1: "3125550301", emailaddress1: "zed@newco.com" },
  { customeridname: "OLD CO", estimatedvalue: "12000", msp_forecastcomments: "JS - 1/Oct - Business Premium renewal, partner Executech.", msp_licensingprogramname: "CSP | Monthly", msp_partneraccountidname: "Executech", fullname: "Kim Lane", telephone1: "3125550401", emailaddress1: "kim@old.com" },
];
const csp = scan2([{ name: "f.csv", fields: cspHead, data: cspRows }], {
  ...emptyRuleSet("t", "csp"),
  fields: { company: "customeridname", contact: "fullname", phone: "telephone1", email: "emailaddress1" },
  notesColumns: ["msp_forecastcomments"],
}).rows;
const [a, b] = csp.map((r) => r.snippet);
ok("CSP note opens with the score and band mark", HEAD.test(a) && HEAD.test(b), `${a} | ${b}`);
ok("  the head matches the bucket (High ▲)", csp[0].bucket !== "priority" || /^\(\d+\) ▲/.test(a), a);
ok("  open renewal keeps its ◆ pin", /◆/.test(a), a);
ok("  what it is about, with seats and value", /Wants M365 E5 and Copilot \(285 seats, \$504k\)\./.test(a), a);
ok("  timeline in Main wording", /Timeline: renews 12\/15\/26/.test(a), a);
ok("  the partner ask reads like Main", /Wants to work with a partner \(1 Oct\) for licensing\./.test(a), a);
ok("  no partner on record", /No partner on record\./.test(a), a);
ok("  billing as a sentence", /Billing: annual new, paid upfront\./.test(a), a);
ok("  ends on the licensing ask", /Ask how they buy licensing today, direct or through a partner, and where the pain is\.$/.test(a), a);
ok("  named partner reads 'Partner on record'", /Partner on record: Executech\./.test(b), b);
ok("  old clause style is gone", !/ · /.test(a) && !/d cold/.test(a) && !/⏰/.test(a), a);

const smcHead = ["Company","Full Name","Email","Description"];
const smcRow = { Company: "SMC CO", "Full Name": "Lou Park", Email: "lou@smc.com",
  Description: "Account: SMC CO. Propensity: D365 BC: Act Now (High Fit; High Prioritization Index). Need: Dynamics 365 Business Central for finance team." };
const smc = scan2([{ name: "s.csv", fields: smcHead, data: [smcRow] }], {
  ...emptyRuleSet("t", "smc"),
  fields: { company: "Company", contact: "Full Name", email: "Email" },
  notesColumns: ["Description"],
}).rows[0];
ok("Custom note opens with the score and band mark (or is a no-signal reason)", HEAD.test(smc.snippet) || smc.bucket === "unmatched", smc.snippet);
if (smc.bucket !== "unmatched" && smc.bucket !== "excluded") {
  ok("  Custom note ends on an Ask", /Ask [^.]+\.$/.test(smc.snippet), smc.snippet);
  ok("  no old ' · High priority (N)' tail", !/· (Strong Signal|High priority|Needs Review|Medium priority)/.test(smc.snippet), smc.snippet);
}

// Stored notes: the body changes, the grade does not.
const stored = (tier: string, score: number, notes: string): StoredLead => ({
  key: "k", source: "csp", company: "NEW CO", contact: "Zed Quinn", title: "", email: "zed@newco.com", phone: "", mobilePhone: "",
  productArea: "", tier, notes, score, firstSeenAt: "", lastSeenAt: "", sourceFiles: [], timesSeen: 1,
} as unknown as StoredLead);
const old = stored("Medium priority", 41, "$504k on Copilot · no partner yet · (41)");
const next = withRefreshedNoteOnly(old, a);
ok("stored refresh keeps the stored score and grade mark", next.notes.startsWith("(41) ▸ "), next.notes);
ok("  and takes the new body", stripSnippetPrefix(next.notes) === stripSnippetPrefix(a), next.notes);
ok("  tier and score untouched", next.tier === "Medium priority" && next.score === 41);
const dated = stored("High priority", 80, "2026-10-01 · old note\n2026-09-01 · older note".replace("\n", "\u0001"));
ok("  a lead with nothing new to say is returned as-is", withRefreshedNoteOnly(dated, "") === dated);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
