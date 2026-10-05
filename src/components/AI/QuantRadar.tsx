/* The radar: statistical intelligence that needs no API key.
 *
 * Anomalies, six-month trend, next-month forecast, month-to-date pace, who moved the number,
 * concentration, correlation and seasonality — all computed locally. This is the part of the AI
 * layer that is always on, and it is also exactly what the language model is grounded in, so
 * what the operator reads here is what the model read.
 */
import type { QuantPack } from '../../ai/analytics';
import { Sparkline } from '../MetricCard/MetricCard';

const pctText = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);

export function QuantRadar({ quant }: { quant: QuantPack }) {
  const movers = [...quant.metrics].filter((m) => m.changePct !== null)
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0)).slice(0, 6);
  return (
    <div className="ai-briefing-body quant-radar">
      <div className="quant-note">Computed locally from the rows in scope — no API key, no network call. The language model is grounded in exactly these numbers.</div>

      {quant.anomalies.length > 0 && (
        <section className="quant-block">
          <div className="ai-sub-label">Anomalies · {quant.anomalies.length}</div>
          {quant.anomalies.map((a) => (
            <div key={a.metricId} className={`quant-anomaly v-${a.verdict}`}>
              <span className="quant-z">{a.z > 0 ? '▲' : '▼'} {Math.abs(a.z).toFixed(1)}σ</span>
              <div><b>{a.label}</b><p>{a.note}</p></div>
            </div>
          ))}
        </section>
      )}

      <section className="quant-block">
        <div className="ai-sub-label">Movement, trend and forecast</div>
        <div className="quant-grid">
          {movers.map((m) => (
            <article key={m.metricId} className="quant-card">
              <header><b>{m.label}</b><span className={`quant-change ${(m.changePct ?? 0) >= 0 === m.higherIsBetter ? 'pos' : 'neg'}`}>{pctText(m.changePct)}</span></header>
              <div className="quant-value tabular">{m.currentFormatted}<small>from {m.previousFormatted}</small></div>
              <Sparkline data={m.series.map((p) => p.value)} width={190} height={26} color="var(--hue-growth)" animate={false} />
              <ul className="quant-facts">
                {m.trend && <li><i>Trend</i>{m.trend.direction} · R² {m.trend.r2.toFixed(2)} over {m.trend.months} months</li>}
                {m.streak && <li><i>Streak</i>{m.streak.months} months {m.streak.direction}</li>}
                {m.forecast && <li><i>Next month</i>{m.forecast.formatted} <small>band {m.forecast.low.toFixed(0)}–{m.forecast.high.toFixed(0)}</small></li>}
                {m.pace && <li><i>Pace</i>{m.pace.formatted} projected · {(m.pace.elapsedShare * 100).toFixed(0)}% elapsed</li>}
                {m.z !== null && <li><i>Position</i>{Math.abs(m.z).toFixed(1)}σ {m.z >= 0 ? 'above' : 'below'} its own median</li>}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {quant.drivers.filter((d) => d.gainers.length || d.losers.length).map((d) => (
        <section key={d.groupBy} className="quant-block">
          <div className="ai-sub-label">What moved {d.label} · by {d.groupLabel.toLowerCase()}</div>
          <div className="quant-drivers">
            <div>
              <span className="quant-driver-head pos">Added</span>
              {d.gainers.map((g) => <div key={g.label} className="quant-driver"><span>{g.label}</span><b className="pos">{g.deltaFormatted}</b>{g.shareOfChange !== null && <small>{(g.shareOfChange * 100).toFixed(0)}% of change</small>}</div>)}
              {!d.gainers.length && <div className="quant-driver faint">None</div>}
            </div>
            <div>
              <span className="quant-driver-head neg">Lost</span>
              {d.losers.map((g) => <div key={g.label} className="quant-driver"><span>{g.label}</span><b className="neg">{g.deltaFormatted}</b>{g.shareOfChange !== null && <small>{Math.abs(g.shareOfChange * 100).toFixed(0)}% of change</small>}</div>)}
              {!d.losers.length && <div className="quant-driver faint">None</div>}
            </div>
          </div>
        </section>
      ))}

      {(quant.concentration.length > 0 || quant.seasonality.length > 0) && (
        <section className="quant-block">
          <div className="ai-sub-label">Concentration and timetable spread</div>
          <ul className="quant-list">
            {quant.concentration.map((c) => <li key={c.groupBy}>{c.note}{c.hhi !== null && <small> HHI {c.hhi.toFixed(2)}</small>}</li>)}
            {quant.seasonality.map((s, i) => <li key={i}>{s.note}</li>)}
          </ul>
        </section>
      )}

      {quant.correlations.length > 0 && (
        <section className="quant-block">
          <div className="ai-sub-label">Metrics that move together</div>
          <ul className="quant-list">{quant.correlations.slice(0, 5).map((c, i) => <li key={i}>{c.note}</li>)}</ul>
        </section>
      )}

      {quant.dataQuality.length > 0 && (
        <section className="quant-block">
          <div className="ai-sub-label">Read these with care</div>
          <ul className="quant-list warn-list">{quant.dataQuality.map((d) => <li key={d.metricId}><b>{d.label}</b> — {d.issue}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
