# Three scanners → one leads database

Jack's stated direction: *"I am going to build this out as three different
scanners and then ultimately build it into a massive leads database where you
can filter through search and it be very detailed."*

Everything below is measured against the code as it stands at
`scanner-platform-v29 @ e0402e8`, not estimated. Where a number is quoted it
came from a run against Jack's real files.

---

## Bottom line

Three things decide whether this works, and two of them are urgent:

1. **Two of the three scanners keep nothing.** Custom (SMC) and CSP persist a
   run record — counts and filenames — and no leads at all. Every Custom/CSP
   scan between now and the database being built is data you cannot get back
   unless the CSV was downloaded. **This is the one thing worth fixing before
   any further scanner work.**
2. **The storage layer cannot answer a query.** There are zero IndexedDB
   indexes and zero cursors in the codebase. The only read primitive is
   `dbGetAll` — load an entire store into memory, then filter in JavaScript.
   That is fine for 3,000 contacts and impossible for "massive".
3. **There is no join key.** The real CSP export has 13 columns and no account
   ID. SMC carries Microsoft TPIDs; Main carries nothing. Getting a stable
   identifier into the CSP export is a five-minute ask at source and a
   permanent fuzzy-matching problem if it never happens.

The scanners themselves are in good shape — 27 suites, 1,040 checks, three
engines that provably never import each other. The database is a storage and
query problem, not a detection problem.

---

## 1. What actually persists today

| | Main Scanner | Custom (SMC) | CSP |
|---|---|---|---|
| Engine | `lib/detection.ts` | `lib/smcLead.ts` | `lib/cspRenewal.ts` |
| Rows kept after the session | **Yes** — full `ResultRow[]` in History, including the entire raw CSV row, forever, no cap | **No** | **No** |
| What is kept | History entry + optionally Lead Library files | `Run2`: id, date, filenames, rule set, `rowsRead`, `duplicatesMerged`, bucket counts | same `Run2` shape |
| Per-lead decisions kept | disposition, priority, cross-out, category override | curation flag only (per click) | curation flag only |
| Can file into the Lead Library | Yes | **No** | **No** |

`buildRun` (`lib/scanner2.ts`) is the whole record for a Custom or CSP scan:

```ts
{ id, scanner, at, fileNames, ruleSetName, rowsRead, duplicatesMerged, counts }
```

No rows. Hit **Start over** and 9,265 scored CSP leads are gone.

### Storage inventory

21 IndexedDB stores, `DB_VERSION` 17. Relevant ones:

- Row-bearing: `history` (Main rows, unbounded), `files` (Lead Library, Strong
  Signal only, opt-in, month + category), `contacts`, `leadLists`
- Counts-only: `scanner2Runs`
- Everything else is config, tasks, sequences, profile, notes

**Known gap already flagged:** "Backup everything" covers 3 of 21 stores.
A restore today loses Contacts, Tasks, Sequences, Lists, Dispositions and
outreach history.

---

## 2. The measured ceilings

**Scanning** (real 24 MB CSP file, 9,265 rows) — linear, no cliff,
~13 MB and ~0.22 ms per row:

| Files | Rows | Parse | Scan | Memory |
|---|---|---|---|---|
| 1 | 9,265 | 1.0 s | 2.1 s | 126 MB |
| 3 | 27,795 | 2.8 s | 6.0 s | 355 MB |
| 6 | 55,590 | 5.7 s | 12.1 s | 610 MB |
| 12 | 111,180 | 11.7 s | 24.4 s | ~1.1 GB |

**Practical ceiling: ~6 files / ~55,000 rows in one tab.**

**Rendering and filtering** (3,000 contacts, before pagination was added):

| | before | after |
|---|---|---|
| Contacts tab switch | 4,998 ms | 65 ms |
| DOM nodes | 77,500 | 717 |
| Typing 5 characters in search | 1,267 ms | 169 ms |

Pagination fixed the *rendering*. The *filtering* still runs a JS predicate
over the whole in-memory array on every keystroke. At 3,000 rows that is
169 ms. At 300,000 it is not a UI.

**So:** the scan pipeline is fine and does not need rewriting. The
load-everything-then-filter-in-JS pattern is what breaks.

---

## 3. Four decisions, before any code

These are genuine forks. Each one changes what gets built.

### D1 — Does the database stay in the browser?

Current guardrail (CLAUDE.md, Access & ownership): local-only, single user, no
shared backend, and anything network-reachable must sit behind a real
credential gate.

| | Browser-local (IndexedDB) | Real backend |
|---|---|---|
| Realistic ceiling | Hundreds of thousands of leads **if** indexed and paged properly | Millions |
| Multi-user | Impossible — data lives in one browser | The reason to do it |
| Survives a cleared browser | No — this is the real risk today | Yes |
| Cost | None | Hosting, auth, backups, a migration |
| Breaks the guardrail | No | **Yes — needs Jack's explicit sign-off** |

**Recommendation: stay local for now, and build the query layer as if it were
a database anyway.** Indexed stores and cursor paging are the same work either
way, and they are what makes a later backend swap a port rather than a
rewrite. Go to a backend when a second person needs access, not when the row
count gets big — row count is solvable locally, sharing is not.

### D2 — One record shape, or three?

The three engines produce genuinely different things:

- **Main** — contact-shaped: name, title, email, phone, company, free-text
  notes → category, tier, DQ reasons, seat count
- **SMC** — account-shaped: TPIDs, propensity matrix per product, ownership
  flags, BANT, partner posture, multiple contacts per company
- **CSP** — renewal-shaped: licensing programme, billing rank, estimated
  value, partner lane, last touch, age, score

Flattening these into one wide table loses most of it. Three separate tables
make "search everything" a three-way union.

**Recommendation: a common spine plus a per-source facet.**

```
LeadRecord {
  id, source: "main" | "smc" | "csp",
  company, companyKey, website, domain,
  contact { first, last, title, email, phone, mobile, linkedin },
  productLine, priority, score, tier,
  firstSeenAt, lastSeenAt, sourceFiles[],
  disposition, crossedOut, onCrm, ownerId,     // decisions, never re-derived
  facet: MainFacet | SmcFacet | CspFacet        // the source's own shape, whole
}
```

The spine is what you filter and search on and it is identical across all
three. The facet is kept verbatim so nothing is lost and a re-scan can rebuild
from it. This is the same pattern `Contact` already uses successfully
(`category`/`disposition` on the record, source detail elsewhere).

### D3 — What makes two rows the same lead?

Today: batch-scoped exact name+company (scanners), email-first then
name+company (Contacts). Across three sources and months of uploads that is
not enough.

What each source actually carries:

| Source | Stable identifier | Reality |
|---|---|---|
| SMC | `tpids[]`, `msxAccount`, `leadId` | Real Microsoft account IDs — the good case |
| CSP | **none** | 13 columns: `customeridname` is a name string, `msp_partneraccountidname` is the partner's name |
| Main | none | Apollo/CRM exports; email is the best available |

**Action worth taking now, outside the code:** ask for the TPID or account
GUID to be included in the CSP export. It is a column at source and the
difference between a reliable join and permanent fuzzy matching. Without it,
CSP leads join on normalized company name + email domain, which will be wrong
some of the time and there is no way to make it not wrong.

Proposed resolution order: TPID → email → website domain → normalized company
name. Each match records *which* rule matched, so a bad merge is auditable and
reversible rather than silent.

### D4 — Current state, or full history?

"This lead, as of now" is simpler and smaller. "Every time we saw this lead
and what changed" is what answers *why did this go cold* and *have we touched
them before*, which is the reason to have the database at all.

**Recommendation: current state on the record, plus an append-only event log**
— the `outreachAttempts` store already works exactly this way and is the
proven pattern here. Scan sightings, disposition changes and outreach all land
in one timeline.

---

## 4. Phases

Sequenced so each one is useful on its own and nothing built early gets thrown
away.

### Phase 0 — Stop losing data *(small, do first)*

Custom and CSP keep their scored rows, the same way Main already does.

- Extend `Run2` to store rows, or give Scanner2 its own row store
- Wire Custom/CSP into the Lead Library, or give them the equivalent
- Widen "Backup everything" from 3 stores to all 21

Nothing else on this list is urgent. This is, because the cost of not doing it
compounds with every scan.

### Phase 1 — The unified record

- `lib/leadRecord.ts`: the spine + facet shape from D2
- A writer per scanner, mapping its own output into the spine
- Identity resolution per D3, with the matched rule recorded
- Backfill from what already exists: History rows, Lead Library files, Contacts
- **The scanners' own behaviour does not change.** They keep their engines,
  their rules, their buckets and their downloads. This is a write path added
  alongside, not a rewrite. The isolation suite must still pass.

### Phase 2 — A query layer that is actually a query layer

The part that makes "filter through search, very detailed" possible.

- Real `createIndex` on the fields that get filtered: company key, domain,
  product line, priority, disposition, owner, `lastSeenAt`, source
- Cursor + `IDBKeyRange` paging, replacing `dbGetAll`-then-filter
- A small query API: facet counts, sort, page — counts computed from indexes,
  not by scanning the array
- A text index for search. IndexedDB has no full-text: either a token index
  (a store keyed by token → lead ids) or an in-memory index built once per
  session over a projection, not the whole record

Acceptance: 100,000 leads, filter and search responsive, memory flat.

### Phase 3 — The database UI

- One Leads view over the unified record
- Faceted filters with live counts — the pattern Scanner2 already uses
  (`tests` + `rowsExcept`), which correctly counts every filter *except* its
  own
- Saved views ("Business Central, no partner, 50+ seats, untouched 90 days")
- Column chooser, export the current view, bulk actions
- Detail panel showing the facet in its source's own vocabulary

### Phase 4 — Enrichment and quality

- Company profiles attached at the company level, not per lead
- Apollo enrichment against the database rather than per upload
- Staleness: "last seen", "never contacted", "no touch in N days" as
  first-class filters — this is the Roadmap's existing timeline-filtering item
- Merge/unmerge UI for identity mistakes

### Phase 5 — Backend, only if D1 says so

Only when a second person needs access. The Phase 2 query API is the seam:
swap the implementation, keep the callers.

---

## 5. What must not break

- **Scanner isolation.** `detection.ts`, `smcLead.ts` and `cspRenewal.ts`
  never import each other; `scanner2.ts` is the only composer; the `isolation`
  suite asserts it. The database reads from all three and must not become a
  back door between them.
- **The download shape.** Ten columns, the canonical Apollo import shape
  (CSP: eight). Anything the database exports matches it.
- **Every lead stays visible and reversible.** Bad Leads and Low priority are
  excluded from downloads, never hidden or deleted.
- **Decisions are never re-derived.** Disposition, cross-out, On CRM, owner
  and curation belong to the record. A re-scan updates the detection facet and
  leaves them alone — this is already the rule for sticky state and must hold
  at database scale.
- **Access & ownership.** Private repo, credential gate on anything reachable.
  A database of every prospect Wired CIO has ever touched raises the stakes,
  it does not lower them.

---

## 6. Open questions

1. **D1** — local-only, or is a backend on the table? Everything else follows
   from this.
2. **CSP account ID** — can the export include a TPID or account GUID? Worth
   asking before more CSP files are scanned.
3. **Scope of the database** — every row scanned, or only qualified leads?
   Contacts already captures every row of every upload; the Lead Library only
   files Strong Signal. Which rule applies here?
4. **A fourth scanner** — Jack's own framing is that each new data source gets
   its own scanner. The unified record should assume a fourth exists; the
   facet design already allows it.
5. **Retention** — does a lead from two years ago stay forever? Unbounded
   growth is the current History behaviour and it is not deliberate.

---

*Written 2026-09-23 against `scanner-platform-v29 @ e0402e8`. Numbers are from
runs against `4e91c37e-Bookleads.csv` (13,106 rows) and
`961c0c2c-BookCSPs_9-4.csv`. Nothing in this document has been built.*
