/** Reproduce analytical defects without modifying business data.
 * npx tsx scripts/audit-metric-correctness.mts [directory-containing-sheet-CSVs]
 * Synthetic fixtures expose supported edge cases; optional CSVs quantify current impact.
 * Exit 1 means an expected mathematical invariant is currently violated.
 */
import fs from 'node:fs';
import path from 'node:path';
const g = globalThis as any;
g.window = { location: { hash: '' }, innerWidth: 1600, matchMedia: () => ({ matches: false }), addEventListener() {} };
g.document = { documentElement: { getAttribute: () => 'matte', setAttribute() {} } };
g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { metric, computeMetric, coverageNote } = await import('../src/semantics/metrics.ts');
const { mapLapsedRow, mapCheckinRow, mapNewRow, buildVisits } = await import('../src/data/normalise.ts');
const { groupRows, GROUP_KEYS } = await import('../src/semantics/aggregations.ts');
const { buildPredicate, DEFAULT_FILTERS } = await import('../src/state/filters.ts');
const { runRules, summariseImpact } = await import('../src/insights/engine.ts');
const { DEFAULT_THRESHOLDS } = await import('../src/state/view.ts');
const ctx = { ratePerSession: 1000, todayTs: Date.UTC(2026, 9, 4), durationDefaultMin: 55, durationSuspect: false,
  dormantDays: 21, riskHigh: 60, zeroUsageDays: 21, matureDays: 21, medianFirstMembership: 12599 };
const results: { check: string; expected: unknown; actual: unknown; passed: boolean }[] = [];
const check = (name: string, actual: unknown, expected: unknown) => {
  const passed = typeof actual === 'number' && typeof expected === 'number' ? Math.abs(actual - expected) < 1e-8 : JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ check: name, expected, actual, passed });
};
const value = (id: string, rows: any[]) => computeMetric(metric(id), rows, ctx).value;
check('Membership purchase products are not erased by numeric parsing', mapNewRow({ 'Memberships Bought Post Trial': 'Studio 1 Month Unlimited' }).memberships_bought, 1);
check('Member grouping preserves distinct identities with the same display name', groupRows([{ member_id: 'a', name: 'Fixture member' }, { member_id: 'b', name: 'Fixture member' }], GROUP_KEYS.member).size, 2);
const payroll = [{ total_sessions: 1, total_paid: 2000, converted: 1 }, { total_sessions: 1, total_paid: 0, converted: 0 }];
check('Payroll margin retains costs on zero-revenue rows', value('p_margin', payroll), 0);
check('Payroll share retains costs on zero-revenue rows', value('payroll_pct_of_revenue', payroll), 1);
check('Cost per acquisition includes zero-conversion rows', value('p_cost_per_acquired', payroll), 2000);
const memberships = [
  mapLapsedRow({ 'Member ID': 'fixture-member', 'Purchase Date': '01/01/2026', 'Start Date': '10/01/2026', 'End Date': '20/01/2026' }, ctx.todayTs),
  mapLapsedRow({ 'Member ID': 'fixture-member', 'Purchase Date': '18/01/2026', 'Start Date': '25/01/2026', 'End Date': '30/01/2026' }, ctx.todayTs),
];
check('Member tenure uses membership start, not purchase', value('member_tenure', memberships), 20);
check('Renewal gap uses next membership start', value('avg_gap_between_memberships', memberships), 5);
const missingPaid = [{ attended: true, checked_in: true, paid: null, complimentary: false }];
check('Unknown payment does not imply complimentary attendance', value('v_complimentary_rate', missingPaid), null);
const cancelResult = computeMetric(metric('v_cancelled'), [{ in_bookings: false, cancelled: false }], ctx);
check('Cancellation source coverage recognises unavailable lifecycle', cancelResult.coverage, 0);
check('Cancellation source coverage warning is present', coverageNote(metric('v_cancelled'), cancelResult) !== null, true);
const rawVisit = { 'Date (IST)': '2026-09-01', Time: '09:00', Location: 'Fixture studio', 'Cleaned Class': 'Barre', 'Checked In': 'TRUE', Paid: '100', 'Session ID': 'fixture-session' };
const ck = [mapCheckinRow(rawVisit, { corrupted: 0 }), mapCheckinRow(rawVisit, { corrupted: 0 })];
check('Incomplete member identity preserves unresolved rows', buildVisits(ck, []).length, 2);
const nullDate = { date: null, is_import: false };
check('Undated observations are excluded from a dated period', buildPredicate(DEFAULT_FILTERS, 'sales', '2026-09-01', '2026-09-30')(nullDate), false);
const tables = { sessions: [], visits: [], checkins: [], sales: [], newc: [], lapsed: [], payroll: [], leads: [], bookings: [] };
const dormant = { active: true, days_since_last_visit: 50, amount_paid: 100, member_id: 'fixture-member', location: 'Fixture studio' };
const baseScope: any = { rowsInScope: 1, period: { start: '2026-09-01', end: '2026-09-30' }, filters: DEFAULT_FILTERS, ctx,
  tables: { ...tables, lapsed: [dormant] }, all: { ...tables, lapsed: [dormant] }, compare: tables, today: '2026-10-04' };
runRules(baseScope, DEFAULT_THRESHOLDS);
const refreshed = { ...baseScope, tables: { ...tables, lapsed: [{ ...dormant, amount_paid: 99999 }] }, all: { ...tables, lapsed: [{ ...dormant, amount_paid: 99999 }] } };
check('Same-count data refresh invalidates dormant insight value', runRules(refreshed, DEFAULT_THRESHOLDS).find(i => i.rule === 'dormant')?.impactINR, 99999);
/* Claims now carry the amount each member contributes, so netting uses real values. The declared
   policy is a per-member maximum: a=max(100,800)=800, b=900, c=100 → 1800. */
const impact = summariseImpact([
  { basis: 'membership_paid', impactINR: 1000, claims: [{ id: 'a', value: 100 }, { id: 'b', value: 900 }] },
  { basis: 'membership_paid', impactINR: 900, claims: [{ id: 'a', value: 800 }, { id: 'c', value: 100 }] },
] as any);
check('Monetary overlap netting follows the declared per-member maximum policy', impact[0]?.net, 1800);
console.log(JSON.stringify({ fixtures: results, overlapApproximation: { calculated: impact[0]?.net, maximumPerMemberPolicy: 1800, firstClaimPolicy: 1100 } }, null, 2));
if (process.argv[2]) {
  const snapshotDir = path.resolve(process.argv[2]);
  const { SHEETS } = await import('../src/data/sheets.config.ts');
  const { resolveUrl } = await import('../src/data/sources.ts');
  const { loadDataset } = await import('../src/data/ingest.ts');
  const { computeScope } = await import('../src/state/data.ts');
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const cfg = SHEETS.find(c => resolveUrl(c) === url);
    const csvPath = path.join(snapshotDir, `${cfg?.title}.csv`);
    return fs.existsSync(csvPath) ? new Response(fs.readFileSync(csvPath), { headers: { 'content-type': 'text/csv' } }) : new Response('', { status: 401 });
  }) as typeof fetch;
  try {
    const ds = await loadDataset(undefined, true);
    const scope = computeScope(ds, DEFAULT_FILTERS, 1200);
    const aggregate = (rows: any[]) => {
      const paid = rows.reduce((s, r) => s + (r.total_paid ?? 0), 0);
      const cost = rows.reduce((s, r) => s + (r.total_sessions ?? 0) * 1200, 0);
      const converted = rows.reduce((s, r) => s + (r.converted ?? 0), 0);
      const liveCtx = { ...scope.ctx, ratePerSession: 1200 };
      return { rows: rows.length, paid, cost, converted,
        actualCPA: computeMetric(metric('p_cost_per_acquired'), rows, liveCtx).value,
        expectedCPA: converted ? cost / converted : null,
        actualMargin: computeMetric(metric('p_margin'), rows, liveCtx).value,
        expectedMargin: paid ? (paid - cost) / paid : null };
    };
    const fresh = scope.tables.newc.filter(r => r.is_new);
    const mature = fresh.filter(r => r.ts !== null && r.ts <= scope.ctx.todayTs - scope.ctx.matureDays * 864e5);
    const actualDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const sourceStages = new Map<string, any[]>();
    for (const row of mature) { const key = row.source ?? 'Unattributed'; const rows = sourceStages.get(key) ?? []; rows.push(row); sourceStages.set(key, rows); }
    const negativeSourceCompositions = [...sourceStages].map(([source, rows]) => {
      const first = rows.length, second = rows.filter(r => r.visits_post_trial > 0).length,
        purchased = rows.filter(r => r.converted).length, retained = rows.filter(r => r.converted && r.days_active >= 90).length;
      return { source, first, second, purchased, retained, components: [first - second, second - purchased, purchased - retained, retained] };
    }).filter(x => x.first >= 20 && x.components.some(v => v < 0));
    console.log(JSON.stringify({ snapshot: { scope: scope.period, inferredToday: ds.today, actualDate,
      sourceLoads: ds.loads.map(l => ({ key: l.key, status: l.status, rows: l.rows })),
      futureSessions: ds.sessions.filter(r => r.date !== null && r.date > actualDate).length,
      futureCheckins: ds.checkins.filter(r => r.date !== null && r.date > actualDate).length,
      allPayroll: aggregate(ds.payroll), periodPayroll: aggregate(scope.tables.payroll),
      acquisition: { allFirstVisits: fresh.length, matureFirstVisits: mature.length,
        allConversion: fresh.length ? fresh.filter(r => r.converted).length / fresh.length : null,
        matureConversion: mature.length ? mature.filter(r => r.converted).length / mature.length : null,
        thirdVisits: mature.filter(r => r.visits_post_trial >= 2).length,
        purchasers: mature.filter(r => r.converted).length, negativeSourceCompositions },
      durationCorruptedRows: ds.defects.find(d => d.id === 'checkins-duration-serial')?.rowsAffected } }, null, 2));
  } finally { globalThis.fetch = savedFetch; }
}
process.exitCode = results.some(r => !r.passed) ? 1 : 0;
