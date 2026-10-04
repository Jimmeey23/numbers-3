import { useMemo, useState } from 'react';
import type { Scope } from '../state/data';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { KpiStrip, Two, useMonths, filtersLabel, SectionEmpty, CohortTriangle } from './common';
import { ChartModule, XYChart } from '../components/charts/core';
import { FunnelChart, CompositionBars, type Stage } from '../components/charts/funnel';
import { Heatmap } from '../components/charts/grids';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { RankingList } from '../components/RankingList/RankingList';
import { metricValues, rollupLevel, type Row } from '../semantics/aggregations';
import { useFilters } from '../state/filters';
import { useDrill } from '../state/drill';
import { fmtCurrency, fmtDate, formatValue } from '../semantics/formats';
import { categorical } from '../design/ramps';
import { useView } from '../state/view';

const A_METRICS = ['new_clients', 'second_visit_rate', 'conversion_rate', 'avg_conversion_span', 'avg_first_purchase', 'avg_ltv', 'retention_rate', 'zero_return_rate', 'survival_90'];

export function Acquisition({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const addTransient = useFilters((s) => s.addTransient);
  const drill = useDrill((s) => s.open);
  const rows = scope.tables.newc;
  const [matured, setMatured] = useState(true);
  // A client who visited yesterday cannot have "returned" yet. Maturity excludes anyone whose
  // first visit was inside 21 days so the return and conversion rates are settled, not optimistic.
  const matureTs = scope.ctx.todayTs - scope.ctx.matureDays * 864e5;
  const allFresh = useMemo(() => rows.filter((r) => r.is_new), [rows]);
  const fresh = useMemo(() => (matured ? allFresh.filter((r) => r.ts !== null && r.ts <= matureTs) : allFresh), [allFresh, matured, matureTs]);
  const immature = allFresh.length - fresh.length;
  const [rankKey, setRankKey] = useState<'source' | 'trainer' | 'timeslot' | 'first_visit_type'>('source');
  const theme = useView((v) => v.theme);

  /* ── The full journey, stage by stage, with every drop-off priced ──
     Leads are real now (25k rows), so the funnel starts where the money is spent. */
  const funnel = useMemo(() => {
    const afp = metricValues(fresh, ['avg_first_purchase'], scope.ctx).avg_first_purchase.value ?? 12599;
    const ltv = metricValues(fresh, ['avg_ltv'], scope.ctx).avg_ltv.value ?? afp;
    const leads = scope.tables.leads;
    const trialed = leads.filter((r) => r.trialed).length;
    const first = fresh.length;
    const second = fresh.filter((r) => (r.visits_post_trial ?? 0) > 0).length;
    const third = fresh.filter((r) => (r.visits_post_trial ?? 0) >= 2).length;
    const purchased = fresh.filter((r) => r.converted).length;
    const member = fresh.filter((r) => (r.memberships_bought ?? 0) > 0).length;
    const retained = fresh.filter((r) => r.converted && (r.days_active ?? 0) >= 90).length;
    const stages: Stage[] = [];
    if (leads.length) {
      stages.push({ id: 'lead', label: 'Leads created', count: leads.length, note: 'Enquiries captured in the Leads sheet for this period.' });
      stages.push({ id: 'trial', label: 'Booked or took a trial', count: trialed, lostValue: null, note: 'Leads with a trial scheduled, completed, or any recorded visit.' });
    }
    stages.push({ id: 'first', label: 'First visit', count: first, lostValue: null, note: 'People who actually walked in for a first class.' });
    stages.push({ id: 'second', label: 'Came back once', count: second, lostValue: (first - second) * afp * 0.3, note: 'The single steepest step in the business — one visit and never again.' });
    stages.push({ id: 'third', label: 'Came back twice', count: third, lostValue: (second - third) * afp * 0.3, note: 'Habit forms around the third visit; past here, conversion climbs sharply.' });
    stages.push({ id: 'purchase', label: 'First purchase', count: purchased, lostValue: (third - purchased) * afp, note: 'Any paid product bought after the trial.' });
    stages.push({ id: 'member', label: 'Bought a membership', count: member, lostValue: (purchased - member) * Math.max(0, ltv - afp), note: 'Converted to recurring revenue rather than a one-off.' });
    stages.push({ id: 'retained', label: 'Still active at 90 days', count: retained, lostValue: (member - retained) * ltv * 0.5, note: 'Converted clients with at least 90 active days.' });
    return stages;
  }, [fresh, scope.tables.leads, scope.ctx]);

  const funnelRows = useMemo(() => ({
    lead: scope.tables.leads, trial: scope.tables.leads.filter((r) => r.trialed), first: fresh,
    second: fresh.filter((r) => (r.visits_post_trial ?? 0) > 0), third: fresh.filter((r) => (r.visits_post_trial ?? 0) >= 2),
    purchase: fresh.filter((r) => r.converted), member: fresh.filter((r) => (r.memberships_bought ?? 0) > 0),
    retained: fresh.filter((r) => r.converted && (r.days_active ?? 0) >= 90),
  } as Record<string, Row[]>), [fresh, scope.tables.leads]);

  /* ── The same funnel cut by source, so you can see which channel leaks where ── */
  const funnelBySource = useMemo(() => {
    const keys = ['First visit', 'Second visit', 'Purchased', 'Retained 90d'];
    return rollupLevel(fresh, ['source'], 0, ['new_clients'], scope.ctx)
      .filter((n) => n.rows.length >= 20)
      .sort((a, b) => b.rows.length - a.rows.length).slice(0, 8)
      .map((n) => {
        const f = n.rows.length;
        const s2 = n.rows.filter((r) => (r.visits_post_trial ?? 0) > 0).length;
        const p = n.rows.filter((r) => r.converted).length;
        const ret = n.rows.filter((r) => r.converted && (r.days_active ?? 0) >= 90).length;
        return { label: n.label, parts: [f - s2, s2 - p, p - ret, ret], total: f, keys };
      });
  }, [fresh, scope.ctx]);

  /* ── Visit-number progression: where the habit forms ── */
  const visitLadder = useMemo(() => {
    const max = 10;
    const counts = Array.from({ length: max }, (_, i) => fresh.filter((r) => (r.visits ?? 0) >= i + 1).length);
    return counts.map((c, i) => ({ visit: i + 1, reached: c, step: i === 0 ? null : counts[i - 1] ? c / counts[i - 1] : null,
      convRate: (() => { const at = fresh.filter((r) => (r.visits ?? 0) === i + 1); return at.length >= 5 ? at.filter((r) => r.converted).length / at.length : null; })() }));
  }, [fresh]);

  /* ── Speed to convert: the window in which decisions actually happen ── */
  const speedCurve = useMemo(() => {
    const bands = [[0, 1, 'Same day'], [1, 8, '1–7 days'], [8, 31, '8–30 days'], [31, 91, '31–90 days'], [91, 1e9, '90+ days']] as const;
    const conv = fresh.filter((r) => r.converted && r.conversion_span !== null);
    return bands.map(([lo, hi, label]) => {
      const rs = conv.filter((r) => (r.conversion_span ?? 0) >= lo && (r.conversion_span ?? 0) < hi);
      return { label, n: rs.length, ltv: rs.length ? rs.reduce((a, r) => a + (r.ltv ?? 0), 0) / rs.length : null,
        retained: rs.length ? rs.filter((r) => r.retained).length / rs.length : null };
    });
  }, [fresh]);

  const maxLtv = useMemo(() => Math.max(1, ...speedCurve.map((s2) => s2.ltv ?? 0)), [speedCurve]);

  const columns: ColumnDef[] = [
    { id: 'new_clients', metricId: 'new_clients', family: 'Volume', bar: true }, { id: 'second_visit_rate', metricId: 'second_visit_rate', family: 'Behaviour', heat: true }, { id: 'conversion_rate', metricId: 'conversion_rate', family: 'Utilisation', heat: true },
    { id: 'avg_conversion_span', metricId: 'avg_conversion_span', family: 'Behaviour' }, { id: 'median_conversion_span', metricId: 'median_conversion_span', family: 'Behaviour', hidden: true },
    { id: 'avg_first_purchase', metricId: 'avg_first_purchase', family: 'Revenue' }, { id: 'median_ltv', metricId: 'median_ltv', family: 'Revenue', heat: true },
    { id: 'avg_ltv', metricId: 'avg_ltv', family: 'Revenue', hidden: true }, { id: 'total_ltv', metricId: 'total_ltv', family: 'Revenue', bar: true }, { id: 'ltv_to_first_purchase', metricId: 'ltv_to_first_purchase', family: 'Revenue', hidden: true },
    { id: 'avg_visits_post_trial', metricId: 'avg_visits_post_trial', family: 'Behaviour' }, { id: 'retention_rate', metricId: 'retention_rate', family: 'Utilisation', heat: true }, { id: 'new_churn_rate', metricId: 'new_churn_rate', family: 'Behaviour' }, { id: 'new_late_cancel_rate', metricId: 'new_late_cancel_rate', family: 'Behaviour', hidden: true }, { id: 'survival_90', metricId: 'survival_90', family: 'Utilisation' }, { id: 'contactable_rate', metricId: 'contactable_rate', family: 'Behaviour', hidden: true },
  ];
  const rankNodes = useMemo(() => rollupLevel(fresh, [rankKey], 0, A_METRICS, scope.ctx), [fresh, rankKey, scope.ctx]);
  const rankPrev = useMemo(() => rollupLevel(scope.compare.newc.filter((r) => r.is_new), [rankKey], 0, A_METRICS, scope.ctx), [scope.compare.newc, rankKey, scope.ctx]);
  const daySlot = useMemo(() => { const cells = []; for (const d of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) for (const s of ['Morning', 'Afternoon', 'Evening']) { const rs = fresh.filter((r) => r.day === d && r.slot === s); if (rs.length) cells.push({ x: s, y: d, value: metricValues(rs, ['conversion_rate'], scope.ctx).conversion_rate.value, n: rs.length }); } return cells; }, [fresh, scope.ctx]);
  const sourceQuality = useMemo(() => rollupLevel(fresh, ['source'], 0, ['new_clients', 'conversion_rate', 'avg_ltv', 'total_ltv'], scope.ctx).filter((n) => n.rows.length >= 5).sort((a, b) => (b.values.total_ltv.value ?? 0) - (a.values.total_ltv.value ?? 0)), [fresh, scope.ctx]);
  const speed = useMemo(() => rollupLevel(fresh, ['speed_bucket'], 0, ['new_clients', 'avg_ltv', 'retention_rate', 'avg_first_purchase'], scope.ctx).sort((a, b) => ['Same Day', '1-7 Days', '8-30 Days', '31-90 Days', '90+ Days', 'Not Converted'].indexOf(a.key) - ['Same Day', '1-7 Days', '8-30 Days', '31-90 Days', '90+ Days', 'Not Converted'].indexOf(b.key)), [fresh, scope.ctx]);
  const trainerScore = useMemo(() => rollupLevel(fresh, ['trainer'], 0, ['new_clients', 'second_visit_rate', 'conversion_rate', 'avg_ltv'], scope.ctx).filter((n) => n.rows.length >= 10).sort((a, b) => (b.values.conversion_rate.value ?? 0) - (a.values.conversion_rate.value ?? 0)), [fresh, scope.ctx]);
  const firstProduct = useMemo(() => rollupLevel(fresh.filter((r) => r.first_purchase_product), ['membership_type'], 0, ['new_clients', 'avg_first_purchase', 'avg_ltv', 'retention_rate'], scope.ctx).sort((a, b) => b.rows.length - a.rows.length), [fresh, scope.ctx]);
  const atRisk = useMemo(() => rows.filter((r) => r.lifecycle === 'Active' && (r.days_since_last_visit ?? 0) > scope.ctx.dormantDays && r.contactable).sort((a, b) => (b.ltv ?? 0) - (a.ltv ?? 0)).slice(0, 25), [rows]);
  const winback = useMemo(() => rows.filter((r) => (r.lifecycle === 'Lapsed' || r.lifecycle === 'Churned') && (r.ltv ?? 0) > 0 && r.contactable).sort((a, b) => (b.ltv ?? 0) - (a.ltv ?? 0)).slice(0, 25), [rows]);
  if (!rows.length) return <div style={{ paddingTop: 20 }}><SectionEmpty what="new clients" scope={scope} /></div>;
  return (
    <>
      <WidgetSection tab="acquisition" scope={scope} placement="top" />
      <Register title="Acquisition" index="① State" domain="growth"
        subtitle={matured
          ? `${fresh.length.toLocaleString('en-IN')} first visits with at least ${scope.ctx.matureDays} days of history, so return and conversion rates are settled. ${immature.toLocaleString('en-IN')} more recent joiners are held back.`
          : `All ${allFresh.length.toLocaleString('en-IN')} first visits in scope, including ${immature.toLocaleString('en-IN')} who joined too recently to have returned yet — rates will read low.`}
        actions={<button className="btn btn-xs" aria-pressed={matured} onClick={() => setMatured((m) => !m)}>
          {matured ? 'Settled cohorts only' : 'Including recent joiners'}
        </button>}>
        <KpiStrip scope={scope} table="newc" rows={fresh}
          compareRows={scope.compare.newc.filter((r) => r.is_new && (!matured || (r.ts !== null && r.ts <= matureTs)))}
          allRows={scope.all.newc.filter((r) => r.is_new && (!matured || (r.ts !== null && r.ts <= matureTs)))}
          ids={['new_clients', 'second_visit_rate', 'conversion_rate', 'avg_conversion_span', 'avg_first_purchase', 'median_ltv', 'avg_ltv_buyers', 'zero_return_rate']} />
      </Register>
      <Register title="The journey" index="② Funnel" domain="growth"
        subtitle="Every stage from enquiry to a member still training at 90 days, with the drop-off at each step valued in rupees. Click any band to list the people in it.">
        <FunnelChart stages={funnel} height={Math.max(280, funnel.length * 52)} unit="people"
          onStage={(st) => drill({ title: st.label, breadcrumb: ['Acquisition', 'Journey', st.label],
            table: st.id === 'lead' || st.id === 'trial' ? 'leads' : 'newc', rows: funnelRows[st.id] ?? [],
            metricIds: st.id === 'lead' || st.id === 'trial' ? ['leads', 'lead_conversion_rate', 'avg_touches', 'response_time_hours'] : ['new_clients', 'conversion_rate', 'avg_ltv', 'retention_rate'],
            domain: 'growth' })} />
        <div className="two-up" style={{ marginTop: 22 }}>
          <div>
            <div className="panel-head"><div className="t-heading-m">Where each source leaks</div>
              <div style={{ flex: 1 }} /><span className="t-label-s faint">Sources with 20+ first visits</span></div>
            <CompositionBars rows={funnelBySource} keys={['Never returned', 'Returned, never bought', 'Bought, then lapsed', 'Retained at 90 days']}
              colors={[categorical(theme, 1), categorical(theme, 3), categorical(theme, 4), categorical(theme, 2)]} />
          </div>
          <ChartModule title="Where the habit forms" subtitle="How many first-timers reach each visit number, and what share of them convert"
            table={{ columns: ['Visit', 'Reached', 'Step rate', 'Conversion'], rows: visitLadder.map((v) => [v.visit, v.reached, formatValue('percent', v.step), formatValue('percent', v.convRate)]) }}>
            <XYChart categories={visitLadder.map((v) => `#${v.visit}`)} height={240} fmtLeft="integer" fmtRight="percent"
              series={[{ id: 'r', label: 'Clients reaching this visit', color: 'var(--hue-growth)', kind: 'bar', values: visitLadder.map((v) => v.reached) },
                { id: 'c', label: 'Conversion at this visit count', color: 'var(--hue-revenue)', axis: 'right', fmt: 'percent', values: visitLadder.map((v) => v.convRate) }]} />
          </ChartModule>
        </div>
      </Register>

      <Register title="How fast people decide" index="③ Timing" domain="growth" lazy
        subtitle="Conversion span against what those clients turned out to be worth. Fast deciders are usually worth more — if they are, the trial offer should close harder and sooner.">
        <ChartModule title="Conversion speed, value and retention"
          table={{ columns: ['Speed', 'Converted', 'Avg LTV', 'Retained'], rows: speedCurve.map((s2) => [s2.label, s2.n, Math.round(s2.ltv ?? 0), formatValue('percent', s2.retained)]) }}>
          <XYChart categories={speedCurve.map((s2) => s2.label)} height={230} fmtLeft="integer" fmtRight="currency"
            series={[{ id: 'n', label: 'Clients converting in this window', color: 'var(--hue-growth)', kind: 'bar', values: speedCurve.map((s2) => s2.n) },
              { id: 'l', label: 'Average LTV', color: 'var(--hue-revenue)', axis: 'right', fmt: 'currency', values: speedCurve.map((s2) => s2.ltv) },
              { id: 'r', label: 'Retained share', color: 'var(--hue-people)', axis: 'right', fmt: 'percent', values: speedCurve.map((s2) => (s2.retained === null ? null : s2.retained * (maxLtv || 1))) }]} />
        </ChartModule>
      </Register>

      <Register title="Drill down" index="④ Detail" subtitle="Source → first-visit location → first trainer → time slot. Regroup by dragging the chips." domain="growth" id="drill-table">
        <NestedTable title="Acquisition" rows={fresh} compareRows={scope.compare.newc.filter((r) => r.is_new)} table="newc" groupKeys={['source', 'location', 'trainer', 'timeslot']} availableKeys={['source', 'location', 'trainer', 'timeslot', 'daypart', 'day', 'weekpart', 'first_visit_type', 'is_new_label', 'lifecycle', 'speed_bucket', 'membership_type', 'month', 'quarter', 'year', 'member', 'spend_band', 'recency_band', 'contactable']} columns={columns} ctx={scope.ctx} domain="growth" defaultSort={{ id: 'new_clients', dir: 'desc' }} filtersLabel={filtersLabel(scope)} rankBy="conversion_rate" leafLabel="clients" />
      </Register>
      <Register title="Best and worst converters; cohort survival" domain="growth" lazy actions={<div style={{ display: 'flex', gap: 2 }}>{([['source', 'Sources'], ['trainer', 'Trainers'], ['timeslot', 'Slots'], ['first_visit_type', 'Entry products']] as const).map(([k, l]) => <button key={k} className="btn btn-xs" aria-pressed={rankKey === k} onClick={() => setRankKey(k)}>{l}</button>)}</div>}>
        <Two a={<RankingList title="Ranked by" nodes={rankNodes} compareNodes={rankPrev} metricOptions={['conversion_rate', 'second_visit_rate', 'avg_ltv', 'retention_rate', 'new_clients']} ctx={scope.ctx} table="newc" domain="growth" minSample={10} sampleLabel="clients" />}
          b={<ChartModule title="Cohort triangle" subtitle="Acquisition month × months since first visit, coloured by share still active (last visit inside the offset)" table={{ columns: ['Month', 'Clients'], rows: months.map((m) => [m, scope.all.newc.filter((r) => r.is_new && r.month === m).length]) }}>
            <CohortTriangle rows={scope.all.newc.filter((r) => r.is_new)} cohortOf={(r) => r.month} alive={(r, o) => { if (!r.last_visit || !r.date) return false; const monthsActive = (new Date(r.last_visit).getTime() - new Date(r.date).getTime()) / (30.4 * 864e5); return monthsActive >= o; }} scope={scope} valueLabel="still visiting" />
          </ChartModule>} />
      </Register>
      <Register title="Which trial times convert" subtitle="First-visit day × time slot by conversion rate" domain="growth" lazy>
        <Heatmap xs={['Morning', 'Afternoon', 'Evening']} ys={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']} cells={daySlot} fmt="percent" minN={5} yLabel={(y) => y.slice(0, 3)} onClick={(c) => { addTransient({ dim: 'day', value: c.y }); addTransient({ dim: 'slot', value: c.x }); }} />
      </Register>
      <Register title="Month on month by source" domain="growth" lazy>
        <MoMTable rows={scope.all.newc.filter((r) => r.is_new)} metricIds={['new_clients', 'second_visit_rate', 'conversion_rate', 'avg_first_purchase', 'avg_ltv', 'retention_rate']} months={months} ctx={scope.ctx} domain="growth" groups={sourceQuality.slice(0, 8).map((n) => ({ label: n.label, rows: scope.all.newc.filter((r) => r.is_new && r.source === n.key) }))} />
      </Register>
      <Register title="Source quality, conversion speed, trainer scorecard, first-purchase mix, at-risk and win-back" domain="growth" collapsed lazy>
        <div style={{ display: 'grid', gap: 24 }}>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Source quality — ranked by total value (volume × conversion × LTV)</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Source</th><th className="t-heading-s">New clients</th><th className="t-heading-s">Conversion</th><th className="t-heading-s">Avg LTV</th><th className="t-heading-s">Total LTV</th></tr></thead><tbody>{sourceQuality.map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{n.values.new_clients.value}</td><td className="t-num">{formatValue('percent', n.values.conversion_rate.value)}</td><td className="t-num">{fmtCurrency(n.values.avg_ltv.value)}</td><td className="t-num">{fmtCurrency(n.values.total_ltv.value)}</td></tr>)}</tbody></table></div></div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Conversion speed buckets</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Bucket</th><th className="t-heading-s">Clients</th><th className="t-heading-s">Avg first purchase</th><th className="t-heading-s">Avg LTV</th><th className="t-heading-s">Retention</th></tr></thead><tbody>{speed.map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{n.values.new_clients.value}</td><td className="t-num">{fmtCurrency(n.values.avg_first_purchase.value)}</td><td className="t-num">{fmtCurrency(n.values.avg_ltv.value)}</td><td className="t-num">{formatValue('percent', n.values.retention_rate.value)}</td></tr>)}</tbody></table></div></div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Trainer conversion scorecard (≥10 first visits)</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Trainer</th><th className="t-heading-s">First visits</th><th className="t-heading-s">Second visit</th><th className="t-heading-s">Conversion</th><th className="t-heading-s">Avg LTV</th></tr></thead><tbody>{trainerScore.map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{n.values.new_clients.value}</td><td className="t-num">{formatValue('percent', n.values.second_visit_rate.value)}</td><td className="t-num">{formatValue('percent', n.values.conversion_rate.value)}</td><td className="t-num">{fmtCurrency(n.values.avg_ltv.value)}</td></tr>)}</tbody></table></div></div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>First-purchase product mix</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Product type</th><th className="t-heading-s">Clients</th><th className="t-heading-s">Avg first purchase</th><th className="t-heading-s">Avg LTV</th><th className="t-heading-s">Retention</th></tr></thead><tbody>{firstProduct.map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{n.rows.length}</td><td className="t-num">{fmtCurrency(n.values.avg_first_purchase.value)}</td><td className="t-num">{fmtCurrency(n.values.avg_ltv.value)}</td><td className="t-num">{formatValue('percent', n.values.retention_rate.value)}</td></tr>)}</tbody></table></div></div>
          <Two a={<div><div className="t-heading-m" style={{ marginBottom: 6 }}>At-risk new members — active, absent 21+ days, contactable</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Client</th><th className="t-heading-s">Days absent</th><th className="t-heading-s">LTV</th><th className="t-heading-s">Last visit</th></tr></thead><tbody>{atRisk.map((r) => <tr key={r.member_id}><td className="t-body-s">{r.name}</td><td className="t-num warn">{r.days_since_last_visit}</td><td className="t-num">{fmtCurrency(r.ltv)}</td><td className="t-num">{fmtDate(r.last_visit)}</td></tr>)}</tbody></table></div></div>}
            b={<div><div className="t-heading-m" style={{ marginBottom: 6 }}>Win-back pool — lapsed or churned, ranked by prior LTV</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Client</th><th className="t-heading-s">Status</th><th className="t-heading-s">LTV</th><th className="t-heading-s">Last visit</th></tr></thead><tbody>{winback.map((r) => <tr key={r.member_id}><td className="t-body-s">{r.name}</td><td className="t-body-s">{r.lifecycle}</td><td className="t-num">{fmtCurrency(r.ltv)}</td><td className="t-num">{fmtDate(r.last_visit)}</td></tr>)}</tbody></table></div></div>} />
        </div>
      </Register>
      <WidgetSection tab="acquisition" scope={scope} placement="bottom" />
    </>
  );
}
