import fs from 'node:fs';
const { METRIC_LIST } = await import('../src/semantics/metrics.ts');
const byDomain: Record<string, typeof METRIC_LIST> = {};
for (const m of METRIC_LIST) (byDomain[m.domain] ??= []).push(m);
let md = `# METRICS — implemented registry\n\nGenerated from \`src/semantics/metrics.ts\` (${METRIC_LIST.length} definitions). Every card, table column, chart and insight imports from this file; nothing is computed inline in a component.\n\nRules enforced by the engine:\n\n- **Rates never average.** \`aggregation: weighted\` recomputes SUM(numerator)/SUM(denominator) at every rollup level and in totals rows.\n- **Null ≠ zero.** Sums over all-null inputs return null and render as —.\n- **Min sample.** Below \`minSample\` a value renders dimmed with an n= marker; ranking lists exclude it and footnote the exclusion.\n- **Deltas.** Percentage-point for \`percent\` metrics, relative % for everything else.\n- **Suspect inputs.** Metrics with a \`suspect\` hook render ⚠ while the Data-health check fails (currently every duration-derived metric, because \`Checkins.Duration (Minutes)\` is corrupted).\n\n`;
for (const [d, ms] of Object.entries(byDomain)) {
  md += `## ${d[0].toUpperCase() + d.slice(1)}\n\n| id | Label | Table | Aggregation | Format | Better | Min n | Formula | Sources |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const m of ms) md += `| \`${m.id}\` | ${m.label} | ${m.table} | ${m.aggregation} | ${m.format} | ${m.higherIsBetter ? '↑' : '↓'}${m.target !== undefined ? ` (target ${m.format === 'percent' ? (m.target * 100).toFixed(0) + '%' : m.target})` : ''} | ${m.minSample} | \`${m.formula.replace(/\|/g, '\\|')}\` | ${m.sources.join(', ')} |\n`;
  md += '\n';
}
md += `## Adding a metric\n\nAppend one \`MetricDef\` to \`defs\` in \`src/semantics/metrics.ts\`. Declare \`table\`, \`formula\` (documentation), \`aggregation\` and the accessor(s):\n\n- \`sum\` / \`avg\` / \`median\`: \`num(r)\`\n- \`count\`: \`num(r)\` returning a boolean\n- \`weighted\`: \`num(r)\` and \`den(r)\` — the only legal way to define a rate\n- \`distinct\`: \`distinctKey(r)\`\n- \`custom\`: \`custom(rows, ctx)\` for anything that needs the whole group (CV, concentration, draw premium)\n\nThe id is then usable in \`KpiStrip\`, \`ColumnDef.metricId\`, \`MoMTable\`, \`RankingList\` and insight rules with no further wiring.\n`;
fs.writeFileSync('METRICS.md', md);
console.log('metrics', METRIC_LIST.length);
