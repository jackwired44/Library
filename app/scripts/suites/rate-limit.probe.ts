import { rateLimitFrom, isRateLimitError } from "../../src/lib/apolloLive";
const JACK = `{ "message": "The maximum number of api calls allowed for api/v1/contacts/search is 2000 times per day. Please upgrade your plan", "error_details": { "code": "USAGE.RATE_LIMIT.API_RATE_LIMIT_EXCEEDED", "suggestions": [ { "label": "Wait 56815 seconds, then retry the request.", "retry_after_seconds": 56815 } ], "context": { "window": { "value": "day" } } } }`;
const cases: [string, unknown, string, number][] = [
  ["Jack's real daily refusal", { code: "tool_error", message: JACK }, "day", 56815],
  ["an hourly refusal", { code: "rate_limited", message: "Rate limit exceeded: 400 per hour" }, "hour", 3600],
  ["a bare 429 with nothing stated", { code: "rate_limited", message: "429 Too Many Requests" }, "hour", 3600],
  ["a per-minute refusal", { message: 'rate limit "value": "minute"' }, "minute", 60],
];
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? (pass++, console.log("  ok   " + n)) : (fail++, console.log(`  FAIL ${n} — ${d}`)); };
ok("the real daily refusal is recognised as a rate limit", isRateLimitError({ message: JACK }));
for (const [n, err, win, secs] of cases) {
  const r = rateLimitFrom(err);
  ok(`${n}: window`, r.window === win, `${r.window} != ${win}`);
  ok(`${n}: seconds`, r.seconds === secs, `${r.seconds} != ${secs}`);
}
ok("a daily wait is never reported as an hour", rateLimitFrom({ message: JACK }).seconds > 3600);
console.log(`\n${pass}/${pass + fail} checks passed`); if (fail) process.exit(1);
