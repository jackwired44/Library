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

## The prompt (paste into a new chat — standalone tool, separate from the Vault)

The tool is its own project. It does not live in, import from, or depend on
the Wired CIO Vault. Everything it needs is in the prompt below.

```
Build a standalone tool for Jack, Sales Director at Wired CIO (an IT /
Microsoft partner selling Dynamics 365 and M365/Azure). It is a separate
project — not part of any existing app. Call it "Sequence Hygiene".

THE PROBLEM
Jack regularly loads old leads into a new Apollo sequence meant only for
people who have NEVER been successfully contacted. Every time, people slip in
who already had a meeting, asked for info, said no, replied, unsubscribed,
spoke on a call that was logged with no disposition, are active clients, or
are already being worked in another sequence. Cleaning it by hand takes hours
and still misses people.

WHAT IT DOES
Pick one Apollo sequence by name. The tool reads every contact in it, checks
each against every source below, and returns:
  1. REMOVE — successful contact or a hard block. Each row: name, company,
     email, exact reason, source, date.
  2. REVIEW — no contact, but a question Jack should decide (wrong product
     line for the sequence, same-company duplicate, weak fit).
  3. KEEP — split into "never touched" and "touched, no contact".
  4. OTHER SEQUENCES — anyone active/paused in another sequence, and anyone
     whose company already has a colleague in the rep's live call sequence.
Then offer actions, each behind a confirm listing every contact affected:
remove from this sequence, finish them in other sequences, re-add someone
removed by mistake. Nothing writes anywhere without Jack's explicit OK.

THE RULES — remove if ANY is true
Phone (Apollo call logs; Trellus dials log into Apollo):
 1. Any call outcome other than No Answer / Left Voicemail: Meeting Booked,
    Qualified/Pending Review, Info Requested, Call Back Scheduled, Not
    interested, Do Not Contact.
 2. A call with NO DISPOSITION that was really a conversation: duration
    >= 240s; or 120–239s with no note; or a note saying they spoke, a
    meeting/follow-up was set, a quote was requested, they're evaluating, or
    they declined.
 3. The contact opted out of calls.
 4. KEEP: gatekeeper / front desk only, or "transferred to voicemail".
Email:
 5. Replied to any email, any sequence, any time.
 6. Unsubscribed, opted out, bounced, spam-blocked, invalid or missing email.
 7. A real 1:1 email thread with anyone at Wired CIO where the prospect
    engaged. Sending domains: wiredcio.com, wired-cio.com, wiredcio.co,
    wiredcio.us, wiredcio.net, grandstrategygroup.com. Automated sequence
    emails with no reply are NOT contact — keep, but label them "touched".
Meetings / CRM:
 8. Any intro, discovery or sales meeting (Outlook/Teams calendar, HubSpot
    meeting, recorded meeting).
 9. Apollo contact stage = Meeting Logged, Not Interested, Open Deal, or
    Review + Email. (Follow Up and Open are fine.)
10. A deal on file, or the company is an ACTIVE CLIENT (HubSpot lifecycle
    customer or a closed-won deal). Clients are never prospected. This has
    been missed before because Apollo shows nothing — always check HubSpot.
Sequence state:
11. Finished an earlier sequence with an end reason showing contact: talked
    on phone, replied, interested, meeting, appointment.
12. Active or paused in ANY other sequence -> offer to finish them there so
    they're only active in this one.
13. Ever in the rep's live call sequence for the same product (active or
    finished) -> out of an email-only sequence.
14. Same company already active in that call sequence with a different
    person -> out (one outreach per company per motion).
15. Several contacts from one company in this sequence -> keep one (best
    title / strongest note), send the rest to REVIEW.
16. Same person twice (same email, same full name at same company, or a
    duplicate Apollo record) -> keep one.
Fit (REVIEW, never auto-remove): the lead's note/product line says it
belongs to a different product line than the sequence (e.g. M365/Azure in a
Dynamics sequence), or has no product signal at all. Make the product-line
test a simple, editable keyword list: Dynamics = Dynamics/D365/Business
Central/ERP/F&O/supply chain/NAV/GP/AX/Power Apps/Power Automate/Power
Platform/Dataverse; M365/Azure = Microsoft 365/Office 365/Azure/Copilot/
Intune/Defender/Entra/Teams/licensing. Bare "CRM"/"sales" don't count without
Dynamics/D365 beside them.

Summary labels: "Never touched" = no calls, no sequence emails. "Touched, no
contact" = only no answer / voicemail / gatekeeper / unreplied sequence
emails (these STAY). "Contacted" = anything in rules 1–11 (these GO).

SOURCES (all read-only except the confirmed actions)
- Apollo API: sequence contacts with per-sequence status, end reason, step,
  contact stage, unsubscribe flag, custom fields, deals; phone calls per
  contact (outcome counts, duration, note, opt-out); email replies;
  membership of other sequences.
- HubSpot: lifecycle stage, deals, logged emails/meetings/calls/notes per
  contact and per company.
- Microsoft 365 (Outlook mail + calendar) for Jack's and Carly's mailboxes.
Use the real APIs with credentials kept server-side (never in the browser,
never in the repo). If a source isn't connected, say so in the report rather
than skipping silently.

APOLLO REALITIES (learned the hard way)
- Limits: contacts search 400/hour and 2,000/day; phone-call search
  400/hour. Batch, save progress, resume where it stopped, show progress, and
  stop cleanly on a rate limit — never retry in a loop.
- Phone-call search IGNORES account_id; query by contact_id and confirm the
  returned contact_id. A per_page=1 call still returns full outcome counts.
- Apollo analytics counts Gatekeeper and Wrong Number as "connected", and
  reports cap at 50 rows — don't use "connected" alone as the contact test.
- Calls logged with No Disposition hide real conversations; always read
  duration and notes.
- Adding via the API always starts at step 1 (no start-at-step option).
- Removing: use "remove" if the sequence has never sent; otherwise "stop"
  with a reason. Re-adding: same status (paused if the sequence is off) and
  the same mailbox rotation the rest of the sequence uses.
- Call outcome ids: Not interested 66203bd7183e310422980485; Meeting Booked
  6a024dabd777bd000d626376; Info Requested 6a0f3f736d2f76001c1d81e9; Call
  Back Scheduled 6a73be64a0f3de000c6be57f; Qualified Pending Review
  6aa2c9e5aaca8f0020ba173e; Do Not Contact 6a989d8ec49089001c19afd7; Wrong
  Number 6a7df36eda04890018573da9; Gatekeeper 6a7df381b85a6000143a839e;
  Left Voicemail 6a85f9f01aba53000c122e8c; No Answer
  66203bd7183e31042298047d.
- Contact stages: Meeting Logged 6a73bd6b59c987000cc2c50c; Not Interested
  66203bd7183e31042298045e; Open Deal 6a65319835213500203822f0; Review +
  Email 6a73ee5976e5ba001c169964. Not contact: Follow Up
  6a73bd924f135d0014ac11a0, Open 6a65319835213500203822ef.
- Users: Jack 68bf4ba5f68a0600194acd11, Carly 6a738903389433001cdab5da.

REQUIREMENTS
- Access: private to Jack (and later Carly) behind a real login; it handles
  prospect and client data.
- Never store prospect data in the code repo; tests use synthetic fixtures.
- Every rule gets a test, including the traps: gatekeeper-only stays; a
  4-minute No-Disposition call goes; an unreplied sequence email stays; a
  HubSpot client goes even with a blank Apollo stage; a call search that
  returns another contact's calls is rejected.
- Results exportable as CSV (remove / review / keep), with the reason per
  row.

HOW TO START
Restate the rules in your own words, list anything ambiguous, and propose
the design — stack, where it runs, how it authenticates to Apollo, HubSpot
and Microsoft 365, data model, screens, and the order you'd build it in.
Build nothing until Jack approves the design.
```
