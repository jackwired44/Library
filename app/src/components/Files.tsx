// Every uploaded CSV, grouped by the month it is dated. Per Jack: "i want to
// be able to filter by the specific csv file and see what the months on all
// leads have file wise". One row per file with its date, scanner and how its
// leads split; tick files and open them in Leads together, or click a name to
// open just that one. Reads the lead store only; nothing here is written.
import { useMemo, useState } from "react";
import type { StoredLead, LeadSource } from "../lib/leadStore";
import { LEAD_SOURCE_META } from "../lib/leadStore";
import { fileDateOverrideOf, fileDates, fileMonthKey, isPreMaySheet, shortMonthLabel, sheetNumberOf } from "../lib/leadFiling";
import { verdictOf, VERDICT_META, VERDICT_ORDER, type Verdict } from "../lib/leadStatus";
import { confirmAction } from "../lib/confirmBox";

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

export default function Files({ leads, onOpen, onSetDate, onRemove, onRescan, onRescanInScanner, noteRefresh = null }: {
  leads: StoredLead[];
  onOpen: (pick: FilesPick) => void;
  /** Per Jack: "edit where it is stored with which month". null resets. */
  onSetDate?: (file: string, date: string | null) => void;
  onRemove?: (file: string) => Promise<{ deleted: number; kept: number }>;
  /** Per Jack: "rescan the files once in files" and "make sure the note is
   *  up to date for old files". Re-reads each lead's saved CSV row with
   *  today's rules (note + verdict), no re-upload. No files = all of them. */
  onRescan?: (files?: string[]) => void;
  /** Main files: rebuild from the saved CSV rows and open in the Main
   *  Scanner, the same view as a fresh upload, before saving. */
  onRescanInScanner?: (files: string[]) => Promise<{ rows: number; missing: number }>;
  noteRefresh?: { done: number; total: number; changed: number; finished: boolean; missing?: [string, number][] } | null;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ file: string; date: string } | null>(null);
  const [notice, setNotice] = useState("");
  const busy = !!noteRefresh && !noteRefresh.finished;
  const sourcesOf = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of leads) for (const f of l.sourceFiles) { if (!m.has(f)) m.set(f, new Set()); m.get(f)!.add(l.source); }
    return m;
  }, [leads]);
  // Main files open in the Main Scanner; Custom and CSP have no rebuilt
  // scanner view yet, so theirs refresh in place.
  const rescan = async (files: string[]) => {
    const main = files.filter((f) => sourcesOf.get(f)?.has("main"));
    const other = files.filter((f) => !main.includes(f));
    if (other.length && onRescan) onRescan(other);
    if (main.length && onRescanInScanner) {
      const r = await onRescanInScanner(main);
      if (!r.rows) setNotice(`Nothing to rescan: the leads in ${main.join(", ")} were saved before CSV rows were kept. Re-upload the file once.`);
    } else if (main.length && onRescan) onRescan(main);
  };
  // Leads per file across every grade and line, so Delete states the real
  // count rather than the filtered one.
  const fileTotals = useMemo(() => {
    const m = new Map<string, { only: number; shared: number }>();
    for (const l of leads) for (const f of l.sourceFiles) {
      const e = m.get(f) ?? { only: 0, shared: 0 };
      if (l.sourceFiles.length <= 1) e.only++; else e.shared++;
      m.set(f, e);
    }
    return m;
  }, [leads]);
  const remove = async (f: string) => {
    if (!onRemove) return;
    const t = fileTotals.get(f) ?? { only: 0, shared: 0 };
    const msg = `Delete ${f}?\n\n${t.only.toLocaleString()} lead${t.only === 1 ? "" : "s"} came only from this file and will be deleted.`
      + (t.shared ? `\n${t.shared.toLocaleString()} also came from another file; they stay and just lose this file's name.` : "")
      + "\n\nLists, the Lead Library and History are not touched. This can't be undone (a Backup restores it).";
    if (!await confirmAction(msg, "Delete")) return;
    const r = await onRemove(f);
    setPicked((p) => { const n = new Set(p); n.delete(f); return n; });
    setNotice(`Deleted ${f}: ${r.deleted.toLocaleString()} lead${r.deleted === 1 ? "" : "s"} removed, ${r.kept.toLocaleString()} kept from other files.`);
  };
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
      {noteRefresh && (
        <div className="panel" role="status" aria-label="Rescan status" style={{ padding: "8px 12px", marginBottom: 10, fontSize: 13 }}>
          {noteRefresh.finished
            ? <>Rescanned {noteRefresh.total.toLocaleString()} lead{noteRefresh.total === 1 ? "" : "s"} with today's rules · {noteRefresh.changed.toLocaleString()} note{noteRefresh.changed === 1 ? "" : "s"} updated, the rest were already current.</>
            : <>Rescanning… {noteRefresh.done.toLocaleString()} of {noteRefresh.total.toLocaleString()}</>}
          {noteRefresh.finished && !!noteRefresh.missing?.length && (
            <div style={{ marginTop: 4 }}>
              <b>{noteRefresh.missing.reduce((t, [, c]) => t + c, 0).toLocaleString()}</b> were saved before CSV rows were kept, so they can't be rescanned here. Re-upload these files once to bring their notes up to date:{" "}
              {noteRefresh.missing.map(([f, c]) => `${f} (${c.toLocaleString()})`).join(", ")}
            </div>
          )}
        </div>
      )}
      {notice && <div className="panel" role="status" style={{ padding: "8px 12px", marginBottom: 10, fontSize: 13 }}>{notice} <button className="btn btn-sm btn-ghost" onClick={() => setNotice("")}>Dismiss</button></div>}
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
          {onRescanInScanner && picked.size > 0 && (
            <button className="btn btn-sm btn-secondary" disabled={busy} aria-label="Rescan picked files in the scanner"
              title="Opens the picked Main Scanner files in the Main Scanner with today's rules, like a fresh upload. Save there to update the stored notes."
              onClick={() => void rescan([...picked])}>
              ↻ Rescan {picked.size.toLocaleString()} picked
            </button>
          )}
          {onRescan && (
            <button className="btn btn-sm btn-ghost" disabled={busy} aria-label="Refresh notes with today's rules"
              title="Rewrites each lead's note and verdict in place from its saved CSV row, no scanner view. For every file, or the picked ones."
              onClick={() => onRescan(picked.size ? [...picked] : undefined)}>
              ↻ Refresh notes {picked.size ? "in place" : "for all files"}
            </button>
          )}
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
              {(onSetDate || onRemove || onRescan) && <th style={{ width: 210 }} />}
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
                  {(onSetDate || onRemove || onRescan) && <td />}
                </tr>,
                ...rs.map((r) => (
                  <tr key={r.file} data-file={r.file} className={picked.has(r.file) ? "is-selected" : undefined}>
                    <td><input type="checkbox" checked={picked.has(r.file)} onChange={() => toggle(r.file)} aria-label={`Pick ${r.file}`} /></td>
                    <td>
                      <button className="btn btn-sm btn-ghost" style={{ padding: 0, textAlign: "left" }} title="Open just this file in Leads" onClick={() => open([r.file])}>{r.file}</button>
                    </td>
                    <td>
                      {editing?.file === r.file ? (
                        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                          <input type="date" className="field" aria-label={`Date for ${r.file}`} value={editing.date} min="2025-10-01"
                            onChange={(e) => setEditing({ file: r.file, date: e.target.value })} style={{ padding: "2px 4px" }} />
                          <button className="btn btn-sm btn-primary" disabled={!editing.date} aria-label={`Save date for ${r.file}`}
                            onClick={() => { onSetDate?.(r.file, editing.date); setEditing(null); }}>Save</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                        </span>
                      ) : r.date ? <>{`${isPreMaySheet(r.file) && !fileDateOverrideOf(r.file) ? "~" : ""}${r.date.slice(5).replace("-", "/")}/${r.date.slice(2, 4)}`}
                          {fileDateOverrideOf(r.file) && <span className="muted" title="Date set by hand" style={{ fontSize: 11 }}> · set</span>}</>
                        : <span className="muted">—</span>}
                    </td>
                    <td>{r.sources.map((s) => LEAD_SOURCE_META[s].label).join(", ")}</td>
                    <td className="num">{r.total.toLocaleString()}</td>
                    <td className="num">{r.strong.toLocaleString()}</td>
                    <td className="num">{r.review.toLocaleString()}</td>
                    <td className="num">{r.bad.toLocaleString()}</td>
                    <td className="num">{r.checked.toLocaleString()}</td>
                    {(onSetDate || onRemove || onRescan) && (
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        {(onRescan || onRescanInScanner) && <button className="btn btn-sm btn-ghost" disabled={busy} aria-label={`Rescan ${r.file}`}
                          title={r.sources.includes("main") && onRescanInScanner ? "Open this file in the Main Scanner with today's rules, like a fresh upload" : "Rewrite this file's notes and verdicts in place with today's rules"}
                          onClick={() => void rescan([r.file])}>Rescan</button>}
                        {onSetDate && <button className="btn btn-sm btn-ghost" aria-label={`Edit date for ${r.file}`} title="Move this file (and its leads) to another date"
                          onClick={() => setEditing({ file: r.file, date: r.date || "" })}>Edit date</button>}
                        {onSetDate && fileDateOverrideOf(r.file) && <button className="btn btn-sm btn-ghost" aria-label={`Reset date for ${r.file}`} title="Back to the automatic date"
                          onClick={() => onSetDate(r.file, null)}>Reset</button>}
                        {onRemove && <button className="btn btn-sm btn-ghost" aria-label={`Delete ${r.file}`} style={{ color: "var(--danger, #b5443b)" }}
                          onClick={() => void remove(r.file)}>Delete</button>}
                      </td>
                    )}
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
