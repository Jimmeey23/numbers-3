import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_THRESHOLDS, TAB_GROUPS, TABS, tabMeta, useView, type TabId } from '../../state/view';
import { useDockedPanel, useOverlay } from '../../state/overlays';
import { Logo } from './Logo';
import { Icon, TAB_ICONS } from './Icons';
import { HeroGraphic } from '../HeroGraphic';
import { useData, useScope } from '../../state/data';
import { useFilters } from '../../state/filters';
import { fmtAgo, fmtCurrency } from '../../semantics/formats';
import { runRules, isDismissed, summariseImpact } from '../../insights/engine';
import { InsightCard } from '../InsightCard/InsightCard';
import { CardComposer, CustomCardView, useCustomCards } from '../InsightCard/CustomCards';
import { METRIC_LIST } from '../../semantics/metrics';
import { useDrill } from '../../state/drill';
import { clearCache } from '../../data/ingest';
import { CACHE_STALE_AFTER_MS } from '../../data/sheets.config';
import type { SheetLoad } from '../../data/types';
import { ExportMenu } from '../ExportMenu';
import { addCard, buildAgentApi, ENDPOINTS, readCards } from '../../api/agent';
import { scopeLine } from '../../api/export';
import { useScope as useScopeForExport } from '../../state/data';
import { AI_EVENT, clearAIKey, generateAISignals, readAIConfig, readOpenAIKey, saveAISettings, type AIConfig } from '../../ai/client';
import { clearSavedReports, listSavedReports } from '../../report/store';
import { RAMPS, THEMES, type Theme } from '../../design/ramps';

/* ════════════════════════════════════════════════════════════════════════════
   SHELL — the chrome around the canvas.

     SideNav     persistent, grouped, icon-led navigation
     TopBar      identity of the current view, search, and global actions
     PageHeader  the title block every tab opens with
     InsightRail signals for whatever is on screen
     StatusBar   provenance: rows, period, which sheets answered
   ════════════════════════════════════════════════════════════════════════════ */

/* ── Side navigation ─────────────────────────────────────────────────────── */
export function SideNav() {
  const tab = useView((s) => s.tab);
  const setTab = useView((s) => s.setTab);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('atlas.nav.collapsed') === '1'; } catch { return false; }
  });
  const scope = useScope();
  const loads = useData((s) => s.loads);
  const failed = loads.filter((l) => l.status === 'error' || l.status === 'empty').length;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [tab]);
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem('atlas.nav.collapsed', c ? '0' : '1'); } catch { /* private mode */ }
    return !c;
  });
  const domain = tabMeta(tab).domain;
  return (
    <nav ref={ref} aria-label="Sections" data-domain={domain} className={`sidenav ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidenav-brand">
        <button type="button" className="brand-home" title="Go to Overview"
          onClick={() => { setTab('overview'); document.getElementById('canvas')?.scrollTo({ top: 0, behavior: 'smooth' }); }}
          aria-label="Atlas home, open Overview">
          <Logo size={collapsed ? 30 : 34} />
          <span style={{ minWidth: 0 }}>
            <span className="brand-mark">ATLAS</span>
            <span className="brand-sub">Physique 57 India</span>
          </span>
        </button>
      </div>

      <div className="sidenav-scroll" role="tablist" aria-orientation="vertical">
        {TAB_GROUPS.map((group) => {
          const items = TABS.filter((t) => t.group === group);
          if (!items.length) return null;
          return (
            <div key={group} className="nav-group">
              <div className="nav-group-label">{group}</div>
              {items.map((t) => (
                <button key={t.id} role="tab" data-tab={t.id} data-domain={t.domain}
                  aria-selected={tab === t.id} aria-label={t.label}
                  className={`nav-item ${tab === t.id ? 'is-active' : ''}`}
                  title={collapsed ? t.label : `${t.label}${t.key ? ` — press ${t.key}` : ''}`}
                  onClick={() => setTab(t.id)}>
                  <span className="nav-item-icon">{TAB_ICONS[t.id]}</span>
                  <span className="nav-item-label">{t.label}</span>
                  {t.id === 'health' && failed > 0
                    ? <span className="nav-item-badge">{failed}</span>
                    : t.key && <span className="nav-item-key">{t.key}</span>}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="sidenav-foot">
        {scope && (
          <div className="nav-scope t-label-s">
            <span className="faint">In scope</span>
            <b>{scope.rowsInScope.toLocaleString('en-IN')} rows</b>
            <span className="faint">{scope.period.label}</span>
          </div>
        )}
        <button className="nav-collapse" onClick={toggle} title="Collapse navigation"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
          <span style={{ display: 'inline-flex', transform: collapsed ? 'rotate(180deg)' : 'none' }}>{Icon.collapse}</span>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  );
}

/** Retained for narrow viewports, where the side rail is hidden. */
export function TabRail() {
  const tab = useView((s) => s.tab);
  const setTab = useView((s) => s.setTab);
  return (
    <div role="tablist" data-domain={tabMeta(tab).domain} className="tabrail">
      {TABS.map((t) => (
        <button key={t.id} role="tab" data-tab={t.id} aria-selected={tab === t.id} data-domain={t.domain}
          className={`tab ${tab === t.id ? 'is-active' : ''}`} onClick={() => setTab(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ── Top bar ─────────────────────────────────────────────────────────────── */
export function TitleBar() {
  const { theme, setTheme, density, setDensity, comparison, toggleComparison, setPaletteOpen, setSettingsOpen, savedViews, saveView, deleteView, tab, setTab } = useView();
  const load = useData((s) => s.load);
  const status = useData((s) => s.status);
  const scope = useScope();
  const filters = useFilters((s) => s.filters);
  const replace = useFilters((s) => s.replace);
  const [views, setViews] = useState(false);
  return (
    <header className="topbar">
      {/* The tab names itself once, in the page hero. The bar carries what is true of every
          number on screen — the scope — so it stays useful after the hero scrolls away. */}
      <div className="topbar-heading">
        <div className="topbar-scope">
          <span className="topbar-period">{scope ? scope.period.label : 'Reading sources…'}</span>
          {scope && filters.compare !== 'none' && <span className="topbar-vs">vs {scope.period.prevLabel}</span>}
        </div>
        <div className="topbar-sub">
          {scope
            ? `${scope.rowsInScope.toLocaleString('en-IN')} rows · ${filters.locations.length ? `${filters.locations.length} ${filters.locations.length === 1 ? 'studio' : 'studios'}` : 'all studios'}${filters.trainers.length ? ` · ${filters.trainers.length} trainers` : ''}`
            : 'Nine sheets'}
        </div>
      </div>

      <div className="topbar-spacer" />

      <button className="topbar-search" onClick={() => setPaletteOpen(true)} title="Search anything">
        {Icon.search}
        <span>Search metrics, trainers, members…</span>
        <span className="kbd">⌘K</span>
      </button>

      <div className="tb-group">
        <button className="btn btn-xs" onClick={() => useView.getState().setAskOpen(true)} title="Ask a question about this data (A)">
          {Icon.ask}<span className="desktop-only">Ask</span>
        </button>
        <button className="btn btn-xs" onClick={() => useView.getState().setReportOpen(true)} title="Generate the monthly report (R)">
          {Icon.report}<span className="desktop-only">Report</span>
        </button>
        <TabExport />
      </div>

      <div className="tb-group">
        <button className="btn btn-xs" aria-pressed={comparison} onClick={toggleComparison} title="Show the comparison value under every figure (C)">
          {Icon.compare}<span className="desktop-only">Compare</span>
        </button>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-xs" onClick={() => setViews((v) => !v)} aria-expanded={views} title="Saved views">
            {Icon.views}<span className="desktop-only">Views</span>
          </button>
          {views && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setViews(false)} />
              <div className="menu" style={{ width: 274, zIndex: 61 }}>
                <div className="menu-label">Saved views</div>
                {savedViews.map((v) => (
                  <div key={v.id} className="menu-row">
                    <button className="t-label-m menu-item" onClick={() => { replace(v.filters); setTab(v.tab); setDensity(v.density); if (v.comparison !== comparison) toggleComparison(); setViews(false); }}>
                      {v.name}<span className="faint"> · {tabMeta(v.tab).label}</span>
                    </button>
                    {!v.preset && <button className="btn-ghost t-label-s" onClick={() => deleteView(v.id)} aria-label={`Delete ${v.name}`}>×</button>}
                  </div>
                ))}
                <button className="btn btn-xs" style={{ margin: '8px 4px 2px', width: 'calc(100% - 8px)' }}
                  onClick={() => { const name = prompt('Name this view'); if (name) saveView({ id: `v-${Date.now()}`, name, tab, filters, density, comparison, createdAt: Date.now() }); setViews(false); }}>Save current view</button>
              </div>
            </>
          )}
        </div>
        <select className="input t-label-m tb-select desktop-only" value={density} onChange={(e) => setDensity(e.target.value as typeof density)} aria-label="Row density (D)">
          <option value="comfortable">Comfortable</option><option value="compact">Compact</option><option value="dense">Dense</option>
        </select>
        <ThemeMenu theme={theme} setTheme={setTheme} />
      </div>

      <div className="tb-group">
        <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Settings — rate card, thresholds, appearance" aria-label="Settings">{Icon.settings}</button>
        <button className="icon-button" onClick={async () => { await clearCache(); load(true); }} disabled={status === 'loading'}
          title="Re-read every sheet from Google. Sheets are otherwise served from the local cache." aria-label="Refresh sources">
          <span style={{ display: 'inline-flex', animation: status === 'loading' ? 'hgSpin 1.1s linear infinite' : undefined }}>{Icon.refresh}</span>
        </button>
      </div>
    </header>
  );
}

/** Exports everything the active tab is showing — KPIs, the grouped breakdown and its insights. */
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
      ...d.insights.map((i) => ['Insight', i.title, Math.round(i.impactINR), i.severity, i.action, '']),
    ];
    return { name: `Atlas · ${ep.title}`, columns: ['Section', 'Item', 'Value', 'Formatted', 'Detail', 'Extra', ...metricCols.map((m) => m)].slice(0, 6 + metricCols.length),
      rows, scopeLine: scopeLine(scope), meta: { tab, generated: new Date().toISOString() } };
  };
  return <ExportMenu payload={payload} label="Export" />;
}

/* Theme menu. Eight palettes rather than a light/dark pair, so a toggle no longer has to say
   what the next press does — the list names each one and shows its palette. T still cycles. */
function ThemeMenu({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const [open, setOpen] = useState(false);
  useOverlay(open, useCallback(() => setOpen(false), []));
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-xs" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Theme (T cycles)">
        <span className="theme-swatches" aria-hidden style={{ paddingTop: 0 }}>
          {SWATCHES[current.id].slice(1, 4).map((c, i) => <i key={i} style={{ background: c, width: 6, height: 12 }} />)}
        </span>
        <span className="desktop-only">{current.label}</span>
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onClick={() => setOpen(false)} />
          <div className="menu theme-menu" role="menu" style={{ right: 0, zIndex: 61 }}>
            <div className="menu-label">Palette</div>
            {THEMES.map((t) => (
              <button key={t.id} role="menuitemradio" aria-checked={t.id === theme} className="theme-item"
                onClick={() => { setTheme(t.id); setOpen(false); }}>
                <span className="theme-swatches" aria-hidden>
                  {SWATCHES[t.id].map((c, i) => <i key={i} style={{ background: c }} />)}
                </span>
                <span className="theme-item-text">
                  <b>{t.label}</b>
                  <span className="t-label-s faint">{t.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* The canvas, then the five domain accents — the menu shows the palette rather than naming it. */
const SWATCHES: Record<Theme, string[]> = Object.fromEntries(THEMES.map((t) => [t.id,
  [RAMPS[t.id].surface, ...['attendance', 'revenue', 'growth', 'people', 'risk'].map((d) => RAMPS[t.id].domain[d])]])) as Record<Theme, string[]>;

/* ── Page header ─────────────────────────────────────────────────────────── */
/** The title block every tab opens with: where you are, what this view answers, and the
    three facts that qualify every number below it. */
export function PageHeader() {
  const tab = useView((s) => s.tab);
  const scope = useScope();
  const { setFiltersOpen, comparison, toggleComparison, railOpen, toggleRail, setAskOpen, thresholds, dismissed } = useView();
  const meta = tabMeta(tab);
  const filters = useFilters((s) => s.filters);
  const status = useData((s) => s.status);
  const signals = useMemo(
    () => (scope ? runRules(scope, thresholds).filter((i) => !isDismissed(dismissed, i.key) && (tab === 'overview' || i.tab === tab)).length : 0),
    [scope, thresholds, dismissed, tab]);
  const studios = filters.locations.length
    ? filters.locations.map((l) => l.split(',')[0]).join(', ')
    : 'All studios';

  /* The head is the top of the tab, not a card laid on top of it: it runs the full width of the
     work area, its tint dissolves into the page beneath, and the first section starts straight
     after the rule. The frame is shared by all fourteen tabs — only the motif, the pattern and
     the accent change, so every tab is recognisably the same product and still its own place. */
  return (
    <header className="page-head" data-domain={meta.domain} data-tab={tab}>
      <div className="page-head-pattern" aria-hidden="true" />
      <div className="page-head-art" aria-hidden="true"><HeroGraphic tab={tab} /></div>

      <div className="page-head-row">
        <div className="page-head-main">
          <div className="page-eyebrow">
            <span className="page-eyebrow-rule" aria-hidden="true" />
            {meta.group}
            {meta.key && <span className="page-eyebrow-key">Press {meta.key}</span>}
          </div>
          <h1 className="page-title">{meta.label}</h1>
          <p className="page-sub">{meta.blurb}</p>
        </div>

        <div className="page-head-actions">
          <button className="btn btn-xs" onClick={() => setFiltersOpen(true)} title="Period, studios, trainers, formats (F)">
            {Icon.filter}<span className="desktop-only">Filters</span>
            {(filters.locations.length + filters.trainers.length) > 0 && <span className="page-action-dot" aria-hidden="true" />}
          </button>
          <button className="btn btn-xs" aria-pressed={comparison} onClick={toggleComparison} title="Show the comparison value under every figure (C)">
            {Icon.compare}<span className="desktop-only">Compare</span>
          </button>
          <button className="btn btn-xs" aria-pressed={railOpen} onClick={toggleRail} title="Insights for this tab (S)">
            {Icon.insight}<span className="desktop-only">Insights</span>
            {signals > 0 && <span className="page-action-count">{signals}</span>}
          </button>
          <button className="btn btn-xs" onClick={() => setAskOpen(true)} title="Ask a question about this tab (A)">
            {Icon.ask}<span className="desktop-only">Ask</span>
          </button>
          <TabExport />
        </div>
      </div>

      <dl className="page-facts">
        <div className="page-fact">
          <dt>Period</dt>
          <dd><button className="page-fact-edit" onClick={() => setFiltersOpen(true)} title="Edit the period (F)">{scope ? scope.period.label : status === 'loading' ? 'Reading sources…' : '—'}</button></dd>
        </div>
        <div className="page-fact">
          <dt>Rows in scope</dt>
          <dd className="tabular">{scope ? scope.rowsInScope.toLocaleString('en-IN') : '—'}</dd>
        </div>
        <div className="page-fact">
          <dt>Compared with</dt>
          <dd>{filters.compare === 'none' ? 'Off' : scope ? scope.period.prevLabel : '—'}</dd>
        </div>
        <div className="page-fact">
          <dt>Studios</dt>
          <dd title={studios}>{studios}</dd>
        </div>
        {filters.trainers.length > 0 && (
          <div className="page-fact">
            <dt>Trainers</dt>
            <dd>{filters.trainers.length} selected</dd>
          </div>
        )}
      </dl>
    </header>
  );
}

/* ── Insight rail ────────────────────────────────────────────────────────── */
export function InsightRail() {
  const { railOpen, toggleRail, thresholds, dismissed, tab, setSettingsOpen, announce } = useView();
  const scope = useScope();
  useDockedPanel(railOpen, useCallback(() => useView.getState().toggleRail(), []));
  const [aiBusy, setAiBusy] = useState(false); const [aiError, setAiError] = useState('');
  const insights = useMemo(() => (scope ? runRules(scope, thresholds).filter((i) => !isDismissed(dismissed, i.key)) : []), [scope, thresholds, dismissed]);
  const forTab = insights.filter((i) => tab === 'overview' || i.tab === tab).slice(0, 12);
  const impact = useMemo(() => summariseImpact(forTab), [forTab]);
  const custom = useCustomCards(tab);
  const counts = { critical: forTab.filter((i) => i.severity === 'critical').length, attention: forTab.filter((i) => i.severity === 'attention').length, opportunity: forTab.filter((i) => i.severity === 'opportunity').length };
  const generateAI = async () => {
    if (!scope || aiBusy) return;
    if (!readOpenAIKey()) { setSettingsOpen(true); announce('Add an OpenAI API key to generate AI insights'); return; }
    setAiBusy(true); setAiError('');
    try {
      const api = buildAgentApi(scope, thresholds, () => undefined);
      const snapshot = api.get(tab, { limit: 30 });
      const result = await generateAISignals(tab, snapshot);
      const source = `openai:${result.fingerprint}`;
      const existing = readCards().filter((c) => c.tab === tab && c.source === source);
      if (!existing.length) for (const s of result.signals) addCard({ tab, title: s.title, body: s.body, action: s.action, severity: s.severity, impactINR: s.impactINR, entity: s.entity, metricId: s.metricId, source });
      announce(result.cached || existing.length ? 'Reused saved AI insights for this data scope' : `Saved ${result.signals.length} AI insights to this tab`);
    } catch (e) { setAiError(e instanceof Error ? e.message : 'AI insight generation failed.'); }
    finally { setAiBusy(false); }
  };
  return (
    <aside aria-label="Insights" className={`insight-rail ${railOpen ? 'is-open' : 'is-closed'}`}>
      {/* Closed, the rail is a labelled handle on the right edge with its count on it — a
          door you can see, not a hotspot you have to find. */}
      <button onClick={toggleRail} aria-expanded={railOpen} className="insight-rail-toggle" title="Toggle insights (S)" aria-label={railOpen ? 'Collapse insights' : `Expand insights, ${forTab.length + custom.length} for this tab`}>
        {railOpen
          ? <><span>Signals <span className="insight-rail-count">{forTab.length + custom.length}</span></span><span className="insight-rail-chevron" aria-hidden="true">›</span></>
          : <>
              <span className="insight-rail-chevron" aria-hidden="true">‹</span>
              <span className="insight-rail-vertical">Insights</span>
              <span className={`insight-rail-count ${counts.critical ? 'is-critical' : ''}`}>{forTab.length + custom.length}</span>
            </>}
      </button>
      {railOpen && (
        <div className="insight-rail-content">
          <div className="insight-rail-intro">Signals for this view</div>
          <div className="insight-rail-severity" aria-label="Insight counts by severity">
            <span><i style={{ background: 'var(--neg)' }} />{counts.critical} critical</span>
            <span><i style={{ background: 'var(--warn)' }} />{counts.attention} attention</span>
            <span><i style={{ background: 'var(--pos)' }} />{counts.opportunity} opportunity</span>
          </div>
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
          <button className="ai-signal-button" onClick={generateAI} disabled={aiBusy || !scope}>✦ {aiBusy ? 'Analyzing displayed data…' : 'Generate with AI'}</button>
          <div className="t-label-s faint">AI insights are saved on this device for the current data and filters.</div>
          {aiError && <div className="signal-ai-error">{aiError}</div>}
          {custom.map((c) => <CustomCardView key={c.id} card={c} />)}
          {forTab.map((i) => <InsightCard key={i.key} insight={i} />)}
          <CardComposer tab={tab} />
          {!forTab.length && !custom.length && <div className="t-body-s muted">No rule has fired for this scope. Widen the period, generate with AI, or check Data health if sheets failed to load.</div>}
          <div className="t-label-s faint">Sorted by rupee impact within severity. Totals count each member once, so they will be lower than the sum of the cards. Dismissals persist 30 days.</div>
        </div>
      )}
    </aside>
  );
}

/** When the sheet text behind this dataset was actually fetched — not when it was last parsed. */
const sourceFetchedAt = (loads: SheetLoad[]): number | null => {
  const ts = loads.map((l) => l.fetchedAt).filter((t): t is number => !!t);
  return ts.length ? Math.min(...ts) : null;
};
const cacheAgeTitle = (loads: SheetLoad[]): string => {
  const cached = loads.filter((l) => l.fromCache).length;
  const at = sourceFetchedAt(loads);
  if (!at) return 'Sheets were read from Google during this session.';
  const stale = Date.now() - at > CACHE_STALE_AFTER_MS;
  return `${cached} of ${loads.length} sheets came from the local cache, read ${fmtAgo(at)}. `
    + 'Reloading the page reuses them; press Refresh to go back to Google.'
    + (stale ? ' This copy is more than fifteen minutes old.' : '');
};

/* ── Status bar ──────────────────────────────────────────────────────────── */
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
      {ds && <span className="faint" title={cacheAgeTitle(loads)}>{sourceFetchedAt(loads) ? `sheets read ${fmtAgo(sourceFetchedAt(loads)!)}` : `updated ${fmtAgo(ds.loadedAt)}`}</span>}
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

/* ── Command palette ─────────────────────────────────────────────────────── */
export function CommandPalette() {
  const open = useView((s) => s.paletteOpen); const setOpen = useView((s) => s.setPaletteOpen);
  useOverlay(open, useCallback(() => setOpen(false), [setOpen])); const setTab = useView((s) => s.setTab);
  const ds = useData((s) => s.dataset); const addTransient = useFilters((s) => s.addTransient); const drill = useDrill((s) => s.open);
  const [q, setQ] = useState(''); const [i, setI] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
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
  const shown = useMemo(() => { const s = q.toLowerCase().trim(); return (s ? items.filter((it) => it.label.toLowerCase().includes(s)) : items.slice(0, 14)).slice(0, 40); }, [items, q]);
  useEffect(() => { setI(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('.palette-item.is-active')?.scrollIntoView({ block: 'nearest' }); }, [i]);
  if (!open) return null;
  return (
    <div className="palette-scrim" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette-input">
          {Icon.search}
          <input autoFocus placeholder="Jump to a tab, metric, trainer, member, slot or class" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(shown.length - 1, x + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              if (e.key === 'Enter' && shown[i]) { shown[i].run(); setOpen(false); }
              if (e.key === 'Escape') setOpen(false);
            }} />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list" ref={listRef}>
          {shown.map((it, j) => (
            <button key={`${it.kind}${it.label}`} onMouseEnter={() => setI(j)} onClick={() => { it.run(); setOpen(false); }}
              className={`palette-item ${j === i ? 'is-active' : ''}`}>
              <span className="palette-kind">{it.kind}</span>
              <span className="t-body-s" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
            </button>
          ))}
          {!shown.length && <div className="t-body-s faint" style={{ padding: '18px 14px' }}>Nothing matches “{q}”.</div>}
        </div>
        <div className="palette-foot">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
          <span><span className="kbd">↵</span> open</span>
          <span style={{ marginLeft: 'auto' }}>{shown.length} of {items.length}</span>
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const { settingsOpen, setSettingsOpen, ratePerSession, setRate, thresholds, setThresholds, theme, setTheme, density, setDensity, comparison, toggleComparison } = useView();
  const load = useData((s) => s.load); const status = useData((s) => s.status); const loads = useData((s) => s.loads);
  const [ai, setAi] = useState<AIConfig>(readAIConfig);
  const [apiKey, setApiKey] = useState(readOpenAIKey);
  const [showKey, setShowKey] = useState(false); const [saved, setSaved] = useState(false); const [reportCount, setReportCount] = useState(0);
  useOverlay(settingsOpen, useCallback(() => setSettingsOpen(false), [setSettingsOpen]));
  useEffect(() => { if (settingsOpen) listSavedReports().then((x) => setReportCount(x.length)).catch(() => setReportCount(0)); }, [settingsOpen]);
  useEffect(() => { const sync = () => { setAi(readAIConfig()); setApiKey(readOpenAIKey()); }; window.addEventListener(AI_EVENT, sync); return () => window.removeEventListener(AI_EVENT, sync); }, []);
  if (!settingsOpen) return null;
  const T: { k: keyof typeof thresholds; label: string; pct?: boolean; help: string }[] = [
    { k: 'deadSlotFill', label: 'Dead slot fill below', pct: true, help: 'Flags recurring classes that are persistently underfilled.' }, { k: 'deadSlotMinOccurrences', label: 'Dead slot min occurrences', help: 'Minimum sample before a recurring slot can be flagged.' },
    { k: 'slotDeclinePp', label: 'Slot decline', pct: true, help: 'Period-over-period fill loss that triggers attention.' }, { k: 'waitlistMin', label: 'Waitlist overbooked count', help: 'Demand above capacity needed to flag an expansion opportunity.' },
    { k: 'dependencyShare', label: 'Trainer dependency share', pct: true, help: 'Share of a format or location attached to one trainer.' }, { k: 'conversionSigma', label: 'Conversion outlier σ', help: 'Distance from peer conversion needed to flag an outlier.' },
    { k: 'secondVisitFloor', label: 'Second-visit floor', pct: true, help: 'Minimum acceptable return after a first visit.' }, { k: 'leadResponseHours', label: 'Lead response SLA (hours)', help: 'Target elapsed time to first contact.' },
    { k: 'untouchedHours', label: 'Untouched lead age (hours)', help: 'How long a lead can remain without an interaction.' }, { k: 'discountCreepPp', label: 'Discount creep', pct: true, help: 'Increase in discount rate that triggers a warning.' },
    { k: 'dormantDays', label: 'Dormant member days', help: 'No-visit interval used for reactivation worklists.' }, { k: 'zeroUsageDays', label: 'Zero-usage grace days', help: 'Elapsed membership days before zero usage becomes risky.' },
    { k: 'expiryCliffShare', label: 'Expiry cliff share', pct: true, help: 'Share expiring together that creates renewal concentration risk.' }, { k: 'utilisationFloor', label: 'Utilisation floor', pct: true, help: 'Minimum package utilisation before churn risk rises.' },
    { k: 'noShowRate', label: 'No-show cluster rate', pct: true, help: 'Rate that flags a class or member cluster.' }, { k: 'mixShiftPp', label: 'Mix shift', pct: true, help: 'Change in product or format mix worth surfacing.' },
    { k: 'integrityVariance', label: 'Integrity variance', pct: true, help: 'Tolerance used by source reconciliation checks.' }, { k: 'riskHigh', label: 'High-risk score', help: 'Member-risk score at which intervention becomes urgent.' },
    { k: 'matureDays', label: 'Mature acquisition days', help: 'Days allowed before judging conversion or retention.' }, { k: 'medianFirstMembership', label: 'First membership baseline (₹)', help: 'Scenario baseline used when observed values are unavailable.' },
    { k: 'coverageFloor', label: 'Minimum data coverage', pct: true, help: 'Coverage below which a metric is explicitly cautioned.' },
    { k: 'durationDefaultMin', label: 'Assumed class length (minutes)', help: 'Used for hours-based metrics wherever the source records no usable duration.' },
  ];
  const saveAi = () => { saveAISettings(ai, apiKey.trim()); setSaved(true); window.setTimeout(() => setSaved(false), 2000); };
  return (
    <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="settings-panel slide-in" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="settings-head"><div><span className="eyebrow">Workspace controls</span><h2>Settings</h2><p>AI, analytical assumptions, insight policy, appearance, data and local storage.</p></div><button className="btn btn-xs" onClick={() => setSettingsOpen(false)}>Close</button></div>

        <section className="settings-section" id="ai-settings"><div className="settings-section-head"><div><h3>AI intelligence</h3><p>Use your own OpenAI key for smarter reports and saved insights. The key goes directly from this browser to the configured endpoint.</p></div><span className={`status-pill ${readOpenAIKey() ? 'pos' : 'warn'}`}>{readOpenAIKey() ? 'Configured' : 'Not configured'}</span></div>
          <label className="settings-field"><span>OpenAI API key<small>Stored only for this browser session unless “remember” is enabled.</small></span><div className="settings-inline"><input className="input" type={showKey ? 'text' : 'password'} autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" /><button className="btn btn-xs" onClick={() => setShowKey((x) => !x)}>{showKey ? 'Hide' : 'Show'}</button></div></label>
          <label className="settings-field"><span>Model<small>A smaller model is quicker; a larger reasoning model may give deeper interpretation.</small></span><select className="input" value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })}><option value="gpt-4.1-mini">gpt-4.1-mini</option><option value="gpt-4.1">gpt-4.1</option><option value="gpt-5-mini">gpt-5-mini</option><option value="gpt-5">gpt-5</option></select></label>
          <label className="settings-field"><span>API base URL<small>Leave unchanged for OpenAI; compatible gateways may use another HTTPS endpoint.</small></span><input className="input" value={ai.baseUrl} onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })} /></label>
          <label className="report-option"><input type="checkbox" checked={ai.rememberKey} onChange={(e) => setAi({ ...ai, rememberKey: e.target.checked })} /><span><b>Remember API key on this device</b><small>Uses browser local storage. Leave off on shared computers.</small></span></label>
          <div className="settings-actions"><button className="btn btn-primary" onClick={saveAi}>Save AI configuration</button><button className="btn" onClick={() => { clearAIKey(); setApiKey(''); }}>Remove key</button>{saved && <span className="t-label-m pos">Saved</span>}</div>
          <div className="privacy-note"><b>Privacy:</b> only compact, scoped aggregates and report evidence are sent for AI generation—not the API key and not the full raw source sheets. Evidence can include entity labels or member names already present in a report worklist. Deterministic reports work without AI.</div>
        </section>

        <section className="settings-section"><div className="settings-section-head"><div><h3>Economics & report assumptions</h3><p>Changes recompute cards, tables, insights and custom reports immediately.</p></div></div>
          <label className="settings-field"><span>Assumed trainer rate per session<small>Used where the payroll source has no directly observed session cost.</small></span><div><div className="t-display-s tabular">₹{ratePerSession.toLocaleString('en-IN')}</div><input type="range" min={300} max={4000} step={50} value={ratePerSession} onChange={(e) => setRate(+e.target.value)} /></div></label>
        </section>

        <section className="settings-section"><div className="settings-section-head"><div><h3>Insight thresholds</h3><p>Fine-tune when deterministic alerts fire. Percent inputs are percentage points.</p></div></div>
          <div className="threshold-grid">{T.map((t) => <label key={t.k}><span>{t.label}<small>{t.help}</small></span><div className="number-suffix"><input className="input" type="number" step={t.pct ? 1 : 1} value={t.pct ? Number((thresholds[t.k] * 100).toFixed(1)) : thresholds[t.k]} onChange={(e) => setThresholds({ [t.k]: t.pct ? +e.target.value / 100 : +e.target.value })} />{t.pct && <i>%</i>}</div></label>)}</div>
          <button className="btn btn-xs" onClick={() => setThresholds({ ...DEFAULT_THRESHOLDS })}>Restore recommended thresholds</button>
        </section>

        <section className="settings-section"><div className="settings-section-head"><div><h3>Appearance & comparison</h3><p>Presentation preferences are stored on this device.</p></div></div>
          <label className="settings-field"><span>Theme</span><select className="input" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>{THEMES.map((t) => <option key={t.id} value={t.id}>{t.label} — {t.dark ? 'dark' : 'light'}</option>)}</select></label>
          <label className="settings-field"><span>Table density</span><select className="input" value={density} onChange={(e) => setDensity(e.target.value as typeof density)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option><option value="dense">Dense</option></select></label>
          <label className="report-option"><input type="checkbox" checked={comparison} onChange={toggleComparison} /><span><b>Show period comparisons</b><small>Add prior-period values beneath metrics and table cells.</small></span></label>
        </section>

        <section className="settings-section"><div className="settings-section-head"><div><h3>Data & local storage</h3><p>{loads.filter((x) => x.status === 'ok').length} sources loaded · {loads.filter((x) => x.status === 'error').length} unavailable · {reportCount} saved report {reportCount === 1 ? 'copy' : 'copies'}.</p></div></div>
          <div className="settings-actions"><button className="btn" disabled={status === 'loading'} onClick={async () => { await clearCache(); load(true); }}>{status === 'loading' ? 'Refreshing…' : 'Clear source cache & refresh'}</button><button className="btn" disabled={!reportCount} onClick={async () => { if (confirm('Delete all saved report copies from this browser?')) { await clearSavedReports(); setReportCount(0); } }}>Delete saved reports</button></div>
          <div className="privacy-note">Raw source cache, saved views, AI insight cache and saved reports stay in this browser. Download report HTML or JSON before clearing browser storage if you need an external copy.</div>
        </section>
      </div>
    </div>
  );
}
