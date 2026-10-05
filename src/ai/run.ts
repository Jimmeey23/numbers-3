/* The single entry point behind every "Generate with AI" control.
 *
 * The rail button and the banner's refresh both land here, so there is exactly one definition
 * of what a run costs and what it populates. A run reads what the operator is looking at,
 * asks for one briefing, stores it for every surface to render, and files the signal cards.
 */
import { addCard, buildAgentApi, readCards } from '../api/agent';
import { generateAIBriefing } from './briefing';
import { useAI } from '../state/ai';
import { useView, type TabId, type Thresholds } from '../state/view';
import type { Scope } from '../state/data';

/** Identifies the data a briefing was generated against: period, comparison and filters. */
export const scopeKeyOf = (scope: Scope) =>
  `${scope.period.start}|${scope.period.end}|${JSON.stringify(scope.filters)}|${scope.ctx.ratePerSession}`;

export async function runAIBriefing(tab: TabId, scope: Scope, thresholds: Thresholds, force = false) {
  const ai = useAI.getState();
  if (ai.busy[tab]) return;
  ai.setBusy(tab, true); ai.setError(tab, '');
  const announce = useView.getState().announce;
  try {
    const api = buildAgentApi(scope, thresholds, () => undefined);
    const payload = api.get(tab, { limit: 30 });
    const sections = useAI.getState().sections[tab] ?? [];
    const { briefing, cached } = await generateAIBriefing(
      tab, payload, sections,
      `${scope.period.label}${scope.filters.locations.length ? ` · ${scope.filters.locations.join(', ')}` : ''}`,
      scope.period.end.slice(0, 7), scope.filters.locations, force,
    );
    useAI.getState().setBriefing(tab, briefing, scopeKeyOf(scope));
    // Signals become rail cards, once per fingerprint — a reused briefing must not duplicate them.
    const source = `openai:${briefing.fingerprint}`;
    if (!readCards().some((c) => c.tab === tab && c.source === source)) {
      for (const s of briefing.signals) {
        addCard({ tab, title: s.title, body: s.body, action: s.action, severity: s.severity, impactINR: s.impactINR, entity: s.entity, metricId: s.metricId, source });
      }
    }
    const parts = [
      briefing.metricNotes.length && `${briefing.metricNotes.length} metric notes`,
      briefing.sectionNotes.length && `${briefing.sectionNotes.length} section notes`,
      briefing.recommendations.length && `${briefing.recommendations.length} recommendations`,
      briefing.signals.length && `${briefing.signals.length} signals`,
    ].filter(Boolean).join(', ');
    announce(cached ? `Reused the saved AI briefing for this scope — ${parts}` : `AI briefing ready — ${parts}`);
  } catch (e) {
    useAI.getState().setError(tab, e instanceof Error ? e.message : 'AI generation failed.');
  } finally {
    useAI.getState().setBusy(tab, false);
  }
}
