// Every uploaded CSV, grouped by the month it is dated. Per Jack: "i want to
// be able to filter by the specific csv file and see what the months on all
// leads have file wise". One row per file with its date, scanner and how its
// leads split; tick files and open them in Leads together, or click a name to
// open just that one. Reads the lead store only; nothing here is written.
import { useMemo, useState } from "react";
import type { StoredLead, LeadSource } from "../lib/leadStore";
import { LEAD_SOURCE_META } from "../lib/leadStore";
import { fileDates, fileMonthKey, isPreMaySheet, shortMonthLabel, sheetNumberOf } from "../lib/leadFiling";
import { verdictOf, VERDICT_META, VERDICT_ORDER, type Verdict } from "../lib/leadStatus";

interface FileRow {
  file: string;
  date: string;
  month: string;
  sources: LeadSource[];
  total: number;
  strong: number;
  review: number;
  bad: number;
  checked: number;
}

/** What Files hands to Leads: the picked files plus the grade and product
 *  line it was narrowed to, so the table opens on exactly the same slice. */
export interface FilesPick { files: string[]; verdict: Verdict | "all"; line: string }

const NO_LINE = "(no product line)";

export default function Files({ leads, onOpen }: { leads: StoredLead[]; onOpen: (pick: FilesPick) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  // Per Jack: "strong signal or not dynamics or m365azure whatever". The
  // counts below follow these two, and Open carries them into Leads.
  const [verdictF, setVerdictF] = useState<Verdict | "all">("all");
  const [lineF, setLineF] = useState("all");
  const lines = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) { const k = l.productArea || NO_LINE; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [leads]);

  const months = useMemo(() => {
    const dates = fileDates(leads);
    const rows = new Map<string, FileRow>();
    for (const l of leads) {
      const v = verdictOf(l.tier);
      if (verdictF !== "all" && v !== verdictF) continue;
      if (lineF !== "all" && (l.productArea || NO_LINE) !== lineF) continue;
      for (const f of l.sourceFiles) {
        let r = rows.get(f);
        if (!r) {
          const date = dates.get(f) || "";
          r = { file: f, date, month: fileMonthKey(f, date), sources: [], total: 0, strong: 0, review: 0, bad: 0, checked: 0 };
          rows.set(f, r);
        }
        r.total++;
        r[v]++;
        if (l.apolloCheckedAt) r.checked++;
        if (!r.sources.includes(l.source)) r.sources.push(l.source);
      }
    }
    const groups = new Map<string, FileRow[]>();
    for (const r of rows.values()) {
      if (!groups.has(r.month)) groups.set(r.month, []);
      groups.get(r.month)!.push(r);
    }
    for (const list of groups.values()) list.sort((a, b) => b.date.localeCompare(a.date) || (sheetNumberOf(b.file) ?? 0) - (sheetNumberOf(a.file) ?? 0) || a.file.localeCompare(b.file));
    return [...groups.entries()].sort((a, b) => (b[0] || "").localeCompare(a[0] || ""));
  }, [leads, verdictF, lineF]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? months.map(([m, rs]) => [m, rs.filter((r) => r.file.toLowerCase().includes(needle))] as const).filter(([, rs]) => rs.length) : months;
  const fileCount = months.reduce((n, [, rs]) => n + rs.length, 0);

  const toggle = (f: string) => setPicked((p) => { const n = new Set(p); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  const toggleMonth = (rs: readonly FileRow[]) => setPicked((p) => {
    const n = new Set(p);
    const all = rs.every((r) => n.has(r.file));
    for (const r of rs) { if (all) n.delete(r.file); else n.add(r.file); }
    return n;
  });

  const open = (files: string[]) => onOpen({ files, verdict: verdictF, line: lineF });
  if (!leads.length) return <div className="panel" style={{ padding: 16 }}>No uploaded files yet. Save a scan to All leads and its CSV shows up here.</div>;

  return (
    <div>
      <div className="page-head" style={{ marginBottom: 10 }}>
        <div>
          <h2 style={{ margin: 0 }}>Files</h2>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {fileCount.toLocaleString()} uploaded CSVs{verdictF !== "all" || lineF !== "all" ? " with matching leads" : ""}, filed under the month each is dated (the date in its name, a Sheet file's estimate, else its upload day). Nothing before {shortMonthLabel("2025-10")}.
          </div>
        </div>
      </div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <div className="toolbar-row">
          <input className="field" aria-label="Find a file" placeholder="Find a file…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
          <div className="seg" role="group" aria-label="Files grade">
            <button className={`seg-btn${verdictF === "all" ? " active" : ""}`} onClick={() => setVerdictF("all")}>All grades</button>
            {VERDICT_ORDER.map((v) => (
              <button key={v} className={`seg-btn${verdictF === v ? " active" : ""}`} onClick={() => setVerdictF(v)}>{VERDICT_META[v].label}</button>
            ))}
          </div>
          <select className="field" aria-label="Files product line" value={lineF} onChange={(e) => setLineF(e.target.value)}>
            <option value="all">Product line: any</option>
            {lines.map(([k, n]) => <option key={k} value={k}>{k} ({n.toLocaleString()})</option>)}
          </select>
          <div className="toolbar-spacer" />
          {picked.size > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setPicked(new Set())}>Clear</button>}
          <button className="btn btn-sm btn-primary" disabled={!picked.size} aria-label="Open picked files in Leads" onClick={() => open([...picked])}>
            Open {picked.size ? picked.size.toLocaleString() : ""} file{picked.size === 1 ? "" : "s"} in Leads
          </button>
        </div>
      </div>
      <div className="table-card">
        <table className="data-table dense-table" aria-label="Uploaded files">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>File</th>
              <th>Dated</th>
              <th>Scanner</th>
              <th className="num" title="Leads in the file matching the grade and product line picked above">Leads</th>
              <th className="num">{VERDICT_META.strong.label}</th>
              <th className="num">{VERDICT_META.review.label}</th>
              <th className="num">{VERDICT_META.bad.label}</th>
              <th className="num" title="Leads looked up in Apollo at least once">Checked in Apollo</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(([m, rs]) => {
              const all = rs.every((r) => picked.has(r.file));
              const sum = (k: "total" | "strong" | "review" | "bad") => rs.reduce((n, r) => n + r[k], 0);
              return [
                <tr key={`m-${m}`} data-month={m} style={{ background: "var(--surface-sunken)" }}>
                  <td><input type="checkbox" checked={all} onChange={() => toggleMonth(rs)} aria-label={`Pick every file in ${m ? shortMonthLabel(m) : "Undated"}`} /></td>
                  <td colSpan={3}><b>{m ? shortMonthLabel(m) : "Undated"}</b> <span className="muted">· {rs.length} file{rs.length === 1 ? "" : "s"}</span></td>
                  <td className="num"><b>{sum("total").toLocaleString()}</b></td>
                  <td className="num"><b>{sum("strong").toLocaleString()}</b></td>
                  <td className="num">{sum("review").toLocaleString()}</td>
                  <td className="num">{sum("bad").toLocaleString()}</td>
                  <td />
                </tr>,
                ...rs.map((r) => (
                  <tr key={r.file} data-file={r.file} className={picked.has(r.file) ? "is-selected" : undefined}>
                    <td><input type="checkbox" checked={picked.has(r.file)} onChange={() => toggle(r.file)} aria-label={`Pick ${r.file}`} /></td>
                    <td>
                      <button className="btn btn-sm btn-ghost" style={{ padding: 0, textAlign: "left" }} title="Open just this file in Leads" onClick={() => open([r.file])}>{r.file}</button>
                    </td>
                    <td>{r.date ? `${isPreMaySheet(r.file) ? "~" : ""}${r.date.slice(5).replace("-", "/")}/${r.date.slice(2, 4)}` : <span className="muted">—</span>}</td>
                    <td>{r.sources.map((s) => LEAD_SOURCE_META[s].label).join(", ")}</td>
                    <td className="num">{r.total.toLocaleString()}</td>
                    <td className="num">{r.strong.toLocaleString()}</td>
                    <td className="num">{r.review.toLocaleString()}</td>
                    <td className="num">{r.bad.toLocaleString()}</td>
                    <td className="num">{r.checked.toLocaleString()}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
