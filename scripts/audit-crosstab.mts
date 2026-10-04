/* The brief's cardinal rule: "Two numbers for the same metric on two tabs destroys the product."
   This computes what each tab would actually display for overlapping concepts. */
import fs from 'node:fs';
const g = globalThis as any;
g.window = { location: { hash: '' }, innerWidth: 1600, matchMedia: () => ({ matches: false }), addEventListener() {} };
g.document = { documentElement: { getAttribute: () => 'matte', setAttribute() {} } };
g.localStorage = { getItem: () => null, setItem() {} };
const { loadDataset } = await import('../src/data/ingest.ts');
const { SHEETS } = await import('../src/data/sheets.config.ts');
const { resolveUrl } = await import('../src/data/sources.ts');
const { computeScope } = await import('../src/state/data.ts');
const { DEFAULT_FILTERS } = await import('../src/state/filters.ts');
const { metricValues } = await import('../src/semantics/aggregations.ts');
const { fmtCurrency, fmtPercent } = await import('../src/semantics/formats.ts');
const F: Record<string, string> = { new: 'New', checkins: 'Checkins', bookings: 'Bookings', sales: 'Sales', lapsed: 'Lapsed', payroll: 'Payroll', leads: 'Leads' };
globalThis.fetch = (async (u: string) => { const c = SHEETS.find((x) => resolveUrl(x) === u); const f = c ? F[c.key] : undefined;
  if (!f || !fs.existsSync(`/tmp/${f}.csv`)) return new Response('', { status: 401, headers: { 'content-type': 'text/html' } });
  return new Response(fs.readFileSync(`/tmp/${f}.csv`), { status: 200, headers: { 'content-type': 'text/csv' } }); }) as any;
const ds = await loadDataset(undefined, true);
const s = computeScope(ds, DEFAULT_FILTERS, 1200);
const m = (t: keyof typeof s.tables, id: string) => metricValues(s.tables[t], [id], s.ctx)[id].value;

const conflicts: string[] = [];
const cmp = (concept: string, entries: { tab: string; label: string; value: number | null; fmt: 'n' | '₹' | '%' }[]) => {
  console.log(`\n${concept}`);
  for (const e of entries) {
    const v = e.value === null ? '—' : e.fmt === '₹' ? fmtCurrency(e.value) : e.fmt === '%' ? fmtPercent(e.value) : Math.round(e.value).toLocaleString('en-IN');
    console.log(`   ${e.tab.padEnd(12)} ${e.label.padEnd(34)} ${v}`);
  }
  const vals = entries.map((e) => e.value).filter((v): v is number => v !== null);
  if (vals.length > 1) {
    const lo = Math.min(...vals); const hi = Math.max(...vals);
    if (hi > 0 && (hi - lo) / hi > 0.02) {
      console.log(`   ⚠ spread ${((hi - lo) / hi * 100).toFixed(0)}%`);
      conflicts.push(`${concept}: ${entries.map((e) => `${e.tab}=${e.value === null ? '—' : e.fmt === '%' ? fmtPercent(e.value) : e.fmt === '₹' ? fmtCurrency(e.value) : Math.round(e.value)}`).join(' vs ')}`);
    }
  }
};

console.log(`Scope: ${s.period.start} → ${s.period.end}`);
console.log('═══ Same concept, different tabs ═══');

cmp('"Revenue" for the period', [
  { tab: 'Overview', label: 'gross_revenue (Sales)', value: m('sales', 'gross_revenue'), fmt: '₹' },
  { tab: 'Sales', label: 'gross_revenue (Sales)', value: m('sales', 'gross_revenue'), fmt: '₹' },
  { tab: 'Classes', label: 'revenue (Sessions)', value: m('sessions', 'revenue'), fmt: '₹' },
  { tab: 'Bookings', label: 'b_revenue (Bookings)', value: m('bookings', 'b_revenue'), fmt: '₹' },
  { tab: 'Attendance', label: 'c_paid (Checkins)', value: m('checkins', 'c_paid'), fmt: '₹' },
  { tab: 'Payroll', label: 'p_revenue (Payroll)', value: m('payroll', 'p_revenue'), fmt: '₹' },
]);

cmp('"Visits" — canonical grain, every tab', [
  { tab: 'Classes', label: 'visits', value: m('visits', 'visits'), fmt: 'n' },
  { tab: 'Attendance', label: 'visits', value: m('visits', 'visits'), fmt: 'n' },
  { tab: 'Bookings', label: 'visits', value: m('visits', 'visits'), fmt: 'n' },
  { tab: 'Slots', label: 'visits', value: m('visits', 'visits'), fmt: 'n' },
]);
cmp('Legacy per-sheet attendance (kept for reconciliation only)', [
  { tab: 'Sessions', label: 'attendance', value: m('sessions', 'attendance'), fmt: 'n' },
  { tab: 'Checkins', label: 'checkins', value: m('checkins', 'checkins'), fmt: 'n' },
  { tab: 'Bookings', label: 'b_attended', value: m('bookings', 'b_attended'), fmt: 'n' },
]);

cmp('"Late-cancel rate" — canonical', [
  { tab: 'Classes', label: 'v_late_cancel_rate', value: m('visits', 'v_late_cancel_rate'), fmt: '%' },
  { tab: 'Bookings', label: 'v_late_cancel_rate', value: m('visits', 'v_late_cancel_rate'), fmt: '%' },
]);

cmp('"No-show rate" — canonical', [
  { tab: 'Classes', label: 'v_no_show_rate', value: m('visits', 'v_no_show_rate'), fmt: '%' },
  { tab: 'Bookings', label: 'v_no_show_rate', value: m('visits', 'v_no_show_rate'), fmt: '%' },
]);

cmp('"Sessions held"', [
  { tab: 'Classes', label: 'sessions (Sessions)', value: m('sessions', 'sessions'), fmt: 'n' },
  { tab: 'Payroll', label: 'p_sessions (Payroll)', value: m('payroll', 'p_sessions'), fmt: 'n' },
]);

cmp('"Active members / memberships"', [
  { tab: 'Overview', label: 'active_memberships (Lapsed)', value: m('lapsed', 'active_memberships'), fmt: 'n' },
  { tab: 'Retention', label: 'distinct_members (Lapsed)', value: m('lapsed', 'distinct_members'), fmt: 'n' },
  { tab: 'Acquisition', label: 'active_members (New lifecycle)', value: m('newc', 'active_members'), fmt: 'n' },
  { tab: 'Attendance', label: 'mau (Checkins)', value: m('checkins', 'mau'), fmt: 'n' },
]);

cmp('"Conversion rate"', [
  { tab: 'Acquisition', label: 'conversion_rate (New)', value: m('newc', 'conversion_rate'), fmt: '%' },
  { tab: 'Payroll', label: 'p_conversion_rate (Payroll)', value: m('payroll', 'p_conversion_rate'), fmt: '%' },
  { tab: 'Leads', label: 'lead_conversion_rate (Leads)', value: m('leads', 'lead_conversion_rate'), fmt: '%' },
]);

cmp('"Retention rate"', [
  { tab: 'Acquisition', label: 'retention_rate (New)', value: m('newc', 'retention_rate'), fmt: '%' },
  { tab: 'Payroll', label: 'p_retention_rate (Payroll)', value: m('payroll', 'p_retention_rate'), fmt: '%' },
  { tab: 'Retention', label: 'renewal_rate (Lapsed)', value: m('lapsed', 'renewal_rate'), fmt: '%' },
]);

cmp('"New clients"', [
  { tab: 'Acquisition', label: 'new_clients (New)', value: m('newc', 'new_clients'), fmt: 'n' },
  { tab: 'Payroll', label: 'p_new (Payroll)', value: m('payroll', 'p_new'), fmt: 'n' },
  { tab: 'Attendance', label: 'new_share × checkins', value: (m('checkins', 'new_share') ?? 0) * (m('checkins', 'checkins') ?? 0), fmt: 'n' },
]);

console.log('\n\n═══ SUMMARY ═══');
console.log(`${conflicts.length} concepts show materially different numbers depending on which tab you open:\n`);
for (const c of conflicts) console.log(`  • ${c}`);
