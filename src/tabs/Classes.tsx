import type { Theme } from '../design/ramps';
import { useMemo, useState } from 'react';
import type { Scope } from '../state/data';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { KpiStrip, DayTimeHeatmap, Two, useMonths, filtersLabel, SectionEmpty } from './common';
import { ChartModule, XYChart } from '../components/charts/core';
import { Scatter } from '../components/charts/special';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { RankingList } from '../components/RankingList/RankingList';
import { rollupLevel, seriesBy, type Row } from '../semantics/aggregations';
import { formatColor } from '../design/ramps';
import { useView } from '../state/view';
import { useFilters } from '../state/filters';
import { useDrill } from '../state/drill';
import { fmtDateShort } from '../semantics/formats';

export const SESSION_COLUMNS = (theme: Theme): ColumnDef[] => [
  { id: 'sessions', metricId: 'sessions', family: 'Volume', bar: true },
  { id: 'seats', metricId: 'seats', family: 'Volume' },
  { id: 'booked', metricId: 'booked', family: 'Volume' },
  { id: 'attendance', metricId: 'attendance', family: 'Volume' },
  { id: 'late_cancels', metricId: 'late_cancels', family: 'Behaviour' },
  { id: 'no_shows', metricId: 'no_shows', family: 'Behaviour' },
  { id: 'fill_rate', metricId: 'fill_rate', family: 'Utilisation', heat: true },
  { id: 'show_up_rate', metricId: 'show_up_rate', family: 'Behaviour', heat: true },
  { id: 'avg_class_size_incl', metricId: 'avg_class_size_incl', family: 'Utilisation' },
  { id: 'avg_class_size_excl', metricId: 'avg_class_size_excl', family: 'Utilisation', hidden: true },
  { id: 'dist', label: 'Size spread', family: 'Utilisation', dist: (rows) => { const b = [0, 0, 0, 0, 0, 0]; for (const r of rows) { const v = r.checked_in ?? 0; b[Math.min(5, Math.floor(v / 4))]++; } return b; } },
  { id: 'empty_sessions', metricId: 'empty_sessions', family: 'Utilisation' },
  { id: 'revenue', metricId: 'revenue', family: 'Revenue', bar: true },
  { id: 'rev_pac', metricId: 'rev_pac', family: 'Revenue' },
  { id: 'rev_pas', metricId: 'rev_pas', family: 'Revenue', heat: true },
  { id: 'unsold_seats', metricId: 'unsold_seats', family: 'Utilisation', hidden: true },
  { id: 'lost_revenue', metricId: 'lost_revenue', family: 'Revenue' },
  { id: 'mix', label: 'Payment mix', family: 'Revenue', mix: (rows) => [{ label: 'Membership', value: rows.reduce((a, r) => a + (r.memberships ?? 0), 0), color: formatColor(theme, 'Cycle') }, { label: 'Package', value: rows.reduce((a, r) => a + (r.packages ?? 0), 0), color: formatColor(theme, 'Pilates') }, { label: 'Intro', value: rows.reduce((a, r) => a + (r.intro_offers ?? 0), 0), color: formatColor(theme, 'Hosted') }, { label: 'Single', value: rows.reduce((a, r) => a + (r.single_classes ?? 0), 0), color: formatColor(theme, 'Strength') }] },
  { id: 'late_cancel_rate', metricId: 'late_cancel_rate', family: 'Behaviour', hidden: true },
  { id: 'non_paid_rate', metricId: 'non_paid_rate', family: 'Revenue', hidden: true },
  { id: 'session_intelligence', metricId: 'session_intelligence', family: 'Utilisation', heat: true },
];

export function Classes({ scope }: { scope: Scope }) {
  const theme = useView((s) => s.theme);
  const months = useMonths(scope);
  const addTransient = useFilters((s) => s.addTransient);
  const drill = useDrill((s) => s.open);
  const rows = scope.tables.sessions;
  const [layer, setLayer] = useState<'fill_rate' | 'rev_pas' | 'empty_sessions'>('fill_rate');
  const [loc, setLoc] = useState<string | null>(null);
  const weekly = useMemo(() => seriesBy(rows, (r) => r.week, ['sessions', 'fill_rate', 'attendance'], scope.ctx), [rows, scope.ctx]);
  const classNodes = useMemo(() => rollupLevel(rows, ['class_name'], 0, ['fill_rate', 'rev_pas', 'rev_pac', 'sessions', 'revenue_per_session', 'show_up_rate'], scope.ctx), [rows, scope.ctx]);
  const classPrev = useMemo(() => rollupLevel(scope.compare.sessions, ['class_name'], 0, ['fill_rate', 'rev_pas', 'rev_pac', 'sessions', 'revenue_per_session', 'show_up_rate'], scope.ctx), [scope.compare.sessions, scope.ctx]);
  const columns = useMemo(() => SESSION_COLUMNS(theme).map((c) => (c.id === 'fill_rate' ? { ...c, bar: true, threshold: () => { const be = classNodes.length ? 0 : 0; return be; } } : c)), [theme, classNodes.length]);
  const locs = [...new Set(rows.map((r) => r.location).filter(Boolean))] as string[];
  const overbooked = useMemo(() => rows.filter((r) => r.booked !== null && r.capacity !== null && r.booked > r.capacity).sort((a, b) => (b.booked - b.capacity) - (a.booked - a.capacity)).slice(0, 30), [rows]);
  if (!rows.length) return <div style={{ paddingTop: 20 }}><SectionEmpty what="sessions" scope={scope} /></div>;
  const derived = rows[0]?.derived;
  return (
    <>
      <WidgetSection tab="classes" scope={scope} placement="top" />
      <Register title="Classes" subtitle={derived ? 'Session grain rebuilt from Checkins (Sessions sheet is private) — see Data health' : 'See how session supply, occupied seats, cancellations, and revenue per class move together.'} domain="attendance">
        <KpiStrip scope={scope} table="sessions" ids={['sessions', 'seats', 'attendance', 'fill_rate', 'empty_sessions', 'rev_pas', 'revenue_per_session', 'late_cancel_rate']} />
      </Register>
      <Register title="Does adding classes dilute fill?" subtitle="Sessions per week as bars, fill rate as a line" domain="attendance">
        <ChartModule title="Sessions and fill by week" table={{ columns: ['Week', 'Sessions', 'Fill rate', 'Attendance'], rows: weekly.map((w) => [w.key, w.values.sessions.value, w.values.fill_rate.value === null ? null : `${(w.values.fill_rate.value * 100).toFixed(1)}%`, w.values.attendance.value]) }}>
          <XYChart categories={weekly.map((w) => fmtDateShort(w.key))} series={[{ id: 's', label: 'Sessions', color: 'var(--hue-attendance)', values: weekly.map((w) => w.values.sessions.value), kind: 'bar' }, { id: 'f', label: 'Fill rate', color: 'var(--hue-revenue)', values: weekly.map((w) => w.values.fill_rate.value), axis: 'right', fmt: 'percent' }]} fmtLeft="integer" fmtRight="percent" onClick={(i) => addTransient({ dim: 'week', value: weekly[i].key, label: `Week of ${fmtDateShort(weekly[i].key)}` })} />
        </ChartModule>
      </Register>
      <Register title="Drill down" subtitle="Format → location → day + time → trainer. Drag the chips to regroup." domain="attendance" id="drill-table">
        <NestedTable title="Classes" rows={rows} compareRows={scope.compare.sessions} table="sessions" groupKeys={['format', 'location', 'slot', 'trainer']} availableKeys={['format', 'location', 'slot', 'trainer', 'day', 'time', 'timeslot', 'daypart', 'weekpart', 'class_name', 'session', 'slot_uid', 'month', 'quarter', 'year', 'week', 'capacity_band', 'type', 'membership_type', 'is_new_label', 'visit_band', 'outcome']} columns={columns} ctx={scope.ctx} domain="attendance" defaultSort={{ id: 'sessions', dir: 'desc' }} filtersLabel={filtersLabel(scope)} rankBy="fill_rate" leafLabel="sessions" />
      </Register>
      <Register title="Rankings and the fill × yield map" domain="attendance" lazy>
        <Two a={<RankingList title="Classes by" nodes={classNodes} compareNodes={classPrev} metricOptions={['fill_rate', 'rev_pas', 'rev_pac', 'show_up_rate', 'revenue_per_session']} ctx={scope.ctx} table="sessions" domain="attendance" minSample={5} sampleLabel="sessions" />}
          b={<ChartModule title="Fill rate × revenue per attendee" subtitle="Bubble = sessions" table={{ columns: ['Class', 'Fill', 'Rev per attendee', 'Sessions'], rows: classNodes.map((n) => [n.label, n.values.fill_rate.value === null ? null : `${(n.values.fill_rate.value * 100).toFixed(1)}%`, Math.round(n.values.rev_pac.value ?? 0), n.values.sessions.value]) }}>
            <Scatter points={classNodes.filter((n) => n.values.fill_rate.value !== null && n.values.rev_pac.value !== null).map((n) => ({ id: n.id, label: n.label, x: n.values.fill_rate.value!, y: n.values.rev_pac.value!, size: n.values.sessions.value ?? 1, n: n.rows.length, color: formatColor(theme, n.rows[0]?.format) }))} xLabel="Fill rate" yLabel="Revenue per attendee" quadrants={['Empty but premium', 'Star', 'Cut', 'Full but cheap']} onClick={(p) => { const n = classNodes.find((x) => x.id === p.id)!; drill({ title: n.label, breadcrumb: ['Classes', n.label], table: 'sessions', rows: n.rows, peers: classNodes.map((x) => ({ label: x.label, rows: x.rows })), metricIds: ['fill_rate', 'rev_pac', 'sessions', 'revenue'], domain: 'attendance' }); }} />
          </ChartModule>} />
      </Register>
      <Register title="Day × time" subtitle="Where fill, revenue density and empties sit in the week" domain="attendance" lazy actions={<div style={{ display: 'flex', gap: 2 }}>{(['fill_rate', 'rev_pas', 'empty_sessions'] as const).map((l) => <button key={l} className="btn btn-xs" aria-pressed={layer === l} onClick={() => setLayer(l)}>{l === 'fill_rate' ? 'Fill' : l === 'rev_pas' ? 'Revenue per seat' : 'Empties'}</button>)}<span style={{ width: 8 }} /><button className="btn btn-xs" aria-pressed={loc === null} onClick={() => setLoc(null)}>All</button>{locs.map((l) => <button key={l} className="btn btn-xs" aria-pressed={loc === l} onClick={() => setLoc(l)}>{l.split(',')[0]}</button>)}</div>}>
        <DayTimeHeatmap rows={loc ? rows.filter((r) => r.location === loc) : rows} metricId={layer} scope={scope} />
      </Register>
      <Register title="Month on month" domain="attendance" lazy>
        <MoMTable rows={scope.all.sessions} metricIds={['sessions', 'attendance', 'fill_rate', 'avg_class_size_incl', 'empty_sessions', 'revenue', 'rev_pas', 'late_cancel_rate', 'no_show_rate']} months={months} ctx={scope.ctx} domain="attendance" />
      </Register>
      <Register title="Utilisation by room size, payment mix, hosted vs regular, overbooking" domain="attendance" collapsed lazy>
        <div style={{ display: 'grid', gap: 24 }}>
          <NestedTable title="Utilisation by room size" rows={rows} table="sessions" groupKeys={['capacity_band', 'format']} availableKeys={['capacity_band', 'format', 'location']} columns={columns.filter((c) => ['sessions', 'seats', 'attendance', 'fill_rate', 'empty_sessions', 'rev_pas'].includes(c.id))} ctx={scope.ctx} domain="attendance" filtersLabel={filtersLabel(scope)} maxHeight={320} />
          <NestedTable title="Payment mix by class" rows={rows} table="sessions" groupKeys={['class_name']} availableKeys={['class_name', 'format', 'location']} columns={[{ id: 'attendance', metricId: 'attendance', family: 'Volume' }, { id: 'membership_att_share', metricId: 'membership_att_share', family: 'Revenue', heat: true }, { id: 'package_att_share', metricId: 'package_att_share', family: 'Revenue' }, { id: 'intro_att_share', metricId: 'intro_att_share', family: 'Revenue' }, { id: 'single_att_share', metricId: 'single_att_share', family: 'Revenue' }, { id: 'non_paid_rate', metricId: 'non_paid_rate', family: 'Revenue', heat: true }, columns.find((c) => c.id === 'mix')!]} ctx={scope.ctx} domain="revenue" filtersLabel={filtersLabel(scope)} maxHeight={320} />
          <NestedTable title="Hosted vs regular" rows={rows} table="sessions" groupKeys={['type', 'class_name']} availableKeys={['type', 'class_name', 'location']} columns={columns.filter((c) => ['sessions', 'attendance', 'fill_rate', 'revenue', 'rev_pac', 'non_paid_rate'].includes(c.id))} ctx={scope.ctx} domain="attendance" filtersLabel={filtersLabel(scope)} maxHeight={280} />
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Overbooked sessions and waitlist pressure</div>
            {overbooked.length ? <div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Date</th><th className="t-heading-s">Time</th><th className="t-heading-s">Class</th><th className="t-heading-s">Trainer</th><th className="t-heading-s">Capacity</th><th className="t-heading-s">Booked</th><th className="t-heading-s">Over by</th></tr></thead><tbody>{overbooked.map((r: Row) => <tr key={r.session_id}><td className="t-body-s">{fmtDateShort(r.date)}</td><td className="t-num">{r.time}</td><td className="t-body-s">{r.class_name}</td><td className="t-body-s">{r.trainer}</td><td className="t-num">{r.capacity}</td><td className="t-num">{r.booked}</td><td className="t-num pos">+{r.booked - r.capacity}</td></tr>)}</tbody></table></div> : <div className="muted t-body-s">No session was booked beyond capacity in this scope.</div>}</div>
        </div>
      </Register>
      <WidgetSection tab="classes" scope={scope} placement="bottom" />
    </>
  );
}
