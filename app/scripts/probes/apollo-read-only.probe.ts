// Per Jack: "nothing should be pushed to apollo make a rule". Every Apollo
// call goes through getMcp(), which only lets read tools through.
import { isApolloReadOnlyTool, getMcp } from "../../src/lib/apolloEnrich";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };

const READS = ["apollo_contacts_search", "apollo_emailer_campaigns_search", "apollo_people_match", "apollo_people_bulk_match",
  "apollo_organizations_enrich", "apollo_organizations_bulk_enrich", "apollo_emailer_campaigns_show", "apollo_tasks_search"];
const WRITES = ["apollo_contacts_create", "apollo_contacts_update", "apollo_contacts_bulk_create", "apollo_accounts_create",
  "apollo_emailer_campaigns_add_contact_ids", "apollo_emailer_campaigns_remove_or_stop_contact_ids", "apollo_emailer_campaigns_approve",
  "apollo_emailer_messages_create", "apollo_emailer_messages_send_now", "apollo_sequences_create", "apollo_sequences_update",
  "apollo_tasks_create", "apollo_tasks_complete", "apollo_tasks_skip", "apollo_tasks_update", "apollo_phone_calls_create",
  "apollo_labels_add_entity_ids_to_label_names", "apollo_deals_create", "apollo_email_account_purchase_create"];
for (const t of READS) ok(`read allowed: ${t}`, isApolloReadOnlyTool(t));
for (const t of WRITES) ok(`write blocked: ${t}`, !isApolloReadOnlyTool(t));

// The guard sits on the live handle, not just the helper.
const calls: string[] = [];
(globalThis as any).window = { claude: { use: async () => ({ listTools: async () => ({ servers: [] }), callTool: async (_s: string, t: string) => { calls.push(t); return { payload: {} }; } }) } };
const mcp = await getMcp();
await mcp!.callTool("Apollo.io", "apollo_contacts_search", {});
let refused: any = null;
try { await mcp!.callTool("Apollo.io", "apollo_emailer_campaigns_add_contact_ids", {}); } catch (e) { refused = e; }
ok("a read goes through", calls.includes("apollo_contacts_search"));
ok("a write is refused before it leaves the page", !calls.includes("apollo_emailer_campaigns_add_contact_ids") && refused?.code === "write_blocked", JSON.stringify(refused));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
