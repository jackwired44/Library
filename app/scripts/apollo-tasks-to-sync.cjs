#!/usr/bin/env node
// Turn raw Apollo task rows into the All leads sync file.
//
// Per Jack: "pull the data from apollo to populate here so i can see when a
// lead is added and when a task is completed in a sequence."
//
// Input: one or more TSV files, one Apollo task per line, no header:
//   task_id  contact_id  contact_name  sequence_id  sequence_name  step  type  status  due_date
// (exactly what apollo_tasks_search returns, flattened.)
//
// Output: a CSV the All leads "Apollo sync" import already reads —
//   Name, Apollo Contact Id, Sequences, Calls, Tasks
//
// What each date honestly is:
// - "added" is the due date of the contact's FIRST task in that sequence.
//   Apollo's task rows carry no enrolment stamp; a step-1 task falls due the
//   day the contact is added, so this is the closest true date available.
// - "last done" is the due date of the newest COMPLETED task. Apollo returns
//   no completion timestamp on a task.
// Neither is ever presented as more than that, here or in the app.
//
// Rows are grouped by contact NAME, not contact id, because the app can
// only match a name (the feed carries no email or company), and two Apollo
// records for one person would otherwise overwrite each other on import.
//
// Usage: node scripts/apollo-tasks-to-sync.cjs out.csv in1.tsv [in2.tsv ...]
const fs = require("fs");

const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length === 0) {
  console.error("usage: apollo-tasks-to-sync.cjs out.csv in.tsv [...]");
  process.exit(2);
}

// Apollo stores some names HTML-escaped several times over
// ("O&amp;Amp;Amp;Apos;Rourke"). Unwind until stable, or the name can never
// match the lead it belongs to.
function unescapeHtml(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/&amp;/gi, "&").replace(/&apos;|&#39;/gi, "'").replace(/&quot;/gi, '"');
  } while (s !== prev);
  return s;
}

const seen = new Set();
const byPerson = new Map();
let read = 0, dup = 0, bad = 0;
for (const file of inputs) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = line.split("\t");
    if (c.length < 9 || !/^\d{4}-\d{2}-\d{2}$/.test(c[8]) || !c[2].trim()) { bad++; continue; }
    read++;
    if (seen.has(c[0])) { dup++; continue; }
    seen.add(c[0]);
    const name = unescapeHtml(c[2]).trim().replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (!byPerson.has(key)) byPerson.set(key, { name, ids: new Set(), tasks: [] });
    const p = byPerson.get(key);
    p.ids.add(c[1]);
    p.tasks.push({
      seq: c[4].trim(), step: /^\d+$/.test(c[5]) ? Number(c[5]) : null,
      type: c[6].trim() || "task", status: c[7].trim().toLowerCase(), at: c[8],
    });
  }
}

const q = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rows = [["Name", "Apollo Contact Id", "Sequences", "Calls", "Tasks"].join(",")];
let seqCount = 0;
for (const p of byPerson.values()) {
  const bySeq = new Map();
  for (const t of p.tasks) {
    if (!t.seq) continue;
    if (!bySeq.has(t.seq)) bySeq.set(t.seq, []);
    bySeq.get(t.seq).push(t);
  }
  const seqs = [];
  for (const [name, ts] of bySeq) {
    const open = ts.filter((t) => t.status === "scheduled").sort((a, b) => a.at.localeCompare(b.at));
    const done = ts.filter((t) => t.status === "completed");
    const added = ts.reduce((m, t) => (t.at < m ? t.at : m), ts[0].at);
    const lastDone = done.reduce((m, t) => (t.at > m ? t.at : m), "");
    const status = open.length ? "active" : "finished";
    const step = open.length ? open[0].step
      : ts.reduce((m, t) => (t.step != null && (m == null || t.step > m) ? t.step : m), null);
    // ":" separates the fields, so a colon inside a sequence name would
    // shift them. None of the live names has one; strip defensively.
    seqs.push([name.replace(/[:;|]/g, " "), status, step ?? "", added, lastDone].join(":"));
    seqCount++;
  }
  const calls = p.tasks.filter((t) => t.status === "completed" && /call/.test(t.type)).length;
  const tasks = [...p.tasks].sort((a, b) => b.at.localeCompare(a.at))
    .map((t) => `${t.at} ${t.type} ${t.status}${t.seq ? ` @${t.seq.replace(/[:;|]/g, " ")}${t.step != null ? `:${t.step}` : ""}` : ""}`);
  rows.push([q(p.name), q([...p.ids].join(" ")), q(seqs.join("; ")), calls, q(tasks.join("; "))].join(","));
}
fs.writeFileSync(out, rows.join("\n") + "\n");
console.log(JSON.stringify({ tasksRead: read, duplicateTasks: dup, badLines: bad, people: byPerson.size, enrolments: seqCount, out }));
