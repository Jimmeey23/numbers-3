import { create } from 'zustand';
import { useMemo } from 'react';
import { loadDataset } from '../data/ingest';
import type { Dataset, SheetLoad } from '../data/types';
import { SHEETS } from '../data/sheets.config';
import { buildPredicate, resolvePeriod, useFilters, type Filters, type Period } from './filters';
import { useView, DEFAULT_THRESHOLDS, type Thresholds } from './view';
import type { QueryContext, TableName } from '../semantics/metrics';
import { slotFillMap, type Row } from '../semantics/aggregations';

interface DataState {
  dataset: Dataset | null;
  loads: SheetLoad[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  load: (force?: boolean) => Promise<void>;
}

export const useData = create<DataState>((set, get) => ({
  dataset: null,
  loads: SHEETS.map((c) => ({ key: c.key, title: c.title, spreadsheetId: c.spreadsheetId, status: 'pending', rows: 0, columns: [], expected: c.expected, missing: [], extra: [], loadMs: 0, fromCache: false, fetchedAt: null })),
  status: 'idle', error: null,
  load: async (force = false) => {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      const ds = await loadDataset((loads) => set({ loads }), force);
      set({ dataset: ds, loads: ds.loads, status: 'ready' });
    } catch (e) { set({ status: 'error', error: (e as Error).message }); }
  },
}));

export interface Scope {
  period: Period;
  filters: Filters;
  ctx: QueryContext;
  tables: Record<TableName, Row[]>;        // current period
  compare: Record<TableName, Row[]>;       // comparison period
  all: Record<TableName, Row[]>;           // dimension-filtered, no period (for trends / MoM)
  rowsInScope: number;
  today: string;
}

const TABLES: TableName[] = ['visits', 'sessions', 'checkins', 'sales', 'newc', 'lapsed', 'payroll', 'leads', 'bookings'];
const EMPTY = Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Record<TableName, Row[]>;

let cache: { sig: string; scope: Scope } | null = null;
let allCache: { sig: string; all: Record<TableName, Row[]> } | null = null;

export function computeScope(ds: Dataset, filters: Filters, ratePerSession: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): Scope {
  const sig = JSON.stringify([filters, ratePerSession, thresholds, ds.loadedAt]);
  if (cache && cache.sig === sig) return cache.scope;
  const period = resolvePeriod(filters, ds.today);
  const pick = (start: string, end: string) => {
    const out = { ...EMPTY };
    for (const t of TABLES) { const pred = buildPredicate(filters, t, start, end); out[t] = ds[t].filter(pred); }
    return out;
  };
  const tables = pick(period.start, period.end);
  const compare = filters.compare === 'none' ? { ...EMPTY } : pick(period.prevStart, period.prevEnd);
  const dimSig = JSON.stringify([{ ...filters, preset: 0, start: 0, end: 0, compare: 0 }, ds.loadedAt]);
  const all = allCache && allCache.sig === dimSig ? allCache.all : pick('2000-01-01', '2100-01-01');
  allCache = { sig: dimSig, all };
  const durationSuspect = ds.defects.some((d) => d.id === 'checkins-duration-serial' && d.status === 'open');
  const ctx: QueryContext = {
    ratePerSession, todayTs: ds.todayTs, durationDefaultMin: 55, durationSuspect, slotFill: slotFillMap(all.sessions),
    dormantDays: thresholds.dormantDays, riskHigh: thresholds.riskHigh, zeroUsageDays: thresholds.zeroUsageDays,
    matureDays: thresholds.matureDays, medianFirstMembership: thresholds.medianFirstMembership,
  };
  const rowsInScope = TABLES.reduce((a, t) => a + tables[t].length, 0);
  const scope: Scope = { period, filters, ctx, tables, compare, all, rowsInScope, today: ds.today };
  cache = { sig, scope };
  return scope;
}

export function useScope(): Scope | null {
  const ds = useData((s) => s.dataset);
  const filters = useFilters((s) => s.filters);
  const rate = useView((s) => s.ratePerSession);
  const thresholds = useView((s) => s.thresholds);
  return useMemo(() => (ds ? computeScope(ds, filters, rate, thresholds) : null), [ds, filters, rate, thresholds]);
}

/** Distinct option lists for the filter drawer, with row counts. */
export function useOptions() {
  const ds = useData((s) => s.dataset);
  return useMemo(() => {
    const count = (rows: Row[], f: (r: Row) => string | null) => { const m = new Map<string, number>(); for (const r of rows) { const k = f(r); if (k) m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n })); };
    if (!ds) return { locations: [], trainers: [], formats: [], sources: [], membershipTypes: [] };
    const everything = [...ds.sessions, ...ds.checkins, ...ds.sales, ...ds.newc, ...ds.lapsed, ...ds.bookings] as Row[];
    return {
      locations: count(everything, (r) => r.location),
      trainers: count([...ds.sessions, ...ds.checkins, ...ds.newc, ...ds.payroll] as Row[], (r) => r.trainer),
      formats: count([...ds.sessions, ...ds.checkins, ...ds.newc] as Row[], (r) => r.format),
      sources: count(ds.newc as Row[], (r) => r.source),
      membershipTypes: count([...ds.sales, ...ds.lapsed, ...ds.checkins] as Row[], (r) => r.membership_type),
    };
  }, [ds]);
}
