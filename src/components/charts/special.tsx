import { useEffect, useMemo, useRef, useState } from 'react';
import { useMeasure, usePathDraw } from '../hooks';
import { fmtCurrency, fmtDateShort, formatValue, type Fmt } from '../../semantics/formats';
import { useView } from '../../state/view';
import { categorical } from '../../design/ramps';
import { TipBody, useTooltip } from '../Tooltip/Tooltip';
import { niceTicks } from './core';
import { maxBy, maxOf, minBy, minOf } from '../../semantics/stats';

/* ---------- Scatter with quadrants ---------- */
export interface Point { id: string; label: string; x: number; y: number; size?: number; color?: string; n?: number }
export function Scatter({ points, xLabel, yLabel, fmtX = 'percent', fmtY = 'currency', quadrants, height = 300, onClick, xRef, yRef, shade }: { points: Point[]; xLabel: string; yLabel: string; fmtX?: Fmt; fmtY?: Fmt; quadrants?: [string, string, string, string]; height?: number; onClick?: (p: Point) => void; xRef?: number; yRef?: number; shade?: 'bl' | 'br' | 'tl' | 'tr' }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const W = Math.max(320, width); const P = { l: 60, r: 16, t: 16, b: 36 }; const iw = W - P.l - P.r; const ih = height - P.t - P.b;
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  const maxX = maxOf(xs, 1e-9); const maxY = maxOf(ys, 1e-9); const minX = minOf(xs, 0); const minY = minOf(ys, 0);
  const sx = (v: number) => P.l + ((v - minX) / (maxX - minX || 1)) * iw; const sy = (v: number) => P.t + ih - ((v - minY) / (maxY - minY || 1)) * ih;
  const mx = xRef ?? (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0); const my = yRef ?? (ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0);
  const maxS = maxBy(points, (p) => p.size ?? 1, 1);
  return (
    <div ref={ref}>
      <svg width={W} height={height} role="img" aria-label={`${yLabel} against ${xLabel}`} style={{ display: 'block' }}>
        {shade && <rect x={shade.endsWith('l') ? P.l : sx(mx)} y={shade.startsWith('t') ? P.t : sy(my)} width={shade.endsWith('l') ? sx(mx) - P.l : P.l + iw - sx(mx)} height={shade.startsWith('t') ? sy(my) - P.t : P.t + ih - sy(my)} fill="var(--neg)" opacity={0.07} />}
        {niceTicks(maxY).map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={sy(t)} y2={sy(t)} stroke="var(--hairline)" /><text x={P.l - 6} y={sy(t) + 3} textAnchor="end" className="t-heading-xs" fill="var(--text-3)">{formatValue(fmtY, t)}</text></g>)}
        {niceTicks(maxX).map((t) => <text key={t} x={sx(t)} y={height - 18} textAnchor="middle" className="t-heading-xs" fill="var(--text-3)">{formatValue(fmtX, t)}</text>)}
        <line x1={sx(mx)} x2={sx(mx)} y1={P.t} y2={P.t + ih} stroke="var(--hairline-strong)" strokeDasharray="3 3" />
        <line x1={P.l} x2={W - P.r} y1={sy(my)} y2={sy(my)} stroke="var(--hairline-strong)" strokeDasharray="3 3" />
        {quadrants && <>
          <text x={P.l + 6} y={P.t + 12} className="t-heading-xs" fill="var(--text-3)">{quadrants[0]}</text>
          <text x={W - P.r - 6} y={P.t + 12} textAnchor="end" className="t-heading-xs" fill="var(--text-3)">{quadrants[1]}</text>
          <text x={P.l + 6} y={P.t + ih - 6} className="t-heading-xs" fill="var(--text-3)">{quadrants[2]}</text>
          <text x={W - P.r - 6} y={P.t + ih - 6} textAnchor="end" className="t-heading-xs" fill="var(--text-3)">{quadrants[3]}</text>
        </>}
        {points.map((p, i) => <Dot key={p.id} p={p} cx={sx(p.x)} cy={sy(p.y)} r={4 + Math.sqrt((p.size ?? 1) / maxS) * 10} fmtX={fmtX} fmtY={fmtY} xLabel={xLabel} yLabel={yLabel} onClick={onClick} delay={Math.min(i, 10) * 28} originX={sx(mx)} originY={sy(my)} />)}
        <text x={P.l + iw / 2} y={height - 4} textAnchor="middle" className="t-heading-xs" fill="var(--text-2)">{xLabel}</text>
        <text transform={`translate(12 ${P.t + ih / 2}) rotate(-90)`} textAnchor="middle" className="t-heading-xs" fill="var(--text-2)">{yLabel}</text>
      </svg>
    </div>
  );
}
function Dot({ p, cx, cy, r, fmtX, fmtY, xLabel, yLabel, onClick, delay, originX, originY }: { p: Point; cx: number; cy: number; r: number; fmtX: Fmt; fmtY: Fmt; xLabel: string; yLabel: string; onClick?: (p: Point) => void; delay: number; originX: number; originY: number }) {
  const tip = useTooltip(() => <TipBody context={p.label} value={`${yLabel}: ${formatValue(fmtY, p.y)}`} delta={`${xLabel}: ${formatValue(fmtX, p.x)}`} n={p.n !== undefined ? `n = ${p.n}` : undefined} hint={onClick ? 'Click to drill' : ''} />, [p.id]);
  return (
    <g {...tip} onClick={() => onClick?.(p)} tabIndex={0} style={{ cursor: onClick ? 'pointer' : 'default' }} onKeyDown={(e) => { if (e.key === 'Enter') onClick?.(p); }}>
      <circle cx={cx} cy={cy} r={r} fill={p.color ?? 'var(--hue)'} opacity={0.55} stroke={p.color ?? 'var(--hue)'} strokeWidth={1}
        style={{ transformOrigin: `${originX}px ${originY}px`, animation: `settle var(--m-data) var(--ease-data) ${delay}ms both` }} />
      <style>{`@keyframes settle{from{transform:translate(${originX - cx}px,${originY - cy}px);opacity:0}to{transform:none;opacity:.55}}`}</style>
    </g>
  );
}

/* ---------- Funnel ---------- */
export function Funnel({ stages, onClick }: { stages: { label: string; count: number; value?: number | null; note?: string }[]; onClick?: (i: number) => void }) {
  const max = maxBy(stages, (s) => s.count, 1);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {stages.map((s, i) => {
        const prev = i ? stages[i - 1].count : s.count; const conv = prev ? s.count / prev : null; const drop = prev - s.count;
        return (
          <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 240px', gap: 12, alignItems: 'center' }}>
            <div className="t-heading-s">{s.label}</div>
            <div style={{ position: 'relative', height: 30, background: 'var(--surface-inset)', borderRadius: 'var(--r-s)', overflow: 'hidden' }} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={() => onClick?.(i)} onKeyDown={(e) => { if (e.key === 'Enter') onClick?.(i); }}>
              <div style={{ position: 'absolute', inset: 0, width: `${(s.count / max) * 100}%`, background: 'var(--hue)', opacity: 0.85, transformOrigin: 'left', animation: `growX var(--m-data) var(--ease-data) ${i * 80}ms both` }} />
              <span className="t-num" style={{ position: 'absolute', left: 8, top: 6, color: 'var(--text-1)', mixBlendMode: 'difference' }}>{s.count.toLocaleString('en-IN')}</span>
            </div>
            <div className="t-label-s muted">
              {i > 0 && conv !== null && <span className="tabular"><b className={conv < 0.5 ? 'neg' : ''}>{(conv * 100).toFixed(1)}%</b> of previous · lost {drop.toLocaleString('en-IN')}{s.value !== undefined && s.value !== null && drop > 0 ? ` ≈ ${fmtCurrency(s.value)}` : ''}</span>}
              {s.note && <div className="faint">{s.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Waterfall ---------- */
export function Waterfall({ steps, height = 260, fmt = 'currency' }: { steps: { label: string; value: number; total?: boolean }[]; height?: number; fmt?: Fmt }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const W = Math.max(320, width); const P = { l: 64, r: 16, t: 16, b: 40 }; const iw = W - P.l - P.r; const ih = height - P.t - P.b;
  let run = 0; const bars = steps.map((s) => { if (s.total) { run = s.value; return { ...s, y0: 0, y1: s.value }; } const y0 = run; run += s.value; return { ...s, y0, y1: run }; });
  const max = maxBy(bars, (b) => Math.max(b.y0, b.y1), 1e-9); const min = minBy(bars, (b) => Math.min(b.y0, b.y1), 0);
  const sy = (v: number) => P.t + ih - ((v - min) / (max - min || 1)) * ih; const bw = iw / steps.length;
  return (
    <div ref={ref}>
      <svg width={W} height={height} role="img" aria-label="Revenue bridge" style={{ display: 'block' }}>
        {niceTicks(max).map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={sy(t)} y2={sy(t)} stroke="var(--hairline)" /><text x={P.l - 6} y={sy(t) + 3} textAnchor="end" className="t-heading-xs" fill="var(--text-3)">{formatValue(fmt, t)}</text></g>)}
        {bars.map((b, i) => {
          const x = P.l + i * bw + bw * 0.2; const w = bw * 0.6; const top = sy(Math.max(b.y0, b.y1)); const h = Math.max(1, Math.abs(sy(b.y0) - sy(b.y1)));
          const color = b.total ? 'var(--text-2)' : b.value >= 0 ? 'var(--pos)' : 'var(--neg)';
          return (
            <g key={b.label}>
              <rect x={x} y={top} width={w} height={h} fill={color} opacity={0.85} style={{ animation: `fadeCell 200ms ease ${i * 80}ms both` }} />
              {i < bars.length - 1 && <line x1={x + w} x2={P.l + (i + 1) * bw + bw * 0.2} y1={sy(b.y1)} y2={sy(b.y1)} stroke="var(--hairline-strong)" strokeDasharray="2 2" style={{ animation: `fadeCell 150ms ease ${i * 80 + 120}ms both` }} />}
              <text x={x + w / 2} y={top - 4} textAnchor="middle" className="t-heading-xs" fill="var(--text-2)">{b.total ? formatValue(fmt, b.value) : `${b.value >= 0 ? '+' : '−'}${formatValue(fmt, Math.abs(b.value))}`}</text>
              <text x={x + w / 2} y={height - 22} textAnchor="middle" className="t-heading-xs" fill="var(--text-3)">{b.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------- Box plot ---------- */
export function BoxPlot({ groups, fmt = 'decimal', height = 280, onClick }: { groups: { label: string; values: number[] }[]; fmt?: Fmt; height?: number; onClick?: (label: string) => void }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const W = Math.max(320, width); const P = { l: 40, r: 8, t: 10, b: 70 }; const iw = W - P.l - P.r; const ih = height - P.t - P.b;
  const stats = groups.map((g) => { const s = [...g.values].sort((a, b) => a - b); const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] : 0); return { ...g, min: s[0] ?? 0, q1: q(0.25), med: q(0.5), q3: q(0.75), max: s[s.length - 1] ?? 0, n: s.length }; });
  const max = maxBy(stats, (s) => s.max, 1e-9); const sy = (v: number) => P.t + ih - (v / max) * ih; const bw = iw / Math.max(1, groups.length);
  return (
    <div ref={ref}>
      <svg width={W} height={height} role="img" aria-label="Distribution" style={{ display: 'block' }}>
        {niceTicks(max).map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={sy(t)} y2={sy(t)} stroke="var(--hairline)" /><text x={P.l - 6} y={sy(t) + 3} textAnchor="end" className="t-heading-xs" fill="var(--text-3)">{formatValue(fmt, t)}</text></g>)}
        {stats.map((s, i) => {
          const cx = P.l + (i + 0.5) * bw; const w = Math.min(28, bw * 0.6);
          return (
            <g key={s.label} onClick={() => onClick?.(s.label)} style={{ cursor: onClick ? 'pointer' : 'default' }}>
              <title>{`${s.label}: median ${formatValue(fmt, s.med)} · IQR ${formatValue(fmt, s.q1)}–${formatValue(fmt, s.q3)} · n=${s.n}`}</title>
              <line x1={cx} x2={cx} y1={sy(s.max)} y2={sy(s.min)} stroke="var(--text-3)" />
              <rect x={cx - w / 2} y={sy(s.q3)} width={w} height={Math.max(1, sy(s.q1) - sy(s.q3))} fill="var(--hue)" opacity={0.35} stroke="var(--hue)" style={{ transformOrigin: `${cx}px ${sy(s.med)}px`, animation: `growY var(--m-data) var(--ease-data) ${Math.min(i, 10) * 28}ms both` }} />
              <line x1={cx - w / 2} x2={cx + w / 2} y1={sy(s.med)} y2={sy(s.med)} stroke="var(--text-1)" strokeWidth={2} />
              <text x={cx} y={height - 54} textAnchor="end" transform={`rotate(-45 ${cx} ${height - 54})`} className="t-heading-xs" fill="var(--text-3)">{s.label.length > 16 ? s.label.slice(0, 15) + '…' : s.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------- Sankey ---------- */
/** Flow diagram with labelled, sized columns, hue-graded links and a hover path trace.
 *  Nodes carry their own count and share so the picture reads without a tooltip. */
export function Sankey({ flows, columns, height = 420, columnTitles, onNode }: {
  flows: { from: string; to: string; value: number }[];
  columns: string[][]; height?: number; columnTitles?: string[];
  onNode?: (node: string) => void;
}) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const theme = useView((s) => s.theme);
  const W = Math.max(420, width);
  const PAD = { t: columnTitles ? 30 : 12, b: 14, l: 8, r: 8 };
  const NODE_W = 11; const GAP = 7;
  const [hl, setHl] = useState<string | null>(null);

  const layout = useMemo(() => {
    const outTotal = new Map<string, number>(); const inTotal = new Map<string, number>();
    for (const f of flows) {
      outTotal.set(f.from, (outTotal.get(f.from) ?? 0) + f.value);
      inTotal.set(f.to, (inTotal.get(f.to) ?? 0) + f.value);
    }
    const size = (n: string) => Math.max(outTotal.get(n) ?? 0, inTotal.get(n) ?? 0);
    const pos = new Map<string, { x: number; y: number; h: number; col: number; value: number }>();
    const usable = height - PAD.t - PAD.b;
    const colX = (ci: number) => PAD.l + (ci / Math.max(1, columns.length - 1)) * (W - PAD.l - PAD.r - NODE_W);
    for (let ci = 0; ci < columns.length; ci++) {
      const col = [...columns[ci]].sort((a, b) => size(b) - size(a));
      const tot = col.reduce((a, n) => a + size(n), 0) || 1;
      const avail = usable - GAP * Math.max(0, col.length - 1);
      let y = PAD.t;
      for (const n of col) {
        const h = Math.max(3, (size(n) / tot) * avail);
        pos.set(n, { x: colX(ci), y, h, col: ci, value: size(n) });
        y += h + GAP;
      }
    }
    const outOff = new Map<string, number>(); const inOff = new Map<string, number>();
    const links = [...flows].sort((a, b) => b.value - a.value).map((f) => {
      const a = pos.get(f.from); const b = pos.get(f.to);
      if (!a || !b) return null;
      const ha = (f.value / (size(f.from) || 1)) * a.h;
      const hb = (f.value / (size(f.to) || 1)) * b.h;
      const y0 = a.y + (outOff.get(f.from) ?? 0); const y1 = b.y + (inOff.get(f.to) ?? 0);
      outOff.set(f.from, (outOff.get(f.from) ?? 0) + ha);
      inOff.set(f.to, (inOff.get(f.to) ?? 0) + hb);
      const x0 = a.x + NODE_W; const x1 = b.x; const mx = (x0 + x1) / 2;
      return { ...f, col: a.col,
        d: `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + hb} C${mx},${y1 + hb} ${mx},${y0 + ha} ${x0},${y0 + ha} Z` };
    }).filter(Boolean) as ({ from: string; to: string; value: number; col: number; d: string })[];
    const grand = columns[0].reduce((a, n) => a + size(n), 0) || 1;
    return { pos, links, grand };
  }, [flows, columns, W, height]); // eslint-disable-line react-hooks/exhaustive-deps

  const connected = useMemo(() => {
    if (!hl) return null;
    const keep = new Set<string>([hl]);
    let grew = true;
    while (grew) { grew = false; for (const l of layout.links) { if (keep.has(l.from) && !keep.has(l.to)) { keep.add(l.to); grew = true; } if (keep.has(l.to) && !keep.has(l.from)) { keep.add(l.from); grew = true; } } }
    return keep;
  }, [hl, layout.links]);

  return (
    <div ref={ref}>
      <svg width={W} height={height} role="img" aria-label="Flow between stages" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          {columns.map((_, ci) => (
            <linearGradient key={ci} id={`sank-${ci}`} x1="0" x2="1">
              <stop offset="0%" stopColor={categorical(theme, ci)} stopOpacity={0.55} />
              <stop offset="100%" stopColor={categorical(theme, Math.min(ci + 1, columns.length - 1))} stopOpacity={0.4} />
            </linearGradient>
          ))}
        </defs>
        {columnTitles?.map((t, ci) => (
          <text key={t} x={PAD.l + (ci / Math.max(1, columns.length - 1)) * (W - PAD.l - PAD.r - NODE_W)}
            y={16} className="t-heading-xs" fill="var(--text-3)"
            textAnchor={ci === columns.length - 1 ? 'end' : 'start'}>{t}</text>
        ))}
        {layout.links.map((l, i) => {
          const dim = connected ? !(connected.has(l.from) && connected.has(l.to)) : false;
          return (
            <path key={i} d={l.d} fill={`url(#sank-${l.col})`} opacity={dim ? 0.06 : 1}
              style={{ transition: 'opacity 150ms', animation: `fadeCell var(--m-emphasis) ease ${Math.min(i, 14) * 22}ms both` }}>
              <title>{`${l.from} → ${l.to}: ${l.value.toLocaleString('en-IN')}`}</title>
            </path>
          );
        })}
        {[...layout.pos.entries()].map(([n, p]) => {
          const dim = connected ? !connected.has(n) : false;
          const last = p.col === columns.length - 1;
          const share = p.value / layout.grand;
          return (
            <g key={n} opacity={dim ? 0.2 : 1} style={{ transition: 'opacity 150ms', cursor: onNode ? 'pointer' : 'default' }}
              onMouseEnter={() => setHl(n)} onMouseLeave={() => setHl(null)} onClick={() => onNode?.(n)}>
              <rect x={p.x} y={p.y} width={NODE_W} height={Math.max(2, p.h)} rx={2}
                fill={categorical(theme, p.col)} stroke="var(--surface-1)" strokeWidth={0.5} />
              {p.h >= 13 && (
                <text x={last ? p.x - 7 : p.x + NODE_W + 7} y={p.y + p.h / 2 + 3}
                  textAnchor={last ? 'end' : 'start'} className="t-label-s" fill="var(--text-1)" style={{ fontWeight: 500 }}>
                  {n.length > 26 ? n.slice(0, 25) + '…' : n}
                  <tspan fill="var(--text-3)"> {p.value.toLocaleString('en-IN')}</tspan>
                  {share >= 0.04 && <tspan fill="var(--text-3)"> · {(share * 100).toFixed(0)}%</tspan>}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="t-label-s faint" style={{ marginTop: 6 }}>Hover any node to trace its full path. Band thickness is the number of leads.</div>
    </div>
  );
}

/* ---------- Bump chart ---------- */
export function Bump({ periods, entities, height = 300, colorOf }: { periods: string[]; entities: { label: string; ranks: (number | null)[] }[]; height?: number; colorOf?: (label: string, i: number) => string }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const W = Math.max(320, width); const P = { l: 8, r: 150, t: 10, b: 24 }; const iw = W - P.l - P.r; const ih = height - P.t - P.b;
  const maxRank = maxBy(entities.flatMap((e) => e.ranks), (r) => r, 1);
  const sx = (i: number) => P.l + (i / Math.max(1, periods.length - 1)) * iw; const sy = (r: number) => P.t + ((r - 1) / Math.max(1, maxRank - 1)) * ih;
  const [hl, setHl] = useState<string | null>(null);
  return (
    <div ref={ref}>
      <svg width={W} height={height} role="img" aria-label="Rank over time" style={{ display: 'block' }}>
        {periods.map((p, i) => <text key={p} x={sx(i)} y={height - 6} textAnchor="middle" className="t-heading-xs" fill="var(--text-3)">{p}</text>)}
        {entities.map((e, i) => { let d = ''; let pen = false; e.ranks.forEach((r, j) => { if (r === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${sx(j)},${sy(r)} `; pen = true; }); const c = colorOf ? colorOf(e.label, i) : 'var(--hue)'; const last = e.ranks[e.ranks.length - 1]; return (
          <g key={e.label} onMouseEnter={() => setHl(e.label)} onMouseLeave={() => setHl(null)} opacity={hl === null || hl === e.label ? 1 : 0.15} style={{ transition: 'opacity 150ms' }}>
            <BumpPath d={d} color={c} delay={i * 28} />
            {e.ranks.map((r, j) => (r === null ? null : <circle key={j} cx={sx(j)} cy={sy(r)} r={3} fill={c} />))}
            {last !== null && <text x={sx(periods.length - 1) + 8} y={sy(last) + 3} className="t-heading-xs" fill="var(--text-1)">{last}. {e.label.length > 20 ? e.label.slice(0, 19) + '…' : e.label}</text>}
          </g>); })}
      </svg>
    </div>
  );
}
function BumpPath({ d, color, delay }: { d: string; color: string; delay: number }) { const ref = usePathDraw(d, 480, delay); return <path ref={ref} d={d} fill="none" stroke={color} strokeWidth={2} />; }

/* ---------- Pulse Ribbon (Overview hero) ---------- */
export function PulseRibbon({ days, onRange, played, onPlayed }: { days: { date: string; attendance: number | null; revenue: number | null; sessions: { fill: number }[] }[]; onRange: (s: string, e: string) => void; played: boolean; onPlayed: () => void }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const W = Math.max(600, width); const H = 180; const P = { l: 0, r: 0, t: 12, b: 26 }; const ih = H - P.t - P.b - 22;
  const n = days.length; const sx = (i: number) => (i / Math.max(1, n - 1)) * W;
  const maxA = maxBy(days, (d) => d.attendance ?? 0, 1); const maxR = maxBy(days, (d) => d.revenue ?? 0, 1);
  const yA = (v: number) => P.t + ih - (v / maxA) * ih; const yR = (v: number) => P.t + ih - (v / maxR) * ih;
  const stepped = useMemo(() => { let d = ''; days.forEach((dd, i) => { const y = yA(dd.attendance ?? 0); const x0 = i === 0 ? 0 : sx(i - 0.5); const x1 = i === n - 1 ? W : sx(i + 0.5); d += `${i ? 'L' : 'M'}${x0},${y} L${x1},${y} `; }); return d; }, [days, W]); // eslint-disable-line react-hooks/exhaustive-deps
  const revLine = useMemo(() => days.map((d, i) => `${i ? 'L' : 'M'}${sx(i)},${yR(d.revenue ?? 0)}`).join(' '), [days, W]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<number | null>(null); const [sel, setSel] = useState<[number, number] | null>(null);
  const aRef = usePathDraw(played ? null : stepped, 900); const rRef = usePathDraw(played ? null : revLine, 900, 120);
  useEffect(() => { if (played) return; const id = window.setTimeout(onPlayed, 1100); return () => window.clearTimeout(id); }, [played, onPlayed]);
  const idx = (e: React.MouseEvent) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))); };
  const d = hover !== null ? days[hover] : null;
  return (
    <div ref={ref} style={{ position: 'relative', marginInline: -24 }}>
      <svg width={W} height={H} role="img" aria-label="90-day pulse: attendance, revenue and per-session fill" style={{ display: 'block' }}
        onMouseMove={(e) => { const i = idx(e); setHover(i); if (drag.current !== null) setSel([Math.min(drag.current, i), Math.max(drag.current, i)]); }}
        onMouseLeave={() => { setHover(null); }} onMouseDown={(e) => { drag.current = idx(e); setSel(null); }}
        onMouseUp={(e) => { const i = idx(e); if (drag.current !== null && Math.abs(i - drag.current) >= 1) { const a = Math.min(drag.current, i); const b = Math.max(drag.current, i); setSel([a, b]); onRange(days[a].date, days[b].date); } drag.current = null; }}>
        <path d={`${stepped} L${W},${yA(0)} L0,${yA(0)} Z`} fill="var(--hue-attendance)" opacity={0.22} />
        <path ref={aRef} d={stepped} fill="none" stroke="var(--hue-attendance)" strokeWidth={1.5} />
        <path ref={rRef} d={revLine} fill="none" stroke="var(--hue-revenue)" strokeWidth={2} />
        {days.map((dd, i) => dd.sessions.map((s, j) => <rect key={`${i}-${j}`} x={sx(i) - 1 + (j - dd.sessions.length / 2) * 2.2} y={H - P.b - 2 - s.fill * 18} width={1.6} height={Math.max(1, s.fill * 18)} fill="var(--hue-attendance)" opacity={0.7} />))}
        {sel && <rect x={sx(sel[0])} y={0} width={sx(sel[1]) - sx(sel[0])} height={H - P.b} fill="var(--hue)" opacity={0.12} />}
        {hover !== null && <line x1={sx(hover)} x2={sx(hover)} y1={0} y2={H - P.b} stroke="var(--text-2)" strokeDasharray="2 3" />}
        <text x={24} y={H - 6} className="t-heading-xs" fill="var(--text-3)">{fmtDateShort(days[0]?.date)}</text>
        <text x={W - 24} y={H - 6} textAnchor="end" className="t-heading-xs" fill="var(--text-3)">{fmtDateShort(days[n - 1]?.date)}</text>
      </svg>
      <div style={{ position: 'absolute', top: 8, left: 24, display: 'flex', gap: 18, pointerEvents: 'none' }}>
        <span className="t-heading-xs" style={{ color: 'var(--hue-attendance)' }}>Attendance</span><span className="t-heading-xs" style={{ color: 'var(--hue-revenue)' }}>Revenue</span><span className="t-heading-xs muted">Ticks: one per session, height = fill</span>
        <span className="t-heading-xs muted">Drag to set the period</span>
      </div>
      {d && <div className="surface chrome t-label-m" style={{ position: 'absolute', top: 28, left: Math.min(W - 240, Math.max(24, sx(hover!) + 12)), padding: '8px 10px', pointerEvents: 'none' }}>
        <div className="muted">{fmtDateShort(d.date)}</div>
        <div className="tabular"><b>{d.attendance ?? '—'}</b> attendees · <b>{fmtCurrency(d.revenue)}</b> · {d.sessions.length} sessions</div>
      </div>}
    </div>
  );
}
