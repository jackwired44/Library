// The post-login landing page — a navigation hub + brief orientation, not a
// module of its own. First pass per Jack: "need to start somewhere then fine
// tune." Doesn't read or write any app state beyond the counts it's handed;
// every module it links to is untouched.
type NavView = "scanner" | "history" | "library" | "engage" | "lists";

interface HomeProps {
  onNavigate: (view: NavView) => void;
  onOpenCheatSheet: () => void;
  libraryCount: number;
  historyCount: number;
  tasksOpenCount: number;
  contactsCount: number;
  listsCount: number;
}

interface ModuleTile {
  key: string;
  icon: string;
  title: string;
  description: string;
  action: () => void;
  stat?: string;
}

export default function Home({ onNavigate, onOpenCheatSheet, libraryCount, historyCount, tasksOpenCount, contactsCount, listsCount }: HomeProps) {
  const tiles: ModuleTile[] = [
    {
      key: "scanner",
      icon: "🔎",
      title: "Scanner",
      description: "Upload a lead export and auto-triage it into Strong Signal, Needs Review, and Bad Leads by Dynamics 365 / M365 / Azure signal.",
      action: () => onNavigate("scanner"),
    },
    {
      key: "library",
      icon: "📚",
      title: "Lead Library",
      description: "The source of truth. Every Strong Signal lead, filed by month and category — the one place all of it lives.",
      action: () => onNavigate("library"),
      stat: `${libraryCount} file${libraryCount === 1 ? "" : "s"}`,
    },
    {
      key: "lists",
      icon: "🗂️",
      title: "Lists",
      description: "Hand-pick specific leads from a scan — any tier — into your own named lists, downloadable as CSV any time.",
      action: () => onNavigate("lists"),
      stat: `${listsCount} list${listsCount === 1 ? "" : "s"}`,
    },
    {
      key: "engage",
      icon: "🤝",
      title: "Engage",
      description: "Contacts (every person from any upload, deduplicated) and a day-by-day task board — schedule and prioritize outbound follow-ups.",
      action: () => onNavigate("engage"),
      stat: `${contactsCount} contact${contactsCount === 1 ? "" : "s"}${tasksOpenCount > 0 ? ` · ${tasksOpenCount} open task${tasksOpenCount === 1 ? "" : "s"}` : ""}`,
    },
    {
      key: "history",
      icon: "🕘",
      title: "History",
      description: "Every past upload, searchable and reloadable back into the Scanner.",
      action: () => onNavigate("history"),
      stat: `${historyCount} upload${historyCount === 1 ? "" : "s"}`,
    },
    {
      key: "cheatsheet",
      icon: "📋",
      title: "Cheat Sheet",
      description: "What each Detected badge means and how the rules decide it — reference, plus where the rule tuning lives.",
      action: onOpenCheatSheet,
    },
  ];

  return (
    <div>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "16px 20px",
          marginBottom: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: "0 0 3px", fontSize: 19 }}>Welcome back, Jack.</h1>
          <p style={{ margin: 0, maxWidth: 560, fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>
            The <strong style={{ color: "var(--ink)" }}>Lead Library</strong> is the single source of truth for every qualified
            lead — the first step toward a lighter-weight, self-hosted CRM built solely for outbound sales.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: "Lead Library", value: libraryCount },
            { label: "Contacts", value: contactsCount },
            { label: "Open tasks", value: tasksOpenCount },
            { label: "Uploads", value: historyCount },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                background: "var(--surface-sunken)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "6px 12px",
                textAlign: "center",
                minWidth: 68,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)", lineHeight: 1.2 }}>{s.value}</div>
              <div style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>Modules</h2>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
        {tiles.map((t) => (
          <button
            key={t.key}
            onClick={t.action}
            style={{
              textAlign: "left",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 9,
              padding: "13px 14px 11px",
              display: "flex",
              flexDirection: "column",
              gap: 5,
              cursor: "pointer",
              minHeight: 108,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 17 }} aria-hidden="true">{t.icon}</span>
              {t.stat && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--muted)",
                    background: "var(--surface-sunken)",
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    padding: "1px 8px",
                  }}
                >
                  {t.stat}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>{t.title}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45, flex: 1 }}>{t.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
