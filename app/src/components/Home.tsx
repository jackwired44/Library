// The post-login landing page — a navigation hub + brief orientation, not a
// module of its own. First pass per Jack: "need to start somewhere then fine
// tune." Doesn't read or write any app state beyond the counts it's handed;
// every module it links to is untouched.
type NavView = "scanner" | "history" | "library" | "engage";

interface HomeProps {
  onNavigate: (view: NavView) => void;
  onOpenCheatSheet: () => void;
  libraryCount: number;
  historyCount: number;
  tasksOpenCount: number;
  contactsCount: number;
}

interface ModuleTile {
  key: string;
  icon: string;
  title: string;
  description: string;
  action: () => void;
  stat?: string;
}

export default function Home({ onNavigate, onOpenCheatSheet, libraryCount, historyCount, tasksOpenCount, contactsCount }: HomeProps) {
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
    <div style={{ paddingTop: 4 }}>
      <div
        style={{
          background: "linear-gradient(135deg, var(--ink), #16414a)",
          borderRadius: 18,
          padding: "36px 34px",
          color: "#fff",
          marginBottom: 28,
        }}
      >
        <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#7fd9bc", marginBottom: 10 }}>
          Wired CIO Lead Scanner
        </div>
        <h1 style={{ margin: "0 0 12px", fontSize: 28, color: "#fff" }}>Welcome back.</h1>
        <p style={{ margin: 0, maxWidth: 640, fontSize: 14.5, lineHeight: 1.6, color: "#d7e6e3" }}>
          This is the lead command center — a Scanner that triages raw exports into qualified opportunities, and a{" "}
          <strong style={{ color: "#fff" }}>Lead Library that's the single source of truth</strong> for every one of them. It's the first
          step toward a lighter-weight, self-hosted CRM built solely for outbound sales — calling, emailing, and sequencing — not a
          general sales platform. Start somewhere, then fine-tune.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Modules</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Jump into any of them below</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
        {tiles.map((t) => (
          <button
            key={t.key}
            onClick={t.action}
            style={{
              textAlign: "left",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: "18px 18px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              cursor: "pointer",
              minHeight: 148,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 22 }} aria-hidden="true">{t.icon}</span>
              {t.stat && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: "var(--muted)",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 999,
                    padding: "2px 9px",
                  }}
                >
                  {t.stat}
                </span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{t.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5, flex: 1 }}>{t.description}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1a8f6f" }}>Open →</div>
          </button>
        ))}
      </div>
    </div>
  );
}
