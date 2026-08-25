// Profile — the single real user's own identity (name/role/org), editable
// in place of the hardcoded "Jack · Wired CIO Sales" the sidebar used to
// show. Still just one local record: this tool has no real accounts yet
// (see CLAUDE.md Access & ownership) — this is UI scaffolding for that,
// not a login system. One record, one browser, no server.
import { dbGetAll, dbPut, STORE_PROFILE } from "./db";

const RECORD_ID = "profile";

export interface Profile {
  id: typeof RECORD_ID;
  name: string;
  role: string;
  org: string;
  updatedAt: string;
}

const DEFAULT_PROFILE: Profile = {
  id: RECORD_ID,
  name: "Jack",
  role: "Sales Director",
  org: "Wired CIO",
  updatedAt: new Date(0).toISOString(),
};

export async function loadProfile(): Promise<Profile> {
  const all = await dbGetAll<Profile>(STORE_PROFILE);
  return all[0] || DEFAULT_PROFILE;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await dbPut<Profile>(STORE_PROFILE, profile);
}
