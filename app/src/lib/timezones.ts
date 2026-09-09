// Time zones — per Jack: "add a feature for time zones and can show the
// time zones according to company location also for the contact but also
// the local user using the platform."
//
// WHERE THE DATA COMES FROM, honestly: this app has no location field on a
// Contact or Company (no city/state/country column is captured from any
// CSV, and company enrichment is still unbuilt — see CLAUDE.md). The one
// real location signal every contact might carry is a PHONE NUMBER, and a
// North American area code maps to a time zone deterministically (with a
// handful of area codes that straddle a zone line — those pick the zone
// covering most of the area code and are always overridable by hand).
// So a contact's zone resolves in this order:
//   1. a manual `Contact.timeZone` override (set in the contact detail view)
//   2. derived from the work phone's area code, then the mobile's
//   3. unknown — shown as "—", never guessed from anything else
// A company's zone is the most common resolved zone among its contacts
// (lib/companies.ts). The local user's zone is whatever the browser
// reports (Intl), which is the real answer for "the person using this."
//
// Everything below is pure, dependency-free, and uses Intl for the actual
// clock math so DST is always right for the date in question.

export type TimeZoneSource = "manual" | "phone" | "unknown";

export interface ResolvedTimeZone {
  zone: string | null; // IANA id, e.g. "America/Chicago"
  source: TimeZoneSource;
}

// Zone -> NANP area codes. Grouped so it's auditable at a glance.
const ZONE_AREA_CODES: Record<string, number[]> = {
  "America/New_York": [
    // CT, DE, DC, ME, MD, MA, NH, NJ, NY, PA, RI, VT, WV
    203, 475, 860, 959, 302, 202, 207, 240, 301, 410, 443, 667, 339, 351, 413, 508, 617, 774, 781, 857, 978, 603,
    201, 551, 609, 640, 732, 848, 856, 862, 908, 973, 212, 315, 332, 347, 516, 518, 585, 607, 631, 646, 680, 716, 718,
    838, 845, 914, 917, 929, 934, 215, 223, 267, 272, 412, 445, 484, 570, 610, 717, 724, 814, 878, 401, 802, 304, 681,
    // FL (peninsula), GA, IN (most), KY (east), MI, NC, OH, SC, TN (east), VA
    239, 305, 321, 352, 386, 407, 561, 689, 727, 754, 772, 786, 813, 863, 904, 941, 954,
    229, 404, 470, 478, 678, 706, 762, 770, 912, 943,
    260, 317, 463, 574, 765, 812, 930,
    502, 606, 859,
    231, 248, 269, 313, 517, 586, 616, 679, 734, 810, 906, 947, 989,
    252, 336, 704, 743, 828, 910, 919, 980, 984,
    216, 220, 234, 283, 326, 330, 380, 419, 440, 513, 567, 614, 740, 937,
    803, 839, 843, 854, 864,
    423, 865,
    276, 434, 540, 571, 703, 757, 804, 826, 948,
    // Canada: Ontario, Quebec
    226, 249, 289, 343, 365, 416, 437, 519, 548, 613, 647, 705, 742, 807, 905,
    418, 438, 450, 514, 579, 581, 819, 873,
  ],
  "America/Chicago": [
    // AL, AR, IL, IA, KS, LA, MN, MS, MO, NE, ND, OK, SD, TN (central), TX, WI, FL panhandle, IN (NW), KY (west)
    205, 251, 256, 334, 659, 938, 479, 501, 870,
    217, 224, 309, 312, 331, 464, 618, 630, 708, 773, 779, 815, 847, 872,
    319, 515, 563, 641, 712, 316, 620, 785, 913, 225, 318, 337, 504, 985,
    218, 320, 507, 612, 651, 763, 952, 228, 601, 662, 769,
    314, 417, 557, 573, 636, 660, 816, 975, 308, 402, 531, 701,
    405, 539, 572, 580, 918, 605, 615, 629, 731, 901, 931,
    210, 214, 254, 281, 325, 346, 361, 409, 430, 432, 469, 512, 682, 713, 726, 737, 806, 817, 830, 832, 903, 936, 940,
    945, 956, 972, 979,
    262, 274, 414, 534, 608, 715, 920, 850, 219, 270, 364,
    // Canada: Manitoba
    204, 431,
  ],
  // Saskatchewan stays on standard time year-round.
  "America/Regina": [306, 639],
  "America/Denver": [
    // CO, ID, MT, NM, UT, WY, TX (El Paso)
    303, 719, 720, 970, 983, 208, 986, 406, 505, 575, 385, 435, 801, 307, 915,
    // Canada: Alberta
    403, 587, 780, 825,
  ],
  // Arizona doesn't observe DST.
  "America/Phoenix": [480, 520, 602, 623, 928],
  "America/Los_Angeles": [
    // CA, NV, OR, WA
    209, 213, 279, 310, 323, 341, 350, 369, 408, 415, 424, 442, 510, 530, 559, 562, 619, 626, 628, 650, 657, 661, 669,
    707, 714, 747, 760, 805, 818, 820, 831, 840, 858, 909, 916, 925, 949, 951,
    702, 725, 775, 458, 503, 541, 971, 206, 253, 360, 425, 509, 564,
    // Canada: British Columbia
    236, 250, 604, 672, 778,
  ],
  "America/Anchorage": [907],
  "Pacific/Honolulu": [808],
  "America/Halifax": [506, 782, 902],
  "America/St_Johns": [709],
  "America/Whitehorse": [867],
};

const AREA_CODE_TO_ZONE: Record<string, string> = {};
Object.entries(ZONE_AREA_CODES).forEach(([zone, codes]) => {
  codes.forEach((c) => { AREA_CODE_TO_ZONE[String(c)] = zone; });
});

// Pulls a NANP area code out of any reasonably-formatted phone string:
// "(312) 555-0100", "312-555-0100", "+1 312 555 0100", "13125550100".
// Anything that isn't a 10-digit (or 1+10) North American number returns
// null — international numbers are simply "unknown", not guessed.
export function areaCodeOf(phone: string | undefined | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return digits.slice(0, 3);
}

export function timeZoneFromPhone(phone: string | undefined | null): string | null {
  const code = areaCodeOf(phone);
  return code ? AREA_CODE_TO_ZONE[code] || null : null;
}

// Resolution order documented at the top of this file.
export function resolveContactTimeZone(c: { timeZone?: string | null; workPhone?: string; mobilePhone?: string }): ResolvedTimeZone {
  if (c.timeZone) return { zone: c.timeZone, source: "manual" };
  const fromPhone = timeZoneFromPhone(c.workPhone) || timeZoneFromPhone(c.mobilePhone);
  if (fromPhone) return { zone: fromPhone, source: "phone" };
  return { zone: null, source: "unknown" };
}

// The most common zone among a set of contacts (ties broken by first
// seen). Null when none of them resolve.
export function mostCommonZone(zones: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  zones.forEach((z) => { if (z) counts.set(z, (counts.get(z) || 0) + 1); });
  let best: string | null = null;
  let bestCount = 0;
  counts.forEach((n, z) => { if (n > bestCount) { best = z; bestCount = n; } });
  return best;
}

// What the browser itself reports — follows the device, so it changes
// when you travel.
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Per Jack: be able to pick a zone and lock it, "in case someone's
// travelling or wanting to select it to a different" one. A locked zone
// pins what "you" means everywhere — the sidebar clock, which US row is
// highlighted, and every "+2h from you" offset on a contact — instead of
// silently following whatever machine you happen to open the app on.
//
// Deliberately localStorage, not the Profile record in IndexedDB, for one
// hard reason: localTimeZone() is called synchronously during render by
// several components, and IndexedDB is async — a profile-backed value
// would render wrong on first paint and then jump. It is also genuinely a
// per-device display preference, same class as the theme toggle.
export const LOCKED_TZ_KEY = "lockedTimeZone";

export function lockedTimeZone(): string | null {
  try {
    const raw = window.localStorage.getItem(LOCKED_TZ_KEY);
    // A zone saved by an older build, or an id this browser's ICU data
    // doesn't know, must not brick every clock in the app.
    return raw && isValidZone(raw) ? raw : null;
  } catch {
    return null;
  }
}

// null clears the lock and goes back to following the device.
export function setLockedTimeZone(zone: string | null): void {
  try {
    if (zone && isValidZone(zone)) window.localStorage.setItem(LOCKED_TZ_KEY, zone);
    else window.localStorage.removeItem(LOCKED_TZ_KEY);
  } catch {
    /* private mode / storage disabled — the lock just doesn't persist */
  }
}

// The person using the platform: their locked choice if they made one,
// otherwise whatever this device reports.
export function localTimeZone(): string {
  return lockedTimeZone() || browserTimeZone();
}

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// "2:45 PM"
export function formatTimeInZone(zone: string, now: Date = new Date()): string {
  if (!isValidZone(zone)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(now);
}

// "CDT", "PST", "GMT+1" — the short name for the date in question, so DST
// is always right.
export function zoneAbbrev(zone: string, now: Date = new Date()): string {
  if (!isValidZone(zone)) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(now);
  return parts.find((p) => p.type === "timeZoneName")?.value || "";
}

// Offset from UTC in minutes for a zone at a given instant.
export function zoneOffsetMinutes(zone: string, now: Date = new Date()): number {
  if (!isValidZone(zone)) return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUTC - now.getTime()) / 60000);
}

// "+2h from you", "-1h from you", "same as you" — the difference between a
// contact's zone and the local user's, at this moment.
export function offsetFromLocalLabel(zone: string, now: Date = new Date(), local: string = localTimeZone()): string {
  const diff = (zoneOffsetMinutes(zone, now) - zoneOffsetMinutes(local, now)) / 60;
  if (diff === 0) return "same as you";
  const sign = diff > 0 ? "+" : "−";
  const abs = Math.abs(diff);
  const h = Number.isInteger(abs) ? `${abs}h` : `${abs}h`;
  return `${sign}${h} from you`;
}

// Hour of day (0-23) in a zone right now.
export function hourInZone(zone: string, now: Date = new Date()): number {
  if (!isValidZone(zone)) return now.getHours();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", hour: "2-digit" }).formatToParts(now);
  return Number(parts.find((p) => p.type === "hour")?.value || 0);
}

function weekdayInZone(zone: string, now: Date = new Date()): number {
  if (!isValidZone(zone)) return now.getDay();
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(now);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

// The reason to show a time zone at all on an outbound platform: is it a
// sane time to dial? Weekday, 8:00–17:59 in THEIR zone.
export function isBusinessHours(zone: string, now: Date = new Date()): boolean {
  const day = weekdayInZone(zone, now);
  if (day === 0 || day === 6) return false;
  const h = hourInZone(zone, now);
  return h >= 8 && h < 18;
}

// Human label for a zone id, e.g. "Central (Chicago)". Falls back to the
// raw id for anything not in the picker list.
export const TIME_ZONE_CHOICES: { zone: string; label: string }[] = [
  { zone: "America/New_York", label: "Eastern (New York)" },
  { zone: "America/Chicago", label: "Central (Chicago)" },
  { zone: "America/Denver", label: "Mountain (Denver)" },
  { zone: "America/Phoenix", label: "Arizona (no DST)" },
  { zone: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { zone: "America/Anchorage", label: "Alaska" },
  { zone: "Pacific/Honolulu", label: "Hawaii" },
  { zone: "America/Halifax", label: "Atlantic (Halifax)" },
  { zone: "America/St_Johns", label: "Newfoundland" },
  { zone: "America/Regina", label: "Saskatchewan (no DST)" },
  { zone: "America/Whitehorse", label: "Yukon" },
  { zone: "America/Mexico_City", label: "Mexico City" },
  { zone: "America/Sao_Paulo", label: "São Paulo" },
  { zone: "Europe/London", label: "London" },
  { zone: "Europe/Paris", label: "Central Europe (Paris/Berlin)" },
  { zone: "Europe/Athens", label: "Eastern Europe (Athens)" },
  { zone: "Asia/Dubai", label: "Dubai" },
  { zone: "Asia/Kolkata", label: "India" },
  { zone: "Asia/Singapore", label: "Singapore" },
  { zone: "Asia/Tokyo", label: "Tokyo" },
  { zone: "Australia/Sydney", label: "Sydney" },
  { zone: "UTC", label: "UTC" },
];

export function zoneLabel(zone: string): string {
  return TIME_ZONE_CHOICES.find((c) => c.zone === zone)?.label || zone.replace(/_/g, " ");
}

// HQ location -> zone, for a Company with an imported Apollo profile (lib/
// companyProfiles.ts). State/province is the deciding field; a country
// alone only resolves when it's a single-zone country. Anything else stays
// null rather than guessing — same rule as the phone path.
const US_STATE_ZONE: Record<string, string> = {
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York", GA: "America/New_York",
  IN: "America/New_York", KY: "America/New_York", ME: "America/New_York", MD: "America/New_York", MA: "America/New_York",
  MI: "America/New_York", NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York", NC: "America/New_York",
  OH: "America/New_York", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", VT: "America/New_York",
  VA: "America/New_York", WV: "America/New_York",
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", IA: "America/Chicago", KS: "America/Chicago",
  LA: "America/Chicago", MN: "America/Chicago", MS: "America/Chicago", MO: "America/Chicago", NE: "America/Chicago",
  ND: "America/Chicago", OK: "America/Chicago", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago",
  WI: "America/Chicago",
  CO: "America/Denver", ID: "America/Denver", MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
  AZ: "America/Phoenix",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles",
  AK: "America/Anchorage", HI: "Pacific/Honolulu",
  // Canadian provinces
  ON: "America/New_York", QC: "America/New_York", MB: "America/Chicago", SK: "America/Regina", AB: "America/Denver",
  BC: "America/Los_Angeles", NS: "America/Halifax", NB: "America/Halifax", PE: "America/Halifax", NL: "America/St_Johns",
  YT: "America/Whitehorse",
};
const US_STATE_NAMES: Record<string, string> = {
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", indiana: "IN", kentucky: "KY",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", "new hampshire": "NH", "new jersey": "NJ", "new york": "NY",
  "north carolina": "NC", ohio: "OH", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", vermont: "VT",
  virginia: "VA", "west virginia": "WV", alabama: "AL", arkansas: "AR", illinois: "IL", iowa: "IA", kansas: "KS",
  louisiana: "LA", minnesota: "MN", mississippi: "MS", missouri: "MO", nebraska: "NE", "north dakota": "ND", oklahoma: "OK",
  "south dakota": "SD", tennessee: "TN", texas: "TX", wisconsin: "WI", colorado: "CO", idaho: "ID", montana: "MT",
  "new mexico": "NM", utah: "UT", wyoming: "WY", arizona: "AZ", california: "CA", nevada: "NV", oregon: "OR",
  washington: "WA", alaska: "AK", hawaii: "HI", ontario: "ON", quebec: "QC", québec: "QC", manitoba: "MB",
  saskatchewan: "SK", alberta: "AB", "british columbia": "BC", "nova scotia": "NS", "new brunswick": "NB",
  "prince edward island": "PE", "newfoundland and labrador": "NL", yukon: "YT",
};
const SINGLE_ZONE_COUNTRIES: Record<string, string> = {
  "united kingdom": "Europe/London", uk: "Europe/London", england: "Europe/London", ireland: "Europe/Dublin",
  france: "Europe/Paris", germany: "Europe/Berlin", netherlands: "Europe/Amsterdam", belgium: "Europe/Brussels",
  spain: "Europe/Madrid", italy: "Europe/Rome", switzerland: "Europe/Zurich", austria: "Europe/Vienna",
  sweden: "Europe/Stockholm", norway: "Europe/Oslo", denmark: "Europe/Copenhagen", poland: "Europe/Warsaw",
  india: "Asia/Kolkata", singapore: "Asia/Singapore", japan: "Asia/Tokyo", "united arab emirates": "Asia/Dubai",
  israel: "Asia/Jerusalem", "south africa": "Africa/Johannesburg", "new zealand": "Pacific/Auckland",
};

export function timeZoneFromLocation(state?: string | null, country?: string | null): string | null {
  const st = (state || "").trim();
  if (st) {
    const abbr = st.length === 2 ? st.toUpperCase() : US_STATE_NAMES[st.toLowerCase()];
    if (abbr && US_STATE_ZONE[abbr]) return US_STATE_ZONE[abbr];
  }
  const co = (country || "").trim().toLowerCase();
  if (co && SINGLE_ZONE_COUNTRIES[co]) return SINGLE_ZONE_COUNTRIES[co];
  return null;
}
