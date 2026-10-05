import type { Theme } from '../../design/ramps';
import { Fragment, useMemo, useState } from 'react';
import { historyMonths, metricValues, type Row } from '../../semantics/aggregations';
import { METRIC_LIST, metric, type QueryContext } from '../../semantics/metrics';
import { fmtDelta, fmtMonthShort, formatValue } from '../../semantics/formats';
import { diverging } from '../../design/ramps';
import { useView } from '../../state/view';
import { useFilters } from '../../state/filters';
import { Sparkline } from '../MetricCard/MetricCard';
import { TipBody, useTooltip } from '../Tooltip/Tooltip';
import { csvEscape, downloadText } from '../hooks';
import { maxBy } from '../../semantics/stats';

interface Props { rows: Row[]; metricIds: string[]; months: string[]; ctx: QueryContext; domain: string; title?: string; groups?: { label: string; rows: Row[] }[] }
type Mode = 'abs' | 'mom' | 'yoy' | 'index';
/* 'timeline' is the calendar run, newest first. 'yoy' puts the same calendar month from every
   year next to each other, which is the only arrangement in which a seasonal business can be
   read: December against December, not December against November. */
type Layout = 'timeline' | 'yoy';

const MODE_LABEL: Record<Mode, string> = { abs: 'Actual value', mom: 'Change on prior month', yoy: 'Change on same month last year', index: 'Indexed to 100' };
const MODE_HELP: Record<Mode, string> = {
  abs: 'the measure itself, as it would be reported.',
  mom: 'how much the figure moved against the month immediately before it, as a percentage. Blank where the earlier month was zero or missing.',
  yoy: 'how much the figure moved against the same month one year earlier, which strips out the season. Blank until there are twelve earlier months to compare with.',
  index: 'every month divided by the first month shown and multiplied by 100, so 120 means twenty per cent above where the series started. Useful for comparing measures of different sizes on one scale.',
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthPart = (iso: string) => +iso.slice(5, 7);
const yearPart = (iso: string) => iso.slice(0, 4);

export function MoMTable({ rows, metricIds, months, ctx, domain, title = 'Month on month', groups }: Props) {
  const theme = useView((s) => s.theme);
  const addTransient = useFilters((s) => s.addTransient);
  const [mode, setMode] = useState<Mode>('abs');
  const [hover, setHover] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<Set<string>>(new Set());
  const [seasonality, setSeasonality] = useState(false);
  const [layout, setLayout] = useState<Layout>('timeline');
  const [help, setHelp] = useState(false);
  const [picker, setPicker] = useState(false);
  /* The caller supplies a starting set; the operator can add any other metric computable on
     the same table rather than being held to whichever rows the tab author happened to pick. */
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const shownIds = useMemo(
    () => [...metricIds, ...extraIds].filter((id, i, a) => a.indexOf(id) === i && !hiddenIds.has(id)),
    [metricIds, extraIds, hiddenIds],
  );
  /* Year on year needs more than the fourteen months a timeline shows, or most calendar months
     would have a single year in them and there would be nothing to compare. */
  const baseMonth = months[months.length - 1] ?? '';
  const activeMonths = useMemo(
    () => (layout === 'yoy' && baseMonth ? historyMonths(baseMonth, 36) : months),
    [layout, baseMonth, months],
  );
  /** Every metric the same source table can compute, for the picker. */
  const addable = useMemo(() => {
    const table = metricIds.length ? metric(metricIds[0]).table : null;
    return METRIC_LIST.filter((m) => (!table || m.table === table) && !metricIds.includes(m.id));
  }, [metricIds]);

  const build = (rs: Row[]) => {
    const byMonth = new Map<string, Row[]>();
    for (const r of rs) if (r.month) { let a = byMonth.get(r.month); if (!a) { a = []; byMonth.set(r.month, a); } a.push(r); }
    return activeMonths.map((m) => ({ m, rows: byMonth.get(m) ?? [], values: metricValues(byMonth.get(m) ?? [], shownIds, ctx) }));
  };
  const cells = useMemo(() => build(rows), [rows, activeMonths, shownIds, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Columns read newest-first, left to right. Everything is still computed in calendar order —
     MoM compares a month with the one before it, not with its left-hand neighbour — so this is a
     display order only: `order` holds chronological indices, reversed. */
  const order = useMemo(() => {
    const idx = activeMonths.map((_, i) => i);
    if (layout === 'timeline') return idx.reverse();
    /* Group by calendar month, and within a group put the years in ascending order so each
       column sits to the right of the year it should be read against. Calendar months run in
       their natural order, which keeps a season contiguous. */
    return idx.sort((a, b) =>
      monthPart(activeMonths[a]) - monthPart(activeMonths[b])
      || activeMonths[a].localeCompare(activeMonths[b]));
  }, [activeMonths, layout]);

  /** For the year-on-year header: how many columns each calendar month spans. */
  const yoyGroups = useMemo(() => {
    if (layout !== 'yoy') return [];
    const out: { month: number; span: number }[] = [];
    for (const i of order) {
      const m = monthPart(activeMonths[i]);
      const last = out[out.length - 1];
      if (last && last.month === m) last.span += 1; else out.push({ month: m, span: 1 });
    }
    return out;
  }, [order, activeMonths, layout]);

  const groupCells = useMemo(() => (groups ?? []).map((g) => ({ label: g.label, cells: build(g.rows) })), [groups, activeMonths, shownIds, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  // A custom metric can legitimately produce no value for a month. Treat every non-finite
  // intermediate as missing before it reaches the colour ramp; passing NaN to the ramp used to
  // throw while switching to the MoM or index views and took the whole tab down.
  const finite = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const transform = (series: (number | null)[], i: number) => {
    const v = finite(series[i]);
    if (mode === 'abs') return v;
    if (mode === 'mom' || mode === 'yoy') {
      // Against the preceding calendar month, or the same month a year back. Both are computed
      // on chronological indices, so re-ordering the columns never changes the arithmetic.
      const p = finite(series[i - (mode === 'yoy' ? 12 : 1)]);
      if (v === null || p === null || p === 0) return null;
      return finite((v - p) / Math.abs(p));
    }
    const first = series.map(finite).find((x) => x !== null && x !== 0);
    return v === null || first === undefined || first === null ? null : finite((v / first) * 100);
  };

  const exportCsv = () => {
    const lines = [['Metric', ...order.map((i) => fmtMonthShort(activeMonths[i]))].join(','),
      ...shownIds.map((id) => [metric(id).label, ...order.map((i) => cells[i].values[id].value ?? '')].map(csvEscape).join(','))];
    downloadText(layout === 'yoy' ? 'year-on-year.csv' : 'month-on-month.csv', lines.join('\n'));
  };

  const renderRow = (id: string, cs: typeof cells, keyPrefix: string, indent = false) => {
    const def = metric(id); const series = cs.map((c) => c.values[id].value);
    const shown = series.map((_, i) => transform(series, i));
    const nums = shown.filter((v): v is number => v !== null);
    const center = mode === 'index' ? 100 : mode === 'mom' || mode === 'yoy' ? 0 : nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    const span = maxBy(nums, (v) => Math.abs(v - center), 0) || 1;
    const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 1;
    const rowKey = `${keyPrefix}${id}`;
    return (
      <tr key={rowKey} onMouseEnter={() => setHover(rowKey)} onMouseLeave={() => setHover(null)} style={{ position: 'relative' }}>
        <td className="pin-l t-heading-s" style={{ paddingLeft: indent ? 28 : undefined, position: 'sticky', left: 0 }}>
          {def.label}
          {hover === rowKey && <div style={{ position: 'absolute', left: 200, right: 0, top: 4, pointerEvents: 'none', opacity: 0.85 }}><Sparkline data={order.map((i) => shown[i])} width={Math.max(120, activeMonths.length * 64)} height={24} color="var(--hue)" area={false} /></div>}
        </td>
        {order.map((i) => { const c = cs[i]; return (
          <MoMCell key={c.m} id={id} v={shown[i]} raw={series[i]} prev={series[i - 1] ?? null} yoy={series[i - 12] ?? null} rank={nums.length ? [...nums].sort((a, b) => b - a).indexOf(shown[i] as number) + 1 : 0} n={c.rows.length} month={c.m} mode={mode} t={shown[i] === null ? null : ((shown[i]! - center) / span) * (def.higherIsBetter ? 1 : -1)} theme={theme} latest={layout === 'timeline' && i === cs.length - 1} hidden={hover === rowKey} seasonal={seasonality ? (shown[i] === null || !mean ? null : shown[i]! / mean - 1) : null}
            onClick={() => addTransient({ dim: 'month', value: c.m, label: fmtMonthShort(c.m) })} />); })}
      </tr>
    );
  };

  return (
    <div data-domain={domain} className="mom-table">
      <div className="mom-toolbar">
        <span className="t-heading-m">{layout === 'yoy' ? title.replace(/month on month/i, 'Year on year') : title}</span>
        <div className="mom-actions">
          <div className="mom-modes" role="radiogroup" aria-label="What each cell shows">
            {(['abs', 'mom', 'yoy', 'index'] as Mode[]).map((m) => (
              <button key={m} className="btn btn-xs" role="radio" aria-checked={mode === m} aria-pressed={mode === m} onClick={() => setMode(m)}
                title={MODE_HELP[m]}>{MODE_LABEL[m]}</button>
            ))}
          </div>
          <div className="mom-modes" role="radiogroup" aria-label="Column arrangement">
            {(['timeline', 'yoy'] as Layout[]).map((l) => (
              <button key={l} className="btn btn-xs" role="radio" aria-checked={layout === l} aria-pressed={layout === l} onClick={() => setLayout(l)}
                title={l === 'timeline' ? 'Months in calendar order, newest on the left.' : 'The same calendar month from every year side by side, so December is read against December.'}>
                {l === 'timeline' ? 'By month' : 'Year on year'}
              </button>
            ))}
          </div>
          <button className="btn btn-xs" aria-pressed={seasonality} onClick={() => setSeasonality((s) => !s)} title="Draw a bar under each cell showing how far that month sits from the row's own average.">Seasonality</button>
          <button className="btn btn-xs" aria-expanded={picker} onClick={() => setPicker((v) => !v)} title="Add any other metric this table can compute as a row.">+ Metrics{extraIds.length ? ` · ${extraIds.length}` : ''}</button>
          <button className="btn btn-xs" aria-expanded={help} onClick={() => setHelp((v) => !v)} title="Plain-English guide to reading this table.">How to read this</button>
          <button className="btn btn-xs" onClick={exportCsv}>Export CSV</button>
          {(extraIds.length > 0 || hiddenIds.size > 0) && (
            <button className="btn btn-xs" onClick={() => { setExtraIds([]); setHiddenIds(new Set()); }}>Reset rows</button>
          )}
        </div>
      </div>

      {help && (
        <div className="mom-help">
          <div className="t-heading-s">How to read this table</div>
          <p className="t-body-s">
            Every row is one measure. Every column is one month. {layout === 'yoy'
              ? 'Columns are grouped by calendar month, and inside each group the years run left to right — so the two or three figures sitting together are the same month in different years. That is the comparison to make in a business with a season.'
              : 'Months run newest first, left to right.'}
          </p>
          <p className="t-body-s"><b>{MODE_LABEL[mode]}</b> — {MODE_HELP[mode]}</p>
          <p className="t-body-s">
            <b>The colours</b> compare a cell only with other cells in its own row, never with the row above. Green means a better figure for that measure, red a worse one — the table knows which direction is good, so a low cancellation rate is green.
          </p>
          <p className="t-body-s">
            <b>A dash</b> means the figure cannot be worked out for that month — usually no rows, or none carrying the fields the measure needs. It does not mean zero.
          </p>
          <p className="t-body-s">
            <b>Clicking a cell</b> filters the whole tab to that month. Hovering a row draws its shape as a small line; hovering a cell shows the month, the change on the month before and on the same month last year, and how many rows it was built from.
          </p>
        </div>
      )}

      {picker && (
        <div className="mom-picker">
          <div className="t-label-s muted">Rows currently shown — untick to hide, or add from the list below.</div>
          <div className="mom-picker-chips">
            {[...metricIds, ...extraIds].filter((id, i, a) => a.indexOf(id) === i).map((id) => (
              <label key={id} className="mom-picker-chip">
                <input type="checkbox" checked={!hiddenIds.has(id)}
                  onChange={() => setHiddenIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />
                {metric(id).label}
              </label>
            ))}
          </div>
          <select className="input t-label-m" value="" aria-label="Add a metric row"
            onChange={(e) => { if (e.target.value) { setExtraIds((prev) => [...prev, e.target.value]); } }}>
            <option value="">Add a measure…</option>
            {addable.filter((m) => !extraIds.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.label} — {m.description.slice(0, 70)}</option>)}
          </select>
        </div>
      )}
      <div className="table-heat-legend" aria-label="Heat colours compare values within each metric row"><span>Within each metric</span><i className="heat-low" /><span>Lower</span><i className="heat-neutral" /><span>Typical</span><i className="heat-high" /><span>Higher</span></div>
      <div className="table-scroll" style={{ overflow: 'auto', border: '1px solid var(--hairline)', maxHeight: 520 }}
        data-summary={`${title} places each registered metric on a row and the latest calendar months across columns, newest first. Absolute, month-on-month and indexed views transform the same underlying monthly rollups.`}
        data-calculation="Absolute values use the metric registry formula. MoM % is (current − previous) ÷ |previous| and stays blank when the previous value is zero or missing. Index = 100 divides each month by the first non-zero month. Heat is normalized within each row; rates are recomputed from monthly numerators and denominators.">
        <table className={`tbl ${layout === 'yoy' ? 'is-yoy' : ''}`} style={{ minWidth: 200 + order.length * (layout === 'yoy' ? 58 : 72) }}>
          <thead>
            {layout === 'yoy' && (
              <tr className="mom-yoy-head">
                <th className="pin-l t-heading-s" style={{ minWidth: 200 }} rowSpan={2}>Metric</th>
                {yoyGroups.map((g, gi) => <th key={`${g.month}-${gi}`} colSpan={g.span} className="t-heading-s" style={{ textAlign: 'center' }}>{MONTH_ABBR[g.month - 1]}</th>)}
              </tr>
            )}
            <tr>
              {layout === 'timeline' && <th className="pin-l t-heading-s" style={{ minWidth: 200 }}>Metric</th>}
              {order.map((i) => (
                <th key={activeMonths[i]} className="t-heading-s"
                  style={{ minWidth: layout === 'yoy' ? 58 : 72, borderLeft: layout === 'timeline' && i === activeMonths.length - 1 ? '2px solid var(--hue)' : undefined }}>
                  {layout === 'yoy' ? yearPart(activeMonths[i]) : fmtMonthShort(activeMonths[i])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="fade-swap" key={mode}>
            {shownIds.map((id) => renderRow(id, cells, ''))}
            {groupCells.map((g) => (
              <Fragment key={g.label}>
                <tr className="l0"><td className="pin-l" colSpan={1} style={{ cursor: 'pointer' }} onClick={() => setOpenGroup((s) => { const x = new Set(s); if (x.has(g.label)) x.delete(g.label); else x.add(g.label); return x; })}><span className={`caret ${openGroup.has(g.label) ? 'open' : ''}`}>▸</span> {g.label}</td>{activeMonths.map((m) => <td key={m} />)}</tr>
                {openGroup.has(g.label) && shownIds.map((id) => renderRow(id, g.cells, `${g.label}-`, true))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="t-label-s faint" style={{ marginTop: 6 }}>
        {layout === 'yoy'
          ? 'Columns are grouped by calendar month with the years side by side, over the last three years. Every comparison is still computed on the calendar, so a change on the prior month means the month before it, not the column to its left.'
          : 'Months run newest first, left to right; every comparison is computed on the calendar rather than on neighbouring columns.'}
        {' '}Colour is scaled within each row against its own spread. Click any cell to filter the whole tab to that month.
      </div>
    </div>
  );
}

function MoMCell({ id, v, raw, prev, yoy, rank, n, month, mode, t, theme, latest, hidden, seasonal, onClick }: { id: string; v: number | null; raw: number | null; prev: number | null; yoy: number | null; rank: number; n: number; month: string; mode: Mode; t: number | null; theme: Theme; latest: boolean; hidden: boolean; seasonal: number | null; onClick: () => void }) {
  const def = metric(id);
  const tip = useTooltip(() => <TipBody context={`${def.label} · ${fmtMonthShort(month)}`} value={formatValue(def.format, raw)} delta={`${fmtDelta(def.format, raw, prev).text} vs previous month · ${fmtDelta(def.format, raw, yoy).text} vs same month last year`} rank={`Rank ${rank} of 12`} n={`n = ${n.toLocaleString('en-IN')} rows`} hint="Click to filter to this month" />, [raw, prev, month]);
  const bg = t === null ? undefined : diverging(theme, t);
  const text = v === null ? '—' : mode === 'abs' ? formatValue(def.format, v) : mode === 'mom' || mode === 'yoy' ? `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%` : v.toFixed(0);
  return (
    <td {...tip} onClick={onClick} className="t-num" style={{ background: bg ? `color-mix(in srgb, ${bg} 24%, var(--surface-1))` : undefined, borderLeft: latest ? '2px solid var(--hue)' : undefined, cursor: 'pointer', opacity: hidden ? 0.35 : 1, transition: 'background var(--m-base) var(--ease-out), opacity var(--m-instant)', position: 'relative' }}>
      {text}
      {seasonal !== null && <div style={{ position: 'absolute', left: '50%', bottom: 2, height: 3, width: `${Math.min(50, Math.abs(seasonal) * 100)}%`, background: seasonal >= 0 ? 'var(--pos)' : 'var(--neg)', transform: seasonal >= 0 ? 'none' : 'translateX(-100%)' }} />}
    </td>
  );
}
