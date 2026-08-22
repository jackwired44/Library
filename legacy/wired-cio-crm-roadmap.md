# Wired CIO — Internal Sales CRM Roadmap

**North star:** the Unified Lead Scanner stops being a scan-and-export utility and becomes the real internal system of record — every lead tracked through its full lifecycle (never contacted → attempted → qualified → in sequence → closed), with sequencing built in, not just a one-time CSV handoff.

**End goal, with a real date on it:** a fully internally-owned and internally-managed outbound sales platform by **May 2027** — not a tool that sits next to Apollo, but the replacement for Apollo's CRM role (pipeline, lead qualification, status, ownership) *and* its sequencing/dialer role, plus a parallel power dialer (likely 2-line), all run under Jack's own roles/permissions and qualification policies rather than Apollo's. Set in August 2026 — roughly a 9-month build. This is the actual target everything below should be sequenced toward, not just a nice-to-have direction.

This doc is the reference point for that direction. Everything built from here forward should be evaluated against whether it moves toward this, not just whether it's a good standalone feature.

**Scope clarification — what's actually being replaced vs. kept:** this replaces Apollo's *execution* layer — the CRM/pipeline/status tracking, the qualification workflow, the sequencing engine, and the dialer. It does **not** replace Apollo's underlying company/contact data and enrichment. That data keeps getting used and enriched on an ongoing basis — Apollo stays the prospecting data source even after its CRM/dialer role is fully replaced. That's a meaningfully smaller (and more achievable) build than "replace all of Apollo," and it's reflected in the feasibility check below.

## The workflow this is actually built around

Stated plainly, so it doesn't get lost in the bigger phases below:

1. Upload all company leads → the Scanner processes, sorts, and summarizes them (this part works today).
2. Download the CSV → import into Apollo, into the *correct* sequence for that lead's product line.
3. **Eventually:** cross-reference Apollo call dispositions to determine which contacts were added to a sequence but never actually reached (no live conversation, not just "no reply").
4. **Eventually:** re-add a never-reached contact back into a sequence automatically, instead of it quietly going cold.

Steps 3 and 4 require reading data *back* from Apollo (dispositions, call outcomes, sequence membership) — not just pushing a CSV *into* it. That's a real API integration, not an export button, and it's the bridge between "uses Apollo" and "replaces Apollo": once dispositions are being read and acted on from outside Apollo, the dialer + sequencing engine underneath it becomes the only piece of Apollo still actually load-bearing.

## Where this stands today

Built and verified working:

- One scan pass detects both Microsoft licensing seat-count signals and Dynamics/Power BI/Fabric/Azure/Migration project signals per lead.
- Three product lines (M365 Tenant — licensing seats + tenant support/creation + generic migration, grouped — Dynamics 365, and Power BI / Azure / Fabric, grouped), auto-assigned with full manual override, single or bulk.
- Three tiers (Strong Signal / Needs Review / Bad Leads) with manual promotion or demotion between any of them, and product-line breakdown within each tier.
- A cross-cutting auto-DQ layer that forces a lead into Bad Leads (buyer-fit issues like 1-seat/freelancer, explicit rejection, locked-in-elsewhere, personal use, basic-support/login requests, wanting Microsoft's direct support — plus data hygiene like missing company name or a placeholder email, and the sub-20-seat licensing threshold, now fully visible instead of silently dropped) with a reportable reason breakdown per batch, while staying fully visible and manually reversible.
- Exactly three final CSV exports (Strong Signal only — Bad Leads and Needs Review are both excluded), always in sync with current category assignments.
- History: every import kept with its source file names, redownloadable at any time without re-uploading.
- Library: every uploaded CSV saved permanently and automatically (separate from History, which tracks scan results, not files) — survives page reloads with no manual save/load step, unlike History. Tracks an automatic "uploaded here" timestamp plus a manually-entered "leads received" date, supports downloading the exact original file back or re-running it through the Scanner at any time, single or bulk.
- Runs entirely client-side today — a single HTML file, no server, no login, no shared database. History lives in browser memory unless manually saved to a JSON file; Library persists on its own via the browser's local IndexedDB storage, but that's still browser-local, not a real database — see the feasibility note on item #1 below.

What this means for the CRM goal: the detection and categorization engine — the hardest, most bespoke part — is done and tested. Library is a real, meaningful step toward persistence (leads no longer disappear when a tab closes), but it's still browser-local storage on one machine, not a shared, backed-up system of record. What's missing is everything that makes it that: a real backend, identity, status over time, and outbound action.

## What "full CRM" actually requires

**1. A real backend.** Already flagged in an earlier conversation: this needs actual hosting, a real database, and login (likely tied to your Microsoft 365 / Entra ID login rather than a separate password system, given Wired CIO already lives in that ecosystem). Every other item below depends on this existing first — none of it works as a client-only file.

**2. Lead lifecycle status, not just tier + category.** Today a lead is Strong Signal or Needs Review. A CRM needs a real status field that persists and changes over time, independent of the detection tier — something like: New / Never Contacted → Attempted → Qualified → Disqualified → In Sequence → Responded → Closed Won / Closed Lost. This is the actual "leads never spoken with" tracking you're asking for — it doesn't exist yet because there was never anywhere to persist it.

**3. Activity history per lead.** Calls logged, emails sent, notes added, who touched it and when — this is what turns a spreadsheet-like export into a CRM. Requires the database from #1.

**4. Ownership and assignment.** If this is meant to hand leads to reps (which the three-CSV-export design was already built toward), the CRM version needs an actual "assigned to" field per lead instead of a CSV changing hands.

**5. Roles, permissions, and qualification policies.** Newly named requirement: this isn't just single-user tooling for Jack. It needs real role-based access (who can see/edit/reassign which leads, who can approve a Strong Signal, who can touch sequencing/dialer settings) and configurable qualification policies — the rules that decide what counts as "qualified" per product line, ideally editable without a code change rather than hardcoded into the detection engine. This sits on top of #1 (the backend/auth layer) and #2 (lifecycle status) — it's the governance layer that makes this safe to run as the actual system of record rather than a personal tool.

**6. Sequencing and dialing — now resolved as a phased path, not an either/or:**

  - **Phase now (built):** Scanner processes and sorts leads → CSV export, manually imported into the right Apollo sequence by hand.
  - **Phase near-term:** bidirectional Apollo integration — push qualified contacts into the correct sequence via API (no manual CSV import step), then pull call disposition data back to identify contacts that were enrolled but never actually reached, and re-enroll them automatically. Apollo is already connected as a tool in this session, so the API access needed for this exists today — this phase is about building the logic on top of it, not acquiring access.
  - **Phase end-state (target May 2027):** native sequencing *and* native parallel dialing (2-line) inside this platform, fully replacing Apollo and the power dialer. The near-term phase isn't a permanent architecture choice — it's the bridge that lets the tool start acting on real call outcomes now, while the native replacement gets built underneath it.

## Suggested build order

1. Stand up the real backend (hosting + database + login) — foundation for everything else.
2. Add persistent lead status (lifecycle stages) on top of the existing tier/category model — the detection engine doesn't change, it just stops being the *only* thing that determines a lead's state.
3. Add activity logging and rep assignment.
4. Add roles/permissions and configurable qualification policies — do this before opening the tool up to anyone beyond Jack, not as an afterthought once other people are already in it.
5. Build the bidirectional Apollo bridge: push qualified leads into the correct sequence via API, pull dispositions back, auto-flag/re-enroll never-reached contacts. (Company/contact enrichment via Apollo keeps running independently of this — it's not something this bridge replaces.)
6. Reporting layer — pipeline by rep, by product line, conversion from Strong Signal → Qualified → Closed.
7. Native sequencing engine, replacing the Apollo push side of step 5.
8. Native parallel dialer (2-line), replacing the power dialer and the remaining reason to hold an Apollo seat for CRM/sequencing purposes (Apollo's data/enrichment can still be kept separately, per the scope clarification above).

## Timeline

- **Aug 2026:** current state — scan/sort/summarize + 3-CSV export, manual Apollo import.
- **Target: full Apollo + power dialer replacement by May 2027.**

## Feasibility check (honest, as of Aug 2026)

Steps 1–6 in the build order — real backend, lifecycle status, activity history, rep assignment, roles/permissions + qualification policies, the bidirectional Apollo bridge, reporting — are realistically buildable well inside 9 months. None of that is exotic; it's standard internal-tool engineering, and the hardest part (the detection engine) is already done.

Keeping Apollo as the ongoing data/enrichment source (rather than also rebuilding a prospecting database from scratch) is a real de-risking factor, not just a scope note. Company/contact discovery and enrichment is its own hard, ongoing problem — data freshness, firmographic accuracy, contact-level email/phone verification — and it's explicitly out of scope here. That keeps this roadmap focused on the CRM/qualification/sequencing/dialer layer, which is the more tractable half of "replace Apollo."

Two things in the end-state are real risk, not just remaining work, and are worth being honest about rather than assuming they're a smaller version of the same problem:

- **Disposition data from Apollo isn't confirmed yet.** The plan to "cross-reference Apollo dispositions" assumes Apollo's API exposes call-outcome granularity (connected / no answer / voicemail / bad number) at the level needed to reliably flag "never reached." That needs to be verified against Apollo's actual API surface before the near-term phase is scoped — if it only exposes task status (scheduled/completed/skipped) rather than true call disposition, that phase needs a different data source or a manual logging step bolted on.
- **The native parallel dialer is the highest-risk single piece of this entire roadmap.** A 2-line power dialer is not just an engineering task — it inherits problems the dedicated dialer vendors (Orum, Nooks, Aircall, etc.) treat as ongoing operational work, not one-time builds: carrier number reputation and "Spam Likely" flagging (STIR/SHAKEN attestation), answering-machine detection accuracy, local-presence number provisioning, and call-recording consent compliance (varies by state, two-party-consent states in particular). The dialing mechanics themselves (e.g. via Twilio Voice) are achievable for a solo or small build; matching the connect-rate quality of an established dialer is a much longer, ongoing effort than a 9-month build-and-done. Same caution applies to fully replacing Apollo's sequencing/sending — a self-built sending pipeline has zero sender reputation on day one, and deliverability is a monitoring discipline, not a shippable feature.

Bottom line: the plan and phasing make sense, and most of it is achievable on this timeline. The dialer is the one piece I'd de-risk explicitly — either by scoping it down (single-line first, parallel dialing as a v2), building it on top of a telephony platform rather than fully from scratch, or giving it more runway than the rest of the roadmap. Worth also naming who's actually building this (just this collaboration, or is engineering headcount coming) — that changes what's realistic more than anything else on this list.

## Confirmed scope note — Aug 2026, in Jack's own words

Logged verbatim during the rebrand/Phase-1 feature pass, since it sharpens and confirms the scope above rather than changing it:

> Eventually I will want to pull data that is in my Apollo tenant into here so I can build out company details per contacts as well as the history in apollo so if a contact had already been spoken with its properly logged. Think of this as one day the entire source of truth for Wired CIO and our entire outbound sales process. Deals will not be stored here but the outbound engagement will be. Like Apollo but much lighter and more direct for my business and its processes.

Two things this confirms explicitly, worth keeping pinned down as the build gets sequenced:

- **Deals stay out of scope, permanently — not just for now.** This platform is the outbound-engagement system of record (contact-level: has this person been spoken with, what's the history, what's next), not a pipeline/deal-value tracker. Wherever deals live today (CRM, spreadsheet, whatever), that stays the deal source of truth; this tool doesn't grow a "deal stage/value" field later as a phase-3 surprise.
- **Company details per contact, pulled from Apollo, are part of the core vision** — not just enrichment as a nice-to-have, but the actual company-level context (industry, size, tech stack signals, etc.) sitting alongside each contact so the tool reads as a real account view, not a flat contact list. This is the concrete version of build-order item #5 (the bidirectional Apollo bridge) above: pulling Apollo's own logged history per contact (so a contact already spoken with in Apollo shows that here) plus company enrichment, rather than only pushing qualified leads out to Apollo sequences.

Not started — this is a direction note for when Phase 2+ of the feature build-out reaches the Apollo integration work, not a build in progress. The two concrete asks actually built in this pass (cross-out toggle + History tag/notes, documented in the tool's own README) came first because they were immediately actionable; this entry exists so the longer-term Apollo/source-of-truth direction doesn't get lost between now and when that work starts.

## The "full archive, on demand" phase — Aug 2026, explicitly paced by Jack

In his own words: "I want to be able to have all the csv lead files fully uploaded each month folder built out and be able to download a certain product line or search a lead on demand when i want to this will be simple and painless once it is fully complete. This entire project will take months. Step by step."

Three things confirmed by this:

- **The end state**: every CSV of leads Wired CIO has ever received, uploaded and sitting in its month folder, with two things possible at any moment without friction — pull every lead in a given product line across the WHOLE archive (not just one month), and find one specific lead by name/company no matter how long ago it came in.
- **The timeline**: Jack said outright this takes months and wants it delivered step by step, not as one big push. That instruction governs how this whole roadmap section gets built, not just this one entry — small, verified, working slices, each one immediately useful on its own, rather than a long buildup to one big reveal.
- **What "on demand" is standing on today**: the tool's month-organization (Library groups) and per-batch archive (History, now with tag labels) already exist from this same session's earlier work. What was still missing was a way to treat the WHOLE archive as one searchable/exportable set instead of one batch at a time.

**Step 1 (built this pass): "Select entire archive."** History's existing "Select all" only grabs the active week tab — fine for one batch, not for "every lead we've ever gotten." Added a second action, "Select entire archive (N)," that selects literally every History entry regardless of week or search filter, then feeds the existing "Combine into Scanner" → the Scanner's own search bar and Final Downloads exports, completely unchanged, now just operating across everything instead of one batch. No new search engine, no new export system — reusing what's already built and tested. Covered by `test-select-entire-archive.js`: two imports seeded weeks apart, confirmed the button selects both regardless of active week, confirmed the older one is findable via the normal Scanner search once combined, and confirmed a category export includes it too.

**Deliberately not built yet (a real Step 2, when it's actually needed):** today, finding one lead still takes select-entire-archive → combine → search — three clicks, not zero. That's an honest tradeoff for now: it reuses fully-tested infrastructure instead of a new parallel search system, and at the archive sizes Jack's at today it's fast. If the archive grows large enough that combining everything starts to feel slow or the three-click path stops feeling "on demand," the next step would be a true always-available search bar that queries across every History entry's actual lead rows directly — no combine step, no month/week navigation, type a name and see every match with its month and status. Worth revisiting once the archive is big enough to actually feel the friction, not before — building it earlier would be guessing at a UX problem that doesn't exist yet.

**Also still open, in rough order of what unlocks the most next:** (1) bulk-importing the actual backlog of historical CSVs Jack already has sitting outside the tool, so the archive is complete rather than starting from whatever gets uploaded going forward; (2) cross-month deduplication — today combining/exporting is a straight concatenation (documented as deliberate under "History at scale" above), which is fine at moderate scale but will need a real answer once the same lead can plausibly show up in several months' imports; (3) everything else already logged above (real backend, lifecycle status, Apollo bridge) — unchanged by this entry, just reaffirmed as the eventual destination this is all walking toward.
