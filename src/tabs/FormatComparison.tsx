import { Fragment, useMemo, useState } from 'react';
import type { Scope } from '../state/data';
import type { VisitRow } from '../data/types';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { ChartModule, XYChart } from '../components/charts/core';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { metricValues, rollupLevel, type Row } from '../semantics/aggregations';
import { formatValue, fmtMonthShort, fmtDelta } from '../semantics/formats';
import { metric } from '../semantics/metrics';
import { RankingList } from '../components/RankingList/RankingList';
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
/* Every visit-grain metric the registry carries, grouped the way an operator reads them:
   how much ran, how full it was, how reliably people turned up, and what it earned. The tab
   used to compare ten of these; the rest were computable all along and simply not shown. */
const METRIC_FAMILIES: { family: string; ids: string[] }[] = [
  { family: 'Scale', ids: ['v_sessions', 'visits', 'v_booked', 'v_unique_members', 'v_attendee_hours'] },
  { family: 'Utilisation', ids: ['v_fill_rate', 'v_attendance_per_session', 'v_show_up_rate', 'v_effective_attendance'] },
  { family: 'Reliability', ids: ['v_cancel_rate', 'v_late_cancel_rate', 'v_no_show_rate', 'v_lead_time', 'v_same_day_share'] },
  { family: 'Members', ids: ['v_visits_per_member', 'v_repeat_rate', 'v_power_users', 'v_new_share', 'v_complimentary_rate'] },
  { family: 'Revenue', ids: ['v_revenue', 'v_rev_per_visit', 'v_rev_per_member'] },
];
const METRICS = METRIC_FAMILIES.flatMap((f) => f.ids);
/* A metric only earns a row in the matrix if at least one format can actually compute it —
   a registry-wide list would otherwise fill the table with dashes. */


/** Every metric against every format, with the prior period beneath and the leader marked.
 *  A grid is the only honest way to compare three formats on twenty metrics — three separate
 *  tables would make the reader hold two columns in their head to do a subtraction. */
function FormatMatrix({ rows, compareRows, ctx, prevLabel }: { rows: Row[]; compareRows: Row[]; ctx: Scope['ctx']; prevLabel: string }) {
  const [showPrev, setShowPrev] = useState(true);
  const data = useMemo(() => {
    const cur = new Map(rollupLevel(rows, ['format'], 0, METRICS, ctx).map((n) => [n.label, n]));
    const prev = new Map(rollupLevel(compareRows, ['format'], 0, METRICS, ctx).map((n) => [n.label, n]));
    return METRIC_FAMILIES.map((fam) => ({
      family: fam.family,
      metrics: fam.ids.map((id) => {
        const def = metric(id);
        const cells = FORMATS.map((f) => ({
          format: f,
          value: cur.get(f)?.values[id]?.value ?? null,
          previous: prev.get(f)?.values[id]?.value ?? null,
        }));
        const usable = cells.filter((c) => c.value !== null).map((c) => c.value as number);
        // "Best" is only meaningful where the metric declares a direction and formats differ.
        const best = usable.length > 1
          ? (def.higherIsBetter ? Math.max(...usable) : Math.min(...usable))
          : null;
        return { id, def, cells, best, measurable: usable.length > 0 };
      }).filter((m) => m.measurable),
    })).filter((fam) => fam.metrics.length > 0);
  }, [rows, compareRows, ctx]);

  return (
    <div>
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <div className="t-label-s muted">The leader on each metric is marked. Direction comes from the registry, so a lower late-cancel rate counts as better.</div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-xs" aria-pressed={showPrev} onClick={() => setShowPrev((v) => !v)}>{showPrev ? 'Hide' : 'Show'} {prevLabel}</button>
      </div>
      <div className="table-scroll">
        <table className="tbl format-matrix">
          <thead>
            <tr><th className="t-heading-s">Metric</th>{FORMATS.map((f) => <th key={f} className="t-heading-s t-num">{f}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((fam) => (
              <Fragment key={fam.family}>
                <tr className="format-matrix-family"><td colSpan={FORMATS.length + 1} className="t-label-s">{fam.family}</td></tr>
                {fam.metrics.map((m) => (
                  <tr key={m.id}>
                    <td className="t-body-s" title={m.def.description}>{m.def.label}</td>
                    {m.cells.map((c) => {
                      const d = fmtDelta(m.def.format, c.value, c.previous);
                      const good = d.value === null ? null : (d.value >= 0) === m.def.higherIsBetter;
                      return (
                        <td key={c.format} className={`t-num ${m.best !== null && c.value === m.best ? 'is-best' : ''}`}>
                          <span>{formatValue(m.def.format, c.value)}</span>
                          {showPrev && d.value !== null && <small className={good ? 'pos' : 'neg'}>{d.text}</small>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FormatComparison({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const rows = useMemo(() => relabel(scope.tables.visits), [scope.tables.visits]);
  const compareRows = useMemo(() => relabel(scope.compare.visits), [scope.compare.visits]);
  const allRows = useMemo(() => relabel(scope.all.visits), [scope.all.visits]);
  const nodes = useMemo(() => {
    const by = new Map(rollupLevel(rows as Row[], ['format'], 0, METRICS, scope.ctx).map((n) => [n.label, n]));
    return FORMATS.map((name) => by.get(name) ?? { id: name, key: name, keyId: name, label: name, level: 0, rows: [], path: [], values: metricValues([], METRICS, scope.ctx) });
  }, [rows, scope.ctx]);
  const monthly = useMemo(() => months.map((month) => ({ month, values: FORMATS.map((format) => metricValues(allRows.filter((r) => r.month === month && r.format === format), ['visits', 'v_fill_rate', 'v_revenue', 'v_rev_per_visit'], scope.ctx)) })), [months, allRows, scope.ctx]);
  const columns: ColumnDef[] = [
    { id: 'visits', metricId: 'visits', family: 'Volume', bar: true }, { id: 'v_unique_members', metricId: 'v_unique_members', family: 'Volume' },
    { id: 'v_fill_rate', metricId: 'v_fill_rate', family: 'Utilisation', heat: true }, { id: 'v_show_up_rate', metricId: 'v_show_up_rate', family: 'Utilisation', heat: true },
    { id: 'v_late_cancel_rate', metricId: 'v_late_cancel_rate', family: 'Behaviour' }, { id: 'v_no_show_rate', metricId: 'v_no_show_rate', family: 'Behaviour' },
    { id: 'v_repeat_rate', metricId: 'v_repeat_rate', family: 'Behaviour' }, { id: 'v_revenue', metricId: 'v_revenue', family: 'Revenue', bar: true }, { id: 'v_rev_per_visit', metricId: 'v_rev_per_visit', family: 'Revenue' },
  ];
  if (!rows.length) return <SectionEmpty what="visits" scope={scope} />;
  return <>
    <WidgetSection tab="format-comparison" scope={scope} placement="top" />
    <Register title="Format comparison" subtitle="Compare demand, booking reliability, and revenue per visit across Barre, PowerCycle, and Strength Lab." domain="growth">
      <KpiStrip scope={scope} table="visits" rows={rows} ids={['visits', 'v_unique_members', 'v_fill_rate', 'v_show_up_rate', 'v_late_cancel_rate', 'v_no_show_rate', 'v_repeat_rate', 'v_rev_per_visit']} />
      <div className="format-scorecards">{nodes.map((n) => <article className="format-scorecard" key={n.label}><span>{n.label}</span><strong>{formatValue('integer', n.values.visits.value)}</strong><small>visits</small><dl><div><dt>Fill</dt><dd>{formatValue('percent', n.values.v_fill_rate.value)}</dd></div><div><dt>Attendance</dt><dd>{formatValue('percent', n.values.v_show_up_rate.value)}</dd></div><div><dt>Revenue</dt><dd>{formatValue('currency', n.values.v_revenue.value)}</dd></div><div><dt>Per visit</dt><dd>{formatValue('currency', n.values.v_rev_per_visit.value)}</dd></div></dl></article>)}</div>
    </Register>
    <Register title="14-month demand comparison" subtitle="Visit volume by format through the current data month" domain="growth">
      <ChartModule title="Monthly visits" table={{ columns: ['Month', ...FORMATS], rows: monthly.map((m) => [m.month, ...m.values.map((v) => v.visits.value)]) }}>
        <XYChart categories={months.map(fmtMonthShort)} series={FORMATS.map((f, i) => ({ id: f, label: f, color: ['var(--hue-attendance)', 'var(--hue-revenue)', 'var(--hue-people)'][i], values: monthly.map((m) => m.values[i].visits.value) }))} fmtLeft="integer" height={260} />
      </ChartModule>
    </Register>
    <Register title="Fill rate and revenue per visit over time" subtitle="Volume alone hides a format that is growing by running more classes at lower fill" domain="growth" lazy>
      <div className="two-up">
        <ChartModule title="Fill rate by format" table={{ columns: ['Month', ...FORMATS], rows: monthly.map((m) => [m.month, ...m.values.map((v) => v.v_fill_rate.value)]) }}>
          <XYChart categories={months.map(fmtMonthShort)} series={FORMATS.map((f, i) => ({ id: f, label: f, color: ['var(--hue-attendance)', 'var(--hue-revenue)', 'var(--hue-people)'][i], values: monthly.map((m) => m.values[i].v_fill_rate.value) }))} fmtLeft="percent" height={240} />
        </ChartModule>
        <ChartModule title="Revenue per visit by format" table={{ columns: ['Month', ...FORMATS], rows: monthly.map((m) => [m.month, ...m.values.map((v) => v.v_rev_per_visit.value)]) }}>
          <XYChart categories={months.map(fmtMonthShort)} series={FORMATS.map((f, i) => ({ id: f, label: f, color: ['var(--hue-attendance)', 'var(--hue-revenue)', 'var(--hue-people)'][i], values: monthly.map((m) => m.values[i].v_rev_per_visit.value) }))} fmtLeft="currency" height={240} />
        </ChartModule>
      </div>
    </Register>
    <Register title="Comparable operating detail" subtitle="Start with format, then drill into location, class, trainer and time" domain="growth" id="format-comparison-table">
      <NestedTable title="Three-format comparison" rows={rows} compareRows={compareRows} table="visits" groupKeys={['format', 'location', 'class_name']} availableKeys={['format', 'location', 'class_name', 'trainer', 'timeslot', 'day', 'daypart', 'weekpart', 'membership_type', 'month', 'quarter']} columns={columns} ctx={scope.ctx} domain="growth" defaultSort={{ id: 'visits', dir: 'desc' }} filtersLabel={filtersLabel(scope)} rankBy="visits" leafLabel="visits" />
    </Register>
    <Register title="Side-by-side scorecard" subtitle="Every visit-grain metric, all three formats, with the change against the prior period" domain="growth" id="format-matrix">
      <FormatMatrix rows={rows as Row[]} compareRows={compareRows as Row[]} ctx={scope.ctx} prevLabel={scope.period.prevLabel} />
    </Register>
    <Register title="Where each format earns and loses" subtitle="Top classes, trainers and time slots within each format, ranked independently" domain="growth" lazy>
      <div className="format-columns">
        {FORMATS.map((f) => {
          const fRows = (rows as Row[]).filter((r) => r.format === f);
          return (
            <section key={f} className="format-column">
              <header className="format-column-head"><b className="t-heading-s">{f}</b><span className="t-label-s faint">{fRows.length.toLocaleString('en-IN')} visits</span></header>
              {fRows.length
                ? (['class_name', 'trainer', 'timeslot'] as const).map((dim) => (
                    <RankingList key={dim} title={`${f} by`} nodes={rollupLevel(fRows, [dim], 0, ['visits', 'v_fill_rate', 'v_rev_per_visit', 'v_no_show_rate'], scope.ctx)}
                      metricOptions={['visits', 'v_fill_rate', 'v_rev_per_visit', 'v_no_show_rate']} ctx={scope.ctx} table="visits" domain="growth" minSample={3} sampleLabel="visits" />
                  ))
                : <div className="t-body-s muted">No visits in this scope.</div>}
            </section>
          );
        })}
      </div>
    </Register>
    <Register title="Month on month, per format" subtitle="Each format's own 14-month table — read them against one another rather than against a blended total" domain="growth" lazy>
      <div className="format-mom-stack">
        {FORMATS.map((f) => {
          const fAll = (allRows as Row[]).filter((r) => r.format === f);
          return (
            <div key={f} className="format-mom">
              <div className="t-heading-m" style={{ marginBottom: 6 }}>{f}</div>
              {fAll.length
                ? <MoMTable rows={fAll} metricIds={METRICS} months={months} ctx={scope.ctx} domain="growth" title={`${f} month on month`} />
                : <div className="t-body-s muted">No visits in this scope.</div>}
            </div>
          );
        })}
      </div>
    </Register>
    <Register title="Month on month, all formats blended" domain="growth" collapsed lazy>
      <MoMTable rows={allRows} metricIds={METRICS} months={months} ctx={scope.ctx} domain="growth" />
    </Register>
    <WidgetSection tab="format-comparison" scope={scope} placement="bottom" />
  </>;
}
