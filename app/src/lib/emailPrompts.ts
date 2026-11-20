// Email prompt library. Per Jack (2026-11-20): "a prompt tab under archive
// for email prompts so i can start saving all my email prompts i use and see
// what works better what doesnt save user prompt and system prompts subjects
// also", and "attach to which product area or sequence it was with also".
// Local only, like every other store here; nothing is sent anywhere.
import { STORE_EMAIL_PROMPTS, dbDelete, dbGetAll, dbPut } from "./db";

export type PromptVerdict = "testing" | "works" | "doesnt" | "retired";
export const PROMPT_VERDICT_META: Record<PromptVerdict, { label: string; cls: string }> = {
  testing: { label: "Testing", cls: "info" },
  works: { label: "Works", cls: "success" },
  doesnt: { label: "Doesn't work", cls: "danger" },
  retired: { label: "Retired", cls: "neutral" },
};
export const PROMPT_VERDICT_ORDER: PromptVerdict[] = ["works", "testing", "doesnt", "retired"];
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

export const loadEmailPrompts = () => dbGetAll<EmailPrompt>(STORE_EMAIL_PROMPTS);
export const saveEmailPrompt = (p: EmailPrompt) => dbPut(STORE_EMAIL_PROMPTS, p);
export const deleteEmailPrompt = (id: string) => dbDelete(STORE_EMAIL_PROMPTS, id);
