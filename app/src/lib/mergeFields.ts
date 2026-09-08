// Merge-field rendering for sequence step content.
//
// Apollo's real templates (see lib/sequenceTemplates.ts, pulled verbatim
// from the live "Dynamics Sequence") interpolate values like
// {{contact.first_name}}, {{contact.title}} and {{account.name}} into a
// subject line, an email body, and an AI prompt's instructions. This
// module resolves those against a real Contact from this app's own
// directory, so a step's content is functional here rather than being
// inert text carried over from another tool.
//
// Deliberately NOT a general template engine. It handles exactly what
// Apollo's own templates use and nothing more:
//   - {{token}} substitution, with a small alias table so Apollo's
//     naming, HubSpot-ish naming and plain naming all resolve
//   - {{#if token}}…{{#endif}} conditionals (Apollo's own syntax, used in
//     the Dynamics Sequence's user prompt around {{contact.title}})
// An unknown token is left VISIBLE as {{token}} rather than silently
// blanked — a template quietly missing a field reads as finished when it
// isn't, which is worse than an obvious placeholder. Callers that want
// them stripped ask for it explicitly (see `renderMerge`'s `blankUnknown`).
import type { Contact } from "./contacts";
import { getFullName } from "./detection";

export interface MergeContext {
  contact?: Contact | null;
  // The sender, for {{sender.*}} — this app's local profile/user name.
  senderName?: string;
  senderCompany?: string;
}

// Canonical token -> resolver. Aliases below map every spelling Apollo
// (and a person typing from memory) actually uses onto one of these.
function baseValues(ctx: MergeContext): Record<string, string> {
  const c = ctx.contact;
  const full = c
    ? getFullName({ firstName: c.firstName, lastName: c.lastName, fullName: c.fullName })
    : "";
  return {
    "contact.first_name": c?.firstName?.trim() || (full ? full.split(/\s+/)[0] : ""),
    "contact.last_name": c?.lastName?.trim() || "",
    "contact.name": full,
    "contact.title": c?.title?.trim() || "",
    "contact.email": c?.email?.trim() || "",
    "contact.phone": (c?.mobilePhone || c?.workPhone || "").trim(),
    "account.name": c?.company?.trim() || "",
    "account.website": c?.companyWebsite?.trim() || "",
    "sender.name": ctx.senderName?.trim() || "",
    "sender.company": ctx.senderCompany?.trim() || "Wired CIO",
  };
}

// Apollo writes {{contact.first_name}}; someone hand-typing a template
// writes {{first_name}} or {{company}}. All resolve to the same value.
const ALIASES: Record<string, string> = {
  first_name: "contact.first_name",
  firstname: "contact.first_name",
  last_name: "contact.last_name",
  lastname: "contact.last_name",
  name: "contact.name",
  full_name: "contact.name",
  title: "contact.title",
  email: "contact.email",
  phone: "contact.phone",
  company: "account.name",
  account: "account.name",
  "account.name_friendly": "account.name",
  website: "account.website",
  "my.name": "sender.name",
  "my.company": "sender.company",
};

function resolveToken(token: string, values: Record<string, string>): string | undefined {
  const key = token.trim();
  if (key in values) return values[key];
  const alias = ALIASES[key.toLowerCase()];
  if (alias && alias in values) return values[alias];
  return undefined;
}

// Every token a template references, in order of first appearance — used
// by the editor to show which fields a step depends on.
export function tokensIn(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{\{\s*(?!#)([^}]+?)\s*\}\}/g)) {
    const t = m[1].trim();
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export interface RenderResult {
  text: string;
  // Tokens present in the template that this app has no value for. Shown
  // in the editor so a template that can never fill in is obvious before
  // it is used, not after.
  unresolved: string[];
}

export function renderMerge(
  template: string,
  ctx: MergeContext,
  opts: { blankUnknown?: boolean } = {}
): RenderResult {
  const values = baseValues(ctx);
  const unresolved: string[] = [];

  // Conditionals first, so a {{#if title}} block whose token is empty is
  // removed before its inner tokens are substituted.
  let out = template.replace(
    /\{\{\s*#if\s+([^}]+?)\s*\}\}([\s\S]*?)\{\{\s*#endif\s*\}\}/g,
    (_all, token: string, inner: string) => {
      const v = resolveToken(token, values);
      return v && v.trim() ? inner : "";
    }
  );

  out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (all, token: string) => {
    const v = resolveToken(token, values);
    if (v === undefined) {
      if (!unresolved.includes(token.trim())) unresolved.push(token.trim());
      return opts.blankUnknown ? "" : all;
    }
    if (!v) {
      // Known token, no value on this contact (e.g. a blank title). Blank
      // it rather than leaving a placeholder in copy a rep will paste.
      return "";
    }
    return v;
  });

  // Collapse the double spaces / stranded punctuation a blanked token
  // leaves behind, so "Hey , quick question" doesn't ship.
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?])/g, "$1");
  return { text: out, unresolved };
}
