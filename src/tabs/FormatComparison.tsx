import { useMemo } from 'react';
import type { Scope } from '../state/data';
import type { VisitRow } from '../data/types';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { ChartModule, XYChart } from '../components/charts/core';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { metricValues, rollupLevel, type Row } from '../semantics/aggregations';
import { formatValue, fmtMonthShort } from '../semantics/formats';
import { KpiStrip, SectionEmpty, filtersLabel, useMonths } from './common';

const FORMATS = ['Barre', 'PowerCycle', 'Strength Lab'] as const;
/* Barre is the residual, not a keyword match. Classifying it by the word "barre" meant every
   visit whose class name said none of the three — a workshop, a hosted class, a renamed slot —
   was dropped, so this tab's visit total silently disagreed with Attendance and Bookings.
   The two specialised formats are identified; everything else is Barre, so the buckets are
   exhaustive and the totals reconcile. */
const bucket = (r: VisitRow): typeof FORMATS[number] => {
  const value = `${r.format ?? ''} ${r.class_name ?? ''}`.toLowerCase();
  /* Matches the reference implementation's `getClassFormat` exactly: PowerCycle and Strength Lab
     are the only two named formats, everything else is Barre. "cycle" and "power cycle" are
     accepted as spelling variants of the same format. */
  if (value.includes('powercycle') || value.includes('power cycle') || value.includes('cycle')) return 'PowerCycle';
  if (value.includes('strength lab')) return 'Strength Lab';
  return 'Barre';
};
const relabel = (rows: VisitRow[]) => rows.map((r) => ({ ...r, format: bucket(r) }));
const METRICS = ['visits', 'v_booked', 'v_show_up_rate', 'v_fill_rate', 'v_late_cancel_rate', 'v_no_show_rate', 'v_unique_members', 'v_repeat_rate', 'v_revenue', 'v_rev_per_visit'];

export function FormatComparison({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const rows = useMemo(() => relabel(scope.tables.visits), [scope.tables.visits]);
  const compareRows = useMemo(() => relabel(scope.compare.visits), [scope.compare.visits]);
  const allRows = useMemo(() => relabel(scope.all.visits), [scope.all.visits]);
  const nodes = useMemo(() => {
    const by = new Map(rollupLevel(rows as Row[], ['format'], 0, METRICS, scope.ctx).map((n) => [n.label, n]));
    return FORMATS.map((name) => by.get(name) ?? { id: name, key: name, keyId: name, label: name, level: 0, rows: [], path: [], values: metricValues([], METRICS, scope.ctx) });
  }, [rows, scope.ctx]);
  const monthly = useMemo(() => months.map((month) => ({ month, values: FORMATS.map((format) => metricValues(allRows.filter((r) => r.month === month && r.format === format), ['visits', 'v_fill_rate', 'v_revenue'], scope.ctx)) })), [months, allRows, scope.ctx]);
  const columns: ColumnDef[] = [
    { id: 'visits', metricId: 'visits', family: 'Volume', bar: true }, { id: 'v_unique_members', metricId: 'v_unique_members', family: 'Volume' },
    { id: 'v_fill_rate', metricId: 'v_fill_rate', family: 'Utilisation', heat: true }, { id: 'v_show_up_rate', metricId: 'v_show_up_rate', family: 'Utilisation', heat: true },
    { id: 'v_late_cancel_rate', metricId: 'v_late_cancel_rate', family: 'Behaviour' }, { id: 'v_no_show_rate', metricId: 'v_no_show_rate', family: 'Behaviour' },
    { id: 'v_repeat_rate', metricId: 'v_repeat_rate', family: 'Behaviour' }, { id: 'v_revenue', metricId: 'v_revenue', family: 'Revenue', bar: true }, { id: 'v_rev_per_visit', metricId: 'v_rev_per_visit', family: 'Revenue' },
  ];
  if (!rows.length) return <SectionEmpty what="visits" scope={scope} />;
  return <>
    <WidgetSection tab="format-comparison" scope={scope} placement="top" />
    <Register title="Format comparison" subtitle="Barre vs PowerCycle vs Strength Lab on the same globally filtered basis. PowerCycle and Strength Lab are matched by class name; every other visit is Barre, so the three add up to the same total Attendance and Bookings show." domain="growth">
      <KpiStrip scope={scope} table="visits" rows={rows} ids={['visits', 'v_unique_members', 'v_fill_rate', 'v_show_up_rate', 'v_late_cancel_rate', 'v_no_show_rate', 'v_repeat_rate', 'v_rev_per_visit']} />
      <div className="format-scorecards">{nodes.map((n) => <article className="format-scorecard" key={n.label}><span>{n.label}</span><strong>{formatValue('integer', n.values.visits.value)}</strong><small>visits</small><dl><div><dt>Fill</dt><dd>{formatValue('percent', n.values.v_fill_rate.value)}</dd></div><div><dt>Attendance</dt><dd>{formatValue('percent', n.values.v_show_up_rate.value)}</dd></div><div><dt>Revenue</dt><dd>{formatValue('currency', n.values.v_revenue.value)}</dd></div><div><dt>Per visit</dt><dd>{formatValue('currency', n.values.v_rev_per_visit.value)}</dd></div></dl></article>)}</div>
    </Register>
    <Register title="13-month demand comparison" subtitle="Visit volume by format through the current data month" domain="growth">
      <ChartModule title="Monthly visits" table={{ columns: ['Month', ...FORMATS], rows: monthly.map((m) => [m.month, ...m.values.map((v) => v.visits.value)]) }}>
        <XYChart categories={months.map(fmtMonthShort)} series={FORMATS.map((f, i) => ({ id: f, label: f, color: ['var(--hue-attendance)', 'var(--hue-revenue)', 'var(--hue-people)'][i], values: monthly.map((m) => m.values[i].visits.value) }))} fmtLeft="integer" height={260} />
      </ChartModule>
    </Register>
    <Register title="Comparable operating detail" subtitle="Start with format, then drill into location, class, trainer and time" domain="growth" id="format-comparison-table">
      <NestedTable title="Three-format comparison" rows={rows} compareRows={compareRows} table="visits" groupKeys={['format', 'location', 'class_name']} availableKeys={['format', 'location', 'class_name', 'trainer', 'timeslot', 'day', 'daypart', 'weekpart', 'membership_type', 'month', 'quarter']} columns={columns} ctx={scope.ctx} domain="growth" defaultSort={{ id: 'visits', dir: 'desc' }} filtersLabel={filtersLabel(scope)} rankBy="visits" leafLabel="visits" />
    </Register>
    <Register title="Month-on-month metrics" domain="growth" lazy><MoMTable rows={allRows} metricIds={METRICS} months={months} ctx={scope.ctx} domain="growth" /></Register>
    <WidgetSection tab="format-comparison" scope={scope} placement="bottom" />
  </>;
}
