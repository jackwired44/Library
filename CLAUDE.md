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

## Library architecture (the trickiest part to port correctly)

- Saving to the Library is **opt-in per upload** (a checkbox, default OFF) —
  not automatic. Jack's own words: "the ability to select if that is what i
  want to do or just upload a one-off file just to scan review and do as i
  please."
- Only **Strong Signal** rows ever get filed — Needs Review and Bad Leads
  are never archived.
- Files are organized **3 per month per category** (Dynamics / Power BI-
  Azure-Fabric / M365 Tenant), appended to across multiple uploads in the
  same month rather than creating a new file per upload.
- Every individual lead inside a filed category file is editable, deletable,
  and movable to a different category (within the same month) in place —
  this is the fix for Scanner-side reassignments/tier promotions otherwise
  going stale in an already-filed archive copy. Automatic sync of a Scanner
  edit into an already-filed Library row was **deliberately left out** — it's
  a bigger design question (re-file on every keystroke? live diffing?) that
  needs its own decision from Jack, not something to build unilaterally.
- Persistence is IndexedDB, and it needs to survive a full page reload —
  that's the entire point of a "Library," and it's directly tested.

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
