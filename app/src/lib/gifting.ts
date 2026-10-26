// Gifting — record keeping for lunches, treats and appreciation sent to
// clients and prospects. Per Jack: "a folder for sending clients and
// prospects treats, lunch and treats based on their location, personalized
// to their company and the individuals we are communicating with — this is
// record keeping, preferences and ideas."
//
// ONE RECORD PER COMPANY, keyed by the same normalized company name
// lib/companies.ts groups contacts by (normalizeCompanyKey), so a gifting
// record lines up with the Companies roll-up without a second matching
// rule that could drift. A record holds the delivery location, the gift
// policy, per-person preferences, a log of what was sent, and ideas.
//
// LOCATION IS ENTERED BY HAND. Nothing in this app carries a real street
// address — the closest is an imported Apollo HQ city/state (lib/
// companyProfiles.ts), used only to pre-fill city/state on a new record.
//
// A GIFT IS ALSO A TOUCH. When a logged gift names a contact, App.tsx also
// writes a "gift" OutreachAttempt for that person (lib/outreachAttempts.ts)
// and stores its id here as `attemptId`, so deleting the gift removes the
// touch too. A gift never sets a disposition — see createAttempt.
import { dbGetAll, dbPut, dbDelete, STORE_GIFTING } from "./db";
import { normalizeCompanyKey, type CompanyProfile } from "./companyProfiles";

export type GiftOccasion = "intro" | "thank-you" | "post-meeting" | "holiday" | "milestone" | "just-because";
export const GIFT_OCCASIONS: { key: GiftOccasion; label: string }[] = [
  { key: "intro", label: "Intro / first touch" },
  { key: "thank-you", label: "Thank-you" },
  { key: "post-meeting", label: "After a meeting" },
  { key: "holiday", label: "Holiday" },
  { key: "milestone", label: "Milestone / win" },
  { key: "just-because", label: "Just because" },
];

// Where the relationship stood when the gift went out. Recorded per gift,
// not per company, because the point of the log is to see what was sent at
// which stage and how it landed — a company moves through these over time.
export type RelationshipStage = "cold-prospect" | "engaged-prospect" | "meeting-held" | "proposal" | "new-client" | "existing-client";
export const RELATIONSHIP_STAGES: { key: RelationshipStage; label: string }[] = [
  { key: "cold-prospect", label: "Cold prospect" },
  { key: "engaged-prospect", label: "Engaged prospect" },
  { key: "meeting-held", label: "Meeting held" },
  { key: "proposal", label: "Proposal / negotiating" },
  { key: "new-client", label: "New client" },
  { key: "existing-client", label: "Existing client" },
];
export function stageLabel(stage: RelationshipStage | undefined): string {
  return RELATIONSHIP_STAGES.find((s) => s.key === stage)?.label || "Not recorded";
}

export type GiftResult = "pending" | "acknowledged" | "replied" | "meeting-booked" | "no-response";
// `tone` maps onto the shared .status-pill variants, so results follow the
// light/dark theme tokens rather than carrying their own hex colors.
export const GIFT_RESULTS: { key: GiftResult; label: string; tone: "neutral" | "success" | "info" | "warning" }[] = [
  { key: "pending", label: "Waiting to hear", tone: "neutral" },
  { key: "acknowledged", label: "Thanked us", tone: "success" },
  { key: "replied", label: "Started a conversation", tone: "info" },
  { key: "meeting-booked", label: "Meeting booked", tone: "info" },
  { key: "no-response", label: "No response", tone: "warning" },
];

export interface PersonPreference {
  id: string;
  // Linked to a real Contact when one exists; name is kept either way so
  // a receptionist or office manager who never came through a CSV still
  // has a place to live.
  contactId: string | null;
  name: string;
  role: string;
  // Optional — a preference profile saved before this field existed has none.
  phone?: string;
  favorites: string;
  dietary: string; // restrictions and allergies — shown prominently
  dislikes: string;
  coffeeOrder: string;
  notes: string;
}

export interface GiftEntry {
  id: string;
  date: string; // YYYY-MM-DD, local
  item: string;
  vendor: string;
  cost: number | null;
  occasion: GiftOccasion;
  // Optional so a gift logged before stages existed still loads; it reads
  // as "Not recorded" everywhere it's shown or exported.
  stage?: RelationshipStage;
  forContactId: string | null;
  forName: string; // "Whole office" when nobody specific
  result: GiftResult;
  note: string;
  attemptId: string | null;
}

export interface GiftIdea {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
}

export interface GiftPolicy {
  // A per-gift dollar ceiling. null = no limit recorded.
  limit: number | null;
  // The employer doesn't accept gifts at all (common in government and
  // regulated industries).
  noGifts: boolean;
  note: string;
}

export interface GiftAccount {
  key: string; // normalizeCompanyKey(companyName)
  companyName: string;
  address: string;
  city: string;
  state: string;
  deliveryNotes: string; // office hours, suite, who signs, parking, etc.
  headcount: string; // how many people to feed — free text ("~12", "8 in office Tue/Thu")
  policy: GiftPolicy;
  people: PersonPreference[];
  gifts: GiftEntry[];
  ideas: GiftIdea[];
  createdAt: string;
  updatedAt: string;
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function giftKeyFor(companyName: string): string {
  return normalizeCompanyKey(companyName);
}

export function createGiftAccount(companyName: string, profile?: CompanyProfile | null): GiftAccount | null {
  const name = companyName.trim();
  const key = giftKeyFor(name);
  if (!key) return null;
  const now = new Date().toISOString();
  return {
    key,
    companyName: name,
    address: "",
    city: profile?.city || "",
    state: profile?.state || "",
    deliveryNotes: "",
    headcount: "",
    policy: { limit: null, noGifts: false, note: "" },
    people: [],
    gifts: [],
    ideas: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createPerson(input: Partial<PersonPreference> & { name: string }): PersonPreference {
  return {
    id: newId("pref"),
    contactId: input.contactId ?? null,
    name: input.name.trim(),
    role: input.role?.trim() || "",
    phone: input.phone?.trim() || "",
    favorites: input.favorites?.trim() || "",
    dietary: input.dietary?.trim() || "",
    dislikes: input.dislikes?.trim() || "",
    coffeeOrder: input.coffeeOrder?.trim() || "",
    notes: input.notes?.trim() || "",
  };
}

export function createGift(input: Partial<GiftEntry> & { item: string; date: string }): GiftEntry {
  return {
    id: newId("gift"),
    date: input.date,
    item: input.item.trim(),
    vendor: input.vendor?.trim() || "",
    cost: input.cost ?? null,
    occasion: input.occasion || "just-because",
    stage: input.stage,
    forContactId: input.forContactId ?? null,
    forName: input.forName?.trim() || "Whole office",
    result: input.result || "pending",
    note: input.note?.trim() || "",
    attemptId: input.attemptId ?? null,
  };
}

export function createIdea(text: string): GiftIdea | null {
  const t = text.trim();
  if (!t) return null;
  return { id: newId("idea"), text: t, done: false, createdAt: new Date().toISOString() };
}

export function touch(account: GiftAccount): GiftAccount {
  return { ...account, updatedAt: new Date().toISOString() };
}

/* ------------------------------------------------------------------ */
/* Policy                                                               */
/* ------------------------------------------------------------------ */

// Why a gift of this cost would break the company's gift policy, or null
// when it wouldn't. A gift with no cost entered only trips the no-gifts
// rule — an unknown cost is never assumed to be over a limit.
export function policyViolation(policy: GiftPolicy, cost: number | null): string | null {
  if (policy.noGifts) return "This company's policy is no gifts.";
  if (policy.limit !== null && cost !== null && cost > policy.limit) {
    return `Over this company's $${formatMoney(policy.limit)} gift limit.`;
  }
  return null;
}

export function hasPolicy(policy: GiftPolicy): boolean {
  return policy.noGifts || policy.limit !== null;
}

export function policyLabel(policy: GiftPolicy): string {
  if (policy.noGifts) return "No gifts";
  if (policy.limit !== null) return `Limit $${formatMoney(policy.limit)}`;
  return "No policy recorded";
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

export function giftsNewestFirst(account: GiftAccount): GiftEntry[] {
  return [...account.gifts].sort((a, b) => b.date.localeCompare(a.date));
}

export function lastGift(account: GiftAccount): GiftEntry | null {
  return giftsNewestFirst(account)[0] || null;
}

// Sum of the costs that were actually entered. Gifts with no cost are
// counted separately by the caller rather than treated as $0.
export function totalSpent(account: GiftAccount): number {
  return account.gifts.reduce((sum, g) => sum + (g.cost ?? 0), 0);
}

export function spentThisYear(account: GiftAccount, year = new Date().getFullYear()): number {
  return account.gifts
    .filter((g) => g.date.startsWith(String(year)))
    .reduce((sum, g) => sum + (g.cost ?? 0), 0);
}

export function openIdeas(account: GiftAccount): GiftIdea[] {
  return account.ideas.filter((i) => !i.done);
}

// Every dietary restriction recorded for anyone at this company — shown at
// the top of the record so it can't be missed when ordering food.
export function dietaryFlags(account: GiftAccount): { name: string; dietary: string }[] {
  return account.people.filter((p) => p.dietary).map((p) => ({ name: p.name, dietary: p.dietary }));
}

export function locationLabel(account: GiftAccount): string {
  return [account.city, account.state].filter(Boolean).join(", ");
}

export function formatMoney(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// Parses a typed dollar amount ("$24.50", "25") into a number, or null for
// blank/unreadable input — never 0 for something that wasn't entered.
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

// The internal gift log as a spreadsheet: one row per gift across every
// company, newest first, with the delivery details alongside so the file
// stands on its own. A company with a record but nothing sent yet still
// gets one row (gift columns blank), so the file is a full account list
// too. Opens in Excel/Sheets for editing.
export const GIFT_LOG_COLUMNS = [
  "Company",
  "Date sent",
  "Gift",
  "Vendor",
  "Cost",
  "Occasion",
  "Relationship stage",
  "For",
  "How it landed",
  "Notes",
  "Delivery address",
  "City",
  "State",
  "Delivery notes",
  "Gift policy",
] as const;

export function giftLogRows(accounts: GiftAccount[]): Record<string, string>[] {
  const rows: { sortDate: string; row: Record<string, string> }[] = [];
  for (const a of accounts) {
    const base = {
      Company: a.companyName,
      "Delivery address": a.address,
      City: a.city,
      State: a.state,
      "Delivery notes": a.deliveryNotes,
      "Gift policy": hasPolicy(a.policy) ? policyLabel(a.policy) : "",
    };
    if (!a.gifts.length) {
      rows.push({ sortDate: "", row: { ...base } });
      continue;
    }
    for (const g of a.gifts) {
      rows.push({
        sortDate: g.date,
        row: {
          ...base,
          "Date sent": g.date,
          Gift: g.item,
          Vendor: g.vendor,
          Cost: g.cost === null ? "" : formatMoney(g.cost),
          Occasion: GIFT_OCCASIONS.find((o) => o.key === g.occasion)?.label || g.occasion,
          "Relationship stage": g.stage ? stageLabel(g.stage) : "",
          For: g.forName,
          "How it landed": GIFT_RESULTS.find((r) => r.key === g.result)?.label || g.result,
          Notes: g.note,
        },
      });
    }
  }
  return rows
    .sort((x, y) => y.sortDate.localeCompare(x.sortDate) || x.row.Company.localeCompare(y.row.Company))
    .map((r) => r.row);
}

/* ------------------------------------------------------------------ */
/* Persistence                                                          */
/* ------------------------------------------------------------------ */
export async function loadGiftAccountsFromDB(): Promise<GiftAccount[]> {
  return dbGetAll<GiftAccount>(STORE_GIFTING);
}
export async function persistGiftAccount(a: GiftAccount) {
  await dbPut(STORE_GIFTING, a);
}
export async function deleteGiftAccountFromDB(key: string) {
  await dbDelete(STORE_GIFTING, key);
}
