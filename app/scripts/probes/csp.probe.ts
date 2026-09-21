// CSP Scanner engine — a Microsoft CSP opportunity export scored 0–100 on
// partner lane, billing intent, recency, notes strength, deal value and
// reachability. Per Jack: no product line here; No Partner Assigned is the
// strongest indicator; annual new upfront is the best billing shape; and
// the strongest lead of all is asking for a partner + none assigned +
// annual upfront, pinned to the top.
import { parseCSVText } from "../../src/lib/csv";
import {
  scan2, profileColumns, emptyRuleSet, guessFieldMapping, guessNotesColumns, guessCampaignColumns,
  toApolloRow, SCANNER2_EXPORT_LABELS, CSP_EXPORT_LABELS, localDayKey, reconcileCspColumns,
  CSP_BUCKET_META, CSP_CURATION_META, CURATION_TO_BUCKET, BUCKET2_META, BUCKET2_ORDER, CURATION_META,
} from "../../src/lib/scanner2";
import {
  guessCspColumns, lastTouchFrom, daysBetween, classifyCsp, readCspLead, resolveCspRules,
  posturize, billingQuality, resellerNamedInNotes, labelledPhoneFrom, nextStepFrom,
  compareCspLeads, cspPartnerLabel, DEFAULT_CSP_RULES, DEFAULT_CSP_WEIGHTS, latestEntry, isDialable,
  companyFromNotes, companyDomainFromEmail, wantsPartnerStated, WANTS_PARTNER_LABEL,
} from "../../src/lib/cspRenewal";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d)); };

const R = resolveCspRules();
const today = localDayKey(new Date());
const plus = (n: number) => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() + n); return localDayKey(d); };
const mdy = (k: string) => { const [y, m, d] = k.split("-"); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };
const dMon = (k: string) => { const [, m, d] = k.split("-"); return `${Number(d)}/${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m) - 1]}`; };

console.log("=== dates recovered from seller notes ===");
ok("m/d/yy with a year wins", lastTouchFrom(`GD - 4/Sep - ${mdy(plus(-3))}: [GD] CS: no update`, today) === plus(-3));
ok("dd/Mon with no year resolves to the most recent past occurrence", lastTouchFrom(`MA - ${dMon(plus(-20))} - Next Steps`, today) === plus(-20));
ok("a dd/Mon that would be in the future means last year", (() => { const k = plus(30); const got = lastTouchFrom(`XX - ${dMon(k)} - note`, today); return !!got && got < today && got.slice(5) === k.slice(5); })());
ok("the NEWEST of several entries wins", lastTouchFrom(`A - ${dMon(plus(-40))} - old B - ${dMon(plus(-5))} - new`, today) === plus(-5));
ok("a malformed ancient date is ignored, not read as 600,000 days stale", lastTouchFrom("KB - 1/1/0007 - garbage " + `${dMon(plus(-10))} real`, today) === plus(-10));
ok("no date at all is null, never epoch", lastTouchFrom("no dates in here", today) === null);
ok("days between", daysBetween(plus(-30), today) === 30);

console.log("\n=== partner posture ===");
ok("NULL is unassigned", posturize("NULL") === "unassigned");
ok("blank is unassigned", posturize("") === "unassigned");
ok("No Partner Assigned is unassigned", posturize("No Partner Assigned") === "unassigned");
ok("non-existing MPN ID is unresolved", posturize("Partner with non-existing MPN ID 4518310") === "unresolved");
ok("Microsoft Corporation is direct", posturize("Microsoft Corporation") === "microsoft");
ok("CDW is a named partner", posturize("CDW Logistics LLC") === "named");
ok("a reseller in the notes is noticed", resellerNamedInNotes("Call w/SHI, E7 in jeopardy") === "SHI");
ok("no reseller in the notes is blank", resellerNamedInNotes("nothing here") === "");

console.log("\n=== billing quality ===");
ok("Annual New Upfront is rank 0", billingQuality("CSP | Annual New Upfront Billing") === 0);
ok("Annual Renewal Upfront is rank 1", billingQuality("CSP | Annual Renewal Upfront Billing") === 1);
ok("Annual New Monthly is rank 2", billingQuality("CSP | Annual New Monthly Billing") === 2);
ok("Annual Renewal Monthly is rank 3", billingQuality("CSP | Annual Renewal Monthly Billing") === 3);
ok("Monthly New is rank 4", billingQuality("CSP | Monthly New") === 4);
ok("an unknown programme ranks last, not guessed better", billingQuality("Something Else") === 4);

console.log("\n=== company never exports blank ===");
ok("a company stated in the notes is recovered", companyFromNotes("Customer TPID: 1 Company Name: SOFVARE Website: https://sofvare.com Main Phone Number: +1") === "SOFVARE", companyFromNotes("Customer TPID: 1 Company Name: SOFVARE Website: https://sofvare.com Main Phone Number: +1"));
ok("  a multi-word company survives", companyFromNotes("Company Name: New Leaf Publishing Group Website: x") === "New Leaf Publishing Group", companyFromNotes("Company Name: New Leaf Publishing Group Website: x"));
ok("  \"not discovered\" is not a company", companyFromNotes("Company Name: Not discovered") === "");
ok("a work email yields the company domain as a last resort", companyDomainFromEmail("kbentley@adriansteel.com") === "adriansteel.com");
ok("  a personal address does not", companyDomainFromEmail("someone@gmail.com") === "");
ok("  nor a malformed one", companyDomainFromEmail("nope") === "");

console.log("\n=== phones ===");
ok("a plain number is dialable", isDialable("312-555-0147"));
ok("an Excel-mangled number is NOT", !isDialable("5.25549E+11"));
ok("  nor with spaces around the E", !isDialable("5.25549 E+ 11"));
ok("a 6-digit extension is not a phone", !isDialable("x1234"));
ok("an international number is dialable", isDialable("+61 2 4646 1511"));
// A labelled number is still refused when it belongs to a partner rep —
// dialling a competitor's seller is worse than having no number.
ok("labelled phone is taken", labelledPhoneFrom("Business Phone: +1 832 545 5602") === "+1 832 545 5602");
ok("  but NOT when partner language sits right before it",
   labelledPhoneFrom("Connecting with partner Alex Padua, Business Phone: 760 930 6400") === "");
ok("  nor for a reseller AE", labelledPhoneFrom("Partner AE Fred Gingras work phone: 514 673 7553") === "");
ok("  a repeated-digit placeholder is not a phone", labelledPhoneFrom("Phone: 8888888888") === "");
ok("  an unlabelled run of digits is never taken", labelledPhoneFrom("ph# 7609306400") === "");

console.log("\n=== notes helpers ===");
ok("labelled phone is recovered", labelledPhoneFrom("Business Phone: +1 832 545 5602 Country: US") === "+1 832 545 5602");
ok("a bare 10-digit run is NOT taken as a phone", labelledPhoneFrom("Contact Id: 7-3GVZ4ZLMDO deal 3125550147 something") === "");
ok("a labelled number with too few digits is rejected", labelledPhoneFrom("Phone: 12345") === "");
ok("next step is pulled", /Tom to create the related opportunity/.test(nextStepFrom("Next Action: Tom to create the related opportunity and coordinate with Brandon.")));

console.log("\n=== columns ===");
const HEAD = ['customeridname','estimatedvalue','msp_forecastcomments','msp_licensingprogramname','msp_partneraccountidname','msp_rollupestrevenue','fullname','address1_telephone1','telephone1','mobilephone','emailaddress1','address1_country','campaignidname'];
const cols = guessCspColumns(HEAD);
ok("program -> msp_licensingprogramname", cols.program === "msp_licensingprogramname", String(cols.program));
ok("value -> estimatedvalue", cols.value === "estimatedvalue", String(cols.value));
ok("rollup -> msp_rollupestrevenue", cols.rollupValue === "msp_rollupestrevenue", String(cols.rollupValue));
ok("partner -> msp_partneraccountidname", cols.partner === "msp_partneraccountidname", String(cols.partner));
const rec = reconcileCspColumns({ partner: "Gone", value: "estimatedvalue" }, HEAD);
ok("a saved column that is gone is re-guessed", rec.partner === "msp_partneraccountidname");
ok("a saved column that is present is kept", rec.value === "estimatedvalue");

// Identity mapping on the REAL header list — the two bugs the real file exposed.
const idProf = profileColumns([parseCSVText("h.csv", [HEAD.join(","), HEAD.map((h) => h === "address1_telephone1" ? "" : "x").join(","), HEAD.map((h) => h === "address1_telephone1" ? "" : "y").join(",")].join("\n"))]);
ok("Notes -> msp_forecastcomments even when the content is short (header match, not the long-text fallback)", guessNotesColumns(idProf).includes("msp_forecastcomments"), JSON.stringify(guessNotesColumns(idProf)));
const idMap = guessFieldMapping(idProf);
ok("Company -> customeridname (not unmapped)", idMap.company === "customeridname", String(idMap.company));
ok("Work phone -> telephone1, NOT the near-empty address1_telephone1 that sits first in the file", idMap.phone === "telephone1", String(idMap.phone));
ok("Mobile -> mobilephone", idMap.mobilePhone === "mobilephone", String(idMap.mobilePhone));
ok("Email -> emailaddress1", idMap.email === "emailaddress1", String(idMap.email));
ok("Contact -> fullname", idMap.contact === "fullname", String(idMap.contact));

console.log("\n=== scoring ===");
const mk = (o: Partial<Record<string, string>>, notes = "", reach = { hasPhone: true, hasEmail: true }) => {
  const raw: Record<string, string> = { msp_licensingprogramname: "", estimatedvalue: "", msp_rollupestrevenue: "", msp_partneraccountidname: "", ...o };
  const lead = readCspLead(raw, cols, notes, today);
  const v = classifyCsp(lead, R, reach);
  lead.score = v.score; lead.breakdown = v.breakdown;
  return { lead, v };
};
const fresh = `MA - ${dMon(plus(-5))} - `;

const perfect = mk({ msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "45000", msp_partneraccountidname: "NULL" }, `${fresh}Customer is looking for a partner to handle licensing. Next Steps: intro call.`);
ok("★ wants partner + none assigned + annual upfront is flagged perfect", perfect.lead.perfect);
ok("  and is Strong Signal", perfect.v.bucket === "priority", perfect.v.why);
ok("  with a high score", perfect.v.score >= 80, String(perfect.v.score));
ok("  the note says so", /wants a partner, none assigned, annual upfront/.test(perfect.v.why), perfect.v.why);
ok("  breakdown leads with the pin", perfect.v.breakdown[0].startsWith("★"));

const strong = mk({ msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "120000", msp_partneraccountidname: "NULL" }, `${fresh}Quote sent, meeting set for next week. Next Steps: review pricing.`);
ok("open lane + annual upfront + fresh + moving is Strong", strong.v.bucket === "priority", strong.v.why);
ok("  but NOT perfect without the partner ask", !strong.lead.perfect);
ok("  perfect sorts above it even on a lower score", compareCspLeads(perfect.lead, strong.lead) < 0);

const held = mk({ msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "120000", msp_partneraccountidname: "CDW Logistics LLC" }, `${fresh}Quote sent, meeting set for next week. Next Steps: review pricing.`);
ok("a held deal scores lower than the same deal with an open lane", held.v.score < strong.v.score, `${held.v.score} vs ${strong.v.score}`);
ok("  lane is the biggest single factor", strong.v.score - held.v.score >= 15, String(strong.v.score - held.v.score));

const monthly = mk({ msp_licensingprogramname: "CSP | Monthly New", estimatedvalue: "120000", msp_partneraccountidname: "NULL" }, `${fresh}Quote sent, meeting set for next week.`);
ok("month-to-month scores below annual upfront, all else equal", monthly.v.score < strong.v.score, `${monthly.v.score} vs ${strong.v.score}`);

const conflict = mk({ msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "120000", msp_partneraccountidname: "NULL" }, `${fresh}Call w/SHI about the E5 move. Quote sent.`);
ok("column says open but notes name SHI -> conflict flagged", conflict.lead.partnerConflict === "SHI");
ok("  and it costs points", conflict.v.score < strong.v.score, `${conflict.v.score} vs ${strong.v.score}`);
ok("  and the partner label says so", /notes mention SHI/.test(cspPartnerLabel(conflict.lead)), cspPartnerLabel(conflict.lead));

console.log("\n=== every lead gets scored: dead language and staleness are penalties, weighed by position ===");
const alive = mk({ msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "500000", msp_partneraccountidname: "NULL" }, `${fresh}Quote sent, meeting set for next week.`);
const deadNow = mk({ msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "500000", msp_partneraccountidname: "NULL" }, `${fresh}Client No-Show. No response has been received. Marking as lost due to inactivity.`);
ok("dead language in the LATEST entry still gets a score", deadNow.v.score > 0, String(deadNow.v.score));
ok("  costs the full latest-entry penalty", alive.v.score - deadNow.v.score >= R.deadLatestPenalty - 3, `${alive.v.score} -> ${deadNow.v.score}`);
ok("  the breakdown shows the deduction", deadNow.v.breakdown.some((b) => /latest entry .*\u2212/.test(b)), deadNow.v.breakdown.join(" | "));
ok("  and the notes line flags it", /latest note: .*no-show/i.test(deadNow.v.why), deadNow.v.why);
ok("  it is not hard-stopped by default", deadNow.v.bucket !== "excluded" || deadNow.v.score < R.reviewAt, `${deadNow.v.bucket} ${deadNow.v.score}`);

const deadOld = mk({ msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "500000", msp_partneraccountidname: "NULL" },
  `${fresh}Meeting set for Thursday, quote requested. KBM - 9/Apr - Client No-Show. No response has been received. Marking as lost due to inactivity.`);
ok("a no-show in an OLDER entry is only a light discount", alive.v.score - deadOld.v.score <= R.deadOlderPenalty + 2 && deadOld.v.score < alive.v.score, `${alive.v.score} -> ${deadOld.v.score}`);
ok("  the lead is still High priority on its merits", deadOld.v.bucket === "priority", `${deadOld.v.bucket} ${deadOld.v.score}`);
ok("  deadInLatest is false", !deadOld.lead.deadInLatest);
ok("  the older entry is named as such", /older note: /.test(deadOld.v.why), deadOld.v.why);

const hard = classifyCsp(deadNow.lead, resolveCspRules({ hardStopDead: true }), { hasPhone: true, hasEmail: true });
ok("the hard-stop toggle still forces Low priority when wanted", hard.bucket === "excluded" && /hard stop/.test(hard.why), hard.why);
const legacy = resolveCspRules({ dqDead: true } as never);
ok("a rule set saved with the old dqDead:true keeps hard-stopping (no silent change)", legacy.hardStopDead === true);
ok("a fresh rule set does not hard-stop", resolveCspRules().hardStopDead === false);

const stale = mk({ msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "500000", msp_partneraccountidname: "NULL" }, `MA - ${mdy(plus(-400))} - looked promising once`);
ok("untouched 400 days is penalised, not binned", stale.v.score > 0 && stale.v.breakdown.some((b) => /untouched 400d.*\u2212/.test(b)), `${stale.v.score} ${stale.v.breakdown.join(" | ")}`);
// $500k, open lane, annual upfront: the merits are real, so 400 days of
// silence knocks it to Medium rather than out — exactly the "give every
// lead a chance" call. The stale deduction is visible in the breakdown.
ok("  and a big open deal lands Medium, not Low — the merits still count", stale.v.bucket === "review", `${stale.v.bucket} ${stale.v.score}`);
const staleSmall = mk({ msp_licensingprogramname: "CSP | Monthly New", estimatedvalue: "900", msp_partneraccountidname: "CDW" }, `MA - ${mdy(plus(-400))} - looked promising once`);
ok("  while a small, held, monthly one that old lands Low", staleSmall.v.bucket === "excluded", `${staleSmall.v.bucket} ${staleSmall.v.score}`);

const weak = mk({ msp_licensingprogramname: "CSP | Monthly New", estimatedvalue: "400", msp_partneraccountidname: "CDW" }, `MA - ${mdy(plus(-150))} - hello`, { hasPhone: false, hasEmail: true });
ok("monthly + held + old + tiny + no phone is a Bad lead on score", weak.v.bucket === "excluded", weak.v.why);
ok("  under the review line", weak.v.score < R.reviewAt, String(weak.v.score));

const mid = mk({ msp_licensingprogramname: "CSP | Annual New Monthly Billing", estimatedvalue: "8000", msp_partneraccountidname: "CDW" }, `${fresh}Next steps: follow up on pricing.`);
ok("a middling deal is Needs review", mid.v.bucket === "review", `${mid.v.score} ${mid.v.why}`);

const noPhone = mk({ msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "120000", msp_partneraccountidname: "NULL" }, `${fresh}Quote sent, meeting set.`, { hasPhone: false, hasEmail: true });
ok("no phone costs points but is not fatal", noPhone.v.score < strong.v.score && noPhone.v.bucket === "priority", String(noPhone.v.score));

const blankValue = mk({ msp_licensingprogramname: "CSP | Annual New Upfront Billing", msp_partneraccountidname: "NULL" }, `${fresh}Quote sent.`);
ok("a blank value scores zero on value, never guessed", blankValue.v.breakdown.every((b) => !/\$/.test(b)));

const empty = mk({}, "");
ok("an empty row is No signal", empty.v.bucket === "unmatched", empty.v.why);

// Weights are settings: turning lane off should collapse the open/held gap.
const R0 = resolveCspRules({ weights: { ...DEFAULT_CSP_WEIGHTS, lane: 0 } });
const a0 = classifyCsp(strong.lead, R0, { hasPhone: true, hasEmail: true }).score;
const b0 = classifyCsp(held.lead, R0, { hasPhone: true, hasEmail: true }).score;
ok("setting the lane weight to 0 removes the open/held gap", a0 === b0, `${a0} vs ${b0}`);
ok("defaults put lane above billing, per Jack", DEFAULT_CSP_WEIGHTS.lane > DEFAULT_CSP_WEIGHTS.billing);
ok("thresholds default 60 / 25", DEFAULT_CSP_RULES.strongAt === 60 && DEFAULT_CSP_RULES.reviewAt === 25);
ok("penalties default 35 latest / 10 older / 20 stale", DEFAULT_CSP_RULES.deadLatestPenalty === 35 && DEFAULT_CSP_RULES.deadOlderPenalty === 10 && DEFAULT_CSP_RULES.stalePenalty === 20);

console.log("\n=== latest entry ===");
ok("the newest entry is the first one", latestEntry("MA - 17/Aug - meeting set. KBM - 9/Apr - no-show.").trim().startsWith("MA - 17/Aug - meeting set."));
ok("  and stops before the second", !/no-show/.test(latestEntry("MA - 17/Aug - meeting set. KBM - 9/Apr - no-show.")));
ok("a note with no entry prefixes is its own latest entry", latestEntry("plain text no dates") === "plain text no dates");

console.log("\n=== end to end ===");
const esc = (x: string) => `"${x.replace(/"/g, '""')}"`;
const row = (o: Record<string, string>) => HEAD.map((h) => esc(o[h] ?? "")).join(",");
const csv = [HEAD.join(",")].concat([
  row({ customeridname: "ACME MANUFACTURING", estimatedvalue: "45000", msp_forecastcomments: `${fresh}Looking for a partner to take over licensing. Next Steps: intro call Monday.`, msp_licensingprogramname: "CSP | Annual New Upfront Billing", msp_partneraccountidname: "NULL", msp_rollupestrevenue: "45000", fullname: "Dana Reyes", telephone1: "312-555-0147", emailaddress1: "dana@acme.com", address1_country: "United States", campaignidname: "US~US~FY25~CMP~TUM~SRAIM514049" }),
  row({ customeridname: "HELD CO", estimatedvalue: "300000", msp_forecastcomments: `${fresh}Quote sent. Meeting set.`, msp_licensingprogramname: "CSP | Annual New Upfront Billing", msp_partneraccountidname: "CDW Logistics LLC", msp_rollupestrevenue: "300000", fullname: "Sam Vale", telephone1: "312-555-0148", emailaddress1: "sam@held.com", address1_country: "United States" }),
  row({ customeridname: "GHOST LLC", estimatedvalue: "80000", msp_forecastcomments: `${fresh}Client No-Show. No response has been received. Marking as lost.`, msp_licensingprogramname: "CSP | Monthly New", msp_partneraccountidname: "NULL", msp_rollupestrevenue: "80000", fullname: "Lee Park", telephone1: "", emailaddress1: "lee@ghost.com", address1_country: "United States" }),
  row({ customeridname: "NOTES PHONE INC", estimatedvalue: "20000", msp_forecastcomments: `${fresh}Contact Id: 7-3GVZ First Name: Ray Business Phone: +1 786 953 5229 wants to move to annual.`, msp_licensingprogramname: "CSP | Annual Renewal Upfront Billing", msp_partneraccountidname: "Microsoft Corporation", msp_rollupestrevenue: "20000", fullname: "Ray Diaz", telephone1: "NULL", mobilephone: "NULL", emailaddress1: "ray@notesphone.com", address1_country: "United States" }),
].map((r) => r)).join("\n");

const parsed = [parseCSVText("csp.csv", csv)];
const prof = profileColumns(parsed);
const rs = { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(prof), notesColumns: guessNotesColumns(prof), campaignColumns: guessCampaignColumns(prof) };
ok("a CSP rule set is created in csp mode", rs.mode === "csp" && rs.scanner === "csp");
const res = scan2(parsed, rs);
const rows = res.rows.map((r) => ({ r, e: toApolloRow(r) as Record<string, string> }));
ok("every row is read", res.rowsRead === 4, String(res.rowsRead));

const acme = rows.find(({ e }) => /ACME/.test(e["Company Name"]));
ok("the perfect lead is Strong Signal", acme?.r.bucket === "priority", acme?.r.snippet);
ok("  flagged perfect on the row", !!acme?.r.csp?.perfect);
ok("  Product Area carries the effective PRIORITY, not a product line", toApolloRow(acme!.r, CSP_BUCKET_META[acme!.r.bucket].label)["Product Area"] === "High priority");
ok("  and the partner posture is in Notes instead", /no partner assigned/i.test(acme?.e.Notes ?? ""), acme?.e.Notes);
ok("  with no override passed it still says something true (partner label)", acme?.e["Product Area"] === "Open — no partner assigned", acme?.e["Product Area"]);
ok("  contact + phone + email carry through", acme?.e["First Name"] === "Dana" && acme?.e["Last Name"] === "Reyes" && acme?.e.Email === "dana@acme.com" && acme?.e["Work Direct Phone"] === "312-555-0147");
ok("  Notes lead with the score", /^Score \d+/.test(acme?.e.Notes ?? ""), acme?.e.Notes);
ok("  Notes carry the value and billing", /\$45k/.test(acme?.e.Notes ?? "") && /annual new/i.test(acme?.e.Notes ?? ""), acme?.e.Notes);
const skuRow = mk({ msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "50000", msp_partneraccountidname: "NULL" }, `${fresh}Moving 225 users from E5 to E7, Copilot workshop next week.`);
ok("license SKUs the notes refer to are kept in the notes line", /licenses: .*E7/.test(skuRow.v.why) && /Copilot/.test(skuRow.v.why), skuRow.v.why);
ok("  but no Dynamics / M365 product line is assigned", !("productLine" in skuRow.lead));
ok("  receivedOn is the last seller touch, so the date filter works", acme?.r.receivedOn === plus(-5), String(acme?.r.receivedOn));

const heldRow = rows.find(({ e }) => /HELD CO/.test(e["Company Name"]));
ok("the held deal's Notes name the partner", /partner: CDW Logistics LLC/.test(heldRow?.e.Notes ?? ""), heldRow?.e.Notes);
ok("a manual Low override maps to the Low priority bucket", CURATION_TO_BUCKET.reject === "excluded" && CSP_BUCKET_META.excluded.label === "Low priority");
ok("perfect outranks the bigger held deal", compareCspLeads(acme?.r.csp, heldRow?.r.csp) < 0);

const ghost = rows.find(({ e }) => /GHOST/.test(e["Company Name"]));
ok("the ghosted deal carries a real score", (ghost?.r.csp?.score ?? -1) >= 0, String(ghost?.r.csp?.score));
ok("  and is Low priority after the penalty (monthly, no phone, no-show now)", ghost?.r.bucket === "excluded", `${ghost?.r.bucket} ${ghost?.r.csp?.score}`);

const np = rows.find(({ e }) => /NOTES PHONE/.test(e["Company Name"]));
ok("a phone labelled in the notes fills an empty phone column", np?.e["Work Direct Phone"] === "+1 786 953 5229", np?.e["Work Direct Phone"]);
ok("  Microsoft direct is named in its Notes", /Microsoft direct/.test(np?.e.Notes ?? ""), np?.e.Notes);

{
  // A subset file saved out of Excel that LOST the company column — this is
  // exactly what produced 0/44 blank companies in a real download.
  const H = HEAD.filter((h) => h !== "customeridname");
  const r2 = (o: Record<string, string>) => H.map((h) => esc(o[h] ?? "")).join(",");
  const c = [H.join(",")].concat([
    r2({ estimatedvalue: "45000", msp_forecastcomments: `${fresh}Looking for a partner. Next Steps: call.`, msp_licensingprogramname: "CSP | Annual New Upfront Billing", msp_partneraccountidname: "NULL", fullname: "Kevin Bentley", emailaddress1: "kbentley@adriansteel.com", telephone1: "18006772726" }),
  ]).join("\n");
  const pp = [parseCSVText("nocompany.csv", c)];
  const pr = profileColumns(pp);
  const rr = scan2(pp, { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(pr), notesColumns: guessNotesColumns(pr), campaignColumns: guessCampaignColumns(pr) });
  const e = toApolloRow(rr.rows[0]) as Record<string, string>;
  ok("with NO company column at all, company still exports", !!e["Company Name"], JSON.stringify(e["Company Name"]));
  ok("  falling back to the work-email domain", e["Company Name"] === "adriansteel.com", e["Company Name"]);
  ok("  and the rest of the row is intact", e["First Name"] === "Kevin" && e["Last Name"] === "Bentley" && e["Work Direct Phone"] === "18006772726");
}

console.log("\n=== priority vocabulary ===");
ok("buckets read High / Medium / Low / No signal in that order",
  BUCKET2_ORDER.map((b) => CSP_BUCKET_META[b].label).join("|") === "High priority|Medium priority|Low priority|No signal",
  BUCKET2_ORDER.map((b) => CSP_BUCKET_META[b].label).join("|"));
ok("curation reads High / Medium / Low", `${CSP_CURATION_META.keep.label}|${CSP_CURATION_META.maybe.label}|${CSP_CURATION_META.reject.label}` === "High|Medium|Low");
ok("each manual priority maps onto the matching bucket", CURATION_TO_BUCKET.keep === "priority" && CURATION_TO_BUCKET.maybe === "review" && CURATION_TO_BUCKET.reject === "excluded");
ok("the SMC vocabulary is untouched", BUCKET2_META.priority.label === "Strong Signal" && CURATION_META.keep.label !== "High");

ok("every dialable telephone1 reaches the export \u2014 nothing is silently dropped",
   rows.every(({ r, e }) => {
     const src = String((r.row as Record<string, string>).telephone1 ?? "").trim();
     return !src || !isDialable(src) || !!e["Work Direct Phone"];
   }));
ok("the SMC download keeps all ten Apollo columns", SCANNER2_EXPORT_LABELS.length === 10);
ok("the CSP download drops Title and Number of Employees \u2014 a CSP export states neither",
   CSP_EXPORT_LABELS.length === 8 && !(CSP_EXPORT_LABELS as readonly string[]).includes("Title") && !(CSP_EXPORT_LABELS as readonly string[]).includes("Number of Employees"),
   CSP_EXPORT_LABELS.join(","));
ok("  Product Area and Notes are still the last two columns", CSP_EXPORT_LABELS[6] === "Product Area" && CSP_EXPORT_LABELS[7] === "Notes");
ok("  toApolloRow still BUILDS all ten \u2014 the label list decides what is written",
   Object.keys(rows[0].e).length === 10);
ok("  a full name is split across First and Last", acme?.e["First Name"] === "Dana" && acme?.e["Last Name"] === "Reyes", `${acme?.e["First Name"]} | ${acme?.e["Last Name"]}`);
ok("no CSP row carries a product line", rows.every(({ r }) => !r.productLine));
ok("curated decisions are namespaced to the CSP tab", rows.every(({ r }) => !r.leadKey || r.leadKey.startsWith("csp:")));

console.log("\n=== dates: a sheet date beats the notes ===");
ok("this file has no date column, so the source is the notes", res.dateSource.kind === "notes", JSON.stringify(res.dateSource));
const HEAD2 = [...HEAD, "createdon"];
const row2 = (o: Record<string, string>) => HEAD2.map((h) => esc(o[h] ?? "")).join(",");
const csv2 = [HEAD2.join(",")].concat([
  row2({ customeridname: "DATED CO", estimatedvalue: "20000", msp_forecastcomments: `MA - ${dMon(plus(-5))} - Meeting set.`, msp_licensingprogramname: "CSP | Annual New Upfront Billing", msp_partneraccountidname: "NULL", fullname: "Al Day", emailaddress1: "al@dated.com", telephone1: "312-555-0199", createdon: `${mdy(plus(-40))} 10:15:00 AM` }),
]).join("\n");
const p2 = [parseCSVText("d.csv", csv2)];
const pr2 = profileColumns(p2);
const r2 = scan2(p2, { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(pr2), notesColumns: guessNotesColumns(pr2), campaignColumns: guessCampaignColumns(pr2) });
ok("a createdon column is recognised as the date source", r2.dateSource.kind === "column" && r2.dateSource.column === "createdon", JSON.stringify(r2.dateSource));
ok("  and the row's date is the SHEET date, not the newer note date", r2.rows[0].receivedOn === plus(-40), `${r2.rows[0].receivedOn} (note said ${plus(-5)})`);
ok("  while the score still uses the note's last touch for recency", r2.rows[0].csp?.ageDays === 5, String(r2.rows[0].csp?.ageDays));
for (const col of ["uploaddate", "dateadded", "leadcreatedon", "createdat"]) {
  const H = [...HEAD, col];
  const c = [H.join(","), H.map((h) => esc(h === col ? "2026-08-01" : h === "customeridname" ? "X" : h === "msp_licensingprogramname" ? "CSP | Monthly New" : "")).join(",")].join("\n");
  const pp = [parseCSVText("u.csv", c)];
  const rr = scan2(pp, { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(profileColumns(pp)), notesColumns: [], campaignColumns: [] });
  ok(`  "${col}" counts as an upload date`, rr.dateSource.kind === "column" && rr.rows[0]?.receivedOn === "2026-08-01", JSON.stringify(rr.dateSource));
}
{
  const H = [...HEAD, "estimatedclosedate"];
  const c = [H.join(","), H.map((h) => esc(h === "estimatedclosedate" ? "2026-12-01" : h === "customeridname" ? "X" : "")).join(",")].join("\n");
  const pp = [parseCSVText("c.csv", c)];
  const rr = scan2(pp, { ...emptyRuleSet("csp", "csp"), fields: guessFieldMapping(profileColumns(pp)), notesColumns: [], campaignColumns: [] });
  ok('  a close date is a forecast, NOT an upload date', rr.dateSource.kind !== "column", JSON.stringify(rr.dateSource));
}

const smcRs = emptyRuleSet("smc", "smc");
ok("an SMC rule set is still smc mode and carries no CSP rules", smcRs.mode === "smc" && smcRs.cspRules === undefined);

// ---------------------------------------------------------------- wants a
// partner: Jack's top-quality flag. "if it states wants a partner that
// needs to be flagged for top quality."
//
// The flag is only worth anything if it is TRUE. On Jack's real 9,265-row
// export the original pattern fired 961 times with 857 of those (89%) on
// rows that NAME a partner in the partner column. Three causes, and every
// case below is real text from that file.
console.log("\n== wants a partner: the top-quality flag ==");

// 1. Microsoft's own CRM template furniture. "Partner Recommendation" is a
//    form FIELD and "partner referral" is Microsoft's own workflow — 846 of
//    the 961 false fires between them.
for (const t of [
  "Partner: Not discovered \u2014 recommend initiating partner discovery/Partner Recommendation Partner POC: Not discovered",
  "Partner: Partner not discovered \u2014 recommend initiating partner discovery/Partner Recommendation.",
  "DAS ACC: Converted partner referral and added opportunity detail",
  "ACC - 12/Mar - DAS ACC: Partner referral follow up reviewal Updated hygiene",
  "Partner Contact: N/A PCM program: Open to partner introduction License Renewal: No renewal discussed",
  "Partner Summary Partner: Not discovered",
]) ok(`  template text is NOT a customer asking: "${t.slice(0, 44)}\u2026"`, !wantsPartnerStated(t));

// 2. Negations are the OPPOSITE signal and must never read as top quality.
for (const t of [
  "the organization sees limited value in paying a middleman. Customer indicated they do not want partner involvement",
  "the client mentioned that they do not need a partner for now",
  "Customer does not want a reseller to be the middle man, Aprox 250 users",
  "they have mature Azure deployments and do not currently need partner support for Azure",
  "Direct Partner: MS Direct (customer explicitly not seeking partner implementation)",
]) ok(`  a negation is NOT a want: "${t.slice(-42)}"`, !wantsPartnerStated(t));

// 3. Real customer statements must still land.
for (const t of [
  "OAP - 15/Jul - URGENT. LOOK FOR A PARTNER THAT FIT THEIR CURRENT NEEDS.",
  "met w longview -broke the news -brett wants a partner by next week",
  "JSR - 16/Jun - Cx not satisfied with MSP, looking for partner nomination in the coming meeting",
  "they are looking for a partner; they are out of support with AX2012",
  "Next Step: pending customer response. Looking for CSP partner rep for alignment on renewal.",
  "The customer is open to partner engagement and phased adoption.",
  "Wants partner contact within 24\u201348 hours. Estimated Close Date: Mid to late May 2026",
  "They already have CRM and need a partner for some further configuration and implementation",
  "are open to switching partners for ERP deployment, licensing, and support",
  "the customer requested a partner-led demo to better understand features, architecture, and costs",
]) ok(`  a real statement IS a want: "${t.slice(0, 46)}\u2026"`, wantsPartnerStated(t));

// 4. The window is bounded: a genuine ask in a long multi-entry blob is
//    still a want even when Microsoft's template appears elsewhere in it.
//    21 of the 109 real flagged rows are exactly this shape.
ok("  a genuine ask survives template text 400 chars away",
   wantsPartnerStated(`Partner Recommendation Partner POC: Not discovered. ${"x".repeat(400)} The customer is open to partner engagement and phased adoption.`));
ok("  but not template text right beside it",
   !wantsPartnerStated("Partner Contact: Not available PCM program: Open to partner introduction"));

// 5. It forces High priority regardless of score, per Jack.
const wp = mk(
  // Deliberately weak everywhere else: monthly billing, a named partner
  // holding it, no value stated. Score alone would never clear 60.
  { msp_licensingprogramname: "CSP | Monthly New", estimatedvalue: "", msp_partneraccountidname: "Some Reseller LLC" },
  `${fresh}The customer is looking for a partner to take over licensing.`,
);
ok("a stated want is flagged even with a named partner and monthly billing", wp.lead.wantsPartner);
ok("  it is forced to High priority", wp.v.bucket === "priority", `${wp.v.bucket} @ ${wp.v.score}`);
ok("  even though its score is under the High line", wp.v.score < R.strongAt, String(wp.v.score));
ok("  and the reason says TOP QUALITY", /TOP QUALITY/.test(wp.v.why), wp.v.why.slice(0, 90));
ok("  the breakdown explains the override", wp.lead.breakdown.some((b) => /top quality/i.test(b)), wp.lead.breakdown.join(" | "));

// A lead that does NOT state it is judged on score alone, as before.
const quiet = mk(
  { msp_licensingprogramname: "CSP | Monthly New", estimatedvalue: "", msp_partneraccountidname: "Some Reseller LLC" },
  `${fresh}Reviewed status. Partner Recommendation Partner POC: Not discovered.`,
);
ok("a row with only template text is NOT flagged", !quiet.lead.wantsPartner);
ok("  and stays out of High on its own merits", quiet.v.bucket !== "priority", `${quiet.v.bucket} @ ${quiet.v.score}`);

// 6. Ranking: the flag outranks a higher score that does not state it.
const higher = mk(
  { msp_licensingprogramname: "CSP | Annual New Upfront Billing", estimatedvalue: "250000", msp_partneraccountidname: "NULL" },
  `${fresh}Quote sent. Meeting set for Thursday. Next Steps: contract.`,
);
ok("  a higher-scoring lead that does not state it scores above", higher.v.score > wp.v.score, `${higher.v.score} vs ${wp.v.score}`);
ok("  ...yet the flagged lead still sorts first", compareCspLeads(wp.lead, higher.lead) < 0);
ok("  and the pinned lead still outranks the merely-flagged one", compareCspLeads(perfect.lead, wp.lead) < 0);

// 7. The motion label still drives the notes factor through the same guard,
//    so a false fire cannot inflate notes strength either.
ok("  the motion label is present on a real want", wp.lead.motion.includes(WANTS_PARTNER_LABEL));
ok("  and absent on template-only text", !quiet.lead.motion.includes(WANTS_PARTNER_LABEL));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
