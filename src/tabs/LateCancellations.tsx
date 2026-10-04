import { useMemo } from 'react';
import type { Scope } from '../state/data';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { ChartModule, XYChart } from '../components/charts/core';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { RankingList } from '../components/RankingList/RankingList';
import { rollupLevel, seriesBy } from '../semantics/aggregations';
import { fmtMonthShort } from '../semantics/formats';
import { KpiStrip, SectionEmpty, Two, filtersLabel, useMonths } from './common';

const IDS = ['v_late_cancels', 'v_late_cancel_rate', 'v_booked', 'v_show_up_rate', 'v_no_show_rate'];
export function LateCancellations({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const rows = scope.tables.visits;
  const lateRows = useMemo(() => rows.filter((r) => r.late_cancelled), [rows]);
  const trend = useMemo(() => seriesBy(scope.all.visits, (r) => r.month, ['v_late_cancels', 'v_late_cancel_rate'], scope.ctx, months), [scope.all.visits, scope.ctx, months]);
  const members = useMemo(() => rollupLevel(rows, ['member'], 0, ['v_late_cancels', 'v_late_cancel_rate'], scope.ctx), [rows, scope.ctx]);
  const trainers = useMemo(() => rollupLevel(rows, ['trainer'], 0, ['v_late_cancels', 'v_late_cancel_rate'], scope.ctx), [rows, scope.ctx]);
  const columns: ColumnDef[] = [
    { id: 'v_late_cancels', metricId: 'v_late_cancels', family: 'Volume', bar: true },
    { id: 'v_late_cancel_rate', metricId: 'v_late_cancel_rate', family: 'Behaviour', heat: true },
    { id: 'v_booked', metricId: 'v_booked', family: 'Volume' },
    { id: 'v_no_show_rate', metricId: 'v_no_show_rate', family: 'Behaviour' },
    { id: 'v_fill_rate', metricId: 'v_fill_rate', family: 'Utilisation' },
    { id: 'v_revenue', metricId: 'v_revenue', family: 'Revenue' },
  ];
  if (!rows.length) return <SectionEmpty what="booking outcomes" scope={scope} />;
  return <>
    <WidgetSection tab="late-cancellations" scope={scope} placement="top" />
    <Register title="Late cancellations" subtitle="Penalty-window cancellations, their rate, concentration and schedule impact" domain="risk">
      <KpiStrip scope={scope} table="visits" ids={IDS} />
    </Register>
    <Register title="13-month movement" subtitle="Counts and rates are shown together so volume changes are not mistaken for behaviour changes" domain="risk">
      <ChartModule title="Late cancellations and rate" table={{ columns: ['Month', 'Late cancellations', 'Rate'], rows: trend.map((s) => [s.key, s.values.v_late_cancels.value, s.values.v_late_cancel_rate.value]) }} records={() => ({ columns: ['Date', 'Member', 'Class', 'Trainer', 'Location'], rows: lateRows.map((r) => [r.date, r.name, r.class_name, r.trainer, r.location]) })}>
        <XYChart categories={months.map(fmtMonthShort)} series={[{ id: 'n', label: 'Late cancellations', color: 'var(--hue-risk)', kind: 'bar', values: trend.map((s) => s.values.v_late_cancels.value) }, { id: 'r', label: 'Late-cancel rate', color: 'var(--hue-revenue)', axis: 'right', fmt: 'percent', values: trend.map((s) => s.values.v_late_cancel_rate.value) }]} fmtLeft="integer" fmtRight="percent" height={250} />
      </ChartModule>
    </Register>
    <Register title="Where late cancellations concentrate" subtitle="Drill location → class → slot → trainer → member; all global filters remain active" domain="risk" id="late-cancel-table">
      <NestedTable title="Late-cancellation analysis" rows={rows} compareRows={scope.compare.visits} table="visits" groupKeys={['location', 'class_name', 'timeslot', 'trainer', 'member']} availableKeys={['location', 'class_name', 'format', 'timeslot', 'day', 'daypart', 'weekpart', 'trainer', 'member_name', 'membership_type', 'month', 'quarter']} columns={columns} ctx={scope.ctx} domain="risk" defaultSort={{ id: 'v_late_cancels', dir: 'desc' }} filtersLabel={filtersLabel(scope)} rankBy="v_late_cancels" leafLabel="bookings" />
    </Register>
    <Register title="Member and trainer concentration" domain="risk" lazy>
      <Two a={<RankingList title="Members by" nodes={members} metricOptions={['v_late_cancels', 'v_late_cancel_rate']} ctx={scope.ctx} table="visits" domain="risk" minSample={1} sampleLabel="bookings" />} b={<RankingList title="Trainers by" nodes={trainers} metricOptions={['v_late_cancels', 'v_late_cancel_rate']} ctx={scope.ctx} table="visits" domain="risk" minSample={3} sampleLabel="bookings" />} />
    </Register>
    <Register title="Month on month" domain="risk" lazy><MoMTable rows={scope.all.visits} metricIds={IDS} months={months} ctx={scope.ctx} domain="risk" /></Register>
    <WidgetSection tab="late-cancellations" scope={scope} placement="bottom" />
  </>;
}
