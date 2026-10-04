import { METRICS, METRIC_LIST, computeMetric, type QueryContext } from '../src/semantics/metrics';
const ctx = { ratePerSession: 1200, todayTs: Date.UTC(2026,9,4), dormantDays: 21, riskHigh: 60, zeroUsageDays: 7, matureDays: 30, medianFirstMembership: 12599, durationDefaultMin: 55, durationSuspect: true } as QueryContext;
const m = (id: string, rows: any[]) => computeMetric(METRICS[id], rows, ctx);
const out: any[] = [];
const T = (name: string, got: any, want: any) => out.push({ check: name, got, want, ok: JSON.stringify(got) === JSON.stringify(want) });

// 1. reliability + empty_session_rate should be 1
const sess = [{checked_in:5},{checked_in:0},{checked_in:null}];
T('reliability + empty_session_rate = 1 when CheckedIn has nulls',
  (m('reliability',sess).value! + m('empty_session_rate',sess).value!), 1);

// 2. below_break_even must not count rows with missing revenue
T('below_break_even ignores rows with no Revenue', m('below_break_even',[{revenue:null},{revenue:5000}]).value, 0);

// 3. voided consistency on sales
const sales = [
 {sale_id:'A', value:1000, net:900, vat:100, voided:false, qty:1, unit_price:1000, member_id:'m1', category_value:1000},
 {sale_id:'B', value:9999, net:9000, vat:999, voided:true,  qty:7, unit_price:9999, member_id:'m2', category_value:null},
];
T('units excludes voided line items', m('units',sales).value, 1);
T('unique_buyers excludes voided-only buyers', m('unique_buyers',sales).value, 1);
T('avg_unit_price excludes voided line items', m('avg_unit_price',sales).value, 1000);

// 4. sale-level membership fields repeated on line items
const mem = [
 {sale_id:'A', voided:false, mem_money_left:5000, mem_classes_left:10, rev_per_credit:500},
 {sale_id:'A', voided:false, mem_money_left:5000, mem_classes_left:10, rev_per_credit:500},
];
T('deferred_revenue counts a sale-level field once per sale', m('deferred_revenue',mem).value, 5000);
T('unused_session_liability counts a sale-level field once per sale', m('unused_session_liability',mem).value, 5000);

// 5. coverage on count metrics
const r5 = m('empty_sessions',[{checked_in:1},{checked_in:null},{checked_in:null}]);
T('count metrics report real coverage (2 of 3 rows lack CheckedIn)', r5.coverage, 1/3);

// 6. visit rate denominators
const v = [{attended:true,no_show:false,cancelled:false,late_cancelled:false},
           {attended:false,no_show:true, cancelled:false,late_cancelled:false},
           {attended:false,no_show:false,cancelled:false,late_cancelled:true},
           {attended:false,no_show:false,cancelled:true, late_cancelled:false}];
T('v_show_up + v_no_show + v_late_cancel rates share a base and sum to 1',
  +( (m('v_show_up_rate',v).value!) + (m('v_no_show_rate',v).value!) + (m('v_late_cancel_rate',v).value!) ).toFixed(4), 1);

// 7. aov denominator == transactions
const noid = [{sale_id:null, sale_item_id:'i1', value:1000, voided:false},{sale_id:null, sale_item_id:'i2', value:1000, voided:false}];
T('aov denominator equals the Transactions metric', m('aov',noid).value, m('gross_revenue',noid).value! / m('transactions',noid).value!);

// 8. complimentary should not be inferred from a missing Paid value
T('v_complimentary_rate ignores rows with unknown Paid', m('v_complimentary_rate',[{attended:true,paid:null,complimentary:false}]).value, null);
T('zero_value_share ignores bookings with unknown Sale Value', m('zero_value_share',[{value:null}]).value, null);

// 9. labels must be unique across the whole registry, not just within a table
const byLabel = new Map<string, string[]>();
for (const d of METRIC_LIST) { const a = byLabel.get(d.label) ?? []; a.push(`${d.id}[${d.table}]`); byLabel.set(d.label, a); }
const dupes = [...byLabel].filter(([, a]) => a.length > 1);
T('every metric label is unique across tables', dupes.length, 0);
for (const [l, ids] of dupes.sort((a, b) => b[1].length - a[1].length)) console.log('  DUPLICATE LABEL', JSON.stringify(l), '→', ids.join(', '));

for (const r of out) console.log(r.ok ? 'PASS' : 'FAIL', '|', r.check, '| got', r.got, '| expected', r.want);
console.log(`\n${out.filter(r=>!r.ok).length} of ${out.length} checks fail`);
