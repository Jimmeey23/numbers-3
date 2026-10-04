/* Agent API — a stable, documented surface over every tab's data.
 *
 * The app is a static single file, so there is no server to host REST routes. Instead every tab
 * exposes its data through one addressable namespace, published on `window.floor`, which an AI
 * agent (or a browser extension, or a Playwright script) can call to read exactly what the
 * operator is looking at and to push insights back into the Insight rail in real time.
 *
 *   await floor.describe()                    → the endpoint catalogue, self-documenting
 *   await floor.get('retention')              → KPIs, groupings, tables and insights for a tab
 *   await floor.query({ tab, groupBy, metrics })→ arbitrary rollup against the live scope
 *   floor.push({ tab, title, body, ... })     → add an insight card to a tab (persists)
 *   floor.setFilters({ ... }) / floor.scope() → drive or read the global filter state
 *
 * Every response carries the scope it was computed under, so an agent can never quote a number
 * without knowing the period and filters that produced it.
 */
import type { Scope } from '../state/data';
import { metric, METRIC_LIST, type TableName } from '../semantics/metrics';
import { GROUP_KEYS, metricValues, rollupLevel, seriesBy, type Row } from '../semantics/aggregations';
import { formatValue } from '../semantics/formats';
import { runRules, summariseImpact } from '../insights/engine';
import { addWidget, readWidgets, removeWidget, updateWidget, WIDGET_KINDS, type WidgetSpec } from './widgets';
import { buildReport } from '../report/model';
import { renderReport } from '../report/shell';
import type { Thresholds, TabId } from '../state/view';

export interface TabEndpoint {
  tab: TabId;
  title: string;
  table: TableName;
  /** Metric ids this tab leads with. */
  headline: string[];
  /** Group keys this tab supports for drill-down. */
  groupBy: string[];
  /** Everything else that is legitimate to ask for on this tab. */
  metrics: string[];
  description: string;
}

export const ENDPOINTS: TabEndpoint[] = [
  { tab: 'overview', title: 'Overview', table: 'visits', description: 'Business state across every source: revenue, visits, fill, acquisition and the active base.',
    headline: ['gross_revenue', 'visits', 'v_fill_rate', 'new_clients', 'conversion_rate', 'active_memberships'],
    groupBy: ['location', 'format', 'month'], metrics: ['gross_revenue', 'visits', 'v_fill_rate', 'v_rev_per_visit', 'new_clients', 'conversion_rate', 'active_memberships', 'churn_rate'] },
  { tab: 'classes', title: 'Classes', table: 'visits', description: 'Class-level attendance, fill, yield and payment mix, one row per class occurrence.',
    headline: ['v_sessions', 'visits', 'v_fill_rate', 'v_attendance_per_session', 'v_rev_per_visit', 'v_no_show_rate'],
    groupBy: ['format', 'location', 'slot', 'trainer', 'class_name', 'day', 'timeslot', 'capacity_band', 'month', 'week'],
    metrics: ['v_sessions', 'visits', 'v_booked', 'v_fill_rate', 'v_show_up_rate', 'v_attendance_per_session', 'v_revenue', 'v_rev_per_visit', 'v_late_cancel_rate', 'v_no_show_rate', 'v_complimentary_rate', 'v_new_share'] },
  { tab: 'slots', title: 'Slots', table: 'visits', description: 'The weekly timetable as a design object: which recurring slots to keep, move or cut.',
    headline: ['v_slots', 'v_fill_rate', 'v_attendance_per_session', 'v_revenue'],
    groupBy: ['location', 'day', 'time', 'trainer', 'slot', 'format', 'timeslot'],
    metrics: ['v_slots', 'v_sessions', 'visits', 'v_fill_rate', 'v_attendance_per_session', 'v_revenue', 'v_rev_per_visit', 'v_no_show_rate'] },
  { tab: 'trainers', title: 'Trainers', table: 'sessions', description: 'Trainer draw, yield, consistency and composite standing, slot-adjusted.',
    headline: ['active_trainers', 'fill_rate', 'draw_premium_pp', 'revenue_per_session'],
    groupBy: ['trainer', 'format', 'location', 'slot', 'day', 'timeslot', 'month'],
    metrics: ['sessions', 'attendance', 'fill_rate', 'draw_premium_pp', 'revenue_per_session', 'rev_pac', 'rev_pas', 'attendance_cv', 'versatility', 'prime_time_share', 'revenue_per_hour'] },
  { tab: 'sales', title: 'Sales', table: 'sales', description: 'Every rupee booked, by category, product, location and salesperson.',
    headline: ['gross_revenue', 'net_revenue', 'transactions', 'aov', 'unique_buyers', 'discount_rate'],
    groupBy: ['category', 'product', 'location', 'sold_by', 'method', 'discount_code', 'membership_type', 'month', 'day', 'hour'],
    metrics: ['gross_revenue', 'net_revenue', 'transactions', 'units', 'aov', 'arpu', 'unique_buyers', 'discount_value', 'discount_rate', 'discounted_share', 'membership_rev_share', 'deferred_revenue', 'repeat_buyer_rate', 'voided_rate'] },
  { tab: 'acquisition', title: 'Acquisition', table: 'newc', description: 'First visits and everything that happened after: return, conversion, value.',
    headline: ['new_clients', 'second_visit_rate', 'conversion_rate', 'median_ltv', 'zero_return_rate'],
    groupBy: ['source', 'location', 'trainer', 'timeslot', 'day', 'first_visit_type', 'speed_bucket', 'lifecycle', 'month'],
    metrics: ['new_clients', 'second_visit_rate', 'conversion_rate', 'avg_conversion_span', 'median_conversion_span', 'avg_first_purchase', 'median_ltv', 'avg_ltv_buyers', 'avg_ltv', 'retention_rate', 'zero_return_rate', 'survival_90', 'avg_visits_post_trial'] },
  { tab: 'retention', title: 'Retention', table: 'lapsed', description: 'Membership and member lifecycle: churn, renewal depth, utilisation and risk.',
    headline: ['active_memberships', 'distinct_members', 'churn_rate', 'gross_revenue_retention', 'high_risk_members', 'revenue_at_risk_30d'],
    groupBy: ['membership_type', 'membership_name', 'location', 'status', 'member', 'sold_by', 'booking_method', 'month'],
    metrics: ['memberships', 'distinct_members', 'active_memberships', 'churned_memberships', 'churn_rate', 'renewal_rate', 'gross_revenue_retention', 'repeat_member_rate', 'memberships_per_member', 'member_ltv', 'member_tenure', 'churn_speed', 'utilisation', 'utilisation_at_churn', 'liability', 'risk_score', 'high_risk_members', 'never_activated', 'winback_rate'] },
  { tab: 'bookings', title: 'Bookings', table: 'visits', description: 'The booking lifecycle: cancellations, no-shows, lead time and reliability.',
    headline: ['v_booked', 'visits', 'v_cancel_rate', 'v_late_cancel_rate', 'v_no_show_rate', 'v_effective_attendance', 'v_lead_time'],
    groupBy: ['class_name', 'trainer', 'slot', 'member', 'location', 'day', 'timeslot', 'membership_type', 'class_no_band', 'month'],
    metrics: ['v_booked', 'visits', 'v_cancelled', 'v_late_cancels', 'v_no_shows', 'v_cancel_rate', 'v_late_cancel_rate', 'v_no_show_rate', 'v_effective_attendance', 'v_show_up_rate', 'v_lead_time', 'v_same_day_share', 'v_rev_per_visit', 'v_source_agreement'] },
  { tab: 'leads', title: 'Leads', table: 'leads', description: 'Enquiry pipeline: sources, response speed, follow-up cadence and win rate.',
    headline: ['leads', 'lead_conversion_rate', 'response_time_hours', 'untouched_leads', 'open_leads', 'pipeline_value'],
    groupBy: ['channel', 'source', 'associate', 'lead', 'stage', 'status', 'location', 'month'],
    metrics: ['leads', 'contacted_leads', 'lead_conversion_rate', 'response_time_hours', 'median_response_hours', 'same_day_response', 'avg_touches', 'touches_to_convert', 'time_to_convert', 'won_leads', 'lost_leads', 'open_leads', 'stale_leads', 'pipeline_value'] },
  { tab: 'attendance', title: 'Attendance', table: 'visits', description: 'Member-level visit behaviour: frequency, engagement, dormancy and concentration.',
    headline: ['visits', 'v_unique_members', 'v_visits_per_member', 'v_repeat_rate', 'v_power_users', 'v_rev_per_visit'],
    groupBy: ['location', 'class_name', 'trainer', 'member', 'format', 'day', 'timeslot', 'membership_type', 'category', 'class_no_band', 'month'],
    metrics: ['visits', 'v_unique_members', 'v_visits_per_member', 'v_repeat_rate', 'v_power_users', 'v_new_share', 'v_complimentary_rate', 'v_rev_per_visit', 'v_rev_per_member', 'v_attendee_hours'] },
  { tab: 'payroll', title: 'Payroll', table: 'payroll', description: 'Trainer economics: cost, contribution margin and conversion value.',
    headline: ['p_sessions', 'p_customers', 'p_revenue', 'p_cost', 'p_margin', 'payroll_pct_of_revenue'],
    groupBy: ['location', 'trainer', 'month'],
    metrics: ['p_sessions', 'p_empty', 'p_empty_rate', 'p_customers', 'p_avg_per_session', 'p_revenue', 'p_rev_per_session', 'p_rev_per_customer', 'p_cost', 'p_contribution', 'p_margin', 'payroll_pct_of_revenue', 'p_converted', 'p_conversion_rate', 'p_retained', 'p_retention_rate'] },
  { tab: 'late-cancellations', title: 'Late cancellations', table: 'visits', description: 'Penalty-window cancellations: trend, concentration and affected demand.',
    headline: ['v_late_cancels', 'v_late_cancel_rate', 'v_booked', 'v_show_up_rate', 'v_no_show_rate'],
    groupBy: ['location', 'class_name', 'timeslot', 'trainer', 'member', 'format', 'month'],
    metrics: ['v_late_cancels', 'v_late_cancel_rate', 'v_booked', 'visits', 'v_show_up_rate', 'v_no_show_rate', 'v_fill_rate', 'v_revenue'] },
  { tab: 'format-comparison', title: 'Format comparison', table: 'visits', description: 'Like-for-like comparison of Barre, PowerCycle and Strength Lab demand and economics.',
    headline: ['visits', 'v_fill_rate', 'v_show_up_rate', 'v_unique_members', 'v_revenue', 'v_rev_per_visit'],
    groupBy: ['format', 'location', 'class_name', 'trainer', 'timeslot', 'month'],
    metrics: ['visits', 'v_booked', 'v_fill_rate', 'v_show_up_rate', 'v_late_cancel_rate', 'v_no_show_rate', 'v_unique_members', 'v_repeat_rate', 'v_revenue', 'v_rev_per_visit'] },
  { tab: 'health', title: 'Data health', table: 'visits', description: 'Source status, reconciliation, referential integrity and known defects.',
    headline: ['v_source_agreement'], groupBy: ['location', 'month'], metrics: ['v_source_agreement', 'visits', 'v_booked'] },
];

export interface AgentScope { period: { start: string; end: string; label: string; comparedWith: string }; filters: Record<string, unknown>; rowsInScope: number; today: string }

function scopeSummary(s: Scope): AgentScope {
  return {
    period: { start: s.period.start, end: s.period.end, label: s.period.label, comparedWith: `${s.period.prevStart}…${s.period.prevEnd} (${s.period.prevLabel})` },
    filters: {
      locations: s.filters.locations, trainers: s.filters.trainers, formats: s.filters.formats,
      sources: s.filters.sources, membershipTypes: s.filters.membershipTypes, days: s.filters.days, slots: s.filters.slots,
      newVsReturning: s.filters.newVsReturning, includeImports: s.filters.includeImports,
      crossFilters: s.filters.transient.map((t) => `${t.dim}=${t.value}`),
    },
    rowsInScope: s.rowsInScope, today: s.today,
  };
}

function valueBlock(id: string, rows: Row[], cmpRows: Row[] | null, s: Scope) {
  const def = metric(id);
  const cur = metricValues(rows, [id], s.ctx)[id];
  const prev = cmpRows ? metricValues(cmpRows, [id], s.ctx)[id] : null;
  return {
    id, label: def.label, domain: def.domain, format: def.format, unit: def.format,
    value: cur.value, formatted: formatValue(def.format, cur.value),
    comparison: prev ? { value: prev.value, formatted: formatValue(def.format, prev.value), label: s.period.prevLabel } : null,
    change: prev && cur.value !== null && prev.value !== null
      ? (def.format === 'percent' ? { kind: 'pp', value: cur.value - prev.value } : { kind: 'relative', value: prev.value ? (cur.value - prev.value) / Math.abs(prev.value) : null })
      : null,
    sample: cur.n, contributing: cur.contributing, coverage: cur.coverage,
    higherIsBetter: def.higherIsBetter, target: def.target ?? null,
    definition: def.description, formula: def.formula, sources: def.sources,
    caveat: cur.suspect,
  };
}

export interface AgentApi {
  version: string;
  describe: () => unknown;
  scope: () => AgentScope;
  get: (tab: TabId, opts?: { groupBy?: string; limit?: number }) => unknown;
  query: (q: { tab?: TabId; table?: TableName; metrics: string[]; groupBy?: string[]; limit?: number; sortBy?: string; trend?: boolean }) => unknown;
  insights: (tab?: TabId) => unknown;
  metrics: () => unknown;
  push: (card: AgentCardInput) => string;
  dismiss: (id: string) => void;
  listPushed: () => AgentCard[];
  setFilters: (patch: Record<string, unknown>) => AgentScope;
  export: (tab: TabId, format: 'json' | 'csv' | 'markdown') => string;
  /** Build a table, chart or metric card and pin it to a tab permanently. */
  addWidget: (spec: Partial<WidgetSpec>) => { id?: string; error?: string };
  updateWidget: (id: string, patch: Partial<WidgetSpec>) => void;
  removeWidget: (id: string) => void;
  listWidgets: () => WidgetSpec[];
  widgetKinds: () => typeof WIDGET_KINDS;
  /** Custom-scope decision report: eleven chapters plus a month-on-month appendix. */
  report: (format?: 'html' | 'json') => string;
}

export interface AgentCardInput {
  tab: TabId; title: string; body?: string; action?: string;
  severity?: 'critical' | 'attention' | 'opportunity' | 'context';
  impactINR?: number; entity?: string; source?: string; metricId?: string; pinned?: boolean;
}
export interface AgentCard extends AgentCardInput { id: string; createdAt: number; severity: NonNullable<AgentCardInput['severity']>; source: string }

const CARD_KEY = 'floor.cards.v1';
export function readCards(): AgentCard[] {
  try { return JSON.parse(localStorage.getItem(CARD_KEY) ?? '[]'); } catch { return []; }
}
export function writeCards(cards: AgentCard[]) {
  try { localStorage.setItem(CARD_KEY, JSON.stringify(cards)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('floor:cards'));
}
export function addCard(input: AgentCardInput): AgentCard {
  const card: AgentCard = {
    ...input, id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(), severity: input.severity ?? 'context', source: input.source ?? 'manual',
  };
  writeCards([card, ...readCards()]);
  return card;
}
export function removeCard(id: string) { writeCards(readCards().filter((c) => c.id !== id)); }
export function updateCard(id: string, patch: Partial<AgentCard>) { writeCards(readCards().map((c) => (c.id === id ? { ...c, ...patch } : c))); }

/** Build the live API object. Called by the shell whenever the scope changes. */
export function buildAgentApi(scope: Scope, thresholds: Thresholds, setFilters: (p: Record<string, unknown>) => void): AgentApi {
  const rowsFor = (t: TableName) => scope.tables[t] ?? [];
  const cmpFor = (t: TableName) => (scope.filters.compare === 'none' ? null : scope.compare[t] ?? []);
  const epFor = (tab: TabId) => ENDPOINTS.find((e) => e.tab === tab) ?? ENDPOINTS[0];

  const getTab = (tab: TabId, opts?: { groupBy?: string; limit?: number }) => {
    const ep = epFor(tab);
    const rows = rowsFor(ep.table);
    const cmp = cmpFor(ep.table);
    const groupKey = opts?.groupBy && GROUP_KEYS[opts.groupBy] ? opts.groupBy : ep.groupBy[0];
    const limit = opts?.limit ?? 25;
    const nodes = GROUP_KEYS[groupKey] ? rollupLevel(rows, [groupKey], 0, ep.headline, scope.ctx) : [];
    return {
      tab, title: ep.title, description: ep.description, scope: scopeSummary(scope),
      headline: ep.headline.map((id) => valueBlock(id, rows, cmp, scope)),
      groupedBy: groupKey,
      groups: nodes.sort((a, b) => b.rows.length - a.rows.length).slice(0, limit).map((n) => ({
        key: n.key, label: n.label, rows: n.rows.length,
        values: Object.fromEntries(ep.headline.map((id) => [id, n.values[id]?.value ?? null])),
      })),
      availableGroupings: ep.groupBy.map((k) => ({ key: k, label: GROUP_KEYS[k]?.label ?? k })),
      availableMetrics: ep.metrics.map((id) => ({ id, label: metric(id).label, format: metric(id).format, definition: metric(id).description })),
      insights: runRules(scope, thresholds).filter((i) => i.tab === tab).map((i) => ({
        rule: i.rule, severity: i.severity, entity: i.entity, title: i.title, body: i.body, action: i.action,
        impactINR: i.impactINR, basis: i.basis ?? null, sample: i.n ?? null,
      })),
    };
  };

  return {
    version: '2.0',
    describe: () => ({
      name: 'Atlas agent API', version: '2.0',
      note: 'Every response includes the scope it was computed under. Never quote a figure without it.',
      methods: {
        'describe()': 'This catalogue.',
        'scope()': 'Current period, comparison window and active filters.',
        'get(tab, {groupBy, limit})': 'Headline metrics, a grouped breakdown, available groupings/metrics and live insights for one tab.',
        'query({tab|table, metrics, groupBy[], limit, sortBy, trend})': 'Arbitrary rollup over the live scope. Up to four grouping levels.',
        'insights(tab?)': 'All fired insights with rupee impact, netted by basis.',
        'metrics()': 'The whole metric registry with formulas and source columns.',
        'push({tab,title,body,action,severity,impactINR})': 'Add a card to a tab\'s Insight rail. Persists across reloads. Returns the card id.',
        'dismiss(id)': 'Remove a pushed card.',
        'listPushed()': 'Cards currently pushed.',
        'setFilters({locations,preset,...})': 'Drive the global filter state; returns the new scope.',
        'export(tab, "json"|"csv"|"markdown")': 'Serialise a tab.',
        'addWidget({tab,kind,metrics[],groupBy,title,placement})': 'Build a table, chart, heatmap or metric card and pin it to a tab. Persists across reloads and recomputes from the live filters. Returns {id} or {error}.',
        'updateWidget(id, patch)': 'Change a pinned widget.',
        'removeWidget(id)': 'Delete one.',
        'listWidgets()': 'Everything currently pinned.',
        'widgetKinds()': 'The widget types available and whether each needs a grouping.',
        'report("html"|"json")': 'Decision report for the current scope: eleven chapters with grounded AI insights, evidence and methods, plus a month-on-month appendix. HTML is self-contained.',
      },
      widgetRecipe: {
        note: 'metrics must share one grain; groupBy must be a key the grain carries. Call metrics() and describe() for the vocabulary.',
        example: { tab: 'classes', kind: 'column', metrics: ['v_fill_rate'], groupBy: 'daypart', title: 'Fill by time of day', placement: 'top' },
      },
      urlEndpoints: {
        note: 'Each tab also has one addressable URL returning its raw rows and consolidated view as a single JSON document. The app is static, so the page renders the response — a caller that runs JavaScript gets JSON; a plain curl gets the HTML shell.',
        pattern: '?api=<tab>&include=all|raw|consolidated&limit=1000|all&groupBy=<key>',
      },
      tabs: ENDPOINTS.map((e) => ({ tab: e.tab, title: e.title, description: e.description, headline: e.headline, groupBy: e.groupBy, metricCount: e.metrics.length, url: `?api=${e.tab}&include=all&limit=1000&format=json` })),
    }),
    scope: () => scopeSummary(scope),
    get: getTab,
    query: (q) => {
      const table: TableName = q.table ?? epFor(q.tab ?? 'overview').table;
      const rows = rowsFor(table);
      const cmp = cmpFor(table);
      const ids = q.metrics.filter((id) => METRIC_LIST.some((m) => m.id === id));
      if (!ids.length) return { error: 'No valid metric ids. Call metrics() for the catalogue.', scope: scopeSummary(scope) };
      const keys = (q.groupBy ?? []).filter((k) => GROUP_KEYS[k]).slice(0, 4);
      const base = { scope: scopeSummary(scope), table, metrics: ids.map((id) => valueBlock(id, rows, cmp, scope)) };
      if (!keys.length) return q.trend ? { ...base, trend: seriesBy(scope.all[table], (r) => r.month, ids, scope.ctx).map((s) => ({ month: s.key, values: Object.fromEntries(ids.map((id) => [id, s.values[id].value])) })) } : base;
      const build = (rs: Row[], level: number, path: string[]): unknown[] =>
        rollupLevel(rs, keys, level, ids, scope.ctx)
          .sort((a, b) => (q.sortBy && ids.includes(q.sortBy) ? (b.values[q.sortBy]?.value ?? 0) - (a.values[q.sortBy]?.value ?? 0) : b.rows.length - a.rows.length))
          .slice(0, q.limit ?? 50)
          .map((n) => ({
            key: n.key, label: n.label, path: [...path, n.key], rows: n.rows.length,
            values: Object.fromEntries(ids.map((id) => [id, { value: n.values[id]?.value ?? null, formatted: formatValue(metric(id).format, n.values[id]?.value ?? null), coverage: n.values[id]?.coverage ?? null }])),
            children: level + 1 < keys.length ? build(n.rows, level + 1, [...path, n.key]) : undefined,
          }));
      return { ...base, groupBy: keys, rows: build(rows, 0, []) };
    },
    insights: (tab) => {
      const all = runRules(scope, thresholds);
      const list = tab ? all.filter((i) => i.tab === tab) : all;
      return {
        scope: scopeSummary(scope),
        totals: summariseImpact(list).map((b) => ({ basis: b.basis, netINR: Math.round(b.net), grossINR: Math.round(b.gross), distinctEntities: b.entities, duplicateClaimsRemoved: b.overlapping })),
        insights: list.map((i) => ({ rule: i.rule, tab: i.tab, severity: i.severity, entity: i.entity, title: i.title, body: i.body, action: i.action, impactINR: Math.round(i.impactINR), basis: i.basis ?? null, sample: i.n ?? null })),
        pushed: readCards(),
      };
    },
    metrics: () => METRIC_LIST.map((m) => ({ id: m.id, label: m.label, table: m.table, domain: m.domain, format: m.format, aggregation: m.aggregation, higherIsBetter: m.higherIsBetter, target: m.target ?? null, minSample: m.minSample, definition: m.description, formula: m.formula, sources: m.sources })),
    push: (card) => addCard({ ...card, source: card.source ?? 'agent' }).id,
    dismiss: removeCard,
    listPushed: readCards,
    setFilters: (patch) => { setFilters(patch); return scopeSummary(scope); },
    addWidget: (spec) => addWidget({ ...spec, source: 'agent' }),
    updateWidget,
    removeWidget,
    listWidgets: readWidgets,
    widgetKinds: () => WIDGET_KINDS,
    report: (format = 'html') => {
      const m = buildReport(scope, thresholds, scope.filters.locations.length === 1 ? scope.filters.locations[0] : 'Physique 57 India');
      return format === 'json' ? JSON.stringify(m, null, 2) : renderReport(m);
    },
    export: (tab, format) => {
      const data = getTab(tab, { limit: 500 }) as ReturnType<typeof getTab>;
      if (format === 'json') return JSON.stringify(data, null, 2);
      if (format === 'csv') {
        const d = data as { headline: { label: string; formatted: string }[]; groups: { label: string; rows: number; values: Record<string, number | null> }[]; groupedBy: string };
        const lines = [`# ${tab} · ${scope.period.label}`, '', 'Metric,Value', ...d.headline.map((h) => `${h.label},${h.formatted}`), '', `${d.groupedBy},rows,${Object.keys(d.groups[0]?.values ?? {}).join(',')}`,
          ...d.groups.map((g) => [g.label, g.rows, ...Object.values(g.values)].join(','))];
        return lines.join('\n');
      }
      const d = data as { title: string; headline: { label: string; formatted: string; change: { kind: string; value: number | null } | null }[]; groups: { label: string; rows: number }[]; insights: { title: string; action: string }[] };
      return [`# ${d.title} — ${scope.period.label}`, '',
        ...d.headline.map((h) => {
          const c = h.change;
          const delta = c?.value == null ? '' : ` (${c.value >= 0 ? '+' : '−'}${Math.abs(c.value * 100).toFixed(1)}${c.kind === 'pp' ? 'pp' : '%'} vs ${scope.period.prevLabel})`;
          return `- **${h.label}**: ${h.formatted}${delta}`;
        }),
        '', '## Insights', ...d.insights.map((i) => `- ${i.title} — ${i.action}`)].join('\n');
    },
  };
}
