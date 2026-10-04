import { useMemo, useState } from 'react';
import type { Scope } from '../state/data';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { MixedKpiStrip, DayTimeHeatmap, Two, useMonths, filtersLabel } from './common';
import { PulseRibbon } from '../components/charts/special';
import { RevenueDrivers } from '../components/charts/RevenueDrivers';
import { ChartModule, HBars, XYChart } from '../components/charts/core';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { metricValues, rollupLevel, seriesBy, type RollupNode, type Row } from '../semantics/aggregations';
import { metric } from '../semantics/metrics';
import { fmtCurrency, fmtDelta, fmtMonthShort, formatValue } from '../semantics/formats';
import { useFilters } from '../state/filters';
import { useView } from '../state/view';
import { runRules, isDismissed } from '../insights/engine';
import { InsightCard } from '../components/InsightCard/InsightCard';
import { Sparkline } from '../components/MetricCard/MetricCard';

const HEADLINE = ['gross_revenue', 'visits', 'fill_rate', 'new_clients', 'conversion_rate', 'active_memberships', 'churn_rate', 'sessions', 'empty_session_rate', 'aov', 'second_visit_rate', 'revenue_at_risk_30d'];
const TABLE_OF: Record<string, 'sessions' | 'sales' | 'newc' | 'lapsed' | 'visits'> = { gross_revenue: 'sales', visits: 'visits', fill_rate: 'sessions', new_clients: 'newc', conversion_rate: 'newc', active_memberships: 'lapsed', churn_rate: 'lapsed', sessions: 'sessions', empty_session_rate: 'sessions', aov: 'sales', second_visit_rate: 'newc', revenue_at_risk_30d: 'lapsed' };

let ribbonPlayed = false;

export function Overview({ scope }: { scope: Scope }) {
  const set = useFilters((s) => s.set);
  const months = useMonths(scope);
  const [played, setPlayed] = useState(ribbonPlayed);
  const [loc, setLoc] = useState<string | null>(null);
  const { thresholds, dismissed } = useView();

  const ribbon = useMemo(() => {
    const end = new Date(scope.today + 'T00:00:00Z'); const days: { date: string; attendance: number | null; revenue: number | null; sessions: { fill: number }[] }[] = [];
    const bySess = new Map<string, Row[]>(); for (const r of scope.all.sessions) if (r.date) { let a = bySess.get(r.date); if (!a) { a = []; bySess.set(r.date, a); } a.push(r); }
    const bySale = new Map<string, number>(); for (const r of scope.all.sales) if (r.date) bySale.set(r.date, (bySale.get(r.date) ?? 0) + (r.value ?? 0));
    for (let i = 89; i >= 0; i--) { const d = new Date(end); d.setUTCDate(d.getUTCDate() - i); const k = d.toISOString().slice(0, 10); const ss = bySess.get(k) ?? []; days.push({ date: k, attendance: ss.length ? ss.reduce((a, r) => a + (r.checked_in ?? 0), 0) : null, revenue: bySale.has(k) ? bySale.get(k)! : null, sessions: ss.map((r) => ({ fill: r.capacity ? Math.min(1, (r.checked_in ?? 0) / r.capacity) : 0 })) }); }
    return days;
  }, [scope]);

  /* Volume and price already explain the revenue change exactly:
       (txCur − txPrev)·aovPrev + (aovCur − aovPrev)·txCur ≡ curRev − prevRev
     Adding mix, new-member sales and an assumed churn exposure on top forced "Other" to become a
     balancing plug, not a driver. Those three overlap with volume and price and with each other,
     so they are reported beside the bridge as context, never as bars inside it. */
  const bridge = useMemo(() => {
    const cur = scope.tables.sales; const prev = scope.compare.sales;
    const v = (rows: Row[]) => metricValues(rows, ['gross_revenue', 'transactions'], scope.ctx);
    const vc = v(cur); const vp = v(prev);
    const prevRev = vp.gross_revenue.value ?? 0; const curRev = vc.gross_revenue.value ?? 0;
    const txPrev = vp.transactions.value || 1; const txCur = vc.transactions.value || 1;
    const aovPrev = prevRev / txPrev; const aovCur = curRev / txCur;
    const volume = (txCur - txPrev) * aovPrev; const price = (aovCur - aovPrev) * txCur;
    return [{ label: scope.period.prevLabel, value: prevRev, total: true }, { label: 'Transactions', value: volume }, { label: 'Average transaction value', value: price }, { label: scope.period.label, value: curRev, total: true }];
  }, [scope]);

  /* Overlapping context, each measured on its own terms and never summed with the bridge. */
  const bridgeContext = useMemo(() => {
    const cur = scope.tables.sales; const prev = scope.compare.sales;
    const g = (rows: Row[]) => metricValues(rows, ['gross_revenue'], scope.ctx).gross_revenue.value ?? 0;
    const newIds = new Set(scope.tables.newc.filter((r) => r.is_new).map((r) => r.member_id));
    // Category shares use the allocated metric, so a mixed-category sale contributes exactly once.
    const memShare = (rows: Row[]) => metricValues(rows, ['membership_rev_share'], scope.ctx).membership_rev_share.value ?? 0;
    const churned = scope.tables.lapsed.filter((r) => r.churned_date && r.churned_date >= scope.period.start && r.churned_date <= scope.period.end);
    return [
      { label: 'Sales to first-time members', value: g(cur.filter((r) => newIds.has(r.member_id))), note: 'Part of the volume and price movement above, not additional to it.' },
      { label: 'Membership share of revenue', value: null as number | null, pct: memShare(cur), delta: memShare(cur) - memShare(prev), note: 'A mix shift inside the same revenue, so it cannot add rupees to the bridge.' },
      { label: 'Amount paid on memberships that churned this period', value: churned.reduce((a, r) => a + (r.amount_paid ?? 0), 0), note: `${churned.length.toLocaleString('en-IN')} memberships. Revenue already banked — exposure for future periods, not a deduction from this one.` },
    ];
  }, [scope]);

  // Location → Domain → Metric table (custom nodes)
  const locTable = useMemo(() => {
    const locs = [...new Set([...scope.tables.sessions, ...scope.tables.sales, ...scope.tables.newc, ...scope.tables.lapsed].map((r) => r.location).filter(Boolean))] as string[];
    const rows: { location: string; domain: string; metric: string; cur: number | null; prev: number | null; spark: (number | null)[] }[] = [];
    for (const l of locs) for (const id of HEADLINE) { const t = TABLE_OF[id]; const f = (rs: Row[]) => rs.filter((r) => r.location === l); const cur = metricValues(f(scope.tables[t]), [id], scope.ctx)[id].value; const prev = metricValues(f(scope.compare[t]), [id], scope.ctx)[id].value; const spark = seriesBy(f(scope.all[t]), (r) => r.month, [id], scope.ctx, months).map((s) => s.values[id].value); rows.push({ location: l, domain: metric(id).domain, metric: id, cur, prev, spark }); }
    return rows;
  }, [scope, months]);

  const movers = useMemo(() => {
    const out: { label: string; value: number; sub: string }[] = [];
    const push = (label: string, cur: number | null, prev: number | null, sub: string) => { if (cur !== null && prev !== null) out.push({ label, value: cur - prev, sub }); };
    /* Allocated revenue, not a raw line-item sum: a product's movement has to reconcile with the
       product table and with the bridge above it. */
    for (const n of rollupLevel(scope.tables.sales, ['product'], 0, ['category_revenue'], scope.ctx)) {
      const prev = scope.compare.sales.filter((r) => r.product === n.key);
      push(n.key, n.values.category_revenue.value, metricValues(prev, ['category_revenue'], scope.ctx).category_revenue.value, 'product');
    }
    for (const n of rollupLevel(scope.tables.sessions, ['trainer'], 0, ['revenue'], scope.ctx)) {
      const prev = scope.compare.sessions.filter((r) => r.trainer === n.key);
      push(n.key, n.values.revenue.value, metricValues(prev, ['revenue'], scope.ctx).revenue.value, 'trainer');
    }
    return out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 12);
  }, [scope]);

  const smallMultiples = useMemo(() => {
    const locs = [...new Set(scope.all.sales.map((r) => r.location).filter(Boolean))] as string[];
    return locs.map((l) => ({ l, series: seriesBy(scope.all.sales.filter((r) => r.location === l), (r) => r.month, ['gross_revenue'], scope.ctx, months).map((s) => s.values.gross_revenue.value), cur: metricValues(scope.tables.sales.filter((r) => r.location === l), ['gross_revenue'], scope.ctx).gross_revenue.value }));
  }, [scope, months]);

  const insights = useMemo(() => runRules(scope, thresholds).filter((i) => !isDismissed(dismissed, i.key)), [scope, thresholds, dismissed]);

  const columns: ColumnDef[] = [
    { id: 'cur', label: 'Current', family: 'Volume', value: (n) => n.rows[0]?.cur ?? null, format: 'decimal', render: (n) => <span className="t-num">{n.level === 2 ? formatValue(metric(n.rows[0].metric).format, n.rows[0].cur) : ''}</span> },
    { id: 'prev', label: scope.period.prevLabel, family: 'Volume', value: (n) => n.rows[0]?.prev ?? null, render: (n) => <span className="t-num muted">{n.level === 2 ? formatValue(metric(n.rows[0].metric).format, n.rows[0].prev) : ''}</span> },
    { id: 'var', label: 'Variance', family: 'Volume', value: (n) => (n.rows[0] && n.rows[0].cur !== null && n.rows[0].prev !== null ? n.rows[0].cur - n.rows[0].prev : null), render: (n) => { if (n.level !== 2) return ''; const d = fmtDelta(metric(n.rows[0].metric).format, n.rows[0].cur, n.rows[0].prev); const good = d.value === null ? null : (d.value >= 0) === metric(n.rows[0].metric).higherIsBetter; return <span className={`t-num ${good === null ? '' : good ? 'pos' : 'neg'}`}>{d.text}</span>; } },
    { id: 'spark', label: '14 months', family: 'Behaviour', render: (n) => (n.level === 2 ? <Sparkline data={n.rows[0].spark} width={80} height={18} color="var(--hue)" area={false} /> : '') },
    { id: 'rank', label: 'Rank across locations', family: 'Score', render: (n) => { if (n.level !== 2) return ''; const id = n.rows[0].metric; const peers = locTable.filter((r) => r.metric === id && r.cur !== null).sort((a, b) => (metric(id).higherIsBetter ? (b.cur ?? 0) - (a.cur ?? 0) : (a.cur ?? 0) - (b.cur ?? 0))); const pos = peers.findIndex((r) => r.location === n.rows[0].location) + 1; return <span className="t-num">{pos ? `#${pos} of ${peers.length}` : '—'}</span>; } },
  ];

  const heatRows = loc ? scope.tables.sessions.filter((r) => r.location === loc) : scope.tables.sessions;
  const locs = [...new Set(scope.tables.sessions.map((r) => r.location).filter(Boolean))] as string[];
  const previousTransactions = metricValues(scope.compare.sales, ['transactions'], scope.ctx).transactions.value ?? 0;
  const currentTransactions = metricValues(scope.tables.sales, ['transactions'], scope.ctx).transactions.value ?? 0;

  return (
    <>
      <WidgetSection tab="overview" scope={scope} placement="top" />
      <div className="overview-workspace">
      <div style={{ padding: '8px 0 0' }}>
        <PulseRibbon days={ribbon} played={played} onPlayed={() => { ribbonPlayed = true; setPlayed(true); }} onRange={(s, e) => set({ preset: 'custom', start: s, end: e })} />
      </div>
      <Register title="Business state" subtitle={`${scope.period.label} versus ${scope.period.prevLabel}: revenue, studio visits, new members, and retention in one view.`} domain="attendance">
        <MixedKpiStrip scope={scope} items={[{ table: 'sales', id: 'gross_revenue' }, { table: 'sales', id: 'aov' }, { table: 'visits', id: 'visits' }, { table: 'sessions', id: 'fill_rate' }, { table: 'newc', id: 'new_clients' }, { table: 'newc', id: 'conversion_rate' }, { table: 'lapsed', id: 'active_memberships' }, { table: 'lapsed', id: 'churn_rate' }]} />
      </Register>
      <Register title="Why revenue moved" subtitle="Volume and price account for the whole change between the two periods. Mix, first-time sales and churn exposure overlap with them, so they are shown separately below rather than added in." domain="revenue">
        <ChartModule title="What changed revenue" subtitle="Compare the two periods, then select a driver to see how it contributed." table={{ columns: ['Step', 'Value'], rows: bridge.map((b) => [b.label, Math.round(b.value)]) }}>
          <RevenueDrivers previous={bridge[0].value} current={bridge[3].value} volume={bridge[1].value} price={bridge[2].value}
            previousTransactions={previousTransactions} currentTransactions={currentTransactions}
            previousLabel={scope.period.prevLabel} currentLabel={scope.period.label} />
        </ChartModule>
        <div className="t-label-s faint" style={{ marginTop: 6 }}>Transaction effect = change in transactions × earlier average value. Average value effect = change in average value × current transactions. Together they reconcile to the revenue change.</div>
        <div style={{ marginTop: 14 }}>
          <div className="t-heading-s" style={{ marginBottom: 4 }}>Related context — already reflected in the revenue change</div>
          <div className="table-scroll overview-context-table"><table className="tbl"><tbody>{bridgeContext.map((c) => <tr key={c.label}>
            <td className="t-body-s">{c.label}</td>
            <td className="t-num">{c.value !== null ? fmtCurrency(c.value) : `${formatValue('percent', c.pct ?? null)} (${(c.delta ?? 0) >= 0 ? '+' : ''}${formatValue('pp', c.delta ?? null)})`}</td>
            <td className="t-label-s faint">{c.note}</td>
          </tr>)}</tbody></table></div>
        </div>
      </Register>
      <Register title="Location scorecard" subtitle="Location → domain → metric, with 14-month shape and rank" domain="attendance" id="drill-table">
        <NestedTable title="Location scorecard" rows={locTable.map((r) => ({ ...r, location: r.location, domainLabel: r.domain, metricLabel: metric(r.metric).label }))} table="sessions" groupKeys={['ov_location', 'ov_domain', 'ov_metric']} availableKeys={['ov_location', 'ov_domain', 'ov_metric']} columns={columns} ctx={scope.ctx} domain="attendance" filtersLabel={filtersLabel(scope)} maxHeight={520} />
      </Register>
      <Register title="Movers and locations" domain="revenue">
        <Two a={<ChartModule title="Biggest movers by rupee impact" subtitle="Products and trainers, current vs comparison" table={{ columns: ['Entity', 'Δ Revenue'], rows: movers.map((m) => [m.label, Math.round(m.value)]) }}><HBars items={movers.map((m) => ({ label: m.label, value: m.value, sub: m.sub }))} fmt="currency" diverge /></ChartModule>}
          b={<div className="overview-locations"><div className="t-heading-m" style={{ marginBottom: 6 }}>Location small multiples — gross revenue, 14 months</div><div className="overview-location-grid">{smallMultiples.map((s) => <div key={s.l} className="surface chrome overview-location-card" style={{ padding: 10 }}><div className="t-heading-s muted">{s.l}</div><div className="t-display-s tabular">{fmtCurrency(s.cur)}</div><Sparkline data={s.series} width={240} height={36} color="var(--hue-revenue)" /></div>)}</div></div>} />
      </Register>
      <Register title="When the studio fills" subtitle="Fill rate by day and hour" domain="attendance" lazy actions={<div style={{ display: 'flex', gap: 2 }}><button className="btn btn-xs" aria-pressed={loc === null} onClick={() => setLoc(null)}>All</button>{locs.map((l) => <button key={l} className="btn btn-xs" aria-pressed={loc === l} onClick={() => setLoc(l)}>{l.split(',')[0]}</button>)}</div>}>
        <DayTimeHeatmap rows={heatRows} metricId="fill_rate" scope={scope} />
      </Register>
      <Register title="Month on month" subtitle="Twelve headline metrics" domain="attendance" lazy>
        <MultiTableMoM scope={scope} months={months} />
      </Register>
      <Register title="Location P&L, format performance and alerts" domain="revenue" collapsed lazy>
        <Two a={<PnL scope={scope} />} b={<div style={{ display: 'grid', gap: 8 }}><div className="t-heading-m">Alert register</div>{insights.slice(0, 8).map((i) => <InsightCard key={i.key} insight={i} compact />)}{!insights.length && <div className="muted t-body-s">No alerts in scope.</div>}</div>} />
      </Register>
      </div>
      <WidgetSection tab="overview" scope={scope} placement="bottom" />
    </>
  );
}

function MultiTableMoM({ scope, months }: { scope: Scope; months: string[] }) {
  const grouped = HEADLINE.map((id) => ({ id, table: TABLE_OF[id] }));
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {(['sales', 'sessions', 'newc', 'lapsed'] as const).map((t) => { const ids = grouped.filter((g) => g.table === t).map((g) => g.id); return <MoMTable key={t} rows={scope.all[t]} metricIds={ids} months={months} ctx={scope.ctx} domain={metric(ids[0]).domain} title={{ sales: 'Sales', sessions: 'Classes', newc: 'Acquisition', lapsed: 'Retention' }[t]} />; })}
    </div>
  );
}

function PnL({ scope }: { scope: Scope }) {
  const rows = useMemo(() => {
    const locs = [...new Set([...scope.tables.sales.map((r) => r.location), ...scope.tables.sessions.map((r) => r.location)].filter(Boolean))] as string[];
    return locs.map((l) => { const sales = metricValues(scope.tables.sales.filter((r) => r.location === l), ['gross_revenue', 'net_revenue', 'discount_value'], scope.ctx); const sess = metricValues(scope.tables.sessions.filter((r) => r.location === l), ['sessions', 'fill_rate'], scope.ctx); const cost = (sess.sessions.value ?? 0) * scope.ctx.ratePerSession; return { l, gross: sales.gross_revenue.value, net: sales.net_revenue.value, disc: sales.discount_value.value, sessions: sess.sessions.value, fill: sess.fill_rate.value, cost, contrib: (sales.net_revenue.value ?? 0) - cost }; }).sort((a, b) => (b.gross ?? 0) - (a.gross ?? 0));
  }, [scope]);
  return (
    <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Location P&L (trainer cost at the assumed rate)</div>
      <div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Location</th><th className="t-heading-s">Gross</th><th className="t-heading-s">Net</th><th className="t-heading-s">Discount</th><th className="t-heading-s">Sessions</th><th className="t-heading-s">Fill</th><th className="t-heading-s">Trainer cost</th><th className="t-heading-s">Contribution</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.l}><td className="t-body-s">{r.l}</td><td className="t-num">{fmtCurrency(r.gross)}</td><td className="t-num">{fmtCurrency(r.net)}</td><td className="t-num">{fmtCurrency(r.disc)}</td><td className="t-num">{r.sessions ?? '—'}</td><td className="t-num">{formatValue('percent', r.fill)}</td><td className="t-num">{fmtCurrency(r.cost)}</td><td className={`t-num ${r.contrib >= 0 ? 'pos' : 'neg'}`}>{fmtCurrency(r.contrib)}</td></tr>)}</tbody></table></div>
    </div>
  );
}

export type { RollupNode };
export { fmtMonthShort, XYChart };
