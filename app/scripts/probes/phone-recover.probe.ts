// Which unlabelled numbers in the notes are OUR contact's, and which
// belong to a partner rep we must never dial?
import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns } from "../../src/lib/scanner2";

const P = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b/961c0c2c-BookCSPs_9-4.csv";
const parsed = [parseCSVText("BookCSPs_9-4.csv", fs.readFileSync(P, "utf8"))];
const prof = profileColumns(parsed);
const res = scan2(parsed, { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) });
const none = res.rows.filter((r) => !r.lead.phone && !r.lead.mobilePhone);

const NUM = /(?<![\d-])(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)/g;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const JUNK = /^(\d)\1{9}$|^1234567890$|^0{7,}$/;
const domainOf = (e: string) => (e.split("@")[1] || "").toLowerCase().replace(/^www\./, "");

let sameDomain = 0, partnerCtx = 0, junk = 0, other = 0;
const samples: string[] = [];
for (const r of none) {
  const notes = String((r.row as Record<string, string>).msp_forecastcomments ?? "");
  const leadDomain = domainOf(r.lead.email || "");
  NUM.lastIndex = 0;
  let m = NUM.exec(notes);
  if (!m) continue;
  const digits = notes.slice(m.index, m.index + m[0].length).replace(/\D/g, "");
  if (JUNK.test(digits.replace(/^1/, ""))) { junk++; continue; }
  // What sits in the 90 characters before it?
  const before = notes.slice(Math.max(0, m.index - 90), m.index);
  const isPartnerCtx = /\bpartner\b|\breseller\b|\bAE\b|\bCSP\b/i.test(before);
  EMAIL.lastIndex = 0;
  const nearEmails = [...before.matchAll(EMAIL)].map((x) => x[1].toLowerCase());
  const matchesLead = !!leadDomain && nearEmails.some((d) => d === leadDomain);
  if (matchesLead) { sameDomain++; if (samples.length < 8) samples.push(`  SAFE   ${r.lead.company.slice(0, 24).padEnd(25)} ${digits}  (email domain ${leadDomain} right before it)`); }
  else if (isPartnerCtx) { partnerCtx++; if (samples.length < 14) samples.push(`  SKIP   ${r.lead.company.slice(0, 24).padEnd(25)} ${digits}  partner context: "${before.slice(-55).replace(/\s+/g, " ")}"`); }
  else other++;
}
console.log(`phoneless rows: ${none.length}`);
console.log(`  number preceded by an email on the LEAD'S OWN domain : ${sameDomain}   <- safe to take`);
console.log(`  number in partner / reseller / AE context            : ${partnerCtx}   <- must NOT take`);
console.log(`  junk (8888888888, repeated digits)                   : ${junk}`);
console.log(`  neither                                              : ${other}   <- unattributable`);
console.log("\nsamples:");
samples.forEach((s) => console.log(s));
