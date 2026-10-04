import { useEffect, useMemo, useState } from 'react';
import { useOverlay } from '../../state/overlays';
import { useDrill } from '../../state/drill';
import { useScope } from '../../state/data';
import { metric } from '../../semantics/metrics';
import { lastNMonths, metricValues, seriesBy, type Row } from '../../semantics/aggregations';
import { fmtDate, fmtMonthShort, formatValue } from '../../semantics/formats';
import { MetricCard } from '../MetricCard/MetricCard';
import { XYChart } from '../charts/core';
import { SHEETS, sheetUiUrl } from '../../data/sheets.config';
import { formatColor } from '../../design/ramps';
import { useView } from '../../state/view';
import { runRules } from '../../insights/engine';
import { InsightCard } from '../InsightCard/InsightCard';

/** `get` is for columns the row does not store directly — an outcome is derived from four flags. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Field = { k: string; label: string; fmt?: 'currency' | 'percent' | 'date'; get?: (r: any) => unknown };
const ROW_FIELDS: Record<string, Field[]> = {
  /* The canonical visit grain is what most tabs drill into now. Without an entry here the panel
     rendered a table with no columns — the detail the drill-down exists to show. */
  visits: [{ k: 'date', label: 'Date', fmt: 'date' }, { k: 'time', label: 'Time' }, { k: 'member_name', label: 'Member' }, { k: 'member_id', label: 'Member ID' },
    { k: 'class_name', label: 'Class' }, { k: 'format', label: 'Format' }, { k: 'trainer', label: 'Trainer' }, { k: 'location_short', label: 'Studio' },
    { k: 'outcome', label: 'Outcome', get: (r) => (r.cancelled ? 'Cancelled ahead' : r.late_cancelled ? 'Late cancelled' : r.attended ? 'Attended' : r.no_show ? 'No-show' : 'Other') },
    { k: 'class_no', label: 'Visit #' }, { k: 'membership_type', label: 'Paid with' }, { k: 'product', label: 'Product' },
    { k: 'paid', label: 'Paid', fmt: 'currency' }, { k: 'lead_time_days', label: 'Booked ahead' }, { k: 'capacity', label: 'Cap' },
    { k: 'is_new_label', label: 'Visit type' },
    { k: 'source_coverage', label: 'Source', get: (r) => (r.in_checkins && r.in_bookings ? 'Both sheets' : r.in_checkins ? 'Checkins only' : 'Bookings only') }],
  sessions: [{ k: 'date', label: 'Date', fmt: 'date' }, { k: 'time', label: 'Time' }, { k: 'trainer', label: 'Trainer' }, { k: 'class_name', label: 'Class' }, { k: 'capacity', label: 'Cap' }, { k: 'checked_in', label: 'In' }, { k: 'booked', label: 'Booked' }, { k: 'revenue', label: 'Revenue', fmt: 'currency' }],
  checkins: [{ k: 'date', label: 'Date', fmt: 'date' }, { k: 'time', label: 'Time' }, { k: 'name', label: 'Member' }, { k: 'trainer', label: 'Trainer' }, { k: 'class_name', label: 'Class' }, { k: 'checked_in', label: 'In' }, { k: 'paid', label: 'Paid', fmt: 'currency' }],
  sales: [{ k: 'date', label: 'Date', fmt: 'date' }, { k: 'customer', label: 'Customer' }, { k: 'product', label: 'Product' }, { k: 'category', label: 'Category' }, { k: 'sold_by', label: 'Sold by' }, { k: 'value', label: 'Value', fmt: 'currency' }, { k: 'discount', label: 'Discount', fmt: 'currency' }],
  newc: [{ k: 'date', label: 'First visit', fmt: 'date' }, { k: 'name', label: 'Client' }, { k: 'source', label: 'Source' }, { k: 'trainer', label: 'Trainer' }, { k: 'conversion_status', label: 'Conversion' }, { k: 'lifecycle', label: 'Lifecycle' }, { k: 'ltv', label: 'LTV', fmt: 'currency' }],
  lapsed: [{ k: 'member_name', label: 'Member' }, { k: 'membership_name', label: 'Membership' }, { k: 'status', label: 'Status' }, { k: 'end_date', label: 'Ends', fmt: 'date' }, { k: 'completed', label: 'Used' }, { k: 'days_since_last_visit', label: 'Days absent' }, { k: 'risk_score', label: 'Risk' }, { k: 'amount_paid', label: 'Paid', fmt: 'currency' }],
  payroll: [{ k: 'trainer', label: 'Trainer' }, { k: 'location', label: 'Location' }, { k: 'month', label: 'Month' }, { k: 'total_sessions', label: 'Sessions' }, { k: 'total_customers', label: 'Customers' }, { k: 'total_paid', label: 'Paid', fmt: 'currency' }],
  leads: [{ k: 'date', label: 'Created', fmt: 'date' }, { k: 'name', label: 'Lead' }, { k: 'source_name', label: 'Source' }, { k: 'associate', label: 'Associate' }, { k: 'stage', label: 'Stage' }, { k: 'status', label: 'Status' }, { k: 'touches', label: 'Touches' }],
  bookings: [{ k: 'date', label: 'Class date', fmt: 'date' }, { k: 'customer', label: 'Member' }, { k: 'teacher', label: 'Teacher' }, { k: 'class_name', label: 'Class' }, { k: 'attended', label: 'Attended' }, { k: 'late_cancelled', label: 'Late' }, { k: 'no_show', label: 'No-show' }, { k: 'value', label: 'Value', fmt: 'currency' }],
};

export function DrillPanel() {
  const { stack, index, back, forward, close } = useDrill();
  const t = stack[index];
  const scope = useScope();
  const theme = useView((s) => s.theme);
  const [rowsShown, setRowsShown] = useState(60);
  useEffect(() => { setRowsShown(60); }, [t]);
  useOverlay(!!t, close);
  useEffect(() => {
    if (!t) return;
    const el = t.sourceEl; el?.classList.add('selected'); const id = window.setTimeout(() => el?.classList.remove('selected'), 2000);
    return () => { window.clearTimeout(id); el?.classList.remove('selected'); };
  }, [t, close]);

  const ctx = scope?.ctx;
  const kpis = useMemo(() => (t && ctx ? metricValues(t.rows, t.metricIds.slice(0, 4), ctx) : null), [t, ctx]);
  const ranks = useMemo(() => {
    if (!t || !ctx || !t.peers) return null;
    const out: Record<string, { pos: number; of: number }> = {};
    for (const id of t.metricIds.slice(0, 4)) {
      const def = metric(id); const vals = t.peers.map((p) => ({ label: p.label, v: metricValues(p.rows, [id], ctx)[id].value })).filter((x) => x.v !== null) as { label: string; v: number }[];
      vals.sort((a, b) => (def.higherIsBetter ? b.v - a.v : a.v - b.v));
      const pos = vals.findIndex((x) => x.label === t.title) + 1; out[id] = { pos: pos || vals.length, of: vals.length };
    }
    return out;
  }, [t, ctx]);
  const trend = useMemo(() => {
    if (!t || !ctx || !scope) return null;
    const months = lastNMonths(scope.today.slice(0, 7), 13);
    const id = t.metricIds[0];
    const own = seriesBy(t.rows, (r) => r.month, [id], ctx, months).map((s) => s.values[id].value);
    const peerSeries = (t.peers ?? []).map((p) => seriesBy(p.rows, (r) => r.month, [id], ctx, months).map((s) => s.values[id].value));
    const median = months.map((_, i) => { const v = peerSeries.map((s) => s[i]).filter((x): x is number => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; });
    return { months, own, median, id };
  }, [t, ctx, scope]);
  const composition = useMemo(() => {
    if (!t) return [];
    const key = t.table === 'sales' ? 'category' : t.table === 'newc' ? 'source' : t.table === 'lapsed' ? 'membership_type' : t.table === 'leads' ? 'status' : 'format';
    const m = new Map<string, number>(); for (const r of t.rows) m.set(r[key] ?? '(none)', (m.get(r[key] ?? '(none)') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [t]);
  const neighbours = useMemo(() => {
    if (!t || !ctx || !t.peers) return [];
    const id = t.metricIds[0]; const def = metric(id);
    const vals = t.peers.map((p) => ({ label: p.label, v: metricValues(p.rows, [id], ctx)[id].value, rows: p.rows })).filter((x) => x.v !== null) as { label: string; v: number; rows: Row[] }[];
    vals.sort((a, b) => (def.higherIsBetter ? b.v - a.v : a.v - b.v));
    const i = vals.findIndex((x) => x.label === t.title); return vals.slice(Math.max(0, i - 5), i + 6).map((x, j) => ({ ...x, self: x.label === t.title, pos: Math.max(0, i - 5) + j + 1 }));
  }, [t, ctx]);
  const insights = useMemo(() => (t && scope ? runRules(scope, useView.getState().thresholds).filter((i) => t.rows.length && (i.entity === t.title || t.breadcrumb.includes(i.entity))).slice(0, 4) : []), [t, scope]);
  if (!t || !scope || !ctx) return null;
  const sheet = SHEETS.find((s) => s.key === (t.table === 'newc' ? 'new' : t.table));
  const fields = ROW_FIELDS[t.table] ?? [];
  const open = useDrill.getState().open;
  return (
    <>
      <div onClick={close} style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 60, opacity: 0.5 }} aria-hidden="true" />
      <aside className="slide-in" data-domain={t.domain} role="dialog" aria-label={`Details for ${t.title}`} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(960px, 92vw)', maxWidth: '100vw', background: 'var(--surface-1)', borderLeft: '1px solid var(--hairline-strong)', zIndex: 61, overflow: 'auto', boxShadow: 'var(--elev-4)' }}>
        <div className="barre barre-glow" style={{ position: 'sticky', top: 0, zIndex: 2 }} />
        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <button className="btn btn-xs" disabled={index <= 0} onClick={back} aria-label="Back">‹</button>
            <button className="btn btn-xs" disabled={index >= stack.length - 1} onClick={forward} aria-label="Forward">›</button>
            <nav className="t-label-s muted" aria-label="Breadcrumb" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{t.breadcrumb.map((b, i) => <span key={i}>{i > 0 && <span className="faint"> / </span>}{b}</span>)}</nav>
            <div style={{ flex: 1 }} />
            <button className="btn btn-xs" onClick={close}>Close <span className="kbd">Esc</span></button>
          </div>
          <h2 className="t-display-s" style={{ margin: '0 0 14px' }}>{t.title} <span className="t-label-m muted">{t.rows.length.toLocaleString('en-IN')} rows</span></h2>
          <div className="kpi-strip" style={{ ['--kpi-cols' as string]: Math.min(4, t.metricIds.length) }}>
            {kpis && t.metricIds.slice(0, 8).map((id, i) => <MetricCard key={id} metricId={id} value={kpis[id].value} n={kpis[id].n} coverage={kpis[id].coverage} contributing={kpis[id].contributing} suspect={kpis[id].suspect} variant="inline" index={i} rank={ranks?.[id]} />)}
          </div>
          {trend && (
            <div style={{ marginTop: 18 }}>
              <div className="t-heading-m" style={{ marginBottom: 6 }}>{metric(trend.id).label}, 13 months vs peer median</div>
              <XYChart categories={trend.months.map(fmtMonthShort)} series={[{ id: 'own', label: t.title, color: 'var(--hue)', values: trend.own, fmt: metric(trend.id).format }, { id: 'med', label: 'Peer median', color: 'var(--text-3)', values: trend.median, fmt: metric(trend.id).format, ghost: true }]} height={180} fmtLeft={metric(trend.id).format} />
            </div>
          )}
          {composition.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="t-heading-m" style={{ marginBottom: 6 }}>Composition</div>
              <div style={{ display: 'flex', height: 14, background: 'var(--surface-inset)' }}>{composition.map(([k, v], i) => <div key={k} title={`${k}: ${v}`} style={{ width: `${(v / t.rows.length) * 100}%`, background: formatColor(theme, k) !== formatColor(theme, 'Unknown') ? formatColor(theme, k) : `color-mix(in oklch, var(--hue) ${100 - i * 15}%, var(--surface-1))` }} />)}</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>{composition.map(([k, v]) => <span key={k} className="t-label-s muted">{k} {((v / t.rows.length) * 100).toFixed(0)}%</span>)}</div>
            </div>
          )}
          {neighbours.length > 1 && (
            <div style={{ marginTop: 18 }}>
              <div className="t-heading-m" style={{ marginBottom: 6 }}>Nearest peers by {metric(t.metricIds[0]).label}</div>
              <table className="tbl"><tbody>{neighbours.map((n) => <tr key={n.label} className={n.self ? 'selected' : ''} style={{ cursor: n.self ? 'default' : 'pointer' }} onClick={() => !n.self && open({ ...t, title: n.label, rows: n.rows, breadcrumb: [...t.breadcrumb.slice(0, -1), n.label], sourceEl: null })}><td className="t-body-s"><span className="medal" style={{ marginRight: 6 }}>{n.pos}</span>{n.label}</td><td className="t-num">{formatValue(metric(t.metricIds[0]).format, n.v)}</td></tr>)}</tbody></table>
            </div>
          )}
          {insights.length > 0 && <div style={{ marginTop: 18, display: 'grid', gap: 8 }}><div className="t-heading-m">Insights for this entity</div>{insights.map((i) => <InsightCard key={i.key} insight={i} compact />)}</div>}
          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><div className="t-heading-m">Contributing rows</div><div style={{ flex: 1 }} />{sheet && <a className="btn btn-xs" href={sheetUiUrl(sheet.spreadsheetId)} target="_blank" rel="noreferrer">Open source sheet</a>}</div>
            <div className="table-scroll" style={{ maxHeight: 420 }}>
              <table className="tbl"><thead><tr>{fields.map((f) => <th key={f.k} className="t-heading-s">{f.label}</th>)}</tr></thead>
                <tbody>{t.rows.slice(0, rowsShown).map((r, i) => <tr key={i}>{fields.map((f) => { const v = f.get ? f.get(r) : r[f.k]; return <td key={f.k} className={f.fmt === 'currency' || typeof v === 'number' ? 't-num' : 't-body-s'}>{f.fmt === 'currency' ? formatValue('currency', v as number, { full: true }) : f.fmt === 'date' ? fmtDate(v as string) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' ? formatValue('decimal', v) : (v as string) ?? '—'}</td>; })}</tr>)}</tbody></table>
            </div>
            {t.rows.length > rowsShown && <button className="btn btn-xs" style={{ marginTop: 6 }} onClick={() => setRowsShown((n) => n + 200)}>Show more ({t.rows.length - rowsShown} remaining)</button>}
          </div>
        </div>
      </aside>
    </>
  );
}
