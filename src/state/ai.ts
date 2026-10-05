/* Where an AI briefing lives once it exists.
 *
 * One store, keyed by tab, read by every surface that renders a piece of the briefing: the
 * banner above the tab, the note on a KPI card, the note under a section heading, the rail,
 * and the suggested questions in Ask. Nothing here calls the model — the shell does that and
 * hands the result over — so a component can read AI output without being able to spend money.
 */
import { create } from 'zustand';
import type { AIBriefing, AIMetricNote } from '../ai/briefing';
import type { TabId } from './view';

interface AIState {
  briefings: Partial<Record<TabId, AIBriefing>>;
  busy: Partial<Record<TabId, boolean>>;
  error: Partial<Record<TabId, string>>;
  /** Section titles currently rendered on each tab, so the model is asked about real sections. */
  sections: Partial<Record<TabId, string[]>>;
  /** Fingerprint of the scope each briefing was generated under, to flag a stale one. */
  scopeKey: Partial<Record<TabId, string>>;
  dismissed: Partial<Record<TabId, boolean>>;
  setBriefing: (tab: TabId, briefing: AIBriefing, scopeKey: string) => void;
  setBusy: (tab: TabId, busy: boolean) => void;
  setError: (tab: TabId, error: string) => void;
  clearBriefing: (tab: TabId) => void;
  registerSection: (tab: TabId, title: string) => () => void;
  setDismissed: (tab: TabId, dismissed: boolean) => void;
}

export const useAI = create<AIState>((set) => ({
  briefings: {}, busy: {}, error: {}, sections: {}, scopeKey: {}, dismissed: {},
  setBriefing: (tab, briefing, scopeKey) => set((s) => ({
    briefings: { ...s.briefings, [tab]: briefing },
    scopeKey: { ...s.scopeKey, [tab]: scopeKey },
    error: { ...s.error, [tab]: '' },
    dismissed: { ...s.dismissed, [tab]: false },
  })),
  setBusy: (tab, busy) => set((s) => ({ busy: { ...s.busy, [tab]: busy } })),
  setError: (tab, error) => set((s) => ({ error: { ...s.error, [tab]: error } })),
  clearBriefing: (tab) => set((s) => {
    const briefings = { ...s.briefings }; delete briefings[tab];
    return { briefings, error: { ...s.error, [tab]: '' } };
  }),
  registerSection: (tab, title) => {
    set((s) => {
      const current = s.sections[tab] ?? [];
      return current.includes(title) ? s : { sections: { ...s.sections, [tab]: [...current, title] } };
    });
    return () => set((s) => ({ sections: { ...s.sections, [tab]: (s.sections[tab] ?? []).filter((t) => t !== title) } }));
  },
  setDismissed: (tab, dismissed) => set((s) => ({ dismissed: { ...s.dismissed, [tab]: dismissed } })),
}));

/** The briefing for a tab, only while it still matches the scope it was generated under. */
export const useBriefing = (tab: TabId, scopeKey?: string): AIBriefing | null => useAI((s) => {
  const briefing = s.briefings[tab];
  if (!briefing) return null;
  if (scopeKey && s.scopeKey[tab] && s.scopeKey[tab] !== scopeKey) return null;
  return briefing;
});

/** Whether the briefing on screen was generated under a different scope than the current one. */
export const useBriefingStale = (tab: TabId, scopeKey: string): boolean =>
  useAI((s) => Boolean(s.briefings[tab] && s.scopeKey[tab] && s.scopeKey[tab] !== scopeKey));

/** The AI note for one metric on the current tab, if the last run commented on it. */
export const useMetricNote = (tab: TabId, metricId: string): AIMetricNote | null =>
  useAI((s) => s.briefings[tab]?.metricNotes.find((n) => n.metricId === metricId) ?? null);

/** The AI note for one section, matched on its exact title. */
export const useSectionNote = (tab: TabId, title: string): string | null =>
  useAI((s) => s.briefings[tab]?.sectionNotes.find((n) => n.section === title)?.note ?? null);
