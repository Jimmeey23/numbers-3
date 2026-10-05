/* One-click AI actions.
 *
 * An insight that only reads well is worth less than one you can act on. The model returns small,
 * declarative action objects — never code — which are validated here against the real filter,
 * tab and widget vocabularies before anything is applied. An unknown field is dropped rather
 * than trusted, so a hallucinated dimension cannot put the workspace into an impossible state.
 */
import { useFilters } from '../state/filters';
import { useView, TABS, type TabId } from '../state/view';
import { addWidget, type WidgetSpec } from '../api/widgets';
import { GROUP_KEYS } from '../semantics/aggregations';
import { METRIC_LIST } from '../semantics/metrics';

export interface AIAction {
  label: string;
  kind: 'focus' | 'tab' | 'widget' | 'ask';
  tab?: TabId;
  /** Narrow the workspace onto the entity the insight is about. */
  filter?: { dim: string; value: string };
  locations?: string[];
  trainers?: string[];
  formats?: string[];
  widget?: Partial<WidgetSpec>;
  question?: string;
}

const knownTab = (t?: string): TabId | null => (t && TABS.some((x) => x.id === t) ? (t as TabId) : null);

export function describeAction(a: AIAction): string {
  if (a.kind === 'focus' && a.filter) return `Filter to ${a.filter.dim} = ${a.filter.value}`;
  if (a.kind === 'tab' && a.tab) return `Open the ${TABS.find((t) => t.id === a.tab)?.label ?? a.tab} tab`;
  if (a.kind === 'widget') return `Pin "${a.widget?.title ?? 'a widget'}" to this tab`;
  if (a.kind === 'ask') return `Ask: ${a.question ?? ''}`;
  return a.label;
}

/** Returns a human sentence describing what happened, or an error string. */
export function applyAIAction(a: AIAction): string {
  const view = useView.getState();
  const filters = useFilters.getState();
  const tab = knownTab(a.tab);

  if (a.kind === 'ask') {
    if (!a.question) return 'That action had no question attached.';
    view.setAskOpen(true);
    window.dispatchEvent(new CustomEvent('floor:ask-prefill', { detail: a.question }));
    return 'Question loaded into Ask.';
  }

  if (a.kind === 'widget') {
    const spec = { ...a.widget, tab: tab ?? view.tab, source: 'agent' } as Partial<WidgetSpec>;
    const metrics = (spec.metrics ?? []).filter((m) => METRIC_LIST.some((d) => d.id === m));
    if (!metrics.length) return 'That widget referenced no metric this workspace knows.';
    const { id, error } = addWidget({ ...spec, metrics });
    return error ? error : id ? `Pinned "${spec.title ?? 'widget'}" to ${TABS.find((t) => t.id === (tab ?? view.tab))?.label}.` : 'Widget could not be pinned.';
  }

  let said = '';
  if (tab) { view.setTab(tab); said = `Opened ${TABS.find((t) => t.id === tab)?.label}. `; }

  const patch: Record<string, string[]> = {};
  if (a.locations?.length) patch.locations = a.locations;
  if (a.trainers?.length) patch.trainers = a.trainers;
  if (a.formats?.length) patch.formats = a.formats;
  if (Object.keys(patch).length) { filters.set(patch as never); said += `${Object.keys(patch).join(' and ')} narrowed. `; }

  if (a.filter?.dim && a.filter.value) {
    if (!GROUP_KEYS[a.filter.dim]) return `${said}"${a.filter.dim}" is not a dimension this workspace can filter on.`;
    filters.addTransient({ dim: a.filter.dim, value: a.filter.value });
    said += `Filtered to ${GROUP_KEYS[a.filter.dim].label} = ${a.filter.value}.`;
  }
  if (!said) return 'Nothing to apply in that action.';
  view.announce(said.trim());
  document.getElementById('canvas')?.scrollTo({ top: 0, behavior: 'smooth' });
  return said.trim();
}

/** Drop anything the workspace cannot honour, so the UI never offers a dead button. */
export function sanitiseActions(input: unknown): AIAction[] {
  if (!Array.isArray(input)) return [];
  return input.filter((a): a is AIAction => {
    if (!a || typeof a !== 'object') return false;
    const x = a as AIAction;
    if (!x.label || !x.kind) return false;
    if (x.kind === 'ask') return !!x.question;
    if (x.kind === 'tab') return !!knownTab(x.tab);
    if (x.kind === 'widget') return !!(x.widget?.metrics ?? []).some((m) => METRIC_LIST.some((d) => d.id === m));
    if (x.kind === 'focus') return !!(x.filter && GROUP_KEYS[x.filter.dim]) || !!(x.locations?.length || x.trainers?.length || x.formats?.length);
    return false;
  }).slice(0, 8);
}
