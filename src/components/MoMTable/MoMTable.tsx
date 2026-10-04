import { Fragment, useMemo, useState } from 'react';
import { metricValues, type Row } from '../../semantics/aggregations';
import { metric, type QueryContext } from '../../semantics/metrics';
import { fmtDelta, fmtMonthShort, formatValue } from '../../semantics/formats';
import { diverging, needsInvert } from '../../design/ramps';
import { useView } from '../../state/view';
import { useFilters } from '../../state/filters';
import { Sparkline } from '../MetricCard/MetricCard';
import { TipBody, useTooltip } from '../Tooltip/Tooltip';
import { csvEscape, downloadText } from '../hooks';
import { maxBy } from '../../semantics/stats';

interface Props { rows: Row[]; metricIds: string[]; months: string[]; ctx: QueryContext; domain: string; title?: string; groups?: { label: string; rows: Row[] }[] }
type Mode = 'abs' | 'mom' | 'index';

export function MoMTable({ rows, metricIds, months, ctx, domain, title = 'Month on month', groups }: Props) {
  const theme = useView((s) => s.theme);
  const addTransient = useFilters((s) => s.addTransient);
  const [mode, setMode] = useState<Mode>('abs');
  const [hover, setHover] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<Set<string>>(new Set());
  const [seasonality, setSeasonality] = useState(false);

  const build = (rs: Row[]) => {
    const byMonth = new Map<string, Row[]>();
    for (const r of rs) if (r.month) { let a = byMonth.get(r.month); if (!a) { a = []; byMonth.set(r.month, a); } a.push(r); }
    return months.map((m) => ({ m, rows: byMonth.get(m) ?? [], values: metricValues(byMonth.get(m) ?? [], metricIds, ctx) }));
  };
  const cells = useMemo(() => build(rows), [rows, months, metricIds, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupCells = useMemo(() => (groups ?? []).map((g) => ({ label: g.label, cells: build(g.rows) })), [groups, months, metricIds, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  const transform = (series: (number | null)[], i: number) => {
    const v = series[i];
    if (mode === 'abs') return v;
    if (mode === 'mom') { const p = series[i - 1]; return v === null || p === null || p === 0 ? null : (v - p) / Math.abs(p); }
    const first = series.find((x) => x !== null && x !== 0); return v === null || first === undefined || first === null ? null : (v / first) * 100;
  };

  const exportCsv = () => {
    const lines = [['Metric', ...months.map(fmtMonthShort)].join(','), ...metricIds.map((id) => [metric(id).label, ...cells.map((c) => c.values[id].value ?? '')].map(csvEscape).join(','))];
    downloadText('month-on-month.csv', lines.join('\n'));
  };

  const renderRow = (id: string, cs: typeof cells, keyPrefix: string, indent = false) => {
    const def = metric(id); const series = cs.map((c) => c.values[id].value);
    const shown = series.map((_, i) => transform(series, i));
    const nums = shown.filter((v): v is number => v !== null);
    const center = mode === 'index' ? 100 : mode === 'mom' ? 0 : nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    const span = maxBy(nums, (v) => Math.abs(v - center), 0) || 1;
    const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 1;
    const rowKey = `${keyPrefix}${id}`;
    return (
      <tr key={rowKey} onMouseEnter={() => setHover(rowKey)} onMouseLeave={() => setHover(null)} style={{ position: 'relative' }}>
        <td className="pin-l t-heading-s" style={{ paddingLeft: indent ? 28 : undefined, position: 'sticky', left: 0 }}>
          {def.label}
          {hover === rowKey && <div style={{ position: 'absolute', left: 200, right: 0, top: 4, pointerEvents: 'none', opacity: 0.85 }}><Sparkline data={shown} width={Math.max(120, months.length * 64)} height={24} color="var(--hue)" area={false} /></div>}
        </td>
        {cs.map((c, i) => <MoMCell key={c.m} id={id} v={shown[i]} raw={series[i]} prev={series[i - 1] ?? null} yoy={series[i - 12] ?? null} rank={nums.length ? [...nums].sort((a, b) => b - a).indexOf(shown[i] as number) + 1 : 0} n={c.rows.length} month={c.m} mode={mode} t={shown[i] === null ? null : ((shown[i]! - center) / span) * (def.higherIsBetter ? 1 : -1)} theme={theme} last={i === cs.length - 1} hidden={hover === rowKey} seasonal={seasonality ? (shown[i] === null || !mean ? null : shown[i]! / mean - 1) : null}
          onClick={() => addTransient({ dim: 'month', value: c.m, label: fmtMonthShort(c.m) })} />)}
      </tr>
    );
  };

  return (
    <div data-domain={domain}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span className="t-heading-m">{title}</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 2 }} role="radiogroup" aria-label="Display mode">
          {(['abs', 'mom', 'index'] as Mode[]).map((m) => <button key={m} className="btn btn-xs" role="radio" aria-checked={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'abs' ? 'Absolute' : m === 'mom' ? 'MoM %' : 'Index = 100'}</button>)}
        </div>
        <button className="btn btn-xs" aria-pressed={seasonality} onClick={() => setSeasonality((s) => !s)}>Seasonality</button>
        <button className="btn btn-xs" onClick={exportCsv}>Export CSV</button>
      </div>
      <div style={{ overflow: 'auto', border: '1px solid var(--hairline)', maxHeight: 520 }}>
        <table className="tbl" style={{ minWidth: 200 + months.length * 72 }}>
          <thead><tr><th className="pin-l t-heading-s" style={{ minWidth: 200 }}>Metric</th>{months.map((m, i) => <th key={m} className="t-heading-s" style={{ minWidth: 72, borderRight: i === months.length - 1 ? '1px solid var(--hue)' : undefined }}>{fmtMonthShort(m)}</th>)}</tr></thead>
          <tbody className="fade-swap" key={mode}>
            {metricIds.map((id) => renderRow(id, cells, ''))}
            {groupCells.map((g) => (
              <Fragment key={g.label}>
                <tr className="l0"><td className="pin-l" colSpan={1} style={{ cursor: 'pointer' }} onClick={() => setOpenGroup((s) => { const x = new Set(s); if (x.has(g.label)) x.delete(g.label); else x.add(g.label); return x; })}><span className={`caret ${openGroup.has(g.label) ? 'open' : ''}`}>▸</span> {g.label}</td>{months.map((m) => <td key={m} />)}</tr>
                {openGroup.has(g.label) && metricIds.map((id) => renderRow(id, g.cells, `${g.label}-`, true))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="t-label-s faint" style={{ marginTop: 6 }}>Heat is normalised per row against its own distribution. Click a cell to filter the whole tab to that month.</div>
    </div>
  );
}

function MoMCell({ id, v, raw, prev, yoy, rank, n, month, mode, t, theme, last, hidden, seasonal, onClick }: { id: string; v: number | null; raw: number | null; prev: number | null; yoy: number | null; rank: number; n: number; month: string; mode: Mode; t: number | null; theme: 'matte' | 'gloss'; last: boolean; hidden: boolean; seasonal: number | null; onClick: () => void }) {
  const def = metric(id);
  const tip = useTooltip(() => <TipBody context={`${def.label} · ${fmtMonthShort(month)}`} value={formatValue(def.format, raw)} delta={`${fmtDelta(def.format, raw, prev).text} vs previous month · ${fmtDelta(def.format, raw, yoy).text} vs same month last year`} rank={`Rank ${rank} of 12`} n={`n = ${n.toLocaleString('en-IN')} rows`} hint="Click to filter to this month" />, [raw, prev, month]);
  const bg = t === null ? undefined : diverging(theme, t);
  const text = v === null ? '—' : mode === 'abs' ? formatValue(def.format, v) : mode === 'mom' ? `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%` : v.toFixed(0);
  return (
    <td {...tip} onClick={onClick} className="t-num" style={{ background: bg, color: bg && t !== null && Math.abs(t) > 0.62 && needsInvert(bg, theme) ? 'var(--heat-text-invert)' : undefined, borderRight: last ? '1px solid var(--hue)' : undefined, cursor: 'pointer', opacity: hidden ? 0.35 : 1, transition: 'background var(--m-base) var(--ease-out), opacity var(--m-instant)', position: 'relative' }}>
      {text}
      {seasonal !== null && <div style={{ position: 'absolute', left: '50%', bottom: 2, height: 3, width: `${Math.min(50, Math.abs(seasonal) * 100)}%`, background: seasonal >= 0 ? 'var(--pos)' : 'var(--neg)', transform: seasonal >= 0 ? 'none' : 'translateX(-100%)' }} />}
    </td>
  );
}
