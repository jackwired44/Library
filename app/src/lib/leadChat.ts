// The lead chat's one round trip: Jack's words in, a SmartRule out.
//
// Per Jack, choosing "Claude reads it": the request goes to Claude through
// the page's `sample` capability (the viewer's own Claude account; the
// first use asks for consent). Claude only returns a rule as JSON, which is
// validated before anything uses it. When the page cannot ask Claude (not
// inside the published page, consent declined, a usage limit), the built-in
// phrase reader answers instead, and the reply says which one did.
import "./claudeRuntime";
import type { ClaudeSampleError } from "./claudeRuntime";
import { parseRuleText, ruleFromCompletion, rulePrompt, isEmptyRule, type RuleContext, type SmartRule } from "./smartRules";

export type RuleSource = "claude" | "builtin";
export interface RuleAnswer { rule: SmartRule; by: RuleSource; note?: string }

const WHY: Record<string, string> = {
  not_granted: "Claude isn't allowed on this page for you, so the built-in reader answered.",
  sampling_disabled: "Claude isn't available on this account, so the built-in reader answered.",
  not_declared: "This version of the page can't ask Claude, so the built-in reader answered.",
  rate_limited: "Claude is busy or your usage limit was reached; the built-in reader answered. Try again later.",
  session_expired: "Your Claude session lapsed; the built-in reader answered. Sign in again to use Claude.",
  prompt_too_large: "That request was too long for Claude; the built-in reader answered.",
  refused: "Claude declined that request; the built-in reader answered.",
  empty_completion: "Claude returned nothing; the built-in reader answered.",
};

/** True only inside a published page that may ask Claude. */
export async function canAskClaude(): Promise<boolean> {
  try { return typeof window !== "undefined" && !!(await window.claude?.use?.("sample")); } catch { return false; }
}

export async function readRequest(text: string, ctx: RuleContext): Promise<RuleAnswer> {
  const builtin = (note?: string): RuleAnswer => ({ rule: parseRuleText(text, ctx), by: "builtin", note });
  let sample = null;
  try { sample = typeof window !== "undefined" ? await window.claude?.use?.("sample") : null; } catch { sample = null; }
  if (!sample) return builtin();
  try {
    const { completion } = await sample({ prompt: rulePrompt(text, ctx), modelTier: "quick" });
    const rule = ruleFromCompletion(completion, ctx);
    if (!rule) return builtin("Claude's answer couldn't be read as a rule, so the built-in reader answered.");
    if (isEmptyRule(rule)) {
      const fallback = parseRuleText(text, ctx);
      if (!isEmptyRule(fallback)) return { rule: fallback, by: "builtin", note: "Claude found no filter in that; the built-in reader did." };
    }
    return { rule, by: "claude" };
  } catch (e) {
    const code = (e as ClaudeSampleError)?.code || "upstream_error";
    return builtin(WHY[code] ?? "Claude couldn't be reached just now; the built-in reader answered.");
  }
}
