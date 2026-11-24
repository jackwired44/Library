// The live HubSpot feed (lib/hubspotSync.ts): the read-only guard, and what
// a real HubSpot payload turns into.
//
// Per Jack: "can we connect hubspot to make sure to flag or scratch a lead
// off from download or search if they are in deals in hubspot or an active
// client" + "even if it is a lost", then "remove anyone like this, this is
// an active deal."
import { isHubspotReadOnlyTool, getHubspotMcp, pullHubspotEngagements } from "../../src/lib/hubspotSync";
import { buildEngagementIndex, engagementsFor, isWon } from "../../src/lib/engagements";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };

/* ------------------------------------------------------------- the guard */

const READS = ["search_crm_objects", "get_crm_objects", "get_properties", "search_properties", "discover_hubspot_schema", "get_user_details"];
// HubSpot's writes are named manage_*, import-* and the like — none of which
// a "looks like a read" regex would catch, which is why this is an
// allowlist. query_crm_data is absent on purpose: Jack's connector refuses
// it ("requires additional permissions"), so nothing should call it.
const WRITES = ["manage_crm_objects", "manage_blog_post", "manage_landing_page", "manage_website_page",
  "manage_campaign_objects", "manage_segment", "manage_saved_reports", "manage_social_posts",
  "manage_aeo_prompts", "manage_aeo_recommendations", "manage_onboarding", "import-claude-design-from-url",
  "crm_property_history", "query_crm_data", "render_asset", "show_feedback_form"];
for (const t of READS) ok(`read allowed: ${t}`, isHubspotReadOnlyTool(t));
for (const t of WRITES) ok(`write blocked: ${t}`, !isHubspotReadOnlyTool(t));
ok("a prefixed tool name still resolves", isHubspotReadOnlyTool("hubspot_search_crm_objects"));
ok("a prefixed write is still blocked", !isHubspotReadOnlyTool("hubspot_manage_crm_objects"));

/* ---------------------------------------------- the guard on a live handle */

const URL_T = "https://app.hubspot.com/contacts/343411302/record/0-2/{id}";
// Shape copied from a real search_crm_objects response, observed 2026-11-24.
// Page 1 fills, page 2 is short, so paging has to stop on its own.
const PAGE1 = Array.from({ length: 100 }, (_, i) => ({
  id: 1000 + i,
  properties: { name: `Filler ${i}`, domain: `filler${i}.com`, lifecyclestage: "opportunity", num_associated_deals: "1", createdate: "2026-11-23T18:39:55.663Z" },
}));
const PAGE2 = [
  { id: 233650406368, properties: { name: "EnergyWorks", domain: "energyworksusa.com", lifecyclestage: "opportunity", num_associated_deals: "1", createdate: "2026-11-23T18:39:55.663Z" } },
  // No domain at all — real, and the reason engagementsFor keeps a company
  // name fallback.
  { id: 233453383640, properties: { name: "SpaceGuard", lifecyclestage: "opportunity", num_associated_deals: "2", createdate: "2026-11-23T15:59:14.925Z" } },
  { id: 9001, properties: { name: "Old Customer", domain: "oldcustomer.com", lifecyclestage: "customer", num_associated_deals: "3", createdate: "2026-02-01T10:00:00.000Z" } },
  // Jack: "even if it is a lost" — a company whose only deal is lost still
  // comes back, because the filter is on having a deal at all.
  { id: 9002, properties: { name: "Lost Lead Co", domain: "lostlead.com", lifecyclestage: "other", num_associated_deals: "1", createdate: "2026-05-05T10:00:00.000Z" } },
];

const seen: { tool: string; input: any }[] = [];
let page = 0;
(globalThis as any).window = {
  claude: {
    use: async (n: string) => n === "permissions" ? null : ({
      listTools: async () => ({ servers: [{ server: "HubSpot", tools: [{ name: "search_crm_objects" }, { name: "manage_crm_objects" }] }] }),
      callTool: async (_s: string, t: string, input: any) => {
        seen.push({ tool: t, input });
        const results = page++ === 0 ? PAGE1 : PAGE2;
        return { payload: { results, total: 104, offset: (input.offset || 0) + results.length, urlTemplate: URL_T } };
      },
    }),
  },
};

const mcp = await getHubspotMcp();
let refused: any = null;
try { await mcp!.callTool("HubSpot", "manage_crm_objects", {}); } catch (e) { refused = e; }
ok("a HubSpot write is refused before it leaves the page",
  refused?.code === "write_blocked" && !seen.some((c) => c.tool === "manage_crm_objects"), JSON.stringify(refused));

/* ----------------------------------------------------------- what it reads */

const pull = await pullHubspotEngagements();
ok("it pages until a short page", page === 2, `pages ${page}`);
ok("it read 104 companies", pull.rows.length === 104, String(pull.rows.length));
ok("it did not stop early", !pull.truncated);

const q = seen.find((c) => c.tool === "search_crm_objects")!.input;
ok("it asks for COMPANY", q.objectType === "COMPANY");
// Two groups, not two filters in one: HubSpot ANDs filters inside a group
// and ORs the groups, so a customer with no deal record must still return.
ok("has-a-deal OR is-a-customer, as two filter groups", q.filterGroups?.length === 2
  && q.filterGroups[0].filters[0].propertyName === "num_associated_deals"
  && q.filterGroups[1].filters[0].value === "customer", JSON.stringify(q.filterGroups));
ok("it asks for the properties the lock matches on",
  ["name", "domain", "lifecyclestage"].every((p) => q.properties.includes(p)));

const by = (name: string) => pull.rows.find((r) => r.company === name)!;
ok("every row is a hubspot engagement", pull.rows.every((r) => r.source === "hubspot"));
ok("an open deal reads as one", by("EnergyWorks").stage === "Open deal", by("EnergyWorks").stage);
ok("a domainless company is still kept", !!by("SpaceGuard") && by("SpaceGuard").domain === "");
ok("more than one deal is counted", by("SpaceGuard").stage === "Open deal (2)", by("SpaceGuard").stage);
ok("a lost-only deal still blocks the company", !!by("Lost Lead Co"));
ok("a customer reads as won", isWon(by("Old Customer")), by("Old Customer").stage);
ok("an open deal does not read as won", !isWon(by("EnergyWorks")));
ok("the date is a plain day", by("EnergyWorks").at === "2026-11-23", by("EnergyWorks").at);
ok("it links back to the record", by("EnergyWorks").url === URL_T.replace("{id}", "233650406368"), by("EnergyWorks").url);
// A company record names no single person, so the email is left blank
// rather than guessed from the domain.
ok("no contact email is invented", pull.rows.every((r) => r.email === "" && r.contact === ""));

/* ------------------------------------------------- and what it then blocks */

const idx = buildEngagementIndex(pull.rows);
const match = (email: string, company: string) => engagementsFor({ email, company } as any, idx);
ok("a lead on the deal's domain is caught", match("sam@energyworksusa.com", "Energy Works LLC")?.how === "domain");
ok("a domainless company is caught by name", match("", "SpaceGuard")?.how === "company");
ok("a lead at the lost-deal company is caught", !!match("bo@lostlead.com", "Lost Lead Co"));
ok("an unrelated lead is not caught", match("nobody@freshprospect.com", "Fresh Prospect") === null);
// Company-wide is deliberate: once a company is on a deal, nobody there is
// cold-called again, not just the one contact on the deal.
ok("a colleague at the same company is caught too", !!match("other@energyworksusa.com", "EnergyWorks"));
// A free provider must never block every gmail.com lead at once.
ok("a free email domain never blocks", match("someone@gmail.com", "No Such Company Ltd") === null);

console.log(`\n${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
