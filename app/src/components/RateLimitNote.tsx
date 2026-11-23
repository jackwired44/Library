// Shown when an Apollo lookup cap stopped a check.
//
// Per Jack, 11/22, pasting the real refusal: Apollo has a DAILY cap of
// 2,000 contact searches as well as the measured 400 an hour, and it came
// back "retry_after_seconds: 56815" — nearly 16 hours. This note used to
// say "run it again in about an hour" whatever the refusal was, so after a
// daily cap it sent him straight back into the same wall. It now reports
// the window Apollo named and the time Apollo gave.
import { APOLLO_LOOKUPS_PER_HOUR, type CheckProgress } from "../lib/apolloLive";

const APOLLO_LOOKUPS_PER_DAY = 2000;

/** "16 hours", "45 minutes" — the wait, in the unit a person would say it in. */
function spell(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  const mins = Math.round(seconds / 60);
  if (mins < 90) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export default function RateLimitNote({ progress }: { progress: CheckProgress | null }) {
  if (!progress?.rateLimitedAt) return null;
  const win = progress.rateLimitWindow ?? "hour";
  const secs = progress.rateLimitRetrySec ?? (win === "day" ? 24 * 3600 : 3600);
  const at = new Date(Date.parse(progress.rateLimitedAt) + secs * 1000);
  const sameDay = at.toDateString() === new Date(Date.parse(progress.rateLimitedAt)).toDateString();
  const back = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    + (sameDay ? "" : ` on ${at.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`);
  const cap = win === "day"
    ? `Apollo's daily cap of ${APOLLO_LOOKUPS_PER_DAY.toLocaleString()} lookups`
    : win === "minute"
      ? "Apollo's per-minute cap"
      : `Apollo's cap of ${APOLLO_LOOKUPS_PER_HOUR} lookups an hour`;
  return (
    <span style={{ color: "#8A5A00" }} aria-label={`Apollo ${win} limit`}>
      {" "}· {cap} stopped it here. Everything read is saved, and the leads it
      did not reach stay unchecked. Apollo said to wait about {spell(secs)} —
      run it again after {back} and it picks up where it stopped.
    </span>
  );
}
