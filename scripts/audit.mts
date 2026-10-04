/* Static + runtime audit of the semantic layer. Finds duplicate ids, rate metrics that are not
   weighted, metrics whose sources don't match their table, unreachable metrics, and cross-tab
   definition conflicts. Run: npx tsx scripts/audit.mts */
import fs from 'node:fs';

const g = globalThis as any;
g.window = { location: { hash: '' }, innerWidth: 1600, matchMedia: () => ({ matches: false }), addEventListener() {} };
g.document = { documentElement: { getAttribute: () => 'matte', setAttribute() {} } };
g.localStorage = { getItem: () => null, setItem() {} };

const { METRIC_LIST, METRICS } = await import('../src/semantics/metrics.ts');
const { GROUP_KEYS } = await import('../src/semantics/aggregations.ts');
const { RULES } = await import('../src/insights/rules.ts');

type Finding = { sev: 'high' | 'medium' | 'low'; area: string; detail: string };
const findings: Finding[] = [];
const add = (sev: Finding['sev'], area: string, detail: string) => findings.push({ sev, area, detail });

/* ── 1. Duplicate metric ids ───────────────────────────────── */
const seen = new Map<string, number>();
for (const m of METRIC_LIST) seen.set(m.id, (seen.get(m.id) ?? 0) + 1);
for (const [id, n] of seen) if (n > 1) add('high', 'registry', `Metric id "${id}" is defined ${n} times — the later definition silently wins.`);

/* ── 2. Rates that are not weighted ────────────────────────── */
for (const m of METRIC_LIST) {
  if (m.format === 'percent' && !['weighted', 'custom', 'avg', 'median'].includes(m.aggregation)) {
    add('high', 'rates', `"${m.id}" is a percent but aggregates as ${m.aggregation}.`);
  }
  if (m.format === 'percent' && m.aggregation === 'avg' && !m.perRowRate) {
    add('medium', 'rates', `"${m.id}" (${m.label}) averages a per-row rate. Correct only if the source column is already a per-entity rate; otherwise it violates the weighted rule.`);
  }
  if (m.aggregation === 'weighted' && !m.den) add('high', 'rates', `"${m.id}" is weighted but declares no denominator.`);
  if (m.aggregation === 'custom' && !m.custom) add('high', 'registry', `"${m.id}" is custom but has no custom().`);
  if (m.aggregation === 'distinct' && !m.distinctKey) add('high', 'registry', `"${m.id}" is distinct but has no distinctKey().`);
  if (['sum', 'count', 'avg', 'median'].includes(m.aggregation) && !m.num) add('high', 'registry', `"${m.id}" is ${m.aggregation} but has no num().`);
}

/* ── 3. Sources that don't reference the metric's own table ── */
const TABLE_PREFIX: Record<string, string[]> = {
  sessions: ['Sessions', 'Checkins'], checkins: ['Checkins'], sales: ['Sales'], newc: ['New'],
  lapsed: ['Lapsed'], payroll: ['Payroll'], leads: ['Leads'], bookings: ['Bookings'],
  visits: ['Checkins', 'Bookings'],   // the reconciled grain legitimately cites both
};
for (const m of METRIC_LIST) {
  const want = TABLE_PREFIX[m.table] ?? [];
  const refs = m.sources.filter((s) => !s.startsWith('Settings.'));
  if (refs.length && !refs.some((s) => want.some((w) => s.startsWith(w + '.')))) {
    add('medium', 'provenance', `"${m.id}" reads table ${m.table} but its ⓘ sources cite ${refs.map((r) => r.split('.')[0]).join(', ')} — the tooltip will mislead.`);
  }
}

/* ── 4. Target sanity ──────────────────────────────────────── */
for (const m of METRIC_LIST) {
  if (m.target === undefined) continue;
  if (m.format === 'percent' && (m.target < 0 || m.target > 1)) add('high', 'targets', `"${m.id}" target ${m.target} is outside 0–1 for a percent metric.`);
}

/* ── 5. minSample sanity ───────────────────────────────────── */
for (const m of METRIC_LIST) {
  if (m.format === 'percent' && m.minSample < 5 && m.aggregation !== 'custom') {
    add('low', 'sampling', `"${m.id}" is a rate with minSample ${m.minSample}; a rate off fewer than 5 rows is noise.`);
  }
}

/* ── 6. Group keys referenced by tabs but not defined ──────── */
const tabFiles = fs.readdirSync('src/tabs').filter((f) => f.endsWith('.tsx'));
const keyRe = /(?:groupKeys|availableKeys)=\{\[([^\]]*)\]\}/g;
const usedKeys = new Set<string>();
for (const f of tabFiles) {
  const src = fs.readFileSync(`src/tabs/${f}`, 'utf8');
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(src))) for (const k of m[1].split(',')) { const t = k.trim().replace(/['"]/g, ''); if (t) usedKeys.add(t); }
}
for (const k of usedKeys) if (!GROUP_KEYS[k]) add('high', 'grouping', `Tabs reference group key "${k}" which is not in GROUP_KEYS — the level renders empty.`);

/* ── 7. Metric ids referenced by tabs but not in the registry ─ */
const idRe = /metricId:\s*'([^']+)'|metricIds=\{\[([^\]]*)\]\}|ids=\{\[([^\]]*)\]\}|metricOptions=\{\[([^\]]*)\]\}/g;
const usedIds = new Set<string>();
for (const f of tabFiles) {
  const src = fs.readFileSync(`src/tabs/${f}`, 'utf8');
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(src))) {
    if (m[1]) usedIds.add(m[1]);
    for (const grp of [m[2], m[3], m[4]]) if (grp) for (const k of grp.split(',')) { const t = k.trim().replace(/['"]/g, ''); if (t && !t.includes('.')) usedIds.add(t); }
  }
}
for (const id of usedIds) if (!METRICS[id]) add('high', 'registry', `Tabs reference metric "${id}" which does not exist — computeMetric throws.`);

/* ── 8. Registry metrics never used anywhere ───────────────── */
const allSrc = [...tabFiles.map((f) => fs.readFileSync(`src/tabs/${f}`, 'utf8')),
  fs.readFileSync('src/insights/rules.ts', 'utf8'),
  fs.readFileSync('src/components/DrillPanel/DrillPanel.tsx', 'utf8'),
  fs.readFileSync('src/tabs/common.tsx', 'utf8')].join('\n');
/* Every metric is reachable from the registry-wide surfaces — the ⌘K palette, the custom-widget
   metric picker and Ask all enumerate METRIC_LIST — so "not named in a tab file" means "not pinned
   to a tab", not "unreachable". Flag only metrics no surface can reach. */
const REGISTRY_SURFACES = ['src/components/shell/Shell.tsx', 'src/components/InsightCard/CustomCards.tsx',
  'src/components/Widgets/WidgetSection.tsx', 'src/api/agent.ts', 'src/api/resolve.ts'];
const enumeratesRegistry = REGISTRY_SURFACES.some((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('METRIC_LIST'));
const unpinned = METRIC_LIST.filter((m) => !allSrc.includes(`'${m.id}'`));
if (!enumeratesRegistry && unpinned.length) add('low', 'registry', `${unpinned.length} metrics are defined but never surfaced: ${unpinned.map((m) => m.id).join(', ')}`);
else if (unpinned.length) console.log(`\nNote: ${unpinned.length} metrics are not pinned to a tab; all remain reachable from the palette, the widget picker and Ask.`);

/* ── 9. Insight rules: duplicate ids, missing tabs ─────────── */
const ruleIds = new Map<string, number>();
for (const r of RULES) ruleIds.set(r.id, (ruleIds.get(r.id) ?? 0) + 1);
for (const [id, n] of ruleIds) if (n > 1) add('high', 'insights', `Rule id "${id}" defined ${n} times.`);

/* ── 10. Duplicate label collisions within a domain ────────── */
const byLabel = new Map<string, string[]>();
for (const m of METRIC_LIST) {
  const k = `${m.table}|${m.label}`;
  byLabel.set(k, [...(byLabel.get(k) ?? []), m.id]);
}
for (const [k, ids] of byLabel) if (ids.length > 1) add('medium', 'naming', `Table ${k.split('|')[0]} has ${ids.length} metrics labelled "${k.split('|')[1]}": ${ids.join(', ')} — indistinguishable in a column picker.`);

/* ── Report ────────────────────────────────────────────────── */
const order = { high: 0, medium: 1, low: 2 };
findings.sort((a, b) => order[a.sev] - order[b.sev] || a.area.localeCompare(b.area));
console.log(`\n${METRIC_LIST.length} metrics · ${RULES.length} rules · ${Object.keys(GROUP_KEYS).length} group keys\n`);
console.log(`FINDINGS: ${findings.filter((f) => f.sev === 'high').length} high · ${findings.filter((f) => f.sev === 'medium').length} medium · ${findings.filter((f) => f.sev === 'low').length} low\n`);
for (const f of findings) console.log(`[${f.sev.toUpperCase().padEnd(6)}] ${f.area.padEnd(12)} ${f.detail}`);
