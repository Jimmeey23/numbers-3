import { useState } from 'react';
import { useMeasure } from '../hooks';
import { fmtCurrency, fmtPercent, formatValue } from '../../semantics/formats';
import { useView } from '../../state/view';
import { categorical, needsInvert } from '../../design/ramps';

export interface Stage {
  id: string;
  label: string;
  count: number;
  /** Rupees lost between the previous stage and this one. */
  lostValue?: number | null;
  /** One-line explanation of the population. */
  note?: string;
  /** Breakdown bar under the stage, e.g. by source or product. */
  parts?: { label: string; value: number }[];
}

/** A true funnel: tapering polygons, stage conversion, drop-off valued in rupees,
 *  and a cumulative rate against the very first stage. */
export function FunnelChart({ stages, height = 340, onStage, unit = 'people' }: { stages: Stage[]; height?: number; onStage?: (s: Stage, i: number) => void; unit?: string }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const theme = useView((s) => s.theme);
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(420, width);
  const LABEL = 186; const RAIL = 226;
  const bandW = Math.max(150, W - LABEL - RAIL);
  const top = stages[0]?.count || 1;
  const rowH = height / Math.max(1, stages.length);
  const cx = LABEL + bandW / 2;
  const widthAt = (c: number) => Math.max(3, (c / top) * bandW);

  return (
    <div ref={ref}>
      <svg width={W} height={height + 10} role="img" aria-label="Conversion and retention journey" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          {stages.map((s, i) => (
            <linearGradient key={s.id} id={`fn-${s.id}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={categorical(theme, i)} stopOpacity={0.95} />
              <stop offset="100%" stopColor={categorical(theme, i)} stopOpacity={0.68} />
            </linearGradient>
          ))}
          <linearGradient id="fn-loss" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--neg)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--neg)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {stages.map((s, i) => {
          const next = stages[i + 1];
          const w0 = widthAt(s.count); const w1 = next ? widthAt(next.count) : w0;
          const y0 = i * rowH + 5; const y1 = (i + 1) * rowH - 5;
          const prev = i ? stages[i - 1].count : s.count;
          const rate = prev ? s.count / prev : 1;
          const cumulative = top ? s.count / top : 0;
          const drop = Math.max(0, prev - s.count);
          const dim = hover !== null && hover !== i;
          const midY = y0 + (y1 - y0) / 2;
          const weak = i > 0 && rate < 0.5;
          return (
            <g key={s.id} opacity={dim ? 0.32 : 1} style={{ transition: 'opacity 150ms', cursor: onStage ? 'pointer' : 'default' }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              onClick={() => onStage?.(s, i)} tabIndex={0} role="button"
              onKeyDown={(e) => { if (e.key === 'Enter') onStage?.(s, i); }}>
              {/* the loss wedge between this band and the next */}
              {next && (
                <path d={`M${cx - w0 / 2},${y1} L${cx - w1 / 2},${y1 + 10} L${cx + w1 / 2},${y1 + 10} L${cx + w0 / 2},${y1} Z`} fill="url(#fn-loss)" />
              )}
              <path d={`M${cx - w0 / 2},${y0} L${cx + w0 / 2},${y0} L${cx + w1 / 2},${y1} L${cx - w1 / 2},${y1} Z`}
                fill={`url(#fn-${s.id})`} rx={2}
                style={{ animation: `fadeCell var(--m-emphasis) var(--ease-data) ${i * 70}ms both` }} />

              {/* left rail: stage name and cumulative survival */}
              <text x={LABEL - 16} y={midY - 4} textAnchor="end" className="t-heading-s" fill="var(--text-1)">{s.label}</text>
              <text x={LABEL - 16} y={midY + 11} textAnchor="end" className="t-label-s" fill="var(--text-3)">
                {fmtPercent(cumulative)} of everyone who started
              </text>
              {/* mini survival bar under the label */}
              <rect x={LABEL - 16 - 54} y={midY + 16} width={54} height={3} rx={1.5} fill="var(--surface-inset)" />
              <rect x={LABEL - 16 - 54} y={midY + 16} width={54 * cumulative} height={3} rx={1.5} fill={categorical(theme, i)} />

              {/* the count, inside the band */}
              <text x={cx} y={midY + 6} textAnchor="middle" className="t-num" fill={needsInvert(categorical(theme, i), theme) ? 'var(--heat-text-invert)' : 'var(--text-1)'}
                style={{ fontSize: Math.min(19, Math.max(12, rowH * 0.34)), fontWeight: 700, letterSpacing: '-0.01em' }}>
                {s.count.toLocaleString('en-IN')}
              </text>

              {/* right rail: step conversion, loss, and what the loss costs */}
              {i > 0 ? (
                <>
                  <circle cx={LABEL + bandW + 26} cy={midY - 4} r={11} fill={weak ? 'var(--neg-wash)' : 'var(--pos-wash)'} />
                  <text x={LABEL + bandW + 26} y={midY - 1} textAnchor="middle" className="t-label-s"
                    fill={weak ? 'var(--neg)' : 'var(--pos)'} style={{ fontWeight: 700, fontSize: 9.5 }}>
                    {Math.round(rate * 100)}%
                  </text>
                  <text x={LABEL + bandW + 44} y={midY - 6} className="t-label-m" fill="var(--text-1)">continue</text>
                  <text x={LABEL + bandW + 44} y={midY + 9} className="t-label-s" fill="var(--text-3)">
                    {drop.toLocaleString('en-IN')} lost{s.lostValue ? ` · ${fmtCurrency(s.lostValue)}` : ''}
                  </text>
                </>
              ) : (
                <text x={LABEL + bandW + 26} y={midY + 4} className="t-label-s" fill="var(--text-3)">{unit} entering the journey</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="funnel-note t-label-s">
        {hover !== null && stages[hover].note
          ? <><b style={{ color: 'var(--text-1)' }}>{stages[hover].label}:</b> <span className="muted">{stages[hover].note}</span></>
          : <span className="faint">Hover a band for what it counts. Click to list the people in it. The faded wedge between bands is the drop-off.</span>}
      </div>
    </div>
  );
}

/** Horizontal lifecycle flow: each state sized by population, with the transitions between them. */
export function LifecycleFlow({ states, height = 120, mode = 'default' }: {
  states: { label: string; count: number; value: number; tone: 'pos' | 'warn' | 'neg' | 'info' }[];
  height?: number;
  mode?: 'default' | 'minimal';
}) {
  const total = states.reduce((a, s) => a + s.count, 0) || 1;
  const TONE = { pos: 'var(--pos)', warn: 'var(--warn)', neg: 'var(--neg)', info: 'var(--info)' };
  return (
    <div className={`lifecycle-flow ${mode === 'minimal' ? 'is-minimal' : ''}`} style={{ display: 'flex', width: '100%', height, gap: 2 }}>
      {states.map((s) => (
        <div key={s.label} title={`${s.label}: ${s.count.toLocaleString('en-IN')} (${fmtPercent(s.count / total)}) · ${fmtCurrency(s.value)}`}
          className={`lifecycle-cell tone-${s.tone}`}
          style={{ flex: `${Math.max(0.04, s.count / total)} 1 0`, minWidth: 0, ['--lc-tone' as string]: TONE[s.tone],
            background: `color-mix(in oklch, ${TONE[s.tone]} 16%, var(--surface-1))`, borderTop: `2px solid ${TONE[s.tone]}`,
            padding: '10px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden' }}>
          <div>
            <div className="t-heading-s lifecycle-label" style={{ color: TONE[s.tone], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</div>
            <div className="t-display-s tabular">{s.count.toLocaleString('en-IN')}</div>
          </div>
          <div className="t-label-s muted lifecycle-meta" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fmtPercent(s.count / total)} · {fmtCurrency(s.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Stacked horizontal bar comparing composition across a handful of cohorts. */
export function CompositionBars({ rows, keys, colors, fmt = 'percent' }: { rows: { label: string; parts: number[]; total: number }[]; keys: string[]; colors: string[]; fmt?: 'percent' | 'integer' }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {keys.map((k, i) => <span key={k} className="t-label-s muted" style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><i style={{ width: 9, height: 9, background: colors[i], borderRadius: 2 }} />{k}</span>)}
      </div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 74px', gap: 10, alignItems: 'center' }}>
          <span className="t-body-s" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</span>
          <div style={{ display: 'flex', height: 16, background: 'var(--surface-inset)', borderRadius: 2, overflow: 'hidden' }}>
            {r.parts.map((p, i) => p > 0 && (
              <div key={keys[i]} title={`${keys[i]}: ${p.toLocaleString('en-IN')} (${fmtPercent(p / (r.total || 1))})`}
                style={{ width: `${(p / (r.total || 1)) * 100}%`, background: colors[i], transition: 'width var(--m-data) var(--ease-data)' }} />
            ))}
          </div>
          <span className="t-num" style={{ textAlign: 'right' }}>{formatValue(fmt === 'percent' ? 'integer' : 'integer', r.total)}</span>
        </div>
      ))}
    </div>
  );
}
