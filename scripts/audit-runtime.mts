/* Runtime audit against the real sheets: cross-tab consistency, definition conflicts,
   filter-predicate correctness, period edge cases and data-quality discrepancies. */
import fs from 'node:fs';

const g = globalThis as any;
g.window = { location: { hash: '' }, innerWidth: 1600, matchMedia: () => ({ matches: false }), addEventListener() {} };
g.document = { documentElement: { getAttribute: () => 'matte', setAttribute() {} } };
g.localStorage = { getItem: () => null, setItem() {} };

const { loadDataset } = await import('../src/data/ingest.ts');
const { SHEETS } = await import('../src/data/sheets.config.ts');
const { resolveUrl } = await import('../src/data/sources.ts');
const { computeScope } = await import('../src/state/data.ts');
const { DEFAULT_FILTERS, resolvePeriod } = await import('../src/state/filters.ts');
const { metricValues, rollupLevel, GROUP_KEYS } = await import('../src/semantics/aggregations.ts');
const { runRules } = await import('../src/insights/engine.ts');
const { DEFAULT_THRESHOLDS } = await import('../src/state/view.ts');

const F: Record<string, string> = { new: 'New', checkins: 'Checkins', bookings: 'Bookings', sales: 'Sales', lapsed: 'Lapsed', payroll: 'Payroll', leads: 'Leads' };
globalThis.fetch = (async (u: string) => {
  const c = SHEETS.find((x) => resolveUrl(x) === u); const f = c ? F[c.key] : undefined;
  if (!f || !fs.existsSync(`/tmp/${f}.csv`)) return new Response('', { status: 401, headers: { 'content-type': 'text/html' } });
  return new Response(fs.readFileSync(`/tmp/${f}.csv`), { status: 200, headers: { 'content-type': 'text/csv' } });
}) as any;

const out: string[] = [];
const say = (s = '') => { out.push(s); console.log(s); };
const flag = (sev: string, area: string, detail: string) => say(`[${sev.padEnd(6)}] ${area.padEnd(16)} ${detail}`);

const ds = await loadDataset(undefined, true);
say(`\nDataset: today=${ds.today}  ${Object.entries({ sessions: ds.sessions, checkins: ds.checkins, bookings: ds.bookings, sales: ds.sales, newc: ds.newc, lapsed: ds.lapsed, leads: ds.leads, payroll: ds.payroll }).map(([k, v]) => `${k} ${v.length.toLocaleString('en-IN')}`).join(' · ')}\n`);

/* ═══ 1. Coverage: does each table actually cover the default period? ═══ */
say('── 1. Period coverage by table ──');
const scope = computeScope(ds, DEFAULT_FILTERS, 1200);
say(`Default period ${scope.period.start} → ${scope.period.end} (compare ${scope.period.prevStart} → ${scope.period.prevEnd})`);
for (const [k, rows] of Object.entries(scope.tables)) {
  const all = (ds as any)[k] as { date: string | null }[];
  const dated = all.filter((r) => r.date);
  const min = dated.reduce((a, r) => (a === null || r.date! < a ? r.date! : a), null as string | null);
  const max = dated.reduce((a, r) => (a === null || r.date! > a ? r.date! : a), null as string | null);
  const pct = all.length ? (rows.length / all.length) * 100 : 0;
  say(`  ${k.padEnd(10)} ${String(rows.length).padStart(7)} in scope of ${String(all.length).padStart(7)} (${pct.toFixed(1)}%)  range ${min} → ${max}`);
  if (all.length > 100 && rows.length === 0) flag('HIGH', 'coverage', `${k} has ${all.length} rows but NONE in the default period — the tab will be empty on open.`);
}

/* ═══ 2. Cross-source agreement on the same real-world quantity ═══ */
say('\n── 2. Cross-source agreement (same period) ──');
const inP = <T extends { date: string | null }>(rows: T[]) => rows.filter((r) => r.date && r.date >= scope.period.start && r.date <= scope.period.end);
const sessAtt = metricValues(inP(ds.sessions), ['attendance'], scope.ctx).attendance.value ?? 0;
const ckAtt = metricValues(inP(ds.checkins), ['checkins'], scope.ctx).checkins.value ?? 0;
const bkAtt = inP(ds.bookings).filter((b) => b.attended).length;
say(`  attendance — Sessions ${sessAtt} · Checkins ${ckAtt} · Bookings ${bkAtt}`);
const attSpread = Math.max(sessAtt, ckAtt, bkAtt) - Math.min(sessAtt, ckAtt, bkAtt);
if (attSpread / Math.max(1, ckAtt) > 0.03) flag('HIGH', 'reconciliation', `Attendance differs by ${attSpread} (${((attSpread / Math.max(1, ckAtt)) * 100).toFixed(1)}%) across Sessions/Checkins/Bookings.`);

const salesRev = metricValues(inP(ds.sales), ['gross_revenue'], scope.ctx).gross_revenue.value ?? 0;
const sessRev = metricValues(inP(ds.sessions), ['revenue'], scope.ctx).revenue.value ?? 0;
const bkRev = metricValues(inP(ds.bookings), ['b_revenue'], scope.ctx).b_revenue.value ?? 0;
say(`  revenue    — Sales ₹${Math.round(salesRev).toLocaleString('en-IN')} · Sessions ₹${Math.round(sessRev).toLocaleString('en-IN')} · Bookings ₹${Math.round(bkRev).toLocaleString('en-IN')}`);
flag('NOTE', 'reconciliation', 'Sales books at purchase, Sessions/Bookings attribute at attendance — a gap is expected. Only a widening gap is a defect.');

/* ═══ 3. Definition conflicts: "active member" across tables ═══ */
say('\n── 3. Definition conflicts for the same concept ──');
const lapsedActive = ds.lapsed.filter((r) => r.active).length;
const lapsedActiveMembers = new Set(ds.lapsed.filter((r) => r.active).map((r) => r.member_id)).size;
const newActive = ds.newc.filter((r) => r.lifecycle === 'Active').length;
const ckRecent = new Set(ds.checkins.filter((r) => r.checked_in && r.ts && r.ts > ds.todayTs - 30 * 864e5).map((r) => r.member_id)).size;
say(`  "Active" means: Lapsed.status∈{Active,Frozen,New} → ${lapsedActive} memberships / ${lapsedActiveMembers} members`);
say(`                  New.lifecycle='Active'            → ${newActive} clients`);
say(`                  visited in last 30 days           → ${ckRecent} members`);
const spread = Math.max(lapsedActiveMembers, newActive, ckRecent) / Math.max(1, Math.min(lapsedActiveMembers, newActive, ckRecent));
if (spread > 1.5) flag('HIGH', 'definitions', `Three different populations are all called "active" and they differ by ${spread.toFixed(1)}×. Overview shows one, Retention another. An operator will read them as the same number.`);

/* ═══ 4. Churn definition overlap ═══ */
const churnedFlag = ds.lapsed.filter((r) => r.churned).length;
const hasChurnDate = ds.lapsed.filter((r) => r.churned_date).length;
const statusLapsed = ds.lapsed.filter((r) => r.status === 'Lapsed').length;
const both = ds.lapsed.filter((r) => r.churned_date && r.status === 'Lapsed').length;
say(`  "Churned" = churn date (${hasChurnDate}) OR status Lapsed (${statusLapsed}); overlap ${both}; union ${churnedFlag}`);
const renewedWithChurnDate = ds.lapsed.filter((r) => r.status === 'Renewed' && r.churned_date).length;
if (renewedWithChurnDate > 0) flag('HIGH', 'definitions', `${renewedWithChurnDate} memberships are status "Renewed" yet carry a Churned Date, so they count as churned AND renewed. churn_rate and renewal_rate can sum above 100%.`);

/* ═══ 5. Is "is_new" consistent between New and Checkins? ═══ */
say('\n── 5. New-client flag consistency ──');
const newIds = new Set(ds.newc.filter((r) => r.is_new).map((r) => r.member_id));
const ckNewIds = new Set(ds.checkins.filter((r) => r.is_new).map((r) => r.member_id));
const inBoth = [...ckNewIds].filter((x) => x && newIds.has(x)).length;
say(`  New sheet flags ${newIds.size} new members; Checkins flags ${ckNewIds.size}; overlap ${inBoth}`);
if (ckNewIds.size && inBoth / ckNewIds.size < 0.5) flag('MEDIUM', 'definitions', `Only ${((inBoth / ckNewIds.size) * 100).toFixed(0)}% of Checkins "new" members are flagged new in the New sheet. new_share (Attendance) and new_clients (Acquisition) measure different populations.`);

/* ═══ 6. Filter predicate: does every filter actually bite on every table? ═══ */
say('\n── 6. Filter reach by table ──');
const loc = 'Kwality House, Kemps Corner';
const filtered = computeScope(ds, { ...DEFAULT_FILTERS, preset: 'all', locations: [loc] }, 1200);
const unfiltered = computeScope(ds, { ...DEFAULT_FILTERS, preset: 'all' }, 1200);
for (const k of Object.keys(filtered.tables) as (keyof typeof filtered.tables)[]) {
  const a = unfiltered.tables[k].length; const b = filtered.tables[k].length;
  const bit = a === 0 ? 'n/a' : b === a ? 'NO EFFECT' : `${((1 - b / a) * 100).toFixed(0)}% removed`;
  say(`  location filter on ${String(k).padEnd(10)} ${String(a).padStart(7)} → ${String(b).padStart(7)}  ${bit}`);
  if (a > 1000 && b === a) flag('MEDIUM', 'filters', `Location filter has no effect on ${k}; the tab silently ignores a filter the operator set.`);
}

/* ═══ 7. Orphan / join integrity ═══ */
say('\n── 7. Join integrity ──');
const newMembers = new Set(ds.newc.map((r) => r.member_id).filter(Boolean));
const check = (name: string, ids: (string | null)[], universe: Set<unknown>) => {
  const present = ids.filter(Boolean) as string[];
  const orphans = present.filter((x) => !universe.has(x)).length;
  const rate = present.length ? orphans / present.length : 0;
  say(`  ${name.padEnd(34)} ${orphans.toLocaleString('en-IN')} / ${present.length.toLocaleString('en-IN')} orphaned (${(rate * 100).toFixed(1)}%)`);
  if (rate > 0.25) flag('MEDIUM', 'joins', `${name}: ${(rate * 100).toFixed(0)}% of ids have no match — any metric that joins these under-counts.`);
  return rate;
};
check('Checkins.member → New', ds.checkins.map((r) => r.member_id), newMembers);
check('Lapsed.member → New', ds.lapsed.map((r) => r.member_id), newMembers);
check('Sales.member → New', ds.sales.map((r) => r.member_id), newMembers);
check('Bookings.member → New', ds.bookings.map((r) => r.member_id), newMembers);
const payrollTrainers = new Set(ds.payroll.map((r) => r.trainer).filter(Boolean));
check('Sessions.trainer → Payroll', [...new Set(ds.sessions.map((r) => r.trainer))], payrollTrainers);

/* ═══ 8. Null-vs-zero discipline on key numeric columns ═══ */
say('\n── 8. Null vs zero on key columns ──');
const nullZero = (name: string, rows: any[], col: string) => {
  let nulls = 0; let zeros = 0;
  for (const r of rows) { const v = r[col]; if (v === null || v === undefined) nulls++; else if (v === 0) zeros++; }
  const pctN = rows.length ? (nulls / rows.length) * 100 : 0;
  say(`  ${(name + '.' + col).padEnd(30)} null ${pctN.toFixed(1)}%  zero ${((zeros / Math.max(1, rows.length)) * 100).toFixed(1)}%`);
  if (pctN > 50) flag('MEDIUM', 'nulls', `${name}.${col} is ${pctN.toFixed(0)}% null — metrics built on it are computed from a minority of rows.`);
};
nullZero('sessions', ds.sessions, 'capacity');
nullZero('sessions', ds.sessions, 'revenue');
nullZero('checkins', ds.checkins, 'paid');
nullZero('lapsed', ds.lapsed, 'sessions_limit');
nullZero('lapsed', ds.lapsed, 'amount_paid');
nullZero('newc', ds.newc, 'ltv');
nullZero('leads', ds.leads, 'response_hours');

/* ═══ 9. Period presets: does each produce a non-empty, sane window? ═══ */
say('\n── 9. Period presets ──');
for (const preset of ['mtd', '30d', '90d', 'month', 'quarter', 'ytd', '12m', 'all'] as const) {
  const p = resolvePeriod({ ...DEFAULT_FILTERS, preset }, ds.today);
  const sc = computeScope(ds, { ...DEFAULT_FILTERS, preset }, 1200);
  const overlap = p.prevEnd >= p.start ? ' ⚠ OVERLAPS CURRENT' : '';
  say(`  ${preset.padEnd(8)} ${p.start} → ${p.end} (${p.days}d) vs ${p.prevStart} → ${p.prevEnd}  rows ${sc.rowsInScope.toLocaleString('en-IN')}${overlap}`);
  if (p.prevEnd >= p.start) flag('HIGH', 'periods', `Preset "${preset}" comparison window overlaps the current window — deltas double-count.`);
  if (sc.rowsInScope === 0) flag('MEDIUM', 'periods', `Preset "${preset}" returns no rows.`);
}

/* ═══ 10. Insight sanity: impact plausibility and duplication ═══ */
say('\n── 10. Insight engine ──');
const ins = runRules(scope, DEFAULT_THRESHOLDS);
say(`  ${ins.length} insights fired`);
const totalImpact = ins.reduce((a, i) => a + i.impactINR, 0);
const periodRev = salesRev;
say(`  claimed impact ₹${Math.round(totalImpact).toLocaleString('en-IN')} vs period revenue ₹${Math.round(periodRev).toLocaleString('en-IN')} (${(totalImpact / Math.max(1, periodRev)).toFixed(1)}×)`);
if (totalImpact > periodRev * 2) flag('MEDIUM', 'insights', `Total claimed impact is ${(totalImpact / Math.max(1, periodRev)).toFixed(1)}× period revenue. Impacts are not mutually exclusive and will not survive scrutiny if read as a sum.`);
const zeroImpact = ins.filter((i) => i.impactINR === 0).length;
if (zeroImpact) flag('LOW', 'insights', `${zeroImpact} insights claim ₹0 impact yet are ranked by impact — they always sort last regardless of urgency.`);
const entities = new Set(ins.map((i) => i.entity));
if (entities.size < ins.length) flag('LOW', 'insights', `${ins.length - entities.size} insights repeat an entity already covered.`);

/* ═══ 11. Weighted-rate correctness spot check ═══ */
say('\n── 11. Weighted vs averaged rate (proof) ──');
const byLoc = rollupLevel(scope.tables.sessions, ['location'], 0, ['fill_rate', 'attendance', 'seats'], scope.ctx);
const totalWeighted = metricValues(scope.tables.sessions, ['fill_rate'], scope.ctx).fill_rate.value ?? 0;
const naiveAvg = byLoc.length ? byLoc.reduce((a, n) => a + (n.values.fill_rate.value ?? 0), 0) / byLoc.length : 0;
say(`  fill_rate weighted total ${(totalWeighted * 100).toFixed(2)}%  ·  naive average of locations ${(naiveAvg * 100).toFixed(2)}%  ·  error ${Math.abs(totalWeighted - naiveAvg) * 100 > 0 ? ((naiveAvg - totalWeighted) * 100).toFixed(2) + 'pp' : '0'}`);

/* ═══ 12. Derived-data honesty ═══ */
say('\n── 12. Derived data ──');
const estCap = ds.sessions.filter((s) => s.capacity_estimated).length;
say(`  sessions with estimated capacity: ${estCap} / ${ds.sessions.length} (${((estCap / Math.max(1, ds.sessions.length)) * 100).toFixed(1)}%)`);
const over100 = ds.sessions.filter((s) => s.capacity && (s.checked_in ?? 0) > s.capacity).length;
say(`  sessions with attendance > capacity: ${over100}`);
if (over100) flag('HIGH', 'derived', `${over100} sessions report more attendees than seats — fill rate exceeds 100%.`);
const noCap = ds.sessions.filter((s) => !s.capacity).length;
say(`  sessions with no capacity at all: ${noCap}`);
if (noCap / ds.sessions.length > 0.05) flag('MEDIUM', 'derived', `${((noCap / ds.sessions.length) * 100).toFixed(0)}% of sessions have no capacity; they are silently excluded from fill rate.`);

fs.writeFileSync('/tmp/audit-runtime.txt', out.join('\n'));
say('\nWritten to /tmp/audit-runtime.txt');
