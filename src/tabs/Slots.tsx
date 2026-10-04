import { useMemo, useState } from 'react';
import type { Scope } from '../state/data';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { KpiStrip, DayTimeHeatmap, Two, useMonths, filtersLabel, SectionEmpty } from './common';
import { ChartModule } from '../components/charts/core';
import { Bump } from '../components/charts/special';
import { ScheduleGrid, Heatmap } from '../components/charts/grids';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { RankingList } from '../components/RankingList/RankingList';
import { GROUP_KEYS, metricValues, rollupLevel, seriesBy, type RollupNode } from '../semantics/aggregations';
import type { QueryContext } from '../semantics/metrics';
import { useFilters } from '../state/filters';
import { fmtDateShort, fmtTime12, formatValue } from '../semantics/formats';
import { categorical } from '../design/ramps';
import { useView } from '../state/view';

type Verdict = 'Keep' | 'Watch' | 'Move' | 'Cut' | 'New';
export function verdictOf(n: RollupNode, ctx: QueryContext): Verdict {
  if (n.rows.length < 4) return 'New';
  const v = metricValues(n.rows, ['fill_rate', 'gap_to_break_even'], ctx); const fill = v.fill_rate.value ?? 0; const gap = v.gap_to_break_even.value ?? 0;
  if (fill < 0.2 && gap < 0) return 'Cut'; if (fill < 0.35 || gap < 0) return 'Move'; if (fill < 0.5) return 'Watch'; return 'Keep';
}
const VERDICT_COLOR: Record<Verdict, string> = { Keep: 'var(--pos)', Watch: 'var(--warn)', Move: 'var(--info)', Cut: 'var(--neg)', New: 'var(--text-3)' };
export const VerdictChip = ({ v }: { v: Verdict }) => <span className="t-label-s pill" style={{ padding: '1px 8px', color: VERDICT_COLOR[v], border: `1px solid ${VERDICT_COLOR[v]}` }}>{v}</span>;

export function Slots({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const theme = useView((s) => s.theme);
  const addTransient = useFilters((s) => s.addTransient);
  const rows = scope.tables.sessions;
  const [layer, setLayer] = useState<'fill_rate' | 'empty_session_rate' | 'rev_per_seat_hour'>('fill_rate');
  const weeks = useMemo(() => { const w = new Set<string>(); for (const r of scope.all.sessions) if (r.week) w.add(r.week); return [...w].sort().slice(-12); }, [scope.all.sessions]);
  const momentum = (rs: typeof rows) => { const s = seriesBy(scope.all.sessions.filter((r) => rs.length && r.location === rs[0].location && r.day === rs[0].day && r.time === rs[0].time), (r) => r.week, ['fill_rate'], scope.ctx, weeks); return s.map((x) => x.values.fill_rate.value); };
  const columns: ColumnDef[] = useMemo(() => [
    { id: 'sessions', metricId: 'sessions', label: 'Occurrences', family: 'Volume', bar: true },
    { id: 'empty_sessions', metricId: 'empty_sessions', family: 'Utilisation' },
    { id: 'reliability', metricId: 'reliability', family: 'Utilisation', heat: true },
    { id: 'avg_class_size_incl', metricId: 'avg_class_size_incl', family: 'Utilisation' },
    { id: 'avg_class_size_excl', metricId: 'avg_class_size_excl', family: 'Utilisation', hidden: true },
    { id: 'fill_rate', metricId: 'fill_rate', family: 'Utilisation', heat: true },
    { id: 'revenue', metricId: 'revenue', family: 'Revenue', bar: true },
    { id: 'revenue_per_session', metricId: 'revenue_per_session', label: 'Weighted avg / occurrence', family: 'Revenue' },
    { id: 'rev_pas', metricId: 'rev_pas', family: 'Revenue', heat: true },
    { id: 'break_even_class_size', metricId: 'break_even_class_size', family: 'Revenue' },
    { id: 'gap_to_break_even', metricId: 'gap_to_break_even', family: 'Revenue', heat: true },
    { id: 'trainer_dependency_index', metricId: 'trainer_dependency_index', family: 'Behaviour', heat: true },
    { id: 'trainer_depth', metricId: 'trainer_depth', family: 'Behaviour' },
    { id: 'momentum', label: '12-week momentum', family: 'Behaviour', spark: momentum },
    { id: 'verdict', label: 'Verdict', family: 'Score', render: (n, ctx) => <VerdictChip v={verdictOf(n, ctx)} />, value: (n, ctx) => ['Cut', 'Move', 'Watch', 'New', 'Keep'].indexOf(verdictOf(n, ctx)) },
  ], [scope.all.sessions, weeks]); // eslint-disable-line react-hooks/exhaustive-deps
  const slotNodes = useMemo(() => rollupLevel(rows, ['slot'], 0, ['fill_rate', 'rev_pas', 'revenue_per_session', 'sessions', 'empty_session_rate', 'gap_to_break_even'], scope.ctx), [rows, scope.ctx]);
  const slotPrev = useMemo(() => rollupLevel(scope.compare.sessions, ['slot'], 0, ['fill_rate', 'rev_pas', 'revenue_per_session', 'sessions', 'empty_session_rate', 'gap_to_break_even'], scope.ctx), [scope.compare.sessions, scope.ctx]);
  const overallFill = metricValues(rows, ['fill_rate'], scope.ctx).fill_rate.value ?? 0.5;
  const schedule = useMemo(() => {
    const m = new Map<string, typeof rows>(); for (const r of rows) { if (!r.day || !r.time) continue; const k = `${r.day}|${r.time}|${r.location}|${r.format}`; let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(r); }
    return [...m.entries()].map(([k, rs]) => { const [day, time, location, format] = k.split('|'); const v = metricValues(rs, ['fill_rate', 'seats'], scope.ctx); return { key: k, day, time, label: `${format} · ${location.split(',')[0]}`, capacity: (v.seats.value ?? 0) / rs.length, value: v.fill_rate.value, n: rs.length, sub: location }; });
  }, [rows, scope.ctx]);
  const bump = useMemo(() => {
    const top = [...slotNodes].sort((a, b) => (b.values.sessions.value ?? 0) - (a.values.sessions.value ?? 0)).slice(0, 8);
    const perWeek = weeks.map((w) => { const ranked = top.map((n) => ({ n, v: metricValues(scope.all.sessions.filter((r) => r.week === w && GROUP_KEYS.slot.accessor(r) === n.key), ['fill_rate'], scope.ctx).fill_rate.value })).filter((x) => x.v !== null).sort((a, b) => (b.v ?? 0) - (a.v ?? 0)); return new Map(ranked.map((x, i) => [x.n.id, i + 1])); });
    return { periods: weeks.map((w) => fmtDateShort(w)), entities: top.map((n) => ({ label: n.label, ranks: perWeek.map((m) => m.get(n.id) ?? null) })) };
  }, [slotNodes, weeks, scope.all.sessions, scope.ctx]);
  const dependency = useMemo(() => slotNodes.map((n) => ({ n, dep: metricValues(n.rows, ['trainer_dependency_index', 'trainer_depth', 'attendance'], scope.ctx) })).filter((x) => (x.dep.trainer_dependency_index.value ?? 0) > 0.6 && (x.dep.trainer_depth.value ?? 0) >= 2 && x.n.rows.length >= 4).sort((a, b) => (b.dep.trainer_dependency_index.value ?? 0) - (a.dep.trainer_dependency_index.value ?? 0)), [slotNodes, scope.ctx]);
  const declining = useMemo(() => slotNodes.map((n) => { const m = momentum(n.rows).filter((v): v is number => v !== null); const half = Math.floor(m.length / 2); if (m.length < 4) return null; const a = m.slice(0, half).reduce((x, y) => x + y, 0) / half; const b = m.slice(half).reduce((x, y) => x + y, 0) / (m.length - half); return { n, before: a, after: b, delta: b - a }; }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.delta - b.delta).slice(0, 15), [slotNodes]); // eslint-disable-line react-hooks/exhaustive-deps
  const formatSlot = useMemo(() => { const cells = []; const fs = [...new Set(rows.map((r) => r.format).filter(Boolean))] as string[]; for (const f of fs) for (const s of ['Morning', 'Afternoon', 'Evening']) { const rs = rows.filter((r) => r.format === f && r.slot === s); if (rs.length) cells.push({ x: s, y: f, value: metricValues(rs, ['fill_rate'], scope.ctx).fill_rate.value, n: rs.length }); } return { fs, cells }; }, [rows, scope.ctx]);
  const substitution = useMemo(() => { const out: { slot: string; trainer: string; fill: number; slotFill: number; n: number }[] = []; for (const n of slotNodes) { const sf = metricValues(n.rows, ['fill_rate'], scope.ctx).fill_rate.value; if (sf === null) continue; const by = rollupLevel(n.rows, ['trainer'], 0, ['fill_rate'], scope.ctx); if (by.length < 2) continue; for (const t of by) if (t.rows.length >= 2 && t.values.fill_rate.value !== null) out.push({ slot: n.label, trainer: t.label, fill: t.values.fill_rate.value, slotFill: sf, n: t.rows.length }); } return out.sort((a, b) => Math.abs(b.fill - b.slotFill) - Math.abs(a.fill - a.slotFill)).slice(0, 20); }, [slotNodes, scope.ctx]);
  if (!rows.length) return <div style={{ paddingTop: 20 }}><SectionEmpty what="sessions" scope={scope} /></div>;
  return (
    <>
      <WidgetSection tab="slots" scope={scope} placement="top" />
      <Register title="Slots" subtitle="A schedule-design tool. The output is a keep / watch / move / cut list." domain="attendance">
        <KpiStrip scope={scope} table="sessions" ids={['active_slots', 'below_break_even', 'revenue_per_session', 'empty_session_rate', 'seat_hours', 'rev_per_seat_hour']} cols={6} />
      </Register>
      <Register title="The week as it runs" subtitle="Each card is a recurring slot, sized by capacity and coloured by fill against the studio average. Click to filter." domain="attendance">
        <ScheduleGrid slots={schedule} center={overallFill} onClick={(s) => { addTransient({ dim: 'daytime', value: `${s.day} ${s.time}`, label: `${s.day.slice(0, 3)} ${fmtTime12(s.time)}` }); addTransient({ dim: 'location', value: s.sub ?? '' }); }} />
      </Register>
      <Register title="Slot table" subtitle="Location → day → time → trainer, with break-even, dependency and a rule-derived verdict" domain="attendance" id="drill-table">
        <NestedTable title="Slots" rows={rows} compareRows={scope.compare.sessions} table="sessions" groupKeys={['location', 'day', 'time', 'trainer']} availableKeys={['location', 'day', 'time', 'trainer', 'slot', 'slot_uid', 'format', 'timeslot', 'daypart', 'weekpart', 'class_name', 'month', 'quarter', 'capacity_band']} columns={columns} ctx={scope.ctx} domain="attendance" defaultSort={{ id: 'fill_rate', dir: 'asc' }} filtersLabel={filtersLabel(scope)} rankBy="fill_rate" leafLabel="occurrences" />
        <div className="t-label-s faint" style={{ marginTop: 6 }}>Verdict: Cut = fill under 20% and below break-even · Move = fill under 35% or below break-even · Watch = fill under 50% · Keep otherwise · New = fewer than 4 occurrences. Break-even uses the rate in Settings (₹{scope.ctx.ratePerSession.toLocaleString('en-IN')}).</div>
      </Register>
      <Register title="Strongest and weakest slots; rank trajectories" domain="attendance" lazy>
        <Two a={<RankingList title="Slots by" nodes={slotNodes} compareNodes={slotPrev} metricOptions={['fill_rate', 'rev_pas', 'revenue_per_session', 'gap_to_break_even', 'empty_session_rate']} ctx={scope.ctx} table="sessions" domain="attendance" minSample={4} sampleLabel="occurrences" />}
          b={<ChartModule title="Rank by fill, 12 weeks" subtitle="Eight most frequent slots" table={{ columns: ['Slot', ...bump.periods], rows: bump.entities.map((e) => [e.label, ...e.ranks]) }}><Bump periods={bump.periods} entities={bump.entities} colorOf={(_, i) => categorical(theme, i)} /></ChartModule>} />
      </Register>
      <Register title="Day × time" domain="attendance" lazy actions={<div style={{ display: 'flex', gap: 2 }}>{(['fill_rate', 'empty_session_rate', 'rev_per_seat_hour'] as const).map((l) => <button key={l} className="btn btn-xs" aria-pressed={layer === l} onClick={() => setLayer(l)}>{l === 'fill_rate' ? 'Fill' : l === 'empty_session_rate' ? 'Empty rate' : 'Revenue per seat-hour'}</button>)}</div>}>
        <DayTimeHeatmap rows={rows} metricId={layer} scope={scope} />
      </Register>
      <Register title="Month on month" domain="attendance" lazy>
        <MoMTable rows={scope.all.sessions} metricIds={['active_slots', 'fill_rate', 'below_break_even', 'empty_session_rate', 'revenue_per_session']} months={months} ctx={scope.ctx} domain="attendance" />
      </Register>
      <Register title="Dependency register, momentum, format-in-slot, substitution impact" domain="attendance" collapsed lazy>
        <div style={{ display: 'grid', gap: 24 }}>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Trainer dependency register — slots where one trainer carries more than 60% of attendance</div>
            {dependency.length ? <div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Slot</th><th className="t-heading-s">Dependency</th><th className="t-heading-s">Trainers</th><th className="t-heading-s">Attendance</th><th className="t-heading-s">Occurrences</th></tr></thead><tbody>{dependency.map((d) => <tr key={d.n.id}><td className="t-body-s">{d.n.label}</td><td className="t-num neg">{formatValue('percent', d.dep.trainer_dependency_index.value)}</td><td className="t-num">{d.dep.trainer_depth.value}</td><td className="t-num">{d.dep.attendance.value}</td><td className="t-num">{d.n.rows.length}</td></tr>)}</tbody></table></div> : <div className="muted t-body-s">No multi-trainer slot exceeds the dependency threshold.</div>}</div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Momentum — biggest declines in fill, first half vs second half of the last 12 weeks</div>
            <div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Slot</th><th className="t-heading-s">Before</th><th className="t-heading-s">After</th><th className="t-heading-s">Change</th></tr></thead><tbody>{declining.map((d) => <tr key={d.n.id}><td className="t-body-s">{d.n.label}</td><td className="t-num">{formatValue('percent', d.before)}</td><td className="t-num">{formatValue('percent', d.after)}</td><td className={`t-num ${d.delta < 0 ? 'neg' : 'pos'}`}>{formatValue('pp', d.delta)}</td></tr>)}</tbody></table></div></div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Format-in-slot matrix — fill by format and time of day</div><Heatmap xs={['Morning', 'Afternoon', 'Evening']} ys={formatSlot.fs} cells={formatSlot.cells} fmt="percent" onClick={(c) => { addTransient({ dim: 'format', value: c.y }); addTransient({ dim: 'slot', value: c.x }); }} /></div>
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Substitution impact — trainer fill vs the slot's own average</div>
            <div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Slot</th><th className="t-heading-s">Trainer</th><th className="t-heading-s">Trainer fill</th><th className="t-heading-s">Slot avg</th><th className="t-heading-s">Impact</th><th className="t-heading-s">n</th></tr></thead><tbody>{substitution.map((s) => <tr key={s.slot + s.trainer}><td className="t-body-s">{s.slot}</td><td className="t-body-s">{s.trainer}</td><td className="t-num">{formatValue('percent', s.fill)}</td><td className="t-num">{formatValue('percent', s.slotFill)}</td><td className={`t-num ${s.fill >= s.slotFill ? 'pos' : 'neg'}`}>{formatValue('pp', s.fill - s.slotFill)}</td><td className="t-num">{s.n}</td></tr>)}</tbody></table></div></div>
        </div>
      </Register>
      <WidgetSection tab="slots" scope={scope} placement="bottom" />
    </>
  );
}
