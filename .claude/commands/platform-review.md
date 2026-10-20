---
description: Run the ten report-only platform agents and collect one report for Jack. Nothing is changed.
---

Run the ten platform agents defined in `.claude/agents/` in parallel, each
with its own scope and rules:

main-scanner-rules, custom-scanner-rules, csp-scanner-rules, notes-format,
apollo-read-only-guard, apollo-connection, sequences-and-reps,
lead-store-integrity, campaign-lists, tests-and-docs.

Before launching them, build the test bundle once (`cd app && npm run
build:test`) and start `npx vite preview --port 4173 --strictPort` in the
background, so the browser suites have something to run against. Tell each
agent the preview is already running.

Then merge their reports into one, most severe first:

1. **Needs Jack's decision** — every question the agents raised, deduped,
   each with its options and a recommendation.
2. **Findings** — high, then medium, then low, each with file:line or suite
   and evidence.
3. **Green** — one line per agent that found nothing.

Rules for this command, same as for the agents: change nothing, push
nothing, publish nothing, write nothing to Apollo. If an agent proposes a
fix, list it as a proposal. Jack decides.
