import { useMemo } from 'react';
import type { Scope } from '../../state/data';
import { metric } from '../../semantics/metrics';
import { GROUP_KEYS, lastNMonths, metricValues, rollupLevel, seriesBy } from '../../semantics/aggregations';
import { fmtMonthShort, formatValue } from '../../semantics/formats';
import { MetricCard } from '../MetricCard/MetricCard';
import { ChartModule, HBars, XYChart } from '../charts/core';
import { Heatmap } from '../charts/grids';
import { categorical } from '../../design/ramps';
import { useView } from '../../state/view';
import { scopeLine } from '../../api/export';
import { moveWidget, removeWidget, type WidgetSpec } from '../../api/widgets';

/** Renders one saved widget against the live scope. Nothing here is a snapshot. */
export function CustomWidget({ spec, scope, onEdit }: { spec: WidgetSpec; scope: Scope; onEdit: (s: WidgetSpec) => void }) {
  const theme = useView((s) => s.theme);
  const comparison = useView((s) => s.comparison);
  const def = metric(spec.metrics[0]);
  const table = def.table;
  const rows = scope.tables[table] ?? [];
  const cmpRows = scope.compare[table] ?? [];
  const months = useMemo(() => lastNMonths(scope.today.slice(0, 7), 13), [scope.today]);

  const nodes = useMemo(() => {
    if (!spec.groupBy || !GROUP_KEYS[spec.groupBy]) return [];
    const all = rollupLevel(rows, [spec.groupBy], 0, spec.metrics, scope.ctx);
    const sortId = spec.sortBy && spec.metrics.includes(spec.sortBy) ? spec.sortBy : spec.metrics[0];
    const dir = spec.sortDir === 'asc' ? 1 : -1;
    return all
      .filter((n) => n.values[sortId]?.value !== null)
      .sort((a, b) => ((a.values[sortId]?.value ?? 0) - (b.values[sortId]?.value ?? 0)) * dir)
      .slice(0, spec.limit ?? 12);
  }, [rows, spec, scope.ctx]);

  const trend = useMemo(() => {
    if (spec.kind !== 'trend') return null;
    const s = seriesBy(scope.all[table] ?? [], (r) => r.month, spec.metrics, scope.ctx, months);
    return { categories: s.map((x) => fmtMonthShort(x.key)), series: spec.metrics.map((id, i) => ({
      id, label: metric(id).label, color: categorical(theme, i), fmt: metric(id).format,
      kind: (i === 0 ? 'area' : 'line') as 'area' | 'line',
      values: s.map((x) => x.values[id].value),
    })) };
  }, [spec, scope, table, months, theme]);

  const heat = useMemo(() => {
    if (spec.kind !== 'heatmap' || !spec.groupBy || !spec.groupBy2) return null;
    const x = GROUP_KEYS[spec.groupBy]; const y = GROUP_KEYS[spec.groupBy2];
    if (!x || !y) return null;
    const buckets = new Map<string, typeof rows>();
    for (const r of rows) {
      const xa = x.accessor(r); const ya = y.accessor(r);
      if (!xa || !ya) continue;
      const k = `${xa}|||${ya}`;
      let a = buckets.get(k); if (!a) { a = []; buckets.set(k, a); } a.push(r);
    }
    const cells = [...buckets.entries()].map(([k, rs]) => {
      const [xa, ya] = k.split('|||');
      return { x: xa, y: ya, value: metricValues(rs, [spec.metrics[0]], scope.ctx)[spec.metrics[0]].value, n: rs.length };
    });
    const uniq = (f: (c: typeof cells[number]) => string, sort?: (a: string, b: string) => number) => {
      const s = [...new Set(cells.map(f))];
      return sort ? s.sort(sort) : s.sort();
    };
    return { cells, xs: uniq((c) => c.x, x.sort), ys: uniq((c) => c.y, y.sort) };
  }, [spec, rows, scope.ctx]);

  const exportTable = useMemo(() => {
    if (spec.kind === 'metric') {
      return { columns: ['Metric', 'Value'], rows: spec.metrics.map((id) => [metric(id).label, metricValues(rows, [id], scope.ctx)[id].value]) };
    }
    if (spec.kind === 'trend' && trend) {
      return { columns: ['Month', ...trend.series.map((s) => s.label)], rows: trend.categories.map((c, i) => [c, ...trend.series.map((s) => s.values[i])]) };
    }
    if (spec.kind === 'heatmap' && heat) {
      return { columns: [GROUP_KEYS[spec.groupBy2!].label, ...heat.xs], rows: heat.ys.map((y) => [y, ...heat.xs.map((x) => heat.cells.find((c) => c.x === x && c.y === y)?.value ?? null)]) };
    }
    return { columns: [GROUP_KEYS[spec.groupBy ?? 'location']?.label ?? 'Group', ...spec.metrics.map((id) => metric(id).label), 'Rows'],
      rows: nodes.map((n) => [n.label, ...spec.metrics.map((id) => n.values[id]?.value ?? null), n.rows.length]) };
  }, [spec, nodes, trend, heat, rows, scope.ctx]);

  const actions = (
    <div className="widget-actions">
      <span className="widget-tag t-label-s">{spec.source === 'agent' ? 'Agent' : spec.source === 'ask' ? 'From Ask' : 'Custom'}</span>
      <button className="btn-ghost btn-xs" title="Move earlier" onClick={() => moveWidget(spec.id, -1)}>↑</button>
      <button className="btn-ghost btn-xs" title="Move later" onClick={() => moveWidget(spec.id, 1)}>↓</button>
      <button className="btn-ghost btn-xs" title="Edit" onClick={() => onEdit(spec)}>✎</button>
      <button className="btn-ghost btn-xs" title="Remove" onClick={() => removeWidget(spec.id)}>×</button>
    </div>
  );

  let body: React.ReactNode = null;
  if (spec.kind === 'metric') {
    body = (
      <div className="kpi-strip" style={{ ['--kpi-cols' as string]: Math.min(6, spec.metrics.length) }}>
        {spec.metrics.map((id, i) => {
          const r = metricValues(rows, [id], scope.ctx)[id];
          const p = metricValues(cmpRows, [id], scope.ctx)[id];
          const spark = seriesBy(scope.all[metric(id).table] ?? [], (x) => x.month, [id], scope.ctx, months).map((s) => s.values[id].value);
          return <MetricCard key={id} metricId={id} value={r.value} prev={p.value} spark={spark} n={r.n}
            coverage={r.coverage} contributing={r.contributing} suspect={r.suspect} index={i}
            comparison={comparison} prevLabel={scope.period.prevLabel} />;
        })}
      </div>
    );
  } else if (spec.kind === 'trend' && trend) {
    body = <XYChart categories={trend.categories} series={trend.series} height={240} fmtLeft={def.format} />;
  } else if (spec.kind === 'heatmap' && heat) {
    body = <Heatmap xs={heat.xs} ys={heat.ys} cells={heat.cells} fmt={def.format}
      kind={def.domain === 'revenue' ? 'revenue' : def.domain === 'risk' ? 'diverging' : 'attendance'} minN={1} />;
  } else if (!nodes.length) {
    body = <div className="t-body-s muted" style={{ padding: 16 }}>Nothing in the current scope has a value for {def.label}. Widen the period or clear a filter.</div>;
  } else if (spec.kind === 'table') {
    body = (
      <div className="table-scroll" style={{ maxHeight: 420 }}>
        <table className="tbl">
          <thead><tr><th className="t-heading-s">{GROUP_KEYS[spec.groupBy!].label}</th>
            {spec.metrics.map((id) => <th key={id} className="t-heading-s">{metric(id).label}</th>)}
            <th className="t-heading-s">Rows</th></tr></thead>
          <tbody>{nodes.map((n) => (
            <tr key={n.id}>
              <td className="t-body-s">{n.label}</td>
              {spec.metrics.map((id) => <td key={id} className="t-num">{formatValue(metric(id).format, n.values[id]?.value ?? null)}</td>)}
              <td className="t-num faint">{n.rows.length.toLocaleString('en-IN')}</td>
            </tr>))}</tbody>
        </table>
      </div>
    );
  } else if (spec.kind === 'bar' || spec.kind === 'ranking') {
    const items = nodes.map((n) => ({ label: n.label, value: n.values[spec.metrics[0]]?.value ?? null, sub: `${n.rows.length}` }));
    body = spec.kind === 'bar'
      ? <HBars items={items} fmt={def.format} />
      : (
        <div className="two-up">
          <div><div className="t-heading-xs muted" style={{ marginBottom: 6 }}>Strongest</div>
            <HBars items={items.slice(0, Math.ceil(items.length / 2))} fmt={def.format} /></div>
          <div><div className="t-heading-xs muted" style={{ marginBottom: 6 }}>Weakest</div>
            <HBars items={[...items].reverse().slice(0, Math.floor(items.length / 2))} fmt={def.format} color="var(--neg)" /></div>
        </div>
      );
  } else {
    const kind = spec.kind === 'column' ? 'bar' : spec.kind === 'area' ? 'area' : 'line';
    body = <XYChart categories={nodes.map((n) => n.label)} height={260} fmtLeft={def.format}
      series={spec.metrics.map((id, i) => ({ id, label: metric(id).label, color: categorical(theme, i),
        kind: (i === 0 ? kind : 'line') as 'bar' | 'line' | 'area', fmt: metric(id).format,
        values: nodes.map((n) => n.values[id]?.value ?? null) }))} />;
  }

  return (
    <div className={`widget ${spec.width === 'half' ? 'widget-half' : ''}`} data-domain={def.domain}>
      <ChartModule title={spec.title} subtitle={spec.note ?? subtitleFor(spec)} table={exportTable}
        actions={actions} scopeLine={scopeLine(scope)}>
        {body}
      </ChartModule>
    </div>
  );
}

function subtitleFor(spec: WidgetSpec): string {
  const def = metric(spec.metrics[0]);
  const bits = [def.description];
  if (spec.groupBy) bits.push(`Grouped by ${GROUP_KEYS[spec.groupBy].label.toLowerCase()}${spec.groupBy2 ? ` × ${GROUP_KEYS[spec.groupBy2].label.toLowerCase()}` : ''}.`);
  bits.push('Recomputed live from the current filters.');
  return bits.join(' ');
}
