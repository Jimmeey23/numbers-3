import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { Dataset } from '../src/data/types.ts';
import type { TableName } from '../src/semantics/metrics.ts';
import type { Filters } from '../src/state/filters.ts';

// The analytical modules also power the browser and initialise small Zustand stores on import.
// Provide inert browser globals before dynamically loading them in Node; no application state is
// read by the API — this only keeps the shared pure computation path single-sourced.
const memory = new Map<string, string>();
if (!('localStorage' in globalThis)) Object.assign(globalThis, { localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => memory.set(k, v), removeItem: (k: string) => memory.delete(k) } });
if (!('window' in globalThis)) Object.assign(globalThis, { window: { location: { hash: '' }, innerWidth: 1600, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false }) } });
if (!('document' in globalThis)) Object.assign(globalThis, { document: { documentElement: { getAttribute: () => 'matte', setAttribute() {} } } });
if (!('CustomEvent' in globalThis)) Object.assign(globalThis, { CustomEvent: class { constructor(public type: string, public detail?: unknown) {} } });

const { loadDataset } = await import('../src/data/ingest.ts');
const { METRIC_LIST } = await import('../src/semantics/metrics.ts');
const { DEFAULT_FILTERS } = await import('../src/state/filters.ts');
const { computeScope } = await import('../src/state/data.ts');
const { DEFAULT_THRESHOLDS } = await import('../src/state/view.ts');
const { ask } = await import('../src/api/ask.ts');
const { buildReport } = await import('../src/report/model.ts');
const { renderReport } = await import('../src/report/shell.ts');

/** Real HTTP surface for agents and third-party applications.
 *
 * Records are normalized (snake_case, ISO dates, INR numbers), PII-redacted by default, and
 * preceded by a machine-readable schema event when streamed. This makes the feed useful to an
 * LLM without forcing it to reverse engineer ten spreadsheet schemas or metric definitions.
 */

export const SOURCE_CATALOGUE: Record<string, { table: TableName; grain: string; description: string }> = {
  visits: { table: 'visits', grain: 'member × class occurrence', description: 'Canonical reconciled attendance grain; Checkins authoritative, booking lifecycle joined.' },
  sessions: { table: 'sessions', grain: 'class occurrence', description: 'Class capacity, attendance, booking and attributed revenue.' },
  checkins: { table: 'checkins', grain: 'check-in', description: 'Normalized attendance records from Checkins.' },
  bookings: { table: 'bookings', grain: 'booking', description: 'Booking lifecycle, cancellation, no-show and lead time.' },
  sales: { table: 'sales', grain: 'sale line', description: 'Payments, products, discounts and membership liabilities.' },
  acquisition: { table: 'newc', grain: 'new-client cohort record', description: 'First visit, conversion, return and lifetime value.' },
  memberships: { table: 'lapsed', grain: 'membership interval', description: 'Membership status, utilisation, renewal, churn and risk.' },
  payroll: { table: 'payroll', grain: 'trainer month', description: 'Sessions, customers, cost and commercial contribution.' },
  leads: { table: 'leads', grain: 'enquiry', description: 'Lead source, response, follow-up, status and pipeline.' },
};

const TABLE_KEYS = Object.values(SOURCE_CATALOGUE).map((s) => s.table);
const PII = new Set(['name', 'member_name', 'customer', 'email', 'phone', 'member_email', 'member_phone']);
const IDENTIFIERS = new Set(['member_id', 'sale_id', 'session_id', 'teacher_id', 'id']);
const DIMENSIONS = new Set(['date', 'month', 'location', 'location_short', 'trainer', 'format', 'day', 'slot', 'source', 'membership_type', 'status', 'stage', 'category', 'product', 'class_name']);
let datasetPromise: Promise<Dataset> | null = null;
let loadedAt = 0;

async function dataset() {
  if (!datasetPromise || Date.now() - loadedAt > 15 * 60_000) {
    datasetPromise = loadDataset(undefined, false).then((d) => { loadedAt = Date.now(); return d; });
    datasetPromise.catch(() => { datasetPromise = null; });
  }
  return datasetPromise;
}

const hashId = (value: unknown) => createHash('sha256').update(String(value)).digest('hex').slice(0, 16);

function safeRecord(row: Record<string, unknown>, includePii: boolean) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (PII.has(key) && !includePii) continue;
    if (IDENTIFIERS.has(key) && value !== null && !includePii) data[key] = hashId(value);
    else if (value instanceof Set || value instanceof Map) continue;
    else data[key] = value;
  }
  return data;
}

function schemaFor(source: string, rows: Record<string, unknown>[]) {
  const fields = new Map<string, { types: Set<string>; present: number; role: string }>();
  for (const row of rows.slice(0, 2_000)) for (const [key, value] of Object.entries(row)) {
    if (PII.has(key)) continue;
    let f = fields.get(key);
    if (!f) {
      f = { types: new Set(), present: 0, role: DIMENSIONS.has(key) ? 'dimension' : IDENTIFIERS.has(key) ? 'identifier' : 'attribute' };
      fields.set(key, f);
    }
    if (value !== null && value !== undefined) {
      f.present++;
      const type = Array.isArray(value) ? 'array' : typeof value;
      f.types.add(type);
      if (type === 'number' && f.role === 'attribute') f.role = 'measure';
    }
  }
  const meta = SOURCE_CATALOGUE[source];
  return {
    type: 'schema', apiVersion: '1.0', source, grain: meta.grain, description: meta.description,
    semantics: { dates: 'ISO-8601 UTC', currency: 'INR numeric values', nulls: 'unknown/not carried; never implicit zero', identifiers: 'SHA-256 pseudonyms unless the server explicitly enables PII' },
    fields: [...fields.entries()].map(([name, f]) => ({ name, types: [...f.types], role: f.role, sampledCoverage: rows.length ? f.present / Math.min(rows.length, 2_000) : null })),
    metricRegistry: `/api/v1/semantic-layer?table=${meta.table}`,
  };
}

function queryRows(ds: Dataset, source: string, url: URL): Record<string, unknown>[] {
  const meta = SOURCE_CATALOGUE[source];
  if (!meta) return [];
  let rows = (ds[meta.table] ?? []) as unknown as Record<string, unknown>[];
  const start = url.searchParams.get('start'); const end = url.searchParams.get('end');
  const locations = url.searchParams.getAll('location').flatMap((v) => v.split('|')).filter(Boolean);
  const formats = url.searchParams.getAll('classFormat').flatMap((v) => v.split('|')).filter(Boolean);
  if (start) rows = rows.filter((r) => !r.date || String(r.date) >= start);
  if (end) rows = rows.filter((r) => !r.date || String(r.date) <= end);
  if (locations.length) rows = rows.filter((r) => locations.includes(String(r.location ?? '')));
  if (formats.length) rows = rows.filter((r) => formats.includes(String(r.format ?? '')));
  return rows;
}

function cors(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', process.env.FLOOR_API_ORIGIN ?? '*');
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
}

const sendJson = (res: ServerResponse, status: number, value: unknown) => {
  res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value));
};

function filtersFrom(url: URL, ds: Dataset): Filters {
  const start = url.searchParams.get('start'); const end = url.searchParams.get('end');
  const locations = url.searchParams.getAll('location').flatMap((v) => v.split('|')).filter(Boolean);
  const formats = url.searchParams.getAll('classFormat').flatMap((v) => v.split('|')).filter(Boolean);
  const preset = (url.searchParams.get('preset') ?? (start || end ? 'custom' : 'month')) as Filters['preset'];
  return { ...DEFAULT_FILTERS, preset, start: start ?? null, end: end ?? ds.today, locations, formats };
}

function describe() {
  return {
    name: 'Floor Data API', version: '1.0', generated: new Date().toISOString(),
    privacy: 'PII is removed and identifiers are pseudonymised by default. PII requires FLOOR_API_INCLUDE_PII=true and ?pii=true.',
    endpoints: [
      { method: 'GET', path: '/api/v1/sources', use: 'Source catalogue and endpoint discovery.' },
      { method: 'GET', path: '/api/v1/sources/:source', use: 'Paginated normalized JSON. Add format=ndjson for a stream.' },
      { method: 'GET', path: '/api/v1/sources/:source/stream', use: 'NDJSON or SSE stream, starting with a schema envelope.' },
      { method: 'GET', path: '/api/v1/consolidated/stream', use: 'All selected grains in one AI-optimized NDJSON stream.' },
      { method: 'GET', path: '/api/v1/semantic-layer', use: 'Metric ids, formulas, sources and aggregation rules.' },
      { method: 'GET', path: '/api/v1/ask?q=…', use: 'Grounded natural-language answer from the same resolver as the app.' },
      { method: 'GET', path: '/api/v1/report?format=json|html', use: 'Generate an on-demand report for period/location query parameters.' },
      { method: 'GET', path: '/api/v1/health', use: 'Freshness, source status, row counts and defects.' },
    ],
    query: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', location: 'repeat or pipe-delimit', classFormat: 'repeat or pipe-delimit', cursor: 'zero-based row offset', limit: 'max 100000', transport: 'ndjson or sse' },
    sources: Object.entries(SOURCE_CATALOGUE).map(([id, s]) => ({ id, ...s, endpoint: `/api/v1/sources/${id}`, stream: `/api/v1/sources/${id}/stream` })),
  };
}

/** Connect/Vite and Node http compatible request handler. Returns false for non-API routes. */
export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) return false;
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  if (req.method !== 'GET') { sendJson(res, 405, { error: 'Method not allowed' }); return true; }

  try {
    if (url.pathname === '/api' || url.pathname === '/api/' || url.pathname === '/api/v1' || url.pathname === '/api/v1/') {
      sendJson(res, 200, describe()); return true;
    }
    if (url.pathname === '/api/v1/sources') {
      sendJson(res, 200, describe()); return true;
    }
    if (url.pathname === '/api/v1/semantic-layer') {
      const table = url.searchParams.get('table');
      sendJson(res, 200, {
        apiVersion: '1.0', nullPolicy: 'null means unknown/unavailable, never zero', rollupPolicy: 'weighted metrics recompute numerator/denominator; rates are never averaged',
        metrics: METRIC_LIST.filter((m) => !table || m.table === table).map((m) => ({ id: m.id, label: m.label, table: m.table, domain: m.domain, format: m.format, aggregation: m.aggregation, definition: m.description, formula: m.formula, sources: m.sources, higherIsBetter: m.higherIsBetter, minSample: m.minSample })),
      }); return true;
    }

    const ds = await dataset();
    if (url.pathname === '/api/v1/health') {
      sendJson(res, 200, { status: ds.loads.some((l) => l.status === 'error') ? 'degraded' : 'ok', dataThrough: ds.today, loadedAt: ds.loadedAt,
        sources: ds.loads.map((l) => ({ key: l.key, title: l.title, status: l.status, rows: l.rows, fetchedAt: l.fetchedAt, missingColumns: l.missing, error: l.error ?? null })), defects: ds.defects }); return true;
    }
    if (url.pathname === '/api/v1/ask') {
      const q = url.searchParams.get('q')?.trim();
      if (!q) { sendJson(res, 400, { error: 'Pass a question in ?q=' }); return true; }
      const scope = computeScope(ds, filtersFrom(url, ds), Number(url.searchParams.get('ratePerSession') ?? 1200), DEFAULT_THRESHOLDS);
      sendJson(res, 200, { ...ask(q, scope, DEFAULT_THRESHOLDS), apiVersion: '1.0' }); return true;
    }
    if (url.pathname === '/api/v1/report') {
      const filters = filtersFrom(url, ds); const scope = computeScope(ds, filters, Number(url.searchParams.get('ratePerSession') ?? 1200), DEFAULT_THRESHOLDS);
      const studio = filters.locations.length === 1 ? filters.locations[0] : (url.searchParams.get('title') ?? 'Physique 57 India');
      const report = buildReport(scope, DEFAULT_THRESHOLDS, studio);
      if (url.searchParams.get('format') === 'html') { res.statusCode = 200; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(renderReport(report)); }
      else sendJson(res, 200, report);
      return true;
    }

    const sourceMatch = url.pathname.match(/^\/api\/v1\/sources\/([^/]+)(?:\/(stream))?$/);
    const consolidated = url.pathname === '/api/v1/consolidated/stream';
    if (!sourceMatch && !consolidated) { sendJson(res, 404, { error: 'Unknown API endpoint', catalogue: '/api/v1' }); return true; }

    const requested = consolidated
      ? (url.searchParams.get('sources')?.split(',').filter((s) => SOURCE_CATALOGUE[s]) ?? Object.keys(SOURCE_CATALOGUE))
      : [decodeURIComponent(sourceMatch![1])];
    if (requested.some((s) => !SOURCE_CATALOGUE[s])) { sendJson(res, 404, { error: 'Unknown source', available: Object.keys(SOURCE_CATALOGUE) }); return true; }
    const cursor = Math.max(0, Number(url.searchParams.get('cursor') ?? 0) || 0);
    const limit = Math.min(100_000, Math.max(1, Number(url.searchParams.get('limit') ?? 5_000) || 5_000));
    const includePii = process.env.FLOOR_API_INCLUDE_PII === 'true' && url.searchParams.get('pii') === 'true';
    const stream = consolidated || sourceMatch?.[2] === 'stream' || url.searchParams.get('format') === 'ndjson' || url.searchParams.get('transport') === 'sse';

    if (!stream && requested.length === 1) {
      const source = requested[0]; const all = queryRows(ds, source, url); const page = all.slice(cursor, cursor + limit);
      sendJson(res, 200, { apiVersion: '1.0', source, schema: schemaFor(source, all), cursor, nextCursor: cursor + page.length < all.length ? cursor + page.length : null, total: all.length,
        records: page.map((r, i) => ({ source, ordinal: cursor + i, data: safeRecord(r, includePii) })) }); return true;
    }

    const sse = url.searchParams.get('transport') === 'sse';
    res.statusCode = 200;
    res.setHeader('content-type', sse ? 'text/event-stream; charset=utf-8' : 'application/x-ndjson; charset=utf-8');
    res.setHeader('x-accel-buffering', 'no');
    const emit = (event: unknown, name = 'record') => res.write(sse ? `event: ${name}\ndata: ${JSON.stringify(event)}\n\n` : `${JSON.stringify(event)}\n`);
    emit({ type: 'manifest', apiVersion: '1.0', sources: requested, dataThrough: ds.today, privacy: includePii ? 'pii-enabled' : 'redacted+pseudonymised' }, 'manifest');
    let emitted = 0;
    for (const source of requested) {
      const all = queryRows(ds, source, url); emit(schemaFor(source, all), 'schema');
      const page = all.slice(cursor, cursor + Math.max(0, limit - emitted));
      for (let i = 0; i < page.length; i++) {
        const row = page[i];
        emit({ type: 'record', source, grain: SOURCE_CATALOGUE[source].grain, ordinal: cursor + i, data: safeRecord(row, includePii), provenance: { normalized: true, dataThrough: ds.today } });
        emitted++;
        if (emitted >= limit || res.destroyed) break;
      }
      if (emitted >= limit || res.destroyed) break;
    }
    emit({ type: 'complete', emitted, cursor, nextCursor: emitted === limit ? cursor + emitted : null }, 'complete');
    res.end(); return true;
  } catch (error) {
    sendJson(res, 500, { error: 'API request failed', detail: (error as Error).message }); return true;
  }
}

export const API_TABLES = TABLE_KEYS;
