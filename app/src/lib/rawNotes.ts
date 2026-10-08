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
  return { key, segments: next };
}

/** Append this upload's raw notes for many leads in one transaction. */
export async function appendRawNotes(entries: { key: string; seg: RawNoteSegment }[]): Promise<void> {
  const byKey = new Map<string, RawNoteSegment[]>();
  for (const e of entries) {
    if (!e.key || !String(e.seg.text || "").trim()) continue;
    const list = byKey.get(e.key) ?? [];
    list.push(e.seg);
    byKey.set(e.key, list);
  }
  await dbUpdateMany<RawNotes>(STORE_RAW_NOTES, [...byKey.keys()], (key, existing) => {
    let cur = existing;
    let changed = false;
    for (const seg of byKey.get(key)!) {
      const next = appendSegment(cur, key, seg);
      if (next) { cur = next; changed = true; }
    }
    return changed ? cur! : null;
  });
}

export async function loadRawNotes(key: string): Promise<RawNotes | undefined> {
  return dbGet<RawNotes>(STORE_RAW_NOTES, key);
}
