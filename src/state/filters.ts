import { create } from 'zustand';
import type { Dims } from '../data/types';
import type { TableName } from '../semantics/metrics';

export type Preset =
  | 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month'
  | 'mtd' | '30d' | '90d' | 'month' | 'quarter' | 'ytd' | '12m' | 'all' | 'custom';
export type Compare = 'prior' | 'yoy' | 'none';
export interface Transient { dim: string; value: string; label?: string }

export interface Filters {
  preset: Preset;
  start: string | null;
  end: string | null;
  compare: Compare;
  locations: string[];
  trainers: string[];
  formats: string[];
  days: string[];
  slots: string[];
  sources: string[];
  membershipTypes: string[];
  newVsReturning: 'all' | 'new' | 'returning';
  includeImports: boolean;
  transient: Transient[];
}

export const DEFAULT_FILTERS: Filters = {
  preset: 'month', start: null, end: null, compare: 'prior',
  locations: [], trainers: [], formats: [], days: [], slots: [], sources: [], membershipTypes: [],
  newVsReturning: 'all', includeImports: false, transient: [],
};

const LIST_KEYS = ['locations', 'trainers', 'formats', 'days', 'slots', 'sources', 'membershipTypes'] as const;

export function encodeFilters(f: Filters): string {
  const p = new URLSearchParams();
  if (f.preset !== DEFAULT_FILTERS.preset) p.set('p', f.preset);
  if (f.start) p.set('s', f.start); if (f.end) p.set('e', f.end);
  if (f.compare !== 'prior') p.set('c', f.compare);
  for (const k of LIST_KEYS) if (f[k].length) p.set(k, f[k].join('|'));
  if (f.newVsReturning !== 'all') p.set('n', f.newVsReturning);
  if (f.includeImports) p.set('imp', '1');
  if (f.transient.length) p.set('x', f.transient.map((t) => `${t.dim}:${t.value}`).join('|'));
  return p.toString();
}
export function decodeFilters(qs: string): Partial<Filters> {
  const p = new URLSearchParams(qs); const out: Partial<Filters> = {};
  if (p.get('p')) out.preset = p.get('p') as Preset;
  if (p.get('s')) out.start = p.get('s'); if (p.get('e')) out.end = p.get('e');
  if (p.get('c')) out.compare = p.get('c') as Compare;
  for (const k of LIST_KEYS) if (p.get(k)) out[k] = p.get(k)!.split('|');
  if (p.get('n')) out.newVsReturning = p.get('n') as Filters['newVsReturning'];
  if (p.get('imp')) out.includeImports = true;
  if (p.get('x')) out.transient = p.get('x')!.split('|').map((s) => { const i = s.indexOf(':'); return { dim: s.slice(0, i), value: s.slice(i + 1) }; });
  return out;
}

interface FilterState {
  filters: Filters;
  set: (patch: Partial<Filters>) => void;
  replace: (f: Filters) => void;
  reset: () => void;
  addTransient: (t: Transient) => void;
  removeTransient: (i: number) => void;
  clearTransient: () => void;
  activeCount: () => number;
}

const fromUrl = (): Filters => ({ ...DEFAULT_FILTERS, ...decodeFilters(window.location.hash.split('?')[1] ?? '') });

export const useFilters = create<FilterState>((set, get) => ({
  filters: fromUrl(),
  set: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  replace: (f) => set({ filters: f }),
  reset: () => set({ filters: { ...DEFAULT_FILTERS } }),
  addTransient: (t) => set((s) => (s.filters.transient.some((x) => x.dim === t.dim && x.value === t.value) ? s : { filters: { ...s.filters, transient: [...s.filters.transient, t] } })),
  removeTransient: (i) => set((s) => ({ filters: { ...s.filters, transient: s.filters.transient.filter((_, j) => j !== i) } })),
  clearTransient: () => set((s) => ({ filters: { ...s.filters, transient: [] } })),
  activeCount: () => { const f = get().filters; let n = 0; for (const k of LIST_KEYS) if (f[k].length) n++; if (f.newVsReturning !== 'all') n++; if (f.includeImports) n++; if (f.preset !== DEFAULT_FILTERS.preset) n++; return n + f.transient.length; },
}));

/* ---------- Period resolution ---------- */
export interface Period { start: string; end: string; prevStart: string; prevEnd: string; label: string; prevLabel: string; days: number }
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const lbl = (s: string, e: string) => `${+s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4) !== e.slice(0, 4) ? s.slice(0, 4) + ' ' : ''}– ${+e.slice(8, 10)} ${MON[+e.slice(5, 7) - 1]} ${e.slice(0, 4)}`;

export function resolvePeriod(f: Filters, today: string): Period {
  const t = new Date(today + 'T00:00:00Z');
  let start: string; let end = today; let label = '';
  switch (f.preset) {
    case 'today': start = today; label = `Today · ${+today.slice(8, 10)} ${MON[t.getUTCMonth()]}`; break;
    case 'yesterday': start = addDays(today, -1); end = start; label = `Yesterday · ${+start.slice(8, 10)} ${MON[+start.slice(5, 7) - 1]}`; break;
    case 'this_week': {
      const mondayOffset = (t.getUTCDay() + 6) % 7;
      start = addDays(today, -mondayOffset); label = 'This week'; break;
    }
    case 'last_week': {
      const mondayOffset = (t.getUTCDay() + 6) % 7;
      end = addDays(today, -(mondayOffset + 1)); start = addDays(end, -6); label = 'Last week'; break;
    }
    case 'mtd':
    case 'this_month': start = today.slice(0, 8) + '01'; label = `${MON[t.getUTCMonth()]} ${t.getUTCFullYear()} to date`; break;
    case '30d': start = addDays(today, -29); label = 'Last 30 days'; break;
    case '90d': start = addDays(today, -89); label = 'Last 90 days'; break;
    case 'month':
    case 'last_month': { const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1)); start = iso(d); end = iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0))); label = `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; break; }
    case 'quarter': { const q = Math.floor(t.getUTCMonth() / 3); start = iso(new Date(Date.UTC(t.getUTCFullYear(), q * 3, 1))); label = `Q${q + 1} ${t.getUTCFullYear()} to date`; break; }
    case 'ytd': start = `${t.getUTCFullYear()}-01-01`; label = `${t.getUTCFullYear()} to date`; break;
    case '12m': start = addDays(iso(new Date(Date.UTC(t.getUTCFullYear() - 1, t.getUTCMonth(), t.getUTCDate()))), 1); label = 'Last 12 months'; break;
    case 'all': start = '2020-01-01'; label = 'All time'; break;
    case 'custom': start = f.start ?? addDays(today, -89); end = f.end ?? today; label = lbl(start, end); break;
    default: start = addDays(today, -89); label = 'Last 90 days';
  }
  const days = Math.round((new Date(end + 'T00:00:00Z').getTime() - new Date(start + 'T00:00:00Z').getTime()) / 864e5) + 1;
  /* Comparison windows are calendar-aware, not rolling. A month compares with the previous month,
     a quarter-to-date with the same days of the previous quarter, and year-to-date with the same
     dates last year — otherwise a seasonal business is compared against the wrong part of the year. */
  let prevStart: string; let prevEnd: string; let prevLabel: string;
  const sd = new Date(start + 'T00:00:00Z'); const ed = new Date(end + 'T00:00:00Z');
  const shiftYears = (d: Date, n: number) => iso(new Date(Date.UTC(d.getUTCFullYear() - n, d.getUTCMonth(), d.getUTCDate())));
  const shiftMonths = (d: Date, n: number) => {
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    return iso(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastDay))));
  };
  if (f.compare === 'yoy') {
    prevStart = shiftYears(sd, 1); prevEnd = shiftYears(ed, 1); prevLabel = 'same period last year';
  } else if (f.preset === 'this_week') {
    prevStart = addDays(start, -7); prevEnd = addDays(end, -7); prevLabel = 'same days last week';
  } else if (f.preset === 'month' || f.preset === 'last_month') {
    prevStart = iso(new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth() - 1, 1)));
    prevEnd = iso(new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), 0)));
    prevLabel = `${MON[new Date(prevStart + 'T00:00:00Z').getUTCMonth()]} ${prevStart.slice(0, 4)}`;
  } else if (f.preset === 'mtd' || f.preset === 'this_month') {
    prevStart = shiftMonths(sd, 1); prevEnd = shiftMonths(ed, 1);
    prevLabel = `${MON[new Date(prevStart + 'T00:00:00Z').getUTCMonth()]} 1–${new Date(prevEnd + 'T00:00:00Z').getUTCDate()}`;
  } else if (f.preset === 'quarter') {
    prevStart = shiftMonths(sd, 3); prevEnd = shiftMonths(ed, 3);
    prevLabel = `same days of Q${Math.floor(new Date(prevStart + 'T00:00:00Z').getUTCMonth() / 3) + 1}`;
  } else if (f.preset === 'ytd') {
    prevStart = shiftYears(sd, 1); prevEnd = shiftYears(ed, 1);
    prevLabel = `${prevStart.slice(0, 4)} to the same date`;
  } else if (f.preset === '12m') {
    prevStart = shiftYears(sd, 1); prevEnd = shiftYears(ed, 1); prevLabel = 'the 12 months before that';
  } else {
    prevEnd = addDays(start, -1); prevStart = addDays(prevEnd, -(days - 1)); prevLabel = 'prior period';
  }
  return { start, end, prevStart, prevEnd, label, prevLabel, days };
}

/* ---------- Predicate ---------- */
export const TABLE_DIMS: Record<TableName, (keyof Dims)[]> = {
  visits: ['location', 'trainer', 'format', 'day', 'slot', 'membership_type', 'is_new'],
  sessions: ['location', 'trainer', 'format', 'day', 'slot'],
  checkins: ['location', 'trainer', 'format', 'day', 'slot', 'membership_type', 'is_new'],
  bookings: ['location', 'trainer', 'format', 'day', 'slot', 'membership_type', 'is_new'],
  sales: ['location', 'trainer', 'format', 'day', 'slot', 'source', 'membership_type'],
  newc: ['location', 'trainer', 'format', 'day', 'slot', 'source', 'membership_type', 'is_new'],
  lapsed: ['location', 'trainer', 'format', 'source', 'membership_type'],
  payroll: ['location', 'trainer', 'format'],
  leads: ['location', 'trainer', 'format', 'source'],
};

export function buildPredicate(f: Filters, table: TableName, start: string, end: string) {
  const dims = TABLE_DIMS[table];
  const has = (k: keyof Dims) => dims.includes(k);
  const sets = {
    location: new Set(f.locations), trainer: new Set(f.trainers), format: new Set(f.formats), day: new Set(f.days),
    slot: new Set(f.slots), source: new Set(f.sources), membership_type: new Set(f.membershipTypes),
  };
  const transient = f.transient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r: any): boolean => {
    if (table === 'lapsed') {
      // membership live during the period
      const s = r.start_date ?? r.purchase_date; const e = r.end_date;
      if (s && s > end) return false;
      if (e && e < start && r.status !== 'Active') return false;
    } else if (r.date !== null) { if (r.date < start || r.date > end) return false; }
    if (!f.includeImports && r.is_import) return false;
    if (has('location') && sets.location.size && !sets.location.has(r.location)) return false;
    if (has('trainer') && sets.trainer.size && !sets.trainer.has(r.trainer)) return false;
    if (has('format') && sets.format.size && !sets.format.has(r.format)) return false;
    if (has('day') && sets.day.size && !sets.day.has(r.day)) return false;
    if (has('slot') && sets.slot.size && !sets.slot.has(r.slot)) return false;
    if (has('source') && sets.source.size && !sets.source.has(r.source)) return false;
    if (has('membership_type') && sets.membership_type.size && !sets.membership_type.has(r.membership_type)) return false;
    if (has('is_new') && f.newVsReturning !== 'all' && r.is_new !== null && r.is_new !== (f.newVsReturning === 'new')) return false;
    for (const t of transient) {
      if (t.dim === 'month') { if (r.month !== t.value) return false; continue; }
      if (t.dim === 'daytime') { if (`${r.day} ${r.time}` !== t.value) return false; continue; }
      if (!(t.dim in r)) continue;                       // dimension not carried by this table
      if (String(r[t.dim]) !== t.value) return false;
    }
    return true;
  };
}
