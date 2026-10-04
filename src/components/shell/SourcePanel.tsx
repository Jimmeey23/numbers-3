import { useCallback, useState } from 'react';
import { useOverlay } from '../../state/overlays';
import type { SheetLoad } from '../../data/types';
import { configFor, parseSpreadsheetId, readOverrides, testSource, writeOverride, type SourceOverride } from '../../data/sources';
import { sheetUiUrl } from '../../data/sheets.config';
import { useData } from '../../state/data';

/** Everything an operator needs to get a blocked sheet loading, without a rebuild. */
export function SourceFixer({ load }: { load: SheetLoad }) {
  const cfg = configFor(load.key);
  const reload = useData((s) => s.load);
  const existing = readOverrides()[load.key];
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(existing?.url ?? (existing?.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${existing.spreadsheetId}/edit` : ''));
  const [title, setTitle] = useState(existing?.title ?? cfg.title);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useOverlay(open, useCallback(() => setOpen(false), []));

  const build = (): SourceOverride | null => {
    const v = value.trim();
    if (!v) return null;
    if (/[?&]tqx=out:csv|format=csv|\.csv($|\?)/.test(v)) return { url: v };
    const id = parseSpreadsheetId(v);
    return id ? { spreadsheetId: id, title: title.trim() || cfg.title } : null;
  };
  const run = async () => {
    const o = build();
    if (!o) { setResult({ ok: false, message: 'Paste a Google Sheets link, a spreadsheet ID, or a direct CSV URL.' }); return; }
    setBusy(true);
    setResult(await testSource(cfg, o));
    setBusy(false);
  };
  const save = () => { const o = build(); if (o) { writeOverride(load.key, o); reload(true); } };

  return (
    <div className="source-fixer">
      <div className="source-fixer-head">
        <span className="t-heading-s">How to fix {cfg.title}</span>
        {existing && <span className="status-pill hue">Custom source</span>}
        <div style={{ flex: 1 }} />
        <a className="btn btn-xs" href={sheetUiUrl(cfg.spreadsheetId)} target="_blank" rel="noreferrer">Open the spreadsheet</a>
        <button className="btn btn-xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Hide' : 'Point at another source'}</button>
      </div>
      <ol className="source-steps t-body-s">
        <li>Open the spreadsheet, then <b>Share</b> → <b>General access</b> → <b>Anyone with the link</b>, role <b>Viewer</b> → <b>Done</b>.</li>
        <li>Come back here and press <b>Refresh</b> in the title bar.</li>
        <li>If your workspace blocks link sharing, either copy the tab into a shareable spreadsheet, or use <b>File → Share → Publish to web → CSV</b> and paste that link below.</li>
      </ol>
      {open && (
        <div className="source-form">
          <label className="t-label-s muted">Spreadsheet link, ID, or a direct CSV URL
            <input className="input" style={{ width: '100%', marginTop: 4 }} value={value} onChange={(e) => { setValue(e.target.value); setResult(null); }}
              placeholder="https://docs.google.com/spreadsheets/d/…  ·  or a published CSV link" />
          </label>
          <label className="t-label-s muted">Tab name
            <input className="input" style={{ width: '100%', marginTop: 4 }} value={title} onChange={(e) => { setTitle(e.target.value); setResult(null); }} placeholder={cfg.title} />
          </label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-xs" onClick={run} disabled={busy}>{busy ? 'Testing…' : 'Test this source'}</button>
            <button className="btn btn-primary btn-xs" onClick={save} disabled={!result?.ok}>Use it and reload</button>
            {existing && <button className="btn btn-xs" onClick={() => { writeOverride(load.key, null); setValue(''); setResult(null); reload(true); }}>Reset to default</button>}
            <span className="t-label-s faint">Expected columns: {cfg.required.join(', ')}</span>
          </div>
          {result && <div className={`t-body-s ${result.ok ? 'pos' : 'neg'}`}>{result.ok ? '✓ ' : '✕ '}{result.message}</div>}
        </div>
      )}
    </div>
  );
}
