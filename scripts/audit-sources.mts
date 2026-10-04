/* Every metric, checked against the sheet it claims to read.
 *
 *   npx tsx scripts/audit-sources.mts            # live sheets
 *
 * Four passes:
 *   A  the columns a metric names in `sources` exist in that sheet's real header
 *   B  the metric computes on live data, with its sample size and coverage
 *   C  the value is in range for its format (a rate outside 0–1, a negative count)
 *   D  a metric that SUMs a column which repeats inside its entity group is double counting
 *
 * Output is a table per pass plus a findings list. Exit 1 on any high finding.
 */
const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) },
  window: { location: { hash: '' }, innerWidth: 1600, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false }) },
  document: { documentElement: { getAttribute: () => 'matte', setAttribute() {} } },
  CustomEvent: class { constructor(public type: string, public detail?: unknown) {} },
});
import Papa from 'papaparse';
const { SHEETS } = await import('../src/data/sheets.config.ts');
const { METRIC_LIST, metric } = await import('../src/semantics/metrics.ts');
const { loadDataset } = await import('../src/data/ingest.ts');
const { computeScope } = await import('../src/state/data.ts');
const { DEFAULT_FILTERS } = await import('../src/state/filters.ts');
const { DEFAULT_THRESHOLDS } = await import('../src/state/view.ts');
const { metricValues } = await import('../src/semantics/aggregations.ts');
const { formatValue } = await import('../src/semantics/formats.ts');

type Sev = 'high' | 'medium' | 'low';
const findings: { sev: Sev; pass: string; metric: string; text: string }[] = [];
const add = (sev: Sev, pass: string, m: string, text: string) => findings.push({ sev, pass, metric: m, text });

/* ── Real headers, straight from each spreadsheet ───────────────────────── */
const headers = new Map<string, string[]>();
/* Only the sheets pass D inspects are retained. Keeping all of them alongside the normalised
   dataset exhausts the heap — Checkins and Bookings alone are 700k rows. */
const KEEP_RAW = new Set(['sales', 'lapsed', 'sessions', 'payroll', 'new', 'leads']);
const raw = new Map<string, Record<string, string>[]>();
for (const cfg of SHEETS as any[]) {
  const url = cfg.url ?? `https://docs.google.com/spreadsheets/d/${cfg.spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(cfg.title)}${cfg.select ? `&tq=${encodeURIComponent(cfg.select)}` : ''}`;
  try {
    const text = await (await fetch(url)).text();
    const p = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
    const h = p.meta.fields ?? [];
    headers.set(cfg.key, h);
    if (KEEP_RAW.has(cfg.key)) raw.set(cfg.key, p.data);
    const missing = (cfg.expected ?? []).filter((c: string) => !h.includes(c));
    const extra = h.filter((c) => (cfg.expected ?? []).length && !cfg.expected.includes(c));
    console.log(`${cfg.key.padEnd(17)} ${String(p.data.length).padStart(7)} rows  ${h.length} cols${missing.length ? `  MISSING ${missing.join(', ')}` : ''}${extra.length ? `  UNDECLARED ${extra.join(', ')}` : ''}`);
    if (missing.length) add('high', 'A', cfg.key, `Sheet "${cfg.title}" is missing declared columns: ${missing.join(', ')}`);
  } catch (e) {
    console.log(`${cfg.key.padEnd(17)} FETCH FAILED ${(e as Error).message}`);
    add('high', 'A', cfg.key, `Could not fetch: ${(e as Error).message}`);
  }
}

/* A metric's `sources` are written "Table.Column". Map the metric table onto the sheets whose
   header may legitimately carry that column — `visits` is reconciled from three of them. */
/* A metric that names an entity-level column but does not sum it raw. `discount_value` sums the
   reconciled line discount: the sale-level column is allocated across the sale's lines by
   post-discount list value, and only when no item-level discount exists. Verified in
   `reconcileSales`. */
const ALLOCATES: Record<string, string[]> = { discount_value: ['Discount Value In Currency'] };

const SHEETS_FOR: Record<string, string[]> = {
  visits: ['checkins', 'bookings', 'sessions'],
  sessions: ['sessions', 'recurring', 'teacherRecurring', 'checkins'],
  checkins: ['checkins'], sales: ['sales'], newc: ['new'], lapsed: ['lapsed'],
  payroll: ['payroll'], leads: ['leads'], bookings: ['bookings'],
};
/* Columns a metric names that are computed here rather than read from a sheet. */
const DERIVED = new Set(['derived', 'Settings', 'rate_per_session']);

console.log('\n── A. source columns exist ───────────────────────────────────');
let checked = 0; let unknown = 0;
for (const m of METRIC_LIST) {
  for (const src of m.sources ?? []) {
    const dot = src.indexOf('.');
    if (dot < 0) continue;
    const col = src.slice(dot + 1);
    if (DERIVED.has(col)) continue;
    const keys = SHEETS_FOR[m.table] ?? [];
    const found = keys.some((k) => (headers.get(k) ?? []).includes(col));
    checked++;
    if (!found && keys.some((k) => headers.has(k))) { unknown++; add('high', 'A', m.id, `names column "${col}" which no ${keys.join('/')} header carries.`); }
  }
}
console.log(`${checked} source-column claims checked, ${unknown} not found in any header`);

/* ── D runs first, on the raw rows, so they can be freed before the dataset is built. ───── */
console.log('\n── D. repetition in the source ───────────────────────────────');
const ENTITY: Record<string, { key: string; label: string }> = {
  sales: { key: 'Sale ID', label: 'sale' },
  lapsed: { key: 'Member ID', label: 'member' },
  payroll: { key: 'Unique Key', label: 'trainer-month' },
  new: { key: 'Member Id', label: 'member' },
  leads: { key: 'ID', label: 'lead' },
};
for (const [sheet, ent] of Object.entries(ENTITY)) {
  const rows = raw.get(sheet); if (!rows?.length) continue;
  const cols = (headers.get(sheet) ?? []).filter((c) => c !== ent.key);
  const groups = new Map<string, Record<string, string>[]>();
  for (const r of rows) { const k = r[ent.key]; if (!k) continue; const a = groups.get(k) ?? []; if (a.length < 8) a.push(r); groups.set(k, a); }
  const multi = [...groups.values()].filter((g) => g.length > 1);
  if (!multi.length) { console.log(`  ${sheet}: no ${ent.label} spans more than one row`); continue; }
  /* A column is entity-level when it is identical on every row of an entity AND genuinely varies
     between entities. Without the second test a near-constant column looks entity-level for a
     trivial reason: `Sale Item Quantity` is 1 on 24,600 of 24,846 rows, so it is identical inside
     every sale without being a sale-level value. The threshold is deliberately low — a column
     with only two or three distinct values across the whole sheet carries too little signal to
     call either way, and is reported separately rather than flagged. */
  const repeats: string[] = []; const nearConstant: string[] = [];
  for (const c of cols) {
    let same = 0; let diff = 0;
    for (const g of multi) { const vals = new Set(g.map((r) => (r[c] ?? '').trim()).filter(Boolean)); if (vals.size > 1) diff++; else if (vals.size === 1) same++; }
    if (diff > 0 || same <= 20) continue;
    const distinct = new Set(rows.map((r) => (r[c] ?? '').trim()).filter(Boolean)).size;
    if (distinct <= 3) nearConstant.push(`${c} (${distinct} distinct)`); else repeats.push(c);
  }
  if (nearConstant.length) console.log(`     near-constant, not entity-level: ${nearConstant.join(', ')}`);
  const dead = (headers.get(sheet) ?? []).filter((c) => { const d = new Set(rows.map((r) => (r[c] ?? '').trim()).filter(Boolean)); return d.size === 1 && [...d][0] === '0'; });
  if (dead.length) { console.log(`  ${sheet}: columns present but never populated (0 on every row): ${dead.join(', ')}`); for (const c of dead) add('high', 'D', sheet, `column "${c}" is 0 on all ${rows.length.toLocaleString('en-IN')} rows — any metric over it reports a confident zero.`); }
  console.log(`  ${sheet}: ${multi.length.toLocaleString('en-IN')} ${ent.label}s span >1 row; ${repeats.length} columns are identical on every row of the ${ent.label}`);
  if (repeats.length) console.log(`     ${repeats.join(', ')}`);
  for (const m of METRIC_LIST) {
    if (!(SHEETS_FOR[m.table] ?? []).includes(sheet)) continue;
    if (m.aggregation !== 'sum') continue;
    for (const src of m.sources ?? []) {
      const col = src.slice(src.indexOf('.') + 1);
      if ((ALLOCATES[m.id] ?? []).includes(col)) continue;
      if (repeats.includes(col)) add('high', 'D', m.id, `SUMs "${col}", which is identical on every row of a ${ent.label} in ${sheet} — it is a ${ent.label}-level value and is being counted once per row.`);
    }
  }
}
raw.clear();


/* ── B/C. compute every metric on live data ─────────────────────────────── */
const ds = await loadDataset(undefined, false);
const scope = computeScope(ds, { ...DEFAULT_FILTERS, preset: '90d' }, 1200, DEFAULT_THRESHOLDS);
console.log(`\n── B. computed over ${scope.period.label} ────────────────────────────`);
const byTable = new Map<string, typeof METRIC_LIST>();
for (const m of METRIC_LIST) { const a = byTable.get(m.table) ?? []; a.push(m); byTable.set(m.table, a as never); }

const report: { table: string; id: string; label: string; formatted: string; value: number | null; n: number; coverage: number | null }[] = [];
for (const [table, list] of byTable) {
  const rows = (scope.tables as any)[table] ?? [];
  const vals = metricValues(rows, list.map((m) => m.id), scope.ctx);
  console.log(`\n  ${table} — ${rows.length.toLocaleString('en-IN')} rows`);
  for (const m of list) {
    const r = vals[m.id];
    const f = String(formatValue(m.format, r.value));
    report.push({ table, id: m.id, label: m.label, formatted: f, value: r.value, n: r.n, coverage: r.coverage ?? null });
    const cov = r.coverage !== null && r.coverage !== undefined && r.coverage < 0.999 ? `${(r.coverage * 100).toFixed(0)}%` : '';
    console.log(`    ${m.id.padEnd(30)} ${f.padStart(13)}  n=${String(r.n).padStart(6)} ${cov.padStart(5)}`);
    if (r.value === null && rows.length > 0 && !m.coverageMatters) add('medium', 'B', m.id, `is null over 90 days with ${rows.length.toLocaleString('en-IN')} rows in scope — the column it reads may be empty.`);
    if (m.format === 'percent' && r.value !== null && (r.value < 0 || r.value > 1.0001)) add('high', 'C', m.id, `is a percent reading ${(r.value * 100).toFixed(1)}% — outside 0–100%.`);
    if (['integer', 'currency'].includes(m.format) && r.value !== null && r.value < 0 && m.higherIsBetter) add('medium', 'C', m.id, `reads negative (${f}) where a count or amount is expected.`);
    if (r.coverage !== null && r.coverage !== undefined && r.coverage < 0.25 && r.n > 50 && !m.coverageMatters) add('medium', 'B', m.id, `computes on ${(r.coverage * 100).toFixed(0)}% of rows without declaring coverageMatters — the figure is about a minority of the data and does not say so.`);
  }
}

console.log(`\nFINDINGS: ${findings.filter((f) => f.sev === 'high').length} high · ${findings.filter((f) => f.sev === 'medium').length} medium · ${findings.filter((f) => f.sev === 'low').length} low`);
for (const f of findings) console.log(`[${f.sev.toUpperCase().padEnd(6)}] ${f.pass} ${f.metric}: ${f.text}`);
import fs from 'node:fs';
fs.writeFileSync('/tmp/metric-report.json', JSON.stringify({ report, findings, period: scope.period }, null, 1));
process.exitCode = findings.some((f) => f.sev === 'high') ? 1 : 0;
