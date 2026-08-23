# Wired CIO Lead Scanner

**Private repo. This is Jack's personal tool — see `CLAUDE.md` for the full
access/ownership note before deploying this anywhere reachable over a
network.** It needs to stay behind a credential gate (the existing
`legacy/web` password-gated build is the current mechanism) and scoped to
Jack alone; it is not a public or multi-user product.

## Repo layout

- **`legacy/`** — the current, live, fully-working app (everything this
  README originally documented — see below). Single-file vanilla JS, real
  Playwright regression suite, three build outputs (standalone HTML, Chrome
  extension, password-gated web version). This is not being thrown away —
  it's the reference implementation and the behavioral spec for the rebuild.
- **`app/`** — a fresh Vite + React + TypeScript rebuild in progress
  (`npm install && npm run dev`). Detection engine, Scanner, Library (with its
  folder/group architecture), History, backup/restore, the Cheat Sheet, and
  the password gate are all built and verified against `legacy/`'s behavior.
  Still outstanding: the adapted Playwright suite and the three build outputs
  (standalone/extension/password-gated web) — see `CLAUDE.md` for the brief
  and rebuild order.
- **`CLAUDE.md`** — read this first if you're picking up development here.
  Full architecture brief, every detection rule, every explicit product
  decision Jack has made along the way, and the access/ownership
  constraints.

The full `legacy/` documentation — Files, the detection model, Library,
History, Groups, backup/restore, the Chrome extension, the password-gated
web version, and every dated build/feature-pass section from the app's
history — lives in [`legacy/README.md`](legacy/README.md).
