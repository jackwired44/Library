import { scanParsedFiles, type ParsedFile } from "../../src/lib/detection";

// Three things Jack asked for in one pass: the matched snippet has to read
// like the lead's own words, the capture gaps have to close, and neither
// may cost precision. They run together on purpose — widening a pattern to
// close a gap shows up here immediately as a precision failure rather than
// as noise in a real batch.

const HEAD = ["First Name", "Last Name", "Title", "Company", "Email", "Phone", "Comments"];
function scan(comment: string, extra: Record<string, string> = {}) {
  const pf: ParsedFile = {
    name: "t.csv",
    fields: [...HEAD, ...Object.keys(extra)],
    data: [{
      "First Name": "Dana", "Last Name": "Reed", Title: "IT Director",
      Company: "Acme Manufacturing", Email: "dana@acmemfg.com", Phone: "(312) 555-0100",
      Comments: comment, ...extra,
    }],
  };
  const r = scanParsedFiles([pf]).results[0];
  return { tier: r ? r.tier : "none", snippet: r ? r.notesSummary : "" };
}

let bad = 0;
const chk = (name: string, ok: boolean, detail: string) => {
  if (!ok) bad++;
  console.log(`${ok ? "  PASS" : "  FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

/* ------------------------------------------------------------------ *
 * 1. The snippet must quote the lead, not a canned category blurb.
 *
 * "budget", "timeline", "this year", "Q3", "renewal", "pricing",
 * "procurement" and "contract" are the SAME words TRIGGER_WORDS_RE uses
 * to promote a lead — but they were also on the snippet's forbidden list,
 * so the sentence that earned the lead its tier was guaranteed to be the
 * one excluded, and the row fell back to boilerplate. 7 of these 12
 * realistic notes showed a canned blurb before the fix.
 * ------------------------------------------------------------------ */
console.log("-- snippet: must quote the lead, not a canned blurb --");
const BLURBS = ["Interested in modernizing their CRM/ERP setup.", "Interested in setting up or supporting their M365 tenant"];
const quoting: [string, string, string][] = [
  ["budget", "They have budget approved for a Business Central rollout. The controller is the decision maker.", "budget approved"],
  ["this year", "Looking to migrate to Business Central this year with an implementation partner.", "this year"],
  ["Q3", "Planning a Dynamics 365 Business Central implementation in Q3 with a partner.", "Q3"],
  ["renewal", "Their Microsoft 365 E3 renewal is coming up for 120 users and they want a new CSP.", "renewal"],
  ["timeline", "Timeline is next quarter to bring in a partner for an Azure migration off on-prem.", "Timeline"],
  ["pricing", "Asked for pricing on Business Central for 40 users, want a partner to implement.", "pricing"],
  ["large seat count", "They run 12000 seats of Microsoft 365 E3 and want a new partner.", "12000 seats"],
  ["procurement", "Procurement wants three bids for a Business Central partner.", "Procurement"],
  ["contract ending", "Their current MSP contract ends soon; they want a new managed services partner for M365.", "managed services partner"],
  ["ERP + CRM", "We run ERP and CRM on separate legacy systems and want a partner to consolidate.", "consolidate"],
  ["picks the best of several", "The company makes industrial valves. They are moving off Great Plains. They want a Microsoft partner to lead the Business Central implementation this year.", "Business Central implementation"],
  ["clean sentence unchanged", "They want to bring in a partner to move their ERP to Business Central.", "bring in a partner"],
];
quoting.forEach(([n, c, mustContain]) => {
  const { snippet } = scan(c);
  const isBlurb = BLURBS.some((b) => snippet.startsWith(b));
  chk(n, !isBlurb && snippet.includes(mustContain), `got ${JSON.stringify(snippet)}`);
});

/* ------------------------------------------------------------------ *
 * 2. What must never reach the snippet, whatever else the sentence says.
 * Email and phone have their own export columns; a ticket/case number is
 * pure noise; a sentence that is ONLY deal metadata says nothing about
 * what the lead wants. That was the original rule's real intent and it
 * still holds — it just no longer takes the good sentence down with it.
 * ------------------------------------------------------------------ */
console.log("\n-- snippet: contact details and pure metadata still never show --");
const redaction: [string, string, string][] = [
  ["email never leaks", "Reach Dana at dana@acmemfg.com. They want a partner for Business Central.", "dana@acmemfg.com"],
  ["phone never leaks", "Call 312-555-0100 to discuss. They want a partner for Business Central.", "312-555-0100"],
  ["ticket id never leaks", "Support Ticket ID: 4521. They want a partner for Business Central.", "4521"],
  ["bare money never leaks", "Budget $40,000. Follow up 3/15/2026. They want a partner for Business Central.", "$40,000"],
  ["bare date never leaks", "Budget $40,000. Follow up 3/15/2026. They want a partner for Business Central.", "3/15/2026"],
];
redaction.forEach(([n, c, mustNotContain]) => {
  const { snippet } = scan(c);
  chk(n, !snippet.includes(mustNotContain) && snippet.includes("Business Central"), `got ${JSON.stringify(snippet)}`);
});

/* ------------------------------------------------------------------ *
 * 3. Capture gaps. Every one of these was measured MISSING: most did not
 * just land in the wrong tier, they produced no hit at all, so the lead
 * was invisible everywhere in the app (not in Needs Review, not in Bad
 * Leads — only in the Non Relevant tab).
 * ------------------------------------------------------------------ */
console.log("\n-- capture: these were invisible or under-tiered --");
const capture: [string, string][] = [
  ["M&A mailbox migration", "We acquired a company and need to migrate their email into our Microsoft 365 tenant."],
  ["tenant merge", "Two tenants after an acquisition, need them merged into one Microsoft 365 tenant."],
  ["tenant to tenant", "Tenant to tenant migration after acquiring a competitor."],
  ["CSP / reseller transfer", "Want to move our Microsoft licensing to a new reseller."],
  ["data centre exit to Azure", "Closing our data center and moving everything to Azure."],
  ["VMware escape to Azure", "VMware licensing costs exploded, evaluating a move to Azure."],
  ["hardening the M365 estate", "Preparing for SOC 2 and need help hardening our Microsoft environment."],
];
capture.forEach(([n, c]) => { const { tier } = scan(c); chk(n, tier === "signal", `got ${tier}`); });

/* ------------------------------------------------------------------ *
 * 4. Precision on exactly the rules widened above. `migrat\w*`, the Azure
 * move verbs, the on-prem synonyms, the tenant-project and licensing
 * phrases and the hardening stem each carry a real over-fire risk in
 * ordinary prose.
 * ------------------------------------------------------------------ */
console.log("\n-- precision: the widened rules must not over-fire --");
const precision: [string, string, string[], Record<string, string>?][] = [
  ["past migration is not a project", "We migrated to Microsoft 365 three years ago and everything is fine.", ["mention", "none"]],
  ["someone else's migration", "Their old vendor handled the migration. Happy with current provider.", ["dq", "mention", "none"]],
  ["migration already done", "The migration is already done internally.", ["mention", "none"]],
  ["moving offices is not moving to cloud", "They are moving to a new office next door. They use Azure for one test VM.", ["mention", "none"]],
  ["shift work is not lift and shift", "They run three shifts and use Azure AD for sign-in.", ["mention", "none"]],
  ["a passing Azure mention", "Our dev team spun up an Azure account once.", ["mention", "none"]],
  ["a data centre with no Azure", "We own our own data center and have no plans to change.", ["none", "mention", "dq"]],
  ["a VMware shop with no Azure", "They are a VMware shop.", ["none", "mention"]],
  ["a merger with no Microsoft anchor", "The company just went through a merger with a competitor.", ["none", "mention"]],
  ["building tenants are not M365 tenants", "Our building tenant improvements are finishing this month.", ["none", "mention"]],
  ["a driver license is not a Microsoft license", "Requires a commercial driver license for the role.", ["none", "mention"]],
  ["licensing their own software", "They license our software annually.", ["none", "mention"]],
  ["hardening steel is not hardening security", "We do heat treating and case hardening of steel parts.", ["none", "mention"]],
  ["support ticket id", "Support Ticket ID: 4521", ["none"]],
  ["a version number is not a seat count", "We need support on upgrade from our current version which is 15.", ["none", "mention"]],
  ["CRM opportunity notes still DQ", "Nicole Vargas is the owner of this opportunity and Partner: SIS LLC. Interest in Purview to support SOC 2 preparation and improve overall security posture. Continued executive engagement will be key to advancing the sales cycle.", ["dq"]],
  ["CRM metadata only still DQ", "F1 / Company Tenant Partner", ["dq"], { "Product Area": "Dynamics 365" }],
];
precision.forEach(([n, c, allowed, extra]) => {
  const { tier } = scan(c, extra);
  chk(n, allowed.includes(tier), `got ${tier}, allowed ${allowed.join("/")}`);
});

const total = quoting.length + redaction.length + capture.length + precision.length;
console.log(`\n${total - bad}/${total} passed`);
process.exit(bad ? 1 : 0);
