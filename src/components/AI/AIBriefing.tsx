/* The briefing surface that sits above the tab.
 *
 * Everything a run produced that is not already attached to a card, a KPI or a section heading
 * is rendered here: the headline, the narrative, what moved, ranked recommendations, risks,
 * the outlook and the follow-up questions. It is a band across the top of the canvas rather
 * than a drawer, because an operator should not have to open anything to read the conclusion.
 */
import { useMemo, useState } from 'react';
import type { Scope } from '../../state/data';
import { useAI, useBriefingStale } from '../../state/ai';
import { useView, type TabId } from '../../state/view';
import { runAIBriefing, scopeKeyOf } from '../../ai/run';
import { metric } from '../../semantics/metrics';
import { fmtCurrency } from '../../semantics/formats';
import { askQuestionInPanel } from '../Ask/askBus';
import type { AIRecommendation } from '../../ai/briefing';

const EFFORT_ORDER = { low: 0, medium: 1, high: 2 } as const;
const HORIZON_ORDER = { today: 0, 'this week': 1, 'this month': 2, 'this quarter': 3 } as const;
/** Soonest first, then cheapest, then largest rupee impact — the order you would work them in. */
const rank = (a: AIRecommendation, b: AIRecommendation) =>
  HORIZON_ORDER[a.horizon] - HORIZON_ORDER[b.horizon]
  || EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort]
  || (b.impactINR ?? 0) - (a.impactINR ?? 0);

const metricLabel = (id?: string) => { if (!id) return null; try { return metric(id).label; } catch { return id; } };

export function AIBriefingBand({ tab, scope }: { tab: TabId; scope: Scope }) {
  const briefing = useAI((s) => s.briefings[tab]);
  const busy = useAI((s) => Boolean(s.busy[tab]));
  const error = useAI((s) => s.error[tab] ?? '');
  const dismissed = useAI((s) => Boolean(s.dismissed[tab]));
  const setDismissed = useAI((s) => s.setDismissed);
  const thresholds = useView((s) => s.thresholds);
  const setAskOpen = useView((s) => s.setAskOpen);
  const stale = useBriefingStale(tab, scopeKeyOf(scope));
  const [pane, setPane] = useState<'summary' | 'actions' | 'risks' | 'outlook'>('summary');
  const recommendations = useMemo(() => [...(briefing?.recommendations ?? [])].sort(rank), [briefing]);

  if (busy && !briefing) {
    return (
      <div className="ai-band is-busy" aria-busy="true">
        <div className="travel-barre" />
        <div className="t-label-m">✦ Reading this tab under {scope.period.label}…</div>
        <div className="t-label-s faint">One call writes the summary, the metric notes, the section notes, the recommendations and the rail cards.</div>
      </div>
    );
  }
  if (!briefing || dismissed) {
    if (!error) return null;
    return <div className="ai-band is-error"><span className="t-label-m">✦ AI briefing failed</span><span className="t-body-s">{error}</span></div>;
  }

  const totalImpact = recommendations.reduce((sum, r) => sum + (r.impactINR ?? 0), 0);
  const regenerate = () => void runAIBriefing(tab, scope, thresholds, true);

  return (
    <section className="ai-band" aria-label="AI briefing for this tab">
      <div className="barre barre-glow" />
      <header className="ai-band-head">
        <div style={{ minWidth: 0 }}>
          <div className="ai-band-kicker t-label-s">
            ✦ AI briefing <span className="faint">· {briefing.model} · {briefing.scopeLabel}</span>
            {stale && <span className="ai-band-stale" title="The filters have changed since this was generated">filters changed</span>}
          </div>
          <h2 className="t-heading-l ai-band-headline">{briefing.headline}</h2>
        </div>
        <div style={{ flex: 1 }} />
        {totalImpact > 0 && (
          <div className="ai-band-impact">
            <span className="t-label-s muted">Addressable in these actions</span>
            <span className="t-heading-s tabular">{fmtCurrency(totalImpact)}</span>
          </div>
        )}
        <button className="btn btn-xs" onClick={regenerate} disabled={busy}>{busy ? 'Regenerating…' : 'Regenerate'}</button>
        <button className="btn-ghost btn-xs" aria-label="Hide the AI briefing" onClick={() => setDismissed(tab, true)}>×</button>
      </header>

      <nav className="ai-band-tabs" role="tablist" aria-label="Briefing sections">
        {([
          ['summary', `Summary${briefing.whatChanged.length ? ` · ${briefing.whatChanged.length}` : ''}`],
          ['actions', `Recommendations · ${recommendations.length}`],
          ['risks', `Risks · ${briefing.risks.length}`],
          ['outlook', `Outlook · ${briefing.outlook.length}`],
        ] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={pane === id} className={`ai-band-tab ${pane === id ? 'is-active' : ''}`}
            disabled={id !== 'summary' && !({ actions: recommendations.length, risks: briefing.risks.length, outlook: briefing.outlook.length }[id])}
            onClick={() => setPane(id)}>{label}</button>
        ))}
      </nav>

      <div className="ai-band-body" role="tabpanel">
        {pane === 'summary' && (
          <>
            {briefing.summary && <p className="t-body-m ai-band-summary">{briefing.summary}</p>}
            {briefing.whatChanged.length > 0 && (
              <ul className="ai-changed">
                {briefing.whatChanged.map((c, i) => <li key={i} className="t-body-s">{c}</li>)}
              </ul>
            )}
          </>
        )}
        {pane === 'actions' && (
          <ol className="ai-reco-list">
            {recommendations.map((r, i) => (
              <li key={i} className="ai-reco" data-effort={r.effort}>
                <div className="ai-reco-head">
                  <span className="ai-reco-rank">{i + 1}</span>
                  <b className="t-heading-s">{r.title}</b>
                  <span className="ai-chip">{r.horizon}</span>
                  <span className="ai-chip">{r.effort} effort</span>
                  <span className={`ai-chip conf-${r.confidence}`}>{r.confidence} confidence</span>
                  {r.impactINR ? <span className="ai-chip is-money tabular">{fmtCurrency(r.impactINR)}</span> : null}
                  {metricLabel(r.metricId) && <span className="ai-chip faint">{metricLabel(r.metricId)}</span>}
                </div>
                {r.rationale && <div className="t-body-s muted">{r.rationale}</div>}
                {r.action && <div className="ai-reco-action t-body-s"><span className="t-label-s muted">Do </span>{r.action}</div>}
                {r.owner && <div className="t-label-s faint">Owner: {r.owner}</div>}
              </li>
            ))}
          </ol>
        )}
        {pane === 'risks' && (
          <div className="ai-risk-list">
            {briefing.risks.map((r, i) => (
              <div key={i} className={`ai-risk sev-${r.severity}`}>
                <div className="t-heading-s">{r.title}</div>
                <div className="t-body-s muted">{r.body}</div>
                {r.mitigation && <div className="t-body-s"><span className="t-label-s muted">Mitigation </span>{r.mitigation}</div>}
              </div>
            ))}
          </div>
        )}
        {pane === 'outlook' && (
          <div className="ai-outlook-list">
            {briefing.outlook.map((o, i) => (
              <div key={i} className="ai-outlook">
                <span className={`ai-outlook-arrow dir-${o.direction}`} aria-hidden="true">{o.direction === 'up' ? '▲' : o.direction === 'down' ? '▼' : '▬'}</span>
                <div>
                  <div className="t-body-s">{o.statement}</div>
                  <div className="t-label-s faint">{metricLabel(o.metricId) ? `${metricLabel(o.metricId)} · ` : ''}{o.confidence} confidence</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {briefing.questions.length > 0 && (
        <div className="ai-band-questions">
          <span className="t-label-s muted">Follow up</span>
          {briefing.questions.map((q) => (
            <button key={q} className="btn btn-xs" onClick={() => { setAskOpen(true); askQuestionInPanel(q); }}>{q}</button>
          ))}
        </div>
      )}
      {briefing.caveats.length > 0 && (
        <div className="ai-band-caveats t-label-s faint">
          {briefing.caveats.map((c, i) => <span key={i}>⚠ {c}</span>)}
        </div>
      )}
      {error && <div className="signal-ai-error" style={{ margin: '0 16px 12px' }}>{error}</div>}
    </section>
  );
}
