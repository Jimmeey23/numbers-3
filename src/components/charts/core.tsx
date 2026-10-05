import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ExportMenu } from '../ExportMenu';
import { svgToPng, useMeasure, usePathDraw } from '../hooks';
import { formatValue, type Fmt } from '../../semantics/formats';
import { TipBody, useTooltip } from '../Tooltip/Tooltip';

import { maxBy } from '../../semantics/stats';

export interface Series { id: string; label: string; color: string; values: (number | null)[]; fmt?: Fmt; axis?: 'left' | 'right'; kind?: 'line' | 'bar' | 'area'; ghost?: boolean }
export interface XYProps { categories: string[]; series: Series[]; height?: number; fmtLeft?: Fmt; fmtRight?: Fmt; stacked?: boolean; onClick?: (i: number) => void; labelEvery?: number; title?: string; tableColumns?: string[] }

const PAD = { l: 56, r: 56, t: 12, b: 28 };

export function niceTicks(max: number, n = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / n; const mag = 10 ** Math.floor(Math.log10(raw)); const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = []; for (let v = 0; v <= max + 1e-9; v += step) out.push(v); return out;
}

export type ViewMode = 'chart' | 'table' | 'data' | 'stats' | 'share';
const VIEW_MODES: { id: ViewMode; label: string; hint: string }[] = [
  { id: 'chart', label: 'Chart', hint: 'The visual' },
  { id: 'table', label: 'Table', hint: 'Every value, sortable and exportable' },
  { id: 'data', label: 'Records', hint: 'The underlying rows behind this chart' },
  { id: 'stats', label: 'Summary', hint: 'Distribution: total, mean, median, range' },
  { id: 'share', label: 'Share', hint: 'Each row as a share of the total' },
];

/** Module wrapper: title, five view modes, export in nine formats, PNG raster. */

/* Plain-English reading of whatever the chart is plotting.
 *
 * Every chart already carries a tabular form of its own data, so the description is derived
 * from that rather than written by hand per chart — which means a chart added later cannot
 * ship without one. It states what is on each axis, where the high and low points are, and
 * which way the series has gone, in the words an operator would use.
 */
function describeChart(table: { columns: string[]; rows: (string | number | null)[][] }, title?: string): string[] {
  const out: string[] = [];
  const [first, ...measures] = table.columns;
  if (!table.rows.length) return ['There is nothing to plot for the current filters.'];
  out.push(
    `Each ${table.rows.length === 1 ? 'entry' : `of the ${table.rows.length.toLocaleString('en-IN')} entries`} along the bottom is one ${(first ?? 'category').toLowerCase()}`
    + (measures.length === 1 ? `, and the height shows ${measures[0].toLowerCase()}.` : `, and the ${measures.length} plotted measures are ${measures.join(', ').toLowerCase()}.`),
  );
  /* Describe the measure that dominates the picture, not whichever happens to be in column
     two — on a ten-series chart the first column is often a minor category, and describing it
     tells the reader about a line they can barely see. */
  const magnitude = table.columns.map((_, i) => (i === 0 ? -1
    : table.rows.reduce((a, r) => a + (typeof r[i] === 'number' ? Math.abs(r[i] as number) : 0), 0)));
  const ci = magnitude.indexOf(Math.max(...magnitude));
  if (ci > 0) {
    const pairs = table.rows
      .map((r) => ({ label: String(r[0] ?? ''), v: typeof r[ci] === 'number' ? (r[ci] as number) : null }))
      .filter((x): x is { label: string; v: number } => x.v !== null && Number.isFinite(x.v));
    if (pairs.length > 1) {
      const top = pairs.reduce((a, b) => (b.v > a.v ? b : a));
      const low = pairs.reduce((a, b) => (b.v < a.v ? b : a));
      const total = pairs.reduce((a, b) => a + b.v, 0);
      out.push(`Taking ${table.columns[ci].toLowerCase()}, the largest measure here: the highest is ${top.label} and the lowest is ${low.label}.`);
      if (total > 0 && top.v > 0) {
        const share = top.v / total;
        if (share > 0.3) out.push(`${top.label} alone is ${Math.round(share * 100)}% of the total shown, so the overall picture largely follows it.`);
      }
      /* Compare the first and last thirds rather than the two end points: the newest column is
         very often a part-month, and a point-to-point reading turns that into a crash. */
      if (pairs.length >= 4) {
        const take = Math.max(1, Math.round(pairs.length / 3));
        const avg = (xs: { v: number }[]) => xs.reduce((a, b) => a + b.v, 0) / xs.length;
        const head = avg(pairs.slice(0, take)); const tail = avg(pairs.slice(-take));
        if (head !== 0) {
          const move = (tail - head) / Math.abs(head);
          out.push(Math.abs(move) >= 0.05
            ? `Comparing the first ${take} ${first.toLowerCase()}${take > 1 ? 's' : ''} shown with the last ${take}, it is running ${Math.abs(move * 100).toFixed(0)}% ${move > 0 ? 'higher' : 'lower'} — the final column may still be a part period.`
            : 'Averaged across the span, it is running at about the same level as it started.');
        }
      }
    }
  }
  out.push('A gap or a dash means the figure could not be worked out for that entry — it does not mean zero. Switch to Data to read the exact numbers behind every point.');
  if (title) out.push(`Only rows matching the current period, location and other filters are included in "${title}".`);
  return out;
}

export function ChartModule({ title, subtitle, children, table, actions, height, records, scopeLine, explain }: {
  title?: string; subtitle?: string; children: ReactNode;
  table: { columns: string[]; rows: (string | number | null)[][] };
  actions?: ReactNode; height?: number;
  /** Overrides the derived plain-English reading where a chart needs saying differently. */
  explain?: string[];
  /** Optional raw rows behind the chart, shown in the Records view. */
  records?: () => { columns: string[]; rows: (string | number | null)[][] };
  scopeLine?: string;
}) {
  const [mode, setMode] = useState<ViewMode>('chart');
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const name = title ?? 'chart';

  const view = useMemo(() => {
    if (mode === 'data' && records) return records();
    if (mode === 'stats') {
      const cols = table.columns.slice(1);
      const rows = cols.map((c, ci) => {
        const vals = table.rows.map((r) => r[ci + 1]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        if (!vals.length) return [c, null, null, null, null, null];
        const sorted = [...vals].sort((a, b) => a - b);
        const sum = vals.reduce((a, b) => a + b, 0);
        const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
        return [c, vals.length, Number(sum.toFixed(2)), Number((sum / vals.length).toFixed(2)), Number(q(0.5).toFixed(2)), `${Number(sorted[0].toFixed(2))} – ${Number(sorted[sorted.length - 1].toFixed(2))}`];
      });
      return { columns: ['Series', 'n', 'Total', 'Mean', 'Median', 'Range'], rows };
    }
    if (mode === 'share') {
      const cols = table.columns.slice(1);
      const totals = cols.map((_, ci) => table.rows.reduce((a, r) => a + (typeof r[ci + 1] === 'number' ? (r[ci + 1] as number) : 0), 0));
      return { columns: table.columns, rows: table.rows.map((r) => [r[0], ...cols.map((_, ci) => { const v = r[ci + 1]; return typeof v === 'number' && totals[ci] ? `${((v / totals[ci]) * 100).toFixed(1)}%` : '—'; })]) };
    }
    return table;
  }, [mode, table, records]);

  const sorted = useMemo(() => {
    if (!sort) return view.rows;
    return [...view.rows].sort((a, b) => {
      const x = a[sort.col]; const y = b[sort.col];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
      return String(x ?? '').localeCompare(String(y ?? '')) * sort.dir;
    });
  }, [view, sort]);

  const payload = () => ({ name, columns: view.columns, rows: sorted, scopeLine: scopeLine ?? '' });
  const reading = useMemo(() => explain ?? describeChart(table, title), [explain, table, title]);
  const copyTable = async () => {
    const tsv = [view.columns.join('\t'), ...sorted.map((r) => r.map((c) => (c ?? '')).join('\t'))].join('\n');
    try { await navigator.clipboard.writeText(tsv); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked */ }
  };

  return (
    <div ref={wrap} className="chart-module">
      <div className="chart-head">
        <div style={{ minWidth: 0 }}>
          {title && <div className="t-heading-m">{title}</div>}
          {subtitle && <div className="t-label-s muted" style={{ marginTop: 2 }}>{subtitle}</div>}
        </div>
        <div style={{ flex: 1 }} />
        {actions}
        <div className="view-switch" role="radiogroup" aria-label="View mode">
          {VIEW_MODES.filter((v) => v.id !== 'data' || records).map((v) => (
            <button key={v.id} role="radio" aria-checked={mode === v.id} title={v.hint}
              className={`view-tab ${mode === v.id ? 'is-active' : ''}`} onClick={() => setMode(v.id)}>{v.label}</button>
          ))}
        </div>
        <button className="btn btn-xs" aria-expanded={showHelp} aria-pressed={showHelp} title="Explain this chart in plain English"
          onClick={() => setShowHelp((v) => !v)}>What am I looking at?</button>
        <button className="btn btn-xs" title="Copy the numbers behind this chart, ready to paste into a spreadsheet"
          onClick={copyTable}>{copied ? 'Copied' : 'Copy'}</button>
        <button className="btn btn-xs" title="Download a 2× PNG of the chart"
          onClick={() => { const svg = wrap.current?.querySelector('svg'); if (svg) svgToPng(svg, `${name.replace(/\s+/g, '-').toLowerCase()}.png`); }}>PNG</button>
        <ExportMenu payload={payload} />
      </div>
      {showHelp && (
        <div className="chart-help">
          <div className="t-heading-s">What am I looking at?</div>
          {reading.map((line, i) => <p key={i} className="t-body-s">{line}</p>)}
        </div>
      )}
      {mode === 'chart' ? children : (
        <div className="table-scroll" style={{ maxHeight: height ?? 340 }}>
          <table className="tbl">
            <thead><tr>{view.columns.map((c, i) => (
              <th key={c} className="t-heading-s sortable" onClick={() => setSort((s2) => (s2?.col === i ? { col: i, dir: s2.dir === 1 ? -1 : 1 } : { col: i, dir: -1 }))}>
                {c}{sort?.col === i && <span className={`caret ${sort.dir === -1 ? 'desc' : ''}`} style={{ fontSize: 9, marginLeft: 3 }}>▲</span>}
              </th>))}</tr></thead>
            <tbody>{sorted.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 't-num' : 't-body-s'}>{c ?? '—'}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Path({ d, color, width = 2, delay = 0, dash, ghost }: { d: string; color: string; width?: number; delay?: number; dash?: string; ghost?: boolean }) {
  const ref = usePathDraw(d, 480, delay);
  return <path ref={ref} d={d} fill="none" stroke={color} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dash} opacity={ghost ? 0.3 : 1} />;
}

/** Multi-series line / bar / area combo on a category x-axis. */
export function XYChart({ categories, series, height = 260, fmtLeft = 'integer', fmtRight = 'percent', stacked = false, onClick, labelEvery, title }: XYProps) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const active = series.filter((s) => !off.has(s.id));
  const W = Math.max(320, width); const H = height; const iw = W - PAD.l - PAD.r; const ih = H - PAD.t - PAD.b;
  const n = categories.length; const xs = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const bandW = n ? Math.max(4, (iw / n) * 0.7) : 0; const xb = (i: number) => PAD.l + (i + 0.5) * (iw / Math.max(1, n));
  const bars = active.filter((s) => s.kind === 'bar');
  const maxL = useMemo(() => {
    let m = 0;
    if (stacked && bars.length) for (let i = 0; i < n; i++) m = Math.max(m, bars.reduce((a, s) => a + (s.values[i] ?? 0), 0));
    for (const s of active) if ((s.axis ?? 'left') === 'left' && !(stacked && s.kind === 'bar')) for (const v of s.values) if (v !== null) m = Math.max(m, v);
    return m;
  }, [active, stacked, bars, n]);
  const maxR = useMemo(() => { let m = 0; for (const s of active) if (s.axis === 'right') for (const v of s.values) if (v !== null) m = Math.max(m, v); return m; }, [active]);
  const yL = (v: number) => PAD.t + ih - (maxL ? (v / maxL) * ih : 0); const yR = (v: number) => PAD.t + ih - (maxR ? (v / maxR) * ih : 0);
  const y = (s: Series, v: number) => (s.axis === 'right' ? yR(v) : yL(v));
  const ticksL = niceTicks(maxL); const ticksR = niceTicks(maxR);
  const hasRight = active.some((s) => s.axis === 'right');
  const linePath = (s: Series, useBar: boolean) => { let d = ''; let pen = false; s.values.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${(useBar ? xb(i) : xs(i)).toFixed(1)},${y(s, v).toFixed(1)} `; pen = true; }); return d; };
  const useBarX = bars.length > 0;
  const every = labelEvery ?? Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 64))));
  const tip = useTooltip(() => {
    if (hover === null) return null;
    const rows = [...active].map((s) => ({ s, v: s.values[hover] })).sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
    return <div><div className="t-label-s muted">{categories[hover]}</div>{rows.map(({ s, v }) => <div key={s.id} className="tt-row t-body-s" style={{ marginTop: 3 }}><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><i style={{ width: 8, height: 8, background: s.color, display: 'inline-block' }} />{s.label}</span><b className="tabular">{formatValue(s.fmt ?? (s.axis === 'right' ? fmtRight : fmtLeft), v)}</b></div>)}<div className="t-label-s faint" style={{ marginTop: 6 }}>{onClick ? 'Click to filter' : ''}</div></div>;
  }, [hover, active.length]);
  const stackOffsets = useMemo(() => { const acc = new Array(n).fill(0); return bars.map((s) => s.values.map((v, i) => { const y0 = acc[i]; acc[i] += v ?? 0; return y0; })); }, [bars, n]);
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={W} height={H} role="img" aria-label={title ?? 'Chart'} {...tip}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const x = e.clientX - r.left; const i = useBarX ? Math.floor((x - PAD.l) / (iw / Math.max(1, n))) : Math.round(((x - PAD.l) / iw) * (n - 1)); setHover(i >= 0 && i < n ? i : null); tip.onMouseMove(e); }}
        onMouseLeave={() => { setHover(null); tip.onMouseLeave(); }} onClick={() => { if (hover !== null && onClick) onClick(hover); }} style={{ cursor: onClick ? 'pointer' : 'default', display: 'block' }}>
        {ticksL.map((t) => <g key={`l${t}`}><line x1={PAD.l} x2={W - PAD.r} y1={yL(t)} y2={yL(t)} stroke="var(--hairline)" /><text x={PAD.l - 6} y={yL(t) + 3} textAnchor="end" className="t-heading-xs" fill="var(--text-3)">{formatValue(fmtLeft, t)}</text></g>)}
        {hasRight && ticksR.map((t) => <text key={`r${t}`} x={W - PAD.r + 6} y={yR(t) + 3} className="t-heading-xs" fill="var(--text-3)">{formatValue(fmtRight, t)}</text>)}
        {categories.map((c, i) => (i % every === 0 ? <text key={c} x={useBarX ? xb(i) : xs(i)} y={H - 8} textAnchor="middle" className="t-heading-xs" fill="var(--text-3)">{c}</text> : null))}
        {bars.map((s, si) => s.values.map((v, i) => { if (v === null) return null; const gw = stacked ? bandW : bandW / bars.length; const x0 = stacked ? xb(i) - bandW / 2 : xb(i) - bandW / 2 + si * gw; const y0 = stacked ? yL(stackOffsets[si][i] + v) : yL(v); const h = (stacked ? yL(stackOffsets[si][i]) : yL(0)) - y0; return <rect key={`${s.id}${i}`} x={x0} y={y0} width={gw - 1} height={Math.max(0, h)} fill={s.color} opacity={hover === null || hover === i ? (s.ghost ? 0.3 : 0.9) : 0.35} style={{ transformOrigin: `${x0}px ${yL(0)}px`, animation: `growY var(--m-data) var(--ease-data) ${i * 28}ms both` }} />; }))}
        {active.filter((s) => s.kind === 'area').map((s, si) => { const d = linePath(s, useBarX); if (!d) return null; const last = s.values.length - 1; const area = `${d} L${(useBarX ? xb(last) : xs(last)).toFixed(1)},${yL(0)} L${(useBarX ? xb(0) : xs(0)).toFixed(1)},${yL(0)} Z`; return <g key={s.id}><path d={area} fill={s.color} opacity={0.14} /><Path d={d} color={s.color} delay={si * 28} ghost={s.ghost} /></g>; })}
        {active.filter((s) => !s.kind || s.kind === 'line').map((s, si) => { const d = linePath(s, useBarX); return d ? <Path key={s.id} d={d} color={s.color} delay={si * 28} ghost={s.ghost} dash={s.ghost ? '4 3' : undefined} /> : null; })}
        {hover !== null && <line x1={useBarX ? xb(hover) : xs(hover)} x2={useBarX ? xb(hover) : xs(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--text-3)" strokeDasharray="2 3" />}
        {hover !== null && active.filter((s) => s.kind !== 'bar').map((s) => { const v = s.values[hover]; return v === null ? null : <circle key={s.id} cx={useBarX ? xb(hover) : xs(hover)} cy={y(s, v)} r={3.5} fill={s.color} stroke="var(--surface-1)" strokeWidth={1.5} />; })}
      </svg>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 4 }}>
        {series.map((s) => <button key={s.id} className="t-label-m" aria-pressed={!off.has(s.id)} onClick={() => setOff((o) => { const x = new Set(o); if (x.has(s.id)) x.delete(s.id); else x.add(s.id); return x; })} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', opacity: off.has(s.id) ? 0.4 : 1, transition: 'opacity 150ms' }}><i style={{ width: 10, height: s.kind === 'bar' ? 10 : 2, background: s.color, display: 'inline-block' }} />{s.label}</button>)}
      </div>
      <style>{`@keyframes growY{from{transform:scaleY(0)}to{transform:scaleY(1)}}`}</style>
    </div>
  );
}

/** Horizontal bars (rankings, diverging). */
export function HBars({ items, fmt = 'integer', height = 22, diverge = false, onClick, color = 'var(--hue)', negColor = 'var(--neg)', max: maxIn }: { items: { label: string; value: number | null; sub?: string; color?: string }[]; fmt?: Fmt; height?: number; diverge?: boolean; onClick?: (i: number) => void; color?: string; negColor?: string; max?: number }) {
  const max = maxIn ?? maxBy(items, (i) => Math.abs(i.value ?? 0), 1e-9);
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {items.map((it, i) => {
        const v = it.value ?? 0; const w = Math.min(100, (Math.abs(v) / max) * 100);
        return (
          <div key={it.label + i} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={() => onClick?.(i)} onKeyDown={(e) => { if (onClick && e.key === 'Enter') onClick(i); }} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 90px', alignItems: 'center', gap: 8, height, cursor: onClick ? 'pointer' : 'default' }}>
            <span className="t-body-s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.label}>{it.label}{it.sub && <span className="faint t-label-s"> {it.sub}</span>}</span>
            <div style={{ position: 'relative', height: height - 8, background: 'var(--surface-inset)' }}>
              {diverge && <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--hairline-strong)' }} />}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: diverge ? (v >= 0 ? '50%' : `${50 - w / 2}%`) : 0, width: diverge ? `${w / 2}%` : `${w}%`, background: it.color ?? (v < 0 ? negColor : color), transformOrigin: v >= 0 || !diverge ? 'left' : 'right', animation: `growX var(--m-data) var(--ease-data) ${Math.min(i, 10) * 28}ms both` }} />
            </div>
            <span className="t-num" style={{ textAlign: 'right' }}>{formatValue(fmt, it.value)}</span>
          </div>
        );
      })}
      <style>{`@keyframes growX{from{transform:scaleX(0)}to{transform:scaleX(1)}}`}</style>
    </div>
  );
}

export function TipValue(p: { context: string; value: string; n?: string; hint?: string }) { return <TipBody context={p.context} value={p.value} n={p.n} hint={p.hint} />; }
