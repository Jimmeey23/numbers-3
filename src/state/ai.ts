/* The AI layer's single source of truth.
 *
 * Two kinds of intelligence live here. The deterministic quant pack is computed locally on every
 * scope change and needs no key: anomalies, trends, forecasts, drivers, concentration and
 * correlation are always on. The language-model pass is generated on demand per tab and is
 * grounded in that pack. Both are read by every AI surface — the briefing, the KPI cards, the
 * table summaries, the Ask panel and the insight rail — so no surface makes its own call.
 */
import { create } from 'zustand';
import { buildAgentApi, addCard, readCards, ENDPOINTS } from '../api/agent';
import { generateTabIntelligence, generateBusinessBriefing, type AITabIntelligence, type AIBusinessBriefing } from '../ai/intelligence';
import { buildQuantPack, compactQuant, type QuantPack } from '../ai/analytics';
import type { Scope } from './data';
import { useView, TABS, type TabId, type Thresholds } from './view';

const KEY = 'floor.ai.tab-intelligence.v2';
const AUTO_KEY = 'floor.ai.autorun';

type Store = {
  byTab: Partial<Record<TabId, AITabIntelligence>>;
  quantByTab: Partial<Record<TabId, QuantPack>>;
  business: AIBusinessBriefing | null;
  busyTab: TabId | null;
  businessBusy: boolean;
  error: string;
  lastCached: boolean;
  /** Generate the tab brief automatically when a tab is opened and a cached copy exists. */
  autoRun: boolean;
  setAutoRun: (v: boolean) => void;
  computeQuant: (tab: TabId, scope: Scope) => QuantPack;
  generate: (tab: TabId, scope: Scope, thresholds: Thresholds) => Promise<void>;
  generateBusiness: (scope: Scope, thresholds: Thresholds) => Promise<void>;
  clear: (tab: TabId) => void;
};

const readCache = (): Partial<Record<TabId, AITabIntelligence>> => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
};
const writeCache = (v: Partial<Record<TabId, AITabIntelligence>>) => {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* quota */ }
};

/** Everything the model is allowed to see: headline KPIs plus up to three groupings. */
function buildSnapshot(tab: TabId, scope: Scope, thresholds: Thresholds, depth = 24) {
  const api = buildAgentApi(scope, thresholds, () => undefined);
  const ep = ENDPOINTS.find((e) => e.tab === tab) ?? ENDPOINTS[0];
  const primary = api.get(tab, { limit: depth }) as Record<string, unknown>;
  const extras = ep.groupBy.slice(1, 4).map((groupBy) => {
    const view = api.get(tab, { groupBy, limit: Math.max(6, Math.round(depth / 2)) }) as { groupedBy: string; groups: unknown[] };
    return { groupedBy: view.groupedBy, rows: view.groups };
  });
  return { ...primary, additionalBreakdowns: extras };
}

export const useAI = create<Store>((set, get) => ({
  byTab: readCache(),
  quantByTab: {},
  business: null,
  busyTab: null,
  businessBusy: false,
  error: '',
  lastCached: false,
  autoRun: (() => { try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; } })(),
  setAutoRun: (v) => { try { localStorage.setItem(AUTO_KEY, v ? '1' : '0'); } catch { /* ignore */ } set({ autoRun: v }); },

  computeQuant: (tab, scope) => {
    const pack = buildQuantPack(scope, tab);
    set({ quantByTab: { ...get().quantByTab, [tab]: pack } });
    return pack;
  },

  clear: (tab) => { const byTab = { ...get().byTab }; delete byTab[tab]; writeCache(byTab); set({ byTab }); },

  generate: async (tab, scope, thresholds) => {
    if (get().busyTab) return;
    set({ busyTab: tab, error: '' });
    try {
      const snapshot = buildSnapshot(tab, scope, thresholds);
      const quant = get().quantByTab[tab] ?? get().computeQuant(tab, scope);
      const scopeLabel = `${scope.period.label} · ${scope.filters.locations.length ? scope.filters.locations.join(', ') : 'all locations'}`;
      const { intelligence, cached } = await generateTabIntelligence(
        tab, snapshot, quant, scopeLabel, scope.period.end.slice(0, 7), scope.filters.locations,
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
        ? 'Reused saved AI intelligence for this scope — briefing, KPI notes, tables, causes and recommendations updated'
        : `AI filled the briefing, ${intelligence.kpiNotes.length} KPI notes, ${intelligence.tableNotes.length} table reads, ${intelligence.rootCauses.length} root causes, ${intelligence.recommendations.length} recommendations and ${intelligence.signals.length} signals`);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'AI generation failed.' });
    } finally {
      set({ busyTab: null });
    }
  },

  generateBusiness: async (scope, thresholds) => {
    if (get().businessBusy) return;
    set({ businessBusy: true, error: '' });
    try {
      const tabs = TABS.map((t) => t.id).filter((t) => t !== 'health' && t !== 'overview');
      const snapshots = tabs.map((tab) => {
        const ep = ENDPOINTS.find((e) => e.tab === tab)!;
        const quant = get().quantByTab[tab] ?? buildQuantPack(scope, tab);
        return { tab, title: ep.title, snapshot: buildSnapshot(tab, scope, thresholds, 8), quant: compactQuant(quant) };
      });
      const scopeLabel = `${scope.period.label} · ${scope.filters.locations.length ? scope.filters.locations.join(', ') : 'all locations'}`;
      const { briefing, cached } = await generateBusinessBriefing(snapshots, scopeLabel, scope.period.end.slice(0, 7), scope.filters.locations);
      set({ business: briefing, lastCached: cached });
      useView.getState().announce(cached ? 'Reused the saved whole-business synthesis for this scope' : `Whole-business synthesis ready — ${briefing.chains.length} cross-functional chains and ${briefing.priorities.length} ranked priorities`);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Business synthesis failed.' });
    } finally {
      set({ businessBusy: false });
    }
  },
}));

/** Read-only helper for surfaces that only care about the current tab. */
export const useTabAI = (tab: TabId) => useAI((s) => s.byTab[tab]);
