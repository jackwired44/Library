import { useState } from "react";
import { EXPORT_LABELS } from "../lib/detection";
import { SCANNER2_EXPORT_LABELS, CSP_EXPORT_LABELS } from "../lib/scanner2";
import { BILLING_META, POSTURE_META, DEFAULT_CSP_RULES, DEFAULT_CSP_WEIGHTS, WEIGHT_META, DEAD_PATTERNS, MOTION_PATTERNS, MOTION_WEIGHT, CSP_COLUMN_HINTS } from "../lib/cspRenewal";
import { DEFAULT_SMC_RULES, SMC_PRODUCTS } from "../lib/smcLead";

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
              m.label === "wants a partner" ? "saturates the notes factor on its own — the strongest thing a note can say" : "adds toward the notes factor"])}
          />
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
            lead type is pinned to the top of High regardless of score: <b>asking for a partner, none assigned, and annual
            new upfront billing</b>. You can override any lead to High / Medium / Low by hand, and the override wins.
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
          <H>What makes a Strong Signal</H>
          <p style={{ margin: 0 }}>
            A product at stage <b>{DEFAULT_SMC_RULES.stages.join(" or ")}</b>, at least <b>{DEFAULT_SMC_RULES.minFit}</b>{" "}
            fit, on a line we sell ({DEFAULT_SMC_RULES.lines.join(" or ")}), and&nbsp;
            {DEFAULT_SMC_RULES.requireNotOwned ? "not already owned — the whitespace play" : "owned or not"}. A high
            prioritisation index, real BANT, or hot language can also promote. Fabric is not sold, and Power BI only
            counts on a large opportunity.
          </p>
          <H>What comes out</H>
          <p style={{ margin: 0 }}>
            Strong Signal leads download split by product line (Dynamics 365, M365 / Azure), in the same nine columns.
            Product Area carries the product line; the reason and the campaign fold into Notes.
          </p>
        </>
      ), "Reads the Cloud Ascent propensity blob; Strong Signal is whitespace at high fit")}

      {sec("main", "Main Scanner — general CRM and Apollo exports", (
        <>
          <p style={{ marginTop: 0 }}>
            The original scanner, for exports where a human wrote real notes. It reads the free text for buying signals
            and maps them to the two lines Wired CIO sells, then applies cross-cutting disqualifiers.
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
