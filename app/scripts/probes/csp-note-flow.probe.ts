import { readFileSync } from "node:fs";
import { parseCSVText } from "../../src/lib/csv";
import { scan2, emptyRuleSet, guessFieldMapping, guessNotesColumns, profileColumns, reconcileCspColumns } from "../../src/lib/scanner2";
import { CSP_NOTE_MAX_WORDS, CSP_NOTE_MAX_WORDS_ASK } from "../../src/lib/cspRenewal";

const f = process.argv[2];
const pf = parseCSVText(f.split("/").pop()!, readFileSync(f, "utf8"));
const rs = emptyRuleSet("probe", "csp");
rs.mode = "csp"; rs.fields = guessFieldMapping(profileColumns([pf]));
rs.notesColumns = guessNotesColumns(profileColumns([pf]));
rs.cspColumns = reconcileCspColumns(undefined, pf.fields);
const hi = scan2([pf], rs).rows.filter((r) => r.bucket === "priority");
const wc = (t: string) => t.split(/\s+/).filter((w) => w && w !== "·").length;


console.log("\n=== how each shape reads ===");
const show = (label: string, pick: (r: typeof hi[number]) => boolean, n = 4) => {
  const rows = hi.filter(pick);
  console.log(`\n### ${label}  (${rows.length} of ${hi.length} High)`);
  rows.slice(0, n).forEach((r) => console.log("   " + r.snippet));
};
show("\u25c6 pinned (renewal + no partner)", (r) => !!r.csp?.openRenewal);
show("\u2691 wants a partner", (r) => !!r.csp?.wantsPartner && !r.csp?.openRenewal);
show("renewal, but they go through a partner", (r) => r.csp?.renewal?.kind === "renewal" && !r.csp.openRenewal && !r.csp.wantsPartner);
show("seller forecast close only", (r) => r.csp?.renewal?.kind === "forecast" && !r.csp?.wantsPartner);
show("a caution flag", (r) => /\u26a0/.test(r.snippet) && !r.csp?.wantsPartner);
show("plain, no renewal date", (r) => !r.csp?.renewal && !r.csp?.wantsPartner);

const lens = hi.map((r) => wc(r.snippet)).sort((a, b) => a - b);
const chars = hi.map((r) => r.snippet.length).sort((a, b) => a - b);
const pick = (a: number[], q: number) => a[Math.floor(a.length * q)];
console.log(`words  median ${pick(lens, .5)}  p90 ${pick(lens, .9)}  max ${lens[lens.length - 1]}`);
console.log(`chars  median ${pick(chars, .5)}  p90 ${pick(chars, .9)}  max ${chars[chars.length - 1]}`);
const over = hi.filter((r) => wc(r.snippet) > (r.csp?.wantsPartner || r.csp?.openRenewal ? CSP_NOTE_MAX_WORDS_ASK : CSP_NOTE_MAX_WORDS));
console.log(`over cap: ${over.length}`);
over.slice(0, 3).forEach((r) => console.log("   " + wc(r.snippet) + " :: " + r.snippet));

console.log(`\nJack's four, coverage across ${hi.length} High rows:`);
const has = (re: RegExp) => hi.filter((r) => re.test(r.snippet)).length;
console.log(`  renewal date stated        ${hi.filter((r) => !!r.csp?.renewal).length}  shown ${has(/Renews |Renewed |Forecast close /)}`);
console.log(`  size of the opp ($)        ${hi.filter((r) => (r.csp?.value ?? 0) > 0).length}  shown ${has(/\$[\d.]/)}`);
console.log(`  what it is about (SKUs)    ${hi.filter((r) => !!r.csp?.skus.length).length}  shown ${has(/ on [A-Z]/)}`);
console.log(`  direct / partner / neither ${hi.length}  shown ${has(/via partner: |direct with Microsoft|no partner yet/)}`);

console.log(`\nlowercase month after the verb: ${hi.filter((r) => /(Renews|Renewed|close) ~?[a-z]{3,}/.test(r.snippet)).length}`);
console.log(`"End of" miscapitalised:        ${hi.filter((r) => /~End of/.test(r.snippet)).length}`);
console.log(`lane+reseller contradiction:    ${hi.filter((r) => /(Open lane|MS direct) · /.test(r.snippet)).length}`);
console.log(`self-contradictory billing:     ${hi.filter((r) => /annual \w+, monthly/.test(r.snippet)).length}`);

const JUNK = /^(1st Comment|Context|CLM\/Partner|Overview|Summary|Engagement type|Tenant ID|Buying-channel|Last Action|Need [A-Z][\w/]*\s+(?:Need|Licensing))/i;
const asks = hi.filter((r) => /Wants partner.*: /.test(r.snippet));
const junk = asks.filter((r) => { const m = /Wants partner(?: \([^)]*\))?: (.+?) ·/.exec(r.snippet); return m && JUNK.test(m[1]); });
console.log(`ask quotes opening on a form label: ${junk.length} of ${asks.length}`);
junk.slice(0, 5).forEach((r) => console.log("   " + (/Wants partner(?: \([^)]*\))?: (.+?) ·/.exec(r.snippet) || [])[1]));

console.log(`\nlongest 4:`);
[...hi].sort((a, b) => wc(b.snippet) - wc(a.snippet)).slice(0, 4).forEach((r) => console.log(`   ${wc(r.snippet)}w  ${r.snippet}`));

console.log(`\nthe 13 lowercase-month rows:`);
hi.filter((r) => /(Renews|Renewed|close) ~?[a-z]{3,}/.test(r.snippet)).slice(0, 13)
  .forEach((r) => console.log("   " + (/(?:Renews|Renewed|Forecast close) [^·]*/.exec(r.snippet) || [])[0]));
console.log(`\nrows with SKUs but no money:`);
hi.filter((r) => !!r.csp?.skus.length && !((r.csp?.value ?? 0) > 0)).slice(0, 3).forEach((r) => console.log("   " + r.snippet));
