import type { Insight } from '../../insights/rules';
import { fmtCurrency } from '../../semantics/formats';
import { useFilters } from '../../state/filters';
import { useView } from '../../state/view';

const SEV: Record<Insight['severity'], { label: string; color: string; wash: string }> = {
  critical: { label: 'Critical', color: 'var(--neg)', wash: 'var(--neg-wash)' },
  attention: { label: 'Attention', color: 'var(--warn)', wash: 'var(--warn-wash)' },
  opportunity: { label: 'Opportunity', color: 'var(--pos)', wash: 'var(--pos-wash)' },
  context: { label: 'Context', color: 'var(--info)', wash: 'var(--info-wash)' },
};

export function InsightCard({ insight, compact = false }: { insight: Insight; compact?: boolean }) {
  const s = SEV[insight.severity];
  const setTab = useView((v) => v.setTab); const dismiss = useView((v) => v.dismiss); const announce = useView((v) => v.announce);
  const addTransient = useFilters((f) => f.addTransient);
  const go = () => { setTab(insight.tab); for (const t of insight.linkFilters) addTransient(t); announce(`Opened ${insight.tab} filtered to ${insight.entity}`); };
  return (
    <article className={`insight-card ${compact ? 'is-compact' : ''}`} style={{ ['--tone' as string]: s.color, ['--tone-wash' as string]: s.wash }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="insight-sev">{s.label}</span>
        {insight.impactINR > 0 && (
          <span className="t-label-s muted tabular" title={insight.basis === 'at-risk' ? 'Revenue currently at risk of being lost' : insight.basis === 'sunk' ? 'Money already collected but not yet delivered against' : insight.basis === 'upside' ? 'Estimated additional revenue if acted on' : 'Estimated impact'}>
            {fmtCurrency(insight.impactINR)}{insight.basis ? <span className="faint"> {insight.basis === 'at-risk' ? 'at risk' : insight.basis === 'sunk' ? 'unused' : 'upside'}</span> : null}
          </span>
        )}
        {insight.n !== undefined && insight.n < 30 && <span className="t-label-s faint">n = {insight.n}</span>}
        <div style={{ flex: 1 }} />
        {!compact && <button className="btn-ghost t-label-s" aria-label="Dismiss for 30 days" onClick={() => dismiss(insight.key)}>×</button>}
      </div>
      <div className="t-heading-s" style={{ marginTop: 7 }}>{insight.title}</div>
      <p className="t-body-s muted" style={{ margin: '5px 0 0' }}>{insight.body}</p>
      <p className="t-body-s insight-action" style={{ margin: '6px 0 0' }}>{insight.action}</p>
      {!compact && <button className="btn btn-xs" style={{ marginTop: 10 }} onClick={go}>Show me →</button>}
    </article>
  );
}
