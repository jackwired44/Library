// Rewrite every stored Main Scanner lead's note with today's note rules.
//
// Per Jack: "we need to make sure we update all the leads in here with the
// new note rule". A stored lead keeps the note it was scanned with; this
// re-runs today's Main Scanner over the lead's stored CSV row (raw note +
// the other columns, see lib/rawNotes.ts) and replaces the NEWEST note
// segment with the fresh brief.
//
// Only the note moves. Tier, score, product area and every Apollo / plan
// field are left exactly as they are, so no lead changes bucket, export or
// download because of this. The score/band mark at the front of the note
// ("(50) ▲") is kept from the stored note for the same reason. Older dated
// segments are history and are not rewritten. Custom and CSP leads are
// untouched: their note rules did not change.
import { scanParsedFiles, stripSnippetPrefix, DEFAULT_RULE_OVERRIDES, type RuleOverrides } from "./detection";
import { NOTE_SEP, noteSegments, type StoredLead } from "./leadStore";
import { loadRawNotesMany, newestRaw, type RawNotes } from "./rawNotes";

/** Bump when the Main note rules change, so stored notes refresh once. */
export const NOTE_RULES_VERSION = "2026-10-16-less-specific";
const VERSION_KEY = "mainNoteRulesVersion";

/** Today's Main Scanner note for one lead's stored raw row, with its
 *  score/band mark, or "" when there is no raw row or nothing matches. */
export function currentMainNote(raw: RawNotes | undefined, overrides: RuleOverrides = DEFAULT_RULE_OVERRIDES): string {
  const text = newestRaw(raw);
  if (!raw || !text) return "";
  const rows = raw.rows ?? [];
  const fields: Record<string, string> = { ...(rows[rows.length - 1]?.fields ?? {}) };
  const notesCol = Object.keys(fields).find((k) => /comment|note|description/i.test(k)) || "Comments";
  fields[notesCol] = text;
  try {
    const r = scanParsedFiles([{ name: raw.segments[0]?.file || "lead", fields: Object.keys(fields), data: [fields] }], overrides).results[0];
    return r?.notesSummary || "";
  } catch {
    return "";
  }
}

/** The lead with its newest note segment replaced, or the same object when
 *  nothing would change. */
export function withRefreshedNote(lead: StoredLead, fresh: string): StoredLead {
  const body = stripSnippetPrefix(fresh).trim();
  if (!body) return lead;
  const segs = noteSegments(lead.notes);
  const top = segs[0]?.text ?? "";
  const oldBody = stripSnippetPrefix(top);
  // Keep the stored score/band mark — the lead's score is not being changed.
  const mark = top.slice(0, top.length - oldBody.length) || fresh.slice(0, fresh.length - stripSnippetPrefix(fresh).length);
  const next = `${mark}${body}`;
  if (next === top) return lead;
  const lines = segs.map((s, i) => {
    const text = i === 0 ? next : s.text;
    return s.date ? `${s.date} · ${text}` : text;
  });
  if (!lines.length) lines.push(next);
  return { ...lead, notes: lines.join(NOTE_SEP) };
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
      const fresh = currentMainNote(raw.get(l.key), overrides);
      if (!fresh) continue;
      const next = withRefreshedNote(l, fresh);
      if (next !== l) changed.push(next);
    }
    onProgress?.(Math.min(i + chunk, main.length), main.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return changed;
}
