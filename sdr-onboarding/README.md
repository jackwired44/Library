# SDR Outbound Cheat Library

Internal-only onboarding/reference material for outbound SDRs — what Wired CIO
sells, what to ask on a call, and what language to listen for, organized by
service line. **Not part of the Lead Scanner app** (`app/`/`legacy/`) — this is
sales enablement content that happens to live in the same private repo.

## Contents (`pdfs/`)

| # | File | Covers |
|---|------|--------|
| 00 | `00-wired-cio-sdr-cheat-library.pdf` | **The binder** — all sections below, combined, with a table of contents. This is the one to hand a new SDR. |
| 01 | `01-who-is-wired-cio.pdf` | Company primer — tagline, positioning, founder story, values, pricing model, engagement structure |
| 02 | `02-outbound-execution.pdf` | Call flow, the qualification framework (mirrors the Lead Scanner's own Strong Signal / Needs Review / Bad Lead tiers), objection framework, handoff |
| 03 | `03-dynamics-overview.pdf` | Dynamics 365 platform overview (ERP + CRM family, module priority) |
| 04 | `04-business-central-erp.pdf` | Business Central / ERP (highest-priority Dynamics module) |
| 05 | `05-sales-crm.pdf` | Dynamics 365 Sales / CRM |
| 06 | `06-project-operations.pdf` | Dynamics 365 Project Operations |
| 07 | `07-msp.pdf` | Managed IT Services (MSP) |
| 08 | `08-co-managed-fully-managed.pdf` | Co-Managed vs. Fully Managed IT |
| 09 | `09-custom-app-dev.pdf` | Custom Application Development |
| 10 | `10-azure-billing.pdf` | Azure Partner / CSP Billing |
| 11 | `11-licensing-csp.pdf` | Microsoft Licensing Support / CSP |
| 12 | `12-document-intelligence.pdf` | Azure Document Intelligence (ties into Custom App Dev) |

Each service-line sheet follows the same shape: Overview → Wired CIO's Angle →
Discovery Questions → Buying Signals → Red Flags (Auto-Disqualify language) →
Objection Handling → Cross-Sell. The buying-signal/red-flag language is
deliberately drawn from the same detection rules the Lead Scanner itself uses
(see the root `CLAUDE.md`), so the human playbook and the scanning tool stay
consistent with each other.

## Regenerating

```
cd sdr-onboarding
python3 generate_cheat_library.py
```

Requires `reportlab` (`pip install reportlab`). Content lives in the
`SECTIONS` list in `generate_cheat_library.py` — edit there, not the PDFs
directly.

## Status — v1, grounded but not exhaustive

Company-identity content (tagline, mission, founder story, values, pricing
model, engagement structure) was pulled from real, verified `wiredcio.com`
copy via web search (direct crawling of the domain is blocked by this
session's network egress policy, so pages were sourced via search-engine
snippets that quote the live site, not invented). Service-line content
(Dynamics/MSP/ERP/CRM/etc.) is grounded in the Lead Scanner's own detection
rules (`CLAUDE.md`) plus standard MSP/Dynamics sales practice.

Per Jack: this is a first pass meant to be perfected over the next several
days, not a final version. Natural next steps:
- A deeper site crawl/content pull once egress access allows it, or pasted
  source content from Jack directly.
- Dedicated sheets for the other named Wired CIO services not yet covered
  here (Cybersecurity, Cloud Services, IT Consulting & Advisory, Backup &
  Disaster Recovery, Compliance Services, Technical Training & Support) —
  scoped out of v1 since the original ask focused on the categories that
  match the Lead Scanner's own detection engine.
- Real call examples / call recordings distilled into the objection-handling
  tables once there's a track record to draw from.
