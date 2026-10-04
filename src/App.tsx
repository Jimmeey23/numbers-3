import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { TitleBar, SideNav, TabRail, PageHeader, InsightRail, StatusBar, CommandPalette, SettingsPanel } from './components/shell/Shell';
import { FilterStrip } from './components/shell/FilterDrawer';
import { TooltipLayer } from './components/Tooltip/Tooltip';
import { DrillPanel } from './components/DrillPanel/DrillPanel';
import { isHardRefresh, useData, useScope, type Scope } from './state/data';
import { useEscapeClosesEverything } from './state/overlays';
import { encodeFilters, useFilters } from './state/filters';
import { TABS, useView, type TabId } from './state/view';
import { THEMES } from './design/ramps';
import { useDrill } from './state/drill';
import { SHEETS } from './data/sheets.config';
import { TabFooter } from './components/shell/TabFooter';
import { buildTabPayload, readApiRequest } from './api/endpoint';
import { buildAgentApi } from './api/agent';
import { AskDock, AskPanel } from './components/Ask/AskPanel';
import { ReportDialog } from './components/Report/ReportDialog';
import { ask as askQuestion } from './api/ask';
import { TableSummaryEnhancer } from './components/TableSummaryEnhancer';

const LAZY: Record<TabId, () => Promise<{ default: ComponentType<{ scope: Scope }> }>> = {
  overview: () => import('./tabs/Overview').then((m) => ({ default: m.Overview })),
  classes: () => import('./tabs/Classes').then((m) => ({ default: m.Classes })),
  slots: () => import('./tabs/Slots').then((m) => ({ default: m.Slots })),
  trainers: () => import('./tabs/Trainers').then((m) => ({ default: m.Trainers })),
  sales: () => import('./tabs/Sales').then((m) => ({ default: m.Sales })),
  acquisition: () => import('./tabs/Acquisition').then((m) => ({ default: m.Acquisition })),
  retention: () => import('./tabs/Retention').then((m) => ({ default: m.Retention })),
  bookings: () => import('./tabs/Bookings').then((m) => ({ default: m.Bookings })),
  leads: () => import('./tabs/Leads').then((m) => ({ default: m.Leads })),
  attendance: () => import('./tabs/Attendance').then((m) => ({ default: m.Attendance })),
  payroll: () => import('./tabs/Payroll').then((m) => ({ default: m.Payroll })),
  'late-cancellations': () => import('./tabs/LateCancellations').then((m) => ({ default: m.LateCancellations })),
  'format-comparison': () => import('./tabs/FormatComparison').then((m) => ({ default: m.FormatComparison })),
  health: () => import('./tabs/DataHealth').then((m) => ({ default: m.DataHealth })),
};
const COMPONENTS = Object.fromEntries(Object.entries(LAZY).map(([k, l]) => [k, lazy(l)])) as Record<TabId, React.LazyExoticComponent<ComponentType<{ scope: Scope }>>>;

function useKeyboard() {
  const { setTab, toggleRail, setDensity, density, setTheme, theme, toggleComparison, setPaletteOpen, setFiltersOpen, filtersOpen } = useView();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement; const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const tab = TABS.find((x) => x.key === e.key); if (tab) { setTab(tab.id); return; }
      switch (e.key) {
        case 'f': case 'F': setFiltersOpen(!filtersOpen); break;
        case 's': case 'S': toggleRail(); break;
        case 'd': case 'D': setDensity(density === 'compact' ? 'dense' : density === 'dense' ? 'comfortable' : 'compact'); break;
        case 't': case 'T': { const ids = THEMES.map((x) => x.id); setTheme(ids[(ids.indexOf(theme) + 1) % ids.length]); break; }
        case 'c': case 'C': toggleComparison(); break;
        case '/': { e.preventDefault(); const el = document.querySelector<HTMLInputElement>('input[aria-label="Search rows"]'); el?.focus(); break; }
        case 'a': case 'A': useView.getState().setAskOpen(!useView.getState().askOpen); break;
        case 'r': case 'R': useView.getState().setReportOpen(!useView.getState().reportOpen); break;
        case 'Escape': useDrill.getState().close(); setPaletteOpen(false); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTab, toggleRail, setDensity, density, setTheme, theme, toggleComparison, setPaletteOpen, setFiltersOpen, filtersOpen]);
}

function useUrlSync() {
  const filters = useFilters((s) => s.filters); const tab = useView((s) => s.tab);
  useEffect(() => { const qs = encodeFilters(filters); const hash = `#/${tab}${qs ? `?${qs}` : ''}`; if (window.location.hash !== hash) history.replaceState(null, '', hash); }, [filters, tab]);
}

function LoadingScreen() {
  const loads = useData((s) => s.loads);
  return (
    <div className="rise" style={{ padding: '60px 0', display: 'grid', gap: 18, maxWidth: 760 }}>
      <div>
        <span className="eyebrow">Initialising</span>
        <div className="t-display-m" style={{ marginTop: 6 }}>Reading Atlas</div>
        <div className="t-body-m muted" style={{ marginTop: 8, maxWidth: '62ch' }}>
          Ten tabs across six spreadsheets, resolved by title. The structure renders now; every value animates in as its sheet lands.
        </div>
      </div>
      <div className="travel-barre" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 8 }}>
        {loads.map((l) => (
          <div key={l.key} className="t-label-m" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 14px', border: '1px solid var(--hairline)', borderRadius: 'var(--r-m)', background: 'color-mix(in oklab, var(--surface-1) 70%, transparent)' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</span>
            <span className={l.status === 'ok' ? 'pos' : l.status === 'error' ? 'neg' : l.status === 'derived' ? 'warn' : 'faint'}>
              {l.status === 'pending' ? 'reading…' : l.status === 'ok' ? `${l.rows.toLocaleString('en-IN')} rows` : l.status === 'derived' ? 'derived' : l.status === 'unused' ? 'not used' : l.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorScreen({ error }: { error: string }) {
  const load = useData((s) => s.load);
  return (
    <div className="rise" style={{ padding: '60px 0', maxWidth: 660, display: 'grid', gap: 14 }}>
      <div>
        <span className="eyebrow" style={{ color: 'var(--neg)' }}>Source failure</span>
        <div className="t-display-m" style={{ marginTop: 6 }}>The data layer failed to initialise</div>
      </div>
      <p className="t-body-m muted" style={{ margin: 0 }}>{error}</p>
      <p className="t-body-s muted" style={{ margin: 0 }}>Each sheet is read with <code>{SHEETS[0].title}</code>-style title resolution from docs.google.com. Check that this browser can reach Google, then retry.</p>
      <div><button className="btn btn-primary" onClick={() => load(true)}>Retry now</button></div>
    </div>
  );
}

function BlockedBanner() {
  const loads = useData((s) => s.loads);
  const tab = useView((s) => s.tab);
  const setTab = useView((s) => s.setTab);
  const [hidden, setHidden] = useState(false);
  const blocked = loads.filter((l) => l.status === 'error');
  const derived = loads.filter((l) => l.status === 'derived');
  if (hidden || tab === 'health' || !blocked.length) return null;
  return (
    <div className="blocked-banner">
      <span className="status-pill neg">{blocked.length} sheet{blocked.length > 1 ? 's' : ''} blocked</span>
      <span className="t-body-s">
        <b>{blocked.map((l) => l.title).join(', ')}</b> returned 401 — the spreadsheet is private, so the browser cannot read it.
        {derived.length > 0 && ' The session grain shown here is rebuilt from Checkins in the meantime.'}
      </span>
      <div style={{ flex: 1 }} />
      <button className="btn btn-xs" onClick={() => setTab('health')}>Fix it</button>
      <button className="btn-ghost btn-xs" onClick={() => setHidden(true)} aria-label="Dismiss">×</button>
    </div>
  );
}

/* API mode. `?api=<tab>` turns the page into that tab's endpoint: the shell never mounts, the data
   loads exactly as it would for a person, and the document body is the JSON response. */
function ApiResponse({ request }: { request: NonNullable<ReturnType<typeof readApiRequest>> }) {
  const { status, error, load } = useData();
  const scope = useScope();
  const thresholds = useView((s) => s.thresholds);
  const setFilters = useFilters((s) => s.set);
  useEffect(() => { load(isHardRefresh()); }, [load]);
  const body = useMemo(() => {
    if (status === 'error') return JSON.stringify({ endpoint: request.tab, error: error ?? 'Load failed' }, null, 2);
    if (!scope) return JSON.stringify({ endpoint: request.tab, status: 'loading', note: 'Poll until status is "ok".' }, null, 2);
    const api = buildAgentApi(scope, thresholds, (patch) => setFilters(patch as never));
    return JSON.stringify({ status: 'ok', ...buildTabPayload(api, scope, request) }, null, 2);
  }, [status, error, scope, thresholds, setFilters, request]);
  useEffect(() => {
    document.title = `Atlas API · ${request.tab}`;
    /* Published for a driver that would rather read a value than scrape the DOM. */
    (window as unknown as Record<string, unknown>).atlasApiResponse = body;
  }, [body, request.tab]);
  return <pre id="atlas-api" data-status={scope ? 'ok' : status} style={{ margin: 0, padding: 16, whiteSpace: 'pre-wrap', wordBreak: 'break-word', font: '12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace' }}>{body}</pre>;
}

export default function App() {
  const apiRequest = useMemo(() => readApiRequest(), []);
  if (apiRequest) return <ApiResponse request={apiRequest} />;
  return <Workspace />;
}

function Workspace() {
  const { status, error, load } = useData();
  const scope = useScope();
  const tab = useView((s) => s.tab);
  const [swapping, setSwapping] = useState(false);
  const prevSig = useRef('');
  useKeyboard(); useUrlSync();
  // Publish the agent surface. Rebuilt whenever the scope changes so an agent always reads
  // exactly what the operator is looking at.
  const setFilters = useFilters((s2) => s2.set);
  const thresholds = useView((s2) => s2.thresholds);
  useEffect(() => {
    if (!scope) return;
    const api = buildAgentApi(scope, thresholds, (patch) => setFilters(patch as never));
    // Same resolver the in-app Ask uses, so an external agent gets identical answers.
    (api as unknown as Record<string, unknown>).ask = (q: string) => askQuestion(q, scope, thresholds);
    (window as unknown as Record<string, unknown>).atlas = api;
    window.dispatchEvent(new CustomEvent('atlas:ready', { detail: { version: api.version } }));
  }, [scope, thresholds, setFilters]);
  /* Cached sheets are reused on every ordinary page load. Only a hard refresh goes back to the
     network on its own; everything else waits for the Reload button. */
  useEffect(() => { load(isHardRefresh()); }, [load]);
  useEscapeClosesEverything();   // one Escape closes every open overlay, whatever has focus
  useEffect(() => { const h = () => { const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0] as TabId; if (TABS.some((t) => t.id === hash)) useView.getState().setTab(hash); }; window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  // 90ms crossfade on scope change, no layout shift
  const sig = scope ? `${scope.period.start}${scope.period.end}${JSON.stringify(scope.filters)}${scope.ctx.ratePerSession}` : '';
  useEffect(() => { if (prevSig.current && prevSig.current !== sig) { setSwapping(true); const id = window.setTimeout(() => setSwapping(false), 90); return () => window.clearTimeout(id); } prevSig.current = sig; }, [sig]);
  useEffect(() => { prevSig.current = sig; }, [sig]);
  // prefetch on hover handled by tab rail via lazy import warmup
  useEffect(() => { const id = window.setTimeout(() => { for (const k of Object.keys(LAZY) as TabId[]) if (k !== tab) LAZY[k](); }, 2500); return () => window.clearTimeout(id); }, [tab]);
  const Tab = COMPONENTS[tab];
  const domain = useMemo(() => TABS.find((t) => t.id === tab)?.domain ?? 'attendance', [tab]);
  return (
    <div className="app-shell" data-domain={domain} data-tab={tab}>
      <SideNav />
      <div className="app-body">
        <TitleBar />
        <FilterStrip />
        <TabRail />
        <div className="work-row">
          <main id="canvas" className={`canvas ${swapping ? 'dim fade-swap' : 'fade-swap'}`} aria-busy={swapping || status === 'loading'}>
            {swapping && <div className="travel-barre" style={{ position: 'sticky', top: 0, zIndex: 5 }} />}
            <BlockedBanner />
            {status === 'error' && error ? <ErrorScreen error={error} /> : !scope ? <LoadingScreen /> : (
              <>
                <PageHeader />
                <Suspense fallback={<div style={{ padding: '24px 0' }}><div className="travel-barre" /></div>}>
                  <Tab key={tab} scope={scope} />
                </Suspense>
              </>
            )}
            {scope && status !== 'error' && <TabFooter tab={tab} scope={scope} />}
          </main>
          <InsightRail />
        </div>
        <StatusBar />
      </div>
      <TooltipLayer />
      <TableSummaryEnhancer />
      <DrillPanel />
      <AskDock />
      <AskPanel />
      <ReportDialog />
      <CommandPalette />
      <SettingsPanel />
      <div className="sr-only" aria-live="polite">{scope ? `${scope.rowsInScope.toLocaleString('en-IN')} rows in scope for ${scope.period.label}` : ''}</div>
    </div>
  );
}
