import { useMemo, useState } from 'react';
import { metric, type QueryContext } from '../../semantics/metrics';
import { metricValues, type RollupNode } from '../../semantics/aggregations';
import { formatValue } from '../../semantics/formats';
import { useFlip } from '../hooks';
import { useDrill } from '../../state/drill';
import { ExportMenu } from '../ExportMenu';
import type { TableName } from '../../semantics/metrics';

interface Props {
  title: string; nodes: RollupNode[]; compareNodes?: RollupNode[]; metricOptions: string[]; ctx: QueryContext;
  count?: number; minSample?: number; table: TableName; domain: string; sampleLabel?: string;
}

const COUNTS = [5, 10, 20];

/** Top and bottom lists on one shared scale.
 *
 *  The list is a control surface, not a printout: the metric, the depth and a name filter are all
 *  live, every row drills into the records behind it, and whatever is on screen can be exported in
 *  the state it is being read in. Strongest and weakest always sit side by side — a ranking only
 *  means something against its opposite end, so neither column can be dismissed. */
export function RankingList({ title, nodes, compareNodes, metricOptions, ctx, count = 10, minSample, table, domain, sampleLabel = 'rows' }: Props) {
  const [mid, setMid] = useState(metricOptions[0]);
  const [n, setN] = useState(count);
  const [q, setQ] = useState('');
  const def = metric(mid);
  const open = useDrill((s) => s.open);
  const minN = minSample ?? def.minSample;

  const { eligible, excluded } = useMemo(() => {
    const val = (node: RollupNode) => node.values[mid]?.value ?? metricValues(node.rows, [mid], ctx)[mid].value;
    const withV = nodes.map((node) => ({ n: node, v: val(node) })).filter((x) => x.v !== null) as { n: RollupNode; v: number }[];
    return { eligible: withV.filter((x) => x.n.rows.length >= minN), excluded: withV.length - withV.filter((x) => x.n.rows.length >= minN).length };
  }, [nodes, mid, ctx, minN]);

  const sorted = useMemo(() => [...eligible].sort((a, b) => (def.higherIsBetter ? b.v - a.v : a.v - b.v)), [eligible, def.higherIsBetter]);
  const needle = q.trim().toLowerCase();
  const match = (x: { n: RollupNode }) => !needle || x.n.label.toLowerCase().includes(needle);
  const top = sorted.filter(match).slice(0, n);
  const bottom = sorted.filter(match).slice(-n).reverse();

  const prevRank = useMemo(() => {
    if (!compareNodes) return null;
    const m = new Map<string, number>();
    const withV = compareNodes.map((node) => ({ n: node, v: node.values[mid]?.value ?? metricValues(node.rows, [mid], ctx)[mid].value })).filter((x) => x.v !== null && x.n.rows.length >= minN) as { n: RollupNode; v: number }[];
    withV.sort((a, b) => (def.higherIsBetter ? b.v - a.v : a.v - b.v)).forEach((x, i) => m.set(x.n.key, i + 1));
    return m;
  }, [compareNodes, mid, ctx, minN, def.higherIsBetter]);

  const max = Math.max(1e-9, ...sorted.map((x) => Math.abs(x.v)));
  const flipA = useFlip<HTMLDivElement>(`${mid}${n}${needle}`);
  const flipB = useFlip<HTMLDivElement>(`${mid}${n}${needle}b`);
  const drill = (node: RollupNode) => open({ title: node.label, breadcrumb: [title, node.label], table, rows: node.rows, peerRows: nodes.flatMap((x) => x.rows), peers: nodes.map((x) => ({ label: x.label, rows: x.rows })), metricIds: metricOptions, domain });

  const payload = () => ({
    name: `${title} ${def.label}`,
    columns: ['Rank', 'Name', def.label, `${sampleLabel} in scope`, 'Rank change'],
    rows: sorted.map((x, i) => [i + 1, x.n.label, x.v, x.n.rows.length, prevRank?.get(x.n.key) ? (prevRank.get(x.n.key)! - (i + 1)) : null] as (string | number | null)[]),
    scopeLine: `${def.label} · minimum sample ${minN} ${sampleLabel}`,
  });

  const renderList = (items: { n: RollupNode; v: number }[], ref: React.RefObject<HTMLDivElement | null>, kind: 'top' | 'bottom') => (
    <div ref={ref} className="rank-list">
      {items.map((x, i) => {
        const overall = sorted.findIndex((s) => s.n.id === x.n.id) + 1;
        const pr = prevRank?.get(x.n.key);
        const ch = pr ? pr - overall : null;
        const pct = (Math.abs(x.v) / max) * 100;
        return (
          <div key={x.n.id} data-key={x.n.id} role="button" tabIndex={0}
            onClick={() => drill(x.n)} onKeyDown={(e) => { if (e.key === 'Enter') drill(x.n); }}
            className={`rank-row is-${kind}`} style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}>
            <span className={`rank-medal ${kind === 'top' && overall <= 3 ? 'is-podium' : ''}`}>{overall}</span>
            <span className="rank-name" title={x.n.label}>
              {x.n.label}
              <span className="rank-sample">{x.n.rows.length.toLocaleString('en-IN')} {sampleLabel}</span>
            </span>
            <span className="rank-track">
              <span className="rank-fill" style={{ width: `${pct}%`, animationDelay: `${Math.min(i, 10) * 28}ms` }} />
            </span>
            {ch !== null && <span className={`rank-change ${ch > 0 ? 'pos' : ch < 0 ? 'neg' : 'flat'}`} title={`Was #${pr} in the comparison period`}>{ch > 0 ? `▲${ch}` : ch < 0 ? `▼${-ch}` : '▬'}</span>}
            <span className="rank-value t-num">{formatValue(def.format, x.v)}</span>
            <span className="rank-go" aria-hidden="true">→</span>
          </div>
        );
      })}
      {!items.length && <div className="rank-empty t-body-s muted">{needle ? `Nothing matches “${q}”.` : 'Nothing meets the minimum sample.'}</div>}
    </div>
  );

  return (
    <div className="ranking" data-domain={domain}>
      <div className="ranking-head">
        <div className="ranking-title">
          <span className="t-heading-m">{title}</span>
          <select className="ranking-metric" value={mid} onChange={(e) => setMid(e.target.value)} aria-label="Ranking metric">
            {metricOptions.map((m) => <option key={m} value={m}>{metric(m).label}</option>)}
          </select>
        </div>
        <div className="ranking-controls">
          <div className="segment ranking-count" role="group" aria-label="How many to show">
            {COUNTS.map((c) => (
              <button key={c} className={n === c ? 'active' : ''} aria-pressed={n === c} onClick={() => setN(c)}>{c}</button>
            ))}
          </div>
          <input className="input ranking-search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name" aria-label={`Filter ${title} by name`} />
          <ExportMenu payload={payload} label="Export" />
        </div>
      </div>

      <div className="ranking-body">
        <div className="ranking-col">
          <div className="ranking-col-head"><span className="ranking-col-mark is-top" aria-hidden="true" />Strongest{def.higherIsBetter ? '' : ' (lowest is best)'}</div>
          {renderList(top, flipA, 'top')}
        </div>
        <div className="ranking-col">
          <div className="ranking-col-head"><span className="ranking-col-mark is-bottom" aria-hidden="true" />Weakest</div>
          {renderList(bottom, flipB, 'bottom')}
        </div>
      </div>

      <div className="ranking-foot t-label-s faint">
        Shared scale across both columns. {excluded > 0 ? `${excluded} excluded below the minimum sample of ${minN} ${sampleLabel}.` : `Minimum sample ${minN} ${sampleLabel}.`}
        {prevRank ? ' Chevrons show rank change against the comparison period.' : ''} Click any row for the records behind it.
      </div>
    </div>
  );
}
