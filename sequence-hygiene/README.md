# Sequence Hygiene

A standalone tool, separate from the Lead Scanner app in this repo. It checks every contact in one
Apollo sequence (person and company) against Apollo, HubSpot, Echo, Switchboard and Outlook. Each
contact is sorted into REMOVE / REVIEW / KEEP / CONFLICTS with a status, and nothing is written back
to Apollo until you confirm a list naming every affected contact.

It runs as a private claude.ai Artifact. Every call goes through the viewer's own claude.ai connectors
(the Artifact `mcp` capability), so the tool holds no credentials at all. Run state and your choices
are kept in the Artifact's database under the viewer's private path.

- `src/rules.js`: the rules engine. Pure functions: adapters (raw connector payload to normalized
  shape), the 18 rules, statuses, totals, touchpoints, action planning, CSV.
- `src/collect.js`: connector calls, Apollo rate budgets, the per-person and per-company checks.
- `src/app.js`: run orchestration (checkpointed, resumable), the screens.
- `src/config.js`: default settings (outcome and stage ids, keyword lists, free domains). All editable in Settings.
- `src/demo.js`: made-up example data, shown only when no connector is reachable.
- `test/rules.test.js`: one test per rule and per source, including every trap from the brief. Made-up data only.

```bash
cd sequence-hygiene && npm test
```

```bash
cd sequence-hygiene && npm run build
```

`npm run build` writes `dist/sequence-hygiene.html`. That file is what gets published. When you republish,
keep the full capabilities set: `mcp` (the six connectors), `db`, `user` and `downloads`.

No prospect data belongs in this folder.
