import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseCSVFile, toCSV, downloadBlob } from "../lib/csv";
import {
  scan2, profileColumns, reconciles, emptyRuleSet, makeRule, guessFieldMapping,
  loadRuleSets, saveRuleSet, loadRuns, saveRun, deleteRun, buildRun,
  loadCuration, setCuration, clearCuration, isDefaultDropColumn, guessNotesColumns, guessCampaignColumns,
  toApolloRow, productLineStyle,
  BUCKET2_ORDER, BUCKET2_META, LEAD_FIELDS, bucketMetaFor, curationMetaFor, CURATION_TO_BUCKET,
  type RuleSet2, type Rule2, type Bucket2, type Scan2Result, type ColumnProfile, type Run2,
  type FieldMapping, type LeadField, type Curation, type CurationRecord, type Row2,
  type ScannerKind, type Scanner2ExportRow, reconcileCspColumns, exportLabelsFor,
} from "../lib/scanner2";
import type { LeadList } from "../lib/leadLists";
import { POSTURE_META, DEFAULT_CSP_RULES, resolveCspRules, CSP_COLUMN_HINTS, cspPartnerLabel, compareCspLeads, BILLING_META, WEIGHT_META, type CspRules, type CspWeights, type PartnerPosture, type BillingQuality } from "../lib/cspRenewal";
import {
  SMC_PRODUCTS, SMC_STAGES, salesGaps, resolveSmcRules, DEFAULT_SMC_RULES,
  type SmcProduct, type ProductLine, type SmcRules, type SmcStage,
} from "../lib/smcLead";

const PAGE = 25;

/** YYYY-MM-DD for `n` days ago in the viewer's own calendar. */
function daysAgoKey(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The panels below are module-level on purpose. Defined inside Scanner2
// they became a NEW component type on every parent render, so React
// remounted them — the rules checkbox was destroyed mid-click and any
// half-typed rule text would vanish on a rescan.
type Ctx = {
  persist: (next: RuleSet2) => Promise<RuleSet2>;
  /** Optimistic: put the change on screen and rescan NOW, save after.
   *  A controlled checkbox that waits for IndexedDB before it flips reads
   *  as broken — it repaints with the old value first. */
  applyNow: (next: RuleSet2) => void;
  rescan: (withSet: RuleSet2) => void;
  profiles: ColumnProfile[];
  result: Scan2Result | null;
  showRules: boolean;
  setShowRules: React.Dispatch<React.SetStateAction<boolean>>;
};

/**
 * Bring an older rule set's column mapping up to date without discarding
 * anything chosen by hand. Returns the repaired mapping plus a plain-English
 * list of what moved, so the change is visible rather than silent.
 */
function repairFieldMapping(
  current: FieldMapping,
  profiles: ColumnProfile[],
): { fields: FieldMapping; changes: string[] } {
  const fresh = guessFieldMapping(profiles);
  const present = new Set(profiles.map((p) => p.name));
  const fields: FieldMapping = { ...current };
  const changes: string[] = [];
  const fillRate = new Map(profiles.map((p) => [p.name, p.fillRate]));
  for (const { key, label } of LEAD_FIELDS) {
    if (key === "notes") continue; // notes has its own multi-select
    const now = fields[key];
    const want = fresh[key];
    if (!want || want === now) continue;
    const neverMapped = !now;
    const missing = !!now && !present.has(now);
    const noise = !!now && isDefaultDropColumn(now);
    // A field pointing at a column that is empty in THIS file, when a better
    // candidate actually has data, is a stale guess rather than a choice —
    // nobody deliberately maps Email to a column with nothing in it. This is
    // what left name / title / email / phone blank on screen.
    const pointsAtEmpty = !!now && (fillRate.get(now) ?? 0) === 0 && (fillRate.get(want) ?? 0) > 0;
    if (neverMapped || missing || noise || pointsAtEmpty) {
      fields[key] = want;
      changes.push(`${label} → ${want}`);
    }
  }

  // Filling a never-mapped field can collide with an older field sitting on
  // the same column: a rule set saved before Mobile phone existed had the
  // work-phone field pointing at "mobilephone", so both ended up there and
  // the download printed the same number twice. Whichever field the fresh
  // guess actually wants keeps the column; the other moves to its own
  // guess, or is cleared rather than left duplicating.
  const labelOf = (k: LeadField) => LEAD_FIELDS.find((f) => f.key === k)?.label ?? k;
  const byColumn = new Map<string, LeadField[]>();
  for (const { key } of LEAD_FIELDS) {
    if (key === "notes") continue;
    const col = fields[key];
    if (col) byColumn.set(col, [...(byColumn.get(col) ?? []), key]);
  }
  for (const [col, keys] of byColumn) {
    if (keys.length < 2) continue;
    const owner = keys.find((k) => fresh[k] === col) ?? keys[0];
    for (const k of keys) {
      if (k === owner) continue;
      const taken = new Set(Object.values(fields).filter(Boolean) as string[]);
      const alt = fresh[k];
      if (alt && !taken.has(alt)) {
        fields[k] = alt;
        changes.push(`${labelOf(k)} → ${alt}`);
      } else {
        delete fields[k];
        changes.push(`${labelOf(k)} → none (was duplicating ${col})`);
      }
    }
  }
  return { fields, changes };
}

// --------------------------------------------------------- field mapping
function FieldMap({ set, ctx }: { set: RuleSet2; ctx: Ctx }) {
const { persist, rescan, profiles } = ctx;
  const names = profiles.map((p) => p.name);
  if (names.length === 0) return null;
  async function setField(k: LeadField, col: string) {
    const fields: FieldMapping = { ...(set.fields ?? {}) };
    if (col) fields[k] = col; else delete fields[k];
    rescan(await persist({ ...set, fields }));
  }
  const identityFields = LEAD_FIELDS.filter((f) => f.key !== "notes");
  const mappedCount = identityFields.filter((f) => (set.fields ?? {})[f.key]).length;
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div className="panel-title">Which column is what</div>
          <div className="panel-sub">
            Guessed from the file, {mappedCount} of {identityFields.length} mapped. Correct anything wrong — your
            choice is saved and a later upload will not overwrite it.
          </div>
        </div>
        <button
          className="btn btn-sm btn-secondary"
          aria-label="Re-guess columns"
          style={{ whiteSpace: "nowrap" }}
          title="Throw away the saved mapping and guess every field again from this file. Use it if the download has the wrong data under the right headings."
          onClick={async () => rescan(await persist({ ...set, fields: guessFieldMapping(profiles) }))}
        >
          ↻ Re-guess columns
        </button>
      </div>
      <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Lead format</span>
        <select
          className="field"
          aria-label="Lead format"
          value={set.mode ?? "smc"}
          onChange={async (e) => rescan(await persist({ ...set, mode: e.target.value as "smc" | "keywords" }))}
        >
          <option value="smc">Microsoft SMC / Cloud Ascent</option>
          <option value="keywords">Plain CSV — keyword rules</option>
        </select>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {(set.mode ?? "smc") === "smc"
            ? "Parses the description blob and campaign code, scores on propensity vs what they already own."
            : "Classifies rows with the keyword rules below."}
        </span>
      </div>
      <div className="panel-body" style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {identityFields.map(({ key, label }) => {
          const col = (set.fields ?? {})[key] ?? "";
          const prof = profiles.find((pp) => pp.name === col);
          // How full the chosen column actually is. A field pointing at an
          // empty column is the difference between "the scanner lost my
          // data" and "this column is empty in the file" — and an empty
          // column is also why Apollo's importer does not offer it.
          const pct = prof ? Math.round(prof.fillRate * 100) : null;
          const warn = col !== "" && pct === 0;
          return (
            <label key={key} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
              <span style={{ color: "var(--muted)", fontWeight: 600 }}>{label}</span>
              <select
                className="field"
                style={warn ? { borderColor: "#B5443B" } : undefined}
                value={col}
                onChange={(e) => setField(key, e.target.value)}
                aria-label={`${label} column`}
              >
                <option value="">— none —</option>
                {names.map((c) => {
                  const p = profiles.find((pp) => pp.name === c);
                  const f = p ? Math.round(p.fillRate * 100) : 0;
                  return <option key={c} value={c}>{c} — {f}% filled</option>;
                })}
              </select>
              <span
                aria-label={`${label} fill`}
                style={{ fontSize: 11, color: warn ? "#B5443B" : "var(--muted)", fontWeight: warn ? 700 : 400 }}
                title={warn ? "This column is empty in the uploaded file, so this field exports blank — and Apollo will not offer it on import." : undefined}
              >
                {col === "" ? "not mapped — exports blank" : `${pct}% filled${warn ? " — empty in this file" : ""}`}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** The one-line statement of what currently counts as Strong Signal.
 *  Shared by the collapsed Scan setup bar and the rules panel itself, so
 *  the summary can never drift from the panel it summarises. */
function ruleSentence(set: RuleSet2): string {
  if (set.mode === "csp") {
    const c = resolveCspRules(set.cspRules);
    const w = c.weights;
    const top = WEIGHT_META.slice().sort((a, b) => w[b.key] - w[a.key]).slice(0, 3).map((m) => m.label.toLowerCase()).join(", ");
    return `Score 0\u2013100 \u00b7 High at ${c.strongAt}+, Medium at ${c.reviewAt}+ \u00b7 weighted on ${top} first` +
      ` \u00b7 dead language \u2212${c.deadLatestPenalty} in the newest entry, \u2212${c.deadOlderPenalty} older` +
      ` \u00b7 untouched ${c.staleDays}+ days \u2212${c.stalePenalty}${c.hardStopDead ? " \u00b7 dead newest entry is a hard stop" : ""}`;
  }
  if ((set.mode ?? "smc") !== "smc") {
    const n = set.rules.filter((r) => r.enabled && r.keywords.length).length;
    return `Plain CSV — ${n} keyword rule${n === 1 ? "" : "s"} in force`;
  }
  const r = resolveSmcRules(set.smcRules);
  return `Strong Signal = ${r.stages.join(" or ") || "no stage"} · at least ${r.minFit} Fit` +
    `${r.requireNotOwned ? " · not already owned" : ""} · on ${r.lines.join(" / ") || "no line"}` +
    `${r.hotWordsPushStrong && r.hotWords.length ? ` · or ${r.hotWords.join("/")} language` : ""}` +
    `${r.highIndexPushesStrong ? " · or High prioritization index" : ""}${r.bantPushesStrong ? " · or real BANT" : ""}` +
    `${(r.notSupported ?? []).length ? ` · never ${r.notSupported.join("/")} (Bad Lead)` : ""}` +
    `${(r.largeOnly ?? []).length ? ` · ${r.largeOnly.join("/")} only if large (Needs Review)` : ""}`;
}

// ------------------------------------------------------- CSP renewal rules
// A renewal is qualified on timing, not intent, so the knobs are the
// windows themselves. Defaults are the behaviour that shipped first, so an
// untouched panel changes nothing.
function CspRenewalRules({ set, ctx, profiles }: { set: RuleSet2; ctx: Ctx; profiles: ColumnProfile[] }) {
  const { persist, rescan } = ctx;
  const rules = resolveCspRules(set.cspRules);
  async function patch(p: Partial<CspRules>) {
    rescan(await persist({ ...set, cspRules: { ...rules, ...p } }));
  }
  const isDefault = JSON.stringify(rules) === JSON.stringify(DEFAULT_CSP_RULES);
  const row: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 12.5, marginBottom: 10 };
  const lab: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", minWidth: 128 };
  const numBox: React.CSSProperties = { width: 84 };
  // A positive whole number only. An empty box is a mid-edit state, not an
  // instruction to set the window to zero.
  const int = (v: string, fallback: number) => {
    const n = Number(v);
    return v.trim() === "" || !Number.isFinite(n) || n < 0 ? fallback : Math.floor(n);
  };
  const cols = profiles.map((p) => p.name);
  const mapped = (set.cspColumns ?? {}) as Record<string, string | undefined>;
  // What the engine is actually reading: the saved pick when it is still in
  // the file, else the fresh guess — the same resolution scan2 applies.
  const effective = reconcileCspColumns(set.cspColumns, cols) as Record<string, string | undefined>;
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <div className="panel-title">CSP scoring rules</div>
        <div className="panel-sub">{ruleSentence(set)}{isDefault ? " \u00b7 defaults" : " \u00b7 edited"}</div>
      </div>
      <div className="panel-body">
        <div style={row}>
          <span style={lab}>Tiers</span>
          <span>Strong Signal at a score of</span>
          <input className="field" style={numBox} type="number" min={0} max={100} value={rules.strongAt}
            onChange={(e) => patch({ strongAt: int(e.target.value, rules.strongAt) })} />
          <span>or more {"\u00b7"} Needs review from</span>
          <input className="field" style={numBox} type="number" min={0} max={100} value={rules.reviewAt}
            onChange={(e) => patch({ reviewAt: int(e.target.value, rules.reviewAt) })} />
          <span style={{ color: "var(--muted)" }}>{"\u00b7"} below that is a Bad lead</span>
        </div>
        <div style={row}>
          <span style={lab}>Stale</span>
          <span>untouched for more than</span>
          <input className="field" style={numBox} type="number" min={1} value={rules.staleDays}
            onChange={(e) => patch({ staleDays: int(e.target.value, rules.staleDays) })} />
          <span>days costs</span>
          <input className="field" style={numBox} type="number" min={0} max={100} value={rules.stalePenalty}
            onChange={(e) => patch({ stalePenalty: int(e.target.value, rules.stalePenalty) })} />
          <span>points</span>
        </div>
        <div style={row}>
          <span style={lab}>Dead language</span>
          <span title="Closed lost, no-show, unresponsive, not interested, opportunity not valid">in the newest seller entry costs</span>
          <input className="field" style={numBox} type="number" min={0} max={100} value={rules.deadLatestPenalty}
            onChange={(e) => patch({ deadLatestPenalty: int(e.target.value, rules.deadLatestPenalty) })} />
          <span>points {"\u00b7"} in an older entry only</span>
          <input className="field" style={numBox} type="number" min={0} max={100} value={rules.deadOlderPenalty}
            onChange={(e) => patch({ deadOlderPenalty: int(e.target.value, rules.deadOlderPenalty) })} />
          <span>points</span>
          <label className="toolbar-check" title="The old behaviour: a dead newest entry forces Low priority regardless of score. Off by default so every lead is scored on its merits.">
            <input type="checkbox" checked={rules.hardStopDead}
              onChange={(e) => patch({ hardStopDead: e.target.checked })} />
            hard stop {"\u2192"} Low
          </label>
        </div>
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 10 }}>
          <div style={{ ...lab, minWidth: 0, marginBottom: 6 }}>
            Scoring weights {"\u00b7"} {Object.values(rules.weights).reduce((a, b) => a + b, 0)} points, normalised to 100
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {WEIGHT_META.map((m) => (
              <label key={m.key} title={m.hint} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, minWidth: 120 }}>
                <span style={{ fontWeight: 600 }}>{m.label}</span>
                <input className="field" style={{ width: 84 }} type="number" min={0} max={100} value={rules.weights[m.key]}
                  onChange={(e) => patch({ weights: { ...rules.weights, [m.key]: int(e.target.value, rules.weights[m.key]) } })} />
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
            Each factor scores a share of its weight {"\u2014"} partner lane: No Partner Assigned is full marks; billing: annual new upfront is full marks; notes: "wants a partner" counts most, then a booked meeting, then pricing talk.
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 10 }}>
          <div style={{ ...lab, minWidth: 0, marginBottom: 6 }}>Which column is what</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {(Object.keys(CSP_COLUMN_HINTS) as string[]).map((k) => {
              const cur = mapped[k] ?? "";
              const eff = effective[k] ?? "";
              const prof = profiles.find((pp) => pp.name === eff);
              const pct = prof ? Math.round(prof.fillRate * 100) : 0;
              return (
                <label key={k} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{CSP_FIELD_LABELS[k] ?? k}</span>
                  <select
                    className="field"
                    style={{ minWidth: 190, borderColor: eff && pct === 0 ? "#B5443B" : undefined }}
                    value={cur}
                    onChange={async (e) => {
                      const v = e.target.value;
                      const next = { ...mapped } as Record<string, string | undefined>;
                      if (v) next[k] = v; else delete next[k];
                      rescan(await persist({ ...set, cspColumns: next }));
                    }}
                  >
                    <option value="">auto {"\u2014"} {eff || "not found"}</option>
                    {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    {eff ? `${pct}% filled${cur ? "" : " (auto)"}` : "not mapped \u2014 reads blank"}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------ priority breakdown
// The chart Jack asked for. Form: a DISTRIBUTION (score histogram) plus
// three magnitude tiles and a drivers table. Colour is the band's status
// colour and is never the only encoding — every tile and bar has its label
// and count in text, Medium bars are hatched (the amber/red pair is too
// close for deuteranopes, per the palette validator), and the two threshold
// lines are drawn and labelled so moving a threshold visibly moves the cut.
function PriorityBreakdown({ rows, rules, meta, effBucket }: {
  rows: Row2[];
  rules: CspRules;
  meta: Record<Bucket2, { label: string; color: string; bg: string }>;
  effBucket: (r: Row2) => Bucket2;
}) {
  const scored = rows.filter((r) => r.csp);
  const total = scored.length || 1;
  const bands: Bucket2[] = ["priority", "review", "excluded"];
  const counts: Record<Bucket2, number> = { priority: 0, review: 0, excluded: 0, unmatched: 0 };
  const sums: Record<Bucket2, Record<keyof CspWeights, number> & { penalty: number; score: number }> = {
    priority: { lane: 0, billing: 0, recency: 0, notes: 0, value: 0, contact: 0, penalty: 0, score: 0 },
    review: { lane: 0, billing: 0, recency: 0, notes: 0, value: 0, contact: 0, penalty: 0, score: 0 },
    excluded: { lane: 0, billing: 0, recency: 0, notes: 0, value: 0, contact: 0, penalty: 0, score: 0 },
    unmatched: { lane: 0, billing: 0, recency: 0, notes: 0, value: 0, contact: 0, penalty: 0, score: 0 },
  };
  const hist = new Array<number>(10).fill(0);
  let overridden = 0;
  for (const r of scored) {
    const b = effBucket(r);
    if (b !== r.bucket) overridden++;
    counts[b]++;
    const c = r.csp!;
    for (const k of Object.keys(c.factorPoints) as (keyof CspWeights)[]) sums[b][k] += c.factorPoints[k];
    sums[b].penalty += c.penaltyPoints;
    sums[b].score += c.score;
    hist[Math.min(9, Math.floor(c.score / 10))]++;
  }
  const maxBar = Math.max(1, ...hist);
  const bandOfBucket = (lo: number): Bucket2 => (lo + 9 >= rules.strongAt && lo >= rules.strongAt ? "priority" : lo + 9 < rules.reviewAt ? "excluded" : lo >= rules.reviewAt ? "review" : lo + 9 >= rules.strongAt ? "priority" : "review");
  const avg = (b: Bucket2, k: keyof CspWeights | "penalty" | "score") => (counts[b] ? Math.round(sums[b][k] / counts[b]) : 0);
  const hatch = (color: string) => `repeating-linear-gradient(135deg, ${color} 0 3px, transparent 3px 6px)`;
  const label: React.CSSProperties = { fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600 };
  // Collapsed by default, per Jack. The three band counts stay in the
  // header so the only numbers that matter are always on screen; the arrow
  // opens the chart and the drivers table for when you want the why.
  const [open, setOpen] = useState(false);
  return (
    <div className="panel" style={{ marginBottom: 14 }} aria-label="Priority breakdown">
      <div className="panel-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn btn-sm btn-ghost"
          aria-label="Toggle priority breakdown"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 6px" }}
        >
          <span aria-hidden="true">{open ? "\u25be" : "\u25b8"}</span>
          <span className="panel-title" style={{ margin: 0 }}>Priority breakdown</span>
        </button>
        <div className="panel-sub" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", margin: 0 }}>
          {bands.map((b) => (
            <span key={b} aria-label={`${meta[b].label} count`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: b === "review" ? hatch(meta[b].color) : meta[b].color, outline: b === "review" ? `1px solid ${meta[b].color}` : undefined, outlineOffset: -1 }} />
              <b style={{ color: meta[b].color }}>{counts[b].toLocaleString()}</b> {meta[b].label.replace(" priority", "")}
            </span>
          ))}
          <span>{"\u00b7"} {scored.length.toLocaleString()} scored{overridden ? ` \u00b7 ${overridden} overridden` : ""}</span>
        </div>
      </div>
      {open && (
      <div className="panel-body" style={{ display: "grid", gap: 16 }}>
        {/* Tiles: magnitude per band, label + count + share always in text. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          {[...bands, ...(counts.unmatched ? (["unmatched"] as Bucket2[]) : [])].map((b) => (
            <div key={b} className="kpi" style={{ borderLeftColor: meta[b].color }} title={`${counts[b].toLocaleString()} of ${scored.length.toLocaleString()} leads \u00b7 average score ${avg(b, "score")}`}>
              <div className="kpi-label">{meta[b].label}</div>
              <div className="kpi-value" style={{ color: meta[b].color }} aria-label={`${meta[b].label} count`}>{counts[b].toLocaleString()}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{Math.round((100 * counts[b]) / total)}% {"\u00b7"} avg score {avg(b, "score")}</div>
            </div>
          ))}
        </div>

        {/* Distribution: one bar per 10 points, coloured by the band that
            bucket falls in under the CURRENT thresholds. */}
        <div>
          <div style={{ ...label, marginBottom: 6 }}>Where the scores fall</div>
          <div style={{ position: "relative", height: 112, paddingTop: 18, boxSizing: "border-box", display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 2, alignItems: "end", borderBottom: "1px solid var(--border)" }} role="img" aria-label="Score histogram in ten-point buckets">
            {hist.map((n, i) => {
              const lo = i * 10, hi = i === 9 ? 100 : lo + 9;
              const b = bandOfBucket(lo);
              const h = Math.max(n ? 3 : 0, Math.round((88 * n) / maxBar));
              return (
                <div key={i} title={`${lo}\u2013${hi}: ${n.toLocaleString()} lead${n === 1 ? "" : "s"} \u00b7 ${meta[b].label}`}
                     style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }}>
                  {n > 0 && n >= maxBar * 0.35 && <span style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 2 }}>{n.toLocaleString()}</span>}
                  <div aria-label={`${lo} to ${hi}: ${n}`} style={{
                    width: "100%", height: h, borderRadius: "4px 4px 0 0",
                    background: b === "review" ? hatch(meta[b].color) : meta[b].color,
                    outline: b === "review" ? `1px solid ${meta[b].color}` : undefined, outlineOffset: -1,
                  }} />
                </div>
              );
            })}
            {/* Threshold lines, drawn and labelled — not colour-only. */}
            {[{ at: rules.reviewAt, text: `Medium ${rules.reviewAt}+`, b: "review" as Bucket2 }, { at: rules.strongAt, text: `High ${rules.strongAt}+`, b: "priority" as Bucket2 }].map((t) => (
              <div key={t.text} style={{ position: "absolute", left: `${t.at}%`, top: 16, bottom: 0, borderLeft: `2px dashed ${meta[t.b].color}`, pointerEvents: "none" }}>
                <span style={{ position: "absolute", top: -16, left: 4, fontSize: 10.5, fontWeight: 600, color: meta[t.b].color, whiteSpace: "nowrap" }}>{t.text}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 2, marginTop: 4 }}>
            {hist.map((_, i) => <div key={i} style={{ fontSize: 10, color: "var(--muted)", textAlign: "center" }}>{i * 10}</div>)}
          </div>
        </div>

        {/* Drivers: average points each factor contributed, per band. This
            is the table view of the whole panel — every number in text. */}
        <div style={{ overflowX: "auto" }}>
          <div style={{ ...label, marginBottom: 6 }}>What drives each band {"\u00b7"} average points per lead</div>
          <table className="data-table" aria-label="Priority drivers" style={{ fontSize: 12, width: "100%" }}>
            <thead><tr><th style={{ textAlign: "left" }}>Factor</th>{bands.map((b) => <th key={b} style={{ textAlign: "right", color: meta[b].color }}>{meta[b].label}</th>)}</tr></thead>
            <tbody>
              {WEIGHT_META.map((m) => (
                <tr key={m.key} title={m.hint}>
                  <td>{m.label} <span style={{ color: "var(--muted)" }}>/ {Math.round((100 * rules.weights[m.key]) / Math.max(1, Object.values(rules.weights).reduce((a, x) => a + x, 0)))}</span></td>
                  {bands.map((b) => (
                    <td key={b} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ display: "inline-block", width: 36, height: 6, borderRadius: 3, background: "var(--surface-sunken)", marginRight: 6, verticalAlign: "middle", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${Math.min(100, (100 * avg(b, m.key)) / Math.max(1, Math.round((100 * rules.weights[m.key]) / Math.max(1, Object.values(rules.weights).reduce((a, x) => a + x, 0)))))}%`, background: meta[b].color, borderRadius: 3 }} />
                      </span>
                      {avg(b, m.key)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr title="Dead language in the notes, and untouched past the stale cutoff">
                <td>Penalties</td>
                {bands.map((b) => <td key={b} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: avg(b, "penalty") ? "#B5443B" : undefined }}>{avg(b, "penalty") ? `\u2212${avg(b, "penalty")}` : "0"}</td>)}
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>Average score</td>
                {bands.map((b) => <td key={b} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{avg(b, "score")}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

const CSP_FIELD_LABELS: Record<string, string> = {
  program: "Licensing programme",
  value: "Estimated value",
  rollupValue: "Roll-up revenue",
  partner: "Partner of record",
};


// ------------------------------------------------- Strong Signal rules
// What pushes an SMC lead to Strong Signal is Jack's call, so every
// knob is here. Defaults are the behaviour that shipped first, so an
// untouched panel changes nothing.
function StrongSignalRules({ set, ctx }: { set: RuleSet2; ctx: Ctx }) {
const { persist, rescan } = ctx;
  const rules = resolveSmcRules(set.smcRules);
  async function patch(p: Partial<SmcRules>) {
    rescan(await persist({ ...set, smcRules: { ...rules, ...p } }));
  }
  const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const stages = SMC_STAGES.filter((st) => st !== "Unknown") as SmcStage[];
  const lines: ProductLine[] = ["Dynamics 365", "M365 / Azure"];
  const isDefault = JSON.stringify(rules) === JSON.stringify(DEFAULT_SMC_RULES);
  const sentence = ruleSentence(set);
  const [hotDraft, setHotDraft] = useState(rules.hotWords.join(", "));
  useEffect(() => { setHotDraft(rules.hotWords.join(", ")); }, [rules.hotWords.join("|")]);
  const [noDraft, setNoDraft] = useState((rules.notSupported ?? []).join(", "));
  useEffect(() => { setNoDraft((rules.notSupported ?? []).join(", ")); }, [(rules.notSupported ?? []).join("|")]);
  const [largeDraft, setLargeDraft] = useState((rules.largeOnly ?? []).join(", "));
  useEffect(() => { setLargeDraft((rules.largeOnly ?? []).join(", ")); }, [(rules.largeOnly ?? []).join("|")]);
  const words = (v: string) => v.split(",").map((w) => w.trim()).filter(Boolean);
  const row: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 12.5 };
  const lab: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", minWidth: 120 };
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div className="panel-title">Strong Signal rules</div>
          <div className="panel-sub">{sentence}</div>
        </div>
        <button className="btn btn-sm btn-ghost" disabled={isDefault} onClick={() => patch(DEFAULT_SMC_RULES)}>Reset to defaults</button>
      </div>
      <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={row}>
          <span style={lab}>Stage counts</span>
          {stages.map((st) => (
            <label key={st} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <input type="checkbox" aria-label={`Stage ${st}`} checked={rules.stages.includes(st)} onChange={() => patch({ stages: toggleIn(rules.stages, st) })} />{st}
            </label>
          ))}
        </div>
        <div style={row}>
          <span style={lab}>Minimum fit</span>
          <select className="field" aria-label="Minimum fit" value={rules.minFit} onChange={(e) => patch({ minFit: e.target.value as SmcRules["minFit"] })}>
            {(["High", "Medium", "Low", "Very Low"] as SmcRules["minFit"][]).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }} title="The whitespace test: only count a product they do not already have">
            <input type="checkbox" aria-label="Require not already owned" checked={rules.requireNotOwned} onChange={(e) => patch({ requireNotOwned: e.target.checked })} />
            must not already own it
          </label>
        </div>
        <div style={row}>
          <span style={lab}>Product lines</span>
          {lines.map((l) => (
            <label key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <input type="checkbox" aria-label={`Line ${l}`} checked={rules.lines.includes(l)} onChange={() => patch({ lines: toggleIn(rules.lines, l) })} />{l}
            </label>
          ))}
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>D365 F&amp;O / Supply Chain and Surface are shown for context but never qualify — Wired CIO does not support those platforms.</span>
        </div>
        <div style={row}>
          <span style={lab}>Also push Strong</span>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <input type="checkbox" aria-label="High prioritization index pushes Strong Signal" checked={rules.highIndexPushesStrong} onChange={(e) => patch({ highIndexPushesStrong: e.target.checked })} />
            High prioritization index on a sold line
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <input type="checkbox" aria-label="BANT pushes Strong Signal" checked={rules.bantPushesStrong} onChange={(e) => patch({ bantPushesStrong: e.target.checked })} />
            A real Need or Authority on file
          </label>
        </div>
        <div style={row}>
          <span style={lab}>Oldest fiscal year</span>
          <input
            className="field"
            type="number"
            aria-label="Oldest fiscal year"
            style={{ width: 72 }}
            value={set.smcMinFiscalYear ?? 25}
            onChange={async (e) => {
              const raw = e.target.value.trim();
              const n = Number(raw);
              // An empty field is a mid-edit state, not "fiscal year 0" —
              // accepting 0 turned the stale-campaign rule off with nothing
              // on screen saying the rule had changed.
              if (raw === "" || !Number.isFinite(n) || n < 1) return;
              rescan(await persist({ ...set, smcMinFiscalYear: n }));
            }}
          />
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>A campaign older than this fiscal year makes the lead a Bad Lead.</span>
        </div>
        <div style={row}>
          <span style={lab}>Hot words</span>
          <label style={{ display: "flex", alignItems: "center", gap: 5 }} title="Per Jack: modernize or migrate/migration are strong indicators of great opps">
            <input type="checkbox" aria-label="Hot words push Strong Signal" checked={rules.hotWordsPushStrong} onChange={(e) => patch({ hotWordsPushStrong: e.target.checked })} />
            in the campaign name, BANT need, or notes
          </label>
          <input
            className="field"
            aria-label="Hot words"
            style={{ flex: 1, minWidth: 260 }}
            value={hotDraft}
            placeholder="modernize, modernization, migrate, migration"
            onChange={(e) => setHotDraft(e.target.value)}
            onBlur={() => patch({ hotWords: words(hotDraft) })}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
        </div>
        <div style={row}>
          <span style={lab}>Not supported</span>
          <input
            className="field"
            aria-label="Not supported products"
            style={{ width: 220 }}
            value={noDraft}
            placeholder="fabric"
            onChange={(e) => setNoDraft(e.target.value)}
            onBlur={() => patch({ notSupported: words(noDraft) })}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>A campaign or BANT need aimed at one of these is a Bad Lead, and a hot word next to it does not count.</span>
        </div>
        <div style={row}>
          <span style={lab}>Large opps only</span>
          <input
            className="field"
            aria-label="Large-only products"
            style={{ width: 220 }}
            value={largeDraft}
            placeholder="power bi"
            onChange={(e) => setLargeDraft(e.target.value)}
            onBlur={() => patch({ largeOnly: words(largeDraft) })}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Never auto-Strong — lands in Needs Review so you judge the size.</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- rules UI
function RuleEditor({ set, ctx }: { set: RuleSet2; ctx: Ctx }) {
const { persist, rescan, profiles, result, showRules, setShowRules } = ctx;
  const [label, setLabel] = useState("");
  const [kw, setKw] = useState("");
  const [bucket, setBucket] = useState<Rule2["bucket"]>("priority");
  const [cols, setCols] = useState<string[]>([]);

  async function add() {
    const keywords = kw.split(",").map((s) => s.trim()).filter(Boolean);
    if (keywords.length === 0) return;
    const saved = await persist({ ...set, rules: [...set.rules, makeRule(label || keywords[0], keywords, bucket, cols)] });
    rescan(saved); setLabel(""); setKw(""); setCols([]);
  }
  async function mutate(id: string, patch: Partial<Rule2>) {
    rescan(await persist({ ...set, rules: set.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  }
  async function remove(id: string) {
    rescan(await persist({ ...set, rules: set.rules.filter((r) => r.id !== id) }));
  }
  const columnNames = profiles.length ? profiles.map((p) => p.name) : result?.columns ?? [];

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div className="panel-title">Optional keyword rules — {set.name}</div>
          <div className="panel-sub">Not needed for SMC leads — those are scored from the propensity matrix. A Bad Lead rule always wins, then Strong Signal, then Needs Review.</div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={() => setShowRules((s) => !s)}>{showRules ? "▾ Hide" : "▸ Show"}</button>
      </div>
      {showRules && (
        <div className="panel-body">
          {set.rules.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
              No keyword rules — SMC leads are scored from propensity. Add one only to override.
            </div>
          )}
          {set.rules.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
              <input type="checkbox" checked={r.enabled} onChange={(e) => mutate(r.id, { enabled: e.target.checked })} title="Enable/disable" />
              <span style={{ minWidth: 140, fontWeight: 600, fontSize: 13 }}>{r.label}</span>
              <span style={{ background: BUCKET2_META[r.bucket].bg, color: BUCKET2_META[r.bucket].color, padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                {BUCKET2_META[r.bucket].label}
              </span>
              <span style={{ flex: 1, fontSize: 12, color: "var(--muted)" }}>
                {r.requireAll ? "all of: " : "any of: "}{r.keywords.join(", ")}
                {r.columns.length > 0 && <> · in {r.columns.join(", ")}</>}
              </span>
              <label style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
                <input type="checkbox" checked={!!r.requireAll} onChange={(e) => mutate(r.id, { requireAll: e.target.checked })} />match all
              </label>
              <button className="btn btn-sm btn-ghost" onClick={() => remove(r.id)} title="Remove rule">✕</button>
            </div>
          ))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }}>
            <input className="field" placeholder="Rule name" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 140 }} />
            <input className="field" placeholder="keywords, comma separated" value={kw} onChange={(e) => setKw(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <select className="field" value={bucket} onChange={(e) => setBucket(e.target.value as Rule2["bucket"])} aria-label="Rule bucket">
              <option value="priority">Strong Signal</option><option value="review">Needs Review</option><option value="excluded">Bad Lead</option>
            </select>
            <select className="field" value={cols[0] ?? ""} onChange={(e) => setCols(e.target.value ? [e.target.value] : [])} aria-label="Rule column">
              <option value="">every column</option>
              {columnNames.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn btn-sm btn-primary" onClick={add} disabled={!kw.trim()}>+ Add rule</button>
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * Scanner 2 — Scanner 1's bones, none of its rules.
 *
 * Same skeleton: upload → resolve who the lead is → classify → work the
 * rows → export. What is different is that the rules are DATA you write
 * here rather than a Microsoft product catalogue compiled into the app,
 * and the final say is yours: rules propose a bucket, you curate.
 *
 * Shares nothing with Scanner 1 but the CSV parser, the download helper
 * and the stylesheet. See lib/scanner2.ts for why.
 */
export default function Scanner2({ kind = "smc", lists = [], onAddToList }: {
  kind?: ScannerKind;
  lists?: LeadList[];
  onAddToList?: (
    rows: { row: Scanner2ExportRow; scanner: "main" | "smc" | "csp"; band?: string; score?: number }[],
    opts: { existingId?: string; newName?: string },
  ) => { listId: string; added: number; skipped: number } | null;
}) {
  const isCsp = kind === "csp";
  // Selection is by row id, so it survives paging, re-sorting and filtering
  // — you can select a page, change the filter, and keep adding.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [listTarget, setListTarget] = useState<string>("");
  const [newListName, setNewListName] = useState("");
  const [customN, setCustomN] = useState(100);
  const [listNote, setListNote] = useState<string | null>(null);
  // CSP reads High / Medium / Low priority where SMC reads Strong Signal /
  // Needs Review / Bad Leads — same buckets, same colours, different words.
  const bMeta = bucketMetaFor(isCsp);
  const cMeta = curationMetaFor(isCsp);
  const [ruleSets, setRuleSets] = useState<RuleSet2[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [files, setFiles] = useState<{ name: string; fields: string[]; data: Record<string, unknown>[] }[]>([]);
  const [result, setResult] = useState<Scan2Result | null>(null);
  const [profiles, setProfiles] = useState<ColumnProfile[]>([]);
  const [runs, setRuns] = useState<Run2[]>([]);
  const [curation, setCurationState] = useState<Record<string, CurationRecord>>({});
  const [bucketFilter, setBucketFilter] = useState<Bucket2 | "all">("all");
  const [curationFilter, setCurationFilter] = useState<Curation | "all" | "undecided">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [productFilter, setProductFilter] = useState<SmcProduct | "all">("all");
  const [gapsOnly, setGapsOnly] = useState(false);
  const [postureFilter, setPostureFilter] = useState<PartnerPosture | "open" | "all">("all");
  const [billingFilter, setBillingFilter] = useState<BillingQuality | "all">("all");
  // Per the real export: 82 of 99 Strong Signal leads had nobody to call.
  // This is how you get to the ones you can actually work.
  const [callableOnly, setCallableOnly] = useState(false);
  const [lineFilter, setLineFilter] = useState<ProductLine | "all">("all");
  // Per Jack: newest first, so a batch can be worked into sequences from
  // the freshest leads down. "File order" keeps the raw upload order.
  const [sortBy, setSortBy] = useState<"score-desc" | "score-asc" | "value-desc" | "value-asc" | "received-desc" | "received-asc" | "file">(isCsp ? "score-desc" : "received-desc");
  // Per Jack: "filter highest to lowest for score number ... and filter
  // together for the price also." A floor on each, applied together.
  const [minScore, setMinScore] = useState(0);
  const [minValue, setMinValue] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(true);
  // High priority gets CALLED, and reachability is only a small share of the
  // score — so the top of a score-sorted list skews email-only. This is the
  // one-click answer: only leads you can actually dial.
  const [phoneOnly, setPhoneOnly] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  // Same drop-zone interaction as the Main Scanner, so the two upload
  // screens feel like one product rather than two tools.
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [rs, rr, cur] = await Promise.all([loadRuleSets(kind), loadRuns(kind), loadCuration()]);
        let sets = rs;
        if (sets.length === 0) sets = [await saveRuleSet(emptyRuleSet("Default rules", kind))];
        setRuleSets(sets);
        setActiveId(sets[0].id);
        setRuns(rr);
        setCurationState(cur);
      } catch (e) {
        // Storage unavailable: still scan, in memory, and say so.
        const fallback = emptyRuleSet("Default rules", kind);
        setRuleSets([fallback]);
        setActiveId(fallback.id);
        setError(`Local storage is unavailable, so settings and decisions will not persist: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, [kind]);

  const active = ruleSets.find((r) => r.id === activeId) ?? null;
  // In CSP a manual High / Medium / Low wins over the scored bucket; in SMC
  // curation never moves a row between tiers, exactly as before.
  const effBucket = useCallback(
    (r: Row2): Bucket2 => {
      if (!isCsp || !r.leadKey) return r.bucket;
      const d = curation[r.leadKey]?.decision;
      return d ? CURATION_TO_BUCKET[d] : r.bucket;
    },
    [isCsp, curation],
  );
  const smcRules = useMemo(() => resolveSmcRules(active?.smcRules), [active]);
  const cspRules = useMemo(() => resolveCspRules(active?.cspRules), [active]);
  useEffect(() => { setPage(1); }, [bucketFilter, curationFilter, search, productFilter, gapsOnly, callableOnly, lineFilter, sortBy, fromDate, toDate, postureFilter, billingFilter, minScore, minValue, phoneOnly]);

  // A storage failure must never block the scan or wipe the screen. The
  // change is applied for this session either way; the banner says it
  // will not survive a reload and why.
  async function persist(next: RuleSet2) {
    let saved = next;
    try {
      saved = await saveRuleSet(next);
    } catch (e) {
      setError(`Applied for this session, but it could not be saved: ${e instanceof Error ? e.message : String(e)}`);
    }
    setRuleSets((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
    return saved;
  }
  function rescan(withSet: RuleSet2, withFiles = files) {
    if (withFiles.length === 0) { setResult(null); return; }
    setResult(scan2(withFiles, withSet));
  }

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0 || !active) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const parsed = await Promise.all(Array.from(list).map((f) => parseCSVFile(f)));
      const prof = profileColumns(parsed);
      setFiles(parsed);
      setProfiles(prof);

      // Only guess when nothing is mapped yet — a mapping you corrected by
      // hand must never be silently overwritten by the next upload.
      let set = active;
      let mappingNote = "";
      const firstEver = !active.fields || Object.keys(active.fields).length === 0;
      if (firstEver) {
        // First upload for this rule set: guess the lead fields AND drop the
        // known-noise columns.
        set = await persist({
          ...active,
          fields: guessFieldMapping(prof),
          notesColumns: guessNotesColumns(prof),
          campaignColumns: guessCampaignColumns(prof),
          excludedColumns: prof.map((c) => c.name).filter(isDefaultDropColumn),
        });
      } else {
        // A rule set saved by an earlier build keeps its mapping, which is
        // right for anything corrected by hand and WRONG in two cases that
        // silently produced a bad download:
        //
        //   1. A field that has never been mapped at all — Mobile phone and
        //      Employees did not exist when older rule sets were saved, so
        //      those columns came out blank forever.
        //   2. A field pointing at a column this scanner drops as noise
        //      (accountidname), or at a column no longer in the file. The
        //      first put "ACCT-1234 (CRM record)" in Company Name.
        //
        // Neither can be a deliberate choice, so both are re-guessed. A
        // field pointing at a real, kept column is never touched.
        const repaired = repairFieldMapping(active.fields ?? {}, prof);
        const changes = [...repaired.changes];
        // The notes columns carry the entire lead for this format, so a stale
        // one is fatal: every row reads as "No usable lead content". Re-guess
        // when the saved choice is absent from this file or empty in it.
        const usable = (cols: string[] | undefined) =>
          (cols ?? []).some((c) => prof.some((pp) => pp.name === c && pp.fillRate > 0));
        let notesColumns = active.notesColumns;
        if (!usable(notesColumns)) {
          const guessed = guessNotesColumns(prof);
          if (guessed.length) { notesColumns = guessed; changes.push(`Notes → ${guessed.join(", ")}`); }
        }
        let campaignColumns = active.campaignColumns;
        if (!usable(campaignColumns)) {
          const guessed = guessCampaignColumns(prof);
          if (guessed.length) { campaignColumns = guessed; changes.push(`Campaign → ${guessed.join(", ")}`); }
        }
        if (changes.length) {
          set = await persist({ ...active, fields: repaired.fields, notesColumns, campaignColumns });
          mappingNote = `Column mapping updated: ${changes.join(", ")}. Change any of it under Edit setup.`;
        }
      }
      const res = scan2(parsed, set);
      setResult(res);
      // The file chips in the page bar state the row count; the only thing
      // worth saying here is what the scanner changed on your behalf.
      setNotice(mappingNote || null);
      // Recording the run is a nicety; the results on screen are the point.
      const run = buildRun(parsed.map((p) => p.name), set.name, res, kind);
      try {
        await saveRun(run);
        setRuns((prev) => [run, ...prev]);
      } catch (e) {
        setError(`Results are shown, but this run could not be recorded: ${e instanceof Error ? e.message : String(e)}`);
      }
    } catch (e) { setError(`Could not read that upload: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(false);
  }

  function startOver() {
    setFiles([]); setResult(null); setProfiles([]); setBucketFilter("all");
    setCurationFilter("all"); setSearch(""); setPage(1); setNotice(null); setError(null);
    setSelected(new Set()); setListNote(null);
    setLineFilter("all"); setProductFilter("all"); setGapsOnly(false); setCallableOnly(false);
    setSortBy("received-desc"); setFromDate(""); setToDate("");
  }

  async function curate(key: string | null, decision: Curation) {
    if (!key) return;
    const existing = curation[key];
    try {
      if (existing?.decision === decision) {
        setCurationState((p) => { const n = { ...p }; delete n[key]; return n; });
        await clearCuration(key);
        return;
      }
      const rec = await setCuration(key, decision);
      setCurationState((p) => ({ ...p, [key]: rec }));
    } catch (e) {
      setError(`That decision could not be saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  }


  // Strong Signal split by product line. Every Strong row carries a line
  // (scan2 guarantees it), so these two always sum to the Strong total —
  // "unassigned" is shown only if that invariant ever breaks.
  const strongByLine = useMemo(() => {
    const out: Record<ProductLine | "unassigned", number> = { "Dynamics 365": 0, "M365 / Azure": 0, unassigned: 0 };
    for (const r of result?.rows ?? []) if (r.bucket === "priority") out[r.productLine ?? "unassigned"]++;
    return out;
  }, [result, effBucket]);

  /**
   * How much contact detail the FILE actually carries. Jack reported name,
   * title, email and phone showing blank; the parser was verified to drop
   * nothing, so the honest answer is per-upload and belongs on screen.
   */
  const contactCoverage = useMemo(() => {
    let noName = 0, noPhone = 0, noEmail = 0;
    for (const r of result?.rows ?? []) {
      if (!r.lead.contact) noName++;
      if (!r.lead.phone && !r.lead.mobilePhone) noPhone++;
      if (!r.lead.email) noEmail++;
    }
    return { noName, noPhone, noEmail };
  }, [result]);

  /**
   * One test per filter dimension, rather than a single predicate.
   *
   * Every count in the UI is FACETED: a count is computed over the rows
   * that pass every filter EXCEPT its own. So narrowing Partner to "open
   * lane" re-counts the High / Medium / Low tabs, the billing options and
   * the override chips to what is left — per Jack, the tabs read 2,166
   * while the table showed 986, because the tabs were counting the whole
   * upload. A dimension counting itself would always read the same number
   * and tell you nothing.
   */
  const tests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return {
      bucket: (r: Row2) => bucketFilter === "all" || effBucket(r) === bucketFilter,
      curation: (r: Row2) => {
        const d = r.leadKey ? curation[r.leadKey]?.decision : undefined;
        if (curationFilter === "all") return true;
        if (curationFilter === "undecided") return !d;
        return d === curationFilter;
      },
      line: (r: Row2) => lineFilter === "all" || r.productLine === lineFilter,
      billing: (r: Row2) => billingFilter === "all" || r.csp?.billingRank === billingFilter,
      posture: (r: Row2) => {
        if (postureFilter === "all") return true;
        const po = r.csp?.posture;
        if (!po) return false;
        // "Open lane" is the whole point of this list: every posture with
        // nobody real standing in front of the customer, in one click.
        return postureFilter === "open" ? POSTURE_META[po].open : po === postureFilter;
      },
      // A floor on score and on value, together. A row with NO stated value
      // does not clear a value floor — unknown is not "at least".
      score: (r: Row2) => !isCsp || minScore <= 0 || (r.csp?.score ?? 0) >= minScore,
      value: (r: Row2) => !isCsp || minValue <= 0 || (r.csp?.value ?? 0) >= minValue,
      gaps: (r: Row2) => !gapsOnly || !!(r.smc && salesGaps(r.smc, smcRules).length),
      callable: (r: Row2) => !callableOnly || !!(r.lead.phone || r.lead.mobilePhone || r.lead.email),
      phone: (r: Row2) => !phoneOnly || !!(r.lead.phone || r.lead.mobilePhone),
      // Date range is inclusive of both days. A row with no stated date is
      // excluded once a range is set — it cannot be shown to fall inside it.
      date: (r: Row2) => (!fromDate || !!(r.receivedOn && r.receivedOn >= fromDate))
                      && (!toDate || !!(r.receivedOn && r.receivedOn <= toDate)),
      product: (r: Row2) => {
        if (productFilter === "all") return true;
        const hit = r.smc?.propensity.find((p) => p.product === productFilter);
        return !!hit && hit.stage !== "Unknown";
      },
      search: (r: Row2) => {
        if (!q) return true;
        const hay = [...Object.values(r.row).map((v) => String(v ?? "")), r.lead.company, r.lead.contact, r.snippet].join(" ").toLowerCase();
        return hay.includes(q);
      },
    };
  }, [bucketFilter, curationFilter, search, curation, productFilter, gapsOnly, callableOnly, smcRules, fromDate, toDate, postureFilter, billingFilter, minScore, minValue, lineFilter, effBucket, isCsp, phoneOnly]);

  type FilterKey = keyof typeof tests;

  /** Rows passing every filter except the ones named. */
  const rowsExcept = useCallback(
    (...skip: FilterKey[]) => {
      const keys = Object.keys(tests) as FilterKey[];
      return (result?.rows ?? []).filter((r) => keys.every((k) => skip.includes(k) || tests[k](r)));
    },
    [result, tests],
  );

  const counts = useMemo(() => {
    const out: Record<Bucket2, number> = { priority: 0, review: 0, excluded: 0, unmatched: 0 };
    for (const r of rowsExcept("bucket")) out[effBucket(r)]++;
    return out;
  }, [rowsExcept, effBucket]);
  /** The "All" tab: everything the other filters leave. */
  const bucketAllCount = useMemo(() => rowsExcept("bucket").length, [rowsExcept]);

  const curationCounts = useMemo(() => {
    const out = { keep: 0, maybe: 0, reject: 0, undecided: 0 };
    for (const r of rowsExcept("curation")) {
      const d = r.leadKey ? curation[r.leadKey]?.decision : undefined;
      if (d) out[d]++; else out.undecided++;
    }
    return out;
  }, [rowsExcept, curation]);

  const lineCounts = useMemo(() => {
    const out: Record<ProductLine | "all", number> = { all: 0, "Dynamics 365": 0, "M365 / Azure": 0 };
    for (const r of rowsExcept("line")) {
      out.all++;
      if (r.productLine) out[r.productLine]++;
    }
    return out;
  }, [rowsExcept]);

  const billingCounts = useMemo(() => {
    const out: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of rowsExcept("billing")) if (r.csp) out[r.csp.billingRank]++;
    return out;
  }, [rowsExcept]);
  const billingAllCount = useMemo(() => rowsExcept("billing").length, [rowsExcept]);

  const postureCounts = useMemo(() => {
    const out: Record<PartnerPosture | "open", number> = { open: 0, unassigned: 0, unresolved: 0, microsoft: 0, named: 0 };
    for (const r of rowsExcept("posture")) {
      const po = r.csp?.posture;
      if (!po) continue;
      out[po]++;
      if (POSTURE_META[po].open) out.open++;
    }
    return out;
  }, [rowsExcept]);
  const postureAllCount = useMemo(() => rowsExcept("posture").length, [rowsExcept]);
  const phoneCount = useMemo(
    () => rowsExcept("phone").filter((r) => r.lead.phone || r.lead.mobilePhone).length,
    [rowsExcept],
  );

  const filtered = useMemo(() => {
    if (!result) return [];
    const rows = rowsExcept();
    // Score and value orders. A row missing a value is never treated as
    // zero — it sinks below every row that states one, either direction,
    // in the order it already had. Score always exists on a CSP row.
    if (sortBy === "score-desc") {
      return rows.map((r, i) => ({ r, i }))
        .sort((a, b) => compareCspLeads(a.r.csp, b.r.csp) || a.i - b.i)
        .map((x) => x.r);
    }
    if (sortBy === "score-asc") {
      return rows.map((r, i) => ({ r, i }))
        .sort((a, b) => ((a.r.csp?.score ?? 0) - (b.r.csp?.score ?? 0)) || a.i - b.i)
        .map((x) => x.r);
    }
    if (sortBy === "value-desc" || sortBy === "value-asc") {
      const dir = sortBy === "value-desc" ? -1 : 1;
      return rows.map((r, i) => ({ r, i }))
        .sort((a, b) => {
          const va = a.r.csp?.value ?? null, vb = b.r.csp?.value ?? null;
          if (va != null && vb != null) return va === vb ? a.i - b.i : (va - vb) * dir;
          if (va != null) return -1;
          if (vb != null) return 1;
          return a.i - b.i;
        })
        .map((x) => x.r);
    }
    if (sortBy === "file") return rows;
    // An undated row is never treated as the oldest (or newest) date — it
    // sinks below every dated row either way, in the order it arrived.
    const dir = sortBy === "received-desc" ? -1 : 1;
    return rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const da = a.r.receivedOn, db = b.r.receivedOn;
        if (da && db) return da === db ? a.i - b.i : (da < db ? -1 : 1) * dir;
        if (da) return -1;
        if (db) return 1;
        return a.i - b.i;
      })
      .map((x) => x.r);
  }, [result, rowsExcept, sortBy]);

  const datedCount = useMemo(() => (result?.rows ?? []).filter((r) => r.receivedOn).length, [result]);

  const pageRows = filtered.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  // Curating rows or re-scanning shrinks the list without changing a filter,
  // which left the pager reading "Showing 51–45 of 45 · Page 3 of 2" over an
  // empty table. Clamp rather than reset, so a Keep click does not throw you
  // back to page 1.
  useEffect(() => { setPage((pp) => (pp > pages ? pages : pp)); }, [pages]);

  /**
   * Every download this scanner produces, in the Main Scanner's Apollo
   * import format minus "Last Name" — nine columns, nothing else. There is
   * deliberately no second, wider export: two buttons side by side that
   * produced nine and forty columns was a trap, and the whole point of
   * this scanner is stripping a CRM export down to what you can call.
   */
  async function exportApollo(rows: Row2[], fileName: string) {
    if (rows.length === 0) return;
    try {
      // CSP: Product Area is the lead's effective priority — High goes to a
      // call sequence, Medium to email, per Jack — so it is the column to
      // split on once the file is in Apollo. SMC keeps the product line.
      const out = rows.map((r) => toApolloRow(r, isCsp ? bMeta[effBucket(r)].label : undefined));
      // CSP drops Title and Number of Employees: a CSP opportunity export
      // states neither, so they shipped empty on every row.
      await downloadBlob(toCSV(out, [...exportLabelsFor(kind)]), fileName);
    } catch (e) {
      setError(`That download could not be saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Every Strong Signal lead on one product line, independent of whatever
   * the table is currently filtered to — the point is to grab a line's
   * leads without first having to set the view to match. Anything
   * explicitly curated as Reject is left out; nothing else is.
   */
  const strongFor = useCallback(
    (line: ProductLine | "all") =>
      (result?.rows ?? []).filter(
        (r) =>
          r.bucket === "priority" &&
          (line === "all" || r.productLine === line) &&
          !(r.leadKey && curation[r.leadKey]?.decision === "reject"),
      ),
    [result, curation],
  );

  /**
   * What you would actually be dialling. A Strong Signal lead with no
   * phone and no email is a row you cannot work, and that is worth seeing
   * BEFORE the download rather than discovering it in a call session.
   */
  const callReadiness = useMemo(() => {
    const rows = strongFor("all").map((r) => toApolloRow(r));
    let noPhone = 0, noCompany = 0, noContactAtAll = 0;
    for (const r of rows) {
      const phone = r["Work Direct Phone"] || r["Mobile Phone"];
      if (!phone) noPhone++;
      if (!r["Company Name"]) noCompany++;
      if (!phone && !r.Email) noContactAtAll++;
    }
    // Which of the nine export columns will be blank in EVERY row. Apollo's
    // importer does not offer a column it sees as empty, which is why only
    // Company Name, Product Area and Notes appeared on a real import.
    const emptyColumns = rows.length
      ? exportLabelsFor(kind).filter((c) => rows.every((r) => !String((r as Record<string, string>)[c] || "").trim()))
      : [];
    // Phones Excel destroyed before the file ever reached us. Counted over
    // the WHOLE scan, not the Strong slice, because the fix is to re-export
    // the file — and that fixes every band at once.
    const mangledPhones = (result?.rows ?? []).filter((r) => r.csp?.phoneMangled).length;
    return { total: rows.length, noPhone, noCompany, noContactAtAll, emptyColumns, mangledPhones };
  }, [strongFor, result, kind]);

  // CSP downloads: every Strong Signal row, in the rank order Jack asked
  // for (billing intent, then notes strength), split by whether anyone
  // already holds the customer — the two calls are different pitches.
  // Per Jack: High priority gets called, Medium gets emailed, and he
  // filters industry / headcount once the file is in Apollo — so the
  // downloads are the two sequence feeders, in score order, using the
  // EFFECTIVE priority (a manual High / Medium / Low wins over the score).
  // Low priority is never in a download, same as Bad Leads on the SMC tab.
  const cspByPriority = useCallback(
    (which: "priority" | "review" | "all") =>
      // Everything the filters leave, EXCEPT the priority tab itself —
      // the band is chosen by the button you click, so the tab you happen
      // to be looking at must not also narrow it.
      rowsExcept("bucket")
        .filter((r) => {
          const b = effBucket(r);
          return which === "all" ? b === "priority" || b === "review" : b === which;
        })
        .map((r, i) => ({ r, i }))
        .sort((a, b) => compareCspLeads(a.r.csp, b.r.csp) || a.i - b.i)
        .map((x) => x.r),
    [rowsExcept, effBucket],
  );

  const strongDownloads = useMemo(
    () =>
      isCsp
        ? ([
            { line: "priority" as const, label: "High priority", file: "csp-high-priority.csv", rows: cspByPriority("priority") },
            { line: "review" as const, label: "Medium priority", file: "csp-medium-priority.csv", rows: cspByPriority("review") },
            { line: "all" as const, label: "High + Medium", file: "csp-high-and-medium.csv", rows: cspByPriority("all") },
          ])
        : (["Dynamics 365", "M365 / Azure", "all"] as const).map((line) => ({
            line,
            label: line === "all" ? "All Strong Signal" : line === "Dynamics 365" ? "Dynamics" : "M365 / Azure",
            file:
              line === "all"
                ? "strong-signal-all.csv"
                : line === "Dynamics 365"
                  ? "strong-signal-dynamics-365.csv"
                  : "strong-signal-m365-azure.csv",
            rows: strongFor(line),
          })),
    [strongFor, cspByPriority, isCsp],
  );

  function applyNow(next: RuleSet2) {
    setRuleSets((prev) => prev.map((r) => (r.id === next.id ? next : r)));
    rescan(next);
  }
  const ctx: Ctx = { persist, applyNow, rescan, profiles, result, showRules, setShowRules };

  if (!active) return <div style={{ color: error ? "#B5443B" : "var(--muted)" }}>{error ?? "Loading…"}</div>;

  return (
    <div>
      <div className="page-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* The two scanners share this component, so the heading has to
              say which one you are in — there is no tab strip above it. */}
          <h2 style={{ margin: 0, fontSize: 16 }}>{isCsp ? "CSP Scanner" : "Custom Scanner September"}</h2>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {isCsp ? "CSP licensing renewals" : "Microsoft SMC / Cloud Ascent"}
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {files.map((f) => (
              <span key={f.name} className="file-chip">
                <b>{f.name}</b> · {f.data.length.toLocaleString()} rows
              </span>
            ))}
          </div>
        </div>
        {result && <button className="btn btn-secondary" onClick={startOver}>Start over</button>}
      </div>

      {error && (
        <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 10, margin: "0 0 12px", padding: "10px 12px", border: "1px solid #E4B4B0", background: "#FBEAE8", color: "#B5443B", borderRadius: 10, fontSize: 13 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button className="btn btn-sm btn-ghost" aria-label="Dismiss error" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* One line of setup, not three panels. The rule in force is the
          part worth reading every time, so it stays visible; the editors
          for it sit behind the toggle. */}
      {result && (
        <div className="dl-strip">
          <span className="dl-title">Scan setup</span>
          <span
            className="dl-hint"
            style={{ flex: 1, minWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={ruleSentence(active)}
          >
            {ruleSentence(active)}
          </span>
          <button
            className="btn btn-sm btn-ghost"
            aria-label="Scan setup"
            style={{ whiteSpace: "nowrap" }}
            onClick={() => setShowSetup((v) => !v)}
          >
            {showSetup ? "\u25be Hide setup" : "\u25b8 Edit setup"}
          </button>
        </div>
      )}

      {result && isCsp && <PriorityBreakdown rows={result.rows} rules={cspRules} meta={bMeta} effBucket={effBucket} />}

      {result && showSetup && <FieldMap set={active} ctx={ctx} />}
      {result && showSetup && (active.mode ?? "smc") === "smc" && <StrongSignalRules set={active} ctx={ctx} />}
      {result && showSetup && active.mode === "csp" && <CspRenewalRules set={active} ctx={ctx} profiles={profiles} />}
      {result && showSetup && <RuleEditor set={active} ctx={ctx} />}

      {!result && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
              background: dragOver ? "#EDF4EF" : "var(--surface)",
              borderRadius: 16,
              padding: "48px 24px",
              textAlign: "center",
              cursor: busy ? "progress" : "pointer",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              style={{ display: "none" }}
              disabled={busy}
              onChange={(e) => onFiles(e.target.files)}
            />
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 7 }}>
              {busy ? "Reading…" : "Drop lead CSVs here"}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 13.5 }}>or click to browse</div>
          </div>
        </>
      )}

      {notice && <div style={{ margin: "10px 0", fontSize: 13, color: "var(--muted)" }}>{notice}</div>}

      {result && counts && (
        <>
          {/* Same UI kit as the Main Scanner — .kpi-row, .scan-note,
              .dl-strip, one hairline-divided .toolbar. Only the scanning
              and qualification underneath differ. */}
          {!isCsp && (
          <div className="kpi-row">
            <div className="kpi" style={{ borderLeftColor: "var(--ink)" }}>
              <div className="kpi-label">Rows read</div>
              <div className="kpi-value">{result.rowsRead.toLocaleString()}</div>
            </div>
            {BUCKET2_ORDER.map((b) => (
              <div className="kpi" key={b} title={bMeta[b].hint} style={{ borderLeftColor: bMeta[b].color }}>
                <div className="kpi-label">{bMeta[b].label}</div>
                <div className="kpi-value" style={{ color: bMeta[b].color }}>{counts[b].toLocaleString()}</div>
                {b === "priority" && (
                  <div
                    aria-label="Strong Signal by product line"
                    style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, whiteSpace: "nowrap" }}
                  >
                    Dynamics <strong>{strongByLine["Dynamics 365"].toLocaleString()}</strong>
                    {" · "}M365/Azure <strong>{strongByLine["M365 / Azure"].toLocaleString()}</strong>
                    {strongByLine.unassigned > 0 && <span style={{ color: "#B5443B" }}> · {strongByLine.unassigned} unassigned</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
          )}

          <div className="scan-note">
            <strong>{result.rowsRead.toLocaleString()}</strong> read
            {" · "}<strong>{result.rows.length.toLocaleString()}</strong> processed
            {result.duplicatesMerged > 0 && (
              <>
                {" · "}<strong>{result.duplicatesMerged.toLocaleString()}</strong>{" "}
                <span title="Same contact + company already seen in this upload — merged into the first-seen row, not discarded.">
                  duplicates merged
                </span>
              </>
            )}
            {isCsp ? " · overridden " : " · curated "}
            <strong>{curationCounts.keep}</strong> {cMeta.keep.label.toLowerCase()}{" / "}
            <strong>{curationCounts.maybe}</strong> {cMeta.maybe.label.toLowerCase()}{" / "}
            <strong>{curationCounts.reject}</strong> {cMeta.reject.label.toLowerCase()}{", "}
            <strong>{curationCounts.undecided}</strong> {isCsp ? "untouched" : "undecided"}
            {reconciles(result)
              ? <span title="rows read = rows processed + duplicates merged"> · figures reconcile ✓</span>
              : <span style={{ color: "#B5443B", fontWeight: 700 }}> · FIGURES DO NOT RECONCILE</span>}
            {/* Where a name or a phone is blank, this says whether the file
                carried one at all — otherwise a blank column reads as a bug
                in the scanner when it is missing data in the export. */}
            {contactCoverage.noName > 0 && (
              <span title="These rows state no person anywhere — not in the CSV columns and not inside the lead text. Nothing was dropped; the file does not carry a name for them.">
                {" · "}<strong>{contactCoverage.noName.toLocaleString()}</strong> of{" "}
                {result.rows.length.toLocaleString()} rows name no person in the file
              </span>
            )}
          </div>

          <div className="dl-strip">
            <span className="dl-title">Final downloads</span>
            {strongDownloads.map((d) => (
              <span key={d.line} className="dl-item">
                <button
                  className={`btn btn-sm ${d.line === "all" ? "btn-secondary" : "btn-primary"}`}
                  aria-label={`Download ${d.label} leads`}
                  disabled={d.rows.length === 0}
                  title={isCsp
                    ? `${d.rows.length} ${d.label.toLowerCase()} lead${d.rows.length === 1 ? "" : "s"} within the filters you have set. Ordered by score, best first; Product Area carries the priority so you can split sequences on it in Apollo. An override wins over the score. Low priority is never downloaded.`
                    : `${d.rows.length} Strong Signal lead${d.rows.length === 1 ? "" : "s"}${d.line === "all" ? "" : ` on ${d.line}`}, whatever the table is filtered to. Same columns as the Main Scanner, ready for Apollo. Anything marked Reject is left out.`}
                  onClick={() => exportApollo(d.rows, d.file)}
                >
                  ⬇ {d.label}
                  <span className="dl-count">{d.rows.length}</span>
                </button>
              </span>
            ))}
            <div className="toolbar-spacer" />
            <button className="btn btn-sm btn-secondary" onClick={() => exportApollo(filtered, "scanner2-current-view.csv")} disabled={filtered.length === 0} title={isCsp ? "Same nine columns, but only the rows the filters below currently leave \u2014 use it to download one slice rather than a whole priority band." : "Same nine columns, but only the rows the filters below currently leave \u2014 use it to download one slice rather than a whole product line."}>
              ⬇ Export these {filtered.length}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowColumns((v) => !v)}>
              {showColumns ? "▾" : "▸"} Columns ({result.columns.length})
            </button>
          </div>
          {callReadiness.emptyColumns.length > 0 && (
            <div
              role="status"
              style={{ margin: "-6px 0 10px", padding: "8px 11px", border: "1px solid #E4B4B0", background: "#FBEAE8", color: "#8A3B33", borderRadius: 9, fontSize: 12.5 }}
            >
              <strong>{callReadiness.emptyColumns.join(", ")}</strong>{" "}
              {callReadiness.emptyColumns.length === 1 ? "is" : "are"} blank in every downloaded row, so Apollo will not
              offer {callReadiness.emptyColumns.length === 1 ? "it" : "them"} when you import. Open{" "}
              <strong>Edit setup</strong> to see which column each field is reading and how full it is.
            </div>
          )}
          {isCsp && callReadiness.mangledPhones > 0 && (
            <div
              role="status"
              aria-label="Mangled phones"
              style={{ margin: "0 0 10px", padding: "9px 12px", borderRadius: 10, border: "1px solid #E4C48B", background: "#FBF3DF", fontSize: 12.5, lineHeight: 1.5 }}
            >
              <strong>{callReadiness.mangledPhones.toLocaleString()} lead{callReadiness.mangledPhones === 1 ? " has" : "s have"} no phone because Excel damaged the number</strong>{" "}
              before this file was saved — it stored e.g. <code>5.25549E+11</code> instead of the digits, and the real number cannot be recovered from that.
              They are left blank rather than exported as a wrong number. To get them back, re-export the file with the phone column formatted as <strong>Text</strong>.
            </div>
          )}
          <div className="dl-hint" style={{ margin: "-6px 0 12px" }}>
            {isCsp
              ? "In the Main Scanner's Apollo import format, best score first. These follow the filters below, so narrow the view first and each button gives you that slice."
              : "Strong Signal only, in the Main Scanner's Apollo import format. Each line downloads on its own, ignoring the filters below."}
            {callReadiness.total > 0 && (
              <>
                {" · "}
                {callReadiness.noPhone === 0 && callReadiness.noCompany === 0 ? (
                  <span style={{ color: BUCKET2_META.priority.color, fontWeight: 600 }}>
                    all {callReadiness.total.toLocaleString()} have a phone and a company
                  </span>
                ) : (
                  <span title="A lead with no phone and no email cannot be worked at all. Search or filter to find them before you start calling.">
                    {callReadiness.noPhone > 0 && (
                      <span style={{ color: "#9A5B22", fontWeight: 600 }}>
                        {callReadiness.noPhone.toLocaleString()} with no phone
                      </span>
                    )}
                    {callReadiness.noPhone > 0 && callReadiness.noCompany > 0 && " · "}
                    {callReadiness.noCompany > 0 && (
                      <span style={{ color: "#9A5B22", fontWeight: 600 }}>
                        {callReadiness.noCompany.toLocaleString()} with no company
                      </span>
                    )}
                    {callReadiness.noContactAtAll > 0 && (
                      <span style={{ color: "#B5443B", fontWeight: 700 }}>
                        {" · "}{callReadiness.noContactAtAll.toLocaleString()} with nobody to call — tick “Callable only” below to work the rest
                      </span>
                    )}
                  </span>
                )}
              </>
            )}
          </div>

          {!isCsp && (
          <div className="toolbar">
            <div className="toolbar-row">
              <div className="seg">
                {BUCKET2_ORDER.map((b) => (
                  <button
                    key={b}
                    className={`seg-btn${bucketFilter === b ? " active" : ""}`}
                    onClick={() => setBucketFilter(b)}
                    title={bMeta[b].hint}
                  >
                    {bMeta[b].label} ({counts[b]})
                  </button>
                ))}
                <button
                  className={`seg-btn${bucketFilter === "all" ? " active" : ""}`}
                  onClick={() => setBucketFilter("all")}
                >
                  All ({bucketAllCount})
                </button>
              </div>
              <div className="toolbar-spacer" />
              <label className="toolbar-check" title="Act Now at High Fit on a product they do not already own">
                <input type="checkbox" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} aria-label="Act Now gaps only" />
                Act&nbsp;Now gaps only
              </label>
              <label className="toolbar-check" title="Only leads with a phone or an email — the ones you can actually work. The rest name a company and nobody at it.">
                <input type="checkbox" checked={callableOnly} onChange={(e) => setCallableOnly(e.target.checked)} aria-label="Callable only" />
                Callable&nbsp;only
              </label>
            </div>

            <div className="toolbar-row">
              <span className="toolbar-label">Product line</span>
              {(["all", "Dynamics 365", "M365 / Azure"] as (ProductLine | "all")[]).map((l) => (
                <button
                  key={l}
                  className={`chip-btn${lineFilter === l ? " active" : ""}`}
                  onClick={() => setLineFilter(l)}
                  aria-label={`Product line ${l}`}
                >
                  {l === "all" ? "All" : l} ({lineCounts[l]})
                </button>
              ))}
              <select className="field" aria-label="Product filter" value={productFilter} onChange={(e) => setProductFilter(e.target.value as SmcProduct | "all")} title="Narrow to one Cloud Ascent product">
                <option value="all">Any product</option>
                {SMC_PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <div className="toolbar-spacer" />
              <input className="field" placeholder="Search company, contact, or notes…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200, maxWidth: 380 }} />
            </div>

            <div className="toolbar-row">
              <span className="toolbar-label">Curation</span>
              <button className={`chip-btn${curationFilter === "all" ? " active" : ""}`} onClick={() => setCurationFilter("all")}>Any</button>
              <button className={`chip-btn${curationFilter === "undecided" ? " active" : ""}`} onClick={() => setCurationFilter("undecided")}>Undecided ({curationCounts.undecided})</button>
              {(["keep", "maybe", "reject"] as Curation[]).map((c) => (
                <button key={c} className={`chip-btn${curationFilter === c ? " active" : ""}`} onClick={() => setCurationFilter(c)}>
                  {cMeta[c].label} ({curationCounts[c]})
                </button>
              ))}
              <div className="toolbar-spacer" />
              <span className="toolbar-label">Received</span>
              <select
                className="field"
                aria-label="Sort by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                title={datedCount ? `${datedCount} of ${result.rows.length} rows state a date; the rest sort last` : "No row in this upload states a received date"}
              >
                <option value="received-desc">Newest first</option>
                <option value="received-asc">Oldest first</option>
                <option value="file">File order</option>
              </select>
              <input className="field" type="date" aria-label="Received from" value={fromDate} onChange={(e) => setFromDate(e.target.value)} title="Received on or after" />
              <span style={{ fontSize: 12, color: "var(--muted)" }}>to</span>
              <input className="field" type="date" aria-label="Received to" value={toDate} onChange={(e) => setToDate(e.target.value)} title="Received on or before" />
              {(fromDate || toDate) && (
                <button className="btn btn-sm btn-ghost" aria-label="Clear date range" onClick={() => { setFromDate(""); setToDate(""); }}>Clear</button>
              )}
            </div>

          </div>
          )}
          {/* CSP: two rows, basic. Per Jack: "all these boxes are too
              confusing just need basic filtering dates is huge." Priority
              tabs and search on the first row; the date range leads the
              second, labelled with WHICH date it is filtering on, then the
              score / value floor and sort, then two dropdowns. No chip
              walls. Manual High / Medium / Low already show under their
              tab, so there is no separate override filter here. */}
          {isCsp && (
          <div className="toolbar" aria-label="CSP filters">
            <div className="toolbar-row" style={{ justifyContent: "space-between" }}>
              <button
                className="btn btn-sm btn-ghost"
                aria-label="Toggle filters"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 6px" }}
              >
                <span aria-hidden="true">{filtersOpen ? "\u25be" : "\u25b8"}</span>
                <b>Filters</b>
                {!filtersOpen && (
                  <span style={{ color: "var(--muted)", fontWeight: 400 }} aria-label="Active filters">
                    {[
                      bucketFilter !== "all" ? bMeta[bucketFilter].label : "",
                      fromDate || toDate ? `${fromDate || "\u2026"} to ${toDate || "\u2026"}` : "",
                      minScore ? `score \u2265 ${minScore}` : "",
                      minValue ? `value \u2265 $${minValue.toLocaleString()}` : "",
                      postureFilter !== "all" ? `partner: ${postureFilter}` : "",
                      billingFilter !== "all" ? `billing: ${BILLING_META[billingFilter].short}` : "",
                      callableOnly ? "callable" : "",
                      phoneOnly ? "has phone" : "",
                      search ? `\u201c${search}\u201d` : "",
                    ].filter(Boolean).join(" \u00b7 ") || "none active"}
                  </span>
                )}
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{filtered.length.toLocaleString()} of {result.rows.length.toLocaleString()} shown</span>
            </div>
            {filtersOpen && (<>
            <div className="toolbar-row">
              <div className="seg">
                {BUCKET2_ORDER.map((b) => (
                  <button key={b} className={`seg-btn${bucketFilter === b ? " active" : ""}`} onClick={() => setBucketFilter(b)} title={bMeta[b].hint}>
                    {bMeta[b].label} ({counts[b]})
                  </button>
                ))}
                <button className={`seg-btn${bucketFilter === "all" ? " active" : ""}`} onClick={() => setBucketFilter("all")}>
                  All ({bucketAllCount})
                </button>
              </div>
              <label className="toolbar-check" title={"Only leads with a phone or an email \u2014 the ones you can actually work."}>
                <input type="checkbox" checked={callableOnly} onChange={(e) => setCallableOnly(e.target.checked)} aria-label="Callable only" />
                Callable
              </label>
              <label className="toolbar-check" title={"Only leads with a phone number. High priority gets called, and a score-sorted list puts plenty of email-only leads at the top \u2014 this removes them."}>
                <input type="checkbox" checked={phoneOnly} onChange={(e) => setPhoneOnly(e.target.checked)} aria-label="Has phone" />
                Has&nbsp;phone ({phoneCount.toLocaleString()})
              </label>
              <div className="toolbar-spacer" />
              <input className="field" placeholder={"Search company, contact, or notes\u2026"} value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200, maxWidth: 380 }} />
            </div>

            <div className="toolbar-row">
              <span
                className="toolbar-label"
                aria-label="Date source"
                title={result.dateSource.kind === "column"
                  ? `Filtering on the "${result.dateSource.column}" column from your sheet \u2014 when the lead was created / uploaded.`
                  : result.dateSource.kind === "notes"
                    ? "This file has no date column, so the date is the newest dated seller entry in the notes \u2014 when Microsoft last touched the lead."
                    : "No date column and no dated notes in this file \u2014 the date filter has nothing to work on."}
              >
                {result.dateSource.kind === "column" ? `Date (${result.dateSource.column})` : result.dateSource.kind === "notes" ? "Last touched" : "No dates"}
              </span>
              <input className="field" type="date" aria-label="Received from" value={fromDate} onChange={(e) => setFromDate(e.target.value)} title="On or after" style={{ width: 128 }} />
              <span style={{ fontSize: 12, color: "var(--muted)" }}>to</span>
              <input className="field" type="date" aria-label="Received to" value={toDate} onChange={(e) => setToDate(e.target.value)} title="On or before" style={{ width: 128 }} />
              <button className="btn btn-sm btn-ghost" aria-label="Last 30 days" onClick={() => { setFromDate(daysAgoKey(30)); setToDate(""); }}>30d</button>
              <button className="btn btn-sm btn-ghost" aria-label="Last 90 days" onClick={() => { setFromDate(daysAgoKey(90)); setToDate(""); }}>90d</button>
              {(fromDate || toDate) && (
                <button className="btn btn-sm btn-ghost" aria-label="Clear date range" onClick={() => { setFromDate(""); setToDate(""); }}>Clear</button>
              )}
              <input className="field" type="number" min={0} max={100} aria-label="Minimum score" value={minScore || ""} placeholder={"Score \u2265"}
                     onChange={(e) => setMinScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} style={{ width: 78 }} title="Only leads scoring at least this" />
              <select className="field" aria-label="Minimum value" value={minValue} onChange={(e) => setMinValue(Number(e.target.value))} title="Only leads whose estimated value is at least this. A lead with no stated value does not pass a floor.">
                <option value={0}>Value: any</option>
                <option value={1000}>{"\u2265"} $1k</option>
                <option value={10000}>{"\u2265"} $10k</option>
                <option value={25000}>{"\u2265"} $25k</option>
                <option value={50000}>{"\u2265"} $50k</option>
                <option value={100000}>{"\u2265"} $100k</option>
                <option value={250000}>{"\u2265"} $250k</option>
              </select>
              <select
                className="field"
                aria-label="Sort by"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                title={datedCount ? `${datedCount} of ${result.rows.length} rows carry a date; the rest sort last on a date order` : "No row in this upload carries a date"}
              >
                <option value="score-desc">Score {"\u2193"}</option>
                <option value="score-asc">Score {"\u2191"}</option>
                <option value="value-desc">Value {"\u2193"}</option>
                <option value="value-asc">Value {"\u2191"}</option>
                <option value="received-desc">Newest</option>
                <option value="received-asc">Oldest</option>
                <option value="file">File order</option>
              </select>
              <div className="toolbar-spacer" />
              <select className="field" aria-label="Partner" style={{ width: 150 }} value={postureFilter} onChange={(e) => setPostureFilter(e.target.value as PartnerPosture | "open" | "all")} title="Who holds this customer today">
                <option value="all">Partner: any ({postureAllCount})</option>
                <option value="open">Open lane ({postureCounts.open})</option>
                {(["unassigned", "unresolved", "microsoft", "named"] as PartnerPosture[]).map((w) => (
                  <option key={w} value={w}>{POSTURE_META[w].label} ({postureCounts[w]})</option>
                ))}
              </select>
              <select className="field" aria-label="Billing" style={{ width: 160 }} value={billingFilter} onChange={(e) => setBillingFilter(e.target.value === "all" ? "all" : Number(e.target.value) as BillingQuality)} title="How they want to be billed">
                <option value="all">Billing: any ({billingAllCount})</option>
                {BILLING_META.map((b) => <option key={b.rank} value={b.rank}>{b.short} ({billingCounts[b.rank]})</option>)}
              </select>
            </div>
            </>)}
          </div>
          )}

          {isCsp && onAddToList && (
            <div className="toolbar" aria-label="Selection" style={{ marginBottom: 10 }}>
              <div className="toolbar-row" style={{ flexWrap: "wrap" }}>
                <label className="toolbar-check" title="Select or clear every lead on this page">
                  <input
                    type="checkbox"
                    aria-label="Select page"
                    checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected((prev) => {
                      const next = new Set(prev);
                      for (const r of pageRows) { if (e.target.checked) next.add(r.id); else next.delete(r.id); }
                      return next;
                    })}
                  />
                  Page ({pageRows.length})
                </label>
                <button className="btn btn-sm btn-ghost" aria-label="Select all filtered"
                  onClick={() => setSelected(new Set(filtered.map((r) => r.id)))}>
                  Select all {filtered.length.toLocaleString()}
                </button>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>or first</span>
                <input className="field" type="number" min={1} aria-label="Custom amount" value={customN}
                  onChange={(e) => setCustomN(Math.max(1, Number(e.target.value) || 1))} style={{ width: 84 }} />
                <button className="btn btn-sm btn-ghost" aria-label="Select first N"
                  onClick={() => setSelected(new Set(filtered.slice(0, customN).map((r) => r.id)))}
                  title="The top N in the current sort — with Score high to low, that is the best N leads">
                  Take top {customN}
                </button>
                {selected.size > 0 && (
                  <button className="btn btn-sm btn-ghost" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
                    Clear ({selected.size.toLocaleString()})
                  </button>
                )}
                <div className="toolbar-spacer" />
                <strong style={{ fontSize: 12.5 }}>{selected.size.toLocaleString()} selected</strong>
              </div>
              {selected.size > 0 && (
                <div className="toolbar-row" style={{ flexWrap: "wrap" }}>
                  <span className="toolbar-label">Add to list</span>
                  <select className="field" aria-label="Target list" value={listTarget} onChange={(e) => setListTarget(e.target.value)} style={{ minWidth: 170 }}>
                    <option value="">+ New list</option>
                    {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.rows.length})</option>)}
                  </select>
                  {!listTarget && (
                    <input className="field" aria-label="New list name" placeholder={"Name the list\u2026"} value={newListName}
                      onChange={(e) => setNewListName(e.target.value)} style={{ minWidth: 190 }} />
                  )}
                  <button
                    className="btn btn-sm btn-primary"
                    aria-label="Add selected to list"
                    disabled={!listTarget && !newListName.trim()}
                    onClick={() => {
                      const chosen = filtered.filter((r) => selected.has(r.id));
                      const payload = chosen.map((r) => ({
                        row: toApolloRow(r, isCsp ? bMeta[effBucket(r)].label : undefined),
                        scanner: (isCsp ? "csp" : "smc") as "csp" | "smc",
                        band: isCsp ? bMeta[effBucket(r)].label : undefined,
                        score: r.csp?.score,
                      }));
                      const res = onAddToList(payload, listTarget ? { existingId: listTarget } : { newName: newListName.trim() });
                      if (!res) { setListNote("That list could not be created."); return; }
                      setListTarget(res.listId);
                      setNewListName("");
                      setSelected(new Set());
                      setListNote(`Added ${res.added.toLocaleString()} lead${res.added === 1 ? "" : "s"}${res.skipped ? ` \u00b7 ${res.skipped.toLocaleString()} already on the list` : ""}. Open Lists to download it.`);
                    }}
                  >
                    Add {selected.size.toLocaleString()}
                  </button>
                </div>
              )}
              {/* Outside the selection guard: adding CLEARS the selection, so
                  a note rendered inside it would unmount the instant it was
                  set and you would never see what happened. */}
              {listNote && (
                <div className="toolbar-row">
                  <span aria-label="List note" style={{ fontSize: 12.5 }}>{listNote}</span>
                  <div className="toolbar-spacer" />
                  <button className="btn btn-sm btn-ghost" aria-label="Dismiss list note" onClick={() => setListNote(null)}>Dismiss</button>
                </div>
              )}
            </div>
          )}

          <div className="table-card">
            <table className="data-table" aria-label="Scan results">
              <thead>
                <tr>
                  {/* Exactly the nine columns the download carries, in the
                      same order, plus the two controls you work with. Per
                      Jack: strip the CRM export down to what you can call. */}
                  {isCsp && onAddToList && <th style={{ width: 28 }} aria-label="Select"></th>}
                  <th>Name</th><th>Company</th><th>Tier</th><th title={isCsp ? "Who holds this customer today \u2014 this is the Product Area column on the download" : "Product area"}>{isCsp ? "Partner" : "Product line"}</th>
                  {isCsp && <th title={"0\u2013100. Hover a score for where the points came from. Estimated value and last seller touch underneath."}>Score</th>}
                  <th title="Why this lead scored the way it did, with the campaign folded in. COE / EA renewal campaigns are left out.">Notes</th>
                  {!isCsp && <th>Title</th>}
                  <th>Email</th><th>Work phone</th><th>Mobile</th>
                  {!isCsp && <th title="Number of employees">Employees</th>}
                  <th>Curate</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && <tr><td colSpan={isCsp ? 11 : 11} style={{ color: "var(--muted)" }}>No rows match this filter.</td></tr>}
                {pageRows.map((r) => {
                  const dec = r.leadKey ? curation[r.leadKey]?.decision : undefined;
                  return (
                    <tr key={r.id} style={dec ? { background: cMeta[dec].bg } : undefined}>
                      {isCsp && onAddToList && (
                        <td style={{ padding: "10px 4px" }}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.lead.company || r.id}`}
                            checked={selected.has(r.id)}
                            onChange={(e) => setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(r.id); else next.delete(r.id);
                              return next;
                            })}
                          />
                        </td>
                      )}
                      {(() => {
                        // scan2 has already merged the blob's best contact into
                        // lead.*, so read the lead and stop second-guessing it.
                        const name = r.lead.contact;
                        const title = r.lead.title;
                        const email = r.lead.email;
                        const work = r.lead.phone;
                        const mob = r.lead.mobilePhone;
                        const emp = r.lead.employees || (r.smc?.employeesMax ?? r.smc?.employeesMin ?? "");
                        const dash = <span style={{ color: "var(--muted)" }}>—</span>;
                        const strike = dec === "reject" ? { textDecoration: "line-through" as const } : {};
                        return (
                          <>
                            <td style={{ fontWeight: 600, minWidth: 104, maxWidth: 130, ...strike }}>
                              {name || dash}
                              {(r.smc?.contacts.length ?? 0) > 1 && (
                                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }} title={r.smc!.contacts.map((c) => `${c.firstName} ${c.lastName} — ${c.title}`).join("\n")}>
                                  +{r.smc!.contacts.length - 1} more
                                </div>
                              )}
                              {r.contactFrom && (
                                <div
                                  style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 400 }}
                                  title={`This row named nobody. The contact was taken from another row in this upload for the same ${r.contactFrom === "tpid" ? "Customer TPID" : "company"}.`}
                                >
                                  ↳ from another row
                                </div>
                              )}
                            </td>
                            <td style={{ fontWeight: 600, minWidth: 112, maxWidth: 150, ...strike }}>
                              {r.lead.company || dash}
                              {(r.duplicateGroupSize ?? 1) > 1 && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--muted)", fontWeight: 400 }} title="Absorbed duplicates">×{r.duplicateGroupSize}</span>}
                            </td>
                            <td style={{ padding: "10px 8px" }}>
                              <span style={{ display: "inline-block", borderRadius: 20, padding: "3px 9px", fontWeight: 700, fontSize: 11, whiteSpace: "nowrap", background: bMeta[effBucket(r)].bg, color: bMeta[effBucket(r)].color }}
                                    title={isCsp && effBucket(r) !== r.bucket ? `Overridden \u2014 scored ${bMeta[r.bucket].label.toLowerCase()}` : undefined}>
                                {bMeta[effBucket(r)].label}
                              </span>
                            </td>
                            <td style={{ padding: "10px 8px", maxWidth: 190 }}>
                              {r.csp ? (
                                <>
                                  <span
                                    aria-label="Partner"
                                    style={{ display: "inline-block", borderRadius: 20, padding: "3px 9px", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap",
                                             color: POSTURE_META[r.csp.posture].color, background: POSTURE_META[r.csp.posture].bg }}
                                    title={cspPartnerLabel(r.csp)}
                                  >
                                    {POSTURE_META[r.csp.posture].short}
                                  </span>
                                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={cspPartnerLabel(r.csp)}>
                                    {r.csp.posture === "named" ? r.csp.partner : POSTURE_META[r.csp.posture].label}
                                  </div>
                                  {r.csp.partnerConflict && (
                                    <div style={{ fontSize: 10.5, color: "#8A6D1F", marginTop: 2 }} title={`The partner column says nobody holds this, but the notes name ${r.csp.partnerConflict}.`}>
                                      {"\u26a0"} notes say {r.csp.partnerConflict}
                                    </div>
                                  )}
                                </>
                              ) : r.productLine
                                ? <span style={{ display: "inline-block", borderRadius: 20, padding: "3px 9px", fontWeight: 600, fontSize: 11, whiteSpace: "nowrap", ...productLineStyle(r.productLine) }}>{r.productLine}</span>
                                : dash}
                            </td>
                            {isCsp && (
                              <td style={{ padding: "10px 8px", whiteSpace: "nowrap", fontSize: 12 }}>
                                <div
                                  aria-label="Score"
                                  title={r.csp?.breakdown.length ? r.csp.breakdown.join("\n") : "No factor scored"}
                                  style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.1, color: (r.csp?.score ?? 0) >= cspRules.strongAt ? "#0E7A72" : (r.csp?.score ?? 0) >= cspRules.reviewAt ? "#8A6D1F" : "var(--muted)" }}
                                >
                                  {r.csp?.perfect && <span title={"Asking for a partner, none assigned, annual upfront \u2014 the strongest lead on this list"} style={{ marginRight: 3 }}>{"\u2605"}</span>}
                                  {r.csp?.score ?? dash}
                                </div>
                                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
                                  {r.csp?.value != null && r.csp.value > 0 ? `$${r.csp.value.toLocaleString()}` : "no value"}
                                </div>
                                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                                  {r.csp?.ageDays == null ? "no dated note"
                                    : r.csp.ageDays === 0 ? "touched today" : `${r.csp.ageDays}d ago`}
                                </div>
                                {r.csp?.program && (
                                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }} title={r.csp.program}>
                                    {r.csp.program.replace(/^CSP\s*\|\s*/, "")}
                                  </div>
                                )}
                              </td>
                            )}
                            <td style={{ padding: "10px 10px", color: "var(--muted)", fontSize: 12.5, minWidth: 200, maxWidth: 300 }}>
                              <span className="clamp-3" title={r.campaign?.raw ? `${r.snippet}\n\nCampaign: ${r.campaign.raw}` : r.snippet}>{r.snippet}</span>
                              {/* The received date is not one of the nine, so it does not get
                                  a column of its own — but the Newest-first sort and the date
                                  filter are blind without it, so it rides along here. */}
                              <span
                                aria-label="Received"
                                title={isCsp ? "Term end date this lead is sorted and filtered by" : "When Microsoft pulled the Cloud Ascent data behind this lead"}
                                style={{ display: "block", marginTop: 3, fontSize: 11, opacity: 0.75, whiteSpace: "nowrap" }}
                              >
                                {r.receivedOn || "no date"}
                              </span>
                            </td>
                            {!isCsp && <td style={{ fontSize: 12, color: "var(--muted)", minWidth: 92, maxWidth: 130 }}>{title || dash}</td>}
                            <td style={{ fontSize: 11.5, wordBreak: "break-all", minWidth: 130 }}>{email || dash}</td>
                            <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{work || dash}</td>
                            <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{mob || dash}</td>
                            {!isCsp && <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{emp || dash}</td>}
                          </>
                        );
                      })()}
                      <td>
                        {r.leadKey ? (
                          <div style={{ display: "flex", gap: 3 }}>
                            {(["keep", "maybe", "reject"] as Curation[]).map((c) => (
                              <button
                                key={c}
                                className="btn btn-sm btn-ghost"
                                aria-label={`${cMeta[c].label} ${r.lead.company}`}
                                title={isCsp
                                  ? `Override to ${cMeta[c].label} priority${dec === c ? " (click to undo)" : ""}`
                                  : `${cMeta[c].label}${dec === c ? " (click to undo)" : ""}`}
                                style={dec === c ? { background: cMeta[c].bg, color: cMeta[c].color, fontWeight: 700 } : undefined}
                                onClick={() => curate(r.leadKey, c)}
                              >{cMeta[c].label}</button>
                            ))}
                          </div>
                        ) : (
                          <span style={{ fontSize: 11.5, color: "var(--muted)" }} title="Needs a company or contact column mapped to curate">no identity</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pager" style={{ marginTop: 10 }}>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE + 1}–{Math.min(page * PAGE, filtered.length)} of {filtered.length}
            </span>
            <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <span style={{ fontSize: 12.5 }}>Page {page} of {pages}</span>
            <button className="btn btn-sm btn-secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>

          {showColumns && profiles.length > 0 && (
            <div className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <div className="panel-title">Columns — what arrived in the file</div>
                <div className="panel-sub">
                  {result.columns.length} columns read. This is a check on the upload, not a download setting: every download is
                  the same nine columns, matching the Main Scanner. Struck-through rows are the CRM noise columns this scanner
                  ignores. Duplicate headers are auto-renamed (a second <code>description</code> arrives as <code>description_1</code>), so nothing is lost.
                </div>
              </div>
              <div className="panel-body">
                <table className="data-table">
                  <thead><tr><th>Column</th><th>Kind</th><th>Filled</th><th>Distinct</th><th>Examples</th></tr></thead>
                  <tbody>
                    {profiles.map((p) => {
                      const dropped = (active.excludedColumns ?? []).includes(p.name);
                      return (
                        <tr key={p.name} style={dropped ? { opacity: 0.55 } : undefined}>
                          <td>
                            <span style={{ fontWeight: 600, textDecoration: dropped ? "line-through" : undefined, color: dropped ? "var(--muted)" : undefined }} title={dropped ? "Treated as CRM noise — never used for identity" : undefined}>{p.name}</span>
                          </td>
                          <td style={{ color: "var(--muted)" }}>{p.kind}</td>
                          <td>{Math.round(p.fillRate * 100)}%</td>
                          <td>{p.distinct}</td>
                          <td style={{ color: "var(--muted)", fontSize: 12 }}>{p.samples.join(" · ") || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {runs.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <div className="panel-title">Past runs</div>
            <div className="panel-sub">Counts only — raw rows are deliberately not kept here.</div>
          </div>
          <div className="panel-body">
            {runs.slice(0, 8).map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 12.5 }}>
                <span style={{ minWidth: 150 }}>{new Date(r.at).toLocaleString()}</span>
                <span style={{ flex: 1, color: "var(--muted)" }}>{r.fileNames.join(", ")}</span>
                <span>{r.rowsRead} read</span>
                <span style={{ color: BUCKET2_META.priority.color }}>{r.counts.priority} priority</span>
                <button className="btn btn-sm btn-ghost" onClick={async () => { await deleteRun(r.id); setRuns((p) => p.filter((x) => x.id !== r.id)); }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
