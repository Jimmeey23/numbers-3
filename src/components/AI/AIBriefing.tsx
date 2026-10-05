/* The AI briefing above the tab canvas.
 *
 * Eight reading surfaces from one generation — radar, summary, causes, recommendations,
 * experiments and what-ifs, risks, outlook, plan — plus a whole-business synthesis on Overview.
 * The radar pane works with no API key at all, so the panel is never dead weight.
 */
import { useMemo, useState } from 'react';
import { useAI } from '../../state/ai';
import { usePlan, openImpact } from '../../state/plan';
import { useScope } from '../../state/data';
import { useView, type TabId } from '../../state/view';
import { fmtCurrency } from '../../semantics/formats';
import { applyAIAction, type AIAction } from '../../ai/actions';
import type { AIRecommendation } from '../../ai/intelligence';
import { QuantRadar } from './QuantRadar';
import { BusinessBriefingView } from './BusinessBriefing';
import { PlanPanel } from './PlanPanel';

const PRIORITY_LABEL: Record<AIRecommendation['priority'], string> = { now: 'Do now', 'this-week': 'This week', 'this-month': 'This month' };
type Pane = 'radar' | 'summary' | 'causes' | 'recommendations' | 'experiments' | 'risks' | 'outlook' | 'plan' | 'business';

function ActionButtons({ actions }: { actions?: AIAction[] }) {
  const announce = useView((s) => s.announce);
  if (!actions?.length) return null;
  return (
    <div className="ai-action-row">
      {actions.map((a, i) => (
        <button key={i} className="ai-action" onClick={() => announce(applyAIAction(a))} title={a.kind === 'ask' ? a.question : a.label}>
          {a.kind === 'widget' ? '⊞' : a.kind === 'ask' ? '?' : '↳'} {a.label}
        </button>
      ))}
    </div>
  );
}

export function AIBriefing({ tab }: { tab: TabId }) {
  const intel = useAI((s) => s.byTab[tab]);
  const quant = useAI((s) => s.quantByTab[tab]);
  const busy = useAI((s) => s.busyTab === tab);
  const error = useAI((s) => s.error);
  const generate = useAI((s) => s.generate);
  const clear = useAI((s) => s.clear);
  const autoRun = useAI((s) => s.autoRun);
  const setAutoRun = useAI((s) => s.setAutoRun);
  const scope = useScope();
  const thresholds = useView((s) => s.thresholds);
  const setAskOpen = useView((s) => s.setAskOpen);
  const allPlanItems = usePlan((s) => s.items);
  const planItems = useMemo(() => allPlanItems.filter((i) => i.tab === tab), [allPlanItems, tab]);
  const addToPlan = usePlan((s) => s.add);
  const planHas = usePlan((s) => s.has);
  const [pane, setPane] = useState<Pane>(intel ? 'summary' : 'radar');
  const [open, setOpen] = useState(true);

  const run = () => { if (scope) generate(tab, scope, thresholds); };
  const q = intel?.quant ?? quant;

  const panes: [Pane, string][] = [
    ['radar', `Radar${q ? ` · ${q.anomalies.length}` : ''}`],
    ...(intel ? ([
      ['summary', `Summary · ${intel.keyTakeaways.length}`],
      ['causes', `Causes · ${intel.rootCauses.length}`],
      ['recommendations', `Actions · ${intel.recommendations.length}`],
      ['experiments', `Tests & what-ifs · ${intel.experiments.length + intel.scenarios.length}`],
      ['risks', `Watch-outs · ${intel.risks.length}`],
      ['outlook', `Outlook · ${intel.outlook.length}`],
    ] as [Pane, string][]) : []),
    ['plan', `Plan · ${planItems.filter((i) => i.status !== 'done' && i.status !== 'dropped').length}`],
    ...(tab === 'overview' ? ([['business', 'Whole business']] as [Pane, string][]) : []),
  ];

  return (
    <section className="ai-briefing" aria-label="AI briefing">
      <header className="ai-briefing-head">
        <span className="ai-briefing-mark" aria-hidden>✦</span>
        <div className="ai-briefing-title">
          <b>{intel?.headline || q?.headline || 'AI briefing for this tab'}</b>
          <small>
            {intel
              ? `${intel.scopeLabel} · ${intel.model} · ${new Date(intel.generatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`
              : 'Statistics are live. Generate to add narrative, causes, recommendations, experiments and outlook.'}
          </small>
        </div>
        <div className="ai-briefing-actions">
          {openImpact(planItems) > 0 && <span className="ai-plan-pill" title="Estimated rupee impact of open plan items on this tab">{fmtCurrency(openImpact(planItems))} in plan</span>}
          <label className="ai-auto" title="When a brief has already been generated for this scope, reuse it automatically on arrival (no new API call).">
            <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />auto
          </label>
          <button className="btn btn-xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Collapse' : 'Expand'}</button>
          <button className={intel ? 'btn btn-xs' : 'ai-signal-button ai-briefing-cta'} onClick={() => { if (intel) clear(tab); run(); }} disabled={busy || !scope}>
            {busy ? 'Analysing…' : intel ? 'Regenerate' : '✦ Generate with AI'}
          </button>
        </div>
      </header>

      {open && (
        <>
          <nav className="ai-briefing-tabs" role="tablist">
            {panes.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={pane === id} className={`ai-briefing-tab ${pane === id ? 'is-active' : ''}`} onClick={() => setPane(id)}>{label}</button>
            ))}
          </nav>

          {pane === 'radar' && (q
            ? <QuantRadar quant={q} />
            : <div className="ai-briefing-body"><p className="t-body-s muted">Statistics appear once the dataset is in scope.</p></div>)}

          {pane === 'plan' && <PlanPanel tab={tab} />}
          {pane === 'business' && <BusinessBriefingView />}

          {intel && pane === 'summary' && (
            <div className="ai-briefing-body">
              <p className="ai-briefing-summary">{intel.executiveSummary}</p>
              <ActionButtons actions={intel.actions} />
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
                    {intel.questions.map((x, i) => (
                      <button key={i} className="ai-chip is-button" onClick={() => { setAskOpen(true); window.dispatchEvent(new CustomEvent('floor:ask-prefill', { detail: x })); }}>{x}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {intel && pane === 'causes' && (
            <div className="ai-briefing-body">
              {intel.rootCauses.map((c, i) => (
                <div key={i} className="ai-cause">
                  <div className="ai-cause-head"><b>{c.effect}</b><span className={`ai-confidence c-${c.confidence}`}>{c.confidence} confidence</span></div>
                  <p><i>Hypothesis.</i> {c.hypothesis}</p>
                  <p className="faint"><i>Evidence.</i> {c.evidence}</p>
                  <small>Test it by: {c.testedBy}</small>
                </div>
              ))}
              {!intel.rootCauses.length && <p className="t-body-s muted">No root-cause hypothesis was returned for this scope.</p>}
            </div>
          )}

          {intel && pane === 'recommendations' && (
            <div className="ai-briefing-body ai-reco-grid">
              {intel.recommendations.map((r, i) => {
                const added = planHas(tab, r.title);
                return (
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
                    {r.measure && <small className="ai-reco-measure">Proof it worked: {r.measure}</small>}
                    {r.risk && <small className="faint">Risk: {r.risk}</small>}
                    <ActionButtons actions={r.actions} />
                    <div className="ai-reco-foot">
                      {r.confidence && <span className={`ai-confidence c-${r.confidence}`}>{r.confidence}</span>}
                      <button className="btn btn-xs" disabled={added}
                        onClick={() => addToPlan({ tab, title: r.title, rationale: r.rationale, steps: r.steps ?? [], priority: r.priority, owner: r.owner, impactINR: r.impactINR, metricId: r.metricId, source: 'ai' })}>
                        {added ? '✓ In plan' : 'Add to plan'}
                      </button>
                    </div>
                  </article>
                );
              })}
              {!intel.recommendations.length && <p className="t-body-s muted">No recommendation was returned for this scope.</p>}
            </div>
          )}

          {intel && pane === 'experiments' && (
            <div className="ai-briefing-body">
              {intel.experiments.length > 0 && <div className="ai-sub-label">Experiments worth running</div>}
              <div className="ai-reco-grid">
                {intel.experiments.map((e, i) => (
                  <article key={i} className="ai-reco p-this-week">
                    <b>{e.title}</b>
                    <p><i>If.</i> {e.hypothesis}</p>
                    <ul className="ai-exp-list">
                      <li><i>Change</i>{e.change}</li>
                      <li><i>Measure</i>{e.measure}</li>
                      <li><i>Run for</i>{e.duration}</li>
                      <li><i>Succeeds if</i>{e.successCriterion}</li>
                    </ul>
                  </article>
                ))}
              </div>
              {intel.scenarios.length > 0 && <div className="ai-sub-label">What-if</div>}
              {intel.scenarios.map((s, i) => (
                <div key={i} className="ai-scenario">
                  <div className="ai-scenario-head">
                    <b>{s.title}</b>
                    {typeof s.estimatedImpactINR === 'number' && <span className="ai-reco-impact">{fmtCurrency(s.estimatedImpactINR)}</span>}
                    <span className={`ai-confidence c-${s.confidence}`}>{s.confidence}</span>
                  </div>
                  <p><b>Lever.</b> {s.lever} <b>Assumes.</b> {s.assumption}</p>
                  <code>{s.math}</code>
                </div>
              ))}
              {!intel.experiments.length && !intel.scenarios.length && <p className="t-body-s muted">No experiment or scenario was returned for this scope.</p>}
            </div>
          )}

          {intel && pane === 'risks' && (
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

          {intel && pane === 'outlook' && (
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

          {error && <div className="signal-ai-error" style={{ margin: '0 16px 14px' }}>{error}</div>}
        </>
      )}
    </section>
  );
}
