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

### "Booked" stamp on meeting-booked leads (app/ only)

Per Jack: "Put a red word 'Booked' in small leads above the company name
for a lead if the disposition is selected as meeting booked like a stamp
also registered to book leads." A concrete, unambiguous UI ask building
directly on the disposition mechanics above, so built without a separate
proposal round.

- **`components/BookedStamp.tsx`** (new, shared) — a small bordered,
  slightly rotated red "BOOKED" label (`#B5443B`, the same red already
  used for the Not-interested disposition/badge), deliberately red rather
  than the Meeting-booked disposition's own blue so it reads as a distinct
  marker/stamp rather than a restatement of the row/badge color already
  showing the same status.
- Rendered wherever a lead or contact's company/name is shown and
  `disposition === "meeting-booked"`: Scanner's results table (above the
  company name), Contacts.tsx's table (above the company cell), and
  Companies.tsx's expanded company card (above each contact's name in the
  per-contact row list). One shared component, three import sites — same
  pattern as `DISPOSITION_META`/`CATEGORY_META` badges elsewhere in the
  app, chosen over three separate inline definitions so the stamp's look
  can't drift between views.
- Purely a visual marker — doesn't change `disposition`, doesn't add a new
  field, doesn't touch downloads/filing/History. Reads directly off the
  disposition value each view already had.
- Verified live: set a lead's disposition to "Meeting booked" in Scanner,
  confirmed the red "BOOKED" stamp renders above the company name in
  Scanner's table, then confirmed the same stamp renders above that
  person's name in both the Contacts table and Companies' expanded card.

### Company website field, auto-derived from email domain (app/ only)

Per Jack: "Create a place where the company website can be linked in the
contact//set a rule to use the email domain to figure that out and map it
properly//this will help ti build out the linkdeln eventualyly also."
Proposed via AskUserQuestion; the question went unanswered while Jack
moved on to other requests, and his later "run through all these proposed
updates" made clear he wanted forward progress rather than more blocking
dialogs — built to the proposed default below.

- **`Contact.companyWebsite?: string`** (`lib/contacts.ts`) — auto-filled
  the first time a contact with an email and no website on file is merged
  (`deriveCompanyWebsite(email)`, called from both branches of
  `mergeContactInputs` — new contact and merge-into-existing), and never
  overwritten afterward by a later auto-derivation, same `|| ` precedence
  pattern `fillBlank` already uses elsewhere in this file — whether the
  existing value came from auto-derivation or a manual edit, it wins.
- **Free/personal providers are explicitly excluded** — a fixed
  `FREE_EMAIL_DOMAINS` set (gmail, yahoo, outlook, hotmail, icloud, aol,
  live, msn, proton, mail.com, gmx, yandex, zoho, and the big three
  consumer ISPs) — someone's `gmail.com` address says nothing about their
  employer's domain, so those are left for manual entry instead of
  silently deriving a wrong website.
- **`ContactDetail.tsx`** gained a "Company website" section, same
  editable-field-plus-save-button pattern as the existing LinkedIn field
  right below it (deliberately adjacent — per Jack's own "this will help
  build out the LinkedIn eventually" framing, company website is a step
  toward that, not a separate concern), with copy that tells you whether
  the value shown was auto-filled or needs manual entry. Editing and
  saving overrides the auto-derived value the same way the LinkedIn field
  already works.
- Scoped to `ContactDetail.tsx` only for now, not surfaced in the
  Contacts/Companies table columns — matches the proposed default; flag if
  a table column or Companies-level display is wanted next.
- Verified live: uploaded a contact with a real company domain
  (`dana@diazconsulting.io`) and confirmed `https://diazconsulting.io` was
  auto-filled and shown as a working link; uploaded a second contact on
  `gmail.com` and confirmed the field stayed blank with the "no domain to
  derive" hint instead of guessing a wrong website, then manually saved a
  website for that contact and confirmed it persisted as a link.

### Disposition-grouped view (app/ only, Contacts)

Per Jack: "create a place where all selected disposition leads are
stored also//this will be important for knowing where a lead stands how
many times they've been contacted and so forth//will eventually tally
how many outbound call attempts have been made there." Proposed via
AskUserQuestion; the question went unanswered while Jack moved on to
other requests, so built to the proposed default per his later "run
through all these proposed updates" instruction, same as the company
website field above.

- **Filter bar on `Contacts.tsx`**, above the table: "All" plus one
  button per `DISPOSITION_ORDER` value (No disposition/Meeting booked/
  Not interested/No contact made/Other), each showing a live count. Reads
  `Contact.disposition` (already persistent/sticky per the earlier
  sticky-state feature — this is filtering on existing data, not adding a
  new field) — no new store, no new persistence path.
- Counts and the filter itself apply on top of the existing search box
  (a typed search narrows the counts too) but are independent of table
  sort — `searched` (search+sort applied) feeds both `dispositionCounts`
  and the further disposition-filtered `filtered` list, so switching
  disposition buckets never resets whatever's typed in search.
- **Aggregate summary strip** — appears only once a specific disposition
  is selected (not on "All," where a cross-bucket sum isn't a meaningful
  number): contact count in that bucket, plus total calls made and total
  emails sent summed across it — a first cut at Jack's "tally how many
  outbound call attempts have been made" ask, using the `callCount`/
  `emailCount` fields Contacts' outreach tracking already had.
- Verified live: uploaded 3 contacts, set one to Meeting booked (3 calls/
  2 emails via the detail modal's counters), confirmed the filter bar
  showed correct live counts (All 3 / No disposition 2 / Meeting booked 1
  / others 0), clicking "Meeting booked" narrowed the table to that one
  contact and showed a summary strip reading "1 contact · 3 total calls
  made · 2 total emails sent," and clicking back to "All" restored all 3
  rows.

### "On CRM" marker (app/ only)

Per Jack: "Add in a feature i can mark onCRM." Confirmed via
AskUserQuestion before building (ambiguous enough — "on CRM" needed a
read — and this adds a new field, so it's not a one-liner): a sticky,
purely manual per-contact flag meaning "this person is already logged in
the real CRM (Dynamics 365/HubSpot)" — distinct from the scan-derived
`disposition` and the directly-editable `outreachStatus`, neither of
which mean "on file elsewhere."

- **`Contact.onCrm?: boolean`** (`lib/contacts.ts`) — never set by any
  scan/sync/merge path, only by the explicit toggle in `ContactDetail.tsx`
  (a button under the name/title header, "Mark as On CRM" → "✓ On CRM"
  once set, calling `onUpdate({ onCrm: !contact.onCrm })`). Persists the
  same way every other Contact field does — no new store.
- **`components/OnCrmBadge.tsx`** (new, shared) — a small green "✓ On CRM"
  pill using the app's brand accent green rather than a status color,
  since this is a tracking marker ("already handled elsewhere"), not a
  lead-qualification signal like the disposition badges. Same
  shared-component pattern as `BookedStamp.tsx`.
- Shown next to the contact's name wherever one appears: Contacts.tsx's
  table, Companies.tsx's expanded per-contact rows, and — read-only,
  since Scanner has no per-row contact editor — Scanner's results table.
  Scanner looks up the matching Contact via the same `buildContactIndex`/
  `lookupContact` helpers `applyStickyState` already uses (now exported
  from `lib/contacts.ts` for this), memoized once per `contacts` prop
  change rather than looked up freshly on every render.
- **Bug caught before shipping**: the first pass added the Scanner-side
  `buildContactIndex` lookup as a `useMemo` placed AFTER Scanner's
  `if (!results) return …` early-return guard — a real rules-of-hooks
  violation (React error #310, confirmed live via a Playwright console
  listener) since the hook would run on some renders and not others.
  Fixed by moving it up alongside Scanner's other `useMemo` calls, all of
  which sit before that early return.
- Verified live: toggled "On CRM" for a contact from the detail modal,
  confirmed the badge appears in Contacts' table, Companies' expanded
  card, and Scanner's results table (with zero direct interaction in
  Scanner itself, confirming the read-only reflect works).

### Personal-email Auto-DQ + "Personal Prospect" carve-out (app/ only)

Per Jack: "we always make emails with personals like @gmail or @aol etc a
bad lead//but if the notes indicate a strong lead signal we move to a new
sub category labeled personal email decent opp." Proposed via
AskUserQuestion before building (a new Auto-DQ rule plus a new
classification is exactly the kind of product decision the standing
proposal rule calls out) — confirmed: new Auto-DQ rule with a carve-out
tag (not a toggle-able exception), and the carve-out stays inside its
already-qualified category/downloads rather than becoming a third
parallel bucket. Two-word phrase, per Jack's explicit ask for one:
**"Personal Prospect"**.

- **Shared free-email-domain list, single-sourced.** Jack's message also
  asked to "double check websites are pulled through cross checking the
  contacts email" — auditing the existing company-website auto-derivation
  (`lib/contacts.ts`) surfaced no bug (31/31 unit cases + a full merge-path
  check all passed), but it did have its OWN separate copy of the
  free-provider domain list. Consolidated into one source of truth —
  `FREE_EMAIL_DOMAINS`/`getEmailDomain`/`isFreeEmailDomain` now live in
  `lib/detection.ts` (exported), and `lib/contacts.ts`'s
  `deriveCompanyWebsite` imports and reuses them instead of keeping its
  own copy — so the "is this a personal email" question is answered
  identically everywhere it's asked, not just coincidentally the same.
- **`PERSONAL_EMAIL_DQ_LABEL` = "Personal email domain"** — a new
  `getDQReasons` check (`lib/detection.ts`), same free-domain list as
  above, checked against the resolved email field directly (same pattern
  as the existing `PLACEHOLDER_EMAIL_RE` check right above it). Cross-
  cutting like every other DQ rule — fires regardless of category/tier.
- **The carve-out, in `scanRowUnified`:** computed tier and DQ reasons
  both run as normal first. Only if the personal-email rule is the ONLY
  DQ reason present AND the row's tier was already `"signal"` before DQ
  is applied does the carve-out fire — `dqReasons` is cleared, tier stays
  `"signal"`, and the new `isPersonalProspect: boolean` flag (`ScanResult`/
  `ResultRow`/`StoredRow.__isPersonalProspect`) is set. Any OTHER DQ
  reason present — alone or alongside the personal-email one — still DQs
  the row as a flat Bad Lead, same as every existing DQ rule; the carve-
  out never overrides a genuine disqualifier. A personal-email row that
  never cleared Strong Signal on its own content also stays a plain Bad
  Lead — the carve-out only fires for OTHERWISE-qualifying leads.
- **Visible, not a new bucket.** A teal "Personal Prospect" badge (chosen
  to stand apart from category/disposition/DQ colors) shows next to the
  category badge wherever a tagged row appears: Scanner's results table
  and the Lead Library's per-lead editor (`Library.tsx`). The row still
  files into its normal category (Dynamics 365 or M365/Azure) and is
  still included in that category's normal CSV download — no new download
  file, no new View-tab, per the confirmed scope.
- Verified via a scripted audit (`scanParsedFiles` exercised directly,
  five scenarios) plus a live Playwright pass: a personal-email lead with
  genuine Strong Signal content stays Strong Signal, tagged, and download-
  eligible; the identical content on a real work email behaves exactly as
  before (no tag); a personal-email lead with only weak/mention-level
  content still lands in Bad Leads with "Personal email domain" as the
  reason; a personal-email lead that ALSO trips an unrelated DQ rule (e.g.
  "not interested") stays a flat Bad Leads with both reasons listed, no
  carve-out.

### Undo disposition (app/ only)

Per Jack: "add in a function also for when i select the dispostion made i
can undo it in case i mistakenly put one down." Concrete UI convenience
building directly on already-shipped mechanics, so built directly.

- **`undoDisposition(id)`** (`Scanner.tsx`) resets `disposition` to
  `"none"` and clears `dispositionNote`. Since selecting "Not interested"
  auto-crosses a row out (see "Disposition row-color + auto-cross-out"
  above), undoing THAT specific disposition also un-crosses the row — a
  mistaken "Not interested" click is fully reversed in one action instead
  of needing a separate trip to the cross-out toggle. Undoing any other
  disposition leaves `crossedOut` alone, same manual-undo-only contract
  as before — this only reverses the auto-effect of the exact disposition
  being undone, never a cross-out set independently.
- A small "↺" button appears next to the disposition dropdown — in
  Scanner's results table (per-row) and in the bulk-action bar (a
  "↺ Undo disposition" button, `undoDispositionForSelected`, same
  per-row logic applied to every selected row) — visible only when
  there's something to undo (`disposition !== "none"`).
- Same "↺" control added to the Lead Library's per-lead editor
  (`Library.tsx`, `CategoryFileCard`) — resets `__disposition`/
  `__dispositionNote` the same way. `StoredRow` has no `crossedOut`
  concept at all (that's a Scanner/Contact-only field), so the Library
  version is just the disposition/note reset, nothing else to reverse.
- Verified live: selected "Not interested" on a lead (confirmed auto-
  cross-out fired), clicked Undo, confirmed disposition reverted to "No
  disposition" AND the row un-crossed and un-tinted in one click; confirmed
  a row manually crossed out with no disposition set shows no Undo button
  (nothing to undo); confirmed the same round-trip works through the bulk
  toolbar on two rows at once.

### Bug fixed: glued "NULL" in CRM exports was suppressing Strong Signal (app/ only)

Per Jack: uploaded a real batch, 12 Business Central leads landed in Needs
Review instead of Strong Signal and had to be manually re-promoted one by
one. Root-caused against his actual export file (a Dynamics/CRM-sourced
CSV) rather than guessed at.

- **Root cause**: this specific CRM export builds each cell by
  concatenating several source fields together and stringifying an empty
  one as the literal text `NULL` — with no separator, so it lands glued
  directly onto real content: `"...Business Central- 25 usersNULL"` or
  `"NULLFrontline Mobile Response is developing..."`. That glued `NULL`
  eats the word boundary every count/keyword regex in `detection.ts`
  relies on — `\busers?\b` doesn't match inside `"usersNULL"` — so a row
  with a real, explicit stated seat count silently failed
  `LICENSE_COUNT_RE`/`DYNAMICS_ESTIMATED_COUNT_RE` and never cleared
  `hasTrigger`, landing at `"mention"` (Needs Review) instead of
  `"signal"`. Confirmed on the real file: 105 of 500 rows (21%) carried
  this glued-`NULL` pattern — not a one-off, a systemic export-formatting
  issue worth fixing at the root rather than one regex at a time.
- **Fix, in `lib/csv.ts`**: a new `stripGluedNull()` runs once, right
  after Papa Parse, inside both `parseCSVFile`/`parseCSVText` — the single
  choke point every consumer (detection, Contacts, CSV re-export) reads
  through. Strips `NULL` glued to either side of a real word
  (`/\bNULL(?=[A-Za-z])/g` and `/(?<=[A-Za-z0-9])NULL\b/g`), and treats a
  cell that's ONLY the literal text `NULL` as blank. Fixing it here, once,
  beats patching every regex in `detection.ts` to tolerate the noise.
- **Second, related bug found in the same file**: Jack's actual export's
  Product Area column is named `msp_primaryproductcodename`, which
  `FIELD_DEFS`'s `productArea` candidates (`mspsolutionareaname`/
  `productarea`/`solutionarea`) didn't recognize — its content still got
  caught by the general column scan, but skipped the more lenient
  "a hit in the Product Area column is automatically Strong Signal" path
  (`scanRowPlatform`'s `productAreaValue` branch) entirely. Added
  `"primaryproductcodename"` to the candidate list.
- **Verified against the real file** (500 rows, not synthetic): Strong
  Signal count went from 34 → 64 rows after both fixes — Business Central
  specifically went from 15 of 23 rows stuck below Strong Signal down to
  3, and those 3 are correctly excluded for unrelated reasons (existing-
  CRM-opportunity-notes DQ, single-seat DQ, and a `"no budget"` DQ hit on
  a row that also happens to state real interest — flagged separately
  below, not silently changed). The exact 12 companies Jack manually
  re-promoted — Servbank, CTA Manufacturing, Conrey Electric, RepScrubs,
  Quantum Signal AI, TrueLink Capital, Metarom USA, American Society for
  Quality, 11:11 Systems, inSeption Group, CalcWorks, and Battleship NC
  Memorial — all now land as Strong Signal automatically, confirmed by
  diffing the exact same file against the code before and after the fix.
  Also confirmed live in the browser against a real two-row slice of the
  file: both leads land as Strong Signal with clean matched snippets (no
  stray "NULL" text) and correctly extracted seat counts.
- **Flagged, not changed**: one of the three still-excluded Business
  Central rows (Acne Industries) trips the "Small one-off project / free
  consultancy request" DQ rule on the phrase "there is no budget amount
  **but discuss further with agent**" — nuanced, open-to-discussion
  language, not a flat rejection — while the same row separately states a
  real product need with a count ("looking to get Dynamics 365 Business
  Central for up to 5 users"). Whether "no budget yet, open to discussing"
  should trip the same DQ rule as a flat "no budget" is a real judgment
  call about false-positive tolerance, not obviously a bug — left alone
  pending Jack's read on it rather than loosening a DQ rule unilaterally.

### Full Strong Signal audit against the real 500-row file (app/ only)

Per Jack: re-check the same real file (`Book82626.csv`) category by
category — Dynamics (Business Central/ERP, Sales/CRM, everything else —
F&O, Supply Chain/SCM, Customer Insights, HR, etc.) and M365/Azure (Azure
Document Intelligence/app builds, Google→Microsoft, Azure migrations,
ongoing/full partner support, licensing/billing) — and fix what's found.
Confirmed final count: **64 Strong Signal** (30 Dynamics 365, 34 M365/
Azure), unchanged in total from the prior glued-NULL fix pass — today's
two shipped fixes were snippet-quality and visibility, not tier-flipping.

- **Dynamics breakdown, all verified correct**: 21 Business Central/ERP/
  F&O/SCM (tier 0), 4 Sales/CRM/Customer Engagement/Insights (tier 1), 5
  "everything else" (tier 2). Two tier-2 rows (1st care Palliative and
  Hospice, D'Amico Hospitality) have near-empty Comments ("F1 / Company
  Tenant Partner") but are legitimately Strong Signal via a real
  `msp_primaryproductcodename = "Dynamics 365"` hit — confirmed by reading
  the raw column value directly, not a fluke of the earlier Product Area
  fix. One nuance flagged, not changed: "50 Eggs" contains "D365 Sales
  Pro" but landed in tier 2 instead of tier 1 — its Dynamics-category
  match came from a different part of a long comment blob than that
  phrase, outside the ±70-char signal window used for module-tier
  classification. Affects which View-tab it shows under, not Strong
  Signal correctness — the row is still correctly Dynamics 365/Strong
  Signal either way.
- **M365/Azure breakdown, checked against each pattern Jack named**:
  Document Intelligence (1, ACT Education Corp — snippet now clean after
  the fix below), Google→Microsoft (3 explicit mentions, 10 total via
  `isGoogleToMicrosoft`, which also covers Azure on-prem migrations per
  its existing widened definition), Azure migrations (4), ongoing/full
  partner support (1 explicit + more via the M365 Tenant Strong Signal
  boost), licensing/billing (4 explicit, plus everything the separate
  licensing engine catches). No app-build-specific examples existed in
  this particular file. Every "matched pattern but not Strong Signal" row
  checked by hand: 4 Azure-migration rows and several billing rows are
  correctly excluded as internal CRM/Opportunity-tracking notes (the
  existing DQ rule working as intended, not a bug); 2 ongoing-partner
  rows correctly DQ'd on a genuinely confirmed sub-15 count; "Ohio Valley
  Bank"/"Arium Networks" correctly stayed at Needs Review — internal
  booking/scheduling notes with no real qualifying signal (Arium's own
  text explicitly says Dynamics questions are "handled in a separate
  future consultation," i.e. out of scope).
- **Fixed: trailing glued-`NULL` only handled a word before it, not
  punctuation.** The original glued-NULL fix (`stripGluedNull`,
  `lib/csv.ts`) used `(?<=[A-Za-z0-9])NULL\b` for the trailing case — but
  plenty of real rows end a full sentence with punctuation right before
  the glue ("...their workload.NULL"), which that lookbehind didn't
  catch. These rows were still correctly Strong Signal (Document
  Intelligence/Azure Migration hits don't need a trigger-word check, see
  the original fix), but their matched-snippet/notes text rendered as a
  literal "NULL." instead of the real, relevant sentence — a real
  cosmetic bug, not a classification one. Widened the lookbehind to
  `(?<=\S)` (any non-whitespace, not just alphanumeric) so punctuation-
  terminated sentences get cleaned too. Verified: ACT Education Corp,
  Data Infocom, TYNET USA INC, and Alpine Adventures all now show their
  real Document Intelligence/Azure Migration/MCA-E language instead of
  "NULL."
- **Fixed: Entra ID licensing pattern only matched the abbreviated form.**
  `SKU_CATALOGUE`'s Entra ID pattern (`\bentra\s*id\s*p[12]\b`) matched
  "Entra ID P2" but not "Entra ID Plan 2," which is how Newton County's
  real row phrased it — that row had zero detection hits at all before
  this fix (not even Needs Review), despite mentioning a real, named
  Microsoft licensing product. Widened to
  `\bentra\s*id\s*(?:p[12]\b|plan\s*[12]\b)`. Doesn't flip Newton County
  to Strong Signal on its own (no confirmed seat count in that row), but
  it's no longer invisible to the tool.
- **Found, NOT shipped: seat-count extraction misses counts separated
  from their unit word by a product name.** LUNA COUNTY's real row states
  "348 Microsoft 365 G3 licenses" — a genuine, large, qualifying count —
  but `COUNT_PATTERNS`' first pattern requires the number to sit
  *directly* next to "users/seats/licenses," so "Microsoft 365 G3"
  sitting in between breaks the match entirely; a much smaller, unrelated
  number nearby (extracted as 3) won instead, DQ'ing a real 348-seat
  renewal as "Low seat count." A widened pattern that tolerates a short
  product-name gap was tested against the full real file before shipping
  anything — it fixed LUNA COUNTY (348) and 3 other genuine cases, but
  **also produced 5 false positives that all extracted the exact same
  wrong number, `365`** — matching the literal "365" in "Microsoft 365"
  itself as if it were a seat count, on leads with no real stated count
  at all (52nd Operations Group, The Hillary Group, Kimmel Cyber
  Security, Assort Health, Lithium Americas). That's a worse trade than
  the bug it fixes, so it was reverted rather than shipped. Left as a
  known limitation — a real fix here needs to specifically exclude
  digits that are part of a recognized product name (365, the SKU
  numbers themselves) from being read as a count, not just widen the
  adjacency gap; flagged for a dedicated pass rather than a rushed
  regex change.

### "Rows scanned" accounting fix + full breakdown in Scanner and History (app/ only)

Per Jack: ran 4 real files (~3000 leads total, lots of duplicates) and the
UI reported "955 rows scanned, 193 dupes removed" — a real discrepancy he
caught by eyeballing the totals. Follow-up asks in the same thread: don't
word duplicate removal as data loss ("recognize them... i know its being
mapped properly"), call out a lead that appeared many times in one file
specifically (his example: "6 rows of the same lead, this happens"), and
extend the same full accounting (rows read, duplicates, tier breakdown,
product-line breakdown) into History so a past upload can be audited the
same way.

- **Root cause of the wrong number.** `scanParsedFiles` (`lib/
  detection.ts`) already computed the correct raw `rowsScanned` — summed
  from every file's row count BEFORE detection drops no-signal rows or
  duplicates are removed — and returned it alongside `results`/
  `duplicatesRemoved`. But every UI call site discarded it: `Scanner.tsx`'s
  stat card read `results.length` (the post-filter, post-dedup count) for
  its "Rows scanned" tile, and `App.tsx`'s `recordHistory` computed its own
  `rowsScanned: scanned.length` instead of using the real per-file sum —
  so both the live Scanner view and every History entry understated the
  true upload size, worse the more duplicates/no-signal rows a batch had
  (which is exactly why a big 4-file, high-duplicate batch showed the
  starkest gap). Per-file counts shown next to each filename were already
  correct throughout — this was isolated to the two aggregate stats.
- **Fix — thread the real numbers through, don't recompute them.**
  `Scanner.tsx` now keeps `lastScanStats` (`rowsScanned`/
  `duplicatesRemoved`/`largestDuplicateGroup`, the last computed from the
  max surviving `duplicateGroupSize` across `results` — see CLAUDE.md
  "Duplicate detection," which already retains each survivor's true group
  size after removal for exactly this purpose) and its stat card now
  reads `lastScanStats.rowsScanned` instead of `results.length`.
  `onRecordHistory`'s signature grew an optional 4th `duplicatesRemoved`
  parameter, threaded from both of Scanner's call sites and Library's
  upload-into-folder call site (all three already had the value in scope
  locally, just weren't passing it on). `App.tsx`'s `recordHistory`
  computes `rowsScanned` from `parsedFiles` directly (never
  `scanned.length`) and derives `largestDuplicateGroup` from `scanned`
  itself before calling `buildHistoryEntry`.
- **Reworded, not just relabeled.** The duplicate-removal notice
  (Scanner's transient banner and its persistent accounting line) now
  reads "N duplicate rows **recognized and merged into their matching
  contact**" instead of language implying rows were discarded — accurate,
  since a repeated lead is never actually lost, just consolidated to its
  first-seen row (see "Duplicates are removed outright" above). Any group
  bigger than 2 gets its own callout: "(one lead appeared N times)" —
  directly answering Jack's "6 rows of the same lead, this happens"
  example.
- **New persistent accounting banner (Scanner).** Below the transient
  dedupe notice, a small always-visible line shows the full pipeline for
  the current upload: rows read → duplicates recognized/merged (with the
  large-group callout) → rows with zero Dynamics/M365/licensing signal
  (invisible everywhere else in the app, per `scanRowUnified`'s early
  return — surfaced here for the first time as an explicit, named count
  rather than an implicit gap) → rows actually processed below. Every
  number in that chain is now internally consistent:
  rowsScanned = duplicatesRemoved + noSignalCount + results.length.
- **History gets the same breakdown per entry, not just a total.**
  `HistoryEntry` (`lib/history.ts`) gained optional `duplicatesRemoved`/
  `largestDuplicateGroup` fields (optional so an entry recorded before
  this change still loads fine, reading as 0 everywhere shown — no
  migration needed), set by `buildHistoryEntry` from the same values
  Scanner/Library already compute. `History.tsx`'s per-entry card now
  shows two lines instead of one: rows read + the same "recognized and
  merged" duplicate wording (fixing a second, related dead-code bug in
  the same pass — `dupCount` was reading
  `entry.results.filter(r => r.isDuplicate).length`, which is ALWAYS zero
  since duplicates are hard-removed from `entry.results` before it's ever
  persisted; now reads `entry.duplicatesRemoved` instead, the only place
  that number still exists), and a second line breaking Strong Signal
  down by product line (Dynamics 365 / M365 Azure counts, existing
  `ACTIVE_CATEGORY_KEYS`/`CATEGORY_META`) alongside Needs Review and Bad
  Leads totals — exactly the "break it down by needs review, strong
  signal and further with the product lines" breakdown Jack asked for.
- Verified live end-to-end: uploaded a 10-row test file with one lead
  repeated 6 times, two rows with zero product/licensing language, one
  Dynamics 365 Strong Signal row, one M365/Azure Strong Signal row, and
  one Needs Review row. Scanner's stat card correctly showed "Rows
  scanned: 10" (not 3, the old bug's post-filter count); the accounting
  banner read "10 rows read · 5 recognized as duplicates and merged into
  their matching contact (one lead appeared 6 times) · 2 had no
  signal... · 3 processed below"; History's entry for the same upload
  showed the identical rows-read/duplicate numbers plus "2 Strong Signal
  (1 Dynamics 365 · 1 M365 / Azure) · 1 Needs Review · 0 Bad Leads" — both
  views agree, and the arithmetic (10 = 5 duplicates + 2 no-signal + 3
  processed) checks out exactly.

### Bug fixed: "Rows scanned" undercounted when a batch was reopened/combined from History (app/ only)

Per Jack: "the rows scanned count when its processing multiple files it
might not be accurate but it seems the strong signals is pretty accurate
with the total." A fresh multi-file upload was verified correct live (4 +
3 files = 7 rows read, matching exactly) — the real gap was elsewhere:
Scanner's `lastScanStats` (the fix directly above) is local state, only
ever set inside Scanner's own `handleFiles`/`loadFromLibraryPicker`.
Reopening a single History entry ("View") or combining several
("Combine into Scanner") both go through `App.tsx`'s
`loadHistoryIntoScanner` instead, which never touched that state — so
those paths silently fell back to the old undercounted `results.length`,
exactly matching Jack's report (Strong Signal counts read straight off
`results` either way, so those stayed accurate). Fixed by having
`combineHistoryEntries` (`lib/history.ts`) also sum `duplicatesRemoved`
and track the max `largestDuplicateGroup` across the combined entries
(mirroring what it already did for `rowsScanned`), threaded through a new
`loadedScanStats` App.tsx state → Scanner prop, adopted into
`lastScanStats` via a `useEffect` scoped to just this path. Verified live:
uploaded a 2-file, 7-row batch, confirmed the fresh-upload banner read "7
rows read"; reopened that same entry from History via "View" and
confirmed the reopened Scanner view now also reads "7 rows read" (not 2,
the old `results.length` bug).

## Custom Lead Lists (app/ only)

Per Jack: "I want to be able to also add certain leads i select and add to
customized made lists the ability to download it as csv added in."
Proposed (new nav item, new IndexedDB store, Scanner-only for v1) and
approved before building, per the standing proposal rule.

- **What it is, and why it's not the Lead Library.** A list is a plain,
  user-named group of hand-picked leads — Jack selects rows in Scanner's
  results table (checkboxes already used for every other bulk action) and
  adds them to a new or existing list via a new "+ Add to list" control in
  the bulk-action bar. Deliberately kept separate from the Lead Library:
  Library only ever files Strong Signal rows, auto-organized by month and
  category; a Custom Lead List takes ANY tier (Strong Signal, Needs
  Review, or Bad Lead — confirmed live, a Needs Review row filed into a
  list right alongside two Strong Signal ones) and is grouped purely by
  Jack's own naming, not auto-filed anywhere.
- **New nav item "Lists"** (`app/src/components/Lists.tsx`), between Lead
  Library and History, with a live count badge same as Library/History.
  Home's module grid gained a matching tile. New IndexedDB store
  (`STORE_LEAD_LISTS`, `lib/db.ts`, `DB_VERSION` bumped 7→8) — same
  one-store-per-concern pattern as everything else.
- **`lib/leadLists.ts`** (new) — `LeadList { id, name, createdAt, rows }`,
  each row a `ListedLeadRow` (the same `ExportRow` shape Final
  Downloads/Library already use, so a list downloads with identical
  columns, plus `__rowKey`/`__category`/`__tier` for display and dedupe).
  Each list stores its own snapshot of the leads added to it (same
  pattern the Lead Library's `StoredRow` already uses) — editing or
  deleting the original Scanner/History row later doesn't change what's
  in the list.
- **Dedupe on add, same convention as everywhere else.** Adding a lead
  already in that list (exact name+company match, case/whitespace-
  insensitive — `normalizeDupKey`, now exported from `detection.ts` for
  reuse) is a silent no-op, not a second copy; a lead missing either name
  or company skips the dedupe check entirely, same "can't reliably key it"
  rule the Scanner's own batch duplicate detection and Contacts' merge
  fallback already use. Verified live: re-selecting the same 3 leads and
  hitting "Add to list" again against the same list correctly reported
  "Added 0 leads (3 already there)" instead of duplicating them.
- **Bug caught and fixed before shipping: stale-closure race between
  create and add.** The first pass had Scanner call one prop to create a
  new list, then immediately call a second prop to add the selected rows
  to it — both `App.tsx` handlers independently read the same `leadLists`
  closure from that render. `setLeadLists` from the create step doesn't
  update that closure before the add step's own handler (captured at the
  same render) reads it, so the add step looked up the brand-new list in
  a `leadLists` array that didn't contain it yet — confirmed live: adding
  3 selected leads to a brand-new list reported "Added 0 leads (3 already
  there)" and the Lists nav count stayed at 0. Fixed by collapsing both
  steps into one `App.tsx` function (`addSelectedToList`) that threads a
  single local `working` array through create-then-add, never round-
  tripping through React state in between. Re-verified live after the
  fix: same flow now correctly reports "Added 3 leads to the list" and
  the new list shows up immediately.
- **Lists view**: each list is a card — rename (inline), delete (a plain
  browser confirm dialog noting the original leads aren't touched), and expand to
  show its rows (Company/Contact/product-line badge/tier badge/remove-
  from-list). "Download CSV" reuses the exact same `downloadCSV`/
  `EXPORT_LABELS` pipeline Final Downloads/Library/History all already
  use, so a downloaded list opens looking identical to every other
  export. Deleting a list or removing a lead from it only affects the
  list — never the source Scanner/History/Library data.
- **Scope for v1, per the approved proposal**: adding leads only from
  Scanner's results table, not Library/History/Contacts directly — flag
  if those are wanted as add-to-list entry points later.
- Verified live end-to-end: created a list from 3 selected leads spanning
  all three tiers, confirmed dedupe on re-add, removed one lead (3 → 2),
  renamed the list, and deleted it (confirm dialog, list gone,
  empty state shown) — all against the real IndexedDB-backed flow, not a
  mock.

## Apollo sequences investigation (app/ only, not built — pure recon)

Per Jack: pull his live Apollo sequences into the app in a "chart style"
view so he can work through them and mark who's been contacted, "basically
a dual screen to Apollo." Explicitly told not to ship anything yet — this
is scoping only, rehearsed live against his real Apollo account (never
synthetic data) per the artifact-capabilities skill's "never guess a
connector's shape" rule.

- **Real data confirmed, not hypothetical.** `apollo_emailer_campaigns_search`
  returned 21 real, live sequences with per-sequence stats already
  attached (open/reply/bounce rates, contacts scheduled/delivered/replied/
  demoed, `overdue_manual_tasks_count`, multi-channel steps — call/
  auto_email/linkedin_step_*). Several sequence names already mirror this
  app's own product-line categories (Dynamics Sequence, M365//Licensing
  Opps). `apollo_tasks_search` (filterable by `emailer_campaign_id` +
  `task_status`: scheduled/completed/skipped) confirmed real per-contact,
  per-step task records — that status IS the "have I touched them yet"
  signal Jack wants. Neither of these calls consumed Apollo credits.
- **Scope narrowed to 5 sequences for now, mainly call tasks**: Carly Main
  Sequence, Carly Outbound (M365//Dynamics//Licensing//Ongoing Support),
  Carly (Azure, Fabric + Power Bi), Dynamics Sequence, General Leads.
  Investigation into call-outcome/disposition values (no-answer, meeting-
  booked, "plus others") is still open — blocked mid-session when the
  Apollo connector's token expired; needs Jack to reauthorize it from his
  claude.ai connector settings before this resumes. My working read (not
  yet confirmed live): "no answer" is very likely a **phone call outcome**
  (`apollo_phone_calls_search` / the `phone_call_outcome_id` analytics
  dimension), while "meeting booked" may come from Apollo's separate
  meetings/calendar-event data rather than a call outcome at all — needs a
  real sample of both before building a mapping, not a guessed one.
- **Open, unresolved design decision, flagged rather than picked
  unilaterally**: whether an eventual "mark contacted" action in this app
  should (a) only write to this app's own Contact record (a read-only
  mirror of Apollo), or (b) actually call Apollo's own task-complete API
  and write back into the live sequence (`apollo_tasks_complete`/
  `apollo_tasks_skip` exist and were confirmed available, not yet called).
  (b) is a materially bigger step than anything Apollo-related shipped so
  far — every existing Apollo touchpoint (people-match enrichment) only
  ever reads Apollo and writes to this app's own data, never the reverse.
  Needs Jack's explicit call once the disposition-mapping piece above is
  resolved, per the standing rule on new network dependencies/write access
  to live external systems.

## Calls & Emails tabs (app/ only)

Per Jack, while the Apollo sequences pull is still blocked on
reauthorizing the connector (see above): "create a call tab here also
emails so we can start building out sequence and actual tasks slowly" —
the first NATIVE slice of the Outbound Engine, deliberately independent of
Apollo so it doesn't have to wait on that connector. Confirmed scope
before building (per the standing proposal rule — this adds a data field
and two new views): reuse the existing Task store rather than a new one,
keep it additive.

- **`Task` gained one new optional field, `channel?: "call" | "email"`**
  (`lib/tasks.ts`) — `undefined`/`null` = an ordinary task, so every
  existing Board/Contact task is completely unaffected, same pattern as
  `contactId`/`priority` before it. `createContactTask` grew an optional
  5th `channel` param.
- **Two new Engage sub-tabs, "Calls" and "Emails"** (`EngageTab` gained
  `"calls"`/`"emails"`, `Engage.tsx`), both rendered by one new shared
  component, `components/ChannelTasks.tsx`, parameterized by channel
  rather than two near-duplicate components. Each tab is a worklist of
  every task with that channel across every contact (same
  priority-then-date sort Contacts' own Tasks panel already uses), with a
  "Hide completed" toggle and a "+ Call"/"+ Email" quick-add form (pick
  any contact via a searchable dropdown, date, priority, optional note —
  same shape as Contacts' existing "+ Task" flow, just channel-tagged and
  not required to start from an already-expanded contact row).
- **Added a real "No answer" disposition** (`Disposition` in
  `lib/detection.ts`, between "Meeting booked" and "Not interested") —
  distinct from the existing "No contact made" (which means no attempt was
  logged at all) since a logged, no-answer call attempt is a real, common
  outcome that deserves its own value. Chosen deliberately to match the
  value Apollo's own call outcomes use, so a future pull-in of real Apollo
  call data (see the investigation above) maps straight onto this same
  field instead of needing a second, parallel taxonomy. Purely additive —
  every place that iterates `DISPOSITION_ORDER`/`DISPOSITION_META`
  (Scanner, Library, Contacts, Companies, ContactDetail) picked it up
  automatically; the one hardcoded `Record<Disposition, number>` literal
  (`Contacts.tsx`'s per-bucket count initializer) was updated to include
  it explicitly.
- **Deliberately did NOT touch the existing Contact-editing boundary.**
  `Contact.disposition` stays exactly what it's always been — a read-only,
  Scanner-synced snapshot, not directly editable from Contacts/Engage (see
  "Contacts: scan-derived fields at a glance"). A Calls-tab task has no
  outcome-capture field of its own yet; per Jack's own restated "this
  becomes the source of truth for all outbound opps" framing, letting a
  completed call task set a Contact's disposition directly is a real,
  separate product decision (crossing that documented boundary) — flagged
  here rather than decided unilaterally alongside this build.
- Verified live: uploaded a CSV to seed Contacts, added a call task from
  the new Calls tab with a note ("Left voicemail"), confirmed it shows
  there with the right contact/company/priority/date; confirmed it does
  NOT appear on the Emails tab (channel-scoped correctly); confirmed it
  DOES appear on the plain Tasks/Board tab too (same shared store, by
  design — matches how contact tasks already behaved before this
  change); confirmed "No answer" now shows as a disposition filter button
  on Contacts.

## Product thesis, restated (app/ only, not a build item)

Per Jack, worth capturing verbatim since it reframes where build effort
should go: **"The scanner will only be used by me and will slowly be used
less once all the data is uploaded and stored properly — the biggest use
case will be attacking outbound leads and processing where they stand."**
Scanner is the on-ramp (CSV in, triaged, filed), not the place Jack expects
to spend ongoing time once historical data is fully loaded — Contacts/
Companies/Lists/Engage (Tasks/Calls/Emails) are where the real, recurring
work happens: working an already-qualified pipeline, not re-processing
CSVs. Directly reinforces why the Calls & Emails tabs above and the
Apollo-sequences work are the right next investments over further Scanner
polish, and matches the Roadmap's "single source of truth for every
qualified lead" framing already captured below — this is that same
thesis, restated with an explicit usage-pattern prediction attached.

## Shell — sidebar Engage sub-nav, Cheat Sheet redo, header rename, History-by-month (app/ only)

A batch of navigation/UI-clarity requests fired in quick succession ahead
of a same-day walkthrough with someone else — treated as a set of
concrete, additive tweaks rather than one big proposal, per Jack's own
urgency ("showing someone this today so need to walk through it").

- **Sidebar Engage sub-nav, Apollo-style.** Per Jack: "a tab on the left
  hand side like Apollo's Engage for tasks, calls, emails... add a
  sequence tab also," then refined to "collapsable... just like apollo"
  with Contacts added too. `App.tsx`'s sidebar now renders a small
  ▸/▾ toggle next to the Engage row (`engageNavExpanded` state, collapsed
  by default) that reveals `ENGAGE_SUB_ITEMS` — Sequences, Tasks, Calls,
  Emails, Contacts — indented underneath. Clicking Engage itself also
  auto-expands it (so navigating there doesn't hide the very sub-nav
  you're about to use); clicking a sub-item sets `engageEntry.tab` and
  navigates, reusing the exact mechanism `HeaderSearch` already used to
  jump to Contacts. Purely additive — Engage's own in-page dropdown
  (`Engage.tsx`) still has every tab including these plus Companies, so
  nothing that worked before stopped working.
- **Sequences tab is a placeholder only**, per Jack's explicit "dont
  build out yet" — `Engage.tsx` renders a plain "not built yet" notice
  pointing at the "Apollo sequences investigation" section above. `Task`/
  `EngageTab` gained no new fields for this; it's UI-only.
- **Cheat Sheet redone for content clarity, zero rule changes.** Per
  Jack: "for questions on how the two categories are broken down...
  what signals are hot and how they break down with different product
  lines in their own category... change no functions." Two new sections
  added to `CheatSheet.tsx`, both purely descriptive (sourced from the
  same fixed rules already documented elsewhere in this file, nothing
  recomputed or changed): **"🔥 Hot signals right now"** (Document
  Intelligence, full app builds, Google→Microsoft, MSP/CSP/partner-
  engagement, security-design language — the hits that skip the trigger-
  word/count requirement entirely) and **"How each category breaks down
  further (View tabs)"** (spells out the Business Central/ERP vs Sales/
  CRM vs Everything-else split for Dynamics, and Google→Microsoft vs
  Everything-else for M365/Azure — previously undocumented anywhere in
  the Cheat Sheet itself, only in this file). The existing threshold
  editor, keyword editor, and Auto-DQ/Duplicates sections are untouched.
- **Direct Cheat Sheet entry point.** `AccountPanel.tsx`'s bottom-left
  "⚙ Settings" button — which only ever opened the Cheat Sheet, never a
  broader settings page — is relabeled "❓ Cheat Sheet" so it reads
  honestly for a live walkthrough. Same handler, same modal, no new
  state; a rename, not a new function.
- **Header retitled** "Wired Sales Outbound" (was "Wired CIO"), larger
  (26px, up from 17px) — per Jack: "add Wired Sales Outbound for the
  title in big letters." Subtitle ("Lead Scanner") and the "W" mark are
  unchanged.
- **Scanner's "Recent uploads" card is now collapsible** (▸/▾, expanded
  by default) — per Jack: "Recent uploads on scanner should be
  collapsable." New `recentUploadsCollapsed` state in `Scanner.tsx`,
  reset on "Start over" like every other per-batch UI choice.
- **History gains a "Month" grouping**, alongside the existing Day/Week
  tabs — per Jack: "history should end up collapsing and storing by the
  month also with all uploaded files," matching the Lead Library's own
  month-folder organization. New `getMonths()` in `lib/history.ts`,
  mirroring `getWeeks`/`getDays` exactly but reusing the Library's own
  `monthKeyFromDate`/`monthLabelFromKey` (imported from `lib/library.ts`)
  so "August 2026" means the same thing in both places. Month is now the
  default grouping (was Day) since it's the more natural default given
  how Jack organizes everything else in the app. No new interaction
  pattern — it's the same click-a-pill-to-filter mechanic Day/Week
  already had, not a new accordion UI.
- Verified live: uploaded a batch, confirmed the Recent-uploads collapse
  toggle round-trips correctly; expanded the sidebar Engage group and
  confirmed Sequences/Tasks/Calls/Emails/Contacts all navigate to the
  right panel with no console errors; confirmed the Cheat Sheet's two new
  sections render in full (verified against the actual rendered DOM
  text, not just the source) alongside every pre-existing section
  untouched; confirmed History's Month tab shows a real month pill and
  narrows correctly; confirmed the header renders "Wired Sales Outbound"
  at the larger size without clipping/overflow in the header bar.

## Native Sequences (app/ only)

Per Jack, approving the earlier proposal: "This wont fully work til i buiild
it out all the way but it is a great start in the direction i am looking to
go." Phase 1 of the Outbound Engine — a real, working sequence builder and
workflow engine, native to the app, deliberately independent of the still-
blocked Apollo connector.

- **Data model** (`lib/sequences.ts`, new `STORE_SEQUENCES`/
  `STORE_SEQUENCE_ENROLLMENTS`, `DB_VERSION` bumped 8→9): a `Sequence` is a
  name plus an ordered list of `SequenceStep` (channel: call/email/
  linkedin, a wait-days-after-previous-step, an optional note). A
  `SequenceEnrollment` tracks one contact's progress through one sequence
  — current step index, status (active/finished/removed), and the id of
  the currently-open Task for that step.
- **No separate task engine — reuses the existing Task store.** `Task`
  gained one more optional field, `sequenceEnrollmentId` (`lib/tasks.ts`),
  alongside the `channel` field the Calls/Emails tabs already added.
  Enrolling a contact creates a Task for step 0, due after that step's
  wait period; completing that task (`App.tsx`'s `toggleTask`, checked for
  `done && task.sequenceEnrollmentId`) calls `advanceEnrollment`, which
  either generates the next step's task or — if that was the last step —
  finishes the enrollment (`finishReason: "completed-all-steps"`). This
  means a sequence's tasks are workable from anywhere: the Sequences tab
  itself, the plain Board, or the Calls/Emails tabs — same store, same
  `onToggleTask`.
- **Email and LinkedIn steps do NOT actually send/connect anything —
  intentionally, flagged in the Sequences UI itself.** There's no
  SendGrid or LinkedIn API tied in (see Roadmap). An email/LinkedIn step
  generates a task you work by hand, exactly like a call step. This was
  called out explicitly in the build proposal so it wouldn't be mistaken
  for real automation later.
- **"Each sequence will finish off how their dispositions were selected,
  restarted, or removed" — implemented literally.** `TERMINAL_DISPOSITIONS`
  (`meeting-booked`, `not-interested`) — when `attachScanResultsToContacts`
  reports a touched contact whose disposition just landed on one of these
  (both call sites: `mergeContacts` and `syncToHistory` in `App.tsx`), every
  ACTIVE enrollment for that contact auto-finishes
  (`finishReason: "disposition"`) via a new `finishTerminalEnrollments`
  helper using a functional `setEnrollments` updater (safe against the
  stale-closure class of bug even when called from inside another
  functional updater). Nothing destructive — already-created tasks are
  left alone, only future step generation stops. **Restart** (back to step
  0, fresh task) and **Remove** (stops it, keeps the history, distinct
  `finishReason: "manual"`) are both explicit per-enrollment buttons in the
  Sequences UI, never automatic.
- **UI** (`components/Sequences.tsx`): name a sequence, add/reorder/remove
  steps (channel + wait-days + optional note), enroll any number of
  contacts via checkboxes (dedup on re-add, same "already active in this
  sequence" no-op pattern as Custom Lead Lists), and one view per sequence
  listing every enrollment with its current step, status badge, and the
  due date of its open task — Restart/Remove buttons per row.
- **Bug found and fixed while verifying: the Engage tab silently stopped
  switching when navigating between sub-items while already inside
  Engage.** `Engage.tsx`'s `tab` state was seeded from the `initialTab`
  prop via `useState`'s one-time initializer only — since `view` stays
  `"engage"` the whole time you're clicking between sidebar sub-items,
  `App.tsx` never unmounts/remounts `<Engage>`, so that initializer never
  re-ran. Clicking a different sidebar sub-item (or a Home tile) while
  already viewing Engage changed the `initialTab` prop but the visibly
  active tab silently stayed put — reads exactly like "tab switching is
  delayed," which is what surfaced it. Fixed with a
  `useEffect(() => setTab(initialTab || "sequences"), [initialTab])`.
  Confirmed by tracing the render path, then verified live: clicking
  Tasks → Calls → Companies in sequence while staying on the Engage view
  now switches correctly every time (previously only the first click
  worked).
- Verified live end-to-end: created a 2-step sequence (call, then email),
  enrolled a contact, confirmed the generated task's exact text and due
  date; completed the step-1 task from the Calls tab and confirmed the
  enrollment advanced to Step 2/2; separately, set a different enrolled
  contact's disposition to "Meeting booked" in Scanner and confirmed
  their enrollment auto-finished with "Ended by disposition" — both core
  mechanics working, not just scaffolding.

## Engage reorganized: sidebar sub-nav collapsible, Lists folded in, header search removed (app/ only)

A batch of navigation requests building directly on the sidebar sub-nav
shipped earlier the same session. Per Jack: "i want to be able to... more
collapsable drop downs under tabs with relevant sub sections like
engage... all collapasable on the left hand side when clicking a little
arrow icon next to engage just like apollo," then "add companies under
emails and reorganize it top to bottom properly... you can move lists
under there also," then "the search bar at the top... can now be
removed."

- **Sidebar Engage sub-nav is now a real collapsible toggle**, not
  always-expanded — a small ▸/▾ button next to "Engage" (`App.tsx`'s
  `engageNavExpanded` state, **collapsed by default**, unlike the
  always-open version shipped earlier the same session). Clicking
  "Engage" itself still auto-expands it and navigates to the default tab.
- **Companies and Contacts moved from Engage's in-page dropdown into the
  sidebar sub-nav too** (previously sidebar-only had Sequences/Tasks/
  Calls/Emails), and **Lists moved from its own top-level sidebar item
  into Engage's sub-nav** — no longer a separate `View`. Both the sidebar
  sub-nav (`ENGAGE_SUB_ITEMS`) and Engage's own in-page dropdown
  (`TAB_OPTIONS`) now share the exact same order: **Sequences, Tasks,
  Calls, Emails, Companies, Contacts, Lists** — Companies landing right
  after Emails per Jack's explicit ask. Engage's default tab changed from
  Tasks to Sequences to match.
- **Home's Lists tile now navigates into Engage's Lists tab** instead of a
  standalone view (`onNavigate` gained an optional second `EngageTab`
  argument, threaded through `App.tsx` the same way the sidebar sub-nav
  already sets `engageEntry` + expands the sub-nav).
- **Global header search removed entirely** — `HeaderSearch.tsx` deleted,
  its import/render/CSS all removed from `App.tsx`/`styles.css`. Contacts
  can still be found via the Contacts tab's own search box; nothing else
  depended on the header search.
- **"Welcome, {first name}" instead of a hardcoded "Welcome back, Jack."**
  — Home now loads the real (editable) `Profile` record itself
  (`lib/profile.ts`) and greets by its first word, falling back to
  "Jack" if no profile is saved yet. Independent load, same pattern
  `AccountPanel` already used for the same data — Home remounts on every
  navigation there anyway, so a profile edit shows up next visit.
- **History's per-entry breakdown now shows the "no signal" count** — per
  Jack, catching a real gap while looking at a real 500-row upload: "rows
  scanned for file 8/26/2026 say 500 while strong signal says 64, needs
  review 33, bad leads 43 — total 140." The math was always correct
  (`rowsScanned = duplicatesRemoved + noSignalCount + results.length`,
  same identity Scanner's own live banner already enforces) but History
  never surfaced the `noSignalCount` term — a row with zero Dynamics/
  M365/licensing signal never becomes a `ResultRow` at all
  (`scanRowUnified` returns `null` for it), so it was never in
  `entry.results` and the number had nowhere to display. Added a
  `noSignalCount` computation and a "N no signal" segment to
  `HistoryCard`'s breakdown line, matching Scanner's existing wording.
  Not a bug in the detection engine — the 64 Strong Signal figure for
  that exact file was independently confirmed correct earlier this
  session (see the "Full Strong Signal audit" section above); this was
  purely a display gap in History specifically.
- Verified live: confirmed the sidebar sub-nav starts collapsed and the
  arrow toggles it; confirmed the new order matches in both the sidebar
  and the in-page dropdown; confirmed clicking through Tasks → Calls →
  Companies while staying in Engage switches correctly each time (the
  tab-switch bug fix above); confirmed the header search box is gone;
  confirmed Home shows "Welcome, Jack." from the real Profile record.

## Contacts: tier + date filtering, and website/LinkedIn hyperlinks (app/ only)

Per Jack: "under engage in the contacts section i do want to be able to
filter by dates as well as strong signal or not as well as needs review
or bad leads" and, separately, "next to email in the contacts row we
should be able to click their website hyperlink and next to that their
linkdeln." Both build directly on data Contacts already had — no new
IndexedDB store, no new upload/persistence path.

- **`Contact.tier?: Tier`** (`lib/contacts.ts`) — a new optional field,
  same snapshot semantics as `category`/`matchedSnippet`: set from
  `ResultRow.tier` in `attachScanResultsToContacts`, overwritten fresh on
  every scan that touches that contact, not accumulated. A contact whose
  most recent scan never cleared detection at all (`scanRowUnified`
  returns `null` for a zero-signal row, so it's never a `ResultRow`) has
  no `tier` and only ever shows up under Contacts' "All tiers" bucket —
  there's no fourth "no signal" filter bucket, since that's not a
  qualification tier, just the absence of one.
- **Tier filter row** (`Contacts.tsx`) — "All tiers" plus one button per
  `TIER_ORDER` (Strong Signal/Needs Review/Bad Lead), same exact button
  styling and live-count pattern as the existing disposition filter row
  directly below it, and independent of it — a contact can be filtered by
  tier and disposition at the same time (`filtered`'s useMemo chains
  disposition → tier → date-range, same "narrows on top of search" model
  the disposition filter already established).
- **Date range filter** — two `<input type="date">` fields ("Seen ...to
  ...") next to the search/sort row, filtering on `Contact.lastSeenAt`.
  Per Jack's own clarification ("looking at dates and every file is
  associated with a month day and year"), this reuses the existing
  full-precision `lastSeenAt` timestamp Contacts already stamps on every
  merge — no new "date collected" field was added, since one already
  existed and doing otherwise would've meant tracking two overlapping
  dates. `dateTo` is inclusive of the whole calendar day (compared against
  `${dateTo}T23:59:59.999Z`), not just midnight. A small "Clear" link
  appears only once a date is set.
- **Empty-state message** now names every active filter (search term,
  disposition, tier, and/or date range) instead of just search+
  disposition, so a genuinely empty result reads as "your filters matched
  nothing" rather than looking broken.
- **Website/LinkedIn hyperlinks** — the Email column now also renders a
  small 🌐 link (when `Contact.companyWebsite` is set — see "Company
  website field, auto-derived from email domain" above) and a small "in"
  link (when `Contact.linkedinUrl` is set — manually saved via
  `ContactDetail`, or auto-filled by Apollo enrichment) directly next to
  the email text, per Jack's exact placement ask. Both are plain
  `target="_blank"` links with `stopPropagation` on click so clicking them
  doesn't also trigger the row's other click handlers; absent for a
  contact with no website/LinkedIn on file, same "—" pattern used
  elsewhere in this table.
- **Industry explicitly NOT built here** — Jack's own message named it but
  flagged it needs full Apollo company enrichment first ("industry can be
  added also but will need to enrich the data fully from apollo"); see the
  paused "Company enrichment" Roadmap item above. Not started.
- Scoped to Contacts.tsx only for this pass — Jack separately asked that
  this kind of filtering extend to "a few different areas" (e.g.
  Companies.tsx); not yet started, flagged as a likely next slice rather
  than assumed in scope here.
- Verified live: uploaded a 4-contact test batch spanning all three
  tiers (one Strong Signal Dynamics 365 hit, one Needs Review mention,
  one zero-signal row with no tier at all, one Auto-DQ'd single-seat
  Business Central mention) — confirmed each tier filter button narrows
  the table to exactly the right contact(s) and the zero-signal contact
  never shows under any tier bucket; confirmed setting a future "seen
  from" date correctly shows the empty-state message and clearing it
  restores all rows; confirmed the 🌐 website link renders with the
  correct auto-derived `https://` href for two different real company
  domains.

## Sequences: hour-granularity waits, manual/automated labels, list-based enrollment (app/ only)

Three concrete, directly-instructed tweaks to already-shipped Native
Sequences, built without a separate proposal round each (per the working
style rule — narrow, unambiguous asks building on existing mechanics).

- **Step wait now goes down to 1 hour, up to 7 days.** `SequenceStep`
  changed from `waitDays: number` (whole days only) to `waitHours: number`
  (`lib/sequences.ts`), clamped to `[MIN_WAIT_HOURS, MAX_WAIT_HOURS]` =
  `[1, 168]` by `addStep`. A step persisted before this change (which
  stored `waitDays`) still loads and works — `resolveWaitHours(step)`
  reads `waitHours` if present, else falls back to `waitDays * 24`; new
  code only ever writes `waitHours`. `Task.date` is still calendar-day-
  only (no time-of-day anywhere in this app), so a sub-day wait still just
  lands the generated task on "today" (or "tomorrow" if it crosses
  midnight) — `addHours` (replacing the old `addDays`) computes the due
  timestamp at hour precision, then still formats down to a plain
  `YYYY-MM-DD`. The step builder (`Sequences.tsx`) now has a number input
  plus an Hours/Days unit dropdown instead of a bare "days" field, with a
  visible "Fires as soon as 1 hour... or as late as 7 days" hint; the
  final value is clamped again on the backend regardless of what unit was
  used, so there's no way to submit outside the range from either the UI
  or a stale/older client.
- **Every step now shows a Manual/Automated badge.** Per Jack: "emails
  should state automated or manual so its properly built in." `CHANNEL_META`
  gained a `sendMode: "manual" | "automated"` per channel — all three
  (call/email/LinkedIn) are `"manual"` today, since nothing actually
  sends/connects yet (see the original Native Sequences section above).
  Shown via a shared `SendModeBadge` component on every step row and next
  to the channel picker in the add-step form, so the limitation is visible
  at the point of building the sequence, not just in the intro paragraph.
  The moment a channel gets real send automation (SendGrid, a LinkedIn
  API), flipping its `sendMode` here is the one place that updates every
  badge in the view at once.
- **Sequences can now be bulk-enrolled from a Custom Lead List**, not just
  picked contact-by-contact. Per Jack: "instead of adding contacts
  manually how it is now in sequences lets be able to add lists instead —
  will scan leads assign to lists then post to sequences basically."
  `lib/leadLists.ts`'s new `resolveListContacts(list, contacts)` maps a
  list's own row snapshots (`ListedLeadRow` — plain export columns, no
  direct link back to a Contact id) onto real, live Contacts via the exact
  same email-first/name+company-fallback lookup every other cross-
  referencing in this app uses (`buildContactIndex`/`lookupContact` from
  `lib/contacts.ts`). A list row that resolves to no Contact (e.g. added
  some other way, or from before that person was ever scanned) is counted
  as unresolved rather than guessed at, and that count is surfaced in the
  enrollment notice, not swallowed silently.
  `Sequences.tsx`'s enrollment section now leads with "Enroll from a Lead
  List" (a folder-style dropdown of existing lists + an "Enroll list"
  button); the original contact-checkbox picker stays right below it,
  relabeled "Or enroll specific contacts (manual)" — kept rather than
  removed, since Jack's ask was about adding the list path, not proven to
  need dropping ad hoc single-contact enrollment. Flag if the manual
  picker should come out entirely.
- Verified live: added a step at "1 hour," confirmed it displays "1h
  after previous" with a Manual badge; added a "7 days" step and a 999-
  hours step, confirmed both correctly display/clamp to "7d after
  previous" (the true 168-hour ceiling); built a Lead List from Scanner's
  bulk-action bar, enrolled it directly from Sequences, and confirmed the
  enrollment notice read "Enrolled 1 contact from '...'" with the new
  enrollment showing Active status.

## "Non Relevant" tab — manual review of zero-signal rows (app/ only, Scanner)

Per Jack, catching a real gap while looking at a real 500-row upload
("500 rows read... 342 had no Dynamics 365/M365/Azure/licensing signal
(not shown below)"): "i do still want to be able to see the 342 here in
a view next to bad leads... i want to be able to review every lead if i
want to... for manual review purposes." Named "Non Relevant" per Jack's
own explicit label.

- **What these rows are.** `scanRowUnified` (`lib/detection.ts`) already
  returns `null` for any row with zero Dynamics/M365/licensing signal at
  all — such a row never becomes a `ResultRow`, so it's invisible
  everywhere else in the app (Scanner's normal tabs, History, Contacts'
  tier field). This tab is the first place these rows are ever actually
  shown, not just counted.
- **`scanParsedFiles` now also returns `noSignalRows: NoSignalRow[]`** —
  a deliberately separate, much lighter shape than `ResultRow` (company/
  contact/title/email/phone/notes/source file only) rather than a fake
  `ResultRow` with an empty tier — these rows never ran through
  detection, so giving them a tier/category would misrepresent them as
  scored when they weren't.
- **Scanner-only, current-batch-only — deliberately NOT persisted into
  History.** The capacity audit earlier this session flagged that History
  already keeps every row's full raw CSV data forever with no cap;
  adding a second, larger "everything that didn't match" array to that
  same unbounded store would only make that worse. `noSignalRows` lives
  in Scanner's own local state, set by `handleFiles`/`loadFromLibraryPicker`
  the same way `lastScanStats` already is, and cleared on "Start over."
  Reopening a batch from History does NOT restore this tab (the raw rows
  were never kept) — a real, deliberate scope limit, not an oversight.
- **A 5th tab, not folded into the existing tier filter.** `Tier` is
  `"signal" | "mention" | "dq"` — a no-signal row was never scored, so it
  doesn't have a real tier value to filter on. Rather than inventing a
  fake 4th `Tier`, "Non Relevant" is its own toggle (`showNoSignal`,
  `Scanner.tsx`) that swaps out the entire category-filter/sub-view/bulk-
  action/table section for a separate, read-only `NonRelevantTable`
  component — same "next to Bad Leads" placement Jack asked for in the
  tab row, but functionally independent of `tierFilter`. Clicking any of
  the three real tier tabs (or "All") turns it back off.
- **Read-only by design** — no checkboxes, no bulk actions, no download,
  no Library filing, matching the "for manual review purposes" framing:
  this is a look-and-decide-by-hand view, not a fourth processing bucket.
  The Notes column shows the row's raw Comments text (truncated, full
  text on hover) specifically so a manual review has enough to actually
  judge the lead by, not just identify it.
- Verified live: uploaded a 3-row batch (1 Strong Signal, 2 with no
  product/licensing language at all) — confirmed "Non Relevant (2)"
  appears in the tab row with the right count, clicking it shows both
  skipped leads with their real company/contact/notes text and hides the
  category-filter row entirely, clicking back to a real tier tab restores
  the normal table, and "Start over" clears the tab along with everything
  else.

## Home rebuilt: sidebar everywhere (incl. Home), Modules tile grid removed, self-serve Weekly Goals metrics board (app/ only)

Per Jack: "fix the home page format... to not have the side bar just
here and have weekly goals metrics that can be pulled and set how many
outbound calls call backs incoming voicemails etc//build this out with
little functonalities yet but we will slowly build this into a full
blown metric board" — then a direct follow-up correction once he saw it:
**"no i want everything on the left handside nothing under modules."**
Net result below is the corrected, final shape — the sidebar is
unconditional again (same as before this whole change) and Home's old
"Modules" tile grid is gone entirely, not just de-emphasized, since the
sidebar already covers every one of those links.

- **Sidebar unconditional again — Home included.** `App.tsx`'s `<aside>`
  briefly went conditional on `view !== "home"` mid-session; per Jack's
  explicit correction it's back to rendering on every view, same as
  always. Home's own module tiles/`onNavigate`/`onOpenCheatSheet`
  plumbing were removed with it (`Home.tsx` no longer takes those props
  at all) — the sidebar is now the only navigation surface, not a
  duplicate of one.
- **`lib/weeklyGoals.ts`** (new) — `WeeklyMetricEntry {id, label, target,
  actual, autoSource?}` and `WeeklyGoals {weekKey, metrics}`, one record
  per Monday-start week (same convention as `lib/tasks.ts`/`lib/
  history.ts`), new IndexedDB store `STORE_WEEKLY_GOALS` (`DB_VERSION`
  bumped 9→10). Deliberately a generic list of named metric rows, not
  fixed fields — adding a metric later is "+ Add metric," not a code
  change, which is the actual mechanism behind "we will slowly build
  this into a full blown metric board."
- **Three default metrics, matching Jack's exact list**: Outbound calls,
  Call backs, Incoming voicemails. Only "Outbound calls" is auto-computed
  (`autoSource: "outboundCalls"`) — its actual is pulled live from
  completed call-channel Tasks whose date falls in the current week
  (`computeAutoActual`), the one metric with an existing, reliable data
  source. Call backs and Incoming voicemails have no existing signal
  anywhere in the app yet, so they're plain manually-tracked numbers
  Jack updates by hand — matches his own "pulled and set" phrasing:
  Outbound calls is pulled, everything else is set, for now.
- **Bug found and fixed before shipping: default metrics used random
  ids, computed independently in two places.** The very first edit to a
  brand-new (never-yet-saved) week's metrics silently vanished — a value
  typed into "Call backs" actual snapped straight back to 0 the moment
  React re-rendered. Root cause, confirmed live via direct DOM
  inspection: `defaultMetrics()` originally called `newId()` (random)
  for each of the three built-in metrics, and it was being called from
  TWO separate places before anything was ever persisted — once in
  `App.tsx`'s render-time `getOrCreateCurrentWeekGoals()` (to show the
  panel) and again inside the save path's own fallback (when no record
  existed yet in state to update) — producing two DIFFERENT random id
  sets for the "same" default metrics. An edit's id (from the rendered
  set) never matched anything in the save path's freshly-regenerated
  set, so the update silently no-opped, and the subsequently-persisted
  (still-zeroed, differently-keyed) default record then replaced the
  displayed rows on re-render — each row keyed by `m.id` in React,
  so the id change forced a fresh mount back at 0. Fixed by giving the
  three built-in metrics fixed, deterministic ids
  (`"default-outbound-calls"` etc.) instead of random ones — every
  `defaultMetrics()` call now agrees regardless of where/when it's
  called, so this class of mismatch can't happen. A metric added later
  via "+ Add metric" still gets a real random id — safe, since the
  record already exists in state with stable ids by then.
- **`updateWeeklyMetric`/`addWeeklyMetric`/`removeWeeklyMetric`
  (`App.tsx`) read `prev` from inside a functional `setWeeklyGoals`
  updater**, never an outer closure — same stale-closure-avoidance
  pattern as `finishTerminalEnrollments` — so two edits fired in quick
  succession (e.g. typing into both a metric's target and actual field)
  can't race and silently drop one of them.
- Verified live: typed into a metric's actual and target fields back to
  back, confirmed both values stuck (not just the second one) and the
  progress bar read the correct percentage; added a custom "Meetings
  booked" metric, reloaded the page, confirmed it and every edited value
  survived; removed it and confirmed it's gone; after the correction,
  confirmed the sidebar renders on Home exactly like every other view and
  stays present navigating to Scanner and back, and confirmed no
  "Modules" heading or tile grid remains anywhere on Home.

## Save to Lead Library moved after scan (app/ only, Scanner)

Per Jack: "i want to be able to store strong signals in files after
theyre scan... put it after so i can store after uploading." Previously
"Save this batch's Strong Signal leads to the Lead Library" was a
pre-upload checkbox + month picker on the landing screen, decided before
the scan even ran; it's now a post-scan action on the results screen, so
the decision happens after actually seeing what came back.

- **The checkbox is gone from the landing screen** — the "New upload"
  card that held it was removed entirely. The "Load from the Lead
  Library" folder/file picker (a separate feature — pulling an existing
  Library file back into Scanner) stays exactly where it was; only the
  save-related card moved.
- **A new bordered row at the top of the results screen** — "Save this
  batch's Strong Signal leads to the Lead Library" + the same month
  picker + a button, right below the filename/"Start over" row so it's
  the first thing visible once results load, before scrolling to the
  tier tabs.
- **One-shot per batch, same as before** — `fileSignalRowsIntoGroup`
  appends rows with no dedupe check against what's already filed (each
  row gets a rowKey but it's never checked against existing rows), so a
  second click for the same batch would create real duplicate rows in
  the Library file. The button disables itself (reads "✓ Filed") the
  moment filing succeeds, and resets on "Start over" or a fresh upload —
  functionally identical to the old checkbox's "decide once per upload"
  contract, just moved to fire after the scan instead of before it.
- **`currentHistoryEntryId` (new Scanner state)** — the History entry
  this exact batch was recorded under, captured from `onRecordHistory`'s
  return value the moment the scan runs (`handleFiles`/
  `loadFromLibraryPicker`), so the later "Save to Lead Library" click can
  still correctly stamp `StoredRow.__historyEntryId` — the same field a
  bug fix earlier this session (see "Contact tasks") depends on being
  right. Filing was previously inline inside the scan itself, where the
  freshly-created History entry's id was right there in scope; deferring
  it to a separate click meant that id had to be threaded through state
  instead.
- Verified live: confirmed the landing screen no longer shows any
  pre-upload save checkbox while "Load from the Lead Library" is
  untouched; uploaded a CSV, confirmed the new "Save to Lead Library" row
  appears on the results screen; clicked it, confirmed the "Filed 1
  Strong Signal lead..." notice appeared, the button switched to a
  disabled "✓ Filed," and the sidebar's Lead Library count incremented
  from 0 to 1.

## Sequence steps: AI system/user prompt fields (app/ only, data capture only)

Per Jack: "create a text body in sequence for ai prompting like apollo
has user prompt input and system prompt input for steps like emails."
Mirrors Apollo's system-prompt/user-prompt pair, but this app has no
LLM/AI integration at all yet (no API key, no `window.claude.use("mcp")`
AI call anywhere), so this is deliberately data-capture-only for now —
same "captured now, wired in later" pattern as the channel Manual/
Automated badges.

- **`SequenceStep` gained two optional fields**, `systemPrompt`/
  `userPrompt` (`lib/sequences.ts`) — plain text, available on any
  channel (not email-only; Jack's own "like" phrasing read as a category,
  not a restriction). `taskTextFor` (what a step's generated Task text
  actually reads) is untouched — these fields have zero effect on
  anything a step currently does.
- **Per-step "🤖 AI prompt" toggle** (`Sequences.tsx`) next to each step's
  move/remove buttons — collapsed by default, shows a small "✓" once
  either field has real content. Expands to two textareas (System
  prompt, User prompt) with a plain-text disclaimer above them: *"nothing
  calls any AI with these yet."* Saved on blur via a new `updateStep`
  (`lib/sequences.ts`) and `onUpdateSequenceStep` handler chain (App.tsx
  → Engage.tsx → Sequences.tsx), threaded the same way `onAddStep`/
  `onRemoveStep` already are.
- Verified live: added an email step, opened its AI prompt editor, typed
  a system and user prompt, confirmed the toggle shows a checkmark;
  collapsed and reopened the editor and confirmed both values round-trip
  correctly (not lost, not stale); reloaded the page and confirmed both
  prompts persisted through IndexedDB.

## Perf fix: Contacts/Companies rendered every row at once (app/ only)

Per Jack: "companies, lists, and contacts take time to load — figure out
this flaw." Root-caused by measurement, not guesswork: seeded a real
3,000-contact / ~1,000-company directory and timed each Engage tab.

**Measured before the fix** (3,000 contacts):

| | before | after |
|---|---|---|
| Contacts tab switch | **4,998 ms** | **65 ms** |
| Companies tab switch | 535 ms | 43 ms |
| Lists tab switch | 232 ms | 21 ms |
| DOM nodes in `<main>` (Contacts) | **77,500** | 717 |
| Typing 5 chars in Contacts search | 1,267 ms | 169 ms |

- **The flaw**: `Contacts.tsx` and `Companies.tsx` both rendered
  `filtered.map(...)` — EVERY row, unpaginated — while Scanner's results
  table has always sliced to `PAGE_SIZE = 25`. At Jack's real volume that
  put ~26 DOM nodes per contact row × 3,000 rows into one view, and every
  keystroke in the search box re-rendered all of them.
- **Why Lists looked slow too** (it has almost no content of its own):
  switching AWAY from Contacts made React tear down those 77,500 nodes
  first. Once Contacts is paginated, that cost disappears — which is why
  Lists got 11× faster without a single change to `Lists.tsx`.
- **The fix**: the same 25-per-page slice + Prev/Next pager Scanner
  already uses, in both components, plus a `useEffect` that resets to
  page 1 whenever search/sort/filters change (otherwise narrowing 3,000
  contacts to 12 while sitting on page 40 shows an empty table).
  Selection for "Enrich via Apollo" is a `Set` of ids, so it survives
  paging untouched.
- **Not changed**: `Lists.tsx` still renders every row of an *expanded*
  list unpaginated. That's latent — only a problem if a single list grows
  into the hundreds — and it wasn't part of the measured slowdown. Flagged
  rather than pre-emptively changed.
- Verified live: pager reads "Showing 1–25 of 3000 · Page 1 of 120",
  Next advances to 26–50 with genuinely different rows, and applying a
  tier filter (→ 1,832) or a search (→ 333) both correctly snap back to
  page 1. Companies behaves identically (1–25 of 1,000).

## Home: start-of-day dashboard (app/ only)

Per Jack, verbatim: "Welcome screen should say the day, how many calls have
been made, follow ups if any were set for that day with the time, and be a
metric dashboard when people login — this is what they see to start their
day." Purely additive to the existing Home (greeting banner + stat-pill row
+ Weekly Goals) — the module tile grid stays removed, the sidebar is
untouched, and Weekly Goals sits below the new panel exactly as before.

- **Today's date, prominently** — a small uppercase line above the
  "Welcome, {firstName}." greeting ("Tuesday, September 1, 2026"), plus the
  same label repeated on the new panel's own header. Formatted from
  `todayDateKey()` at local noon (`new Date(\`${today}T12:00:00\`)`) so a
  timezone offset can never render yesterday's weekday.
- **New "📅 Today" panel** (`TodayPanel`, local to `Home.tsx`), between the
  banner and Weekly Goals. Two parts:
  - **A four-tile day metric row**: Calls made today, Emails sent today,
    Follow-ups due today, Meetings booked. The first two come from
    `countCompletedChannelTasks(tasks, channel, today, today)` — a new
    exported helper in `lib/weeklyGoals.ts` that `computeAutoActual` (the
    Weekly Goals board's auto "Outbound calls" metric) was refactored to
    call as well, so the day and week numbers can never drift on what
    counts as a made call. "Meetings booked" counts Contacts whose
    `disposition === "meeting-booked"` — the same persistent, sticky field
    every disposition view already reads; no new field, no new store.
  - **Today's follow-ups list**: every Task with `date === today` and
    `!done`, showing time, channel icon, priority badge, task text, and
    the linked Contact's name/company (resolved from the `contacts` array
    App.tsx already holds). Each row's checkbox calls **the same
    `onToggleTask` App.tsx passes to the Board/Calls/Emails** — so
    completing a sequence-generated task from Home still advances its
    enrollment, no parallel path. Empty state points at Engage →
    Contacts/Calls/Emails.
- **`Task.time?: string \| null` ("HH:MM", 24h)** — the first time-of-day
  anywhere in this app, added strictly optional/additive, exactly the
  pattern `contactId`/`priority`/`channel`/`sequenceEnrollmentId` already
  set: every existing task (and any new one created without picking a
  time) reads `null` and behaves precisely as before. `date` is still the
  only scheduling key — nothing computes off `time` except display and the
  Home list's ordering. Settable in both places a contact/channel task is
  created: `Contacts.tsx`'s `AddContactTaskForm` "+ Task" and
  `ChannelTasks.tsx`'s "+ Call"/"+ Email" form (a plain
  `<input type="time">` next to the existing date field, blank by
  default). Threaded as a trailing optional param through
  `createContactTask` → `App.tsx`'s `addContactTask` → `Engage.tsx` →
  `Contacts.tsx`/`ChannelTasks.tsx`, so no existing call site changed
  meaning. Calls/Emails rows now render `date · time` when a time is set.
- **Ordering** (`compareByTimeThenCreated`, `lib/tasks.ts`): timed tasks
  first, in time order; untimed tasks after them in creation order — an
  absent time is never treated as 00:00, the same "a missing value doesn't
  become 0" convention the Dynamics seat-count sort already follows. An
  untimed row renders the word "Anytime" rather than a blank cell.
- Two small shared helpers were added to `lib/tasks.ts` alongside it —
  `todayDateKey()` (several components computed this inline) and
  `formatTaskTime()` ("14:30" → "2:30 PM", locale-formatted, "" for
  untimed).
- Verified live (Playwright, preview build, real IndexedDB): Home renders
  "Tuesday, September 1, 2026" and the empty state with all four metric
  tiles at 0 before any data; after seeding contacts via a Scanner CSV
  upload and adding two call tasks for today (one at 09:30, one untimed),
  Home listed them in exactly that order ("9:30 AM … Morning check-in"
  then "Anytime … Untimed follow-up") with contact/company, channel icon
  and priority badge, and read "0 calls made / 0 emails sent / 2
  follow-ups due"; checking the 9:30 row off from Home flipped the tiles
  to "1 call made / 1 follow-up due" and dropped it from the open list;
  adding a 15:45 task from Contacts' "+ Task" form put "3:45 PM" at the
  top of Home's list ahead of the untimed one, and it survived a full page
  reload. No app console errors.
- Deliberately not done: no time on plain Board tasks (`createTask` is
  untouched) or on Sequence-generated steps (`createSequenceTask` still
  writes no time — sequence waits are hour-precision internally but land
  on a calendar day, see "Sequences: hour-granularity waits"); no editing
  a time after creation; no time column on the Board/Contacts tables. Flag
  if any of those are wanted next.

## Sequences: owners, groups, pause/archive, copy (app/ only)

Per Jack: "build out sequences to have sequence owners by users
associated with the platform and have credentials // should be able to
group sequences also edit and delete as well as pause/activate + archive
if need be and copy which duplicates it exactly."

**The credentials half is NOT built, deliberately.** `lib/users.ts` is a
roster for ATTRIBUTION, not AUTHENTICATION — there is one shared password
(`lib/auth.ts`) and no server, so an owner stamp says who a sequence
belongs to, never who may open the app or act as whom. Anyone who unlocks
the app still sees and edits everything regardless of owner. Adding a
password field to a user record would be actively misleading. Real
per-user sign-in is the same unmade backend decision as the email
sign-in-code thread (see Access & ownership and the Roadmap). The roster
is built so a real account can bind to an existing user id later without
re-attributing every sequence. The UI says all of this in plain text
under the roster rather than implying a login exists.

- **`lib/users.ts`** (new, `STORE_USERS`) — `PlatformUser {id, name,
  email, role, isSelf}` with roles Owner/Admin/Rep. The roster always
  contains "you", seeded once from the local Profile so there's always
  someone to attribute to. Editable inline in Profile & Access, which
  replaced its disabled "+ Invite teammate" placeholder with a real
  add/edit/remove list. Removing a user clears them off any sequence they
  owned rather than leaving a dangling id.
- **`lib/sequenceGroups.ts`** (new, `STORE_SEQUENCE_GROUPS`) — folders for
  sequences, same shape as the Lead Library's own `LibraryGroup`, and the
  same rule: **deleting a group never deletes the sequences in it**, they
  just become ungrouped. Managed from a "🗂 Groups" panel; the sequence
  list renders one section per group with "Ungrouped" last.
- **`Sequence` gained `status`, `ownerId`, `groupId`, `archivedAt`** — all
  optional, so every sequence saved before this still loads (an undefined
  status reads as "active" via `resolveStatus`). `DB_VERSION` 10→11.
- **Pause/archive gate real behavior, they are not labels.** A
  non-runnable sequence takes no new enrollments (`enrollContact` returns
  null — the UI disables the controls too, but that function is the real
  guard) and generates no new step tasks: completing an already-open task
  still counts, but the enrollment parks on its next step with no open
  task. `resumeEnrollments` regenerates that task when the sequence is
  reactivated, so pausing suspends rather than strands people mid-sequence.
- **Copy duplicates exactly** — steps deep-copied with fresh ids (a shared
  step id would make two sequences edit each other), owner and group
  carried over, named "… (copy)", always starting active. Enrollments are
  deliberately NOT copied: they belong to the original's contacts and
  their in-flight tasks, and duplicating them would generate a second live
  task per person.
- **Bug found and fixed during verification: pausing made the card vanish.**
  The status filter defaulted to "Active only", so clicking Pause instantly
  filtered the sequence out of view — leaving no reachable Activate button.
  Confirmed live before fixing. The filter is now **Live (active + paused,
  the default) / Archived / All**: archiving is the action that removes
  something from the default list, pausing just stops it running. That
  distinction is the whole point of having both.
- Verified live, 16/16 checks, zero console errors: added a teammate to
  the roster; created a sequence, assigned it that owner and a new group;
  copied it and confirmed the copy carried the step; enrolled a contact;
  paused it and confirmed the "no new enrollments or step tasks" notice
  plus a disabled enroll button; archived it and confirmed it left the
  Live list and appeared under Archived; reactivated it back into Live;
  reloaded and confirmed owner, group and copy all survived — and read
  IndexedDB directly to confirm `ownerId`/`groupId`/group name really
  persisted rather than trusting the render.

## Auto-DQ: CRM-metadata-only rows ("F1 / Company Tenant Partner")

Per Jack: "stuff like f1 company partner or something is a bad lead."
Grounded in real rows from his own 500-row export (see "Full Strong
Signal audit" above): **1st care Palliative and Hospice** and **D'Amico
Hospitality** had a Comments field containing nothing but
`"F1 / Company Tenant Partner"` — a CRM product-code + partner-type
label, not a person saying anything — yet both cleared Strong Signal
purely off a `msp_primaryproductcodename` column hit.

- **`CRM_METADATA_ONLY_DQ_LABEL`** ("CRM metadata only, no lead content"),
  checked in `getDQReasons` against the resolved **comments** field.
- **Deliberately a WHOLE-FIELD test**, unlike every other `DQ_RULES`
  entry (which are substring regexes against the combined text). A real
  lead that mentions F1 inside an actual sentence — "We need F1 licenses
  for 200 frontline workers" — must NOT be disqualified. The rule strips
  label-ish tokens (f1/f3/e1/e3/e5/g1/g3/g5, company, tenant, partner,
  customer, account, prospect, lead, contact, reseller, csp, direct,
  indirect, n/a, null, none, unknown, tbd, pending) plus punctuation, and
  only fires when **nothing** is left. A 60-character cap keeps it off
  genuine prose regardless.
- **Empty comments do not trigger it** — a row can legitimately qualify
  off a Product Area column with no notes at all; that's a different
  question and wasn't what Jack flagged.
- Verified: 14/14 boundary cases in a direct unit check ("F1 / Company
  Tenant Partner", "Company Tenant Partner", "F1", "Partner", "N/A",
  "NULL" all DQ; "F1 licenses for 200 frontline workers", "Wants a CSP
  partner for Azure billing", "Looking at E3 licensing for 40 users",
  "Company Tenant Partner - interested in Dynamics" all pass through).
  Then live: a 3-row file scanned to 2 Strong Signal / 1 Bad Lead, with
  the metadata-only row carrying the new reason and the F1-in-a-sentence
  row untouched at Strong Signal.

## Apollo-style visual pass: white ground + green/blue "wire" lining

Per Jack: "change the background to a more apollo like interface with
white background with the green blue wired lining coming through
separating pages sections tabs and making it look cleaner."

**Honest limitation, stated up front:** apollo.io is blocked by this
environment's network egress, so the "deep scan of Apollo's UI" Jack
asked for could not be performed. This pass is built from his own written
brief plus the app's existing token system — not from a live look at
Apollo. Screenshots would let this be tightened properly.

- **Tokens (`styles.css`)**: `--bg` moved from the flat grey `#eef0f2` to
  plain **white**; `--border` lightened to `#e4e9ed`; `--surface-sunken`
  to `#f6f8f9`. Definition now comes from hairline borders and the accent
  wire rather than a tinted backdrop. The blue already used ad hoc for
  LinkedIn/meeting-booked was promoted to a real token,
  `--accent-blue: #0a66c2`, alongside the existing brand green.
- **The "wire"** — `linear-gradient(90deg, var(--accent), var(--accent-blue))`
  — is defined once and reused so the treatment can't drift: as the
  header's bottom rule (via `border-image`), as `.wire-rule` / `.wire-top`
  utilities, and as the fill on every active tab/filter pill.
- **Active states stopped being heavy dark pills.** The sidebar's active
  item is now an accent-tinted row with a 3px green inset rail (Apollo's
  lit-rail idiom) instead of a solid `--ink` block. Tab/filter pills
  across Scanner, Contacts, Sequences, History, Library and the Cheat
  Sheet switched from `#081E22` to the wire gradient; their inactive
  fills moved from one-off hexes (`#F6FAFA`, `#E9EBEF`, `#4C6167`) onto
  the shared tokens so they follow the white ground.
- Verified live: computed `body` background is exactly `rgb(255,255,255)`,
  the header's border-image resolves to the green→blue gradient, and the
  active sidebar item computes to an accent tint with a
  `rgb(44,194,149) 3px inset` rail.

## Home banner: sales-motion metrics instead of data volume

Per Jack: "change contacts below welcome jack to assigned tasks instead
and active sequences as another meetings booked on the week another
follow up leads as another." The banner's four stat pills went from
counts of how much data is in the system (Lead Library / Contacts / Open
tasks / Uploads) to what the day actually looks like:

- **Assigned tasks** — open tasks tied to a specific contact (someone is
  on the hook), as opposed to a loose personal to-do on the Board.
- **Active sequences** — sequences whose status resolves to active, with
  the live enrollment count across them on hover.
- **Booked this week** — required a real data change: `disposition`
  carries no timestamp, so this could only ever have been an all-time
  number. `Contact.meetingBookedAt` (`lib/contacts.ts`) is now stamped on
  the transition INTO meeting-booked, kept while it stays booked, and
  cleared if the disposition moves away (so a re-book re-stamps). Scoped
  to the Monday-start week, matching every other week boundary in the app.
- **Follow-up leads** — distinct contacts with an open follow-up, so two
  tasks on one lead count once.

## Home: per-user "what's on my plate" view + a Notifications panel (app/ only)

Per Jack, two asks in the same thread: "On the home page flag emails
scheduled for delivery also emails sent today by each user // emails
replied to//any outstanding tasks or missed dates for sequences or their
tasks add a notification button also for tasks to update to and anything
set follow ups," then the reframing that decided the shape of the build:
"I want to make the home page esentially a welcome everyday people log on
and when they click it at a high level they can see anything they need to
act on and can see whats fully on their plate for that user."

- **"Emails replied to" has no real data source — built as a manual flag,
  stated plainly.** This app has no email send/inbox integration anywhere
  (see the Roadmap's SendGrid item and the new Email accounts feature
  below) — nothing here could ever detect a real reply. `Task` gained
  `repliedAt?: string | null` (`lib/tasks.ts`) and `userId?: string | null`
  (which platform user, `lib/users.ts`, a task is assigned to) — both
  optional/additive, so every task before these fields existed is
  unaffected. A new "Mark replied" / "✓ Replied" toggle button on
  email-channel task rows in Engage → Emails (`ChannelTasks.tsx`) is the
  ONLY way `repliedAt` is ever set — never inferred, never auto-detected.
  Same honesty pattern as `Contact.outreachStatus`/disposition elsewhere
  in this app.
- **"Assign to" on Calls/Emails tasks.** `ChannelTasks.tsx`'s "+ Call"/
  "+ Email" quick-add form gained a user picker (defaults to the self
  user), threaded through `createContactTask`'s new optional trailing
  `userId` param → `App.tsx`'s `addContactTask` → `onAddContactTask`. An
  assigned task shows a small blue name badge on its row. A generic
  `App.tsx` handler, `updateTaskFields(id, patch)`, was added for both
  `userId` and `repliedAt` — same safe functional-updater pattern as the
  existing `editTask`.
- **"Viewing as" — Home's per-user scoping.** A new selector in Home's
  banner (`Home.tsx`), defaulting to the local self user (`SELF_USER_ID`,
  `lib/users.ts`), with an "Everyone" option for the original all-up view.
  Scopes `tasks`/`sequences`/`enrollments` used everywhere on the page —
  the banner's Assigned tasks/Active sequences/Follow-up leads stats, the
  Today panel, and the Notifications panel below. **A task or sequence
  with no `userId`/`ownerId` set stays visible under ANY selected
  person** rather than silently disappearing — same "don't orphan legacy
  data" rule this app already applies elsewhere (e.g. `StoredRow`'s
  optional View-tab flags) — since every task/sequence created before
  these fields existed has neither. "Meetings booked" stays a whole-team
  number regardless of who's viewed — there's no per-rep attribution on
  `Contact.disposition` anywhere in this app, and guessing at one would
  be worse than being honest that it's not scoped.
- **`NotificationsPanel`** (new, bottom of `Home.tsx`, per Jack's own
  follow-up instruction to place it "towards the bottom half" of the
  page) — a collapsible 🔔 card (closed by default, an "N overdue" badge
  when there's something actionable) with six sections, all reading off
  the same "Viewing as"-scoped task list:
  - **Outstanding & overdue tasks** — any channel, `date < today`, open.
  - **Missed sequence steps** — the subset of the above carrying a
    `sequenceEnrollmentId`, called out separately since a stalled
    sequence step is a different kind of problem than a personal to-do
    slipping.
  - **Upcoming follow-ups** — any open, contact-linked task dated after
    today (not just today's, which the existing Today panel already
    covers) — directly answers "anything set follow ups."
  - **Emails scheduled for delivery** — open email-channel tasks dated
    after today.
  - **Emails sent today, by user** — deliberately reads from the
    UNSCOPED task list regardless of which person "Viewing as" has
    selected, since the entire point of this one row is the per-rep
    breakdown Jack asked for ("by each user"). Grouped by `userId`
    (an "Unassigned" bucket catches tasks with none).
  - **Emails replied to** — the manually-flagged tasks from the "Mark
    replied" feature above, each with an inline "✕" to unmark it.
- Checking a task off from any Notifications row reuses the exact same
  `onToggleTask` App.tsx already passes everywhere else (Board/Calls/
  Emails/the existing Today panel), so a sequence-generated task
  completed from here still advances its enrollment.
- Verified live (Playwright, preview build, real IndexedDB, 17/18 checks
  — the one non-pass was a font/favicon load blocked by this sandbox's
  own network egress policy, unrelated to the app): seeded a contact via
  a Scanner CSV upload; added an email task assigned to the self user and
  confirmed the assignment badge renders with the real profile name;
  marked it done and confirmed it appears under "Emails sent today, by
  user" with the correct per-user count; used "Mark replied" and
  confirmed it moved into "Emails replied to"; added a second, future-
  dated email task and confirmed it appears under "Emails scheduled for
  delivery" with the right date; confirmed switching "Viewing as" to
  "Everyone" doesn't blank or error the page.

## Email sending accounts — sender-identity scaffolding for Sequences (app/ only, not a live connection)

Per Jack: "Add in an ability to connect emails so we can fire sequences
will loop in sengrid eventually and go that route to build it out." This
is a new network-dependency-shaped ask (Working style's standing rule),
so it's built exactly as narrow as that phrasing supports: SendGrid is
confirmed as the intended direction, but nothing here calls SendGrid or
stores anything capable of doing so — read the warning below before
extending it.

- **Why there's no API key field, deliberately.** This app has no backend
  (see Access & ownership — one shared password, no server). A SendGrid
  API key is a secret that can send email as Jack's own domain; a key
  like that has to live on a server that keeps it out of client-visible
  code. Storing one in this app's IndexedDB would put it in plain text,
  readable by anyone with the shared password (or just this browser) via
  devtools — a real security regression, not a shortcut worth taking.
  So "connecting" an account here captures ONLY a sender identity — a
  label, a from name, a from email — never a credential.
- **`lib/emailAccounts.ts`** (new, `STORE_EMAIL_ACCOUNTS`, `DB_VERSION`
  bumped 11→12) — `EmailAccount {id, label, fromName, fromEmail,
  provider: "sendgrid", connected, createdAt}`. `connected` is a real
  field, always `false` today, kept (not hardcoded in the UI) so
  flipping it to `true` is the one place that changes once a backend
  relay to hold the key server-side actually exists.
- **`Sequence` gained `emailAccountId?: string | null`** (`lib/
  sequences.ts`) — which account a sequence's email steps should send
  from once real sending exists. Purely a stored preference: email steps
  still only ever generate a manual task exactly as before (`taskTextFor`
  is untouched), same "captured now, wired in later" pattern already
  used for the AI system/user prompt fields and the channel Manual/
  Automated badges. Carried over by `duplicateSequence`'s "copy which
  duplicates it exactly."
- **UI, in `Sequences.tsx`** — a "✉️ Email accounts (N)" button next to
  the existing "🗂 Groups" button opens a management panel (add/edit/
  delete accounts, same inline-edit pattern as Groups) that leads with an
  explicit, un-missable note: *"Not a live connection yet... there's no
  SendGrid API key or backend here to actually send through."* Every
  account row also carries a small "Not connected" badge. Each expanded
  sequence's Owner/Group row gained a third "Send from" selector; deleting
  an account clears any sequence pointing at it back to "None selected"
  rather than leaving a dangling id (same rule `deleteUserFromDB`/
  `deleteSequenceGroupById` already follow).
- Verified live: added an account ("Wired CIO Outbound" / "Jack at Wired
  CIO" / a from-email), confirmed it lists with the "Not connected" badge;
  created a sequence, set its "Send from" to that account, and confirmed
  the sequence's summary line reads "· sends from: Wired CIO Outbound."

## Scanner UI redesign + one sans type system (app/ only)

Per Jack: "lets check the ui and deep dive functions commands button
builds how it looks use more hubspot inspirations and apollo for
inteface," then narrowed to "lets attempt to redesign the ui for the
scanner and make this more defined and built out // change no
functions." **Styling only — every handler, prop and piece of state in
Scanner.tsx is byte-for-byte unchanged**, confirmed by a 15-check live
functional pass (tier tabs, product-line chips, both View-tab sets, the
seat-count sort, search, row selection, every bulk action, the Non
Relevant tab, per-row controls) after the rework.

**Honest limitation, again**: apollo.io is blocked by this environment's
network egress (same as the earlier Apollo restyle pass), so this is
built from HubSpot/Apollo's established interface conventions plus a
screenshot sweep of this app's own screens — not from a live look at
either product.

- **One sans type system, app-wide.** Headings used a serif display face
  ("Fraunces"), which is the single biggest reason the app read as an
  editorial page rather than a working tool. `index.html` now loads Inter
  instead of Fraunces/Hanken Grotesk, `styles.css` sets one sans stack
  for body AND headings (weight/tracking carry hierarchy instead), and
  `font-variant-numeric: tabular-nums` is global so every table column,
  KPI tile and count badge lines up. The `.app-mark`/`.account-avatar`
  serif references went with it.
- **A real UI kit in `styles.css`** (`.panel`/`.panel-head`/`.panel-body`,
  `.btn` + `-primary`/`-secondary`/`-ghost`/`-danger`/`-warn`/`-sm`,
  `.field`, `.kpi`, `.toolbar`/`.toolbar-row`, `.seg`/`.seg-btn`,
  `.chip-btn`, `.bulkbar`, `.table-card`/`.data-table`, `.pager`) so
  buttons and tables stop being a dozen one-off inline styles. Brand
  hues, the green→blue "wire" gradient on active tabs/chips, and every
  documented View-tab set are unchanged.
- **Scanner specifically**: a page bar (title + per-file chips + Start
  over) replacing a bare filename line; Save-to-Lead-Library and Final
  downloads as titled panels with subtitles instead of loose rows; a
  denser KPI rail strip; **the four stacked filter rows across two
  bordered containers consolidated into one hairline-divided toolbar**
  (tier segmented control + Non Relevant + Duplicates/Priority toggles on
  row 1, product line + sort + search on row 2, View tabs on row 3);
  the bulk-action bar regrouped with labeled sections and dividers; and
  a real data table with a sticky uppercase header, even row heights (a
  3-line clamp on the matched snippet), non-wrapping contact/tier cells
  and no clipped columns at 1440px.
- Verified live at 1440px with screenshots before/after plus the 15-check
  functional pass; also confirmed the Non Relevant table picked up the
  same table styling.

## Contacts: Record Details (app/ only)

Per Jack: "Build out for contacts // Record Details with the matched
snippet or notes, lists theyre attached to and sequences plus the user
owner and last activity dat with the date and how many days ago it was
email call or however communication was mad the product lines and
cetegorys associated." Built into the existing `ContactDetail.tsx`
modal as one "Record details" panel above the existing scan/website/
LinkedIn/outreach sections.

- **Owner** — `Contact.ownerId?: string | null` (`lib/contacts.ts`), the
  only writable field in the panel. Set by hand only; never inferred
  from a scan, an upload or a task assignment, since none of those carry
  real ownership. Optional, so every contact captured before it existed
  reads as unowned rather than being attributed by guesswork.
- **Last activity** — the most recent COMPLETED task for that contact
  (`lastActivityForContact`, `lib/tasks.ts`), showing the date, how many
  days ago, the channel (📞 Call / ✉️ Email / plain Task), and the task
  text. Open tasks don't count: something scheduled for next week isn't
  activity that happened.
  - **Bug found and fixed during verification**: it first read "-1 days
    ago." A task's `date` is when it was SCHEDULED — a sequence step due
    tomorrow can be completed today — so scheduling date can't answer
    "when was this contact last worked." `Task.completedAt?: string |
    null` was added (`lib/tasks.ts`), stamped by `App.tsx`'s `toggleTask`
    when a task is marked done and cleared when it's un-done; last
    activity reads that stamp, falling back to `date` for any task
    completed before the field existed, and clamps days-ago at 0.
- **Product lines & categories** — the union of the scan-derived
  `Contact.category` and the categories carried by that contact's rows on
  any Custom Lead List, plus their tier and disposition badges. Plural,
  per Jack's wording, without inventing a new field.
- **Lists** — every Custom Lead List the contact is on
  (`listsForContact`, `lib/leadLists.ts` — the inverse of the existing
  `resolveListContacts`, same email-first/name+company-fallback matching
  used everywhere else).
- **Sequences** — every enrollment for that contact with the sequence
  name, enrollment status badge, step N of M, and a note when the
  sequence itself is paused/archived.
- Plumbed as read-only props (`users`, `tasks`, `leadLists`, `sequences`,
  `enrollments`) from `App.tsx` → `Engage.tsx` → `Contacts.tsx`/
  `Companies.tsx` → `ContactDetail.tsx`; both places that open the modal
  pass the same set, so the record reads identically from either.
- Verified live, 11/11: seeded a contact, added it to a new Lead List
  from Scanner's bulk bar, enrolled it in a sequence, completed the
  generated call task, then confirmed the panel showed the list, the
  enrollment, the Dynamics 365 + Strong Signal badges, a non-negative
  days-ago reading, and an owner that survived a full page reload.

## Custom call dispositions + checkbox filtering (app/ only)

Per Jack: "lets start building out a dispostion section i can manully add
new ones for caling and remove them and make sure it can be filtered
through in a check box way."

- **The six built-ins are untouched and stay special.** Three of them
  drive real behavior — "Not interested" auto-crosses a row out,
  "Meeting booked" tints the row, stamps BOOKED and auto-finishes that
  contact's sequence enrollments (`TERMINAL_DISPOSITIONS`). **A custom
  disposition is deliberately a label + color only**, with none of those
  side effects; the manager UI says so in plain text so "Left voicemail"
  can't be mistaken for something that also crosses the lead out.
- **`lib/dispositions.ts`** (new, `STORE_DISPOSITIONS`, `DB_VERSION`
  bumped 12→13) — `CustomDisposition {id, label, color, bg, createdAt}`,
  with `createCustomDisposition` rejecting a blank name or one whose slug
  collides with an existing built-in or custom (so "No Answer" can't be
  added next to the built-in "No answer"). Colors come from a fixed
  7-entry palette cycled by how many already exist, so a new disposition
  always reads as a real chip without asking Jack for hex codes.
- **The type widened, carefully.** `Disposition` in `lib/detection.ts` is
  now `BuiltInDisposition | (string & {})` — any string is storable, but
  every existing `=== "meeting-booked"` comparison still typechecks and
  autocompletes. `DISPOSITION_META` stays a `Record<BuiltInDisposition,
  …>` and is **no longer indexed directly anywhere**: all 24 call sites
  went through `dispositionMetaFor(key, dispositions)`, which never
  returns undefined — that's what makes an unknown key safe.
- **Deleting a disposition never orphans a lead.** A custom id is a slug
  of its label (`custom:left-voicemail`), so a lead still stamped with a
  deleted one renders as "Left voicemail (removed)" in muted grey rather
  than a raw id or a crash — same "don't rewrite already-filed data"
  rule the rest of the app follows. The delete confirm says exactly that.
- **Checkbox filtering, per the ask.** Contacts' disposition filter went
  from single-select pills to a **multi-select checkbox row** (empty set
  = no filter, live per-bucket counts, a "Clear (N)" link, and a
  "⚙ Manage" button that opens the manager). The same checkbox row was
  added to Engage → **Calls and Emails**, where a task is filtered by its
  linked *contact's* disposition (a task has no disposition of its own) —
  and each task row now shows that contact's disposition chip.
- **Where it's managed**: a third tab, "Dispositions", in the existing
  shared Platform Notes / Cheat Sheet panel (`notesPanelTab` gained a
  `"dispositions"` value), reachable from either of those tabs or
  straight from Contacts' "⚙ Manage" button.
- Every disposition dropdown in the app (Scanner per-row + bulk bar, Lead
  Library's per-lead editor) now offers built-ins + customs from the same
  `dispositionOptions()` source, so the sets can't drift apart.
- Verified live, 15/15: added two customs, confirmed a duplicate name is
  rejected with a message, set a lead to a custom disposition from
  Scanner's per-row dropdown, confirmed the Contacts count went to 1 and
  the checkbox filtered the table to that one lead, confirmed two boxes
  checked shows both leads, confirmed the Calls tab carries the same
  filter, reloaded and confirmed customs + the lead's value persisted,
  then removed one and confirmed the lead reads "Left voicemail
  (removed)" with no errors.

## Time zones — contact, company, and the local user (app/ only)

Per Jack: "lets add a feature for time zones and can show the time zones
according to company location also for the contact but also the local
user using the platform."

**Where the data actually comes from — stated plainly.** This app has no
location field on a Contact or Company: no city/state/country column is
captured from any CSV, and company enrichment is still unbuilt. The one
real location signal a contact might carry is a **phone number**, and a
North American area code maps to a time zone deterministically. So
(`lib/timezones.ts`, `resolveContactTimeZone`) a contact's zone resolves
manual override → work-phone area code → mobile area code → unknown, and
unknown is shown as "—", never guessed from a name or email. A company's
zone (`Company.timeZone`, `lib/companies.ts`) is the most common resolved
zone among its contacts — that IS the company's zone until Apollo
enrichment lands an HQ location to read instead (see the Apollo bulk-
enrichment prep). The local user's zone is what the browser reports
(`Intl.DateTimeFormat().resolvedOptions().timeZone`) — the real answer
for "the person using this."

- **`lib/timezones.ts`** — a ~330-entry NANP area-code → IANA table
  grouped by zone (Eastern/Central/Mountain/Pacific/Alaska/Hawaii plus
  Arizona and Saskatchewan as no-DST zones, and Canada's Atlantic/
  Newfoundland/Yukon). A handful of area codes straddle a zone line; each
  is mapped to the zone covering most of it and is overridable. All clock
  math goes through `Intl` with an explicit `timeZone`, so DST is always
  right for the date in question. Also: `isBusinessHours` (weekday,
  8:00–17:59 in THEIR zone — the actual reason to show a zone on an
  outbound platform), `offsetFromLocalLabel` ("+2h from you"),
  `TIME_ZONE_CHOICES` for the manual picker.
- **`Contact.timeZone?: string | null`** (`lib/contacts.ts`) — manual
  override, set only from the detail view. Optional; a contact with no
  override just derives from phone at display time.
- **`components/LocalTime.tsx`** — one shared chip: "2:45 PM CDT" with a
  green dot inside business hours there, grey outside; `variant="full"`
  adds the zone name and offset from you. Shown in Contacts (new "Local
  time" column next to Phone), Companies (a Local time stat on the
  expanded card), Engage → Calls/Emails (on each task row, since that's
  where you decide whether to dial), and the contact detail view's Record
  details (a "Time zone & local time" row with the manual override picker
  and a hint when nothing resolved). `AccountPanel` shows the local
  user's own clock and zone under their name.
- **`lib/useNow.ts`** — one shared 30-second tick so every clock on the
  page advances together instead of each running its own interval.
- Verified live, 15/15, with the browser pinned to America/Chicago: 212 →
  Eastern, 415 → Pacific, 602 → Arizona (MST, no DST), no phone → "—", a
  UK number → "—"; manual override to London rendered a London time with
  an offset-from-you label, showed up in the Contacts column, and
  survived a reload; a company with two Eastern contacts rolled up to
  Eastern; a call task row showed its contact's Pacific time; the account
  panel read Central.

## Full-platform workflow audit + brand/structured-borders pass (app/ only)

Per Jack: "Run a detailed prompt to check the workflows or any backend
functions to make sure the entire platform works well and lets build the
ui out a bit more with structured borders the wiredcio.com color scheme
across the whole platform." Two halves, both shipped.

**Audit.** `scratchpad/audit.js` (Playwright, preview build, real
IndexedDB, browser pinned to America/Chicago) walks every module end to
end and asserts on OUTCOMES — counts, persisted values, cross-module
effects — not "the page rendered": lock screen (wrong/right password),
Scanner upload → accounting line → tier cycling → Not-interested auto-
cross-out → Save to Lead Library → bulk add-to-list, Lead Library folder/
files, History badge + View reopen, Contacts (dedupe, local time, search,
tier filter, detail record, website derivation, On CRM, Profile Agent
honesty), Companies (roll-up, Apollo import, HQ time zone, Known info),
Sequences (enroll → task, pause keeps card, copy, completion finishes
enrollment), Calls/Emails (local time, disposition filter, Mark replied),
Lists, Home (Today/Weekly Goals/Notifications/Booked week stepper),
Cheat Sheet / Dispositions / Platform Notes shared panel, Profile &
Access, persistence across reload, Lock. **Final: 53/53, zero page
errors.** Two real bugs it caught, both fixed:
- **Last activity read "-1 days ago" / Home "Calls made today" stayed 0
  after completing a call.** Root causes: a task's `date` is when it was
  SCHEDULED, not when it was worked (a sequence step due tomorrow can be
  completed today) — added `Task.completedAt` (stamped by `App.tsx`'s
  `toggleTask`, cleared on un-done; `lastActivityForContact` and
  `countCompletedChannelTasks` read it, falling back to `date` for tasks
  completed before the field existed). Then still 0: `completedAt.slice(0,
  10)` is the UTC date, which past ~6-7pm Central is already tomorrow.
  Added `localDayKeyFromIso()` (`lib/tasks.ts`) and routed every "which
  local day did this happen" comparison through it (`weeklyGoals.ts`,
  `tasks.ts`, Home's meeting-booked day/week checks).
- Everything else the audit initially flagged was the audit's own
  locator/fixture problem (tier pill cycles by design, Sequences list
  prepends copies, unlock persists per-browser across reload), fixed in
  the script — not the app.

**Brand pass.** wiredcio.com is blocked by this environment's egress, so
the palette comes from the recorded rebrand in `legacy/README.md`
(green `#2CC295`, ink `#081E22`, hero `#0C4651`, light `#F6FAFA`) rather
than a live look at the site — flagged, not hidden. `styles.css` gained a
brand block: `--border #dbe4e6` / `--border-strong #c4d2d6` /
`--surface-sunken #f3f8f8` / `--ink-2 #0c4651`, global `thead th`/`tbody
td` styling so every table reads as the same structured grid, a green→blue
rail before each `main h2`, and a consistent input focus ring. One-off
grey border hexes across 11 components were mechanically replaced with
`var(--border)`, and radii normalized to 10px. Styling only — no handler,
prop or state changed anywhere; the 53-check audit ran against the
restyled build.

## Companies: Apollo bulk-dump import + company profiles (app/ only)

Per Jack: "get ready to enrich data coming from apollo in a large dump
process to build out companies and known info." This is the "known info"
layer Companies has been missing since it was a pure Contacts roll-up.

- **`lib/companyProfiles.ts`** (new) — `CompanyProfile` (website/domain/
  industry/employees/city/state/country/phone/LinkedIn/keywords/revenue/
  founded/description/technologies/Apollo account id + source files),
  new IndexedDB store `STORE_COMPANY_PROFILES` (keyPath `key`,
  `DB_VERSION` bumped 13→14). Keyed by the SAME normalized company name
  `lib/companies.ts` groups contacts by, with website domain as a
  secondary match — so a profile lines up with the roll-up it enriches.
- **It is a CSV import, not a live API call, on purpose.** A large dump is
  exactly where a file beats per-row credits, and it keeps Jack's
  "explicit, nothing in the background" rule for every Apollo touchpoint.
  Headers are matched by candidate list against Apollo's own export
  headers ("Company", "# Employees", "Industry", "Company City/State/
  Country", "Company Phone", "Website", "Company Linkedin Url",
  "Keywords", "Annual Revenue", "Founded Year", "Short Description"/"SEO
  Description", "Technologies", "Apollo Account Id") via the Scanner's
  own tolerant `guessColumn`; the import summary lists any column that
  went unmapped rather than guessing. Merging is additive (fillBlank) —
  re-importing the same dump is a no-op and a sparser file never blanks a
  richer one.
- **Companies.tsx**: "⬆ Import Apollo export" button (hidden file input,
  summary notice: N new / N updated / N skipped for no name / unmapped
  columns), new Industry / Employees / HQ columns, and a "Known info"
  panel inside the expanded company card. `groupContactsByCompany(contacts,
  profiles)` attaches `Company.profile`; the HQ city/state/country is now
  the preferred source for the company's time zone (`timeZoneSource`),
  ahead of the contacts' phone area codes.

## Contacts: Profile Agent (app/ only)

Per Jack: "Create an agent to pull accurate website links with the
contacts email domain and cross reference with linkedin and their name
and email to pull a great profile with their accurate title and what's
uploaded." Built as one explicit run over the SELECTED contacts (the same
checkbox selection + 10-per-click cap the existing "Enrich via Apollo"
button already had — `runEnrichment` in `Contacts.tsx` was rewritten into
this):
1. **Website from the email domain**, no network — `deriveCompanyWebsite`
   re-applied to any selected contact still missing one.
2. **Apollo people-match on name + company + email** — the ONLY
   cross-reference source this app can actually reach. There is no
   LinkedIn API here and LinkedIn can't be read from a browser page, so
   "cross reference with LinkedIn" means Apollo's verified `linkedin_url`,
   title, org website and person location — stated plainly in the report
   panel, not implied to be a LinkedIn lookup.
3. **Auto-apply only what's safe**: LinkedIn URL, a BLANK title, a BLANK
   website (when the email domain couldn't derive one), a time zone from
   Apollo's location when no manual override exists and the phone couldn't
   resolve one. Anything that CONFLICTS with the upload — a different
   title, a different website — is listed in a "Profile agent report"
   with an explicit "Use Apollo's" button per field. Uploaded data is
   never silently overwritten.
- Without Apollo (or outside the Artifact viewer) it still does step 1,
  then says exactly why steps 2-3 didn't run — the audit checks this
  ("reports honestly and does not fake a match").

## Upload-time Apollo company enrichment (app/ only, one explicit click per upload)

Per Jack: "I want to keep data enriching as new contacts are uploaded
here if apollo has data on the company." Built to satisfy two rules at
once — Jack's own "nothing in the background I can't see" and Apollo's
connector contract, which requires explicit user confirmation stating the
total count before any credit-consuming batch.
- **Scanner results screen gained an "Apollo company data" panel** with
  a toggle, "Check Apollo for new companies on upload" (OFF by default;
  persisted in `localStorage` as `autoEnrichCompanies`, a preference, not
  data). Companies already covered by an imported profile attach to new
  contacts automatically regardless of the toggle — that part costs
  nothing.
- With the toggle on, every upload (`App.tsx`'s `recordHistory`) computes
  `pendingEnrich` via `companiesNeedingEnrichment()` — companies in this
  batch with a work-email domain (free providers skipped) and no profile
  on file — and the panel shows: "**N companies** in this upload have no
  Apollo data yet. Enriching them will consume up to **N credits** (no
  charge for any not found)" plus the names, and ONE button, "Enrich N
  now." Nothing runs until it's clicked. Capped at 25 per click
  (`MAX_COMPANY_BATCH`); a bigger batch says "first 25 per click" rather
  than chunking silently.
- **`enrichCompaniesViaApollo(domains)`** (`lib/apolloEnrich.ts`) calls
  the viewer's Apollo connector's `organizations_enrich` tool (discovered
  by name at call time, same as the people-match path) sequentially, one
  domain at a time, and records a per-domain outcome — ✓ Found (industry
  · employees · city, state) / No Apollo record (0 credits) / Error with
  the real `McpError` message. Found results go through
  `upsertProfileFromApollo` into the same `CompanyProfile` store the
  bulk import uses (source label "Apollo (live enrich)"), fillBlank-merged.
- The tool shape (`{domain}` in; `{organization: {...}}` out; 1 credit if
  found, 0 if not) was rehearsed live earlier this session against
  Apollo's own domain — not guessed. Verified live in preview: toggle off
  shows no credit language; toggle on shows the count/credit banner (6 of
  7 fixture companies, the free-email row excluded); clicking outside the
  Artifact viewer yields one honest "isn't available in this view" line
  per domain and never a fabricated ✓ Found. **The real Apollo round-trip
  from inside the deployed Artifact is still unverified** (same caveat as
  the people-match button) — first real test is Jack's.
- **Republish note**: the Artifact's `capabilities.mcp.servers[].tools`
  list must include `apollo_organizations_enrich` alongside the two
  people-match tools, or `listTools()` never surfaces it and the button
  reports Apollo as not connected.

## Company Overview Agent — the export → research → import loop (app/ + `app/scripts/`)

Per Jack: "an agent to run a brief overview on every company with their
industry and what they do from scraping their website … or LinkedIn with
employee count … more so when data cannot be pulled from Apollo." The
published page cannot fetch arbitrary websites (the Artifact sandbox
allows only connector calls), so the agent runs OUTSIDE the app and the
app owns both ends of the hand-off:
- **Companies → "⬇ Export missing info (N)"** — a CSV of every company
  whose profile lacks industry, description or employee count, with the
  best website we have (profile domain → a contact's company website → a
  contact's work-email domain), in the exact header shape the importer
  reads: `Company, Website, Industry, # Employees, Short Description`.
- **`npm run company-overview -- companies-missing-info.csv`**
  (`app/scripts/company-overview.cjs`, plain Node, fetches via `curl` so
  OS proxy/CA settings apply). Per company with a website it fetches the
  homepage plus a linked About page, reads `<title>`, meta/og description,
  and JSON-LD `Organization` (description, `numberOfEmployees`), looks for
  EXPLICIT headcount phrasing only ("250+ employees", "team of 40" — never
  a bare number), and guesses an Industry from a small keyword table. A
  `Source` column says where each field came from and labels the industry
  "(guess)". Anything not found stays blank; an unreachable site or a
  missing website is written as such, never filled in.
- **LinkedIn is deliberately not consulted** — login wall and terms; the
  script never requests linkedin.com and the run summary says so.
  Employee counts come only from the company's own site or from Apollo.
- **Import the output through the same "⬆ Import Apollo export" button.**
  The importer is header-driven and fillBlank, so agent output never
  overwrites something Apollo already supplied; `Source` simply reports
  as an unmapped column. Verified: fixture sites (meta description +
  JSON-LD headcount; a plain paragraph with "850+ employees") → correct
  Industry/Employees/Description; an unreachable domain and a no-website
  row → blank with the reason; the output CSV mapped 5/5 fields through
  `mapProfileColumns` and imported cleanly.

## Scanner 3×3 consistency run on Jack's three real files (app/ only)

Per Jack: "Check the scanner and lets make sure we are processing the
data right … run these 3 files 3 times each." `Book82626.csv`,
`Book82126.csv`, `BookSheet83.csv`, each scanned three times headless
through the exact `parseCSVText → scanParsedFiles` path the browser uses,
plus a 9-upload UI pass. **Result: byte-identical per-row signatures
(tier/category/DQ reasons) on every run — the pipeline is deterministic;
no inconsistency exists.** Nothing in detection was changed.

**One rule question surfaced and left for Jack, not decided here.** The
"Low seat count" Auto-DQ only fires from the LICENSING engine (a
confirmed M365 seat count under the 15 threshold). A Dynamics 365 lead
with a stated count under 15 ("Dynamics 365 Business Central - 5 users")
is NOT DQ'd — `dynamicsSeatCount` is a ranking key only. Across the three
files that's **31 Dynamics Strong Signal rows with a stated count of
3-12 seats** (list in the session report). A fix that DQ'd them was
written, then reverted: Conrey Electric (BC, 10 users) is one of the 12
companies Jack personally re-promoted to Strong Signal (see the glued-
NULL fix above), so treating sub-15 Dynamics as a Bad Lead contradicts a
call he already made. Whether Dynamics should share the 15-seat floor is
his product decision.

## Sidebar time-zone cheat window (app/ only)

Per Jack: "allow a little cheat sheet window below the jack sales director
at the bottom to show mst current time est and pst." A small bordered
strip in `AccountPanel.tsx`, directly under the account row and above the
Cheat Sheet / Platform notes buttons: three stacked rows — Eastern,
Mountain, Pacific — each with the current time and the LIVE abbreviation
(EDT/MDT/PDT in summer, EST/MST/PST in winter), driven by the same shared
30-second `useNow` tick and `formatTimeInZone`/`zoneAbbrev` helpers the
local clock above it already uses. Mountain is `America/Denver` (observes
DST), read from Jack's "MST" as the Mountain zone generally rather than
Arizona's year-round MST. Pure display, no data. Verified live with the
browser pinned to Chicago: Eastern +1h, Mountain -1h, Pacific -2h from the
local clock, correct DST abbreviations, no console errors.

## Call dispositions: Jack's two-bucket taxonomy + the connected rule (app/ only)

Per Jack, giving his real call-outcome list split into two groups, in the
course of comparing this app against an Engage build spec that rebuilds
Apollo's sequences/emails/calls/tasks. This replaces the earlier six-value
set and, more importantly, makes the split *behavioral* rather than
cosmetic.

- **The nine outcomes, in two buckets.** Reached them: Meeting booked,
  Call back scheduled, Info requested, Not interested, Do not contact.
  Didn't reach them: Gatekeeper / front desk, Left voicemail, No answer,
  Wrong number. Three keys carry over untouched (`meeting-booked`,
  `not-interested`, `no-answer`) so nothing already filed is rewritten.
- **`connected` drives sequence advancement, and that is the point.**
  `DispositionMeta` (`lib/detection.ts`) gained `connected: boolean` and a
  `group`, and `isTerminalDisposition` (`lib/sequences.ts`) is now
  literally `isConnectedDisposition` — ANY "reached them" outcome finishes
  that contact's active enrollments, built-in or custom. The old
  hardcoded `TERMINAL_DISPOSITIONS` set of two keys is gone.
  **The reasoning changed mid-thread and it matters**: the first proposal
  had Call back scheduled and Info requested keep someone active, argued
  on the grounds that with no automatic email there's no risk of the
  machine chasing someone you just spoke to. Jack then said SendGrid is
  coming, which removes that premise entirely — so all five connected
  outcomes now finish. Don't quietly revert this without re-reading that
  argument.
- **Do not contact is a hard opt-out.** `enrollmentBlockReason`
  (`lib/sequences.ts`) refuses enrollment outright, checked inside
  `enrollContact` itself so every path is covered, bulk list enrollment
  included. `enrollContactsInSequence` (`App.tsx`) now returns
  `{enrolled, blocked}` instead of a bare number so the UI reports
  "N skipped as Do not contact" rather than lumping an opt-out in with
  "already active in this sequence." Not interested stays re-enrollable on
  purpose — that's a soft no you may re-approach next quarter.
- **Retired, not deleted.** "No contact made" and "Other" stay in
  `DISPOSITION_META` with their original labels and colours but are absent
  from `DISPOSITION_ORDER`, so a lead already stamped with one still
  renders correctly and no picker offers it again. `isBuiltInDisposition`
  now tests `DISPOSITION_META` rather than `DISPOSITION_ORDER`, which is
  what makes that work. Same "don't rewrite already-filed data" rule the
  rest of this app follows.
- **Customs carry the flag too.** `CustomDisposition.connected` is
  optional, so one saved before this existed reads as not-connected, the
  safe default — a pre-existing custom can't silently start ending
  sequences. The manager UI has a Reached/Didn't-reach selector on the add
  form and labels each custom with its bucket.
- **Grouped everywhere it's picked.** New shared `DispositionOptions`
  component renders `<optgroup>`s for both buckets, used by Scanner's
  per-row and bulk selectors and the Lead Library's per-lead editor, so
  the three pickers can't drift. Contacts' checkbox filter row shows a
  small uppercase bucket header wherever the group changes.
- Verified live, 12/12: dropdown grouping and all nine outcomes present
  with the retired pair gone; enrolled a contact then set Do not contact
  and confirmed the enrollment auto-finished; confirmed re-enrolling that
  contact is refused with the visible reason and a zero count; confirmed
  Left voicemail on a different enrolled contact leaves them Active;
  added a custom in the Reached bucket and confirmed it and the opt-out
  survived a full reload. Full platform audit re-run after: 53/53.

**Not built, flagged deliberately.** A disposition still lives on the
Contact as a single latest-outcome value, not on a per-call record — three
voicemails leave one value, not a history of three. The spec puts
disposition on a `call` row, and a dialer makes that necessary rather than
nice-to-have. That's the next brick, not an oversight. Also skipped from
the spec's version: `sentiment` and the contact-stage trigger, since Jack
named neither and this app has no contact-stage concept at all.

**Repo-layout correction found while checking this.** CLAUDE.md's own
"Repo layout" section above describes `legacy/extension/`, `legacy/web/`
and a `legacy/test-*.js` Playwright suite as existing. They do not, and
git history confirms they never have been tracked in this repository.
`legacy/` holds `unified-tool.js`, `build-unified.js`,
`generate-perf-fixtures.js`, `package.json`, `README.md` and
`wired-cio-crm-roadmap.md`. So "the legacy Playwright suite is the
acceptance bar" is pointing at files that aren't there, and a future
Chrome extension build starts from scratch rather than from a reference.
Left the layout section itself alone rather than rewriting a section
documenting someone else's intent, but do not trust it as a file listing.

## Audit pass: five confirmed bugs fixed (app/ only)

Per Jack: "run a harness check on workflows and how the app is built and
check over the code section by section." Two read-only review agents swept
`lib/` and the component layer; every finding below was then re-verified
directly before any change was made. Jack's follow-up — "make sure nothing
with the scanner is reversed or messed up" and "check the functions remain
the same or improve" — is why each fix is deliberately surgical and why the
full regression suites were re-run after.

**1. A Lead Library folder upload wiped sticky cross-out/disposition.**
`Library.tsx`'s `handleUploadIntoFolder` was the ONLY upload path not
calling `applyStickyState(scanned, contacts)` — Scanner's own upload, its
Lead Library picker and `App.loadParsedFilesIntoScanner` all do. It then
fed those fresh rows (always `crossedOut:false` / `disposition:"none"`) to
`attachScanResultsToContacts`, which OVERWRITES rather than fill-blanks, so
uploading a CSV into a folder silently reset a disposition set earlier,
un-crossed the lead, and nulled `meetingBookedAt` (breaking Home's "Booked
this week"). Fixed by adding the same call in the same position, plus a new
`contacts` prop on `LibraryView`. Directly contradicted CLAUDE.md's own
"Sticky crossed-out/disposition state" section.

**2. Unmarking a starred lead could revert a live disposition.** Scanner's
High Priority panel lists rows from ALL of History, then edited them via
`onSyncToHistory({...row, priority:false})`. `App.syncToHistory` does two
things: patch History (correct) AND run `attachScanResultsToContacts` on
that row. A months-old row replayed its stale `disposition:"none"` /
`crossedOut:false` onto the live Contact, nulled `meetingBookedAt`, and
could even auto-finish a currently-active sequence enrollment via
`finishTerminalEnrollments`. The month `<input>` did it on every keystroke.
Fixed with an opt-out: `syncToHistory(row, opts?: {syncContact?: boolean})`
**defaults to true**, so every Scanner per-row edit (tier, category,
disposition, cross-out, priority) behaves exactly as before; only the two
High Priority panel call sites pass `false`. That panel only ever edits
`priority`/`priorityMonth`, which are History-only fields with no Contact
equivalent, so it had nothing legitimate to sync.

**3. Moving a lead between category files inside an UNGROUPED file lost
it.** `moveLibraryRowToBucket` called `getOrCreateMonthCategoryEntry(...,
source.groupId ?? "", ...)`. An ungrouped entry stores `groupId: null` (what
"deleting a folder only ungroups its files" leaves behind), and `""` never
matches `null`, so a third, unreachable entry was created; `Library.tsx`'s
persist filter (`e.groupId === source?.groupId`) then skipped it, writing
the source (row removed) but never the destination. The lead vanished from
both files on reload. Fixed by widening the parameter to `string | null`
and passing `?? null`. Verified with a direct unit check: the move now
appends to the existing ungrouped file, creates no orphan, and leaves every
`groupId` null.

**4. The Engage sidebar sub-nav went dead on a repeat click.** `Engage.tsx`
resyncs its tab via `useEffect(..., [initialTab])`, but `App.tsx` set
`engageEntry` to a new object carrying the SAME string. So: click Calls in
the sidebar, switch to Contacts with the in-page dropdown, click Calls
again — `initialTab` is still `"calls"`, the effect never re-runs, and the
click does nothing while the sidebar keeps highlighting Calls. This is the
same seed-vs-resync class as the bug CLAUDE.md already documents fixing
once; that fix closed the value-changes case but not the value-repeats
case. Fixed at the root rather than with a nonce: `Engage` now reports its
tab back via `onTabChange`, so App's copy never goes stale — which makes a
repeat click a real change AND fixes the stale sidebar highlight with one
mechanism. Confirmed broken then confirmed fixed with the same live script.

**5. "Save to Lead Library" silently no-opped on a batch reopened from
History.** `saveStrongSignalToLibrary` guards on `currentHistoryEntryId`,
which only Scanner's own `handleFiles`/`loadFromLibraryPicker` ever set.
`App.loadHistoryIntoScanner` sets `results` directly, so reopening any
Recent upload rendered the button ENABLED, and clicking it hit the guard
and returned with no filing, no notice and no state change. Fixed by
threading `loadedHistoryEntryId` down (same adopt-via-`useEffect` pattern
`loadedScanStats` already uses). A multi-entry combine has no single id to
stamp, so it stays null and the button is now disabled with a title
explaining why, instead of failing silently.

**Verification.** Full platform audit 53/53 and the disposition suite 12/12
both still green after the changes, plus an 8-check script proving each fix
against the real IndexedDB flow. Scanner specifically was re-checked end to
end: tier tabs, product-line chips, View sub-tabs, search, per-row tier/
category/disposition/undo/cross-out/priority, the bulk bar, Non Relevant,
Save to Lead Library and Start over all behave exactly as before.

**Reported, NOT changed** (real findings, but each is a judgement call or a
larger change than a bug fix): the Lead Library is the only place in the app
that deletes persisted data with no confirmation, in four places including
one that removes a whole filed file from a button beside Download; Weekly
Goals' `computeAutoActual` parses its week end as UTC midnight so Sunday
calls are dropped outside UTC+0; deleting a sequence-generated task strands
its enrollment permanently (nothing clears `currentTaskId` and
`resumeEnrollments` skips anything that still has one); "Backup everything"
covers 3 of 17 IndexedDB stores while the filename says full backup;
clearing the Cheat Sheet's qualify-threshold field writes `0` instantly;
Contacts' date-range filter compares a local calendar date against a UTC
`lastSeenAt` so evening uploads fall outside their own day; and
`createCustomDisposition` doesn't guard the two retired built-in slugs, so a
second "Other" chip can be added. Also flagged: ~11 exported functions and
fields nothing reads, and `Sequences.tsx`'s enroll picker renders every
contact unpaginated (the same pattern already measured and fixed in
Contacts/Companies).

**Confirmed clean.** No rules-of-hooks violations anywhere, checked by
script across every component then by hand on each one that early-returns.
Every rapid-fire state mutator in `App.tsx` correctly reads `prev` from
inside its own functional updater. All list keys are stable.
`lib/detection.ts`, `lib/csv.ts`, `lib/timezones.ts` and `lib/tasks.ts` had
no defects found; `tasks.ts` was singled out as the one file that gets
local-vs-UTC day handling right throughout and should be the reference.

## Interface remodel — design tokens, dark theme, and a new shell (app/ only)

Per Jack: "the track 3 interface remodel of the build plan is to be
executed now." Apollo's information architecture wearing HubSpot's
restraint, in Wired CIO's teal. Steps 1 through 3 of the build plan
(tokens, primitives, shell). **No component's behaviour, props or state
changed** — the full platform audit (53/53), the disposition suite (12/12)
and the audit-fix suite (8/8) all still pass against the remodelled build.

**The token layer, and why the old names survive.** `styles.css` now opens
with the full canonical set: brand/ground/ink/line/semantic/elevation/
radius/space/layout/type. Crucially the ELEVEN legacy names (`--ink`,
`--muted`, `--bg`, `--surface`, `--border`, `--accent` …) are kept as
aliases onto the new values. That is deliberate: ~970 inline styles across
the components still reference them, so aliasing restyles the entire
product in one move instead of requiring every file to change at once.
New code uses the canonical names; the inline styles get converted screen
by screen from here.

**The green rule, now enforced by the tokens themselves.** Wired CIO is
teal AND green, and green is also the universal success signal — if both
are interactive, a green badge stops meaning anything. So `--accent` (the
alias every existing component uses for its interactive colour) now
resolves to **teal** `#0E7A72`, and green survives only as `--success` and
as `--brand-accent` for non-interactive marks. Nothing green is clickable.
Every ratio in the set was verified by computation, not assumed: 13 of 13
claimed values check out exactly.

**Dark theme, both states.** Tokens are redefined under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`
AND `:root[data-theme="dark"]`, so the unstamped system default and the
explicit toggle both work in both directions. No component rule lives
inside a theme block, so it is impossible to render one theme's text on
the other theme's ground. A new toggle in the top bar cycles it,
persisted in `localStorage` as a display preference (never data).

**The shell.** A 56px top bar (brand mark, product name, theme toggle,
Lock) plus a **dark teal sidebar** (`--bg-sidebar` `#12312F`), flat and
grouped, replacing the old light sidebar with its collapsible Engage
group:
- **(ungrouped)** Home
- **Pipeline** — Scanner, Lead library, Lists, History
- **Work** — Tasks, Calls
- **Outreach** — Sequences, Emails
- **Records** — Contacts, Companies

Every Engage sub-tab is now its own top-level destination, one click
instead of nav-then-dropdown. This is navigation PRESENTATION only: those
entries still set `view="engage"` plus an `engageEntry.tab` and render the
exact same `<Engage>` they always did, and Engage's own in-page dropdown
is untouched. The **Pipeline group is the addition to the reference
design**, which has six destinations where this product has eleven —
Scanner, Lead library, Lists and History had nowhere to live in it.
Sidebar items carry live counts (library files, history entries, lists,
open tasks, open calls) in mono.

**The active-rail colour is deliberately NOT `--brand`.** Brand teal on
the dark sidebar measures 2.07:1 where a control needs 3:1 — it fails the
spec's own acceptance checklist, and it is the primary wayfinding signal
in the whole shell. `--sidebar-rail` `#4CBFB3` clears 4.83:1 against the
hover fill and 6.25:1 against the ground, and reads as the same family.
Verified live: the computed active border is `rgb(76, 191, 179)`.

**Bug found and fixed while building it.** Two stale `.side-nav-btn.active`
rules from earlier visual passes were still setting a pale
`--accent-soft` background with dark ink, which on the new dark sidebar
rendered the active item nearly unreadable. Caught by screenshotting
rather than by trusting the CSS, and removed.

**Fonts** moved to IBM Plex Sans + IBM Plex Mono (from Inter), per the
build prompt.

**Deliberately NOT done in this pass**, so it is not mistaken for
finished: the reference design's page-header pattern (title + single
primary CTA + control strip) is not applied per screen yet, so
Backup/Restore still floats at the top of `main`; there is no filter
rail, no saved views, no skeletons, no right-hand drawers; the ~970
inline styles are still inline; and the contact record is still a modal
rather than a three-column page. Those are step 4 onward, screen by
screen, starting with Tasks.

**Test-harness note.** `scratchpad/audit.js`'s navigation helpers were
updated for the flat nav (an Engage tab is now one sidebar click, and
"Lead Library" is now sentence-case "Lead library"). That is a legitimate
harness update, not a masked failure — every assertion in all three
suites is unchanged and still passes.

## Audit findings fixed (app/ only)

The remaining items flagged but not changed in the previous audit pass,
now fixed:
- **Weekly Goals dropped every Sunday call.** `computeAutoActual` parsed
  its week end from a bare `YYYY-MM-DD`, which JS reads as UTC midnight;
  adding six days with local getters landed on Saturday for anyone west
  of UTC. Now parsed at local noon, the same convention `lib/history.ts`
  and `lib/tasks.ts` already use.
- **Contacts' date-range filter excluded evening uploads.** It compared a
  local calendar date against the UTC `lastSeenAt` stamp, so a contact
  merged at 8pm Central on the 8th read as the 9th and fell outside a
  "to the 8th" filter. Both ends now go through `localDayKeyFromIso`.
- **Clearing the qualify-threshold field wrote `0` instantly.** `Number("")`
  is 0, and 0 was accepted, which silently disqualifies every licensing
  hit with any stated count and kills the sub-threshold Bad Lead route
  with nothing on screen saying the rule changed. Empty and sub-1 values
  are now ignored as mid-edit states.
- **Deleting a sequence-generated task stranded its enrollment
  permanently.** Nothing cleared `currentTaskId`, so the enrollment could
  never advance (no task left to complete) and `resumeEnrollments`
  explicitly skips anything that still has one — reactivating the
  sequence would not regenerate it either. `deleteTask` now clears the
  back-pointer first.
- **A second disposition literally named "Other" could be added.**
  `createCustomDisposition` built its collision list from
  `DISPOSITION_ORDER`, which deliberately omits the two RETIRED built-ins.
  Now checked against every key in `DISPOSITION_META`.
- **The Lead Library was the only place in the app deleting persisted data
  with no confirmation** — four controls, including one that removes an
  entire filed file from a button sitting beside Download. Deleting a
  file, a folder, and an individual filed lead now each confirm, naming
  what is being destroyed and how many leads it holds. (Folder deletion
  still only ungroups its files, and the prompt says so.)

## Cleanup pass: Home, filters behind a dropdown, condensed Scanner (app/ only)

Per Jack: "clean up the home landing page and be more like hubspot less ai
and bs cluttered together," "cleaner and more friendly less confusing," and
— the most concrete of the three — filters "should be pretty clear and easy
to navigate with filtered options but hidden under drop downs and not
displayed just across the screen."

**Reusable page furniture, defined once.** `styles.css` gained
`.page-head` (title + subtitle left, at most one primary action right),
`.metric-row`/`.metric` (tiles inside ONE bordered container separated by
hairlines, not floating pills), `.control-strip`, `.filter-btn`/
`.filter-pop` (the filters dropdown with a count badge), and `.chip-row`/
`.chip` (active filters as removable chips). Every module can now use the
same furniture instead of inventing its own layout.

**Home.** The banner used to cram a date, a greeting, a marketing
paragraph, the "Viewing as" control and four stat pills into one box. It
is now a plain page header (greeting + today's date) with the Viewing-as
control on the right, followed by a single hairline-separated metric row.
**The product-thesis paragraph was deleted outright** — that is the "ai
and bs" Jack meant; it belongs in these docs, not on the screen he opens
every morning. Today, Weekly Goals and Notifications are unchanged below
it.

**Contacts: every filter moved behind one dropdown.** Search and sort stay
in the open; tier, disposition (both buckets) and the last-seen date range
now live in a single **Filters** popover carrying a count badge, with
per-option counts. Whatever is active renders as removable chips above the
table with a "Clear all". This removes the wall of ~13 disposition
checkboxes plus a tier row plus a date row that used to span the whole
screen. The popover is right-anchored — left-anchored ran off the viewport,
caught by screenshotting rather than assumed.

**Backup/Restore moved into the Lead Library.** It used to sit above the
page title on EVERY view, which is the first thing you saw on Home. It
briefly moved to the sidebar, then to the Lead Library per Jack ("backup
and restore can be in the library") — which is the better home anyway,
since the Library is where the filed data it protects actually lives. It
renders in the Lead Library's page header, passed down from `App.tsx` as
a `backup` node so the component keeps owning its own state and the
Library doesn't need to know what a backup is. The Lead Library also
gained a real `.page-head` title while it was being touched.

**Scanner: the two accounting lines were saying the same thing twice.**
Per Jack, pasting both back. There was a transient dedupe banner AND the
persistent accounting line, and the banner's content was already the
second clause of the line. The banner and its `dedupeNotice` state are
gone, and the line is condensed from a paragraph to
`13 read · 10 processed · 1 no signal · 2 duplicates merged (one ×3)`,
with the long explanations moved to hover titles. The arithmetic identity
is unchanged and still holds: read = processed + no signal + duplicates.

**Scanner: Final downloads condensed.** It was a full panel with a
full-width editable filename input per product line. It is now one strip
of compact download buttons carrying their counts, with the filename
editor behind a small ✎ toggle — still editable, just not occupying a
third of the panel until wanted.

**Verification.** Platform audit 53/53, disposition suite 12/12,
audit-fix suite 8/8, zero console errors. Several harness locators were
updated for the new markup (an Engage tab is one sidebar click, tier and
disposition now live inside the Filters popover, and the accounting line's
wording changed) — legitimate harness updates, since every assertion is
unchanged and still passes.

**Known leftover, flagged not fixed:** Engage's own in-page dropdown is
now redundant with the flat sidebar and still renders above the page
title. Removing it deletes a working control, so it needs Jack's call
rather than a unilateral change.

## Competitor Auto-DQ, bulk enrichment, Companies filters (app/ only)

Per Jack, in one thread: "if the company is an msp, it partner, microsoft
partner, computer software or network and security for cloud or tech its
going to be a bad signal going forward automatically when uploaded and
enriched"; "raise the amount i can enrich at once from 25 for company
data"; "there will be a filter for company size and industry also to
filter also filter out and delete"; "check for cache errors."

**Competitor / IT-services Auto-DQ.** Wired CIO IS an MSP and a Microsoft
partner, so another MSP, IT services firm, Microsoft partner or security/
cloud vendor is a peer, not a prospect. `COMPETITOR_DQ_LABEL`
("Competitor / IT services company") is cross-cutting like every other
Auto-DQ: it overrides whatever category/tier the row would otherwise get,
and the lead stays visible and reversible, just out of the three CSV
downloads. **Two independent signals, deliberately kept apart because they
are not equally trustworthy:**
- **Industry, from an enriched company profile** — the reliable one.
  Apollo's industry values are a fixed vocabulary, so `COMPETITOR_INDUSTRIES`
  matches them WHOLE rather than by substring. Applied by
  `applyCompetitorDQ` (`lib/companyProfiles.ts`), which runs as a separate
  pass right after `scanParsedFiles`, in the same shape and position as
  `applyStickyState`, because detection never sees company profiles and a
  profile may only arrive later via enrichment.
- **Company name, at scan time** — can only ever be a heuristic, so
  `COMPETITOR_NAME_RE` is deliberately NARROW: whole phrases that
  essentially only appear in the name of an IT services business
  ("managed services", "IT solutions", "cyber security", "Microsoft
  partner"), never single broad words like "technologies", "systems",
  "digital" or "solutions", which sit in the names of plenty of
  manufacturers, clinics and logistics firms.

Wired into all four scan sites (Scanner's upload and Library picker,
App's "Load into Scanner", and Library's upload-into-folder) and re-run
over the rows already on screen after an enrichment run — per Jack, a
competitor is a bad signal "when uploaded AND enriched", so a newly
learned industry disqualifies immediately rather than at the next scan.
Verified with 36 assertions including adversarial names: "Acme
Technologies", "Vertex Health Systems", "Quill Digital", "Baker
Solutions" and "IT'S A GRIND COFFEE" all correctly do NOT fire.

**Enrichment cap raised from 25 to 100.** The old ceiling guarded a
one-Apollo-call-per-domain loop. `enrichCompaniesViaApollo` now prefers
Apollo's BULK organization endpoint (10 domains per call, chunked) and
falls back to the single-domain one when the bulk tool isn't exposed, so
the same work costs a tenth of the round trips. Bulk results are read
**by index**, parallel to the input array — re-matching by name would
silently attach one company's data to another. Credit cost is identical
either way (1 per match, 0 per miss), and Apollo's mandatory
confirmation is unchanged: the panel states the exact count and cost, and
nothing runs without the explicit click.

**Companies: filters behind one dropdown, plus filter-out-and-delete.**
Company size (five employee buckets), industry (only values actually
present, with counts) and a competitor filter (show all / hide / only)
all live in the same `.filter-pop` dropdown pattern Contacts uses, with
active filters as removable chips. A company with no employee count on
file never matches a size bucket rather than being guessed into the
smallest one. **"Remove N filtered"** deletes every contact behind the
currently-filtered companies, and is offered ONLY while a filter is
active, so it can never wipe the whole directory in one click; it
confirms with both counts. This needed a real delete path —
`deleteContactsFromDB` — because until now nothing in the app could
remove a contact, the directory only ever grew. Filed Lead Library rows,
History entries and list snapshots are separate copies and are
deliberately untouched, which the confirmation says.

**Cache errors, both real, both found by the audit.**
- `lib/db.ts` had **no `onblocked` handler**. If another tab held an older
  `DB_VERSION` open, neither `onsuccess` nor `onerror` ever fired and the
  app hung on its loading state with no message — the one storage failure
  that looks like a frozen page rather than an error. Now rejects with an
  actionable message, and a `versionchange` handler closes this
  connection so another tab can upgrade instead of being blocked forever.
- `lib/library.ts` carried a **per-entry category-count cache nothing ever
  read**, kept warm by four `invalidateCategoryCount` calls on every
  write. Removed with its four call sites. A dead cache is worse than no
  cache: it reads as a live invariant someone has to maintain.

**Bug found by live-testing the new filters: the Filters popover covered
its own trigger.** `.filter-pop-backdrop` is a SIBLING of the button
inside `.filter-wrap`, so its `z-index: 39` painted over the button —
clicking Filters again to close the panel silently did nothing (clicking
anywhere else still worked, which is why it was easy to miss). Raising
`.filter-wrap` did not help, because a parent's z-index does not reorder
its own children; the fix is `position: relative; z-index: 41` on
`.filter-btn` itself, in the same stacking context as the backdrop.
Affects Contacts as well as Companies, since both use the shared pattern.

**Verification.** Platform audit 53/53, disposition suite 12/12,
audit-fix suite 8/8, 36/36 on the competitor rule, plus a 16-check live
pass over the whole Companies flow: a competitor name lands in Bad Leads
with the right reason, an Apollo import populates the industry list,
"Competitors only" and the employee-size buckets each narrow correctly,
active filters render as chips, and "Remove N filtered" actually deletes
those companies' contacts.

**Not built yet, from the same thread:** Jack also said "the goal should
be to pull data from their website, linkedin, company linkedin and
apollos enriched data which is the best." Apollo and the website are
covered (live enrichment, and the export/research/import loop for sites).
LinkedIn is still not scrapeable and has no API here — see "Contacts:
Profile Agent" above for why that stays a manual field plus an Apollo-
supplied URL.

## Home rebuilt as a three-tier dashboard + Weekly Goals with pace (app/ only)

Per Jack: "i want to make a fully built out home page and make the weekly
goals much more defined and not ai crap use hubspot for this ui swap,"
against a redesign brief whose own diagnosis was right — the page was a
flat grid of equal-weight metric cards, so nothing read first and the rep
had to scan and decide rather than look and act.

**Cross-checked the brief against real data before building.** Roughly
half of what it specified has no data behind it, and building those
blocks with placeholder numbers would have made the page look finished
while lying every morning. What was dropped, and why:
- **Connects** (calls that reached someone) — the brief is right that
  calls without connects is vanity, but `connected` is a flag on a
  DISPOSITION, and a disposition lives on the Contact as one latest
  value, not on a call. Three voicemails to one person leave one value.
  Needs the per-call record (see the disposition section above); it is
  the next brick and the dialer makes it necessary anyway.
- **Reply classification** ("willing to meet", "question", "referral") —
  does not exist anywhere. `Task.repliedAt` is a manual "Mark replied"
  toggle with no reply body, sender or real timestamp. The page shows
  what was flagged, and calls it "flagged" rather than implying a real
  inbox.
- **Bounce rate and auto-paused sequences** — no delivery data at all
  until SendGrid. The page shows sequences PAUSED BY HAND and says so,
  rather than implying the system decided.
- **Reply rate** — same reason; a ratio of completed email tasks to
  manual flags is not a reply rate and would read as one.
- **"Start call session"** — there is no dialer; zero occurrences in the
  codebase. The button is honest: "Start calling", landing on Calls.

**What was built, in the brief's four tiers:**
1. **Greeting + one line of state.** Time-aware greeting, date and
   viewing-as on the right. The state line drops zero clauses entirely,
   so a clean day reads clean rather than printing "0 overdue".
2. **The action band** — the page's focal point and its ONLY primary
   button, with a 3px brand left border. States the queue size, overdue
   count and which product lines it covers, read off each task's
   contact. Empty state swaps to a SECONDARY "Go to sequences" rather
   than showing a dead primary button.
3. **Today's numbers** in one hairline-separated container: Calls,
   Emails, Meetings booked, Follow-ups due. Deltas compare against
   **your own average for this weekday** (`sameWeekdayAverage`,
   `lib/weeklyGoals.ts`) rather than yesterday, since Monday against
   Friday is noise. Needs no backend — every task already carries
   `completedAt`. The delta is omitted entirely below two prior
   same-weekday samples rather than printing a meaningless one.
4. **Two columns.** Left "Needs you now" is an action list, not a metric
   list: overdue tasks, today's follow-ups, flagged replies, paused
   sequences — each block hidden entirely when empty, and the whole
   column collapsing to a designed "You're clear" state when nothing
   needs attention. Right is week counters plus Weekly Goals.

**Weekly Goals rebuilt around pace, which is the actual point.** The old
version was three rows of bare number inputs and a thin bar: it told you
how full a bar was, never whether you were on track. Each metric now
shows where you are, a marker for where you SHOULD be given how far
through the week it is (`weekProgressFraction`), and a state — Goal hit /
On pace / N behind pace — with "on pace" as a 5% band rather than a knife
edge, so being half a call short of a 50 target isn't coloured as a
failure. Editing moved behind an Edit toggle so the display state is
clean, and **defaults to open when no metric has a target yet**, so a
fresh week can't read "No target set" three times with the only fix
hidden behind a button.

**Deliberately not done**, per the brief's own instruction: no chart. Six
data points of history is decoration, not a trend.

**Verification.** Platform audit 54/54 (one new check: never more than
one primary button on Home), disposition suite 12/12, audit-fix suite
8/8, Companies 16/16, plus a live pass over both the empty and populated
Home states.

## Apollo's Dynamics Sequence, reproduced natively (app/ only)

Per Jack: "pull in the dynamics sequence made by jack snellgrove in apollo
to here and see if we can re create it," then "the prompts in the
sequences now are great to use so copy and pull them over // both user and
system prompt for the automated email."

**Pulled live, not from memory.** `apollo_emailer_campaigns_show` on
emailer_campaign `6a0b653aba6c9100208889c0` ("Dynamics Sequence") returned
the real step order, wait times, email subject, LinkedIn note and both AI
prompts. Sequence reads cost 0 Apollo credits. Its live shape:

| # | Type | Wait | Content |
|---|---|---|---|
| 1 | Call | 0 (on enroll) | — |
| 2 | Auto email | 0h | Subject "Microsoft Solutions"; body AI-generated from the prompts |
| 3 | Call | 2 days | — |
| 4 | Call | 2 days | — |
| 5 | LinkedIn connect | 1h | Fixed note with `{{contact.first_name}}` |

Live performance at time of pull, worth keeping since it argues for the
dialer: **427 overdue manual tasks**, Apollo flags it
`is_performing_poorly`. Step 1 call 772 completed / 90.2% no answer / 19
meetings booked; step 3 571 / 91.4% / 6; step 4 496 / **94.0%** / 3. Email
638 delivered, 12.7% open (tracked), 4.2% reply, 3.4% demo, 1.25% opt-out.
The call steps carry this sequence; the third dial is near-exhausted.

**How it lands here — a code-level template, not a live import.** This
app's data lives in the viewer's own IndexedDB, so nothing outside the
browser can write a sequence into it. `lib/sequenceTemplates.ts` carries
the sequence as a `SequenceTemplate`, and `sequenceFromTemplate()` builds
a real, ordinary `Sequence` from it via the same `addStep`/`updateStep`
path the editor uses — so a template can never produce a step shape the
normal editor can't handle. Instantiating is a **create, not a link**:
editing the result changes only Jack's copy. Surfaced as a "📋 Templates"
button beside "+ New sequence" in `Sequences.tsx`.

**Both prompts are copied verbatim**, including Apollo's own two
banned-word lists, the 14 numbered writing rules, and its merge fields.
They live in the `systemPrompt`/`userPrompt` fields `SequenceStep` already
had — those were added speculatively an earlier session and turn out to map
exactly onto Apollo's `prompt_template.system_instructions` /
`instructions`. Two artifacts were left as-is rather than silently
corrected, since this is a copy of what is running: the LinkedIn note is
missing a space after `{{contact.first_name}}` (renders "Hey
Danareaching out here"), and the user prompt says "peaked their interest"
where it means "piqued." Both are flagged for Jack to fix in Apollo and
here together.

**Three supporting changes:**
- **`SequenceStep` gained `subject?` and `body?`** — what a step actually
  says, as opposed to `note` (a reminder to the rep working the task).
  Optional, so every step saved before this loads unchanged. Editable via
  a new "✉️ Content" toggle rendered only on non-call steps (a call has no
  message to write). **Filling these in still sends nothing** — same
  honesty line as everything else here; an email step still generates a
  manual task. `taskTextFor` now prefers a rendered subject over the note
  for the generated task's text.
- **`lib/mergeFields.ts`** — resolves `{{contact.first_name}}`,
  `{{contact.title}}`, `{{account.name}}` etc. against a real Contact,
  plus Apollo's own `{{#if token}}…{{#endif}}` conditional syntax (used in
  the Dynamics user prompt around `{{contact.title}}`). Deliberately not a
  general template engine — it handles exactly what Apollo's templates use.
  An **unknown** token stays visible as `{{token}}` rather than being
  blanked, because a template quietly missing a field reads as finished
  when it isn't; a **known** token with no value on that contact blanks,
  and the stranded punctuation/double spaces are collapsed so "Hey ,
  quick question" can't ship. The content editor previews against a real
  contact from the directory and names which one.
- **`MIN_WAIT_HOURS` 1 → 0.** Apollo's real sequence opens with a call at
  wait 0 and an email at wait 0; a 1-hour floor made that shape
  unrepresentable. `Task.date` is still calendar-day-only, so wait 0 means
  "due today."

**Deliberately not built:** no live "import from Apollo" button (would
need the connector inside the published page — a separate grant), no AI
generation of the email body (this app still has no LLM wired in; the step
says so in plain text), and Apollo's `Connected - Positive` /
`Connected - Neutral` outcomes were NOT added to the nine dispositions —
flagged for Jack, since collapsing them into Info requested / Call back
scheduled versus adding two more is his call.

Verified live, 22/22: template panel lists the sequence with its step
chips and "immediately" wait; using it creates and opens a 5-step
sequence; Content buttons appear on exactly the 2 non-call steps and both
show filled; the email step's system and user prompts read back Apollo's
verbatim text including the banned-word list and merge fields; the
LinkedIn body copies verbatim and its preview resolves against a real
contact; the subject reads "Microsoft Solutions"; enrolling generates the
step-1 call task on the Calls tab; everything survives a reload. Regression
suites after: platform audit 54/54, dispositions 12/12, audit-fix 8/8,
Companies 16/16. Two disposition-suite locators were updated for the flat
sidebar and the Filters popover (both documented app changes from earlier
passes) — every assertion is unchanged and still passes.

## Home: day/week task scope, call backs, hot leads (app/ only)

Per Jack: "the home page should have tasks for that day or week also and
people to call back follow ups or hot leads." Additive to the existing
Home — no panel was removed, no new IndexedDB store, no new field on any
record. Everything below is computed from `tasks` and `contacts` that
`App.tsx` already holds.

- **Day / Week toggle** on the "Needs you now" column header. The due-task
  block rescopes between today and Monday–Sunday of the current week, and
  relabels ("N due today" / "N due this week"); a week row also shows
  which day it lands on ("in 3d"). **Overdue is deliberately NOT
  rescoped** — past due is past due regardless of the window you're
  looking at, so that block always shows in full and a task can never
  appear in both.
- **Call backs** — everyone whose `disposition` is `call-back-scheduled`,
  one of the nine real call outcomes, so this is not a heuristic: it's
  simply who is sitting on that outcome, most recently seen first, each
  with a button through to Engage → Calls.
- **Hot leads** — this one needed a definition, and it is built only from
  fields that already exist. A hot lead is a contact the detection engine
  already put at Strong Signal (`tier === "signal"`), not crossed out, not
  Not interested and not Do not contact, not already in the Call backs
  block above, and either sitting on **Info requested** or with **zero
  calls and zero emails logged** (qualified but never worked).
  Info-requested rank first — they asked — then untouched, most recently
  seen first. **The definition is printed under the block** so the number
  is never a mystery, and it is a product decision Jack can change.
- `.status-pill.success` was a missing variant in `styles.css` (the tokens
  existed, the rule didn't) — added for the Hot pill. Non-interactive
  marker only; the green rule still holds, nothing green is clickable.
- Home's `onNavigate` widened from `"calls" | "sequences"` to include
  `"contacts"`.

Verified live, 16/16: two Strong Signal leads from a real CSV upload show
as hot with their product line and "Not worked yet" while a no-signal row
correctly does not; a call task dated three days out is hidden under Day
and appears under Week with its relative day; setting a lead to Call back
scheduled moves them out of the hot list and into a Call backs block; all
of it survives a reload. Suites after: audit 54/54, dispositions 12/12,
audit-fix 8/8, Companies 16/16, sequence template 22/22.

## Merge fields: {{#else}} and sender tokens (app/ only)

Found while pulling Apollo's full sequence design for the Sequence Engine
spec — reading every step type across all 20 live sequences surfaced a
defect in the renderer shipped a session earlier.

**Apollo's real templates use an else branch**, e.g.
`{{#if first_name}}{{first_name}}{{#else}}there{{#endif}}`, in both the
Commercial Real Estate call script and its LinkedIn note.
`renderMerge` (`lib/mergeFields.ts`) handled `{{#if}}…{{#endif}}` only, and
**both** branches were wrong:

| Case | Was | Now |
|---|---|---|
| Contact has a first name | `Hi Dana{{#else}}there, quick one…` | `Hi Dana, quick one…` |
| Contact has none | `Hi, quick one…` | `Hi there, quick one…` |

The first row is the dangerous one — control syntax leaking into copy a rep
pastes into a real email. The lazy inner capture swallowed the else marker
and its fallback text, then the substitution pass left `{{#else}}` visible
as an unresolved token.

Fixed by splitting the captured inner block on `{{#else}}` and picking the
branch. **Deliberately non-nesting**: the inner capture is lazy, so a
nested `{{#if}}` would bind to the first `{{#endif}}`. None of Apollo's
templates nest, and a real parser is a lot of machinery for a case that
doesn't occur — flagged in the code rather than silently assumed away.

**Sender tokens added**: `{{sender_first_name}}` (Apollo greets with the
first name, so it needs its own token rather than making callers split a
full name), `{{sender_name}}`, `{{sender_company}}`.

**`{{sender_meeting_alias}}` is deliberately NOT resolved.** It builds a
link to an Apollo booking page; this platform has no scheduling link, so
resolving it to a blank would silently produce "grab time
<a href="">here</a>" pointing nowhere. It stays a visible `{{token}}` the
writer has to deal with — exported as `KNOWN_UNSUPPORTED_TOKENS` so the
choice is documented in code, not just here.

Verified 12/12 against Apollo's real template text (both conditional
branches, no-else templates unchanged, the Dynamics LinkedIn note, the CRE
call script, and `tokensIn` correctly skipping the control words). Suites
after: sequence template 22/22, platform audit 54/54.

**Trailing-whitespace note**: a template ending in a blanked conditional
renders with a trailing space ("Title: "). Pre-existing, harmless, and the
collapse rules that handle double spaces and space-before-punctuation were
deliberate — left alone rather than widened.

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

**Status checklist**: ["End State Blueprint"](https://claude.ai/code/artifact/2c005df6-75cd-4422-8b94-9ca2c247311d)
(published artifact) — a nine-pillar checkpoint of what's shipped vs. still
ahead (Detection Engine/Scanner/Lead Library/History/Engage all shipped;
Access & Identity and Enrichment partially shipped by design; the Outbound
Engine researched but not built; two rebuild-parity gaps — the legacy
Playwright suite never run against `app/`, and the Chrome extension/
standalone-offline build outputs never reproduced from it — still open).
Re-generate/update this doc when a full status check is asked for again,
rather than trusting memory of it.

- Pull Apollo.io company/contact data into the app directly (API tie-in),
  instead of only ever importing a CSV export of it.
- Detect Teams meetings booked and auto-label/cross out the matching lead as
  "intro booked" — ties into the disposition/status tracking Jack's asked
  for (meeting booked / not interested / no contact yet / other, with a free
  -text note).
- A power dialer, eventually a 2x parallel dialer, hooked up to VOIP or
  Teams phone numbers.
- **Sequenced outbound task management — Phase 1 shipped**, see "Native
  Sequences" below. Research doc: ["Sequence UX Teardown"](https://claude.ai/code/artifact/b6dec613-1643-4f5a-a8d1-8d04872558c5)
  (published artifact) — a HubSpot-vs-Apollo comparison of their Sequences/
  Engage UI and underlying data model (step types, wait-time/schedule
  config, enrollment + auto-pause rules, dialer mechanics, reporting),
  including real sequence/task shapes pulled live from Apollo's own API,
  plus the phased build plan this followed (Phase 1: task/call-only
  sequencing reusing existing Task/Contact data, no email step — done;
  Phase 2: real email/LinkedIn sending once SendGrid/a LinkedIn API land;
  Phase 3: power dialer). Still ahead: pulling real Apollo sequence/call-
  outcome data in as its own separate track (see "Apollo sequences
  investigation" above — blocked on reauthorizing the connector).
- User accounts/login policies as a real precursor to any of the above
  (today's single shared password gate, per Access & ownership, isn't that).
- SendGrid tie-in for sending + monitoring outbound email, and a view of
  emails actually sent per lead. The sender-identity scaffolding (which
  account a sequence should send from) is built — see "Email sending
  accounts" above — but no backend relay exists yet to hold a real
  SendGrid API key or make an actual send call; that's still this item.
- Filtering/segmenting companies by size, industry, etc. — richer company-
  level data than what a lead CSV export alone carries today (Jack's named
  fields so far: estimated employees, industry, website).
- A LinkedIn integration — surfaced alongside the company-profile fields
  above, no scope defined yet (enrichment? profile links per contact?).
- **Timeline-based non-contacted filtering + auto-updating outreach state,
  feeding into sequences.** Per Jack, verbatim intent: be able to filter
  down to every lead not yet contacted within a chosen time window (e.g.
  "everyone untouched in the past N months"), and always have an
  at-a-glance read per lead of whether they've been contacted, how many
  calls, how many emails, what the last conversation was and where it
  stands — with that state able to auto-update over time (e.g. "no contact
  in 30 days" surfacing itself without a manual check) and eventually
  feeding a lead straight into a fully built outbound sequence. This is
  the connective layer between outreach tracking (`Contact.callCount`/
  `emailCount`/`outreachStatus`, already shipped) and the still-unbuilt
  power dialer/sequenced task management items above — a date-based
  "last contacted"/staleness field and a real filter UI for it are the
  most likely first slice, but not scoped or approved yet.

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
  **Every republish must pass the FULL capabilities object, every time** —
  `capabilities` is a full-set declaration; whatever isn't restated is
  silently revoked. This app currently needs both `downloads: true` (CSV
  exports — Scanner's Final Downloads, Library's per-file downloads,
  History's per-entry downloads, the audit trail export — all route
  through `saveViaClaudeDownloads` in `lib/csv.ts`, which is a total no-op
  without this capability) and `mcp: {servers: [{server: "Apollo.io",
  tools: ["apollo_people_match", "apollo_people_bulk_match",
  "apollo_organizations_enrich"]}]}` (Contacts' "Enrich via Apollo"/Profile
  Agent, and Scanner's upload-time company enrichment). **Bug that already happened once**: a republish
  that only passed `{mcp: {...}}}` (adding/confirming the Apollo grant)
  silently dropped `downloads`, breaking every CSV download in the
  deployed Artifact with no error shown anywhere — Jack had to report it
  as "download function broke." Before every publish call, restate BOTH
  capabilities together; don't add one without carrying the other forward.
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
