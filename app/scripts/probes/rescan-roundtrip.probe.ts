// Files → Rescan must give the same Strong Signals as uploading the same
// files again. Per Jack: "rescanned 19 files ... got 394 dynamics strong
// signals ... uploaded it manually into main scanner ... got 496 find the
// gap". This replays the real save path (lead inputs → keys → raw rows and
// notes) and the real rebuild (rebuildFileRows), then compares the scans.
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles, DEFAULT_RULE_OVERRIDES, type ParsedFile } from "../../src/lib/detection";
import { leadInputsFromResults, leadInputsFromNoSignal, leadInputsFromDuplicates } from "../../src/lib/leadFiling";
import { mergeLeads, leadKeyOfInput, type LeadInput, type StoredLead } from "../../src/lib/leadStore";
import { appendRow, appendSegment, rebuildFileRows, type RawNotes } from "../../src/lib/rawNotes";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };

const q = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
const HEAD = ["Company", "Full Name", "Title", "Email", "msp_primaryproductcodename", "Comments"];
const csv = (rows: string[][]) => [HEAD.join(",")].concat(rows.map((r) => r.map(q).join(","))).join("\n");
const DYN = (n: number) => `Evaluating Dynamics 365 Business Central to replace QuickBooks for ${n} users this quarter, want a partner to implement.`;
const LONG = `${"Background on the account and prior meetings with the team. ".repeat(40)}They are now evaluating Dynamics 365 Business Central for 40 users to replace Sage.`;

const A = parseCSVText("BookSheet75.csv", csv([
  ["Acme Shared", "Ann One", "CFO", "info@acmeshared.com", "", DYN(25)],
  ["Acme Shared", "Bob Two", "Controller", "info@acmeshared.com", "", DYN(30)],
  ["Acme Shared", "Cal Three", "COO", "info@acmeshared.com", "", DYN(35)],
  ["Same First", "John Smith", "CFO", "", "", DYN(20)],
  ["Same First", "John Brown", "CIO", "", "", DYN(22)],
  ["Repeat Co", "Rita Repeat", "CFO", "rita@repeat.com", "", DYN(50)],
  ["Long Co", "Lon Long", "CFO", "lon@long.com", "", LONG],
  ["Plain Co", "Pat Plain", "CFO", "pat@plain.com", "Dynamics 365", DYN(15)],
]));
const B = parseCSVText("BookSheet76.csv", csv([
  ["Repeat Co", "Rita Repeat", "CFO", "rita@repeat.com", "", DYN(50)], // identical note in a later file
  ["Other Co", "Oz Other", "CFO", "oz@other.com", "", DYN(60)],
]));
const files: ParsedFile[] = [A as ParsedFile, B as ParsedFile];

const strongDyn = (pf: ParsedFile[]) => scanParsedFiles(pf, DEFAULT_RULE_OVERRIDES).results.filter((r) => r.tier === "signal" && r.category === "dynamics365").length;

// --- save each file as its own upload, the way Save does ---------------
let leads: StoredLead[] = [];
const raws = new Map<string, RawNotes>();
let t = 0;
for (const f of files) {
  const scan = scanParsedFiles([f], DEFAULT_RULE_OVERRIDES);
  const rawOf = (id: string) => { const m = id.match(/(\d+)-(\d+)$/); return m ? ([f][Number(m[1])]?.data[Number(m[2])] as Record<string, unknown>) : undefined; };
  const scored = leadInputsFromResults(scan.results);
  const noSig = leadInputsFromNoSignal(scan.noSignalRows ?? [], rawOf);
  const keys = new Set([...scored, ...noSig].map((i) => leadKeyOfInput(i)));
  const inputs: LeadInput[] = [...scored, ...noSig, ...leadInputsFromDuplicates(scan.duplicateRows ?? [], keys, rawOf)];
  const at = new Date(Date.UTC(2026, 9, 1, 0, t++)).toISOString();
  leads = mergeLeads(leads, inputs, at).leads;
  for (const i of inputs) {
    const key = leadKeyOfInput(i);
    if (!key) continue;
    let cur = raws.get(key);
    const s = appendSegment(cur, key, { at, file: i.sourceFile, text: i.rawNotes || "" });
    if (s) cur = { ...s, rows: cur?.rows };
    if (i.rawFields) { const r = appendRow(cur, key, { at, file: i.sourceFile, fields: i.rawFields }); if (r) cur = r; }
    if (cur) raws.set(key, cur);
  }
}

// --- rebuild every file from what was saved, then scan together ---------
const rebuilt: ParsedFile[] = [];
let missing = 0;
for (const f of files) {
  const inFile = leads.filter((l) => l.sourceFiles.includes(f.name));
  const b = rebuildFileRows(f.name, inFile.map((l) => raws.get(l.key)));
  missing += b.missing;
  const cols: string[] = [];
  for (const row of b.data) for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k);
  rebuilt.push({ name: f.name, fields: cols, data: b.data });
}

const direct = strongDyn(files);
const again = strongDyn(rebuilt);
console.log(`  direct ${direct} · rebuilt ${again} · missing ${missing}`);
ok("three people sharing one email come back as three rows", rebuilt[0].data.filter((r) => /acmeshared/.test(String(r.Email || ""))).length === 3);
ok("two Johns at one company with no email both come back", rebuilt[0].data.filter((r) => /Same First/.test(String(r.Company || ""))).length === 2);
ok("a person whose note repeats in a later file is rebuilt in that file too", rebuilt[1].data.some((r) => /Rita/.test(String(r["Full Name"] || "")) && /Business Central/.test(String(r.Comments || ""))));
ok("a long note keeps the words past 2,000 characters", rebuilt[0].data.some((r) => /replace Sage/.test(String(r.Comments || ""))));
ok("nothing is missing", missing === 0, String(missing));
ok("rescan gives the same Dynamics Strong Signals as uploading again", direct === again, `${direct} vs ${again}`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
