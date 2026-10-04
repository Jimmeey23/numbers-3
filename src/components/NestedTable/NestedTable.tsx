import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { GROUP_KEYS, metricValues, rollupLevel, type RollupNode, type Row } from '../../semantics/aggregations';
import { metric, type QueryContext, type TableName } from '../../semantics/metrics';
import { fmtDelta, formatValue, type Fmt } from '../../semantics/formats';
import { diverging, needsInvert } from '../../design/ramps';
import { useView } from '../../state/view';
import { useDrill } from '../../state/drill';
import { csvEscape, downloadText, useCountUp, useFlip } from '../hooks';
import { Sparkline } from '../MetricCard/MetricCard';
import { TipBody, useTooltip } from '../Tooltip/Tooltip';
import { maxBy, maxOf } from '../../semantics/stats';

export interface ColumnDef {
  id: string; metricId?: string; label?: string; family?: 'Volume' | 'Utilisation' | 'Revenue' | 'Behaviour' | 'Score';
  heat?: boolean; bar?: boolean; threshold?: (ctx: QueryContext) => number | null;
  spark?: (rows: Row[]) => (number | null)[]; mix?: (rows: Row[]) => { label: string; value: number; color: string }[]; dist?: (rows: Row[]) => number[];
  render?: (node: RollupNode, ctx: QueryContext) => ReactNode; value?: (node: RollupNode, ctx: QueryContext) => number | null; format?: Fmt; hidden?: boolean; width?: number; higherIsBetter?: boolean;
}

export interface NestedTableProps {
  title: string; rows: Row[]; compareRows?: Row[]; table: TableName; groupKeys: string[]; availableKeys?: string[]; columns: ColumnDef[]; ctx: QueryContext; domain: string;
  defaultSort?: { id: string; dir: 'asc' | 'desc' }; maxHeight?: number; rankBy?: string; filtersLabel: string; leafLabel?: string; onGroupKeysChange?: (k: string[]) => void;
}

const colFmt = (c: ColumnDef): Fmt => c.format ?? (c.metricId ? metric(c.metricId).format : 'integer');
const colLabel = (c: ColumnDef) => c.label ?? (c.metricId ? metric(c.metricId).label : c.id);
const nodeVal = (n: RollupNode, c: ColumnDef, ctx: QueryContext): number | null => (c.value ? c.value(n, ctx) : c.metricId ? n.values[c.metricId]?.value ?? null : null);

function Num({ v, fmt, full }: { v: number | null; fmt: Fmt; full?: boolean }) {
  const a = useCountUp(v);
  return <span>{formatValue(fmt, a, { full })}</span>;
}

export function NestedTable(p: NestedTableProps) {
  const theme = useView((s) => s.theme);
  const comparison = useView((s) => s.comparison);
  const openDrill = useDrill((s) => s.open);
  const [keys, setKeys] = useState(p.groupKeys);
  useEffect(() => setKeys(p.groupKeys), [p.groupKeys]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(p.defaultSort ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set(p.columns.filter((c) => c.hidden).map((c) => c.id)));
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [compressed, setCompressed] = useState(false);
  const [scrolledX, setScrolledX] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const metricIds = useMemo(() => Array.from(new Set(p.columns.map((c) => c.metricId).filter((x): x is string => !!x))), [p.columns]);
  const columns = p.columns.filter((c) => !hidden.has(c.id));

  const rows = useMemo(() => {
    if (!query.trim()) return p.rows;
    const q = query.toLowerCase();
    const accs = keys.map((k) => GROUP_KEYS[k].accessor);
    return p.rows.filter((r) => accs.some((a) => (a(r) ?? '').toLowerCase().includes(q)));
  }, [p.rows, query, keys]);

  // lazy child cache
  const childCache = useRef(new Map<string, RollupNode[]>());
  const sig = useMemo(() => `${rows.length}|${keys.join(',')}|${metricIds.join(',')}|${p.ctx.ratePerSession}|${p.rows === rows ? 'a' : query}`, [rows, keys, metricIds, p.ctx.ratePerSession, p.rows, query]);
  useEffect(() => { childCache.current.clear(); }, [sig]);

  const root = useMemo(() => rollupLevel(rows, keys, 0, metricIds, p.ctx), [rows, keys, metricIds, p.ctx]);
  const totalsV = useMemo(() => metricValues(rows, metricIds, p.ctx), [rows, metricIds, p.ctx]);
  const totalNode: RollupNode = useMemo(() => ({ id: '__total', key: 'Total', keyId: '', label: 'Total', level: -1, rows, values: totalsV, path: [] }), [rows, totalsV]);

  const childrenOf = useCallback((n: RollupNode): RollupNode[] => {
    if (n.level + 1 >= keys.length) return [];
    let c = childCache.current.get(n.id);
    if (!c) { c = rollupLevel(n.rows, keys, n.level + 1, metricIds, p.ctx, n.path); childCache.current.set(n.id, c); }
    return c;
  }, [keys, metricIds, p.ctx]);

  const sortNodes = useCallback((ns: RollupNode[]) => {
    if (!sort) return ns;
    const c = p.columns.find((x) => x.id === sort.id); if (!c) return ns;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...ns].sort((a, b) => { const va = nodeVal(a, c, p.ctx); const vb = nodeVal(b, c, p.ctx); if (va === null && vb === null) return 0; if (va === null) return 1; if (vb === null) return -1; return (va - vb) * dir; });
  }, [sort, p.columns, p.ctx]);

  const flat = useMemo(() => {
    const out: RollupNode[] = [];
    const walk = (ns: RollupNode[]) => { for (const n of sortNodes(ns)) { out.push(n); if (expanded.has(n.id)) walk(childrenOf(n)); } };
    walk(root);
    return out;
  }, [root, expanded, sortNodes, childrenOf]);

  // comparison values per node
  const compareVals = useMemo(() => {
    if (!comparison || !p.compareRows) return null;
    const m = new Map<string, Record<string, { value: number | null }>>();
    const accs = keys.map((k) => GROUP_KEYS[k].accessor);
    for (const n of flat) {
      const rs = p.compareRows.filter((r) => n.path.every((k, i) => (accs[i](r) ?? '(none)') === k));
      m.set(n.id, metricValues(rs, metricIds, p.ctx));
    }
    m.set('__total', metricValues(p.compareRows, metricIds, p.ctx));
    return m;
  }, [comparison, p.compareRows, flat, keys, metricIds, p.ctx]);

  // heat scales: deviation from the total per column
  const heat = useMemo(() => {
    const m = new Map<string, { center: number; span: number }>();
    for (const c of columns) {
      if (!c.heat && !c.bar) continue;
      const vals = flat.map((n) => nodeVal(n, c, p.ctx)).filter((v): v is number => v !== null);
      if (!vals.length) continue;
      const center = nodeVal(totalNode, c, p.ctx) ?? vals.reduce((a, b) => a + b, 0) / vals.length;
      const span = maxBy(vals, (v) => Math.abs(v - center), 0) || 1;
      m.set(c.id, { center, span: c.bar ? maxOf(vals, 0) || 1 : span });
    }
    return m;
  }, [columns, flat, p.ctx, totalNode]);

  const rankMap = useMemo(() => {
    if (!p.rankBy) return null; const c = p.columns.find((x) => x.id === p.rankBy); if (!c) return null;
    const m = new Map<string, number>();
    const l0 = [...root].sort((a, b) => ((nodeVal(b, c, p.ctx) ?? -Infinity) - (nodeVal(a, c, p.ctx) ?? -Infinity)) * ((c.higherIsBetter ?? (c.metricId ? metric(c.metricId).higherIsBetter : true)) ? 1 : -1));
    l0.forEach((n, i) => m.set(n.id, i + 1));
    return m;
  }, [p.rankBy, p.columns, root, p.ctx]);

  const toggle = (n: RollupNode, whole = false) => {
    setExpanded((s) => {
      const next = new Set(s);
      const targets = whole ? flat.filter((x) => x.level === n.level) : [n];
      const opening = !next.has(n.id);
      for (const t of targets) { if (opening) next.add(t.id); else next.delete(t.id); }
      return next;
    });
  };
  const cycleSort = (id: string) => setSort((s) => (!s || s.id !== id ? { id, dir: 'desc' } : s.dir === 'desc' ? { id, dir: 'asc' } : null));

  const drill = (n: RollupNode, el?: HTMLElement | null) => {
    const siblings = n.level === 0 ? root : childrenOf(flat.find((x) => x.id === n.path.slice(0, -1).join('›')) ?? totalNode);
    openDrill({ title: n.label, breadcrumb: [p.title, ...n.path.map((k, i) => GROUP_KEYS[keys[i]].display?.(k) ?? k)], table: p.table, rows: n.rows, peerRows: rows, peers: siblings.map((s) => ({ label: s.label, rows: s.rows })), metricIds, domain: p.domain, sourceEl: el ?? null });
  };

  const exportCsv = () => {
    const head = ['Level', ...keys.map((k) => GROUP_KEYS[k].label), ...columns.filter((c) => !c.mix && !c.spark && !c.dist).map(colLabel)];
    const lines = [`# ${p.title} — filters: ${p.filtersLabel}`, head.map(csvEscape).join(',')];
    for (const n of flat) lines.push([n.level, ...keys.map((_, i) => n.path[i] ?? ''), ...columns.filter((c) => !c.mix && !c.spark && !c.dist).map((c) => { const v = nodeVal(n, c, p.ctx); return v === null ? '' : colFmt(c) === 'percent' ? (v * 100).toFixed(2) : v; })].map(csvEscape).join(','));
    lines.push(['Total', ...keys.map(() => ''), ...columns.filter((c) => !c.mix && !c.spark && !c.dist).map((c) => { const v = nodeVal(totalNode, c, p.ctx); return v === null ? '' : v; })].map(csvEscape).join(','));
    downloadText(`${p.title.replace(/\s+/g, '-').toLowerCase()}.csv`, lines.join('\n'));
  };

  // windowing
  const rowH = useMemo(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--row-h')) || 34, []);
  const maxH = p.maxHeight ?? 560;
  const virtual = flat.length > 120;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / rowH) - 8) : 0;
  const end = virtual ? Math.min(flat.length, Math.ceil((scrollTop + maxH) / rowH) + 8) : flat.length;
  const slice = flat.slice(start, end);
  const flipRef = useFlip<HTMLTableSectionElement>(`${sort?.id}-${sort?.dir}-${keys.join()}`);

  const onKey = (e: React.KeyboardEvent<HTMLTableRowElement>, n: RollupNode, i: number) => {
    const rowsEls = scroller.current?.querySelectorAll<HTMLTableRowElement>('tbody tr[data-key]');
    const focusRow = (j: number) => rowsEls?.[j]?.focus();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusRow(i + 1); break;
      case 'ArrowUp': e.preventDefault(); focusRow(i - 1); break;
      case 'ArrowRight': e.preventDefault(); if (!expanded.has(n.id) && n.level + 1 < keys.length) toggle(n, e.altKey); break;
      case 'ArrowLeft': e.preventDefault(); if (expanded.has(n.id)) toggle(n, e.altKey); break;
      case 'Enter': e.preventDefault(); drill(n, e.currentTarget); break;
      case ' ': e.preventDefault(); setSelected((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; }); break;
      case '/': e.preventDefault(); searchRef.current?.focus(); break;
    }
  };

  const selectedNode: RollupNode | null = useMemo(() => {
    if (!selected.size) return null;
    const rs = flat.filter((n) => selected.has(n.id)).flatMap((n) => n.rows);
    return { id: '__sel', key: 'Selected', keyId: '', label: `${selected.size} selected`, level: -1, rows: rs, values: metricValues(rs, metricIds, p.ctx), path: [] };
  }, [selected, flat, metricIds, p.ctx]);
  const footNode = selectedNode ?? totalNode;

  const families = ['Volume', 'Utilisation', 'Revenue', 'Behaviour', 'Score'] as const;
  const available = p.availableKeys ?? Object.keys(GROUP_KEYS);

  return (
    <div data-domain={p.domain} className="nested-table">
      <div className="nested-table-mobile inset t-body-s muted" style={{ display: 'none', padding: 16 }}>The {p.title} drill-down table needs a larger screen. KPIs, charts, rankings and insights stay available here.</div>
      {/* toolbar */}
      <div className="tbl-toolbar">
        <span className="t-label-s faint">Group by</span>
        <div className="groupby" role="list" aria-label="Grouping order — drag to reorder">
          {keys.map((k, i) => (
            <div key={k} role="listitem" draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (drag === null || drag === i) return; const next = [...keys]; const [m] = next.splice(drag, 1); next.splice(i, 0, m); setKeys(next); setExpanded(new Set()); p.onGroupKeysChange?.(next); setDrag(null); }}
              className="groupby-chip" style={{ opacity: drag === i ? 0.45 : 1 }}>
              <span className="groupby-step">{i + 1}</span>
              <select value={k} aria-label={`Level ${i + 1} grouping`}
                onChange={(e) => { const next = [...keys]; next[i] = e.target.value; setKeys(next); setExpanded(new Set()); p.onGroupKeysChange?.(next); }}>
                {available.filter((a) => a === k || !keys.includes(a)).map((a) => <option key={a} value={a}>{GROUP_KEYS[a].label}</option>)}
              </select>
              {i > 0 && <button aria-label="Move earlier" onClick={() => { const next = [...keys]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; setKeys(next); setExpanded(new Set()); p.onGroupKeysChange?.(next); }}>‹</button>}
              {i < keys.length - 1 && <button aria-label="Move later" onClick={() => { const next = [...keys]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; setKeys(next); setExpanded(new Set()); p.onGroupKeysChange?.(next); }}>›</button>}
              {keys.length > 1 && <button aria-label="Remove level" onClick={() => { const next = keys.filter((_, j) => j !== i); setKeys(next); setExpanded(new Set()); p.onGroupKeysChange?.(next); }}>×</button>}
            </div>
          ))}
          {keys.length < 4 && available.some((a) => !keys.includes(a)) && (
            <select className="btn btn-xs t-label-s" value="" aria-label="Add grouping level" onChange={(e) => { if (!e.target.value) return; const next = [...keys, e.target.value]; setKeys(next); p.onGroupKeysChange?.(next); }}>
              <option value="">+ level</option>
              {available.filter((a) => !keys.includes(a)).map((a) => <option key={a} value={a}>{GROUP_KEYS[a].label}</option>)}
            </select>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <input ref={searchRef} className="input t-label-m" placeholder="Search rows  /" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 180 }} aria-label="Search rows" />
        <button className="btn btn-xs" onClick={() => setExpanded(new Set(flat.filter((n) => n.level < keys.length - 1).map((n) => n.id).concat(root.map((n) => n.id))))}>Expand all</button>
        <button className="btn btn-xs" onClick={() => setExpanded(new Set())}>Collapse</button>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-xs" aria-expanded={picker} onClick={() => setPicker((o) => !o)}>Columns</button>
          {picker && (
            <div className="surface chrome" style={{ position: 'absolute', right: 0, top: 26, zIndex: 30, width: 280, padding: 10, maxHeight: 360, overflow: 'auto' }}>
              {families.map((f) => { const cs = p.columns.filter((c) => (c.family ?? 'Volume') === f); return cs.length ? (
                <div key={f} style={{ marginBottom: 8 }}>
                  <div className="t-heading-xs muted" style={{ marginBottom: 4 }}>{f}</div>
                  {cs.map((c) => <label key={c.id} className="t-label-m" style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}><input type="checkbox" checked={!hidden.has(c.id)} onChange={() => setHidden((h) => { const x = new Set(h); if (x.has(c.id)) x.delete(c.id); else x.add(c.id); return x; })} />{colLabel(c)}</label>)}
                </div>) : null; })}
              <button className="btn btn-xs" onClick={() => setHidden(new Set(p.columns.filter((c) => c.hidden).map((c) => c.id)))}>Reset</button>
            </div>
          )}
        </div>
        <button className="btn btn-xs" onClick={exportCsv}>Export CSV</button>
      </div>

      {/* table */}
      <div ref={scroller} className="table-scroll" style={{ maxHeight: maxH, position: 'relative' }}
        onScroll={(e) => { const t = e.currentTarget; setCompressed(t.scrollTop > 40); setScrolledX(t.scrollLeft > 0); if (virtual) setScrollTop(t.scrollTop); }}>
        <table className={`tbl ${compressed ? 'compressed' : ''} ${scrolledX ? 'scrolled-x' : ''}`} role="grid" aria-rowcount={flat.length}>
          <thead>
            <tr>
              <th className="pin-l t-heading-s" style={{ minWidth: 268, width: widths.__label }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" aria-label="Select all visible" checked={selected.size > 0 && selected.size === flat.length} onChange={(e) => setSelected(e.target.checked ? new Set(flat.map((n) => n.id)) : new Set())} />
                  {keys.map((k) => GROUP_KEYS[k].label).join(' › ')}
                </span>
              </th>
              {columns.map((c) => {
                const active = sort?.id === c.id;
                return (
                  <th key={c.id} className={`t-heading-s ${active ? 'sorted' : ''} ${c.mix || c.spark || c.dist ? '' : 'sortable'}`} style={{ width: widths[c.id] ?? c.width, position: 'sticky' }} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => { if (!(c.render && !c.value) && !c.mix && !c.spark && !c.dist) cycleSort(c.id); }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{colLabel(c)}{active && <span className={`caret ${sort!.dir === 'desc' ? 'desc' : ''}`} style={{ fontSize: 9 }}>▲</span>}</span>
                    <span onMouseDown={(e) => { e.stopPropagation(); const sx = e.clientX; const th = e.currentTarget.parentElement!; const w0 = th.offsetWidth; const guide = document.createElement('div'); guide.style.cssText = `position:fixed;top:0;bottom:0;width:2px;background:var(--hue);left:${sx}px;z-index:999;pointer-events:none`; document.body.appendChild(guide); const mv = (ev: MouseEvent) => { guide.style.left = `${ev.clientX}px`; }; const up = (ev: MouseEvent) => { setWidths((w) => ({ ...w, [c.id]: Math.max(60, w0 + ev.clientX - sx) })); guide.remove(); window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); }}
                      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize' }} aria-hidden="true" />
                  </th>
                );
              })}
              <th style={{ width: 40 }} aria-label="Row actions" />
            </tr>
          </thead>
          <tbody ref={flipRef}>
            {virtual && start > 0 && <tr aria-hidden="true"><td colSpan={columns.length + 2} style={{ height: start * rowH, padding: 0, border: 0 }} /></tr>}
            {slice.map((n, si) => {
              const i = start + si; const isOpen = expanded.has(n.id); const canOpen = n.level + 1 < keys.length; const leaf = !canOpen;
              return (
                <NodeRow key={n.id} n={n} i={i} isOpen={isOpen} canOpen={canOpen} leaf={leaf} columns={columns} ctx={p.ctx} theme={theme} heat={heat} rank={rankMap?.get(n.id)} selected={selected.has(n.id)}
                  compare={compareVals?.get(n.id) ?? null} toggle={toggle} drill={drill} onKey={onKey} setSelected={setSelected} leafLabel={p.leafLabel} table={p.table} />
              );
            })}
            {virtual && end < flat.length && <tr aria-hidden="true"><td colSpan={columns.length + 2} style={{ height: (flat.length - end) * rowH, padding: 0, border: 0 }} /></tr>}
            {!flat.length && <tr><td colSpan={columns.length + 2} className="muted" style={{ textAlign: 'center', padding: 24 }}>No rows matched these filters.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <td className="pin-l" style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '2px solid var(--hue)' }}>
                {selectedNode ? <><span>{selectedNode.label}</span><button className="btn btn-xs" onClick={() => setSelected(new Set())}>Clear</button></> : 'Total'}
                <span className="t-label-s muted" style={{ fontFamily: 'var(--font-ui)', fontWeight: 400 }}>{footNode.rows.length.toLocaleString('en-IN')} rows</span>
              </td>
              {columns.map((c) => {
                const v = nodeVal(footNode, c, p.ctx); const fmt = colFmt(c);
                const cv = compareVals?.get('__total'); const pv = cv && c.metricId ? cv[c.metricId]?.value ?? null : null;
                return <td key={c.id} className="tabular">{c.render && !c.value ? '' : <><Num v={v} fmt={fmt} full={fmt === 'currency'} />{comparison && pv !== null && <div className="t-label-s muted" style={{ fontWeight: 400 }}>{fmtDelta(fmt, v, pv).text}</div>}</>}</td>;
              })}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="t-label-s faint" style={{ marginTop: 7, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span>{flat.length.toLocaleString('en-IN')} visible of {rows.length.toLocaleString('en-IN')} source rows</span>
        <span>Totals recompute rates from sums, never averaging them</span>
        <span>Alt-click a chevron to open a whole level · Enter opens details</span>
      </div>
    </div>
  );
}

interface RowProps {
  n: RollupNode; i: number; isOpen: boolean; canOpen: boolean; leaf: boolean; columns: ColumnDef[]; ctx: QueryContext; theme: 'matte' | 'gloss'; heat: Map<string, { center: number; span: number }>; rank?: number; selected: boolean;
  compare: Record<string, { value: number | null }> | null; toggle: (n: RollupNode, whole?: boolean) => void; drill: (n: RollupNode, el?: HTMLElement | null) => void; onKey: (e: React.KeyboardEvent<HTMLTableRowElement>, n: RollupNode, i: number) => void;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>; leafLabel?: string; table: TableName;
}

function NodeRow({ n, i, isOpen, canOpen, columns, ctx, theme, heat, rank, selected, compare, toggle, drill, onKey, setSelected }: RowProps) {
  const indent = n.level * 16;
  return (
    <tr data-key={n.id} tabIndex={0} className={`l${n.level} ${selected ? 'selected' : ''}`} aria-level={n.level + 1} aria-expanded={canOpen ? isOpen : undefined} onKeyDown={(e) => onKey(e, n, i)}
      onClick={(e) => { if ((e.target as HTMLElement).closest('button,input')) return; drill(n, e.currentTarget); }} style={{ cursor: 'pointer' }}>
      <td className="pin-l" style={{ paddingLeft: 8 + indent }}>
        <span className="group-label" style={{ fontFamily: 'var(--font-display)', fontWeight: n.level === 0 ? 600 : n.level === 1 ? 550 : 500, fontVariationSettings: '"wdth" 90', fontSize: n.level >= 3 ? 12 : undefined, color: n.level >= 3 ? 'var(--text-2)' : undefined }}>
          <input type="checkbox" checked={selected} aria-label={`Select ${n.label}`} onClick={(e) => e.stopPropagation()} onChange={() => setSelected((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; })} />
          {canOpen ? (
            <button aria-label={isOpen ? 'Collapse' : 'Expand'} onClick={(e) => { e.stopPropagation(); toggle(n, e.altKey); }} style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}><span className={`caret ${isOpen ? 'open' : ''}`}>▸</span></button>
          ) : <span className="faint" style={{ width: 16, textAlign: 'center' }}>·</span>}
          {rank !== undefined && rank <= 3 && <span className="medal top">{rank}</span>}
          <span className="group-name" style={{ maxWidth: 230 }} title={n.label}>{n.label}</span>
          <span className="group-count">{n.rows.length.toLocaleString('en-IN')}</span>
        </span>
      </td>
      {columns.map((c) => <Cell key={c.id} c={c} n={n} ctx={ctx} theme={theme} heat={heat.get(c.id)} prev={compare && c.metricId ? compare[c.metricId]?.value ?? null : null} />)}
      <td style={{ paddingLeft: 2, paddingRight: 6 }}>
        <span className="row-actions">
          <button className="btn-ghost btn-xs" aria-label={`Open details for ${n.label}`} title="Open details" onClick={(e) => { e.stopPropagation(); drill(n, e.currentTarget.closest('tr')); }}>↗</button>
        </span>
      </td>
    </tr>
  );
}

function Cell({ c, n, ctx, theme, heat, prev }: { c: ColumnDef; n: RollupNode; ctx: QueryContext; theme: 'matte' | 'gloss'; heat?: { center: number; span: number }; prev: number | null }) {
  const fmt = colFmt(c);
  const v = nodeVal(n, c, ctx);
  const def = c.metricId ? metric(c.metricId) : null;
  const res = c.metricId ? n.values[c.metricId] : null;
  const low = def && res ? res.n < def.minSample : false;
  const hib = c.higherIsBetter ?? def?.higherIsBetter ?? true;
  const tip = useTooltip(() => (
    <TipBody context={`${n.label} · ${colLabel(c)}`} value={formatValue(fmt, v, { full: fmt === 'currency' })}
      delta={prev !== null ? `${fmtDelta(fmt, v, prev).text} vs comparison` : undefined} deltaClass={prev !== null && v !== null ? ((v >= prev) === hib ? 'pos' : 'neg') : undefined}
      share={heat && v !== null && fmt !== 'percent' && heat.center ? `${((v / (heat.center || 1)) * 100).toFixed(0)}% of total` : undefined}
      n={`n = ${n.rows.length.toLocaleString('en-IN')} rows`} extra={def ? <div className="t-label-s faint" style={{ marginTop: 4 }}>{def.formula}</div> : undefined} />
  ), [v, prev, n.id, c.id]);
  if (c.render) return <td {...tip}>{c.render(n, ctx)}</td>;
  if (c.spark) { const d = c.spark(n.rows); return <td style={{ padding: '2px 8px' }}><span style={{ display: 'inline-block', opacity: 0.62 }}><Sparkline data={d} width={62} height={16} color="var(--text-2)" area={false} animate={false} /></span></td>; }
  if (c.mix) {
    const parts = c.mix(n.rows); const tot = parts.reduce((a, b) => a + b.value, 0) || 1;
    return <td {...tip} style={{ padding: '4px 8px' }} title={parts.map((x) => `${x.label} ${Math.round((x.value / tot) * 100)}%`).join(', ')}><div className="mix-bar">{parts.map((x) => <i key={x.label} style={{ width: `${(x.value / tot) * 100}%`, background: x.color }} />)}</div></td>;
  }
  if (c.dist) {
    const d = c.dist(n.rows); const max = Math.max(1, ...d);
    return <td style={{ padding: '4px 8px' }}><svg width={42} height={14} aria-hidden="true">{d.map((x, i) => <circle key={i} cx={4 + (i / Math.max(1, d.length - 1)) * 34} cy={7} r={1 + (x / max) * 2.2} fill="var(--text-2)" opacity={0.28 + (x / max) * 0.42} />)}</svg></td>;
  }
  let style: React.CSSProperties = {};
  let inner: ReactNode = <span className={low ? 'muted' : ''}>{formatValue(fmt, v, { full: fmt === 'currency' })}{low && v !== null ? <span className="faint" title={`n = ${res?.n}`}> ·</span> : ''}</span>;
  if (c.heat && heat && v !== null) {
    const t = ((v - heat.center) / heat.span) * (hib ? 1 : -1);
    const bg = diverging(theme, t * 0.85);
    style = { background: bg, color: Math.abs(t) > 0.62 && needsInvert(bg, theme) ? 'var(--heat-text-invert)' : undefined };
  }
  if (c.bar && heat && v !== null) {
    const th = c.threshold?.(ctx);
    inner = <div className="cell-bar" style={{ minWidth: 80 }}><div className="bar" style={{ width: '100%', transform: `scaleX(${Math.max(0, Math.min(1, v / heat.span))})` }} />{th !== null && th !== undefined && <div className="tick" style={{ left: `${Math.min(100, (th / heat.span) * 100)}%` }} />}<span className={low ? 'muted' : ''}>{formatValue(fmt, v, { full: fmt === 'currency' })}</span></div>;
  }
  return (
    <td {...tip} className="t-num" style={style}>
      {inner}
      {prev !== null && <div className="t-label-s muted rise" style={{ fontFamily: 'var(--font-ui)' }}>{formatValue(fmt, prev)}</div>}
    </td>
  );
}
