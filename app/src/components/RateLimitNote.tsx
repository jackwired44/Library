// Shown when Apollo's hourly lookup cap stopped a check.
import { APOLLO_LOOKUPS_PER_HOUR, type CheckProgress } from "../lib/apolloLive";

export default function RateLimitNote({ progress }: { progress: CheckProgress | null }) {
  if (!progress?.rateLimitedAt) return null;
  const back = new Date(Date.parse(progress.rateLimitedAt) + 60 * 60 * 1000)
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <span style={{ color: "#8A5A00" }} aria-label="Apollo hourly limit">
      {" "}· Apollo allows {APOLLO_LOOKUPS_PER_HOUR} lookups an hour, so it paused here. Everything read is saved;
      run it again after about {back} and it picks up where it stopped.
    </span>
  );
}
