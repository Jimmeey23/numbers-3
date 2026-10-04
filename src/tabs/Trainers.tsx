import { useMemo } from 'react';
import type { Scope } from '../state/data';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { KpiStrip, Two, useMonths, filtersLabel, SectionEmpty } from './common';
import { ChartModule } from '../components/charts/core';
import { BoxPlot, Scatter } from '../components/charts/special';
import { Heatmap } from '../components/charts/grids';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { RankingList } from '../components/RankingList/RankingList';
import { compositeScore, metricValues, rollupLevel } from '../semantics/aggregations';
import { useDrill } from '../state/drill';
import { useFilters } from '../state/filters';
import { fmtTime12, formatValue } from '../semantics/formats';

const T_METRICS = ['sessions', 'fill_rate', 'revenue_per_session', 'rev_pac', 'draw_premium_pp', 'attendance_cv', 'revenue_per_hour', 'attendance'];

export function Trainers({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const drill = useDrill((s) => s.open);
  const addTransient = useFilters((s) => s.addTransient);
  const rows = scope.tables.sessions;
  const trainerNodes = useMemo(() => rollupLevel(rows, ['trainer'], 0, T_METRICS, scope.ctx), [rows, scope.ctx]);
  const trainerPrev = useMemo(() => rollupLevel(scope.compare.sessions, ['trainer'], 0, T_METRICS, scope.ctx), [scope.compare.sessions, scope.ctx]);
  /* Acquisition outcomes come from the New sheet, keyed by first-visit trainer. The table itself
     is on the session grain, so these are joined in per trainer rather than computed over the
     rows in scope — the same pattern the composite already used for trial conversion. */
  const ACQ = ['new_clients', 'converted_count', 'conversion_rate', 'retention_rate', 'second_visit_rate', 'median_ltv'];
  const acqByTrainer = useMemo(() => {
    const m = new Map<string, Record<string, number | null>>();
    for (const n of rollupLevel(scope.tables.newc.filter((r) => r.is_new), ['trainer'], 0, ACQ, scope.ctx)) {
      m.set(n.key, Object.fromEntries(ACQ.map((id) => [id, n.values[id].value])));
    }
    return m;
  }, [scope.tables.newc, scope.ctx]);          // eslint-disable-line react-hooks/exhaustive-deps
  const convByTrainer = useMemo(() => {
    const m = new Map<string, { conv: number | null; ret: number | null }>();
    for (const [k, v] of acqByTrainer) m.set(k, { conv: v.conversion_rate, ret: v.retention_rate });
    return m;
  }, [acqByTrainer]);
  const composite = useMemo(() => {
    const nodes = trainerNodes.map((n) => ({ ...n, values: { ...n.values, conv: { value: convByTrainer.get(n.key)?.conv ?? null, n: 0, contributing: 0, coverage: null, suspect: null }, ret: { value: convByTrainer.get(n.key)?.ret ?? null, n: 0, contributing: 0, coverage: null, suspect: null } } }));
    return compositeScore(nodes, [{ id: 'fill_rate', w: 0.3 }, { id: 'revenue_per_session', w: 0.25 }, { id: 'conv', w: 0.25 }, { id: 'ret', w: 0.2 }]);
  }, [trainerNodes, convByTrainer]);
  const columns: ColumnDef[] = useMemo(() => [
    { id: 'sessions', metricId: 'sessions', family: 'Volume', bar: true }, { id: 'empty_sessions', metricId: 'empty_sessions', family: 'Utilisation' }, { id: 'attendance', metricId: 'attendance', family: 'Volume' },
    { id: 'fill_rate', metricId: 'fill_rate', family: 'Utilisation', heat: true }, { id: 'draw_premium_pp', metricId: 'draw_premium_pp', family: 'Score', heat: true },
    { id: 'avg_class_size_incl', metricId: 'avg_class_size_incl', family: 'Utilisation' }, { id: 'avg_class_size_excl', metricId: 'avg_class_size_excl', family: 'Utilisation', hidden: true },
    { id: 'revenue', metricId: 'revenue', family: 'Revenue', bar: true }, { id: 'revenue_per_session', metricId: 'revenue_per_session', family: 'Revenue' }, { id: 'rev_pac', metricId: 'rev_pac', family: 'Revenue' }, { id: 'rev_pas', metricId: 'rev_pas', family: 'Revenue', heat: true },
    { id: 'teaching_hours', metricId: 'teaching_hours', family: 'Volume' }, { id: 'revenue_per_hour', metricId: 'revenue_per_hour', family: 'Revenue' }, { id: 'attendance_cv', metricId: 'attendance_cv', family: 'Behaviour' },
    { id: 'versatility', metricId: 'versatility', family: 'Behaviour' }, { id: 'locations_taught', metricId: 'locations_taught', family: 'Behaviour' }, { id: 'prime_time_share', metricId: 'prime_time_share', family: 'Behaviour', heat: true },
    { id: 'acq_new', label: 'New members', family: 'Acquisition', bar: true,
      value: (n) => (n.level === 0 ? acqByTrainer.get(n.key)?.new_clients ?? null : null), format: 'integer',
      render: (n) => <span className="t-num">{n.level === 0 ? formatValue('integer', acqByTrainer.get(n.key)?.new_clients ?? null) : ''}</span> },
    { id: 'acq_converted', label: 'Converted', family: 'Acquisition',
      value: (n) => (n.level === 0 ? acqByTrainer.get(n.key)?.converted_count ?? null : null), format: 'integer',
      render: (n) => <span className="t-num">{n.level === 0 ? formatValue('integer', acqByTrainer.get(n.key)?.converted_count ?? null) : ''}</span> },
    { id: 'acq_value', label: 'Conversion value', family: 'Acquisition', bar: true,
      value: (n) => { const c = n.level === 0 ? acqByTrainer.get(n.key)?.converted_count ?? null : null; return c === null ? null : c * scope.ctx.medianFirstMembership; }, format: 'currency',
      render: (n) => { const c = n.level === 0 ? acqByTrainer.get(n.key)?.converted_count ?? null : null; return <span className="t-num">{c === null ? '' : formatValue('currency', c * scope.ctx.medianFirstMembership)}</span>; } },
    { id: 'acq_second', label: 'Second-visit rate', family: 'Acquisition', hidden: true,
      value: (n) => (n.level === 0 ? acqByTrainer.get(n.key)?.second_visit_rate ?? null : null), format: 'percent',
      render: (n) => <span className="t-num">{n.level === 0 ? formatValue('percent', acqByTrainer.get(n.key)?.second_visit_rate ?? null) : ''}</span> },
    { id: 'acq_retention', label: 'Retention of new members', family: 'Acquisition',
      value: (n) => (n.level === 0 ? acqByTrainer.get(n.key)?.retention_rate ?? null : null), format: 'percent',
      render: (n) => <span className="t-num">{n.level === 0 ? formatValue('percent', acqByTrainer.get(n.key)?.retention_rate ?? null) : ''}</span> },
    { id: 'acq_ltv', label: 'Median LTV of their members', family: 'Acquisition', hidden: true,
      value: (n) => (n.level === 0 ? acqByTrainer.get(n.key)?.median_ltv ?? null : null), format: 'currency',
      render: (n) => <span className="t-num">{n.level === 0 ? formatValue('currency', acqByTrainer.get(n.key)?.median_ltv ?? null) : ''}</span> },
    { id: 'conv', label: 'Trial conversion', family: 'Score', value: (n) => (n.level === 0 ? convByTrainer.get(n.key)?.conv ?? null : null), format: 'percent', render: (n) => <span className="t-num">{n.level === 0 ? formatValue('percent', convByTrainer.get(n.key)?.conv) : ''}</span> },
    { id: 'composite', label: 'Composite score', family: 'Score', value: (n) => (n.level === 0 ? composite.get(n.id) ?? null : null), format: 'decimal', render: (n) => <span className="t-num">{n.level === 0 ? formatValue('decimal', composite.get(n.id) ?? null) : ''}</span> },
  ], [convByTrainer, composite]);
  const trainerHour = useMemo(() => { const cells = []; const hours = new Set<string>(); const ts = trainerNodes.filter((n) => n.rows.length >= 5).map((n) => n.key); for (const t of ts) { const m = new Map<string, typeof rows>(); for (const r of rows) if (r.trainer === t && r.time) { const h = r.time.slice(0, 2) + ':00'; hours.add(h); let a = m.get(h); if (!a) { a = []; m.set(h, a); } a.push(r); } for (const [h, rs] of m) cells.push({ x: h, y: t, value: metricValues(rs, ['fill_rate'], scope.ctx).fill_rate.value, n: rs.length }); } return { xs: [...hours].sort(), ys: ts, cells }; }, [trainerNodes, rows, scope.ctx]);
  const trainerFormat = useMemo(() => { const cells = []; const fs = [...new Set(rows.map((r) => r.format).filter(Boolean))] as string[]; for (const n of trainerNodes) for (const f of fs) { const rs = n.rows.filter((r) => r.format === f); if (rs.length) cells.push({ x: f, y: n.key, value: metricValues(rs, ['fill_rate'], scope.ctx).fill_rate.value, n: rs.length }); } return { fs, cells }; }, [trainerNodes, rows, scope.ctx]);
  const prime = useMemo(() => trainerNodes.filter((n) => n.rows.length >= 5).map((n) => { const p = metricValues(n.rows, ['prime_time_share'], scope.ctx).prime_time_share.value; const isPrime = (r: typeof rows[number]) => { const h = r.time ? +r.time.slice(0, 2) + (+r.time.slice(3, 5)) / 60 : -1; return (h >= 7 && h < 10) || (h >= 17.5 && h < 20); }; const pf = metricValues(n.rows.filter(isPrime), ['fill_rate'], scope.ctx).fill_rate.value; const of = metricValues(n.rows.filter((r) => !isPrime(r)), ['fill_rate'], scope.ctx).fill_rate.value; return { t: n.key, share: p, primeFill: pf, offFill: of, n: n.rows.length }; }).sort((a, b) => (b.share ?? 0) - (a.share ?? 0)), [trainerNodes, scope.ctx]);
  const workload = useMemo(() => trainerNodes.map((n) => { const weeks = new Set(n.rows.map((r) => r.week)); const days = [...new Set(n.rows.map((r) => r.date))].sort() as string[]; let maxRun = 0; let run = 0; for (let i = 0; i < days.length; i++) { run = i > 0 && (new Date(days[i]).getTime() - new Date(days[i - 1]).getTime()) === 864e5 ? run + 1 : 1; maxRun = Math.max(maxRun, run); } return { t: n.key, perWeek: n.rows.length / Math.max(1, weeks.size), maxRun, sessions: n.rows.length }; }).sort((a, b) => b.perWeek - a.perWeek), [trainerNodes]);
  const median = useMemo(() => { const v = trainerNodes.filter((n) => n.rows.length >= 5).map((n) => n.values.fill_rate.value).filter((x): x is number => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; }, [trainerNodes]);
  const dev = useMemo(() => trainerNodes.filter((n) => n.rows.length >= 5 && n.values.fill_rate.value !== null && median !== null).map((n) => ({ t: n.key, fill: n.values.fill_rate.value!, gap: n.values.fill_rate.value! - median!, cv: n.values.attendance_cv.value, n: n.rows.length })).sort((a, b) => a.gap - b.gap), [trainerNodes, median]);
  if (!rows.length) return <div style={{ paddingTop: 20 }}><SectionEmpty what="sessions" scope={scope} /></div>;
  return (
    <>
      <WidgetSection tab="trainers" scope={scope} placement="top" />
      <Register title="Trainers" subtitle="Compare instructor demand, class fill, and revenue across the times they teach." domain="people">
        <KpiStrip scope={scope} table="sessions" ids={['active_trainers', 'sessions', 'avg_class_size_incl', 'fill_rate', 'revenue_per_session', 'teaching_hours', 'draw_premium_spread', 'top3_revenue_concentration']} />
      </Register>
      <Register title="Popular vs profitable" subtitle="Draw premium against revenue per attendee; bubble = sessions" domain="people">
        <ChartModule title="Draw premium × revenue per attendee" table={{ columns: ['Trainer', 'Draw premium', 'Rev per attendee', 'Sessions'], rows: trainerNodes.map((n) => [n.label, n.values.draw_premium_pp.value === null ? null : `${(n.values.draw_premium_pp.value * 100).toFixed(1)}pp`, Math.round(n.values.rev_pac.value ?? 0), n.values.sessions.value]) }}>
          <Scatter points={trainerNodes.filter((n) => n.rows.length >= 3 && n.values.draw_premium_pp.value !== null && n.values.rev_pac.value !== null).map((n) => ({ id: n.id, label: n.label, x: n.values.draw_premium_pp.value!, y: n.values.rev_pac.value!, size: n.values.sessions.value ?? 1, n: n.rows.length }))} xLabel="Draw premium (pp vs slot average)" yLabel="Revenue per attendee" fmtX="pp" xRef={0} quadrants={['Premium but unpopular', 'Star', 'Neither', 'Popular but cheap']} onClick={(p) => { const n = trainerNodes.find((x) => x.id === p.id)!; drill({ title: n.label, breadcrumb: ['Trainers', n.label], table: 'sessions', rows: n.rows, peers: trainerNodes.map((x) => ({ label: x.label, rows: x.rows })), metricIds: ['fill_rate', 'draw_premium_pp', 'revenue_per_session', 'sessions'], domain: 'people' }); }} />
        </ChartModule>
      </Register>
      <Register title="Trainer table" subtitle="Trainer → format → location → slot" domain="people" id="drill-table">
        <NestedTable title="Trainers" rows={rows} compareRows={scope.compare.sessions} table="sessions" groupKeys={['trainer', 'format', 'location', 'slot']} availableKeys={['trainer', 'format', 'location', 'slot', 'day', 'time', 'timeslot', 'daypart', 'weekpart', 'class_name', 'month', 'quarter', 'year', 'capacity_band']} columns={columns} ctx={scope.ctx} domain="people" defaultSort={{ id: 'composite', dir: 'desc' }} filtersLabel={filtersLabel(scope)} rankBy="composite" leafLabel="sessions" />
        <div className="t-label-s faint" style={{ marginTop: 6 }}>Composite = 0.30·z(fill) + 0.25·z(revenue per session) + 0.25·z(trial conversion) + 0.20·z(retention), z-scored across trainers in scope.</div>
      </Register>
      <Register title="Rankings and class-size distribution" domain="people" lazy>
        <Two a={<RankingList title="Trainers by" nodes={trainerNodes} compareNodes={trainerPrev} metricOptions={['draw_premium_pp', 'revenue_per_hour', 'attendance_cv', 'fill_rate', 'rev_pac']} ctx={scope.ctx} table="sessions" domain="people" minSample={5} sampleLabel="sessions" />}
          b={<ChartModule title="Class-size distribution per trainer" subtitle="Box = interquartile range, line = median" table={{ columns: ['Trainer', 'Sessions', 'Avg size'], rows: trainerNodes.map((n) => [n.label, n.rows.length, (n.values.attendance.value ?? 0) / Math.max(1, n.rows.length)]) }}><BoxPlot groups={trainerNodes.filter((n) => n.rows.length >= 5).map((n) => ({ label: n.label, values: n.rows.map((r) => r.checked_in ?? 0) }))} onClick={(l) => addTransient({ dim: 'trainer', value: l })} /></ChartModule>} />
      </Register>
      <Register title="Who is scheduled into the wrong hours" subtitle="Trainer × hour by fill rate" domain="people" lazy>
        <Heatmap xs={trainerHour.xs} ys={trainerHour.ys} cells={trainerHour.cells} fmt="percent" xLabel={fmtTime12} minN={2} onClick={(c) => addTransient({ dim: 'trainer', value: c.y })} />
      </Register>
      <Register title="Month on month per trainer" domain="people" lazy>
        <MoMTable rows={scope.all.sessions} metricIds={['attendance', 'revenue', 'fill_rate']} months={months} ctx={scope.ctx} domain="people" groups={trainerNodes.map((n) => ({ label: n.label, rows: scope.all.sessions.filter((r) => r.trainer === n.key) }))} />
      </Register>
      <Register title="Format matrix, prime-slot audit, workload, development" domain="people" collapsed lazy>
        <div style={{ display: 'grid', gap: 24 }}>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Trainer × format — fill rate</div><Heatmap xs={trainerFormat.fs} ys={trainerNodes.map((n) => n.key)} cells={trainerFormat.cells} fmt="percent" minN={2} /></div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Prime-slot allocation audit</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Trainer</th><th className="t-heading-s">Prime share</th><th className="t-heading-s">Fill in prime</th><th className="t-heading-s">Fill off-peak</th><th className="t-heading-s">Sessions</th></tr></thead><tbody>{prime.map((p) => <tr key={p.t}><td className="t-body-s">{p.t}</td><td className="t-num">{formatValue('percent', p.share)}</td><td className="t-num">{formatValue('percent', p.primeFill)}</td><td className="t-num">{formatValue('percent', p.offFill)}</td><td className="t-num">{p.n}</td></tr>)}</tbody></table></div></div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Workload — sessions per week and longest run of consecutive teaching days</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Trainer</th><th className="t-heading-s">Sessions / week</th><th className="t-heading-s">Longest streak</th><th className="t-heading-s">Sessions</th></tr></thead><tbody>{workload.map((w) => <tr key={w.t}><td className="t-body-s">{w.t}</td><td className={`t-num ${w.perWeek > 15 ? 'warn' : ''}`}>{w.perWeek.toFixed(1)}</td><td className={`t-num ${w.maxRun >= 6 ? 'warn' : ''}`}>{w.maxRun} days</td><td className="t-num">{w.sessions}</td></tr>)}</tbody></table></div></div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Development — gap to the peer median fill ({formatValue('percent', median)})</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Trainer</th><th className="t-heading-s">Fill</th><th className="t-heading-s">Gap to median</th><th className="t-heading-s">Consistency (CV)</th><th className="t-heading-s">n</th></tr></thead><tbody>{dev.map((d) => <tr key={d.t}><td className="t-body-s">{d.t}</td><td className="t-num">{formatValue('percent', d.fill)}</td><td className={`t-num ${d.gap < 0 ? 'neg' : 'pos'}`}>{formatValue('pp', d.gap)}</td><td className="t-num">{formatValue('ratio', d.cv)}</td><td className="t-num">{d.n}</td></tr>)}</tbody></table></div></div>
        </div>
      </Register>
      <WidgetSection tab="trainers" scope={scope} placement="bottom" />
    </>
  );
}
