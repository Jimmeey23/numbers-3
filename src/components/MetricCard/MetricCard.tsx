import { useMemo, useState } from 'react';
import { coverageNote, metric } from '../../semantics/metrics';
import { fmtDelta, fmtN, formatValue, isNil } from '../../semantics/formats';
import { useCountUp, usePathDraw } from '../hooks';
import { useTooltip } from '../Tooltip/Tooltip';
import { extent } from '../../semantics/stats';

export interface MetricCardProps {
  metricId: string; value: number | null; prev?: number | null; spark?: (number | null)[]; n?: number; suspect?: string | null; coverage?: number | null; contributing?: number;
  variant?: 'hero' | 'standard' | 'inline' | 'comparison'; index?: number; benchmark?: { label: string; value: number | null }; rank?: { pos: number; of: number };
  onClick?: () => void; active?: boolean; comparison?: boolean; prevLabel?: string; alert?: boolean; loading?: boolean; labelOverride?: string;
}

export function Sparkline({ data, width, height, color, area = true, delay = 0, animate = true, strokeWidth = 1.5 }: { data: (number | null)[]; width: number; height: number; color: string; area?: boolean; delay?: number; animate?: boolean; strokeWidth?: number }) {
  const pts = data.map((v, i) => [i, v] as const).filter((d): d is readonly [number, number] => d[1] !== null);
  const path = useMemo(() => {
    if (pts.length < 2) return { line: '', area: '', last: null as null | { x: number; y: number } };
    const ys = pts.map((p) => p[1]); const [min, max] = extent(ys); const span = max - min || 1;
    const x = (i: number) => (i / (data.length - 1)) * (width - 4) + 2; const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
    const areaP = `${line} L${x(pts[pts.length - 1][0]).toFixed(1)},${height} L${x(pts[0][0]).toFixed(1)},${height} Z`;
    const l = pts[pts.length - 1];
    return { line, area: areaP, last: { x: x(l[0]), y: y(l[1]) } };
  }, [data, width, height, pts]);
  const ref = usePathDraw(animate ? path.line : null, 480, delay);
  if (!path.line) return <svg width={width} height={height} />;
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ overflow: 'visible', display: 'block' }}>
      {area && <path d={path.area} fill={color} opacity={0.1} />}
      <path ref={ref} d={path.line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {path.last && <circle cx={path.last.x} cy={path.last.y} r={2} fill={color} />}
    </svg>
  );
}

export function MetricCard(p: MetricCardProps) {
  const def = metric(p.metricId);
  const variant = p.variant ?? 'standard';
  const delay = (p.index ?? 0) * 28;
  const v = useCountUp(p.value, delay);
  const delta = fmtDelta(def.format, p.value, p.prev);
  const good = delta.value === null ? null : (delta.value >= 0) === def.higherIsBetter;
  const low = p.n !== undefined && p.n < def.minSample;
  // A metric that can only see part of the scope says so, rather than presenting a partial
  // measurement as a fact about the whole base.
  const partial = p.coverage !== null && p.coverage !== undefined && p.coverage < 0.9 && (p.n ?? 0) > 0;
  const coverageText = partial ? `on ${((p.coverage ?? 0) * 100).toFixed(0)}% of rows` : null;
  const [info, setInfo] = useState(false);
  const tip = useTooltip(() => (
    <div>
      <div className="t-heading-s">{def.label}</div>
      <div className="t-body-s muted" style={{ marginTop: 4 }}>{def.description}</div>
      <div className="t-label-s" style={{ marginTop: 6, fontFamily: 'var(--font-display)' }}>{def.formula}</div>
      <div className="t-label-s faint" style={{ marginTop: 4 }}>Sources: {def.sources.join(', ')}</div>
      {partial && <div className="t-label-s warn" style={{ marginTop: 6 }}>⚠ {coverageNote(def, { value: p.value ?? null, n: p.n ?? 0, contributing: p.contributing ?? 0, coverage: p.coverage ?? null, suspect: null })}</div>}
      {p.suspect && <div className="t-label-s warn" style={{ marginTop: 4 }}>⚠ {p.suspect}</div>}
    </div>
  ), [def.id, p.suspect, p.coverage, p.contributing]);
  const heights = { hero: 180, standard: 132, inline: 56, comparison: 132 }[variant];
  const valueClass = variant === 'hero' ? 't-display-l' : variant === 'inline' ? 't-display-s' : 't-display-m';
  const color = `var(--hue-${def.domain})`;
  const display = formatValue(def.format, v);
  const barreColor = p.alert ? 'var(--warn)' : color;
  return (
    <div data-domain={def.domain} className={`surface chrome ${p.active ? 'barre-glow' : ''}`} role={p.onClick ? 'button' : undefined} tabIndex={p.onClick ? 0 : undefined}
      onClick={p.onClick} onKeyDown={(e) => { if (p.onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); p.onClick(); } }}
      style={{ height: heights, padding: variant === 'inline' ? '8px 12px' : '12px 14px 0', display: 'flex', flexDirection: 'column', position: 'relative', cursor: p.onClick ? 'pointer' : 'default', transition: 'background var(--m-quick) var(--ease-out)', minWidth: 0 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-3)')} onMouseLeave={(e) => (e.currentTarget.style.background = '')}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span className="t-heading-s muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.labelOverride ?? def.label}{(p.suspect || partial) && <span className="warn-mark" title={p.suspect ?? coverageNote(def, { value: null, n: p.n ?? 0, contributing: p.contributing ?? 0, coverage: p.coverage ?? null, suspect: null }) ?? ''}>⚠</span>}</span>
        <button className="btn-ghost t-label-s" aria-label={`About ${def.label}`} {...tip} onClick={(e) => { e.stopPropagation(); setInfo((i) => !i); }} style={{ width: 18, height: 18, borderRadius: 999, border: '1px solid var(--hairline-strong)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>i</button>
      </div>
      {variant !== 'inline' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: variant === 'hero' ? 10 : 4 }}>
            <span className={`${valueClass} tabular ${low ? 'muted' : ''}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{p.loading ? '' : display}</span>
            {variant !== 'comparison' && delta.value !== null && (
              <span className="t-label-s pill" style={{ padding: '2px 7px', background: good ? 'var(--pos-wash)' : 'var(--neg-wash)', color: good ? 'var(--pos)' : 'var(--neg)', display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                <span style={{ display: 'inline-block', transform: delta.value >= 0 ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform var(--m-quick) var(--ease-out)' }}>▲</span>{delta.text}
              </span>
            )}
            {variant === 'comparison' && <span className="t-heading-s muted tabular">vs {formatValue(def.format, p.prev)}</span>}
          </div>
          {p.comparison && variant !== 'comparison' && <div className="t-label-s muted tabular rise" style={{ marginTop: 2 }}>{formatValue(def.format, p.prev)} {p.prevLabel ?? 'prior period'}</div>}
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', minHeight: 0, paddingTop: 4 }}>
            {p.spark && p.spark.length > 1 ? <Sparkline data={p.spark} width={variant === 'hero' ? 260 : 200} height={variant === 'hero' ? 40 : 28} color={color} delay={delay} /> : <div style={{ height: variant === 'hero' ? 40 : 28 }} />}
          </div>
          <div style={{ height: 2, background: barreColor, marginTop: 6, boxShadow: p.active ? `var(--glow) color-mix(in srgb, ${color} 45%, transparent)` : undefined }} className={p.alert ? 'pulse-once' : ''} />
          <div className="t-label-s muted" style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 8px', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.loading ? 'Loading' : low ? `Low sample · ${fmtN(p.n ?? 0)}` : partial ? coverageText : p.benchmark ? `vs ${p.benchmark.label} ${formatValue(def.format, p.benchmark.value)}` : p.n !== undefined ? fmtN(p.n) : ''}
            </span>
            {p.rank && <span>#{p.rank.pos} of {p.rank.of}</span>}
            {isNil(p.value) && !p.loading && <span className="hue">Widen date range</span>}
          </div>
          {p.loading && <div className="travel-barre" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} />}
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 2 }}>
          <span className={`${valueClass} tabular`}>{display}</span>
          {delta.value !== null && <span className={`t-label-s ${good ? 'pos' : 'neg'}`}>{delta.text}</span>}
        </div>
      )}
      {info && (
        <div className="surface chrome t-body-s" style={{ position: 'absolute', top: 36, left: 8, right: 8, zIndex: 20, padding: 12 }} onClick={(e) => e.stopPropagation()}>
          <div className="t-heading-s">{def.label}</div>
          <div className="muted" style={{ marginTop: 4 }}>{def.description}</div>
          <div className="t-label-s" style={{ marginTop: 6, fontFamily: 'var(--font-display)' }}>{def.formula}</div>
          <div className="t-label-s faint" style={{ marginTop: 4 }}>{def.sources.join(' · ')}</div>
          <div className="t-label-s faint" style={{ marginTop: 4 }}>Aggregation: {def.aggregation}{def.aggregation === 'weighted' ? ' (never an average of rates)' : ''}</div>
        </div>
      )}
    </div>
  );
}
