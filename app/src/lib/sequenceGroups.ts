// Sequence groups — folders for sequences, per Jack: "should be able to
// group sequences also." Same shape and spirit as the Lead Library's own
// LibraryGroup (lib/library.ts): a named container that sequences point
// at by id, never a container that owns them.
//
// Deleting a group therefore never deletes the sequences inside it — it
// just ungroups them (`groupId: null`), exactly the rule the Lead
// Library already follows for its folders, so a delete can't silently
// take real work with it.
import { dbGetAll, dbPut, dbDelete, STORE_SEQUENCE_GROUPS } from "./db";

export interface SequenceGroup {
  id: string;
  name: string;
  createdAt: string;
}

function newId() {
  return `seqgroup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadSequenceGroupsFromDB(): Promise<SequenceGroup[]> {
  const all = await dbGetAll<SequenceGroup>(STORE_SEQUENCE_GROUPS);
  return all.sort((a, b) => a.name.localeCompare(b.name));
}
export async function persistSequenceGroup(group: SequenceGroup) {
  await dbPut(STORE_SEQUENCE_GROUPS, group);
}
export async function deleteSequenceGroupFromDB(id: string) {
  await dbDelete(STORE_SEQUENCE_GROUPS, id);
}

export function createSequenceGroup(name: string): SequenceGroup | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return { id: newId(), name: trimmed, createdAt: new Date().toISOString() };
}

export function renameSequenceGroup(group: SequenceGroup, name: string): SequenceGroup {
  return { ...group, name: name.trim() || group.name };
}

export function groupLabel(groups: SequenceGroup[], id: string | null | undefined): string {
  if (!id) return "Ungrouped";
  return groups.find((g) => g.id === id)?.name || "Ungrouped";
}
