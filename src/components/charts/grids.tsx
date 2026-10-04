import { useMemo } from 'react';
import { diverging, needsInvert, sequential } from '../../design/ramps';
import { useView } from '../../state/view';
import { formatValue, type Fmt } from '../../semantics/formats';
import { TipBody, useTooltip } from '../Tooltip/Tooltip';
import { maxBy, maxOf, minOf } from '../../semantics/stats';

export interface HeatCell { x: string; y: string; value: number | null; n: number; extra?: string }
interface HeatProps { xs: string[]; ys: string[]; cells: HeatCell[]; fmt?: Fmt; kind?: 'attendance' | 'revenue' | 'diverging'; center?: number; onClick?: (c: HeatCell) => void; cellH?: number; minN?: number; xLabel?: (x: string) => string; yLabel?: (y: string) => string; title?: string }

/** Generic X × Y heatmap. Square cells; number always carried alongside colour. */
export function Heatmap({ xs, ys, cells, fmt = 'percent', kind = 'attendance', center, onClick, cellH = 28, minN = 1, xLabel, yLabel, title }: HeatProps) {
  const theme = useView((s) => s.theme);
  const map = useMemo(() => { const m = new Map<string, HeatCell>(); for (const c of cells) m.set(`${c.x}|${c.y}`, c); return m; }, [cells]);
  const vals = cells.filter((c) => c.value !== null && c.n >= minN).map((c) => c.value as number);
  const min = minOf(vals, 0); const max = maxOf(vals, 1e-9);
  const mid = center ?? (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  const span = maxBy(vals, (v) => Math.abs(v - mid), 1e-9);
  const colorOf = (v: number) => (kind === 'diverging' ? diverging(theme, (v - mid) / span) : sequential(theme, kind, (v - min) / (max - min || 1)));
  return (
    <div style={{ overflow: 'auto' }} role="table" aria-label={title ?? 'Heatmap'}>
      <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${xs.length}, minmax(52px, 1fr))`, gap: 2, minWidth: 120 + xs.length * 54 }}>
        <div />
        {xs.map((x) => <div key={x} className="t-heading-xs muted" style={{ textAlign: 'center', padding: '2px 0' }}>{xLabel ? xLabel(x) : x}</div>)}
        {ys.map((y, yi) => (
          <HeatRow key={y} y={y} yi={yi} xs={xs} map={map} colorOf={colorOf} fmt={fmt} onClick={onClick} cellH={cellH} minN={minN} yLabel={yLabel} theme={theme} />
        ))}
      </div>
      <style>{`@keyframes fadeCell{from{opacity:0}to{opacity:1}}`}</style>
    </div>
  );
}

function HeatRow({ y, yi, xs, map, colorOf, fmt, onClick, cellH, minN, yLabel, theme }: { y: string; yi: number; xs: string[]; map: Map<string, HeatCell>; colorOf: (v: number) => string; fmt: Fmt; onClick?: (c: HeatCell) => void; cellH: number; minN: number; yLabel?: (y: string) => string; theme: 'matte' | 'gloss' }) {
  return (
    <>
      <div className="t-heading-xs muted" style={{ display: 'flex', alignItems: 'center', paddingRight: 8, justifyContent: 'flex-end' }}>{yLabel ? yLabel(y) : y}</div>
      {xs.map((x) => { const c = map.get(`${x}|${y}`); return <HeatCellView key={x} c={c} x={x} y={y} colorOf={colorOf} fmt={fmt} onClick={onClick} cellH={cellH} minN={minN} delay={yi * 20} theme={theme} />; })}
    </>
  );
}

function HeatCellView({ c, x, y, colorOf, fmt, onClick, cellH, minN, delay, theme }: { c?: HeatCell; x: string; y: string; colorOf: (v: number) => string; fmt: Fmt; onClick?: (c: HeatCell) => void; cellH: number; minN: number; delay: number; theme: 'matte' | 'gloss' }) {
  const low = !c || c.value === null || c.n < minN;
  const bg = low ? 'var(--surface-inset)' : colorOf(c!.value as number);
  const tip = useTooltip(() => <TipBody context={`${y} · ${x}`} value={c ? formatValue(fmt, c.value) : '—'} n={c ? `n = ${c.n}${c.extra ? ` · ${c.extra}` : ''}` : 'No data'} hint={onClick ? 'Click to filter' : ''} />, [c?.value]);
  return (
    <div {...tip} role="cell" tabIndex={c && onClick ? 0 : -1} onClick={() => c && onClick?.(c)} onKeyDown={(e) => { if (e.key === 'Enter' && c) onClick?.(c); }}
      className="t-num-dense" style={{ height: cellH, background: bg, color: low ? 'var(--text-3)' : needsInvert(bg, theme) ? 'var(--heat-text-invert)' : 'var(--text-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: c && onClick ? 'pointer' : 'default', animation: `fadeCell 300ms ease ${delay}ms both`, transition: 'transform var(--m-quick)', outlineOffset: -2 }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.06)'; (e.currentTarget as HTMLElement).style.zIndex = '2'; tip.onMouseEnter(e); }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.zIndex = ''; tip.onMouseLeave(); }}>
      {c && c.value !== null ? (c.n < minN ? `${formatValue(fmt, c.value)}·` : formatValue(fmt, c.value)) : ''}
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
  const rowH = 44;
  return (
    <div style={{ overflow: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `48px repeat(7, minmax(120px, 1fr))`, gap: 2, minWidth: 900 }}>
        <div />
        {days.map((d) => <div key={d} className="t-heading-xs muted" style={{ textAlign: 'center', padding: '4px 0' }}>{d.slice(0, 3)}</div>)}
        {hours.map((h) => (
          <div key={h} style={{ display: 'contents' }}>
            <div className="t-heading-xs muted" style={{ height: rowH, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingRight: 6 }}>{String(h).padStart(2, '0')}:00</div>
            {days.map((d) => {
              const here = (byDay.get(d) ?? []).filter((s) => +s.time.slice(0, 2) === h).sort((a, b) => a.time.localeCompare(b.time));
              return (
                <div key={d} style={{ height: rowH, background: 'var(--surface-inset)', display: 'flex', gap: 2, padding: 2, overflow: 'hidden' }}>
                  {here.map((s) => <SlotCardView key={s.key} s={s} theme={theme} span={span} center={center} maxCap={maxCap} onClick={onClick} />)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
function SlotCardView({ s, theme, span, center, maxCap, onClick }: { s: SlotCard; theme: 'matte' | 'gloss'; span: number; center: number; maxCap: number; onClick?: (s: SlotCard) => void }) {
  const t = s.value === null ? 0 : (s.value - center) / span; const bg = s.value === null ? 'var(--surface-2)' : diverging(theme, t);
  const tip = useTooltip(() => <TipBody context={`${s.day.slice(0, 3)} ${s.time} · ${s.label}`} value={formatValue('percent', s.value)} n={`n = ${s.n} occurrences · capacity ${s.capacity}${s.sub ? ` · ${s.sub}` : ''}`} hint="Click to filter" />, [s.key, s.value]);
  return (
    <button {...tip} onClick={() => onClick?.(s)} className="t-num-dense" style={{ flex: `${Math.max(0.4, s.capacity / maxCap)} 1 0`, minWidth: 0, background: bg, color: needsInvert(bg, theme) ? 'var(--heat-text-invert)' : 'var(--text-1)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '3px 5px', textAlign: 'left', overflow: 'hidden' }} title={s.label}>
      <span style={{ fontSize: 10, opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{s.time.slice(0, 5)} {s.label}</span>
      <span>{formatValue('percent', s.value)}</span>
    </button>
  );
}
