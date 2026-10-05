import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOverlay } from '../../state/overlays';
import { generateAIReport, readAIConfig, readOpenAIKey, reportFingerprint } from '../../ai/client';
import { renderReport } from '../../report/shell';
import { buildReport, CHAPTERS, type ChapterId, type ReportModel } from '../../report/model';
import { deleteSavedReport, findSavedReport, listSavedReports, saveReport, type SavedReport } from '../../report/store';
import { computeScope, useData, useScope } from '../../state/data';
import { useFilters } from '../../state/filters';
import { useView } from '../../state/view';
import ReportWorker from '../../report/worker?worker&inline';
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 20)));
function buildOffThread(scope: NonNullable<ReturnType<typeof useScope>>, thresholds: ReturnType<typeof useView.getState>['thresholds'], studio: string, onStage: (s: string) => void): Promise<ReportModel> {
  if (typeof Worker === 'undefined') return Promise.resolve(buildReport(scope, thresholds, studio));
  return new Promise((resolve, reject) => {
    const worker = new ReportWorker();
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('Report calculation exceeded two minutes. Narrow the scope or retry.')); }, 120_000);
    worker.onmessage = (e: MessageEvent<{ type: string; stage?: string; model?: ReportModel; message?: string }>) => {
      if (e.data.type === 'stage' && e.data.stage) onStage(e.data.stage);
      if (e.data.type === 'done' && e.data.model) { window.clearTimeout(timeout); worker.terminate(); resolve(e.data.model); }
      if (e.data.type === 'error') { window.clearTimeout(timeout); worker.terminate(); reject(new Error(e.data.message ?? 'The report worker failed.')); }
    };
    worker.onerror = (e) => { window.clearTimeout(timeout); worker.terminate(); reject(new Error(e.message || 'The report worker could not start.')); };
    worker.postMessage({ scope, thresholds, studio });
  });
}

export function ReportDialog() {
  const { reportOpen, setReportOpen, setSettingsOpen, thresholds, ratePerSession } = useView();
  const current = useScope(); const dataset = useData((s) => s.dataset); const filters = useFilters((s) => s.filters);
  const [studio, setStudio] = useState('Physique 57 India');
  const [period, setPeriod] = useState<'current' | 'last90' | 'ytd' | 'custom'>('current');
  const [customStart, setCustomStart] = useState(''); const [customEnd, setCustomEnd] = useState('');
  const [locations, setLocations] = useState<string[]>(filters.locations); const [formats, setFormats] = useState<string[]>(filters.formats);
  const [selected, setSelected] = useState<ChapterId[]>(CHAPTERS.map((c) => c.id));
  const [includeMom, setIncludeMom] = useState(true);
  const [model, setModel] = useState<ReportModel | null>(null);
  const [generating, setGenerating] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [library, setLibrary] = useState<SavedReport[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const available = useMemo(() => {
    if (!dataset) return { locations: [] as string[], formats: [] as string[] };
    const dimensionRows = [...dataset.sessions, ...dataset.checkins, ...dataset.sales, ...dataset.newc, ...dataset.lapsed];
    return { locations: [...new Set(dimensionRows.map((r) => r.location).filter((x): x is string => Boolean(x)))].sort(),
      formats: [...new Set(dimensionRows.map((r) => r.format).filter((x): x is Exclude<typeof x, null> => Boolean(x) && x !== 'Unknown'))].sort() };
  }, [dataset]);
  const range = useMemo(() => {
    const end = current?.period.end ?? new Date().toISOString().slice(0, 10);
    if (period === 'current') return { start: current?.period.start ?? end, end };
    if (period === 'last90') { const d = new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 89); return { start: d.toISOString().slice(0, 10), end }; }
    if (period === 'custom') return { start: customStart || current?.period.start || end, end: customEnd || end };
    return { start: `${end.slice(0, 4)}-01-01`, end };
  }, [period, customStart, customEnd, current?.period.start, current?.period.end]);
  const scope = useMemo(() => dataset ? computeScope(dataset, { ...filters, locations, formats, preset: 'custom', start: range.start, end: range.end }, ratePerSession, thresholds) : null,
    [dataset, filters, locations, formats, range.start, range.end, ratePerSession, thresholds]);
  const html = useMemo(() => model ? renderReport({ ...model, chapters: model.chapters.filter((c) => selected.includes(c.id)), appendix: includeMom ? model.appendix : [] }) : '', [model, selected, includeMom]);

  useEffect(() => { if (filters.locations.length === 1) setStudio(filters.locations[0]); else setStudio('Physique 57 India'); }, [filters.locations]);
  useEffect(() => { if (reportOpen) { setLocations(filters.locations); setFormats(filters.formats); setCustomStart(current?.period.start ?? ''); setCustomEnd(current?.period.end ?? ''); setModel(null); } }, [reportOpen, filters.locations, filters.formats, current?.period.start, current?.period.end]);
  useEffect(() => { if (!reportOpen) { setPreview(false); setError(''); setNotice(''); } }, [reportOpen]);
  useEffect(() => { if (!reportOpen) return; listSavedReports().then(setLibrary).catch(() => setLibrary([])); }, [reportOpen]);
  useOverlay(reportOpen, useCallback(() => { if (preview) setPreview(false); else setReportOpen(false); }, [preview, setReportOpen]));

  if (!reportOpen) return null;
  const toggle = (id: ChapterId) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const prepare = async () => {
    setGenerating(true); setError(''); setNotice(''); setStage('Preparing scoped rows…'); await nextPaint();
    try {
      setStage('Calculating chapters, comparisons and evidence…'); await nextPaint();
      if (!scope) throw new Error('The data scope is still loading. Wait a moment and try again.');
      const built = await buildOffThread(scope, thresholds, studio, setStage);
      setModel(built); setNotice('Deterministic report ready. Preview it now or add the saved AI intelligence layer.');
    } catch (e) { console.error('Report generation failed', e); setError(e instanceof Error ? e.message : 'The report could not be generated.'); }
    finally { setGenerating(false); setStage(''); }
  };
  const makeSmart = async () => {
    setGenerating(true); setError(''); setNotice('');
    try {
      let base = model;
      if (!base) { setStage('Calculating report evidence…'); await nextPaint(); if (!scope) throw new Error('The data scope is still loading.'); base = await buildOffThread(scope, thresholds, studio, setStage); setModel(base); }
      const config = readAIConfig(); setStage('Checking the saved report library…'); await nextPaint();
      const fingerprint = await reportFingerprint(base, config.model);
      let saved: SavedReport | null = null; try { saved = await findSavedReport(fingerprint); } catch { /* private browsing may block IndexedDB */ }
      if (saved?.model.ai) { setModel(saved.model); setNotice(`Reused the saved AI report from ${new Date(saved.createdAt).toLocaleString('en-IN')}. No OpenAI request was made.`); return; }
      if (!readOpenAIKey()) {
        // A report may have been generated on another device and saved in the dedicated AI cache.
        // generateAIReport checks that cache before asking for a key or spending tokens.
        setStage('Checking the cloud AI cache…');
      }
      setStage(`Asking ${config.model} to analyze the evidence…`); await nextPaint();
      const ai = await generateAIReport(base); const enhanced = { ...base, ai };
      setModel(enhanced);
      try { await saveReport(enhanced, fingerprint, true, config.model); setLibrary(await listSavedReports()); setNotice('AI report generated and saved. Repeating this exact scope will reuse this copy without another AI request.'); }
      catch { setNotice('AI report generated, but this browser blocked local report storage. Download a copy before closing it.'); }
    } catch (e) { console.error('AI report generation failed', e); setError(e instanceof Error ? e.message : 'AI report generation failed.'); }
    finally { setGenerating(false); setStage(''); }
  };
  const saveCurrent = async () => {
    if (!model) return; try { const f = await reportFingerprint(model, model.ai?.model ?? 'deterministic'); await saveReport(model, f, Boolean(model.ai), model.ai?.model); setLibrary(await listSavedReports()); setNotice('Report copy saved in this browser.'); } catch { setError('The browser could not save this report copy.'); }
  };
  const download = (kind: 'html' | 'json') => {
    if (!model) return; const body = kind === 'html' ? html : JSON.stringify(model, null, 2);
    const blob = new Blob([body], { type: kind === 'html' ? 'text/html' : 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `studio-report-${range.start}-${range.end}.${kind}`; a.click(); URL.revokeObjectURL(a.href);
  };

  if (preview && model) return <div className="report-preview" role="dialog" aria-modal="true" aria-label="Report preview">
    <div className="report-preview-bar"><div><b>{model.meta.title}</b><span>{model.ai ? `AI enhanced · ${model.ai.model}` : 'Deterministic analysis'} · {model.meta.periodLabel}</span></div><div className="report-preview-actions"><button onClick={() => download('html')}>Download HTML</button><button onClick={() => download('json')}>Download data</button><button onClick={() => setPreview(false)}>Back to setup</button><button className="primary" onClick={() => setReportOpen(false)}>Close</button></div></div>
    <iframe className="report-frame" title="Generated performance report" srcDoc={html} sandbox="allow-scripts allow-modals" />
  </div>;

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setReportOpen(false); }}><div className="report-dialog" role="dialog" aria-modal="true" aria-label="Custom report builder">
    <div className="report-dialog-head"><div><span className="eyebrow">Custom report</span><h2>Build the operating review you need</h2><p>First calculate the grounded report. OpenAI enhancement is optional, saved, and never silently rerun.</p></div><button className="icon-button" onClick={() => setReportOpen(false)} aria-label="Close">×</button></div>
    <div className="report-builder-grid"><section><h3>Report period</h3><div className="segment report-period"><button className={period === 'current' ? 'active' : ''} onClick={() => { setPeriod('current'); setModel(null); }}>Current</button><button className={period === 'last90' ? 'active' : ''} onClick={() => { setPeriod('last90'); setModel(null); }}>Last 90 days</button><button className={period === 'ytd' ? 'active' : ''} onClick={() => { setPeriod('ytd'); setModel(null); }}>Year to date</button><button className={period === 'custom' ? 'active' : ''} onClick={() => { setPeriod('custom'); setModel(null); }}>Custom</button></div>
      {period === 'custom' && <div className="report-date-fields"><label>Start<input className="input" type="date" value={customStart} onChange={(e) => { setCustomStart(e.target.value); setModel(null); }} /></label><label>End<input className="input" type="date" value={customEnd} onChange={(e) => { setCustomEnd(e.target.value); setModel(null); }} /></label></div>}
      <div className="report-scope"><b>{range.start}</b><span>to</span><b>{range.end}</b><small>{scope?.period.label ?? 'Loading scope…'}</small></div>
      <label className="report-field"><span className="t-label-s muted">Report title / studio</span><input className="input" value={studio} onChange={(e) => { setStudio(e.target.value); setModel(null); }} /></label>
      <h3>Locations <small className="muted">None selected = all</small></h3><div className="report-dimension-picker">{available.locations.map((x) => <label key={x}><input type="checkbox" checked={locations.includes(x)} onChange={() => { setLocations((v) => v.includes(x) ? v.filter((k) => k !== x) : [...v, x]); setModel(null); }} /><span>{x}</span></label>)}</div>
      <h3>Formats <small className="muted">None selected = all</small></h3><div className="report-dimension-picker">{available.formats.map((x) => <label key={x}><input type="checkbox" checked={formats.includes(x)} onChange={() => { setFormats((v) => v.includes(x) ? v.filter((k) => k !== x) : [...v, x]); setModel(null); }} /><span>{x}</span></label>)}</div>
      <h3>Chapters</h3><div className="chapter-picker">{CHAPTERS.map((c) => <label key={c.id}><input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} /><span>{c.title}</span></label>)}</div><label className="report-option"><input type="checkbox" checked={includeMom} onChange={(e) => setIncludeMom(e.target.checked)} /><span><b>Month-on-month appendix</b><small>Include every chapter's 14-month history grid.</small></span></label></section>
      <aside><div className="report-ready"><span className="report-ready-icon">{generating ? '···' : model ? (model.ai ? 'AI' : '✓') : '11'}</span><b>{generating ? stage : model ? (model.ai ? 'AI report ready' : 'Grounded report ready') : 'Eleven decision chapters'}</b><p>{generating ? 'Large data scopes are processed in phases. Keep this window open.' : model ? 'Preview, save, download, or enrich this exact evidence with OpenAI.' : 'Revenue, funnel, demand, engagement, retention, people economics, actions, outlook and methods.'}</p></div>
        {notice && <div className="report-notice">{notice}</div>}{error && <div className="report-error"><b>Could not complete the report</b><span>{error}</span>{error.includes('OpenAI API key') && <button className="btn btn-xs" onClick={() => setSettingsOpen(true)}>Open AI settings</button>}</div>}
        <button className="primary report-generate" disabled={generating || !selected.length} onClick={prepare}>{generating ? 'Working…' : model ? 'Recalculate grounded report' : 'Generate grounded report'}</button>
        <button className="report-ai-button" disabled={generating || !selected.length} onClick={makeSmart}>✦ {model?.ai ? 'Reuse / regenerate AI report' : 'Generate smarter report with AI'}</button>
        {model && <><button className="report-open-button" onClick={() => setPreview(true)}>Preview report</button><button className="report-open-button" onClick={saveCurrent}>Save a copy</button></>}
        <button className="report-open-button" onClick={() => setLibraryOpen((x) => !x)}>Saved reports <span>{library.length}</span></button>
        {libraryOpen && <div className="report-library">{library.length ? library.map((r) => <div key={r.id}><button onClick={() => { setModel(r.model); setNotice(`Loaded saved copy from ${new Date(r.createdAt).toLocaleString('en-IN')}.`); }}>{r.aiGenerated ? '✦' : '□'} <span><b>{r.title}</b><small>{new Date(r.createdAt).toLocaleString('en-IN')} · {r.scopeLine}</small></span></button><button aria-label="Delete saved report" onClick={async () => { await deleteSavedReport(r.id); setLibrary(await listSavedReports()); }}>×</button></div>) : <p>No saved report copies yet.</p>}</div>}
      </aside></div>
  </div></div>;
}
