/* The action plan.
 *
 * Accepted recommendations become owned, dated work with a status. Everything here is local and
 * persistent, so the plan survives regeneration — the point of the panel is that an AI pass can
 * be thrown away without losing the decisions it prompted.
 */
import { usePlan, openImpact, type PlanItem, type PlanStatus } from '../../state/plan';
import { fmtCurrency } from '../../semantics/formats';
import { ExportMenu } from '../ExportMenu';
import { TABS, type TabId } from '../../state/view';

const NEXT: Record<PlanStatus, PlanStatus> = { open: 'doing', doing: 'done', done: 'open', dropped: 'open' };
const LABEL: Record<PlanStatus, string> = { open: 'Open', doing: 'In progress', done: 'Done', dropped: 'Dropped' };

export function PlanPanel({ tab }: { tab: TabId }) {
  const items = usePlan((s) => s.items);
  const update = usePlan((s) => s.update);
  const remove = usePlan((s) => s.remove);
  const clearDone = usePlan((s) => s.clearDone);
  const mine = items.filter((i) => i.tab === tab);
  const others = items.filter((i) => i.tab !== tab);
  const live = items.filter((i) => i.status === 'open' || i.status === 'doing');

  const payload = () => ({
    name: 'Atlas action plan',
    columns: ['Tab', 'Priority', 'Title', 'Owner', 'Status', 'Impact INR', 'Rationale', 'Steps', 'Created'],
    rows: items.map((i) => [TABS.find((t) => t.id === i.tab)?.label ?? i.tab, i.priority, i.title, i.owner ?? '', i.status, i.impactINR ?? null, i.rationale, i.steps.join(' | '), new Date(i.createdAt).toISOString()]),
    scopeLine: `${items.length} items · ${fmtCurrency(openImpact(items))} estimated impact open`,
  });

  const row = (i: PlanItem) => (
    <div key={i.id} className={`plan-item s-${i.status} p-${i.priority}`}>
      <button className="plan-status" onClick={() => update(i.id, { status: NEXT[i.status] })} title="Advance status">{LABEL[i.status]}</button>
      <div className="plan-body">
        <b>{i.title}</b>
        <p>{i.rationale}</p>
        {i.steps.length > 0 && <ol>{i.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>}
        <div className="plan-meta">
          <span>{i.priority === 'now' ? 'Do now' : i.priority === 'this-week' ? 'This week' : 'This month'}</span>
          {i.owner && <span>{i.owner}</span>}
          {i.tab !== tab && <span>{TABS.find((t) => t.id === i.tab)?.label}</span>}
          <span>{new Date(i.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
          {typeof i.impactINR === 'number' && <b className="ai-reco-impact">{fmtCurrency(i.impactINR)}</b>}
        </div>
      </div>
      <div className="plan-controls">
        <button className="btn-ghost btn-xs" onClick={() => update(i.id, { status: 'dropped' })} title="Drop">⊘</button>
        <button className="btn-ghost btn-xs" onClick={() => remove(i.id)} aria-label="Delete">×</button>
      </div>
    </div>
  );

  return (
    <div className="ai-briefing-body">
      <div className="plan-head">
        <div>
          <b className="t-heading-s">{live.length} live {live.length === 1 ? 'item' : 'items'}</b>
          <small className="t-label-s faint"> · {fmtCurrency(openImpact(items))} estimated impact across open and in-progress work</small>
        </div>
        <div style={{ flex: 1 }} />
        {items.length > 0 && <ExportMenu payload={payload} label="Export plan" />}
        {items.some((i) => i.status === 'done' || i.status === 'dropped') && <button className="btn btn-xs" onClick={clearDone}>Clear finished</button>}
      </div>
      {!items.length && <p className="t-body-s muted">Nothing yet. Generate a brief, then press <b>Add to plan</b> on any recommendation — plan items survive regeneration and tab changes.</p>}
      {mine.map(row)}
      {others.length > 0 && (
        <>
          <div className="ai-sub-label">From other tabs · {others.length}</div>
          {others.map(row)}
        </>
      )}
    </div>
  );
}
