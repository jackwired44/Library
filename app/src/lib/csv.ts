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
  if (!downloads) return false; // capability not granted to this view — see downloadBlob's message
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

/** Test harness only: set to "1" to skip the name box. There is no way to
 *  set it from the page. Per Jack: "need to be able to rename the csv when
 *  i download it" — an old "Don't ask again" tick (key "askFileName") had
 *  silently switched the box off for good, so the option is gone and the
 *  old key is ignored. */
export const ASK_FILE_NAME_KEY = "skipFileNameBox";

/** Per Jack: "need to be able to name the csv before i download and export
 *  the file". Every download goes through downloadBlob, so the name box
 *  lives here once: pre-filled with the suggested name, Enter downloads,
 *  Esc cancels. It asks every time. The
 *  extension is kept if it is typed away, and characters a filename cannot
 *  carry are replaced. */
export function cleanFileName(typed: string, suggested: string): string {
  const ext = (suggested.match(/\.[a-z0-9]{2,5}$/i) || [""])[0];
  let name = typed.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim();
  if (!name) return suggested;
  if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
  return name;
}

function chooseFileName(suggested: string): Promise<string | null> {
  if (typeof document === "undefined") return Promise.resolve(suggested);
  try { if (localStorage.getItem(ASK_FILE_NAME_KEY) === "1") return Promise.resolve(suggested); } catch { /* ask */ }
  return new Promise((resolve) => {
    const ext = (suggested.match(/\.[a-z0-9]{2,5}$/i) || [""])[0];
    const wrap = document.createElement("div");
    wrap.className = "name-file-backdrop";
    wrap.innerHTML = `
      <div class="name-file" role="dialog" aria-modal="true" aria-label="Name the file">
        <div class="name-file-title">Name the file</div>
        <label class="name-file-row"><input class="field name-file-input" aria-label="File name" /><span class="name-file-ext"></span></label>
        <div class="name-file-actions">
          <button type="button" class="btn btn-sm btn-ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-sm btn-primary" data-act="ok">Download</button>
        </div>
      </div>`;
    const input = wrap.querySelector<HTMLInputElement>(".name-file-input")!;
    input.value = ext ? suggested.slice(0, -ext.length) : suggested;
    wrap.querySelector<HTMLElement>(".name-file-ext")!.textContent = ext;
    const done = (ok: boolean) => {
      wrap.remove();
      resolve(ok ? cleanFileName(input.value, suggested) : null);
    };
    wrap.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
      if (act === "ok") done(true);
      else if (act === "cancel" || e.target === wrap) done(false);
    });
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(true); }
      else if (e.key === "Escape") { e.preventDefault(); done(false); }
    });
    document.body.appendChild(wrap);
    input.focus();
    input.select();
  });
}

/**
 * Deliberately NO byte-order mark.
 *
 * A BOM would make Excel on Windows read the file as UTF-8 instead of ANSI,
 * which is a real cosmetic win for the notes column. But it also prepends
 * an invisible character to the FIRST header, so any importer that does not
 * strip it sees column A as "\uFEFFFirst Name" and drops it. That is a
 * functional risk to a live Apollo import, traded against a cosmetic one.
 * Not worth it — the file stays plain UTF-8.
 */
export async function downloadBlob(text: string, suggested: string, mime = "text/csv;charset=utf-8;"): Promise<void> {
  const fileName = await chooseFileName(suggested);
  if (!fileName) return; // cancelled in the name box
  if (await saveViaClaudeDownloads(fileName, text)) return;
  if (typeof window !== "undefined" && window.claude?.use) {
    // Inside a claude.ai viewer, but the save genuinely failed (not a
    // decline) — the classic <a download> fallback below is a guaranteed
    // no-op here, so say so instead of silently doing nothing.
    //
    // The overwhelmingly likely cause is that this page was republished
    // without restating `downloads` in its capabilities object. That
    // object is a FULL-SET declaration: anything not restated on a
    // republish is silently revoked, with no error anywhere. It has
    // happened twice. Name it, so the next report is "downloads got
    // revoked" instead of "the download button broke".
    let granted = false;
    try {
      granted = Boolean(await window.claude.use("downloads"));
    } catch {
      granted = false;
    }
    window.alert(
      granted
        ? `Couldn't save "${fileName}". Try again, or run this app outside the preview (npm run dev) to download normally.`
        : `Downloads are turned off for this page, so "${fileName}" can't be saved.\n\nThis is a publish setting, not a bug in the file: the page needs republishing with the "downloads" capability restated. Nothing you can fix from here.`
    );
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
  // A queue code glued onto the start of the cell — "f1Locked out of
  // teams", "1C1E2026-09-25 …" — hides the first word from every rule
  // (the login-issue DQ never saw "Locked"). Only when glued; "F1 / …"
  // with a space is a label and the metadata DQ reads it as one.
  return v.replace(/^(\s*)(?:1C[01]E|f1)(?=[A-Za-z]|\d{4}-)/i, "$1")
    .replace(/\bNULL(?=[A-Za-z])/g, "").replace(/(?<=\S)NULL\b/g, "");
}
// Mojibake repair. A Dynamics/Excel export that lost its encoding on the
// way out writes U+FFFD (the replacement character) where a smart quote or
// a bullet used to be — 3,717 of 9,265 rows in one real CSP export. Left
// alone it reaches the call notes as "customer<?>s" and the download as a
// literal replacement glyph.
//
// Two cases, and nothing is invented beyond them:
//   letter <?> letter  -> an apostrophe ("customer<?>s" is "customer's")
//   anything else      -> dropped, and the surrounding spaces collapsed,
//                         because a stray bullet carries no meaning
// Done here, once, at the same choke point stripGluedNull uses, so all
// three scanners and every export read the repaired text.
// NB the guard is a regex, not `v.includes("\uFFFD")`: a string literal
// containing the escape is compiled to a REAL replacement character in the
// bundle, which then trips every "is this file UTF-8 clean" check — the
// publish step refused the build over it. A regex literal keeps the escape.
function repairMojibake(v: string): string {
  if (!/\uFFFD/.test(v)) return v;
  return v
    .replace(/(?<=\p{L})\uFFFD(?=\p{L})/gu, "\u2019")
    .replace(/\s*\uFFFD+\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cleanParsedRows(data: Record<string, unknown>[]): Record<string, unknown>[] {
  return data.map((row) => {
    const cleaned: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      const v = stripGluedNull(row[key]);
      cleaned[key] = typeof v === "string" ? repairMojibake(v) : v;
    }
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
