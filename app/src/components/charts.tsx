// A small chart kit for the Home dashboard, built to the dataviz method:
// thin marks with 4px rounded data-ends, hairline axes, a 2px surface gap
// between touching fills, values printed at bar ends (never on every
// point), a hover tooltip on every mark, and a table view on every chart so
// no value is reachable only by hovering.
//
// Colours come from CSS roles on `.viz-root` (styles.css), validated with
// the skill's six-checks script against THIS app's surfaces — white cards
// (light) and #152426 (dark). Light mode warns that aqua and yellow sit
// under 3:1 on white; the relief the method requires is exactly what every
// chart here ships: visible labels plus the table view.
//
// All labels render through React text nodes, never innerHTML — they come
// from CSV headers and sync files.
import { useEffect, useRef, useState } from "react";

/** The element's real pixel width, kept current. Charts draw at this width
 *  so text is always its true size — a fixed viewBox stretched to fill a
 *  card scaled every label with it (measured: ~1.6x on a half-width card). */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  // A callback ref, not a ref object: a chart that starts empty renders no
  // element, and an effect keyed on mount would never see the one that
  // appears later. This observes whatever element is attached, when it is.
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const set = () => setW(Math.floor(el.getBoundingClientRect().width));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

/** 1,284 / 12.9K / 4.2M — compact for display values. */
export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

/* -------------------------------------------------------------- tooltip */

interface Tip { x: number; y: number; value: string; label: string }

function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: { clientX: number; clientY: number } | null, value: string, label: string, el?: Element) => {
    const host = ref.current?.getBoundingClientRect();
    if (!host) return;
    let x: number, y: number;
    if (e) { x = e.clientX - host.left; y = e.clientY - host.top; }
    else { const r = el!.getBoundingClientRect(); x = r.left - host.left + r.width / 2; y = r.top - host.top; }
    setTip({ x, y, value, label });
  };
  const node = tip && (
    <div role="tooltip" style={{
      position: "absolute", left: Math.max(4, tip.x + 12), top: Math.max(4, tip.y - 44),
      background: "var(--viz-tip-bg)", color: "var(--viz-tip-ink)", padding: "6px 9px", borderRadius: 6,
      fontSize: 12, pointerEvents: "none", whiteSpace: "nowrap", zIndex: 5, boxShadow: "var(--sh-md)",
    }}>
      {/* Values lead, labels follow. */}
      <div style={{ fontWeight: 700, fontSize: 13 }}>{tip.value}</div>
      <div style={{ opacity: 0.85 }}>{tip.label}</div>
    </div>
  );
  return { ref, show, hide: () => setTip(null), node };
}

/* ---------------------------------------------------------------- card */

/** A chart container: title, subtitle, and the table-view toggle every
 *  chart carries. Grows with its content — no fixed height to clip axes. */
export function ChartCard({
  title, sub, children, table, action, wide,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  /** The accessible twin: rows of [label, ...values] with a header. */
  table?: { head: string[]; rows: (string | number)[][] };
  action?: React.ReactNode;
  wide?: boolean;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="viz-card" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <header style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="viz-title">{title}</h3>
          {sub && <div className="viz-sub">{sub}</div>}
        </div>
        {action}
        {table && (
          <button className="viz-toggle" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}
                  title={asTable ? "Show the chart" : "Show the numbers as a table"}>
            {asTable ? "Chart" : "Table"}
          </button>
        )}
      </header>
      {asTable && table ? (
        <table className="viz-table">
          <thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}>{typeof c === "number" ? c.toLocaleString() : c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      ) : children}
    </section>
  );
}

/* ------------------------------------------------------------- KPI tile */

export function KpiTile({
  label, value, sub, trend, onClick, tone,
}: {
  label: string;
  value: string;
  /** What the number is against, e.g. "38% of stored" or "not synced". */
  sub?: string;
  /** Optional 12-point series; the last point is the current period. */
  trend?: number[];
  onClick?: () => void;
  tone?: "muted";
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`viz-kpi${onClick ? " is-link" : ""}`} onClick={onClick}>
      <div className="viz-kpi-label">{label}</div>
      <div className="viz-kpi-value" style={tone === "muted" ? { color: "var(--viz-ink-3)" } : undefined}>{value}</div>
      {sub && <div className="viz-kpi-sub">{sub}</div>}
      {trend && trend.length > 1 && <Sparkline values={trend} />}
    </Tag>
  );
}

export function Sparkline({ values }: { values: number[] }) {
  const w = 120, h = 28, pad = 3;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [pad + (i * (w - 2 * pad)) / (values.length - 1), h - pad - (v / max) * (h - 2 * pad)]);
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: "block", marginTop: 6 }}>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--viz-deemph)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={4} fill="var(--series-1)" stroke="var(--viz-surface)" strokeWidth={2} />
    </svg>
  );
}

/* ------------------------------------------------------- horizontal bars */

export interface BarRow { key: string; label: string; value: number; group?: string; onClick?: () => void; hint?: string }

/**
 * Horizontal bars, one series, one colour (slot 1) — nominal categories are
 * never coloured by value. Value printed at each bar's tip; the bar row is
 * the hover/click target, not just the painted pixels.
 */
export function BarList({ rows, max, color = SERIES[0], format = (n: number) => n.toLocaleString(), empty }: {
  rows: BarRow[];
  max?: number;
  color?: string;
  format?: (n: number) => string;
  empty?: string;
}) {
  const tip = useTip();
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="viz-empty">{empty ?? "Nothing to show yet."}</div>;
  let lastGroup: string | undefined;
  return (
    <div ref={tip.ref} style={{ position: "relative" }}>
      {rows.map((r) => {
        const head = r.group && r.group !== lastGroup ? r.group : null;
        lastGroup = r.group;
        const pct = top > 0 ? (r.value / top) * 100 : 0;
        const Row = r.onClick ? "button" : "div";
        return (
          <div key={r.key}>
            {head && <div className="viz-group">{head}</div>}
            <Row
              className={`viz-barrow${r.onClick ? " is-link" : ""}`}
              onClick={r.onClick}
              onPointerMove={(e) => tip.show(e, format(r.value), r.hint ?? r.label)}
              onPointerLeave={tip.hide}
              onFocus={(e) => tip.show(null, format(r.value), r.hint ?? r.label, e.currentTarget)}
              onBlur={tip.hide}
            >
              <span className="viz-barlabel">{r.label}</span>
              <span className="viz-bartrack">
                <span className="viz-bar" style={{ width: `${pct}%`, minWidth: r.value > 0 ? 3 : 0, background: color }} />
                <span className="viz-barvalue">{format(r.value)}</span>
              </span>
            </Row>
          </div>
        );
      })}
      {tip.node}
    </div>
  );
}

/* ---------------------------------------------------- stacked horizontal */

export interface StackRow { key: string; label: string; parts: number[] }

/**
 * Part-to-whole per row, up to four series in the fixed slot order, with a
 * 2px surface gap between segments and a legend always present. A segment
 * too narrow for its number shows none — the tooltip and the table carry it.
 */
export function StackedBars({ rows, series }: { rows: StackRow[]; series: string[] }) {
  const tip = useTip();
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((a, b) => a + b, 0)));
  return (
    <div ref={tip.ref} style={{ position: "relative" }}>
      <Legend series={series} />
      {rows.map((r) => {
        const total = r.parts.reduce((a, b) => a + b, 0);
        return (
          <div key={r.key} className="viz-barrow">
            <span className="viz-barlabel">{r.label}</span>
            <span className="viz-bartrack">
              <span style={{ display: "flex", gap: 2, width: `${(total / max) * 100}%`, minWidth: total ? 3 : 0 }}>
                {r.parts.map((v, i) => v > 0 && (
                  <span
                    key={i}
                    className="viz-seg"
                    tabIndex={0}
                    style={{ flex: v, background: SERIES[i] }}
                    onPointerMove={(e) => tip.show(e, v.toLocaleString(), `${r.label} · ${series[i]}`)}
                    onPointerLeave={tip.hide}
                    onFocus={(e) => tip.show(null, v.toLocaleString(), `${r.label} · ${series[i]}`, e.currentTarget)}
                    onBlur={tip.hide}
                  />
                ))}
              </span>
              <span className="viz-barvalue">{total.toLocaleString()}</span>
            </span>
          </div>
        );
      })}
      {tip.node}
    </div>
  );
}

export function Legend({ series }: { series: string[] }) {
  return (
    <div className="viz-legend">
      {series.map((s, i) => (
        <span key={s} className="viz-legend-item">
          <i style={{ background: SERIES[i] }} />{s}
        </span>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- columns */

/**
 * One series over time: columns <=24px wide, 4px rounded tops, square at a
 * hairline baseline, clean y ticks. Labels only the latest and the peak —
 * never every column. `highlightFrom` tints the columns inside the active
 * date filter so the context weeks read as context.
 */
export function ColumnChart({ points, height = 170, highlightFrom, empty }: {
  points: { key: string; label: string; value: number; long?: string }[];
  height?: number;
  highlightFrom?: string;
  /** Shown instead of an empty plot when every value is zero. */
  empty?: string;
}) {
  const tip = useTip();
  const [box, measured] = useWidth<HTMLDivElement>();
  if (empty && points.every((p) => p.value === 0)) return <div className="viz-empty">{empty}</div>;
  const w = Math.max(280, measured || points.length * 44);
  const padL = 34, padB = 22, padT = 18;
  const plotH = height - padB - padT;
  const raw = Math.max(1, ...points.map((p) => p.value));
  const step = niceStep(raw);
  const top = Math.ceil(raw / step) * step;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const band = (w - padL) / Math.max(1, points.length);
  const barW = Math.min(24, band * 0.6);
  const peak = points.reduce((m, p, i) => (p.value > points[m].value ? i : m), 0);
  return (
    <div ref={(el) => { (tip.ref as React.MutableRefObject<HTMLDivElement | null>).current = el; box(el); }}
         style={{ position: "relative" }}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ display: "block" }} role="img"
           aria-label={points.map((p) => `${p.long ?? p.label}: ${p.value}`).join("; ")}>
        {ticks.map((t) => {
          const y = padT + plotH - (t / top) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={w} y1={y} y2={y} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
              <text x={padL - 6} y={y + 4} textAnchor="end" className="viz-tick">{compact(t)}</text>
            </g>
          );
        })}
        {points.map((p, i) => {
          const x = padL + i * band + (band - barW) / 2;
          const hgt = (p.value / top) * plotH;
          const y = padT + plotH - hgt;
          const r = Math.min(4, hgt / 2);
          const inRange = !highlightFrom || p.key >= highlightFrom;
          const showLabel = p.value > 0 && (i === points.length - 1 || i === peak);
          return (
            <g key={p.key}>
              {/* The whole band is the hit target, not just the column. */}
              <rect
                x={padL + i * band} y={padT} width={band} height={plotH} fill="transparent" tabIndex={0}
                onPointerMove={(e) => tip.show(e, p.value.toLocaleString(), p.long ?? p.label)}
                onPointerLeave={tip.hide}
                onFocus={(e) => tip.show(null, p.value.toLocaleString(), p.long ?? p.label, e.currentTarget)}
                onBlur={tip.hide}
              />
              {hgt > 0 && (
                <path
                  d={`M${x},${y + hgt} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + hgt} Z`}
                  fill={inRange ? "var(--series-1)" : "var(--viz-deemph)"}
                  pointerEvents="none"
                />
              )}
              {showLabel && (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" className="viz-collabel">{compact(p.value)}</text>
              )}
              <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="viz-tick">{p.label}</text>
            </g>
          );
        })}
      </svg>
      {tip.node}
    </div>
  );
}

function niceStep(max: number): number {
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, rough)));
  const n = rough / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}
