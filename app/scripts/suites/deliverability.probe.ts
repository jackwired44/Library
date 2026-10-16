// Email deliverability: Apollo's own verdict and a verifier's file combine
// into one lane per lead. Per Jack: catch-alls "hurt but the numbers are
// great … i need a middle ground" — so a catch-all is never dropped, only
// laned; and "recognized and green lighted in here".
import { laneOf, readVerifierFiles, normaliseStatus, normaliseScore, emailsToVerify, indexChecks, isGreenLit, type EmailCheck } from "../../src/lib/deliverability";
import { emailVerdictOf } from "../../src/lib/apolloLive";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : (fail++, console.log(`  FAIL ${n}${d ? " — " + d : ""}`)); };
const chk = (o: Partial<EmailCheck>): EmailCheck => ({ email: "a@x.com", domain: "x.com", status: "valid", score: null, raw: "", checkedAt: new Date().toISOString(), sourceFile: "f.csv", ...o });

// --- Apollo's verdict alone (the free live check)
ok("no email -> no-email", laneOf("", undefined) === "no-email");
ok("nothing known -> unverified", laneOf("a@x.com", undefined) === "unverified");
ok("Apollo verified, not catch-all -> send", laneOf("a@x.com", undefined, 70, { emailStatus: "verified", catchAll: false, catchAllVerdict: "allow" }) === "send");
ok("Apollo catch-all + allow -> green-lit catch-all lane", laneOf("a@x.com", undefined, 70, { emailStatus: "verified", catchAll: true, catchAllVerdict: "allow" }) === "catch-all-send");
ok("Apollo catch-all, screened -> call first, NOT dropped", laneOf("a@x.com", undefined, 70, { catchAll: true, catchAllVerdict: "deny" }) === "catch-all-call");
ok("Apollo unavailable -> bad email", laneOf("a@x.com", undefined, 70, { emailStatus: "unavailable" }) === "call-only");
ok("Apollo extrapolated/guessed -> still unverified", laneOf("a@x.com", undefined, 70, { emailStatus: "extrapolated" }) === "unverified");

// --- Personal addresses: Apollo flags them when adding to a sequence
ok("gmail -> personal", laneOf("jo@gmail.com", undefined) === "personal");
ok("a VERIFIED gmail is still personal, never green-lit", laneOf("jo@gmail.com", chk({ email: "jo@gmail.com", status: "valid" }), 70, { emailStatus: "verified" }) === "personal");
ok("Apollo free_domain flag -> personal", laneOf("jo@family-domain.net", undefined, 70, { freeDomain: true }) === "personal");
ok("personal is not green-lit", !isGreenLit("personal"));
ok("a bad personal address is still bad, not personal", laneOf("jo@gmail.com", chk({ email: "jo@gmail.com", status: "invalid" })) === "call-only");
ok("SendGrid: verdict column read as status", readVerifierFiles([{ name: "sg.csv", fields: ["email", "verdict", "score"], data: [{ email: "s@x.com", verdict: "Risky", score: "0.91" }] }]).checks[0]?.score === 91);

// --- A verifier on top
ok("verifier valid -> send", laneOf("a@x.com", chk({ status: "valid" })) === "send");
ok("verifier invalid beats Apollo verified", laneOf("a@x.com", chk({ status: "invalid" }), 70, { emailStatus: "verified" }) === "call-only");
ok("high-score catch-all lifts a screened one into the email lane", laneOf("a@x.com", chk({ status: "catch-all", score: 85 }), 70, { catchAll: true, catchAllVerdict: "deny" }) === "catch-all-send");
ok("low-score catch-all stays call-first", laneOf("a@x.com", chk({ status: "catch-all", score: 40 })) === "catch-all-call");
ok("the cutoff is adjustable", laneOf("a@x.com", chk({ status: "catch-all", score: 40 }), 30) === "catch-all-send");
ok("unscored catch-all is call-first, not green", laneOf("a@x.com", chk({ status: "catch-all", score: null })) === "catch-all-call");
ok("risky/unknown scored like a catch-all", laneOf("a@x.com", chk({ status: "unknown", score: 90 })) === "catch-all-send");
ok("green-lit lanes are exactly send + catch-all-send", isGreenLit("send") && isGreenLit("catch-all-send") && !isGreenLit("catch-all-call") && !isGreenLit("unverified"));

// --- Every verifier's vocabulary
ok("ZeroBounce catch-all", normaliseStatus("catch-all") === "catch-all");
ok("ZeroBounce do_not_mail -> invalid", normaliseStatus("do_not_mail", "role_based") === "invalid");
ok("ZeroBounce spamtrap -> invalid", normaliseStatus("spamtrap") === "invalid");
ok("Bouncer risky/accept_all -> catch-all (not plain risky)", normaliseStatus("risky", "accept_all") === "catch-all");
ok("Bouncer deliverable -> valid", normaliseStatus("deliverable", "accepted_email") === "valid");
ok("Bouncer undeliverable -> invalid", normaliseStatus("undeliverable", "rejected_email") === "invalid");
ok("NeverBounce catchall", normaliseStatus("catchall") === "catch-all");
ok("Kickbox risky without accept_all stays risky", normaliseStatus("risky", "low_quality") === "risky");
ok("unknown", normaliseStatus("unknown") === "unknown");
ok("blank -> null (row skipped)", normaliseStatus("", "") === null);
ok("score 0-100 kept", normaliseScore("87") === 87);
ok("Kickbox sendex 0-1 scaled", normaliseScore("0.62") === 62);
ok("percent sign tolerated", normaliseScore("45%") === 45);
ok("blank score -> null", normaliseScore("") === null);

// --- ZeroBounce's real results-file shape (original columns + ZB columns)
const zb = readVerifierFiles([{ name: "zb.csv", fields: ["Email", "First Name", "Company", "ZB Status", "ZB Sub Status", "ZB Free Email", "ZB Score"], data: [
  { Email: "Ana@Acme.com ", "First Name": "Ana", Company: "Acme", "ZB Status": "valid", "ZB Sub Status": "", "ZB Free Email": "false", "ZB Score": "9" },
  { Email: "bo@catch.io", "First Name": "Bo", Company: "Catch", "ZB Status": "catch-all", "ZB Sub Status": "", "ZB Free Email": "false", "ZB Score": "8" },
  { Email: "cy@gone.com", "First Name": "Cy", Company: "Gone", "ZB Status": "invalid", "ZB Sub Status": "mailbox_not_found", "ZB Free Email": "false", "ZB Score": "" },
  { Email: "", "First Name": "No", Company: "Email", "ZB Status": "valid", "ZB Sub Status": "", "ZB Free Email": "", "ZB Score": "" },
] }]);
ok("ZB: email column is the uploaded Email, not 'ZB Free Email'", zb.mapping.email === "Email", String(zb.mapping.email));
ok("ZB: status column found", zb.mapping.status === "ZB Status", String(zb.mapping.status));
ok("ZB: sub-status read as the reason", zb.mapping.reason === "ZB Sub Status", String(zb.mapping.reason));
ok("ZB: score column found", zb.mapping.score === "ZB Score", String(zb.mapping.score));
ok("ZB: 3 results, 1 blank-email row skipped", zb.checks.length === 3 && zb.skipped === 1);
ok("ZB: email normalised to lower case, trimmed", zb.checks.some((c) => c.email === "ana@acme.com"));
const zbCatch = zb.checks.find((c) => c.email === "bo@catch.io");
ok("ZB: 0-10 AI score read on its own scale (8 -> 80)", zbCatch?.score === 80, String(zbCatch?.score));
ok("ZB: so a ZB-8 catch-all is green-lit at the default cutoff", laneOf("bo@catch.io", zbCatch) === "catch-all-send");
ok("ZB: counts by status", zb.byStatus.valid === 1 && zb.byStatus["catch-all"] === 1 && zb.byStatus.invalid === 1);

// --- Bouncer's results-file shape
const bo = readVerifierFiles([{ name: "b.csv", fields: ["email", "status", "reason", "score"], data: [
  { email: "d@risk.com", status: "risky", reason: "accept_all", score: "78" },
] }]);
ok("Bouncer: accept_all row is a scored catch-all", bo.checks[0]?.status === "catch-all" && bo.checks[0]?.score === 78);

// --- Export: each address paid for once
const leads = [
  { email: "ana@acme.com", contact: "Ana A", company: "Acme" },
  { email: "ANA@acme.com", contact: "Ana A", company: "Acme" },
  { email: "new@x.com", contact: "New N", company: "X" },
  { email: "", contact: "No Email", company: "Y" },
];
const idx = indexChecks([chk({ email: "ana@acme.com" })]);
const due = emailsToVerify(leads, idx);
ok("export skips addresses with a fresh result, duplicates and blanks", due.length === 1 && due[0].email === "new@x.com", JSON.stringify(due));
const old = indexChecks([chk({ email: "ana@acme.com", checkedAt: "2026-01-01T00:00:00Z" })]);
ok("a result older than 90 days is due again", emailsToVerify(leads, old, Date.parse("2026-10-16")).length === 2);

// --- Apollo's per-address verdict, read off a real contact shape
const contact = {
  email: "support@x.com", email_status: "verified", email_domain_catchall: false, email_domain_catchall_verdict: "allow",
  contact_emails: [
    { email: "support@x.com", email_status: "verified", email_domain_catchall: false, email_domain_catchall_verdict: "allow" },
    { email: "alt@x.com", email_status: "unavailable", email_domain_catchall: true, email_domain_catchall_verdict: "deny" },
  ],
};
const v1 = emailVerdictOf(contact, "support@x.com");
ok("Apollo: verdict for the matching address", v1.emailStatus === "verified" && v1.catchAll === false && v1.catchAllVerdict === "allow");
const v2 = emailVerdictOf(contact, "ALT@x.com");
ok("Apollo: a second address on the contact reads its OWN verdict", v2.emailStatus === "unavailable" && v2.catchAll === true && v2.catchAllVerdict === "deny");
ok("Apollo: no fields -> nothing invented", JSON.stringify(emailVerdictOf({}, "a@b.com")) === "{}");

console.log(`deliverability ${fail ? "FAIL" : "PASS"} ${pass}/${pass + fail}`);
if (fail) process.exit(1);
