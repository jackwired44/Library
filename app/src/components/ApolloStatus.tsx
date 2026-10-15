// In Apollo — is this lead active in Apollo, and in which sequence.
//
// Per Jack: "the apollo queue isnt what i want … i want to be able to see if
// a lead is active in apollo from here and if so which sequence." This
// replaces the queue (which pre-assigned sequences here, something he does
// in Apollo, not in this platform).
//
// Read-only. Two sources, both already on the device:
//   - an imported Apollo sync matched to the lead (lead.apollo), which
//     carries each sequence's status, step and date;
//   - the pulled Apollo uploads (the roster), matched by email or a unique
//     full name, which carries each sequence with "(active)" on live ones.
// Nothing here writes to Apollo or assigns anything.
import RateLimitNote from "./RateLimitNote";
import { leadsDueForApollo } from "./ApolloSyncPanel";
import { useMemo, useRef, useState } from "react";
import { toCSV, downloadBlob } from "../lib/csv";
import { stripSnippetPrefix, type ExportRow } from "../lib/detection";
import type { LeadList } from "../lib/leadLists";
import type { StoredLead } from "../lib/leadStore";
import { apolloHitFor, type RosterIndex } from "../lib/apolloRoster";
import { DEFAULT_PULL_MONTHS, type PullProgress, type CheckProgress } from "../lib/apolloLive";
import { VERDICT_META, VERDICT_ORDER, verdictOf, type Verdict } from "../lib/leadStatus";

// Per Jack: "i want to be able to see where a lead stands and act on the
// ones who have never been reached or slip being added into a sequence".
// So an ended sequence is split by whether Apollo says the person was
// reached, and "not checked yet" is its own state rather than being
// counted as "not in Apollo" — the two mean very different things.
type Status = "active" | "finished" | "reached" | "none" | "out" | "unchecked";
const STATUS_META: Record<Status, { label: string; short: string; hint: string; color: string; bg: string }> = {
  active: { label: "Active in a sequence", short: "Active", hint: "In Apollo and live in at least one sequence right now.", color: "#0A66C2", bg: "#EAF3FC" },
  finished: { label: "Sequence ended, never reached", short: "Ended · not reached", hint: "Every sequence they were in has ended or paused, and Apollo records no conversation, reply or meeting. Ready to go again.", color: "#8A5A00", bg: "#FFF4DD" },
  reached: { label: "Sequence ended, reached", short: "Ended · reached", hint: "A sequence ended because they replied, were spoken to, booked, or opted out. Not a re-add.", color: "#5B3FC4", bg: "#EEEAFC" },
  none: { label: "In Apollo, no sequence", short: "No sequence", hint: "A contact in Apollo that was never put in a sequence.", color: "#B5443B", bg: "#FBEAE8" },
  out: { label: "Not in Apollo", short: "Not in Apollo", hint: "Looked up in Apollo and not found — never added.", color: "#B5443B", bg: "#FBEAE8" },
  unchecked: { label: "Not checked yet", short: "Not checked", hint: "Not looked up in Apollo yet. Run a check to see where it stands.", color: "#4C6167", bg: "#EEF1F2" },
};
const STATUS_ORDER: Status[] = ["active", "finished", "reached", "none", "out", "unchecked"];
/** The ones to act on: never reached, or never put into a sequence. */
const NEEDS: ReadonlySet<Status> = new Set(["finished", "none", "out"]);
type StatusFilter = Status | "all" | "needs";
/** An ended sequence whose reason means a person answered or closed it out. */
const REACHED_REASON_RE = /talk|spoke|repl|meet|book|demo|interest|unsub|opt.?out|do not|bounc|wrong|left company/i;

interface Seq { name: string; active: boolean; status: string; step: number | null; addedAt: string; steps?: number; finishedAt?: string; reason?: string }
interface Row { lead: StoredLead; status: Status; seqs: Seq[]; how: string }

const PAGE = 100;

// Per Jack: "select the leads and download them to a csv for export ... after
// its confirmed where they stand". One row per lead; a lead in several
// sequences lists them all, the live one first.
const STATUS_EXPORT_COLUMNS = ["First Name", "Last Name", "Company", "Email", "Work Direct Phone", "Mobile Phone", "Title",
  "Stored As", "Apollo Status", "Sequence", "Sequence Status", "Step", "Added", "Ended", "Apollo Reason", "Checked On", "Matched By", "Notes"] as const;

function exportRow(r: Row): Record<string, string> {
  const [first, ...rest] = (r.lead.contact || "").trim().split(/\s+/);
  const seqs = [...r.seqs].sort((a, b) => Number(b.active) - Number(a.active));
  const join = (f: (s: Seq) => string) => seqs.map(f).filter(Boolean).join(" | ");
  return {
    "First Name": first || "", "Last Name": rest.join(" "), Company: r.lead.company, Email: r.lead.email,
    "Work Direct Phone": r.lead.phone, "Mobile Phone": r.lead.mobilePhone, Title: r.lead.title,
    "Stored As": VERDICT_META[verdictOf(r.lead.tier)].label,
    "Apollo Status": STATUS_META[r.status].label,
    Sequence: join((s) => s.name),
    "Sequence Status": join((s) => (s.active ? "active" : s.status)),
    Step: join((s) => (s.step != null ? `${s.step}${s.steps ? ` of ${s.steps}` : ""}` : "")),
    Added: join((s) => (s.addedAt || "").slice(0, 10)),
    Ended: join((s) => (s.finishedAt || "").slice(0, 10)),
    "Apollo Reason": join((s) => s.reason || ""),
    "Checked On": (r.lead.apolloCheckedAt || "").slice(0, 10),
    "Matched By": r.how,
    Notes: r.lead.notes,
  };
}

/** A lead in the list/export shape, with where it stands in Apollo up front
 *  in the note so a list keeps the classification it was built from. */
function listRowFor(r: Row): ExportRow {
  const [first, ...rest] = (r.lead.contact || "").trim().split(/\s+/);
  const live = r.seqs.find((s) => s.active) ?? r.seqs[0];
  const where = `Apollo: ${STATUS_META[r.status].short}${live ? ` (${live.name})` : ""}`;
  const note = stripSnippetPrefix(r.lead.notes || "");
  return {
    "First Name": first || "", "Last Name": rest.join(" "), Title: r.lead.title, "Company Name": r.lead.company,
    Email: r.lead.email, "Work Direct Phone": r.lead.phone, "Mobile Phone": r.lead.mobilePhone,
    "Number of Employees": "", "Product Area": r.lead.productArea, Notes: note ? `${where} · ${note}` : where,
  };
}

function rowFor(l: StoredLead, index: RosterIndex | null): Row {
  if (l.apollo) {
    const seqs = l.apollo.sequences.map((s) => ({
      name: s.name, active: s.status === "active", status: s.status, step: s.step, addedAt: s.addedAt ?? "",
      steps: s.steps, finishedAt: s.finishedAt, reason: s.reason,
    }));
    const lv = l.apollo.live;
    const how = lv
      ? [`Apollo check ${l.apollo.syncedAt.slice(0, 10)}`, lv.owner && `owner ${lv.owner}`, lv.lastActivityAt && `last activity ${lv.lastActivityAt}`].filter(Boolean).join(" · ")
      : "Apollo sync";
    return { lead: l, seqs, how, status: statusOfSeqs(seqs) };
  }
  const hit = apolloHitFor({ email: l.email, contact: l.contact }, index);
  if (!hit) return l.apolloCheckedAt
    ? { lead: l, seqs: [], how: `Apollo check ${l.apolloCheckedAt.slice(0, 10)}`, status: "out" }
    : { lead: l, seqs: [], how: "not checked yet", status: "unchecked" };
  const seqs = hit.sequences.map((label) => {
    const active = /\(active\)$/.test(label);
    return { name: label.replace(/\s*\(active\)$/, ""), active, status: active ? "active" : "ended", step: null, addedAt: "" };
  });
  return {
    lead: l, seqs, how: hit.how === "email" ? "email" : "name",
    status: statusOfSeqs(seqs),
  };
}

function statusOfSeqs(seqs: Seq[]): Status {
  if (seqs.some((s) => s.active)) return "active";
  if (!seqs.length) return "none";
  return seqs.some((s) => s.reason && REACHED_REASON_RE.test(s.reason)) ? "reached" : "finished";
}

export default function ApolloStatus({
  leads, apolloIndex, rosterPulledAt = "", onPullApollo, onCheckLeads, lists = [], onAddToList,
}: {
  lists?: LeadList[];
  onAddToList?: (rows: { row: ExportRow; scanner: "main" | "smc" | "csp" }[], opts: { existingId?: string; newName?: string }) => { listId: string; added: number; skipped: number } | null;
  leads: StoredLead[];
  apolloIndex: RosterIndex | null;
  rosterPulledAt?: string;
  onPullApollo?: (months: number, onProgress: (p: PullProgress) => void, signal: AbortSignal) => Promise<PullProgress>;
  onCheckLeads?: (leads: StoredLead[], onProgress: (p: CheckProgress) => void, signal: AbortSignal) => Promise<CheckProgress>;
}) {
  // Per Jack: "the contacts in the all leads here for strong signal only".
  // Per Jack: "every lead uploaded into this platform regardless of the
  // scanner will get ran against sequences in apollo" and "just because its
  // a bad lead doesnt mean we wont ever reach out". So every tier, by default.
  const [verdictF, setVerdictF] = useState<Verdict | "all">("all");
  // Opens on the leads to act on once anything has been checked; before
  // that "needs" would be empty, so it opens on everyone.
  const [statusF, setStatusF] = useState<StatusFilter>(() => (leads.some((l) => l.apolloCheckedAt || l.apollo) ? "needs" : "all"));
  const [check, setCheck] = useState<CheckProgress | null>(null);
  const [checkError, setCheckError] = useState("");
  const [recheck, setRecheck] = useState(false);
  const checkAbort = useRef<AbortController | null>(null);
  const [seqF, setSeqF] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pull, setPull] = useState<PullProgress | null>(null);
  const [pullError, setPullError] = useState("");
  const [months, setMonths] = useState(DEFAULT_PULL_MONTHS);
  const abort = useRef<AbortController | null>(null);
  // Per Jack: "select all or select one by one or multiple". Lead keys.
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Per Jack: "need to be able to select the quantity and not just all at
  // once every time". How many of the due Strong Signal leads one click runs.
  const [qty, setQty] = useState<number>(100);
  // Per Jack: "lists manually created so i can classify them all and then
  // download as needed or edit" — these are the platform's own Lists.
  const [listTarget, setListTarget] = useState<string>("");
  const [newListName, setNewListName] = useState("");
  const [listNotice, setListNotice] = useState("");

  const rows = useMemo(() => leads
    .filter((l) => verdictF === "all" || verdictOf(l.tier) === verdictF)
    .map((l) => rowFor(l, apolloIndex)), [leads, apolloIndex, verdictF]);

  // The check runs over the leads the "Stored as" filter shows (every tier
  // by default), Strong Signal first, then newest. Leads looked up in the
  // last 7 days are skipped unless "re-check" is ticked, so a stopped run
  // picks up where it left off.
  const scope = useMemo(() => leads.filter((l) => verdictF === "all" || verdictOf(l.tier) === verdictF), [leads, verdictF]);
  const toCheck = useMemo(() => recheck ? leadsDueForApollo(scope, Date.now(), true) : leadsDueForApollo(scope), [scope, recheck]);
  const scopeNoun = verdictF === "all" ? "lead" : `${VERDICT_META[verdictF].label} lead`;

  // A selection is checked as picked — any tier, re-check or not.
  const selected = useMemo(() => leads.filter((l) => sel.has(l.key)), [leads, sel]);

  async function runCheck(only?: StoredLead[]) {
    const targets = only ?? (selected.length ? selected : (qty > 0 ? toCheck.slice(0, qty) : toCheck));
    if (!onCheckLeads || (check && !check.finished) || !targets.length) return;
    const ac = new AbortController();
    checkAbort.current = ac;
    setCheckError("");
    setCheck({ total: targets.length, done: 0, found: 0, notFound: 0, skipped: 0, errors: 0, finished: false });
    try {
      const p = await onCheckLeads(targets, setCheck, ac.signal);
      setCheck({ ...p, finished: true });
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
      setCheck((x) => (x ? { ...x, finished: true } : x));
    } finally { checkAbort.current = null; }
  }

  const counts = useMemo(() => {
    const m: Record<Status, number> = { active: 0, finished: 0, reached: 0, none: 0, out: 0, unchecked: 0 };
    for (const r of rows) m[r.status]++;
    return { ...m, needs: m.finished + m.none + m.out };
  }, [rows]);

  // Sequences people are ACTIVE in, with how many — the "which sequence".
  const activeBySeq = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const s of r.seqs) if (s.active) m.set(s.name, (m.get(s.name) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const allSeqs = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const s of r.seqs) m.set(s.name, (m.get(s.name) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => rows.filter((r) =>
    (statusF === "all" || (statusF === "needs" ? NEEDS.has(r.status) : r.status === statusF))
    && (seqF === "all" || r.seqs.some((s) => s.name === seqF && (statusF !== "active" || s.active)))
    && (!needle || `${r.lead.company} ${r.lead.contact} ${r.lead.email}`.toLowerCase().includes(needle)),
  ), [rows, statusF, seqF, needle]);
  const shown = filtered.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

  async function runPull() {
    if (!onPullApollo || (pull && !pull.done)) return;
    const ac = new AbortController();
    abort.current = ac;
    setPullError("");
    setPull({ pages: 0, scanned: 0, kept: 0, reachedDate: "", done: false, hitCeiling: false });
    try {
      const p = await onPullApollo(months, setPull, ac.signal);
      setPull({ ...p, done: true });
    } catch (e) {
      setPullError(e instanceof Error ? e.message : String(e));
      setPull((x) => (x ? { ...x, done: true } : x));
    } finally { abort.current = null; }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>In Apollo</h2>
          <p className="page-sub">Whether each lead here is in Apollo, and which sequence they're active in.</p>
        </div>
      </div>

      {onCheckLeads && (
        <div className="panel" style={{ marginBottom: 10 }}>
          <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
            <span style={{ color: "var(--muted)" }}>
              Look up where each lead stands in Apollo, any tier, Strong Signal first — sequence, step, finished and why.
              Free and read-only; nothing is written to Apollo.
            </span>
            <div className="toolbar-spacer" />
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
              <input type="checkbox" checked={recheck} disabled={!!check && !check.finished} onChange={(e) => setRecheck(e.target.checked)} />
              Re-check ones done this week
            </label>
            {check && !check.finished
              ? <button className="btn btn-sm btn-secondary" onClick={() => checkAbort.current?.abort()}>Stop</button>
              : selected.length > 0
                ? <button className="btn btn-sm btn-primary" onClick={() => runCheck()}
                          title="One Apollo contact search per selected lead. Free, read-only.">
                    Check {selected.length.toLocaleString()} selected
                  </button>
                : <>
                    <select className="field" aria-label="How many to check" value={qty}
                            onChange={(e) => setQty(Number(e.target.value))}>
                      {[25, 50, 100, 200, 400].map((n) => <option key={n} value={n}>Batch of {n}{n === 400 ? " (Apollo's hourly max)" : ""}</option>)}
                      <option value={0}>All due</option>
                    </select>
                    <button className="btn btn-sm btn-primary" disabled={!toCheck.length} onClick={() => runCheck()}
                            title="One Apollo contact search per lead, by email (or full name + company). Free, read-only. Next run picks up where this one stopped.">
                      {(() => { const n = qty > 0 ? Math.min(qty, toCheck.length) : toCheck.length;
                        return <>Check {n.toLocaleString()} {scopeNoun}{n === 1 ? "" : "s"}{n < toCheck.length ? <span style={{ opacity: 0.75 }}> of {toCheck.length.toLocaleString()}</span> : null}</>; })()}
                    </button>
                  </>}
          </div>
          {(check || checkError) && (
            <div className="panel-body" style={{ paddingTop: 0, fontSize: 12 }} aria-label="Apollo check">
              {check && <>
                {check.finished ? "Checked" : "Checking…"} <b>{check.done.toLocaleString()}</b> of {check.total.toLocaleString()}
                {" · "}<b>{check.found.toLocaleString()}</b> in Apollo · {check.notFound.toLocaleString()} not in Apollo
                {check.skipped > 0 && <> · {check.skipped.toLocaleString()} skipped (no email or full name)</>}
                {check.errors > 0 && <span style={{ color: "#B5443B" }}> · {check.errors} failed{check.lastError ? `: ${check.lastError}` : ""}</span>}
                <RateLimitNote progress={check} />
              </>}
              {checkError && <span style={{ color: "#B5443B" }}> Apollo check stopped: {checkError}</span>}
            </div>
          )}
        </div>
      )}

      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-body" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
          <span style={{ color: "var(--muted)" }}>
            {rosterPulledAt
              ? <>Apollo uploads last pulled <b style={{ color: "var(--ink)" }}>{rosterPulledAt.slice(0, 10)}</b>. Sequence status is only as fresh as that.</>
              : <>Apollo uploads not pulled yet — pull them to see who is active in which sequence.</>}
          </span>
          <div className="toolbar-spacer" />
          {onPullApollo && (
            <>
              <select className="field" aria-label="How far back" value={months} disabled={!!pull && !pull.done}
                      onChange={(e) => setMonths(Number(e.target.value))}>
                {[1, 2, 3, 4, 6].map((m) => <option key={m} value={m}>Last {m} month{m === 1 ? "" : "s"}</option>)}
              </select>
              {pull && !pull.done
                ? <button className="btn btn-sm btn-secondary" onClick={() => abort.current?.abort()}>Stop</button>
                : <button className="btn btn-sm btn-primary" onClick={runPull}
                          title="Read the CSV uploads you made into Apollo for you and Carly, with each contact's sequences. Read-only.">
                    ⟳ Refresh from Apollo
                  </button>}
            </>
          )}
        </div>
        {(pull || pullError) && (
          <div className="panel-body" style={{ paddingTop: 0, fontSize: 12 }} aria-label="Apollo pull">
            {pull && !pull.done && <>Reading Apollo… {pull.scanned.toLocaleString()} contacts read, back to {pull.reachedDate || "—"} · <b>{pull.kept.toLocaleString()}</b> of yours kept.</>}
            {pull && pull.done && !pullError && <>Pulled <b>{pull.kept.toLocaleString()}</b> Apollo uploads{pull.reachedDate ? ` back to ${pull.reachedDate}` : ""}.{pull.hitCeiling && " Apollo's 50,000-contact limit stopped it early — pick a shorter window."}</>}
            {pullError && <span style={{ color: "#B5443B" }}>Apollo pull stopped: {pullError}</span>}
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="panel-body" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="vault-tile" aria-pressed={statusF === "needs"}
                  title="Never reached, or never put in a sequence: sequence ended without a conversation, in Apollo with no sequence, or not in Apollo at all."
                  style={{ borderColor: statusF === "needs" ? "var(--brand, #0E7A72)" : undefined, borderWidth: 2, background: statusF === "needs" ? "var(--brand-subtle, #E3F3F1)" : undefined }}
                  onClick={() => { setStatusF(statusF === "needs" ? "all" : "needs"); setPage(1); }}>
            <span className="vault-num" style={{ color: "var(--brand, #0E7A72)" }}>{counts.needs.toLocaleString()}</span>
            <span><b>Needs a sequence</b></span>
          </button>
          {STATUS_ORDER.map((s) => {
            const on = statusF === s; const m = STATUS_META[s];
            return (
              <button key={s} className="vault-tile" aria-pressed={on} title={m.hint}
                      style={{ borderColor: on ? m.color : undefined, background: on && m.bg !== "transparent" ? m.bg : undefined }}
                      onClick={() => { setStatusF(on ? "all" : s); setPage(1); }}>
                <span className="vault-num" style={{ color: m.color }}>{counts[s].toLocaleString()}</span>
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
        {activeBySeq.length > 0 && (
          <div className="panel-body" style={{ paddingTop: 0, fontSize: 12, color: "var(--muted)" }}>
            Active by sequence:{" "}
            {activeBySeq.map(([n, c], i) => (
              <span key={n}>
                {i > 0 && " · "}
                <button className="btn btn-sm btn-ghost" style={{ padding: "0 4px" }}
                        onClick={() => { setStatusF("active"); setSeqF(n); setPage(1); }}>
                  {n} <b>{c.toLocaleString()}</b>
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="toolbar">
        <div className="toolbar-row">
          <input className="field" placeholder="Search company, contact, email…" value={q}
                 onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ flex: 1, minWidth: 220, maxWidth: 360 }} />
          <select className="field" aria-label="Stored as" value={verdictF} onChange={(e) => { setVerdictF(e.target.value as Verdict | "all"); setPage(1); }}>
            <option value="all">Stored as: any</option>
            {VERDICT_ORDER.map((v) => <option key={v} value={v}>{VERDICT_META[v].label}</option>)}
          </select>
          <select className="field" aria-label="Sequence" value={seqF} onChange={(e) => { setSeqF(e.target.value); setPage(1); }}>
            <option value="all">Sequence: any</option>
            {allSeqs.map(([n, c]) => <option key={n} value={n}>{n} ({c.toLocaleString()})</option>)}
          </select>
          <div className="toolbar-spacer" />
          <span style={{ fontSize: 12, color: "var(--muted)" }}><b>{filtered.length.toLocaleString()}</b> of {rows.length.toLocaleString()}</span>
        </div>
        <div className="toolbar-row" aria-label="Selection" style={{ fontSize: 12 }}>
          <button className="btn btn-sm btn-ghost" disabled={!shown.length}
                  onClick={() => setSel((s) => { const n = new Set(s); shown.forEach((r) => n.add(r.lead.key)); return n; })}>
            Select page ({shown.length.toLocaleString()})
          </button>
          <button className="btn btn-sm btn-ghost" disabled={!filtered.length}
                  onClick={() => setSel(new Set(filtered.map((r) => r.lead.key)))}>
            Select all {filtered.length.toLocaleString()} matched
          </button>
          <button className="btn btn-sm btn-secondary" disabled={!sel.size && !filtered.length}
                  title="A CSV of these leads with where each one stands in Apollo"
                  onClick={() => {
                    const pick = sel.size ? rows.filter((r) => sel.has(r.lead.key)) : filtered;
                    const stamp = new Date().toISOString().slice(0, 10);
                    void downloadBlob(toCSV(pick.map(exportRow), STATUS_EXPORT_COLUMNS), `apollo-status-${stamp}.csv`);
                  }}>
            ⬇ Download {sel.size ? `${sel.size.toLocaleString()} selected` : `${filtered.length.toLocaleString()} shown`}
          </button>
          {sel.size > 0 && <>
            <span><b>{sel.size.toLocaleString()}</b> selected</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>Clear</button>
            {onAddToList && <>
              <select className="field" aria-label="Add to list" value={listTarget} onChange={(e) => setListTarget(e.target.value)}>
                <option value="">＋ New list…</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.rows.length})</option>)}
              </select>
              {!listTarget && <input className="field" placeholder="List name" aria-label="New list name" value={newListName}
                                     onChange={(e) => setNewListName(e.target.value)} style={{ width: 170 }} />}
              <button className="btn btn-sm btn-primary" disabled={!listTarget && !newListName.trim()}
                      onClick={() => {
                        const picked = rows.filter((r) => sel.has(r.lead.key));
                        const res = onAddToList(picked.map((r) => ({ row: listRowFor(r), scanner: r.lead.source })),
                          listTarget ? { existingId: listTarget } : { newName: newListName.trim() });
                        if (!res) { setListNotice("Couldn't add to that list."); return; }
                        const name = lists.find((l) => l.id === res.listId)?.name ?? newListName.trim();
                        setListNotice(`Added ${res.added.toLocaleString()} to "${name}"${res.skipped ? ` (${res.skipped} already there)` : ""}. Open Lists to edit or download it.`);
                        setListTarget(res.listId); setNewListName(""); setSel(new Set());
                      }}>
                Add {sel.size.toLocaleString()} to list
              </button>
            </>}
          </>}
          {listNotice && <span style={{ color: "var(--success, #1F7A4D)" }} aria-label="List notice">{listNotice}</span>}
          {statusF === "needs" && counts.unchecked > 0 && (
            <span className="muted">{counts.unchecked.toLocaleString()} not checked yet aren't counted here — check them to see where they stand.</span>
          )}
        </div>
      </div>

      <div className="table-card" style={{ maxHeight: "calc(100vh - 330px)", minHeight: 240, overflow: "auto" }}>
        <table className="data-table dense-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" aria-label="Select this page"
                       checked={shown.length > 0 && shown.every((r) => sel.has(r.lead.key))}
                       onChange={(e) => setSel((s) => { const n = new Set(s); shown.forEach((r) => (e.target.checked ? n.add(r.lead.key) : n.delete(r.lead.key))); return n; })} />
              </th>
              <th>Lead</th>
              <th>Note</th>
              <th>Stored as</th>
              <th>Where they stand</th>
              <th>Sequence</th>
              {onCheckLeads && <th />}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const v = VERDICT_META[verdictOf(r.lead.tier)];
              const m = STATUS_META[r.status];
              const ordered = [...r.seqs].sort((a, b) => Number(b.active) - Number(a.active));
              return (
                <tr key={r.lead.key}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${r.lead.contact || r.lead.company}`} checked={sel.has(r.lead.key)}
                           onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.lead.key)) n.delete(r.lead.key); else n.add(r.lead.key); return n; })} />
                  </td>
                  <td style={{ minWidth: 170 }}>
                    <div className="strong" title={r.lead.company}>{r.lead.company || "—"}</div>
                    <div className="muted" style={{ fontSize: 12 }} title={[r.lead.contact, r.lead.title, r.lead.email].filter(Boolean).join(" · ")}>
                      {r.lead.contact || "—"}{r.lead.title ? ` · ${r.lead.title}` : ""}
                    </div>
                  </td>
                  <td style={{ minWidth: 260, maxWidth: 420 }} title={stripSnippetPrefix(r.lead.notes || "")}>
                    <div style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 12.5, lineHeight: 1.4 }}>
                      {stripSnippetPrefix(r.lead.notes || "") || <span className="muted">—</span>}
                    </div>
                  </td>
                  <td><span className="pill" style={{ color: v.color, background: v.bg }}>{v.label}</span></td>
                  <td title={`${m.hint}${r.how ? ` · matched by ${r.how}` : ""}`}>
                    <span className="pill" style={{ color: m.color, background: m.bg, whiteSpace: "nowrap" }}>{m.short}</span>
                    {r.how && r.status !== "unchecked" && <div className="muted" style={{ fontSize: 11, marginTop: 2, maxWidth: 220 }}>{r.how.replace(/^Apollo check /, "checked ")}</div>}
                  </td>
                  <td className="wide">
                    {ordered.length === 0 ? <span className="muted">—</span> : ordered.map((s, i) => (
                      <div key={`${s.name}-${i}`} style={{ color: s.active ? "var(--ink)" : "var(--muted)" }}>
                        {s.active && <b style={{ color: "#0A66C2" }}>● </b>}{s.name}
                        <span className="muted">
                          {" · "}{s.active ? "active" : s.status}
                          {s.step != null ? ` · step ${s.step}${s.steps ? ` of ${s.steps}` : ""}` : ""}
                          {s.addedAt ? ` · added ${s.addedAt}` : ""}
                          {s.finishedAt ? ` · ended ${s.finishedAt}` : ""}
                          {s.reason ? ` · "${s.reason}"` : ""}
                        </span>
                      </div>
                    ))}
                  </td>
                  {onCheckLeads && (
                    <td>
                      <button className="btn btn-sm btn-ghost" disabled={!!check && !check.finished} onClick={() => runCheck([r.lead])}
                              title="Look up just this lead in Apollo">Check</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={onCheckLeads ? 8 : 7} style={{ textAlign: "center", padding: 24, color: "var(--muted)" }}>
                {rows.length === 0 ? "No leads stored yet." : "No leads match."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pager" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>page {page} of {pages}</span>
        <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </>
  );
}
