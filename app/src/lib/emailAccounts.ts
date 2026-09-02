// Email sending accounts — per Jack: "add in an ability to connect emails
// so we can fire sequences will loop in sengrid eventually and go that
// route to build it out."
//
// READ THIS BEFORE EXTENDING IT: this app has no backend and no SendGrid
// API key anywhere (see CLAUDE.md Access & ownership — one shared
// password, no server). A SendGrid API key is a secret capable of
// sending mail as Jack's own domain; it must live on a server that can
// keep it out of client-visible code, never in this app's IndexedDB,
// which anyone with the shared password (or just this browser) can read
// straight out of devtools. So "connecting" an account here does NOT
// store an API key or call SendGrid at all — it only captures WHICH
// sender identity (a label, from name, from email) a sequence should use
// once real sending exists. `connected` stays false everywhere until a
// real backend relay is built to hold the key server-side and proxy the
// send — same "captured now, wired in later" pattern already used for
// Sequence steps' AI system/user prompts and the channel Manual/
// Automated send-mode badges (see lib/sequences.ts, components/
// Sequences.tsx). Flagged here in plain terms so this is never mistaken
// for a working integration by a future reader (or Jack, months later).
import { dbGetAll, dbPut, dbDelete, STORE_EMAIL_ACCOUNTS } from "./db";

export type EmailProvider = "sendgrid";

export interface EmailAccount {
  id: string;
  label: string;
  fromName: string;
  fromEmail: string;
  provider: EmailProvider;
  // Always false today — there is nothing to actually connect through
  // yet. Kept as a real field (not hardcoded in the UI) so flipping it
  // to true is the one place that changes once a backend relay exists.
  connected: boolean;
  createdAt: string;
}

function newId() {
  return `email-account-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadEmailAccountsFromDB(): Promise<EmailAccount[]> {
  const all = await dbGetAll<EmailAccount>(STORE_EMAIL_ACCOUNTS);
  return all.sort((a, b) => a.label.localeCompare(b.label));
}
export async function persistEmailAccount(account: EmailAccount) {
  await dbPut(STORE_EMAIL_ACCOUNTS, account);
}
export async function deleteEmailAccountFromDB(id: string) {
  await dbDelete(STORE_EMAIL_ACCOUNTS, id);
}

export function createEmailAccount(label: string, fromName: string, fromEmail: string): EmailAccount | null {
  const trimmedLabel = label.trim();
  const trimmedEmail = fromEmail.trim();
  if (!trimmedLabel || !trimmedEmail) return null;
  return {
    id: newId(),
    label: trimmedLabel,
    fromName: fromName.trim(),
    fromEmail: trimmedEmail,
    provider: "sendgrid",
    connected: false,
    createdAt: new Date().toISOString(),
  };
}

export function updateEmailAccount(
  account: EmailAccount,
  patch: Partial<Pick<EmailAccount, "label" | "fromName" | "fromEmail">>
): EmailAccount {
  return { ...account, ...patch };
}

export function emailAccountLabel(accounts: EmailAccount[], id: string | null | undefined): string {
  if (!id) return "None selected";
  const acct = accounts.find((a) => a.id === id);
  return acct ? `${acct.label} <${acct.fromEmail}>` : "None selected";
}
