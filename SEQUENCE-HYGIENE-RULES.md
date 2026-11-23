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

```
Build a standalone tool for me — Jack, Sales Director at Wired CIO (a
Microsoft partner selling Dynamics 365 and M365/Azure). It's its own
project, not part of any existing app. Name: "Sequence Hygiene".

WHY
I often load old leads into a new Apollo sequence meant only for people who
have NEVER been successfully contacted. Every time, people slip in who
already booked a meeting, asked for info, said no, replied, unsubscribed,
had a real conversation logged with no disposition, are active clients, or
are already being worked elsewhere. Cleaning it by hand takes hours and still
misses people, because the evidence is spread across many systems.

WHAT IT DOES
I pick one Apollo sequence. The tool checks every contact (person AND their
company / email domain) against EVERY source below and gives me:
  1. REMOVE — contact made or hard block (name, company, email, reason,
     source, date, link back to the record)
  2. REVIEW — no contact, but I should decide (wrong product line,
     duplicate company, weak fit, a source that couldn't be checked)
  3. KEEP — split into "never touched" and "touched, no contact"
  4. CONFLICTS — active/paused in another sequence, or a colleague at the
     same company already in my live call sequence
Every contact also gets a STATUS that tells me what to do next:
  - Never touched — no calls, no emails, nothing.
  - Touched, no contact — only no answer / voicemail / gatekeeper /
    unreplied emails. Fine to sequence.
  - Contacted, went nowhere — we reached them (or they replied) but it
    stalled: no meeting, no next step, no hard no. A follow-up candidate,
    not an automatic remove.
  - Live / next step pending — meeting booked, info requested, call back,
    open deal. Out of any sequence; belongs to a rep's follow-up.
  - Closed — not interested, DNC, unsubscribed, client, bounced. Out.

REVIEW SCREEN (the main screen)
- A table of everyone flagged REMOVE or REVIEW, with checkboxes: select
  one by one, select all, select all in a filter (by reason, status,
  source, company, last-touch date range).
- Click a person to open a detail panel showing everything at once:
  - Every reason they were flagged, with the source, date and a link.
  - TOUCHPOINT HISTORY: every sequence they've ever been in (Apollo, any
    rep): sequence name, owner, added date, finished date, end reason,
    furthest step reached of total ("step 4 of 6"), and each step that
    actually happened (date, type — call / auto email / manual email /
    LinkedIn connect / LinkedIn message / task — and its result: delivered,
    opened, replied, bounced, no answer, voicemail, connected + outcome).
  - Totals: number of sequences, calls (and how many connected), emails
    sent / opened / replied, LinkedIn touches, meetings, total touchpoints,
    first touch, last touch, days since last touch.
  - Every call with duration, outcome, caller and note (and the Trellus
    summary/transcript link), every email thread, every meeting (Echo,
    calendar, HubSpot, Switchboard).
- Per person or for the selection, I choose an outcome:
  Remove · Keep in this sequence · Move to another sequence (pick it) ·
  Follow up manually (creates nothing — just tags it) · Skip for now.
  Each choice takes an optional note. Show a final summary of all choices
  before anything is written.
- The same touchpoint history columns (sequences count, furthest step,
  total touches, last touch, status) are sortable/filterable in the table,
  so I can pull e.g. "contacted, went nowhere, last touch 60+ days ago" and
  plan a new follow-up or a new sequence for them.

ACTIONS (each behind a confirm listing every contact affected; nothing
writes anywhere without my explicit OK):
  remove from this sequence · finish them in other sequences · move to
  another sequence (finish here, add there) · re-add anyone removed by
  mistake · export the selection to CSV with full touchpoint history.

SOURCES — check ALL of them, every run. A source that can't be reached is
reported as "not checked" on every affected row, never silently skipped.
 1. Apollo contacts & sequences — per-sequence status, end reason, step,
    contact stage, unsubscribe flag, custom fields, deals, every other
    sequence the person was in.
 2. Apollo email — every message sent to them and every reply (any
    sequence, any mailbox), bounces, unsubscribes.
 3. Apollo calls — outcome, duration, note, opt-out, caller.
 4. Trellus — our dialer. Its calls sync into Apollo, but read Trellus
    directly too: call recordings/transcripts and AI summaries catch real
    conversations Apollo logged as No Answer or No Disposition.
 5. Echo — our recorded-meetings archive (sales, delivery, internal).
    Any meeting with this person or anyone at their company/domain = contact.
 6. Switchboard — our internal sales desk: deals, companies, contacts,
    discovery questionnaires, proposals, client workspaces, sales meetings,
    the decision queue. Any deal, meeting, questionnaire or proposal for the
    company = out.
 7. HubSpot — lifecycle stage, deals (any stage), and logged emails,
    meetings, calls and notes on the contact and the company.
 8. Active clients — anyone whose company is a current Wired CIO client:
    HubSpot lifecycle customer, a closed-won deal, a Switchboard client
    workspace, or an active account in our PSA (projects/tickets). Clients
    are never prospected, at any contact, at any title.
 9. Outlook inboxes — every Wired CIO mailbox (mine, Carly's, and all
    sending domains: wiredcio.com, wired-cio.com, wiredcio.co, wiredcio.us,
    wiredcio.net, grandstrategygroup.com): any thread with the person or
    their domain where they wrote back, and any calendar invite/meeting with
    them. Teams chats/meetings too if available.

REMOVE IF ANY OF THESE IS TRUE
Phone (Apollo + Trellus)
 1. Any outcome besides No Answer / Left Voicemail: Meeting Booked,
    Qualified/Pending Review, Info Requested, Call Back Scheduled, Not
    interested, Do Not Contact.
 2. A "No Disposition" (or mis-logged No Answer) call that was really a
    conversation: >= 240s; 120–239s with no note; or a note, transcript or
    summary saying they spoke, set a meeting/follow-up, asked for a quote,
    are evaluating, or declined.
 3. Opted out of calls.
    KEEP: gatekeeper / front desk only, or "transferred to voicemail".
Email (Apollo email + Outlook + HubSpot)
 4. Replied to any email, from anyone at Wired CIO, any time.
 5. Unsubscribed, opted out, bounced, spam-blocked, invalid or no email.
 6. Any real 1:1 thread where they engaged. Unreplied sequence emails are
    NOT contact (keep, mark "touched").
Meetings / CRM (Echo + Switchboard + HubSpot + Outlook calendar)
 7. Any intro, discovery, demo or sales meeting with the person — or
    anyone at their company — whether booked, held, or recorded.
 8. Apollo stage is Meeting Logged, Not Interested, Open Deal, or
    Review + Email. (Follow Up and Open are fine.)
 9. A deal or proposal on file anywhere (Apollo, HubSpot, Switchboard).
10. Active client (source 8).
Sequence state
11. An earlier sequence ended with a contact reason: talked on phone,
    replied, interested, meeting, appointment.
12. Active/paused in any other sequence -> offer to finish them there.
13. Ever in my live call sequence for the same product (active or
    finished) -> out of an email-only sequence.
14. A colleague at the same company is active in that call sequence -> out
    (one outreach per company per motion).
15. Several people from one company in this sequence -> keep the best one,
    rest to REVIEW.
16. Same person twice (same email, same name + company, duplicate record)
    -> keep one.
Fit (REVIEW only, never auto-remove)
17. Notes/product line don't match the sequence's product, or show no
    product signal. Editable keyword lists:
    Dynamics: Dynamics, D365, Business Central, ERP, F&O, supply chain,
    NAV, GP, AX, Power Apps/Automate/Platform, Dataverse
    M365/Azure: Microsoft 365, Office 365, Azure, Copilot, Intune,
    Defender, Entra, Teams, licensing
    A bare "CRM" or "sales" doesn't count without Dynamics/D365 beside it.

Match on person AND company: email, full name + company, and email domain
(ignore free domains like gmail/outlook/yahoo for the company match).

APOLLO GOTCHAS
- Limits: contact search 400/hr and 2,000/day; call search 400/hr. Batch,
  save progress, resume, show progress, stop cleanly on a rate limit —
  never retry in a loop.
- Call search ignores account_id: query by contact_id and verify the
  returned contact_id. per_page=1 still returns full outcome counts.
- Analytics counts Gatekeeper and Wrong Number as "connected" and caps at
  50 rows — don't use "connected" alone.
- No Disposition calls hide real conversations: read duration and notes
  (and the Trellus transcript).
- API adds always start at step 1. Remove = "remove" if the sequence has
  never sent, else "stop" with a reason. Re-add with the same status and
  mailbox rotation as the rest.
- Outcome IDs: Not interested 66203bd7183e310422980485 · Meeting Booked
  6a024dabd777bd000d626376 · Info Requested 6a0f3f736d2f76001c1d81e9 ·
  Call Back 6a73be64a0f3de000c6be57f · Pending Review
  6aa2c9e5aaca8f0020ba173e · Do Not Contact 6a989d8ec49089001c19afd7 ·
  Wrong Number 6a7df36eda04890018573da9 · Gatekeeper
  6a7df381b85a6000143a839e · Left Voicemail 6a85f9f01aba53000c122e8c ·
  No Answer 66203bd7183e31042298047d
- Stages: Meeting Logged 6a73bd6b59c987000cc2c50c · Not Interested
  66203bd7183e31042298045e · Open Deal 6a65319835213500203822f0 ·
  Review + Email 6a73ee5976e5ba001c169964 (fine: Follow Up
  6a73bd924f135d0014ac11a0, Open 6a65319835213500203822ef)
- Users: Jack 68bf4ba5f68a0600194acd11 · Carly 6a738903389433001cdab5da

REQUIREMENTS
- Private to me (later Carly) behind a real login — it holds prospect and
  client data. All credentials server-side, never in the browser or repo.
- No prospect data in the code repo; tests use made-up data.
- A test for every rule and every source, including the traps:
  gatekeeper-only stays; a 4-minute No Disposition call goes; a Trellus
  transcript showing a conversation overrides a "No Answer" log; an
  unreplied sequence email stays; a client in HubSpot/Switchboard/PSA goes
  even with a blank Apollo stage; a 6-step sequence finished at step 4
  shows "step 4 of 6" with the 4 touches listed; an Echo meeting with a colleague at the
  same domain removes the whole company; a call result belonging to
  another contact is rejected; an unreachable source shows "not checked".
- Every result row links back to its source record (Apollo, HubSpot,
  Echo, Switchboard, Outlook).
- CSV export of REMOVE / REVIEW / KEEP with reason, source, status and
  touchpoint totals per row; a second CSV with every touchpoint (one row
  per sequence step / call / email / meeting).

START HERE
Restate the rules and sources in your own words, list what access you'll
need for each source (and flag any that has no API you can reach), flag
anything ambiguous, and propose a design: stack, hosting, auth to each
source, data model, screens, build order. Build nothing until I approve.
```
