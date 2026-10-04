import { useEffect, useMemo, useRef, useState } from 'react';
import { TABS, useView, type TabId } from '../../state/view';
import { useData, useScope } from '../../state/data';
import { useFilters } from '../../state/filters';
import { fmtAgo, fmtCurrency } from '../../semantics/formats';
import { runRules, isDismissed, summariseImpact } from '../../insights/engine';
import { InsightCard } from '../InsightCard/InsightCard';
import { CardComposer, CustomCardView, useCustomCards } from '../InsightCard/CustomCards';
import { METRIC_LIST } from '../../semantics/metrics';
import { useDrill } from '../../state/drill';
import { clearCache } from '../../data/ingest';
import { ExportMenu } from '../ExportMenu';
import { buildAgentApi, ENDPOINTS } from '../../api/agent';
import { scopeLine } from '../../api/export';
import { useScope as useScopeForExport } from '../../state/data';

export function TitleBar() {
  const { theme, setTheme, density, setDensity, comparison, toggleComparison, setPaletteOpen, setSettingsOpen, savedViews, saveView, deleteView, tab, setTab } = useView();
  const load = useData((s) => s.load); const status = useData((s) => s.status);
  const ds = useData((s) => s.dataset);
  const filters = useFilters((s) => s.filters); const replace = useFilters((s) => s.replace);
  const [views, setViews] = useState(false);
  const locations = useMemo(() => {
    if (!ds) return [] as string[];
    const m = new Map<string, number>();
    for (const r of ds.sessions) if (r.location_short) m.set(r.location_short, (m.get(r.location_short) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
  }, [ds]);
  return (
    <header className="titlebar">
      <div className="brand">
        <span className="brand-mark">FLOOR</span>
        <span className="brand-rule" aria-hidden="true" />
        <span className="t-label-m muted titlebar-sub">Physique 57 India</span>
      </div>
      <nav className="t-label-s faint titlebar-locations" aria-label="Locations in scope">
        {locations.map((l) => <span key={l}>{l}</span>)}
      </nav>
      <div style={{ flex: 1, minWidth: 0 }} />
      <div className="tb-group">
        <button className="btn btn-xs" aria-pressed={comparison} onClick={toggleComparison} title="Show the comparison value under every figure (C)">Compare</button>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-xs" onClick={() => setViews((v) => !v)} aria-expanded={views}>Views</button>
          {views && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setViews(false)} />
              <div className="surface chrome menu" style={{ width: 268 }}>
                <div className="menu-label">Saved views</div>
                {savedViews.map((v) => (
                  <div key={v.id} className="menu-row">
                    <button className="t-label-m menu-item" onClick={() => { replace(v.filters); setTab(v.tab); setDensity(v.density); if (v.comparison !== comparison) toggleComparison(); setViews(false); }}>
                      {v.name}<span className="faint"> · {TABS.find((t) => t.id === v.tab)?.label}</span>
                    </button>
                    {!v.preset && <button className="btn-ghost t-label-s" onClick={() => deleteView(v.id)} aria-label={`Delete ${v.name}`}>×</button>}
                  </div>
                ))}
                <button className="btn btn-xs" style={{ margin: '6px 4px 2px', width: 'calc(100% - 8px)' }}
                  onClick={() => { const name = prompt('Name this view'); if (name) saveView({ id: `v-${Date.now()}`, name, tab, filters, density, comparison, createdAt: Date.now() }); setViews(false); }}>Save current view</button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="tb-group">
        <select className="input t-label-m tb-select" value={density} onChange={(e) => setDensity(e.target.value as typeof density)} aria-label="Row density (D)">
          <option value="comfortable">Comfortable</option><option value="compact">Compact</option><option value="dense">Dense</option>
        </select>
        <button className="btn btn-xs" onClick={() => setTheme(theme === 'matte' ? 'gloss' : 'matte')} aria-label={`Switch to the ${theme === 'matte' ? 'Gloss' : 'Matte'} theme`} title="Theme (T)">
          {theme === 'matte' ? '◐' : '◑'} {theme === 'matte' ? 'Gloss' : 'Matte'}
        </button>
      </div>
      <div className="tb-group">
        <button className="btn btn-xs" onClick={() => useView.getState().setAskOpen(true)} title="Ask a question about this data (A)">Ask <span className="kbd">A</span></button>
        <button className="btn btn-xs" onClick={() => setPaletteOpen(true)} title="Search anything">Search <span className="kbd">⌘K</span></button>
        <button className="btn btn-xs" onClick={() => useView.getState().setReportOpen(true)} title="Generate the monthly report (R)">Report <span className="kbd">R</span></button>
        <button className="btn btn-xs" onClick={() => setSettingsOpen(true)} title="Rate card and insight thresholds">Settings</button>
        <TabExport />
        <button className="btn btn-xs" onClick={async () => { await clearCache(); load(true); }} disabled={status === 'loading'} title="Clear the 15-minute cache and re-read every sheet">
          {status === 'loading' ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>
    </header>
  );
}

/** Exports everything the active tab is showing — KPIs, the grouped breakdown and its signals. */
function TabExport() {
  const tab = useView((s) => s.tab);
  const thresholds = useView((s) => s.thresholds);
  const scope = useScopeForExport();
  const setFilters = useFilters((s) => s.set);
  if (!scope) return null;
  const ep = ENDPOINTS.find((e) => e.tab === tab) ?? ENDPOINTS[0];
  const payload = () => {
    const api = buildAgentApi(scope, thresholds, (p) => setFilters(p as never));
    const d = api.get(tab, { limit: 1000 }) as {
      headline: { label: string; formatted: string; value: number | null }[];
      groups: { label: string; rows: number; values: Record<string, number | null> }[];
      insights: { severity: string; title: string; action: string; impactINR: number }[];
    };
    const metricCols = ep.headline;
    const rows: (string | number | null)[][] = [
      ...d.headline.map((h) => ['KPI', h.label, h.value, h.formatted, '', '']),
      ...d.groups.map((g) => [ep.groupBy[0], g.label, g.rows, '', ...metricCols.map((m) => g.values[m] ?? null)].slice(0, 6 + metricCols.length)),
      ...d.insights.map((i) => ['Signal', i.title, Math.round(i.impactINR), i.severity, i.action, '']),
    ];
    return { name: `Floor · ${ep.title}`, columns: ['Section', 'Item', 'Value', 'Formatted', 'Detail', 'Extra', ...metricCols.map((m) => m)].slice(0, 6 + metricCols.length),
      rows, scopeLine: scopeLine(scope), meta: { tab, generated: new Date().toISOString() } };
  };
  return <ExportMenu payload={payload} label="Export tab" />;
}

export function TabRail() {
  const tab = useView((s) => s.tab); const setTab = useView((s) => s.setTab);
  const ref = useRef<HTMLDivElement>(null); const [bar, setBar] = useState({ left: 0, width: 0 });
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (el) { setBar({ left: el.offsetLeft, width: el.offsetWidth }); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }, [tab]);
  const domain = TABS.find((t) => t.id === tab)?.domain ?? 'attendance';
  return (
    <div ref={ref} role="tablist" data-domain={domain} className="tabrail">
      {TABS.map((t) => (
        <button key={t.id} role="tab" data-tab={t.id} aria-selected={tab === t.id} onClick={() => setTab(t.id)}
          className={`tab ${tab === t.id ? 'is-active' : ''}`} data-domain={t.domain} title={`${t.label} — press ${t.key}`}>
          {t.label}
        </button>
      ))}
      <div className="barre barre-glow tabrail-barre" style={{ left: bar.left, width: bar.width }} />
    </div>
  );
}

export function SignalRail() {
  const { railOpen, toggleRail, thresholds, dismissed, tab } = useView();
  const scope = useScope();
  const insights = useMemo(() => (scope ? runRules(scope, thresholds).filter((i) => !isDismissed(dismissed, i.key)) : []), [scope, thresholds, dismissed]);
  const forTab = insights.filter((i) => tab === 'overview' || i.tab === tab).slice(0, 7);
  const impact = useMemo(() => summariseImpact(forTab), [forTab]);
  const custom = useCustomCards(tab);
  const counts = { critical: forTab.filter((i) => i.severity === 'critical').length, attention: forTab.filter((i) => i.severity === 'attention').length, opportunity: forTab.filter((i) => i.severity === 'opportunity').length };
  return (
    <aside aria-label="Signal rail" style={{ width: railOpen ? 320 : 44, flexShrink: 0, borderLeft: '1px solid var(--hairline)', background: 'var(--surface-1)', transition: 'width var(--m-base) var(--ease-out)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <button onClick={toggleRail} aria-expanded={railOpen} className="t-heading-s" style={{ height: 44, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: '1px solid var(--hairline)', whiteSpace: 'nowrap' }} title="Signal rail (S)">
        <span>{railOpen ? '›' : '‹'}</span>{railOpen ? <span>Signals <span className="muted">{forTab.length + custom.length}</span></span> : <span style={{ writingMode: 'vertical-rl', display: 'flex', gap: 6, alignItems: 'center' }}>{forTab.length + custom.length}<i style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--neg)', opacity: counts.critical ? 1 : 0.2 }} /><i style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--warn)', opacity: counts.attention ? 1 : 0.2 }} /><i style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--pos)', opacity: counts.opportunity ? 1 : 0.2 }} /></span>}
      </button>
      {railOpen && (
        <div style={{ padding: 12, overflow: 'auto', display: 'grid', gap: 10, alignContent: 'start' }}>
          {impact.length > 0 && (
            <div className="impact-summary">
              {impact.map((b) => (
                <div key={b.basis} className="impact-row">
                  <span className="t-label-s muted">{b.basis === 'at-risk' ? 'Revenue at risk' : b.basis === 'sunk' ? 'Already paid, unused' : 'Estimated upside'}</span>
                  <span className="t-heading-s tabular">{fmtCurrency(b.net)}</span>
                  {b.overlapping > 0 && <span className="t-label-s faint" title={`Gross ${fmtCurrency(b.gross)} before removing ${b.overlapping} duplicated members`}>net of overlap · {b.entities.toLocaleString('en-IN')} members</span>}
                </div>
              ))}
            </div>
          )}
          {custom.map((c) => <CustomCardView key={c.id} card={c} />)}
          {forTab.map((i) => <InsightCard key={i.key} insight={i} />)}
          <CardComposer tab={tab} />
          {!forTab.length && <div className="t-body-s muted">No rule has fired for this scope. Widen the period or check Data health if sheets failed to load.</div>}
          <div className="t-label-s faint">Sorted by rupee impact within severity. Totals count each member once, so they will be lower than the sum of the cards. Dismissals persist 30 days.</div>
        </div>
      )}
    </aside>
  );
}

export function StatusBar() {
  const loads = useData((s) => s.loads); const ds = useData((s) => s.dataset); const scope = useScope();
  const announcement = useView((s) => s.announcement); const setTab = useView((s) => s.setTab);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(id); }, []);
  const failed = loads.filter((l) => l.status === 'error' || l.status === 'empty');
  const derived = loads.filter((l) => l.status === 'derived');
  return (
    <footer className="statusbar t-label-s">
      <span className="tabular" style={{ color: 'var(--text-2)' }}>{scope ? `${scope.rowsInScope.toLocaleString('en-IN')} rows in scope` : 'Loading'}</span>
      {scope && <span className="faint">{scope.period.label}</span>}
      {ds && <span className="faint">updated {fmtAgo(ds.loadedAt)}</span>}
      <span className="sheet-dots">
        {loads.map((l) => (
          <span key={l.key} className={`sheet-dot ${l.status}`} title={`${l.title}: ${l.status === 'ok' ? `${l.rows.toLocaleString('en-IN')} rows` : l.error ?? l.hint ?? l.status}`}>
            <i /> {l.title}
          </span>
        ))}
      </span>
      <div style={{ flex: 1 }} />
      {(failed.length > 0 || derived.length > 0) && (
        <button className="btn btn-xs" onClick={() => setTab('health')}>
          {failed.length ? `${failed.length} sheet${failed.length > 1 ? 's' : ''} unavailable` : `${derived.length} derived`} — open Data health
        </button>
      )}
      <span aria-live="polite" role="status" className="hue">{announcement}</span>
    </footer>
  );
}

export function CommandPalette() {
  const open = useView((s) => s.paletteOpen); const setOpen = useView((s) => s.setPaletteOpen); const setTab = useView((s) => s.setTab);
  const ds = useData((s) => s.dataset); const addTransient = useFilters((s) => s.addTransient); const drill = useDrill((s) => s.open);
  const [q, setQ] = useState(''); const [i, setI] = useState(0);
  const items = useMemo(() => {
    if (!ds) return [] as { label: string; kind: string; run: () => void }[];
    const out: { label: string; kind: string; run: () => void }[] = [];
    for (const t of TABS) out.push({ label: t.label, kind: 'Tab', run: () => setTab(t.id) });
    for (const m of METRIC_LIST) out.push({ label: m.label, kind: 'Metric', run: () => setTab(({ sessions: 'classes', checkins: 'attendance', sales: 'sales', newc: 'acquisition', lapsed: 'retention', payroll: 'payroll', leads: 'leads', bookings: 'bookings' } as Record<string, TabId>)[m.table]) });
    const trainers = new Set<string>(); for (const r of ds.sessions) if (r.trainer) trainers.add(r.trainer); for (const r of ds.newc) if (r.trainer) trainers.add(r.trainer);
    for (const t of trainers) out.push({ label: t, kind: 'Trainer', run: () => { setTab('trainers'); addTransient({ dim: 'trainer', value: t }); } });
    const slots = new Set<string>(); for (const r of ds.sessions) if (r.day && r.time) slots.add(`${r.day} ${r.time}`);
    for (const s of slots) out.push({ label: s, kind: 'Slot', run: () => { setTab('slots'); addTransient({ dim: 'daytime', value: s }); } });
    const classes = new Set<string>(); for (const r of ds.sessions) if (r.class_name) classes.add(r.class_name);
    for (const c of classes) out.push({ label: c, kind: 'Class', run: () => { setTab('classes'); addTransient({ dim: 'class_name', value: c }); } });
    const members = new Map<string, typeof ds.newc>(); for (const r of ds.newc) if (r.name) { const a = members.get(r.name) ?? []; a.push(r); members.set(r.name, a); }
    for (const [n, rows] of members) out.push({ label: n, kind: 'Member', run: () => drill({ title: n, breadcrumb: ['Members', n], table: 'newc', rows, metricIds: ['avg_ltv', 'visits_post_trial' in rows[0] ? 'avg_visits_post_trial' : 'avg_ltv', 'conversion_rate', 'retention_rate'], domain: 'growth' }) });
    return out;
  }, [ds, setTab, addTransient, drill]);
  const shown = useMemo(() => { const s = q.toLowerCase().trim(); return (s ? items.filter((it) => it.label.toLowerCase().includes(s)) : items.slice(0, 12)).slice(0, 40); }, [items, q]);
  useEffect(() => { setI(0); }, [q]);
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--overlay)', display: 'flex', justifyContent: 'center', paddingTop: '12vh' }} onClick={() => setOpen(false)}>
      <div className="surface chrome" style={{ width: 560, height: 'fit-content', maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input autoFocus className="input t-body-m" style={{ height: 44, border: 0, borderBottom: '1px solid var(--hairline)', borderRadius: 0, background: 'transparent' }} placeholder="Jump to a tab, metric, trainer, member, slot or class" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') setI((x) => Math.min(shown.length - 1, x + 1)); if (e.key === 'ArrowUp') setI((x) => Math.max(0, x - 1)); if (e.key === 'Enter' && shown[i]) { shown[i].run(); setOpen(false); } if (e.key === 'Escape') setOpen(false); }} />
        <div style={{ overflow: 'auto' }}>{shown.map((it, j) => <button key={`${it.kind}${it.label}`} onClick={() => { it.run(); setOpen(false); }} className="t-body-s" style={{ display: 'flex', width: '100%', padding: '8px 14px', gap: 10, background: j === i ? 'var(--surface-3)' : 'transparent', textAlign: 'left' }}><span className="t-label-s muted" style={{ width: 60 }}>{it.kind}</span>{it.label}</button>)}</div>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const { settingsOpen, setSettingsOpen, ratePerSession, setRate, thresholds, setThresholds } = useView();
  if (!settingsOpen) return null;
  const T: { k: keyof typeof thresholds; label: string; pct?: boolean }[] = [
    { k: 'deadSlotFill', label: 'Dead slot fill below', pct: true }, { k: 'deadSlotMinOccurrences', label: 'Dead slot min occurrences' }, { k: 'slotDeclinePp', label: 'Slot decline (pp)', pct: true }, { k: 'waitlistMin', label: 'Waitlist overbooked count' },
    { k: 'dependencyShare', label: 'Trainer dependency share', pct: true }, { k: 'conversionSigma', label: 'Conversion outlier σ' }, { k: 'secondVisitFloor', label: 'Second-visit floor', pct: true }, { k: 'leadResponseHours', label: 'Lead response hours' },
    { k: 'discountCreepPp', label: 'Discount creep (pp)', pct: true }, { k: 'dormantDays', label: 'Dormant days' }, { k: 'zeroUsageDays', label: 'Zero-usage days' }, { k: 'expiryCliffShare', label: 'Expiry cliff share', pct: true }, { k: 'utilisationFloor', label: 'Utilisation floor', pct: true }, { k: 'noShowRate', label: 'No-show cluster rate', pct: true }, { k: 'mixShiftPp', label: 'Mix shift (pp)', pct: true }, { k: 'integrityVariance', label: 'Integrity variance', pct: true },
  ];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'var(--overlay)', display: 'flex', justifyContent: 'flex-end' }} onClick={() => setSettingsOpen(false)}>
      <div className="slide-in" style={{ width: 420, background: 'var(--surface-1)', borderLeft: '1px solid var(--hairline-strong)', padding: 20, overflow: 'auto' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div style={{ display: 'flex', alignItems: 'center' }}><h2 className="t-heading-l" style={{ margin: 0 }}>Settings</h2><div style={{ flex: 1 }} /><button className="btn btn-xs" onClick={() => setSettingsOpen(false)}>Close</button></div>
        <div style={{ marginTop: 16 }}>
          <div className="t-heading-s">Assumed trainer rate per session</div>
          <div className="t-display-s tabular" style={{ margin: '6px 0' }}>₹{ratePerSession.toLocaleString('en-IN')}</div>
          <input type="range" min={300} max={4000} step={50} value={ratePerSession} onChange={(e) => setRate(+e.target.value)} style={{ width: '100%' }} aria-label="Rate per session" />
          <div className="t-label-s muted">Every margin, break-even and payroll figure recomputes live as this moves.</div>
        </div>
        <div style={{ marginTop: 20 }}>
          <div className="t-heading-s" style={{ marginBottom: 8 }}>Insight thresholds</div>
          <div style={{ display: 'grid', gap: 6 }}>{T.map((t) => <label key={t.k} className="t-label-m" style={{ display: 'grid', gridTemplateColumns: '1fr 90px', alignItems: 'center', gap: 8 }}>{t.label}<input className="input" type="number" step={t.pct ? 1 : 1} value={t.pct ? Math.round(thresholds[t.k] * 100) : thresholds[t.k]} onChange={(e) => setThresholds({ [t.k]: t.pct ? +e.target.value / 100 : +e.target.value })} aria-label={t.label} /></label>)}</div>
        </div>
      </div>
    </div>
  );
}
