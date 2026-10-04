/* Rollup engine. Rates are always recomputed from their numerators and denominators — never averaged. */
import { computeMetric, metric, type MetricResult, type QueryContext } from './metrics';
import { fmtMonthShort, fmtTime12 } from './formats';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = any;

export interface GroupKeyDef { id: string; label: string; accessor: (r: Row) => string | null; display?: (k: string) => string; sort?: (a: string, b: string) => number }

/* People are grouped by identity, never by display name: two members called "Priya Sharma" are two
   members. The key carries the id, the label shows the name, and an id-less row stays on its own. */
const NAME_SEP = '\u0000';
const identity = (name: string | null | undefined, id: string | null | undefined): string | null =>
  id ? `${name ?? 'Unidentified'}${NAME_SEP}${id}` : (name ?? null);
const showName = (k: string) => { const i = k.indexOf(NAME_SEP); return i < 0 ? k : k.slice(0, i); };

const DAY_ORDER: Record<string, number> = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };

/* The risk ladder hangs off the operator's high-risk cut-off, so the bands, the KPI cards and the
   insight rail can never disagree about where "high risk" starts. computeScope keeps this in sync. */
let riskHigh = 60;
export const setRiskHigh = (v: number) => { riskHigh = v; };
const bandBounds = () => ({ critical: Math.min(100, riskHigh + 20), high: riskHigh, watch: Math.max(0, riskHigh - 20) });
export const riskBandLabels = (): string[] => {
  const b = bandBounds();
  return [`Critical (${b.critical}+)`, `High (${b.high}–${b.critical - 1})`, `Watch (${b.watch}–${b.high - 1})`, `Healthy (<${b.watch})`];
};
export const riskBandOf = (score: number | null | undefined): string | null => {
  if (score === null || score === undefined) return null;
  const b = bandBounds(); const l = riskBandLabels();
  return score >= b.critical ? l[0] : score >= b.high ? l[1] : score >= b.watch ? l[2] : l[3];
};

export const GROUP_KEYS: Record<string, GroupKeyDef> = {
  format: { id: 'format', label: 'Format', accessor: (r) => r.format },
  location: { id: 'location', label: 'Location', accessor: (r) => r.location, display: (k) => k },
  slot: { id: 'slot', label: 'Day + time', accessor: (r) => (r.day && r.time ? `${r.day} ${r.time}` : null), display: (k) => `${k.slice(0, 3)} ${fmtTime12(k.slice(-5))}`, sort: (a, b) => (DAY_ORDER[a.split(' ')[0]] - DAY_ORDER[b.split(' ')[0]]) || a.slice(-5).localeCompare(b.slice(-5)) },
  day: { id: 'day', label: 'Day', accessor: (r) => r.day, sort: (a, b) => DAY_ORDER[a] - DAY_ORDER[b] },
  time: { id: 'time', label: 'Time', accessor: (r) => r.time, display: fmtTime12 },
  timeslot: { id: 'timeslot', label: 'Time slot', accessor: (r) => r.slot, sort: (a, b) => ['Morning', 'Afternoon', 'Evening'].indexOf(a) - ['Morning', 'Afternoon', 'Evening'].indexOf(b) },
  trainer: { id: 'trainer', label: 'Trainer', accessor: (r) => r.trainer ?? r.teacher },
  month: { id: 'month', label: 'Month', accessor: (r) => r.month, display: fmtMonthShort },
  week: { id: 'week', label: 'Week', accessor: (r) => r.week },
  class_name: { id: 'class_name', label: 'Class', accessor: (r) => r.class_name ?? r.session_name },
  category: { id: 'category', label: 'Category', accessor: (r) => r.category },
  product: { id: 'product', label: 'Product', accessor: (r) => r.product ?? r.membership_name },
  sold_by: { id: 'sold_by', label: 'Salesperson', accessor: (r) => r.sold_by },
  method: { id: 'method', label: 'Payment method', accessor: (r) => r.method ?? r.payment_method },
  discount_code: { id: 'discount_code', label: 'Discount code', accessor: (r) => r.discount_code ?? 'None' },
  source: { id: 'source', label: 'Source', accessor: (r) => r.source },
  membership_type: { id: 'membership_type', label: 'Membership type', accessor: (r) => r.membership_type },
  membership_name: { id: 'membership_name', label: 'Membership', accessor: (r) => r.membership_name },
  status: { id: 'status', label: 'Status', accessor: (r) => r.status },
  lifecycle: { id: 'lifecycle', label: 'Lifecycle', accessor: (r) => r.lifecycle },
  speed_bucket: { id: 'speed_bucket', label: 'Conversion speed', accessor: (r) => r.speed_bucket },
  first_visit_type: { id: 'first_visit_type', label: 'Entry product', accessor: (r) => r.first_visit_entity },
  member: { id: 'member', label: 'Member', accessor: (r) => identity(r.name ?? r.member_name ?? r.customer, r.member_id), display: showName },
  channel: { id: 'channel', label: 'Channel', accessor: (r) => r.channel },
  associate: { id: 'associate', label: 'Associate', accessor: (r) => r.associate },
  lead: { id: 'lead', label: 'Lead', accessor: (r) => identity(r.name, r.id ?? r.member_id ?? r.email), display: showName },
  stage: { id: 'stage', label: 'Stage', accessor: (r) => r.stage },
  teacher: { id: 'teacher', label: 'Teacher', accessor: (r) => r.teacher ?? r.trainer },
  booking_method: { id: 'booking_method', label: 'Booking channel', accessor: (r) => r.booking_method },
  is_new: { id: 'is_new', label: 'New vs returning', accessor: (r) => (r.is_new === null ? null : r.is_new ? 'New' : 'Returning') },
  is_new_label: { id: 'is_new_label', label: 'Visit type', accessor: (r) => r.is_new_label },
  class_no_band: { id: 'class_no_band', label: 'Visit number', accessor: (r) => (r.class_no === null ? null : r.class_no <= 1 ? '1st' : r.class_no === 2 ? '2nd' : r.class_no <= 5 ? '3–5' : r.class_no <= 10 ? '6–10' : '11+') },
  capacity_band: { id: 'capacity_band', label: 'Room size', accessor: (r) => (r.capacity === null ? null : r.capacity <= 8 ? '≤8' : r.capacity <= 14 ? '9–14' : r.capacity <= 20 ? '15–20' : '21+') },
  hour: { id: 'hour', label: 'Hour', accessor: (r) => (r.hour === null || r.hour === undefined ? null : `${String(r.hour).padStart(2, '0')}:00`) },
  type: { id: 'type', label: 'Session type', accessor: (r) => (r.class_name && /hosted/i.test(r.class_name) ? 'Hosted' : 'Regular') },
  /* ── Visit-grain and behavioural groupings ── */
  session: { id: 'session', label: 'Class occurrence', accessor: (r) => r.session_key ?? r.session_id },
  slot_uid: { id: 'slot_uid', label: 'Recurring slot', accessor: (r) => r.slot_uid },
  member_name: { id: 'member_name', label: 'Member', accessor: (r) => identity(r.member_name ?? r.name ?? r.customer, r.member_id), display: showName },
  hour_of_day: { id: 'hour_of_day', label: 'Hour of day', accessor: (r) => (r.time ? `${r.time.slice(0, 2)}:00` : null), sort: (a, b) => a.localeCompare(b) },
  daypart: { id: 'daypart', label: 'Daypart', accessor: (r) => { const h = r.time ? +r.time.slice(0, 2) : null; if (h === null) return null; return h < 7 ? 'Early (before 7)' : h < 10 ? 'Prime morning (7–10)' : h < 12 ? 'Late morning (10–12)' : h < 17 ? 'Midday (12–17)' : h < 20 ? 'Prime evening (17–20)' : 'Late (20+)'; },
    sort: (a, b) => ['Early (before 7)', 'Prime morning (7–10)', 'Late morning (10–12)', 'Midday (12–17)', 'Prime evening (17–20)', 'Late (20+)'].indexOf(a) - ['Early (before 7)', 'Prime morning (7–10)', 'Late morning (10–12)', 'Midday (12–17)', 'Prime evening (17–20)', 'Late (20+)'].indexOf(b) },
  ampm: { id: 'ampm', label: 'AM / PM', accessor: (r) => r.time ? (+r.time.slice(0, 2) < 12 ? 'AM' : 'PM') : null },
  weekpart: { id: 'weekpart', label: 'Weekday / weekend', accessor: (r) => (r.day ? (r.day === 'Saturday' || r.day === 'Sunday' ? 'Weekend' : 'Weekday') : null) },
  quarter: { id: 'quarter', label: 'Quarter', accessor: (r) => (r.month ? `${r.month.slice(0, 4)} Q${Math.floor((+r.month.slice(5, 7) - 1) / 3) + 1}` : null) },
  year: { id: 'year', label: 'Year', accessor: (r) => (r.date ? r.date.slice(0, 4) : null) },
  outcome: { id: 'outcome', label: 'Booking outcome', accessor: (r) => (r.cancelled ? 'Cancelled ahead' : r.late_cancelled ? 'Late cancelled' : r.attended ? 'Attended' : r.no_show ? 'No-show' : 'Other') },
  visit_band: { id: 'visit_band', label: 'Visit number band', accessor: (r) => (r.class_no === null || r.class_no === undefined ? null : r.class_no <= 1 ? '1st visit' : r.class_no === 2 ? '2nd visit' : r.class_no <= 5 ? '3rd–5th' : r.class_no <= 10 ? '6th–10th' : r.class_no <= 25 ? '11th–25th' : '26th+'),
    sort: (a, b) => ['1st visit', '2nd visit', '3rd–5th', '6th–10th', '11th–25th', '26th+'].indexOf(a) - ['1st visit', '2nd visit', '3rd–5th', '6th–10th', '11th–25th', '26th+'].indexOf(b) },
  spend_band: { id: 'spend_band', label: 'Spend band', accessor: (r) => { const v = r.amount_paid ?? r.value ?? r.paid ?? r.ltv; if (v === null || v === undefined) return null; return v === 0 ? '₹0' : v < 2000 ? 'Under ₹2k' : v < 6000 ? '₹2k–6k' : v < 15000 ? '₹6k–15k' : v < 40000 ? '₹15k–40k' : '₹40k+'; },
    sort: (a, b) => ['₹0', 'Under ₹2k', '₹2k–6k', '₹6k–15k', '₹15k–40k', '₹40k+'].indexOf(a) - ['₹0', 'Under ₹2k', '₹2k–6k', '₹6k–15k', '₹15k–40k', '₹40k+'].indexOf(b) },
  risk_band: { id: 'risk_band', label: 'Risk band', accessor: (r) => riskBandOf(r.risk_score),
    sort: (a, b) => riskBandLabels().indexOf(a) - riskBandLabels().indexOf(b) },
  tenure_band: { id: 'tenure_band', label: 'Tenure band', accessor: (r) => { const d = r.duration_days ?? r.days_active; if (d === null || d === undefined) return null; return d < 31 ? 'Under a month' : d < 92 ? '1–3 months' : d < 183 ? '3–6 months' : d < 366 ? '6–12 months' : 'Over a year'; },
    sort: (a, b) => ['Under a month', '1–3 months', '3–6 months', '6–12 months', 'Over a year'].indexOf(a) - ['Under a month', '1–3 months', '3–6 months', '6–12 months', 'Over a year'].indexOf(b) },
  recency_band: { id: 'recency_band', label: 'Recency', accessor: (r) => { const d = r.days_since_last_visit; if (d === null || d === undefined) return null; return d <= 7 ? 'This week' : d <= 21 ? 'Within 3 weeks' : d <= 60 ? '3–8 weeks' : d <= 180 ? '2–6 months' : 'Over 6 months'; },
    sort: (a, b) => ['This week', 'Within 3 weeks', '3–8 weeks', '2–6 months', 'Over 6 months'].indexOf(a) - ['This week', 'Within 3 weeks', '3–8 weeks', '2–6 months', 'Over 6 months'].indexOf(b) },
  lead_time_band: { id: 'lead_time_band', label: 'Booking lead time', accessor: (r) => { const d = r.lead_time_days; if (d === null || d === undefined) return null; return d < 0.25 ? 'Under 6 hours' : d < 1 ? '6–24 hours' : d < 3 ? '1–3 days' : d < 7 ? '3–7 days' : 'A week or more'; },
    sort: (a, b) => ['Under 6 hours', '6–24 hours', '1–3 days', '3–7 days', 'A week or more'].indexOf(a) - ['Under 6 hours', '6–24 hours', '1–3 days', '3–7 days', 'A week or more'].indexOf(b) },
  touch_band: { id: 'touch_band', label: 'Follow-up count', accessor: (r) => (r.touches === null || r.touches === undefined ? null : `${r.touches} touch${r.touches === 1 ? '' : 'es'}`) },
  response_band: { id: 'response_band', label: 'Response speed', accessor: (r) => { const h = r.response_hours; if (h === null || h === undefined) return 'Never contacted'; return h < 1 ? 'Within the hour' : h < 4 ? '1–4 hours' : h < 24 ? '4–24 hours' : h < 72 ? '1–3 days' : 'Over 3 days'; },
    sort: (a, b) => ['Within the hour', '1–4 hours', '4–24 hours', '1–3 days', 'Over 3 days', 'Never contacted'].indexOf(a) - ['Within the hour', '1–4 hours', '4–24 hours', '1–3 days', 'Over 3 days', 'Never contacted'].indexOf(b) },
  utm_source: { id: 'utm_source', label: 'UTM source', accessor: (r) => r.utm_source },
  utm_medium: { id: 'utm_medium', label: 'UTM medium', accessor: (r) => r.utm_medium },
  utm_campaign: { id: 'utm_campaign', label: 'UTM campaign', accessor: (r) => r.utm_campaign },
  trial_status: { id: 'trial_status', label: 'Trial status', accessor: (r) => r.trial_status },
  contactable: { id: 'contactable', label: 'Contactable', accessor: (r) => (r.contactable === undefined ? null : r.contactable ? 'Contactable' : 'No usable contact') },
  source_coverage: { id: 'source_coverage', label: 'Source coverage', accessor: (r) => (r.in_checkins === undefined ? null : r.in_checkins && r.in_bookings ? 'Both sheets' : r.in_checkins ? 'Checkins only' : 'Bookings only') },

  // Overview scorecard keys (rows are pre-shaped {location, domainLabel, metricLabel})
  ov_location: { id: 'ov_location', label: 'Location', accessor: (r) => r.location },
  ov_domain: { id: 'ov_domain', label: 'Domain', accessor: (r) => r.domainLabel },
  ov_metric: { id: 'ov_metric', label: 'Metric', accessor: (r) => r.metricLabel },
};

export interface RollupNode {
  id: string;
  key: string;
  keyId: string;
  label: string;
  level: number;
  rows: Row[];
  values: Record<string, MetricResult>;
  children?: RollupNode[];
  path: string[];
}

export function metricValues(rows: Row[], ids: string[], ctx: QueryContext): Record<string, MetricResult> {
  const out: Record<string, MetricResult> = {};
  for (const id of ids) out[id] = computeMetric(metric(id), rows, ctx);
  return out;
}

export function groupRows(rows: Row[], key: GroupKeyDef): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key.accessor(r) ?? '(none)';
    let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(r);
  }
  return m;
}

/** Builds one level; children are built lazily via `expandNode`. */
export function rollupLevel(rows: Row[], keyIds: string[], level: number, metricIds: string[], ctx: QueryContext, path: string[] = []): RollupNode[] {
  const key = GROUP_KEYS[keyIds[level]];
  if (!key) return [];
  const groups = groupRows(rows, key);
  const nodes: RollupNode[] = [];
  for (const [k, rs] of groups) {
    nodes.push({ id: [...path, k].join('›'), key: k, keyId: key.id, label: key.display ? key.display(k) : k, level, rows: rs, values: metricValues(rs, metricIds, ctx), path: [...path, k] });
  }
  if (key.sort) nodes.sort((a, b) => key.sort!(a.key, b.key));
  return nodes;
}

export function totals(rows: Row[], metricIds: string[], ctx: QueryContext) { return metricValues(rows, metricIds, ctx); }

/* ---------- Time series ---------- */
export function seriesBy(rows: Row[], bucket: (r: Row) => string | null, metricIds: string[], ctx: QueryContext, keys?: string[]) {
  const m = new Map<string, Row[]>();
  for (const r of rows) { const k = bucket(r); if (!k) continue; let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(r); }
  const ks = keys ?? [...m.keys()].sort();
  return ks.map((k) => ({ key: k, rows: m.get(k) ?? [], values: metricValues(m.get(k) ?? [], metricIds, ctx) }));
}

export function lastNMonths(endMonth: string, n: number): string[] {
  const y = +endMonth.slice(0, 4); const mo = +endMonth.slice(5, 7);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(y, mo - 1 - i, 1)); out.push(d.toISOString().slice(0, 7)); }
  return out;
}

/** Current month plus at least thirteen completed months for inclusive year-over-year history. */
export function historyMonths(currentMonth: string, n = 14): string[] {
  return lastNMonths(currentMonth, Math.max(14, n));
}

/* ---------- Ranking & stats ---------- */
export function zscores(values: (number | null)[]): (number | null)[] {
  const v = values.filter((x): x is number => x !== null);
  if (v.length < 2) return values.map(() => null);
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) || 1;
  return values.map((x) => (x === null ? null : (x - m) / sd));
}

export function compositeScore(nodes: RollupNode[], weights: { id: string; w: number; invert?: boolean }[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const zs = weights.map((w) => zscores(nodes.map((n) => n.values[w.id]?.value ?? null)).map((z) => (z === null ? null : w.invert ? -z : z)));
  nodes.forEach((n, i) => {
    let s = 0; let tw = 0;
    weights.forEach((w, j) => { const z = zs[j][i]; if (z !== null) { s += w.w * z; tw += w.w; } });
    out.set(n.id, tw ? s / tw : null);
  });
  return out;
}

export function slotFillMap(sessions: Row[]): Map<string, number> {
  const m = new Map<string, { a: number; c: number }>();
  for (const r of sessions) { const k = `${r.location}|${r.day}|${r.time}|${r.format}`; const e = m.get(k) ?? { a: 0, c: 0 }; e.a += r.checked_in ?? 0; e.c += r.capacity ?? 0; m.set(k, e); }
  const out = new Map<string, number>();
  for (const [k, e] of m) if (e.c) out.set(k, e.a / e.c);
  return out;
}

export const percentile = (vals: number[], p: number) => { if (!vals.length) return null; const s = [...vals].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i); const hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
