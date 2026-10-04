import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOverlay } from '../../state/overlays';
import type { Scope } from '../../state/data';
import { useView, type TabId } from '../../state/view';
import { METRIC_LIST, metric } from '../../semantics/metrics';
import { GROUP_KEYS } from '../../semantics/aggregations';
import { Register } from '../Register';
import { CustomWidget } from './CustomWidget';
import {
  addWidget, compatibleMetrics, defaultTitle, groupKeysFor, readWidgets, tabForMetric,
  updateWidget, WIDGET_EVENT, WIDGET_KINDS, type WidgetKind, type WidgetSpec,
} from '../../api/widgets';

/** Live subscription to the widget store. */
export function useWidgets(tab: TabId, placement: 'top' | 'bottom') {
  const [all, setAll] = useState<WidgetSpec[]>(readWidgets);
  useEffect(() => {
    const sync = () => setAll(readWidgets());
    window.addEventListener(WIDGET_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(WIDGET_EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  return useMemo(() => all.filter((w) => w.tab === tab && w.placement === placement), [all, tab, placement]);
}

/** Drop this into a tab to host whatever the operator or an agent has built there. */
export function WidgetSection({ tab, scope, placement = 'bottom', inFooter = false }: { tab: TabId; scope: Scope; placement?: 'top' | 'bottom'; inFooter?: boolean }) {
  const widgets = useWidgets(tab, placement);
  const [editing, setEditing] = useState<WidgetSpec | null>(null);
  const [building, setBuilding] = useState(false);
  useOverlay(building, useCallback(() => { setBuilding(false); setEditing(null); }, []));
  if (placement === 'bottom' && !inFooter) return null;
  if (!widgets.length && placement === 'top') return null;
  return (
    <Register title={placement === 'top' ? 'Pinned' : 'Your widgets'} domain="neutral"
      index={placement === 'top' ? 'Pinned' : 'Custom'}
      subtitle={widgets.length
        ? 'Built here or by an agent. Each one recomputes from the current filters — these are live views, not snapshots.'
        : 'Nothing built for this tab yet. Add a table, chart or metric card and it stays here across reloads.'}
      actions={<button className="btn btn-xs" onClick={() => { setEditing(null); setBuilding(true); }}>+ Build a widget</button>}>
      {widgets.length > 0 && (
        <div className="widget-grid">
          {widgets.map((w) => <CustomWidget key={w.id} spec={w} scope={scope} onEdit={(s) => { setEditing(s); setBuilding(true); }} />)}
        </div>
      )}
      {building && <WidgetBuilder tab={tab} existing={editing} onClose={() => { setBuilding(false); setEditing(null); }} />}
    </Register>
  );
}

/** The visual builder. Everything it offers is guaranteed computable — metric choices are filtered
 *  to one grain, and groupings to those the grain actually carries. */
export function WidgetBuilder({ tab, existing, onClose, seed }: {
  tab: TabId; existing?: WidgetSpec | null; onClose: () => void;
  seed?: Partial<WidgetSpec>;
}) {
  const announce = useView((s) => s.announce);
  const start = existing ?? seed;
  const [kind, setKind] = useState<WidgetKind>(start?.kind ?? 'table');
  const [metrics, setMetrics] = useState<string[]>(start?.metrics ?? ['visits']);
  const [groupBy, setGroupBy] = useState<string | undefined>(start?.groupBy ?? 'location');
  const [groupBy2, setGroupBy2] = useState<string | undefined>(start?.groupBy2);
  const [limit, setLimit] = useState(start?.limit ?? 12);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(start?.sortDir ?? 'desc');
  const [targetTab, setTargetTab] = useState<TabId>(start?.tab ?? tab);
  const [placement, setPlacement] = useState<'top' | 'bottom'>(start?.placement ?? 'bottom');
  const [title, setTitle] = useState(start?.title ?? '');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const primary = metrics[0] ?? 'visits';
  const allowed = useMemo(() => new Set(compatibleMetrics(primary)), [primary]);
  const groupOptions = useMemo(() => groupKeysFor(primary), [primary]);
  const needsGroup = WIDGET_KINDS.find((k) => k.id === kind)!.needsGroup;

  const metricChoices = useMemo(() => {
    const q = query.toLowerCase().trim();
    return METRIC_LIST
      .filter((m) => metrics.includes(m.id) || allowed.has(m.id))
      .filter((m) => !q || m.label.toLowerCase().includes(q) || m.id.includes(q) || m.description.toLowerCase().includes(q))
      .slice(0, 60);
  }, [query, allowed, metrics]);

  useEffect(() => { if (needsGroup && (!groupBy || !groupOptions.includes(groupBy))) setGroupBy(groupOptions[0]); }, [needsGroup, groupBy, groupOptions]);
  useEffect(() => { if (kind === 'heatmap' && !groupBy2) setGroupBy2(groupOptions.find((g) => g !== groupBy)); }, [kind, groupBy2, groupBy, groupOptions]);

  const toggleMetric = (id: string) => {
    setMetrics((m) => {
      if (m.includes(id)) return m.length === 1 ? m : m.filter((x) => x !== id);
      if (!m.length) return [id];
      if (metric(id).table !== metric(m[0]).table) return [id];   // switching grain resets the set
      return kind === 'metric' || kind === 'table' ? [...m, id] : [id, ...m.slice(1)];
    });
  };

  const save = () => {
    const payload: Partial<WidgetSpec> = {
      id: existing?.id, tab: targetTab, placement, kind, metrics, groupBy: needsGroup ? groupBy : undefined,
      groupBy2: kind === 'heatmap' ? groupBy2 : undefined, limit, sortDir,
      title: title.trim() || defaultTitle(metrics, needsGroup ? groupBy : undefined, kind),
      source: existing?.source ?? seed?.source ?? 'manual',
    };
    if (existing) { updateWidget(existing.id, payload); announce('Widget updated'); onClose(); return; }
    const { id, error: err } = addWidget(payload);
    if (err) { setError(err); return; }
    announce(`Widget added to ${targetTab}`);
    if (id) onClose();
  };

  return (
    <div className="widget-builder">
      <div className="builder-head">
        <div className="t-heading-m">{existing ? 'Edit widget' : 'Build a widget'}</div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-xs" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary btn-xs" onClick={save}>{existing ? 'Save changes' : 'Add to tab'}</button>
      </div>
      {error && <div className="t-body-s neg" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="builder-grid">
        <section>
          <div className="builder-label">1 · What to show</div>
          <div className="chip-row">
            {WIDGET_KINDS.map((k) => (
              <button key={k.id} className="btn btn-xs" aria-pressed={kind === k.id} title={k.hint} onClick={() => setKind(k.id)}>{k.label}</button>
            ))}
          </div>
          <div className="t-label-s faint" style={{ marginTop: 6 }}>{WIDGET_KINDS.find((k) => k.id === kind)!.hint}</div>
        </section>

        <section>
          <div className="builder-label">2 · Measure
            <span className="t-label-s faint"> {metrics.length} selected · {metric(primary).table} grain</span>
          </div>
          <input className="input" style={{ width: '100%', marginBottom: 6 }} placeholder="Search metrics" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search metrics" />
          <div className="builder-list">
            {metricChoices.map((m) => (
              <label key={m.id} className="builder-option" title={m.description}>
                <input type={kind === 'metric' || kind === 'table' ? 'checkbox' : 'radio'} checked={metrics.includes(m.id)} onChange={() => toggleMetric(m.id)} />
                <span className="builder-option-label">{m.label}</span>
                <span className="faint t-label-s">{m.format}</span>
              </label>
            ))}
          </div>
          <div className="t-label-s faint" style={{ marginTop: 5 }}>
            Only metrics that share a grain can sit in one widget, so the rows line up. Picking a different grain starts a fresh selection.
          </div>
        </section>

        <section>
          <div className="builder-label">3 · Cut it by</div>
          {needsGroup ? (
            <>
              <select className="input" style={{ width: '100%' }} value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label="Group by">
                {groupOptions.map((g) => <option key={g} value={g}>{GROUP_KEYS[g].label}</option>)}
              </select>
              {kind === 'heatmap' && (
                <select className="input" style={{ width: '100%', marginTop: 6 }} value={groupBy2} onChange={(e) => setGroupBy2(e.target.value)} aria-label="Second grouping">
                  {groupOptions.filter((g) => g !== groupBy).map((g) => <option key={g} value={g}>{GROUP_KEYS[g].label}</option>)}
                </select>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <label className="t-label-s muted" style={{ flex: 1 }}>Rows
                  <input className="input" style={{ width: '100%' }} type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(+e.target.value)} />
                </label>
                <label className="t-label-s muted" style={{ flex: 1 }}>Order
                  <select className="input" style={{ width: '100%' }} value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}>
                    <option value="desc">Highest first</option><option value="asc">Lowest first</option>
                  </select>
                </label>
              </div>
            </>
          ) : <div className="t-body-s muted">{kind === 'trend' ? 'Plotted by month over the last twelve.' : 'One card per metric — no grouping needed.'}</div>}
        </section>

        <section>
          <div className="builder-label">4 · Where it lives</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <select className="input" style={{ flex: 1 }} value={targetTab} onChange={(e) => setTargetTab(e.target.value as TabId)} aria-label="Tab">
              {['overview', 'classes', 'slots', 'trainers', 'sales', 'acquisition', 'retention', 'bookings', 'leads', 'attendance', 'payroll', 'health'].map((t) =>
                <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
            <select className="input" style={{ width: 118 }} value={placement} onChange={(e) => setPlacement(e.target.value as 'top' | 'bottom')} aria-label="Placement">
              <option value="top">Pin to top</option><option value="bottom">At the bottom</option>
            </select>
          </div>
          <input className="input" style={{ width: '100%', marginTop: 6 }} placeholder={defaultTitle(metrics, needsGroup ? groupBy : undefined, kind)} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
          <div className="t-label-s faint" style={{ marginTop: 6 }}>
            Suggested home: {tabForMetric(primary)}. Widgets persist on this device and recompute from whatever filters are active when you open the tab.
          </div>
        </section>
      </div>
    </div>
  );
}
