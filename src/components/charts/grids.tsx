import type { HeatKind, Theme } from '../../design/ramps';
import { useMemo, useState } from 'react';
import { diverging, divergingRamp, needsInvert, sequential, sequentialRamp } from '../../design/ramps';
import { tabMeta, useView } from '../../state/view';
import { formatValue, type Fmt } from '../../semantics/formats';
import { TipBody, useTooltip } from '../Tooltip/Tooltip';
import { maxBy, maxOf, minOf } from '../../semantics/stats';

export interface HeatCell { x: string; y: string; value: number | null; n: number; extra?: string }
interface HeatProps {
  xs: string[]; ys: string[]; cells: HeatCell[]; fmt?: Fmt;
  /** A domain name takes that accent's ramp; 'diverging' splits around the centre.
   *  Left unset, the heatmap takes the accent of the tab it is drawn on. */
  kind?: HeatKind | 'diverging';
  center?: number; onClick?: (c: HeatCell) => void; cellH?: number; minN?: number;
  xLabel?: (x: string) => string; yLabel?: (y: string) => string; title?: string;
}

/** Generic X × Y heatmap.
 *
 *  Colour comes from the theme's own ramp for the active domain — the same accent as the tab's
 *  chrome — so a heatmap never introduces a palette the rest of the screen does not use. The
 *  number is always carried alongside the colour, and the legend states the scale rather than
 *  leaving the reader to infer it. */
export function Heatmap({ xs, ys, cells, fmt = 'percent', kind, center, onClick, cellH = 28, minN = 1, xLabel, yLabel, title }: HeatProps) {
  const theme = useView((s) => s.theme);
  const tab = useView((s) => s.tab);
  const mode: HeatKind | 'diverging' = kind ?? (tabMeta(tab).domain as HeatKind);
  const [hover, setHover] = useState<{ x: string; y: string } | null>(null);
  const map = useMemo(() => { const m = new Map<string, HeatCell>(); for (const c of cells) m.set(`${c.x}|${c.y}`, c); return m; }, [cells]);
  const vals = cells.filter((c) => c.value !== null && c.n >= minN).map((c) => c.value as number);
  const min = minOf(vals, 0); const max = maxOf(vals, 1e-9);
  const mid = center ?? (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  const span = maxBy(vals, (v) => Math.abs(v - mid), 1e-9);
  const colorOf = (v: number) => (mode === 'diverging' ? diverging(theme, (v - mid) / span) : sequential(theme, mode, (v - min) / (max - min || 1)));
  /* The peak is worth pointing at: on a grid of 150 cells the eye finds "warm" long before it
     finds "warmest", and the one cell that matters is usually the extreme. */
  const peak = useMemo(() => {
    let best: HeatCell | null = null;
    for (const c of cells) if (c.value !== null && c.n >= minN && (!best || (c.value as number) > (best.value as number))) best = c;
    return best;
  }, [cells, minN]);
  const ramp = mode === 'diverging' ? divergingRamp(theme) : sequentialRamp(theme, mode);
  const gradient = `linear-gradient(90deg, ${ramp.join(', ')})`;
  return (
    <div className="heat">
      <div className="heat-scroll" role="table" aria-label={title ?? 'Heatmap'}>
        <div className="heat-grid" style={{ gridTemplateColumns: `var(--heat-label-w) repeat(${xs.length}, minmax(50px, 1fr))`, minWidth: 128 + xs.length * 52 }}>
          <div className="heat-corner" />
          {xs.map((x) => (
            <div key={x} className={`heat-col-head ${hover?.x === x ? 'is-hot' : ''}`}>{xLabel ? xLabel(x) : x}</div>
          ))}
          {ys.map((y, yi) => (
            <HeatRow key={y} y={y} yi={yi} xs={xs} map={map} colorOf={colorOf} fmt={fmt} onClick={onClick}
              cellH={cellH} minN={minN} yLabel={yLabel} theme={theme} hover={hover} setHover={setHover} peakKey={peak ? `${peak.x}|${peak.y}` : ''} />
          ))}
        </div>
      </div>
      <div className="heat-legend">
        <span className="heat-legend-label">{mode === 'diverging' ? 'Below average' : 'Low'}</span>
        <span className="heat-legend-bar" style={{ background: gradient }} aria-hidden="true" />
        <span className="heat-legend-label">{mode === 'diverging' ? 'Above average' : 'High'}</span>
        <span className="heat-legend-scale">
          {mode === 'diverging'
            ? <>centred on {formatValue(fmt, mid)}</>
            : <>{formatValue(fmt, min)} → {formatValue(fmt, max)}</>}
        </span>
        {peak && <span className="heat-legend-peak" title={`Highest cell: ${peak.y} · ${peak.x}`}>◆ peak {peak.y} · {peak.x} — {formatValue(fmt, peak.value)}</span>}
        {minN > 1 && <span className="heat-legend-scale">cells under {minN} rows are greyed and marked ·</span>}
      </div>
    </div>
  );
}

function HeatRow({ y, yi, xs, map, colorOf, fmt, onClick, cellH, minN, yLabel, theme, hover, setHover, peakKey }: {
  y: string; yi: number; xs: string[]; map: Map<string, HeatCell>; colorOf: (v: number) => string; fmt: Fmt;
  onClick?: (c: HeatCell) => void; cellH: number; minN: number; yLabel?: (y: string) => string; theme: Theme;
  hover: { x: string; y: string } | null; setHover: (h: { x: string; y: string } | null) => void; peakKey: string;
}) {
  return (
    <>
      <div className={`heat-row-head ${hover?.y === y ? 'is-hot' : ''}`} style={{ height: cellH }}>{yLabel ? yLabel(y) : y}</div>
      {xs.map((x) => {
        const c = map.get(`${x}|${y}`);
        return <HeatCellView key={x} c={c} x={x} y={y} colorOf={colorOf} fmt={fmt} onClick={onClick} cellH={cellH} minN={minN}
          delay={yi * 18} theme={theme} hot={hover?.x === x || hover?.y === y} setHover={setHover} peak={peakKey === `${x}|${y}`} />;
      })}
    </>
  );
}

function HeatCellView({ c, x, y, colorOf, fmt, onClick, cellH, minN, delay, theme, hot, setHover, peak }: {
  c?: HeatCell; x: string; y: string; colorOf: (v: number) => string; fmt: Fmt; onClick?: (c: HeatCell) => void;
  cellH: number; minN: number; delay: number; theme: Theme; hot: boolean; setHover: (h: { x: string; y: string } | null) => void; peak: boolean;
}) {
  const thin = !!c && c.value !== null && c.n < minN;
  const low = !c || c.value === null || thin;
  const bg = low ? 'var(--surface-inset)' : colorOf(c!.value as number);
  const tip = useTooltip(() => (
    <TipBody context={`${y} · ${x}`} value={c ? formatValue(fmt, c.value) : '—'}
      n={c ? `n = ${c.n}${c.extra ? ` · ${c.extra}` : ''}${thin ? ` · below the ${minN}-row minimum` : ''}` : 'No data'}
      hint={onClick ? 'Click to filter' : ''} />
  ), [c?.value, thin]);
  const clickable = !!c && !!onClick;
  return (
    <div {...tip} role="cell" tabIndex={clickable ? 0 : -1}
      onClick={() => c && onClick?.(c)} onKeyDown={(e) => { if (e.key === 'Enter' && c) onClick?.(c); }}
      className={`heat-cell t-num-dense ${low ? 'is-low' : ''} ${thin ? 'is-thin' : ''} ${hot ? 'is-hot' : ''} ${peak ? 'is-peak' : ''} ${clickable ? 'is-clickable' : ''}`}
      style={{
        height: cellH, background: bg,
        color: low ? 'var(--text-3)' : needsInvert(bg, theme) ? 'var(--heat-text-invert)' : 'var(--text-1)',
        animationDelay: `${delay}ms`,
      }}
      onMouseEnter={(e) => { setHover({ x, y }); tip.onMouseEnter(e); }}
      onMouseLeave={() => { setHover(null); tip.onMouseLeave(); }}>
      {c && c.value !== null ? formatValue(fmt, c.value) : ''}
      {thin && <span className="heat-cell-thin" aria-hidden="true">·</span>}
    </div>
  );
}

/* ---------- Schedule grid: the week as the manager sees it ---------- */
export interface SlotCard { day: string; time: string; label: string; capacity: number; value: number | null; n: number; sub?: string; key: string }
export function ScheduleGrid({ slots, onClick, center = 0.5 }: { slots: SlotCard[]; onClick?: (s: SlotCard) => void; center?: number }) {
  const theme = useView((s) => s.theme);
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const hours = Array.from({ length: 16 }, (_, i) => i + 6); // 06:00 – 21:00
  const byDay = useMemo(() => { const m = new Map<string, SlotCard[]>(); for (const s of slots) { let a = m.get(s.day); if (!a) { a = []; m.set(s.day, a); } a.push(s); } return m; }, [slots]);
  const span = maxBy(slots, (s) => Math.abs((s.value ?? center) - center), 0.05);
  const maxCap = maxBy(slots, (s) => s.capacity, 1);
  const rowH = 46;
  return (
    <div className="heat">
      <div className="heat-scroll">
        <div className="heat-grid schedule-grid" style={{ gridTemplateColumns: '54px repeat(7, minmax(118px, 1fr))', minWidth: 900 }}>
          <div className="heat-corner" />
          {days.map((d) => <div key={d} className="heat-col-head">{d.slice(0, 3)}</div>)}
          {hours.map((h) => (
            <div key={h} style={{ display: 'contents' }}>
              <div className="heat-row-head" style={{ height: rowH, alignItems: 'flex-start', paddingTop: 4 }}>{String(h).padStart(2, '0')}:00</div>
              {days.map((d) => {
                const here = (byDay.get(d) ?? []).filter((s) => +s.time.slice(0, 2) === h).sort((a, b) => a.time.localeCompare(b.time));
                return (
                  <div key={d} className="schedule-lane" style={{ height: rowH }}>
                    {here.map((s) => <SlotCardView key={s.key} s={s} theme={theme} span={span} center={center} maxCap={maxCap} onClick={onClick} />)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="heat-legend">
        <span className="heat-legend-label">Under-filled</span>
        <span className="heat-legend-bar" style={{ background: `linear-gradient(90deg, ${divergingRamp(theme).join(', ')})` }} aria-hidden="true" />
        <span className="heat-legend-label">Over-filled</span>
        <span className="heat-legend-scale">centred on {Math.round(center * 100)}% · card width is capacity</span>
      </div>
    </div>
  );
}
function SlotCardView({ s, theme, span, center, maxCap, onClick }: { s: SlotCard; theme: Theme; span: number; center: number; maxCap: number; onClick?: (s: SlotCard) => void }) {
  const t = s.value === null ? 0 : (s.value - center) / span; const bg = s.value === null ? 'var(--surface-2)' : diverging(theme, t);
  const tip = useTooltip(() => <TipBody context={`${s.day.slice(0, 3)} ${s.time} · ${s.label}`} value={formatValue('percent', s.value)} n={`n = ${s.n} occurrences · capacity ${s.capacity}${s.sub ? ` · ${s.sub}` : ''}`} hint="Click to filter" />, [s.key, s.value]);
  return (
    <button {...tip} onClick={() => onClick?.(s)} className="slot-card t-num-dense"
      style={{ flex: `${Math.max(0.4, s.capacity / maxCap)} 1 0`, background: bg, color: needsInvert(bg, theme) ? 'var(--heat-text-invert)' : 'var(--text-1)' }} title={s.label}>
      <span className="slot-card-label">{s.time.slice(0, 5)} {s.label}</span>
      <span>{formatValue('percent', s.value)}</span>
    </button>
  );
}
