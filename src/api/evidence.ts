/* Evidence for a "why" question.
 *
 * The deterministic resolver answers "what is X" well and "why did X move" not at all — it has
 * no notion of a cause. A language model has the opposite problem: it will happily narrate a
 * cause it cannot see. So the arithmetic is done here, in the open, and the model is handed the
 * result to rank and explain. It never computes a figure of its own.
 *
 * For an additive metric the decomposition is exact: each group's change sums to the total
 * change, and each group's share of it is a real contribution. For a ratio it is not — a rate
 * can fall while every group's rate rises, if weight moves to the weaker groups. Those two
 * cases are therefore reported differently, and the pack says which one it is, so the model is
 * never invited to call a mix shift a rate decline.
 */
import type { Scope } from '../state/data';
import { metric, type MetricDef } from '../semantics/metrics';
import { GROUP_KEYS, groupRows, metricValues, seriesBy, historyMonths, type Row } from '../semantics/aggregations';
import { formatValue } from '../semantics/formats';
import { ENDPOINTS } from './agent';
import { runRules } from '../insights/engine';
import type { Thresholds } from '../state/view';

export interface DriverGroup {
  label: string;
  current: number | null;
  previous: number | null;
  change: number | null;
  /** Additive metrics only: this group's share of the total movement, as a fraction. */
  shareOfChange?: number | null;
  /** Ratio metrics only: how much of the base this group carried, before and after. */
  weightBefore?: number | null;
  weightAfter?: number | null;
  rowsCurrent: number;
  rowsPrevious: number;
}
export interface DriverDimension {
  dimension: string;
  label: string;
  /** 'additive' — contributions sum to the total change. 'mix' — rate metric, read weight too. */
  kind: 'additive' | 'mix';
  groups: DriverGroup[];
  /** Groups that existed before and have no rows now, or vice versa — often the whole story. */
  appeared: string[];
  disappeared: string[];
}

export interface EvidencePack {
  question: string;
  metric: { id: string; label: string; definition: string; formula: string; format: string; aggregation: string; higherIsBetter: boolean; sources: string[] };
  period: { label: string; comparedWith: string };
  headline: { current: number | null; previous: number | null; change: number | null; changePct: number | null; formattedCurrent: string; formattedPrevious: string; sampleCurrent: number; samplePrevious: number; coverage: number | null; caveat: string | null };
  /** Decomposition across every dimension the metric's table supports. */
  drivers: DriverDimension[];
  /** Other metrics on the same table over the same two windows — the cross-checks. */
  companions: { id: string; label: string; current: string; previous: string; changePct: number | null; direction: 'up' | 'down' | 'flat' }[];
  /** The metric's own recent history, so a one-month blip is distinguishable from a trend. */
  history: { month: string; value: number | null }[];
  /** Deterministic rules that already fired on the relevant tab. */
  firedRules: { title: string; body: string; severity: string; impactINR?: number }[];
  /** A movement the question asserted, checked against what the data shows. */
  premise: { stated: string; statedPct: number | null; statedDirection: 'up' | 'down' | null; matches: boolean; note: string } | null;
  notes: string[];
}

/* A question often carries its own claim — "the 29% drop in transactions". If the data does not
   show that, answering the question as asked would confirm something untrue, so the claim is
   checked before anything is attributed to it. */
function checkPremise(question: string, actualPct: number | null, actualChange: number | null): EvidencePack['premise'] {
  const m = question.match(/(\d+(?:\.\d+)?)\s*%/);
  const down = /\b(drop|fall|fell|decline|decrease|down|loss|dip|slump|shortfall)\b/i.test(question);
  const up = /\b(rise|rose|grow|growth|increase|up|jump|surge|gain)\b/i.test(question);
  const statedDirection = down && !up ? 'down' as const : up && !down ? 'up' as const : null;
  if (!m && !statedDirection) return null;
  const statedPct = m ? Number(m[1]) / 100 : null;
  const actualDirection = actualChange === null || actualChange === 0 ? null : actualChange < 0 ? 'down' : 'up';
  const stated = `${m ? `${m[1]}% ` : ''}${statedDirection ?? 'change'}`;

  if (statedDirection && actualDirection && statedDirection !== actualDirection) {
    return { stated, statedPct, statedDirection, matches: false,
      note: `The question assumes a ${statedDirection === 'down' ? 'fall' : 'rise'}, but over this period the metric moved the other way${actualPct === null ? '' : ` (${(actualPct * 100).toFixed(1)}%)`}. Nothing can explain a movement that did not happen; the premise needs correcting before the cause is worth discussing.` };
  }
  if (statedPct !== null && actualPct !== null && Math.abs(Math.abs(actualPct) - statedPct) > Math.max(0.05, statedPct * 0.35)) {
    return { stated, statedPct, statedDirection, matches: false,
      note: `The question states ${m![1]}%, but this scope shows ${(actualPct * 100).toFixed(1)}%. The figure in the question may come from a different period, location or filter set.` };
  }
  return { stated, statedPct, statedDirection, matches: true, note: 'The movement in the question matches this scope.' };
}

const pct = (cur: number | null, prev: number | null): number | null =>
  cur === null || prev === null || prev === 0 ? null : (cur - prev) / Math.abs(prev);

/** Dimensions worth decomposing: those the metric's table actually carries values for. */
function dimensionsFor(def: MetricDef): string[] {
  const endpoint = ENDPOINTS.find((e) => e.table === def.table);
  const keys = endpoint?.groupBy ?? ['location', 'month'];
  // `month` and `week` describe the period itself, not a cause within it.
  return keys.filter((k) => GROUP_KEYS[k] && !['month', 'week', 'quarter', 'year'].includes(k)).slice(0, 7);
}

function decompose(def: MetricDef, dimension: string, rows: Row[], prevRows: Row[], ctx: Scope['ctx'], totalChange: number | null): DriverDimension | null {
  const key = GROUP_KEYS[dimension];
  if (!key) return null;
  const now = groupRows(rows, key);
  const before = groupRows(prevRows, key);
  const names = new Set([...now.keys(), ...before.keys()]);
  if (names.size < 2 || names.size > 60) return null;

  /* Whether the parts add up to the whole is a property of the data, not of the declared
     aggregation name: `gross_revenue` is a "custom" that sums perfectly, while a distinct count
     is a "distinct" that does not (the same member appears in two groups). So measure it —
     compare the sum of the group values against the total actually computed over all rows. */
  const totalCur = metricValues(rows, [def.id], ctx)[def.id].value;
  const partsSum = [...now.values()].reduce((acc, rs) => acc + (metricValues(rs, [def.id], ctx)[def.id].value ?? 0), 0);
  const additive = totalCur !== null && totalCur !== 0
    ? Math.abs(partsSum - totalCur) / Math.abs(totalCur) < 0.005
    : partsSum === 0 && def.aggregation !== 'weighted' && def.aggregation !== 'avg' && def.aggregation !== 'median';
  const totalNow = rows.length || 1;
  const totalBefore = prevRows.length || 1;
  const groups: DriverGroup[] = [];
  for (const name of names) {
    const a = now.get(name) ?? [];
    const b = before.get(name) ?? [];
    const cur = metricValues(a, [def.id], ctx)[def.id].value;
    const prev = metricValues(b, [def.id], ctx)[def.id].value;
    const change = cur === null && prev === null ? null : (cur ?? 0) - (prev ?? 0);
    groups.push({
      label: key.display ? key.display(name) : name,
      current: cur, previous: prev, change,
      ...(additive
        ? { shareOfChange: change !== null && totalChange ? change / totalChange : null }
        : { weightBefore: b.length / totalBefore, weightAfter: a.length / totalNow }),
      rowsCurrent: a.length, rowsPrevious: b.length,
    });
  }
  // Largest movers first — in both directions, because an offsetting riser is part of the story.
  groups.sort((x, y) => Math.abs(y.change ?? 0) - Math.abs(x.change ?? 0));
  return {
    dimension, label: key.label, kind: additive ? 'additive' : 'mix',
    groups: groups.slice(0, 12),
    appeared: [...names].filter((n) => !before.has(n) && (now.get(n)?.length ?? 0) > 0).slice(0, 8),
    disappeared: [...names].filter((n) => !now.has(n) && (before.get(n)?.length ?? 0) > 0).slice(0, 8),
  };
}

/** How much of the total movement this dimension's largest mover accounts for, 0–1.
 *  Mix dimensions are discounted: they describe the change, they do not attribute it. */
function concentration(d: DriverDimension, totalChange: number | null): number {
  const top = d.groups[0];
  if (!top) return 0;
  if (d.kind === 'additive') return Math.min(2, Math.abs(top.shareOfChange ?? 0));
  if (!totalChange) return 0;
  return Math.min(2, Math.abs((top.change ?? 0) / totalChange)) * 0.5;
}

export function buildEvidence(
  question: string, def: MetricDef, rows: Row[], prevRows: Row[], scope: Scope, thresholds: Thresholds,
  periodLabel: string, prevLabel: string,
): EvidencePack {
  const ctx = scope.ctx;
  const cur = metricValues(rows, [def.id], ctx)[def.id];
  const prev = metricValues(prevRows, [def.id], ctx)[def.id];
  const change = cur.value === null || prev.value === null ? null : cur.value - prev.value;

  const drivers = dimensionsFor(def)
    .map((d) => decompose(def, d, rows, prevRows, ctx, change))
    .filter((d): d is DriverDimension => d !== null)
    // A dimension where one group explains most of the move is more use than an even spread.
    /* Rank by how much of the movement the top group explains, as a fraction — a raw change is
       scale-dependent and would just pick whichever dimension happens to have the biggest group.
       An additive split that concentrates the change is the most explanatory thing available, so
       those sort ahead of mix dimensions, which cannot attribute at all. */
    .sort((a, b) => concentration(b, change) - concentration(a, change))
    .slice(0, 5);

  const endpoint = ENDPOINTS.find((e) => e.table === def.table);
  const companions = (endpoint?.metrics ?? []).filter((id) => id !== def.id).slice(0, 12).map((id) => {
    const cdef = metric(id);
    const c = metricValues(rows, [id], ctx)[id].value;
    const p = metricValues(prevRows, [id], ctx)[id].value;
    const cp = pct(c, p);
    return {
      id, label: cdef.label,
      current: formatValue(cdef.format, c), previous: formatValue(cdef.format, p),
      changePct: cp === null ? null : Number(cp.toFixed(4)),
      direction: (cp === null || Math.abs(cp) < 0.01 ? 'flat' : cp > 0 ? 'up' : 'down') as 'up' | 'down' | 'flat',
    };
  });

  const months = historyMonths(scope.today.slice(0, 7), 14);
  const history = seriesBy(scope.all[def.table] ?? [], (r) => r.month, [def.id], ctx, months)
    .map((s) => ({ month: s.key, value: s.values[def.id].value }));

  const tab = endpoint?.tab;
  const firedRules = runRules(scope, thresholds)
    .filter((i) => !tab || i.tab === tab)
    .slice(0, 8)
    .map((i) => ({ title: i.title, body: i.body, severity: i.severity, impactINR: i.impactINR }));

  const notes: string[] = [];
  if (cur.n < def.minSample) notes.push(`Only ${cur.n} rows contribute in ${periodLabel}; below the ${def.minSample}-row floor for this metric, so group-level splits are unreliable.`);
  if (cur.coverage !== null && cur.coverage < 0.9) notes.push(`${Math.round((cur.coverage ?? 0) * 100)}% of rows carry the inputs this metric needs; the rest are excluded and may not be missing at random.`);
  if (cur.suspect) notes.push(cur.suspect);
  if (drivers.length && drivers.every((d) => d.kind === 'mix')) {
    notes.push('The parts of this metric do not add up to the whole, so no group can be given a share of the change. A fall can come from mix — weight moving to weaker groups — even where every group improved. Compare weightBefore against weightAfter before attributing it to a rate.');
  }

  return {
    question,
    metric: { id: def.id, label: def.label, definition: def.description, formula: def.formula, format: def.format, aggregation: def.aggregation, higherIsBetter: def.higherIsBetter, sources: def.sources },
    period: { label: periodLabel, comparedWith: prevLabel },
    headline: {
      current: cur.value, previous: prev.value, change,
      changePct: pct(cur.value, prev.value),
      formattedCurrent: formatValue(def.format, cur.value),
      formattedPrevious: formatValue(def.format, prev.value),
      sampleCurrent: cur.n, samplePrevious: prev.n,
      coverage: cur.coverage, caveat: cur.suspect,
    },
    drivers, companions, history, firedRules,
    premise: checkPremise(question, pct(cur.value, prev.value), change),
    notes,
  };
}
