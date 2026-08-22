# Wired CIO Unified Lead Scanner — `legacy/` (current, live app)

This is the current, live version of the tool, and every path below is
relative to this `legacy/` folder — run commands from inside here (`cd
legacy && npm install && npm test`, etc.). See the repo root's `README.md`
and `CLAUDE.md` for how this folder relates to the `app/` rebuild in
progress.

## Files

- `unified-tool.js` — the entire app: detection engine (licensing seat-count
  scan + Dynamics/Power BI/Fabric/Azure/Migration signal scan), state,
  rendering, and event handling. Plain JS, no framework, no build step of its
  own — it's a single `<script>` body.
- `build-unified.js` — assembles the final HTML file. Reads `unified-tool.js`
  and `papaparse.min.js` and inlines both into `wired-cio-unified-lead-scanner.html`
  along with the page shell/CSS. Run `node build-unified.js` after any edit to
  `unified-tool.js` to rebuild the shippable file.
- `papaparse.min.js` — the only third-party dependency (CSV parsing),
  vendored locally so the final file has zero external runtime dependencies.
- `wired-cio-unified-lead-scanner.html` — the current built output. This is
  the file you actually open/use day to day.
- `wired-cio-crm-roadmap.md` — the longer-term direction (full internal CRM:
  lead lifecycle status, activity history, rep assignment, sequencing via
  Apollo). Say "CRM Build" in conversation to pull this up and add to it.
- `test-unified.js`, `test-invariants.js`, `test-errors.js`, `test-history.js`,
  `test-cheatsheet.js`, `test-dq.js`, `test-library.js`, `test-groups.js`,
  `test-history-scale.js`, `test-rules-audit.js`, `test-backup-restore.js` —
  Playwright regression tests exercising the detection engine, the
  arithmetic (every count reconciles across tiers/categories/buckets, a
  3-way signal/mention/dq split), edge cases (empty files, zero-match
  uploads), the History save/load round trip, the in-app cheat sheet
  overlay, the Bad Leads auto-DQ system, the Library (including that it
  survives a full page reload — the actual point of it), the Library's
  rename + Groups organization layer, History's auto-persistence + search +
  "Combine into Scanner" (including that a combined-view edit writes back
  to the correct original import, not just the first one with a matching
  row id), the rules-audit correction (Azure's growth-language bonus
  removed, 15-seat threshold), and full backup/restore (including that
  restore MERGES rather than wipes, and that a restored group/assignment
  survives a reload). Worth running after any change:
  `node test-invariants.js && node test-errors.js && node test-unified.js && node test-history.js && node test-cheatsheet.js && node test-dq.js && node test-library.js && node test-groups.js && node test-history-scale.js && node test-rules-audit.js && node test-backup-restore.js`
  (each writes and cleans up its own throwaway CSV fixtures).
  `test-perf.js` is a benchmarking script, not a pass/fail test.
  `test-library-folders.js`, `test-library-folder-grid.js`,
  `test-file-to-folder.js`, `test-file-to-folder-month-picker.js`,
  `test-upload-time-filing.js`, `test-cross-out-tags.js`,
  `test-select-entire-archive.js`, `test-save-to-library-toggle.js`,
  `test-3-per-month.js`, `test-library-row-editing.js`, and
  `test-duplicate-detection.js` cover, respectively: month folders +
  category filtering, the folder-icon grid, manual/upload-time filing to a
  month folder (both now exercised under the opt-in model — see "Strong
  Signal only + opt-in save toggle" below), the cross-out toggle and History
  tag/notes, "Select entire archive," the save-to-Library checkbox itself,
  the 3-files-per-month append/move behavior, per-lead editing inside a
  folder's category file (see "Fully editable folders" further below), and
  post-scan duplicate detection (see "Duplicate detection" further below).

## How the detection model works, in brief

Every uploaded row runs through two regex-based engines in one pass:
licensing (Microsoft SKU + seat-count matching, `SKU_CATALOGUE`) and platform
(`PLATFORM_CATALOGUE` — Dynamics 365, Power BI, Microsoft Fabric, Azure,
Migration/Modernization, and a combined "Tenant Support" signal covering
Google-to-Microsoft migration, new-tenant creation, and general ongoing
IT-support language). Each individual signal still has its own detection
pattern and hit-level trigger logic, but they roll up (via
`PLATFORM_LABEL_TO_KEY`) into exactly three product lines
(`CATEGORY_META`), each always reassignable by hand, and each product line
is its own final CSV download (`BUCKET_META`):
- **M365 Tenant** — licensing seats + Tenant Support + generic
  Migration/Modernization, all grouped together.
- **Dynamics** — Dynamics 365, unchanged.
- **Power BI / Azure / Fabric** — those three platform signals grouped
  together (Azure-flavored migration language is still always kept here,
  never pulled into the generic Migration signal, via
  `AZURE_MIGRATION_OVERRIDE_RE`).

A row that matches neither engine at all is never added to `state.results` —
this tool only ever reports on leads it detected *something* for.

**Strong Signal bonus rules, per category (a rules-audit correction worth
knowing):** every platform category can reach Strong Signal via a generic
trigger word (`TRIGGER_WORDS_RE` — migrating, implementing, RFP, "this
year", etc.) or a nearby license/seat count, same as each other. On top of
that baseline, two categories get their own extra bonus path: Tenant Support
gets growth/overload language ("stretched thin", "overwhelmed", "no IT
staff" — `GROWTH_OVERLOAD_RE`), and Azure gets infrastructure-scale language
("virtual machines/VMs", "usage", "consumption", "adoption" —
`AZURE_SCALE_RE`). Growth/overload language used to ALSO count as an Azure
bonus, which didn't hold up on review — "we're overwhelmed, need help" is a
Tenant Support signal (wanting a support relationship), not an
infrastructure decision, so that cross-wiring was removed. Power BI and
Microsoft Fabric intentionally do NOT get either bonus — they reach Strong
Signal the same way Dynamics does, off the shared baseline only.

## Bad Leads — auto-DQ, on top of the three product lines

Every row that DOES get scanned in also runs through a cross-cutting
"Auto-DQ" check (`DQ_RULES`, `getDQReasons()`), and if any rule fires the row
is forced into a third tier — `"dq"` (Bad Lead) — regardless of what
category or tier it would otherwise have gotten. The tier system is a 3-way
cycle now (`TIER_CYCLE = ["signal", "mention", "dq"]`), so the per-row tier
badge cycles Strong Signal → Needs review → Bad lead → back to Strong Signal
on repeated clicks.

Bad Leads are always fully visible (their detected category chips, matched
snippet, and one-or-more DQ reason chips still show in the table) and fully
reversible by hand — nothing is dropped or hidden. They're broken out into
their own tier tab ("Bad Leads (N)") with a reason-breakdown panel
(`getDQReasonCounts()`) so a batch's DQ rate and reasons are reportable, and
they're automatically excluded from all three final CSV downloads (which
only ever pull `tier === "signal"` rows) and from the History card's
Strong Signal / Needs review / Bad leads counts.

Current DQ rules, all defined in `DQ_RULES` plus two standalone hygiene
checks in `getDQReasons()`:
- Single seat/user, or "for 1 person"/"just myself" — includes freelancer /
  solo / independent contractor / sole proprietor / self-employed language.
- Explicit rejection ("not interested", "went with a competitor",
  "unsubscribe").
- Happy with current provider / just renewed / locked into a contract.
- Personal / non-business use (home, hobby, school project).
- Basic support or account-login issue (password reset, locked out,
  username problem) — this always disqualifies even if the same note also
  contains Tenant Support wording like "help desk"/"support", since a
  one-off login problem isn't the same as wanting an ongoing IT
  relationship.
- Wants Microsoft's own direct support, not a reseller/MSP.
- Confirmed seat/user count under 15 (`QUALIFY_THRESHOLD` — lowered from 20
  in a rules audit; no longer silently dropped, surfaces as a "Low seat
  count (under 15)" DQ reason).
- Missing company name / placeholder or invalid email (`test@`, `noemail@`,
  `example.com`, etc.) — data-hygiene checks, not buyer-fit checks, but
  folded into the same Bad Leads bucket since both make a row unusable as-is.

The in-app cheat sheet (corner button) documents all of this in plain
English under its own "Bad Leads" section — keep that in sync by hand if
`DQ_RULES` changes, same as the rest of the cheat sheet.

## Library — a permanent archive of every uploaded file

**Superseded — read "Strong Signal only + opt-in save toggle" near the end
of this file first.** Everything below in this section describes the
Library's ORIGINAL design (auto-save always on, one entry per uploaded
file, storing the exact original bytes). That model changed twice more
later in the project — first to month folders (below), then to the
current model: saving is opt-in per batch, and what's stored is each
batch's Strong Signal leads (not the raw file), aggregated into at most 3
files per month. Kept here for the historical detection-pipeline/IndexedDB
detail, which is still accurate; the storage shape it describes is not.

A third nav tab, separate from both Scanner (what a given upload looks like
right now) and History (what a given scan/import looked like at the time).
Library answers a different question: "give me the original file back,
any time, without re-uploading it" — every CSV dropped into the Scanner is
also saved here automatically, in full, forever (until manually deleted).

Storage is `IndexedDB` (`LIBRARY_DB_NAME = "wiredCioUnifiedLeadScannerLibrary_v1"`),
not a save/load JSON file like History — it persists across page reloads
with no manual step. Each entry: `{ id, fileName, rawText, rowCount,
uploadedAt, receivedAt }`. `rawText` is the exact original file bytes
(captured via `file.text()` alongside the existing `Papa.parse(file, …)`
call, never altered), so "Download" on a Library entry hands back byte-for-
byte what was uploaded, and "Load into Scanner" re-parses that same text
through the identical mapping/scan pipeline a fresh upload goes through
(`applyParsedFiles`, factored out of `handleFiles` so both paths share one
implementation).

Two dates, deliberately different in nature:
- **Uploaded here** — automatic, stamped the moment the file enters this
  tool. Never editable.
- **Leads received** — blank until typed in by hand (an `<input type="date">`
  per row), for when the leads actually came in from wherever they came
  from. Deliberately not auto-guessed from anything, so it's never
  confidently wrong.

Storage caveat worth knowing, and worth telling Jack again if this ever
comes up: this is real IndexedDB, not a folder on disk. Chromium scopes it
to the `file://` origin as a whole (confirmed empirically — two copies of
this HTML file at different paths on the same machine share one Library),
so rebuilding/re-downloading the tool doesn't lose it, but clearing browser
data, using a different browser, using a private/incognito window, or
opening the file on a different computer all start a fresh, empty Library.
It is explicitly not a substitute for a real backend/database — that's
still item #1 on the CRM roadmap below, and this note should be updated (or
removed) once that lands. "Backup everything" (below) is a first, small
step toward closing that gap — not a fix for it.

**Boot sequence — a real bug this surfaced, worth understanding before
touching render() or the Library init code again:** the app's first
`render()` is deliberately held until the Library finishes loading from
IndexedDB (bounded by a 3-second timeout so a broken/slow storage layer
can't block boot forever — see `loadLibraryFromDB()`'s comment and the
`DOMContentLoaded` handler in `unified-tool.js`). An earlier version
rendered immediately on boot and re-rendered a second time once the async
IndexedDB read resolved. Since `render()` always does a full
`root.innerHTML = html` replace, that second render — firing shortly after
boot, completely asynchronously — could silently detach `#file-input` (or
any other element) out from under an in-flight interaction: a fast user (or
a Playwright-driven upload, which is how this was actually caught) who
selects a file in that narrow window would have the resulting "change"
event dispatch on an already-detached node, which never bubbles to the
delegated listener, so the upload would just silently do nothing. Empirically
reproduced under Playwright and fixed by awaiting the Library load first. The
static "Loading…" placeholder in `build-unified.js`'s HTML shell exists so
that brief (normally sub-100ms) wait never shows a blank page. If a future
change reintroduces a second post-boot render for some other reason, revisit
this.

## Library rename + Groups — organizing the archive itself

Two small additions on top of the Library, scoped entirely to that tab —
neither touches Scanner, History, detection, or exports in any way.

**Rename.** Each Library row's file name is an editable text field
(`data-library-filename`), committed on blur/change (not per-keystroke, so
typing doesn't fight a re-render). A blank edit reverts to the existing name
rather than saving an empty string (`renameLibraryEntry`).

**Groups.** A purely organizational layer for sorting saved files — e.g.
"Fully contacted" vs. "Not yet contacted" — that never affects scanning,
detection, categories, tiers, or CSV exports. Each Library entry has a
`groupId` (null = ungrouped). Groups live in their own IndexedDB store
(`LIBRARY_GROUPS_STORE = "groups"`, added in a v1→v2 schema bump — see
`openLibraryDB()`'s `onupgradeneeded`, which handles both a fresh database
and an existing v1 database with files already in it).

- **Create** via the "+ New group" button, which opens an inline form for a
  name (required) and optional notes. The form auto-closes on successful
  create; reopen it to reach the "Existing groups" list below it, where each
  group's name and notes are themselves inline-editable
  (`data-library-group-rename` / `data-library-group-notes`,
  `renameLibraryGroup`), and a group can be deleted from there.
- **Assign** a file to a group either per-row (a `<select>` on each Library
  row, `data-library-group-assign`) or in bulk (select multiple rows, pick a
  group from "Move to:" in the bulk-action bar, click Apply —
  `assignSelectedLibraryToGroup`).
- **Delete a group** only ungroups its files (`deleteLibraryGroup` sets their
  `groupId` back to `null`) — it never deletes the underlying saved files.
  This is deliberate: a group is a label on files that still need to be
  somewhere, not a trash can for them.
- **Filter and search** — group tabs across the top ("All files", "Ungrouped",
  then one tab per group, each with a live count from `getLibraryGroupCounts()`)
  narrow the table via `getFilteredLibrary()`, and the existing search box
  now matches group names in addition to file names, so typing "Fully
  contacted" surfaces every file in that group even if none of their file
  names mention it.

## History at scale — persistence, search, and combining across imports

Built for a specific workload: uploading ~100 raw CSVs, five at a time (the
`MAX_FILES` cap), each batch condensing into its own History entry, then
needing to combine batches together and run deep filtering across all of
them before placing leads in the right bucket.

**Auto-persistence.** History now lives in IndexedDB (`HISTORY_STORE =
"history"`, added in a v2→v3 schema bump alongside Library's existing
stores — same database, same `onupgradeneeded` pattern, no data lost for
anyone upgrading from an earlier version). Previously History only survived
a reload if you manually clicked "Save history file" first; at 100-import
scale that's too much riding on memory with no safety net. Every new import,
every delete, every manually-loaded history JSON file, and every edit made
while viewing a saved import (reassign, tier cycle, bulk move) now writes
through to local storage automatically (`historyDBPut`/`historyDBDelete`,
mirroring the Library convenience wrappers). "Save/Load history file" still
exist — they're just a backup/transfer mechanism now, not the only save
path.

**Search across all of History**, not just the currently-selected week
(`historySearch`, `getFilteredHistory()`) — matches file names first, then
falls back to checking each entry's own scanned rows for a company/contact
match. With a lot of imports likely landing in the same week (running 20
batches in one afternoon doesn't spread across weeks), the week tabs alone
stop being a useful way to find one specific import; search ignores week
grouping entirely and just returns matches, newest first. A "Show more"
button (`historyVisibleCount`) keeps a week or search result with a lot of
entries from rendering as one giant wall of cards all at once.

**Combine into Scanner** — the actual point of all of this. Check off
several History entries (or click "Select all" on whatever's currently
shown) and a bulk bar appears with a rows/imports preview and a "Combine
into Scanner" button (`combineSelectedHistoryIntoScanner`). That pulls every
checked import's rows into the Scanner as one working set — not a flat CSV
dump, the actual Scanner view — so the full existing toolkit (category
tabs, tier cycling, search, per-row and bulk reassignment) works across all
of them together, and the same exactly-3-bucket export at the bottom
produces one combined CSV per product line once everything's placed where
it belongs. A banner at the top of the Scanner ("Viewing N combined
imports") makes it clear what's being edited.

Rows brought into a combined view are shallow copies with a synthesized
unique id (`${importId}::${originalRowId}`) — NOT the original shared
objects like a single "View / edit" does. This matters: two different
imports can easily both have a row id like `"0-0"` (ids are only ever
scoped to one file/import at a time), so combining without remapping ids
would risk one row's edit silently landing on a different import's row
that happened to share the same id. Every edit made in a combined view
writes back to the correct original import via `syncCombinedRowEditBack`
(matched by which import + original row id the copy came from) and
persists that one import to IndexedDB — verified in `test-history-scale.js`
by editing a row from one import inside a 2-import combined view and
confirming only that import's stored data changed.

Deliberately NOT done here: no deduplication. Combining is a straight
concatenation of whatever's in the checked imports — if the same lead
appears in two different raw files, it'll appear twice in the combined
view and in the resulting export. Worth a follow-up conversation if
duplicate leads across files turn out to be common at 100-file volume, but
"same lead" isn't a well-defined check yet (exact row match? same email?
same company?) and guessing at it felt riskier than leaving it manual for
now.

## Data architecture, phase 1 — full backup/restore

The honest architectural ceiling of this tool: Library, Groups, and History
all live in one browser's IndexedDB. No backend, so it's gone if browser
data is cleared, a different browser/machine is used, or a teammate needs
to see the same data. A real fix is a real backend — that's its own project
(see the CRM roadmap below), not something to build "slowly." This is
phase 1 instead: a small, low-risk, purely additive safety net, decided on
deliberately over a bigger first move (no auto-backup to the device yet —
that's a later phase, if wanted).

Two new buttons sit next to the nav tabs, visible on every view (not
scoped to one tab, since this covers all three data stores at once):

- **Backup everything** (`backupEverything`) downloads one JSON file —
  `wired-cio-lead-scanner-full-backup-<date>.json` — containing the full
  Library (including each file's raw original content), all Groups, and
  all of History, exactly as they exist in IndexedDB at that moment. Save
  it wherever you actually control it — Drive, a folder, email it to
  yourself.
- **Restore backup** (`restoreBackupFile`) loads that file back in. Restore
  is a MERGE (upsert by id) into whatever's currently loaded, not a wipe-
  and-replace — same pattern `loadHistoryFile` already used for History
  alone. In the primary use case (browser data got cleared, state is empty)
  a merge produces exactly the same result a full replace would, but a
  merge is strictly safer for every other case: restoring an older backup
  can only add or update entries, never silently delete something newer
  that isn't in the file. Every restored entry is written through to
  IndexedDB immediately (not just patched into memory), so it's still
  there on the next reload — verified in `test-backup-restore.js`,
  including a case that deletes a Library group by hand, restores an older
  backup that still has it, and confirms the group (and its file
  assignment) comes back and survives a subsequent reload.

A malformed or unrelated JSON file shows a clear error (`state.error`)
rather than crashing or silently doing nothing.

One known open item, not yet fixed: on a licensing-only lead, the matched
snippet can occasionally pull in fragments of adjacent CSV columns (contact
name/email/title) if they sit close to the matched SKU text — see
`scanRowLicensing` / `extractCountNear`'s window-based extraction. Flagged
during the last visual-only pass but intentionally not touched since that
round was scoped to styling only.

## Visual/UI upgrade pass — styling only, zero behavior change

A full pass over the CSS and inline styles across all three views (Scanner,
History, Library) plus the cheat sheet modal, done under one hard constraint:
no state, no event handler, no `id`, no `data-*` attribute, and no
conditional that decides what renders was touched — only colors, spacing,
radii, shadows, and a few purely-decorative markup additions (stat-tile
icons, etc.). Verified by rerunning the full 11-test regression suite
unchanged (see the command above) both before and after — same pass/fail,
same numbers, zero page/console errors.

What changed, concretely:

- `build-unified.js`'s global `<style>` block: a subtle two-tone background
  wash instead of flat gray, a `.wc-card` / `.wc-card-hover` utility (soft
  lift + shadow on hover, used on stat tiles and History cards), zebra
  striping on table rows, a refined top nav bar (gradient + green-tinted
  bottom border), `:focus-visible` handling, and two small keyframe
  animations (`wc-modal-in` / `wc-fade-in`) used only by the cheat sheet
  modal's open transition — nothing else re-animates on re-render, since
  `render()` replaces the DOM on every keystroke and an app-wide fade would
  flicker constantly.
- Every card/badge/pill/button across all three views: consistent radii
  (9–13px depending on size), consistent shadow language (a resting shadow
  plus a slightly stronger one on active/selected states), pill-shaped chips
  instead of small-radius rectangles for Detected-column tags and DQ reason
  tags, and a segmented-control look for pagination instead of two loose
  buttons.
- Stat tiles (Rows scanned / Strong Signal / Needs review / Bad leads) each
  got a small icon and a hover lift; the same treatment was applied to
  History's per-import cards.
- The cheat sheet modal got a backdrop blur, a scale+fade entrance, pill-
  shaped chips, and slightly more breathing room — none of its actual text
  or logic changed.
- One small non-visual-only fix bundled in since it was found while doing
  this pass: the History search box was clipping its own placeholder text
  (`flex:0 0 220px` was too narrow) — widened to 260px.

Nothing about detection, tiers, DQ, History/Library persistence, backup/
restore, or the cheat sheet's content changed. If anything here ever looks
inconsistent with the rules described elsewhere in this file, this section
is describing paint, not behavior — trust the sections above it.

## Rebrand pass — matched to wiredcio.com, styling only

Jack asked for the tool to actually look like Wired CIO's own site, not just
"a nice UI." Values below were pulled directly off wiredcio.com (via a live
browser session — computed styles, not guesswork) rather than approximated,
then applied the same way as the prior pass: colors, fonts, and shapes only,
verified against the same 11-test suite before and after.

What was pulled from the live site:

- **Fonts**: `Fraunces` (serif, the site's display/heading font) for
  everything using `.lf-display`; `Hanken Grotesk` (sans, the site's body/UI
  font) as the base font-family, replacing Space Grotesk + Inter. `IBM Plex
  Mono` stays for data chips — the site has no mono equivalent, but it's a
  UI-only distinction (marking detected values as data), not a brand clash.
- **Brand green** `#2CC295` — the site's one accent color, sampled from the
  "people." headline text and the "Grow" section heading. Replaces the old
  `#2F6F4F`. Their CTA button pairs this green with **dark ink text**
  (`#081E22`), not white — `#2CC295` is bright enough that white-on-green
  reads weak. Every green-filled button in the tool (Combine into Scanner
  trigger, bulk Apply, Library actions, and especially the three "Final
  downloads" buttons) was repaired to match: dark text on the bright green,
  not white. The three download buttons additionally now use the site's
  actual CTA shape — full pill (`border-radius:999px`), bold, 2px border —
  since those are the tool's real call-to-action, same role as "Book an
  Intro Call" on the site.
- **Dark ink** `#081E22` and the hero gradient `linear-gradient(140deg,
  #0C4651 0%, #081E22 78%)` — sampled directly from the site's hero section
  CSS. Replaces the old flat navy (`#16202B` / `#12181F` / etc.) on the nav
  bar, the header icon tile, the cheat sheet button, and every place that
  used to be "dark UI chrome." The nav bar's green radial glow and bottom
  border are the same treatment the site uses under its own hero.
- **Page background** `#F6FAFA` — the site's exact light-mode background,
  replacing the old `#F4F5F7`.
- **The actual logo mark** — fetched directly from
  `wiredcio.com/assets/logos/icon-light.svg` (the site's own asset, since
  this is Wired CIO's own internal tool) and inlined in the nav bar in place
  of the placeholder "WC" monogram tile.
- **Category badge colors** — Dynamics 365 and Power BI/Azure/Fabric now use
  the exact purple and blue sampled from the site's "Automate" and "Protect"
  icons, respectively (`#5B3FC4` / `#1470A0`, darkened slightly from the
  site's icon-weight versions for text legibility on a light background).
  M365 Tenant's rust-orange was left alone — deliberately NOT given the
  brand green, since that's already the "Strong Signal" tier color
  elsewhere, and a category badge in the same green would blur two
  different meanings together in the same row.
- **Nav tabs** (Scanner / History / Library) went uppercase, bold, and
  letter-spaced — matching the site's own nav link treatment — while the
  denser secondary filter rows (tier/category/group tabs) were left in
  normal case, since the site itself only tracks-out its top-level nav, not
  every control.

Deliberately NOT changed: the tier semantic colors (green = Strong Signal,
amber = Needs review, red = Bad lead) and the Bad Leads red, since the site
has no equivalent to borrow and these carry real meaning in the workflow —
changing them would be a functional risk dressed as a style change. Also
left untouched: the Needs-review amber (`#9A5B22`), since it was already
almost identical to the site's own "Align" amber (`#8A5A12`) by coincidence.

## Phase 1 of the feature build-out: cross-out + History labeling

First two concrete asks after the rebrand: a way to mark a lead as handled
without moving it off whatever list/tier/group it's already sitting on, and
a way to label/annotate a History import instead of every entry just being
a timestamp and a file name. Both are additive — nothing about detection,
tiers, categories, filtering, counts, or exports changed; covered by a new
`test-cross-out-tags.js` on top of the existing 11-test suite (12/12 pass).

**Cross out a lead, in place.** A small toggle button at the end of every
Scanner row (`data-cross-toggle`, the new `strike` icon) flips a plain
boolean, `row.crossedOut`, via `toggleCrossedOut(id)`. When true, the
Company and Contact cells render with a strikethrough — nothing else about
the row changes. It keeps its tier, its category, its position in the
list, and it still counts toward every stat tile and export exactly as
before. This is deliberate: Jack's ask was to mark a lead "handled" while
leaving it exactly where he put it — not a fourth tier, not a hide/archive
action, just a visual line through it so a list of 40 leads shows at a
glance which ones have been worked. The bulk-selection bar picked up two
matching actions, "Cross out" and "Restore" (`setCrossedOutForSelected`),
for marking or clearing a whole selection at once — same pattern as the
existing bulk tier/category actions, selection clears after applying.
Persistence follows the same rule as every other per-row edit in this
tool: it writes through to IndexedDB once the row belongs to an import
that's actively being viewed from History, or once it's edited from a
combined view (`syncCombinedRowEditBack` now carries `crossedOut` across
alongside category/tier) — a fresh, never-opened-from-History import
behaves the same way reassigning a category on it always has.

**Tag and notes on every History import.** Two new fields on each History
entry, `tag` (a short label, e.g. "March cold list") and `notes` (freeform
text, e.g. "called Alpha, left VM, follow up Friday"), editable right on
the History card (`data-history-tag` / `data-history-notes`, saved via
`updateHistoryTag` / `updateHistoryNotes` on blur/change — same
inline-edit-on-the-card pattern already used for Library file renames and
group notes). Both persist to IndexedDB immediately, independent of
whether that import is currently loaded into the Scanner. The History
search box now checks the tag first before falling back to file names and
row-level company/contact matches, so at real volume (Jack's stated ~100
imports) a consistent labeling habit turns History into something you can
actually find your way back into, not just a dated pile of uploads.

Not done here, on purpose: this doesn't touch the existing three-category
structure or add a separate free-form per-lead tagging system beyond the
cross-out mark — Jack's "categorization/tagging" answer named the cross-out
mechanic specifically as the concrete piece, so that's what got built first.
Worth a follow-up conversation if a broader per-lead tag system (independent
of category/tier) turns out to still be wanted on top of this.

## Chrome extension packaging — same tool, reached from the toolbar

A packaging option, not a rebuild: everything above still describes the one
real tool (`unified-tool.js`). The `extension/` folder wraps that exact same
file as a Chrome side panel — a toolbar icon that opens the Scanner
alongside whatever page you're on, instead of having to find and open an
HTML file. Built because the ask was specifically "just convenience," not
new page-reading capability — so nothing about detection, tiers, History,
Library, or exports changed or was duplicated; `extension/build-extension.js`
reads the same `unified-tool.js` and `papaparse.min.js` this whole README
describes, copies them as-is, and wraps them in a manifest + side panel
shell.

**Install it (unpacked — this is a personal tool, not a public listing):**

1. Unzip `wired-cio-lead-scanner-extension.zip` somewhere permanent (not a
   temp/Downloads folder that gets cleared — Chrome reads the extension
   from this folder every time it starts).
2. Go to `chrome://extensions`, turn on "Developer mode" (top-right toggle).
3. Click "Load unpacked" and select the unzipped folder.
4. Click the puzzle-piece icon in Chrome's toolbar, then pin "Wired CIO
   Unified Lead Scanner" so its icon stays visible.
5. Click the icon — the Scanner opens in the side panel, same as the
   standalone tool.

**One real thing that does NOT carry over automatically: your existing
History and Library data.** The standalone HTML file's saved leads live in
that file's own browser storage; the extension gets its own separate
storage the first time it's used, starting empty. To bring existing data
across: open the current `wired-cio-unified-lead-scanner.html`, click
"Backup everything," then open the extension and click "Restore backup"
with that same file. This is the exact backup/restore feature described
above under "Data architecture, phase 1" — built for this kind of move,
not just disaster recovery.

**Packaging differences from the standalone file (why `extension/` has its
own build script instead of reusing `build-unified.js` output directly):**
Manifest V3 extension pages run under a stricter Content Security Policy
than a plain HTML file — inline `<script>` blocks are blocked outright, with
no setting to allow them back. `build-unified.js` inlines everything into
one file, which works fine for a standalone HTML file opened directly, but
would silently fail to run at all as an extension page. `build-extension.js`
instead copies `unified-tool.js` and `papaparse.min.js` as real sibling
files and loads them via `<script src="...">`, which is allowed. Same code,
different delivery — verified by loading the unpacked extension in a real
Chromium instance (not just previewing the HTML) and confirming upload,
scan, IndexedDB persistence across a reload, and CSV download all work
under the extension's own `chrome-extension://` origin.

Also extension-only: the floating "Cheat sheet" button is pinned to the
viewport corner, which works fine on a full-width tab (there's blank margin
for it to float in) but can sit closer to card buttons in a narrow,
resizable side panel. Shrunk via a `@media (max-width: 480px)` rule scoped
to the extension shell only — confirmed via bounding-box measurement that
it doesn't actually intercept clicks on History card buttons, and the panel
can always be dragged wider (matching the standalone tool's spacing
exactly) if it ever feels tight.

Not done: publishing to the Chrome Web Store. That requires a one-time
developer account, a public listing, and a review process — none of which
makes sense for a single-person internal tool. If this ever needs to reach
teammates' machines without each person manually loading it unpacked,
that's the point to revisit this.

## Password-gated web version — for phone access, kept simple on purpose

`web/build-web.js` produces `web/wired-cio-lead-scanner-web.html` — the same
tool again, wrapped in a basic password lock screen so it's safe(-ish) to
open from a phone or hand around a URL. Enter the password once and it's
remembered on that device (`localStorage`) until "Lock" is clicked in the
nav bar.

Deliberately simple, and deliberately NOT real account security: the
password lives in plain text in this file's own source (`SITE_PASSWORD` at
the top of `build-web.js`, easy to change — just edit and re-run the build),
readable by anyone who views the page source. That's an accepted tradeoff
for "quick," discussed directly before building this — the alternative is a
real backend with a real login, which is Phase 1 of the CRM roadmap
(`wired-cio-crm-roadmap.md`) and a meaningfully bigger build, not something
to reach for casually. This file is not currently hosted anywhere; it's
just a file, same as the standalone tool, until a hosting decision is made.

## Library "month folders" + category filter — organizing the archive

Jack's ask: leads should be "properly stored and be able to build off it,"
with the Library standing as the full archive of every lead Wired CIO has
ever received, organized by month, filterable by product line. Built on
top of what already existed rather than a new hierarchy — the existing
Library Groups feature (see "Library rename + Groups" above) already did
90% of this; it just needed a sensible automatic default instead of leaving
every file "Ungrouped" until manually sorted.

**Month folders are Groups, auto-created.** Every file saved to the Library
(via a normal Scanner upload) now auto-joins a group named for the month it
was uploaded — "August 2026," created the first time that month is seen,
reused after that (`getOrCreateMonthGroupId` in `unified-tool.js`). Nothing
new to learn: it's the exact same Groups UI (rename, filter tabs, "+ New
group," bulk reassignment) that already existed, just seeded with a useful
starting point instead of an empty "Ungrouped" bucket. Files can still be
manually moved to a different or additional custom group afterward exactly
as before — this only changes the default.

**Legacy files get swept in too**, not just uploads going forward — since
"source of truth for all leads ever received" implied the whole archive,
not just new arrivals. Any Library file still sitting "Ungrouped" from
before this feature existed gets backfilled into its own upload month the
next time the Library loads, using its real original `uploadedAt` date (not
today's date) — so a file actually uploaded last January lands in "January
2026," not "August 2026." This runs once per legacy file (it persists the
assignment immediately), not on every load.

**Category filter, separate from the month/group filter.** A new row of
tabs — All categories / M365 Tenant / Dynamics 365 / Power BI-Azure-Fabric
— sits below the group tabs, answering "show me every archived file that
has at least one Dynamics 365 lead in it," across all months at once (or
combined with a month filter, since both apply together). Library only
ever stored a file's raw text, never its detected categories — that's
History's job, and not every Library file necessarily has a matching
History run. So this runs the same column-guessing + detection pipeline
`applyParsedFiles` uses (`getLibraryEntryCategoryCounts`), just against one
file's raw text on demand, and caches the result by file id (`rawText`
never changes after upload, so there's no reason to ever recompute it) —
otherwise re-parsing and re-scanning full CSV text for every visible file
on every render would get slow at the archive scale Jack's building toward.
A small chip row under each file name (e.g. "Dynamics 365 1") shows exactly
why a file matched, without needing to open it.

Deliberately NOT done: category sub-folders nested inside each month. Jack
was asked directly whether the category breakdown should be a filter/lens
on top of the existing structure or a real nested hierarchy, and chose the
filter — simpler, and every file already carries its real category
breakdown regardless of how it's filed.

## "File this batch to a month folder" — one click from Final Downloads

A follow-up ask, more specific than the Library folders above: "click on
the final downloads section and move them to a folder titled by the month
the leads came in." The Scanner's Final Downloads card (the three
M365/Dynamics/Power BI export buttons) now shows a fourth action once a
single, identifiable batch is loaded: a button reading `File this batch to
"August 2026 Leads"` (`fileCurrentBatchToMonthFolder` in `unified-tool.js`).
One click sets that label as the tag on the batch's History entry — the
exact same tag field documented under "Phase 1 of the feature build-out"
above, not a second storage system. Once filed, the button is replaced with
a plain confirmation ("Filed as **August 2026 Leads** — redownload or pick
it back up anytime from History") so a manually-customized tag can't get
silently overwritten by clicking it again.

The stated reason this matters, in Jack's words: "massively for planning
ahead so when there's less hot leads we can go back and attempt old leads
or never contacted prospects and its all organized ready to be actioned
on." That's exactly the shape of the existing pieces working together —
History's redownload buttons and "View / edit" reload still work
unchanged on a filed batch, and the cross-out toggle (also documented
above) marks which leads in an old batch have already been worked, so
reopening "August 2026 Leads" months later shows at a glance what's still
open, not just what was originally there.

Only shown for a single traceable batch — a fresh upload or a reloaded
"View / edit" History entry, found by matching `state.results` back to its
originating History entry by reference (`getCurrentBatchHistoryEntry`).
Hidden in a combined multi-import view, since combining by definition spans
more than one original batch and there's no single entry to file it under.

**Refinement — pick the month, don't just take the upload date.** Jack's
follow-up: "I need to be able to select the month in year so I can properly
go back to October 2025 at the latest, every month til now." He's
backfilling leads that were actually received months before they get
scanned into the tool, so a batch uploaded today can't always be filed
under today's month. The button is now paired with a month/year dropdown
(`#batch-file-month-select`, built by `getMonthOptionsForFiling` in
`unified-tool.js`) covering a rolling 36 months back from today —
comfortably past October 2025 with room to spare, and it keeps rolling
forward automatically so it never needs a manual bump. It defaults to the
month the batch was actually scanned (the old behavior), so nothing changes
for a same-month upload — just pick an earlier month first when backfilling
an older list, then click "File this batch." The label and the History tag
it sets both use whichever month is selected, not the scan date.

**Refinement — it now actually moves the file, not just the label.** Jack
tried it and flagged the gap directly: "I need it to then populate and
create a folder based on that month and year and store it in the
library... not sure where its being stored after 'file this batch' is
clicked, but it needs to be in the library section." He was right — the
original version only renamed the History record; the source CSV itself
stayed wherever it auto-landed on upload (this month's Library folder,
per the section above), so a backfilled October 2025 batch would still
show up sitting in "August 2026" in the Library. Filing now does both:
every File-uploaded batch's History entry carries a `libraryEntryIds` link
back to its exact Library file(s) (set once, at upload time, in
`handleFiles`/`applyParsedFiles`), and `fileCurrentBatchToMonthFolder`
uses that link to actually reassign those files into a Library folder
matching the chosen month — creating the folder first if it doesn't exist
yet (`getOrCreateGroupByName`, the same lookup the automatic upload-time
assignment uses, so the two paths can never fork into two different
folders for one month). The "Filed as..." confirmation now says exactly
that ("...the source file moved into the Library's **October 2025**
folder...") and adds a "View in Library" button that jumps straight to
that folder, filtered, so Jack can see it landed where he expects. A
batch reloaded from before this link existed still files correctly (the
History tag still gets set), it just can't also relocate a Library file
it has no record of — the confirmation says so plainly rather than
silently doing nothing.

## Library folders as a folder-icon grid — friendlier browsing

Jack's next refinement, on the Library's folder picker itself: "a small
folder icon on each month with four being allowed in each row so its the
month and year in small text but sizeable under the folder so its easy
access and viewer ability... friendly ui." The old picker was a single
wrapped row of pill-shaped tabs ("All files (12)", "August 2026 (4)",
etc.) — functional, but not the visual "this is a filing cabinet of
folders" feel he was after. It's now a grid, capped at exactly 4 columns
(`grid-template-columns: repeat(4, minmax(0,1fr))`), one card per folder:
a folder icon on top, the folder's name in bold beneath it, and the file
count in smaller, muted text below that. "All files" and "Ungrouped" get
the same folder-card treatment as every named month/manual group, so the
whole picker reads as one consistent set of folders rather than two
different UI styles bolted together. Clicking a card still does exactly
what clicking the old pill did — same `data-library-group-filter`
attribute, same `.library-group-tab` class, same click handler — so this
was a pure visual change with the filtering logic untouched (confirmed in
`test-library-folder-grid.js`). The active folder is shown with a filled
dark card instead of a filled dark pill, same idea, bigger target.

## Filing at upload time — no separate click needed anymore

Jack's next ask went one step earlier in the flow than "File this batch":
"I want the uploaded csv files to be scanned and categorized like it
normally does but stored in the file marked with the specific month and
year" — then, clarifying further, "the three downloadable categories
should be properly stored with that given month's csv files uploaded
fully scanned." In other words: don't make filing a second step at all:
let him mark the month right when he uploads, scan/categorize exactly as
always, and land already properly stored.

The Scanner's empty upload screen now shows a small "These leads are
from: [Month Year]" picker directly above the dropzone, defaulting to the
current month (same 36-month range as the Final Downloads picker,
`getMonthOptionsForFiling`). Scanning and categorization are completely
unchanged — same detection pipeline, same three product lines — but the
moment a batch finishes scanning, it's already saved into that month's
Library folder AND its History entry is already tagged (`"<Month> <Year>
Leads"`), exactly as if "File this batch" had been clicked immediately.
The Final Downloads card reflects this: it shows the "Filed as..."
confirmation right away, with no button to click. The old manual
picker+button (documented above) is still there as a fallback — it only
resurfaces for a batch that genuinely isn't filed yet, which in practice
now means either an older History entry saved before this existed, or a
bulk "Load into Scanner" from the Library where the selected files span
more than one month (deliberately left unfiled rather than guessing which
month to use).

Two details worth knowing: picking an older month shows a small amber
"Backfilling an older month" note next to the picker so it's obvious
you're not on the current month, and the picker resets back to the
current month every time you click "Scan another batch" — so a backfill
pick for October's leads can't silently carry over and mis-file a normal
upload afterward. Re-running a file that's already sitting in a month
folder (via the Library's "Load" button) also keeps tagging it under that
same month automatically (`monthKeyForLibraryEntry` /
`monthKeyFromGroupName`), so re-attempting an old batch doesn't accidentally
knock it out of its folder. Covered end-to-end in
`test-upload-time-filing.js`.

## "Select entire archive" — step 1 of searching/exporting across everything

Jack's next ask, explicitly paced: "download a certain product line or
search a lead on demand... this entire project will take months, step by
step." Full detail and the planned next step are logged in
`wired-cio-crm-roadmap.md` under "The 'full archive, on demand' phase" —
this section covers just what shipped.

History's existing "Select all" only ever grabs the active week tab (or
the active search match) — right for tidying up one batch, wrong for "give
me every lead across every month." A second action, **Select entire
archive (N)** (`selectEntireHistoryArchive` in `unified-tool.js`), appears
next to it whenever the archive has more in it than the current week/search
view shows, and selects literally every History entry regardless of
week or filter. From there it's the exact same "Combine into Scanner" this
tool already had — no new search engine, no new export system. Once
combined, the Scanner's normal search bar finds a lead from any month, and
the normal Final Downloads buttons export a product line across the whole
combined set. Covered by `test-select-entire-archive.js`: two imports
seeded weeks apart, confirms the new button selects both regardless of the
active week tab, confirms the older one is findable via ordinary search
once combined, and confirms a category export includes it.

Deliberately not built yet: a true zero-click "always on" search across
the whole archive without a combine step first. Today's path (select
entire archive → combine → search) is three clicks, not one — an honest
tradeoff for reusing fully-tested infrastructure instead of standing up a
second, parallel search system before there's evidence it's actually
needed. Revisit if/when the archive gets large enough that this starts to
feel slow, per the roadmap note.

## Strong Signal only + opt-in save toggle — the Library's third major revision

Jack's biggest change to the Library yet, in two parts, delivered together:
"It should move the strong signal leads into the file... also should have
the ability to select if that is what I want to do or just upload a one
off file just to scan review and do as I please." Then a follow-up
refinement, once he saw the first cut: "I want to be able to go into each
monthly folder and then click into each strong signal category, given
there's three, there should be a total of 3 stored per month."

**What changed, part 1 — Strong Signal only, not the raw file.** Every
earlier version of the Library (see the superseded section above, and
"month folders" below it) stored the exact original uploaded CSV, byte for
byte. That's no longer what's saved. What lands in the Library now is the
Scanner's own Strong Signal rows — the same qualified, ready-to-action
leads the three Final Downloads buttons already export — written out in
that same normalized format (`buildExportRow`/`EXPORT_LABELS`: First Name,
Last Name, Title, Company Name, Email, Work Direct Phone, Mobile Phone,
Number of Employees, Product Area, Notes). Needs-review and Bad Lead rows
are never archived; only what's actually actionable is. Downloading a
Library file now gives back that normalized export, not a copy of
whatever the original CSV happened to look like — a deliberate tradeoff
(asked for directly by Jack) in exchange for an archive that's uniformly
clean and immediately usable, instead of a pile of differently-formatted
source files.

**What changed, part 2 — opt-in, off by default.** Saving to the Library
is no longer automatic. The Scanner's upload screen has a checkbox, "Save
this batch's Strong Signal leads to the Library," unchecked by default
(Jack's explicit choice, over defaulting it on to match the old behavior —
he wanted the safer option). The month/year picker next to it
(`#upload-month-select`, same `getMonthOptionsForFiling` 36-month range
used everywhere else in the tool) is grayed out and disabled until the box
is checked. Leave it unchecked and a batch is a pure one-off: scanned,
categorized, and downloadable exactly as always, but nothing gets written
to the Library and nothing gets auto-tagged in History. Check it before
uploading (or before clicking "File this batch" afterward) and the batch
files itself in, same as before. `reset()` — "Scan another batch" — always
puts the checkbox back to unchecked, so saving one batch never silently
carries over and archives the next one Jack didn't mean to keep. Covered
end-to-end in `test-save-to-library-toggle.js`.

**What changed, part 3 — three files per month, not one per upload.** The
biggest structural change: a month folder no longer holds one Library
entry per uploaded CSV. It holds **at most three** — one per downloadable
category (M365 Tenant, Dynamics 365, Power BI/Azure/Fabric) —
(`getOrCreateMonthCategoryEntry` in `unified-tool.js`). Filing a batch
splits its Strong Signal rows by category and merges each group into that
month's matching category file, creating it on first use. Filing a
*second* batch into a month that already has files **appends** onto the
existing three rather than creating duplicates — no dedup against what's
already there, the same "just concatenate" convention the rest of the
archive already uses (see "Select entire archive" above). Practically:
open August 2026's folder in the Library and there are exactly three
files to click into, each one a running list of every Strong Signal lead
ever filed into that category that month, no matter how many separate
uploads contributed to it.

Each stored row carries a hidden `__historyEntryId` tag — never part of
the exported CSV's columns, since `toCSV` only ever pulls the named
`EXPORT_LABELS` fields — recording which batch it came from. That's what
makes "move this batch to a different month" possible without duplicating
rows: `removeBatchSignalRows` finds and pulls out just one batch's own
rows from wherever they currently sit (deleting a category file entirely
if that empties it), before `fileSignalRowsIntoGroup` re-adds them under
the newly chosen month. This matters even after a batch has already
auto-filed itself: the Final Downloads card's "Filed as..." confirmation
now also shows a small "Filed under the wrong month? Move this batch"
control (`#refile-batch-month-select` / `#refile-batch-to-folder-btn`) so
a mis-filed batch (forgot to change the upload-time picker, or a backfill
that should've gone to October 2025 but landed in August 2026) can still
be corrected after the fact — not just before uploading. Covered end to
end, including the append behavior and the move-without-duplicating
behavior, in `test-3-per-month.js`.

**The "isFiled" gate.** The Final Downloads card now decides whether a
batch already has a real Library link by checking
`(batchEntry.libraryEntryIds || []).length > 0`, not just whether it has a
tag. That distinction matters because a batch reloaded from the Library
(`loadLibraryEntryIntoScanner`) inherits a month tag (so it reads as
"October 2025 Leads" rather than unfiled) without carrying a
`libraryEntryIds` link — a Library entry is now a shared, ongoing export
for a whole month/category, not one specific batch's own file, so there's
nothing meaningful for a fresh reload to "already be linked to." Known,
accepted tradeoff: clicking "File this batch" on a reloaded review would
re-append those same rows rather than being blocked as a no-op — consistent
with the archive's existing no-dedup convention, not something this reload
path guards against.

Every test in this suite that uploads a CSV and checks on Library state
now explicitly checks the save-to-Library checkbox first (it defaults
off) and looks entries up by `bucketKey` (`m365Tenant` | `dynamics` |
`dataPlatform`) rather than by original filename, since a CSV triggering
more than one category now produces more than one Library entry, and two
different CSVs triggering the same category land in the *same* entry.

## Full audit pass — two real bugs found and fixed, one gap closed

Jack asked for a full pass over every function/flow to check for bugs or
gaps after the Strong-Signal-only refactor above. Two things came out of
it, both fixed:

**Bug 1 — the "Move this batch" month picker had no default selection.**
The "Filed under the wrong month? Move this batch" control added in that
same refactor rendered its `<option>`s with no `selected` attribute at
all. Every test that exercised it happened to call
`page.selectOption(...)` before clicking, which masked the problem — but a
real user clicking "Move this batch" without first touching the dropdown
would have silently relocated the batch to whatever the browser defaults
an unselected `<select>` to: the FIRST `<option>`, which is the OLDEST
month in the 36-month range (three years back), not a harmless no-op.
Fixed by defaulting the picker to the month the batch is *already* filed
under (parsed back from its tag via `monthKeyFromGroupName`, falling back
to the scan-date month), so clicking the button without changing anything
is a safe no-op and an actual move requires deliberately picking a
different month.

**Bug 2 (the bigger one) — reassigning a lead or promoting/demoting its
tier after a batch had already auto-filed never touched the archived
copy.** The Scanner already lets Jack manually reassign a lead's category
(`reassignRow`) or promote a "Needs review" lead to Strong Signal /
demote one out of it (`toggleTier`) — both pre-existing, both still fully
live on `state.results`. But under the new auto-files-at-upload model,
filing to the Library happens immediately, synchronously, the moment a
batch finishes scanning — before Jack has looked at anything. Any
correction made afterward updated the Scanner view and the live download
buttons correctly, but the Library's already-saved category files kept
whatever categorization/tier existed at the *moment of filing*, with
nothing in the UI indicating the two had drifted apart. In practice: a
lead auto-detected as Dynamics 365 gets filed into that month's Dynamics
file; Jack notices it's actually a Power BI lead and reassigns it in the
Scanner; the Library's Dynamics file still has it, and the Power BI file
never gets it — silently, with the "Filed as..." confirmation still
showing as if everything were in sync. (Clicking "Move this batch" to the
*same* month happened to work around this — it always re-derives
`entry.results.filter(r => r.tier === "signal")` fresh — but nothing
prompted Jack to do that, so the drift would otherwise sit there
unnoticed indefinitely.)

## Fully editable folders — per-lead edit/delete/move inside a category file

The direct fix for that gap, and Jack's own follow-up ask once he saw the
audit findings: "under folders, I want to be able to edit and delete the
files at will, need to build this out fully so it is fully editable."
Every file-level action (rename, move between groups, set a received
date, download, delete the whole file) already existed; what was missing
was editing the individual leads *inside* a file without a Scanner
round-trip.

Each row in the Library table now has a small chevron button
(`data-library-expand-toggle`, `toggleLibraryEntryExpanded` in
`unified-tool.js`) that expands a nested, per-lead table directly beneath
it — every `EXPORT_LABELS` field (First Name, Last Name, Title, Company
Name, Email, Work Direct Phone, Mobile Phone, Number of Employees, Notes)
as a plain editable input, committing on blur/change the same way the
file-level rename and received-date fields already do
(`updateLibraryRowField`). Two more actions per lead:

- **Delete** (`deleteLibraryRow`) — removes just that one lead. If it was
  the last lead in the file, the file itself is removed too, same
  "empties out → gone" rule `removeBatchSignalRows` already used for
  batch-level moves — an empty archive file was never worth keeping as a
  placeholder.
- **Move to** (`moveLibraryRowToBucket`) — a small select offering the
  other two categories. Picking one pulls the lead out of its current
  file and appends it into the matching category file for the *same*
  month folder (creating that file if it doesn't exist yet — the same
  `getOrCreateMonthCategoryEntry` helper filing itself uses), updating its
  stored "Product Area" to match. This is the direct fix for Bug 2 above:
  a miscategorized or re-tiered lead can now be corrected (or removed)
  in the archive itself, by hand, instead of the Library silently staying
  stale.

Each lead carries a hidden `__rowKey` (stamped once at filing time,
`${historyEntryId}-${resultRowId}`) so it can be found and edited/deleted/
moved regardless of its current position in the array — array-index
addressing alone would drift the moment an earlier row in the same file
is removed or moved out. Rows saved before `__rowKey` existed fall back to
being addressed by array position (`findLibraryRowIndex`), safe in this
architecture since a render always completes synchronously before another
click can land. Capped at 400 visible rows per expanded file
(`LIBRARY_ROW_EDITOR_CAP`) purely as a DOM-size safeguard for an unusually
large shared file — Download still exports every row regardless of the
cap. Covered end to end, including the delete-empties-the-file rule and
the move-to-a-different-bucket behavior, in `test-library-row-editing.js`.

Deliberately out of scope for this pass: syncing a Scanner-side edit
*automatically* into an already-filed Library copy (i.e., making Bug 2
impossible rather than just fixable by hand). That would mean either
re-filing on every single Scanner edit (chatty, and re-derives the whole
batch's signal set on every keystroke) or a more surgical live-diff
between `state.results` and whatever's already archived — a bigger design
question worth its own decision, not a fix to make unilaterally inside a
bug-audit pass. Flagging it here so it doesn't get lost.

## Duplicate detection — flagged, scoped to the current import

Jack's report: "under folders... fix an error post scanning for
duplicates// dont allow the same exact name to duplicate a lead use rules
to cross check currently i am looking at an import in the app and theres
atleast four duplicates." A real import had the same lead appearing more
than once with nothing in the Scanner calling that out.

Three decisions, asked and confirmed before building this (all reversible
in a future pass, nothing here is a one-way door):

- **Match rule:** exact match on **full name + company**, not name alone —
  two different real people who happen to share a common name at different
  companies are never treated as the same lead. "Exact" means
  case/whitespace-insensitive only (`normalizeDupKey` in
  `unified-tool.js`), not fuzzy or typo-tolerant — deliberately strict for
  this first pass so the hit rate is easy to sanity-check against what
  Jack already knows is in a given import. A row missing either a name or
  a company is skipped from the check entirely (can't confidently call
  something a duplicate without both sides to compare).
- **Scope:** just the batch being scanned right now — every file in one
  upload, checked against each other. Not cross-checked against the
  Library or past History batches; that's a bigger, separate ask he didn't
  pick for this pass.
- **Action:** flag, never auto-remove. "Flag for now then we will decide, i
  want to see the accuracy" — every row after the first occurrence of a
  given name+company gets a `DUPLICATE` chip in the Detected column (and a
  faint highlight on the row itself), but nothing is deleted or excluded
  from tiers, categories, or downloads. A **Duplicates (N)** pill appears
  next to the tier tabs whenever a batch has any — click it to filter down
  to just the flagged rows and review them at a glance, click again to
  clear the filter.

Mechanically: `markDuplicateLeads()` runs once inside `scanParsedFiles()`,
right after every row in the batch has been mapped and scanned, so it sees
the whole import at once regardless of how many files were dropped in
together. Each row gets `isDuplicate`, `duplicateOfId` (points back at the
first occurrence's row id), and `duplicateGroupSize` (how many rows in
this batch share the same name+company, including the original) — the
last one is there so a 3-or-more-way duplicate group reads clearly instead
of just saying "yes/no."

Documented in the in-app Cheat Sheet alongside the rest of the detection
rules. Covered end to end — the exact-match hit, a same-name-different-
company non-match, a 3-way group, a row with a missing company being
skipped, the Duplicates pill's count and filter toggle, and confirming
nothing is auto-removed from Strong Signal — in
`test-duplicate-detection.js`.

If the accuracy holds up against real imports, the natural next steps
(not yet built, on purpose — Jack asked to see this pass first) would be:
widening the scope to check against the Library/History too, and/or
promoting from "flag" to an actual one-click "merge/remove extras" action
once he's comfortable it isn't over-flagging.
