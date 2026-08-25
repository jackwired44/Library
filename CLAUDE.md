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

**Bug fixed: generic trigger words and bare numbers were still promoting
Tenant Support to Strong Signal, undermining the whole tightening pass
above.** Jack caught it with real examples that got wrongly marked Strong
Signal: "Support Ticket ID: 4521" and "We need support on upgrade from our
current version which is 15." Two separate root causes, both in
`scanRowPlatform` (`app/src/lib/detection.ts`):
- `hasBareTrailingCount`/`hasBareLeadingCount` (the "a bare number sits
  next to the match" rule) was being checked for *every* category, when
  it was only ever meant to be Dynamics-365-specific (see the original
  rule above) — so a support ticket number or a software version number
  sitting near a generic "support" mention got misread as a seat count.
  Now scoped to `cat.label === "Dynamics 365"` only.
- `TRIGGER_WORDS_RE` ("upgrade," "budget," "this year," etc.) was also
  checked for every category. It's an original, intentional Dynamics 365
  rule ("any generic trigger word present" promotes Dynamics on its own)
  but was never meant to apply to Tenant Support once Tenant Support got
  its own tightened boost list this session — "we need support on
  upgrade..." isn't real M365/Azure buying intent just because it contains
  the word "upgrade." Now excluded for `cat.label === TENANT_SUPPORT_LABEL`
  specifically; Dynamics 365 keeps it.
- `LICENSE_COUNT_RE` (an actual "N users/seats/licenses" phrase) stays
  global on purpose — a real stated seat count near support language is
  still a genuine signal, unlike a bare unitless number.

**Existing-CRM-opportunity Auto-DQ.** Per Jack, with a real example: "Nicole
Vargas is the owner of this opportunity and Partner: SIS LLC. Particular
interest was shown in leveraging Purview to support SOC 2 preparation and
improve overall security posture. Continued executive engagement and
successful ETC outcomes will be key to advancing the sales cycle." This is
internal CRM/Dynamics 365 Opportunity-record notes describing a deal
someone else is *already* tracking — third-person pipeline-management
language ("owner of this opportunity," "Partner: [name]," "executive
engagement," "advancing the sales cycle"), not a fresh lead's own expressed
interest — and it was wrongly promoting to Strong Signal off the security-
posture language inside it. A new cross-cutting Auto-DQ rule ("Existing CRM
opportunity notes, not a fresh lead" in `DQ_RULES`) now excludes it
regardless of what platform/licensing language happens to be nearby, same
semantics as every other Auto-DQ rule. Scoped narrowly to these specific
CRM-notes phrasings — the same security-posture language on its own (no
CRM-opportunity metadata alongside it) still correctly promotes to Strong
Signal, since that hot-signal boost from earlier this session is unchanged.

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

**Duplicates are removed outright, not just flagged (app/ only — a
deliberate escalation past the point above).** First pass only excluded a
duplicate from downloads/filing while still showing it in the Scanner
table. Per Jack's explicit follow-up — "i dont want it to be possible to
dupe" — that wasn't enough: `scanParsedFiles` (`app/src/lib/detection.ts`)
now runs `markDuplicateLeads` and then drops every repeat
(`isDuplicate: true`) from the returned `results` array itself, before
anything reaches the Scanner table, History, or the Library. The
*first-seen* row of a duplicate group is the only one that survives — same
exact name+company match key, still scoped to the current upload/batch
only (this doesn't touch the deferred cross-batch/Library-wide widening).
`scanParsedFiles` returns a new `duplicatesRemoved` count so the removal
isn't silent — Scanner shows "Removed N duplicate lead(s)..." next to the
upload, and Library's per-folder direct-upload flow appends the same count
to its "Filed..." notice. The `isDuplicate`/`duplicateOfId`/
`duplicateGroupSize` fields, the Scanner's "Duplicates" filter button, and
the DUPLICATE badge are all left in place (harmless — they just never
trigger for a fresh scan now) purely so any row already sitting in History
or the Library from before this change, still flagged from the old
"visible but excluded" behavior, keeps rendering correctly.

**Google → Microsoft view (app/ only, Scanner).** Per Jack: Google→
Microsoft migration leads should always be viewable as their own group,
but the two download categories (Dynamics 365, M365 / Azure) stay exactly
as they are — this is a view-level split within M365/Azure, not a third
category or a third download file. Every `ResultRow` carries a new
`isGoogleToMicrosoft` flag (`app/src/lib/detection.ts`, set on the
Tenant Support platform hit when `GOOGLE_TO_MICROSOFT_RE` matches, plumbed
through `PlatformResult`/`ScanResult`/`ResultRow` the same way
`dynamicsSeatCount` is). When the M365 / Azure category filter is active,
Scanner shows a "View:" row of three tabs — "All M365/Azure," "Google →
Microsoft," "Everything else" — that only filters what's shown in the
table; it never touches `category`/`bucket`, so the Final Downloads CSV,
Library filing, and History all still file every M365/Azure lead into
exactly the same single bucket regardless of which tab is active.

**Google → Microsoft tab widened to "migrations" generally.** Per Jack:
the tab should also pick up any other migration-flavored lead that's
already qualifying as Strong Signal within M365/Azure, not just literal
Google Workspace → Microsoft 365 migrations. `isGoogleToMicrosoft` now
also goes true for any `Migration / Modernization`-category hit (these
already require partner-engagement language to exist as a hit at all, so
any hit there is already Strong Signal) and for Azure hits specifically
qualified via `AZURE_MIGRATION_OVERRIDE_RE` (on-prem-to-cloud migration
language) — but *not* Azure hits that qualified via billing/CSP language
instead, and *not* security-design hits, both of which stay in "Everything
else." The tab label itself is unchanged ("Google → Microsoft") since
Jack referred to it by that name when asking for the widening; flag if a
more general label ("Migrations") is wanted instead.

**Business Central view (app/ only, Scanner) — same pattern, Dynamics
365 side.** Per Jack, built the same exact way as the Google→Microsoft
view above: Business Central/ERP leads should always be viewable as their
own group, but Dynamics 365 stays exactly one category and one download
file. `ResultRow.isBusinessCentral` (`app/src/lib/detection.ts`) is set on
a Dynamics 365 hit when `BUSINESS_CENTRAL_RE` matches — exactly three
keywords per Jack ("Business Central," "ERP," "erp," the last two just
case variants already covered by the regex's `/i` flag). Deliberately
narrower than `DYNAMICS_ERP_RE`, which also covers Finance and Operations/
Supply Chain Management/AX/NAV/GP for the module-tier ranking — a lead
that only says "Finance and Operations" with no "Business Central" or
bare "ERP" wording stays in "Everything else" even though it shares the
same tier-0 ranking block. Plumbed through `PlatformResult`/`ScanResult`/
`ResultRow` the same way `isGoogleToMicrosoft` is. When the Dynamics 365
category filter is active, Scanner shows the same "View:" row of three
tabs — "All Dynamics 365," "Business Central / ERP," "Everything else" —
purely a view-level filter; Final Downloads, Library filing, and History
all still file every Dynamics 365 lead into the same single bucket
regardless of which tab is active. Per Jack, this is one of a growing set
of these keyword-triggered sub-filters, meant to make filed leads easier
to slice once stored — expect more of these as specific keywords come up.

**Both View-tab sub-filters now also live in the Library, not just the
Scanner.** Per Jack: "we are slowly building out the filters for the
leads so when they become stored it is easy to filter through" — the
whole point of these sub-filters is to still be usable once a lead is
filed, not just during the original scan. `StoredRow` (`app/src/lib/
library.ts`) now carries `__isGoogleToMicrosoft`/`__isBusinessCentral`,
copied straight from the `ResultRow` at filing time (`fileSignalRowsIntoGroup`)
— both optional, so a `StoredRow` filed before this existed just reads as
`false` everywhere it's checked, no migration needed. Each category
file's card in `Library.tsx` (`CategoryFileCard`) now shows the same
"View:" tab row inside its expanded editor — Business Central/ERP vs
Everything else on a Dynamics 365 file, Google→Microsoft vs Everything
else on an M365/Azure file — filtering only what's shown/edited there;
download and the combined "All Strong Signal Leads" export are
unaffected. Each category file card tracks its own sub-view
independently (a `useState` local to `CategoryFileCard`), so having both
a Dynamics and an M365/Azure file open at once with different tabs
selected works fine.

**Sales / CRM view (app/ only) — third Dynamics 365 tab, same pattern
again.** Per Jack: "add a section for Dynamics 'Sales' or 'CRM' or 'crm'
// just like we did with the business central filter." `SALES_CRM_RE =
/\b(sales|crm)\b/i` (`app/src/lib/detection.ts`) — exactly three keywords
per Jack ("Sales," "CRM," "crm," the last two case variants already
covered by `/i`), scoped to `cat.label === "Dynamics 365"` the same way
`BUSINESS_CENTRAL_RE` is. Deliberately narrower than `DYNAMICS_CRM_RE`
(which also covers Customer Engagement/Insights/Contact Center/Field
Service/Marketing/Project Operations/Human Resources for the module-tier
ranking) — a lead that only says "Customer Engagement" with no bare
"Sales" or "CRM" wording stays in "Everything else" even though it
shares the same tier-1 ranking block. `isSalesCrm` is plumbed through
`PlatformHit`/`PlatformResult`/`ScanResult`/`ResultRow` (and
`StoredRow.__isSalesCrm` in `library.ts`) the same way `isBusinessCentral`
is. The Dynamics 365 "View:" row is four tabs — "All Dynamics 365,"
"Business Central / ERP," "Sales / CRM," "Everything else" — in both the
Scanner (`dynamicsSubView`, `Scanner.tsx`) and the Library's
`CategoryFileCard` (`Library.tsx`, whose `subView` state grew a
`"special2"` option alongside `"special"` — M365/Azure files still only
ever render `"special"` (Google→Microsoft), since that category has just
the one keyword tab so far). Still purely a view-level filter: Final
Downloads, Library filing, and History all still file every Dynamics 365
lead into the same single bucket regardless of which tab is active.

**Bug fixed: Business Central/ERP and Sales/CRM tabs originally weren't
mutually exclusive.** A lead whose text hit both keyword sets (e.g.
"Business Central for finance, and also want to grow our CRM side" — or
two separate hits, one BC-flavored and one Sales/CRM-flavored, from
different sentences in the same row) showed under BOTH tabs. Per Jack —
"some business central [leads] went to sales/crm," with an explicit ask
to cross-check and DQ each from entering the other's view — the two tabs
are now strictly mutually exclusive at the row level, with Business
Central/ERP taking priority (same precedence as the module-tier ranking,
where tier 0/ERP already ranks above tier 1/Sales-CRM): in
`scanRowPlatform`'s aggregation (`app/src/lib/detection.ts`),
`isSalesCrm` is now `!isBusinessCentral && hits.some((h) => h.isSalesCrm)`
— if any hit on the row is Business Central/ERP-flavored, the row is
Business Central/ERP only and never also shows in Sales/CRM, regardless
of what else the text mentions. "Everything else" is unaffected — it was
already defined as neither flag set.

**Locked invariant, per Jack's explicit reconfirmation: these View-tab
sets don't change.** Dynamics 365 is always exactly four tabs — All
Dynamics 365, Business Central / ERP, Sales / CRM, Everything else. M365 /
Azure is always exactly three — All M365/Azure, Google → Microsoft,
Everything else. True in both places they render (Scanner's
`dynamicsSubView`/`m365SubView`, and the Lead Library's `CategoryFileCard`
`subView`). Don't add, remove, rename, or reorder a tab in either set
without Jack explicitly asking — this isn't a "start somewhere then fine
tune" area the way the visual density passes are.

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

## Shell — landing page + sidebar nav (app/ only)

Per Jack: "need to start somewhere then fine tune" — a first-pass app shell
to make this read as a structured platform rather than a single tool, not a
redesign of any module. Nothing about Scanner/Library/History/Board/Cheat
Sheet's own behavior changed — only how you get to them.

- **Home** (`app/src/components/Home.tsx`) is a new, non-module landing
  view — the default view on load (`App.tsx`'s `view` state starts at
  `"home"` instead of `"scanner"`). It has a welcome banner stating the
  product thesis Jack gave verbatim: the Library is the single source of
  truth for every qualified lead, and this is the first step toward a
  lighter-weight, self-hosted CRM built solely for outbound sales (calling/
  emailing/sequencing), not a general sales platform — see the Roadmap
  section below, this is that same framing surfaced in-app. Below the
  banner, a card grid lists every module (Scanner, Library, History, Board,
  Cheat Sheet) with a one-line description and live counts (Library file
  count, History upload count, open task count) pulled from the same state
  `App.tsx` already holds — Home doesn't read its own IndexedDB or introduce
  a new data path. Clicking a card calls `onNavigate`/`onOpenCheatSheet`,
  the same handlers the sidebar nav uses.
- **Sidebar navigation** replaces the old horizontal nav-button row in the
  header. `App.tsx` now renders a `flex` row below the header: a `<aside>`
  (`.side-nav-btn` in `styles.css`) with Home/Scanner/Library/History/Board,
  `position: sticky` with its own `overflow-y: auto` and a `max-height`
  capped to the viewport — so it stays in view while the main content
  scrolls, and scrolls internally on its own if the nav list ever grows
  past the viewport (per Jack's explicit ask for a "scroll option"), rather
  than pushing the page down. The Lock button stays in the top header (not
  moved into the sidebar). The floating Cheat Sheet button/modal are
  unchanged in behavior, just moved after `</main>` in the JSX so they sit
  outside the two-column layout (harmless — they're `position: fixed`
  either way).
- This is explicitly a v1 pass, not a finished design — expect follow-up
  fine-tuning (visual polish, maybe collapsing the sidebar on narrow
  widths, maybe more on the Home page) rather than treating this shape as
  final.

## Contacts (app/ only)

A permanent, cross-upload directory of every person seen in any CSV upload
— its own nav item (between Library and History), described in-app as an
extension of the Library ("an additional function of the library," per
Jack), but broader in scope: it captures every row of every upload, not
just Strong Signal leads. Two product decisions here were confirmed with
Jack before building (cross-checked per his explicit ask, not guessed):

- **Capture scope: every row, every upload — not just detection hits.**
  `lib/contacts.ts`'s `mergeContactsFromParsedFiles` is deliberately built
  from the raw `ParsedFile[]` the Scanner/Library upload handlers already
  have, NOT from the `ResultRow[]` `scanParsedFiles` returns — that array
  has already dropped every row with zero Dynamics/M365/licensing signal
  (`scanRowUnified`'s early returns), which would've silently excluded
  plenty of real contacts. `computeFileFieldMapping`/`resolveRowFields`
  were factored out of `scanParsedFiles` in `lib/detection.ts` specifically
  so Contacts could resolve every row's fields (name/company/email/phone/
  title) without running detection over rows that will never match
  anything. Hooked into `App.tsx`'s `recordHistory` — the single existing
  choke point every fresh CSV upload already passes through (Scanner's
  direct upload, Library's upload-into-folder, and a Library "Load into
  Scanner" reload all funnel here) — via a new `mergeContacts(parsedFiles)`
  call.
- **Dedup key: email first, name+company fallback — checked as two
  independent lookups, not one fixed key per contact.** A row's email
  (case/whitespace-normalized) is checked first; if absent, the same
  normalized exact-match name+company key the Scanner's own batch-scoped
  duplicate check uses. Critically, `mergeContactsFromParsedFiles` derives
  BOTH keys fresh from each existing Contact's CURRENT fields on every
  merge run (`emailKeyOf`/`nameCompanyKeyOf`, never a field frozen at
  creation) and tries both — a contact first seen with no email (matched
  only by name+company) still gets found and merged, not duplicated, once
  a later upload supplies their email. Merging is additive: a later,
  sparser upload never blanks a field a prior upload already filled in
  (`fillBlank`), and `sourceFiles`/`timesSeen`/`lastSeenAt` accumulate
  across every upload a contact appears in.
- **Contacts.tsx's own fields are read-only** — search (name/company/title/
  email/phone) and a sort dropdown (most recent/name/company/times seen),
  no per-contact field editing here. Editing a contact's own data still
  lives on the lead itself in Scanner/Library, deliberately, to avoid a
  second edit surface for the same person's data. A contact CAN be turned
  into a dated, prioritized follow-up task, though — see "Contact tasks"
  below; that's additive scheduling, not editing the contact's fields.
- Persistence is its own IndexedDB store (`STORE_CONTACTS`, `lib/db.ts`,
  `DB_VERSION` bumped 4→5) — same one-store-per-concern pattern as Library/
  History/Tasks, not folded into an existing store.

### Contact tasks (app/ only)

Per Jack: "add in a tasks section so contacts can be added as tasks for
given dates and priorities so sales reps know which contacts are the most
important." Reuses the existing Board task store rather than building a
parallel one — `lib/tasks.ts`'s `Task` gained two optional fields,
`contactId`/`priority` (`"high" | "medium" | "low"`, a new, separate concept
from the boolean lead-priority ⭐ elsewhere in the app), set only on a task
created from the Contacts page via the new `createContactTask`. Both are
optional so every ordinary Board task (created via the original
`createTask`, neither field set) is completely unaffected — per Jack's
explicit "change no functions" ask, **Board's own component was not
touched at all**. That's possible because a contact task's `text` has the
contact's name/company baked in at creation time (`"Follow up with {name}
({company}) — {note}"`), so it reads fine on the Board exactly like any
other task without Board needing to know contacts exist.
- Contacts.tsx: a "+ Task" button per contact row opens an inline form
  (date, priority, optional note) that calls `onAddContactTask`. A "Tasks"
  panel above the contacts table lists every task with a `contactId`
  matching a currently-loaded contact, sorted by priority (High first) then
  date — the "which contacts matter most, at a glance" view Jack asked for.
  Done/delete on a contact task go through the same `onToggleTask`/
  `onDeleteTask` App.tsx already had for the Board.
- `App.tsx`'s new `addContactTask(contactId, date, priority, text)` mirrors
  the existing `addTask`, just building the task via `createContactTask`.

**Bug found and fixed while wiring this up (predates this feature).**
`fileSignalRowsIntoGroup`'s `historyEntryId` argument — meant to stamp each
filed `StoredRow.__historyEntryId` with the History entry it came from, so
Library files can be traced back — was being passed a throwaway
`` `${Date.now()}` `` in both Scanner.tsx's direct-upload flow and
Library.tsx's upload-into-folder flow, never the real `HistoryEntry.id`.
That made every `__historyEntryId` on every filed Library row wrong,
silently, since the feature shipped — nothing before this session ever
read that field, so it went unnoticed. Fixed by having `onRecordHistory`
(the prop both components already call) return the created `HistoryEntry`,
and using its real `.id` for the Library filing call — reordered in
Library.tsx so History is recorded first. Caught because the new History
"Library-linked" override guard below depends on this field being correct;
verified with a live upload that the badge/override now actually fires.

### Contacts: scan-derived fields at a glance (app/ only)

Per Jack: "find the contacts matched snippet/summarized note post scan and
it being uploaded then stored in the platform same with the product line
and disposition from a glance." Proposed and approved before building (per
the standing proposal rule). `Contact` (`lib/contacts.ts`) gained four
optional fields — `category`, `matchedSnippet` (the same `notesSummary`
text Scanner already computes per row), `disposition`, `dispositionNote` —
populated from `ResultRow`, not the raw CSV row, since only a row that
clears detection has any of these to begin with. Most contacts (no
detection hit) simply read blank across all four; that's expected, not a
gap, same reasoning as the rest of Contacts' capture-scope design.

- `attachScanResultsToContacts(contacts, resultRows)` matches each
  `ResultRow` to an existing Contact via the exact same email-first/
  name+company-fallback key the CSV-merge path already uses, then
  overwrites (not `fillBlank`-merges) those four fields — this is meant to
  reflect the most recent scan's read of that lead, not accumulate stale
  values across multiple scans.
- Runs in two places: once inside `App.tsx`'s `recordHistory` (right after
  `mergeContacts`, using the freshly-scanned `ResultRow[]`) so category and
  matched snippet are populated the moment a lead is first scanned, and
  again inside `syncToHistory` for every subsequent Scanner-side edit
  (disposition, category reassignment, tier/cross-out — anything that
  already flows through `Scanner.tsx`'s `mutateResults`/`onSyncToHistory`).
- The second hook is not optional polish — it's why disposition works at
  all. A lead's disposition is always `"none"` at the moment it's first
  scanned and only ever set afterward (meeting booked / not interested /
  no contact yet / other, from the Scanner's per-row dropdown); a pure
  "snapshot at initial scan" would mean the Disposition column in Contacts
  could never show anything but blank, defeating the point of surfacing it
  at all. Reusing `onSyncToHistory` — already firing on every Scanner edit
  for the History-sync feature — costs nothing extra and keeps
  category/snippet/disposition in Contacts live-accurate to Scanner without
  a new plumbing path. (I'd originally scoped "live sync" to Jack as the
  more expensive option before realizing this hook already existed and is
  reused as-is — flagged here so the choice reads as fixed, not silently
  reversed.) Library's own separate per-lead editor (`StoredRow`, not
  `ResultRow`) is NOT wired to this — same deliberate scope line as the
  existing "Scanner edits don't auto-sync into filed Library rows" rule.
- `Contacts.tsx`'s table gained three columns: a Product line badge, a
  Disposition badge (note on hover), and a truncated Matched snippet (full
  text on hover). `Companies.tsx`'s expanded contact rows show the same two
  badges inline next to each contact. Both render a plain "—" when the
  field is unset.

## Nav restructure: Lead Library rename + Engage tab (app/ only)

Per Jack's explicit ask, proposed and approved before building (per the new
standing rule below): "Library" is renamed **"Lead Library"** everywhere a
person sees it — sidebar label, Home tile, the Home banner's "single source
of truth" line, History's Library-linked badge/override copy, the Scanner's
"Save to the Lead Library" checkbox, the Lead Library's own empty-folder
hint, Contacts' empty state, and the Backup/Restore tooltips. Nothing else
changed: the component file stays `Library.tsx`, `lib/library.ts`,
`LibraryEntry`/`LibraryGroup`, and every `libraryEntries`/`libraryGroups`
variable name are untouched — renaming those would be pure internal churn
with real regression risk for zero user-facing benefit.

**Board and Contacts are no longer their own top-level nav items** — both
now live as sub-tabs ("Tasks" / "Contacts," later joined by "Companies" —
see below) inside a new **Engage** view (`app/src/components/Engage.tsx`),
sitting between Lead Library and History in the sidebar. This is purely a
navigation regroup, same as the Google→Microsoft/Business Central View-tab
pattern elsewhere in the app but one level up (nav-level, not row-level):
`Engage.tsx` renders `TaskBoard` and `ContactsView` completely unchanged,
same props, same data — it only owns the tab switcher and its own `tab`
state (originally a button strip, since replaced by a dropdown — see
below). `App.tsx`'s `View` type
lost `"board"`/`"contacts"` and gained `"engage"`; the two separate render
blocks collapsed into one `<Engage ... />` that forwards every prop both
children need (`tasks`, `contacts`, and all their existing handlers).
Home's module grid collapsed the separate Board and Contacts tiles into
one "Engage" tile showing a combined stat (`N contacts · M open tasks`).
Contact tasks (the feature directly above) keep working exactly the same
inside Engage's Contacts sub-tab — verified live that adding a task there
shows up immediately in Engage's Tasks sub-tab.

### Companies + Engage's dropdown switcher (app/ only)

Per Jack: Engage should switch between Contacts/Companies/Tasks via "a drop
down feature ... on the main screen," not the button tab strip above —
`Engage.tsx`'s tab strip is now a single `<select>` (`EngageTab = "contacts"
| "companies" | "tasks"`, in that order per Jack's stated ordering; default
selection stays `"tasks"` for continuity with the pre-dropdown behavior).

**Companies** (`app/src/components/Companies.tsx`, `app/src/lib/
companies.ts`) is a brand-new third Engage tab — a company-level roll-up
computed from the existing Contacts array, not a new data source: no new
IndexedDB store, no new upload path, nothing filed differently. Per Jack:
"we will slowly build this out with more data fields and closer to an
actual Apollo down the road" — this is the seed of the Roadmap's "richer
company-level data" item, deliberately starting minimal.
- `groupContactsByCompany` groups by the exact-match normalized company
  name (case/whitespace-insensitive, no fuzzy matching — same convention
  Contacts' own dedup fallback uses), rolling up contact count, combined
  `timesSeen`, earliest/latest `firstSeenAt`/`lastSeenAt`, and the union of
  `sourceFiles` across every contact in that company. A contact with no
  company isn't grouped anywhere (not even an "Unknown" bucket) — deferred,
  not an oversight.
- Companies.tsx has no company-level fields of its own yet (still just
  a Contacts roll-up): search (company or contact name) and a sort
  dropdown (most recent/name/most contacts), no editing of the company
  itself. Clicking a company row expands it in place to list its
  contacts (name/title/email or phone) and, per the manual add-contact
  feature below, add one.
- No company-level tasks yet (Contacts' "+ Task" stays contact-only) —
  scoped out of this pass, flag if wanted next.

### Companies: manual "+ Add contact" (app/ only)

Per Jack: "add for companies an option to add another contact with their
first last name email title company also (because it could be a parent or
separate entity, phone number etc." A company's expanded row now has an
"+ Add contact" button opening an inline form (First/Last name, Title,
Company, Email, Phone). The **Company field is pre-filled with the row you
added from but stays freely editable** — exactly per Jack's own reasoning,
the new contact might actually belong to a parent or separate entity
rather than that exact company, so submitting with a different company
name correctly creates/joins a different company group instead of forcing
it into the one you started from (verified live: adding a contact from
"Adams Co" with company overridden to "Adams Holdings" created a separate
company, not a third contact under Adams Co).
- `lib/contacts.ts` was refactored so `mergeContactsFromParsedFiles`
  (CSV path) and the new `mergeManualContact` (this feature) both call a
  shared `mergeContactInputs` — same email-first/name+company-fallback
  dedup rules either way, so manually "adding" someone already on file
  merges into their existing record (additive — never blanks a field
  that's already filled in) instead of creating a duplicate. A manually
  added contact's `sourceFiles` gets the fixed label `"Manually added"`
  instead of a real filename.
- Threaded through as `onAddContact` (`App.tsx`'s new `addManualContact`
  → `Engage.tsx` → `Companies.tsx`), the same prop-drilling pattern
  `onAddContactTask` already uses.
- Per Jack, this is explicit direction for later, not built yet: a future
  LinkedIn integration, and richer company profile fields (estimated
  employees, industry, website) once Companies grows past a pure Contacts
  roll-up — see Roadmap.

## Shell — denser, product-grade visual pass + account panel (app/ only)

Per Jack: "less AI // more like a hubspot or apollo // keep functions etc
change none of that // back the backdrop less white space // include like a
bottom left account settings internal platform notes section." Confirmed
two open questions before building (per the standing proposal rule): the
account block is a **static identity block only** (this is a single-
password tool with no real user accounts — see Access & ownership — so
there's nothing to actually manage yet); its settings icon opens the
existing Cheat Sheet, since that's where rule tuning already lives, rather
than a new empty settings page. Platform Notes is a **persistent
scratchpad**, not a changelog.

- **Visual pass** (`styles.css`, `App.tsx`, `Home.tsx`) is styling/spacing
  only — no component's behavior, props, or data flow changed. `--bg` moved
  from a pastel mint to a cooler flat gray (`#eef0f2`), a new
  `--surface-sunken` token was added for filled chips/stat-pills, and
  paddings/radii were tightened across the header, sidebar nav items, and
  Home (header bar, module tiles) to read as a denser SaaS product rather
  than an airy AI-generated landing page. The brand hues (`--ink`,
  `--accent`) are deliberately unchanged — those are the actual Wired CIO
  brand, not part of what Jack asked to change. **Home's hero** went from a
  large full-bleed gradient marketing card to a flat bordered header strip
  with a short greeting/mission line plus a compact stat-pill row (Lead
  Library/Contacts/Open tasks/Uploads counts) — the same live counts it
  already had, just laid out like a dashboard summary bar instead of a
  hero banner. Module tiles are the same tiles, just smaller (tighter
  padding/gaps, no separate "Open →" line — the whole tile is already the
  click target). Every other view (Scanner/Lead Library/History/Engage/
  Contacts/Companies/Cheat Sheet) inherits the new tokens automatically
  through the shared CSS variables and wasn't touched component-by-
  component this pass — expect a follow-up density pass on their own
  table paddings if more tightening is wanted, per the usual "start
  somewhere then fine tune."
- **`AccountPanel`** (`app/src/components/AccountPanel.tsx`) is pinned to
  the bottom of the sidebar via a flex-column `<aside>` in `App.tsx`
  (`nav` now scrolls independently in its own flex item — the existing
  "scroll option" behavior from the Shell's original build is unchanged —
  while `AccountPanel` sits below it via `margin-top: auto`, always in
  view). Originally a static "Jack · Wired CIO Sales" identity block — see
  "Profile & Access" below for how it became a real, editable one. A
  separate settings button calls the same `setShowCheatSheet(true)` the
  floating Cheat Sheet button already uses — no new settings surface.
- **Platform Notes** (`app/src/lib/platformNotes.ts`) is a single free-text
  scratchpad — one record, one string — for internal notes about the
  platform/build itself, explicitly separate from the per-lead
  `dispositionNote`/Library notes that already exist. A "📝 Platform
  notes" button under the account block opens a small popover (bottom-
  left, near its trigger) with a `<textarea>` that autosaves 500ms after
  the last keystroke — no explicit save button, matching the low-friction
  feel of a real scratchpad. New IndexedDB store (`STORE_PLATFORM_NOTES`,
  `lib/db.ts`, `DB_VERSION` bumped 5→6) — same one-store-per-concern
  pattern as every other store here.

## Global header search (app/ only)

Per Jack: "add in a search bar the top right a bit below lock so i can
search by contatcs companies or phone number etc." `HeaderSearch.tsx` sits
in the header's right column, stacked under the Lock button (`App.tsx`
turned that corner into a `flex-direction: column` group). Searches the
existing Contacts directory only — no new data source, since a Contact
already carries company and phone (see lib/contacts.ts's `searchContacts`,
reused as-is). As-you-type dropdown shows up to 6 matching contacts
(name/company/phone); clicking one, or hitting Enter, navigates to
Engage's Contacts tab with that search already applied.
- `Engage.tsx` gained optional `initialTab`/`initialContactsSearch` props,
  and `Contacts.tsx` gained `initialSearch` — both seed-only (read once on
  mount via `useState(initial || ...)`), which works because `App.tsx`
  only ever renders `<Engage>` when `view === "engage"`, so it fully
  unmounts/remounts on every navigation into the tab. `App.tsx` holds a
  small `engageEntry` state (`{ tab?, contactsQuery? }`) that
  `HeaderSearch`'s `onJumpToContacts` sets before switching `view` to
  `"engage"`. The sidebar's own Engage nav button explicitly resets
  `engageEntry` to `{}` on click, so navigating there normally (not via
  search) always lands back on the Tasks tab instead of replaying a stale
  search.

## Profile & Access (app/ only)

Per Jack: "add in a section for account and profile so i can build out
others being allowed access and then start building around user policies
etc." Confirmed scope before building (per the standing proposal rule,
and because this is the single largest guardrail in this file): **UI
scaffolding only, one real local user, no backend change** — this app has
no shared database, so a second person "invited" here still couldn't see
Jack's data no matter what UI exists. Real multi-user access is a separate,
much larger effort (a hosted backend + database) that hasn't been started.
- `lib/profile.ts` replaces the account block's hardcoded "Jack · Wired
  CIO Sales" with a real, editable, locally-persisted record (name/role/
  org) — new IndexedDB store (`STORE_PROFILE`, `DB_VERSION` bumped 6→7).
  Same one-user-only posture as everything else in Access & ownership,
  just no longer hardcoded in JSX.
- Clicking the account row (now a button, `AccountPanel.tsx`) opens
  `ProfileAccess.tsx` — a modal with two sections: **Your profile** (the
  editable name/role/org form above) and **Team & access**, which lists
  the one real user ("you," tagged "Owner") plus a deliberately **disabled**
  "+ Invite teammate" button with an explanatory note underneath about why
  (no shared backend yet) — chosen over a working-looking invite that
  would silently do nothing, which would be actively misleading. This is
  the seed for the Roadmap's "user accounts/login policies" item; role-
  based policies (Owner/Admin/Rep) are named in the copy as direction, not
  implemented.
- The settings gear (previously inline in the account row) is now its own
  full-width button below it, since the row itself is the profile-modal
  trigger — still opens the same Cheat Sheet, nothing else changed there.

## History: Clear/delete with a Library-linked override (app/ only)

Per Jack: a way to clear History wholesale or delete individual imports,
but "if there's a file saved in the library" tied to that entry, deleting
it needs a typed **"override"** confirmation first — not a plain browser
confirm — since it would sever the Library's sync-back link to that entry's
original scan (see Library architecture above on `__historyEntryId`/
`onSyncToHistory`), even though the filed Library copy's own data is
untouched either way.
- `History.tsx` computes `linkedHistoryIds` from the `libraryEntries` prop
  (now passed in from `App.tsx`) — every `StoredRow.__historyEntryId` across
  every Library file. A History card whose id is in that set shows a small
  "📚 Library-linked" badge and, on delete, opens `OverrideModal` (typed
  "override," case-insensitive, required before the button enables) instead
  of deleting. An unlinked entry still gets a plain `window.confirm` (not
  silent — this is also new, there was no confirmation of any kind before).
- **Clear History** (new toolbar button) applies the same rule at the batch
  level: if ANY currently-loaded History entry is Library-linked, clearing
  requires the same override modal; otherwise a plain confirm. `App.tsx`'s
  new `clearHistory()` deletes every entry from state and IndexedDB.
- The Library files themselves are never touched by any of this — only
  History entries and their `__historyEntryId` back-link are affected.

## Scanner: layout condensing + Lead Library file picker (app/ only)

Per Jack: reorganize Scanner's UI for readability without changing any
function/feature, plus a new way to pull a file already sitting in the
Lead Library back into Scanner without leaving the screen first. Proposed
and approved before building (per the standing proposal rule) — including
confirming the existing app-wide password gate (locked until unlocked,
per-browser, always locked on a fresh browser/artifact URL — `lib/auth.ts`)
already covers "Scanner should always need a password," no change needed
there.

- **Layout only, zero behavior change**: the landing screen's "Save to
  Lead Library" checkbox/month picker now sits in its own bordered card
  instead of a floating centered row; Recent uploads and the High Priority
  panel got the same card treatment. On the results screen, the tier tabs,
  Duplicates/Priority toggles, product-line filter buttons, and the
  Google→Microsoft/Business Central/Sales-CRM "View:" sub-tabs — previously
  four separate loosely-spaced rows — are now visually grouped inside one
  bordered container. Every button/toggle/filter keeps its exact prior
  behavior; only spacing and grouping changed. Scanner's card backgrounds/
  borders/muted text now pull from the same `--surface`/`--border`/
  `--muted`/`--accent` tokens the rest of the app (Home, sidebar,
  AccountPanel) already uses, instead of one-off hex values, for visual
  consistency with the density pass documented above.
- **New: "Or load from the Lead Library" picker**, next to the New Upload
  card on Scanner's landing screen — a Folder dropdown (`libraryGroups`,
  already a Scanner prop) followed by a File dropdown scoped to that
  folder's files (`getFolderEntries`, `lib/library.ts` — each of the
  up-to-3 files a folder can hold, plus an "All files (combined)" option
  via `getCombinedFolderExport` when a folder has more than one). "Load"
  re-parses the selected file's stored `rawText` (`parseCSVText`) and runs
  it through the exact same path `handleFiles` already uses for a fresh
  upload — `scanParsedFiles` → `setResults`/`setUploadedFiles` →
  `onRecordHistory` — so it behaves identically to a brand-new scan of
  that CSV: current rule overrides apply, a new History entry is created,
  and (as with Library's own pre-existing "Load into Scanner" button) it
  does NOT re-file into the Lead Library, since the file loaded is already
  filed. This is a second entry point onto behavior that already existed
  (Library.tsx's own `handleLoad`/`onLoadIntoScanner`), not a new data
  path — no new IndexedDB store, no new persisted state.
- Verified live: uploaded a CSV with Save-to-Lead-Library checked, filed
  successfully, started over, then used the new picker (August 2026 →
  Dynamics 365) to pull the same lead back into a fresh Scanner session —
  confirmed the row reappears with its original detection/tier/category
  intact and the consolidated filter bar/landing cards render correctly.

## Contacts: detail view, LinkedIn, and outreach tracking (app/ only)

Per Jack: click a contact to see more info, a LinkedIn link, and a way to
track calls/emails/status per contact — plus, for Companies, a real "card"
view and the same call/email/status editing. Proposed and approved before
building (per the standing proposal rule), including a follow-up
clarification on how live Apollo enrichment could actually work (see
below) and Jack's explicit "as I select I don't want to have too much
going on in the background yet I can't see."

- **`ContactDetail.tsx`** (new) is a modal opened by clicking a contact's
  name in `Contacts.tsx` or inside a company's expanded row in
  `Companies.tsx` — same shared component, same `onUpdate(patch)` callback
  wired to `App.tsx`'s new `updateContact(id, patch)`. Shows every field
  Contacts already had (including the scan-derived category/disposition/
  matched-snippet from the feature above) plus two things editable ONLY
  here.
- **LinkedIn — no automatic profile match.** Jack's original ask was a
  hyperlink derived from "first and last name with their company and
  title having to match" — there is no deterministic way to do that;
  LinkedIn profile URLs are arbitrary slugs, not derivable from a name/
  company/title rule, and this app has no LinkedIn API access regardless.
  What's built instead: a "Search LinkedIn ↗" link that opens LinkedIn's
  own people-search prefilled with name + company (always available, no
  network call from this app at all), plus a manual `linkedinUrl` field
  (`Contact.linkedinUrl`, `lib/contacts.ts`) to save the real profile URL
  once you find it. See Apollo enrichment below for the closest thing to
  an automatic match this app actually has.
- **Outreach tracking — a new, separate concept from scan-derived
  `disposition`.** `Contact` gained `callCount`, `emailCount`,
  `outreachStatus` (`"not-contacted" | "contacted" | "contacted-
  successfully" | "not-interested" | "meeting-booked"` —
  `OUTREACH_STATUS_META`/`OUTREACH_STATUS_ORDER`, `lib/contacts.ts`).
  Deliberately kept separate from the existing `disposition`/
  `dispositionNote` fields documented above: those are a read-only
  snapshot of the Scanner's own lead-qualification status (synced via
  `onSyncToHistory`), while this is a directly-editable outreach-activity
  tracker with its own state set and two counters that have no Scanner
  equivalent at all. Edited via `ContactDetail`'s stepper counters and a
  status dropdown; shown as a badge + counts in `Contacts.tsx`'s new
  "Outreach" column and in `Companies.tsx`'s contact rows.
- **Companies as a "card."** Per Jack, a company's expanded row in
  `Companies.tsx` now opens with a stat strip (Calls made, Emails sent,
  Contacted N/total, Meetings booked — `Company.totalCalls`/`totalEmails`/
  `contactedCount`/`meetingBookedCount`, computed by
  `groupContactsByCompany` in `lib/companies.ts`) before listing contacts.
  Read-only there, per Jack's own call: outreach is tracked per person,
  Companies only sums it up. Each contact in the list is now clickable,
  opening the same `ContactDetail` modal.

### Apollo enrichment — a real, viewer-gated network dependency

Per Jack's explicit approval, after a clarifying round on the only way
this can actually work: Contacts data lives in the VIEWER's own browser
(their local IndexedDB, once they open the published Artifact) — it never
reaches a Claude Code session, so there's no way to run a one-time
enrichment pass from outside the app. The only real option is a live
in-app button that calls Apollo using the viewer's OWN connected Apollo
account via the Artifact `mcp` runtime capability — this IS a new network
dependency shipped in the product, flagged per this file's own
Working-style rule on that specifically, and gated entirely behind
whether the viewer (Jack) has Apollo connected in his claude.ai account.
Nothing here uses a credential this app holds itself — there isn't one.

- **Explicit and selection-driven only** — per Jack: "this should be as i
  select i dont want to have too much going on in the background yet i
  cant see." Nothing runs automatically, ever. `Contacts.tsx` gained row
  checkboxes and an "Enrich via Apollo" button that only appears once at
  least one contact is selected (capped at 10 per click — Apollo's own
  bulk-match limit — the button disables past that with a message rather
  than silently chunking into multiple background calls). Every contact's
  outcome (matched/no-match/error) is listed individually right below the
  button, never collapsed into one spinner or banner.
- **`lib/apolloEnrich.ts`** (new) calls the viewer's Apollo connector via
  `window.claude.use("mcp")` (see the artifact-capabilities skill/
  `claude.d.ts`/`mcp.d.ts`) — `checkApolloAvailability()` and
  `enrichContactsViaApollo(contacts)`, the latter calling Apollo's
  people-bulk-match tool with name/company/email per contact and reading
  back `linkedin_url` when Apollo returns a confident match (silently
  `"no-match"` otherwise — normal, not an error). A matched result writes
  straight to `Contact.linkedinUrl` via the same `onUpdateContact` path
  the detail modal uses.
- **Connector name isn't knowable from a build session** — Apollo tools
  were rehearsed directly (not guessed) via this session's own
  `mcp__Apollo_io__apollo_people_match`/`apollo_people_bulk_match` calls
  against synthetic test data, to learn the real request/response shape
  (a single match returns `{person: {...}}`; bulk returns `{matches:
  [...]}`, parallel to the input array, `null` for no match — confirmed
  live, 0 credits consumed on a non-match). But the exact CONNECTOR
  DISPLAY NAME Jack's own claude.ai account uses for Apollo can't be
  observed from here. `findApolloServer()` in `apolloEnrich.ts` resolves
  it defensively at call time — `listTools()` and match any connector
  whose name contains "apollo" (case-insensitive) among what's actually
  available to the viewer, rather than a hardcoded guess. The Artifact
  publish's `capabilities.mcp.servers` manifest (see the next "CRM"
  publish) needs to list Jack's actual connector display name as a
  candidate `server` entry for `listTools()` to ever surface it at all —
  if the button reports "Apollo isn't connected" despite Apollo being
  connected in his claude.ai account, the fix is adding the exact display
  name shown there to that manifest, not a code change.
- **Not yet verified against a real Apollo call from inside the deployed
  app** — everything up to the `window.claude.use("mcp")` boundary was
  verified live in this session's own Playwright browser (detail modal,
  LinkedIn manual field, outreach counters/status, selection UI, Companies
  rollup); the actual live Apollo round-trip only exists inside the real
  claude.ai Artifact viewer with Jack's own connected account, which this
  build/test environment cannot reach. First real test happens when Jack
  uses the button after the next publish.

### Company enrichment — paused mid-design (app/ only, not built)

Per Jack: enrich company-level data too (location, industry, employee
count, corporate phone if available, an overview — the same "About"
section data Apollo shows on a company profile), using the org data
already nested in a person-enrichment response when present. A design was
proposed and approved (new `CompanyProfile`/`STORE_COMPANY_PROFILES`
store, `groupContactsByCompany` merging it onto the existing rollup,
fillBlank-style merge on re-enrichment) and the organization-enrich
response shape was rehearsed live against Apollo's own public domain
(`apollo.io` — 1 credit, approved by Jack first, since that endpoint is
NOT free like the person-match tools already shipped: `industry`,
`estimated_num_employees`, `raw_address`/`city`/`state`/`country`,
`short_description`, `website_url`, `logo_url` all came back populated; no
`phone` field was present on that particular response — Apollo's org data
doesn't always carry one, consistent with Jack's own "if able").

**Then paused before any UI/store code was written**: Jack's explicit
follow-up — "I want to select on which contacts I am going to enrich data
with I want to slowly be sure this doesn't break anything or dump too
much data at once" — ruled out the auto-populate-on-person-enrichment
path from the original design (silently saving company data as a side
effect of enriching a contact). Whenever this resumes, company enrichment
needs to be its OWN explicit, selective action — same pattern as the
already-shipped Contacts "Enrich via Apollo" (pick specific companies,
click a button, see the per-company cost and outcome) — not a background
side effect of anything else. The one inert schema change made while
exploring this (`STORE_COMPANY_PROFILES` in `lib/db.ts`) was reverted;
nothing related to this feature exists in the codebase yet.

**Direction for later, per Jack**: the real point of enriching company
(and contact) data isn't the data for its own sake — it's to eventually
filter/narrow down or remove leads based on it, feeding into a future
qualification pass the same way the Scanner's own detection engine
already qualifies a lead into Strong Signal/Needs Review/Bad Leads today.
Not scoped or designed yet; captured here so it isn't lost, same as the
rest of this Roadmap section.

### Design/bug review pass (app/ only)

Per Jack's ask to "check all the design look for bugs re scan" — a full
read-through of the app's recent code plus a live Playwright sweep of
every view (Home, Scanner landing/results, Lead Library, History, Engage's
three tabs, Contact detail, header search, Profile & Access, Platform
Notes, Cheat Sheet). No visual/design regressions found across any view —
every screen still renders cleanly against the shared token set. Two real
bugs found and fixed:

- **`ContactDetail.tsx` never rendered the scan-derived `disposition`** —
  it was checked as one of three conditions that reveal the "From the
  last scan" panel, but only the category badge and matched-snippet text
  were actually drawn inside it. A contact whose only last-scan signal
  was a disposition (no category, no snippet) showed an empty panel, and
  no contact ever saw its disposition in the detail modal at all — present
  in `Contacts.tsx`'s table, missing from the one place Jack asked for "a
  contact page you can click into and see more info." Fixed: the panel
  now renders a disposition badge (with the note on hover) alongside the
  category badge. Verified live: set a lead's disposition to "Not
  interested" in Scanner, confirmed both the Dynamics 365 category badge
  and the Not interested badge render together in the detail modal.
- **`lib/apolloEnrich.ts` mishandled every real Apollo failure.** A
  connector-call rejection from `mcp.callTool`/`mcp.listTools` is a plain
  `McpError` object (`{code, message, ...}`, per the artifact-
  capabilities skill's `mcp.d.ts`), never a real `Error` instance — so the
  original `err instanceof Error ? err.message : "..."` check was always
  false for it, silently discarding the runtime's actual message and
  collapsing every distinct failure (expired Apollo auth, no connector,
  a genuine tool error) into one generic "Apollo call failed." — exactly
  the anti-pattern `mcp.d.ts` calls out by name ("never collapse all
  failures into one generic banner"). Fixed with `describeApolloError()`,
  which reads the real `McpError` shape and gives specific guidance for
  `needs_reauth`/`server_not_connected`/`selection_required`; also
  wrapped the previously-unguarded `findApolloServer()` call inside
  `enrichContactsViaApollo` so a raw `McpError` can't leak past this
  module uncaught.

Findings surfaced but NOT changed (judgment calls, not correctness bugs —
flagged for Jack rather than decided unilaterally):
- Apollo match results carry a `title` field that's captured but never
  applied to `Contact.title` or shown anywhere — dead data today. Could
  fill a blank title, or show it in the per-contact outcome line;
  unclear which Jack wants, if either.
- Contacts.tsx's selection (and the "Enrich via Apollo" outcome list)
  isn't cleared after a run completes, unlike Scanner's bulk-action bar,
  which clears selection after every "Apply." Selecting new contacts and
  running enrichment again works fine either way — this is a minor
  consistency nit, not a functional bug.
- `Companies.tsx`'s "+ Add contact" form lets the pre-filled Company
  field be cleared entirely; submitting with a blank company still saves
  the contact, but it won't group under any company (`groupContactsByCompany`
  skips contacts with no company name) — an edge case only reachable by
  deliberately clearing the field.

## Cheat Sheet relocation + dated Platform Notes (app/ only)

Per Jack: remove the floating Cheat Sheet button and its Settings-gear
entry point, and fold it into one panel with Platform Notes as a tab —
plus Platform Notes itself becomes a real dated/titled log instead of one
free-text scratchpad. Proposed and approved before building (per the
standing proposal rule), including confirming what happens to an
already-saved note (migrated into a dated entry, not discarded).

- **One shared modal, two tabs, not two separate popups.** The floating
  📋 button (bottom-right, `App.tsx`) and its `onClick` are gone entirely.
  `AccountPanel`'s Settings gear (`onOpenSettings`) and its "📝 Platform
  notes" trigger (new `onOpenNotes` prop) both now open the same panel —
  Settings opens straight to the Cheat Sheet tab, Platform Notes opens to
  the Notes tab — via one `App.tsx` state, `notesPanelTab: "notes" |
  "cheatsheet" | null`, replacing the old `showCheatSheet` boolean.
  `CheatSheet.tsx` gained an optional `onSwitchToNotes` prop (only passed
  from this entry point) that draws a small tab strip so you can flip
  back to Notes without closing — additive, no change to Cheat Sheet's
  own content or its other call site (there isn't one anymore, but the
  prop is optional so nothing else breaks if `CheatSheet` is ever opened
  standalone again).
- **Platform Notes is now `PlatformNoteEntry[]`, not one string.**
  `lib/platformNotes.ts` replaced `loadPlatformNotes(): string` /
  `savePlatformNotes(text)` with `loadPlatformNotes(): PlatformNoteEntry[]`,
  `addPlatformNote(title, body)`, `deletePlatformNote(id)` — each entry
  auto-stamps `createdAt` (title is user-given, defaults to "Untitled" if
  left blank). Still `STORE_PLATFORM_NOTES` — no `DB_VERSION` bump needed,
  since the store was already keyed by `id` and previously held exactly
  one fixed-id row; it now holds one row per entry instead.
- **Migration, not data loss.** A browser that still has the old
  single-blob record (`id: "platform-notes"`, a `text` field) gets it
  converted into the first dated entry (titled "Untitled", `createdAt`
  taken from the old record's `updatedAt`) the first time `loadPlatformNotes()`
  runs, then the legacy record is deleted so it's not re-migrated on every
  load. An old record that was empty is just cleaned up, nothing created.
- **`PlatformNotes.tsx`** (new) — "+ New note" opens an inline title+body
  form; entries list newest-first, each showing title, timestamp, body,
  and a delete button. "Go back on a calendar day basis" (Jack's ask) is a
  day-filter dropdown built from the distinct calendar days notes exist on
  (`dayKeyOf()`, local calendar day — not UTC — so it matches what the
  entry's own timestamp reads as), each option showing that day's entry
  count; "All days" clears the filter.
- Orphaned CSS from the old inline popover (`.notes-popover` bare class,
  `.notes-textarea`, `.notes-popover-footer`) removed from `styles.css`.
  `.notes-popover-backdrop`/`-header`/`-close` were kept — `ProfileAccess.tsx`
  still reuses those for its own modal shell, unrelated to this change.
- Verified live: floating button confirmed gone from Home; opened via
  both the Settings gear (lands on Cheat Sheet) and the Platform Notes
  trigger (lands on Notes); added a dated note, switched tabs both
  directions without losing it, closed and reopened cleanly; Home's own
  Cheat Sheet module tile still opens the same shared panel correctly.

## Sticky crossed-out/disposition state (app/ only)

Per Jack: "if a contact ever becomes crossed out it should stay crossed
out until that command is undone manually even with new uploads/scan
history, especially with dispositions for the lead or contact." Proposed
and approved before building (per the standing proposal rule) — this
changes core Scanner semantics (what crossing a row out and setting its
disposition actually mean across uploads), not a cosmetic tweak.

- **The gap**: `scanParsedFiles` always builds a brand-new `ResultRow` per
  row with `crossedOut: false`/`disposition: "none"` hardcoded, regardless
  of anything set on that same person in a prior upload. Since Contacts
  already tracks the same real person across every upload (email-first/
  name+company dedup), a re-upload — a fresh CSV export, or the same file
  scanned again — silently reset both fields to blank every time.
- **`Contact` gained `crossedOut`** (`lib/contacts.ts`), alongside the
  existing scan-derived `disposition`/`dispositionNote`. Unlike
  `category`/`matchedSnippet` (a pure per-scan snapshot), `crossedOut` and
  `disposition` on Contact are now the PERSISTENT source of truth for that
  person, not a snapshot of the latest scan.
- **`applyStickyState(rows, contacts)`** (new, `lib/contacts.ts`) runs
  immediately after every fresh `scanParsedFiles()` call — Scanner.tsx's
  `handleFiles` (drag/drop upload) and `loadFromLibraryPicker` (the
  Folder→File picker), and `App.tsx`'s `loadParsedFilesIntoScanner` (the
  Library's own "Load into Scanner") — and BEFORE those rows are ever
  shown or recorded. For each row, it looks up the matching Contact (same
  `buildContactIndex`/`lookupContact` helpers `attachScanResultsToContacts`
  already used, now shared rather than duplicated) and, if that Contact
  already has `crossedOut: true` and/or a real (non-"none") `disposition`,
  carries it onto the fresh row before anything else touches it.
- **The only way out is the manual toggle, same as before.** Crossing a
  row back out (or in) in Scanner already flows into its Contact via
  `onSyncToHistory` → `attachScanResultsToContacts` — unchanged, except
  that function now also writes `crossedOut` (it previously synced
  category/snippet/disposition only). Since `applyStickyState` runs
  before that sync path ever sees a fresh row, there's no feedback loop —
  a freshly-seeded row just round-trips its own already-correct value
  back onto the Contact untouched until someone actually toggles it.
- Verified live: crossed out and dispositioned a lead in one upload;
  uploaded a second, unrelated CSV containing the same person (different
  file, different wording) and confirmed both the strikethrough styling
  and the disposition carried forward automatically, with zero manual
  action; manually un-crossed it on that second upload; uploaded a THIRD
  time and confirmed the un-cross stuck (no longer crossed out) while the
  disposition — never touched — still correctly carried forward,
  confirming the two track independently and each only changes via its
  own explicit action.

### Disposition row-color + auto-cross-out on "Not interested" (app/ only)

Per Jack: "when a disposition is logged the contact row should change
with appropriate color — blue being meeting booked, red being not
interested, for now" — plus a follow-up in the same breath: "if not
interested is selected, cross their name out also automatically, for
now." Both are direct, concrete asks building on already-shipped
mechanics (the existing disposition badges, the sticky-crossed-out
feature above), so built directly without a separate proposal round.

- **Meeting booked recolored to blue** (`DISPOSITION_META["meeting-
  booked"]`, `lib/detection.ts`) — was green (`#2CC295`, the same green
  used for "Strong Signal" elsewhere, which is why it's changing); now
  `#0A66C2`/`#EAF3FC`, reusing the exact blue already established by the
  "Search LinkedIn" button rather than inventing a new one. Not-interested
  stays the red it already was (`#B5443B`/`#FBEAE8`).
- **Row-level tinting, not just the badge.** The whole row now takes the
  disposition's `bg` color when it's "meeting-booked" or "not-interested"
  — Scanner's results table (`Scanner.tsx`, alongside the existing
  duplicate-row tint, which still takes priority since it's rarer and
  already-established), Contacts.tsx's table, and each contact line
  inside a Companies.tsx expanded card. Every other disposition (none,
  no-contact, other) is unstyled — "for now," per Jack's own qualifier;
  more colors for the rest is a natural follow-up, not scoped yet.
- **Auto-cross-out is a one-way trigger, not a toggle-sync.** Setting a
  row's disposition to "Not interested" (`setDisposition`, and the bulk
  `setDispositionForSelected`, both `Scanner.tsx`) also sets
  `crossedOut: true` on that same row — which immediately shows as
  strikethrough (Scanner already draws that from `crossedOut`) and, via
  the sticky-state feature above, persists into that person's Contact
  record and every future upload of them, exactly like a manual cross-out
  would. Deliberately does NOT auto-uncross if the disposition later
  changes away from "Not interested" — `crossedOut` stays exactly what
  the sticky-state feature already established: manual-undo-only.
- **Contacts.tsx and Companies.tsx now also render `crossedOut` visually**
  (strikethrough on the contact's name) — this data existed on `Contact`
  since the sticky-state feature but was never actually displayed there
  before; now that a disposition change can set it automatically, it
  needed to be visible in both places disposition already shows.
- Verified live: set a lead to "Meeting booked" in Scanner, confirmed the
  row background matched the new blue exactly (`rgb(234, 243, 252)`);
  changed it to "Not interested," confirmed the row turned the existing
  red, the company/contact cells struck through with zero additional
  clicks, and both the red tint and strikethrough carried into the
  Contacts table for the same person.

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
  level data than what a lead CSV export alone carries today (Jack's named
  fields so far: estimated employees, industry, website).
- A LinkedIn integration — surfaced alongside the company-profile fields
  above, no scope defined yet (enrichment? profile links per contact?).

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
- When Jack says **"CRM"** on its own, that means: pull up the platform —
  rebuild if there are uncommitted changes since the last publish, then
  republish/refresh the claude.ai Artifact and hand him the link. Treat it
  the same as "open the platform"/"drop the platform link," just shorter.
- **Before implementing any change/add-on/feedback that edits the platform,
  rewrite the request as a short solution-design proposal and get Jack's
  explicit approve/tweak/disapprove first** — per his own standing
  instruction. The proposal states: what will actually change (files/
  components/data model), what won't, and any product decision it implies
  (new duplicate/dedup rule, new nav/IA change, renaming something already
  shipped, anything that could conflict with a feature already in place).
  Skip this only for a true one-liner with no ambiguity (a typo fix, a copy
  tweak) — anything that adds a data field, a new view, a new IndexedDB
  store, or touches more than one component goes through the proposal step.
  This replaces jumping straight to implementation for those cases; the
  "don't ask permission for routine implementation choices" rule above
  still governs judgment calls made *while building* an already-approved
  proposal.
- When Jack says **"checkpoint"** on its own: push a new branch named
  `checkpoint-N` (next sequential number — check existing `checkpoint-*`
  branches on origin first rather than trusting memory of the last one
  used) pointing at the current tip of `claude/epic-faraday-zbehnu`, then
  confirm the branch name, the commit it points at, and a one-line summary
  of what's included since the prior checkpoint. This is a **branch**, not
  a git tag — this session's push credentials can create/push branches but
  get a 403 on tag refs, discovered when checkpoint 1 was created. To "go
  back to checkpoint N": reset/checkout `claude/epic-faraday-zbehnu` to
  that branch's commit (ask Jack to confirm before actually rewriting the
  working branch's history — this is exactly the kind of destructive/
  hard-to-reverse action Access & ownership and the system prompt's own
  git-safety rules call out). To "redo an update" after going back: the
  commits between the checkpoint and where the branch was before are still
  reachable by their SHAs (`git log --all`/`git reflog`) — cherry-pick or
  merge them back in as needed rather than re-doing the work from scratch.
  **Checkpoint 1** = branch `checkpoint-1`, commit `8069116` ("Make
  crossed-out and disposition sticky per-person across uploads") — the
  most recent commit at the time Jack asked for this, covering everything
  built up through the sticky-crossed-out/disposition feature.
