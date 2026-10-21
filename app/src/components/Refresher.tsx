// All leads → Refresher: lists the platform suggests, and where each
// accepted list stands on its way into an Apollo sequence. See
// lib/refresher.ts for the rules. Nothing here writes to Apollo: accepting a
// suggestion makes a dated campaign list and hands over the import CSV, and
// the list reads "In sequence" once an Apollo check shows its leads there.
import { useMemo, useState } from "react";
import type { StoredLead } from "../lib/leadStore";
import type { CompanyProfile } from "../lib/companyProfiles";
import type { RosterIndex } from "../lib/apolloRoster";
import { campaignMembership, listRowKey, cycleDueOn, type LeadList } from "../lib/leadLists";
import { buildFactsMap } from "../lib/smartRules";
import { indexChecks, isGreenLit, laneOf, DEFAULT_CATCH_ALL_MIN, type EmailCheck } from "../lib/deliverability";
import { recycleOf, type RecycleRules } from "../lib/recycle";
import { VERDICT_META, verdictOf } from "../lib/leadStatus";
import { stripSnippetPrefix } from "../lib/detection";
import {
  buildSuggestions, defaultSequenceFor, dismissSuggestion, loadDismissed, clearDismissed, inSequence,
  handoffStage, HANDOFF_META, REFRESH_CAP, DISMISS_DAYS, GROUP_BY_LABEL, COMPANY_MIN, strongWithoutIndustry,
  draftFromKeywords, DRAFT_FIELD_LABEL, type RefreshSuggestion, type EmailReadiness, type GroupBy, type DraftField,
} from "../lib/refresher";
import { listRowForLead, MAIN_SEQUENCES } from "./ApolloStatus";

const LAST_SEQ_KEY = "refresherLastSequence";
function loadLastSeq(): Record<string, string> { try { return JSON.parse(localStorage.getItem(LAST_SEQ_KEY) || "{}"); } catch { return {}; } }
function saveLastSeq(v: Record<string, string>) { try { localStorage.setItem(LAST_SEQ_KEY, JSON.stringify(v)); } catch { /* preference only */ } }
const shortDate = (d = new Date()) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
// Which files to work from and how to cut the lists: per-browser preferences.
const FILES_KEY = "refresherFiles";
const GROUP_KEY = "refresherGroupBy";
function loadFiles(): string[] { try { const v = JSON.parse(localStorage.getItem(FILES_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } }
function loadGroup(): GroupBy { try { const v = localStorage.getItem(GROUP_KEY); return v === "company" || v === "industry" ? v : "product"; } catch { return "product"; } }

export default function Refresher({
  leads, companyProfiles, apolloIndex, emailChecks, lists, recycleRules, sequenceNames, onAccept, onCheck, checkBusy, onOpenLists,
}: {
  leads: StoredLead[];
  companyProfiles: CompanyProfile[];
  apolloIndex: RosterIndex | null;
  emailChecks: EmailCheck[];
  lists: LeadList[];
  recycleRules: RecycleRules;
  sequenceNames: string[];
  /** Download the import CSV, then file a dated campaign list. Null when the
   *  download was cancelled (nothing is filed). */
  onAccept: (a: { suggestionId: string; title: string; name: string; sequence: string; leads: StoredLead[] }) => Promise<{ listId: string; added: number } | null>;
  /** Read-only Apollo lookup, on the shared run shown at the top. */
  onCheck?: (leads: StoredLead[], label: string) => void;
  checkBusy?: boolean;
  onOpenLists?: () => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  const [lastSeq, setLastSeq] = useState<Record<string, string>>(loadLastSeq);
  const [seqPick, setSeqPick] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  /** Files picked to work from. Empty = every file. */
  const [files, setFilesState] = useState<string[]>(loadFiles);
  const [groupBy, setGroupByState] = useState<GroupBy>(loadGroup);
  const [fileQ, setFileQ] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftAsked, setDraftAsked] = useState("");
  const [draftField, setDraftField] = useState<DraftField>("all");
  const [draftStrong, setDraftStrong] = useState(true);
  const setFiles = (v: string[]) => { setFilesState(v); try { localStorage.setItem(FILES_KEY, JSON.stringify(v)); } catch { /* preference only */ } };
  const setGroupBy = (v: GroupBy) => { setGroupByState(v); try { localStorage.setItem(GROUP_KEY, v); } catch { /* preference only */ } };

  // Every uploaded file, newest upload first, with its lead count.
  const fileOptions = useMemo(() => {
    const m = new Map<string, { n: number; strong: number; at: string }>();
    for (const l of leads) for (const f of l.sourceFiles) {
      const at = l.fileSeen?.find((x) => x.file === f)?.at || l.firstSeenAt || "";
      const e = m.get(f) ?? { n: 0, strong: 0, at };
      e.n++; if (verdictOf(l.tier) === "strong") e.strong++;
      if (at && (!e.at || at < e.at)) e.at = at;
      m.set(f, e);
    }
    return [...m].sort((a, b) => b[1].at.localeCompare(a[1].at) || a[0].localeCompare(b[0]));
  }, [leads]);
  // A picked file that no longer exists (deleted, renamed) stops counting.
  const picked = useMemo(() => files.filter((f) => fileOptions.some(([x]) => x === f)), [files, fileOptions]);
  const scoped = useMemo(() => {
    if (!picked.length) return leads;
    const set = new Set(picked);
    return leads.filter((l) => l.sourceFiles.some((f) => set.has(f)));
  }, [leads, picked]);

  const catchAllMin = (() => { try { const v = Number(localStorage.getItem("catchAllMin")); return v > 0 && v <= 100 ? v : DEFAULT_CATCH_ALL_MIN; } catch { return DEFAULT_CATCH_ALL_MIN; } })();
  const facts = useMemo(() => buildFactsMap(leads, companyProfiles, apolloIndex), [leads, companyProfiles, apolloIndex]);
  const checkIndex = useMemo(() => indexChecks(emailChecks), [emailChecks]);
  const rowKeyOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads) m.set(l.key, listRowKey(listRowForLead(l, apolloIndex)));
    return m;
  }, [leads, apolloIndex]);
  const membership = useMemo(() => campaignMembership(lists), [lists]);

  const ctx = useMemo(() => ({
    leads: scoped, facts,
    email: (l: StoredLead): EmailReadiness => {
      const lane = laneOf(l.email, checkIndex.get((l.email || "").trim().toLowerCase()), catchAllMin, l.apollo?.live);
      return isGreenLit(lane) ? "ready" : lane === "unverified" ? "unchecked" : "flagged";
    },
    onLiveCampaign: (l: StoredLead) => membership.has(rowKeyOf.get(l.key) || ""),
    recycleReady: (l: StoredLead) => recycleOf(l, recycleRules).stage === "ready",
  }), [scoped, facts, checkIndex, catchAllMin, membership, rowKeyOf, recycleRules]);
  const suggestions = useMemo(() => buildSuggestions(ctx, dismissed, groupBy), [ctx, dismissed, groupBy]);
  const draft = useMemo(() => (draftAsked ? draftFromKeywords(ctx, draftAsked, draftField, draftStrong) : null), [ctx, draftAsked, draftField, draftStrong]);
  const noIndustry = useMemo(() => (groupBy === "industry" ? strongWithoutIndustry(ctx) : 0), [ctx, groupBy]);
  const shownFiles = fileOptions.filter(([f]) => !fileQ.trim() || f.toLowerCase().includes(fileQ.trim().toLowerCase()));

  const sequences = useMemo(() => {
    const set = new Set<string>([...MAIN_SEQUENCES, ...sequenceNames]);
    for (const l of leads) for (const s of l.apollo?.sequences ?? []) set.add(s.name);
    return [...set].filter(Boolean);
  }, [leads, sequenceNames]);

  // Lists accepted from here, and how far each has got into its sequence.
  const handoffs = useMemo(() => {
    const byRow = new Map<string, StoredLead>();
    for (const l of leads) { const k = rowKeyOf.get(l.key); if (k) byRow.set(k, l); }
    return lists.filter((l) => l.targetSequence && l.status !== "cycled").map((list) => {
      const members = list.rows.map((r) => byRow.get(r.__rowKey)).filter((x): x is StoredLead => !!x);
      const confirmed = members.filter((l) => inSequence(l, list.targetSequence!, apolloIndex));
      const waiting = members.filter((l) => !inSequence(l, list.targetSequence!, apolloIndex));
      return { list, members, confirmed: confirmed.length, waiting, stage: handoffStage(confirmed.length, list.rows.length) };
    }).sort((a, b) => (b.list.handedOffAt || b.list.createdAt).localeCompare(a.list.handedOffAt || a.list.createdAt));
  }, [lists, leads, rowKeyOf, apolloIndex]);

  async function accept(s: RefreshSuggestion) {
    const sequence = seqPick[s.id] ?? defaultSequenceFor(s, sequences, lastSeq[s.id]);
    const name = (names[s.id] ?? `${s.title} — ${shortDate()}`).trim();
    if (!sequence || !name || !s.ready.length || busy) return;
    setBusy(s.id);
    try {
      const r = await onAccept({ suggestionId: s.id, title: s.title, name, sequence, leads: s.ready });
      if (r) {
        const next = { ...lastSeq, [s.id]: sequence };
        setLastSeq(next); saveLastSeq(next);
        setNotice((n) => ({ ...n, [s.id]: `Filed "${name}" with ${r.added.toLocaleString()} leads for ${sequence}. Import the CSV into Apollo and add them to that sequence; it reads In sequence once an Apollo check sees them there.` }));
      } else {
        setNotice((n) => ({ ...n, [s.id]: "Download cancelled, so nothing was filed." }));
      }
    } finally { setBusy(""); }
  }

  function renderCard(s: RefreshSuggestion) {
            const seq = seqPick[s.id] ?? defaultSequenceFor(s, sequences, lastSeq[s.id]);
            const name = names[s.id] ?? `${s.title} — ${shortDate()}`;
            return (
              <div key={s.id} className="panel" aria-label={`Suggestion ${s.title}`} style={{ padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <b style={{ fontSize: 14 }}>{s.title}</b>
                  <span style={{ fontSize: 12.5 }}><b>{s.ready.length.toLocaleString()}</b> ready{s.readyTotal > s.ready.length ? <span className="muted"> of {s.readyTotal.toLocaleString()}</span> : ""}</span>
                </div>
                <div className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>{s.why}</div>
                {(s.unchecked.length > 0 || s.flagged > 0) && (
                  <div style={{ fontSize: 12, marginBottom: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {s.unchecked.length > 0 && <span>{s.unchecked.length.toLocaleString()} more need an email check</span>}
                    {s.unchecked.length > 0 && onCheck && (
                      <button className="btn btn-sm btn-ghost" disabled={checkBusy} title="Read-only Apollo lookup. Settles the email status for free; up to 400 an hour."
                              onClick={() => onCheck(s.unchecked.slice(0, 400), `the "${s.title}" suggestion`)}>
                        ⟳ Check {Math.min(400, s.unchecked.length).toLocaleString()} in Apollo
                      </button>
                    )}
                    {s.flagged > 0 && <span className="muted" title="Apollo or a verifier flagged the email. Left for calling.">· {s.flagged.toLocaleString()} flagged, left for calling</span>}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
                  <select className="field" aria-label={`Sequence for ${s.title}`} value={seq} onChange={(e) => setSeqPick((p) => ({ ...p, [s.id]: e.target.value }))} style={{ maxWidth: 220 }}>
                    {!seq && <option value="">Pick a sequence…</option>}
                    {sequences.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <input className="field" aria-label={`List name for ${s.title}`} value={name} onChange={(e) => setNames((p) => ({ ...p, [s.id]: e.target.value }))} style={{ flex: 1, minWidth: 140 }} />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  <button className="btn btn-sm btn-primary" disabled={!s.ready.length || !seq || !!busy} onClick={() => void accept(s)}
                          title="Hands you the Apollo import CSV, then files a dated campaign list tagged with this sequence.">
                    {busy === s.id ? "Preparing…" : `✓ Accept ${s.ready.length.toLocaleString()} + download`}
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                    {open === s.id ? "Hide" : "Preview"}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => { dismissSuggestion(s.id); setDismissed(loadDismissed()); }} title={`Hide this suggestion for ${DISMISS_DAYS} days`}>
                    Dismiss
                  </button>
                </div>
                {notice[s.id] && <div role="status" style={{ fontSize: 12, marginTop: 6 }}>{notice[s.id]}</div>}
                {open === s.id && (
                  <table className="data-table" aria-label={`Preview ${s.title}`} style={{ marginTop: 8, fontSize: 12 }}>
                    <thead><tr><th>Company</th><th>Contact</th><th>Signal</th><th>Note</th></tr></thead>
                    <tbody>
                      {s.ready.slice(0, 10).map((l) => {
                        const v = VERDICT_META[verdictOf(l.tier)];
                        return (
                          <tr key={l.key}>
                            <td>{l.company}</td><td>{l.contact}</td>
                            <td><span className="pill" style={{ color: v.color, background: v.bg }}>{v.label}</span></td>
                            <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={stripSnippetPrefix(l.notes || "")}>{stripSnippetPrefix(l.notes || "")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Refresher</h2>
          <p className="page-sub" style={{ maxWidth: 780 }}>
            Lists worth sending next, from the files you pick: leads that are fresh or went nowhere. Left out: anyone active in a
            sequence, a deal or meeting on file (HubSpot, Notion, Echo), a successful conversation (info requested, pending review,
            replied, meeting booked), not interested or do not contact, and anyone already on a live campaign list. Up to {REFRESH_CAP} leads
            per list, green-lit emails only. Accepting one files a dated campaign list and hands you the Apollo import CSV. Nothing is sent to Apollo from here.
          </p>
        </div>
        {dismissed.size > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={() => { clearDismissed(); setDismissed(new Set()); }}>Show {dismissed.size} dismissed</button>
        )}
      </div>

      <div className="panel" aria-label="Refresher scope" style={{ padding: "10px 14px", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
          <b>Build lists by</b>
          <div className="seg" role="group" aria-label="Build lists by">
            {(Object.keys(GROUP_BY_LABEL) as GroupBy[]).map((g) => (
              <button key={g} className={"seg-btn" + (groupBy === g ? " active" : "")} aria-pressed={groupBy === g} onClick={() => setGroupBy(g)}>{GROUP_BY_LABEL[g]}</button>
            ))}
          </div>
          <span className="muted" aria-label="Files in scope">
            {picked.length ? `${picked.length} file${picked.length === 1 ? "" : "s"} picked · ${scoped.length.toLocaleString()} leads` : `Every file · ${leads.length.toLocaleString()} leads`}
          </span>
        </div>
        {groupBy === "company" && <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>One list per company with {COMPANY_MIN}+ Strong Signal people who are fresh or went nowhere, biggest first.</div>}
        {groupBy === "industry" && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            Industry comes from enriched company data only.{noIndustry > 0 && <> {noIndustry.toLocaleString()} Strong Signal leads in scope have no industry yet: enrich their companies in All leads to bring them in.</>}
          </div>
        )}
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: 12.5 }}>Pick files to work from{picked.length ? ` (${picked.length})` : ""}</summary>
          <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0", flexWrap: "wrap" }}>
            <input className="field" aria-label="Find a file" placeholder="Find a file" value={fileQ} onChange={(e) => setFileQ(e.target.value)} style={{ minWidth: 200 }} />
            {picked.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setFiles([])}>Use every file</button>}
          </div>
          <div aria-label="Files" style={{ maxHeight: 220, overflowY: "auto", display: "grid", gap: 2, fontSize: 12.5 }}>
            {shownFiles.map(([f, e]) => {
              const on = picked.includes(f);
              return (
                <label key={f} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" aria-label={`File ${f}`} checked={on} onChange={() => setFiles(on ? picked.filter((x) => x !== f) : [...picked, f])} />
                  <span style={{ flex: 1 }}>{f}</span>
                  <span className="muted">{e.at.slice(0, 10)} · {e.n.toLocaleString()} leads · {e.strong.toLocaleString()} Strong</span>
                </label>
              );
            })}
            {!shownFiles.length && <span className="muted">No file matches.</span>}
          </div>
        </details>
      </div>

      <div className="panel" aria-label="Draft from keywords" style={{ padding: "10px 14px", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
          <b>Draft from keywords</b>
          <input className="field" aria-label="Draft keywords" value={draftText} onChange={(e) => setDraftText(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") setDraftAsked(draftText.trim()); }}
                 placeholder='e.g. controller, cfo, manufacturing, "business central"' style={{ flex: 1, minWidth: 260 }} />
          <select className="field" aria-label="Match keywords in" value={draftField} onChange={(e) => setDraftField(e.target.value as DraftField)}>
            {(Object.keys(DRAFT_FIELD_LABEL) as DraftField[]).map((k) => <option key={k} value={k}>{DRAFT_FIELD_LABEL[k]}</option>)}
          </select>
          <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" aria-label="Strong Signal only" checked={draftStrong} onChange={(e) => setDraftStrong(e.target.checked)} /> Strong Signal only
          </label>
          <button className="btn btn-sm btn-primary" disabled={!draftText.trim()} onClick={() => setDraftAsked(draftText.trim())}>Draft list</button>
          {draftAsked && <button className="btn btn-sm btn-ghost" onClick={() => { setDraftAsked(""); setDraftText(""); }}>Clear</button>}
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
          Commas mean any of these. Within one part: every word, "an exact phrase", -leave out. Title, industry (enriched), company and the scanned note are searched.
        </div>
        {draftAsked && !draft && <div role="status" style={{ fontSize: 12, marginTop: 6 }}>Nothing to search for in that.</div>}
        {draft && (draft.ready.length + draft.unchecked.length + draft.flagged === 0
          ? <div role="status" style={{ fontSize: 12, marginTop: 6 }}>No lead {picked.length ? "in the picked files " : ""}matches that and is fresh or went nowhere.</div>
          : <div style={{ marginTop: 10, maxWidth: 520 }}>{renderCard(draft)}</div>)}
      </div>

      <h3 style={{ fontSize: 14, margin: "4px 0 8px" }}>Suggested lists</h3>
      {suggestions.length === 0 ? (
        <div className="calm-state"><div className="calm-title">Nothing to suggest right now</div>
          <div className="calm-body">Every likely lead in {picked.length ? "the picked files" : "scope"} is already on a live campaign list, in a sequence, closed out, or had a conversation that went somewhere. Pick other files, another way to build lists, or upload new leads.</div></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12, marginBottom: 18 }}>
          {suggestions.map(renderCard)}
        </div>
      )}

      <h3 style={{ fontSize: 14, margin: "4px 0 8px" }}>Handed off to Apollo</h3>
      {handoffs.length === 0 ? (
        <p className="muted" style={{ fontSize: 12.5 }}>Accepted lists show here with how many of their leads an Apollo check has seen in the sequence.</p>
      ) : (
        <div className="table-card">
          <table className="data-table" aria-label="Handed off lists">
            <thead><tr><th>List</th><th>Sequence</th><th>Handed off</th><th>Stage</th><th className="num">In sequence</th><th>Cycles</th><th></th></tr></thead>
            <tbody>
              {handoffs.map(({ list, confirmed, waiting, stage }) => {
                const m = HANDOFF_META[stage];
                return (
                  <tr key={list.id} aria-label={`Handoff ${list.name}`}>
                    <td style={{ fontWeight: 600 }}>{list.name}</td>
                    <td>{list.targetSequence}</td>
                    <td>{(list.handedOffAt || list.createdAt).slice(0, 10)}</td>
                    <td><span className="pill" title={m.hint} style={{ color: m.color, background: m.bg }}>{m.label}</span></td>
                    <td className="num">{confirmed.toLocaleString()} / {list.rows.length.toLocaleString()}</td>
                    <td>{cycleDueOn(list) ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {waiting.length > 0 && onCheck && (
                        <button className="btn btn-sm btn-ghost" disabled={checkBusy} onClick={() => onCheck(waiting.slice(0, 400), `the "${list.name}" list`)}
                                title="Read-only Apollo lookup of the leads not yet seen in the sequence.">
                          ⟳ Check {Math.min(400, waiting.length)}
                        </button>
                      )}
                      {onOpenLists && <button className="btn btn-sm btn-ghost" onClick={onOpenLists}>Open in Lists</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
