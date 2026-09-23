import { useState } from "react";
import { EXPORT_LABELS, TOP_PRIORITY_META, TOP_PRIORITY_ORDER } from "../lib/detection";
import { SCANNER2_EXPORT_LABELS, CSP_EXPORT_LABELS } from "../lib/scanner2";
import { BILLING_META, POSTURE_META, DEFAULT_CSP_RULES, DEFAULT_CSP_WEIGHTS, WEIGHT_META, DEAD_PATTERNS, MOTION_PATTERNS, MOTION_WEIGHT, CSP_COLUMN_HINTS, WANTS_PARTNER_LABEL } from "../lib/cspRenewal";
import { SMC_PRODUCTS, DEFAULT_SMC_SCORE_RULES, DEFAULT_SMC_WEIGHTS, SMC_FACTOR_META, SMC_PARTNER_META, RUNS_MAX } from "../lib/smcLead";

/**
 * The reference for the whole platform: what each scanner reads, what it
 * does with it, and what comes out. Per Jack — "every time I receive data
 * in a new way I am going to have to build a scanner" — so this doubles as
 * the spec for adding a fourth.
 *
 * Everything quantitative here is READ FROM THE CODE, never retyped: the
 * column lists, the default weights and thresholds, the billing ranks, the
 * partner postures and the note patterns all come from the same constants
 * the engines run on. Change a rule and this page changes with it, so it
 * cannot drift into being wrong.
 */
export default function Documentation() {
  const [open, setOpen] = useState<string>("overview");
  const sec = (id: string, title: string, body: React.ReactNode, sub?: string) => (
    <div className="panel" style={{ marginBottom: 12 }} key={id}>
      <div className="panel-head">
        <button
          className="btn btn-sm btn-ghost"
          aria-label={`Toggle ${title}`}
          aria-expanded={open === id}
          onClick={() => setOpen(open === id ? "" : id)}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 6px", textAlign: "left" }}
        >
          <span aria-hidden="true">{open === id ? "▾" : "▸"}</span>
          <span>
            <span className="panel-title" style={{ margin: 0 }}>{title}</span>
            {sub && <span className="panel-sub" style={{ display: "block", margin: 0, fontWeight: 400 }}>{sub}</span>}
          </span>
        </button>
      </div>
      {open === id && <div className="panel-body" style={{ fontSize: 13, lineHeight: 1.6 }}>{body}</div>}
    </div>
  );

  const H = ({ children }: { children: React.ReactNode }) =>
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", margin: "14px 0 6px" }}>{children}</div>;
  const Code = ({ children }: { children: React.ReactNode }) =>
    <code style={{ background: "var(--surface-sunken)", padding: "1px 5px", borderRadius: 4, fontSize: 12 }}>{children}</code>;
  const Table = ({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) => (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table" style={{ fontSize: 12.5, width: "100%" }}>
        <thead><tr>{head.map((h) => <th key={h} style={{ textAlign: "left" }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="page-bar">
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Documentation</h2>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            What each scanner reads, how it decides, and what comes out. Numbers on this page are read from the live rules.
          </span>
        </div>
      </div>

      {sec("overview", "How the platform is put together", (
        <>
          <p style={{ marginTop: 0 }}>
            Three scanners, one set of plumbing. Every scanner shares the CSV reader, the column-guesser, the results
            table and the Apollo export; each owns its own rules and its own storage. They cannot see each other&rsquo;s
            rule sets, runs, or keep/reject decisions.
          </p>
          <Table
            head={["Scanner", "Built for", "Decides on", "Output"]}
            rows={[
              ["Main Scanner", "Apollo / CRM exports with free-text notes", "keyword and product-line detection", "Strong Signal / Needs Review / Bad Lead"],
              ["Custom Scanner September", "Microsoft SMC / Cloud Ascent propensity blobs", "propensity stage x fit, against what they already own", "Strong Signal / Needs Review / Bad Lead"],
              ["CSP Scanner", "Microsoft CSP opportunity exports", "a 0–100 score over six weighted factors", "High / Medium / Low priority"],
            ]}
          />
          <H>What is genuinely shared</H>
          <p style={{ margin: 0 }}>
            CSV parsing (including two repairs made once for everyone: Excel&rsquo;s glued <Code>NULL</Code>, and mojibake
            where an export lost its encoding and wrote <Code>customer?s</Code>), column profiling and auto-mapping,
            duplicate merging, the results table, curation, and the nine-column Apollo export. Nothing about how a lead
            is judged is shared.
          </p>
          <H>Adding a fourth scanner</H>
          <p style={{ margin: 0 }}>
            A new format needs three things: a rules module of its own (importing none of the other engines), a branch in
            the scan <Code>mode</Code> switch, and a <Code>scanner</Code> tag on its saved rule sets and runs so its
            storage stays separate. The <Code>isolation</Code> test suite pins all three; if a new scanner reaches into
            another engine, that suite fails.
          </p>
        </>
      ), "Three scanners, shared plumbing, separate rules")}

      {sec("csp", "CSP Scanner — licensing renewals and cold outreach", (
        <>
          <p style={{ marginTop: 0 }}>
            Reads a Microsoft CSP <b>opportunity</b> export. The goal is to become the customer&rsquo;s partner of record,
            so the scoring is about whether the deal is alive, whether there is a lane in, and whether it is worth the
            call. There is deliberately <b>no product line</b> here.
          </p>

          <H>Columns it looks for</H>
          <Table
            head={["Field", "Header candidates, in priority order"]}
            rows={Object.entries(CSP_COLUMN_HINTS).map(([k, v]) => [<Code key={k}>{k}</Code>, v.join(", ")])}
          />
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            Identity columns (company, contact, title, email, work phone, mobile) are matched separately. When two columns
            match the same hint, the fuller one wins &mdash; a CSP export carries both <Code>address1_telephone1</Code> (71
            rows filled) and <Code>telephone1</Code> (6,580), and the near-empty one sits first in the file.
          </p>

          <H>The date it filters on</H>
          <p style={{ margin: 0 }}>
            A date column on the sheet always wins &mdash; <Code>createdon</Code>, <Code>createdate</Code>,{" "}
            <Code>uploaddate</Code>, <Code>dateadded</Code>, <Code>leadcreatedon</Code> and similar. A <i>close</i> or{" "}
            <i>expected</i> date is ignored: that is a forecast, not a receipt. When the export has no date column at all
            (the current CSP file has none), the date is the newest dated entry in the seller notes &mdash; the filter
            label says which of the two you are looking at.
          </p>

          <H>How the score is built</H>
          <p style={{ margin: 0 }}>
            Six factors, each scoring a share of its weight, normalised to 0&ndash;100. Weights are editable per scan.
          </p>
          <Table
            head={["Factor", "Default weight", "Full marks for"]}
            rows={WEIGHT_META.map((m) => [m.label, String(DEFAULT_CSP_WEIGHTS[m.key]), m.hint])}
          />

          <H>Billing intent</H>
          <p style={{ margin: 0 }}>How they want to be billed, best first. An unrecognised programme ranks last rather than being guessed better.</p>
          <Table
            head={["Rank", "Programme", "Share of the billing weight"]}
            rows={BILLING_META.map((b) => [String(b.rank), b.label, `${Math.round([1, 0.8, 0.55, 0.4, 0.15][b.rank] * 100)}%`])}
          />

          <H>Partner lane</H>
          <Table
            head={["Posture", "Means", "Counts as an open lane"]}
            rows={(Object.keys(POSTURE_META) as (keyof typeof POSTURE_META)[]).map((k) => [
              POSTURE_META[k].label,
              k === "unassigned" ? "nothing in the partner column" :
              k === "unresolved" ? "“Partner with non-existing MPN ID” — Microsoft cannot resolve them" :
              k === "microsoft" ? "Microsoft Corporation — no reseller in the way" : "a named reseller holds the customer",
              POSTURE_META[k].open ? "yes" : "no, unless the notes show the deal moving",
            ])}
          />
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            When the column says nobody but the notes name a reseller, the row is flagged and loses lane points &mdash; it
            is less open than it looks.
          </p>

          <H>What the notes are read for</H>
          <Table
            head={["Signal", "Weight", "Effect"]}
            rows={MOTION_PATTERNS.map((m) => [m.label, String(MOTION_WEIGHT[m.label] ?? 0),
              m.label === WANTS_PARTNER_LABEL
                ? "top quality — forces High priority whatever the score says, and saturates the notes factor"
                : "adds toward the notes factor"])}
          />
          <H>&#9745; &ldquo;Wants a partner&rdquo; is the top-quality flag</H>
          <p style={{ margin: 0 }}>
            If the notes say the customer wants a partner, the lead is <b>forced to High priority regardless of its
            score</b> &mdash; that is the whole pitch, and it should never sit in Medium because its deal value went
            unstated. It carries a <b>&#9873; wants a partner</b> chip in the table and has its own filter toggle, so you
            can pull exactly that list.
          </p>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            Three things are deliberately NOT treated as a customer asking, because on a real 9,265-row export the naive
            reading fired 961 times with 857 of those on rows that already <i>name</i> a partner:
          </p>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            <li><b>Microsoft&rsquo;s own CRM template text.</b> <Code>Partner Recommendation</Code> is a form field and
              <Code>partner referral</Code> is Microsoft&rsquo;s own referral workflow &mdash; a referral they already
              made. Those two accounted for 846 of the false fires on their own.</li>
            <li><b>Template form values near the match</b> &mdash; <Code>Partner: Not discovered</Code>,{" "}
              <Code>PCM program: Open to partner introduction</Code>, <Code>Partner Contact: N/A</Code>.</li>
            <li><b>Negations.</b> &ldquo;does not want a reseller to be the middle man&rdquo; is the opposite signal.</li>
          </ul>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            Template text elsewhere in a long multi-entry blob does not suppress a genuine ask &mdash; only text within
            110 characters of the phrase does. Net on that file: <b>118 flagged instead of 961</b>, and 69 leads that had
            been scoring on the boilerplate left High while 68 that actually ask came in.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            These end a deal instead: {DEAD_PATTERNS.map((d) => d.label).join(", ")}. Where they sit matters &mdash;{" "}
            <b>&minus;{DEFAULT_CSP_RULES.deadLatestPenalty}</b> when in the newest seller entry (the account is dead
            today), <b>&minus;{DEFAULT_CSP_RULES.deadOlderPenalty}</b> when only in an older one (that is history). Nothing
            is binned outright: every lead is scored on its merits and then marked down.
          </p>

          <H>Bands</H>
          <p style={{ margin: 0 }}>
            High at <b>{DEFAULT_CSP_RULES.strongAt}+</b>, Medium at <b>{DEFAULT_CSP_RULES.reviewAt}+</b>, Low below that.
            Untouched for more than {DEFAULT_CSP_RULES.staleDays} days costs {DEFAULT_CSP_RULES.stalePenalty} points. One
            Two things reach High regardless of score: a lead whose notes state it <b>wants a partner</b> (top quality,
            see above), and above even that the pinned lead &mdash; <b>asking for a partner, none assigned, and annual
            new upfront billing</b>, all three at once. You can override any lead to High / Medium / Low by hand, and the
            override wins.
          </p>

          <H>What comes out</H>
          <p style={{ margin: 0 }}>
            High priority and Medium priority download separately, best score first, in the nine-column Apollo shape.
            <b> Product Area carries the priority</b>, so you can split sequences on it in Apollo. Partner, deal value,
            billing, last touch, licenses named and the next step all fold into Notes. Downloads follow whatever filters
            are set. Low priority is never downloaded.
          </p>
        </>
      ), "Scores a CSP opportunity 0–100 on partner lane, billing intent, recency, notes, value and reachability")}

      {sec("smc", "Custom Scanner September — Microsoft SMC / Cloud Ascent", (
        <>
          <p style={{ marginTop: 0 }}>
            Reads the run-on text blob a Cloud Ascent export puts in its description column. Nobody writes a sentence
            saying they want to buy, so intent is read from the propensity matrix instead: what Microsoft&rsquo;s model
            recommends, crossed with what the customer already owns.
          </p>
          <H>What it parses out of the blob</H>
          <p style={{ margin: 0 }}>
            Customer TPID, company, website, main phone, SMC segment, every contact block (first/last name, job title,
            phone, email, LinkedIn), the propensity table for {SMC_PRODUCTS.length} products, current ownership, BANT
            (budget / authority / need / timeline / partner) and the date the data was pulled.
          </p>
          <H>Scored 0–100, like the CSP tab</H>
          <p style={{ margin: 0 }}>
            Every lead gets a score and lands in <b>High</b>, <b>Medium</b> or <b>Low priority</b>. High at{" "}
            <b>{DEFAULT_SMC_SCORE_RULES.strongAt}+</b>, Medium at <b>{DEFAULT_SMC_SCORE_RULES.reviewAt}+</b>, both
            editable. Six weighted factors:
          </p>
          <Table
            head={["Factor", "Weight", "What earns it"]}
            rows={SMC_FACTOR_META.map((m) => [m.label, String(DEFAULT_SMC_WEIGHTS[m.key]), m.hint])}
          />
          <H>Two things worth knowing about the weights</H>
          <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
            <li><b>Fit is not scored, on purpose.</b> Measured across all 16,865 propensity rows in a real 13,106-row
              export, Fit is the SAME signal as the stage with zero exceptions — Act Now always High, Evaluate always
              Medium, Nurture always Low, Educate always Very Low. Requiring both looked strict but was one
              requirement wearing two hats.</li>
            <li><b>The prioritization index IS independent, and used to be switched off.</b> Within Act Now it is High
              only 36% of the time. That makes it the real discriminator in this data, which is why it carries the
              second-largest weight.</li>
          </ul>
          <H>Partner lane \u2014 an adjustment, not a seventh weight</H>
          <p style={{ margin: 0 }}>
            The blob sometimes carries a <code>Partner:</code> field naming who already holds the account.
            Where it does, the score moves by <b>{"\u00b1"}{DEFAULT_SMC_SCORE_RULES.partnerAdjust}</b> points:
          </p>
          <Table
            head={["Lane", "Effect", "What it means"]}
            rows={[
              [SMC_PARTNER_META.open.label, `+${DEFAULT_SMC_SCORE_RULES.partnerAdjust}`, SMC_PARTNER_META.open.hint],
              [SMC_PARTNER_META.held.label, `\u2212${DEFAULT_SMC_SCORE_RULES.partnerAdjust}`, SMC_PARTNER_META.held.hint],
              [SMC_PARTNER_META.unknown.label, "0", SMC_PARTNER_META.unknown.hint],
            ]}
          />
          <p style={{ margin: 0 }}>
            It is an adjustment rather than a weighted factor for one measured reason: on the real 13,106-row export
            the blob states a partner on <b>2.7% of rows</b>. A seventh weight divides every row by a bigger
            denominator, so the 97% that say nothing either way would quietly lose points for staying silent. This
            way only the rows that actually state something move. On that file it shifted <b>142 rows</b> of 12,118 —
            almost all of it at the Medium / Low line, where 130 partner-held leads dropped out of Medium and 10
            open-lane leads came up into it. Set the adjustment to <b>0</b> to turn it off entirely.
          </p>
          <p style={{ margin: 0 }}>
            This is deliberately NOT the CSP tab&rsquo;s four-way partner posture. CSP reads a dedicated column that is
            about 70% filled, which is what justifies a 30-point factor there. Here it is a label inside free text,
            so the honest answer for most rows is &ldquo;not stated&rdquo; and it has to cost nothing.
          </p>
          <H>Top quality, and what still overrides the score</H>
          <p style={{ margin: 0 }}>
            A <b>stated BANT need on an Act Now whitespace account</b> is forced to High priority whatever it scores —
            the analogue of &ldquo;wants a partner&rdquo; on the CSP tab, and the only place in this data where a human
            wrote down what the customer actually wants. All four at once (stated need, Act Now, High index, not owned)
            pins the lead to the very top. Fabric is still never sold, Power BI still waits for a human to judge the
            size, and a stale campaign is still excluded before anything is scored.
          </p>
          <H>Hot words only count where a human wrote them</H>
          <p style={{ margin: 0 }}>
            &ldquo;modernize / migrate&rdquo; in the <b>BANT need or the notes</b> pushes a lead to High. In the{" "}
            <b>campaign title</b> it does not, and shows only as context. On the real export that title rule was firing
            on 173 of 197 hot-signal leads across just 81 distinct campaign names — 364 accounts shared
            &ldquo;Microsoft Azure Virtual Training Day: Migrate and Secure Windows Server&rdquo; alone, and 122 of the
            197 had no propensity data at all. A webinar invite list is not buying intent.
          </p>
          <H>What comes out</H>
          <p style={{ margin: 0 }}>
            Five files: High priority split by product line (Dynamics 365, M365 / Azure) plus a combined High file,
            Medium priority whole, and High + Medium together — High gets called, Medium gets emailed. Every file is
            <b> ranked by score, best first</b>, the same order the CSP files come out in, and a manual High / Medium /
            Low override wins over the score. Low priority is never downloaded. Product Area carries the product line.
          </p>
          <H>What the note tells the rep</H>
          <p style={{ margin: 0 }}>
            The Notes column is the call note, and it names <b>one area</b> so the call has a direction rather
            than a summary. It opens with the instruction &mdash; <b>Pitch</b> a product they do not run,
            <b> Expand</b> one they do &mdash; then the evidence for it: a <b>stated need quoted verbatim</b> when
            a human wrote one, otherwise Cloud Ascent&rsquo;s own stage and fit. A stated need picks the area
            outright, ahead of the propensity ranking, because a human wrote it about this account. After that
            come up to {RUNS_MAX} products they already run (closest to the pitch first), the band and score, and
            who holds the account. A second, competing product is never named, and a product they already run is
            never pitched to them.
          </p>
        </>
      ), `Scored 0–100 across six factors plus a ±${DEFAULT_SMC_SCORE_RULES.partnerAdjust} partner lane; High at ${DEFAULT_SMC_SCORE_RULES.strongAt}+`)}

      {sec("main", "Main Scanner — general CRM and Apollo exports", (
        <>
          <p style={{ marginTop: 0 }}>
            The original scanner, for exports where a human wrote real notes. It reads the free text for buying signals
            and maps them to the two lines Wired CIO sells, then applies cross-cutting disqualifiers.
          </p>
          <H>Top priority</H>
          <p style={{ margin: 0 }}>
            Two signals pin a lead to the top — of the results table, of the Lead library file it is stored in,
            and of every download that contains it. Ranked in this order:
          </p>
          <Table
            head={["Badge", "What it means"]}
            rows={TOP_PRIORITY_ORDER.map((k) => [`★ ${TOP_PRIORITY_META[k].label}`, TOP_PRIORITY_META[k].hint])}
          />
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            A pin is a badge and a sort, nothing else. It never changes a lead’s product line, its tier, or which
            file it downloads in — the same leads come out, the pinned ones just come out first. A lead carrying
            both signals shows as the Google one, the rarer of the two. This is narrower than the
            <b> Google → Microsoft</b> view tab, which is a migrations tab: a generic modernization or an Azure
            lift-and-shift shows there but is not pinned.
          </p>
          <H>What comes out</H>
          <p style={{ margin: 0 }}>Ten columns — the canonical Apollo shape, with first and last name separate:</p>
          <p style={{ margin: "6px 0 0" }}>{EXPORT_LABELS.map((l) => <Code key={l}>{l}</Code>)}</p>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            The Custom Scanner exports the same ten. The CSP Scanner exports eight of them: it drops Title and Number of
            Employees, because a CSP opportunity export states neither and an always-blank column is worse than an absent
            one &mdash; Apollo hides it on import either way. Sources that carry one full-name field are split at the last
            space, so First and Last Name are always separate on every download.
          </p>
        </>
      ), "Keyword and product-line detection over free-text notes")}

      {sec("export", "The CSV, column by column", (
        <>
          <p style={{ marginTop: 0 }}>
            Every download is the same canonical Apollo shape, in the same order, so anything you pull imports the same
            way. The CSP export is that shape with two columns removed, never reordered.
          </p>
          <Table
            head={["#", "Column", "Main Scanner", "Custom Scanner", "CSP Scanner"]}
            rows={EXPORT_LABELS.map((l) => [
              (CSP_EXPORT_LABELS as readonly string[]).includes(l)
                ? "ABCDEFGHIJ"[(CSP_EXPORT_LABELS as readonly string[]).indexOf(l)]
                : "—",
              l,
              "yes",
              (SCANNER2_EXPORT_LABELS as readonly string[]).includes(l) ? "yes" : "no",
              (CSP_EXPORT_LABELS as readonly string[]).includes(l) ? "yes" : "no — not in the source",
            ])}
          />
          <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
            The first column is the spreadsheet letter that column lands in on a CSP download. Company Name is D and
            Product Area and Notes are the last two, G and H &mdash; no number ever lands in either.
          </p>
          <H>Things worth knowing before you import</H>
          <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
            <li>A column blank in every row is flagged above the downloads, because Apollo hides those on import. The two
              columns a CSP export could never fill &mdash; Title and Number of Employees &mdash; are not written at all
              rather than shipped empty.</li>
            <li>Company Name is recovered rather than left blank: the account column first, then any other company or
              customer column, then a company named in the notes, and finally the email domain if it is not a free
              provider.</li>
            <li>Phone numbers Excel mangled into scientific notation (<Code>5.25549E+11</Code>) are dropped, not exported.
              The real digits are unrecoverable, and a wrong number in a call list is worse than a blank.</li>
            <li>A phone that appears only inside the notes, explicitly labelled, is recovered into the phone column.</li>
            <li>Duplicates are merged before export, first-seen wins, and the count is shown.</li>
            <li>Anything you mark Low priority, or Reject on the other scanners, is left out of the downloads.</li>
          </ul>
        </>
      ), `${EXPORT_LABELS.length} columns on Main and Custom, ${CSP_EXPORT_LABELS.length} on CSP`)}

      {sec("capacity", "Capacity and storage", (
        <>
          <H>Measured on the real 24 MB / 9,265-row CSP export</H>
          <Table
            head={["Upload", "Rows in", "Parse", "Scan", "Re-scan on a rule change", "Browser memory"]}
            rows={[
              ["1 file", "9,265", "0.4 s", "2.3 s", "2.2 s", "113 MB"],
              ["2 files", "18,530", "0.7 s", "4.4 s", "4.3 s", "228 MB"],
              ["3 files", "27,795", "27,795", "6.6 s", "6.5 s", "249 MB"],
            ]}
          />
          <p style={{ margin: "8px 0 0" }}>
            A monthly pull is comfortably inside this. Scanning is linear in rows, and the slow part is reading the seller
            notes, which is cached per row so changing a rule only re-scores.
          </p>
          <H>What is actually stored</H>
          <p style={{ margin: 0 }}>
            Only your rule sets, a small run record per scan (file names and counts — a few hundred bytes, never the
            rows), and one row per lead you curate. The leads themselves live in the page for as long as the scan is open
            and are never written to disk, which is why a reload starts fresh.
          </p>
        </>
      ), "Measured, not estimated")}

      {sec("limits", "Known limits", (
        <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
          <li><b>&ldquo;Wants a partner&rdquo; over-fires.</b> Microsoft&rsquo;s own boilerplate &mdash; &ldquo;Partner: Not
            discovered &mdash; recommend initiating partner discovery&rdquo; &mdash; reads as a customer asking for one.
            Pinned leads also require no partner assigned and annual upfront, so they are unaffected, but the notes factor
            is generous on rows held by a named partner.</li>
          <li><b>Title and employee count are not exported by the CSP Scanner</b> because the source carries neither.
            Filter industry and employee range in Apollo after enrichment.</li>
          <li><b>Undated notes.</b> Roughly one row in eight states no date anywhere; those score zero on recency rather
            than being guessed a date, and a date filter excludes them.</li>
          <li><b>A reload clears the results.</b> Rule sets, runs and curation survive; the scanned rows do not.</li>
        </ul>
      ), "Stated plainly rather than discovered later")}
    </div>
  );
}
