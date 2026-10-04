/* Custom widgets.
 *
 * A widget is a saved *specification*, never a snapshot. It stores what to measure and how to
 * cut it; the value is recomputed from the live scope on every render. A table pinned in March
 * therefore shows September's numbers in September, and respects whatever filters are active —
 * which is the whole point of pinning it to a dashboard rather than exporting a PDF.
 */
import type { TabId } from '../state/view';
import { METRIC_LIST, metric, type TableName } from '../semantics/metrics';
import { GROUP_KEYS } from '../semantics/aggregations';
import { ENDPOINTS } from './agent';

export type WidgetKind = 'metric' | 'table' | 'bar' | 'column' | 'line' | 'area' | 'ranking' | 'heatmap' | 'trend';

export const WIDGET_KINDS: { id: WidgetKind; label: string; hint: string; needsGroup: boolean }[] = [
  { id: 'metric', label: 'Metric cards', hint: 'One card per metric, with comparison and sparkline', needsGroup: false },
  { id: 'trend', label: 'Trend line', hint: 'The metric by month over the last year', needsGroup: false },
  { id: 'table', label: 'Table', hint: 'Rows grouped by a dimension, every metric as a column', needsGroup: true },
  { id: 'column', label: 'Column chart', hint: 'Vertical bars across a dimension', needsGroup: true },
  { id: 'bar', label: 'Bar chart', hint: 'Horizontal bars, best for long labels', needsGroup: true },
  { id: 'line', label: 'Line chart', hint: 'A line across an ordered dimension', needsGroup: true },
  { id: 'area', label: 'Area chart', hint: 'Filled line, good for volume', needsGroup: true },
  { id: 'ranking', label: 'Top and bottom', hint: 'Best and worst performers side by side', needsGroup: true },
  { id: 'heatmap', label: 'Heatmap', hint: 'Two dimensions crossed, coloured by the metric', needsGroup: true },
];

export interface WidgetSpec {
  id: string;
  tab: TabId;
  placement: 'top' | 'bottom';
  kind: WidgetKind;
  title: string;
  note?: string;
  /** Metric ids. Charts use the first; tables and cards use all. */
  metrics: string[];
  groupBy?: string;
  /** Second axis for heatmaps. */
  groupBy2?: string;
  limit?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  width: 'half' | 'full';
  createdAt: number;
  source: 'manual' | 'agent' | 'ask';
  /** Pin the widget to the filters that were active when it was built. */
  freezeScope?: { start: string; end: string; label: string };
}

const KEY = 'atlas.widgets.v1';
export const WIDGET_EVENT = 'atlas:widgets';

export function readWidgets(): WidgetSpec[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
export function writeWidgets(w: WidgetSpec[]) {
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* quota */ }
  window.dispatchEvent(new CustomEvent(WIDGET_EVENT));
}

/** Validate and normalise a spec before it is saved, so a bad agent call cannot break a tab. */
export function normaliseSpec(input: Partial<WidgetSpec> & { metrics?: string[] }): { spec: WidgetSpec | null; error?: string } {
  const metrics = (input.metrics ?? []).filter((m) => METRIC_LIST.some((d) => d.id === m));
  if (!metrics.length) return { spec: null, error: `No valid metric. Known ids include ${METRIC_LIST.slice(0, 5).map((m) => m.id).join(', ')}…` };

  // Every metric must read the same table, or the rows cannot be grouped together.
  const tables = new Set(metrics.map((m) => metric(m).table));
  if (tables.size > 1) return { spec: null, error: `Metrics span ${[...tables].join(' and ')}; a single widget can only read one grain.` };

  const kind: WidgetKind = (WIDGET_KINDS.find((k) => k.id === input.kind)?.id) ?? 'table';
  const needsGroup = WIDGET_KINDS.find((k) => k.id === kind)!.needsGroup;
  const groupBy = input.groupBy && GROUP_KEYS[input.groupBy] ? input.groupBy : undefined;
  if (needsGroup && !groupBy) return { spec: null, error: `A ${kind} needs a grouping. Try one of: ${Object.keys(GROUP_KEYS).slice(0, 8).join(', ')}…` };
  const groupBy2 = input.groupBy2 && GROUP_KEYS[input.groupBy2] ? input.groupBy2 : undefined;
  if (kind === 'heatmap' && !groupBy2) return { spec: null, error: 'A heatmap needs two groupings — groupBy and groupBy2.' };

  const tab: TabId = (ENDPOINTS.find((e) => e.tab === input.tab)?.tab)
    ?? (ENDPOINTS.find((e) => e.table === metric(metrics[0]).table)?.tab) ?? 'overview';

  return { spec: {
    id: input.id ?? `w-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tab, placement: input.placement === 'top' ? 'top' : 'bottom', kind,
    title: (input.title ?? defaultTitle(metrics, groupBy, kind)).slice(0, 120),
    note: input.note, metrics, groupBy, groupBy2,
    limit: Math.min(Math.max(input.limit ?? 12, 1), 200),
    sortBy: input.sortBy && metrics.includes(input.sortBy) ? input.sortBy : metrics[0],
    sortDir: input.sortDir === 'asc' ? 'asc' : 'desc',
    width: input.width === 'half' ? 'half' : kind === 'metric' ? 'full' : 'full',
    createdAt: input.createdAt ?? Date.now(),
    source: input.source ?? 'manual',
    freezeScope: input.freezeScope,
  } };
}

export function defaultTitle(metrics: string[], groupBy?: string, kind?: WidgetKind): string {
  const names = metrics.slice(0, 3).map((m) => metric(m).label);
  const head = names.join(', ') + (metrics.length > 3 ? ` +${metrics.length - 3}` : '');
  if (groupBy) return `${head} by ${GROUP_KEYS[groupBy].label.toLowerCase()}`;
  return kind === 'trend' ? `${head} over time` : head;
}

export function addWidget(input: Partial<WidgetSpec>): { id?: string; error?: string } {
  const { spec, error } = normaliseSpec(input);
  if (!spec) return { error };
  writeWidgets([...readWidgets(), spec]);
  return { id: spec.id };
}
export function updateWidget(id: string, patch: Partial<WidgetSpec>) {
  writeWidgets(readWidgets().map((w) => {
    if (w.id !== id) return w;
    const { spec } = normaliseSpec({ ...w, ...patch });
    return spec ?? w;
  }));
}
export function removeWidget(id: string) { writeWidgets(readWidgets().filter((w) => w.id !== id)); }
export function moveWidget(id: string, dir: -1 | 1) {
  const all = readWidgets();
  const i = all.findIndex((w) => w.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  writeWidgets(all);
}

/** Which tab a metric naturally belongs to, for the "where should this go" default. */
export const tabForMetric = (id: string): TabId => {
  const t = metric(id).table as TableName;
  return ENDPOINTS.find((e) => e.headline.includes(id))?.tab
    ?? ENDPOINTS.find((e) => e.metrics.includes(id))?.tab
    ?? ENDPOINTS.find((e) => e.table === t)?.tab ?? 'overview';
};

/** Group keys that make sense for a given metric's grain. */
export function groupKeysFor(metricId: string): string[] {
  const t = metric(metricId).table;
  const ep = ENDPOINTS.find((e) => e.table === t);
  const fromEndpoint = ep?.groupBy ?? [];
  const universal = ['location', 'month', 'quarter', 'year'];
  return [...new Set([...fromEndpoint, ...universal])].filter((k) => GROUP_KEYS[k]);
}

/** Metrics sharing a grain with the given one — the legal companions in one widget. */
export function compatibleMetrics(metricId: string): string[] {
  const t = metric(metricId).table;
  return METRIC_LIST.filter((m) => m.table === t).map((m) => m.id);
}
