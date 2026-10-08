// Apollo's sequences and their step funnels — the AGGREGATE half of
// campaign oversight.
//
// Per Jack: "i need to oversee all the email campaigns here so i need to
// have full visibility into every lead that has been added to a sequence so
// i can see where they fall off before i put it into apollo."
//
// There are two different answers to "where do they fall off", and this app
// shows both rather than conflating them:
//
//   1. APOLLO'S OWN NUMBERS — every contact in the sequence, including the
//      thousands never scanned into this library. Imported here from
//      emailer_steps[].counts. This is the true funnel shape.
//   2. YOUR LEADS — the subset this library holds, derived from each
//      StoredLead's own ApolloLeadState. This is the actionable half: the
//      people you can actually click into and re-work.
//
// (2) is always a subset of (1), often a small one, and a view that
// presented either as "the" number would be lying. They are labelled apart.
//
// Keyed by sequence NAME, not Apollo's id: a synced lead carries the name
// (see apolloSync.ts's `Name:status:step` cell) and never the id, so the
// name is the only thing the two halves share. Renaming a sequence in
// Apollo therefore orphans its funnel until the next sync — a real limit,
// and the honest cost of not storing Apollo ids on 25,000 leads.
import { guessColumn, type ParsedFile } from "./detection";
import { STORE_APOLLO_FUNNELS, dbGetAll, dbBulkPut } from "./db";
import type { StoredLead } from "./leadStore";

export interface ApolloStep {
  /** 1-based, as Apollo numbers them. **0 is the sequence-level summary
   *  row**, not a step: several sequences report campaign totals with no
   *  per-step breakdown available, and a summary row lets those appear
   *  honestly instead of either vanishing or being drawn as a fake step 1. */
  position: number;
  type: string;
  active: number;
  /** Contacts parked on this step. A sequence Apollo has switched off
   *  reports its people as paused rather than active, and collapsing the
   *  two would show a dead campaign as a live one. */
  paused: number;
  finished: number;
  bounced: number;
  spam: number;
  /** Calls completed at this step. Null when Apollo returned "loading" —
   *  it computes these async, and a retry-later is not a zero. */
  callsCompleted: number | null;
  topOutcome: string;
}

/** Campaign-level numbers. EVERY field is nullable on purpose: for most of
 *  a sequence's history Apollo reports some totals and not others, and a
 *  count we were never given must render as unknown, not as zero — a dead
 *  campaign and an unmeasured one are different things. */
export interface FunnelTotals {
  /** Active plus paused — people still sitting somewhere in the sequence. */
  onSequence: number | null;
  finished: number | null;
  delivered: number | null;
  replied: number | null;
  bounced: number | null;
  spam: number | null;
}

export interface ApolloFunnel {
  name: string;
  /** Real steps only, 1-based. The summary row is NOT a step and lives in
   *  `totals` instead, so nothing that draws a funnel can mistake it for one. */
  steps: ApolloStep[];
  /** From the position-0 row, when the export carried one. */
  totals?: FunnelTotals;
  /** Switched on in Apollo. Null when the export did not say. */
  live?: boolean | null;
  importedAt: string;
}

const COL = {
  sequence: ["sequence", "sequencename", "campaign", "campaignname"],
  step: ["step", "position", "stepposition", "stepnumber"],
  type: ["type", "steptype", "channel"],
  active: ["active", "countactive"],
  paused: ["paused", "countpaused"],
  finished: ["finished", "countfinished", "completed"],
  bounced: ["bounced", "countbounced"],
  spam: ["spam", "spamblocked", "countspam"],
  calls: ["callscompleted", "calls", "completedcalls", "uniquecompleted"],
  outcome: ["topoutcome", "outcome", "topdisposition"],
  delivered: ["delivered", "countdelivered", "emailsdelivered"],
  replied: ["replied", "countreplied", "replies"],
  live: ["live", "isactive", "enabled", "on"],
};

/** Apollo returns the literal string "loading" for counts it has not
 *  finished computing. That is not zero, and writing it as zero would show
 *  a step as untouched when it may be the busiest one. */
function numOrNull(raw: unknown): number | null {
  const v = String(raw ?? "").trim();
  if (!v || /^loading$/i.test(v)) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const num = (raw: unknown): number => numOrNull(raw) ?? 0;

/** Read the step-funnel CSV. Unmapped columns are reported, never guessed
 *  at — the same contract every other import in this app follows. */
export function parseFunnelCSV(files: ParsedFile[]): {
  funnels: ApolloFunnel[];
  unmapped: string[];
  skipped: number;
} {
  const byName = new Map<string, ApolloStep[]>();
  const totalsByName = new Map<string, { totals: FunnelTotals; live: boolean | null }>();
  const unmapped = new Set<string>();
  let skipped = 0;

  for (const f of files) {
    const taken = new Set<string>();
    const pick = (cands: string[]): string | null => {
      const col = guessColumn(f.fields, cands, taken);
      if (col) taken.add(col);
      return col;
    };
    const cSeq = pick(COL.sequence);
    const cStep = pick(COL.step);
    const cType = pick(COL.type);
    const cActive = pick(COL.active);
    const cPaused = pick(COL.paused);
    const cFinished = pick(COL.finished);
    const cBounced = pick(COL.bounced);
    const cSpam = pick(COL.spam);
    const cCalls = pick(COL.calls);
    const cOutcome = pick(COL.outcome);
    const cDelivered = pick(COL.delivered);
    const cReplied = pick(COL.replied);
    const cLive = pick(COL.live);
    for (const h of f.fields) if (!taken.has(h)) unmapped.add(h);

    const get = (r: Record<string, unknown>, c: string | null) => (c ? r[c] : "");

    for (const r of f.data) {
      const name = String(get(r, cSeq) ?? "").trim();
      const position = numOrNull(get(r, cStep));
      // A row with no sequence name or no step number cannot be placed.
      if (!name || position === null) { skipped++; continue; }

      // Position 0 is the campaign summary, never a step. Read with
      // numOrNull throughout so a blank stays unknown.
      if (position === 0) {
        const a = numOrNull(get(r, cActive));
        const p = numOrNull(get(r, cPaused));
        const liveRaw = String(get(r, cLive) ?? "").trim().toLowerCase();
        totalsByName.set(name, {
          totals: {
            onSequence: a === null && p === null ? null : (a ?? 0) + (p ?? 0),
            finished: numOrNull(get(r, cFinished)),
            delivered: numOrNull(get(r, cDelivered)),
            replied: numOrNull(get(r, cReplied)),
            bounced: numOrNull(get(r, cBounced)),
            spam: numOrNull(get(r, cSpam)),
          },
          live: /^(yes|y|true|1|live|on|active)$/.test(liveRaw) ? true
            : /^(no|n|false|0|off|inactive)$/.test(liveRaw) ? false : null,
        });
        if (!byName.has(name)) byName.set(name, []);
        continue;
      }

      const steps = byName.get(name) ?? [];
      steps.push({
        position,
        type: String(get(r, cType) ?? "").trim(),
        active: num(get(r, cActive)),
        paused: num(get(r, cPaused)),
        finished: num(get(r, cFinished)),
        bounced: num(get(r, cBounced)),
        spam: num(get(r, cSpam)),
        callsCompleted: numOrNull(get(r, cCalls)),
        topOutcome: String(get(r, cOutcome) ?? "").trim(),
      });
      byName.set(name, steps);
    }
  }

  const now = new Date().toISOString();
  const funnels: ApolloFunnel[] = [...byName.entries()].map(([name, steps]) => {
    const t = totalsByName.get(name);
    return {
      name,
      steps: steps.sort((a, b) => a.position - b.position),
      ...(t ? { totals: t.totals, live: t.live } : {}),
      importedAt: now,
    };
  });
  return { funnels, unmapped: [...unmapped], skipped };
}

/* ------------------------------------------------------------- the join */

/** How many steps a sequence has, so a lead's step reads "5 of 6" rather
 *  than a bare 5. Null when no funnel is held for that name. */
export function stepsInSequence(funnels: ApolloFunnel[], name: string): number | null {
  const f = funnels.find((x) => x.name === name);
  return f && f.steps.length ? f.steps.length : null;
}

/** The real steps. The summary row never enters `steps` (it is parsed into
 *  `totals`), but a funnel stored before that change may still carry a
 *  position-0 entry, so it is filtered here defensively. */
export function realSteps(funnel: ApolloFunnel | null | undefined): ApolloStep[] {
  return (funnel?.steps ?? []).filter((s) => s.position > 0);
}

export interface SequenceRollup {
  name: string;
  funnel: ApolloFunnel | null;
  /** Leads THIS library holds that are in this sequence. */
  held: number;
  heldActive: number;
  heldFinished: number;
  /** Where the held leads stopped: step position -> how many. A lead whose
   *  sync carried no step lands under 0, counted separately rather than
   *  being assigned to step 1 by assumption. */
  heldByStep: Map<number, number>;
  /** Apollo's own totals across every contact, not just ours. Null when no
   *  funnel has been imported for this sequence. */
  apolloActive: number | null;
  apolloFinished: number | null;
  apolloDelivered: number | null;
  apolloReplied: number | null;
}

/**
 * One row per sequence, joining Apollo's funnel to the leads held here.
 *
 * Built in a single pass over the leads: at 25,000 leads a per-sequence
 * filter would walk the array once per sequence, which is the quadratic
 * shape this app has already had to fix twice.
 */
export function rollUpSequences(leads: StoredLead[], funnels: ApolloFunnel[]): SequenceRollup[] {
  const rows = new Map<string, SequenceRollup>();

  const ensure = (name: string): SequenceRollup => {
    let r = rows.get(name);
    if (!r) {
      r = {
        name, funnel: null, held: 0, heldActive: 0, heldFinished: 0,
        heldByStep: new Map(), apolloActive: null, apolloFinished: null,
        apolloDelivered: null, apolloReplied: null,
      };
      rows.set(name, r);
    }
    return r;
  };

  // Apollo's side first, so a sequence with a funnel but no held leads
  // still appears — "nobody here is in this campaign" is information.
  for (const f of funnels) {
    const r = ensure(f.name);
    r.funnel = f;
    // A sequence-level summary row is authoritative when present: several
    // sequences have campaign totals but no per-step breakdown, and summing
    // steps that do not exist would report them as empty.
    const steps = realSteps(f);
    const t = f.totals;
    const summed = (pick: (s: ApolloStep) => number) =>
      steps.length ? steps.reduce((a, s) => a + pick(s), 0) : null;
    r.apolloActive = t ? t.onSequence : summed((s) => s.active + s.paused);
    r.apolloFinished = t ? t.finished : summed((s) => s.finished);
    r.apolloDelivered = t?.delivered ?? null;
    r.apolloReplied = t?.replied ?? null;
  }

  for (const l of leads) {
    for (const s of l.apollo?.sequences ?? []) {
      const r = ensure(s.name);
      r.held++;
      if (s.status === "active") r.heldActive++;
      else r.heldFinished++;
      const step = s.step ?? 0;
      r.heldByStep.set(step, (r.heldByStep.get(step) || 0) + 1);
    }
  }

  // Your leads first; then live sequences ahead of switched-off ones; then
  // by reach. With nothing synced yet every `held` is 0, so without the
  // live/reach keys the list falls back to alphabetical and buries the
  // campaigns actually running under ones created today with no traffic.
  const reach = (r: SequenceRollup) => r.apolloDelivered ?? r.apolloActive ?? 0;
  return [...rows.values()].sort((a, b) =>
    b.held - a.held
    || Number(b.funnel?.live === true) - Number(a.funnel?.live === true)
    || reach(b) - reach(a)
    || a.name.localeCompare(b.name));
}

/* --------------------------------------------------------- persistence */

export async function loadFunnels(): Promise<ApolloFunnel[]> {
  return (await dbGetAll<ApolloFunnel>(STORE_APOLLO_FUNNELS)) ?? [];
}

/** Replaced wholesale per sequence, not merged: a funnel is a snapshot of
 *  live Apollo state, so a re-import has to be able to shrink a step's
 *  count, not only grow it. Same rule applyApolloSync follows. */
export async function saveFunnels(funnels: ApolloFunnel[]): Promise<void> {
  if (funnels.length) await dbBulkPut(STORE_APOLLO_FUNNELS, funnels);
}
