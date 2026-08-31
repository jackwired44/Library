#!/usr/bin/env python3
"""
Wired CIO — SDR Outbound Cheat Library generator.

Internal-only sales playbook/reference material. Generates one PDF per
service line (for quick reference / study) plus one combined binder PDF
(all service lines back to back) into sdr-onboarding/pdfs/.

Run: python3 generate_cheat_library.py
"""
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "pdfs")
os.makedirs(OUT_DIR, exist_ok=True)

INK = colors.HexColor("#1B2A3C")
ACCENT = colors.HexColor("#0A66C2")
GOOD = colors.HexColor("#1E7B4D")
BAD = colors.HexColor("#B5443B")
MUTED = colors.HexColor("#5B6B7C")
SURFACE = colors.HexColor("#EEF0F2")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle("Kicker", parent=styles["Normal"], textColor=ACCENT,
                           fontName="Helvetica-Bold", fontSize=9, spaceAfter=2,
                           tracking=1))
styles.add(ParagraphStyle("DocTitle", parent=styles["Title"], textColor=INK,
                           fontSize=22, leading=26, spaceAfter=4))
styles.add(ParagraphStyle("Subtitle", parent=styles["Normal"], textColor=MUTED,
                           fontSize=11, leading=15, spaceAfter=14))
styles.add(ParagraphStyle("H2", parent=styles["Heading2"], textColor=INK,
                           fontSize=13, spaceBefore=14, spaceAfter=6,
                           borderColor=ACCENT, borderWidth=0))
styles.add(ParagraphStyle("Body", parent=styles["Normal"], fontSize=10,
                           leading=14, spaceAfter=6))
styles.add(ParagraphStyle("PlainBullet", parent=styles["Normal"], fontSize=10,
                           leading=14, leftIndent=14, bulletIndent=2,
                           spaceAfter=4))
styles.add(ParagraphStyle("QBullet", parent=styles["Normal"], fontSize=10.5,
                           leading=14, leftIndent=16, bulletIndent=2,
                           spaceAfter=6, textColor=INK))
styles.add(ParagraphStyle("SignalGood", parent=styles["Normal"], fontSize=9.5,
                           leading=13, leftIndent=14, textColor=GOOD,
                           spaceAfter=3))
styles.add(ParagraphStyle("SignalBad", parent=styles["Normal"], fontSize=9.5,
                           leading=13, leftIndent=14, textColor=BAD,
                           spaceAfter=3))
styles.add(ParagraphStyle("Fact", parent=styles["Normal"], fontSize=10,
                           leading=14, leftIndent=14, textColor=INK,
                           spaceAfter=4))
styles.add(ParagraphStyle("Cross", parent=styles["Normal"], fontSize=9.5,
                           leading=13, textColor=MUTED))


def header_footer(canvas, doc):
    canvas.saveState()
    w, h = letter
    canvas.setFillColor(INK)
    canvas.rect(0, h - 0.55 * inch, w, 0.55 * inch, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(0.65 * inch, h - 0.37 * inch, "WIRED CIO")
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#B9C4D0"))
    canvas.drawRightString(w - 0.65 * inch, h - 0.37 * inch,
                            "SDR Outbound Playbook — Internal Use Only")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(0.65 * inch, 0.4 * inch,
                       "Wired CIO — Confidential / Internal Sales Reference")
    canvas.drawRightString(w - 0.65 * inch, 0.4 * inch, f"Page {doc.page}")
    canvas.restoreState()


def build_doc(path):
    doc = BaseDocTemplate(
        path, pagesize=letter,
        leftMargin=0.65 * inch, rightMargin=0.65 * inch,
        topMargin=0.85 * inch, bottomMargin=0.65 * inch,
        title="Wired CIO SDR Outbound Playbook",
        author="Wired CIO",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height,
                   id="normal")
    doc.addPageTemplates([PageTemplate(id="main", frames=frame,
                                        onPage=header_footer)])
    return doc


def bullets(items, style="PlainBullet", bullet="•"):
    return [Paragraph(f"{bullet}&nbsp;&nbsp;{item}", styles[style]) for item in items]


def questions(items):
    out = []
    for i, q in enumerate(items, 1):
        out.append(Paragraph(f"<b>{i}.</b>&nbsp;&nbsp;{q}", styles["QBullet"]))
    return out


def objection_table(rows):
    data = [["If they say...", "Ask / respond with..."]] + rows
    t = Table(data, colWidths=[2.5 * inch, 4.15 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SURFACE]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D5DBE1")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def section_story(section, kicker, num, total):
    """Build the flowables for one service-line section (used standalone
    and inside the combined binder)."""
    s = []
    s.append(Paragraph(f"{kicker} &nbsp;·&nbsp; {num} of {total}", styles["Kicker"]))
    s.append(Paragraph(section["title"], styles["DocTitle"]))
    s.append(Paragraph(section["subtitle"], styles["Subtitle"]))

    s.append(Paragraph("Overview", styles["H2"]))
    for p in section["overview"]:
        s.append(Paragraph(p, styles["Body"]))

    if section.get("wired_angle"):
        s.append(Paragraph(section.get("wired_angle_heading", "Wired CIO's Angle"), styles["H2"]))
        for p in section["wired_angle"]:
            s.append(Paragraph(p, styles["Body"]))

    if section.get("facts"):
        s.append(Paragraph(section.get("facts_heading", "Key Facts — Know This Cold"), styles["H2"]))
        s += bullets(section["facts"], style="Fact", bullet="•")

    if section.get("questions"):
        s.append(Paragraph(
            section.get("questions_heading", "Discovery Questions — Ask On the Call"),
            styles["H2"]))
        s += questions(section["questions"])

    if section.get("signals_good"):
        s.append(Paragraph(
            section.get("signals_good_heading", "Buying Signals — Listen For This Language"),
            styles["H2"]))
        s += bullets(section["signals_good"], style="SignalGood", bullet="+")

    if section.get("signals_bad"):
        s.append(Paragraph(
            section.get("signals_bad_heading", "Red Flags — Not a Fit / Disqualify"),
            styles["H2"]))
        s += bullets(section["signals_bad"], style="SignalBad", bullet="x")

    if section.get("objections"):
        s.append(Paragraph(section.get("objections_heading", "Objection Handling"), styles["H2"]))
        s.append(objection_table(section["objections"]))
        s.append(Spacer(1, 6))

    if section.get("cross_sell"):
        s.append(Paragraph(
            section.get("cross_sell_heading", "Cross-Sell / Related Offerings"), styles["H2"]))
        s.append(Paragraph(section["cross_sell"], styles["Cross"]))

    return s


# ---------------------------------------------------------------------------
# Content
# ---------------------------------------------------------------------------

SECTIONS = [
    dict(
        key="who-is-wired-cio",
        kicker="COMPANY PRIMER",
        title="Who Is Wired CIO",
        subtitle='"When your technology works, so do your people." — what every SDR needs '
                  "to know cold before the first dial.",
        overview=[
            "Wired CIO builds the IT department of the future: one Microsoft-aligned partner "
            "to grow, protect, automate, and align a business. We're an IT partner for "
            "growing businesses — fully managed or co-managed, built on the Microsoft cloud, "
            "and accountable for the whole stack, not just the help desk.",
            "Founded by Russell, a technology leader with 15 years of IT experience and deep "
            "Microsoft expertise. The company exists because of a gap he saw firsthand: large "
            "enterprises run IT with reporting trees of eighty-plus specialists — help desk, "
            "system administrators, security engineers, and more — but growing companies need "
            "most of those same capabilities and can't field that full roster themselves. "
            "That's the gap Wired CIO fills.",
            "Headquartered in Chicago, also serving the Cincinnati market. Core values: "
            "transparency, continuous improvement, and a solution-first mindset — proactive "
            "strategy, not reactionary fixes.",
        ],
        wired_angle_heading="Why This Is a Different Pitch Than \"We Do IT Support\"",
        wired_angle=[
            "Most traditional IT contracts cover day-to-day tickets and nothing else — "
            "strategy, applications, security, and compliance sit outside the scope, handled "
            "ad hoc or not at all. Wired CIO's scope is strategy, operations, security, "
            "applications, and compliance from one accountable team.",
            "A dedicated vCIO owns the technology roadmap so a client's IT evolves with the "
            "business instead of reacting to it after something breaks — this is a strategic "
            "relationship, not a vendor relationship.",
            "Wired CIO is the single point of contact for every technology vendor — ISPs, "
            "SaaS providers, hardware vendors — and owns their tickets directly, so the "
            "client's own team stops chasing support lines.",
        ],
        facts_heading="Key Facts — Know This Cold",
        facts=[
            "Tagline: <i>\"When your technology works, so do your people.\"</i>",
            "Full service line-up: Managed IT Services, Cybersecurity, Cloud Services, IT "
            "Consulting &amp; Advisory, Backup &amp; Disaster Recovery, Compliance Services, "
            "Vendor Management, and Technical Training &amp; Support — plus, covered "
            "elsewhere in this playbook, Dynamics 365 (ERP/CRM) and Custom Application "
            "Development.",
            "ICP: growing small-to-midsize businesses that need enterprise-grade IT "
            "capability without hiring an enterprise-sized internal team. Named industries "
            "include Small Business, Manufacturing, and Healthcare (HIPAA/compliance-driven).",
            "Pricing model: a flat monthly rate per person, which covers their primary "
            "device — shared and additional devices are a small add-on. Simple and "
            "predictable; never quote a specific number cold, that comes after Discovery.",
            "Engagement structure: a rolling 90-day commitment, not a multi-year lock-in — "
            "\"we earn your business every quarter.\" A strong, disarming answer to the "
            "\"long contract\" objection.",
            "Sales motion: Discovery (ballpark scope and budget shared early, no signature "
            "expected) → Design → fixed-scope pricing, presented two ways side by side — a "
            "straight hourly project, or the same scope amortized monthly with support "
            "included.",
        ],
        questions_heading="Be Ready to Answer These (Prospects Will Ask)",
        questions=[
            "\"How is this different from just hiring an IT person?\" — Point to the "
            "comprehensive scope: strategy, security, applications, and compliance from one "
            "accountable team, not just a warm body closing tickets.",
            "\"What's the contract length?\" — A rolling 90-day commitment, not a multi-year "
            "lock-in.",
            "\"How much does this cost?\" — Flat monthly rate per person, covering their "
            "primary device. Give a real ballpark only after Discovery, never a number cold.",
            "\"Are you a Microsoft shop, or can you work with anything?\" — Microsoft-aligned "
            "by design: M365, Azure, and Dynamics 365 are the whole-stack story.",
            "\"We already have IT — why would we need you?\" — Find out if there's real "
            "co-managed potential (see that sheet) before assuming this has to be a full "
            "replacement conversation.",
        ],
        objections_heading="Objection Handling",
        objections=[
            ["\"That sounds expensive.\"",
             "Reframe around the flat per-person rate and the 90-day commitment — no "
             "long-term risk, and pricing gets concrete (two structures, side by side) only "
             "after a real Discovery conversation."],
            ["\"We like our current IT person/provider.\"",
             "Ask what's NOT covered today — strategy, security, compliance, applications "
             "are the gaps a support-only contract usually leaves open. Co-managed is often "
             "the easier entry point."],
            ["\"We don't have time for a call right now.\"",
             "Acknowledge it, then ask for a specific window instead of \"send me info\" — "
             "log a real follow-up date, don't let it go cold."],
        ],
    ),
    dict(
        key="outbound-execution",
        kicker="EXECUTION",
        title="Outbound Execution Playbook",
        subtitle="How an SDR performs and executes an outbound call — from dial to booked "
                  "Discovery.",
        overview=[
            "An SDR's job on an outbound call is narrow and specific: qualify fit and "
            "interest fast, using the language in this playbook, and book a Discovery call. "
            "You are selling the next step — a 20-30 minute Discovery conversation — not the "
            "IT services themselves. Don't over-pitch on the first call.",
            "Every lead an SDR works has already been triaged by Wired CIO's own detection "
            "engine into a tier (Strong Signal / Needs Review / Bad Lead) and a product-line "
            "category (Dynamics 365 or M365/Azure) before it ever reaches a dial list. Know "
            "which tier and category a lead landed in before you call — it tells you which "
            "service-line sheet in this library to have open.",
        ],
        wired_angle_heading="Call Flow",
        wired_angle=[
            "<b>1. Open on their situation, not our services.</b> Mirror the trigger that "
            "got them on the list (a stated pain point, a piece of language from their form "
            "fill or CSV notes) — don't lead with a features pitch.",
            "<b>2. Confirm the trigger.</b> What changed, or what are they actively dealing "
            "with right now? This is where you find out if the signal that qualified them is "
            "still real.",
            "<b>3. Run the category-specific discovery questions</b> from the matching "
            "service-line sheet (Dynamics 365, MSP, Custom App Dev, Licensing, etc.).",
            "<b>4. Qualify against the tier framework below</b> before you ask for the "
            "meeting — don't book a Discovery call on a lead that's really a Bad Lead in "
            "disguise.",
            "<b>5. Book Discovery and set expectations.</b> Wired CIO comes back with a "
            "ballpark scope, not a hard sell — no signature expected at that stage. That's an "
            "easy, low-pressure ask.",
        ],
        signals_good_heading="Qualify Like the Scanner Does",
        signals_good=[
            "Strong Signal: a real trigger (a stated pain point, timeline, or event) PLUS a "
            "real number, timeline, or named decision-maker. Book Discovery now.",
            "Needs Review: real interest, but missing a number, timeline, or clear owner. "
            "Ask one more qualifying question before booking, or log a specific, dated "
            "follow-up rather than letting it drift.",
            "A confirmed seat/user count of 15+ is the internal strong-signal bar for "
            "licensing and Dynamics conversations — smaller confirmed counts still get "
            "worked, just at lower priority.",
        ],
        signals_bad_heading="Auto-Disqualify Language — Master List",
        signals_bad=[
            "Single-seat / freelancer language — not a real seat-count opportunity.",
            "A flat rejection: \"not interested,\" \"unsubscribe.\"",
            "\"We're happy with our current provider\" / locked into an existing contract.",
            "Personal, non-business use.",
            "A one-off basic support issue (password reset, locked out) — a ticket, not a "
            "relationship opportunity.",
            "They want Microsoft's own direct support, not a partner/reseller.",
            "Internal CRM/Opportunity notes describing a deal someone else already owns — "
            "third-person pipeline language, not a fresh lead's own interest.",
            "Small one-off project or free-advice language: \"pick your brain,\" \"free "
            "consultation,\" \"no budget,\" \"not looking to hire/engage/pay.\"",
        ],
        objections_heading="Objection Framework (Generic — See Each Sheet for Specifics)",
        objections=[
            ["\"How much does this cost?\"",
             "Never quote a number cold. Explain the model (flat monthly rate per person, "
             "90-day rolling commitment) and set up Discovery for a real ballpark."],
            ["\"We already have someone.\"",
             "Find out if it's a full replacement \"no,\" or a co-managed gap — don't "
             "assume. See the Co-Managed vs. Fully Managed sheet."],
            ["\"Just send me some info.\"",
             "Treat as a soft no. Get one more qualifying answer before agreeing, and lock a "
             "specific follow-up date rather than an open-ended \"I'll email you.\""],
            ["\"Not the right time.\"",
             "Ask what would need to change, and when their next budget/planning cycle "
             "starts. Log a real, dated follow-up — don't just drop it."],
        ],
        cross_sell_heading="Handoff — What a Booked Discovery Call Needs",
        cross_sell="Company name, contact, the product-line category (Dynamics 365 / "
                   "M365-Azure / MSP / Custom App Dev / etc.), the tier you qualified them "
                   "at, and the specific trigger language they used on the call. That's what "
                   "becomes the account team's opening line in Discovery — don't let it get "
                   "lost in a generic handoff note.",
    ),
    dict(
        key="dynamics-overview",
        kicker="DYNAMICS 365",
        title="Dynamics 365 — Platform Overview",
        subtitle="How to talk about Microsoft's ERP + CRM suite, and how Wired CIO fits in.",
        overview=[
            "Dynamics 365 is Microsoft's combined ERP and CRM product family. It covers "
            "everything from finance and supply chain (Business Central, Finance and "
            "Operations, Supply Chain Management — the modern successors to AX, NAV, and GP) "
            "to sales, service, and marketing (Dynamics 365 Sales, Customer Engagement, "
            "Customer Insights, Field Service) to project-based business management "
            "(Project Operations).",
            "Most prospects won't say \"Dynamics 365\" by name — they'll describe the pain "
            "(an aging ERP, a spreadsheet-based sales process, a system that doesn't talk to "
            "their other tools) or name the specific product/module (\"Business Central,\" "
            "\"CRM,\" \"NAV,\" \"GP\"). Learn to recognize both.",
        ],
        wired_angle=[
            "Wired CIO isn't a pure Dynamics reseller — we're the partner for the whole "
            "Microsoft stack. A Dynamics deal almost always comes bundled with a tenant, "
            "licensing, and ongoing support conversation, which is our real differentiator "
            "against a Dynamics-only VAR: one partner, one relationship, for the ERP/CRM AND "
            "everything it runs on.",
            "Internally we work Dynamics leads in priority order: Business Central/ERP first, "
            "then Sales/CRM, then everything else in the family (Project Operations, HR, "
            "Marketing, Field Service, Customer Insights). ERP conversations tend to be the "
            "biggest, stickiest engagements — lead with those when a prospect could go either way.",
        ],
        questions=[
            "Are you currently on Dynamics 365, an older Dynamics product (CRM, AX, NAV, GP), "
            "or a different ERP/CRM platform entirely (Salesforce, NetSuite, SAP, QuickBooks)?",
            "Roughly how many users/seats would be on the system?",
            "Is this a brand-new implementation, a migration off an on-prem system, or an "
            "upgrade of an existing Dynamics deployment?",
            "What's driving the timing — a budget cycle, a specific pain point, an "
            "end-of-life deadline, a leadership mandate?",
            "Who else is involved in this decision — IT, Finance, Operations, a specific "
            "department head?",
            "Do you already have a tenant/M365 environment set up, or would this be part of a "
            "broader Microsoft rollout?",
        ],
        signals_good=[
            "A named module (Business Central, D365 Sales, CRM, Project Operations, etc.) "
            "mentioned alongside a real or estimated user/seat count.",
            "ERP and CRM mentioned together in the same conversation — usually a bigger, "
            "more strategic project.",
            "Trigger language: \"upgrade,\" \"budget,\" \"this year,\" a specific timeline.",
            "Any bare number sitting next to a Dynamics product mention (often a seat count "
            "described informally, e.g. \"Business Central — 25 users\").",
        ],
        signals_bad=[
            "Single-user or freelancer language — not a real seat-count opportunity.",
            "Flat rejection: \"not interested,\" \"unsubscribe.\"",
            "\"We're happy with our current provider\" / locked into an existing contract.",
            "Personal, non-business use.",
            "A one-off support issue (password reset, locked out) — not a system project.",
            "They want Microsoft's own direct support, not a partner/reseller.",
            "Internal CRM/Opportunity notes describing a deal someone else already owns "
            "(\"owner of this opportunity,\" \"Partner: [name],\" \"advancing the sales "
            "cycle\") — this is pipeline management language, not a fresh lead's own interest.",
            "Small one-off project or free-advice language: \"pick your brain,\" \"free "
            "consultation,\" \"no budget,\" \"not looking to hire/engage/pay.\"",
        ],
        objections=[
            ["\"We already have a system.\"",
             "Ask what's not working, or whether it's approaching end-of-life / out of "
             "support. Most Dynamics conversations start as a replacement, not a first buy."],
            ["\"That sounds expensive.\"",
             "Ask what they're spending today across licensing, maintenance, and any "
             "consultants — the comparison is rarely apples-to-apples."],
            ["\"Not a priority right now.\"",
             "Ask what would need to be true for it to become one, and when their next "
             "budget cycle starts. Log a follow-up, don't just drop it."],
        ],
        cross_sell="Every Dynamics deployment needs a tenant, licensing, and ongoing support — "
                   "always ask about their M365/Azure and licensing situation even on a pure "
                   "Dynamics call.",
    ),
    dict(
        key="business-central-erp",
        kicker="DYNAMICS 365",
        title="Business Central / ERP",
        subtitle="Cloud ERP for finance, supply chain, and operations — our highest-priority Dynamics module.",
        overview=[
            "Business Central (and its predecessors NAV, GP, and AX, plus Finance and "
            "Operations and Supply Chain Management for larger orgs) is Microsoft's cloud ERP "
            "line — general ledger, AP/AR, inventory, supply chain, manufacturing, and "
            "project accounting in one system.",
            "This is the single highest-priority Dynamics conversation for us. ERP "
            "replacements are large, multi-year, deeply embedded engagements — once a company "
            "is live on Business Central, it becomes the system of record for the whole "
            "business, not just one department.",
        ],
        questions=[
            "What are you running finance and operations on today — NAV, GP, AX, QuickBooks, "
            "another ERP, or spreadsheets?",
            "Roughly how many users would need licenses?",
            "Is this just finance, or does it also cover supply chain, inventory, and "
            "manufacturing?",
            "What's forcing the change — end-of-life support, you've outgrown the current "
            "system, an acquisition, a compliance requirement?",
            "What's the target go-live window?",
            "Do you have an internal champion (CFO, Controller, Ops lead) driving this?",
        ],
        signals_good=[
            "\"Business Central,\" \"ERP,\" \"NAV,\" \"GP,\" \"AX,\" \"Finance and "
            "Operations,\" or \"Supply Chain Management\" mentioned by name.",
            "A stated or estimated user count alongside any of the above.",
            "End-of-life / no-longer-supported language about a current system.",
            "Multi-department scope (finance + supply chain + operations together).",
        ],
        objections=[
            ["\"We already have an ERP.\"",
             "Ask what's not working, or if it's end-of-life / no longer supported by the "
             "vendor. That's usually the real trigger."],
            ["\"Too expensive to replace.\"",
             "Ask about the current total cost — licensing, maintenance, consultants, "
             "workarounds — most legacy ERPs cost more than people realize."],
            ["\"Not now.\"",
             "Ask about their budget cycle and log a follow-up for that window — ERP "
             "decisions are planned well in advance, so timing matters more than urgency."],
        ],
        cross_sell="Business Central customers almost always need Azure hosting/tenant support "
                   "and M365 licensing alongside the ERP itself — always ask.",
    ),
    dict(
        key="sales-crm",
        kicker="DYNAMICS 365",
        title="Dynamics 365 Sales / CRM",
        subtitle="Sales, Customer Engagement, Customer Insights, Field Service, Marketing.",
        overview=[
            "Covers Dynamics 365 Sales, Customer Engagement, Customer Insights, Field "
            "Service, Marketing, and Contact Center — the CRM side of the Dynamics family, as "
            "opposed to the ERP side (Business Central).",
            "Note: Business Central/ERP language always takes priority internally — if a lead "
            "mentions both ERP and CRM/Sales language, it's worked as an ERP opportunity, not "
            "a CRM one. Don't double-pitch a lead that's really an ERP conversation.",
        ],
        questions=[
            "What are you using for CRM today — Salesforce, HubSpot, spreadsheets, nothing "
            "formal?",
            "How many sales and/or service users would need licenses?",
            "Which functions are in scope — Sales, Customer Service, Marketing, Field "
            "Service?",
            "Does this need to integrate with an ERP or financial system (especially "
            "Business Central)?",
            "What does the current sales/service process look like, and where does it break "
            "down?",
            "Is there a data migration involved — how much historical data, from what "
            "system?",
        ],
        signals_good=[
            "\"Sales,\" \"CRM,\" \"Customer Engagement,\" \"Field Service,\" \"Marketing,\" "
            "or \"Insights\" mentioned by name, with a real or estimated user count.",
            "Trigger language: \"upgrade,\" \"budget,\" \"this year.\"",
            "Explicit dissatisfaction with a current CRM or a manual/spreadsheet process.",
        ],
        signals_bad=[
            "If Business Central/ERP language also appears in the same lead, treat it as an "
            "ERP opportunity — don't pitch CRM in parallel.",
        ],
        cross_sell="Power BI/reporting on top of CRM data, and Azure for any custom "
                   "integrations, are natural next conversations.",
    ),
    dict(
        key="project-operations",
        kicker="DYNAMICS 365",
        title="Dynamics 365 Project Operations",
        subtitle="Project-based business management — resourcing, time/expense, project accounting.",
        overview=[
            "Project Operations is built for project-based businesses — professional "
            "services, engineering, construction, consulting firms — that need to manage "
            "resourcing, time and expense tracking, and project accounting in one system, "
            "tied to sales and (ideally) financials.",
            "It's technically one of the Dynamics 365 Sales/CRM-family modules internally, "
            "but it's a distinct enough conversation to prep for separately: the buyer is "
            "usually a services-firm operations or finance lead, not a traditional sales "
            "director.",
        ],
        questions=[
            "How do you currently track project time, budgets, and resourcing — spreadsheets, "
            "a dedicated PSA (professional services automation) tool, something else?",
            "Roughly how many billable/project resources are involved?",
            "Do you need project accounting tied directly to your financials/ERP?",
            "What's the biggest pain point — utilization visibility, resource scheduling, "
            "billing accuracy, forecasting?",
            "Are you already on (or planning) Business Central or another Dynamics ERP?",
        ],
        signals_good=[
            "\"Project Operations,\" \"PSA,\" \"resource scheduling,\" or \"project "
            "accounting\" mentioned, even in otherwise generic phrasing.",
            "Any project-based services company (consulting, engineering, construction, "
            "agencies) describing manual/spreadsheet-based project tracking.",
        ],
        cross_sell="Pairs naturally with Business Central for a full project-to-cash "
                   "workflow — always ask about ERP plans in the same conversation.",
    ),
    dict(
        key="msp",
        kicker="MANAGED IT",
        title="Managed IT Services (MSP)",
        subtitle="Our core recurring offering — the umbrella every other service line nests under.",
        overview=[
            "Fully outsourced IT: help desk, endpoint and network management, patching, "
            "monitoring, and vendor management. This is Wired CIO's core, recurring-revenue "
            "offering, and it's the umbrella almost every other conversation (security, "
            "backup/DR, compliance, licensing, cloud) can nest under.",
        ],
        questions=[
            "Do you have internal IT today, or is it fully outsourced already?",
            "Roughly how many employees/devices would need support?",
            "If you have a current provider, what's not working — response time, "
            "expertise, cost, communication?",
            "Are you looking for full outsourcing, or to supplement an internal team "
            "(co-managed — see that sheet)?",
            "What's driving the change right now — a bad experience, a security concern, "
            "growth, a cost review?",
            "Do you have any compliance requirements (HIPAA, CMMC, PCI, cyber insurance "
            "requirements) driving this?",
        ],
        signals_good=[
            "\"IT support,\" \"help desk,\" managed services / MSP language.",
            "Growth or overload language: \"stretched thin,\" \"overwhelmed,\" "
            "\"understaffed.\"",
            "Explicit dissatisfaction with a current provider.",
        ],
        signals_bad=[
            "A single, basic support issue (password reset, locked out) — that's a one-off "
            "ticket, not an MSP relationship opportunity.",
            "They want Microsoft's own direct support rather than a reseller/MSP partner.",
        ],
        objections=[
            ["\"We already have an IT provider.\"",
             "Ask what's working and what isn't — response time, proactive vs. reactive, "
             "security posture. Most MSP switches come from a specific frustration."],
            ["\"We handle it in-house.\"",
             "Ask about co-managed instead of a full replacement — augmenting, not "
             "replacing, internal IT."],
        ],
        cross_sell="Cybersecurity, Backup/DR, Compliance, and licensing all sell naturally "
                   "once an MSP relationship is on the table — MSP is the umbrella.",
    ),
    dict(
        key="co-managed-fully-managed",
        kicker="MANAGED IT",
        title="Co-Managed vs. Fully Managed IT",
        subtitle="Two shapes of the MSP relationship — know which one to lead with.",
        overview=[
            "Fully Managed: Wired CIO is the entire IT department — no internal IT staff, "
            "or the client wants out of IT entirely.",
            "Co-Managed: there's an internal IT person or team already, and Wired CIO "
            "supplements them — extra hands, specialized expertise (security, cloud), "
            "after-hours coverage, or a second set of eyes on things the internal team "
            "doesn't have bandwidth or skill for.",
        ],
        wired_angle=[
            "Co-managed is often the easier first \"yes\" when a prospect already has an "
            "internal IT hire — it reduces the perceived threat of \"you're replacing my "
            "job\" and opens the door without a full displacement conversation.",
        ],
        questions=[
            "Is there an internal IT person or team today?",
            "What do they handle well, and what falls through the cracks?",
            "Are you looking to replace internal IT entirely, or augment what you already "
            "have?",
            "Where's the gap — security expertise, cloud/Azure expertise, after-hours "
            "coverage, project capacity?",
            "How does the internal IT person feel about bringing in outside help — is this "
            "their idea or leadership's?",
        ],
        signals_good=[
            "An internal IT hire mentioned alongside a specific gap (security, cloud, "
            "after-hours, project work).",
            "\"Co-managed,\" \"supplement,\" \"extra support,\" or similar augmentation "
            "language.",
        ],
        cross_sell="Security, backup/DR, and cloud are the most common co-managed add-on "
                   "scopes — lead with whichever gap the internal team named.",
    ),
    dict(
        key="custom-app-dev",
        kicker="CUSTOM DEVELOPMENT",
        title="Custom Application Development",
        subtitle="Power Platform, custom Azure-hosted apps, and Dynamics/M365 integrations.",
        overview=[
            "Wired CIO builds custom solutions on the Microsoft platform — Power Apps and "
            "Power Automate, fully custom Azure-hosted applications, and integrations with "
            "Dynamics 365 and M365. This is a project-based (not purely recurring) "
            "conversation, usually triggered by a specific manual process or gap that no "
            "off-the-shelf product solves.",
        ],
        questions=[
            "What manual or paper-based process are you trying to replace or automate?",
            "Does this need to integrate with an existing system — Dynamics, M365, a legacy "
            "database?",
            "Is this internal tooling, or a customer-facing application?",
            "Do you have a rough scope or budget expectation in mind?",
            "What's driving the timeline — is there urgency, or is this exploratory?",
            "Who owns this internally — IT, an operations lead, a specific department?",
        ],
        signals_good=[
            "\"Custom app,\" \"app build,\" \"custom development,\" \"Power Apps,\" or "
            "\"Power Automate\" mentioned specifically.",
            "A document-heavy manual process combined with wanting automation — see the "
            "Azure Document Intelligence sheet, this is usually the same conversation.",
        ],
        signals_bad=[
            "Small one-off project or free-advice language: \"just want some advice,\" "
            "\"quick question,\" \"pick your brain,\" \"no budget.\" We build engagements, "
            "not favors.",
        ],
        cross_sell="Azure hosting, Document Intelligence for anything document-heavy, and "
                   "Dynamics/Power Platform integration are the natural next questions.",
    ),
    dict(
        key="azure-billing",
        kicker="AZURE / CLOUD",
        title="Azure Partner / CSP Billing",
        subtitle="Consolidated Azure billing, cost management, and support routed through us.",
        overview=[
            "Wired CIO can act as the CSP (Cloud Solution Provider) partner of record for a "
            "prospect's Azure environment — consolidating billing, providing cost "
            "management, and giving them a real support relationship instead of being on "
            "their own with Microsoft direct.",
        ],
        wired_angle=[
            "This is often the easiest, lowest-friction \"yes\" in the whole playbook — same "
            "infrastructure, same environment, just better billing and a real partner to "
            "call. It's a great foot-in-the-door for a fuller MSP or Dynamics conversation "
            "later.",
        ],
        questions=[
            "Are you on Azure today — direct with Microsoft, or already through a partner?",
            "Roughly what's your monthly or annual Azure spend?",
            "Any pain with current billing or support — surprise costs, no one to call, "
            "confusing invoices?",
            "Are you planning any migration or expansion that would change your spend "
            "(on-prem to cloud, new workloads)?",
        ],
        signals_good=[
            "Azure billing/cost language, or explicitly looking for a partner/CSP to route "
            "billing through.",
            "On-prem-to-cloud migration or lift-and-shift language paired with Azure.",
        ],
        objections=[
            ["\"We're direct with Microsoft, why switch?\"",
             "Ask about their support experience today — direct billing usually means no "
             "dedicated support contact, just a portal."],
        ],
        cross_sell="A strong opener for a broader MSP, security, or Dynamics conversation "
                   "once trust is established on billing.",
    ),
    dict(
        key="licensing-csp",
        kicker="LICENSING",
        title="Microsoft Licensing Support / CSP",
        subtitle="M365, security, and specialty SKUs — the easiest entry point into every other conversation.",
        overview=[
            "Wired CIO sells and supports Microsoft licensing as a CSP: M365 Business Basic/"
            "Standard/Premium, O365/M365 E1/E3/E5, F1/F3, EMS, Power BI Pro/Premium, M365 "
            "Copilot, Defender variants, Entra ID P1/P2, Teams Phone, and Intune, among "
            "others.",
        ],
        questions=[
            "What licenses are you on today, and who manages that — Microsoft direct, "
            "another partner, internal IT?",
            "Roughly how many seats/users?",
            "Any known gaps — no MFA/security licensing, no Copilot, no advanced backup?",
            "When does your current agreement renew?",
            "Who owns procurement and budget for this?",
        ],
        signals_good=[
            "A confirmed seat count of 15 or more is our internal strong-signal threshold — "
            "smaller confirmed counts still get worked, just at lower priority.",
            "Any of the named SKUs above mentioned by name.",
        ],
        signals_bad=[
            "Single-seat/freelancer language.",
            "They want Microsoft's own direct support instead of a partner.",
        ],
        cross_sell="Licensing is the easiest entry point into every other conversation — "
                   "MSP, security, Copilot, Dynamics. Always ask what's NOT currently "
                   "licensed, that's usually the real opening.",
    ),
    dict(
        key="document-intelligence",
        kicker="CUSTOM DEVELOPMENT",
        title="Azure Document Intelligence",
        subtitle="AI-powered document extraction — always pitched as part of a custom app, not standalone.",
        overview=[
            "Azure Document Intelligence is an AI service that extracts structured data from "
            "documents — invoices, forms, contracts, ID documents, claims paperwork. Wired "
            "CIO builds it into custom applications and workflows; we don't sell it as a "
            "standalone product.",
        ],
        wired_angle=[
            "Always frame this as part of a custom app development conversation — the real "
            "question is \"who's going to build the app that uses this,\" not \"do you want "
            "this Azure service.\" Lead with custom app dev, mention Document Intelligence as "
            "the engine underneath.",
        ],
        questions=[
            "What documents are being processed manually today, and by how many people/how "
            "many hours a week?",
            "What system would the extracted data need to flow into — an ERP, a CRM, a "
            "database, a spreadsheet today?",
            "Roughly what volume are we talking about — documents per day or per month?",
            "Is there already an app or workflow in mind, or is this purely the manual-"
            "processing pain point so far?",
        ],
        signals_good=[
            "\"Document Intelligence\" mentioned by name.",
            "Any document-heavy manual process (invoice processing, forms, claims, "
            "contracts) combined with wanting a custom app or automation.",
        ],
        cross_sell="Business Central/ERP (invoice processing is the most common use case), "
                   "custom app dev (the delivery vehicle), and Azure hosting/billing.",
    ),
]


def render(section, out_path, num, total):
    doc = build_doc(out_path)
    story = section_story(section, section["kicker"], num, total)
    doc.build(story)


def render_binder(out_path):
    doc = build_doc(out_path)
    story = []
    story.append(Paragraph("WIRED CIO SDR PLAYBOOK", styles["Kicker"]))
    story.append(Paragraph("Outbound Cheat Library", styles["DocTitle"]))
    story.append(Paragraph(
        "Internal reference guide for outbound SDRs — what we sell, what to ask, and what "
        "to listen for on every call, by service line. Study this before your first "
        "outbound shift, and keep it open during dials.",
        styles["Subtitle"]))
    story.append(Paragraph("Contents", styles["H2"]))
    for i, sec in enumerate(SECTIONS, 1):
        story.append(Paragraph(f"{i}. {sec['title']}", styles["PlainBullet"]))
    story.append(PageBreak())

    total = len(SECTIONS)
    for i, sec in enumerate(SECTIONS, 1):
        story += section_story(sec, sec["kicker"], i, total)
        if i < total:
            story.append(PageBreak())

    doc.build(story)


def main():
    total = len(SECTIONS)
    for i, sec in enumerate(SECTIONS, 1):
        out_path = os.path.join(OUT_DIR, f"{i:02d}-{sec['key']}.pdf")
        render(sec, out_path, i, total)
        print("wrote", out_path)

    binder_path = os.path.join(OUT_DIR, "00-wired-cio-sdr-cheat-library.pdf")
    render_binder(binder_path)
    print("wrote", binder_path)


if __name__ == "__main__":
    main()
