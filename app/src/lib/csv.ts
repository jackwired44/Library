import Papa from "papaparse";
import type { ExportLabel } from "./detection";
import type { ClaudeDownloadsNamespace } from "./claudeRuntime";

export function toCSV(rows: Record<string, unknown>[], columns: readonly string[]): string {
  return Papa.unparse({ fields: columns as string[], data: rows.map((r) => columns.map((c) => r[c] ?? "")) });
}

function swapExtension(fileName: string, ext: string): string {
  return fileName.replace(/\.[^./\\]+$/, "") + ext;
}

// Tries the capability's own save prompt first (this is the ONLY way a
// file leaves the page when running inside the Artifact preview — the
// viewer's sandbox blocks the classic <a download> trick outright, see
// the Artifact tool's own warning). CSV is in the capability's "extended"
// file-type set, which isn't guaranteed enabled for every viewer, so a
// rejected/unsupported CSV extension falls back to a .txt with the same
// content rather than failing outright.
async function saveViaClaudeDownloads(fileName: string, text: string): Promise<boolean> {
  if (typeof window === "undefined" || !window.claude?.use) return false;
  let downloads: ClaudeDownloadsNamespace | null;
  try {
    downloads = await window.claude.use("downloads");
  } catch {
    return false;
  }
  if (!downloads) return false;
  try {
    await downloads.save({ filename: fileName, data: text });
    return true;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "declined") return true; // the viewer said no — not a failure, never auto-retry
    if (code === "rejected_extension" || code === "extension_not_enabled") {
      try {
        await downloads.save({ filename: swapExtension(fileName, ".txt"), data: text });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export async function downloadBlob(text: string, fileName: string, mime = "text/csv;charset=utf-8;"): Promise<void> {
  if (await saveViaClaudeDownloads(fileName, text)) return;
  if (typeof window !== "undefined" && window.claude?.use) {
    // Inside a claude.ai viewer, but the save genuinely failed (not a
    // decline) — the classic <a download> fallback below is a guaranteed
    // no-op here, so say so instead of silently doing nothing.
    window.alert(`Couldn't save "${fileName}" here. Try again, or run this app outside the preview (npm run dev) to download normally.`);
    return;
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadCSV(fileName: string, rows: Record<ExportLabel, string>[], columns: readonly ExportLabel[]): Promise<void> {
  await downloadBlob(toCSV(rows, columns), fileName);
}

// Some CRM exports (confirmed live on a real Wired CIO export) build each
// cell by concatenating several source fields together and stringifying an
// empty one as the literal text "NULL" — with NO separator, so it lands
// glued directly onto real content: "Dynamics 365 Business Central - 25
// usersNULL" or "NULLFrontline Mobile Response is developing...". That
// glued "NULL" eats the word boundary every count/keyword regex in
// detection.ts relies on (`\busers?\b` doesn't match inside "usersNULL"),
// so a lead with a real, explicit stated seat count silently missed
// Strong Signal promotion and landed in Needs Review instead — confirmed
// on a real batch where Jack had to manually re-promote 12 leads because
// of exactly this. Stripped once, here, right after parsing — the single
// choke point every consumer (detection, Contacts, CSV re-export) reads
// through — rather than patching every regex to tolerate it. A cell that's
// ONLY the literal text "NULL" (a genuinely empty source field, not a
// glued-artifact) is treated as blank the same way.
function stripGluedNull(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (trimmed.toUpperCase() === "NULL") return "";
  // Trailing glue isn't always onto a word — plenty of real rows end a full
  // sentence with punctuation right before the glued NULL ("...their
  // workload.NULL"), not just a bare word ("usersNULL"). `(?<=\S)` catches
  // both instead of only `[A-Za-z0-9]`; found because those rows still
  // rendered a literal "NULL." as their entire matched-snippet/notes text.
  return v.replace(/\bNULL(?=[A-Za-z])/g, "").replace(/(?<=\S)NULL\b/g, "");
}
function cleanParsedRows(data: Record<string, unknown>[]): Record<string, unknown>[] {
  return data.map((row) => {
    const cleaned: Record<string, unknown> = {};
    for (const key of Object.keys(row)) cleaned[key] = stripGluedNull(row[key]);
    return cleaned;
  });
}

export function parseCSVFile(file: File): Promise<{ name: string; fields: string[]; data: Record<string, unknown>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => resolve({ name: file.name, fields: parsed.meta.fields || [], data: cleanParsedRows(parsed.data) }),
      error: (err) => reject(new Error(`${file.name}: ${err.message || "could not be parsed"}`)),
    });
  });
}

export function parseCSVText(fileName: string, text: string): { name: string; fields: string[]; data: Record<string, unknown>[] } {
  const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
  return { name: fileName, fields: parsed.meta.fields || [], data: cleanParsedRows(parsed.data) };
}
