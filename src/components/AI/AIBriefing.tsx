/* The AI briefing that sits above the tab canvas.
 *
 * One generation fills five reading surfaces here — summary, takeaways, recommendations,
 * watch-outs and outlook — so the AI is not hidden inside a single drawer.
 */
import { useState } from 'react';
import { useAI } from '../../state/ai';
import { useScope } from '../../state/data';
import { useView, type TabId } from '../../state/view';
import { fmtCurrency } from '../../semantics/formats';
import type { AIRecommendation } from '../../ai/intelligence';

const PRIORITY_LABEL: Record<AIRecommendation['priority'], string> = { now: 'Do now', 'this-week': 'This week', 'this-month': 'This month' };
type Pane = 'summary' | 'recommendations' | 'risks' | 'outlook';

export function AIBriefing({ tab }: { tab: TabId }) {
  const intel = useAI((s) => s.byTab[tab]);
  const busy = useAI((s) => s.busyTab === tab);
  const error = useAI((s) => s.error);
  const generate = useAI((s) => s.generate);
  const clear = useAI((s) => s.clear);
  const scope = useScope();
  const thresholds = useView((s) => s.thresholds);
  const setAskOpen = useView((s) => s.setAskOpen);
  const [pane, setPane] = useState<Pane>('summary');
  const [open, setOpen] = useState(true);

  const run = () => { if (scope) generate(tab, scope, thresholds); };

  if (!intel) {
    return (
      <div className="ai-briefing is-empty">
        <span className="ai-briefing-mark" aria-hidden>✦</span>
        <div className="ai-briefing-pitch">
          <b>AI briefing for this tab</b>
          <small>One generation writes the summary, per-KPI commentary, table reads, recommendations, risks, outlook and the insight rail.</small>
        </div>
        {error && <span className="signal-ai-error">{error}</span>}
        <button className="ai-signal-button ai-briefing-cta" onClick={run} disabled={busy || !scope}>
          ✦ {busy ? 'Analysing this view…' : 'Generate with AI'}
        </button>
      </div>
    );
  }

  const counts = { r: intel.recommendations.length, k: intel.risks.length, o: intel.outlook.length };
  return (
    <section className="ai-briefing" aria-label="AI briefing">
      <header className="ai-briefing-head">
        <span className="ai-briefing-mark" aria-hidden>✦</span>
        <div className="ai-briefing-title">
          <b>{intel.headline || 'AI briefing'}</b>
          <small>{intel.scopeLabel} · {intel.model} · {new Date(intel.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small>
        </div>
        <div className="ai-briefing-actions">
          <button className="btn btn-xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Collapse' : 'Expand'}</button>
          <button className="btn btn-xs" onClick={() => { clear(tab); run(); }} disabled={busy}>{busy ? 'Regenerating…' : 'Regenerate'}</button>
        </div>
      </header>
      {open && (
        <>
          <nav className="ai-briefing-tabs" role="tablist">
            {([['summary', `Summary · ${intel.keyTakeaways.length}`], ['recommendations', `Recommendations · ${counts.r}`], ['risks', `Watch-outs · ${counts.k}`], ['outlook', `Outlook · ${counts.o}`]] as [Pane, string][]).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={pane === id} className={`ai-briefing-tab ${pane === id ? 'is-active' : ''}`} onClick={() => setPane(id)}>{label}</button>
            ))}
          </nav>

          {pane === 'summary' && (
            <div className="ai-briefing-body">
              <p className="ai-briefing-summary">{intel.executiveSummary}</p>
              <ul className="ai-takeaways">
                {intel.keyTakeaways.map((t, i) => <li key={i}><span className="ai-bullet-index">{i + 1}</span>{t}</li>)}
              </ul>
              {intel.tableNotes.length > 0 && (
                <div className="ai-table-reads">
                  <div className="ai-sub-label">What the breakdowns say</div>
                  {intel.tableNotes.map((n, i) => (
                    <div key={i} className="ai-table-read">
                      <b>{n.title}</b>
                      <p>{n.summary}</p>
                      {n.standouts?.length ? <div className="ai-chips">{n.standouts.map((s, j) => <span key={j} className="ai-chip">{s}</span>)}</div> : null}
                      {n.recommendation && <small>→ {n.recommendation}</small>}
                    </div>
                  ))}
                </div>
              )}
              {intel.dataCaveats.length > 0 && (
                <div className="ai-caveats"><b>Caveats</b><ul>{intel.dataCaveats.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
              )}
              {intel.questions.length > 0 && (
                <div className="ai-questions">
                  <div className="ai-sub-label">Ask next</div>
                  <div className="ai-chips">
                    {intel.questions.map((q, i) => (
                      <button key={i} className="ai-chip is-button" onClick={() => { setAskOpen(true); window.dispatchEvent(new CustomEvent('floor:ask-prefill', { detail: q })); }}>{q}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {pane === 'recommendations' && (
            <div className="ai-briefing-body ai-reco-grid">
              {intel.recommendations.map((r, i) => (
                <article key={i} className={`ai-reco p-${r.priority}`}>
                  <header>
                    <span className="ai-reco-priority">{PRIORITY_LABEL[r.priority] ?? r.priority}</span>
                    {r.effort && <span className="ai-reco-meta">{r.effort} effort</span>}
                    {r.owner && <span className="ai-reco-meta">{r.owner}</span>}
                    {typeof r.impactINR === 'number' && <span className="ai-reco-impact">{fmtCurrency(r.impactINR)}</span>}
                  </header>
                  <b>{r.title}</b>
                  <p>{r.rationale}</p>
                  <ol>{r.steps?.map((s, j) => <li key={j}>{s}</li>)}</ol>
                  {r.confidence && <small className="faint">confidence: {r.confidence}</small>}
                </article>
              ))}
              {!intel.recommendations.length && <p className="t-body-s muted">No recommendation was returned for this scope.</p>}
            </div>
          )}

          {pane === 'risks' && (
            <div className="ai-briefing-body">
              {intel.risks.map((r, i) => (
                <div key={i} className={`ai-risk sev-${r.severity}`}>
                  <b>{r.title}</b>
                  <p>{r.body}</p>
                  {r.earlyIndicator && <small>Watch weekly: {r.earlyIndicator}</small>}
                </div>
              ))}
              {!intel.risks.length && <p className="t-body-s muted">No watch-out was returned for this scope.</p>}
            </div>
          )}

          {pane === 'outlook' && (
            <div className="ai-briefing-body ai-outlook-grid">
              {intel.outlook.map((o, i) => (
                <div key={i} className={`ai-outlook dir-${o.direction}`}>
                  <span className="ai-outlook-arrow" aria-hidden>{o.direction === 'up' ? '↗' : o.direction === 'down' ? '↘' : '→'}</span>
                  <b>{o.label}</b>
                  <p>{o.expectation}</p>
                  <small>{o.basis}</small>
                </div>
              ))}
              {!intel.outlook.length && <p className="t-body-s muted">No outlook was returned for this scope.</p>}
            </div>
          )}
          {error && <div className="signal-ai-error">{error}</div>}
        </>
      )}
    </section>
  );
}
