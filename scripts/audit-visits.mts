/* Why does "visits/attendance" differ between Bookings and every other tab?
   Traces the discrepancy to the row level so the fix is evidence-led, not guessed. */
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
const F: Record<string, string> = { new: 'New', checkins: 'Checkins', bookings: 'Bookings', sales: 'Sales', lapsed: 'Lapsed', payroll: 'Payroll', leads: 'Leads' };
globalThis.fetch = (async (u: string) => { const c = SHEETS.find((x) => resolveUrl(x) === u); const f = c ? F[c.key] : undefined;
  if (!f || !fs.existsSync(`/tmp/${f}.csv`)) return new Response('', { status: 401, headers: { 'content-type': 'text/html' } });
  return new Response(fs.readFileSync(`/tmp/${f}.csv`), { status: 200, headers: { 'content-type': 'text/csv' } }); }) as any;

const ds = await loadDataset(undefined, true);
const s = computeScope(ds, DEFAULT_FILTERS, 1200);
const S = s.period.start, E = s.period.end;
const inP = (d: string | null) => !!d && d >= S && d <= E;

console.log(`\nPeriod ${S} → ${E}\n`);
const ck = ds.checkins.filter((r) => inP(r.date));
const bk = ds.bookings.filter((r) => inP(r.date));
console.log(`checkins rows ${ck.length}  attended ${ck.filter((r) => r.checked_in).length}`);
console.log(`bookings rows ${bk.length}  attended ${bk.filter((r) => r.attended).length}`);
console.log(`gap in attended: ${ck.filter((r) => r.checked_in).length - bk.filter((r) => r.attended).length}\n`);

/* Which sessions exist in one but not the other? */
const ckU = new Map<string, number>(); const bkU = new Map<string, number>();
for (const r of ck) if (r.uid && r.checked_in) ckU.set(r.uid, (ckU.get(r.uid) ?? 0) + 1);
for (const r of bk) if (r.uid && r.attended) bkU.set(r.uid, (bkU.get(r.uid) ?? 0) + 1);
const onlyCk = [...ckU.keys()].filter((u) => !bkU.has(u));
const onlyBk = [...bkU.keys()].filter((u) => !ckU.has(u));
console.log(`sessions with attendance only in Checkins: ${onlyCk.length} (${onlyCk.reduce((a, u) => a + (ckU.get(u) ?? 0), 0)} attendees)`);
console.log(`sessions with attendance only in Bookings: ${onlyBk.length} (${onlyBk.reduce((a, u) => a + (bkU.get(u) ?? 0), 0)} attendees)`);
const shared = [...ckU.keys()].filter((u) => bkU.has(u));
let diffTotal = 0; const diffs: { uid: string; ck: number; bk: number }[] = [];
for (const u of shared) { const a = ckU.get(u)!; const b = bkU.get(u)!; if (a !== b) { diffTotal += a - b; diffs.push({ uid: u, ck: a, bk: b }); } }
console.log(`shared sessions ${shared.length}, of which ${diffs.length} disagree, net ${diffTotal}\n`);
diffs.sort((a, b) => Math.abs(b.ck - b.bk) - Math.abs(a.ck - a.bk));
for (const d of diffs.slice(0, 6)) {
  const sample = ck.find((r) => r.uid === d.uid);
  console.log(`  ${d.uid}  checkins ${d.ck} vs bookings ${d.bk}  |  ${sample?.date} ${sample?.time} ${sample?.class_name} @ ${sample?.location}`);
}

/* Members counted in one source but not the other for the same session */
if (diffs.length) {
  const u = diffs[0].uid;
  const ckM = new Set(ck.filter((r) => r.uid === u && r.checked_in).map((r) => r.member_id));
  const bkM = new Set(bk.filter((r) => r.uid === u && r.attended).map((r) => r.member_id));
  console.log(`\n  detail for ${u}: in checkins only ${[...ckM].filter((m) => !bkM.has(m)).length}, in bookings only ${[...bkM].filter((m) => !ckM.has(m)).length}`);
}

/* Do the location sets match? */
console.log('\nLocation coverage in period:');
const locCk = new Map<string, number>(); const locBk = new Map<string, number>();
for (const r of ck) if (r.checked_in) locCk.set(r.location ?? '—', (locCk.get(r.location ?? '—') ?? 0) + 1);
for (const r of bk) if (r.attended) locBk.set(r.location ?? '—', (locBk.get(r.location ?? '—') ?? 0) + 1);
for (const l of new Set([...locCk.keys(), ...locBk.keys()])) {
  const a = locCk.get(l) ?? 0; const b = locBk.get(l) ?? 0;
  console.log(`  ${l.padEnd(34)} checkins ${String(a).padStart(5)}  bookings ${String(b).padStart(5)}  ${a !== b ? `Δ${a - b}` : ''}`);
}

/* Are imports or zero-value rows involved? */
console.log('\nBookings in period by flag:');
console.log(`  imports ${bk.filter((r) => r.is_import).length} · cancelled ${bk.filter((r) => r.cancelled).length} · late ${bk.filter((r) => r.late_cancelled).length} · no-show ${bk.filter((r) => r.no_show).length}`);
const cancelledButAttended = bk.filter((r) => r.cancelled && r.attended).length;
console.log(`  cancelled AND attended (contradictory): ${cancelledButAttended}`);
const noUid = bk.filter((r) => !r.uid).length;
console.log(`  bookings with no UniqueID: ${noUid} (attended ${bk.filter((r) => !r.uid && r.attended).length})`);
const ckNoUid = ck.filter((r) => !r.uid).length;
console.log(`  checkins with no UniqueID: ${ckNoUid} (attended ${ck.filter((r) => !r.uid && r.checked_in).length})`);

/* ── Duplicate detection: same member, same session, counted twice? ── */
console.log('\n── Duplicate rows per (session, member) ──');
const dupCk = new Map<string, number>(); const dupBk = new Map<string, number>();
for (const r of ck) if (r.checked_in && r.uid && r.member_id) { const k = `${r.uid}|${r.member_id}`; dupCk.set(k, (dupCk.get(k) ?? 0) + 1); }
for (const r of bk) if (r.attended && r.uid && r.member_id) { const k = `${r.uid}|${r.member_id}`; dupBk.set(k, (dupBk.get(k) ?? 0) + 1); }
const extraCk = [...dupCk.values()].reduce((a, v) => a + (v - 1), 0);
const extraBk = [...dupBk.values()].reduce((a, v) => a + (v - 1), 0);
console.log(`  checkins: ${dupCk.size} distinct (session,member) pairs, ${extraCk} surplus rows`);
console.log(`  bookings: ${dupBk.size} distinct (session,member) pairs, ${extraBk} surplus rows`);
console.log(`  → deduplicated attendance: checkins ${dupCk.size} vs bookings ${dupBk.size} (gap ${dupCk.size - dupBk.size})`);
const worst = [...dupCk.entries()].filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);
for (const [k, v] of worst) {
  const [uid, mid] = k.split('|');
  const rows = ck.filter((r) => r.uid === uid && r.member_id === mid && r.checked_in);
  console.log(`    ${v}× member ${mid} in ${uid}: products [${rows.map((r) => r.product ?? '—').join(', ')}] paid [${rows.map((r) => r.paid ?? 0).join(', ')}]`);
}
