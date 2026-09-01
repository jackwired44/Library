// Platform users — a local roster of the people this platform's work is
// attributed to. Per Jack: "sequence owners by users associated with the
// platform and have credentials."
//
// READ THIS BEFORE EXTENDING IT: these records are ATTRIBUTION, NOT
// AUTHENTICATION. This app has one shared password (lib/auth.ts) and no
// server, so a user record here says *who owns a thing*, never *who is
// allowed to open the app or act as whom*. Anyone who unlocks the app
// still sees and can edit everything regardless of the owner stamped on
// it. Adding a `password` field here would be actively misleading — real
// credentials need a backend that can verify them, which is the separate,
// still-unmade decision in CLAUDE.md's Access & ownership section and its
// Roadmap. This roster is deliberately built so that, when that backend
// lands, a real account can bind to an existing user id without
// re-attributing every sequence.
import { dbGetAll, dbPut, dbDelete, STORE_USERS } from "./db";

export type UserRole = "owner" | "admin" | "rep";

export const ROLE_META: Record<UserRole, { label: string; color: string; bg: string }> = {
  owner: { label: "Owner", color: "#0A66C2", bg: "#EAF3FC" },
  admin: { label: "Admin", color: "#9A5B22", bg: "#FBEBDD" },
  rep: { label: "Rep", color: "#2E6B4A", bg: "#E1F2E7" },
};
export const ROLE_ORDER: UserRole[] = ["owner", "admin", "rep"];

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
  // True for the single record representing whoever set this browser up
  // (seeded from lib/profile.ts). Kept so the roster always has at least
  // one real person to attribute to before anyone adds teammates.
  isSelf?: boolean;
}

export const SELF_USER_ID = "user-self";

function newId() {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadUsersFromDB(): Promise<PlatformUser[]> {
  const all = await dbGetAll<PlatformUser>(STORE_USERS);
  return all.sort((a, b) => {
    if (a.isSelf && !b.isSelf) return -1;
    if (b.isSelf && !a.isSelf) return 1;
    return a.name.localeCompare(b.name);
  });
}
export async function persistUser(user: PlatformUser) {
  await dbPut(STORE_USERS, user);
}
export async function deleteUserFromDB(id: string) {
  await dbDelete(STORE_USERS, id);
}

// The roster always contains "you" — derived from the local Profile so the
// name matches what the sidebar shows. Created once, then editable like
// any other record.
export function selfUserFrom(profileName: string): PlatformUser {
  return {
    id: SELF_USER_ID,
    name: profileName.trim() || "You",
    email: "",
    role: "owner",
    createdAt: new Date().toISOString(),
    isSelf: true,
  };
}

export function createUser(name: string, email: string, role: UserRole): PlatformUser | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return { id: newId(), name: trimmed, email: email.trim(), role, createdAt: new Date().toISOString() };
}

export function updateUser(user: PlatformUser, patch: Partial<Pick<PlatformUser, "name" | "email" | "role">>): PlatformUser {
  return { ...user, ...patch };
}

export function userLabel(users: PlatformUser[], id: string | null | undefined): string {
  if (!id) return "Unassigned";
  return users.find((u) => u.id === id)?.name || "Unassigned";
}
