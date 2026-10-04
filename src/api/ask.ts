/* Question answering, grounded in the registry.
 *
 * Takes a plain-English question, resolves the business terms against the metric registry,
 * runs the real computation over the live scope, and returns an answer that always states the
 * number, the scope it came from, and the definition behind it. If a term cannot be resolved it
 * says so and offers the nearest metrics — it never claims the data does not exist when it does.
 */
import type { Scope } from '../state/data';
import type { MetricDef } from '../semantics/metrics';
import { GROUP_KEYS, metricValues, rollupLevel, seriesBy, lastNMonths } from '../semantics/aggregations';
import { fmtDelta, fmtMonthShort, formatValue } from '../semantics/formats';
import { findDimension, grainOf, normalise, resolveTerm, searchMetrics } from './resolve';
import { runRules, summariseImpact } from '../insights/engine';
import type { Thresholds, TabId } from '../state/view';
import { ENDPOINTS } from './agent';
import { defaultTitle, tabForMetric, type WidgetKind, type WidgetSpec } from './widgets';

export type Intent = 'value' | 'breakdown' | 'rank' | 'trend' | 'compare' | 'define' | 'signals' | 'help' | 'build';

export interface AskResult {
  question: string;
  intent: Intent;
  answer: string;                 // the sentence an operator reads
  detail?: string;                // supporting sentence
  metricId?: string;
  dimension?: string;
  table?: { columns: string[]; rows: (string | number | null)[][] };
  scope: string;
  provenance?: { label: string; formula: string; sources: string[]; grain: string; coverage: string | null };
  suggestions: string[];
  tab?: TabId;
  confidence: 'exact' | 'synonym' | 'likely' | 'guess';
  unresolved?: boolean;
  /** When the question asked for something to be built, the spec that would be pinned. */
  buildSpec?: Partial<WidgetSpec>;
}

const TOP_WORDS = /\b(top|best|highest|most|strongest|leading)\b/;
const BOTTOM_WORDS = /\b(worst|lowest|bottom|weakest|least|poorest)\b/;
const TREND_WORDS = /\b(trend|over time|by month|monthly|history|trajectory|movement|moving)\b/;
const COMPARE_WORDS = /\b(vs|versus|compared|change|changed|up or down|better or worse|movement)\b/;
const DEFINE_WORDS = /\b(what is|what does|define|definition|meaning|how is .* calculated|how do you calculate|formula)\b/;
const SIGNAL_WORDS = /\b(signal|insight|alert|problem|issue|worry|concern|what should i|what do i do|priorit)\b/;
const BUILD_WORDS = /\b(add|pin|build|create|make|put|save|chart it|show me a (chart|table|card)|as a (chart|table|card|heatmap))\b/;
const HELP_WORDS = /\b(help|what can you|capabilit|which metrics|list metrics|vocabulary)\b/;
/* An explicit request to split the number up. "per" only counts when it introduces a grouping
   ("per location"), never when it is part of a metric name ("revenue per head"). */
const GROUPING_CUE = /\b(by|across|split|grouped?|break ?down|broken down)\b/;

function intentOf(q: string): Intent {
  const s = normalise(q);
  if (BUILD_WORDS.test(s) && !/\b(what|why|how much|how many)\b/.test(s)) return 'build';
  if (HELP_WORDS.test(s)) return 'help';
  if (SIGNAL_WORDS.test(s)) return 'signals';
  if (DEFINE_WORDS.test(s)) return 'define';
  if (TREND_WORDS.test(s)) return 'trend';
  if (TOP_WORDS.test(s) || BOTTOM_WORDS.test(s)) return 'rank';
  if (COMPARE_WORDS.test(s)) return 'compare';
  if (GROUPING_CUE.test(s)) return 'breakdown';
  return 'value';
}

/** Strip the words the metric name already accounts for, so "revenue per head" does not read
 *  "head" as a dimension and "speed to lead" does not read "lead" as one. */
function stripMetricWords(q: string, def: MetricDef): string {
  let out = normalise(q);
  for (const w of normalise(def.label).split(' ')) if (w.length > 2) out = out.replace(new RegExp(`\\b${w}\\b`, 'g'), ' ');
  return out.replace(/\b(per|rate|value|score|share|time|speed|head|number|count)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

const tabFor = (def: MetricDef): TabId => {
  const ep = ENDPOINTS.find((e) => e.headline.includes(def.id)) ?? ENDPOINTS.find((e) => e.metrics.includes(def.id));
  return ep?.tab ?? 'overview';
};

const scopeSentence = (s: Scope) => {
  const f = s.filters;
  const bits = [s.period.label];
  if (f.locations.length) bits.push(f.locations.length === 1 ? f.locations[0] : `${f.locations.length} locations`);
  if (f.trainers.length) bits.push(`${f.trainers.length} trainer${f.trainers.length > 1 ? 's' : ''}`);
  if (f.formats.length) bits.push(f.formats.join(', '));
  if (f.transient.length) bits.push(...f.transient.map((t) => `${t.dim} = ${t.value}`));
  return bits.join(' · ');
};

const provenanceOf = (def: MetricDef, coverage: number | null): AskResult['provenance'] => ({
  label: def.label, formula: def.formula, sources: def.sources, grain: grainOf(def.table) ?? def.table,
  coverage: coverage !== null && coverage < 0.9 ? `measured on ${(coverage * 100).toFixed(0)}% of rows in scope` : null,
});

export function ask(question: string, scope: Scope, thresholds: Thresholds): AskResult {
  const q = question.trim();
  const base = { question: q, scope: scopeSentence(scope), suggestions: [] as string[], confidence: 'exact' as const };
  if (!q) return { ...base, intent: 'help', answer: 'Ask about any metric, or any breakdown of one.', suggestions: defaultSuggestions() };

  const intent = intentOf(q);

  if (intent === 'help') {
    return { ...base, intent, answer: 'I can answer anything the metric registry can compute — 237 metrics across visits, sales, members, leads, trainers and payroll.',
      detail: 'Ask for a value ("fill rate"), a breakdown ("revenue by location"), a ranking ("worst slots by fill"), a trend ("visits by month"), a comparison ("how did churn change"), or a definition ("what is draw premium"). Terms are resolved against the registry, so trade language works.',
      suggestions: defaultSuggestions() };
  }

  if (intent === 'signals') {
    const ins = runRules(scope, thresholds);
    const totals = summariseImpact(ins);
    const top = ins.slice(0, 5);
    return { ...base, intent,
      answer: top.length ? `${ins.length} signals are firing. The largest is: ${top[0].title}.` : 'Nothing is firing for this scope.',
      detail: totals.length ? totals.map((t) => `${t.basis === 'at-risk' ? 'Revenue at risk' : t.basis === 'sunk' ? 'Paid but unused' : 'Upside'} ${formatValue('currency', t.net)} across ${t.entities} members, after removing ${t.overlapping} duplicate claims.`).join(' ') : undefined,
      table: top.length ? { columns: ['Severity', 'Signal', 'Impact', 'Action'], rows: top.map((i) => [i.severity, i.title, formatValue('currency', i.impactINR), i.action]) } : undefined,
      suggestions: ['What should I do about dormant members?', 'Show churn by membership type', 'Worst slots by fill rate'] };
  }

  /** Which visual the question asked for. */
  const kindFromWords = (text: string, hasGroup: boolean): WidgetKind => {
    const t = normalise(text);
    if (/\bheat ?map\b/.test(t)) return 'heatmap';
    if (/\b(card|kpi|tile|number)\b/.test(t)) return 'metric';
    if (/\b(trend|over time|by month|monthly)\b/.test(t)) return 'trend';
    if (/\b(top and bottom|best and worst|ranking|leaderboard)\b/.test(t)) return 'ranking';
    if (/\bline\b/.test(t)) return 'line';
    if (/\barea\b/.test(t)) return 'area';
    if (/\b(bar)\b/.test(t)) return 'bar';
    if (/\b(column|chart|graph|plot)\b/.test(t)) return 'column';
    if (/\btable\b/.test(t)) return 'table';
    return hasGroup ? 'table' : 'metric';
  };

  // Everything else needs a metric.
  const resolved = resolveTerm(q);
  if (resolved.kind === 'unknown' || !resolved.metric) {
    const near = searchMetrics(q, 6);
    return { ...base, intent, unresolved: true, confidence: 'guess',
      answer: `I could not match "${q}" to a metric in the registry.`,
      detail: near.length ? 'The closest things I can compute are listed below — ask again using one of these names.' : 'Try asking for help to see what is available.',
      table: near.length ? { columns: ['Metric', 'What it measures', 'Grain'], rows: near.map((m) => [m.item.label, m.item.description, grainOf(m.item.table) ?? m.item.table]) } : undefined,
      suggestions: near.slice(0, 4).map((m) => m.item.label) };
  }

  const def = resolved.metric;
  const ep = ENDPOINTS.find((e) => e.metrics.includes(def.id) || e.headline.includes(def.id));
  const rows = scope.tables[def.table] ?? [];
  const cmpRows = scope.compare[def.table] ?? [];
  const cur = metricValues(rows, [def.id], scope.ctx)[def.id];
  const tab = tabFor(def);
  const conf = resolved.confidence;
  const hedge = conf === 'guess' ? ` I read that as ${def.label} — ${resolved.why}.` : conf === 'likely' || conf === 'synonym' ? ` (${resolved.why}.)` : '';
  const altSuggestions = resolved.alternatives.slice(0, 3).map((a) => a.label);

  if (intent === 'define') {
    return { ...base, intent, metricId: def.id, tab, confidence: conf,
      answer: `${def.label}: ${def.description}`,
      detail: `Computed as ${def.formula}, over ${grainOf(def.table)}. ${cur.value !== null ? `Right now it is ${formatValue(def.format, cur.value)} for ${scopeSentence(scope)}.` : 'No rows in the current scope carry the inputs it needs.'}`,
      provenance: provenanceOf(def, cur.coverage),
      suggestions: [`${def.label} by location`, `${def.label} by month`, ...altSuggestions] };
  }

  if (intent === 'trend') {
    const months = lastNMonths(scope.today.slice(0, 7), 12);
    const series = seriesBy(scope.all[def.table] ?? [], (r) => r.month, [def.id], scope.ctx, months);
    const vals = series.map((s) => s.values[def.id].value);
    const first = vals.find((v) => v !== null) ?? null;
    const last = [...vals].reverse().find((v) => v !== null) ?? null;
    const dir = first !== null && last !== null ? (last > first ? 'up' : last < first ? 'down' : 'flat') : 'unclear';
    const good = dir === 'flat' || dir === 'unclear' ? '' : (dir === 'up') === def.higherIsBetter ? ' — moving the right way' : ' — moving the wrong way';
    return { ...base, intent, metricId: def.id, tab, confidence: conf,
      answer: `${def.label} is ${last === null ? 'not measurable' : formatValue(def.format, last)} in the latest month, ${dir}${good} from ${formatValue(def.format, first)} twelve months ago.${hedge}`,
      detail: 'The trend ignores the period filter so the shape is comparable; dimension filters still apply.',
      table: { columns: ['Month', def.label], rows: series.map((s, i) => [fmtMonthShort(s.key), vals[i] === null ? null : Number(vals[i]!.toFixed(4))]) },
      provenance: provenanceOf(def, cur.coverage),
      suggestions: [`${def.label} by location`, `Top locations by ${def.label}`, ...altSuggestions] };
  }

  if (intent === 'compare') {
    const prev = metricValues(cmpRows, [def.id], scope.ctx)[def.id];
    const d = fmtDelta(def.format, cur.value, prev.value);
    const better = d.value === null ? null : (d.value >= 0) === def.higherIsBetter;
    return { ...base, intent, metricId: def.id, tab, confidence: conf,
      answer: `${def.label} is ${formatValue(def.format, cur.value)} for ${scope.period.label}, against ${formatValue(def.format, prev.value)} in ${scope.period.prevLabel} — ${d.text}${better === null ? '' : better ? ', an improvement' : ', a deterioration'}.${hedge}`,
      detail: cur.coverage !== null && cur.coverage < 0.9 ? `Measured on ${(cur.coverage * 100).toFixed(0)}% of rows in scope — the rest do not carry the inputs.` : undefined,
      provenance: provenanceOf(def, cur.coverage),
      suggestions: [`${def.label} by month`, `${def.label} by location`, ...altSuggestions] };
  }

  if (intent === 'build') {
    const bDim = findDimension(stripMetricWords(q, def));
    const kind = kindFromWords(q, !!bDim);
    const needsGroup = !['metric', 'trend'].includes(kind);
    // A tab named in the question wins; otherwise the metric's natural home.
    const named = ENDPOINTS.find((e) => normalise(q).includes(normalise(e.title)) || normalise(q).includes(e.tab));
    const target = named?.tab ?? tabForMetric(def.id);
    if (needsGroup && !bDim) {
      return { ...base, intent, metricId: def.id, tab: target, confidence: conf,
        answer: `I can build a ${kind} of ${def.label}, but I need to know how to cut it.`,
        detail: `Say for example "${def.label} by location" or "by month". Anything the ${def.table} grain carries will work.`,
        suggestions: [`Add ${def.label} by location to ${target}`, `Add ${def.label} by month to ${target}`, `Pin ${def.label} as a card`] };
    }
    const spec: Partial<WidgetSpec> = {
      tab: target, kind, metrics: [def.id], groupBy: needsGroup ? bDim ?? undefined : undefined,
      groupBy2: kind === 'heatmap' ? (bDim === 'day' ? 'hour_of_day' : 'location') : undefined,
      placement: /\b(top|pin)\b/.test(normalise(q)) ? 'top' : 'bottom',
      title: defaultTitle([def.id], needsGroup ? bDim ?? undefined : undefined, kind), source: 'ask',
    };
    const what = kind === 'metric' ? 'metric card' : kind === 'table' ? 'table' : `${kind} chart`;
    return { ...base, intent, metricId: def.id, dimension: bDim ?? undefined, tab: target, confidence: conf, buildSpec: spec,
      answer: `Ready to add a ${what} of ${def.label}${bDim ? ` by ${GROUP_KEYS[bDim].label.toLowerCase()}` : ''} to the ${target} tab.`,
      detail: "It recomputes from whatever filters are active, so it stays live rather than freezing today's numbers. Review it below, then add it.",
      suggestions: [`Add ${def.label} by month instead`, 'Make it a chart', 'Pin it to the top'] };
  }

  /* Only group when the question asks for it. Otherwise an incidental word — "lead" in
     "speed to lead", "head" in "revenue per head" — silently turns a single number into a
     breakdown the operator never requested. */
  const asksForGrouping = GROUPING_CUE.test(normalise(q)) || intent === 'rank' || intent === 'breakdown';
  const explicitDim = asksForGrouping ? findDimension(stripMetricWords(q, def)) : null;
  const dim = explicitDim ?? (intent === 'rank' || intent === 'breakdown' ? (ep?.groupBy[0] ?? 'location') : null);

  if (dim && GROUP_KEYS[dim]) {
    const nodes = rollupLevel(rows, [dim], 0, [def.id], scope.ctx)
      .filter((n) => n.rows.length >= (intent === 'rank' ? def.minSample : 1) && n.values[def.id].value !== null);
    const descending = !BOTTOM_WORDS.test(normalise(q)) ? def.higherIsBetter : !def.higherIsBetter;
    nodes.sort((a, b) => ((b.values[def.id].value ?? 0) - (a.values[def.id].value ?? 0)) * (descending ? 1 : -1));
    const shown = nodes.slice(0, intent === 'rank' ? 10 : 25);
    const label = GROUP_KEYS[dim].label.toLowerCase();
    if (!shown.length) {
      return { ...base, intent, metricId: def.id, dimension: dim, tab, confidence: conf,
        answer: `No ${label} in the current scope has enough data to report ${def.label}.`,
        detail: `${def.label} needs at least ${def.minSample} rows per group. Widen the period or clear a filter.`,
        suggestions: ['Extend to the last 90 days', `${def.label} overall`, ...altSuggestions] };
    }
    const first = shown[0];
    const last = shown[shown.length - 1];
    /* `shown` is already ordered so index 0 is the group the question asked for — best when the
       question says "top", worst when it says "worst" — accounting for whether high is good. */
    const worstFirst = BOTTOM_WORDS.test(normalise(q));
    const firstWord = worstFirst ? 'weakest is' : 'strongest is';
    const lastWord = worstFirst ? 'least bad of those shown is' : 'weakest of those shown is';
    return { ...base, intent, metricId: def.id, dimension: dim, tab, confidence: conf,
      answer: `${def.label} by ${label}: ${firstWord} ${first.label} at ${formatValue(def.format, first.values[def.id].value)}${shown.length > 1 ? `, ${lastWord} ${last.label} at ${formatValue(def.format, last.values[def.id].value)}` : ''}. Overall it is ${formatValue(def.format, cur.value)}.${hedge}`,
      detail: intent === 'rank' ? `Groups with fewer than ${def.minSample} rows are excluded, so a single lucky class cannot top the list.` : undefined,
      table: { columns: [GROUP_KEYS[dim].label, def.label, 'Rows'], rows: shown.map((n) => [n.label, n.values[def.id].value === null ? null : Number(n.values[def.id].value!.toFixed(4)), n.rows.length]) },
      provenance: provenanceOf(def, cur.coverage),
      suggestions: [`${def.label} by month`, `How did ${def.label} change`, ...altSuggestions] };
  }

  // plain value
  const prev = metricValues(cmpRows, [def.id], scope.ctx)[def.id];
  const d = fmtDelta(def.format, cur.value, prev.value);
  if (cur.value === null) {
    return { ...base, intent: 'value', metricId: def.id, tab, confidence: conf,
      answer: `${def.label} cannot be measured in the current scope.`,
      detail: `${def.description} It needs ${def.sources.join(', ')}, and no row in scope carries them. Widen the period or clear a filter.`,
      provenance: provenanceOf(def, cur.coverage), suggestions: ['Extend to the last 90 days', ...altSuggestions] };
  }
  return { ...base, intent: 'value', metricId: def.id, tab, confidence: conf,
    answer: `${def.label} is ${formatValue(def.format, cur.value)} for ${scopeSentence(scope)}${d.value !== null ? `, ${d.text} against ${scope.period.prevLabel}` : ''}.${hedge}`,
    detail: `${def.description}${cur.coverage !== null && cur.coverage < 0.9 ? ` Measured on ${(cur.coverage * 100).toFixed(0)}% of rows in scope.` : ''}${cur.n < def.minSample ? ` Only ${cur.n} rows — below the ${def.minSample}-row minimum, so treat it as indicative.` : ''}`,
    provenance: provenanceOf(def, cur.coverage),
    suggestions: [`${def.label} by location`, `${def.label} by month`, `What is ${def.label}`, ...altSuggestions].slice(0, 4) };
}

export const defaultSuggestions = () => [
  'What is draw premium',
  'Fill rate by day and time',
  'Worst slots by fill rate',
  'How did churn change',
  'Revenue by location',
  'What should I worry about',
];
