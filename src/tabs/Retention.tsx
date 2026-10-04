import { useMemo, useState } from 'react';
import type { Scope } from '../state/data';
import { Register, DataPanel } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { KpiStrip, Two, useMonths, filtersLabel, SectionEmpty, CohortTriangle } from './common';
import { ChartModule, HBars, XYChart } from '../components/charts/core';
import { Scatter } from '../components/charts/special';
import { LifecycleFlow, CompositionBars } from '../components/charts/funnel';
import { Heatmap } from '../components/charts/grids';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { RankingList } from '../components/RankingList/RankingList';
import { metricValues, rollupLevel, type Row } from '../semantics/aggregations';
import type { QueryContext } from '../semantics/metrics';
import { categorical } from '../design/ramps';
import { useView } from '../state/view';
import { useDrill } from '../state/drill';
import { fmtCurrency, fmtDate, fmtMonthShort, fmtPercent, formatValue } from '../semantics/formats';
import { maxBy } from '../semantics/stats';

const R_METRICS = ['risk_score', 'utilisation', 'avg_sessions_used_pct', 'avg_days_since_visit', 'avg_days_active', 'churn_rate', 'churn_rate_ending', 'early_exit_rate', 'discount_driven_lapse', 'l_revenue', 'memberships'];
/* Bands are relative to the operator's high-risk threshold rather than fixed, so moving it in
   Settings moves the ladder, the KPI cards and the insights together. */
const riskBandsFor = (high: number) => [
  { id: 'critical', label: `Critical (${high + 20}+)`, lo: high + 20, hi: 101, tone: 'neg' as const },
  { id: 'high', label: `High (${high}–${high + 19})`, lo: high, hi: high + 20, tone: 'warn' as const },
  { id: 'watch', label: `Watch (${high - 20}–${high - 1})`, lo: high - 20, hi: high, tone: 'info' as const },
  { id: 'healthy', label: `Healthy (under ${high - 20})`, lo: -1, hi: high - 20, tone: 'pos' as const },
];

/** Paid membership value, always the registry's definition so a worklist total and the KPI card
 *  above it can never be two different numbers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const paidValue = (rows: any[], ctx: QueryContext): number => metricValues(rows, ['l_revenue'], ctx).l_revenue.value ?? 0;

export function Retention({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const theme = useView((s) => s.theme);
  const drill = useDrill((s) => s.open);
  const rows = scope.tables.lapsed;
  const [cohortMode, setCohortMode] = useState<'retained' | 'revenue'>('retained');
  const RISK_BANDS = useMemo(() => riskBandsFor(scope.ctx.riskHigh), [scope.ctx.riskHigh]);

  /* ── Member-level roll-up: the Lapsed sheet is one row per membership, but retention is a
        property of the member. This single pass gives renewal depth, tenure, gaps and status. ── */
  const members = useMemo(() => {
    const m = new Map<string, {
      id: string; name: string; location: string | null; memberships: number; renewed: number; spend: number;
      firstStart: number | null; lastEnd: number | null; churned: boolean; active: boolean; risk: number;
      completed: number; limit: number; daysSince: number | null; contactable: boolean; types: Set<string>;
      lastMembership: string | null; frozen: number; discount: number; original: number;
    }>();
    for (const r of rows) {
      if (!r.member_id) continue;
      let e = m.get(r.member_id);
      if (!e) {
        e = { id: r.member_id, name: r.member_name ?? r.member_id, location: r.location, memberships: 0, renewed: 0, spend: 0,
          firstStart: null, lastEnd: null, churned: false, active: false, risk: 0, completed: 0, limit: 0, daysSince: null,
          contactable: r.contactable, types: new Set(), lastMembership: null, frozen: 0, discount: 0, original: 0 };
        m.set(r.member_id, e);
      }
      e.memberships++;
      if (r.renewed) e.renewed++;
      e.spend += r.amount_paid ?? 0;
      e.discount += r.discount_value ?? 0;
      e.original += r.original_amount ?? r.amount_paid ?? 0;
      e.frozen += r.freeze_count ?? 0;
      if (r.ts !== null && (e.firstStart === null || r.ts < e.firstStart)) e.firstStart = r.ts;
      if (r.end_ts !== null && (e.lastEnd === null || r.end_ts > e.lastEnd)) { e.lastEnd = r.end_ts; e.lastMembership = r.membership_name; }
      if (r.active) e.active = true;
      if (r.churned) e.churned = true;
      if ((r.risk_score ?? 0) > e.risk) e.risk = r.risk_score ?? 0;
      e.completed += r.completed ?? 0;
      if (r.sessions_limit) e.limit += r.sessions_limit;
      if (r.days_since_last_visit !== null && (e.daysSince === null || r.days_since_last_visit < e.daysSince)) e.daysSince = r.days_since_last_visit;
      if (r.membership_type) e.types.add(r.membership_type);
    }
    return [...m.values()];
  }, [rows]);

  /* ── Lifecycle states: where the membership base actually sits right now ── */
  const lifecycle = useMemo(() => {
    const bucket = (name: string, pred: (r: Row) => boolean, tone: 'pos' | 'warn' | 'neg' | 'info') => {
      const rs = rows.filter(pred);
      return { label: name, count: rs.length, value: paidValue(rs, scope.ctx), tone };
    };
    return [
      bucket('New', (r) => r.status === 'New', 'info'),
      bucket('Active', (r) => r.status === 'Active', 'pos'),
      bucket('Renewed', (r) => r.status === 'Renewed', 'pos'),
      bucket('Frozen', (r) => r.status === 'Frozen', 'warn'),
      bucket('Never activated', (r) => r.status === 'Not Activated', 'warn'),
      bucket('Lapsed', (r) => r.status === 'Lapsed', 'neg'),
    ].filter((b) => b.count > 0);
  }, [rows]);

  /* ── Risk bands over active memberships, each with the money attached ── */
  const riskBands = useMemo(() => {
    const act = rows.filter((r) => r.active);
    return RISK_BANDS.map((b) => {
      const rs = act.filter((r) => (r.risk_score ?? 0) >= b.lo && (r.risk_score ?? 0) < b.hi);
      return { ...b, rows: rs, count: rs.length, value: paidValue(rs, scope.ctx),
        util: metricValues(rs, ['utilisation'], scope.ctx).utilisation.value,
        absent: metricValues(rs, ['avg_days_since_visit'], scope.ctx).avg_days_since_visit.value };
    });
  }, [rows, scope.ctx, RISK_BANDS]);

  /* ── Survival by membership type ── */
  const survival = useMemo(() => {
    const types = rollupLevel(rows.filter((r) => r.duration_days !== null && (r.amount_paid ?? 0) > 0), ['membership_type'], 0, ['memberships'], scope.ctx)
      .filter((n) => n.rows.length >= 25).slice(0, 5);
    const xs = Array.from({ length: 13 }, (_, i) => i * 30);
    return { xs, series: types.map((n, i) => ({
      id: n.key, label: n.label, color: categorical(theme, i), fmt: 'percent' as const,
      values: xs.map((d) => {
        const eligible = n.rows.filter((r) => (r.days_elapsed ?? 0) >= d || r.churned);
        if (!eligible.length) return null;
        const alive = eligible.filter((r) => !r.churned || (r.duration_days ?? 0) >= d).length;
        return alive / eligible.length;
      }),
    })) };
  }, [rows, scope.ctx, theme]);

  /* ── When do people churn? Tenure-at-churn distribution ── */
  const churnTiming = useMemo(() => {
    const bands = [[0, 15, 'Under 2 weeks'], [15, 31, '2–4 weeks'], [31, 61, '1–2 months'], [61, 92, '2–3 months'], [92, 183, '3–6 months'], [183, 366, '6–12 months'], [366, 1e9, 'Over a year']] as const;
    const churned = rows.filter((r) => r.churned && r.duration_days !== null);
    return bands.map(([lo, hi, label]) => {
      const rs = churned.filter((r) => (r.duration_days ?? 0) >= lo && (r.duration_days ?? 0) < hi);
      return { label, n: rs.length, value: paidValue(rs, scope.ctx),
        util: metricValues(rs, ['utilisation'], scope.ctx).utilisation.value };
    });
  }, [rows, scope.ctx]);

  /* ── Renewal depth: how far members get through the ladder ── */
  const renewalDepth = useMemo(() => {
    const bands = [1, 2, 3, 4, 5];
    return bands.map((b) => {
      const ms = members.filter((m) => (b === 5 ? m.memberships >= 5 : m.memberships === b));
      return { label: b === 5 ? '5 or more' : `${b} membership${b > 1 ? 's' : ''}`, n: ms.length,
        spend: ms.length ? ms.reduce((a, m) => a + m.spend, 0) / ms.length : 0,
        churn: ms.length ? ms.filter((m) => m.churned && !m.active).length / ms.length : 0 };
    });
  }, [members]);

  /* ── What separates members who stay from members who go ── */
  const drivers = useMemo(() => {
    const stayed = members.filter((m) => m.active || m.renewed > 0);
    const gone = members.filter((m) => m.churned && !m.active);
    const avg = (a: typeof members, f: (m: typeof members[number]) => number | null) => {
      const v = a.map(f).filter((x): x is number => x !== null && Number.isFinite(x));
      return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
    };
    const rows2 = [
      { k: 'Sessions completed', s: avg(stayed, (m) => m.completed), g: avg(gone, (m) => m.completed), fmt: 'decimal' as const, higher: true },
      { k: 'Utilisation of entitlement', s: avg(stayed, (m) => (m.limit ? m.completed / m.limit : null)), g: avg(gone, (m) => (m.limit ? m.completed / m.limit : null)), fmt: 'percent' as const, higher: true },
      { k: 'Days since last visit', s: avg(stayed, (m) => m.daysSince), g: avg(gone, (m) => m.daysSince), fmt: 'days' as const, higher: false },
      { k: 'Lifetime spend', s: avg(stayed, (m) => m.spend), g: avg(gone, (m) => m.spend), fmt: 'currency' as const, higher: true },
      { k: 'Memberships bought', s: avg(stayed, (m) => m.memberships), g: avg(gone, (m) => m.memberships), fmt: 'decimal' as const, higher: true },
      { k: 'Membership product types bought', s: avg(stayed, (m) => m.types.size), g: avg(gone, (m) => m.types.size), fmt: 'decimal' as const, higher: true },
      { k: 'Discount taken', s: avg(stayed, (m) => (m.original ? m.discount / m.original : null)), g: avg(gone, (m) => (m.original ? m.discount / m.original : null)), fmt: 'percent' as const, higher: false },
      { k: 'Freezes used', s: avg(stayed, (m) => m.frozen), g: avg(gone, (m) => m.frozen), fmt: 'decimal' as const, higher: false },
    ];
    return rows2.map((r) => ({ ...r, gap: r.s !== null && r.g !== null && r.g !== 0 ? (r.s - r.g) / Math.abs(r.g) : null }));
  }, [members]);

  const columns: ColumnDef[] = [
    { id: 'memberships', metricId: 'memberships', family: 'Volume', bar: true },
    { id: 'distinct_members', metricId: 'distinct_members', family: 'Volume' },
    { id: 'active_memberships', metricId: 'active_memberships', family: 'Volume' },
    { id: 'churned_memberships', metricId: 'churned_memberships', family: 'Volume' },
    { id: 'churn_rate', metricId: 'churn_rate', family: 'Utilisation', heat: true },
    { id: 'renewal_rate', metricId: 'renewal_rate', family: 'Utilisation', heat: true },
    { id: 'gross_revenue_retention', metricId: 'gross_revenue_retention', family: 'Revenue', heat: true },
    { id: 'memberships_per_member', metricId: 'memberships_per_member', family: 'Behaviour' },
    { id: 'repeat_member_rate', metricId: 'repeat_member_rate', family: 'Behaviour', heat: true },
    { id: 'member_ltv', metricId: 'member_ltv', family: 'Revenue', bar: true },
    { id: 'member_tenure', metricId: 'member_tenure', family: 'Behaviour' },
    { id: 'churn_speed', metricId: 'churn_speed', family: 'Behaviour' },
    { id: 'utilisation', metricId: 'utilisation', family: 'Utilisation', heat: true },
    { id: 'utilisation_at_churn', metricId: 'utilisation_at_churn', family: 'Utilisation' },
    { id: 'completed_sessions', metricId: 'completed_sessions', family: 'Volume', hidden: true },
    { id: 'remaining_sessions', metricId: 'remaining_sessions', family: 'Volume' },
    { id: 'liability', metricId: 'liability', family: 'Revenue' },
    { id: 'l_attendance_rate', metricId: 'l_attendance_rate', family: 'Behaviour' },
    { id: 'l_cancel_rate', metricId: 'l_cancel_rate', family: 'Behaviour', heat: true },
    { id: 'avg_days_since_visit', metricId: 'avg_days_since_visit', family: 'Behaviour' },
    { id: 'avg_sessions_month', metricId: 'avg_sessions_month', family: 'Behaviour' },
    { id: 'l_revenue', metricId: 'l_revenue', family: 'Revenue', bar: true },
    { id: 'l_rev_per_session', metricId: 'l_rev_per_session', family: 'Revenue' },
    { id: 'l_discount_rate', metricId: 'l_discount_rate', family: 'Revenue', hidden: true },
    { id: 'freeze_rate', metricId: 'freeze_rate', family: 'Behaviour', hidden: true },
    { id: 'never_activated', metricId: 'never_activated', family: 'Utilisation', hidden: true },
    { id: 'risk_score', metricId: 'risk_score', family: 'Score', heat: true },
  ];

  const memberNodes = useMemo(() => rollupLevel(rows.filter((r) => r.active), ['member'], 0, R_METRICS, scope.ctx), [rows, scope.ctx]);
  const scatter = useMemo(() => rows.filter((r) => r.active && r.sessions_limit && r.days_since_last_visit !== null)
    .map((r) => ({ id: `${r.member_id}-${r.membership_name}`, label: `${r.member_name} · ${r.membership_name}`,
      x: Math.min(1, (r.completed ?? 0) / r.sessions_limit!), y: r.days_since_last_visit!, size: r.amount_paid ?? 1, n: 1 })).slice(0, 700), [rows]);
  const byType = useMemo(() => rollupLevel(rows, ['membership_name'], 0, ['memberships', 'churn_rate', 'renewal_rate', 'avg_tenure_at_churn', 'utilisation', 'l_revenue', 'member_ltv'], scope.ctx)
    .filter((n) => n.rows.length >= 20).sort((a, b) => (b.values.churn_rate.value ?? 0) - (a.values.churn_rate.value ?? 0)), [rows, scope.ctx]);
  const expiry = useMemo(() => rows.filter((r) => r.active && r.end_ts !== null && r.end_ts >= scope.ctx.todayTs && r.end_ts <= scope.ctx.todayTs + 60 * 864e5)
    .sort((a, b) => a.end_ts! - b.end_ts!), [rows, scope.ctx.todayTs]);
  const zero = useMemo(() => rows.filter((r) => r.active && (r.completed ?? 0) === 0 && (r.days_elapsed ?? 0) > scope.ctx.zeroUsageDays && (r.amount_paid ?? 0) > 0)
    .sort((a, b) => (b.amount_paid ?? 0) - (a.amount_paid ?? 0)), [rows]);
  const winback = useMemo(() => members.filter((m) => m.churned && !m.active && m.spend > 0 && m.contactable)
    .sort((a, b) => b.spend - a.spend).slice(0, 40), [members]);
  const worklist = useMemo(() => rows.filter((r) => r.active && (r.risk_score ?? 0) >= scope.ctx.riskHigh)
    .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0) || (b.amount_paid ?? 0) - (a.amount_paid ?? 0)).slice(0, 60), [rows, scope.ctx.riskHigh]);
  const locationChurn = useMemo(() => {
    const locs = [...new Set(rows.map((r) => r.location).filter(Boolean))] as string[];
    return locs.map((l) => { const rs = rows.filter((r) => r.location === l);
      return { label: l, parts: RISK_BANDS.map((b) => rs.filter((r) => r.active && (r.risk_score ?? 0) >= b.lo && (r.risk_score ?? 0) < b.hi).length), total: rs.filter((r) => r.active).length };
    }).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
  }, [rows, RISK_BANDS]);

  /* Renewal calendar is anchored to membership end date, not purchase date. It intentionally
     reads dimension-filtered `all` rows so a membership bought last year still appears in the
     month it becomes due. Three forward months turn the same view into an outreach plan. */
  const renewalMonths = useMemo(() => {
    const out = [...months]; const [y, m] = months[months.length - 1].split('-').map(Number);
    for (let i = 1; i <= 3; i++) { const d = new Date(Date.UTC(y, m - 1 + i, 1)); out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
    return out;
  }, [months]);
  const renewalCalendar = useMemo(() => renewalMonths.map((month) => {
    const due = scope.all.lapsed.filter((r) => r.end_date?.slice(0, 7) === month);
    const renewed = due.filter((r) => r.renewed || r.status === 'Renewed').length;
    const lapsed = due.filter((r) => !r.renewed && (r.churned || r.status === 'Lapsed')).length;
    const frozen = due.filter((r) => !r.renewed && r.status === 'Frozen').length;
    const notActivated = due.filter((r) => !r.renewed && r.status === 'Not Activated').length;
    const pending = due.filter((r) => !r.renewed && !r.churned && r.status !== 'Lapsed' && r.status !== 'Frozen' && r.status !== 'Not Activated').length;
    const decided = renewed + lapsed;
    return { month, due: due.length, renewed, lapsed, frozen, notActivated, pending, rate: decided ? renewed / decided : null,
      value: paidValue(due, scope.ctx) };
  }), [renewalMonths, scope.all.lapsed]);

  if (!rows.length && !scope.all.lapsed.length) return <div style={{ paddingTop: 20 }}><SectionEmpty what="memberships" scope={scope} /></div>;
  const activeCount = rows.filter((r) => r.active).length;

  return (
    <>
      <WidgetSection tab="retention" scope={scope} placement="top" />
      <Register title="Retention" index="① State" domain="risk"
        subtitle={`${members.length.toLocaleString('en-IN')} members holding ${rows.length.toLocaleString('en-IN')} memberships live in ${scope.period.label}. Risk blends utilisation, recency, cancellations and attendance.`}>
        <KpiStrip scope={scope} table="lapsed" ids={['active_memberships', 'distinct_members', 'churn_rate', 'gross_revenue_retention', 'repeat_member_rate', 'member_ltv', 'high_risk_members', 'revenue_at_risk_30d']} />
        <div style={{ marginTop: 18 }}>
          <div className="panel-head"><div className="t-heading-m">Where the base sits today</div><div style={{ flex: 1 }} /><span className="t-label-s faint">Width is share of memberships; the figure under each is the money in that state</span></div>
          <LifecycleFlow states={lifecycle} />
        </div>
      </Register>

      <Register title="Monthly renewal outcomes" index="② Renewals" domain="risk"
        subtitle="Memberships are counted in the month their end date makes them due—not the month they were sold. The final three months are forward-looking outreach cohorts.">
        <ChartModule title="Due for renewal: renewed, lapsed and unresolved" subtitle="Renewal rate uses decided outcomes only (renewed ÷ renewed + lapsed); frozen, not activated and pending remain visible separately."
          table={{ columns: ['Due month', 'Due', 'Renewed', 'Lapsed', 'Frozen', 'Not activated', 'Pending / other', 'Renewal rate', 'Membership value'], rows: renewalCalendar.map((r) => [r.month, r.due, r.renewed, r.lapsed, r.frozen, r.notActivated, r.pending, r.rate, r.value]) }}>
          <XYChart categories={renewalMonths.map(fmtMonthShort)} stacked height={270} fmtLeft="integer" fmtRight="percent" series={[
            { id: 'renewed', label: 'Renewed', color: 'var(--pos)', kind: 'bar', values: renewalCalendar.map((r) => r.renewed) },
            { id: 'lapsed', label: 'Lapsed', color: 'var(--neg)', kind: 'bar', values: renewalCalendar.map((r) => r.lapsed) },
            { id: 'frozen', label: 'Frozen', color: 'var(--info)', kind: 'bar', values: renewalCalendar.map((r) => r.frozen) },
            { id: 'not-activated', label: 'Not activated', color: 'var(--warn)', kind: 'bar', values: renewalCalendar.map((r) => r.notActivated) },
            { id: 'pending', label: 'Pending / other', color: 'var(--text-3)', kind: 'bar', values: renewalCalendar.map((r) => r.pending) },
            { id: 'rate', label: 'Renewal rate (decided)', color: 'var(--hue-revenue)', axis: 'right', fmt: 'percent', values: renewalCalendar.map((r) => r.rate) },
          ]} />
        </ChartModule>
      </Register>

      <Register title="Risk ladder" index="③ Triage" domain="risk"
        subtitle="Every active membership scored, banded, and priced. This is the call list, top band first.">
        <div className="risk-bands">
          {riskBands.map((b) => (
            <button key={b.id} className="risk-band" style={{ ['--tone' as string]: `var(--${b.tone})` }}
              onClick={() => drill({ title: b.label, breadcrumb: ['Retention', 'Risk', b.label], table: 'lapsed', rows: b.rows,
                peers: riskBands.map((x) => ({ label: x.label, rows: x.rows })), metricIds: ['risk_score', 'utilisation', 'avg_days_since_visit', 'l_revenue'], domain: 'risk' })}>
              <div className="t-heading-s" style={{ color: `var(--${b.tone})` }}>{b.label}</div>
              <div className="t-display-m tabular">{b.count.toLocaleString('en-IN')}</div>
              <div className="t-label-s muted">{fmtPercent(activeCount ? b.count / activeCount : 0)} of actives</div>
              <div className="risk-band-foot">
                <span className="t-label-s">{fmtCurrency(b.value)} at stake</span>
                <span className="t-label-s faint">{formatValue('percent', b.util)} used · {formatValue('days', b.absent)} absent</span>
              </div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="panel-head"><div className="t-heading-m">Risk mix by location</div></div>
          <CompositionBars rows={locationChurn} keys={RISK_BANDS.map((b) => b.label)} colors={RISK_BANDS.map((b) => `var(--${b.tone})`)} />
        </div>
      </Register>

      <Register title="How memberships die" index="③ Diagnosis" domain="risk"
        subtitle="Survival by product, the tenure at which people actually leave, and how much of what they bought they had used when they went.">
        <Two
          a={<ChartModule title="Survival by membership type" subtitle="Share still live at each 30-day mark"
            table={{ columns: ['Days', ...survival.series.map((s) => s.label)], rows: survival.xs.map((x, i) => [x, ...survival.series.map((s) => formatValue('percent', s.values[i]))]) }}>
            <XYChart categories={survival.xs.map((x) => `${x}d`)} series={survival.series} fmtLeft="percent" height={250} />
          </ChartModule>}
          b={<ChartModule title="When churn happens" subtitle="Tenure at churn, with the revenue and the utilisation each band reached"
            table={{ columns: ['Tenure', 'Churned', 'Revenue', 'Utilisation'], rows: churnTiming.map((c) => [c.label, c.n, Math.round(c.value), formatValue('percent', c.util)]) }}>
            <XYChart categories={churnTiming.map((c) => c.label)} height={250} fmtLeft="integer" fmtRight="percent"
              series={[{ id: 'n', label: 'Memberships churned', color: 'var(--neg)', kind: 'bar', values: churnTiming.map((c) => c.n) },
                { id: 'u', label: 'Utilisation reached', color: 'var(--hue-attendance)', axis: 'right', fmt: 'percent', values: churnTiming.map((c) => c.util) }]} />
          </ChartModule>} />
        <div style={{ marginTop: 18 }}>
          <div className="panel-head"><div className="t-heading-m">What separates members who stay from members who leave</div>
            <div style={{ flex: 1 }} /><span className="t-label-s faint">Stayed = active or renewed ({members.filter((m) => m.active || m.renewed > 0).length.toLocaleString('en-IN')}) · Left = churned ({members.filter((m) => m.churned && !m.active).length.toLocaleString('en-IN')})</span></div>
          <div className="table-scroll" style={{ maxHeight: 340 }}>
            <table className="tbl">
              <thead><tr><th className="t-heading-s" style={{ textAlign: 'left' }}>Signal</th><th className="t-heading-s">Members who stayed</th><th className="t-heading-s">Members who left</th><th className="t-heading-s">Difference</th><th className="t-heading-s" style={{ width: 160 }}>Separation</th></tr></thead>
              <tbody>{drivers.map((d) => {
                const good = d.gap !== null && ((d.gap > 0) === d.higher);
                const mag = d.gap === null ? 0 : Math.min(1, Math.abs(d.gap));
                return (
                  <tr key={d.k}>
                    <td className="t-body-s">{d.k}</td>
                    <td className="t-num">{formatValue(d.fmt, d.s)}</td>
                    <td className="t-num">{formatValue(d.fmt, d.g)}</td>
                    <td className={`t-num ${good ? 'pos' : 'neg'}`}>{d.gap === null ? '—' : `${d.gap > 0 ? '+' : '−'}${Math.abs(d.gap * 100).toFixed(0)}%`}</td>
                    <td><div style={{ height: 8, background: 'var(--surface-inset)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${mag * 100}%`, height: '100%', background: good ? 'var(--pos)' : 'var(--neg)', opacity: 0.7 }} /></div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="t-label-s faint" style={{ marginTop: 6 }}>Read this as: the further a bar extends, the more sharply that signal divides the two groups. Utilisation and recency are the levers you can act on.</div>
        </div>
      </Register>

      <Register title="Membership drill-down" index="④ Detail" domain="risk" id="drill-table"
        subtitle="Membership type → location → status → member. Regroup by dragging the chips; every rate recomputes weighted.">
        <NestedTable title="Retention" rows={rows} compareRows={scope.compare.lapsed} table="lapsed"
          groupKeys={['membership_type', 'location', 'status', 'member']}
          availableKeys={['membership_type', 'membership_name', 'location', 'status', 'member', 'sold_by', 'booking_method', 'month', 'quarter', 'year', 'risk_band', 'tenure_band', 'recency_band', 'spend_band', 'contactable']}
          columns={columns} ctx={scope.ctx} domain="risk" defaultSort={{ id: 'memberships', dir: 'desc' }}
          filtersLabel={filtersLabel(scope)} rankBy="churn_rate" leafLabel="memberships" />
      </Register>

      <Register title="Renewal ladder and the danger quadrant" index="⑤ Behaviour" domain="risk" lazy>
        <Two
          a={<ChartModule title="Renewal depth" subtitle="Members by how many memberships they have bought, with average spend and churn at each rung"
            table={{ columns: ['Depth', 'Members', 'Avg spend', 'Churned'], rows: renewalDepth.map((r) => [r.label, r.n, Math.round(r.spend), formatValue('percent', r.churn)]) }}>
            <XYChart categories={renewalDepth.map((r) => r.label)} height={240} fmtLeft="integer" fmtRight="currency"
              series={[{ id: 'n', label: 'Members', color: 'var(--hue-risk)', kind: 'bar', values: renewalDepth.map((r) => r.n) },
                { id: 's', label: 'Average lifetime spend', color: 'var(--hue-revenue)', axis: 'right', fmt: 'currency', values: renewalDepth.map((r) => r.spend) }]} />
            <div className="t-label-s faint" style={{ marginTop: 4 }}>The step from one membership to two is where lifetime value is made: {renewalDepth[0]?.n ?? 0} members never took it.</div>
          </ChartModule>}
          b={<ChartModule title="Utilisation against absence" subtitle="Active limited memberships; the shaded corner is unused and absent"
            table={{ columns: ['Member', 'Utilisation', 'Days since visit'], rows: scatter.slice(0, 200).map((p) => [p.label, fmtPercent(p.x), p.y]) }}>
            <Scatter points={scatter} xLabel="Utilisation of entitlement" yLabel="Days since last visit" fmtY="integer" xRef={0.5} yRef={21} shade="tl"
              quadrants={['Unused and absent — call today', 'Used it, then stopped', 'Just started', 'Healthy and engaged']}
              onClick={(p) => { const r = rows.find((x) => `${x.member_id}-${x.membership_name}` === p.id);
                if (r) drill({ title: r.member_name ?? '', breadcrumb: ['Retention', r.member_name ?? ''], table: 'lapsed',
                  rows: rows.filter((x) => x.member_id === r.member_id), metricIds: ['risk_score', 'utilisation', 'l_revenue', 'memberships'], domain: 'risk' }); }} />
          </ChartModule>} />
      </Register>

      <Register title="Rankings" index="⑥ Ranking" domain="risk" lazy>
        <Two
          a={<RankingList title="Active members by" nodes={memberNodes} metricOptions={['risk_score', 'utilisation', 'avg_days_since_visit', 'l_revenue', 'member_tenure']}
            ctx={scope.ctx} table="lapsed" domain="risk" minSample={1} sampleLabel="memberships" />}
          b={<RankingList title="Membership products by" nodes={byType} metricOptions={['churn_rate', 'renewal_rate', 'utilisation', 'member_ltv', 'gross_revenue_retention']}
            ctx={scope.ctx} table="lapsed" domain="risk" minSample={20} sampleLabel="memberships" />} />
      </Register>

      <Register title="Cohorts" index="⑦ Cohort" domain="risk" lazy
        actions={<div style={{ display: 'flex', gap: 2 }}>{([['retained', 'Retained'], ['revenue', 'Revenue kept']] as const).map(([k, l]) =>
          <button key={k} className="btn btn-xs" aria-pressed={cohortMode === k} onClick={() => setCohortMode(k)}>{l}</button>)}</div>}
        subtitle="Purchase-month cohort against months since purchase. A column that fades early is a product problem; a row that fades early is a month you onboarded badly.">
        <CohortTriangle rows={scope.all.lapsed.filter((r) => (r.amount_paid ?? 0) > 0)} cohortOf={(r) => r.month}
          alive={(r, o) => !(r.churned && (r.duration_days ?? 0) < o * 30)} scope={scope} valueLabel="still active" />
      </Register>

      <Register title="Month on month" index="⑧ Trend" domain="risk" lazy
        subtitle="Memberships are grouped by the month they were purchased, and every status column reads each membership's status today. This is therefore today's outcome by purchase cohort — &ldquo;of the memberships bought in March, how many are active or churned now&rdquo; — not a month-by-month history of the active base. The source carries no status history to reconstruct that from.">
        <MoMTable rows={scope.all.lapsed} metricIds={['new_memberships', 'active_memberships', 'churned_memberships', 'churn_rate', 'renewal_rate', 'gross_revenue_retention', 'utilisation', 'liability', 'member_ltv']}
          months={months} ctx={scope.ctx} domain="risk" />
      </Register>

      <Register title="Worklists" index="⑨ Act" domain="risk" lazy
        subtitle="Four lists, each sorted so the first row is the most valuable call you can make today.">
        <div className="subgrid">
          <DataPanel title={`Save list — ${worklist.length} active memberships at or above the ${scope.ctx.riskHigh} risk threshold`}
            subtitle={`${fmtCurrency(paidValue(worklist, scope.ctx))} of paid membership value`} maxHeight={360}>
            <table className="tbl">
              <thead><tr><th className="t-heading-s">Member</th><th className="t-heading-s">Membership</th><th className="t-heading-s">Risk</th><th className="t-heading-s">Used</th><th className="t-heading-s">Absent</th><th className="t-heading-s">Ends</th><th className="t-heading-s">Paid</th></tr></thead>
              <tbody>{worklist.map((r, i) => (
                <tr key={i} onClick={() => drill({ title: r.member_name ?? '', breadcrumb: ['Retention', 'Save list', r.member_name ?? ''], table: 'lapsed', rows: rows.filter((x) => x.member_id === r.member_id), metricIds: ['risk_score', 'utilisation', 'l_revenue', 'memberships'], domain: 'risk' })} style={{ cursor: 'pointer' }}>
                  <td className="t-body-s">{r.member_name}</td><td className="t-body-s">{r.membership_name}</td>
                  <td className="t-num neg">{r.risk_score}</td>
                  <td className="t-num">{r.completed ?? 0}{r.sessions_limit ? `/${r.sessions_limit}` : ''}</td>
                  <td className="t-num">{r.days_since_last_visit ?? '—'}d</td>
                  <td className="t-num">{fmtDate(r.end_date)}</td><td className="t-num">{fmtCurrency(r.amount_paid)}</td>
                </tr>))}</tbody>
            </table>
          </DataPanel>
          <Two
            a={<DataPanel title={`Expiring in 60 days — ${expiry.length}`} subtitle={`${fmtCurrency(paidValue(expiry, scope.ctx))} up for renewal`} maxHeight={320}>
              <table className="tbl">
                <thead><tr><th className="t-heading-s">Member</th><th className="t-heading-s">Ends</th><th className="t-heading-s">Used</th><th className="t-heading-s">Paid</th></tr></thead>
                <tbody>{expiry.slice(0, 60).map((r, i) => <tr key={i}><td className="t-body-s">{r.member_name}</td><td className="t-num">{fmtDate(r.end_date)}</td>
                  <td className="t-num">{formatValue('percent', r.sessions_limit ? (r.completed ?? 0) / r.sessions_limit : r.used_pct)}</td><td className="t-num">{fmtCurrency(r.amount_paid)}</td></tr>)}</tbody>
              </table>
            </DataPanel>}
            b={<DataPanel title={`Never used — ${zero.length}`} subtitle={`${fmtCurrency(paidValue(zero, scope.ctx))} bought and untouched for more than ${scope.ctx.zeroUsageDays} days`} maxHeight={320}>
              <table className="tbl">
                <thead><tr><th className="t-heading-s">Member</th><th className="t-heading-s">Membership</th><th className="t-heading-s">Started</th><th className="t-heading-s">Paid</th></tr></thead>
                <tbody>{zero.slice(0, 60).map((r, i) => <tr key={i}><td className="t-body-s">{r.member_name}</td><td className="t-body-s">{r.membership_name}</td>
                  <td className="t-num">{fmtDate(r.start_date)}</td><td className="t-num">{fmtCurrency(r.amount_paid)}</td></tr>)}</tbody>
              </table>
              {!zero.length && <div className="muted t-body-s" style={{ padding: 12 }}>No unused paid memberships in scope.</div>}
            </DataPanel>} />
          <DataPanel title={`Win-back pool — ${winback.length} churned members with spend history`}
            subtitle={`${fmtCurrency(winback.reduce((a, m) => a + m.spend, 0))} of prior value, all contactable`} maxHeight={320}>
            <table className="tbl">
              <thead><tr><th className="t-heading-s">Member</th><th className="t-heading-s">Memberships</th><th className="t-heading-s">Last product</th><th className="t-heading-s">Lifetime spend</th><th className="t-heading-s">Ended</th></tr></thead>
              <tbody>{winback.map((m) => <tr key={m.id}><td className="t-body-s">{m.name}</td><td className="t-num">{m.memberships}</td>
                <td className="t-body-s">{m.lastMembership ?? '—'}</td><td className="t-num">{fmtCurrency(m.spend)}</td>
                <td className="t-num">{m.lastEnd ? fmtDate(new Date(m.lastEnd).toISOString().slice(0, 10)) : '—'}</td></tr>)}</tbody>
            </table>
          </DataPanel>
        </div>
      </Register>

      <Register title="Product economics, discounting and freezes" index="⑩ Reference" domain="risk" collapsed lazy>
        <div className="subgrid">
          <DataPanel title="Churn and renewal by membership product" subtitle="Products with at least 20 records">
            <table className="tbl">
              <thead><tr><th className="t-heading-s">Membership</th><th className="t-heading-s">Records</th><th className="t-heading-s">Churn</th><th className="t-heading-s">Renewed</th><th className="t-heading-s">Tenure at churn</th><th className="t-heading-s">Utilisation</th><th className="t-heading-s">Member LTV</th><th className="t-heading-s">Revenue</th></tr></thead>
              <tbody>{byType.map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{n.rows.length}</td>
                <td className="t-num">{formatValue('percent', n.values.churn_rate.value)}</td><td className="t-num">{formatValue('percent', n.values.renewal_rate.value)}</td>
                <td className="t-num">{formatValue('days', n.values.avg_tenure_at_churn.value)}</td><td className="t-num">{formatValue('percent', n.values.utilisation.value)}</td>
                <td className="t-num">{fmtCurrency(n.values.member_ltv.value)}</td><td className="t-num">{fmtCurrency(n.values.l_revenue.value)}</td></tr>)}</tbody>
            </table>
          </DataPanel>
          <Two
            a={<ChartModule title="Does discounting buy loyalty?" table={{ columns: ['Group', 'Churn', 'Renewed'], rows: [] }}>
              <DiscountSplit rows={rows} scope={scope} />
            </ChartModule>}
            b={<ChartModule title="Do freezes predict churn?" table={{ columns: ['Group', 'Churn', 'Renewed'], rows: [] }}>
              <FreezeSplit rows={rows} scope={scope} />
            </ChartModule>} />
          <div>
            <div className="panel-head"><div className="t-heading-m">Cancellation behaviour by risk band</div></div>
            <Heatmap xs={['Cancellation rate', 'Attendance rate', 'Utilisation']} ys={RISK_BANDS.map((b) => b.label)} fmt="percent" kind="diverging" cellH={30}
              cells={RISK_BANDS.flatMap((b) => { const rs = rows.filter((r) => r.active && (r.risk_score ?? 0) >= b.lo && (r.risk_score ?? 0) < b.hi);
                const v = metricValues(rs, ['l_cancel_rate', 'l_attendance_rate', 'utilisation'], scope.ctx);
                return [{ x: 'Cancellation rate', y: b.label, value: v.l_cancel_rate.value, n: rs.length },
                  { x: 'Attendance rate', y: b.label, value: v.l_attendance_rate.value, n: rs.length },
                  { x: 'Utilisation', y: b.label, value: v.utilisation.value, n: rs.length }]; })} />
          </div>
        </div>
      </Register>
    </>
  );
}

function DiscountSplit({ rows, scope }: { rows: Row[]; scope: Scope }) {
  const groups = useMemo(() => {
    const bands = [[0, 0.001, 'Full price'], [0.001, 0.1, 'Up to 10%'], [0.1, 0.25, '10–25%'], [0.25, 1.01, 'Over 25%']] as const;
    return bands.map(([lo, hi, label]) => {
      const rs = rows.filter((r) => { const o = r.original_amount ?? r.amount_paid ?? 0; const d = o ? (r.discount_value ?? 0) / o : 0; return o > 0 && d >= lo && d < hi; });
      const v = metricValues(rs, ['churn_rate', 'renewal_rate', 'member_ltv'], scope.ctx);
      return { label, n: rs.length, churn: v.churn_rate.value, renew: v.renewal_rate.value, ltv: v.member_ltv.value };
    }).filter((g) => g.n >= 10);
  }, [rows, scope.ctx]);
  const max = maxBy(groups, (g) => g.churn, 0.01);
  return (
    <>
      <HBars items={groups.map((g) => ({ label: g.label, value: g.churn, sub: `${g.n} records` }))} fmt="percent" max={max} color="var(--neg)" />
      <div className="t-label-s faint" style={{ marginTop: 6 }}>Churn rate by discount depth. Renewal: {groups.map((g) => `${g.label} ${formatValue('percent', g.renew)}`).join(' · ')}</div>
    </>
  );
}

function FreezeSplit({ rows, scope }: { rows: Row[]; scope: Scope }) {
  const groups = useMemo(() => ([
    { label: 'Never frozen', rs: rows.filter((r) => !(r.freeze_count ?? 0)) },
    { label: 'Frozen once', rs: rows.filter((r) => (r.freeze_count ?? 0) === 1) },
    { label: 'Frozen more than once', rs: rows.filter((r) => (r.freeze_count ?? 0) > 1) },
  ].map((g) => { const v = metricValues(g.rs, ['churn_rate', 'renewal_rate'], scope.ctx);
    return { label: g.label, n: g.rs.length, churn: v.churn_rate.value, renew: v.renewal_rate.value }; }).filter((g) => g.n >= 10)), [rows, scope.ctx]);
  const max = maxBy(groups, (g) => g.churn, 0.01);
  return (
    <>
      <HBars items={groups.map((g) => ({ label: g.label, value: g.churn, sub: `${g.n} records` }))} fmt="percent" max={max} color="var(--warn)" />
      <div className="t-label-s faint" style={{ marginTop: 6 }}>Churn rate by freeze history. Renewal: {groups.map((g) => `${g.label} ${formatValue('percent', g.renew)}`).join(' · ')}</div>
      <WidgetSection tab="retention" scope={scope} placement="bottom" />
    </>
  );
}
