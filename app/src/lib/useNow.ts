// A shared "current time" that re-renders on a fixed tick, so every local-
// time display in the app (contact rows, company cards, the account
// panel's own clock) advances in lockstep instead of each running its own
// interval. Default tick is 30s — a minute-precision clock never lags
// more than half a minute, and that's cheap enough to leave running.
import { useEffect, useState } from "react";

export function useNow(tickMs: number = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);
  return now;
}
