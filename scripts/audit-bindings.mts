/* One concept, one metric, everywhere.
 *
 * The cardinal rule is that the same question must not get two answers on two tabs. The runtime
 * cross-tab script proves that with live numbers; this one proves it statically, from the bindings
 * themselves, so a regression is caught without a dataset.
 *
 *   npx tsx scripts/audit-bindings.mts
 *
 * Exit 1 means two tabs bind different metrics to the same concept, or a tab binds a metric that
 * is deliberately reserved for reconciliation.
 */
import fs from 'node:fs';
import path from 'node:path';

const g = globalThis as never as Record<string, unknown>;
g.window = { location: { hash: '' }, innerWidth: 1600, matchMedia: () => ({ matches: false }), addEventListener() {} };
g.document = { documentElement: { getAttribute: () => 'matte', setAttribute() {} } };
g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { METRICS } = await import('../src/semantics/metrics.ts');

/* ── The concept map ───────────────────────────────────────────────────────
   `canonical` is the metric every tab must use when it wants to answer this question.
   `reconciliation` metrics measure the same concept on a different source. They are kept so the
   two sources can be compared on Data health, and they may only appear there. */
const { CONCEPTS: APP_CONCEPTS } = await import('../src/semantics/concepts.ts');

/* The concept map is the app's own (src/semantics/concepts.ts), so the enforced rule and the
   reconciliation panel the operator reads can never drift apart. */
interface Concept {
  id: string;
  question: string;
  canonical: string;
  reconciliation: string[];
  /** Tabs allowed to bind a variant, because comparing or attributing by source is their job. */
  reconcilersAllowedOn: string[];
}

/** Tabs whose subject is a single source, so they may legitimately show that source's own figure. */
const SOURCE_TABS: Record<string, string[]> = {
  attendance: ['DataHealth', 'Classes', 'Trainers', 'Slots', 'Payroll'],
  bookings_taken: ['DataHealth', 'Classes'],
  late_cancels: ['DataHealth', 'Classes', 'Retention'],
  late_cancel_rate: ['DataHealth', 'Classes', 'Acquisition'],
  no_shows: ['DataHealth', 'Classes', 'Retention'],
  no_show_rate: ['DataHealth', 'Classes'],
  cancel_rate: ['DataHealth', 'Retention'],
  show_up_rate: ['DataHealth', 'Classes'],
  complimentary_rate: ['DataHealth', 'Classes'],
  rev_per_visit: ['DataHealth', 'Classes', 'Trainers', 'Bookings'],
  attributed_revenue: ['DataHealth', 'Classes', 'Slots', 'Trainers', 'Payroll', 'Overview', 'Sales'],
};

const CONCEPTS: Concept[] = APP_CONCEPTS.map((c) => ({
  id: c.id,
  question: c.question,
  canonical: c.canonical.metricId,
  reconciliation: c.variants.map((v) => v.metricId),
  reconcilersAllowedOn: SOURCE_TABS[c.id] ?? ['DataHealth'],
}));

const TAB_DIR = 'src/tabs';
const tabFiles = fs.readdirSync(TAB_DIR).filter((f) => f.endsWith('.tsx') && f !== 'common.tsx');

/** Every metric a tab actually binds. Only metric-carrying positions count: a quoted word that
 *  happens to match a metric id — a group key, a UI mode, a domain name — is not a binding. */
function bindingsOf(src: string): Set<string> {
  const out = new Set<string>();
  const take = (id: string | undefined) => { if (id && METRICS[id]) out.add(id); };

  for (const m of src.matchAll(/metricId:\s*'([a-z0-9_]+)'/g)) take(m[1]);                 // column defs
  for (const m of src.matchAll(/\{\s*table:\s*'[a-z]+',\s*id:\s*'([a-z0-9_]+)'/g)) take(m[1]); // MixedKpiStrip
  for (const m of src.matchAll(/rankBy="([a-z0-9_]+)"/g)) take(m[1]);
  for (const m of src.matchAll(/metricId="([a-z0-9_]+)"/g)) take(m[1]);                   // DayTimeHeatmap

  /* Array literals in metric positions: KPI strips, MoM tables, ranking options, rollup and
     series metric lists, and the `const X_METRICS = [...]` headers each tab declares. */
  const ARRAYS = /(?:ids|metricIds|metricOptions)=\{\[([^\]]*)\]\}|_METRICS\s*=\s*\[([^\]]*)\]|(?:metricValues|rollupLevel|seriesBy)\([^;]*?\[([^\]]*)\]/g;
  for (const m of src.matchAll(ARRAYS)) {
    const body = m[1] ?? m[2] ?? m[3] ?? '';
    const ids = [...body.matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
    // A group-key array sits in the same syntactic position; it is not a metric list.
    if (ids.length && ids.every((id) => METRICS[id])) ids.forEach(take);
  }
  return out;
}

const findings: { sev: 'high' | 'medium'; text: string }[] = [];
const add = (sev: 'high' | 'medium', text: string) => findings.push({ sev, text });

const byTab = new Map<string, Set<string>>();
for (const f of tabFiles) byTab.set(path.basename(f, '.tsx'), bindingsOf(fs.readFileSync(path.join(TAB_DIR, f), 'utf8')));

console.log(`${tabFiles.length} tabs · ${CONCEPTS.length} shared concepts\n`);

for (const c of CONCEPTS) {
  if (!METRICS[c.canonical]) { add('high', `Concept "${c.id}" names a canonical metric that does not exist: ${c.canonical}`); continue; }
  const usingCanonical: string[] = [];
  const usingOther: string[] = [];
  for (const [tab, ids] of byTab) {
    const hasCanonical = ids.has(c.canonical);
    const others = (c.reconciliation ?? []).filter((r) => ids.has(r));
    if (hasCanonical) usingCanonical.push(tab);
    for (const o of others) {
      const allowed = (c.reconcilersAllowedOn ?? []).includes(tab);
      if (!allowed) add('high', `${tab} answers "${c.question}" with "${o}" (${METRICS[o]?.label}) instead of the canonical "${c.canonical}" (${METRICS[c.canonical].label}).`);
      else usingOther.push(`${tab}:${o}`);
    }
  }
  const mark = usingCanonical.length ? '·' : ' ';
  console.log(`${mark} ${c.id.padEnd(22)} canonical ${c.canonical.padEnd(24)} on ${usingCanonical.join(', ') || '— nowhere —'}`);
  if (usingOther.length) console.log(`  ${''.padEnd(22)} reconciliation ${usingOther.join(', ')}`);
}

/* Every variant must be reachable in the reconciliation panel, and every metric that variant
   names must exist — otherwise the panel silently drops a row the rule says it shows. */
for (const c of CONCEPTS) {
  for (const r of c.reconciliation) if (!METRICS[r]) add('high', `Concept "${c.id}" lists a reconciliation metric that does not exist: ${r}`);
}
const health = fs.readFileSync(path.join(TAB_DIR, 'DataHealth.tsx'), 'utf8');
if (!health.includes('CONCEPTS')) add('high', 'Data health no longer renders the concept reconciliation panel, so the variants are kept without ever being compared.');

/* ── Every tab leads with exactly eight cards ──────────────────────────────
   A strip that varies between five and eight makes the tabs feel like different products and
   leaves the grid half empty, so the count is part of the contract rather than a per-tab choice. */
const KPI_CARDS = 8;
for (const f of tabFiles) {
  const tab = path.basename(f, '.tsx');
  if (tab === 'DataHealth') continue;                 // a diagnostics tab, not an operating view
  const src = fs.readFileSync(path.join(TAB_DIR, f), 'utf8');
  /* `ids={[...]}` is unique to the KPI strip (the nested and month-on-month tables use
     `columns=` and `metricIds=`), so it is matched directly — scanning forward from the component
     name fails on the arrow functions in the intervening props. */
  const strip = src.match(/\bids=\{\[([^\]]*)\]\}/) ?? src.match(/\bitems=\{\[([\s\S]*?)\]\}/);
  const isMixed = !src.includes('ids={[') && src.includes('MixedKpiStrip');
  const idsConst = src.match(/const IDS\s*=\s*\[([^\]]*)\]/);
  if (!strip && !idsConst) { add('high', `${tab} has no KPI strip; every operating tab leads with ${KPI_CARDS} cards.`); continue; }
  const body = strip ? strip[1] : idsConst![1];
  const count = isMixed
    ? [...body.matchAll(/\bid:\s*'([a-z0-9_]+)'/g)].filter((m) => METRICS[m[1]]).length
    : [...body.matchAll(/'([a-z0-9_]+)'/g)].filter((m) => METRICS[m[1]]).length;
  if (count !== KPI_CARDS) add('high', `${tab} leads with ${count} KPI cards; every operating tab shows exactly ${KPI_CARDS}.`);
}

console.log(`\nFINDINGS: ${findings.filter((f) => f.sev === 'high').length} high · ${findings.filter((f) => f.sev === 'medium').length} medium`);
for (const f of findings) console.log(`[${f.sev.toUpperCase().padEnd(6)}] ${f.text}`);
process.exitCode = findings.some((f) => f.sev === 'high') ? 1 : 0;
