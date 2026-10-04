import { useMemo, type ReactNode } from 'react';
import type { Scope } from '../state/data';
import { historyMonths, metricValues, seriesBy, type Row } from '../semantics/aggregations';
import { metric, type TableName } from '../semantics/metrics';
import { MetricCard } from '../components/MetricCard/MetricCard';
import { Heatmap, type HeatCell } from '../components/charts/grids';
import type { HeatKind } from '../design/ramps';
import { ChartModule } from '../components/charts/core';
import { useFilters } from '../state/filters';
import { useView } from '../state/view';
import { fmtMonthShort, fmtTime12 } from '../semantics/formats';
import { EmptyState } from '../components/Register';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** Include the current month and thirteen completed months, including the prior-year comparison month. */
export const useMonths = (scope: Scope, n = 14) => useMemo(() => historyMonths(scope.today.slice(0, 7), n), [scope.today, n]);
export const filtersLabel = (scope: Scope) => { const f = scope.filters; return [scope.period.label, f.locations.length ? f.locations.join('/') : 'all locations', f.trainers.length ? `${f.trainers.length} trainers` : 'all trainers', ...f.transient.map((t) => `${t.dim}=${t.value}`)].join(' · '); };

export function useKpis(scope: Scope, table: TableName, ids: string[], override?: { cur: Row[]; prev?: Row[]; all?: Row[] }) {
  const months = useMonths(scope);
  return useMemo(() => {
    const cur = metricValues(override?.cur ?? scope.tables[table], ids, scope.ctx);
    const prev = scope.filters.compare === 'none' ? null : metricValues(override?.prev ?? scope.compare[table], ids, scope.ctx);
    const series = seriesBy(override?.all ?? scope.all[table], (r) => r.month, ids, scope.ctx, months);
    const spark: Record<string, (number | null)[]> = {}; for (const id of ids) spark[id] = series.map((s) => s.values[id].value);
    return { cur, prev, spark };
  }, [scope, table, ids, months, override]);
}

export function KpiStrip({ scope, table, ids, variant = 'standard', cols, rows, compareRows, allRows }: { scope: Scope; table: TableName; ids: string[]; variant?: 'hero' | 'standard'; cols?: number; rows?: Row[]; compareRows?: Row[]; allRows?: Row[] }) {
  const override = useMemo(() => (rows ? { cur: rows, prev: compareRows, all: allRows } : undefined), [rows, compareRows, allRows]);
  const k = useKpis(scope, table, ids, override);
  const comparison = useView((s) => s.comparison);
  return (
    <div className="kpi-strip" style={{ ['--kpi-cols' as string]: cols ?? Math.min(8, ids.length) }}>
      {ids.map((id, i) => {
        const def = metric(id); const r = k.cur[id];
        const alert = def.target !== undefined && r.value !== null && ((def.higherIsBetter && r.value < def.target * 0.8) || (!def.higherIsBetter && r.value > def.target * 1.25));
        return <MetricCard key={id} metricId={id} value={r.value} prev={k.prev?.[id].value ?? null} spark={k.spark[id]} n={r.n} coverage={r.coverage} contributing={r.contributing} suspect={r.suspect} variant={variant} index={i} comparison={comparison} prevLabel={scope.period.prevLabel} alert={alert}
          benchmark={def.target !== undefined ? { label: 'target', value: def.target } : undefined}
          onClick={() => { document.getElementById('drill-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); useView.getState().announce(`Scrolled to the table for ${def.label}`); }} />;
      })}
    </div>
  );
}

/** KPI strip mixing metrics from several tables (Overview hero). */
export function MixedKpiStrip({ scope, items, variant = 'hero' }: { scope: Scope; items: { table: TableName; id: string }[]; variant?: 'hero' | 'standard' }) {
  const months = useMonths(scope);
  const comparison = useView((s) => s.comparison);
  const data = useMemo(() => items.map(({ table, id }) => {
    const cur = metricValues(scope.tables[table], [id], scope.ctx)[id];
    const prev = scope.filters.compare === 'none' ? null : metricValues(scope.compare[table], [id], scope.ctx)[id].value;
    const spark = seriesBy(scope.all[table], (r) => r.month, [id], scope.ctx, months).map((s) => s.values[id].value);
    return { id, cur, prev, spark };
  }), [scope, items, months]);
  return (
    <div className="kpi-strip" style={{ ['--kpi-cols' as string]: items.length }}>
      {data.map((d, i) => <MetricCard key={d.id} metricId={d.id} value={d.cur.value} prev={d.prev} spark={d.spark} n={d.cur.n} coverage={d.cur.coverage} contributing={d.cur.contributing} suspect={d.cur.suspect} variant={variant} index={i} comparison={comparison} prevLabel={scope.period.prevLabel} benchmark={metric(d.id).target !== undefined ? { label: 'target', value: metric(d.id).target! } : undefined} />)}
    </div>
  );
}

/** Day × hour heatmap for any table carrying day + time. */
export function DayTimeHeatmap({ rows, metricId, scope, minN = 3, kind }: { rows: Row[]; metricId: string; scope: Scope; minN?: number; kind?: HeatKind | 'diverging' }) {
  const addTransient = useFilters((s) => s.addTransient);
  const def = metric(metricId);
  const { xs, cells } = useMemo(() => {
    const m = new Map<string, Row[]>(); const hours = new Set<string>();
    for (const r of rows) { if (!r.day || !r.time) continue; const h = r.time.slice(0, 2) + ':00'; hours.add(h); const k = `${h}|${r.day}`; let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(r); }
    const cells: HeatCell[] = []; for (const [k, rs] of m) { const [x, y] = k.split('|'); cells.push({ x, y, value: metricValues(rs, [metricId], scope.ctx)[metricId].value, n: rs.length }); }
    return { xs: [...hours].sort(), cells };
  }, [rows, metricId, scope.ctx]);
  if (!cells.length) return <EmptyState title="No sessions carry a day and time in this scope" body="Widen the period or clear day and slot filters." />;
  const table = { columns: ['Day', ...xs.map((x) => fmtTime12(x))], rows: DAYS.map((d) => [d, ...xs.map((x) => { const c = cells.find((k) => k.x === x && k.y === d); return c?.value ?? null; })]) };
  return <ChartModule title={`${def.label} by day and hour`} subtitle="Click a cell to filter the tab to that exact day and hour. Tables that do not carry a time of day are unaffected — the filter chip says which." table={table}><Heatmap xs={xs} ys={DAYS} cells={cells} fmt={def.format} kind={kind ?? (def.domain === 'risk' ? 'diverging' : (def.domain as HeatKind))} minN={minN} xLabel={(x) => fmtTime12(x)} yLabel={(y) => y.slice(0, 3)} title={`${def.label} by day and hour`}
    onClick={(c) => { addTransient({ dim: 'day', value: c.y }); addTransient({ dim: 'hour_of_day', value: c.x, label: fmtTime12(c.x) }); }} /></ChartModule>;
}

/** Cohort triangle: cohort month × months since, value = share of cohort still meeting `alive` at that offset. */
export function CohortTriangle({ rows, cohortOf, alive, scope, months = 14, valueLabel = 'retained' }: { rows: Row[]; cohortOf: (r: Row) => string | null; alive: (r: Row, offset: number) => boolean; scope: Scope; months?: number; valueLabel?: string }) {
  const ms = useMonths(scope, months);
  const cells = useMemo(() => {
    const out: HeatCell[] = [];
    for (const c of ms) { const cohort = rows.filter((r) => cohortOf(r) === c); if (!cohort.length) continue; const idx = ms.indexOf(c); for (let o = 0; o < ms.length - idx; o++) { const surv = cohort.filter((r) => alive(r, o)).length; out.push({ x: `M+${o}`, y: c, value: surv / cohort.length, n: cohort.length, extra: `${surv} ${valueLabel}` }); } }
    return out;
  }, [rows, ms, cohortOf, alive, valueLabel]);
  const xs = Array.from({ length: months }, (_, i) => `M+${i}`);
  const table = { columns: ['Cohort', ...xs], rows: ms.map((m) => [fmtMonthShort(m), ...xs.map((x) => { const c = cells.find((k) => k.x === x && k.y === m); return c ? Number((c.value ?? 0).toFixed(3)) : null; })]) };
  return <ChartModule title="Cohort survival" subtitle="Each row is an entry month; each column is months elapsed since" table={table}>
    <Heatmap xs={xs} ys={ms} cells={cells} fmt="percent" yLabel={fmtMonthShort} title="Cohort survival" cellH={24} />
  </ChartModule>;
}

export function Two({ a, b }: { a: ReactNode; b: ReactNode }) { return <div className="two-up"><div>{a}</div><div>{b}</div></div>; }

export function SectionEmpty({ what, scope }: { what: string; scope: Scope }) {
  const set = useFilters((s) => s.set);
  return <EmptyState title={`No ${what} matched these filters`} body={`Scope: ${filtersLabel(scope)}.`} actions={<><button className="btn btn-xs" onClick={() => set({ preset: '90d' })}>Extend to 90 days</button><button className="btn btn-xs" onClick={() => set({ locations: [], trainers: [], formats: [] })}>Include all locations</button><button className="btn btn-xs" onClick={() => set({ preset: 'all' })}>All time</button></>} />;
}

export function SheetMissing({ title, load }: { title: string; load?: { error?: string; hint?: string; status: string } }) {
  return <EmptyState title={`${title} didn't load`} body={`${load?.error ?? 'The sheet returned no rows.'} ${load?.hint ?? ''}`} actions={<button className="btn btn-xs" onClick={() => useView.getState().setTab('health')}>Check source in Data health</button>} />;
}
