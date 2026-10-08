// Campaign oversight: every sequence, where people fall off, and which of
// those people this library actually holds.
//
// Per Jack: "i need to oversee all the email campaigns here so i need to
// have full visibility into every lead that has been added to a sequence so
// i can see where they fall off before i put it into apollo", and "so we
// already populate whats been acted on and filter through what hasnt what
// was warm and how it left off no abswer or what".
//
// THE ONE THING THIS SCREEN MUST NOT DO is present Apollo's numbers and
// this library's numbers as the same number. Apollo's funnel counts every
// contact in the sequence; the library holds only what has been scanned
// here, which is a subset and often a small one. Both are shown, labelled,
// side by side. See lib/apolloFunnel.ts.
import { useMemo, useState } from "react";
import {
  rollUpSequences, realSteps, type ApolloFunnel, type SequenceRollup,
} from "../lib/apolloFunnel";
import { outcomeSummary, type StoredLead } from "../lib/leadStore";
import { syncAgeDays, SYNC_STALE_DAYS } from "../lib/apolloSync";
import { parseCSVFile } from "../lib/csv";
import type { ParsedFile } from "../lib/detection";

const dash = <span style={{ color: "var(--muted)" }}>&mdash;</span>;

/** A step's share of the sequence's total drop-off, as a bar. The step
 *  where most enrolments END is the one that kills the sequence, so that is
 *  what is drawn — not how many are sitting there now. */
function DropBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, background: "var(--surface-sunken)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: pct >= 50 ? "#B5443B" : "var(--accent)" }} />
      </div>
      <span style={{ fontSize: 11, color: "var(--muted)", width: 34, textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

function SequenceCard({
  row, leads, onOpenLeads,
}: {
  row: SequenceRollup;
  leads: StoredLead[];
  onOpenLeads: (sequence: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const steps = realSteps(row.funnel);
  const maxFinished = steps.reduce((m, s) => Math.max(m, s.finished), 0);

  // The leads held here that are in this sequence, so the card can show
  // real names rather than only counts.
  const mine = useMemo(
    () => leads.filter((l) => (l.apollo?.sequences ?? []).some((s) => s.name === row.name)),
    [leads, row.name],
  );
  const warm = useMemo(
    () => mine.filter((l) => {
      const o = l.apollo?.outcomes ?? {};
      return ["Meeting Booked", "Info Requested", "Call Back Scheduled", "Qualified, Pending Review"]
        .some((k) => (o[k] ?? 0) > 0);
    }),
    [mine],
  );
  const neverDialled = useMemo(() => mine.filter((l) => (l.apollo?.callCount ?? 0) === 0), [mine]);

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div
        className="panel-head"
        style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
      >
        <div style={{ minWidth: 0 }}>
          <b>{open ? "▾" : "▸"} {row.name}</b>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {steps.length > 0 ? `${steps.length} steps · ` : "no funnel imported · "}
            {row.apolloActive !== null
              ? `Apollo: ${row.apolloActive.toLocaleString()} active, ${row.apolloFinished!.toLocaleString()} finished`
              : "Apollo totals not imported"}
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 12, whiteSpace: "nowrap" }}>
          <div><b>{row.held.toLocaleString()}</b> of your leads</div>
          <div style={{ color: "var(--muted)" }}>
            {row.heldActive.toLocaleString()} active · {row.heldFinished.toLocaleString()} ended
          </div>
        </div>
      </div>

      {open && (
        <div className="panel-body">
          {steps.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              No step funnel imported for this sequence, so the drop-off per step is unknown.
              Import the step-funnel CSV to fill this in.
            </div>
          ) : (
            <table className="data-table" style={{ marginBottom: 10 }}>
              <thead>
                <tr>
                  <th>Step</th><th>Type</th>
                  <th title="Apollo: contacts sitting on this step right now. A switched-off sequence reports them as paused, shown here too.">On step</th>
                  <th title="Apollo: enrolments that ENDED on this step — the fall-off">Ended here</th>
                  <th>Share of drop-off</th>
                  <th title="Calls completed at this step. Blank where Apollo had not finished computing it.">Calls</th>
                  <th>Top outcome</th>
                  <th title="Leads in THIS library that stopped at this step">Yours</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.position}>
                    <td>{s.position}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{s.type || dash}</td>
                    <td>
                      {(s.active + s.paused).toLocaleString()}
                      {s.paused > 0 && (
                        <span style={{ color: "var(--muted)", fontSize: 11 }} title="paused, not active — this sequence is switched off in Apollo">
                          {" "}paused
                        </span>
                      )}
                    </td>
                    <td><b>{s.finished.toLocaleString()}</b></td>
                    <td><DropBar value={s.finished} max={maxFinished} /></td>
                    <td>{s.callsCompleted === null
                      ? <span style={{ color: "var(--muted)" }} title="Apollo had not finished computing this">not ready</span>
                      : s.callsCompleted.toLocaleString()}</td>
                    <td style={{ fontSize: 12 }}>{s.topOutcome || dash}</td>
                    <td>{(row.heldByStep.get(s.position) || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {row.heldByStep.get(0) ? (
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {row.heldByStep.get(0)!.toLocaleString()} of your leads in this sequence carry no step in the
              sync, so they are not placed above. They are counted in the totals, not assigned to step 1.
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, marginBottom: 8 }}>
            <span><b>{warm.length.toLocaleString()}</b> warm — booked, info requested or call back scheduled</span>
            <span><b>{neverDialled.length.toLocaleString()}</b> never dialled</span>
            <button className="btn btn-sm btn-ghost" onClick={() => onOpenLeads(row.name)}>
              Open these leads →
            </button>
          </div>

          {warm.length > 0 && (
            <div>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 4 }}>
                Warm, in this sequence
              </div>
              <div style={{ maxHeight: 180, overflowY: "auto" }}>
                {warm.slice(0, 50).map((l) => (
                  <div key={l.key} style={{ fontSize: 12, padding: "2px 0" }}>
                    <b>{l.company || "—"}</b> · {l.contact || "—"}
                    <span style={{ color: "var(--muted)" }}> · {outcomeSummary(l.apollo)}</span>
                  </div>
                ))}
                {warm.length > 50 && (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>…and {warm.length - 50} more.</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Campaigns({
  leads, funnels, onImportFunnels, onOpenLeads,
}: {
  leads: StoredLead[];
  funnels: ApolloFunnel[];
  onImportFunnels?: (files: ParsedFile[]) => Promise<{ funnels: number; steps: number; unmapped: string[]; skipped: number }>;
  onOpenLeads: (sequence: string) => void;
}) {
  const rows = useMemo(() => rollUpSequences(leads, funnels), [leads, funnels]);
  const ageDays = useMemo(() => syncAgeDays(leads), [leads]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  async function importFunnels(files: FileList | null) {
    if (!files?.length || !onImportFunnels || busy) return;
    setBusy(true);
    setReport(null);
    try {
      const parsed = await Promise.all([...files].map((f) => parseCSVFile(f)));
      const r = await onImportFunnels(parsed as ParsedFile[]);
      setReport(
        `${r.funnels} sequence${r.funnels === 1 ? "" : "s"}, ${r.steps} steps imported.`
        + (r.skipped ? ` ${r.skipped} row${r.skipped === 1 ? "" : "s"} had no sequence name or step number and were skipped.` : "")
        + (r.unmapped.length ? ` Unmapped columns, ignored rather than guessed at: ${r.unmapped.join(", ")}.` : ""),
      );
    } catch (e) {
      setReport(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const totalHeld = rows.reduce((a, r) => a + r.held, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Campaigns</h2>
          <p className="page-sub">
            Every sequence, where people fall off, and which of them you hold here.
          </p>
        </div>
        {onImportFunnels && (
          <label className="btn btn-sm btn-secondary" style={{ cursor: busy ? "default" : "pointer" }}
                 title="Import the per-step funnel exported from Apollo (Sequence, Step, Type, Active, Finished, …).">
            {busy ? "Reading…" : "⬆ Import step funnel"}
            <input type="file" accept=".csv,text/csv" multiple hidden disabled={busy}
                   onChange={(e) => { importFunnels(e.target.files); e.target.value = ""; }} />
          </label>
        )}
      </div>

      {report && (
        <div style={{ marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>
          {report}
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: 6 }} onClick={() => setReport(null)}>Dismiss</button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="panel"><div className="panel-body">
          <p style={{ margin: 0 }}>
            No sequences yet. Two things fill this screen, and they are separate imports:
            the <b>step funnel</b> (Apollo's own per-step counts, imported here) and the{" "}
            <b>lead sync</b> (which of your stored leads sits where, imported from All leads).
            Either one alone is useful; together they show the funnel and the people in it.
          </p>
        </div></div>
      ) : (
        <>
          <div style={{ marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>
            {rows.length} sequence{rows.length === 1 ? "" : "s"} · {totalHeld.toLocaleString()} enrolment
            {totalHeld === 1 ? "" : "s"} across leads you hold
            {ageDays === null
              ? " · leads not synced yet, so every sequence below reads empty on your side"
              : ageDays > SYNC_STALE_DAYS
                ? ` · lead sync is ${ageDays} days old and stale`
                : ` · lead sync ${ageDays === 0 ? "today" : `${ageDays}d ago`}`}
          </div>
          {rows.map((r) => (
            <SequenceCard key={r.name} row={r} leads={leads} onOpenLeads={onOpenLeads} />
          ))}
        </>
      )}
    </>
  );
}
