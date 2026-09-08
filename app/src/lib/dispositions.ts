// Custom call dispositions — per Jack: "lets start building out a
// disposition section i can manully add new ones for caling and remove
// them and make sure it can be filtered through in a check box way."
//
// The built-in dispositions (lib/detection.ts's DISPOSITION_META) carry
// real behavior: "not-interested" auto-crosses a row out, "meeting-booked"
// tints the row and stamps BOOKED, "do-not-contact" blocks future sequence
// enrollment, and ANY disposition marked connected finishes a contact's
// active enrollments.
//
// A custom disposition added here is a label, a colour, and one real
// choice: whether it counts as having REACHED the person. That flag is the
// only behavior a custom carries, and it's the same flag the built-ins
// use, so a custom "Connected - callback next quarter" stops a cadence
// exactly like a built-in would. It never crosses a row out or stamps
// anything; that stays built-in only, and the manager UI says so.
// A custom saved before the flag existed reads as not-connected, which is
// the safe default — it can't silently start ending sequences.
//
// A custom disposition's id doubles as a human-readable slug of its label
// ("custom:left-voicemail"), so a lead still stamped with a disposition
// that was later deleted renders as "Left voicemail" rather than a dead
// id — same "don't orphan already-filed data" rule the rest of this app
// follows (see CLAUDE.md).
import { dbGetAll, dbPut, dbDelete, STORE_DISPOSITIONS } from "./db";
import {
  DISPOSITION_META,
  DISPOSITION_ORDER,
  isBuiltInDisposition,
  type Disposition,
  type DispositionGroup,
} from "./detection";

export interface CustomDisposition {
  id: string; // "custom:<slug>"
  label: string;
  color: string;
  bg: string;
  createdAt: string;
  // Whether this outcome means the rep actually reached the person.
  // Optional so a custom saved before this existed still loads; absent
  // reads as false everywhere, which is the safe default (see header).
  connected?: boolean;
}

export interface DispositionOption {
  key: Disposition;
  label: string;
  color: string;
  bg: string;
  custom: boolean;
  connected: boolean;
  group: DispositionGroup;
}

export const CUSTOM_PREFIX = "custom:";

// A small fixed palette so a new disposition always reads as a real chip
// without asking Jack to pick hex codes. Cycled by however many already
// exist, so consecutive adds don't collide.
const PALETTE: { color: string; bg: string }[] = [
  { color: "#3A4B8C", bg: "#EEF2FF" },
  { color: "#0F7A72", bg: "#DFF3F1" },
  { color: "#8A5A00", bg: "#FBF3E7" },
  { color: "#7A3E8C", bg: "#F4EAF7" },
  { color: "#0A66C2", bg: "#EAF3FC" },
  { color: "#2E6B4A", bg: "#E1F2E7" },
  { color: "#B5443B", bg: "#FBEAE8" },
];

export function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// "custom:left-voicemail" -> "Left voicemail". Used both for a live custom
// disposition with no stored record to hand (shouldn't happen) and for one
// that was deleted while leads still carry it.
function humanizeKey(key: string): string {
  const slug = key.startsWith(CUSTOM_PREFIX) ? key.slice(CUSTOM_PREFIX.length) : key;
  const words = slug.replace(/-/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
}

export async function loadDispositionsFromDB(): Promise<CustomDisposition[]> {
  const all = await dbGetAll<CustomDisposition>(STORE_DISPOSITIONS);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export async function persistDisposition(d: CustomDisposition) {
  await dbPut(STORE_DISPOSITIONS, d);
}
export async function deleteDispositionFromDB(id: string) {
  await dbDelete(STORE_DISPOSITIONS, id);
}

// Returns null for a blank label, or one that collides with a built-in or an
// existing custom disposition (checked on the slug, so "No Answer" can't be
// added alongside the built-in "No answer").
export function createCustomDisposition(
  label: string,
  existing: CustomDisposition[],
  connected = false
): CustomDisposition | null {
  const trimmed = label.trim();
  const slug = slugify(trimmed);
  if (!trimmed || !slug) return null;
  // Every built-in, INCLUDING the retired ones — DISPOSITION_ORDER omits
  // those, so without this a second chip literally reading "Other" could
  // be added alongside the legacy value, indistinguishable in any picker.
  const builtInSlugs = Object.keys(DISPOSITION_META).map((k) => slugify(DISPOSITION_META[k as keyof typeof DISPOSITION_META].label));
  if (builtInSlugs.includes(slug)) return null;
  if (existing.some((d) => d.id === `${CUSTOM_PREFIX}${slug}`)) return null;
  const palette = PALETTE[existing.length % PALETTE.length];
  return {
    id: `${CUSTOM_PREFIX}${slug}`,
    label: trimmed,
    color: palette.color,
    bg: palette.bg,
    createdAt: new Date().toISOString(),
    connected,
  };
}

// Every disposition a dropdown/filter should offer: the selectable
// built-ins in their fixed order, then customs in the order they were
// added. Retired built-ins are never included (see DISPOSITION_ORDER).
export function dispositionOptions(custom: CustomDisposition[]): DispositionOption[] {
  const builtIns: DispositionOption[] = DISPOSITION_ORDER.map((k) => ({
    key: k,
    label: DISPOSITION_META[k].label,
    color: DISPOSITION_META[k].color,
    bg: DISPOSITION_META[k].bg,
    custom: false,
    connected: DISPOSITION_META[k].connected,
    group: DISPOSITION_META[k].group,
  }));
  const customs: DispositionOption[] = custom.map((d) => ({
    key: d.id,
    label: d.label,
    color: d.color,
    bg: d.bg,
    custom: true,
    connected: Boolean(d.connected),
    group: (d.connected ? "reached" : "not-reached") as DispositionGroup,
  }));
  return [...builtIns, ...customs];
}

// The same options split into the two buckets Jack works in, for a grouped
// <select> or a two-section filter row. "none" is returned separately since
// it's the empty state, not an outcome.
export function groupedDispositionOptions(custom: CustomDisposition[]): {
  none: DispositionOption[];
  reached: DispositionOption[];
  notReached: DispositionOption[];
} {
  const all = dispositionOptions(custom);
  return {
    none: all.filter((o) => o.group === "none"),
    reached: all.filter((o) => o.group === "reached"),
    notReached: all.filter((o) => o.group === "not-reached"),
  };
}

// Did this disposition mean we actually reached the person? The single
// source of truth for the advancement rule — never hardcode a key list
// against this question anywhere else.
export function isConnectedDisposition(key: Disposition | undefined | null, custom: CustomDisposition[]): boolean {
  const k = (key || "none") as string;
  if (isBuiltInDisposition(k)) return DISPOSITION_META[k].connected;
  return Boolean(custom.find((d) => d.id === k)?.connected);
}

// Safe lookup for ANY disposition value, including one whose custom record
// was deleted — never returns undefined, so no call site can crash reading
// .label off a missing key (the whole reason DISPOSITION_META isn't indexed
// directly any more).
export function dispositionMetaFor(
  key: Disposition | undefined | null,
  custom: CustomDisposition[]
): { label: string; color: string; bg: string } {
  const k = (key || "none") as string;
  if (isBuiltInDisposition(k)) return DISPOSITION_META[k];
  const match = custom.find((d) => d.id === k);
  if (match) return { label: match.label, color: match.color, bg: match.bg };
  // Deleted (or otherwise unknown) — keep the lead readable rather than
  // showing a raw id or blowing up.
  return { label: `${humanizeKey(k)} (removed)`, color: "#9aa1ac", bg: "#F4F6F7" };
}
