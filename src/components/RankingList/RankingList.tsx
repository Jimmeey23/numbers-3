import { useMemo, useState } from 'react';
import { metric, type QueryContext } from '../../semantics/metrics';
import { metricValues, type RollupNode } from '../../semantics/aggregations';
import { formatValue } from '../../semantics/formats';
import { useFlip } from '../hooks';
import { useDrill } from '../../state/drill';
import type { TableName } from '../../semantics/metrics';

interface Props { title: string; nodes: RollupNode[]; compareNodes?: RollupNode[]; metricOptions: string[]; ctx: QueryContext; count?: number; minSample?: number; table: TableName; domain: string; sampleLabel?: string }

/** Top and bottom lists side by side on a shared scale, with min-sample guard and rank-change chevrons. */
export function RankingList({ title, nodes, compareNodes, metricOptions, ctx, count = 10, minSample, table, domain, sampleLabel = 'rows' }: Props) {
  const [mid, setMid] = useState(metricOptions[0]);
  const def = metric(mid);
  const open = useDrill((s) => s.open);
  const minN = minSample ?? def.minSample;
  const { eligible, excluded } = useMemo(() => {
    const val = (n: RollupNode) => n.values[mid]?.value ?? metricValues(n.rows, [mid], ctx)[mid].value;
    const withV = nodes.map((n) => ({ n, v: val(n) })).filter((x) => x.v !== null) as { n: RollupNode; v: number }[];
    const eligible = withV.filter((x) => x.n.rows.length >= minN);
    return { eligible, excluded: withV.length - eligible.length };
  }, [nodes, mid, ctx, minN]);
  const sorted = [...eligible].sort((a, b) => (def.higherIsBetter ? b.v - a.v : a.v - b.v));
  const top = sorted.slice(0, count); const bottom = sorted.slice(-count).reverse();
  const prevRank = useMemo(() => {
    if (!compareNodes) return null;
    const m = new Map<string, number>();
    const withV = compareNodes.map((n) => ({ n, v: n.values[mid]?.value ?? metricValues(n.rows, [mid], ctx)[mid].value })).filter((x) => x.v !== null && x.n.rows.length >= minN) as { n: RollupNode; v: number }[];
    withV.sort((a, b) => (def.higherIsBetter ? b.v - a.v : a.v - b.v)).forEach((x, i) => m.set(x.n.key, i + 1));
    return m;
  }, [compareNodes, mid, ctx, minN, def.higherIsBetter]);
  const max = Math.max(1e-9, ...sorted.map((x) => Math.abs(x.v)));
  const flipA = useFlip<HTMLDivElement>(mid); const flipB = useFlip<HTMLDivElement>(mid + 'b');
  const drill = (n: RollupNode) => open({ title: n.label, breadcrumb: [title, n.label], table, rows: n.rows, peerRows: nodes.flatMap((x) => x.rows), peers: nodes.map((x) => ({ label: x.label, rows: x.rows })), metricIds: metricOptions, domain });
  const renderList = (items: { n: RollupNode; v: number }[], ref: React.RefObject<HTMLDivElement | null>, kind: 'top' | 'bottom') => (
    <div ref={ref} style={{ display: 'grid', gap: 3 }}>
      {items.map((x, i) => {
        const overall = sorted.findIndex((s) => s.n.id === x.n.id) + 1; const pr = prevRank?.get(x.n.key); const ch = pr ? pr - overall : null;
        return (
          <div key={x.n.id} data-key={x.n.id} role="button" tabIndex={0} onClick={() => drill(x.n)} onKeyDown={(e) => { if (e.key === 'Enter') drill(x.n); }}
            style={{ display: 'grid', gridTemplateColumns: '22px 1fr 36px 90px', gap: 8, alignItems: 'center', height: 26, cursor: 'pointer', padding: '0 4px' }} className="rank-row">
            <span className={`medal ${kind === 'top' && i < 3 ? 'top' : ''}`}>{overall}</span>
            <div style={{ position: 'relative', height: 16, background: 'var(--surface-inset)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${(Math.abs(x.v) / max) * 100}%`, background: kind === 'top' ? 'var(--hue)' : 'var(--neg)', opacity: 0.35, transformOrigin: 'left', animation: `growX var(--m-data) var(--ease-data) ${Math.min(i, 10) * 28}ms both` }} />
              <span className="t-label-m" style={{ position: 'absolute', left: 6, top: 0, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '95%' }} title={x.n.label}>{x.n.label} <span className="faint">{x.n.rows.length} {sampleLabel}</span></span>
            </div>
            <span className={`t-label-s ${ch === null ? 'faint' : ch > 0 ? 'pos' : ch < 0 ? 'neg' : 'muted'}`}>{ch === null ? '' : ch > 0 ? `▲${ch}` : ch < 0 ? `▼${-ch}` : '▬'}</span>
            <span className="t-num" style={{ textAlign: 'right' }}>{formatValue(def.format, x.v)}</span>
          </div>
        );
      })}
      {!items.length && <div className="muted t-body-s">Nothing meets the minimum sample.</div>}
    </div>
  );
  return (
    <div data-domain={domain}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="t-heading-m">{title}</span>
        <div style={{ flex: 1 }} />
        <select className="input t-label-m" value={mid} onChange={(e) => setMid(e.target.value)} aria-label="Ranking metric">{metricOptions.map((m) => <option key={m} value={m}>{metric(m).label}</option>)}</select>
      </div>
      <div className="two-up" style={{ gap: 20 }}>
        <div><div className="t-heading-xs muted" style={{ marginBottom: 6 }}>Strongest</div>{renderList(top, flipA, 'top')}</div>
        <div><div className="t-heading-xs muted" style={{ marginBottom: 6 }}>Weakest</div>{renderList(bottom, flipB, 'bottom')}</div>
      </div>
      <div className="t-label-s faint" style={{ marginTop: 8 }}>Shared scale. {excluded > 0 ? `${excluded} excluded below the minimum sample of ${minN} ${sampleLabel}.` : `Minimum sample ${minN} ${sampleLabel}.`}{prevRank ? ' Chevrons show rank change vs the comparison period.' : ''}</div>
      <style>{`.rank-row:hover{background:var(--surface-3)} .rank-row:hover .medal{border-color:var(--hue)}`}</style>
    </div>
  );
}
