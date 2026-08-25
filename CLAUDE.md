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
- Companies.tsx is read-only, same posture as Contacts: search (company or
  contact name) and a sort dropdown (most recent/name/most contacts), no
  editing. Clicking a company row expands it in place to list its
  contacts (name/title/email or phone) — the only interaction beyond
  search/sort for now.
- No company-level tasks yet (Contacts' "+ Task" stays contact-only) —
  scoped out of this pass, flag if wanted next.

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
  view). Shows a static "Jack · Wired CIO Sales" identity block with a
  settings gear that calls the same `setShowCheatSheet(true)` the floating
  Cheat Sheet button already uses — no new settings surface.
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
