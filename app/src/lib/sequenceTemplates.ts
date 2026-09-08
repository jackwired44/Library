// Sequence templates — real, working sequences reproduced in this app.
//
// The one below was pulled LIVE from Jack's own Apollo account
// (emailer_campaign 6a0b653aba6c9100208889c0, "Dynamics Sequence") via
// the Apollo connector, not written from memory or approximated: its
// step order, channels, wait times, email subject, LinkedIn message and
// both AI prompts are verbatim copies of what is running there today.
//
// Why a code-level template rather than a live import button: this app's
// data lives in the viewer's own browser (IndexedDB), so nothing outside
// it can write a sequence into Jack's account. Shipping the sequence as a
// template he instantiates with one click is the only mechanism that
// actually puts it in his hands. A live "import from Apollo" reader can
// come later — see CLAUDE.md — but it would need the connector available
// inside the published page, which is a separate grant.
import { addStep, updateStep, createSequence, type Sequence, type SequenceChannel } from "./sequences";

export interface TemplateStep {
  channel: SequenceChannel;
  waitHours: number;
  note?: string;
  subject?: string;
  body?: string;
  systemPrompt?: string;
  userPrompt?: string;
}

export interface SequenceTemplate {
  id: string;
  name: string;
  // Shown in the picker so the shape is readable before instantiating.
  description: string;
  // Where this came from, stated plainly in the UI.
  source: string;
  steps: TemplateStep[];
}

/* ------------------------------------------------------------------ */
/* Dynamics Sequence — verbatim from Apollo                             */
/* ------------------------------------------------------------------ */

// Apollo's `prompt_template.system_instructions` for the step-2 email.
// Copied exactly, including its own capitalisation and banned-word lists.
const DYNAMICS_EMAIL_SYSTEM_PROMPT = `You are a skilled conversationalist who excels at showing value to people. You carefully analyse the given pieces of information, find connections between them and then write a compelling, coherent and logical message. You use only the information provided by the users and avoid creating any specific details that are not provided.
Your messages are short, crisp and less than 80 words. You are subtle, creative and do not blatantly copy sentences provided to you for information. Your communication should be casual and friendly. Format the email professionally and avoid presenting your entire message in one paragraph.

** IMPORTANT **
Avoid using any of the following words (or very similar ones): Streamlining, Delve, Streamline, Supercharge, Turbocharge, Priceless, Absolutely Free, Exclusive Offer, Limited Time, Revolutionary, Breakthrough, Unparalleled, Groundbreaking, Spectacular, Ultimate, Premium, Elite, Game-Changing, Risk-Free, Unmatched, Unbeatable, Superior, Instant Results, Magic Formula, Secret Weapon, Exclusive Access, Once-in-a-Lifetime, Transformative, Next-Generation, World-Class, Life-Changing, Must-Have, Irresistible, Sensational.

Ensure that the language avoids 'buzzwords' or phrases that sound overly 'salesy' or spam-like. Avoid terms that are irrelevant to the product, solution, or recipient (e.g., "Irrelevant" refers to content that does not relate at all to the product or solution; "Spam-like" includes phrases such as: Freebie, Buy Now, Urgent, Act Now, Limited Offer, Winner, Guarantee, Risk-Free, No Cost, Exclusive Deal).

Remember, the task is to generate only the email body, starting with the greeting and ending with the signature. Do not include a subject line or any content outside the main body of the email. Also, do not include any preamble or explanation like "Here's an email draft for you:...".`;

// Apollo's `prompt_template.instructions` for the same step. Merge fields
// are left exactly as written — lib/mergeFields.ts resolves the same
// {{contact.*}} / {{account.*}} tokens and Apollo's {{#if}}…{{#endif}}
// conditional syntax, so this text works here unchanged.
const DYNAMICS_EMAIL_USER_PROMPT = `You work for Wired CIO, a Microsoft Solutions partner serving small and midsize businesses. Wired CIO supports ERP and CRM projects, Azure, Power BI. For this email, focus only on Wired CIO as a Microsoft Solutions Partner focusing on Microsoft Dynamics as a potential fit for these targeted SMB companies. Write a warm first outreach email to the person below, using the details listed after each label.

Name: {{contact.first_name}}
Company: {{account.name}}
Title: {{#if contact.title}}{{contact.title}}{{#endif}}

This is the first time reaching out. You have never spoken before. Introduce yourself as Jack from Wired CIO in the first sentence only, and do not mention Jack or Wired CIO again.
Write as though you are making a reasonable assumption based on the person's role and company type. Do not imply that you know their situation exactly, but they may be looking for a new platform for the company of some sort in the Microsoft ecosystem.

The goal is to position Wired CIO as a potential Microsoft Solutions Partner for Dynamics. The email should open a conversation around setting up a discovery call to see if there is a viable solution around what peaked their interest and the companies requirements,

Close with one low pressure question asking if they are open to a short call.


Writing rules.
(1) three short paragraphs, plain text, under 75 words total
(2) use only periods and commas. Do not use em dashes, en dashes, hyphens joining clauses, semicolons, or colons anywhere in the email
(3) write the way a real person types a quick email. Vary sentence length. Some short, one a little longer. Do not give every sentence the same rhythm
(4) do not describe their day-to-day or paint a picture of the future
(5) use no rhetorical questions except the closing ask
(6) no lists of three. No "whether it's X, Y, or Z." No "not just X but Y."
(7) sound like a person, not a brochure
(8) do not open sentences with "Imagine," "Picture," or setups like "Looking to..."
(9) mention protection or keeping systems covered no more than once, and only if it comes up naturally
(10) no fear or urgency language, and no geographic references of any kind
(11) work from the title and company name alone. Do not invent specific details about the company and do not mention that anything is missing
(12) always introduce yourself as Jack
(13) no links, URLs, or booking links of any kind
(14) never use these words: streamline, streamlining, synergy, value proposition, touch base, game changer, revolutionary, transformative, supercharge, delve, unparalleled, groundbreaking, cutting-edge, innovative, seamless, robust, leverage, utilize, best-in-class, holistic, proactive, cyber, cybersecurity, cyber threats, security risks, hacked, breach, attacked, vulnerability, cobbled, gaps, risk, danger, critical, urgent

Output only the email body. No subject line, no preamble, no explanation, no signature, no name at the bottom, no links or URLs.`;

// Apollo's step-5 LinkedIn connect note, verbatim. The missing space
// after the merge field is in the live template — left as-is rather than
// silently corrected, since this is a copy of what is running. Fix it
// here and in Apollo together if wanted.
const DYNAMICS_LINKEDIN_BODY = `Hey {{contact.first_name}}reaching out here in case my email or call didn't land. We help companies figure out the right systems and platforms to support their growth — happy to connect if that's ever on your radar.`;

export const DYNAMICS_SEQUENCE_TEMPLATE: SequenceTemplate = {
  id: "tpl-dynamics-apollo",
  name: "Dynamics Sequence",
  description: "5 steps — call, email, call, call, LinkedIn. Three call touches carrying the sequence, one AI-written first email.",
  source: "Copied from Apollo (Dynamics Sequence), including both AI prompts",
  steps: [
    {
      channel: "call",
      waitHours: 0,
      note: "First dial — fires the moment they are enrolled",
    },
    {
      channel: "email",
      waitHours: 0,
      subject: "Microsoft Solutions",
      // Apollo generates this body from the prompts below rather than
      // sending a fixed template, so there is no static body to copy —
      // the prompts ARE the content. Stated in the step itself so it does
      // not read as an empty step.
      body: "",
      systemPrompt: DYNAMICS_EMAIL_SYSTEM_PROMPT,
      userPrompt: DYNAMICS_EMAIL_USER_PROMPT,
      note: "Body is AI-written from the prompts on this step",
    },
    { channel: "call", waitHours: 48, note: "Second dial" },
    { channel: "call", waitHours: 48, note: "Third dial" },
    {
      channel: "linkedin",
      waitHours: 1,
      body: DYNAMICS_LINKEDIN_BODY,
      note: "LinkedIn connect request with a note",
    },
  ],
};

export const SEQUENCE_TEMPLATES: SequenceTemplate[] = [DYNAMICS_SEQUENCE_TEMPLATE];

// Builds a real, persistable Sequence from a template. Reuses addStep/
// updateStep rather than hand-building step objects, so a template can
// never produce a step shape the normal editor can't handle (ids,
// positions and wait clamping all go through the same path).
export function sequenceFromTemplate(tpl: SequenceTemplate, name?: string): Sequence | null {
  let seq = createSequence(name?.trim() || tpl.name);
  if (!seq) return null;
  for (const t of tpl.steps) {
    seq = addStep(seq, t.channel, t.waitHours, t.note);
    const added = seq.steps[seq.steps.length - 1];
    const patch: Parameters<typeof updateStep>[2] = {};
    if (t.subject !== undefined) patch.subject = t.subject;
    if (t.body !== undefined) patch.body = t.body;
    if (t.systemPrompt !== undefined) patch.systemPrompt = t.systemPrompt;
    if (t.userPrompt !== undefined) patch.userPrompt = t.userPrompt;
    if (Object.keys(patch).length) seq = updateStep(seq, added.id, patch);
  }
  return seq;
}
