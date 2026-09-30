#!/usr/bin/env python3
"""
Generates the Apollo handoff brief PDF for the Lead Scanner build session.

Everything in here was verified against Jack's live Apollo account on
2026-09-30 through the Apollo MCP connector. The point of the document is
that the other session should not have to rediscover any of it — several
of these facts cost real calls to learn, and two of them (the task record
carrying no email, the analytics tool answering in markdown) silently
produce wrong code if guessed.

    pip install reportlab && python3 make-brief.py
"""

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether,
)

OUT = "apollo-sequence-check-brief.pdf"

INK = colors.HexColor("#0b1a1d")
INK2 = colors.HexColor("#4a5f63")
RULE = colors.HexColor("#c9d6d8")
BAND = colors.HexColor("#eef4f4")
BRAND = colors.HexColor("#0c4651")
WARN = colors.HexColor("#ab372c")
OK = colors.HexColor("#17795e")

ss = getSampleStyleSheet()

H1 = ParagraphStyle("H1", parent=ss["Title"], fontName="Helvetica-Bold",
                   fontSize=19, leading=23, textColor=BRAND, alignment=TA_LEFT,
                   spaceAfter=2)
SUB = ParagraphStyle("SUB", parent=ss["Normal"], fontName="Helvetica",
                     fontSize=9.5, leading=13, textColor=INK2, spaceAfter=14)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], fontName="Helvetica-Bold",
                    fontSize=12.5, leading=15, textColor=BRAND,
                    spaceBefore=15, spaceAfter=5)
H3 = ParagraphStyle("H3", parent=ss["Heading3"], fontName="Helvetica-Bold",
                    fontSize=10, leading=13, textColor=INK, spaceBefore=9,
                    spaceAfter=3)
BODY = ParagraphStyle("BODY", parent=ss["Normal"], fontName="Helvetica",
                      fontSize=9.4, leading=13.4, textColor=INK, spaceAfter=6)
BULLET = ParagraphStyle("BULLET", parent=BODY, leftIndent=12, bulletIndent=2,
                        spaceAfter=3)
CODE = ParagraphStyle("CODE", parent=ss["Normal"], fontName="Courier",
                      fontSize=8.2, leading=11, textColor=INK,
                      backColor=BAND, borderPadding=6, spaceBefore=4,
                      spaceAfter=8, leftIndent=2)
NOTE = ParagraphStyle("NOTE", parent=BODY, textColor=WARN,
                      fontName="Helvetica-Bold")


def rule():
    t = Table([[""]], colWidths=[6.9 * inch], rowHeights=[0.6])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), RULE)]))
    return t


def table(rows, widths, header=True, mono_cols=()):
    data = []
    for r in rows:
        data.append([Paragraph(str(c), ParagraphStyle(
            "c", parent=BODY, fontSize=8.4, leading=11, spaceAfter=0,
            fontName="Courier" if i in mono_cols else "Helvetica"))
            for i, c in enumerate(r)])
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), BAND),
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, RULE),
        ]
        for i, c in enumerate(data[0]):
            c.style = ParagraphStyle("h", parent=BODY, fontSize=7.6, leading=10,
                                     fontName="Helvetica-Bold", spaceAfter=0,
                                     textColor=INK2)
    t.setStyle(TableStyle(style))
    return t


def b(text):
    return Paragraph(text, BULLET, bulletText="•")


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(0.85 * inch, LETTER[1] - 0.62 * inch,
                LETTER[0] - 0.85 * inch, LETTER[1] - 0.62 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(INK2)
    canvas.drawString(0.85 * inch, LETTER[1] - 0.55 * inch,
                      "Apollo → Lead Scanner  ·  build brief")
    canvas.drawRightString(LETTER[0] - 0.85 * inch, LETTER[1] - 0.55 * inch,
                           "Verified against live Apollo, 30 Sep 2026")
    canvas.drawCentredString(LETTER[0] / 2, 0.5 * inch, str(canvas.getPageNumber()))
    canvas.restoreState()


story = []

story.append(Paragraph("Are these leads already in a sequence?", H1))
story.append(Paragraph(
    "A build brief for the Lead Scanner session: flag, at upload time, which leads are "
    "already being worked in Apollo. Every API fact below was confirmed by a real call "
    "against Jack&rsquo;s account on 30 September 2026 &mdash; none of it is inferred. "
    "Two of these facts silently produce wrong code if guessed; they are marked.", SUB))
story.append(rule())

# ---------------------------------------------------------------- the ask
story.append(Paragraph("What to build", H2))
story.append(Paragraph(
    "When a CSV of leads is uploaded to the Scanner, show for each row whether that person "
    "is <b>already in one of Jack&rsquo;s or Carly&rsquo;s Apollo sequences</b>, what "
    "happened to them, and where they stand &mdash; so the same lead is not re-worked from "
    "scratch, and so a lead that was scanned but never sequenced is visible as such.", BODY))
story.append(Paragraph("Per lead, the target row reads:", BODY))
story.append(b("<b>Never sequenced</b> &mdash; scanned and uploaded, no cadence ever started"))
story.append(b("<b>In sequence</b> &mdash; which one, active or finished, and which step it reached"))
story.append(b("<b>Standing</b> &mdash; the Apollo contact stage and the last call outcome"))
story.append(b("<b>Notes</b> &mdash; the Scanner&rsquo;s own scan verdict, which already travels into Apollo"))

# ---------------------------------------------------------- the key insight
story.append(Paragraph("Why this is possible at all", H2))
story.append(Paragraph(
    "The Scanner&rsquo;s verdict is already inside Apollo. Contacts uploaded from the Scanner "
    "carry it in Apollo custom fields, so matching a lead back to its scan needs no access to "
    "the Scanner&rsquo;s IndexedDB &mdash; which would be impossible anyway, since each Artifact "
    "has its own origin and cannot read another&rsquo;s storage.", BODY))
story.append(Paragraph(
    'typed_custom_fields: {<br/>'
    '&nbsp;&nbsp;"68abe22a26a866001d3e1a08": "Dynamics 365",<br/>'
    '&nbsp;&nbsp;"68abe2198cb839001d7d67c3": "Pitch D365 Sales Pro (Act Now, High fit)'
    ' &middot; runs O365, Azure &middot; High priority (70)"<br/>}', CODE))

story.append(Paragraph("Custom field ids &rarr; names", H3))
story.append(table([
    ["Field id", "Name", "Type", "Carries"],
    ["68abe22a26a866001d3e1a08", "Lead Solution Area", "string", "Scanner product line: &ldquo;Dynamics 365&rdquo; / &ldquo;M365 / Azure&rdquo;"],
    ["68abe2198cb839001d7d67c3", "Notes", "textarea", "Scan pitch, fit and priority score"],
    ["68c32705c53494000d84f430", "Lead Score", "number", "Numeric score"],
    ["68c988cf882b300021d96942", "Product Line", "textarea", "Freer-text product line"],
], [2.0 * inch, 1.35 * inch, 0.6 * inch, 2.95 * inch], mono_cols=(0,)))

# ------------------------------------------------------------- what works
story.append(Paragraph("The call that answers the question", H2))
story.append(Paragraph(
    "<b>apollo_contacts_search</b> returns the email <i>and</i> the sequence membership in one "
    "record, which is what makes a single pass sufficient.", BODY))
story.append(Paragraph(
    '"email": "justin@legacylabor.com",<br/>'
    '"emailer_campaign_ids": ["6a0b653aba6c9100208889c0", "6a8c57f7bb0f38001460ab11"],<br/>'
    '"last_activity_date": "2026-09-30T17:24:34.000+00:00",<br/>'
    '"contact_stage_id": "6a73bd924f135d0014ac11a0",<br/>'
    '"label_ids": ["6a749ad3f6b704000191faff"],<br/>'
    '"contact_campaign_statuses": [{<br/>'
    '&nbsp;&nbsp;"emailer_campaign_id": "6a0b653aba6c9100208889c0",<br/>'
    '&nbsp;&nbsp;"status": "finished",<br/>'
    '&nbsp;&nbsp;"inactive_reason": "Completed last step",<br/>'
    '&nbsp;&nbsp;"added_at": "2026-09-08T16:40:05.978+00:00",<br/>'
    '&nbsp;&nbsp;"finished_at": "2026-09-21T15:09:48.122+00:00",<br/>'
    '&nbsp;&nbsp;"current_step_position": 6,<br/>'
    '&nbsp;&nbsp;"send_email_from_email_address": "jack.snellgrove@wired-cio.com"<br/>'
    '}]', CODE))
story.append(Paragraph(
    "An empty <font face='Courier'>emailer_campaign_ids</font> is the &ldquo;never sequenced&rdquo; "
    "signal. <font face='Courier'>contact_campaign_statuses</font> gives status, step reached and "
    "which mailbox sent &mdash; everything needed for &ldquo;where it stands&rdquo;.", BODY))

# ------------------------------------------------------------ what doesn't
story.append(Paragraph("Traps &mdash; things that look like they work and do not", H2))

story.append(Paragraph("1. A task record carries no email", H3))
story.append(Paragraph(
    "<b>apollo_tasks_search</b> is the obvious way to list who is in a sequence. Do not use it "
    "for matching. A task&rsquo;s contact is <font face='Courier'>{id, name, linkedin_url}</font> "
    "&mdash; <b>no email and no company</b>. The Scanner keys contacts on email first with a "
    "name+company fallback, so a task roster cannot be matched back to a Scanner lead without a "
    "second lookup per contact. This is why the design goes contact-first.", BODY))

story.append(Paragraph("2. Analytics answers in markdown, not rows", H3))
story.append(Paragraph(
    "<b>apollo_analytics_sync_report</b> returns a rendered markdown table as a string under "
    "<font face='Courier'>summary</font>. There is no structured row array. Parse the table, and "
    "if parsing fails show &ldquo;unavailable&rdquo; rather than zero &mdash; a zero here reads as "
    "&ldquo;no activity&rdquo; and is a lie.", BODY))

story.append(Paragraph("3. Filters that do not exist", H3))
story.append(table([
    ["Wanted", "Reality"],
    ["Filter contacts by sequence", "No campaign filter on contacts_search. Fetch and filter client-side."],
    ["Filter contacts by created date", "No date filter. Sort by <font face='Courier'>contact_created_at</font> desc and stop at the cutoff."],
    ["Filter contacts by custom field", "Not supported. <font face='Courier'>q_keywords</font> covers name, title, employer, email only."],
    ["Export all contacts to CSV", "<font face='Courier'>csv_exports_export_view</font> only exports custom-object collections, not contacts."],
    ["Read Apollo workflow objects", "No workflow/automation endpoint exists in the connector at all."],
], [1.75 * inch, 5.15 * inch]))

story.append(Paragraph("4. The one filter that does exist, and is the whole trick", H3))
story.append(Paragraph(
    "<font face='Courier'>contact_label_ids</font> <b>is</b> a server-side filter. Jack&rsquo;s "
    "Apollo Plays already maintain lists that bucket leads by exactly the standing we want, so "
    "fetching by list beats crawling 19,667 contacts: roughly 90 targeted calls instead of 197 "
    "blind pages.", BODY))

story.append(Paragraph("Plays-maintained lists (contacts)", H3))
story.append(table([
    ["List", "List id", "Count", "Owner"],
    ["Unprocessed Leads", "68abe5c95d714d00190c607d", "5,823", "Russell &mdash; verify scope"],
    ["No Answer &mdash; Auto Email Continue", "6a749ad3f6b704000191faff", "802", "Jack"],
    ["Meeting Booked Contacts", "6a02523197f4590001552bf0", "102", "Jack"],
    ["SalesHive Non Actioned Leads", "69efcdacf6d770001d045465", "880", "Jack"],
    ["May Leads", "69f8cd829693db0021be518d", "584", "Jack"],
    ["May 7th", "69fe04615c4a720011fd42dd", "506", "Jack"],
    ["Nurturing Campaign MSP Camp", "6924952b5103a60021420bcb", "184", "Jack"],
    ["Saleshive Dynamics Backlog", "69fa1314448bfe001df5024e", "55", "Jack"],
], [1.95 * inch, 2.0 * inch, 0.6 * inch, 2.35 * inch], mono_cols=(1,)))
story.append(Paragraph(
    "The first three are written by Apollo&rsquo;s rules engine "
    "(<font face='Courier'>RulesEngine::ActionHandler#upsert_labels</font>) and update "
    "continuously. <b>&ldquo;Unprocessed Leads&rdquo; is owned by Russell&rsquo;s user id, not "
    "Jack&rsquo;s</b> &mdash; confirm in Apollo whether it is team-wide before treating it as "
    "Jack&rsquo;s never-contacted pile.", BODY))

# --------------------------------------------------------------- reference
story.append(Paragraph("Reference ids", H2))
story.append(Paragraph("People", H3))
story.append(table([
    ["Who", "Apollo user id", "Email"],
    ["Jack Snellgrove", "68bf4ba5f68a0600194acd11", "jack@wiredcio.com"],
    ["Carly Parks", "6a738903389433001cdab5da", "carly@wiredcio.com"],
    ["Team", "66203bd7183e310422980459", "&mdash;"],
], [1.4 * inch, 2.4 * inch, 3.1 * inch], mono_cols=(1,)))
story.append(Paragraph(
    "Resolve these by <b>email</b> at run time rather than hardcoding the ids &mdash; an id can "
    "change and a silently empty result looks like &ldquo;no work&rdquo; rather than a broken "
    "filter. If neither resolves, say the filter failed.", BODY))

story.append(Paragraph("Live sequences &mdash; Jack and Carly only", H3))
story.append(table([
    ["Sequence", "Sequence id", "Steps", "Owner"],
    ["Jack Main Sequence", "6a0b653aba6c9100208889c0", "6", "Jack"],
    ["Dual Effort Leads", "6a15fa4ba24719001c6a860f", "5", "Jack"],
    ["Jack Outbound Emails", "6a6a9356b1e5bf000c6855f6", "3", "Jack"],
    ["CSP Leads", "6aad4a8c59b8f300184954da", "5", "Jack"],
    ["Carly Main Sequence", "6a8c57f7bb0f38001460ab11", "6", "Carly"],
    ["Carly Outbound Emails", "6aa1691e1da2db001c122762", "3", "Carly"],
], [1.75 * inch, 2.25 * inch, 0.55 * inch, 2.35 * inch], mono_cols=(1,)))
story.append(Paragraph(
    "Eight further sequences belong to other people on the team and are deliberately out of "
    "scope, per Jack: &ldquo;just jack and carly that is it.&rdquo;", BODY))

story.append(Paragraph("Call outcomes Apollo actually uses", H3))
story.append(Paragraph(
    "Apollo names this dimension &ldquo;Disposition&rdquo;. It matches the Scanner&rsquo;s own "
    "nine almost exactly, plus one the app does not carry. Counts are the last 3 months.", BODY))
story.append(table([
    ["Reached them", "Calls", "Didn&rsquo;t reach them", "Calls"],
    ["Meeting Booked", "77", "No Answer", "6,261"],
    ["Call Back Scheduled", "111", "Gatekeeper / Front Desk", "182"],
    ["Info Requested", "69", "Wrong Number", "72"],
    ["Not interested", "163", "Left Voicemail", "24"],
    ["Do Not Contact", "1", "&mdash;", "&mdash;"],
    ["Qualified, Pending Review <b>*</b>", "14", "&mdash;", "&mdash;"],
], [1.95 * inch, 0.75 * inch, 1.95 * inch, 0.75 * inch]))
story.append(Paragraph(
    "<b>*</b> exists in Apollo, absent from the Scanner&rsquo;s disposition set. Apollo labels "
    "carry stray trailing spaces &mdash; trim before matching. Two further outcome ids return as "
    "bare 24-hex strings (125 calls): those outcomes were deleted while calls still reference "
    "them. Render as &ldquo;deleted&rdquo;, never as a raw id.", BODY))

# ------------------------------------------------------------- the numbers
story.append(Paragraph("The numbers this is meant to fix", H2))
story.append(Paragraph("Last 6 months, whole account:", BODY))
story.append(table([
    ["Metric", "Value", ""],
    ["Leads loaded", "19,667", ""],
    ["Added to a sequence", "8,194", "<font color='#ab372c'><b>11,473 never sequenced (58%)</b></font>"],
    ["Actually touched", "7,972", "<font color='#ab372c'><b>11,695 never touched (59%)</b></font>"],
    ["Called", "7,047", ""],
    ["Emailed", "5,785", ""],
    ["Replied", "114", "1.4% of touched"],
], [1.9 * inch, 0.9 * inch, 4.1 * inch]))
story.append(Paragraph(
    "Nearly six in ten qualified leads have never been called once. That is the gap the "
    "upload-time flag is meant to stop widening.", BODY))

# ---------------------------------------------------------- implementation
story.append(Paragraph("Suggested implementation", H2))
story.append(Paragraph(
    "The Scanner already holds every lead ever uploaded &mdash; its Contacts store captures every "
    "row of every CSV, not only Strong Signal ones &mdash; and already has a disposition filter, a "
    "tier filter and a <font face='Courier'>workedFilter</font> (all / worked / unworked) driven by "
    "<font face='Courier'>isWorked()</font> in <font face='Courier'>lib/contacts.ts</font>.", BODY))
story.append(Paragraph(
    "<b>The problem to fix:</b> <font face='Courier'>isWorked()</font> reads "
    "<font face='Courier'>callCount || emailCount</font>, and those only ever count activity logged "
    "<i>inside the app</i>. Apollo says 7,047 contacts were called; the app says almost none. So the "
    "existing filter currently reports nearly every lead as never contacted, which is wrong.", BODY))

story.append(Paragraph("New fields on Contact", H3))
story.append(Paragraph(
    "Keep these separate from the app&rsquo;s own manual counters, for the same reason "
    "<font face='Courier'>disposition</font> is kept separate from "
    "<font face='Courier'>outreachStatus</font>: one is what we logged here, the other is what "
    "Apollo did. Then widen <font face='Courier'>isWorked()</font> to consider both.", BODY))
story.append(Paragraph(
    "apolloContactId?: string;<br/>"
    "apolloSequences?: { id: string; name: string; status: string;<br/>"
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
    "step: number; addedAt: string }[];<br/>"
    "apolloStanding?: string;      // from the Plays list membership<br/>"
    "apolloLastActivityAt?: string | null;<br/>"
    "apolloSyncedAt?: string;", CODE))

story.append(Paragraph("The upload-time check", H3))
story.append(Paragraph(
    "Hook it into <font face='Courier'>App.tsx</font>&rsquo;s <font face='Courier'>recordHistory</font> "
    "&mdash; the single choke point every CSV upload already passes through (Scanner direct upload, "
    "Library upload-into-folder, and Library &ldquo;Load into Scanner&rdquo; all funnel there, which "
    "is where <font face='Courier'>mergeContacts</font> already runs).", BODY))
story.append(b("Match on email first, then normalised name+company &mdash; the same convention "
               "<font face='Courier'>buildContactIndex</font> / <font face='Courier'>lookupContact</font> already use."))
story.append(b("Make the Apollo call <b>explicit</b>, never automatic, matching the shipped "
               "&ldquo;Enrich via Apollo&rdquo; pattern and Jack&rsquo;s standing rule: "
               "&ldquo;I don&rsquo;t want too much going on in the background I can&rsquo;t see.&rdquo;"))
story.append(b("Make it resumable and stoppable, with a visible progress count."))
story.append(b("All of these calls are reads and consume <b>zero Apollo credits</b>."))

story.append(Paragraph("Artifact manifest", H3))
story.append(Paragraph(
    "<font face='Courier'>capabilities</font> is a full-set declaration &mdash; anything not restated "
    "on a republish is silently revoked. This has already broken every CSV download once. Restate "
    "<b>both</b> every time:", BODY))
story.append(Paragraph(
    'capabilities: {<br/>'
    '&nbsp;&nbsp;downloads: true,<br/>'
    '&nbsp;&nbsp;mcp: { servers: [{ server: "Apollo.io", tools: [<br/>'
    '&nbsp;&nbsp;&nbsp;&nbsp;"apollo_people_match", "apollo_people_bulk_match",<br/>'
    '&nbsp;&nbsp;&nbsp;&nbsp;"apollo_organizations_enrich", "apollo_organizations_bulk_enrich",<br/>'
    '&nbsp;&nbsp;&nbsp;&nbsp;"apollo_contacts_search", "apollo_labels_index",<br/>'
    '&nbsp;&nbsp;&nbsp;&nbsp;"apollo_emailer_campaigns_search", "apollo_users_search"<br/>'
    '&nbsp;&nbsp;] }] }<br/>'
    '}', CODE))
story.append(Paragraph(
    "The last four are the additions this feature needs. Everything else is already declared and "
    "must be carried forward.", BODY))

# ------------------------------------------------------------------- gaps
story.append(Paragraph("Known gaps, stated rather than hidden", H2))
story.append(b("<b>Exact per-contact call counts are not bulk-available.</b> Sequence membership and "
               "status are. Getting &ldquo;called 3 times&rdquo; needs "
               "<font face='Courier'>apollo_phone_calls_search</font> with a contact id &mdash; one "
               "call per contact, so it belongs in the contact detail view, not a bulk sync."))
story.append(b("<b>Left Voicemail is logged 24 times against 6,261 No Answers.</b> Voicemails are "
               "being left and not dispositioned, so No Answer is a bucket rather than an outcome and "
               "the true connect rate is understated."))
story.append(b("<b>No sequence finishes on a connected call.</b> "
               "<font face='Courier'>mark_finished_if_phone_call_connected</font> is unset on every "
               "sequence with call steps, so leads who book a meeting by phone stay enrolled and keep "
               "being worked. Fix in Apollo, not in code."))
story.append(b("<b>Nothing blocks re-entry by stage.</b> "
               "<font face='Courier'>excluded_contact_stage_ids</font> is empty everywhere, which is "
               "why the Not Interested stage holds 116 contacts but shows 145 sequence adds."))
story.append(b("<b>Apollo exposes no sequence delete.</b> Only create and update, and update uses "
               "declarative diff: any step id omitted from the payload is <b>deleted</b>. Treat "
               "writes as out of scope &mdash; per Jack, this is oversight, not an Apollo replacement."))

story.append(Spacer(1, 10))
story.append(rule())
story.append(Spacer(1, 6))
story.append(Paragraph(
    "Companion tool: <b>Apollo Sequence Control</b> &mdash; a standalone read-only console over the "
    "same data (sequences, workflow structure, dispositions, contact stages, mailbox health), scoped "
    "to Jack and Carly. Source: <font face='Courier'>apollo-control/index.html</font>. That tool and "
    "this brief were built from the same verified calls.", BODY))

doc = BaseDocTemplate(OUT, pagesize=LETTER,
                      leftMargin=0.85 * inch, rightMargin=0.85 * inch,
                      topMargin=0.85 * inch, bottomMargin=0.75 * inch,
                      title="Apollo to Lead Scanner build brief",
                      author="Wired CIO")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=header_footer)])
doc.build(story)
print("wrote", OUT)
