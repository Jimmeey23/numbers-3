import { useMemo } from 'react';
import type { Scope } from '../state/data';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { KpiStrip, Two, useMonths, filtersLabel, SectionEmpty, SheetMissing } from './common';
import { ChartModule, HBars, XYChart } from '../components/charts/core';
import { Heatmap } from '../components/charts/grids';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { RankingList } from '../components/RankingList/RankingList';
import { compositeScore, metricValues, rollupLevel } from '../semantics/aggregations';
import { useView } from '../state/view';
import { useData } from '../state/data';
import { useFilters } from '../state/filters';
import { fmtCurrency, fmtMonthShort, formatValue } from '../semantics/formats';
import { formatColor } from '../design/ramps';

const P_METRICS = ['p_margin', 'p_conversion_rate', 'p_contribution', 'p_rev_per_session', 'p_retention_rate', 'trainer_score', 'p_empty_rate', 'p_sessions'];

export function Payroll({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const { ratePerSession, setRate, theme } = useView();
  const addTransient = useFilters((s) => s.addTransient);
  const load = useData((s) => s.loads.find((l) => l.key === 'payroll'));
  const rows = scope.tables.payroll;
  const trainerNodes = useMemo(() => rollupLevel(rows, ['trainer'], 0, [...P_METRICS, 'p_revenue', 'p_cost', 'p_cycle_sessions', 'p_strength_sessions', 'p_barre_sessions'], scope.ctx), [rows, scope.ctx]);
  const composite = useMemo(() => compositeScore(trainerNodes, [{ id: 'p_margin', w: 0.3 }, { id: 'p_rev_per_session', w: 0.25 }, { id: 'p_conversion_rate', w: 0.25 }, { id: 'p_retention_rate', w: 0.2 }]), [trainerNodes]);
  const columns: ColumnDef[] = useMemo(() => [
    { id: 'p_sessions', metricId: 'p_sessions', family: 'Volume', bar: true }, { id: 'p_cycle_sessions', metricId: 'p_cycle_sessions', family: 'Volume' }, { id: 'p_strength_sessions', metricId: 'p_strength_sessions', family: 'Volume' }, { id: 'p_barre_sessions', metricId: 'p_barre_sessions', family: 'Volume' },
    { id: 'p_empty', metricId: 'p_empty', family: 'Utilisation' }, { id: 'p_empty_rate', metricId: 'p_empty_rate', family: 'Utilisation', heat: true }, { id: 'p_customers', metricId: 'p_customers', family: 'Volume' }, { id: 'p_avg_per_session', metricId: 'p_avg_per_session', family: 'Utilisation' },
    { id: 'p_revenue', metricId: 'p_revenue', family: 'Revenue', bar: true }, { id: 'p_cycle_paid', metricId: 'p_cycle_paid', family: 'Revenue', hidden: true }, { id: 'p_strength_paid', metricId: 'p_strength_paid', family: 'Revenue', hidden: true }, { id: 'p_barre_paid', metricId: 'p_barre_paid', family: 'Revenue', hidden: true },
    { id: 'p_rev_per_session', metricId: 'p_rev_per_session', family: 'Revenue' }, { id: 'p_rev_per_customer', metricId: 'p_rev_per_customer', family: 'Revenue' }, { id: 'p_cost', metricId: 'p_cost', family: 'Revenue' }, { id: 'p_contribution', metricId: 'p_contribution', family: 'Revenue', heat: true }, { id: 'p_margin', metricId: 'p_margin', family: 'Revenue', heat: true },
    { id: 'p_converted', metricId: 'p_converted', family: 'Behaviour' }, { id: 'p_conversion_rate', metricId: 'p_conversion_rate', family: 'Behaviour', heat: true }, { id: 'p_retained', metricId: 'p_retained', family: 'Behaviour' }, { id: 'p_retention_rate', metricId: 'p_retention_rate', family: 'Behaviour' }, { id: 'p_new', metricId: 'p_new', family: 'Behaviour' }, { id: 'p_conversion_value', metricId: 'p_conversion_value', family: 'Revenue' },
    { id: 'composite', label: 'Composite score', family: 'Score', value: (n) => (n.level === 0 && n.keyId === 'trainer' ? composite.get(n.id) ?? null : null), format: 'decimal', render: (n) => <span className="t-num">{n.level === 0 && n.keyId === 'trainer' ? formatValue('decimal', composite.get(n.id) ?? null) : ''}</span> },
  ], [composite]);
  const diverging = useMemo(() => [...trainerNodes].sort((a, b) => (b.values.p_margin.value ?? 0) - (a.values.p_margin.value ?? 0)).flatMap((n) => [{ label: n.label, value: n.values.p_revenue.value, sub: 'revenue', color: 'var(--pos)' }, { label: n.label, value: -(n.values.p_cost.value ?? 0), sub: `cost · margin ${formatValue('percent', n.values.p_margin.value)}`, color: 'var(--neg)' }]), [trainerNodes]);
  const formatMix = useMemo(() => ({ cats: trainerNodes.map((n) => n.label), series: [{ id: 'c', label: 'Cycle', color: formatColor(theme, 'Cycle'), kind: 'bar' as const, values: trainerNodes.map((n) => n.values.p_cycle_sessions.value) }, { id: 's', label: 'Strength', color: formatColor(theme, 'Strength'), kind: 'bar' as const, values: trainerNodes.map((n) => n.values.p_strength_sessions.value) }, { id: 'b', label: 'Barre', color: formatColor(theme, 'Barre 57'), kind: 'bar' as const, values: trainerNodes.map((n) => n.values.p_barre_sessions.value) }] }), [trainerNodes, theme]);
  const heat = useMemo(() => { const ms = [...new Set(scope.all.payroll.map((r) => r.month).filter(Boolean))].sort() as string[]; const cells = []; for (const n of rollupLevel(scope.all.payroll, ['trainer'], 0, ['p_margin'], scope.ctx)) for (const m of ms) { const rs = n.rows.filter((r) => r.month === m); if (rs.length) cells.push({ x: m, y: n.key, value: metricValues(rs, ['p_margin'], scope.ctx).p_margin.value, n: rs.length }); } return { ms, cells }; }, [scope.all.payroll, scope.ctx]);
  const formatEcon = useMemo(() => [{ f: 'Cycle', s: 'p_cycle_sessions', p: 'p_cycle_paid', c: 'cycle_customers' }, { f: 'Strength', s: 'p_strength_sessions', p: 'p_strength_paid', c: 'strength_customers' }, { f: 'Barre', s: 'p_barre_sessions', p: 'p_barre_paid', c: 'barre_customers' }].map((x) => { const v = metricValues(rows, [x.s, x.p], scope.ctx); const s = v[x.s].value ?? 0; const p = v[x.p].value ?? 0; const cust = rows.reduce((a, r) => a + (r[x.c] ?? 0), 0); return { f: x.f, sessions: s, paid: p, cust, perSession: s ? p / s : null, cost: s * ratePerSession, margin: p ? (p - s * ratePerSession) / p : null }; }), [rows, scope.ctx, ratePerSession]);
  if (load?.status === 'error') return <div style={{ paddingTop: 20 }}><SheetMissing title="Payroll sheet" load={load} /></div>;
  if (!rows.length) return <div style={{ paddingTop: 20 }}><SectionEmpty what="payroll rows" scope={scope} /></div>;
  const rateCard = (
    <div className="surface chrome" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 14, minWidth: 320 }}>
      <div><div className="t-heading-s muted">Rate per session</div><div className="t-display-s tabular">{fmtCurrency(ratePerSession, false)}</div></div>
      <input type="range" min={300} max={4000} step={50} value={ratePerSession} onChange={(e) => setRate(+e.target.value)} style={{ flex: 1 }} aria-label="Rate per session" />
    </div>
  );
  return (
    <>
      <WidgetSection tab="payroll" scope={scope} placement="top" />
      <Register title="Payroll" subtitle={`Trainer economics at an assumed ${fmtCurrency(ratePerSession, false)} per session — move the slider and every margin recomputes`} domain="people" actions={rateCard}>
        <KpiStrip scope={scope} table="payroll" ids={['p_sessions', 'p_customers', 'p_revenue', 'p_rev_per_session', 'p_cost', 'payroll_pct_of_revenue', 'p_margin', 'p_empty_cost']} />
      </Register>
      <Register title="Revenue against cost per trainer" subtitle="Sorted by contribution margin" domain="people">
        <ChartModule title="Revenue vs trainer cost" table={{ columns: ['Trainer', 'Revenue', 'Cost', 'Margin'], rows: trainerNodes.map((n) => [n.label, Math.round(n.values.p_revenue.value ?? 0), Math.round(n.values.p_cost.value ?? 0), formatValue('percent', n.values.p_margin.value)]) }}>
          <HBars items={diverging} fmt="currency" diverge height={18} onClick={(i) => addTransient({ dim: 'trainer', value: diverging[i].label })} />
        </ChartModule>
      </Register>
      <Register title="Drill down" subtitle="Location → trainer → month" domain="people" id="drill-table">
        <NestedTable title="Payroll" rows={rows} compareRows={scope.compare.payroll} table="payroll" groupKeys={['location', 'trainer', 'month']} availableKeys={['location', 'trainer', 'month', 'quarter', 'year']} columns={columns} ctx={scope.ctx} domain="people" defaultSort={{ id: 'p_contribution', dir: 'desc' }} filtersLabel={filtersLabel(scope)} rankBy="p_margin" leafLabel="rows" />
      </Register>
      <Register title="Rankings and format mix" domain="people" lazy>
        <Two a={<RankingList title="Trainers by" nodes={trainerNodes} metricOptions={['p_margin', 'p_conversion_rate', 'p_contribution', 'p_rev_per_session', 'p_retention_rate']} ctx={scope.ctx} table="payroll" domain="people" minSample={1} sampleLabel="rows" />}
          b={<ChartModule title="Format mix per trainer" table={{ columns: ['Trainer', 'Cycle', 'Strength', 'Barre'], rows: trainerNodes.map((n) => [n.label, n.values.p_cycle_sessions.value, n.values.p_strength_sessions.value, n.values.p_barre_sessions.value]) }}><XYChart categories={formatMix.cats.map((c) => c.split(' ')[0])} series={formatMix.series} stacked height={260} onClick={(i) => addTransient({ dim: 'trainer', value: formatMix.cats[i] })} /></ChartModule>} />
      </Register>
      <Register title="Trainer × month by contribution margin" domain="people" lazy>
        <Heatmap xs={heat.ms} ys={[...new Set(heat.cells.map((c) => c.y))]} cells={heat.cells} fmt="percent" kind="diverging" center={0} xLabel={fmtMonthShort} />
      </Register>
      <Register title="Month on month" domain="people" lazy>
        <MoMTable rows={scope.all.payroll} metricIds={['p_sessions', 'p_customers', 'p_revenue', 'p_cost', 'p_margin', 'p_conversion_rate', 'p_retention_rate']} months={months} ctx={scope.ctx} domain="people" />
      </Register>
      <Register title="Format economics, empty-session cost, conversion value, cost per acquired member" domain="people" collapsed lazy>
        <div style={{ display: 'grid', gap: 24 }}>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Format economics</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Format</th><th className="t-heading-s">Sessions</th><th className="t-heading-s">Customers</th><th className="t-heading-s">Revenue</th><th className="t-heading-s">Rev / session</th><th className="t-heading-s">Cost</th><th className="t-heading-s">Margin</th></tr></thead><tbody>{formatEcon.map((f) => <tr key={f.f}><td className="t-body-s">{f.f}</td><td className="t-num">{f.sessions}</td><td className="t-num">{f.cust}</td><td className="t-num">{fmtCurrency(f.paid)}</td><td className="t-num">{fmtCurrency(f.perSession)}</td><td className="t-num">{fmtCurrency(f.cost)}</td><td className={`t-num ${(f.margin ?? 0) < 0 ? 'neg' : ''}`}>{formatValue('percent', f.margin)}</td></tr>)}</tbody></table></div></div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Empty-session cost register</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Trainer</th><th className="t-heading-s">Empty sessions</th><th className="t-heading-s">Empty rate</th><th className="t-heading-s">Cost of empties</th></tr></thead><tbody>{rollupLevel(rows, ['trainer'], 0, ['p_empty', 'p_empty_rate', 'p_empty_cost'], scope.ctx).filter((n) => (n.values.p_empty.value ?? 0) > 0).sort((a, b) => (b.values.p_empty_cost.value ?? 0) - (a.values.p_empty_cost.value ?? 0)).map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{n.values.p_empty.value}</td><td className="t-num">{formatValue('percent', n.values.p_empty_rate.value)}</td><td className="t-num neg">{fmtCurrency(n.values.p_empty_cost.value)}</td></tr>)}</tbody></table></div></div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Conversion and retention value; cost per acquired member</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Trainer</th><th className="t-heading-s">New handled</th><th className="t-heading-s">Converted</th><th className="t-heading-s">Conversion value</th><th className="t-heading-s">Retained</th><th className="t-heading-s">Cost per acquired</th></tr></thead><tbody>{rollupLevel(rows, ['trainer'], 0, ['p_new', 'p_converted', 'p_conversion_value', 'p_retained', 'p_cost_per_acquired'], scope.ctx).sort((a, b) => (b.values.p_conversion_value.value ?? 0) - (a.values.p_conversion_value.value ?? 0)).map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{n.values.p_new.value}</td><td className="t-num">{n.values.p_converted.value}</td><td className="t-num">{fmtCurrency(n.values.p_conversion_value.value)}</td><td className="t-num">{n.values.p_retained.value}</td><td className="t-num">{fmtCurrency(n.values.p_cost_per_acquired.value)}</td></tr>)}</tbody></table></div></div>
        </div>
      </Register>
      <WidgetSection tab="payroll" scope={scope} placement="bottom" />
    </>
  );
}
