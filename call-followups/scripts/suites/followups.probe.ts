import {
  parseTrellusNote, resolveRange, filterCalls, latestCallPerContact, toFollowUp, mergeFollowUp,
  findBannedPhrases, checkDraft, templateDraft, buildDraftPrompt, parseDraftJson, findOutcomeByName,
  hasDraftSource, openerLine, CLOSER_LINE, type ApolloCall, type CallOutcomeFacet,
} from "../../src/lib/followups";

let bad = 0;
const chk = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "  PASS" : "  FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

// Synthetic, shaped exactly like a real Trellus-logged Apollo call.
const SUMMARY = "Jack reached Dana, who is currently evaluating NetSuite and Microsoft Business Central to replace their legacy Dynamics SL 2018 and in-house systems. Dana is looking to improve inventory tracking and reporting. She requested a follow-up email and suggested reconnecting after her upcoming NetSuite demo and initial contact with Microsoft.";
const NOTE = `${SUMMARY}\nCalled +13125550100 (MOBILE). Recording: https://app.trellus.ai/transcripts?id=abc123def`;
const FACETS: CallOutcomeFacet[] = [
  { value: "o-info", display_name: "Info Requested ", count: 3 },
  { value: "o-na", display_name: "No Answer", count: 9 },
];
const call = (id: string, contact: string, iso: string, outcome = "o-info", user = "u-jack", note = NOTE): ApolloCall => ({
  id, user_id: user, contact_id: contact, phone_call_outcome_id: outcome, start_time: iso, note_text: note, caller_name: "Jack",
  contact: { id: contact, first_name: "Dana", last_name: "Reed", name: "Dana Reed", title: "Controller", organization_name: "Acme Mfg", email: "dana@acmemfg.com", time_zone: "America/Chicago", typed_custom_fields: { "68abe2198cb839001d7d67c3": "Wants Business Central (40 users)." } },
});

console.log("\nNote parsing");
const p = parseTrellusNote(NOTE);
chk("summary keeps the conversation", p.summary === SUMMARY, p.summary);
chk("pulls the Trellus link", p.trellusUrl === "https://app.trellus.ai/transcripts?id=abc123def", String(p.trellusUrl));
const linkOnly = parseTrellusNote("Called +12699213467 (WORK). Recording: https://app.trellus.ai/transcripts?id=zzz");
chk("link-only note has no summary", linkOnly.summary === "", linkOnly.summary);
chk("link-only note still has the link", !!linkOnly.trellusUrl);
chk("empty note is safe", parseTrellusNote(null).summary === "" && parseTrellusNote(null).trellusUrl === null);

console.log("\nDate ranges (process TZ = America/Chicago)");
const now = new Date(2026, 10, 23, 15, 0); // Mon Nov 23 2026, 3pm local
const last7 = resolveRange("last7", now)!;
chk("last 7 starts Nov 17 local midnight", new Date(last7.startMs).getDate() === 17 && new Date(last7.startMs).getHours() === 0);
chk("last 7 ends end of today", new Date(last7.endMs).getDate() === 23 && new Date(last7.endMs).getHours() === 23);
const custom = resolveRange("custom", now, "2026-11-05", "2026-11-12")!;
// 8pm Central on the 12th is 02:00Z on the 13th — must still be inside.
const evening = Date.parse("2026-11-13T02:00:00Z");
chk("custom range includes an 8pm call on its last day", evening >= custom.startMs && evening <= custom.endMs);
chk("custom range excludes the next morning", Date.parse("2026-11-13T15:00:00Z") > custom.endMs);
const reversed = resolveRange("custom", now, "2026-11-12", "2026-11-05")!;
chk("reversed custom dates are swapped, not empty", reversed.startMs === custom.startMs && reversed.endMs === custom.endMs);
chk("custom with no dates is null", resolveRange("custom", now) === null);
const y = resolveRange("yesterday", now)!;
chk("yesterday is the 22nd", new Date(y.startMs).getDate() === 22 && new Date(y.endMs).getDate() === 22);
const m = resolveRange("thisMonth", now)!;
chk("this month starts on the 1st", new Date(m.startMs).getDate() === 1);

console.log("\nSelecting calls");
const calls = [
  call("c1", "p1", "2026-11-23T20:42:00Z"),
  call("c2", "p1", "2026-11-20T15:00:00Z"),
  call("c3", "p2", "2026-11-21T15:00:00Z", "o-na"),
  call("c4", "p3", "2026-11-22T15:00:00Z", "o-info", "u-carly"),
  call("c5", "p4", "2026-11-10T15:00:00Z"),
];
chk("outcome resolved by trimmed name", findOutcomeByName(FACETS, "info requested")?.value === "o-info");
const picked = filterCalls(calls, { outcomeIds: ["o-info"], userId: "u-jack", range: last7 });
chk("filters by outcome, user and date", picked.map((c) => c.id).join() === "c1,c2", picked.map((c) => c.id).join());
const everyone = filterCalls(calls, { outcomeIds: ["o-info"], userId: null, range: last7 });
chk("Everyone includes other reps", everyone.some((c) => c.id === "c4"));
const anyOutcome = filterCalls(calls, { outcomeIds: [], userId: "u-jack", range: last7 });
chk("Any disposition includes No Answer", anyOutcome.some((c) => c.id === "c3"));
const grouped = latestCallPerContact(picked);
chk("one row per contact", grouped.length === 1);
chk("keeps the most recent call and counts both", grouped[0].call.id === "c1" && grouped[0].count === 2);

console.log("\nRecord + sticky merge");
const f = toFollowUp(grouped[0].call, grouped[0].count, FACETS);
chk("first name, company, email", f.firstName === "Dana" && f.company === "Acme Mfg" && f.email === "dana@acmemfg.com");
chk("disposition label trimmed", f.outcomeLabel === "Info Requested", f.outcomeLabel);
chk("lead note read from Jack's field", f.leadNote === "Wants Business Central (40 users).");
chk("new by default", f.status === "new");
const worked = { ...f, status: "drafted" as const, draftSubject: "x", draftBody: "y", pastedNotes: "z" };
const merged = mergeFollowUp(worked, { ...f, summary: "updated summary", callCount: 3 });
chk("refresh keeps status/draft/notes", merged.status === "drafted" && merged.draftBody === "y" && merged.pastedNotes === "z");
chk("refresh updates Apollo fields", merged.summary === "updated summary" && merged.callCount === 3);
const noSummary = toFollowUp(call("c9", "p9", "2026-11-23T15:00:00Z", "o-info", "u-jack", "Called +1312 555 0100 (WORK). Recording: https://app.trellus.ai/x"), 1, FACETS);
chk("link-only call has no draft source", !hasDraftSource(noSummary));
chk("pasted notes become the draft source", hasDraftSource({ ...noSummary, pastedNotes: "Wants pricing on BC" }));

console.log("\nBanned words");
chk("catches leverage + seamless", findBannedPhrases("We leverage a seamless setup").sort().join() === "leverage,seamless");
chk("catches em dash and !", findBannedPhrases("Great — thanks!").includes("em dash") && findBannedPhrases("Great!").includes("exclamation point"));
chk("whole words only (no hit inside 'gapsmith')", findBannedPhrases("the gapsmith family").length === 0);
chk("clean text passes", findBannedPhrases("Thanks for the time today. Sounds like reporting is the sticking point.").length === 0);

console.log("\nTemplate draft (Jack's structure)");
const t = templateDraft(f, "Jack");
const paras = t.body.split("\n\n");
chk("opens with 'Hi Dana, following up after our call.'", paras[0] === openerLine("Dana"), paras[0]);
chk("closes with the reach-out line", paras[paras.length - 1] === CLOSER_LINE, paras[paras.length - 1]);
chk("four paragraphs", paras.length === 4, String(paras.length));
chk("recap is in second person", /you're currently evaluating/i.test(t.body), t.body);
chk("no leftover third person", !/\b(She|Dana is|Jack reached)\b/.test(t.body), t.body);
chk("next steps mention the demo", /demo/i.test(paras[2]), paras[2]);
chk("doesn't say 'you asked for a follow-up email' inside the follow-up", !/follow-up email/i.test(t.body), t.body);
chk("subject is lowercase and specific", t.subject === "business central next steps", t.subject);
const tc = checkDraft(t.subject, t.body, f);
chk("template passes the checker", tc.problems.length === 0 && !tc.hasUrl, tc.problems.join(" | "));
console.log("\n--- template output ---\nSubject: " + t.subject + "\n\n" + t.body + "\n-----------------------");

console.log("\nAI prompt + parsing");
const prompt = buildDraftPrompt(f, "Jack");
chk("prompt carries the exact opener", prompt.includes("Hi Dana, following up after our call."));
chk("prompt carries the exact closer", prompt.includes(CLOSER_LINE));
chk("prompt carries the call notes", prompt.includes("Dynamics SL 2018"));
chk("prompt asks for JSON", /ONLY a JSON object/.test(prompt));
const pj = parseDraftJson('Sure: {"subject":"Business Central Next Steps","body":"Hi Dana, following up after our call.\\n\\nRecap.\\n\\nSteps.\\n\\n' + CLOSER_LINE + '"}');
chk("parses JSON wrapped in text, lowercases subject", !!pj && pj.subject === "business central next steps" && pj.body.split("\n\n").length === 4);
chk("rejects junk", parseDraftJson("no json here") === null);

const neil = checkDraft("x", "Hey, we can leverage https://x.com", f);
chk("checker flags banned word, link, missing name", neil.banned.includes("leverage") && neil.hasUrl && neil.problems.some((x) => /greet/.test(x)));

console.log(bad ? `\n${bad} FAILED` : "\nAll follow-up checks passed");
process.exit(bad ? 1 : 0);
