// The platform's clock is Central time. Per Jack: "platform should state
// date and time so the scanner is aware" — "cst time". Every visible "now"
// (the header clock, a scan's stamp) and every "has this date passed yet?"
// question the scanner asks reads from here, so they always agree.
export const PLATFORM_TZ = "America/Chicago";

function parts(d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: PLATFORM_TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** "Fri, Oct 16, 2026 · 6:05 PM CDT" */
export function formatCentral(d: Date = new Date()): string {
  const date = new Intl.DateTimeFormat("en-US", { timeZone: PLATFORM_TZ, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: PLATFORM_TZ, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
  return `${date} · ${time}`;
}

/** Today's date in Central as a local-calendar Date at midnight — what a
 *  "MM/DD/YYYY" read out of a note is compared against. A date that is
 *  today in Central still counts as ahead, wherever the browser is. */
export function centralToday(now: Date = new Date()): Date {
  const p = parts(now);
  return new Date(Number(p.year), Number(p.month) - 1, Number(p.day));
}
