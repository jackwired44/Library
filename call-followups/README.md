# Call Follow-ups

A standalone tool, separate from the Wired CIO Lead Scanner (which is
archived). Pick a rep, one or more call dispositions (default **Info Requested**) and
a day or date range, pull every matching Apollo call, open the Trellus
recording if needed, and click **Draft** to get the follow-up email written
from what was said on the call. **Create Outlook draft** puts it in your
Outlook Drafts folder. It never sends.

## Dispositions

The Dispositions picker lists every call disposition set up in your Apollo
account, read live from Apollo (0 credits) the first time you open it and
refreshed on every pull, so a disposition added in Apollo shows up without
a code change. Tick as many as you want; nothing ticked means any
disposition. They're grouped the way calls actually go: **Reached them**
(Meeting Booked, Call Back Scheduled, Info Requested, Qualified, Not
interested, Do Not Contact), **Didn't reach them** (Gatekeeper, Left
Voicemail, No Answer, Wrong Number) and **Other** (No Disposition, plus
anything a new name doesn't match). Grouping is by name; ids are Apollo's.

## Where the call content comes from

Trellus-logged calls in Apollo have no recording file or transcript.
Trellus writes its own AI summary of the conversation into the call's note,
followed by a `Recording: https://app.trellus.ai/…` link. The summary is
the drafting source. The recording is a link you open, never scraped.
Calls with no summary are flagged **No call summary** and take pasted notes
instead.

## The email

Always this structure, in plain text, 60 to 120 words:

1. `Hi {First}, following up after our call.`
2. A high-level recap of what you talked about.
3. What you agreed to as next steps, only what's in the call notes.
4. `If any questions come up in the meantime, feel free to reach out.`

Lowercase 2 to 5 word subject, no links, no em dashes or exclamation
points, and Jack's banned-word list is checked after writing (one automatic
rewrite if anything slips). Drafted by Claude on the viewer's own account
through the Artifact `sample` capability. Without it, a labeled
**Template draft** fills the same structure from the call notes.

## Runtime capabilities (restate ALL of them on every publish)

- `mcp`: Apollo.io `apollo_phone_calls_search`, `apollo_users_api_profile`,
  `apollo_users_search`; Microsoft 365 `outlook_create_draft` only.
- `sample`: Claude drafting.
- `db` + `user`: statuses, drafts and pasted notes saved under the
  viewer's private path, so they follow you across devices. Outside a
  claude.ai viewer the page falls back to this browser's IndexedDB.

Apollo's call search has no outcome or date filter, so the page reads
newest-first and stops at the first page older than the range start
(capped at 60 pages, with a warning if hit). Call reads cost 0 credits.

## Access

No sign-in screen, per Jack. The artifact is private to the owner's
claude.ai account, and that login is the access control. Anyone it is
shared with from the page's Share menu can open it, so share deliberately.

## Develop and test

```
npm install
npm run dev
npm test          # builds, runs both suites
```

`scripts/suites/followups.cjs` is the unit suite (note parsing, local-day
date ranges, call selection, one row per contact, sticky merge, banned
words, email structure). `followups-ui.cjs` drives the built page in
Chromium with Apollo, Outlook and Claude mocked in the shapes observed
from the live connectors. It needs Playwright resolvable from this folder.
