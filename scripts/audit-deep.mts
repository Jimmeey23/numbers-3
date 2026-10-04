/* Deep-dives into the specific discrepancies the runtime audit surfaced. */
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
const F: Record<string, string> = { new: 'New', checkins: 'Checkins', bookings: 'Bookings', sales: 'Sales', lapsed: 'Lapsed', payroll: 'Payroll', leads: 'Leads' };
globalThis.fetch = (async (u: string) => { const c = SHEETS.find((x) => resolveUrl(x) === u); const f = c ? F[c.key] : undefined;
  if (!f || !fs.existsSync(`/tmp/${f}.csv`)) return new Response('', { status: 401, headers: { 'content-type': 'text/html' } });
  return new Response(fs.readFileSync(`/tmp/${f}.csv`), { status: 200, headers: { 'content-type': 'text/csv' } }); }) as any;
const ds = await loadDataset(undefined, true);
const scope = computeScope(ds, DEFAULT_FILTERS, 1200);
const P = (r: { date: string | null }) => r.date && r.date >= scope.period.start && r.date <= scope.period.end;

console.log('\n═══ A. UTILISATION: what fraction of memberships can it even see? ═══');
const lim = ds.lapsed.filter((r) => r.sessions_limit && r.sessions_limit > 0);
const unl = ds.lapsed.filter((r) => r.unlimited);
const neither = ds.lapsed.filter((r) => !r.sessions_limit && !r.unlimited);
console.log(`  limited (has a numeric cap) : ${lim.length.toLocaleString('en-IN')}`);
console.log(`  unlimited                   : ${unl.length.toLocaleString('en-IN')}`);
console.log(`  neither (blank limit)       : ${neither.length.toLocaleString('en-IN')}`);
console.log(`  → utilisation is computed over ${((lim.length / ds.lapsed.length) * 100).toFixed(1)}% of memberships`);
const neitherWithSessions = neither.filter((r) => (r.completed ?? 0) > 0).length;
console.log(`  of the "neither" group, ${neitherWithSessions.toLocaleString('en-IN')} have completed sessions but no denominator`);
const usedPctPresent = ds.lapsed.filter((r) => r.used_pct !== null).length;
console.log(`  rows where the sheet supplies "Sessions Used %": ${usedPctPresent.toLocaleString('en-IN')}`);
console.log(`  headline utilisation now = ${((metricValues(scope.tables.lapsed, ['utilisation'], scope.ctx).utilisation.value ?? 0) * 100).toFixed(1)}%`);

console.log('\n═══ B. RISK SCORE: how many inputs are actually present? ═══');
const riskInputs = { util: 0, recency: 0, cancel: 0, attendance: 0, none: 0 };
for (const r of ds.lapsed) {
  let n = 0;
  if (r.sessions_limit || r.used_pct !== null) { riskInputs.util++; n++; }
  if (r.days_since_last_visit !== null) { riskInputs.recency++; n++; }
  if (r.cancel_rate !== null) { riskInputs.cancel++; n++; }
  if (r.attendance_rate !== null) { riskInputs.attendance++; n++; }
  if (n === 0) riskInputs.none++;
}
const pc = (n: number) => `${((n / ds.lapsed.length) * 100).toFixed(1)}%`;
console.log(`  utilisation present ${pc(riskInputs.util)} · recency ${pc(riskInputs.recency)} · cancel ${pc(riskInputs.cancel)} · attendance ${pc(riskInputs.attendance)}`);
console.log(`  rows with NO risk inputs at all: ${riskInputs.none.toLocaleString('en-IN')} (${pc(riskInputs.none)}) — these still receive a score from the defaults`);
const scores = ds.lapsed.map((r) => r.risk_score ?? 0);
const hist = new Map<number, number>();
for (const s of scores) { const b = Math.floor(s / 10) * 10; hist.set(b, (hist.get(b) ?? 0) + 1); }
console.log('  score distribution:', [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([b, n]) => `${b}s:${n}`).join(' '));
const defaultScore = ds.lapsed.filter((r) => !r.sessions_limit && r.used_pct === null && r.days_since_last_visit === null && r.cancel_rate === null && r.attendance_rate === null);
if (defaultScore.length) console.log(`  ⚠ ${defaultScore.length} rows score purely on defaults → identical score ${defaultScore[0].risk_score}`);

console.log('\n═══ C. LTV: is avg_ltv meaningful? ═══');
const withLtv = ds.newc.filter((r) => (r.ltv ?? 0) > 0);
const zeroLtv = ds.newc.filter((r) => (r.ltv ?? 0) === 0);
console.log(`  clients with LTV > 0: ${withLtv.length.toLocaleString('en-IN')} · LTV = 0: ${zeroLtv.length.toLocaleString('en-IN')}`);
const avgAll = ds.newc.reduce((a, r) => a + (r.ltv ?? 0), 0) / ds.newc.length;
const avgPos = withLtv.reduce((a, r) => a + (r.ltv ?? 0), 0) / Math.max(1, withLtv.length);
console.log(`  avg over everyone ₹${Math.round(avgAll).toLocaleString('en-IN')}  ·  avg over buyers ₹${Math.round(avgPos).toLocaleString('en-IN')}  → ${(avgPos / Math.max(1, avgAll)).toFixed(1)}× difference`);
const sorted = withLtv.map((r) => r.ltv ?? 0).sort((a, b) => a - b);
const q = (p: number) => sorted[Math.floor(sorted.length * p)] ?? 0;
console.log(`  buyers: p50 ₹${Math.round(q(0.5)).toLocaleString('en-IN')} · p90 ₹${Math.round(q(0.9)).toLocaleString('en-IN')} · p99 ₹${Math.round(q(0.99)).toLocaleString('en-IN')} · max ₹${Math.round(sorted[sorted.length - 1] ?? 0).toLocaleString('en-IN')}`);
console.log(`  → mean is ${(avgPos / Math.max(1, q(0.5))).toFixed(1)}× the median; a skewed distribution reported as a mean overstates the typical member`);

console.log('\n═══ D. BOOKINGS vs CHECKINS attendance gap ═══');
const bkP = ds.bookings.filter(P); const ckP = ds.checkins.filter(P);
const bkAtt = bkP.filter((b) => b.attended).length; const ckAtt = ckP.filter((c) => c.checked_in).length;
console.log(`  bookings rows in period ${bkP.length} (attended ${bkAtt}) · checkins rows ${ckP.length} (checked-in ${ckAtt})`);
const bkUids = new Set(bkP.map((b) => b.uid).filter(Boolean));
const ckUids = new Set(ckP.map((c) => c.uid).filter(Boolean));
const shared = [...bkUids].filter((u) => ckUids.has(u!)).length;
console.log(`  distinct sessions — bookings ${bkUids.size} · checkins ${ckUids.size} · shared ${shared}`);
console.log(`  → the two sheets do not cover exactly the same sessions, so a 1:1 attendance match is not expected`);
const bkOnlyLoc = new Set(bkP.map((b) => b.location)); const ckOnlyLoc = new Set(ckP.map((c) => c.location));
console.log(`  locations in bookings: ${[...bkOnlyLoc].join(', ')}`);
console.log(`  locations in checkins: ${[...ckOnlyLoc].join(', ')}`);

console.log('\n═══ E. "Online" location — is it real studio activity? ═══');
const online = ds.bookings.filter((b) => b.location === 'Online');
console.log(`  bookings at "Online": ${online.length.toLocaleString('en-IN')} (${((online.length / ds.bookings.length) * 100).toFixed(1)}%)`);
console.log(`  attended ${online.filter((b) => b.attended).length.toLocaleString('en-IN')} · revenue ₹${Math.round(online.reduce((a, b) => a + (b.value ?? 0), 0)).toLocaleString('en-IN')}`);
console.log(`  → these appear in location filters and the location scorecard alongside physical studios`);

console.log('\n═══ F. Import rows: are they excluded everywhere they should be? ═══');
const imports = ds.bookings.filter((b) => b.is_import);
console.log(`  bookings flagged import: ${imports.length.toLocaleString('en-IN')} · attended ${imports.filter((b) => b.attended).length.toLocaleString('en-IN')} · value ₹${imports.reduce((a, b) => a + (b.value ?? 0), 0)}`);
const importInSessions = ds.sessions.filter((s) => s.is_import).length;
console.log(`  sessions flagged import: ${importInSessions}`);
const y2020 = ds.bookings.filter((b) => b.date === '2020-01-01').length;
console.log(`  bookings dated exactly 2020-01-01: ${y2020.toLocaleString('en-IN')} (all backfill)`);
const newImports = ds.newc.filter((r) => r.is_import).length;
console.log(`  new-client rows flagged import: ${newImports.toLocaleString('en-IN')}`);

console.log('\n═══ G. Trainer name hygiene across sheets ═══');
const norm = (s: string | null) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const sessTr = new Set(ds.sessions.map((r) => r.trainer).filter(Boolean));
const payTr = new Set(ds.payroll.map((r) => r.trainer).filter(Boolean));
const newTr = new Set(ds.newc.map((r) => r.trainer).filter(Boolean));
const missExact = [...sessTr].filter((t) => !payTr.has(t!));
const missNorm = [...sessTr].filter((t) => ![...payTr].some((p) => norm(p) === norm(t)));
console.log(`  sessions trainers ${sessTr.size} · payroll ${payTr.size} · new ${newTr.size}`);
console.log(`  in sessions but not payroll (exact): ${missExact.length} → ${missExact.slice(0, 8).join(' | ')}`);
console.log(`  still missing after normalising case/space: ${missNorm.length} → ${missNorm.slice(0, 8).join(' | ')}`);
if (missExact.length > missNorm.length) console.log(`  ⚠ ${missExact.length - missNorm.length} are pure formatting mismatches that a trim+case fold would join`);

console.log('\n═══ H. Duplicate-member impact on member-level metrics ═══');
const byEmail = new Map<string, Set<string>>();
for (const r of ds.newc) { const k = (r.email ?? '').toLowerCase(); if (!k || !r.member_id) continue; let s = byEmail.get(k); if (!s) { s = new Set(); byEmail.set(k, s); } s.add(r.member_id); }
let dupes = 0; let dupIds = 0;
for (const s of byEmail.values()) if (s.size > 1) { dupes++; dupIds += s.size - 1; }
console.log(`  emails mapping to >1 member id: ${dupes.toLocaleString('en-IN')} · surplus ids ${dupIds.toLocaleString('en-IN')}`);
console.log(`  → unique-member counts and per-member LTV are overstated by up to ${((dupIds / Math.max(1, byEmail.size)) * 100).toFixed(1)}%`);

console.log('\n═══ I. Insight impact overlap ═══');
const { runRules } = await import('../src/insights/engine.ts');
const { DEFAULT_THRESHOLDS } = await import('../src/state/view.ts');
const ins = runRules(scope, DEFAULT_THRESHOLDS);
for (const i of ins.slice(0, 8)) console.log(`  ${i.rule.padEnd(22)} ₹${Math.round(i.impactINR).toLocaleString('en-IN').padStart(12)}  ${i.title.slice(0, 68)}`);
const dormant = ins.find((i) => i.rule === 'dormant'); const highRisk = ins.find((i) => i.rule === 'high_risk_value');
if (dormant && highRisk) console.log(`  ⚠ "dormant actives" (₹${Math.round(dormant.impactINR).toLocaleString('en-IN')}) and "high-risk actives" (₹${Math.round(highRisk.impactINR).toLocaleString('en-IN')}) count overlapping populations — dormancy is an input to the risk score.`);
