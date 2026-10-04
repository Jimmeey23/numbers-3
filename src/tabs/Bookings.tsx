import { useMemo } from 'react';
import type { Scope } from '../state/data';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { KpiStrip, DayTimeHeatmap, Two, useMonths, filtersLabel, SectionEmpty } from './common';
import { ChartModule, XYChart } from '../components/charts/core';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { RankingList } from '../components/RankingList/RankingList';
import { metricValues, rollupLevel, seriesBy } from '../semantics/aggregations';
import { useFilters } from '../state/filters';
import { fmtCurrency, fmtDateShort, formatValue } from '../semantics/formats';
import { isoWeek } from '../data/normalise';

const B_METRICS = ['v_effective_attendance', 'v_no_show_rate', 'v_late_cancel_rate', 'v_booked', 'v_lead_time', 'v_rev_per_visit'];

export function Bookings({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const addTransient = useFilters((s) => s.addTransient);
  const rows = scope.tables.visits;   // canonical visit grain — the same rows every other tab counts
  const weekly = useMemo(() => seriesBy(rows, (r) => isoWeek(r.date), ['visits', 'v_late_cancels', 'v_no_shows', 'v_cancelled', 'v_effective_attendance'], scope.ctx), [rows, scope.ctx]);
  const columns: ColumnDef[] = [
    { id: 'v_booked', metricId: 'v_booked', family: 'Volume', bar: true }, { id: 'visits', metricId: 'visits', family: 'Volume' }, { id: 'v_cancelled', metricId: 'v_cancelled', family: 'Behaviour' }, { id: 'v_late_cancels', metricId: 'v_late_cancels', family: 'Behaviour' }, { id: 'v_no_shows', metricId: 'v_no_shows', family: 'Behaviour' },
    { id: 'v_cancel_rate', metricId: 'v_cancel_rate', family: 'Behaviour', hidden: true }, { id: 'v_late_cancel_rate', metricId: 'v_late_cancel_rate', family: 'Behaviour', heat: true }, { id: 'v_no_show_rate', metricId: 'v_no_show_rate', family: 'Behaviour', heat: true }, { id: 'v_effective_attendance', metricId: 'v_effective_attendance', family: 'Utilisation', heat: true },
    { id: 'v_lead_time', metricId: 'v_lead_time', family: 'Behaviour' }, { id: 'v_same_day_share', metricId: 'v_same_day_share', family: 'Behaviour' }, { id: 'v_show_up_rate', metricId: 'v_show_up_rate', family: 'Revenue' },
    { id: 'v_revenue', metricId: 'v_revenue', family: 'Revenue', bar: true }, { id: 'v_rev_per_visit', metricId: 'v_rev_per_visit', family: 'Revenue' }, { id: 'v_complimentary_rate', metricId: 'v_complimentary_rate', family: 'Revenue', hidden: true }, { id: 'v_source_agreement', metricId: 'v_source_agreement', family: 'Revenue', hidden: true },
  ];
  const classNodes = useMemo(() => rollupLevel(rows, ['class_name'], 0, B_METRICS, scope.ctx), [rows, scope.ctx]);
  const memberNodes = useMemo(() => rollupLevel(rows, ['member'], 0, B_METRICS, scope.ctx), [rows, scope.ctx]);
  const leadCurve = useMemo(() => { const buckets = [[0, 0.25, '<6h'], [0.25, 1, '6–24h'], [1, 2, '1–2d'], [2, 4, '2–4d'], [4, 7, '4–7d'], [7, 1e9, '7d+']] as const; return buckets.map(([a, b, l]) => { const rs = rows.filter((r) => r.lead_time_days !== null && !r.is_import && r.lead_time_days >= a && r.lead_time_days < b); const v = metricValues(rs, ['v_no_show_rate', 'v_late_cancel_rate'], scope.ctx); return { l, n: rs.length, ns: v.v_no_show_rate.value, lc: v.v_late_cancel_rate.value }; }); }, [rows, scope.ctx]);
  const visitCurve = useMemo(() => { const m = new Map<number, number>(); for (const r of rows) if (r.class_no !== null && r.attended) m.set(r.class_no, (m.get(r.class_no) ?? 0) + 1); return Array.from({ length: 12 }, (_, i) => i + 1).map((n) => ({ n, count: m.get(n) ?? 0, ret: m.get(n) ? (m.get(n + 1) ?? 0) / m.get(n)! : null })); }, [rows]);
  const offenders = useMemo(() => memberNodes.filter((n) => n.rows.length >= 3).map((n) => ({ n, bad: n.rows.filter((r) => r.no_show || r.late_cancelled).length })).filter((x) => x.bad >= 2).sort((a, b) => b.bad - a.bad).slice(0, 25), [memberNodes]);
  const channel = useMemo(() => rollupLevel(rows, ['method'], 0, ['v_booked', 'v_effective_attendance', 'v_no_show_rate', 'v_rev_per_visit'], scope.ctx).sort((a, b) => b.rows.length - a.rows.length), [rows, scope.ctx]);
  const products = useMemo(() => rollupLevel(rows, ['membership_type'], 0, ['v_booked', 'v_effective_attendance', 'v_no_show_rate', 'v_unique_bookers'], scope.ctx).sort((a, b) => b.rows.length - a.rows.length), [rows, scope.ctx]);
  const loyalty = useMemo(() => { const m = new Map<string, Map<string, number>>(); for (const r of rows) { if (!r.member_id || !r.teacher || !r.attended) continue; let t = m.get(r.member_id); if (!t) { t = new Map(); m.set(r.member_id, t); } t.set(r.teacher, (t.get(r.teacher) ?? 0) + 1); } const byT = new Map<string, { loyal: number; total: number }>(); for (const t of m.values()) { const tot = [...t.values()].reduce((a, b) => a + b, 0); if (tot < 3) continue; for (const [k, v] of t) { const e = byT.get(k) ?? { loyal: 0, total: 0 }; e.total++; if (v / tot >= 0.6) e.loyal++; byT.set(k, e); } } return [...byT.entries()].map(([k, v]) => ({ k, ...v, idx: v.total ? v.loyal / v.total : 0 })).filter((x) => x.total >= 5).sort((a, b) => b.idx - a.idx); }, [rows]);
  if (!rows.length) return <div style={{ paddingTop: 20 }}><SectionEmpty what="bookings" scope={scope} /></div>;

  return (
    <>
      <WidgetSection tab="bookings" scope={scope} placement="top" />
      <Register title="Bookings" subtitle={rows[0]?.in_bookings === false ? 'Rebuilt from Checkins (Bookings sheet is private): pre-class cancellations are not visible, so cancellation rate reads 0 — see Data health' : 'From the Bookings sheet'} domain="attendance">
        <KpiStrip scope={scope} table="visits" ids={['v_booked', 'v_unique_bookers', 'v_cancel_rate', 'v_late_cancel_rate', 'v_no_show_rate', 'v_effective_attendance', 'v_lead_time', 'v_rev_per_visit']} />
      </Register>
      <Register title="Weekly outcomes" subtitle="Attended, late-cancelled, no-show and cancelled, with effective attendance overlaid" domain="attendance">
        <ChartModule title="Booking outcomes by week" table={{ columns: ['Week', 'Attended', 'Late', 'No-show', 'Cancelled', 'Effective'], rows: weekly.map((w) => [w.key, w.values.visits.value, w.values.v_late_cancels.value, w.values.v_no_shows.value, w.values.v_cancelled.value, formatValue('percent', w.values.v_effective_attendance.value)]) }}>
          <XYChart categories={weekly.map((w) => fmtDateShort(w.key))} stacked series={[{ id: 'a', label: 'Attended', color: 'var(--hue-attendance)', kind: 'bar', values: weekly.map((w) => w.values.visits.value) }, { id: 'l', label: 'Late cancelled', color: 'var(--warn)', kind: 'bar', values: weekly.map((w) => w.values.v_late_cancels.value) }, { id: 'n', label: 'No-show', color: 'var(--neg)', kind: 'bar', values: weekly.map((w) => w.values.v_no_shows.value) }, { id: 'c', label: 'Cancelled', color: 'var(--text-3)', kind: 'bar', values: weekly.map((w) => w.values.v_cancelled.value) }, { id: 'e', label: 'Effective attendance', color: 'var(--text-1)', axis: 'right', fmt: 'percent', values: weekly.map((w) => w.values.v_effective_attendance.value) }]} onClick={(i) => addTransient({ dim: 'week', value: weekly[i].key, label: `Week of ${fmtDateShort(weekly[i].key)}` })} />
        </ChartModule>
      </Register>
      <Register title="Drill down" subtitle="Class → teacher → day + time → member" domain="attendance" id="drill-table">
        <NestedTable title="Bookings" rows={rows} compareRows={scope.compare.visits} table="visits" groupKeys={['class_name', 'teacher', 'slot', 'member']} availableKeys={['class_name', 'trainer', 'slot', 'member_name', 'location', 'day', 'time', 'timeslot', 'daypart', 'weekpart', 'membership_type', 'is_new_label', 'visit_band', 'outcome', 'lead_time_band', 'source_coverage', 'month', 'quarter', 'session', 'slot_uid', 'format', 'category']} columns={columns} ctx={scope.ctx} domain="attendance" defaultSort={{ id: 'v_booked', dir: 'desc' }} filtersLabel={filtersLabel(scope)} rankBy="v_effective_attendance" leafLabel="bookings" />
      </Register>
      <Register title="Reliability and lead time" domain="attendance" lazy>
        <Two a={<RankingList title="Classes by" nodes={classNodes} metricOptions={['v_effective_attendance', 'v_no_show_rate', 'v_late_cancel_rate', 'v_rev_per_visit']} ctx={scope.ctx} table="visits" domain="attendance" minSample={10} sampleLabel="bookings" />}
          b={<ChartModule title="Lead time × no-show and late-cancel rate" table={{ columns: ['Lead time', 'Bookings', 'No-show', 'Late cancel'], rows: leadCurve.map((b) => [b.l, b.n, formatValue('percent', b.ns), formatValue('percent', b.lc)]) }}>
            <XYChart categories={leadCurve.map((b) => b.l)} series={[{ id: 'ns', label: 'No-show rate', color: 'var(--neg)', values: leadCurve.map((b) => b.ns), fmt: 'percent' }, { id: 'lc', label: 'Late-cancel rate', color: 'var(--warn)', values: leadCurve.map((b) => b.lc), fmt: 'percent' }, { id: 'n', label: 'Bookings', color: 'var(--hue-attendance)', kind: 'bar', axis: 'right', fmt: 'integer', values: leadCurve.map((b) => b.n) }]} fmtLeft="percent" fmtRight="integer" height={240} />
          </ChartModule>} />
      </Register>
      <Register title="Day × time by no-show rate" subtitle="Usually a different shape to the fill heatmap — that difference is the insight" domain="attendance" lazy>
        <DayTimeHeatmap rows={rows} metricId="v_no_show_rate" scope={scope} minN={5} kind="diverging" />
      </Register>
      <Register title="Month on month" domain="attendance" lazy>
        <MoMTable rows={scope.all.visits} metricIds={['v_booked', 'visits', 'v_cancel_rate', 'v_late_cancel_rate', 'v_no_show_rate', 'v_lead_time', 'v_rev_per_visit']} months={months} ctx={scope.ctx} domain="attendance" />
      </Register>
      <Register title="Visit-number retention, repeat offenders, channel mix, product usage, trainer loyalty" domain="attendance" collapsed lazy>
        <div style={{ display: 'grid', gap: 24 }}>
          <Two a={<ChartModule title="Visit-number retention curve" subtitle="Share of members at visit n who reach visit n+1" table={{ columns: ['Visit', 'Bookings', 'Reach next'], rows: visitCurve.map((v) => [v.n, v.count, formatValue('percent', v.ret)]) }}><XYChart categories={visitCurve.map((v) => `#${v.n}`)} series={[{ id: 'c', label: 'Attended', color: 'var(--hue-attendance)', kind: 'bar', values: visitCurve.map((v) => v.count) }, { id: 'r', label: 'Reach next visit', color: 'var(--hue-revenue)', axis: 'right', fmt: 'percent', values: visitCurve.map((v) => v.ret) }]} fmtLeft="integer" fmtRight="percent" height={220} /></ChartModule>}
            b={<div><div className="t-heading-m" style={{ marginBottom: 6 }}>Repeat offenders — 2+ no-shows or late cancels</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Member</th><th className="t-heading-s">Bookings</th><th className="t-heading-s">Missed</th><th className="t-heading-s">Effective</th></tr></thead><tbody>{offenders.map((o) => <tr key={o.n.id}><td className="t-body-s">{o.n.label}</td><td className="t-num">{o.n.rows.length}</td><td className="t-num neg">{o.bad}</td><td className="t-num">{formatValue('percent', o.n.values.v_effective_attendance.value)}</td></tr>)}</tbody></table></div></div>} />
          <Two a={<div><div className="t-heading-m" style={{ marginBottom: 6 }}>Booking channel / payment method mix</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Method</th><th className="t-heading-s">Bookings</th><th className="t-heading-s">Effective</th><th className="t-heading-s">No-show</th><th className="t-heading-s">Rev / booking</th></tr></thead><tbody>{channel.map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{n.rows.length}</td><td className="t-num">{formatValue('percent', n.values.v_effective_attendance.value)}</td><td className="t-num">{formatValue('percent', n.values.v_no_show_rate.value)}</td><td className="t-num">{fmtCurrency(n.values.v_rev_per_visit.value)}</td></tr>)}</tbody></table></div></div>}
            b={<div><div className="t-heading-m" style={{ marginBottom: 6 }}>Membership product usage</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Product type</th><th className="t-heading-s">Bookings</th><th className="t-heading-s">Bookers</th><th className="t-heading-s">Effective</th><th className="t-heading-s">No-show</th></tr></thead><tbody>{products.map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{n.rows.length}</td><td className="t-num">{n.values.v_unique_bookers.value}</td><td className="t-num">{formatValue('percent', n.values.v_effective_attendance.value)}</td><td className="t-num">{formatValue('percent', n.values.v_no_show_rate.value)}</td></tr>)}</tbody></table></div></div>} />
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Trainer loyalty index — share of a trainer's regulars (3+ visits) who take 60%+ of their classes with them</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Trainer</th><th className="t-heading-s">Regulars</th><th className="t-heading-s">Loyal</th><th className="t-heading-s">Loyalty index</th></tr></thead><tbody>{loyalty.map((l) => <tr key={l.k}><td className="t-body-s">{l.k}</td><td className="t-num">{l.total}</td><td className="t-num">{l.loyal}</td><td className="t-num">{formatValue('percent', l.idx)}</td></tr>)}</tbody></table></div></div>
        </div>
      </Register>
      <WidgetSection tab="bookings" scope={scope} placement="bottom" />
    </>
  );
}
