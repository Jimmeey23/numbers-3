/* Renders every tab server-side against the real sheet CSVs (downloaded to /tmp) to catch runtime errors. */
import fs from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';

// minimal browser globals for store initialisation
const g = globalThis as any;
g.window = { location: { hash: '', href: 'http://localhost/' }, innerWidth: 1600, innerHeight: 900, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
g.document = { documentElement: { getAttribute: (k: string) => (k === 'data-theme' ? 'matte' : 'compact'), setAttribute() {} }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, remove() {}, click() {}, set href(_: string) {}, set download(_: string) {} }), body: { appendChild() {} } };
g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
g.getComputedStyle = () => ({ getPropertyValue: () => '34' });
g.history = { replaceState() {} };
g.navigator = { clipboard: { writeText() {} } };

const { loadDataset } = await import('../src/data/ingest.ts');
const { SHEETS } = await import('../src/data/sheets.config.ts');
const { resolveUrl } = await import('../src/data/sources.ts');
const { computeScope } = await import('../src/state/data.ts');
const { DEFAULT_FILTERS } = await import('../src/state/filters.ts');
const { runRules } = await import('../src/insights/engine.ts');
const { DEFAULT_THRESHOLDS } = await import('../src/state/view.ts');
const { useData } = await import('../src/state/data.ts');

const FILES: Record<string, string> = { new: 'New', checkins: 'Checkins', bookings: 'Bookings', sales: 'Sales', lapsed: 'Lapsed', payroll: 'Payroll', leads: 'Leads' };
globalThis.fetch = (async (url: string) => {
  const cfg = SHEETS.find((c) => resolveUrl(c) === url);
  const f = cfg ? FILES[cfg.key] : undefined;
  if (!f || !fs.existsSync(`/tmp/${f}.csv`)) return new Response('', { status: 401, headers: { 'content-type': 'text/html' } });
  return new Response(fs.readFileSync(`/tmp/${f}.csv`), { status: 200, headers: { 'content-type': 'text/csv' } });
}) as any;
const tB = performance.now();
const ds = await loadDataset(undefined, true);
console.log('ingest', ((performance.now() - tB) / 1000).toFixed(1), 's · heap', (process.memoryUsage().heapUsed / 1e6).toFixed(0), 'MB');
console.log('rows:', Object.entries({ sessions: ds.sessions, checkins: ds.checkins, bookings: ds.bookings, sales: ds.sales, newc: ds.newc, lapsed: ds.lapsed, payroll: ds.payroll, leads: ds.leads }).map(([k, v]) => `${k} ${v.length.toLocaleString('en-IN')}`).join(' · '));
useData.setState({ dataset: ds, loads: ds.loads, status: 'ready' });
console.log('today', ds.today, 'defects', ds.defects.map((d) => d.id).join(','), 'loads', ds.loads.map((l) => `${l.key}:${l.status}:${l.rows}`).join(' '));

const scenarios: [string, any][] = [
  ['default (last month vs previous)', DEFAULT_FILTERS],
  ['all time, Kemps Corner, compare yoy', { ...DEFAULT_FILTERS, preset: 'all', locations: ['Kwality House, Kemps Corner'], compare: 'yoy' }],
  ['mtd, no compare, transient month', { ...DEFAULT_FILTERS, preset: 'mtd', compare: 'none', transient: [{ dim: 'month', value: '2026-09' }] }],
  ['empty scope', { ...DEFAULT_FILTERS, preset: 'custom', start: '2019-01-01', end: '2019-02-01' }],
  ['all time', { ...DEFAULT_FILTERS, preset: 'all' }],
];
const tabs = ['Overview', 'Classes', 'Slots', 'Trainers', 'Sales', 'Acquisition', 'Retention', 'Bookings', 'Leads', 'Attendance', 'Payroll', 'DataHealth'];
let failures = 0;
for (const [name, filters] of scenarios) {
  const t0 = performance.now();
  const scope = computeScope(ds, filters, 1200);
  const tScope = performance.now() - t0;
  const t1 = performance.now(); const insights = runRules(scope, DEFAULT_THRESHOLDS); const tRules = performance.now() - t1;
  console.log(`\n== ${name}: rows in scope ${scope.rowsInScope} · scope ${tScope.toFixed(0)}ms · ${insights.length} insights in ${tRules.toFixed(0)}ms`);
  if (name.startsWith('default')) for (const i of insights.slice(0, 14)) console.log(`   [${i.severity}] ${i.title} (≈₹${Math.round(i.impactINR).toLocaleString('en-IN')})`);
  for (const t of tabs) {
    const mod = await import(`../src/tabs/${t}.tsx`);
    const Comp = mod[t] as React.ComponentType<{ scope: any }>;
    const s = performance.now();
    try { const html = renderToString(React.createElement(Comp, { scope })); console.log(`   ${t.padEnd(12)} ok  ${(performance.now() - s).toFixed(0).padStart(5)}ms  ${(html.length / 1024).toFixed(0)}kB`); }
    catch (e) { failures++; console.log(`   ${t.padEnd(12)} FAIL ${(e as Error).message}\n${(e as Error).stack?.split('\n').slice(1, 4).join('\n')}`); }
  }
}
// shell components
const shell = await import('../src/components/shell/Shell.tsx');
for (const [n, C] of Object.entries({ TitleBar: shell.TitleBar, TabRail: shell.TabRail, SignalRail: shell.SignalRail, StatusBar: shell.StatusBar })) { try { renderToString(React.createElement(C as any)); console.log(`   ${n} ok`); } catch (e) { failures++; console.log(`   ${n} FAIL ${(e as Error).message}`); } }
console.log(failures ? `\n${failures} FAILURES` : '\nALL TABS RENDERED');
process.exit(failures ? 1 : 0);
