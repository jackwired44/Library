// Rewrite every stored Main Scanner lead's note with today's note rules.
//
// Per Jack: "we need to make sure we update all the leads in here with the
// new note rule". A stored lead keeps the note it was scanned with; this
// re-runs today's Main Scanner over the lead's stored CSV row (raw note +
// the other columns, see lib/rawNotes.ts) and replaces the NEWEST note
// segment with the fresh brief.
//
// The scan verdict moves with the note — tier, score and product area — the
// same way a re-upload of the same lead already updates them (see
// mergeLeads). Per Jack, on a lead the old rules called Strong Signal:
// "this is bad lead". A lead marked not-a-fit (notFit) keeps its Bad Lead
// verdict; only its note is rewritten. Every Apollo / plan / status field
// is left alone. Older dated note segments are history and are not
// rewritten. Custom and CSP leads are untouched: their rules did not change.
import { scanParsedFiles, stripSnippetPrefix, DEFAULT_RULE_OVERRIDES, type RuleOverrides } from "./detection";
import { NOTE_SEP, noteSegments, type StoredLead } from "./leadStore";
import { leadInputsFromResults } from "./leadFiling";
import type { ResultRow } from "./detection";
import { loadRawNotesMany, newestRaw, type RawNotes } from "./rawNotes";

/** Bump when the Main note rules change, so stored notes refresh once. */
export const NOTE_RULES_VERSION = "2026-10-16-no-dated-sentences";
const VERSION_KEY = "mainNoteRulesVersion";

/** Today's Main Scanner read of one lead's stored raw row, or null when
 *  there is no raw row or the row no longer matches anything. */
export function currentMainScan(raw: RawNotes | undefined, overrides: RuleOverrides = DEFAULT_RULE_OVERRIDES): ResultRow | null {
  const text = newestRaw(raw);
  if (!raw || !text) return null;
  const rows = raw.rows ?? [];
  const fields: Record<string, string> = { ...(rows[rows.length - 1]?.fields ?? {}) };
  const notesCol = Object.keys(fields).find((k) => /comment|note|description/i.test(k)) || "Comments";
  fields[notesCol] = text;
  try {
    return scanParsedFiles([{ name: raw.segments[0]?.file || "lead", fields: Object.keys(fields), data: [fields] }], overrides).results[0] ?? null;
  } catch {
    return null;
  }
}
/** Today's note text (with its score/band mark), or "". */
export function currentMainNote(raw: RawNotes | undefined, overrides: RuleOverrides = DEFAULT_RULE_OVERRIDES): string {
  return currentMainScan(raw, overrides)?.notesSummary || "";
}

/** The lead with today's verdict and newest note, or the same object when
 *  nothing would change. */
export function withRefreshedScan(lead: StoredLead, row: ResultRow): StoredLead {
  const fresh = row.notesSummary || "";
  const body = stripSnippetPrefix(fresh).trim();
  const input = leadInputsFromResults([row])[0];
  const keepVerdict = !!lead.notFit;
  const segs = noteSegments(lead.notes);
  const top = segs[0]?.text ?? "";
  // A lead someone marked not-a-fit keeps its own mark; otherwise the
  // fresh score/band mark rides with the fresh verdict.
  const mark = keepVerdict
    ? top.slice(0, top.length - stripSnippetPrefix(top).length)
    : fresh.slice(0, fresh.length - body.length);
  const nextTop = body ? `${mark}${body}` : top;
  const lines = segs.length
    ? segs.map((s, i) => { const text = i === 0 ? nextTop : s.text; return s.date ? `${s.date} · ${text}` : text; })
    : [nextTop];
  const notes = lines.join(NOTE_SEP);
  const next: StoredLead = keepVerdict
    ? { ...lead, notes }
    : { ...lead, notes, tier: input.tier || lead.tier, score: input.score, productArea: input.productArea || lead.productArea };
  const same = next.notes === lead.notes && next.tier === lead.tier && next.score === lead.score && next.productArea === lead.productArea;
  return same ? lead : next;
}

export function noteRulesStale(): boolean {
  try { return localStorage.getItem(VERSION_KEY) !== NOTE_RULES_VERSION; } catch { return true; }
}
export function markNoteRulesCurrent(): void {
  try { localStorage.setItem(VERSION_KEY, NOTE_RULES_VERSION); } catch { /* preference only */ }
}

/**
 * Refresh every Main lead's note. Reads raw rows a chunk at a time and
 * yields between chunks so the page stays usable. Returns only the leads
 * whose note actually changed.
 */
export async function refreshMainNotes(
  leads: StoredLead[],
  overrides: RuleOverrides = DEFAULT_RULE_OVERRIDES,
  onProgress?: (done: number, total: number) => void,
  chunk = 250,
): Promise<StoredLead[]> {
  const main = leads.filter((l) => l.source === "main");
  const changed: StoredLead[] = [];
  for (let i = 0; i < main.length; i += chunk) {
    const slice = main.slice(i, i + chunk);
    const raw = await loadRawNotesMany(slice.map((l) => l.key));
    for (const l of slice) {
      const row = currentMainScan(raw.get(l.key), overrides);
      if (!row) continue;
      const next = withRefreshedScan(l, row);
      if (next !== l) changed.push(next);
    }
    onProgress?.(Math.min(i + chunk, main.length), main.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return changed;
}
