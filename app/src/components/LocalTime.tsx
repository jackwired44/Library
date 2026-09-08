// A contact's/company's current local time as a small chip — "2:45 PM CDT"
// with a green dot when it's a sane hour to dial (weekday, 8–6 in THEIR
// zone) and a grey one when it isn't. Renders a muted "—" for an unknown
// zone rather than guessing. One shared component so the treatment can't
// drift between Contacts, Companies, Calls and the detail view. See
// lib/timezones.ts for where a zone actually comes from.
import { formatTimeInZone, isBusinessHours, offsetFromLocalLabel, zoneAbbrev, zoneLabel, type TimeZoneSource } from "../lib/timezones";

interface LocalTimeProps {
  zone: string | null;
  now: Date;
  source?: TimeZoneSource;
  // Compact = chip only; full adds the zone name and the offset from you.
  variant?: "compact" | "full";
}

const SOURCE_HINT: Record<TimeZoneSource, string> = {
  manual: "Time zone set by hand on this contact",
  phone: "Time zone derived from the phone number's area code — override it on the contact if it's wrong",
  unknown: "No time zone: no manual override and no North American phone number to read an area code from",
};

export default function LocalTime({ zone, now, source = "unknown", variant = "compact" }: LocalTimeProps) {
  if (!zone) {
    return (
      <span title={SOURCE_HINT.unknown} style={{ fontSize: 12, color: "var(--muted)" }}>
        —
      </span>
    );
  }
  const open = isBusinessHours(zone, now);
  const time = formatTimeInZone(zone, now);
  const abbrev = zoneAbbrev(zone, now);
  return (
    <span
      title={`${zoneLabel(zone)} · ${offsetFromLocalLabel(zone, now)} · ${open ? "within business hours there" : "outside business hours there"}\n${SOURCE_HINT[source]}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", fontSize: 12 }}
    >
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: 999, background: open ? "#2CC295" : "#c3cbd1", flexShrink: 0 }}
      />
      <span style={{ fontWeight: 600, color: "var(--ink)" }}>{time}</span>
      <span style={{ color: "var(--muted)", fontSize: 11 }}>{abbrev}</span>
      {variant === "full" && (
        <span style={{ color: "var(--muted)", fontSize: 11 }}>
          · {zoneLabel(zone)} · {offsetFromLocalLabel(zone, now)}
        </span>
      )}
    </span>
  );
}
