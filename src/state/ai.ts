/* The AI layer's single source of truth.
 *
 * One generation per tab + data scope is held here and read by every AI surface: the briefing
 * above the canvas, the KPI cards, the table summaries, the Ask panel and the insight rail.
 * Results are cached per tab so switching tabs never loses a generation, and persisted so a
 * reload keeps what you already paid an API call for.
 */
import { create } from 'zustand';
import { buildAgentApi, addCard, readCards, ENDPOINTS } from '../api/agent';
import { generateTabIntelligence, type AITabIntelligence } from '../ai/intelligence';
import type { Scope } from './data';
import { useView, type TabId, type Thresholds } from './view';

const KEY = 'floor.ai.tab-intelligence.v1';

type Store = {
  byTab: Partial<Record<TabId, AITabIntelligence>>;
  busyTab: TabId | null;
  error: string;
  lastCached: boolean;
  generate: (tab: TabId, scope: Scope, thresholds: Thresholds) => Promise<void>;
  clear: (tab: TabId) => void;
};

const readCache = (): Partial<Record<TabId, AITabIntelligence>> => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
};
const writeCache = (v: Partial<Record<TabId, AITabIntelligence>>) => {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* quota */ }
};

/** Everything the model is allowed to see: headline KPIs plus up to three groupings. */
function buildSnapshot(tab: TabId, scope: Scope, thresholds: Thresholds) {
  const api = buildAgentApi(scope, thresholds, () => undefined);
  const ep = ENDPOINTS.find((e) => e.tab === tab) ?? ENDPOINTS[0];
  const primary = api.get(tab, { limit: 24 }) as Record<string, unknown>;
  const extras = ep.groupBy.slice(1, 4).map((groupBy) => {
    const view = api.get(tab, { groupBy, limit: 12 }) as { groupedBy: string; groups: unknown[] };
    return { groupedBy: view.groupedBy, rows: view.groups };
  });
  return { ...primary, additionalBreakdowns: extras };
}

export const useAI = create<Store>((set, get) => ({
  byTab: readCache(),
  busyTab: null,
  error: '',
  lastCached: false,
  clear: (tab) => { const byTab = { ...get().byTab }; delete byTab[tab]; writeCache(byTab); set({ byTab }); },
  generate: async (tab, scope, thresholds) => {
    if (get().busyTab) return;
    set({ busyTab: tab, error: '' });
    try {
      const snapshot = buildSnapshot(tab, scope, thresholds);
      const scopeLabel = `${scope.period.label} · ${scope.filters.locations.length ? scope.filters.locations.join(', ') : 'all locations'}`;
      const { intelligence, cached } = await generateTabIntelligence(
        tab, snapshot, scopeLabel, scope.period.end.slice(0, 7), scope.filters.locations,
      );
      const byTab = { ...get().byTab, [tab]: intelligence };
      writeCache(byTab);
      set({ byTab, lastCached: cached });

      // Signals still land in the insight rail as cards, once per fingerprint.
      const source = `openai:${intelligence.fingerprint}`;
      const already = readCards().some((c) => c.tab === tab && c.source === source);
      if (!already) {
        for (const s of intelligence.signals) {
          addCard({ tab, title: s.title, body: s.body, action: s.action, severity: s.severity, impactINR: s.impactINR, entity: s.entity, metricId: s.metricId, source });
        }
        for (const r of intelligence.recommendations.filter((x) => x.priority === 'now').slice(0, 3)) {
          addCard({ tab, title: r.title, body: r.rationale, action: r.steps.join(' → '), severity: 'opportunity', impactINR: r.impactINR, metricId: r.metricId, source });
        }
      }
      useView.getState().announce(cached
        ? 'Reused saved AI intelligence for this scope — briefing, KPI notes, tables and recommendations updated'
        : `AI filled the briefing, ${intelligence.kpiNotes.length} KPI notes, ${intelligence.tableNotes.length} table reads, ${intelligence.recommendations.length} recommendations and ${intelligence.signals.length} signals`);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'AI generation failed.' });
    } finally {
      set({ busyTab: null });
    }
  },
}));

/** Read-only helper for surfaces that only care about the current tab. */
export const useTabAI = (tab: TabId) => useAI((s) => s.byTab[tab]);
