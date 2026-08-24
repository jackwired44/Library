// Persistence for the user-editable layer on top of the detection engine
// (see detection.ts RuleOverrides, and CLAUDE.md). One record, fixed id,
// same "single row" pattern as any other app-wide setting would use in
// this IndexedDB.
import { dbGetAll, dbPut, STORE_RULE_OVERRIDES } from "./db";
import { DEFAULT_RULE_OVERRIDES, type RuleOverrides, type CategoryKey } from "./detection";

const RECORD_ID = "rules";

export async function loadRuleOverrides(): Promise<RuleOverrides> {
  const rows = await dbGetAll<RuleOverrides & { id: string }>(STORE_RULE_OVERRIDES);
  const stored = rows.find((r) => r.id === RECORD_ID);
  if (!stored) return DEFAULT_RULE_OVERRIDES;
  // Defensive merge — an older/partial record (or a future field Jack
  // hasn't set yet) should never leave a category's keyword list undefined.
  return {
    qualifyThreshold: typeof stored.qualifyThreshold === "number" ? stored.qualifyThreshold : DEFAULT_RULE_OVERRIDES.qualifyThreshold,
    customKeywords: {
      dynamics365: stored.customKeywords?.dynamics365 ?? [],
      dataPlatform: stored.customKeywords?.dataPlatform ?? [],
      m365Tenant: stored.customKeywords?.m365Tenant ?? [],
    },
  };
}

export async function persistRuleOverrides(overrides: RuleOverrides): Promise<void> {
  await dbPut(STORE_RULE_OVERRIDES, { id: RECORD_ID, ...overrides });
}

export function addCustomKeyword(overrides: RuleOverrides, category: CategoryKey, word: string): RuleOverrides {
  const trimmed = word.trim();
  if (!trimmed) return overrides;
  const existing = overrides.customKeywords[category];
  if (existing.some((w) => w.toLowerCase() === trimmed.toLowerCase())) return overrides;
  return { ...overrides, customKeywords: { ...overrides.customKeywords, [category]: [...existing, trimmed] } };
}
export function removeCustomKeyword(overrides: RuleOverrides, category: CategoryKey, word: string): RuleOverrides {
  return { ...overrides, customKeywords: { ...overrides.customKeywords, [category]: overrides.customKeywords[category].filter((w) => w !== word) } };
}
export function setQualifyThreshold(overrides: RuleOverrides, value: number): RuleOverrides {
  return { ...overrides, qualifyThreshold: Number.isFinite(value) && value >= 0 ? Math.round(value) : overrides.qualifyThreshold };
}
