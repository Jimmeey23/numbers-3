/* Whole-business synthesis.
 *
 * Every other AI surface reads one tab. This one reads all of them in a single pass, which is
 * the only way to see that leads improved into slots that were already full, or that payroll
 * cost rose where attendance did not. Expensive, so it is explicitly requested and cached.
 */
import { useAI } from '../../state/ai';
import { useScope } from '../../state/data';
import { useView } from '../../state/view';
import { fmtCurrency } from '../../semantics/formats';

export function BusinessBriefingView() {
  const business = useAI((s) => s.business);
  const busy = useAI((s) => s.businessBusy);
  const generate = useAI((s) => s.generateBusiness);
  const scope = useScope();
  const thresholds = useView((s) => s.thresholds);
  const setTab = useView((s) => s.setTab);
  const setAskOpen = useView((s) => s.setAskOpen);

  if (!business) {
    return (
      <div className="ai-briefing-body">
        <p className="t-body-s muted">
          One pass across classes, slots, trainers, sales, acquisition, retention, bookings, leads, attendance and payroll —
          looking for the chains and contradictions no single tab can show. Costs one larger request; the result is cached per scope.
        </p>
        <button className="ai-signal-button" style={{ maxWidth: 320 }} disabled={busy || !scope} onClick={() => scope && generate(scope, thresholds)}>
          ✦ {busy ? 'Reading every area…' : 'Synthesise the whole business'}
        </button>
      </div>
    );
  }

  return (
    <div className="ai-briefing-body">
      <div className="biz-head">
        <div><b className="t-heading-s">{business.headline}</b><small className="t-label-s faint"> · {business.scopeLabel} · {business.model}</small></div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-xs" disabled={busy || !scope} onClick={() => scope && generate(scope, thresholds)}>{busy ? 'Working…' : 'Refresh'}</button>
      </div>
      <p className="ai-briefing-summary">{business.executiveSummary}</p>

      {business.scorecard.length > 0 && (
        <div className="biz-scorecard">
          {business.scorecard.map((s, i) => (
            <button key={i} className={`biz-score st-${s.state}`} onClick={() => s.tab && setTab(s.tab)} title={`Open ${s.area}`}>
              <b>{s.area}</b><span className="biz-state">{s.state}</span><small>{s.note}</small>
            </button>
          ))}
        </div>
      )}

      {business.chains.length > 0 && (
        <section className="quant-block">
          <div className="ai-sub-label">Cross-functional chains</div>
          {business.chains.map((c, i) => (
            <div key={i} className="biz-chain">
              <div className="biz-chain-head"><span className="biz-chain-path">{c.chain}</span><span className={`ai-confidence c-${c.confidence}`}>{c.confidence}</span></div>
              <b>{c.finding}</b>
              <p className="faint">{c.evidence}</p>
              <small>→ {c.implication}</small>
            </div>
          ))}
        </section>
      )}

      {business.contradictions.length > 0 && (
        <section className="quant-block">
          <div className="ai-sub-label">Where the data disagrees with itself</div>
          {business.contradictions.map((c, i) => (
            <div key={i} className="ai-risk sev-attention"><b>{c.finding}</b><p>{c.evidence}</p><small>Resolution: {c.resolution}</small></div>
          ))}
        </section>
      )}

      {business.priorities.length > 0 && (
        <section className="quant-block">
          <div className="ai-sub-label">Ranked group priorities</div>
          {business.priorities.map((p, i) => (
            <div key={i} className="biz-priority">
              <span className="biz-rank">{p.rank ?? i + 1}</span>
              <div>
                <b>{p.title}</b>
                <p>{p.why}</p>
                <small>First step: {p.firstStep}{p.owner ? ` · ${p.owner}` : ''}</small>
              </div>
              {typeof p.impactINR === 'number' && <span className="ai-reco-impact">{fmtCurrency(p.impactINR)}</span>}
              {p.tab && <button className="btn btn-xs" onClick={() => setTab(p.tab!)}>Open</button>}
            </div>
          ))}
        </section>
      )}

      {business.watchlist.length > 0 && (
        <section className="quant-block">
          <div className="ai-sub-label">Watchlist · check weekly</div>
          <ul className="quant-list">{business.watchlist.map((w, i) => <li key={i}><b>{w.title}</b> — {w.metric} crossing {w.threshold}{w.tab ? ` (${w.tab})` : ''}</li>)}</ul>
        </section>
      )}

      {business.questions.length > 0 && (
        <div className="ai-questions">
          <div className="ai-sub-label">Board-level questions</div>
          <div className="ai-chips">
            {business.questions.map((q, i) => (
              <button key={i} className="ai-chip is-button" onClick={() => { setAskOpen(true); window.dispatchEvent(new CustomEvent('floor:ask-prefill', { detail: q })); }}>{q}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
