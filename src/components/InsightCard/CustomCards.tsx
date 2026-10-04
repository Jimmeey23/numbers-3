import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOverlay } from '../../state/overlays';
import { addCard, readCards, removeCard, updateCard, type AgentCard } from '../../api/agent';
import { fmtCurrency } from '../../semantics/formats';
import { useView, type TabId } from '../../state/view';
import { METRIC_LIST } from '../../semantics/metrics';

/** Live subscription to the pushed-card store — updated by both the composer and the agent API. */
export function useCustomCards(tab: TabId) {
  const [cards, setCards] = useState<AgentCard[]>(readCards);
  useEffect(() => {
    const sync = () => setCards(readCards());
    window.addEventListener('atlas:cards', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('atlas:cards', sync); window.removeEventListener('storage', sync); };
  }, []);
  return useMemo(() => cards.filter((c) => c.tab === tab).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt - a.createdAt), [cards, tab]);
}

const SEV = {
  critical: { label: 'Critical', color: 'var(--neg)', wash: 'var(--neg-wash)' },
  attention: { label: 'Attention', color: 'var(--warn)', wash: 'var(--warn-wash)' },
  opportunity: { label: 'Opportunity', color: 'var(--pos)', wash: 'var(--pos-wash)' },
  context: { label: 'Context', color: 'var(--info)', wash: 'var(--info-wash)' },
} as const;

export function CustomCardView({ card }: { card: AgentCard }) {
  const s = SEV[card.severity];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card);
  useOverlay(editing, useCallback(() => setEditing(false), []));
  useEffect(() => setDraft(card), [card]);
  if (editing) {
    return (
      <article className="surface" style={{ padding: 12, borderLeft: `2px solid ${s.color}`, display: 'grid', gap: 7 }}>
        <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="What did you notice?" aria-label="Title" />
        <textarea className="input" style={{ height: 58, padding: 8, resize: 'vertical' }} value={draft.body ?? ''} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="The evidence" aria-label="Body" />
        <input className="input" value={draft.action ?? ''} onChange={(e) => setDraft({ ...draft, action: e.target.value })} placeholder="What to do about it" aria-label="Action" />
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="input t-label-m" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value as AgentCard['severity'] })} aria-label="Severity">
            {Object.entries(SEV).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input className="input" type="number" style={{ width: 110 }} value={draft.impactINR ?? ''} onChange={(e) => setDraft({ ...draft, impactINR: e.target.value ? +e.target.value : undefined })} placeholder="₹ impact" aria-label="Impact" />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-primary btn-xs" onClick={() => { updateCard(card.id, draft); setEditing(false); }}>Save</button>
          <button className="btn btn-xs" onClick={() => { setDraft(card); setEditing(false); }}>Cancel</button>
        </div>
      </article>
    );
  }
  return (
    <article className="surface" style={{ padding: '12px 14px', borderLeft: `2px solid ${s.color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="t-label-s pill" style={{ background: s.wash, color: s.color, padding: '1px 8px' }}>{s.label}</span>
        <span className="status-pill t-label-s" style={{ color: 'var(--text-3)' }}>
          {card.source.startsWith('openai:') ? 'OpenAI · saved' : card.source === 'agent' ? 'From an agent' : 'Yours'}
        </span>
        {card.impactINR ? <span className="t-label-s muted tabular">{fmtCurrency(card.impactINR)}</span> : null}
        <div style={{ flex: 1 }} />
        <button className="btn-ghost t-label-s" title={card.pinned ? 'Unpin' : 'Pin to the top'} onClick={() => updateCard(card.id, { pinned: !card.pinned })}>{card.pinned ? '★' : '☆'}</button>
        <button className="btn-ghost t-label-s" title="Edit" onClick={() => setEditing(true)}>✎</button>
        <button className="btn-ghost t-label-s" title="Delete" onClick={() => removeCard(card.id)}>×</button>
      </div>
      <div className="t-heading-s" style={{ marginTop: 6 }}>{card.title}</div>
      {card.body && <p className="t-body-s muted" style={{ margin: '4px 0 0' }}>{card.body}</p>}
      {card.action && <p className="t-body-s" style={{ margin: '4px 0 0' }}>{card.action}</p>}
      {card.entity && <div className="t-label-s faint" style={{ marginTop: 4 }}>{card.entity}</div>}
    </article>
  );
}

/** Composer: write an insight by hand, optionally anchored to a metric. Persists locally. */
export function CardComposer({ tab }: { tab: TabId }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [action, setAction] = useState('');
  const [severity, setSeverity] = useState<AgentCard['severity']>('attention');
  const [impact, setImpact] = useState('');
  const [metricId, setMetricId] = useState('');
  useOverlay(open, useCallback(() => setOpen(false), []));
  const announce = useView((s) => s.announce);
  const submit = () => {
    if (!title.trim()) return;
    addCard({ tab, title: title.trim(), body: body.trim() || undefined, action: action.trim() || undefined, severity,
      impactINR: impact ? +impact : undefined, metricId: metricId || undefined, source: 'manual' });
    setTitle(''); setBody(''); setAction(''); setImpact(''); setMetricId(''); setOpen(false);
    announce('Insight saved to this tab');
  };
  if (!open) return <button className="btn btn-xs" style={{ width: '100%' }} onClick={() => setOpen(true)}>+ Add an insight</button>;
  return (
    <div className="surface" style={{ padding: 12, display: 'grid', gap: 7 }}>
      <div className="t-heading-s">New insight on this tab</div>
      <input autoFocus className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What did you notice?" aria-label="Title"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }} />
      <textarea className="input" style={{ height: 56, padding: 8, resize: 'vertical' }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The evidence — numbers, dates, who it affects" aria-label="Body" />
      <input className="input" value={action} onChange={(e) => setAction(e.target.value)} placeholder="What to do about it" aria-label="Action" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select className="input t-label-m" value={severity} onChange={(e) => setSeverity(e.target.value as AgentCard['severity'])} aria-label="Severity">
          {Object.entries(SEV).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input className="input" type="number" style={{ width: 104 }} value={impact} onChange={(e) => setImpact(e.target.value)} placeholder="₹ impact" aria-label="Impact in rupees" />
      </div>
      <select className="input t-label-m" value={metricId} onChange={(e) => setMetricId(e.target.value)} aria-label="Anchor to a metric">
        <option value="">Not anchored to a metric</option>
        {METRIC_LIST.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-primary btn-xs" onClick={submit} disabled={!title.trim()}>Save insight</button>
        <button className="btn btn-xs" onClick={() => setOpen(false)}>Cancel</button>
        <div style={{ flex: 1 }} />
        <span className="t-label-s faint">Persists on this device</span>
      </div>
    </div>
  );
}
