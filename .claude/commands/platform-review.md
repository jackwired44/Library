---
description: Run the ten report-only platform agents and collect one report for Jack. Nothing in the platform is changed.
---

Run the ten platform agents defined in `.claude/agents/` and report back.
Jack sees the results in the Vault's **Agents** tab (bottom-left).

## 0. Decisions Jack pasted (if any)

If the message includes a block starting `Agent decisions from the Vault`,
apply it to `.claude/agent-state.json` before anything else:

- `Pause: <agent>` → add to `paused`. `Resume: <agent>` → remove.
- `Approve: <agent>/<id> — …` → this is Jack's go-ahead for that one item.
  Do exactly that item (it still follows the repo's working-style rules:
  proposal already approved, run the suites, commit, push), then add
  `<agent>/<id>` to `acted`.
- `Decline: <agent>/<id>` → do nothing with it; add it to `acted`.
- `Choose "<option>": <agent>/<id>` → do that option, then add to `acted`.

Nothing that is not in that block is approved.

## 1. Run the agents

Skip every agent listed in `paused` in `.claude/agent-state.json`; say which
were skipped.

Build the test bundle once (`cd app && npm run build:test`) and start
`npx vite preview --port 4173 --strictPort` in the background, so the
browser suites have something to run against. Tell each agent the preview
is already running. Launch the remaining agents in parallel, each with its
own scope and rules.

## 2. Store each report for the Vault

Write one file per agent that ran, `.claude/agent-reports/<agent>.json`:

```json
{
  "agent": "<name>",
  "at": "<ISO timestamp>",
  "status": "green | findings | blocked",
  "summary": "<one or two sentences>",
  "findings": [{ "severity": "high|medium|low", "text": "...", "where": "file:line or suite" }],
  "questions": [{ "id": "<short-kebab-id, stable across runs>", "text": "...", "options": ["approve", "decline"], "recommendation": "..." }],
  "checked": ["short list of what was fine"]
}
```

Never put prospect data (names, emails, companies) in a report: field names,
counts and file:line only.

Then `cd app && npm run build && cp dist/index.html ../wired-cio-lead-scanner-app.html`
so the Agents tab shows the new reports, and commit + push the report files
and the bundle to the working branch (reports only: no code changes ride
along unless Jack approved them in step 0).

## 3. Reply

Merge the reports into one message, most severe first:

1. **Needs Jack's decision**: every question, deduped, with options and a
   recommendation. Remind him he can answer in the Agents tab and paste the
   block back.
2. **Findings**: high, then medium, then low, each with file:line or suite
   and evidence.
3. **Green**: one line per agent that found nothing; and which were paused.

Rules for this command, same as for the agents: change nothing in the
platform, publish nothing, write nothing to Apollo. If an agent proposes a
fix, list it as a proposal. Jack decides.
