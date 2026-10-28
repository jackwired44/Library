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
// rewritten. Custom and CSP leads get the Main-format note too, keeping
// their own grade (see refreshMainNotes).
import { scanParsedFiles, stripSnippetPrefix, DEFAULT_RULE_OVERRIDES, type RuleOverrides } from "./detection";
import { NOTE_SEP, noteSegments, type StoredLead } from "./leadStore";
import { leadInputsFromResults } from "./leadFiling";
import type { ResultRow } from "./detection";
import { loadRawNotesMany, newestRaw, type RawNotes } from "./rawNotes";
import { scan2, emptyRuleSet, loadRuleSets, profileColumns, guessFieldMapping, type RuleSet2, type ScannerKind } from "./scanner2";

/** Bump when the Main note rules change, so stored notes refresh once. */
export const NOTE_RULES_VERSION = "2026-10-28-dynamics-tabs";
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
/**
 * Today's Main-format note for a Custom (SMC) or CSP lead, re-read from its
 * stored raw row with that scanner's saved rules. Per Jack: "change all the
 * notes from current form to the main scanner format". "" when there is no
 * raw row or the row now reads as no signal.
 */
export function currentScanner2Note(raw: RawNotes | undefined, kind: ScannerKind, ruleSet?: RuleSet2): string {
  const text = newestRaw(raw);
  if (!raw || !text) return "";
  const rows = raw.rows ?? [];
  const fields: Record<string, string> = { ...(rows[rows.length - 1]?.fields ?? {}) };
  const base = ruleSet && ruleSet.mode === kind ? ruleSet : emptyRuleSet("refresh", kind);
  const keys = Object.keys(fields);
  const notesCol = (base.notesColumns ?? []).find((c) => keys.includes(c))
    || keys.find((k) => /forecast|comment|note|description/i.test(k)) || "Notes";
  fields[notesCol] = text;
  const all = Object.keys(fields);
  const mapped = base.fields && Object.values(base.fields).some((c) => c && all.includes(String(c)))
    ? base.fields
    : guessFieldMapping(profileColumns([{ name: "lead", fields: all, data: [fields] }]));
  try {
    const row = scan2([{ name: raw.segments[0]?.file || "lead", fields: all, data: [fields] }],
      { ...base, fields: mapped, notesColumns: [notesCol], dedupeColumns: [] }).rows[0];
    return row && row.bucket !== "unmatched" ? row.snippet : "";
  } catch {
    return "";
  }
}

/** The ▲ ▸ ▼ ✕ mark for a stored lead's own grade, so a rewritten note keeps
 *  the grade it was filed with. Per Jack: note only, keep the grade. */
function markForStored(l: StoredLead): string {
  if (l.notFit) return "\u2715";
  const t = (l.tier || "").toLowerCase();
  if (/strong signal|high priority/.test(t)) return "\u25B2";
  if (/needs review|medium priority/.test(t)) return "\u25B8";
  if (/bad lead/.test(t)) return "\u2715";
  return "\u25BC";
}

/** The lead with a new newest-note body and its own stored grade. */
export function withRefreshedNoteOnly(lead: StoredLead, freshNote: string): StoredLead {
  const body = stripSnippetPrefix(freshNote).trim();
  if (!body) return lead;
  const nextTop = `(${lead.score ?? 0}) ${markForStored(lead)} ${body}`;
  const segs = noteSegments(lead.notes);
  const lines = segs.length
    ? segs.map((s, i) => { const text = i === 0 ? nextTop : s.text; return s.date ? `${s.date} \u00b7 ${text}` : text; })
    : [nextTop];
  const notes = lines.join(NOTE_SEP);
  return notes === lead.notes ? lead : { ...lead, notes };
}

export async function refreshMainNotes(
  leads: StoredLead[],
  overrides: RuleOverrides = DEFAULT_RULE_OVERRIDES,
  onProgress?: (done: number, total: number) => void,
  chunk = 250,
  /** Filled in as it runs: leads with no saved CSV row, which a refresh
   *  cannot rewrite, counted by the file they came from. Re-uploading
   *  those files is the only way to give them today's note. */
  missing?: Map<string, number>,
): Promise<StoredLead[]> {
  // All three scanners. A Main lead is re-graded with today's Main rules;
  // a Custom or CSP lead gets the Main-format note and keeps its own grade.
  const main = leads.filter((l) => l.source === "main" || l.source === "smc" || l.source === "csp");
  const sets: Partial<Record<ScannerKind, RuleSet2>> = {};
  for (const k of ["smc", "csp"] as ScannerKind[]) {
    if (!main.some((l) => l.source === k)) continue;
    try { sets[k] = (await loadRuleSets(k))[0]; } catch { /* default rules */ }
  }
  const changed: StoredLead[] = [];
  for (let i = 0; i < main.length; i += chunk) {
    const slice = main.slice(i, i + chunk);
    const raw = await loadRawNotesMany(slice.map((l) => l.key));
    for (const l of slice) {
      if (missing && !raw.get(l.key)) {
        const f = l.sourceFiles[l.sourceFiles.length - 1] || "Unknown file";
        missing.set(f, (missing.get(f) || 0) + 1);
        continue;
      }
      if (l.source !== "main") {
        const fresh = currentScanner2Note(raw.get(l.key), l.source as ScannerKind, sets[l.source as ScannerKind]);
        const next = fresh ? withRefreshedNoteOnly(l, fresh) : l;
        if (next !== l) changed.push(next);
        continue;
      }
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
