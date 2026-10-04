/* Term resolution.
 *
 * An agent answering "I can't find draw premium in these sheets" is looking at raw sheet columns
 * instead of the metric registry — where `draw_premium_pp` is defined, documented and computable.
 * This module makes every business term in the product resolvable: metric labels, ids, the words
 * in their descriptions and formulas, plus an explicit synonym table for the vocabulary an
 * operator actually uses ("churn", "no shows", "walk-ins", "revenue per head").
 */
import { METRIC_LIST, metric, type MetricDef, type TableName } from '../semantics/metrics';
import { GROUP_KEYS } from '../semantics/aggregations';

/* Operator vocabulary → metric id. The left side is how people speak; the right side is the
   registry. Multi-word phrases are matched before single tokens. */
const SYNONYMS: Record<string, string> = {
  'draw premium': 'draw_premium_pp', 'draw': 'draw_premium_pp', 'trainer draw': 'draw_premium_pp',
  'pull': 'draw_premium_pp', 'trainer pull': 'draw_premium_pp', 'star power': 'draw_premium_pp',
  'fill': 'v_fill_rate', 'fill rate': 'v_fill_rate', 'occupancy': 'v_fill_rate', 'utilisation of classes': 'v_fill_rate',
  'full': 'v_fill_rate', 'how full': 'v_fill_rate', 'capacity used': 'v_fill_rate',
  'visits': 'visits', 'attendance': 'visits', 'attendees': 'visits', 'check ins': 'visits', 'checkins': 'visits',
  'footfall': 'visits', 'turnout': 'visits', 'bums on seats': 'visits', 'people in class': 'visits',
  'bookings': 'v_booked', 'booked': 'v_booked', 'reservations': 'v_booked',
  'no shows': 'v_no_show_rate', 'no show': 'v_no_show_rate', 'did not turn up': 'v_no_show_rate', 'ghosted': 'v_no_show_rate',
  'late cancels': 'v_late_cancel_rate', 'late cancellations': 'v_late_cancel_rate', 'last minute cancels': 'v_late_cancel_rate',
  'cancellations': 'v_cancel_rate', 'cancel rate': 'v_cancel_rate',
  'show up': 'v_show_up_rate', 'show up rate': 'v_show_up_rate', 'turn up rate': 'v_show_up_rate',
  'revenue': 'gross_revenue', 'sales': 'gross_revenue', 'turnover': 'gross_revenue', 'takings': 'gross_revenue',
  'top line': 'gross_revenue', 'money': 'gross_revenue', 'income': 'gross_revenue',
  'net': 'net_revenue', 'net revenue': 'net_revenue', 'ex vat': 'net_revenue', 'excluding vat': 'net_revenue',
  'aov': 'aov', 'average order': 'aov', 'basket': 'aov', 'average spend': 'aov', 'ticket size': 'aov',
  'arpu': 'arpu', 'revenue per member': 'v_rev_per_member', 'revenue per head': 'v_rev_per_visit',
  'revenue per visit': 'v_rev_per_visit', 'yield': 'rev_pas', 'revenue per seat': 'rev_pas', 'revpas': 'rev_pas',
  'revenue per attendee': 'rev_pac', 'revpac': 'rev_pac',
  'discount': 'discount_rate', 'discounting': 'discount_rate', 'markdown': 'discount_rate',
  'churn': 'churn_rate', 'churn rate': 'churn_rate', 'leaving': 'churn_rate', 'lost members': 'churn_rate',
  'attrition': 'churn_rate', 'drop off': 'churn_rate', 'lapsing': 'churn_rate',
  'retention': 'retention_rate', 'retained': 'retention_rate', 'sticking': 'retention_rate',
  'renewal': 'renewal_rate', 'renewals': 'renewal_rate', 'resign': 'renewal_rate',
  'grr': 'gross_revenue_retention', 'revenue retention': 'gross_revenue_retention',
  'risk': 'risk_score', 'risk score': 'risk_score', 'at risk': 'high_risk_members', 'flight risk': 'risk_score',
  'conversion': 'conversion_rate', 'convert': 'conversion_rate', 'trial conversion': 'conversion_rate',
  'second visit': 'second_visit_rate', 'came back': 'second_visit_rate', 'return rate': 'second_visit_rate',
  'never returned': 'zero_return_rate', 'one and done': 'zero_return_rate',
  'ltv': 'median_ltv', 'lifetime value': 'median_ltv', 'customer value': 'median_ltv', 'member value': 'member_ltv',
  'new clients': 'new_clients', 'new members': 'new_clients', 'first timers': 'new_clients', 'newcomers': 'new_clients',
  'leads': 'leads', 'enquiries': 'leads', 'enquiry': 'leads',
  'win rate': 'lead_conversion_rate', 'lead conversion': 'lead_conversion_rate',
  'response time': 'response_time_hours', 'speed to lead': 'response_time_hours', 'first response': 'response_time_hours',
  'untouched': 'untouched_leads', 'not contacted': 'untouched_leads',
  'pipeline': 'pipeline_value', 'open leads': 'open_leads',
  'utilisation': 'utilisation', 'utilization': 'utilisation', 'sessions used': 'utilisation',
  'dormant': 'dormant_actives', 'inactive': 'dormant_actives', 'absent': 'avg_days_since_visit',
  'empty classes': 'empty_sessions', 'empty': 'empty_sessions', 'nobody turned up': 'empty_sessions',
  'margin': 'p_margin', 'contribution': 'p_contribution', 'profit': 'p_contribution',
  'payroll': 'p_cost', 'trainer cost': 'p_cost', 'wage': 'p_cost', 'cost': 'p_cost',
  'classes': 'v_sessions', 'sessions': 'v_sessions', 'class count': 'v_sessions', 'occurrences': 'v_sessions',
  'slots': 'v_slots', 'timetable': 'v_slots',
  'members': 'v_unique_members', 'unique members': 'v_unique_members', 'distinct members': 'v_unique_members',
  'active members': 'active_memberships', 'active': 'active_memberships',
  'frequency': 'v_visits_per_member', 'visits per member': 'v_visits_per_member', 'how often': 'v_visits_per_member',
  'power users': 'v_power_users', 'regulars': 'v_power_users',
  'lead time': 'v_lead_time', 'how far ahead': 'v_lead_time', 'advance booking': 'v_lead_time',
  'comps': 'v_complimentary_rate', 'complimentary': 'v_complimentary_rate', 'free': 'v_complimentary_rate',
  'liability': 'liability', 'unused': 'liability', 'owed': 'liability',
  'consistency': 'attendance_cv', 'variability': 'attendance_cv',
  'break even': 'break_even_class_size', 'breakeven': 'break_even_class_size',
};

/* Dimension vocabulary → group key. */
const DIM_SYNONYMS: Record<string, string> = {
  'studio': 'location', 'studios': 'location', 'site': 'location', 'branch': 'location', 'venue': 'location', 'location': 'location', 'locations': 'location',
  'trainer': 'trainer', 'trainers': 'trainer', 'teacher': 'trainer', 'teachers': 'trainer', 'instructor': 'trainer', 'coach': 'trainer', 'who teaches': 'trainer',
  'class': 'class_name', 'classes': 'class_name', 'class type': 'class_name', 'format': 'format', 'formats': 'format', 'discipline': 'format',
  'day': 'day', 'days': 'day', 'weekday': 'day', 'day of week': 'day',
  'time': 'time', 'times': 'time', 'hour': 'hour_of_day', 'time of day': 'daypart', 'daypart': 'daypart',
  'slot': 'slot', 'slots': 'slot', 'timeslot': 'timeslot', 'morning': 'timeslot', 'evening': 'timeslot',
  'month': 'month', 'months': 'month', 'monthly': 'month', 'quarter': 'quarter', 'year': 'year', 'week': 'week', 'weekly': 'week',
  'source': 'source', 'sources': 'source', 'channel': 'channel', 'campaign': 'utm_campaign',
  'member': 'member_name', 'members': 'member_name', 'client': 'member_name', 'customer': 'member_name', 'person': 'member_name',
  'product': 'product', 'products': 'product', 'membership': 'membership_name', 'membership type': 'membership_type', 'plan': 'membership_type',
  'category': 'category', 'salesperson': 'sold_by', 'sold by': 'sold_by', 'staff': 'sold_by',
  'associate': 'associate', 'status': 'status', 'stage': 'stage', 'lifecycle': 'lifecycle',
  'risk band': 'risk_band', 'tenure': 'tenure_band', 'recency': 'recency_band', 'spend': 'spend_band',
  'visit number': 'visit_band', 'outcome': 'outcome', 'payment method': 'method',
  'weekend': 'weekpart', 'weekday vs weekend': 'weekpart',
};

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'by', 'and', 'or', 'is', 'are', 'was', 'what', 'whats', 'how', 'show', 'me', 'my', 'our', 'this', 'that', 'it', 'with', 'per', 'at', 'do', 'does', 'did', 'we', 'i', 'has', 'have', 'been', 'be', 'much', 'many', 'about', 'tell', 'give', 'can', 'you', 'please', 'there', 'their', 'from', 'vs', 'versus', 'compare', 'compared']);

export const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s: string) => normalise(s).split(' ').filter((t) => t && !STOP.has(t));

export interface Match<T> { item: T; score: number; why: string }

/** Score a metric against a query. Exact phrase hits dominate; token overlap breaks ties. */
function scoreMetric(def: MetricDef, q: string, qTokens: string[]): Match<MetricDef> | null {
  const label = normalise(def.label);
  const id = normalise(def.id.replace(/_/g, ' '));
  let score = 0; let why = '';
  if (q === label || q === id) { score = 1000; why = 'exact name'; }
  else if (q.includes(label) && label.length > 3) { score = 600 + label.length; why = `matched "${def.label}"`; }
  else if (label.includes(q) && q.length > 3) { score = 500 + q.length; why = `matched "${def.label}"`; }
  else if (q.includes(id) && id.length > 4) { score = 480; why = `matched id ${def.id}`; }
  const labelTokens = new Set([...tokens(def.label), ...tokens(def.id.replace(/_/g, ' '))]);
  const hits = qTokens.filter((t) => labelTokens.has(t));
  if (hits.length) { const s = 120 * hits.length + 40 * (hits.length / Math.max(1, labelTokens.size)); if (s > score) { score = s; why = `name contains ${hits.join(', ')}`; } }
  if (score === 0) {
    const descTokens = new Set(tokens(def.description));
    const dHits = qTokens.filter((t) => descTokens.has(t));
    if (dHits.length >= 2) { score = 30 * dHits.length; why = `described in terms of ${dHits.slice(0, 3).join(', ')}`; }
  }
  return score > 0 ? { item: def, score, why } : null;
}

export interface ResolvedTerm {
  kind: 'metric' | 'dimension' | 'unknown';
  metric?: MetricDef;
  dimension?: string;
  confidence: 'exact' | 'synonym' | 'likely' | 'guess';
  why: string;
  alternatives: { id: string; label: string; why: string }[];
}

/** Resolve a free-text business term to something the engine can actually compute. */
export function resolveTerm(input: string): ResolvedTerm {
  const q = normalise(input);
  const qTokens = tokens(input);
  if (!q) return { kind: 'unknown', confidence: 'guess', why: 'empty query', alternatives: [] };

  // 1. longest matching synonym phrase
  const phrases = Object.keys(SYNONYMS).sort((a, b) => b.length - a.length);
  for (const p of phrases) {
    if (q === p || q.includes(p)) {
      const def = METRIC_LIST.find((m) => m.id === SYNONYMS[p]);
      if (def) return { kind: 'metric', metric: def, confidence: q === p ? 'exact' : 'synonym',
        why: `"${p}" is how this product refers to ${def.label}`, alternatives: [] };
    }
  }
  // 2. registry scoring
  const scored = METRIC_LIST.map((m) => scoreMetric(m, q, qTokens)).filter(Boolean) as Match<MetricDef>[];
  scored.sort((a, b) => b.score - a.score);
  if (scored.length && scored[0].score >= 100) {
    return { kind: 'metric', metric: scored[0].item,
      confidence: scored[0].score >= 500 ? 'exact' : scored[0].score >= 200 ? 'likely' : 'guess',
      why: scored[0].why,
      alternatives: scored.slice(1, 5).map((m) => ({ id: m.item.id, label: m.item.label, why: m.why })) };
  }
  // 3. dimension?
  const dim = findDimension(input);
  if (dim) return { kind: 'dimension', dimension: dim, confidence: 'synonym', why: `"${input}" is a way of grouping the data`, alternatives: [] };
  // 4. weak metric guess, offered rather than asserted
  if (scored.length) return { kind: 'metric', metric: scored[0].item, confidence: 'guess', why: scored[0].why,
    alternatives: scored.slice(1, 5).map((m) => ({ id: m.item.id, label: m.item.label, why: m.why })) };
  return { kind: 'unknown', confidence: 'guess', why: 'no metric or dimension matched',
    alternatives: METRIC_LIST.slice(0, 6).map((m) => ({ id: m.id, label: m.label, why: 'available metric' })) };
}

/** Find a grouping dimension mentioned anywhere in a sentence. */
export function findDimension(input: string): string | null {
  const q = normalise(input);
  const phrases = Object.keys(DIM_SYNONYMS).sort((a, b) => b.length - a.length);
  for (const p of phrases) {
    if (new RegExp(`\\b${p.replace(/ /g, '\\s+')}\\b`).test(q)) {
      const key = DIM_SYNONYMS[p];
      if (GROUP_KEYS[key]) return key;
    }
  }
  for (const [key, def] of Object.entries(GROUP_KEYS)) {
    if (q.includes(normalise(def.label)) && def.label.length > 3) return key;
  }
  return null;
}

/** Every metric that could answer a question, ranked — used for "did you mean". */
export function searchMetrics(input: string, limit = 8): Match<MetricDef>[] {
  const q = normalise(input); const qTokens = tokens(input);
  const syn = Object.keys(SYNONYMS).filter((p) => q.includes(p)).map((p) => SYNONYMS[p]);
  const scored = METRIC_LIST.map((m) => {
    const base = scoreMetric(m, q, qTokens);
    const bonus = syn.includes(m.id) ? 900 : 0;
    return base ? { ...base, score: base.score + bonus } : bonus ? { item: m, score: bonus, why: 'known synonym' } : null;
  }).filter(Boolean) as Match<MetricDef>[];
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** The table a metric lives on, as a human noun. */
export const grainOf = (t: TableName) => ({
  visits: 'one row per member per class', sessions: 'one row per class occurrence', sales: 'one row per sale line',
  newc: 'one row per new client', lapsed: 'one row per membership', payroll: 'one row per trainer per month',
  leads: 'one row per enquiry', checkins: 'one row per check-in', bookings: 'one row per booking',
}[t]);

export const vocabulary = () => ({
  metricSynonyms: SYNONYMS, dimensionSynonyms: DIM_SYNONYMS,
  metrics: METRIC_LIST.map((m) => ({ id: m.id, label: m.label, table: m.table, definition: m.description, formula: m.formula })),
  dimensions: Object.entries(GROUP_KEYS).map(([k, v]) => ({ key: k, label: v.label })),
});

export const metricOrThrow = (id: string) => metric(id);
