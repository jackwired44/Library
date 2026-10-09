// A lead's RAW note text, exactly as it arrived in each CSV, dated per
// upload — kept beside the scanner's processed note so the two can be read
// side by side.
//
// Per Jack: "we can view the raw note form and scanned note form to cross
// reference and really analyze these leads."
//
// Stored apart from the lead (see STORE_RAW_NOTES in db.ts) and read one
// lead at a time, only when its record is opened. Additive across uploads:
// a new upload adds a segment, an identical one is not stored twice, and
// nothing here is ever rewritten by a scan.
import { STORE_RAW_NOTES, dbGet, dbUpdateMany } from "./db";

export interface RawNoteSegment {
  /** When this text arrived (the upload time). */
  at: string;
  file: string;
  text: string;
}

export interface RawNotes {
  key: string;
  segments: RawNoteSegment[];
  /** Every other column of the CSV row, per upload. Per Jack: "their csv
   *  upload data is attached to every lead". Optional: records written
   *  before this carried notes only. */
  rows?: RawRowRecord[];
}

/** One CSV row as it arrived, minus the notes column (that is a segment). */
export interface RawRowRecord {
  at: string;
  file: string;
  fields: Record<string, string>;
}

/** Distinct row versions kept per lead. */
export const RAW_ROWS_MAX = 24;
/** One cell's ceiling — a mis-mapped notes column must not bloat this. */
export const RAW_CELL_MAX = 2_000;

/** A CSV row reduced to what is worth keeping: real columns only (never
 *  the app's own "__" fields), non-empty, minus the notes text that is
 *  already stored as a segment, each cell capped. */
export function rawFieldsOf(row: Record<string, unknown> | undefined, notesText = ""): Record<string, string> | undefined {
  if (!row) return undefined;
  const notes = norm(notesText);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith("__")) continue;
    const t = String(v ?? "").trim();
    if (!t || t.toUpperCase() === "NULL") continue;
    if (notes && norm(t) === notes) continue;
    out[k] = t.length > RAW_CELL_MAX ? `${t.slice(0, RAW_CELL_MAX)} …` : t;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Add one upload's raw row. Same file with identical values is not kept
 *  twice. Pure, for testing. */
export function appendRow(prev: RawNotes | undefined, key: string, rec: RawRowRecord): RawNotes | null {
  const rows = prev?.rows ?? [];
  const sig = (r: RawRowRecord) => `${r.file}\u0001${JSON.stringify(r.fields)}`;
  if (rows.some((r) => sig(r) === sig(rec))) return null;
  return { key, segments: prev?.segments ?? [], rows: [rec, ...rows].slice(0, RAW_ROWS_MAX) };
}

/** One segment's ceiling. The real CSP file's longest note is ~40,000
 *  characters of pasted call transcript; past this the tail is cut and
 *  says so, rather than one row growing without limit. */
export const RAW_SEGMENT_MAX = 20_000;
/** Distinct versions kept per lead, newest kept when it overflows. */
export const RAW_SEGMENTS_MAX = 12;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function clipRaw(text: string): string {
  const t = String(text || "").trim();
  return t.length > RAW_SEGMENT_MAX ? `${t.slice(0, RAW_SEGMENT_MAX)} … [cut at ${RAW_SEGMENT_MAX.toLocaleString()} characters]` : t;
}

/** Add one upload's raw text to a lead's segments. Pure, for testing. */
export function appendSegment(prev: RawNotes | undefined, key: string, seg: RawNoteSegment): RawNotes | null {
  const text = clipRaw(seg.text);
  if (!text) return null;
  const segments = prev?.segments ?? [];
  if (segments.some((s) => norm(s.text) === norm(text))) {
    // Same words again (a re-upload). Nothing new to keep.
    return null;
  }
  const next = [{ ...seg, text }, ...segments].slice(0, RAW_SEGMENTS_MAX);
  return { key, segments: next, ...(prev?.rows ? { rows: prev.rows } : {}) };
}

/** Append this upload's raw notes and raw rows for many leads, in one
 *  transaction. */
export async function appendRawNotes(entries: { key: string; seg: RawNoteSegment; fields?: Record<string, string> }[]): Promise<void> {
  const byKey = new Map<string, { seg: RawNoteSegment; fields?: Record<string, string> }[]>();
  for (const e of entries) {
    if (!e.key) continue;
    if (!String(e.seg.text || "").trim() && !e.fields) continue;
    const list = byKey.get(e.key) ?? [];
    list.push(e);
    byKey.set(e.key, list);
  }
  await dbUpdateMany<RawNotes>(STORE_RAW_NOTES, [...byKey.keys()], (key, existing) => {
    let cur = existing;
    let changed = false;
    for (const e of byKey.get(key)!) {
      const next = appendSegment(cur, key, e.seg);
      if (next) { cur = { ...next, rows: cur?.rows }; changed = true; }
      if (e.fields) {
        const withRow = appendRow(cur, key, { at: e.seg.at, file: e.seg.file, fields: e.fields });
        if (withRow) { cur = withRow; changed = true; }
      }
    }
    return changed ? cur! : null;
  });
}

export async function loadRawNotes(key: string): Promise<RawNotes | undefined> {
  return dbGet<RawNotes>(STORE_RAW_NOTES, key);
}
