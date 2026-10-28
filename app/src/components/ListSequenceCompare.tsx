// A list beside the Apollo sequence it was built for. Per Jack: "pull up a
// certain sequence owned by jack and carly with the list here side by side
// to see which leads got added and which didnt so i can note why whether its
// a email domain issue meeting booked or what", "search it by campign name
// and name the cmapaign name the sequence the list is for", and "so i can
// start fully managing the leads in apollo … built off a list in this
// platform". Read-only toward Apollo: the only call is a sequence search by
// name; who is in the sequence comes from what the platform already knows
// (live checks and the pulled Apollo uploads).
import { useMemo, useState } from "react";
import { downloadBlob, toCSV } from "../lib/csv";
import { normEmail, type StoredLead } from "../lib/leadStore";
import { seenNameKey } from "../lib/seenBefore";
import { engagementOf } from "../lib/engagements";
import { statusOf } from "../lib/leadStatus";
import { laneOf } from "../lib/deliverability";
import { ownersOf } from "../lib/reps";
import { normPersonName, type ApolloRosterEntry, type RosterIndex } from "../lib/apolloRoster";
import type { FoundSequence } from "../lib/apolloLive";
import type { LeadList, ListedLeadRow } from "../lib/leadLists";
import { MAIN_SEQUENCES, sequencesForLead, type Seq } from "./ApolloStatus";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Why a list lead is not in the sequence, most decisive first. */
export type MissReason =
  | "notStored" | "account" | "meeting" | "notInterested" | "reached" | "activeElsewhere"
  | "noEmail" | "personal" | "badEmail" | "catchAll" | "unchecked" | "notInApollo" | "noSequence" | "endedElsewhere" | "unknown";
export const MISS_META: Record<MissReason, { label: string; color: string; bg: string }> = {
  notStored: { label: "Not saved in All leads", color: "#4C6167", bg: "#EEF1F2" },
  account: { label: "Deal or meeting on file — account manager only", color: "#7A1F1F", bg: "#F6E3E3" },
  meeting: { label: "Meeting booked", color: "#0A66C2", bg: "#EAF3FC" },
  notInterested: { label: "Not interested / do not contact", color: "#B5443B", bg: "#FBEAE8" },
  reached: { label: "Already had a conversation", color: "#5B3FC4", bg: "#EEEAFC" },
  activeElsewhere: { label: "Active in another sequence", color: "#0A66C2", bg: "#EAF3FC" },
  noEmail: { label: "No email", color: "#8A5A00", bg: "#FFF4DD" },
  personal: { label: "Personal email domain (Apollo flags it)", color: "#8A5A00", bg: "#FFF4DD" },
  badEmail: { label: "Email bad or unavailable", color: "#8A5A00", bg: "#FFF4DD" },
  catchAll: { label: "Catch-all email, not green-lit", color: "#8A5A00", bg: "#FFF4DD" },
  unchecked: { label: "Not checked in Apollo yet", color: "#4C6167", bg: "#EEF1F2" },
  notInApollo: { label: "Not in Apollo as a contact", color: "#B5443B", bg: "#FBEAE8" },
  noSequence: { label: "In Apollo, never sequenced", color: "#B5443B", bg: "#FBEAE8" },
  endedElsewhere: { label: "Ended another sequence, not added here", color: "#8A6D3B", bg: "#F7F1E5" },
  unknown: { label: "No reason found", color: "#4C6167", bg: "#EEF1F2" },
};

export interface CompareRow {
  row: ListedLeadRow;
  lead: StoredLead | null;
  /** The target sequence on this lead, if it is in it. */
  here: Seq | null;
  miss: MissReason | null;
  /** The other sequence that explains a miss (active or ended elsewhere). */
  other: string;
}

/** One list row against the target sequence. */
export function compareRow(row: ListedLeadRow, lead: StoredLead | null, target: string, index: RosterIndex | null): CompareRow {
  if (!lead) return { row, lead, here: null, miss: "notStored", other: "" };
  const { status, seqs } = sequencesForLead(lead, index);
  const here = seqs.find((s) => norm(s.name) === norm(target)) ?? null;
  if (here) return { row, lead, here, miss: null, other: "" };
  if (engagementOf(lead)) return { row, lead, here, miss: "account", other: "" };
  const ls = statusOf(lead);
  if (ls === "meeting") return { row, lead, here, miss: "meeting", other: "" };
  if (ls === "not-interested") return { row, lead, here, miss: "notInterested", other: "" };
  const active = seqs.find((s) => s.active);
  if (active) return { row, lead, here, miss: "activeElsewhere", other: active.name };
  if (ls === "reached" || status === "reached") {
    const why = seqs.find((s) => s.reason);
    return { row, lead, here, miss: "reached", other: why ? `${why.name}: ${why.reason}` : "" };
  }
  const lane = laneOf(lead.email, undefined, undefined, lead.apollo?.live);
  if (lane === "no-email") return { row, lead, here, miss: "noEmail", other: "" };
  if (lane === "personal") return { row, lead, here, miss: "personal", other: "" };
  if (lane === "call-only") return { row, lead, here, miss: "badEmail", other: "" };
  if (lane === "catch-all-call") return { row, lead, here, miss: "catchAll", other: "" };
  if (status === "unchecked") return { row, lead, here, miss: "unchecked", other: "" };
  if (status === "out") return { row, lead, here, miss: "notInApollo", other: "" };
  if (status === "none") return { row, lead, here, miss: "noSequence", other: "" };
  if (status === "finished") return { row, lead, here, miss: "endedElsewhere", other: seqs[0]?.name ?? "" };
  return { row, lead, here, miss: "unknown", other: "" };
}

export interface SequenceOnly { name: string; email: string; company: string; seq: Seq; stored: boolean }

/** People the platform knows are in the sequence but who are not on the
 *  list: the pulled Apollo uploads plus checked leads. Never complete —
 *  Apollo can't be asked "who is in this sequence", so anyone added another
 *  way and never checked won't show. */
export function sequenceOnly(target: string, list: LeadList, leads: StoredLead[], roster: ApolloRosterEntry[], index: RosterIndex | null): SequenceOnly[] {
  const onList = new Set<string>();
  for (const r of list.rows) {
    const e = normEmail(r.Email);
    if (e.includes("@")) onList.add(`e:${e}`);
    const n = seenNameKey(`${r["First Name"] || ""} ${r["Last Name"] || ""}`, r["Company Name"]);
    if (n) onList.add(`n:${n}`);
  }
  const keysOf = (email: string, name: string, company: string) => {
    const e = normEmail(email);
    const n = seenNameKey(name, company);
    return [e.includes("@") ? `e:${e}` : "", n ? `n:${n}` : "", `p:${normPersonName(name)}`].filter(Boolean);
  };
  const out = new Map<string, SequenceOnly>();
  const seen = new Set<string>();
  const add = (email: string, name: string, company: string, seq: Seq, stored: boolean) => {
    const ks = keysOf(email, name, company);
    if (ks.some((k) => onList.has(k) || seen.has(k))) return;
    for (const k of ks) seen.add(k);
    out.set(ks[0], { name, email, company, seq, stored });
  };
  for (const l of leads) {
    if (!l.apollo) continue;
    const s = sequencesForLead(l, index).seqs.find((x) => norm(x.name) === norm(target));
    if (s) add(l.email, l.contact, l.company, s, true);
  }
  for (const r of roster) {
    const st = r.seqStates?.find((x) => norm(x.name) === norm(target));
    const label = !st && r.sequences.find((x) => norm(x.replace(/\s*\(active\)$/, "")) === norm(target));
    if (!st && !label) continue;
    const seq: Seq = st
      ? { name: st.name, active: st.status === "active", status: st.status, step: st.step, addedAt: st.addedAt ?? "", steps: st.steps, finishedAt: st.finishedAt, reason: st.reason }
      : { name: target, active: /\(active\)$/.test(String(label)), status: /\(active\)$/.test(String(label)) ? "active" : "ended", step: null, addedAt: "" };
    add(r.email, r.name, r.company, seq, false);
  }
  return [...out.values()].sort((a, b) => Number(b.seq.active) - Number(a.seq.active) || (b.seq.addedAt || "").localeCompare(a.seq.addedAt || ""));
}

/** Every sequence name the platform has seen, main sequences first. */
export function knownSequenceNames(leads: StoredLead[], roster: ApolloRosterEntry[]): string[] {
  const names = new Map<string, string>();
  const put = (n: string) => { const k = norm(n); if (k && !names.has(k)) names.set(k, n.trim()); };
  for (const n of MAIN_SEQUENCES) put(n);
  for (const l of leads) for (const s of l.apollo?.sequences ?? []) put(s.name);
  for (const r of roster) {
    for (const s of r.seqStates ?? []) put(s.name);
    for (const s of r.sequences) put(s.replace(/\s*\(active\)$/, ""));
  }
  return [...names.values()];
}

const stepText = (s: Seq) => [s.active ? "Active" : s.status === "finished" ? "Finished" : s.status || "Ended",
  s.step != null ? `step ${s.step}${s.steps ? ` of ${s.steps}` : ""}` : "",
  s.addedAt ? `added ${s.addedAt.slice(0, 10)}` : "",
  s.reason ? s.reason : ""].filter(Boolean).join(" · ");

/** Pick the sequence a list is for: search Apollo by name, or pick one the
 *  platform already knows (works without Apollo). */
export function SequencePicker({ list, known, onPick, onSearch, onClose }: {
  list: LeadList;
  known: string[];
  onPick: (s: { name: string; id?: string; owner?: string }) => void;
  onSearch?: (q: string) => Promise<FoundSequence[]>;
  onClose: () => void;
}) {
  const [q, setQ] = useState(list.targetSequence || list.campaign || "");
  const [found, setFound] = useState<FoundSequence[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const localHits = known.filter((n) => !q.trim() || norm(n).includes(norm(q))).slice(0, 12);
  async function search() {
    if (!onSearch || !q.trim()) return;
    setBusy(true); setErr("");
    try { setFound(await onSearch(q)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setFound(null); }
    finally { setBusy(false); }
  }
  return (
    <div aria-label={`Pick sequence for ${list.name}`} style={{ marginTop: 10, border: "1px solid var(--border)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="field" aria-label="Sequence name" placeholder="Sequence or campaign name" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(); }} style={{ minWidth: 260 }} />
        {onSearch && <button className="btn btn-sm btn-secondary" onClick={search} disabled={busy || !q.trim()}>{busy ? "Searching…" : "Search Apollo"}</button>}
        <button className="btn btn-sm btn-ghost" onClick={onClose}>Close</button>
      </div>
      <div className="muted" style={{ fontSize: 11.5 }}>Read-only: this only looks sequences up by name. Picking one also sets the list's campaign name to it.</div>
      {err && <div role="alert" style={{ color: "#B5443B" }}>{err}</div>}
      {found && (
        <div aria-label="Apollo sequences found">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>In Apollo ({found.length})</div>
          {found.length === 0 && <div className="muted">No Apollo sequence matches "{q}".</div>}
          {found.map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderTop: "1px solid var(--border)" }}>
              <button className="btn btn-sm btn-primary" onClick={() => onPick({ name: s.name, id: s.id, owner: s.owner })}>Use</button>
              <strong>{s.name}</strong>
              <span className="muted">{[s.owner && `owner ${s.owner}`, s.steps ? `${s.steps} steps` : "", s.scheduled != null ? `${s.scheduled} scheduled` : "",
                s.createdAt && `created ${s.createdAt}`, s.archived ? "archived" : s.active ? "active" : "paused"].filter(Boolean).join(" · ")}</span>
            </div>
          ))}
        </div>
      )}
      {localHits.length > 0 && (
        <div aria-label="Known sequences">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Already seen on your leads</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {localHits.map((n) => (
              <button key={n} className="chip-btn" onClick={() => onPick({ name: n, owner: ownersOf([n])[0] })}>{n}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The reasons, in five plain groups. Per Jack, on the first version's wall
 *  of thirteen reason chips: "lets try and make this cleaner". */
type GroupKey = "ready" | "email" | "working" | "dont" | "check";
const MISS_GROUPS: { key: GroupKey; label: string; hint: string; color: string; reasons: MissReason[] }[] = [
  { key: "ready", label: "Can add now", color: "#0E7A72", reasons: ["notInApollo", "noSequence", "endedElsewhere"],
    hint: "Not in Apollo, never sequenced, or ended another sequence without a conversation." },
  { key: "email", label: "Email problem", color: "#C98A1B", reasons: ["personal", "catchAll", "badEmail", "noEmail"],
    hint: "Personal domain, catch-all not green-lit, bad or no email. Apollo flags or refuses these." },
  { key: "working", label: "In another sequence", color: "#0A66C2", reasons: ["activeElsewhere"],
    hint: "Active in a different sequence right now." },
  { key: "dont", label: "Don't add", color: "#B5443B", reasons: ["account", "meeting", "notInterested", "reached"],
    hint: "A deal or meeting on file, a meeting booked, not interested, or already had a conversation." },
  { key: "check", label: "Check first", color: "#8A979B", reasons: ["unchecked", "notStored", "unknown"],
    hint: "Not checked in Apollo yet, not saved in All leads, or no reason found." },
];
const GROUP_OF = new Map<MissReason, GroupKey>(MISS_GROUPS.flatMap((g) => g.reasons.map((r) => [r, g.key] as [MissReason, GroupKey])));
const ADDED_COLOR = "#1F7A4D";
const PAGE = 50;

/** The list (left) beside the sequence (right). */
export function ComparePanel({ list, compared, extras, onNote, onRecheck, recheckBusy = false }: {
  list: LeadList;
  compared: CompareRow[];
  extras: SequenceOnly[];
  onNote?: (rowKey: string, note: string) => void;
  /** Look these stored leads up in Apollo again now, read-only, ignoring the
   *  usual 7-day skip: a lead imported into Apollo since its last check
   *  still reads "Not in Apollo" until it is looked up again. */
  onRecheck?: (keys: string[]) => void;
  recheckBusy?: boolean;
}) {
  // One filter, per Jack: "simplify those filterting fields". Values: all,
  // added, not, g:<group>, r:<reason>.
  const [show, setShow] = useState("all");
  const [page, setPage] = useState(0);
  const target = list.targetSequence || "";
  const added = compared.filter((c) => c.here);
  const counts = useMemo(() => {
    const byGroup = new Map<GroupKey, number>();
    const byReason = new Map<MissReason, number>();
    for (const c of compared) if (!c.here && c.miss) {
      byReason.set(c.miss, (byReason.get(c.miss) || 0) + 1);
      const g = GROUP_OF.get(c.miss)!;
      byGroup.set(g, (byGroup.get(g) || 0) + 1);
    }
    return { byGroup, byReason };
  }, [compared]);
  const shown = compared.filter((c) => show === "all" ? true : show === "added" ? !!c.here : c.here || !c.miss ? false
    : show === "not" ? true : show.startsWith("g:") ? GROUP_OF.get(c.miss) === show.slice(2) : c.miss === show.slice(2));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE);
  const pickShow = (v: string) => { setShow(v); setPage(0); };
  const recheckKeys = [...new Set(compared.filter((c) => !c.here && c.lead && c.miss !== "account").map((c) => c.lead!.key))];
  const noteOf = (k: string) => list.rowNotes?.[k] ?? "";
  function download() {
    const rows = shown.map((c) => ({
      "First Name": c.row["First Name"], "Last Name": c.row["Last Name"], "Company Name": c.row["Company Name"], Email: c.row.Email,
      Sequence: target, "In Sequence": c.here ? "Yes" : "No", "Sequence Status": c.here ? stepText(c.here) : "",
      Group: c.here ? "Added" : c.miss ? MISS_GROUPS.find((g) => g.key === GROUP_OF.get(c.miss!))!.label : "",
      "Why Not Added": c.miss ? `${MISS_META[c.miss].label}${c.other ? ` (${c.other})` : ""}` : "", "Your Note": noteOf(c.row.__rowKey),
    }));
    void downloadBlob(toCSV(rows, ["First Name", "Last Name", "Company Name", "Email", "Sequence", "In Sequence", "Sequence Status", "Group", "Why Not Added", "Your Note"]), `${list.name} vs ${target}.csv`);
  }
  const segs: { key: "added" | GroupKey; label: string; hint: string; color: string; n: number }[] = [
    { key: "added", label: "Added", hint: `In ${target}.`, color: ADDED_COLOR, n: added.length },
    ...MISS_GROUPS.map((g) => ({ key: g.key, label: g.label, hint: g.hint, color: g.color, n: counts.byGroup.get(g.key) || 0 })),
  ];
  const total = compared.length || 1;
  const activeGroup = show.startsWith("g:") ? show.slice(2) : show.startsWith("r:") ? GROUP_OF.get(show.slice(2) as MissReason) : show === "added" ? "added" : null;
  return (
    <div aria-label={`Compare ${list.name} with ${target}`} style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{target}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            <span data-compare-summary>{added.length} of {compared.length} added · {compared.length - added.length} not added</span>
            {list.targetSequenceOwner && <> · owner {list.targetSequenceOwner}</>}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {onRecheck && recheckKeys.length > 0 && (
            <button className="btn btn-sm btn-secondary" disabled={recheckBusy} onClick={() => onRecheck(recheckKeys)}
              title="Looks these leads up in Apollo again now, even ones checked in the last 7 days, so anyone imported since shows as added. Read-only. Apollo allows 400 lookups an hour.">
              ↻ Re-check {recheckKeys.length.toLocaleString()} not added
            </button>
          )}
          <button className="btn btn-sm btn-ghost" onClick={download} title="The rows shown below, with the group, the reason and your note">⬇ Download</button>
        </div>
      </div>

      <div aria-hidden style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: "var(--surface-sunken)", margin: "12px 0 6px" }}>
        {segs.filter((x) => x.n).map((x) => (
          <div key={x.key} title={`${x.label}: ${x.n}`} style={{ width: `${(x.n / total) * 100}%`, background: x.color, opacity: !activeGroup || activeGroup === x.key ? 1 : 0.25 }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
        <select className="field" aria-label="Show" value={show} onChange={(e) => pickShow(e.target.value)} style={{ fontSize: 13, minWidth: 260 }}>
          <option value="all">Everyone ({compared.length.toLocaleString()})</option>
          <option value="added">✓ Added ({added.length.toLocaleString()})</option>
          <option value="not">Not added ({(compared.length - added.length).toLocaleString()})</option>
          {MISS_GROUPS.filter((g) => counts.byGroup.get(g.key)).map((g) => (
            <optgroup key={g.key} label={g.label}>
              <option value={`g:${g.key}`}>All {g.label.toLowerCase()} ({counts.byGroup.get(g.key)!.toLocaleString()})</option>
              {g.reasons.filter((r) => counts.byReason.get(r)).length > 1 && g.reasons.filter((r) => counts.byReason.get(r)).map((r) => (
                <option key={r} value={`r:${r}`}>{MISS_META[r].label} ({counts.byReason.get(r)!.toLocaleString()})</option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="muted" data-compare-legend style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {segs.filter((x) => x.n).map((x) => (
            <span key={x.key} title={x.hint} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: x.color, display: "inline-block" }} />{x.label} {x.n.toLocaleString()}
            </span>
          ))}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 12, marginTop: 12 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "6px 10px", fontWeight: 600, fontSize: 12, background: "var(--surface-sunken)", display: "flex", gap: 8, alignItems: "center" }}>
            On the list <span className="muted" style={{ fontWeight: 400 }}>{shown.length.toLocaleString()} shown</span>
            {pages > 1 && (
              <span style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center", fontWeight: 400 }}>
                <button className="btn btn-sm btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
                {page + 1} / {pages}
                <button className="btn btn-sm btn-ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
              </span>
            )}
          </div>
          <div style={{ overflow: "auto", maxHeight: 440 }}>
            <table className="data-table" style={{ width: "100%" }}>
              <thead><tr><th>Contact</th><th>Where they stand</th><th>Your note</th></tr></thead>
              <tbody>
                {pageRows.map((c) => {
                  const g = c.miss ? MISS_GROUPS.find((x) => x.key === GROUP_OF.get(c.miss!)) : null;
                  return (
                    <tr key={c.row.__rowKey} data-compare-row={c.row["Company Name"]}>
                      <td style={{ fontSize: 12 }}>
                        <div>{`${c.row["First Name"]} ${c.row["Last Name"]}`.trim() || "—"}</div>
                        <div className="muted">{c.row["Company Name"]}{c.row.Email ? ` · ${c.row.Email}` : ""}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: c.here ? ADDED_COLOR : g?.color, flex: "none" }} />
                          <span>{c.here ? "✓ Added" : c.miss ? MISS_META[c.miss].label : ""}</span>
                        </div>
                        {(c.here || c.other) && <div className="muted" style={{ fontSize: 11, paddingLeft: 14 }}>{c.here ? stepText(c.here) : c.other}</div>}
                      </td>
                      <td>
                        <input className="field" aria-label={`Note for ${c.row["Company Name"]}`} placeholder={c.here ? "" : "Why not added?"} defaultValue={noteOf(c.row.__rowKey)}
                          disabled={!onNote} onBlur={(e) => { if (e.target.value !== noteOf(c.row.__rowKey)) onNote?.(c.row.__rowKey, e.target.value); }}
                          style={{ width: "100%", minWidth: 120, fontSize: 12 }} />
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && <tr><td colSpan={3} className="muted" style={{ textAlign: "center", padding: 14 }}>Nothing here.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "6px 10px", fontWeight: 600, fontSize: 12, background: "var(--surface-sunken)" }}
            title="From your pulled Apollo uploads and checked leads. Anyone added another way and never checked won't show here.">
            In the sequence, not on this list <span className="muted" style={{ fontWeight: 400 }}>{extras.length.toLocaleString()}</span>
          </div>
          <div style={{ overflow: "auto", maxHeight: 440 }}>
            <table className="data-table" style={{ width: "100%" }}>
              <thead><tr><th>Contact</th><th>Status</th></tr></thead>
              <tbody>
                {extras.slice(0, 300).map((x, i) => (
                  <tr key={`${x.email}-${i}`} data-extra-row={x.company}>
                    <td style={{ fontSize: 12 }}><div>{x.name || "—"}</div><div className="muted">{x.company}{x.email ? ` · ${x.email}` : ""}</div></td>
                    <td style={{ fontSize: 11.5 }}>{stepText(x.seq)}{x.stored ? "" : <div className="muted">not in All leads</div>}</td>
                  </tr>
                ))}
                {!extras.length && <tr><td colSpan={2} className="muted" style={{ textAlign: "center", padding: 14 }}>No one else known in this sequence.</td></tr>}
              </tbody>
            </table>
            {extras.length > 300 && <div className="muted" style={{ padding: 8, fontSize: 11 }}>Showing the first 300 of {extras.length.toLocaleString()}.</div>}
          </div>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Read-only: nothing here is written to Apollo.</div>
    </div>
  );
}
