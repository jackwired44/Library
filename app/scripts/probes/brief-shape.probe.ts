// The new three-clause Main brief, measured on Jack's real Main files.
import * as fs from "fs";
import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";

const DIR = "/root/.claude/uploads/dd1348d8-8ff6-501c-af5d-361f8a90722b";
const FILES = ["bb31c527-Book8-26-26.csv", "c1009a37-Book8-21-26.csv", "d119ae44-Book9-4-26.csv", "dc5b3192-Book9-30.csv", "39b8008d-Book8-10-26.csv"];
const parsed = FILES.map((f) => parseCSVText(f, fs.readFileSync(`${DIR}/${f}`, "utf8")));
const { results } = scanParsedFiles(parsed);
const strong = results.filter((r) => r.tier === "signal");
console.log(`${results.length} rows, ${strong.length} Strong Signal`);
console.log(`tiers: signal ${strong.length}, mention ${results.filter((r)=>r.tier==="mention").length}, dq ${results.filter((r)=>r.tier==="dq").length}`);

const n = (re: RegExp) => strong.filter((r) => re.test(r.notesSummary)).length;
console.log(`\n=== clause coverage across ${strong.length} Strong Signal rows ===`);
console.log(`  Runs …                              ${n(/\bRuns /)}`);
console.log(`  … with a (N seats) on a SKU         ${n(/\(\d+ seats\)/)}`);
console.log(`  Microsoft is already pitching them  ${n(/Microsoft is already pitching them/)}`);
console.log(`  Goes direct with Microsoft          ${n(/Goes direct with Microsoft/)}`);
console.log(`  Partner on record:                  ${n(/Partner on record:/)}`);
console.log(`  any direction clause                ${n(/Microsoft is already pitching them|Goes direct with Microsoft|Partner on record:/)}`);
console.log(`  On <platform> today                 ${n(/\bOn .+ today\./)}`);
console.log(`  Flagged "<pain>"                    ${n(/Flagged "/)}`);
console.log(`  Row reverses                        ${n(/Row reverses:/)}`);
console.log(`\n=== the ask ===`);
console.log(`  Dynamics ask      ${n(/Ask if they have looked at Dynamics/)}`);
console.log(`  licensing ask     ${n(/Ask how they manage licensing today/)}`);
console.log(`  Azure ask         ${n(/Ask how Azure is managed today/)}`);
console.log(`  reversal ask      ${n(/Ask what changed/)}`);
console.log(`  …and where the pain is   ${n(/and where the pain is/)}`);
console.log(`  NO ask at all     ${strong.filter((r) => !/\bAsk /.test(r.notesSummary)).length}`);

const lens = strong.map((r) => r.notesSummary.length).sort((a, b) => a - b);
const p = (q: number) => lens[Math.floor(lens.length * q)];
console.log(`\nlength: median ${p(0.5)}, p90 ${p(0.9)}, max ${lens[lens.length - 1]}`);

// A note with NOTHING before the ask is the shape to watch — the row
// qualified but the brief found nothing to state.
const bare = strong.filter((r) => /^\(\d+\) [^ ]+ Ask /.test(r.notesSummary));
console.log(`\nnotes that are score + ask only (nothing stated): ${bare.length}`);
bare.slice(0, 5).forEach((r) => console.log(`   ${r.company} — ${r.notesSummary.slice(0, 120)}`));

console.log("\n=== 14 real notes ===");
for (const r of strong.slice(0, 14)) console.log(`  ${r.notesSummary}`);
console.log("\n=== 6 with a partner on record ===");
strong.filter((r) => /Partner on record:/.test(r.notesSummary)).slice(0, 6).forEach((r) => console.log(`  ${r.notesSummary}`));
console.log("\n=== 6 Azure-direction ===");
strong.filter((r) => /Ask how Azure/.test(r.notesSummary)).slice(0, 6).forEach((r) => console.log(`  ${r.notesSummary}`));
