/* Quantitative intelligence — the deterministic half of the AI layer.
 *
 * Everything here runs locally on the scoped dataset, with no API key and no network call, so
 * anomaly detection, trend, forecast, driver attribution, concentration and correlation are
 * always available. The same pack is handed to the language model as grounding evidence, which
 * is what stops it inventing movements and lets it talk about causes rather than restating KPIs.
 *
 * Statistics are deliberately robust rather than clever: median/MAD for outliers, ordinary least
 * squares for trend, residual spread for the forecast band. Small samples are reported, never
 * hidden, because a boutique studio month is a small sample by nature.
 */
import type { Scope } from '../state/data';
import { metric, type TableName } from '../semantics/metrics';
import { GROUP_KEYS, historyMonths, metricValues, rollupLevel, seriesBy, type Row } from '../semantics/aggregations';
import { formatValue } from '../semantics/formats';
import { ENDPOINTS } from '../api/agent';
import type { TabId } from '../state/view';

export interface SeriesPoint { month: string; value: number | null }
export interface MetricQuant {
  metricId: string; label: string; format: string; higherIsBetter: boolean;
  current: number | null; currentFormatted: string;
  previous: number | null; previousFormatted: string;
  changePct: number | null; changeAbs: number | null;
  series: SeriesPoint[];
  /** Robust standard score of the latest completed month against its own history. */
  z: number | null;
  anomaly: null | { direction: 'spike' | 'slump'; z: number; verdict: 'good' | 'bad'; note: string };
  trend: null | { slopePerMonth: number; r2: number; direction: 'rising' | 'falling' | 'flat'; months: number; note: string };
  forecast: null | { next: number; low: number; high: number; formatted: string; basis: string };
  /** Month-to-date pace against the same elapsed share of the prior month. */
  pace: null | { projected: number; formatted: string; vsPreviousPct: number | null; elapsedShare: number; note: string };
  streak: null | { direction: 'up' | 'down'; months: number };
}
export interface DriverRow {
  label: string; group: string;
  current: number | null; previous: number | null;
  delta: number | null; shareOfChange: number | null; rows: number;
  formatted: string; deltaFormatted: string;
}
export interface DriverPack { metricId: string; label: string; groupBy: string; groupLabel: string; totalDelta: number | null; gainers: DriverRow[]; losers: DriverRow[] }
export interface ConcentrationPack { groupBy: string; groupLabel: string; metricId: string; label: string; top3Share: number | null; hhi: number | null; n: number; note: string }
export interface CorrelationPack { a: string; aLabel: string; b: string; bLabel: string; r: number; months: number; note: string }
export interface SeasonalityPack { metricId: string; label: string; best: { key: string; value: number } | null; worst: { key: string; value: number } | null; spreadPct: number | null; note: string }

export interface QuantPack {
  tab: TabId; generatedAt: string; months: number;
  metrics: MetricQuant[];
  anomalies: { metricId: string; label: string; direction: 'spike' | 'slump'; z: number; verdict: 'good' | 'bad'; note: string }[];
  drivers: DriverPack[];
  concentration: ConcentrationPack[];
  correlations: CorrelationPack[];
  seasonality: SeasonalityPack[];
  dataQuality: { metricId: string; label: string; issue: string }[];
  headline: string;
}

/* ── small statistics ──────────────────────────────────────────────────── */
const num = (v: (number | null)[]) => v.filter((x): x is number => x !== null && Number.isFinite(x));
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mad = (v: number[]) => { if (v.length < 3) return 0; const m = median(v); return median(v.map((x) => Math.abs(x - m))) * 1.4826; };
const sd = (v: number[]) => { if (v.length < 2) return 0; const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)); };

function ols(ys: number[]) {
  const n = ys.length;
  if (n < 3) return null;
  const xs = ys.map((_, i) => i);
  const mx = mean(xs); const my = mean(ys);
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (!sxx) return null;
  const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const slope = sxy / sxx; const intercept = my - slope * mx;
  const fitted = xs.map((x) => intercept + slope * x);
  const ssTot = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  const ssRes = ys.reduce((a, y, i) => a + (y - fitted[i]) ** 2, 0);
  const residSd = Math.sqrt(ssRes / Math.max(1, n - 2));
  return { slope, intercept, r2: ssTot ? 1 - ssRes / ssTot : 0, residSd, n };
}

function pearson(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const x = a.slice(-n); const y = b.slice(-n);
  const mx = mean(x); const my = mean(y);
  const sx = sd(x); const sy = sd(y);
  if (!sx || !sy) return null;
  return x.reduce((acc, v, i) => acc + ((v - mx) / sx) * ((y[i] - my) / sy), 0) / (n - 1);
}

const pct = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);

/* ── the pack ──────────────────────────────────────────────────────────── */
export function buildQuantPack(scope: Scope, tab: TabId, historyLength = 14): QuantPack {
  const ep = ENDPOINTS.find((e) => e.tab === tab) ?? ENDPOINTS[0];
  const table = ep.table as TableName;
  const rows: Row[] = scope.tables[table] ?? [];
  const cmp: Row[] = scope.filters.compare === 'none' ? [] : scope.compare[table] ?? [];
  const all: Row[] = scope.all[table] ?? [];
  const months = historyMonths(scope.today.slice(0, 7), historyLength);
  const ids = ep.headline.slice(0, 8);

  const curValues = metricValues(rows, ids, scope.ctx);
  const prevValues = cmp.length ? metricValues(cmp, ids, scope.ctx) : null;
  const history = seriesBy(all, (r) => r.month, ids, scope.ctx, months);

  const today = new Date(`${scope.today}T00:00:00`);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const elapsedShare = Math.min(1, today.getDate() / daysInMonth);
  const isCurrentMonth = scope.period.end.slice(0, 7) === scope.today.slice(0, 7);

  const metrics: MetricQuant[] = ids.map((id) => {
    const def = metric(id);
    const series: SeriesPoint[] = history.map((s) => ({ month: s.key, value: s.values[id]?.value ?? null }));
    // The latest month is frequently partial, so trend and anomaly work on completed months only.
    const completed = series.filter((p) => p.month < scope.today.slice(0, 7));
    const hist = num(completed.map((p) => p.value));
    const latest = hist.length ? hist[hist.length - 1] : null;
    const baseline = hist.slice(0, -1);
    const m = median(baseline); const dispersion = mad(baseline) || sd(baseline);
    const z = latest !== null && baseline.length >= 4 && dispersion ? (latest - m) / dispersion : null;

    const cur = curValues[id]?.value ?? null;
    const prev = prevValues?.[id]?.value ?? null;
    const changeAbs = cur !== null && prev !== null ? cur - prev : null;
    const changePct = cur !== null && prev ? (cur - prev) / Math.abs(prev) : null;

    const fit = ols(hist.slice(-6));
    const slopeShare = fit && m ? fit.slope / Math.abs(m) : 0;
    const trend = fit ? {
      slopePerMonth: fit.slope, r2: fit.r2, months: Math.min(6, hist.length),
      direction: (Math.abs(slopeShare) < 0.01 || fit.r2 < 0.25 ? 'flat' : fit.slope > 0 ? 'rising' : 'falling') as 'rising' | 'falling' | 'flat',
      note: `${def.label} has moved ${formatValue(def.format, fit.slope)} per month across the last ${Math.min(6, hist.length)} completed months (fit quality R²=${fit.r2.toFixed(2)}).`,
    } : null;

    const forecast = fit && latest !== null ? (() => {
      const next = fit.intercept + fit.slope * (hist.slice(-6).length);
      const band = 1.5 * fit.residSd;
      return { next, low: next - band, high: next + band, formatted: formatValue(def.format, next),
        basis: `Least-squares projection from the last ${Math.min(6, hist.length)} completed months; band is ±1.5× residual spread.` };
    })() : null;

    const anomaly = z !== null && Math.abs(z) >= 2 && latest !== null ? (() => {
      const direction = (z > 0 ? 'spike' : 'slump') as 'spike' | 'slump';
      const good = (z > 0) === def.higherIsBetter;
      return { direction, z, verdict: (good ? 'good' : 'bad') as 'good' | 'bad',
        note: `${def.label} at ${formatValue(def.format, latest)} is ${Math.abs(z).toFixed(1)} robust deviations ${z > 0 ? 'above' : 'below'} its own ${baseline.length}-month median of ${formatValue(def.format, m)}.` };
    })() : null;

    // Consecutive same-direction moves, which read more honestly than a single month's delta.
    let streak: MetricQuant['streak'] = null;
    if (hist.length >= 3) {
      const diffs = hist.slice(1).map((v, i) => v - hist[i]);
      let n = 0; const dir = diffs[diffs.length - 1] >= 0 ? 1 : -1;
      for (let i = diffs.length - 1; i >= 0; i -= 1) { if ((diffs[i] >= 0 ? 1 : -1) === dir) n += 1; else break; }
      if (n >= 2) streak = { direction: dir > 0 ? 'up' : 'down', months: n };
    }

    const pace = isCurrentMonth && def.aggregation !== 'weighted' && cur !== null && elapsedShare > 0.15 ? (() => {
      const projected = cur / elapsedShare;
      const vs = prev ? (projected - prev) / Math.abs(prev) : null;
      return { projected, formatted: formatValue(def.format, projected), vsPreviousPct: vs, elapsedShare,
        note: `${(elapsedShare * 100).toFixed(0)}% of the month has elapsed; at this pace the month lands near ${formatValue(def.format, projected)}${vs === null ? '' : ` (${pct(vs)} vs ${scope.period.prevLabel})`}.` };
    })() : null;

    return {
      metricId: id, label: def.label, format: def.format, higherIsBetter: def.higherIsBetter,
      current: cur, currentFormatted: formatValue(def.format, cur),
      previous: prev, previousFormatted: formatValue(def.format, prev),
      changePct, changeAbs, series, z, anomaly, trend, forecast, pace, streak,
    };
  });

  /* Driver attribution: who moved the number, and by how much of the total change. */
  const driverMetric = ids[0];
  const drivers: DriverPack[] = ep.groupBy.slice(0, 2).filter((g) => GROUP_KEYS[g]).map((groupBy) => {
    const def = metric(driverMetric);
    const curNodes = rollupLevel(rows, [groupBy], 0, [driverMetric], scope.ctx);
    const prevNodes = cmp.length ? rollupLevel(cmp, [groupBy], 0, [driverMetric], scope.ctx) : [];
    const prevMap = new Map(prevNodes.map((n) => [n.key, n.values[driverMetric]?.value ?? null]));
    const curTotal = curValues[driverMetric]?.value ?? null;
    const prevTotal = prevValues?.[driverMetric]?.value ?? null;
    const totalDelta = curTotal !== null && prevTotal !== null ? curTotal - prevTotal : null;
    const rowsOut: DriverRow[] = curNodes.map((n) => {
      const c = n.values[driverMetric]?.value ?? null;
      const p = prevMap.get(n.key) ?? null;
      const delta = c !== null && p !== null ? c - p : null;
      return {
        label: n.label, group: groupBy, current: c, previous: p, delta, rows: n.rows.length,
        shareOfChange: delta !== null && totalDelta ? delta / totalDelta : null,
        formatted: formatValue(def.format, c), deltaFormatted: delta === null ? '—' : `${delta >= 0 ? '+' : ''}${formatValue(def.format, delta)}`,
      };
    }).filter((r) => r.delta !== null);
    rowsOut.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
    return {
      metricId: driverMetric, label: def.label, groupBy, groupLabel: GROUP_KEYS[groupBy]?.label ?? groupBy, totalDelta,
      gainers: rowsOut.filter((r) => (r.delta ?? 0) > 0).slice(0, 4),
      losers: rowsOut.filter((r) => (r.delta ?? 0) < 0).slice(-4).reverse(),
    };
  });

  /* Concentration: how much of the business rests on a handful of rows. */
  const concentration: ConcentrationPack[] = ep.groupBy.slice(0, 2).filter((g) => GROUP_KEYS[g]).map((groupBy) => {
    const def = metric(driverMetric);
    const nodes = rollupLevel(rows, [groupBy], 0, [driverMetric], scope.ctx);
    const vals = nodes.map((n) => n.values[driverMetric]?.value ?? 0).filter((v) => v > 0).sort((a, b) => b - a);
    const total = vals.reduce((a, b) => a + b, 0);
    const top3Share = total ? vals.slice(0, 3).reduce((a, b) => a + b, 0) / total : null;
    const hhi = total ? vals.reduce((a, v) => a + (v / total) ** 2, 0) : null;
    return {
      groupBy, groupLabel: GROUP_KEYS[groupBy]?.label ?? groupBy, metricId: driverMetric, label: def.label,
      top3Share, hhi, n: vals.length,
      note: top3Share === null ? 'Not measurable for this scope.'
        : `The top 3 of ${vals.length} ${(GROUP_KEYS[groupBy]?.label ?? groupBy).toLowerCase()} values hold ${(top3Share * 100).toFixed(0)}% of ${def.label.toLowerCase()}${hhi && hhi > 0.25 ? ' — concentrated enough that losing one would be felt immediately.' : '.'}`,
    };
  }).filter((c) => c.top3Share !== null);

  /* Correlation across the tab's own headline metrics, on completed months. */
  const correlations: CorrelationPack[] = [];
  for (let i = 0; i < metrics.length; i += 1) {
    for (let j = i + 1; j < metrics.length; j += 1) {
      const a = num(metrics[i].series.map((p) => p.value));
      const b = num(metrics[j].series.map((p) => p.value));
      const r = pearson(a, b);
      if (r !== null && Math.abs(r) >= 0.6) {
        correlations.push({
          a: metrics[i].metricId, aLabel: metrics[i].label, b: metrics[j].metricId, bLabel: metrics[j].label,
          r, months: Math.min(a.length, b.length),
          note: `${metrics[i].label} and ${metrics[j].label} have moved ${r > 0 ? 'together' : 'in opposition'} (r=${r.toFixed(2)}) across ${Math.min(a.length, b.length)} months. Association, not proof of cause.`,
        });
      }
    }
  }
  correlations.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  /* Seasonality on the dimension this tab actually schedules against. */
  const seasonKey = ep.groupBy.find((g) => g === 'day' || g === 'timeslot' || g === 'slot') ?? null;
  const seasonality: SeasonalityPack[] = seasonKey ? [(() => {
    const def = metric(driverMetric);
    const nodes = rollupLevel(rows, [seasonKey], 0, [driverMetric], scope.ctx)
      .map((n) => ({ key: n.label, value: n.values[driverMetric]?.value ?? null, rows: n.rows.length }))
      .filter((n): n is { key: string; value: number; rows: number } => n.value !== null && n.rows >= 3);
    if (!nodes.length) return { metricId: driverMetric, label: def.label, best: null, worst: null, spreadPct: null, note: 'Not enough sample per bucket.' };
    const best = nodes.reduce((a, b) => (b.value > a.value ? b : a));
    const worst = nodes.reduce((a, b) => (b.value < a.value ? b : a));
    const spread = best.value ? (best.value - worst.value) / Math.abs(best.value) : null;
    return {
      metricId: driverMetric, label: def.label, best: { key: best.key, value: best.value }, worst: { key: worst.key, value: worst.value }, spreadPct: spread,
      note: `${def.label} runs ${formatValue(def.format, best.value)} at its best ${seasonKey} (${best.key}) against ${formatValue(def.format, worst.value)} at its worst (${worst.key})${spread === null ? '' : ` — a ${(spread * 100).toFixed(0)}% spread the timetable controls`}.`,
    };
  })()] : [];

  const dataQuality = ids.map((id) => {
    const r = curValues[id];
    const def = metric(id);
    if (!r) return null;
    if (r.suspect) return { metricId: id, label: def.label, issue: r.suspect };
    if (r.coverage !== null && r.coverage !== undefined && r.coverage < 0.9) return { metricId: id, label: def.label, issue: `Measured on ${((r.coverage ?? 0) * 100).toFixed(0)}% of rows in scope.` };
    if (r.n !== undefined && r.n < def.minSample) return { metricId: id, label: def.label, issue: `Sample of ${r.n} is below the ${def.minSample} needed to read this reliably.` };
    return null;
  }).filter((x): x is { metricId: string; label: string; issue: string } => x !== null);

  const anomalies = metrics.filter((m) => m.anomaly).map((m) => ({ metricId: m.metricId, label: m.label, ...m.anomaly! }));
  const worst = anomalies.find((a) => a.verdict === 'bad');
  const lead = metrics[0];
  const headline = worst ? worst.note
    : lead ? `${lead.label} is ${lead.currentFormatted}${lead.changePct === null ? '' : ` (${pct(lead.changePct)} vs ${scope.period.prevLabel})`}${lead.trend && lead.trend.direction !== 'flat' ? `, ${lead.trend.direction} over six months` : ''}.`
    : 'No headline metric is measurable for this scope.';

  return { tab, generatedAt: new Date().toISOString(), months: historyLength, metrics, anomalies, drivers, concentration, correlations, seasonality, dataQuality, headline };
}

/** The slim, token-cheap form handed to the language model as grounding. */
export function compactQuant(q: QuantPack) {
  return {
    headline: q.headline,
    metrics: q.metrics.map((m) => ({
      metricId: m.metricId, label: m.label, current: m.currentFormatted, previous: m.previousFormatted,
      changePct: m.changePct === null ? null : +(m.changePct * 100).toFixed(1),
      robustZ: m.z === null ? null : +m.z.toFixed(2),
      trend: m.trend ? { direction: m.trend.direction, r2: +m.trend.r2.toFixed(2) } : null,
      forecastNext: m.forecast?.formatted ?? null,
      monthToDatePace: m.pace ? m.pace.formatted : null,
      streak: m.streak,
      lastMonths: m.series.slice(-8).map((p) => p.value),
    })),
    anomalies: q.anomalies.map((a) => a.note),
    drivers: q.drivers.map((d) => ({ metric: d.label, by: d.groupLabel, totalDelta: d.totalDelta,
      gainers: d.gainers.map((g) => `${g.label} ${g.deltaFormatted}${g.shareOfChange === null ? '' : ` (${(g.shareOfChange * 100).toFixed(0)}% of change)`}`),
      losers: d.losers.map((g) => `${g.label} ${g.deltaFormatted}${g.shareOfChange === null ? '' : ` (${(g.shareOfChange * 100).toFixed(0)}% of change)`}`) })),
    concentration: q.concentration.map((c) => c.note),
    correlations: q.correlations.slice(0, 6).map((c) => c.note),
    seasonality: q.seasonality.map((s) => s.note),
    dataQuality: q.dataQuality.map((d) => `${d.label}: ${d.issue}`),
  };
}
