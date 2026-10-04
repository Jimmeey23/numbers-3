/* Does the MoM table really put the newest month on the left, while still comparing each month
   with the one before it in calendar order? */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
Object.assign(globalThis, { window: { location: { hash: '' }, innerWidth: 1600, matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} }, document: { documentElement: { getAttribute: () => 'matte', setAttribute() {} } }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
const { MoMTable } = await import('../src/components/MoMTable/MoMTable.tsx');
const months = ['2026-06', '2026-07', '2026-08'];
const rows = [
  { month: '2026-06', attended: true, checked_in: true }, { month: '2026-06', attended: true },
  { month: '2026-07', attended: true }, { month: '2026-07', attended: true }, { month: '2026-07', attended: true },
  { month: '2026-08', attended: true },
];
const ctx = { ratePerSession: 1200, todayTs: Date.now(), dormantDays: 21, riskHigh: 60, zeroUsageDays: 7, matureDays: 21, medianFirstMembership: 12599, durationDefaultMin: 55, durationSuspect: false, periodStart: '2026-06-01', periodEnd: '2026-08-31' };
const html = renderToStaticMarkup(React.createElement(MoMTable as never, { rows, metricIds: ['visits'], months, ctx, domain: 'attendance' } as never));
const heads = [...html.matchAll(/<th[^>]*>([A-Z][a-z]{2}[^<]*)<\/th>/g)].map((m) => m[1]);
const cells = [...html.matchAll(/class="t-num"[^>]*>(?:<[^>]+>)*([\d.,]+)/g)].map((m) => m[1]);
console.log('header order :', heads.join(' | '));
console.log('cell order   :', cells.join(' | '));
const monthHeads = heads.filter((h) => /^[A-Z][a-z]{2} \d{2}$/.test(h));
const ok = monthHeads[0]?.startsWith('Aug') && monthHeads.at(-1)?.startsWith('Jun') && cells.join(',') === '1,3,2';
console.log('newest leftmost :', monthHeads[0]);
console.log('oldest rightmost:', monthHeads.at(-1));
console.log('cells follow the header order, not calendar order:', cells.join(',') === '1,3,2');
console.log(ok ? '\nPASS: months read newest-first and the values follow them' : '\nFAIL');
process.exitCode = ok ? 0 : 1;
