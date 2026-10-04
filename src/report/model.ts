/* The monthly report model.
 *
 * Structure follows the Studio Pulse monthly-report template: seven numbered chapters running
 * money → demand → funnel → retention → outlook → actions, then a month-on-month appendix that
 * collects every chapter's history grid in one place.
 *
 * Where that template calls an LLM for its narrative, this composes the prose from the metric
 * registry and the insight engine. The figures in a sentence and the figures in the table beside
 * it therefore come from the same computation and cannot drift apart.
 */
import type { Scope } from '../state/data';
import type { Thresholds } from '../state/view';
import { metric, type TableName } from '../semantics/metrics';
import { GROUP_KEYS, lastNMonths, metricValues, rollupLevel, seriesBy, type Row } from '../semantics/aggregations';
import { fmtCurrency, fmtDelta, fmtMonthShort, fmtPercent, formatValue } from '../semantics/formats';
import { runRules, summariseImpact } from '../insights/engine';
import type { Insight } from '../insights/rules';
import { scopeLine } from '../api/export';

/* ── Chapter order. Shared by the top nav, the side rail, the footer contents list and the
      anchor each section header prints, so the four can never disagree. ── */
export const CHAPTERS = [
  { id: 'executive-summary', nav: 'Overview', no: '01', title: 'Executive summary' },
  { id: 'revenue-performance', nav: 'Revenue', no: '02', title: 'Revenue and sales performance' },
  { id: 'conversion-funnel', nav: 'Funnel', no: '03', title: 'New client conversion funnel' },
  { id: 'sessions', nav: 'Sessions', no: '04', title: 'Sessions and class performance' },
  { id: 'lapsed', nav: 'Retention', no: '05', title: 'Lapsed memberships deep dive' },
  { id: 'recommendations', nav: 'Actions', no: '06', title: 'Strategic recommendations' },
  { id: 'predictions', nav: 'Outlook', no: '07', title: 'Predictions and forward view' },
] as const;

export type ChapterId = typeof CHAPTERS[number]['id'];

export interface ReportKpi {
  id: string; label: string; formatted: string; value: number | null;
  prevFormatted: string; delta: string; good: boolean | null;
  definition: string; formula: string; sources: string[];
  coverage: number | null; sample: number; spark: (number | null)[];
}

export interface ReportTable {
  title: string; note?: string;
  columns: string[]; rows: (string | number | null)[][];
  /** Column indices that should render right-aligned as numbers. */
  numeric: number[];
  /** Index of the column to draw an inline bar behind, if any. */
  barColumn?: number;
}

export interface ReportBullet { headline: string; meaning: string; evidence?: string }

export interface ReportAction {
  priority: 'high' | 'medium' | 'low';
  title: string; description: string; impact: string; timeline: string; owner: string;
}

export interface ReportChapter {
  id: ChapterId; nav: string; no: string; title: string;
  standfirst: string;
  kpis: ReportKpi[];
  narrative: string[];
  bullets: ReportBullet[];
  tables: ReportTable[];
  /** Registered here as the chapter renders; the appendix prints them all together. */
  mom?: ReportTable;
  chart?: { kind: 'line' | 'bars'; title: string; labels: string[]; values: (number | null)[]; fmt: string };
}

export interface ReportModel {
  meta: {
    title: string; studio: string; periodLabel: string; comparedWith: string;
    generated: string; scopeLine: string; rowsInScope: number;
    dataThrough: string;
  };
  chapters: ReportChapter[];
  actions: ReportAction[];
  appendix: ReportTable[];
  impact: { basis: string; net: number; gross: number; entities: number; overlapping: number }[];
}

/* ── helpers ──────────────────────────────────────────────── */

const rowsFor = (scope: Scope, t: TableName): Row[] => scope.tables[t] ?? [];

function buildKpi(scope: Scope, id: string, months: string[]): ReportKpi {
  const def = metric(id);
  const t = def.table;
  const cur = metricValues(rowsFor(scope, t), [id], scope.ctx)[id];
  const prev = metricValues(scope.compare[t] ?? [], [id], scope.ctx)[id];
  const d = fmtDelta(def.format, cur.value, prev.value);
  const spark = seriesBy(scope.all[t] ?? [], (r) => r.month, [id], scope.ctx, months).map((s) => s.values[id].value);
  return {
    id, label: def.label, value: cur.value,
    formatted: formatValue(def.format, cur.value),
    prevFormatted: formatValue(def.format, prev.value),
    delta: d.text,
    good: d.value === null ? null : (d.value >= 0) === def.higherIsBetter,
    definition: def.description, formula: def.formula, sources: def.sources,
    coverage: cur.coverage, sample: cur.n, spark,
  };
}

/** A grouped table: one row per group, one column per metric.
 *  `order: 'natural'` keeps the dimension's own sequence (risk bands, dayparts, days of the week)
 *  rather than re-sorting by a measure, which would scramble an ordinal axis. */
function groupTable(scope: Scope, opts: {
  title: string; note?: string; metrics: string[]; groupBy: string; limit?: number;
  sortBy?: string; sortDir?: 'asc' | 'desc'; minRows?: number; order?: 'metric' | 'natural';
}): ReportTable {
  const first = metric(opts.metrics[0]);
  const rows = rowsFor(scope, first.table);
  const key = GROUP_KEYS[opts.groupBy];
  let nodes = key ? rollupLevel(rows, [opts.groupBy], 0, opts.metrics, scope.ctx) : [];
  if (opts.minRows) nodes = nodes.filter((n) => n.rows.length >= opts.minRows!);
  const sortId = opts.sortBy && opts.metrics.includes(opts.sortBy) ? opts.sortBy : opts.metrics[0];
  if (opts.order !== 'natural') {
    const dir = opts.sortDir === 'asc' ? -1 : 1;
    nodes.sort((a, b) => {
      const av = a.values[sortId]?.value; const bv = b.values[sortId]?.value;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return (bv - av) * dir;
    });
  }
  const shown = nodes.slice(0, opts.limit ?? 10);
  return {
    title: opts.title, note: opts.note,
    columns: [key?.label ?? 'Group', ...opts.metrics.map((m) => metric(m).label), 'Rows'],
    rows: shown.map((n) => [
      n.label,
      ...opts.metrics.map((m) => formatValue(metric(m).format, n.values[m]?.value ?? null)),
      n.rows.length,
    ]),
    numeric: opts.metrics.map((_, i) => i + 1).concat([opts.metrics.length + 1]),
    barColumn: 1,
  };
}

/** The month-on-month grid a chapter contributes to the appendix. */
function momTable(scope: Scope, title: string, ids: string[], months: string[]): ReportTable {
  const byMetric = ids.map((id) => {
    const def = metric(id);
    const series = seriesBy(scope.all[def.table] ?? [], (r) => r.month, [id], scope.ctx, months);
    return [def.label, ...series.map((s) => formatValue(def.format, s.values[id].value))];
  });
  return {
    title, columns: ['Metric', ...months.map(fmtMonthShort)], rows: byMetric,
    numeric: months.map((_, i) => i + 1),
    note: 'Twelve months to the reporting month. Dimension filters apply; the period filter does not, so the shape stays comparable.',
  };
}

const pctWord = (v: number | null, good: boolean | null) =>
  v === null ? 'held flat' : good === null ? 'moved' : good ? 'improved' : 'slipped';

const sentence = (parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' ');

/* ── Narrative composition ────────────────────────────────── */

function bulletsFromKpis(kpis: ReportKpi[], max = 4): ReportBullet[] {
  return kpis
    .filter((k) => k.value !== null && k.good !== null)
    .sort((a, b) => Number(a.good) - Number(b.good))
    .slice(0, max)
    .map((k) => ({
      headline: `${k.label} ${k.good ? 'is moving the right way' : 'needs attention'}`,
      meaning: `${k.definition} It now reads ${k.formatted} against ${k.prevFormatted} last period.`,
      evidence: sentence([
        `${k.delta} change`,
        k.coverage !== null && k.coverage < 0.9 ? `measured on ${(k.coverage * 100).toFixed(0)}% of rows` : null,
        k.sample < metric(k.id).minSample ? `only ${k.sample} rows, below the ${metric(k.id).minSample}-row minimum` : null,
      ]),
    }));
}

/* ── Actions, from the insight engine ─────────────────────── */

const OWNER_BY_TAB: Record<string, string> = {
  retention: 'Membership team', acquisition: 'Front desk and marketing', leads: 'Sales associate on duty',
  slots: 'Schedule owner', classes: 'Studio manager', trainers: 'Head of training',
  sales: 'Studio manager', bookings: 'Front desk', attendance: 'Studio manager',
  payroll: 'Finance and head of training', overview: 'Studio manager', health: 'Data owner',
};

const TIMELINE_BY_SEVERITY: Record<string, string> = {
  critical: 'This week', attention: 'This month', opportunity: 'Next 30 days', context: 'Monitor',
};

const PRIORITY_BY_SEVERITY: Record<string, ReportAction['priority']> = {
  critical: 'high', attention: 'medium', opportunity: 'medium', context: 'low',
};

function actionsFrom(insights: Insight[], limit = 8): ReportAction[] {
  return insights.slice(0, limit).map((i) => ({
    priority: PRIORITY_BY_SEVERITY[i.severity] ?? 'low',
    title: i.title,
    description: i.body,
    impact: i.impactINR > 0
      ? `${fmtCurrency(i.impactINR)}${i.basis === 'at-risk' ? ' at risk' : i.basis === 'sunk' ? ' already paid and unused' : ' estimated upside'}`
      : 'Not valued — act on the evidence, not a rupee figure',
    timeline: TIMELINE_BY_SEVERITY[i.severity] ?? 'Monitor',
    owner: OWNER_BY_TAB[i.tab] ?? 'Studio manager',
  }));
}

/* ── Outlook ──────────────────────────────────────────────── */

/** Trailing mean plus the slope of the recent run, stated as a range rather than a point. */
function project(series: (number | null)[]): { low: number; mid: number; high: number } | null {
  const vals = series.filter((v): v is number => v !== null && Number.isFinite(v));
  if (vals.length < 4) return null;
  const recent = vals.slice(-3);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const window = vals.slice(-6);
  const n = window.length;
  const xMean = (n - 1) / 2;
  const yMean = window.reduce((a, b) => a + b, 0) / n;
  let num = 0; let den = 0;
  for (let i = 0; i < n; i++) { num += (i - xMean) * (window[i] - yMean); den += (i - xMean) ** 2; }
  const slope = den ? num / den : 0;
  const mid = Math.max(0, mean + slope);
  const spread = Math.max(Math.abs(slope) * 1.5, mean * 0.08);
  return { low: Math.max(0, mid - spread), mid, high: mid + spread };
}

/* ── The builder ──────────────────────────────────────────── */

export function buildReport(scope: Scope, thresholds: Thresholds, studio: string): ReportModel {
  const months = lastNMonths(scope.today.slice(0, 7), 12);
  const K = (id: string) => buildKpi(scope, id, months);
  const insights = runRules(scope, thresholds);
  const impact = summariseImpact(insights);
  const chapters: ReportChapter[] = [];
  const appendix: ReportTable[] = [];

  const register = (c: ReportChapter) => { chapters.push(c); if (c.mom) appendix.push(c.mom); };

  /* 01 — Executive summary. The whole business in one screen. */
  const exec = [K('gross_revenue'), K('visits'), K('v_fill_rate'), K('new_clients'), K('conversion_rate'), K('active_memberships')];
  const worst = [...exec].filter((k) => k.good === false).sort((a, b) => a.label.localeCompare(b.label))[0];
  const best = [...exec].filter((k) => k.good === true)[0];
  register({
    id: 'executive-summary', nav: 'Overview', no: '01', title: 'Executive summary',
    standfirst: `${studio} · ${scope.period.label}, measured against ${scope.period.prevLabel}.`,
    kpis: exec,
    narrative: [
      sentence([
        `${studio} took ${exec[0].formatted} across ${exec[1].formatted} visits in ${scope.period.label}.`,
        exec[0].delta !== '—' ? `Revenue ${pctWord(exec[0].value, exec[0].good)} ${exec[0].delta} against ${scope.period.prevLabel}.` : null,
        `Classes ran at ${exec[2].formatted} of capacity.`,
      ]),
      sentence([
        `${exec[3].formatted} people took a first class and ${exec[4].formatted} of first-timers went on to buy.`,
        `The membership base stands at ${exec[5].formatted}.`,
        best ? `${best.label} is the clearest gain at ${best.delta}.` : null,
        worst ? `${worst.label} is the clearest problem at ${worst.delta}.` : null,
      ]),
      insights.length
        ? `${insights.length} rules fired this period. ${impact.map((b) => `${b.basis === 'at-risk' ? 'Revenue at risk' : b.basis === 'sunk' ? 'Paid but unused' : 'Estimated upside'} ${fmtCurrency(b.net)} across ${b.entities} members`).join('; ')}. Figures are netted so no member is counted twice.`
        : 'No alert rule fired against this scope.',
    ],
    bullets: bulletsFromKpis(exec),
    tables: [groupTable(scope, {
      title: 'Performance by location', metrics: ['visits', 'v_fill_rate', 'v_rev_per_visit', 'v_unique_members'],
      groupBy: 'location', limit: 8,
      note: 'Visits are the canonical grain — one row per member per class — so this agrees with every other chapter.',
    })],
    mom: momTable(scope, 'Executive summary', ['gross_revenue', 'visits', 'v_fill_rate', 'new_clients', 'conversion_rate'], months),
    chart: { kind: 'line', title: 'Revenue, twelve months', labels: months.map(fmtMonthShort), values: exec[0].spark, fmt: 'currency' },
  });

  /* 02 — Revenue. */
  const rev = [K('gross_revenue'), K('net_revenue'), K('transactions'), K('aov'), K('unique_buyers'), K('discount_rate')];
  register({
    id: 'revenue-performance', nav: 'Revenue', no: '02', title: 'Revenue and sales performance',
    standfirst: 'Every rupee booked, by category, product and the people who sold it.',
    kpis: rev,
    narrative: [
      sentence([
        `${rev[0].formatted} gross, ${rev[1].formatted} net of tax, across ${rev[2].formatted} transactions from ${rev[4].formatted} distinct buyers.`,
        `Average order value is ${rev[3].formatted}, ${rev[3].delta} on ${scope.period.prevLabel}.`,
      ]),
      sentence([
        `Discounting ran at ${rev[5].formatted}`,
        rev[5].good === false ? `— up ${rev[5].delta}, which is giving away margin that volume is not replacing.` : `, ${rev[5].delta}.`,
      ]),
    ],
    bullets: bulletsFromKpis(rev),
    tables: [
      groupTable(scope, { title: 'Revenue by category', metrics: ['gross_revenue', 'transactions', 'aov', 'discount_rate'], groupBy: 'category', limit: 10 }),
      groupTable(scope, { title: 'Top products', metrics: ['gross_revenue', 'units', 'aov'], groupBy: 'product', limit: 10 }),
      groupTable(scope, { title: 'Sold by', metrics: ['gross_revenue', 'transactions', 'aov', 'discount_rate'], groupBy: 'sold_by', limit: 8 }),
    ],
    mom: momTable(scope, 'Revenue', ['gross_revenue', 'net_revenue', 'transactions', 'aov', 'discount_rate', 'membership_rev_share'], months),
    chart: { kind: 'line', title: 'Gross revenue, twelve months', labels: months.map(fmtMonthShort), values: rev[0].spark, fmt: 'currency' },
  });

  /* 03 — Funnel. */
  const fun = [K('new_clients'), K('second_visit_rate'), K('conversion_rate'), K('avg_conversion_span'), K('median_ltv'), K('zero_return_rate')];
  const fresh = (scope.tables.newc ?? []).filter((r) => r.is_new);
  const mature = fresh.filter((r) => r.ts !== null && r.ts <= scope.ctx.todayTs - scope.ctx.matureDays * 864e5);
  const stages: [string, number][] = [
    ['Leads created', (scope.tables.leads ?? []).length],
    ['Took a trial', (scope.tables.leads ?? []).filter((r) => r.trialed).length],
    ['First visit', mature.length],
    ['Came back once', mature.filter((r) => (r.visits_post_trial ?? 0) > 0).length],
    ['Bought something', mature.filter((r) => r.converted).length],
    ['Bought a membership', mature.filter((r) => (r.memberships_bought ?? 0) > 0).length],
    ['Still active at 90 days', mature.filter((r) => r.converted && (r.days_active ?? 0) >= 90).length],
  ];
  const top = stages[0][1] || 1;
  register({
    id: 'conversion-funnel', nav: 'Funnel', no: '03', title: 'New client conversion funnel',
    standfirst: `From enquiry to a member still training at ninety days. Cohorts younger than ${scope.ctx.matureDays} days are held back, so the rates are settled rather than optimistic.`,
    kpis: fun,
    narrative: [
      sentence([
        `${fun[0].formatted} first visits in the period.`,
        `${fun[1].formatted} came back at least once and ${fun[2].formatted} went on to buy, taking a median ${fun[3].formatted} to decide.`,
      ]),
      sentence([
        `${fun[5].formatted} never returned after their first class.`,
        fun[5].good === false ? 'That is the single largest leak in the business, and it happens before anyone has been asked to buy.' : null,
        `Median lifetime value among those who do spend is ${fun[4].formatted}.`,
      ]),
    ],
    bullets: bulletsFromKpis(fun),
    tables: [
      {
        title: 'The journey, stage by stage',
        columns: ['Stage', 'People', 'Of the stage before', 'Of everyone who entered'],
        rows: stages.map(([label, n], i) => [
          label, n,
          i === 0 ? '—' : fmtPercent(stages[i - 1][1] ? n / stages[i - 1][1] : 0),
          fmtPercent(n / top),
        ]),
        numeric: [1, 2, 3], barColumn: 1,
        note: 'Leads and trials come from the Leads sheet, everything from the first visit onward from the New sheet. '
          + 'The first two steps are not a strict cohort of the third — a lead raised this month may convert next — so read '
          + 'them as volumes at each stage rather than as one group walking through. From the first visit down it is a single cohort.',
      },
      groupTable(scope, { title: 'By acquisition source', metrics: ['new_clients', 'second_visit_rate', 'conversion_rate', 'median_ltv'], groupBy: 'source', limit: 10 }),
      groupTable(scope, { title: 'By first-visit trainer', metrics: ['new_clients', 'conversion_rate', 'retention_rate'], groupBy: 'trainer', limit: 10 }),
    ],
    mom: momTable(scope, 'Funnel', ['new_clients', 'second_visit_rate', 'conversion_rate', 'median_ltv', 'retention_rate'], months),
    chart: { kind: 'bars', title: 'Funnel', labels: stages.map((s) => s[0]), values: stages.map((s) => s[1]), fmt: 'integer' },
  });

  /* 04 — Sessions and demand. */
  const ses = [K('v_sessions'), K('visits'), K('v_fill_rate'), K('v_attendance_per_session'), K('v_no_show_rate'), K('v_late_cancel_rate')];
  register({
    id: 'sessions', nav: 'Sessions', no: '04', title: 'Sessions and class performance',
    standfirst: 'What ran, how full it was, and what it earned per seat.',
    kpis: ses,
    narrative: [
      sentence([
        `${ses[0].formatted} classes ran, drawing ${ses[1].formatted} visits — an average of ${ses[3].formatted} people per class against ${ses[2].formatted} of capacity.`,
      ]),
      sentence([
        `${ses[4].formatted} of bookings were no-shows and ${ses[5].formatted} were cancelled inside the penalty window.`,
        'Both block a seat that someone else would have taken.',
      ]),
    ],
    bullets: bulletsFromKpis(ses),
    tables: [
      groupTable(scope, { title: 'By class format', metrics: ['v_sessions', 'visits', 'v_fill_rate', 'v_rev_per_visit'], groupBy: 'format', limit: 10 }),
      groupTable(scope, { title: 'By time of day', metrics: ['v_sessions', 'visits', 'v_fill_rate', 'v_no_show_rate'], groupBy: 'daypart', limit: 8, order: 'natural' }),
      groupTable(scope, {
        title: 'Weakest recurring slots', metrics: ['v_fill_rate', 'visits', 'v_sessions'], groupBy: 'slot',
        limit: 10, sortBy: 'v_fill_rate', sortDir: 'asc', minRows: 8,
        note: 'Emptiest first. Slots with fewer than eight bookings in the period are excluded, so a one-off cannot head the list.',
      }),
      groupTable(scope, { title: 'By trainer', metrics: ['v_sessions', 'visits', 'v_fill_rate', 'v_attendance_per_session'], groupBy: 'trainer', limit: 12 }),
    ],
    mom: momTable(scope, 'Sessions', ['v_sessions', 'visits', 'v_fill_rate', 'v_attendance_per_session', 'v_no_show_rate'], months),
    chart: { kind: 'line', title: 'Visits, twelve months', labels: months.map(fmtMonthShort), values: ses[1].spark, fmt: 'integer' },
  });

  /* 05 — Retention and lapsed. */
  const ret = [K('active_memberships'), K('churn_rate'), K('renewal_rate'), K('high_risk_members'), K('revenue_at_risk_30d'), K('never_activated')];
  register({
    id: 'lapsed', nav: 'Retention', no: '05', title: 'Lapsed memberships deep dive',
    standfirst: 'Who is leaving, who is about to, and what it is worth to keep them.',
    kpis: ret,
    narrative: [
      sentence([
        `${ret[0].formatted} memberships are live. ${ret[1].formatted} of memberships in scope have churned and ${ret[2].formatted} renewed.`,
      ]),
      sentence([
        `${ret[3].formatted} active memberships score at or above the ${scope.ctx.riskHigh} risk threshold,`,
        `and ${ret[4].formatted} of paid membership value expires inside thirty days.`,
        Number(ret[5].value ?? 0) > 0 ? `A further ${ret[5].formatted} memberships were paid for and never activated at all.` : null,
      ]),
    ],
    bullets: bulletsFromKpis(ret),
    tables: [
      groupTable(scope, { title: 'By membership type', metrics: ['memberships', 'churn_rate', 'renewal_rate', 'utilisation'], groupBy: 'membership_type', limit: 10 }),
      groupTable(scope, { title: 'By risk band', metrics: ['memberships', 'risk_score', 'avg_days_since_visit', 'l_revenue'], groupBy: 'risk_band', limit: 6, order: 'natural' }),
      groupTable(scope, { title: 'By location', metrics: ['active_memberships', 'churn_rate', 'member_ltv'], groupBy: 'location', limit: 8 }),
    ],
    mom: momTable(scope, 'Retention', ['active_memberships', 'churned_memberships', 'churn_rate', 'renewal_rate', 'liability'], months),
    chart: { kind: 'line', title: 'Churn rate, twelve months', labels: months.map(fmtMonthShort), values: ret[1].spark, fmt: 'percent' },
  });

  /* 06 — Actions. */
  const actions = actionsFrom(insights);
  register({
    id: 'recommendations', nav: 'Actions', no: '06', title: 'Strategic recommendations',
    standfirst: 'Every item names an entity, a number and the person who owns it.',
    kpis: [],
    narrative: [
      actions.length
        ? `${actions.length} actions, ordered by rupee impact within severity. ${actions.filter((a) => a.priority === 'high').length} are marked high priority and should be worked this week.`
        : 'No rule fired against this scope, so there is nothing to action from the data this period.',
      impact.length
        ? `Totals are netted within a basis and each member is counted once, so these figures are lower than the sum of the cards above and will survive scrutiny: ${impact.map((b) => `${b.basis} ${fmtCurrency(b.net)}`).join(', ')}.`
        : '',
    ].filter(Boolean),
    bullets: insights.slice(0, 6).map((i) => ({
      headline: i.title,
      meaning: i.body,
      evidence: sentence([i.impactINR > 0 ? fmtCurrency(i.impactINR) : null, i.n !== undefined ? `n = ${i.n}` : null]),
    })),
    tables: [],
  });

  /* 07 — Outlook.
     The twelve-month series runs to the month containing `today`, which is usually still in
     progress. A partial month would drag any trailing mean down, so everything after the month
     being reported on is dropped before projecting. */
  const reportMonth = scope.period.end.slice(0, 7);
  const cut = months.indexOf(reportMonth);
  const complete = <T,>(s: T[]) => (cut >= 0 ? s.slice(0, cut + 1) : s);
  const revSeries = complete(exec[0].spark);
  const visSeries = complete(ses[1].spark);
  const revP = project(revSeries);
  const visP = project(visSeries);
  const expiring = metricValues(rowsFor(scope, 'lapsed'), ['expiring_30d', 'revenue_at_risk_30d'], scope.ctx);
  const pipeline = metricValues(rowsFor(scope, 'leads'), ['open_leads', 'pipeline_value'], scope.ctx);
  register({
    id: 'predictions', nav: 'Outlook', no: '07', title: 'Predictions and forward view',
    standfirst: 'A projection from the trailing run, plus the money already on the books.',
    kpis: [],
    narrative: [
      revP
        ? `On the last three months' average adjusted for the six-month trend, next month lands near ${fmtCurrency(revP.mid)}, within a range of ${fmtCurrency(revP.low)} to ${fmtCurrency(revP.high)}.`
        : 'There is not enough month-on-month history in scope to project revenue.',
      visP
        ? `Visits project to roughly ${Math.round(visP.mid).toLocaleString('en-IN')}, between ${Math.round(visP.low).toLocaleString('en-IN')} and ${Math.round(visP.high).toLocaleString('en-IN')}.`
        : '',
      sentence([
        `${formatValue('integer', expiring.expiring_30d.value)} memberships worth ${fmtCurrency(expiring.revenue_at_risk_30d.value)} come up for renewal inside thirty days,`,
        `and ${formatValue('integer', pipeline.open_leads.value)} open leads carry an estimated ${fmtCurrency(pipeline.pipeline_value.value)}.`,
        'Both are decided by what happens next month, not by what happened last month.',
      ]),
      `Method: the midpoint is the mean of the last three complete months plus the slope of the last six; the range is the larger of that slope or eight per cent of the mean. Months after ${fmtMonthShort(reportMonth)} are excluded because they are still running. It is a run-rate, not a forecast — it assumes nothing changes.`,
    ].filter(Boolean),
    bullets: [],
    tables: [{
      title: 'What is already committed',
      columns: ['Item', 'Count', 'Value', 'Decided by'],
      rows: [
        ['Memberships expiring within 30 days', formatValue('integer', expiring.expiring_30d.value), fmtCurrency(expiring.revenue_at_risk_30d.value), 'Renewal conversations'],
        ['Open leads in the pipeline', formatValue('integer', pipeline.open_leads.value), fmtCurrency(pipeline.pipeline_value.value), 'Follow-up speed'],
        ['Active memberships at or above the risk threshold', formatValue('integer', metricValues(rowsFor(scope, 'lapsed'), ['high_risk_members'], scope.ctx).high_risk_members.value), fmtCurrency(metricValues(rowsFor(scope, 'lapsed'), ['at_risk_value'], scope.ctx).at_risk_value.value), 'Save calls'],
      ],
      numeric: [1, 2],
    }],
    chart: {
      kind: 'line', title: 'Revenue, complete months, with next month projected',
      labels: [...complete(months).map(fmtMonthShort), 'Next'],
      values: [...revSeries, revP ? revP.mid : null], fmt: 'currency',
    },
  });

  return {
    meta: {
      title: `${studio} · Performance report`,
      studio,
      periodLabel: scope.period.label,
      comparedWith: scope.period.prevLabel,
      generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
      scopeLine: scopeLine(scope),
      rowsInScope: scope.rowsInScope,
      dataThrough: scope.today,
    },
    chapters, actions, appendix, impact,
  };
}
