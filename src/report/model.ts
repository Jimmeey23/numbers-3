/* Custom decision-report model.
 *
 * Eleven chapters cover money, portfolio, funnel, demand, engagement, retention, people, actions,
 * outlook and confidence, followed by a month-on-month appendix. Dynamic decision briefs are
 * grounded in registry metrics, trend shape, sample and coverage, so prose and adjacent tables
 * always come from the same computation and cannot drift apart.
 */
import type { Scope } from '../state/data';
import type { Thresholds } from '../state/view';
import { metric, type TableName } from '../semantics/metrics';
import { GROUP_KEYS, historyMonths, metricValues, rollupLevel, seriesBy, type Row } from '../semantics/aggregations';
import { fmtCurrency, fmtDelta, fmtMonthShort, fmtPercent, formatValue } from '../semantics/formats';
import { runRules, summariseImpact } from '../insights/engine';
import type { Insight } from '../insights/rules';
import { scopeLine } from '../api/export';

/* ── Chapter order. Shared by the top nav, the side rail, the footer contents list and the
      anchor each section header prints, so the four can never disagree. ── */
export const CHAPTERS = [
  { id: 'executive-summary', nav: 'Overview', no: '01', title: 'Executive summary' },
  { id: 'revenue-performance', nav: 'Revenue', no: '02', title: 'Revenue and sales performance' },
  { id: 'location-portfolio', nav: 'Locations', no: '03', title: 'Location and product portfolio' },
  { id: 'conversion-funnel', nav: 'Funnel', no: '04', title: 'New client conversion funnel' },
  { id: 'sessions', nav: 'Sessions', no: '05', title: 'Sessions and class performance' },
  { id: 'engagement', nav: 'Engagement', no: '06', title: 'Member engagement and attendance' },
  { id: 'lapsed', nav: 'Retention', no: '07', title: 'Lapsed memberships deep dive' },
  { id: 'people-economics', nav: 'People', no: '08', title: 'People and unit economics' },
  { id: 'recommendations', nav: 'Actions', no: '09', title: 'Strategic recommendations' },
  { id: 'predictions', nav: 'Outlook', no: '10', title: 'Predictions and forward view' },
  { id: 'methodology', nav: 'Confidence', no: '11', title: 'Data confidence and methodology' },
] as const;

export type ChapterId = typeof CHAPTERS[number]['id'];

export interface ReportKpi {
  id: string; label: string; formatted: string; value: number | null;
  prevFormatted: string; delta: string; deltaValue: number | null; good: boolean | null;
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

/** A grounded analytical synthesis. These are generated afresh for the report scope from metric
 * deltas, trend shape, sample and coverage — never free-written independently of the numbers. */
export interface ReportInsight {
  tone: 'risk' | 'opportunity' | 'driver' | 'context';
  headline: string;
  finding: string;
  action: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
  method: string;
}

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
  insights: ReportInsight[];
  tables: ReportTable[];
  /** Registered here as the chapter renders; the appendix prints them all together. */
  mom?: ReportTable;
  chart?: { kind: 'line' | 'bars'; title: string; labels: string[]; values: (number | null)[]; fmt: string };
}

export interface ReportModel {
  meta: {
    title: string; studio: string; periodLabel: string; comparedWith: string;
    generated: string; scopeLine: string; rowsInScope: number;
    dataThrough: string; scopeEnd?: string; locations?: string[];
  };
  chapters: ReportChapter[];
  actions: ReportAction[];
  appendix: ReportTable[];
  impact: { basis: string; net: number; gross: number; entities: number; overlapping: number }[];
  /** Optional AI-authored interpretation. Deterministic chapters remain the source of truth. */
  ai?: {
    provider: 'openai'; model: string; generatedAt: string; executiveSummary: string;
    crossFunctionalInsights: { headline: string; finding: string; evidence: string; recommendation: string; confidence: 'high' | 'medium' | 'low' }[];
    chapterBriefs: { chapterId: string; summary: string; implications: string[]; actions: string[] }[];
    assumptions: string[];
  };
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
    delta: d.text, deltaValue: d.value,
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

const ACTION_BY_METRIC: Record<string, string> = {
  gross_revenue: 'Trace the change to location, product and salesperson, then protect the two largest drivers next period.',
  net_revenue: 'Review discount and product mix before changing top-line targets.',
  v_fill_rate: 'Move one class from the weakest recurring slot into the strongest unmet-demand window and measure the next four occurrences.',
  fill_rate: 'Compare like-for-like slots and coach or reallocate where trainer draw remains below the peer median.',
  conversion_rate: 'Inspect first-visit source, trainer and follow-up timing; give the owner a seven-day conversion list.',
  second_visit_rate: 'Contact first-timers within 24 hours and offer a specific second class rather than a generic promotion.',
  churn_rate: 'Prioritise high-value members expiring within 30 days and record the save outcome.',
  renewal_rate: 'Start renewal conversations before expiry and segment the offer by utilisation rather than discounting everyone.',
  v_no_show_rate: 'Target the members and slots causing most no-shows with reminders and wait-list backfill.',
  response_time_hours: 'Assign every untouched lead to an owner and set a same-day response service level.',
  p_margin: 'Compare contribution by trainer after controlling for slot quality; do not cut cost on volume alone.',
  visits: 'Separate the movement into new-member volume and repeat frequency before changing the timetable.',
};

/** Dynamic decision intelligence grounded in the same KPI objects that print above it. */
function groundedInsights(kpis: ReportKpi[], max = 3): ReportInsight[] {
  const measurable = kpis.filter((k) => k.value !== null && k.deltaValue !== null);
  const confidenceOf = (k: ReportKpi): ReportInsight['confidence'] =>
    k.sample < metric(k.id).minSample || (k.coverage !== null && k.coverage < 0.6) ? 'low'
      : k.coverage !== null && k.coverage < 0.9 ? 'medium' : 'high';
  const magnitude = (k: ReportKpi) => Math.abs(k.deltaValue ?? 0);
  const ordered = [...measurable].sort((a, b) => {
    if (a.good !== b.good) return a.good === false ? -1 : 1;
    return magnitude(b) - magnitude(a);
  });
  const out: ReportInsight[] = ordered.slice(0, max).map((k) => ({
    tone: k.good === false ? 'risk' : 'opportunity',
    headline: `${k.label}: ${k.good ? 'momentum to compound' : 'movement to investigate'}`,
    finding: `${k.label} is ${k.formatted}, ${k.delta} versus the comparison period. ${k.definition}`,
    action: ACTION_BY_METRIC[k.id] ?? `Break ${k.label.toLowerCase()} down by location and its primary operating dimension, then assign the largest controllable gap to an owner.`,
    confidence: confidenceOf(k),
    evidence: `${k.formatted} now · ${k.prevFormatted} before · n = ${k.sample.toLocaleString('en-IN')}${k.coverage !== null ? ` · ${(k.coverage * 100).toFixed(0)}% coverage` : ''}`,
    method: `Direction is evaluated using the registry definition (${k.formula}) and whether higher is better; magnitude is the period-on-period change.`,
  }));

  // Add a trend-shape insight when period comparison alone would hide a recent reversal.
  const trendCandidates = kpis.map((k) => {
    const v = k.spark.filter((x): x is number => x !== null && Number.isFinite(x));
    if (v.length < 4) return null;
    const recent = v.slice(-3); const previous = v.slice(-6, -3);
    if (!previous.length) return null;
    const r = recent.reduce((a, b) => a + b, 0) / recent.length;
    const p = previous.reduce((a, b) => a + b, 0) / previous.length;
    return { k, change: p ? (r - p) / Math.abs(p) : null };
  }).filter((x): x is { k: ReportKpi; change: number | null } => x !== null && x.change !== null)
    .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
  const trend = trendCandidates[0];
  if (out.length < max && trend && Math.abs(trend.change ?? 0) >= 0.05) {
    const improving = ((trend.change ?? 0) >= 0) === metric(trend.k.id).higherIsBetter;
    out.push({
      tone: improving ? 'driver' : 'risk',
      headline: `${trend.k.label}: the recent run is ${improving ? 'strengthening' : 'weakening'}`,
      finding: `The latest three-month average is ${Math.abs((trend.change ?? 0) * 100).toFixed(1)}% ${trend.change! >= 0 ? 'above' : 'below'} the preceding three months.`,
      action: ACTION_BY_METRIC[trend.k.id] ?? `Check the month-by-month breakdown and isolate the entities driving this change.`,
      confidence: confidenceOf(trend.k),
      evidence: `Six-month directional comparison · ${trend.k.sample.toLocaleString('en-IN')} rows in the report period`,
      method: 'Compares the mean of the latest three available months with the three months immediately before them; no forecast is implied.',
    });
  }
  return out;
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
  const months = historyMonths(scope.today.slice(0, 7));
  // A metric may appear in several chapters. Build it once: on large visit grains this removes
  // millions of duplicate row scans and keeps report generation responsive.
  const kpiCache = new Map<string, ReportKpi>();
  const K = (id: string) => { const hit = kpiCache.get(id); if (hit) return hit; const built = buildKpi(scope, id, months); kpiCache.set(id, built); return built; };
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
    insights: groundedInsights(exec),
    tables: [groupTable(scope, {
      title: 'Performance by location', metrics: ['visits', 'v_fill_rate', 'v_rev_per_visit', 'v_unique_members'],
      groupBy: 'location', limit: 8,
      note: 'Visits are the canonical grain — one row per member per class — so this agrees with every other chapter.',
    })],
    mom: momTable(scope, 'Executive summary', ['gross_revenue', 'visits', 'v_fill_rate', 'new_clients', 'conversion_rate'], months),
    chart: { kind: 'line', title: 'Revenue, thirteen months', labels: months.map(fmtMonthShort), values: exec[0].spark, fmt: 'currency' },
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
    insights: groundedInsights(rev),
    tables: [
      groupTable(scope, { title: 'Revenue by category', note: 'Sale payments are allocated once across post-discount line values, so category totals reconcile to gross revenue.', metrics: ['category_revenue', 'transactions', 'aov', 'discount_rate'], groupBy: 'category', limit: 10 }),
      groupTable(scope, { title: 'Top products', metrics: ['gross_revenue', 'units', 'aov'], groupBy: 'product', limit: 10 }),
      groupTable(scope, { title: 'Sold by', metrics: ['gross_revenue', 'transactions', 'aov', 'discount_rate'], groupBy: 'sold_by', limit: 8 }),
    ],
    mom: momTable(scope, 'Revenue', ['gross_revenue', 'net_revenue', 'transactions', 'aov', 'discount_rate', 'membership_rev_share'], months),
    chart: { kind: 'line', title: 'Gross revenue, thirteen months', labels: months.map(fmtMonthShort), values: rev[0].spark, fmt: 'currency' },
  });

  /* 03 — Location and product portfolio. */
  const portfolio = [K('gross_revenue'), K('v_rev_per_visit'), K('membership_rev_share'), K('discount_rate'), K('v_fill_rate'), K('conversion_rate')];
  register({
    id: 'location-portfolio', nav: 'Locations', no: '03', title: 'Location and product portfolio',
    standfirst: 'Where the business is creating volume, value and repeatable demand — and where mix is masking under-performance.',
    kpis: portfolio,
    narrative: [
      `This view reads location performance through three different lenses: sales booked, visits delivered and new-client conversion. They are kept separate because purchase date and attendance date answer different questions.`,
      `${portfolio[1].label} is ${portfolio[1].formatted}, class fill is ${portfolio[4].formatted}, and memberships account for ${portfolio[2].formatted} of revenue. Together they show whether growth is coming from more bodies, better yield or a change in product mix.`,
    ],
    bullets: bulletsFromKpis(portfolio),
    insights: groundedInsights(portfolio),
    tables: [
      groupTable(scope, { title: 'Sales by location', metrics: ['gross_revenue', 'transactions', 'aov', 'discount_rate'], groupBy: 'location', limit: 12 }),
      groupTable(scope, { title: 'Attendance economics by location', metrics: ['visits', 'v_unique_members', 'v_fill_rate', 'v_rev_per_visit'], groupBy: 'location', limit: 12 }),
      groupTable(scope, { title: 'Product portfolio', metrics: ['gross_revenue', 'units', 'aov', 'discount_rate'], groupBy: 'product', limit: 15 }),
      groupTable(scope, { title: 'New-client quality by location', metrics: ['new_clients', 'second_visit_rate', 'conversion_rate', 'median_ltv'], groupBy: 'location', limit: 12 }),
    ],
    mom: momTable(scope, 'Location and portfolio', ['gross_revenue', 'v_rev_per_visit', 'membership_rev_share', 'v_fill_rate', 'conversion_rate'], months),
  });

  /* 04 — Funnel. */
  const fun = [K('new_clients'), K('second_visit_rate'), K('conversion_rate'), K('median_conversion_span'), K('median_ltv'), K('zero_return_rate')];
  const fresh = (scope.tables.newc ?? []).filter((r) => r.is_new);
  const mature = fresh.filter((r) => r.ts !== null && r.ts <= scope.ctx.todayTs - scope.ctx.matureDays * 864e5);
  const bought = mature.filter((r) => r.converted);
  const members = bought.filter((r) => (r.memberships_bought ?? 0) > 0);
  const observed90 = members.filter((r) => r.ts !== null && scope.ctx.todayTs - r.ts >= 90 * 864e5);
  const stages: [string, number][] = [
    ['Leads created', (scope.tables.leads ?? []).length],
    /* From the New sheet, like every stage below it — the Leads sheet under-records trials and is
       scoped by enquiry date, which made this stage smaller than the first visits it contains. */
    ['Booked or took a trial', mature.length],
    ['First visit', mature.length],
    ['Second visit', mature.filter((r) => (r.visits_post_trial ?? 0) > 0).length],
    ['Bought something', bought.length],
    ['Bought a membership', members.length],
    ['Still active at 90 days', observed90.filter((r) => (r.days_active ?? 0) >= 90).length],
  ];
  const top = stages[0][1] || 1;
  register({
    id: 'conversion-funnel', nav: 'Funnel', no: '04', title: 'New client conversion funnel',
    standfirst: `From enquiry to a member still training at ninety days. The stage counts use the ${mature.length.toLocaleString('en-IN')} first visits with at least ${scope.ctx.matureDays} days of history; the KPI cards above use all ${fresh.length.toLocaleString('en-IN')} first visits in the period, which is why the two differ.`,
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
    insights: groundedInsights(fun),
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
          + 'them as volumes at each stage rather than as one group walking through. From the first visit down each stage is a '
          + 'strict subset of the one above it. '
          + (observed90.length < members.length
            ? `The ninety-day stage is measured on the ${observed90.length.toLocaleString('en-IN')} membership buyers whose first visit is at least ninety days old; the rest have not had the time yet and are not counted as lost.`
            : ''),
      },
      groupTable(scope, { title: 'By acquisition source', metrics: ['new_clients', 'second_visit_rate', 'conversion_rate', 'median_ltv'], groupBy: 'source', limit: 10 }),
      groupTable(scope, { title: 'By first-visit trainer', metrics: ['new_clients', 'conversion_rate', 'retention_rate'], groupBy: 'trainer', limit: 10 }),
    ],
    mom: momTable(scope, 'Funnel', ['new_clients', 'second_visit_rate', 'conversion_rate', 'median_ltv', 'retention_rate'], months),
    chart: { kind: 'bars', title: 'Funnel', labels: stages.map((s) => s[0]), values: stages.map((s) => s[1]), fmt: 'integer' },
  });

  /* 05 — Sessions and demand. */
  const ses = [K('v_sessions'), K('visits'), K('v_fill_rate'), K('v_attendance_per_session'), K('v_no_show_rate'), K('v_late_cancel_rate')];
  register({
    id: 'sessions', nav: 'Sessions', no: '05', title: 'Sessions and class performance',
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
    insights: groundedInsights(ses),
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
    chart: { kind: 'line', title: 'Visits, thirteen months', labels: months.map(fmtMonthShort), values: ses[1].spark, fmt: 'integer' },
  });

  /* 06 — Engagement and attendance behaviour. */
  const engagement = [K('visits'), K('v_unique_members'), K('v_visits_per_member'), K('v_repeat_rate'), K('v_power_users'), K('v_new_share')];
  register({
    id: 'engagement', nav: 'Engagement', no: '06', title: 'Member engagement and attendance',
    standfirst: 'How broad the audience is, how often people return, and whether attendance depends on a small core.',
    kpis: engagement,
    narrative: [
      `${engagement[1].formatted} distinct members generated ${engagement[0].formatted} visits, or ${engagement[2].formatted} per member. ${engagement[3].formatted} returned more than once in the period.`,
      `${engagement[4].formatted} members qualify as power users and ${engagement[5].formatted} of attendance came from new clients. Read those together: concentration can protect current volume while weakening the future pipeline.`,
    ],
    bullets: bulletsFromKpis(engagement),
    insights: groundedInsights(engagement),
    tables: [
      groupTable(scope, { title: 'Engagement by location', metrics: ['visits', 'v_unique_members', 'v_visits_per_member', 'v_repeat_rate'], groupBy: 'location', limit: 12 }),
      groupTable(scope, { title: 'Engagement by membership type', metrics: ['visits', 'v_unique_members', 'v_visits_per_member', 'v_rev_per_visit'], groupBy: 'membership_type', limit: 12 }),
      groupTable(scope, { title: 'Class preferences', metrics: ['visits', 'v_unique_members', 'v_new_share', 'v_complimentary_rate'], groupBy: 'format', limit: 10 }),
      groupTable(scope, { title: 'Attendance by day', metrics: ['visits', 'v_unique_members', 'v_repeat_rate'], groupBy: 'day', limit: 7, order: 'natural' }),
    ],
    mom: momTable(scope, 'Engagement', ['visits', 'v_unique_members', 'v_visits_per_member', 'v_repeat_rate', 'v_new_share'], months),
    chart: { kind: 'line', title: 'Distinct attending members, thirteen months', labels: months.map(fmtMonthShort), values: engagement[1].spark, fmt: 'integer' },
  });

  /* 07 — Retention and lapsed. */
  const ret = [K('active_memberships'), K('churn_rate'), K('renewal_rate'), K('high_risk_members'), K('revenue_at_risk_30d'), K('never_activated')];
  register({
    id: 'lapsed', nav: 'Retention', no: '07', title: 'Lapsed memberships deep dive',
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
    insights: groundedInsights(ret),
    tables: [
      groupTable(scope, { title: 'By membership type', metrics: ['memberships', 'churn_rate', 'renewal_rate', 'utilisation'], groupBy: 'membership_type', limit: 10 }),
      groupTable(scope, { title: 'By risk band', metrics: ['memberships', 'risk_score', 'avg_days_since_visit', 'l_revenue'], groupBy: 'risk_band', limit: 6, order: 'natural' }),
      groupTable(scope, { title: 'By location', metrics: ['active_memberships', 'churn_rate', 'member_ltv'], groupBy: 'location', limit: 8 }),
    ],
    mom: momTable(scope, 'Retention', ['active_memberships', 'churned_memberships', 'churn_rate', 'renewal_rate', 'liability'], months),
    chart: { kind: 'line', title: 'Churn rate, thirteen months', labels: months.map(fmtMonthShort), values: ret[1].spark, fmt: 'percent' },
  });

  /* 08 — People and unit economics. */
  const people = [K('p_sessions'), K('p_revenue'), K('p_cost'), K('p_margin'), K('p_empty_rate'), K('p_conversion_rate')];
  register({
    id: 'people-economics', nav: 'People', no: '08', title: 'People and unit economics',
    standfirst: 'The teaching load, payroll envelope and contribution created by the people delivering the service.',
    kpis: people,
    narrative: [
      `${people[0].formatted} payroll sessions carried ${people[2].formatted} of teaching cost against ${people[1].formatted} of attributed revenue, leaving a ${people[3].formatted} contribution margin.`,
      `${people[4].formatted} of paid sessions were empty and trainer-handled new clients converted at ${people[5].formatted}. These measures belong together: utilisation, commercial value and coaching quality should be managed as a system.`,
    ],
    bullets: bulletsFromKpis(people),
    insights: groundedInsights(people),
    tables: [
      groupTable(scope, { title: 'Trainer economics', metrics: ['p_sessions', 'p_customers', 'p_revenue', 'p_cost', 'p_margin'], groupBy: 'trainer', limit: 20 }),
      groupTable(scope, { title: 'Payroll by location', metrics: ['p_sessions', 'p_revenue', 'p_cost', 'p_contribution', 'payroll_pct_of_revenue'], groupBy: 'location', limit: 12 }),
      groupTable(scope, { title: 'Trainer acquisition contribution', metrics: ['p_new', 'p_converted', 'p_conversion_rate', 'p_retained', 'p_retention_rate'], groupBy: 'trainer', limit: 20 }),
    ],
    mom: momTable(scope, 'People and economics', ['p_sessions', 'p_revenue', 'p_cost', 'p_margin', 'p_conversion_rate', 'p_retention_rate'], months),
    chart: { kind: 'line', title: 'Payroll cost, thirteen months', labels: months.map(fmtMonthShort), values: people[2].spark, fmt: 'currency' },
  });

  /* 09 — Actions. */
  const actions = actionsFrom(insights);
  register({
    id: 'recommendations', nav: 'Actions', no: '09', title: 'Strategic recommendations',
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
    insights: insights.slice(0, 4).map((i) => ({
      tone: i.severity === 'critical' || i.severity === 'attention' ? 'risk' : i.severity === 'opportunity' ? 'opportunity' : 'context',
      headline: i.title, finding: i.body, action: i.action,
      confidence: (i.n ?? 0) >= 30 ? 'high' : (i.n ?? 0) >= 10 ? 'medium' : 'low',
      evidence: sentence([i.entity, i.impactINR > 0 ? fmtCurrency(i.impactINR) : null, i.n !== undefined ? `n = ${i.n}` : null]),
      method: `Generated by rule ${i.rule}; impact is netted by ${i.basis ?? 'entity'} before report totals are shown.`,
    })),
    tables: [],
  });

  /* 10 — Outlook.
     The thirteen-month series runs to the month containing `today`, which is usually still in
     progress. A partial month would drag any trailing mean down, so everything after the month
     being reported on is dropped before projecting. */
  const reportMonth = scope.period.end.slice(0, 7);
  /* A month only counts as complete when the reporting window actually covers its last day.
     The reporting month itself is dropped for MTD and for any custom window that stops short,
     and a report month outside the thirteen-month series drops everything after it rather than
     silently keeping the current months (the old `cut = -1` path). */
  const lastDayOfReportMonth = new Date(Date.UTC(+reportMonth.slice(0, 4), +reportMonth.slice(5, 7), 0)).toISOString().slice(0, 10);
  const reportMonthComplete = scope.period.end >= lastDayOfReportMonth;
  const idx = months.indexOf(reportMonth);
  const cut = idx >= 0 ? (reportMonthComplete ? idx : idx - 1)
    : months.filter((m) => m <= reportMonth).length - 1;     // report month after the series end
  const complete = <T,>(s: T[]) => s.slice(0, Math.max(0, cut + 1));
  const completeMonths = complete(months);
  const revSeries = complete(exec[0].spark);
  const visSeries = complete(ses[1].spark);
  const revP = project(revSeries);
  const visP = project(visSeries);
  const expiring = metricValues(rowsFor(scope, 'lapsed'), ['expiring_30d', 'revenue_at_risk_30d'], scope.ctx);
  const pipeline = metricValues(rowsFor(scope, 'leads'), ['open_leads', 'pipeline_value'], scope.ctx);
  register({
    id: 'predictions', nav: 'Outlook', no: '10', title: 'Predictions and forward view',
    standfirst: 'A projection from the trailing run, plus the money already on the books.',
    kpis: [],
    narrative: [
      completeMonths.length < 4
        ? `Only ${completeMonths.length} complete month${completeMonths.length === 1 ? '' : 's'} of history fall inside this report, which is not enough to project from. Widen the period to at least four complete months.`
        : '',
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
      `Method: the midpoint is the mean of the last three complete months plus the slope of the last six; the range is the larger of that slope or eight per cent of the mean. History runs to ${completeMonths.length ? fmtMonthShort(completeMonths[completeMonths.length - 1]) : 'no complete month'}${reportMonthComplete ? '' : `; ${fmtMonthShort(reportMonth)} is still in progress and is excluded`}. It is a run-rate, not a forecast — it assumes nothing changes.`,
    ].filter(Boolean),
    bullets: [],
    insights: [
      ...(revP ? [{
        tone: (revP.mid >= (revSeries.filter((v): v is number => v !== null).slice(-1)[0] ?? revP.mid) ? 'opportunity' : 'risk') as ReportInsight['tone'],
        headline: 'Next-month revenue run-rate',
        finding: `The grounded run-rate midpoint is ${fmtCurrency(revP.mid)}, with a sensitivity range from ${fmtCurrency(revP.low)} to ${fmtCurrency(revP.high)}.`,
        action: 'Use the low case for cash planning, the midpoint for staffing, and only use the high case after leading indicators confirm it.',
        confidence: (revSeries.filter((v) => v !== null).length >= 6 ? 'medium' : 'low') as ReportInsight['confidence'],
        evidence: `${revSeries.filter((v) => v !== null).length} complete monthly observations · range width ${fmtCurrency(revP.high - revP.low)}`,
        method: 'Trailing three-month mean plus six-month linear slope; uncertainty is the larger of 1.5× slope or 8% of the mean.',
      }] : []),
      {
        tone: 'driver', headline: 'Committed next-period workload',
        finding: `${formatValue('integer', expiring.expiring_30d.value)} expiries and ${formatValue('integer', pipeline.open_leads.value)} open leads are already visible.`,
        action: 'Assign every expiry and qualified open lead before the period begins; report contacted, won and unresolved each week.',
        confidence: 'high', evidence: `${fmtCurrency(expiring.revenue_at_risk_30d.value)} at renewal · ${fmtCurrency(pipeline.pipeline_value.value)} pipeline`,
        method: 'Counts source records whose expiry or open status falls inside the configured 30-day horizon.',
      },
    ],
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

  /* 11 — Data confidence and methodology. */
  const grains: { label: string; table: TableName; meaning: string }[] = [
    { label: 'Canonical visits', table: 'visits', meaning: 'One member × one class occurrence; Checkins is authoritative and booking lifecycle is joined where available.' },
    { label: 'Sessions', table: 'sessions', meaning: 'One class occurrence; can be derived from Checkins while the private Sessions source is unavailable.' },
    { label: 'Sales', table: 'sales', meaning: 'One sale line booked on payment date.' },
    { label: 'New clients', table: 'newc', meaning: 'One client cohort record anchored on first visit.' },
    { label: 'Memberships', table: 'lapsed', meaning: 'One membership interval, included when it overlaps the report period.' },
    { label: 'Payroll', table: 'payroll', meaning: 'One trainer-month payroll record.' },
    { label: 'Leads', table: 'leads', meaning: 'One enquiry anchored on creation date.' },
  ];
  const coverageKpis = [...exec, ...rev, ...fun, ...ses, ...engagement, ...ret, ...people];
  const limited = coverageKpis.filter((k) => k.coverage !== null && k.coverage < 0.9);
  register({
    id: 'methodology', nav: 'Confidence', no: '11', title: 'Data confidence and methodology',
    standfirst: 'What the report can support, where coverage is partial, and exactly how calculations roll up.',
    kpis: [],
    narrative: [
      `${scope.rowsInScope.toLocaleString('en-IN')} normalised records contribute to this report scope across ${grains.length} analytical grains. A missing value is never silently converted to zero.`,
      limited.length
        ? `${limited.length} headline metric instances have less than 90% contributing-row coverage. Each is disclosed below; decisions should be weighted toward the higher-coverage measures.`
        : 'Every headline metric with a row-based input has at least 90% coverage in this scope.',
      'Rates are always recomputed from summed numerators and denominators at the displayed level. Currency uses INR; cohorts are anchored to their event date; membership records use interval overlap.',
    ],
    bullets: limited.slice(0, 8).map((k) => ({
      headline: `${k.label}: partial coverage`,
      meaning: `${k.definition} The result is based on ${k.sample.toLocaleString('en-IN')} rows in scope.`,
      evidence: `${((k.coverage ?? 0) * 100).toFixed(1)}% contributing coverage · ${k.formula}`,
    })),
    insights: [{
      tone: limited.length ? 'context' : 'opportunity',
      headline: limited.length ? 'Use coverage-weighted judgement' : 'Headline coverage supports normal decision use',
      finding: limited.length ? `${limited.length} headline measures depend on a subset of their grain.` : 'No headline coverage exception crossed the 90% disclosure threshold.',
      action: limited.length ? 'Resolve the lowest-coverage source fields before using those measures for compensation or irreversible schedule changes.' : 'Keep the current source checks and investigate any future drop below 90%.',
      confidence: 'high', evidence: `${coverageKpis.length} metric instances checked · ${limited.length} below threshold`,
      method: 'Coverage equals rows carrying all inputs required by a metric divided by rows in that metric’s scoped grain.',
    }],
    tables: [
      {
        title: 'Analytical grains in this report', columns: ['Source grain', 'Rows in period', 'Rows in filtered history', 'Meaning'],
        rows: grains.map((g) => [g.label, rowsFor(scope, g.table).length, (scope.all[g.table] ?? []).length, g.meaning]), numeric: [1, 2],
        note: 'The same filters are applied across grains only where the source actually carries that dimension.',
      },
      {
        title: 'Headline metric definitions and coverage', columns: ['Metric', 'Value', 'Coverage', 'Sample', 'Formula', 'Sources'],
        rows: coverageKpis.filter((k, i, a) => a.findIndex((x) => x.id === k.id) === i).map((k) => [k.label, k.formatted, k.coverage === null ? '—' : fmtPercent(k.coverage), k.sample, k.formula, k.sources.join(' · ')]),
        numeric: [1, 2, 3], note: 'Definitions come directly from the metric registry used by the dashboard, chatbot and API.',
      },
    ],
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
      scopeEnd: scope.period.end,
      locations: scope.filters.locations,
    },
    chapters, actions, appendix, impact,
  };
}
