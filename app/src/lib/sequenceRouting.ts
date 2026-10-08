// Which Apollo sequence each stored lead is headed for.
//
// Per Jack: "this is the way i want to build so i can upload all new leads
// here and start pre storing them with the relevant seuqence to transition
// to into apollo to create as task to call and email."
//
// THE FLOW THIS SERVES:
//   upload -> scan -> qualification gate (leadQualify.ts) -> stored lead
//     -> ROUTED to a target sequence (this file) -> queued
//     -> exported as one Apollo import file per sequence -> "exported"
//     -> imported into Apollo and added to that sequence, where Apollo
//        itself generates the call and email tasks from the sequence steps.
//
// WHAT THIS DELIBERATELY DOES NOT DO: write into Apollo. Adding contacts to
// a live sequence through the API (apollo_contacts_bulk_create +
// apollo_emailer_campaigns_add_contact_ids) is possible, but every Apollo
// touchpoint in this app so far only ever reads, and pushing contacts into
// Jack's production sequences is his call to make separately. The export is
// a file; nothing leaves this browser on its own.
//
// A plan is NEVER overwritten by a rule. Once a lead has a target — set by a
// rule or by hand — only a person changes it, and an exported lead stays
// exported. Re-running the rules after editing them only fills leads that
// have no plan yet. That is what makes it safe to re-upload a file: a lead
// already queued, moved, or sent cannot be silently re-routed.
import { STORE_ROUTING, dbGetAll, dbPut } from "./db";
import type { StoredLead } from "./leadStore";
import type { SizeBand } from "./campaignExport";

export type PlanStatus = "queued" | "exported";

export interface SequencePlan {
  /** Apollo sequence NAME — the same key Campaigns and the sync use. */
  sequence: string;
  status: PlanStatus;
  assignedAt: string;
  /** Set when the lead went out in an export file. */
  exportedAt?: string;
  /** How it got this target. A rule-assigned lead and a hand-placed one
   *  read differently in the queue, so a wrong rule is easy to spot. */
  by: "rule" | "manual";
}

/* ------------------------------------------------------------ lead types */

/** What kind of lead this is, for routing. Scanner + product line, because
 *  that is how Jack's sequences actually split: a CSP renewal goes to a
 *  different motion than a Dynamics lead, whichever scanner it came from. */
export type RouteKey =
  | "main:dynamics365" | "main:m365" | "main:other"
  | "smc:dynamics365" | "smc:m365" | "smc:other"
  | "csp";

export const ROUTE_ORDER: RouteKey[] = [
  "main:dynamics365", "main:m365", "main:other",
  "smc:dynamics365", "smc:m365", "smc:other",
  "csp",
];

export const ROUTE_META: Record<RouteKey, { label: string; hint: string }> = {
  "main:dynamics365": { label: "Main · Dynamics 365", hint: "Main Scanner leads on the Dynamics 365 product line." },
  "main:m365": { label: "Main · M365 / Azure", hint: "Main Scanner leads on M365 / Azure — licensing, migrations, ongoing support." },
  "main:other": { label: "Main · no product line", hint: "Main Scanner leads that qualified on licensing alone, with no product line." },
  "smc:dynamics365": { label: "Custom · Dynamics 365", hint: "Custom Scanner (SMC) leads on Dynamics 365." },
  "smc:m365": { label: "Custom · M365 / Azure", hint: "Custom Scanner (SMC) leads on M365 / Azure." },
  "smc:other": { label: "Custom · no product line", hint: "Custom Scanner leads with no product line." },
  csp: { label: "CSP renewals", hint: "Every CSP Scanner lead. CSP has no product line by design." },
};

export function routeKeyOf(lead: Pick<StoredLead, "source" | "productArea">): RouteKey {
  if (lead.source === "csp") return "csp";
  const line = lead.productArea === "Dynamics 365" ? "dynamics365"
    : lead.productArea === "M365 / Azure" ? "m365" : "other";
  return `${lead.source}:${line}` as RouteKey;
}

/* ------------------------------------------------------------- the rules */

export interface RoutingRules {
  id: "routing";
  /** Lead type -> sequence name. A type with no entry is never auto-routed. */
  rules: Partial<Record<RouteKey, string>>;
  updatedAt: string;
}

/** Starting rules. Only the unambiguous one is pre-filled: CSP leads go to
 *  the CSP Leads sequence. Every other type starts EMPTY on purpose —
 *  which sequence a Dynamics or M365 lead belongs in is Jack's call, and a
 *  guessed default would quietly route hundreds of leads somewhere wrong. */
export const DEFAULT_ROUTING: RoutingRules = {
  id: "routing",
  rules: { csp: "CSP Leads" },
  updatedAt: "",
};

export async function loadRouting(): Promise<RoutingRules> {
  const all = await dbGetAll<RoutingRules>(STORE_ROUTING);
  return all.find((r) => r.id === "routing") ?? DEFAULT_ROUTING;
}

export async function saveRouting(r: RoutingRules): Promise<void> {
  await dbPut(STORE_ROUTING, r);
}

/* -------------------------------------------------------- qualification */

/** The top verdict on every scanner. Main says "High priority" (or "Strong
 *  Signal" on a row scanned before scoring); Custom says "Strong Signal";
 *  CSP says "High priority". Only these are routed automatically. */
export const TOP_TIERS = new Set(["High priority", "Strong Signal"]);

export type HoldReason =
  | "not-top-tier" | "already-in-apollo" | "under-size" | "no-rule";

export const HOLD_META: Record<HoldReason, string> = {
  "not-top-tier": "Not a top-tier lead",
  "already-in-apollo": "Already worked in Apollo",
  "under-size": "Company under 10 employees",
  "no-rule": "No sequence set for this lead type",
};

/**
 * Why a lead with no plan is not being auto-routed — or null if it should
 * be. "Already worked" means any sequence history or any call: Jack wants
 * the queue to be TRULY uncontacted leads, and a finished sequence is still
 * a contacted lead.
 */
export function holdReason(
  lead: StoredLead,
  rules: RoutingRules,
  sizeBand: SizeBand | undefined,
): HoldReason | null {
  if (!TOP_TIERS.has(lead.tier)) return "not-top-tier";
  const a = lead.apollo;
  if (a && (a.sequences.length > 0 || a.callCount > 0)) return "already-in-apollo";
  if (sizeBand === "under") return "under-size";
  if (!rules.rules[routeKeyOf(lead)]) return "no-rule";
  return null;
}

/**
 * Give every eligible, un-planned lead its rule's sequence.
 *
 * Returns only the leads it changed, so the caller writes just those in
 * one transaction. A lead that already has a plan is never touched — see
 * the note at the top of this file.
 */
export function autoRoute(
  leads: StoredLead[],
  rules: RoutingRules,
  sizeBands: Map<string, SizeBand>,
  now = new Date().toISOString(),
): StoredLead[] {
  const changed: StoredLead[] = [];
  for (const l of leads) {
    if (l.plan) continue;
    if (holdReason(l, rules, sizeBands.get(l.key)) !== null) continue;
    const sequence = rules.rules[routeKeyOf(l)]!;
    changed.push({ ...l, plan: { sequence, status: "queued", assignedAt: now, by: "rule" } });
  }
  return changed;
}

/** Hand-place (or clear, with null) a lead's target. Moving an exported
 *  lead to a different sequence re-queues it — it has not been sent THERE.
 *  Moving it to the sequence it already went to keeps it exported. */
export function withPlan(lead: StoredLead, sequence: string | null, now = new Date().toISOString()): StoredLead {
  if (!sequence) {
    const { plan: _drop, ...rest } = lead;
    void _drop;
    return rest as StoredLead;
  }
  if (lead.plan && lead.plan.sequence === sequence) return lead;
  return { ...lead, plan: { sequence, status: "queued", assignedAt: now, by: "manual" } };
}

export function markExported(lead: StoredLead, now = new Date().toISOString()): StoredLead {
  if (!lead.plan) return lead;
  return { ...lead, plan: { ...lead.plan, status: "exported", exportedAt: now } };
}

/** One row per target sequence, for the queue and Home. */
export interface QueueGroup {
  sequence: string;
  queued: StoredLead[];
  exported: StoredLead[];
}

export function groupByPlan(leads: StoredLead[]): QueueGroup[] {
  const by = new Map<string, QueueGroup>();
  for (const l of leads) {
    if (!l.plan) continue;
    let g = by.get(l.plan.sequence);
    if (!g) { g = { sequence: l.plan.sequence, queued: [], exported: [] }; by.set(l.plan.sequence, g); }
    (l.plan.status === "exported" ? g.exported : g.queued).push(l);
  }
  return [...by.values()].sort((a, b) => b.queued.length - a.queued.length || a.sequence.localeCompare(b.sequence));
}
