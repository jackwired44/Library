import { parseCSVText } from "../../src/lib/csv";
import { scanParsedFiles } from "../../src/lib/detection";
const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
const rows = [
  ["no incumbent, no pain", "Looking at Dynamics 365 Business Central for 40 users."],
  ["incumbent known",       "We looked at Dynamics 365 Business Central for 40 users. We are on Sage 100 today and continue to move forward."],
  ["pain already stated",   "Looking at Dynamics 365 Business Central for 40 users. The current setup is end of life."],
  ["incumbent AND pain",    "Dynamics 365 Business Central for 40 users. On QuickBooks today and the manual double-entry is a bottleneck, and we continue to move forward."],
  ["licensing (unchanged)", "Renewing Microsoft 365 E3 for 300 users this year."],
  ["azure (unchanged)",     "Planning an on-prem to Azure migration with a partner this year."],
];
const csv = ["Company,Full Name,Title,Email,Phone,Comments"]
  .concat(rows.map((r, i) => [`C${i}`, `P V${i}`, "IT Director", `p${i}@x${i}.com`, "312-555-0100", r[1]].map(q).join(","))).join("\n");
const res = scanParsedFiles([parseCSVText("t.csv", csv)]).results as any[];
const by = new Map(res.map((x) => [x.id, x]));
rows.forEach((r, i) => {
  const row = by.get(`0-${i}`);
  console.log(`${r[0].padEnd(24)} ${row ? row.notesSummary : "(no row)"}\n`);
});
