// Email prompt library. Per Jack (2026-11-20): "a prompt tab under archive
// for email prompts so i can start saving all my email prompts i use and see
// what works better what doesnt save user prompt and system prompts subjects
// also", and "attach to which product area or sequence it was with also".
// Local only, like every other store here; nothing is sent anywhere.
import { STORE_EMAIL_PROMPTS, dbBulkPut, dbDelete, dbGetAll, dbPut } from "./db";
import { PROMPT_SEEDS, PROMPT_SEEDS_AT } from "./emailPromptSeeds";

export type PromptVerdict = "live" | "testing" | "works" | "doesnt" | "retired";
export const PROMPT_VERDICT_META: Record<PromptVerdict, { label: string; cls: string }> = {
  live: { label: "Live in Apollo", cls: "info" },
  testing: { label: "Testing", cls: "warning" },
  works: { label: "Works", cls: "success" },
  doesnt: { label: "Doesn't work", cls: "danger" },
  retired: { label: "Retired", cls: "neutral" },
};
export const PROMPT_VERDICT_ORDER: PromptVerdict[] = ["live", "works", "testing", "doesnt", "retired"];
export const PROMPT_PRODUCT_AREAS = ["Dynamics 365", "M365 / Azure", "Licensing / CSP", "Azure build / app", "Security / MSP", "General"] as const;

export interface EmailPrompt {
  id: string;
  title: string;
  productArea: string;
  sequence: string;      // Apollo sequence name, free text so a past one still fits
  step: string;          // e.g. "Step 2 auto email"
  subject: string;
  systemPrompt: string;
  userPrompt: string;
  verdict: PromptVerdict;
  // What it did, typed in from Apollo. Optional: blank reads as unknown, never 0.
  sent?: number | null;
  openRate?: number | null;   // percent
  replyRate?: number | null;  // percent
  meetings?: number | null;
  notes: string;
  /** Set on prompts copied from Apollo: the touch's status there
   *  ("approved", "to_be_reviewed") and which seed it came from. */
  apolloStatus?: string;
  seedId?: string;
  createdAt: string;
  updatedAt: string;
}

export function newEmailPrompt(patch: Partial<EmailPrompt> = {}): EmailPrompt {
  const now = new Date().toISOString();
  return {
    id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: "", productArea: "", sequence: "", step: "", subject: "", systemPrompt: "", userPrompt: "",
    verdict: "testing", notes: "", createdAt: now, updatedAt: now, ...patch,
  };
}

const DISMISSED_KEY = "promptSeedsDismissed";
function dismissed(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]")); } catch { return new Set(); } }
export function dismissSeed(id: string) { try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed(), id])); } catch { /* preference only */ } }

/** Load, adding any Apollo prompt not stored yet. A seed already stored (and
 *  perhaps edited) is never touched; one deleted on purpose stays deleted. */
export async function loadEmailPrompts(): Promise<EmailPrompt[]> {
  const have = await dbGetAll<EmailPrompt>(STORE_EMAIL_PROMPTS);
  const ids = new Set(have.map((p) => p.id));
  const gone = dismissed();
  const at = `${PROMPT_SEEDS_AT}T12:00:00.000Z`;
  const add = PROMPT_SEEDS.filter((s) => !ids.has(s.id) && !gone.has(s.id)).map((s): EmailPrompt => ({
    id: s.id, seedId: s.id, title: s.title, productArea: s.productArea, sequence: s.sequence, step: s.step,
    subject: s.subject, systemPrompt: s.systemPrompt, userPrompt: s.userPrompt,
    verdict: "live", apolloStatus: s.apolloStatus,
    notes: `Copied word for word from Apollo on ${PROMPT_SEEDS_AT}${s.apolloStatus === "to_be_reviewed" ? " (not approved in Apollo yet)" : ""}.`,
    createdAt: at, updatedAt: at,
  }));
  if (add.length) await dbBulkPut(STORE_EMAIL_PROMPTS, add);
  return [...have, ...add];
}
export const saveEmailPrompt = (p: EmailPrompt) => dbPut(STORE_EMAIL_PROMPTS, p);
export async function deleteEmailPrompt(p: EmailPrompt) {
  if (p.seedId) dismissSeed(p.seedId);
  await dbDelete(STORE_EMAIL_PROMPTS, p.id);
}
