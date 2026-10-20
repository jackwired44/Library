// Bundles the ten platform agents into the Vault's Agents tab.
//
// Per Jack: "i want to see a overview of the agents and their work so make a
// tab at the bottom left so i can view them and there work approve stuff
// and pause". The agents run in Claude Code sessions (/platform-review), not
// inside the page, so their definitions and latest reports are copied in
// at build time from:
//   ../.claude/agents/<name>.md          (frontmatter + rules)
//   ../.claude/agent-reports/<name>.json (latest report, written by
//                                         /platform-review)
//   ../.claude/agent-state.json          (paused agents, decisions Claude
//                                         has already acted on)
// into src/agents.generated.json. Runs before every build.
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..', '..', '.claude');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const json = (p, d) => { try { return JSON.parse(read(p)); } catch { return d; } };

const agentsDir = path.join(root, 'agents');
const files = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort() : [];
const agents = files.map((f) => {
  const text = read(path.join(agentsDir, f));
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text) || [null, '', text];
  const meta = Object.fromEntries(m[1].split('\n').map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }).filter(([k]) => k));
  const body = m[2];
  // The agent's own section, before the shared standing rules.
  const scope = body.split('## Standing rules')[0].replace(/^# .*\n/, '').trim();
  const name = meta.name || f.replace(/\.md$/, '');
  return {
    name,
    description: meta.description || '',
    tools: (meta.tools || '').split(',').map((t) => t.trim()).filter(Boolean),
    scope,
    report: json(path.join(root, 'agent-reports', `${name}.json`), null),
  };
});
const state = json(path.join(root, 'agent-state.json'), { paused: [], acted: [] });
const standing = (() => { const t = files.length ? read(path.join(agentsDir, files[0])) : ''; const i = t.indexOf('## Standing rules'); const j = t.indexOf('## Report format'); return i >= 0 ? t.slice(i, j > i ? j : undefined).trim() : ''; })();
const out = { generatedAt: new Date().toISOString(), standingRules: standing, state, agents };
fs.writeFileSync(path.join(__dirname, '..', 'src', 'agents.generated.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`agents-sync: ${agents.length} agents, ${agents.filter((a) => a.report).length} with a report`);
