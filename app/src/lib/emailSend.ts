// The seam between a sequence's email step and something that actually
// sends it.
//
// Nothing in this app sends email today: there is no backend, and a
// SendGrid API key cannot live in this browser (see CLAUDE.md, Access &
// ownership — it would sit in plain text in IndexedDB, readable by
// anyone with the shared password). So this module deliberately does two
// separate jobs, and only the first of them can run here:
//
//   1. COMPOSE — turn a step + a contact + a sender identity into the
//      exact message that would go out, with merge fields resolved and
//      every reason it is not sendable listed. This is pure, testable,
//      and correct today.
//   2. SEND — hand that message to an EmailSender. The only sender that
//      exists right now REFUSES and says why. When a real relay is built,
//      it implements this one interface and nothing else changes.
//
// Composing without a sender is the whole point: it means the day
// SendGrid is connected, the message that goes out is the message this
// app has already been showing, not a new code path written under time
// pressure.
import type { SequenceStep } from "./sequences";
import type { Contact } from "./contacts";
import type { EmailAccount } from "./emailAccounts";
import { renderMerge, tokensIn, KNOWN_UNSUPPORTED_TOKENS } from "./mergeFields";

export interface ComposedEmail {
  to: string;
  toName: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  // Every reason this message is not ready to send. An empty array means
  // it genuinely is — that is the check a sender should gate on, rather
  // than each caller re-deriving its own idea of "ready".
  blockers: EmailBlocker[];
  // Non-fatal: worth showing, does not stop a send.
  warnings: string[];
}

export type EmailBlockerCode =
  | "no_recipient"
  | "no_sender_account"
  | "no_subject"
  | "no_body"
  | "ai_body_unavailable"
  | "unresolved_tokens"
  | "do_not_contact";

export interface EmailBlocker {
  code: EmailBlockerCode;
  message: string;
}

// A contact who has opted out is never emailable, regardless of what the
// sequence says. Checked here as well as at enrollment because a
// disposition can change after someone is already enrolled.
const OPTED_OUT = new Set(["do-not-contact", "not-interested"]);

export function composeStepEmail(
  step: SequenceStep,
  contact: Contact,
  account: EmailAccount | null,
  sender: { name: string; company: string }
): ComposedEmail {
  const blockers: EmailBlocker[] = [];
  const warnings: string[] = [];

  const to = (contact.email || "").trim();
  const toName = (contact.fullName || `${contact.firstName} ${contact.lastName}`).trim();
  if (!to) blockers.push({ code: "no_recipient", message: "This contact has no email address on file." });

  if (!account) {
    blockers.push({ code: "no_sender_account", message: "No sending account is selected on this sequence." });
  }

  if (contact.disposition && OPTED_OUT.has(contact.disposition)) {
    blockers.push({
      code: "do_not_contact",
      message: `Contact is marked "${contact.disposition === "do-not-contact" ? "Do not contact" : "Not interested"}".`,
    });
  }

  const values = { contact, senderName: sender.name, senderCompany: sender.company };

  const rSubject = renderMerge(step.subject || "", values);
  const subject = rSubject.text.trim();
  if (!subject) blockers.push({ code: "no_subject", message: "This step has no subject line." });

  let body = "";
  if (step.bodyMode === "ai") {
    // The body is meant to be written per contact from the step's
    // prompts. This app has no model wired in, so it cannot produce one
    // — and inventing placeholder copy that then went out over a real
    // relay would be far worse than refusing.
    blockers.push({
      code: "ai_body_unavailable",
      message:
        "This step's body is AI-written from its prompts, and no AI is connected to this app. " +
        "Either connect one, or switch the step to a manual email and write the body.",
    });
    if (!step.systemPrompt?.trim() || !step.userPrompt?.trim()) {
      warnings.push("This AI step is missing a system or user prompt.");
    }
  } else {
    const rBody = renderMerge(step.body || "", values);
    body = rBody.text.trim();
    if (!body) blockers.push({ code: "no_body", message: "This step has no message body." });
  }

  // A token that survived rendering is a field this contact has no value
  // for, or one this app does not know. Either way it would go out as
  // literal "{{...}}" text, so it stops the send rather than warning.
  const leftover = [...tokensIn(subject), ...tokensIn(body)].filter(
    (t) => !KNOWN_UNSUPPORTED_TOKENS.includes(t)
  );
  if (leftover.length) {
    blockers.push({
      code: "unresolved_tokens",
      message: `Unresolved merge field${leftover.length === 1 ? "" : "s"}: ${leftover.map((t) => `{{${t}}}`).join(", ")}.`,
    });
  }
  const unsupported = [...tokensIn(subject), ...tokensIn(body)].filter((t) =>
    KNOWN_UNSUPPORTED_TOKENS.includes(t)
  );
  if (unsupported.length) {
    warnings.push(`This app cannot fill ${unsupported.map((t) => `{{${t}}}`).join(", ")} — edit it out before sending.`);
  }

  return {
    to,
    toName,
    fromName: account?.fromName || "",
    fromEmail: account?.fromEmail || "",
    subject,
    body,
    blockers,
    warnings,
  };
}

export const isSendable = (msg: ComposedEmail) => msg.blockers.length === 0;

export interface SendResult {
  ok: boolean;
  // Provider's own id for the message, when it gives one.
  providerMessageId?: string;
  error?: string;
  errorCode?: "not_configured" | "rejected" | "network" | "unknown";
}

// The one interface a real relay has to implement. Deliberately tiny:
// everything above this line is already decided and tested, so a SendGrid
// adapter only has to turn a ComposedEmail into an API call.
export interface EmailSender {
  readonly id: string;
  readonly label: string;
  readonly connected: boolean;
  send(msg: ComposedEmail): Promise<SendResult>;
}

// The only sender that exists today. It refuses, and says exactly why —
// rather than resolving ok:true and letting the rest of the app behave as
// though mail went out.
export const NO_SENDER: EmailSender = {
  id: "none",
  label: "No sending relay configured",
  connected: false,
  async send() {
    return {
      ok: false,
      errorCode: "not_configured",
      error:
        "No email relay is connected. Sending needs a server to hold the API key — it cannot be done from this page. " +
        "Until then, email steps generate a task you send by hand.",
    };
  },
};

// Send one step's email to one contact. Composition and the blocker
// check happen here, not in the sender, so every sender inherits the
// same rules and no adapter can accidentally skip them.
export async function sendStepEmail(
  step: SequenceStep,
  contact: Contact,
  account: EmailAccount | null,
  sender: { name: string; company: string },
  relay: EmailSender = NO_SENDER
): Promise<{ composed: ComposedEmail; result: SendResult }> {
  const composed = composeStepEmail(step, contact, account, sender);
  if (!isSendable(composed)) {
    return {
      composed,
      result: {
        ok: false,
        errorCode: "rejected",
        error: composed.blockers.map((b) => b.message).join(" "),
      },
    };
  }
  if (!relay.connected) {
    return { composed, result: await NO_SENDER.send(composed) };
  }
  try {
    return { composed, result: await relay.send(composed) };
  } catch (err) {
    return {
      composed,
      result: {
        ok: false,
        errorCode: "network",
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// Only an AUTOMATIC email step would ever be sent by a relay. A manual
// one is a task by design, and stays one even after a relay exists.
export const stepSendsAutomatically = (step: SequenceStep) =>
  step.channel === "email" && step.sendMode === "auto";
