# Wired CIO Lead Scanner — project brief for Claude Code

Read this before touching anything. It exists so you don't have to re-derive
product decisions from the legacy source, or re-ask Jack things he's already
decided.

## Who this is for

Jack is Sales Director at Wired CIO (Chicago-based IT company — Managed IT,
Cybersecurity, Cloud, IT Consulting, Backup/DR, Compliance, Co-Managed IT,
Vendor Management, custom solution development including Microsoft Dynamics/
CRM/ERP builds). He owns the entire revenue function personally — outbound,
lead management, sequencing, pipeline, closing. This tool is how he turns raw
lead exports (Apollo, CRM dumps, cold lists) into a triaged, categorized,
exportable pipeline fast. He thinks several steps ahead and wants a build
partner that matches that pace — not generic scaffolding, not hand-holding.
Push back with a better approach when you see one; don't just execute the
literal ask if there's a sharper way to do it.

## Access & ownership — read this part twice

**This tool is private to Jack. Keep it that way by default.**

- The GitHub repo this lives in is **private**, under Jack's account. It stays
  that way unless he explicitly says otherwise.
- **This is a personal, single-owner tool for now.** Every architectural
  decision below (local-only data, no shared backend) follows from that. Do
  not add multi-user support, a shared database, or team-wide access as a
  "nice to have" — that's a real, separate decision Jack hasn't made yet.
- **If this is ever deployed anywhere reachable over the network** (not just
  run locally), **it must sit behind a credential gate** — a real login, not
  security-through-obscurity of an unlisted URL. The legacy app already has a
  precedent for this: `legacy/web/build-web.js` produces a password-gated
  standalone HTML build (see that file for the current mechanism). Match or
  improve on that bar; never ship a publicly-reachable, ungated build of this
  tool. It contains real prospect/company data — treat that as sensitive by
  default even though it's not customer PII in the regulatory sense.
- **`app/`'s gate improves on the legacy mechanism by one real notch**:
  `app/src/lib/auth.ts` compares a salted SHA-256 hash, never the real
  password, in the page's own source — so reading the source doesn't hand
  someone the password outright the way legacy's plaintext `SITE_PASSWORD`
  does. It's still not real account security (no server, no rate limiting,
  no lockout) — same honest ceiling as before, just a higher floor. To
  change the password: `cd app && npm run hash-password -- "new password"`,
  paste the printed hash into `PASSWORD_HASH` in `auth.ts`, rebuild. The
  placeholder password is `changeme` — change it before this ever runs
  anywhere that matters.

## Repo layout

```
CLAUDE.md — this file
README.md — human-facing project README (points here + explains legacy/app split)
legacy/ — the CURRENT, WORKING app. Single-file vanilla JS. Fully featured,
          battle-tested, has a real Playwright regression suite. This is the
          reference implementation AND the acceptance bar for the rebuild —
          not something being thrown away, something to be matched.
app/    — fresh Vite + React + TypeScript scaffold. Nothing ported yet. This
          is where the rebuild happens.
```

### `legacy/` — what's in it

- `unified-tool.js` — the entire current app: detection engine, state,
  rendering (hand-rolled `render()` + `innerHTML` + event delegation — this is
  the exact pattern React is meant to replace), all Library/History/Groups/
  backup logic. ~5,500 lines. This is the spec, read it before assuming
  anything about a rule or a flow.
- `build-unified.js` — inlines `unified-tool.js` + `papaparse.min.js` into
  the shippable `wired-cio-unified-lead-scanner.html`.
- `extension/` — Chrome MV3 side-panel build of the same tool.
- `web/` — password-gated standalone build (see Access section above).
- `test-*.js` — Playwright regression tests, one process each (not a test
  runner framework — each file is a standalone script that launches
  chromium, exercises the app, and exits non-zero on failure). Run the whole
  suite from inside `legacy/`: `npm install && npm test`. Run one file with
  `xvfb-run -a node test-whatever.js` if there's no display server, plain
  `node test-whatever.js` otherwise.
- `generate-perf-fixtures.js` — regenerates the synthetic CSVs `test-perf.js`
  benchmarks against (not committed — see `.gitignore`). Run once before
  `test-perf.js` if its fixtures aren't present; `npm test`'s `pretest` hook
  does this automatically.

**Every one of these tests encodes a real product decision Jack made.** When
the rebuild's behavior disagrees with a legacy test, the test is right and
the rebuild is wrong — don't "fix" a test to match new behavior without
checking with Jack first.

### `app/` — what's in it

A bare Vite + React + TypeScript + ESLint scaffold. `npm install && npm run
dev` works today and shows a placeholder page — that's it. No app logic has
been ported. `npm run build` produces a single-page `dist/` (the Vite config
inlines all assets — `assetsInlineLimit` is set very high, `cssCodeSplit` is
off — so the output stays true to the legacy app's "one self-contained file"
philosophy, which is what makes an extension build and a password-gated
static build trivial to produce from the same output later).

## The rebuild — what "done" means

Not a redesign. Not a chance to quietly drop features. The rebuild's job is
to reproduce every behavior in `legacy/` — same detection rules, same tier
logic, same Library/History/Groups/backup semantics, same three build
outputs (standalone, extension, password-gated web) — in React + TypeScript,
with proper components and real types instead of one giant `render()`
function and untyped state. The legacy Playwright suite is the acceptance
bar: port each test's *intent* forward (pointed at the new app) as each
piece of functionality lands, don't wait until the end to write tests.

Suggested order (discuss with Jack before deviating far from this — it's a
sequencing opinion, not a hard requirement):

1. Core scan pipeline as pure, typed functions first (CSV parse → column
   mapping → detection → tiering) — no UI yet. This is the highest-value,
   lowest-risk slice to port because it's pure logic, directly testable
   without a browser, and everything else depends on it.
2. Results table + tier/category/duplicate filters (Scanner view).
3. Library (opt-in save, 3-files-per-month, per-lead edit/delete/move).
4. History (persistence, search, combine-into-scanner).
5. Groups, backup/restore, the Cheat Sheet.
6. Re-produce the three build outputs (standalone bundle, extension,
   password-gated web) from the new `app/` build.

Local-only persistence carries forward as-is: IndexedDB (or an equivalent
browser-local store) in the new app too, no server, no shared database. See
Access & ownership above for why.

## Detection engine — the actual rules (condensed from `legacy/unified-tool.js`)

Two independent engines run over every row and combine into one result:

**Licensing (Part 1):** looks for any of ~18 Microsoft SKUs (M365 Business
Basic/Standard/Premium, O365/M365 E1/E3/E5/E7, F1/F3, EMS, Power BI Pro/
Premium, M365 Copilot, Defender variants, Entra ID P1/P2, Teams Phone/
Calling, Intune, bare "E3"/"E5"). Strong Signal requires a confirmed seat/
user/license count at or above `QUALIFY_THRESHOLD` (15 — see `test-rules-
audit.js` for why it's 15, not the original higher number). A confirmed
count *under* threshold routes straight to Bad Leads, not silently dropped.

**Platform (Part 2):** three product-line buckets, each fed by independent
regex signals, all fully detailed and pattern-exact in `unified-tool.js`
lines ~104-137 (`PLATFORM_CATALOGUE`) and the Cheat Sheet in-app (`Read` the
`cheatSheetHtml()` function — it's the same information formatted for a
human, keep it in sync with any rule changes):

- **Dynamics 365** — its own bucket. Dynamics 365/D365/CRM/AX/NAV/GP,
  Business Central, Finance and Operations, Customer Engagement, Supply
  Chain Management, bare "ERP". Strong Signal if: ERP+CRM mentioned together,
  OR a specific product/module named with a real or estimated count, OR any
  generic trigger word present, OR a bare number sits next to the match.
- **Power BI / Azure / Fabric** — one shared bucket (`dataPlatform` key),
  fed by three independent patterns: Power BI (broadened — also catches
  generic "analytics dashboard," "business intelligence," "leverage our
  data," etc., not just literal "Power BI"), Microsoft Fabric (narrow —
  "Microsoft Fabric" or "OneLake" only), Azure (narrow — bare word "azure").
  Strong Signal needs a generic trigger word, a seat/license count, or —
  Azure only — scale language (VMs, usage, consumption, adoption). Growth/
  overload language ("stretched thin," "overwhelmed") does NOT count toward
  Azure's Strong Signal bonus — that phrasing only promotes Tenant Support.
  **Special override:** Azure-flavored migration language ("azure" near
  "migrat-," on-prem-to-cloud, lift-and-shift near azure) is redirected into
  this bucket instead of the generic Migration path below, even though the
  generic Migration pattern would also match.
- **M365 Tenant** — the combined/generic bucket: Tenant Support (Google→
  Microsoft migration, new tenant creation/provisioning, MSP/managed
  services/co-managed IT language, plain "IT support"/"help desk" language)
  plus generic Migration/Modernization (data migration, legacy system,
  re-platforming, lift-and-shift, on-prem-to-cloud — MINUS anything caught by
  the Azure override above) plus Licensing hits with no specific product
  angle. Strong Signal needs a trigger word, a count, or (Tenant Support only)
  growth/overload/understaffed language.

**Tie-break when a row matches more than one bucket:** every row is always
manually reassignable regardless, but the auto-default picks in this order:
Dynamics 365 → Power BI/Azure/Fabric → M365 Tenant (`CATEGORY_PRIORITY`).

**Auto-DQ ("Bad Leads"):** cross-cutting, applies on top of whatever
category/tier a row would otherwise get, always wins. Rules, in the order
Jack added them: single-seat/freelancer language, explicit rejection ("not
interested," "unsubscribe"), happy-with-current-provider/locked-in language,
personal/non-business use, a basic support/login issue (password reset,
locked out — this overrides even Tenant Support's own "help desk"/"support"
wording, since a one-off login problem isn't the same as wanting an ongoing
IT relationship), wanting Microsoft's own direct support rather than a
reseller/MSP. Plus two data-hygiene checks (missing company name, placeholder/
invalid email) and the sub-threshold licensing seat count. A Bad Lead is
still fully visible and reversible, just excluded from the three CSV
downloads.

**Duplicate detection (added most recently — see `test-duplicate-
detection.js`):** exact match on full name + company (case/whitespace-
insensitive, no fuzzy matching), scoped to just the current import/batch —
NOT checked against the Library or History. Rows are flagged (`isDuplicate`,
`duplicateGroupSize`), never auto-removed — Jack wants to see the real hit
rate before anything gets stricter or automatic. A row missing either a name
or a company is skipped from the check entirely. Don't widen the scope
(cross-batch/Library-wide) or change flag-vs-remove without asking — both are
explicitly-deferred next steps he already flagged himself, not oversights.

**Dynamics 365 ranking (app/ only, added during the rebuild):** Dynamics 365
leads are always ranked wherever they're shown or exported — the Scanner
table when filtered to Dynamics 365, the Scanner's Dynamics CSV export, and
the Library's Dynamics 365 category file (display, per-lead editor,
download, and its slice of the combined "All Strong Signal Leads" file) —
by a two-key sort: **module type first, seat count second.** Every Dynamics
hit is tagged with a module tier — 0 for Business Central/ERP/Finance and
Operations/Supply Chain Management/AX/NAV/GP/bare "ERP", 1 for Dynamics 365
Sales/Dynamics CRM/Customer Engagement/Insights/Service/Marketing/Field
Service/Project Operations/Human Resources/bare "CRM", 2 for everything else
— and a row's overall tier is the most specific (lowest-numbered) tier among
its hits. Rows sort by that tier ascending first (ERP/BC leads always above
Sales/CRM leads, which are always above the rest, regardless of count), then
by stated seat/user/license count descending *within* each tier block. The
count is extracted from the matched text itself
(`app/src/lib/detection.ts`, `sortByDynamicsSeatCount` /
`PlatformResult.dynamicsSeatCount` / `dynamicsModuleTier`) — same
seat/user/license number-extraction the licensing engine already used,
applied to Dynamics hits too. A lead with no stated count is never treated
as a count of 0: within its module-tier block it sinks below every counted
lead in that same block, in whatever order it was already in — not
interleaved by guesswork. Scoped to Dynamics 365 only, by explicit choice;
M365/Azure (below) keeps its existing order until asked. This is an
app/-only enhancement — legacy/unified-tool.js does not have it.

The seat-count secondary key's direction is user-togglable (Scanner, next
to the category filter buttons, visible only when the Dynamics 365 filter
is active) — "greatest to least" (default) or "least to greatest." The
module-tier grouping never flips with it; only which end of the count
range comes first *within* each tier block changes, and an uncounted lead
still always sinks to the bottom of its own block either way
(`sortByDynamicsSeatCount`'s `desc` param).

### App/-only detection tightening (fine-tuning pass)

The rules below are deliberate, Jack-directed departures from the
legacy/-described model above, made as the business gets more specialized.
They apply to `app/` only — `legacy/unified-tool.js` is untouched and still
runs the original 3-category model exactly as described above.

**Category merge — two live categories, not three.** Power BI / Azure /
Fabric no longer has its own bucket. Its rule *logic* still lives in the
code under the internal key `dataPlatform` (kept only for backward
compatibility with already-filed Library entries and already-recorded
History entries tagged with that key — see below), but every new scan now
routes those hits straight into the `m365Tenant` bucket, relabeled
**"M365 / Azure"**. Going forward there are exactly two categories Jack
tackles: **Dynamics 365** and **M365 / Azure** (Azure, migrations, Google→
Microsoft, tenant support, licensing, Azure billing, CSP/MSP/partner
engagement, ongoing support, security-hardening). `CATEGORY_PRIORITY` is now
just `["dynamics365", "m365Tenant"]`. New-facing UI (category filters, bulk
move, Final Downloads, Cheat Sheet) iterates `ACTIVE_CATEGORY_KEYS`/
`ACTIVE_BUCKET_KEYS` (`app/src/lib/detection.ts`) rather than the full type,
so it only ever presents the two live categories — while the full 3-value
`CategoryKey`/`BucketKey` type and `CATEGORY_META`/`BUCKET_META` (with a
"(legacy)"-suffixed label on the old `dataPlatform` entry) stay intact
purely so anything already sitting in the Library or History under the old
`dataPlatform` value keeps rendering and downloading correctly instead of
disappearing or crashing. Don't remove that legacy scaffolding without
confirming no persisted data still references it.

**Power BI / Azure / Fabric / Migration tightened qualification** — a bare
product or generic-migration mention no longer counts as a hit at all:
- **Power BI** only counts when there's language about actually bringing in
  a partner, vendor, consultant, reseller, MSP, or CSP for it — wanting
  better dashboards/reporting alone no longer qualifies.
- **Azure** counts for: an on-prem-to-cloud migration, Azure billing/cost
  language, looking for a partner/CSP to route that billing through, Azure
  Document Intelligence, or a full custom-app build on Azure. The old
  generic "VMs/usage/consumption/adoption" scale-language qualifier was
  removed entirely — it no longer promotes to Strong Signal *or* creates a
  category match on its own. Document Intelligence and full app builds are
  a hot signal right now per Jack — `DOCUMENT_INTELLIGENCE_RE`/
  `APP_BUILD_RE` in `app/src/lib/detection.ts`, shared with Fabric's gate
  below.
- **Microsoft Fabric** ("Microsoft Fabric" or "OneLake" only) also no
  longer qualifies on a bare mention — it only counts when it ties into a
  larger project: an Azure tie-in, custom app/solution development, or
  (Azure) Document Intelligence specifically (`FABRIC_PROJECT_RE` in
  `app/src/lib/detection.ts`).
- **Migration / Modernization** (generic — "legacy system," "re-platforming,"
  "lift and shift," "modernizing") now needs the same partner/vendor/
  consultant/MSP/CSP language as Power BI to count at all — a bare mention
  of legacy/modernization language, even with a trigger word like "budget"
  or "this year" nearby, no longer qualifies on its own.
- Google→Microsoft migration language is also a hot signal right now —
  already auto-promotes M365/Azure to Strong Signal on its own (see the
  M365 Tenant Strong Signal boost above); no change needed, called out
  here so it isn't mistaken for something still to build.
- Any hit that clears one of these gates is automatically Strong Signal —
  surviving the gate already proves real intent, so there's no separate
  "trigger word" requirement layered on top the way Dynamics/Tenant still
  have.

**M365 Tenant Strong Signal boost.** On top of the existing licensing-count
path (a confirmed seat/user/license count at or above the qualify threshold
already promotes to Strong Signal — e.g. "Service-Microsoft 365 Business
Standard-50 users"), Strong Signal now also auto-promotes on: Google→
Microsoft migration language, MSP/CSP/partner-being-brought-in language
(now also including plain "partner engagement"/"full engagement" phrasing,
not just verbs like "bring in a partner" — `ONGOING_PARTNER_SRC` in
`app/src/lib/detection.ts`), or security design/architecture/hardening
language (`SECURITY_DESIGN_RE`) — this last one also creates the Tenant
Support category match on its own, same footing as "IT support"/"help
desk". A bare "IT support"/"help desk" mention on its own still only counts
toward the category match, not this promotion — that distinction was
intentional, not loosened.

**Small-project / free-consultancy Auto-DQ.** Per Jack: the business wants
longer-term partner engagements, not one-off jobs or free advice. A new
cross-cutting Auto-DQ rule ("Small one-off project / free consultancy
request" in `DQ_RULES`) catches "one-off/small/quick project," "free
consultation," "pick your brain," "just want some advice," "quick
question," "no budget," and "not looking to hire/engage/pay" — same
cross-cutting semantics as every other Auto-DQ rule: it overrides whatever
category/tier the row would otherwise get (even an otherwise-qualifying
Strong Signal), and the lead stays visible/reversible, just excluded from
the three CSV downloads.

**Email/phone redaction.** The auto-generated "Matched snippet" (Scanner)
and exported "Notes" column (CSV) never include an email address or phone
number, even if the sentence they were extracted from contains one — those
already have their own dedicated Email/Phone export columns, so repeating
them in the free-text summary was pure duplication. Any candidate sentence
containing an email or phone pattern is dropped from the summary the same
way a sentence with a date/BANT/serial-number pattern already was
(`hasForbiddenContent()` in `app/src/lib/detection.ts`).

**High Priority Leads panel (app/ only, Scanner landing screen).** The
Scanner's empty/upload screen has a small panel at the bottom, below
"Recent uploads," listing every lead marked High Priority (⭐) across *all*
of History — not just the 6-most-recent uploads shown above it — since a
priority tag can be set long after its own batch scrolled out of "recent."
Each row shows company/contact, the exact source CSV file it came from
(`ResultRow.sourceFile`, not the History entry's combined `fileName`, so a
multi-file upload still attributes correctly), and lets you edit the
month/year tag or unmark it right there, without reopening that upload. A
filter dropdown narrows the list to one source file when more than one is
represented. Editing writes straight through to the History entry the row
came from (`onSyncToHistory`, reusing the same `__sourceEntryId`/
`__sourceRowId` plumbing every row already carries from the moment it's
first scanned) — no separate storage, no new persistence path.

**Bug fixed while building the panel:** `Scanner.tsx`'s `mutateResults`
(added last session to make `onSyncToHistory` StrictMode-safe) read a
setState functional updater's result via a `let touched` variable captured
from *outside* the updater, assuming the updater always runs synchronously
before that line executes. Confirmed via direct instrumentation that this
assumption is false in React 18 for at least one real case (a second edit
fired shortly after a first one to the same state) — the outer read ran
before the updater's own internal logic did, so `touched` was still empty
and the History sync silently never happened. This wasn't limited to the
new panel: it affected every Scanner-side edit (tier toggle, category
reassignment, disposition, cross-out, priority) whenever one fired as an
isolated `mutateResults` call shortly after another. Fixed by having
`mutateResults` read the `results` prop directly (always current when an
event handler runs) instead of depending on the updater's timing at all.

**Duplicates excluded from downloads and Library filing (app/ only).** A
duplicate (per the batch-scoped exact name+company match above) is still
fully visible and flagged in the Scanner table — nothing about the
detection/flagging itself changed — but per Jack: "it shouldn't appear
twice in the strong signal... flagged and pulled so it doesn't get
downloaded like that." So the *first-seen* row of a duplicate group still
downloads/files normally; every repeat (`isDuplicate: true`) is excluded
from the Scanner's Final Downloads CSVs, History's per-entry redownload
(both go through `exportRowsForBucket` in `app/src/lib/detection.ts`), and
Library filing (`signalRows` in `Scanner.tsx`'s upload handler) — same
"visible but not exported" treatment a Bad Lead already gets. Still scoped
to the current batch, same as the underlying duplicate check itself —
this doesn't touch the deferred cross-batch/Library-wide widening.

## Library architecture (the trickiest part to port correctly)

- Saving to the Library is **opt-in per upload** (a checkbox, default OFF) —
  not automatic. Jack's own words: "the ability to select if that is what i
  want to do or just upload a one-off file just to scan review and do as i
  please."
- Only **Strong Signal** rows ever get filed — Needs Review and Bad Leads
  are never archived.
- Files are organized **up to 3 per month** — one combined "All Strong
  Signal Leads" file plus one file per active category (Dynamics 365, M365
  / Azure — see the category-merge note under Detection engine above),
  appended to across multiple uploads in the same month rather than
  creating a new file per upload. A custom (non-month) folder holds the
  same up-to-3 file shape and can also be uploaded into directly.
- A custom folder is tracked as such via an explicit `isAutoMonthFolder:
  false` flag (`app/src/lib/library.ts`), not guessed from whether its name
  parses as a month — so a custom folder someone names like a month (e.g.
  "March 2025") is never misclassified as one of the auto-managed month
  folders. Deleting a folder (month or custom) only ungroups its files
  (`groupId: null`) — never deletes them — and the Library view has an
  "Ungrouped files" section so those files stay reachable (load/download/
  delete) afterward instead of orphaned.
- Every individual lead inside a filed category file is editable, deletable,
  and movable to a different category (within the same month) in place —
  this is the fix for Scanner-side reassignments/tier promotions otherwise
  going stale in an already-filed archive copy. Automatic sync of a Scanner
  edit into an already-filed Library row was **deliberately left out** — it's
  a bigger design question (re-file on every keystroke? live diffing?) that
  needs its own decision from Jack, not something to build unilaterally.
- Persistence is IndexedDB, and it needs to survive a full page reload —
  that's the entire point of a "Library," and it's directly tested.

## Roadmap — long-term direction, not a build queue

Jack's own words, captured so they don't get re-derived or lost: this tool
is meant to slowly grow into a lighter-weight, self-hosted alternative to
Apollo, scoped strictly to Jack's own sequenced outbound work (calling,
emailing, outreach) — not a general sales platform. Nothing below is
scheduled or approved for building yet; treat it as direction, not a task
list. Build toward it opportunistically (e.g. lean field/data-model choices
that don't foreclose these paths), but don't start any of it without Jack
explicitly asking, since each item is a real architecture and access-model
decision in its own right (several would also require a real backend and
break the "local-only, no shared backend" constraint in Access & ownership
above — that tradeoff needs Jack's explicit sign-off when the time comes).

- Pull Apollo.io company/contact data into the app directly (API tie-in),
  instead of only ever importing a CSV export of it.
- Detect Teams meetings booked and auto-label/cross out the matching lead as
  "intro booked" — ties into the disposition/status tracking Jack's asked
  for (meeting booked / not interested / no contact yet / other, with a free
  -text note).
- A power dialer, eventually a 2x parallel dialer, hooked up to VOIP or
  Teams phone numbers.
- Sequenced outbound task management — calling/emailing/outreach cadences
  per lead, Apollo-style.
- User accounts/login policies as a real precursor to any of the above
  (today's single shared password gate, per Access & ownership, isn't that).
- SendGrid tie-in for sending + monitoring outbound email, and a view of
  emails actually sent per lead.
- Filtering/segmenting companies by size, industry, etc. — richer company-
  level data than what a lead CSV export alone carries today.

## Working style

- Don't ask permission for routine implementation choices; do ask before any
  decision that's actually a product decision in disguise (changing what
  counts as a duplicate, widening data sharing, adding a network dependency,
  changing what "Strong Signal" means, anything touching Access & ownership
  above).
- Tight, scannable answers. Jack reads fast and wants the bottom line first.
- When you finish a slice of the rebuild, run the relevant legacy Playwright
  tests (pointed at whichever build is currently under test) before calling
  it done — "it compiles" is not the bar, "it matches the legacy behavior"
  is.
