// The "Detected" column reference — what each badge/chip in the Scanner and
// Library actually means. Legacy's own version (cheatSheetHtml()) lived in
// the render layer that was deliberately not ported into lib/detection.ts
// (see CLAUDE.md); this is freshly written from the same rules, sourced
// live from detection.ts where possible (QUALIFY_THRESHOLD, the SKU list,
// the Auto-DQ reasons) so it can't quietly drift out of sync with a rule
// change the way a hand-copied description could.
import { useState } from "react";
import { ACTIVE_CATEGORY_KEYS, CATEGORY_META, SKU_CATALOGUE, DQ_RULES, type CategoryKey, type RuleOverrides } from "../lib/detection";
import { addCustomKeyword, removeCustomKeyword, setQualifyThreshold } from "../lib/ruleOverrides";

interface CheatSheetProps {
  onClose: () => void;
  ruleOverrides: RuleOverrides;
  onChangeRuleOverrides: (next: RuleOverrides) => void;
  // Present only when opened from the combined Platform Notes/Cheat Sheet
  // entry point (see PlatformNotes.tsx) — renders a small tab strip so you
  // can flip back to Notes without closing. Absent = no tab strip, same as
  // before this shared shell existed.
  onSwitchToNotes?: () => void;
}

export default function CheatSheet({ onClose, ruleOverrides, onChangeRuleOverrides, onSwitchToNotes }: CheatSheetProps) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(8,30,34,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px", zIndex: 50, overflowY: "auto" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, maxWidth: 760, width: "100%", padding: "28px 30px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
      >
        {onSwitchToNotes && (
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            <button onClick={onSwitchToNotes} style={{ border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 700, background: "#F4F6F7", color: "#5b6b72", cursor: "pointer" }}>
              Platform Notes
            </button>
            <button disabled style={{ border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 700, background: "#081E22", color: "#fff" }}>
              Cheat Sheet
            </button>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 19 }}>Cheat Sheet — what "Detected" means</h2>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 20, color: "#4c6167", cursor: "pointer" }}>✕</button>
        </div>
        <p style={{ color: "#4c6167", fontSize: 13, marginTop: 0, marginBottom: 20 }}>
          Two independent engines run over every row and combine into one result. Reassign or re-tier any row manually any
          time — this is what the auto-detection is doing before you touch it. The threshold and extra trigger words below
          are yours to edit; everything else here is the fixed rule set built into the app.
        </p>

        <Section title="🔥 Hot signals right now">
          <p style={{ marginBottom: 8 }}>
            These clear a category match AND jump straight to Strong Signal on their own — no trigger word or seat count
            needed on top:
          </p>
          <ul style={{ margin: "0 0 6px", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 5 }}>
            <li><strong>Azure Document Intelligence</strong> mentions — M365 / Azure.</li>
            <li><strong>Full custom app build on Azure</strong> — M365 / Azure.</li>
            <li><strong>Google → Microsoft migration</strong> language — M365 / Azure (also lands in the "Google → Microsoft" view tab, see below).</li>
            <li><strong>MSP / CSP / full partner-engagement</strong> language — including plain "partner engagement" or "full engagement" phrasing, not just "bring in a partner" — M365 / Azure.</li>
            <li><strong>Security design / architecture / hardening</strong> language — M365 / Azure (this one also creates the category match on its own, same footing as "IT support"/"help desk").</li>
          </ul>
          <p style={{ margin: 0, color: "#9aa1ac", fontSize: 12 }}>
            Everything else still needs a trigger word, a stated seat count, or (Dynamics only) a bare number sitting next
            to the match — see each category below.
          </p>
        </Section>

        <Section title="Licensing — Microsoft SKUs">
          <p>
            Looks for any of {SKU_CATALOGUE.length} Microsoft SKU patterns. A <strong>Strong Signal</strong> requires a
            confirmed seat/user/license count at or above the threshold below. A confirmed count under that threshold
            routes straight to Bad Leads — it's never silently dropped.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 12px" }}>
            <label style={{ fontWeight: 700, fontSize: 12.5 }}>Qualify threshold:</label>
            <input
              type="number"
              min={0}
              value={ruleOverrides.qualifyThreshold}
              onChange={(e) => onChangeRuleOverrides(setQualifyThreshold(ruleOverrides, Number(e.target.value)))}
              style={{ width: 70, border: "1px solid #D8DBE1", borderRadius: 7, padding: "5px 8px", fontSize: 13, fontWeight: 700 }}
            />
            <span style={{ fontSize: 11.5, color: "#9aa1ac" }}>seats/users — a confirmed count below this is a Bad Lead, not silently dropped</span>
          </div>
          <ChipList items={SKU_CATALOGUE.map((s) => s.label)} />
        </Section>

        <Section title="Platform — two product-line buckets">
          <p>Every row also gets checked against two independent product-line buckets. When a row matches both, the auto-default picks in this order (always manually reassignable regardless):</p>
          <ol style={{ margin: "8px 0 14px", paddingLeft: 20 }}>
            {ACTIVE_CATEGORY_KEYS.map((k) => (
              <li key={k} style={{ marginBottom: 4 }}>
                <CategoryBadge k={k} />
              </li>
            ))}
          </ol>
          <CategoryDetail k="dynamics365">
            Dynamics 365/D365/CRM/AX/NAV/GP, Business Central, Finance and Operations, Customer Engagement, Supply Chain
            Management, bare "ERP". Strong Signal if ERP+CRM are mentioned together, OR a specific product/module is named
            with a real or estimated count, OR any generic trigger word is present, OR a bare number sits next to the match.
            Ranked greatest-to-smallest by stated seat count once scanned — Business Central/ERP leads first, then Sales/
            CRM leads, then everything else, each block ranked by count within itself.
            <KeywordEditor category="dynamics365" ruleOverrides={ruleOverrides} onChangeRuleOverrides={onChangeRuleOverrides} />
          </CategoryDetail>
          <CategoryDetail k="m365Tenant">
            The merged bucket — everything that isn't a Dynamics 365 opportunity: Azure, Power BI, Microsoft Fabric, Google→
            Microsoft migrations, tenant support, licensing, Azure billing, CSP/MSP/partner engagement, ongoing support, and
            security-hardening asks. Tightened qualification on the product-specific halves — a bare product mention no
            longer counts:
            <br />
            <strong>Power BI</strong> only counts when there's language about actually bringing in a partner, vendor,
            consultant, reseller, MSP, or CSP for it — "we want better dashboards" alone does not qualify anymore.
            <br />
            <strong>Azure</strong> counts for: an on-prem-to-cloud migration, Azure billing/cost language, looking for a
            partner/CSP to route that billing through, Azure Document Intelligence, or a full custom-app build on Azure
            (the last two are hot right now). Generic "VMs/usage/adoption" scale language still doesn't qualify on its own.
            <br />
            <strong>Microsoft Fabric</strong> ("Microsoft Fabric" or "OneLake" only) no longer qualifies on a bare
            mention either — it only counts when it ties into a larger project: an Azure tie-in, custom app/solution
            development, or (Azure) Document Intelligence specifically.
            <br />
            <strong>Migration / Modernization</strong> (generic data migration/legacy-system/re-platforming/lift-and-
            shift language) no longer qualifies on a bare mention either, same bar as Power BI — it needs partner/
            vendor/consultant/MSP/CSP language nearby to count as a hit at all. A trigger word like "budget" or "this
            year" next to bare legacy-system language is not enough on its own anymore.
            <br />
            <strong>Tenant Support / Licensing</strong> — Google→Microsoft migration, new tenant setup, MSP/co-managed
            IT/full partner engagement language, security design/architecture/hardening work, plain "IT support"/"help
            desk", and Licensing hits with no specific product angle. Strong Signal auto-promotes on Google→Microsoft
            migration language, MSP/CSP/partner-engagement language, security design/hardening language, or a stated
            seat/user count nearby — a bare "IT support"/"help desk" mention, a generic trigger word like "upgrade" or
            "budget," or a stray number that isn't actually a seat count (a support ticket ID, a software version) no
            longer promotes anything on their own. Dynamics 365 is the one category a bare trigger word or a bare
            number next to the match can still promote on its own — that's an original, documented Dynamics rule, not
            a loophole.
            <br />
            <strong>Auto-DQ override:</strong> a small one-off project or a request for free consultancy/advice — "quick
            question," "no budget," "pick your brain" — is a Bad Lead regardless of category, even if it otherwise reads
            as a match. The goal here is always a longer-term partner engagement, not a one-off job.
            <KeywordEditor category="m365Tenant" ruleOverrides={ruleOverrides} onChangeRuleOverrides={onChangeRuleOverrides} />
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: "#9aa1ac", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
                Extra Power BI / Azure trigger words
              </div>
              <div style={{ fontSize: 12, color: "#4c6167", marginBottom: 4 }}>
                Tagged separately from the words above, but files into this same M365 / Azure bucket.
              </div>
              <KeywordEditor category="dataPlatform" ruleOverrides={ruleOverrides} onChangeRuleOverrides={onChangeRuleOverrides} />
            </div>
          </CategoryDetail>
        </Section>

        <Section title="How each category breaks down further (View tabs)">
          <p style={{ marginBottom: 10 }}>
            Once a category filter is active in Scanner or a Lead Library file, a "View:" row of tabs slices it further —
            purely for browsing/filtering. It never changes what's downloaded, filed, or which of the two categories a lead
            counts toward.
          </p>
          <CategoryDetail k="dynamics365">
            <strong>Four tabs, always: All Dynamics 365 · Business Central / ERP · Sales / CRM · Everything else.</strong>
            <br />
            <strong>Business Central / ERP</strong> — a row mentions "Business Central" or bare "ERP." This is the same
            tier-0 module ranking (highest-priority Dynamics leads, always shown first).
            <br />
            <strong>Sales / CRM</strong> — a row mentions "Sales" or "CRM" and does <em>not</em> also hit Business
            Central/ERP — the two tabs are mutually exclusive; BC/ERP always wins if a row hits both.
            <br />
            <strong>Everything else</strong> — every other Dynamics hit: Finance and Operations, Supply Chain Management,
            Customer Engagement/Insights, Field Service, Marketing, Project Operations, Human Resources, and anything with
            no specific module named.
          </CategoryDetail>
          <CategoryDetail k="m365Tenant">
            <strong>Three tabs, always: All M365/Azure · Google → Microsoft · Everything else.</strong>
            <br />
            <strong>Google → Microsoft</strong> — literal Google Workspace→Microsoft 365 migration language, PLUS any
            other Migration/Modernization-category hit (those already require partner-engagement language to count at
            all, so they're already Strong Signal), PLUS Azure hits qualified specifically via on-prem-to-cloud migration
            language. Azure billing/CSP hits and security-design hits do NOT land here even though they're Strong Signal —
            they stay in Everything else.
            <br />
            <strong>Everything else</strong> — every other M365/Azure hit: Azure billing/CSP, Document Intelligence, app
            builds, security design/hardening, tenant support, and plain licensing.
          </CategoryDetail>
        </Section>

        <Section title="Auto-DQ — Bad Leads">
          <p>Cross-cutting, applies on top of whatever category/tier a row would otherwise get, always wins. Still fully visible and reversible — just excluded from the three CSV downloads.</p>
          <ChipList items={DQ_RULES.map((r) => r.label)} tone="dq" />
        </Section>

        <Section title="Duplicates">
          <p>Exact match on full name + company (case/whitespace-insensitive, no fuzzy matching), scoped to just the current import — not checked against the Library or History. Rows are flagged, never auto-removed.</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 11.5, color: "#8b93a0", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#1B2430", lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function CategoryBadge({ k }: { k: CategoryKey }) {
  const meta = CATEGORY_META[k];
  return <span style={{ fontSize: 11.5, background: meta.bg, color: meta.color, padding: "2px 9px", borderRadius: 20, fontWeight: 700 }}>{meta.label}</span>;
}

function CategoryDetail({ k, children }: { k: CategoryKey; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10, paddingLeft: 2 }}>
      <div style={{ marginBottom: 3 }}><CategoryBadge k={k} /></div>
      <div style={{ color: "#4c6167" }}>{children}</div>
    </div>
  );
}

// Extra plain-text trigger words Jack adds per category — matched as a
// simple substring (never regex), and any match always counts as a Strong
// Signal trigger. Applies to future scans only, not a retroactive
// reclassification of anything already sitting in the Scanner/Library.
function KeywordEditor({
  category,
  ruleOverrides,
  onChangeRuleOverrides,
}: {
  category: CategoryKey;
  ruleOverrides: RuleOverrides;
  onChangeRuleOverrides: (next: RuleOverrides) => void;
}) {
  const [draft, setDraft] = useState("");
  const words = ruleOverrides.customKeywords[category];

  function add() {
    const w = draft.trim();
    if (!w) return;
    onChangeRuleOverrides(addCustomKeyword(ruleOverrides, category, w));
    setDraft("");
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: "#9aa1ac", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Your extra trigger words</div>
      {words.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {words.map((w) => (
            <span key={w} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, background: "#EEF2FF", color: "#3A4B8C", padding: "3px 6px 3px 9px", borderRadius: 20 }}>
              {w}
              <button
                onClick={() => onChangeRuleOverrides(removeCustomKeyword(ruleOverrides, category, w))}
                title={`Remove "${w}"`}
                style={{ border: "none", background: "none", color: "#3A4B8C", cursor: "pointer", fontSize: 12, padding: 0 }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a trigger word or phrase"
          style={{ flex: "1 1 200px", border: "1px solid #E1E4E9", borderRadius: 7, padding: "5px 9px", fontSize: 12 }}
        />
        <button onClick={add} style={{ border: "1px solid #D5D9E0", background: "#fff", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 700 }}>Add</button>
      </div>
    </div>
  );
}

function ChipList({ items, tone }: { items: string[]; tone?: "dq" }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {items.map((label) => (
        <span
          key={label}
          style={{
            fontSize: 11.5,
            background: tone === "dq" ? "#FBEAE8" : "#F6FAFA",
            color: tone === "dq" ? "#B5443B" : "#4c6167",
            padding: "3px 9px",
            borderRadius: 20,
          }}
        >
          {label}
        </span>
      ))}
    </div>
  );
}
