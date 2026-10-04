/* Fetch every tab by title, validate the header against the declared schema, cache raw CSV until
   the operator explicitly asks for fresh data.
   Memory discipline: the raw CSV text and the parsed row array for a sheet are released the moment that
   sheet has been mapped. Holding all of them at once costs well over a gigabyte at these volumes. */
import { makeRowView, parseCsv, readHeader } from './csv';
import { SHEETS, type SheetConfig } from './sheets.config';
import { readOverrides, resolveConfig, resolveUrl } from './sources';
import type { Dataset, Defect, SheetKey, SheetLoad } from './types';
import {
  buildVisits, deriveBookings, deriveSessions, deriveSessionsFromBookings, mapBookingRow, mapCheckinRow, mapLapsedRow,
  mapLeadRow, mapNewRow, mapPayrollRow, mapSaleRow, mapSessionRow, reconcileSales, resetPool, type CheckinStats,
} from './normalise';

type Raw = Record<string, string>;
const CACHE_NAME = 'floor-sheets-v1';

async function readCache(url: string): Promise<{ text: string; at: number } | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const c = await caches.open(CACHE_NAME);
    const res = await c.match(url);
    if (!res) return null;
    const at = Number(res.headers.get('x-floor-cached-at') ?? 0);
    if (!at) return null;
    /* No time-based expiry. A cached sheet is served however old it is; only an explicit
       refresh — the Reload button, or a hard refresh of the page — goes back to the network. */
    return { text: await res.text(), at };
  } catch { return null; }
}
async function writeCache(url: string, text: string) {
  if (typeof caches === 'undefined') return;
  try {
    const c = await caches.open(CACHE_NAME);
    await c.put(url, new Response(text, { headers: { 'content-type': 'text/csv', 'x-floor-cached-at': String(Date.now()) } }));
  } catch { /* quota — the sheet simply refetches next time */ }
}
export async function clearCache() {
  if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function blankLoad(cfg: SheetConfig): SheetLoad {
  return { key: cfg.key, title: cfg.title, spreadsheetId: cfg.spreadsheetId, status: 'pending', rows: 0, columns: [],
    expected: cfg.expected, missing: [], extra: [], loadMs: 0, fromCache: false, fetchedAt: null };
}

/** Network only — returns the CSV text, never parses. */
async function fetchText(cfgIn: SheetConfig, force: boolean): Promise<{ load: SheetLoad; text: string | null }> {
  const overrides = readOverrides();
  const cfg = resolveConfig(cfgIn, overrides);
  const url = resolveUrl(cfgIn, overrides);
  const t0 = performance.now();
  const base = { ...blankLoad(cfg), overridden: !!overrides[cfg.key] };
  let text: string | null = null; let fromCache = false; let at = Date.now();
  if (!force) { const c = await readCache(url); if (c) { text = c.text; fromCache = true; at = c.at; } }
  if (text === null) {
    let res: Response;
    try { res = await fetch(url, { redirect: 'follow' }); }
    catch (e) { return { load: { ...base, status: 'error', loadMs: performance.now() - t0, error: `Network error: ${(e as Error).message}`, hint: 'Check connectivity, then Retry.' }, text: null }; }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('csv')) {
      const priv = res.status === 401 || res.status === 403;
      const why = priv
        ? `Google returned ${res.status}. The "${cfg.title}" spreadsheet is private — every request redirects to the Google sign-in page, and a browser cannot authenticate to docs.google.com from another origin.`
        : `Google returned ${res.status} for the "${cfg.title}" tab.`;
      return { load: { ...base, status: 'error', loadMs: performance.now() - t0, error: why,
        hint: priv
          ? 'Open the spreadsheet → Share → General access → "Anyone with the link", role Viewer → Done. Then press Refresh. If sharing is blocked by policy, use "Point at another source" below.'
          : 'Check the tab name, then press Refresh.' }, text: null };
    }
    text = await res.text(); at = Date.now();
    void writeCache(url, text);
  }
  return { load: { ...base, loadMs: performance.now() - t0, fromCache, fetchedAt: at, url }, text };
}

/** Validate the header without materialising the body. */
function validateHeader(cfg: SheetConfig, text: string, load: SheetLoad): boolean {
  const columns = readHeader(text).filter(Boolean);
  const present = new Set(columns.map(norm));
  const missingRequired = cfg.required.filter((c) => !present.has(norm(c)));
  const expectedSet = new Set(cfg.expected.map(norm));
  load.columns = columns;
  load.missing = cfg.expected.filter((c) => !present.has(norm(c)));
  load.extra = columns.filter((c) => !expectedSet.has(norm(c)));
  if (missingRequired.length) {
    load.status = 'error';
    load.error = `Tab "${cfg.title}" was not found by title — Google served a different sheet (it returned: ${columns.slice(0, 6).join(', ')}…).`;
    load.hint = `Rename the tab to exactly "${cfg.title}" or update sheets.config.ts. Missing required columns: ${missingRequired.join(', ')}.`;
    return false;
  }
  return true;
}

/** Stream the CSV a row at a time, mapping as we go: no raw row array is ever materialised,
 *  and a single reused row view feeds the mapper, so the parse costs one object, not 200,000. */
function streamRows<T>(text: string, mapRow: (r: Raw) => T | null): T[] {
  const out: T[] = [];
  let view: Record<string, string> | null = null;
  let set: ((cells: string[]) => void) | null = null;
  parseCsv(text, {
    onHeader: (h) => { const v = makeRowView(h); view = v.view; set = v.set; },
    onRow: (cells) => { set!(cells); const v = mapRow(view as Raw); if (v !== null) out.push(v); },
  });
  return out;
}

export type Progress = (loads: SheetLoad[], phase: string) => void;

export async function loadDataset(onProgress?: Progress, force = false): Promise<Dataset> {
  const loads: SheetLoad[] = SHEETS.map(blankLoad);
  const idx = Object.fromEntries(SHEETS.map((c, i) => [c.key, i])) as Record<SheetKey, number>;

  /* Fetch with a sliding window. Downloading all ten sheets at once would hold ~165 MB of CSV
     text resident before a single row is mapped; a window of two keeps the network busy while
     the text for a sheet lives only until that sheet is consumed. Order matches consumption. */
  const ORDER: SheetKey[] = ['new', 'checkins', 'bookings', 'sessions', 'recurring', 'teacherRecurring', 'sales', 'payroll', 'lapsed', 'leads'];
  const WINDOW = 2;
  const pending: Partial<Record<SheetKey, Promise<{ load: SheetLoad; text: string | null }>>> = {};
  let started = 0;
  const startNext = () => {
    while (started < ORDER.length && Object.keys(pending).length < WINDOW) {
      const key = ORDER[started++];
      const cfg = SHEETS.find((c) => c.key === key)!;
      pending[key] = fetchText(cfg, force).then((r) => {
        loads[idx[key]] = { ...loads[idx[key]], ...r.load };
        onProgress?.([...loads], `Fetched ${cfg.title}`);
        return r;
      });
    }
  };
  startNext();

  /** Await a sheet, stream-map it, then release the text. Nothing raw survives the call. */
  async function consume<T>(key: SheetKey, mapRow: ((r: Raw) => T | null) | null): Promise<T[]> {
    const cfg = SHEETS.find((c) => c.key === key)!;
    if (!pending[key]) startNext();
    const r = await pending[key]!;
    delete pending[key];                       // drop our only reference to the resolved text
    startNext();                               // refill the window now that a slot is free
    const load = loads[idx[key]];
    let out: T[] = [];
    if (r.text !== null && mapRow) {
      onProgress?.([...loads], `Reading ${cfg.title}`);
      if (validateHeader(cfg, r.text, load)) {
        out = streamRows(r.text, mapRow);
        load.rows = out.length;
        load.status = out.length ? 'ok' : 'empty';
        if (!out.length) { load.error = `Tab "${cfg.title}" loaded but holds only a header row.`; load.hint = 'Populate the tab; the modules render as soon as rows exist.'; }
      }
    } else if (r.text !== null) {
      /* The fetch succeeded but no mapper consumes this sheet. Reporting it as still "pending"
         implied a load that never finishes; it is read and deliberately unused. */
      validateHeader(cfg, r.text, load);
      load.status = 'unused';
      load.rows = Math.max(0, r.text.split('\n').filter((line) => line.trim()).length - 1);
      load.hint = `Fetched successfully and deliberately not ingested: nothing in the app reads "${cfg.title}". Its source-defined calculations are not reconciled against the app's own.`;
    }
    (r as { text: string | null }).text = null;
    onProgress?.([...loads], `Prepared ${cfg.title}`);
    return out;
  }

  resetPool();
  const defects: Defect[] = [];

  // New first: it supplies the member-name lookup that Bookings needs (Bookings is fetched without names).
  const names = new Map<string, string>();
  const newc = await consume('new', (r) => {
    const id = (r['Member Id'] ?? '').trim();
    if (id && !names.has(id)) { const n = `${(r['First Name'] ?? '').trim()} ${(r['Last Name'] ?? '').trim()}`.trim(); if (n) names.set(id, n); }
    return mapNewRow(r);
  });

  const ckStats: CheckinStats = { corrupted: 0 };
  const checkins = await consume('checkins', (r) => {
    const c = mapCheckinRow(r, ckStats);
    if (c.member_id && c.name && !names.has(c.member_id)) names.set(c.member_id, c.name);
    return c;
  });
  const corruptedDurations = ckStats.corrupted;
  if (corruptedDurations > 0) {
    defects.push({ id: 'checkins-duration-serial', sheet: 'Checkins', column: 'Duration (Minutes)',
      description: 'Values arrive as Excel serial dates (for example 1900-02-25) instead of a minute count. Set to NULL on ingest.',
      rowsAffected: corruptedDurations, impact: 'Teaching hours, revenue per hour, seat-hours and revenue per attendee-hour use a labelled 55-minute estimate and carry a ⚠.', status: 'open' });
  }

  let bookings = await consume('bookings', (r) => mapBookingRow(r, names));
  if (!bookings.length && checkins.length) {
    bookings = deriveBookings(checkins);
    const l = loads[idx.bookings]; l.status = 'derived'; l.rows = bookings.length;
    l.hint = `${l.error ?? ''} Bookings are rebuilt from Checkins (one row per booking). Cancellations made before the class are not visible in that source.`.trim();
  }

  // Session grain: the real sheet if readable, else rebuilt from Bookings (widest history, real
  // cancellations) with capacity joined from Checkins on UniqueID, else from Checkins alone.
  let sessions = await consume('sessions', (r) => mapSessionRow(r));
  await consume('recurring', null);
  await consume('teacherRecurring', null);
  /* Prefer Checkins: it carries a real Capacity per session, so fill rate is measured rather than
     estimated. Bookings is only used for the session grain when Checkins is unavailable, because it
     has no capacity column and the modal-capacity fallback produces fill rates above 100%. */
  let sessionSource = 'the Sessions sheet';
  if (!sessions.length && checkins.length) { sessions = deriveSessions(checkins, bookings); sessionSource = 'Checkins, with cancellations from Bookings'; }
  else if (!sessions.length && bookings.length) { sessions = deriveSessionsFromBookings(bookings, checkins); sessionSource = 'Bookings joined to Checkins'; }
  if (sessionSource !== 'the Sessions sheet') {
    for (const k of ['sessions', 'recurring', 'teacherRecurring'] as const) {
      const l = loads[idx[k]];
      l.status = 'derived'; l.rows = sessions.length;
      l.hint = `${l.error ?? ''} Session grain is rebuilt from ${sessionSource} — one row per class occurrence — until this tab is shared.`.trim();
    }
    let estimated = 0; for (const s of sessions) if (s.capacity_estimated) estimated++;
    if (estimated) defects.push({ id: 'capacity-estimated', sheet: 'Bookings', column: 'Capacity',
      description: 'Bookings carries no capacity column. Sessions that match a Checkins row by UniqueID use the real capacity; the rest use the modal capacity for that location and class.',
      rowsAffected: estimated, impact: 'Fill rate, unsold seats and revenue per seat are estimates for these sessions.', status: 'open' });
  }

  /* One canonical visit grain, built once, so every tab counts visits identically. */
  const visits = buildVisits(checkins, bookings);
  const ckOnly = visits.filter((v) => v.in_checkins && !v.in_bookings && v.attended).length;
  const bkOnly = visits.filter((v) => !v.in_checkins && v.in_bookings && v.attended).length;
  if (ckOnly + bkOnly > 0) defects.push({ id: 'visit-source-gap', sheet: 'Checkins / Bookings', column: 'attendance',
    description: `Bookings does not carry every attendance row: ${ckOnly.toLocaleString('en-IN')} attended visits appear in Checkins only, ${bkOnly.toLocaleString('en-IN')} in Bookings only.`,
    rowsAffected: ckOnly + bkOnly,
    impact: 'Visits are counted once from the reconciled visit grain (Checkins authoritative), so every tab agrees. Booking-lifecycle metrics — cancellation rate, lead time — can only be measured on rows Bookings does carry.', status: 'mitigated' });

  const sales = reconcileSales(await consume('sales', (r) => mapSaleRow(r)));
  const payroll = await consume('payroll', (r) => mapPayrollRow(r));

  /* The sheet's own net-of-VAT column does not reconcile with payment minus VAT on some rows. */
  let netMismatch = 0;
  for (const r of sales) {
    if (r.net === null || r.net_reported === null) continue;
    if (r.net_reported > r.net * 1.5 + 1) netMismatch++;
  }
  if (netMismatch) defects.push({ id: 'sales-net-vat', sheet: 'Sales', column: 'Price Excluding VAT In Currency',
    description: 'The column exceeds payment minus VAT on some rows — one observed row reads ₹400,000 against a ₹42,000 payment and a ₹40,000 unit price.',
    rowsAffected: netMismatch,
    impact: 'Net of VAT is derived as Payment Value − Payment VAT, falling back to unit price × quantity, so it can never exceed gross. The sheet column is retained only for this check.', status: 'mitigated' });

  /* Operational "today" is the IST wall clock. It used to be the latest timestamp in the sheets,
     which the schedule pushes into the future: classes booked for next week became part of the
     current period, every one of them with zero attendance, and fill rate collapsed. The latest
     observation is still useful — but as source freshness, reported separately. */
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const todayTs = Date.parse(`${today}T00:00:00Z`);
  let maxTs = 0;
  for (const arr of [sessions, checkins, sales, newc] as { ts: number | null }[][]) for (const r of arr) if (r.ts && r.ts > maxTs && r.ts <= todayTs) maxTs = r.ts;
  const dataThrough = maxTs ? new Date(maxTs).toISOString().slice(0, 10) : today;
  const scheduledAhead = (sessions as { date: string | null }[]).filter((r) => r.date !== null && r.date > today).length;
  if (scheduledAhead) defects.push({ id: 'sessions-scheduled-ahead', sheet: 'Sessions', column: 'Date',
    description: `${scheduledAhead.toLocaleString('en-IN')} session occurrences are dated after today — they are on the timetable but have not happened yet.`,
    rowsAffected: scheduledAhead,
    impact: 'Every relative period now ends at the IST date, so scheduled occurrences stay out of held-session, empty-session, fill and no-show figures. A custom period with an end date in the future will include them.', status: 'mitigated' });

  const lapsed = await consume('lapsed', (r) => mapLapsedRow(r, todayTs));
  const leads = await consume('leads', (r) => mapLeadRow(r, todayTs));

  /* Carry member-acquisition dimensions onto downstream financial and membership rows. Without
     this join, selecting a trainer, source or first-visit format would silently stop filtering on
     Sales and Retention. The original sale owner remains available as `sold_by`. */
  const profile = new Map<string, { trainer: string | null; format: typeof newc[number]['format']; source: string | null }>();
  for (const r of newc) if (r.member_id && !profile.has(r.member_id)) profile.set(r.member_id, { trainer: r.trainer, format: r.format, source: r.source });
  for (const r of sales) { const p = r.member_id ? profile.get(r.member_id) : null; if (p) { r.trainer = p.trainer; r.source = p.source; if (r.format === 'Unknown' || r.format === 'Other') r.format = p.format; } }
  for (const r of lapsed) { const p = r.member_id ? profile.get(r.member_id) : null; if (p) { r.trainer = p.trainer; r.format = p.format; r.source = p.source; } }
  const trainerFormats = new Map<string, Map<string, number>>();
  for (const r of sessions) if (r.trainer && r.format && r.format !== 'Unknown') { let m = trainerFormats.get(r.trainer); if (!m) { m = new Map(); trainerFormats.set(r.trainer, m); } m.set(r.format, (m.get(r.format) ?? 0) + 1); }
  for (const r of payroll) { const m = r.trainer ? trainerFormats.get(r.trainer) : null; if (m?.size) r.format = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] as typeof r.format; }

  let importCount = 0;
  for (const r of newc) if (r.is_import) importCount++;
  for (const r of bookings) if (r.is_import) importCount++;
  if (importCount) defects.push({ id: 'import-rows', sheet: 'New / Bookings', column: 'Payment Method = imported',
    description: 'Historical backfill rows dated 2020-01-01 17:30 carrying ₹0.', rowsAffected: importCount,
    impact: 'Excluded from revenue and lead-time metrics; included in attendance history when "Include imported rows" is on in the filter drawer.', status: 'mitigated' });

  let placeholders = 0;
  for (const r of newc) if (r.email && !r.contactable && /noemail/i.test(r.email)) placeholders++;
  for (const r of lapsed) if (r.email && !r.contactable && /noemail/i.test(r.email)) placeholders++;
  if (placeholders) defects.push({ id: 'placeholder-emails', sheet: 'New / Lapsed', column: 'Email',
    description: 'Placeholder addresses of the form noemail+NNN@gmail.com.', rowsAffected: placeholders,
    impact: 'Flagged non-contactable, excluded from contactability metrics and from worklists that need an email.', status: 'mitigated' });

  // Duplicate members on normalised email or phone — reported, never auto-merged.
  const byContact = new Map<string, Set<string>>();
  for (const r of newc) {
    const k = (r.contactable && r.email ? r.email.toLowerCase() : '') || (r.phone ?? '').replace(/\D/g, '');
    if (!k || !r.member_id) continue;
    let set = byContact.get(k); if (!set) { set = new Set(); byContact.set(k, set); } set.add(r.member_id);
  }
  let dupes = 0; for (const set of byContact.values()) if (set.size > 1) dupes += set.size - 1;
  if (dupes) defects.push({ id: 'duplicate-members', sheet: 'New', column: 'Email / Phone Number',
    description: 'The same person appears under more than one Member ID, matched on normalised email or phone.', rowsAffected: dupes,
    impact: 'Counts of unique members and LTV per member are slightly overstated. Not auto-merged — merge at source.', status: 'open' });

  for (const cfg of SHEETS) {
    const l = loads[idx[cfg.key]];
    if (l.status === 'empty') defects.push({ id: `${cfg.key}-empty`, sheet: cfg.title, column: '*',
      description: `The ${cfg.title} tab holds only a header row.`, rowsAffected: 0,
      impact: `The ${cfg.title} modules render their structure with empty states; rules that depend on them stay silent.`, status: 'open' });
  }

  onProgress?.([...loads], 'Ready');
  return { visits, sessions, checkins, sales, newc, lapsed, payroll, leads, bookings, loads, defects, today, todayTs, dataThrough, loadedAt: Date.now() };
}

/** Offline assembly used by scripts/render-test.mts — same code path, CSV text in, Dataset out. */
export async function buildDatasetFromText(texts: Partial<Record<SheetKey, string>>): Promise<Dataset> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const key = SHEETS.find((c) => resolveUrl(c) === url)?.key;
    const text = key ? (texts as Record<string, string | undefined>)[key] : undefined;
    if (text === undefined) return new Response('', { status: 401, headers: { 'content-type': 'text/html' } });
    return new Response(text, { status: 200, headers: { 'content-type': 'text/csv' } });
  }) as typeof fetch;
  try { return await loadDataset(undefined, true); } finally { globalThis.fetch = original; }
}
