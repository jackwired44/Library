# Lead store + Apollo sync — design

Status: **design approved, implementation starting.** Measured against Jack's
live Apollo account and his three real scanner files on 2026-10-07.

Jack's framing, verbatim across the thread:

> "if we can see **where** the leads are assigned there then i know what has
> been acted on exactly and what hasnt"
>
> "we need to make this the **source of truth for leads** if we can compare
> whats assigned from these uploads as a task in a specific sequence in
> apollo i will know everything"
>
> "i will be able to filter through all strong signals here if they are
> active in a sequence finished their apollo and trellus selected
> disposition but **from raw lead to finished lead in this library**"
>
> "i will just upload the files again then store them going forward fresh
> library state as theyre uploaded pull the data over from apollo"

---

## 1. What Apollo actually provides (measured, not assumed)

Every call below was rehearsed live against the real account. Search reads
cost 0 credits.

### Contact record — `apollo_contacts_search`

```jsonc
{
  "email": "alfonso@americankeysupply.com",
  "name": "Alfonso Vasquez",
  "organization_name": "American Key Supply",
  "emailer_campaign_ids": ["6aa1691e1da2db001c122762"],
  "contact_campaign_statuses": [{
    "emailer_campaign_id": "6aa1691e1da2db001c122762",
    "status": "finished",                  // or "active"
    "inactive_reason": "Completed last step",
    "added_at": "2026-09-10T13:45:45Z",
    "finished_at": "2026-10-07T00:54:17Z",
    "paused_at": "2026-09-17T23:43:17Z",
    "current_step_id": "6aa1691e1da2db001c12276d"
  }]
}
```

This is the whole "where is it assigned" answer: **which sequence, what
state, which step, since when.** A contact can hold several at once — one
real contact (Kitsap Golf) is `finished` in one sequence and `active` in
another. A boolean would have hidden that.

### Call record — `apollo_phone_calls_search`

```jsonc
{
  "start_time": "2026-10-06T19:28:18Z",
  "duration": 65,
  "phone_call_outcome_id": "6a7df381b85a6000143a839e",
  "campaign_name": "Carly Main Sequence",
  "campaign_position": 5,
  "caller_name": "Carly Parks",
  "note_text": "Carly reached a gatekeeper, Danielle, while looking for …",
  "contact": { "email": "...", "name": "...", "organization_name": "..." }
}
```

`note_text` carries Trellus's own call summary and recording link. Sentiment
is faceted (149 positive / 107 negative / 821 neutral).

### The outcome vocabulary already matches this app's

35,513 calls, by outcome:

| Apollo outcome | calls | in `DISPOSITION_META`? |
|---|---:|---|
| No Answer | 29,026 | yes |
| *(no disposition logged)* | 5,349 | n/a |
| Not interested | 337 | yes |
| Gatekeeper / Front Desk | 234 | yes |
| Info Requested | 127 | yes |
| Call Back Scheduled | 123 | yes |
| Meeting Booked | 121 | yes |
| Wrong Number | 105 | yes |
| Left Voicemail | 61 | yes |
| **Qualified, Pending Review** | 28 | **NO — new** |
| Do Not Contact | 2 | yes |

Nine of eleven map 1:1 onto the taxonomy already shipped, so call history
imports with **no translation layer**. `Qualified, Pending Review` is the one
Apollo has that this app does not; it is added as a built-in, in the
`connected` bucket.

### Hard limits found

| | records | why a blind full pull fails |
|---|---:|---|
| Contacts | 136,371 | no "in a sequence" filter; display caps at 50,000 |
| Phone calls | 35,513 | ~5KB each (contact + account inlined) ≈ 175MB |
| Calls in the last 3 months | <12,000 | call #12,000 is 2026-06-03 |

**This is why the sync is lead-driven, not Apollo-driven.** The app knows
which leads it holds; it only ever needs Apollo state for those.

---

## 2. Match key — settled by measurement, not by preference

A real failure found on live data: the scanner row reads
`contact: "Josh Lewis"`, and the Apollo contact it created reads
`name: "Josh"` — **no last name**. A full-name match misses it silently.

Across all 7,709 CSP rows:

| key | coverage | collisions |
|---|---:|---:|
| email | **99.3%** | — |
| name + company | 100% | **0** |
| first-name + company | 100% | 26 of 7,680 (0.34%) |

**Rule: email first, then first-name + company.** Company names normalise
through the same legal-suffix stripping `normalizeBlockedName` already uses
(`Inc`, `LLC`, `Corp`, …), so `LCF Systems, Inc.` and `LCF SYSTEMS` agree.

---

## 3. Shape

Two stores, deliberately separate.

```ts
// lib/leadStore.ts — every lead ever scanned, all three scanners.
interface StoredLead {
  key: string;            // email key, else firstname|company
  scanner: "main" | "smc" | "csp";
  company; contact; title; email; phone; mobilePhone;
  productArea; notes; tier; score;
  firstSeenAt; lastSeenAt; sourceFiles: string[]; timesSeen: number;
}

// lib/apolloSync.ts — what Apollo says about that person, right now.
interface ApolloState {
  key: string;            // same key space
  sequences: { name; status: "active"|"finished"|"paused"; step; addedAt }[];
  // Calls are AGGREGATED, not listed. Per Jack: "most people i call 5-20
  // times each that doesnt matter … but it does for context of how many
  // per person." 29,026 of 35,513 real calls are No Answer, so a per-call
  // list is fourteen identical rows per lead and no extra meaning.
  callCount: number;
  outcomes: Record<string, number>;   // "No Answer": 14, "Left Voicemail": 2
  lastOutcome: string;
  lastCallAt: string;
  lastNote: string;                   // only the most recent note is kept
  syncedAt: string;
}
```

A lead therefore reads **"17 calls · No Answer ×14, Voicemail ×2,
Gatekeeper ×1 · last 6 Oct"** rather than seventeen rows. That is both what
Jack asked for and roughly a twentieth of the storage.

**Apollo state is never written onto the lead.** It is joined at read time.
A lead filed in August must not keep claiming August's sequence state
forever; re-sync once and every view corrects at once. This is the single
most important structural decision here.

---

## 4. Loop engineering — the trap this must not repeat

`Scanner2`'s faceted counts run **eleven passes over every row per
keystroke**. The search bug already fixed this session cost **1,033 ms per
keystroke** because `tests.search` rebuilt a per-row haystack *inside* the
filter, so one keystroke stringified the whole upload ten times over.

An Apollo filter is the same shape and would reproduce it exactly: eleven
passes × 9,265 rows × (normalise email → build key → Map lookup).

**Therefore: each row's Apollo state is resolved ONCE per scan and memoised
on `result`, exactly like `haystacks` is.** The filter predicates and the
facet counts read a precomputed value, never a key they derive themselves.
A probe in `perf-scan` guards it, proven to fail on the unguarded version
first.

Second trap: the index itself. Building a `Map` over the Apollo snapshot on
every render is O(n) per render. It is built once per snapshot, memoised at
`App` level, and passed down.

---

## 5. Workflow issues, and what each costs

1. **The snapshot is always one cycle behind.** Scan → download → upload to
   Apollo → enrol. An export can only reflect the *previous* cycle, so a
   lead enrolled an hour ago still reads "not in Apollo".
   **Mitigation that needs no Apollo call:** the app already knows what it
   downloaded. Recording "downloaded 2026-10-07 in `csp-high-priority.csv`"
   locally gives a second, always-accurate signal, so the honest state is
   *"downloaded, not yet confirmed in Apollo"* rather than *"net new"*.
2. **Staleness must be visible.** The panel states "synced 3 days ago ·
   7,412 contacts · 1,138 calls" and goes amber past two weeks. A silently
   stale snapshot is worse than none, because it reads as fact.
3. **Library semantics change.** Today it files **Strong Signal only, Main
   Scanner only**. "Every lead, all three scanners" is a different product.
   Custom and CSP currently persist **zero** leads (`buildRun` stores counts
   and filenames, no rows), so this is new storage, not a widening.
4. **Volume.** One cycle of the real files is 14,635 + 13,106 + 9,265 ≈
   **37,000 rows.** Jack's call — re-upload fresh, store going forward —
   means no backfill, but retention still needs an answer before this grows
   unbounded the way History already has.
5. **Apollo truncates names** (§2). Fallback key is first-name + company.
6. **`Qualified, Pending Review`** exists in Apollo and not here; adding it
   is additive and cannot disturb a filed lead.

---

## 5a. Sync is upload-triggered, never speculative

Jack, explicitly: *"but only as i upload contatcts"* and *"dont upload or
update those numbers here or what sequence a lead is assigned to til i
upload the files going forward."*

So the sync is **lead-driven and pull-on-demand**:

- Nothing is fetched from Apollo until leads exist in the store.
- No Apollo state is pre-seeded, and no historical backfill is performed.
- A sync only ever asks Apollo about people the Library already holds.

This is also what makes the volume tractable (§1): the app never has to walk
136,371 contacts, only the few thousand it actually scanned.

## 6. Build order

1. `lib/leadStore.ts` + filing from all three scanners (the "store going
   forward" half — nothing else works without it).
2. Library view over it: search, tier/scanner/product filters.
3. `lib/apolloSync.ts` — model, importer, match, join.
4. Apollo column + filter on all three scanners and in the Library.
5. The download ledger (§5.1).

Engines are untouched throughout: `detection.ts`, `smcLead.ts` and
`cspRenewal.ts` gain nothing and import nothing, so the `isolation` suite
holds unchanged.
