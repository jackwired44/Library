// "Seen before": has this person already come in on an earlier file? Per
// Jack: "if a strong signal gets logged has it been logged by that same
// contact name in the past so i dont keep importing contacts to be updated
// ... like marcus bush was in 10/19 and 10/25".
//
// Same person = the same email, or the same FULL name at the same company
// (confirmed with Jack). A first name alone, or a name with no company, never
// matches: two different Marcus Bushes at two companies are two people.
// Read-only: nothing here changes a lead, a grade or a download.
import type { StoredLead } from "./leadStore";
import { normCompany, normEmail } from "./leadStore";
import { fileDates } from "./leadFiling";

export interface SeenIndex {
  byEmail: Map<string, Set<string>>;
  byName: Map<string, Set<string>>;
  /** File -> the date it is filed under (YYYY-MM-DD), same as Files. */
  dates: Map<string, string>;
}

export interface SeenFile { file: string; date: string }

function emailKey(email: unknown): string {
  const e = normEmail(email);
  return e.includes("@") ? e : "";
}

/** "Marcus Bush" + "Acme Inc." -> "marcus bush::acme". Needs two name words. */
export function seenNameKey(name: unknown, company: unknown): string {
  const n = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const c = normCompany(company);
  return n.includes(" ") && c ? `${n}::${c}` : "";
}

export function buildSeenIndex(leads: StoredLead[]): SeenIndex {
  const byEmail = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, files: string[]) => {
    if (!k || !files.length) return;
    let s = m.get(k);
    if (!s) { s = new Set(); m.set(k, s); }
    for (const f of files) s.add(f);
  };
  for (const l of leads) {
    add(byEmail, emailKey(l.email), l.sourceFiles);
    add(byName, seenNameKey(l.contact, l.company), l.sourceFiles);
  }
  return { byEmail, byName, dates: fileDates(leads) };
}

/** Every file this person has come in on, oldest first, leaving out
 *  `exclude` (the upload being looked at, so it doesn't count itself). */
export function seenFilesFor(
  idx: SeenIndex,
  p: { email?: unknown; contact?: unknown; company?: unknown },
  exclude?: Set<string>,
): SeenFile[] {
  const files = new Set<string>();
  for (const f of idx.byEmail.get(emailKey(p.email)) ?? []) files.add(f);
  for (const f of idx.byName.get(seenNameKey(p.contact, p.company)) ?? []) files.add(f);
  const out: SeenFile[] = [];
  for (const f of files) if (!exclude?.has(f)) out.push({ file: f, date: idx.dates.get(f) || "" });
  return out.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.file.localeCompare(b.file));
}

/** "2026-10-19" -> "10/19"; a file with no date reads as its name. */
export function seenLabel(files: SeenFile[]): string {
  const parts: string[] = [];
  for (const s of files) {
    const p = s.date ? `${Number(s.date.slice(5, 7))}/${Number(s.date.slice(8, 10))}` : s.file;
    if (!parts.includes(p)) parts.push(p);
  }
  return parts.join(", ");
}
