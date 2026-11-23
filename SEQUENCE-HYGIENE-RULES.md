# Sequence Hygiene — rules and build prompt

Rules Jack set on 2026-11-22/23 while cleaning "11/23/26 Dynamics Emails"
(531 added → 399 kept). Saved so a dedicated tool can apply them. Nothing
here is built yet.

## The rules (who comes OUT of a new sequence)

A lead stays only if there has been **no successful contact** with the person.
Remove if ANY of these is true, checked across every source:

**Phone (Apollo calls; Trellus dials log into Apollo)**
1. Any call outcome other than No Answer / Left Voicemail:
   Meeting Booked, Qualified / Pending Review, Info Requested, Call Back
   Scheduled, Not interested, Do Not Contact.
2. A call logged with **No Disposition** that was really a conversation:
   - duration **≥ 240s** (4 min) — always out;
   - duration 120–239s with no note — out (Jack's call on 11/23);
   - the call note says they spoke, a meeting/follow-up was set, a quote was
     requested, they're evaluating, or they declined.
3. The contact **opted out of calls** (call_opted_out).
4. Gatekeeper / front-desk only, or "transferred to voicemail" = NOT contact.
   Keep them.

**Email**
5. Replied to any email (any sequence, any time) — out, whatever the reply said.
6. Unsubscribed / opted out / bounced / spam-blocked / invalid or no email.
7. Any 1:1 email thread with anyone at Wired CIO (Jack, Carly, any teammate;
   all sending domains: wiredcio.com, wired-cio.com, wiredcio.co/.us/.net,
   grandstrategygroup.com) where the prospect engaged. Automated sequence
   sends with no reply are NOT contact — list them separately, keep them.

**Meetings / CRM**
8. Any intro, discovery or sales meeting (Outlook/Teams calendar, HubSpot
   meeting, Echo recording, Notion meeting note).
9. Apollo contact stage = Meeting Logged, Not Interested, Open Deal,
   Review + Email.
10. A deal on file (Apollo or HubSpot), or the company is an **active
    client** (HubSpot lifecycle customer, closed-won deal). Clients are never
    prospected — this one has been missed before; check it every time.

**Sequence state**
11. A finished earlier sequence whose end reason shows contact: talked on
    phone, replied, interested, meeting, appointment.
12. Active or paused in ANY other sequence → finish them there (stop, with
    reason) so they are only active in the new one. (Jack's rule.)
13. Ever enrolled in the rep's live call sequence for the same product
    (e.g. Jacks Dynamics) — active or finished — out of the email sequence.
14. Same company already active in that call sequence with a different
    person → out of the email sequence (one outreach per company per motion).
15. More than one contact from the same company in the new sequence → keep
    one (strongest signal, then best title), flag the rest.
16. Same person twice (same email, or same full name at same company, or a
    second Apollo record) → keep one.

**Fit (review, don't auto-remove)**
17. Run every lead through the Vault Main Scanner (app/src/lib/detection.ts,
    scanParsedFiles) using the Apollo note (custom field
    68abe2198cb839001d7d67c3), tags (68c988cf882b300021d96942) and product
    line (68abe22a26a866001d3e1a08, only passed as Product Area when it is
    Dynamics/Power Platform). Wrong product line for the sequence, no signal,
    or Bad Lead → put in a REVIEW list. Jack decides; "no successful contact"
    leads stay unless he says otherwise.

**What counts as "contacted" in the final summary**
- Never touched: no calls, no sequence emails, nothing.
- Touched, no contact: only No Answer / voicemail / gatekeeper, or sequence
  emails with no reply. These STAY.
- Contacted: anything in rules 1–11. These GO.

## Process rules

- Read everything first, change nothing. Show the remove list grouped by
  reason with names and companies, plus the review list, plus counts. Apollo
  writes only after Jack says go.
- Remove mode = "remove" while the sequence has never sent (clean, no
  history). Use "stop" with a stop_reason for anyone already mid-sequence.
- New contacts are always added at step 1 via the API; Apollo has no
  start-at-step option.
- Re-adding: same status as the rest (paused if the sequence is off), same
  mailbox rotation the rest use, waive "finished in other sequence" only.
- Apollo limits: contacts_search 400/hour and 2,000/day; phone_calls_search
  400/hour. The Vault's own live sync spends the same quota — pause it
  first. phone_calls_search ignores account_id; always query by contact_id
  and confirm the returned contact_id. Its per_page=1 response still carries
  the full outcome facet counts — use that to stay cheap.
- Analytics reports show only 50 rows; slice by date until each slice ends on
  a zero row.
- Never trust a single source. Calls logged with No Disposition hide real
  conversations; Apollo stages miss clients; HubSpot holds client status.
- Keep prospect data out of the repo.

## Apollo IDs worth knowing

- Users: Jack 68bf4ba5f68a0600194acd11, Carly 6a738903389433001cdab5da.
- Call outcome ids: Not interested 66203bd7183e310422980485; Meeting Booked
  6a024dabd777bd000d626376; Info Requested 6a0f3f736d2f76001c1d81e9; Call
  Back Scheduled 6a73be64a0f3de000c6be57f; Qualified Pending Review
  6aa2c9e5aaca8f0020ba173e; Do Not Contact 6a989d8ec49089001c19afd7; Wrong
  Number 6a7df36eda04890018573da9; Gatekeeper 6a7df381b85a6000143a839e;
  Left Voicemail 6a85f9f01aba53000c122e8c; No Answer
  66203bd7183e31042298047d.
- Contact stages: Meeting Logged 6a73bd6b59c987000cc2c50c; Not Interested
  66203bd7183e31042298045e; Open Deal 6a65319835213500203822f0; Review +
  Email 6a73ee5976e5ba001c169964; Follow Up 6a73bd924f135d0014ac11a0 and
  Open 6a65319835213500203822ef are NOT contact.
- Apollo counts Gatekeeper and Wrong Number as "connected" in analytics —
  don't use "connect" alone as the contact test.

---

## The prompt (paste into a new chat)

```
You're building a tool for Jack (Sales Director, Wired CIO) inside his
private repo (The Wired CIO Vault, app/ — React + TypeScript + Vite). Read
CLAUDE.md and SEQUENCE-HYGIENE-RULES.md first; the rules file is the spec.

PROBLEM
Jack regularly loads old leads into a new Apollo sequence meant only for
people who have never been successfully contacted. Every time, people slip
in who already had a meeting, asked for info, said no, replied, unsubscribed,
spoke on a call logged with no disposition, are active clients, or are
already being worked in another sequence. Cleaning it by hand takes hours.

WHAT TO BUILD: "Sequence Hygiene" — a check that runs on one Apollo sequence
(picked by name) and returns three lists:
  1. REMOVE — successful contact or a hard block, each with the exact reason,
     source and date (rules 1–16 in SEQUENCE-HYGIENE-RULES.md).
  2. REVIEW — no contact but a fit question (rule 17: wrong product line per
     the Vault Main Scanner, no signal, Bad Lead, same-company duplicates).
  3. KEEP — split into "never touched" and "touched, no contact".
Plus: anyone active/paused in another sequence (offer to finish them there),
and anyone whose company has a colleague in the rep's call sequence.

SOURCES (read-only)
- Apollo: contacts in the sequence (contact_campaign_statuses incl.
  inactive_reason, contact_stage_id, email_unsubscribed, typed_custom_fields,
  deals); phone calls per contact (outcome facets, duration, note,
  call_opted_out); email replies; other sequences' membership.
- HubSpot: lifecycle stage, deals, logged emails/meetings/calls/notes per
  contact and company — the only reliable active-client signal.
- Outlook / Teams calendar: 1:1 threads and meetings with the prospect's
  domain from any Wired CIO mailbox.
- Optional: Echo meetings, Notion meeting notes.
Trellus dials log into Apollo, so Apollo calls cover them.

ACTIONS (each behind a confirm that names every contact)
- Remove from this sequence ("remove" if it has never sent, else "stop" with
  a reason).
- Finish in other sequences (stop, reason "Moved to <sequence>").
- Re-add someone removed by mistake (same status + mailbox rotation as the
  rest).
Nothing writes to Apollo without Jack's explicit OK in that moment.

CONSTRAINTS
- Follow CLAUDE.md: propose the design first (files, data model, where it
  lives — likely a tab next to Sequence Scanner, reusing lib/apolloSequences.ts
  and the existing read-only/limited-write Apollo guards) and wait for
  approval before writing code.
- Respect Apollo limits (400/hr contacts_search, 2,000/day; 400/hr calls):
  batch, resume where it stopped, show progress, never loop on a rate limit.
- Query calls by contact_id only (account_id is ignored by Apollo).
- Grade fit with the real Main Scanner (lib/detection.ts), not a copy.
- Never put prospect data in the repo; tests use synthetic fixtures.
- Every rule needs a test, including the traps: gatekeeper-only stays,
  No-Disposition 4-minute call goes, sequence email with no reply stays,
  HubSpot client goes even with a blank Apollo stage.

Start by restating the rules back as you understand them and listing any
you think are ambiguous. Build nothing until Jack approves the design.
```
