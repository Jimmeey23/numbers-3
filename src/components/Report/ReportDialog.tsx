import { useEffect, useMemo, useState } from 'react';
import { useScope } from '../../state/data';
import { useView } from '../../state/view';
import { useFilters } from '../../state/filters';
import { buildReport, CHAPTERS } from '../../report/model';
import { renderReport } from '../../report/shell';
import { downloadText } from '../hooks';
import { fmtCurrency } from '../../semantics/formats';

/** Generates the monthly report: seven chapters plus a month-on-month appendix, in one
 *  self-contained HTML file that opens from disk with nothing behind it. */
export function ReportDialog() {
  const open = useView((s) => s.reportOpen);
  const setOpen = useView((s) => s.setReportOpen);
  const thresholds = useView((s) => s.thresholds);
  const announce = useView((s) => s.announce);
  const scope = useScope();
  const filters = useFilters((s) => s.filters);
  const setFilters = useFilters((s) => s.set);
  const [studio, setStudio] = useState('Physique 57 India');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Name the report after the single location in scope, when there is one.
  useEffect(() => {
    if (filters.locations.length === 1) setStudio(filters.locations[0]);
    else setStudio('Physique 57 India');
  }, [filters.locations]);

  const model = useMemo(() => (open && scope ? buildReport(scope, thresholds, studio) : null), [open, scope, thresholds, studio]);

  if (!open) return null;
  const monthly = filters.preset === 'month';

  const html = () => renderReport(model!);
  const slug = `${studio.replace(/[^a-zA-Z0-9]+/g, '-')}-${scope?.period.start ?? ''}`.toLowerCase().replace(/^-|-$/g, '');

  return (
    <>
      <div className="ask-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className="report-panel slide-in" role="dialog" aria-label="Generate the monthly report">
        <div className="barre barre-glow" />
        <header className="ask-head">
          <div>
            <div className="t-heading-m">Monthly report</div>
            <div className="t-label-s muted">{scope ? `${scope.period.label} · compared with ${scope.period.prevLabel}` : 'Loading'}</div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-xs" onClick={() => setOpen(false)}>Close <span className="kbd">Esc</span></button>
        </header>

        <div className="report-body">
          {!monthly && (
            <div className="report-warn">
              <div className="t-body-s">
                The report is designed around a calendar month. The current period is <b>{scope?.period.label}</b>,
                so chapter headings and the comparison will read oddly.
              </div>
              <button className="btn btn-xs" onClick={() => setFilters({ preset: 'month' })}>Switch to last month</button>
            </div>
          )}

          <label className="report-field">
            <span className="t-label-s muted">Report title</span>
            <input className="input" value={studio} onChange={(e) => setStudio(e.target.value)} aria-label="Report title" />
          </label>

          <div className="report-toc">
            <div className="t-heading-xs muted" style={{ marginBottom: 8 }}>What the report contains</div>
            <ol className="report-chapters">
              {CHAPTERS.map((c, i) => {
                const ch = model?.chapters[i];
                return (
                  <li key={c.id}>
                    <span className="report-no">{c.no}</span>
                    <span className="report-ch-title">{c.title}</span>
                    <span className="t-label-s faint">
                      {ch ? [
                        ch.kpis.length ? `${ch.kpis.length} figures` : null,
                        ch.tables.length ? `${ch.tables.length} table${ch.tables.length > 1 ? 's' : ''}` : null,
                        ch.chart ? 'chart' : null,
                        ch.mom ? 'history' : null,
                      ].filter(Boolean).join(' · ') : '—'}
                    </span>
                  </li>
                );
              })}
              <li>
                <span className="report-no">08</span>
                <span className="report-ch-title">Month-on-month appendix</span>
                <span className="t-label-s faint">{model ? `${model.appendix.length} grids` : '—'}</span>
              </li>
            </ol>
          </div>

          {model && (
            <div className="report-summary">
              <div className="t-heading-xs muted" style={{ marginBottom: 8 }}>Headline, as it will print</div>
              <p className="t-body-s" style={{ margin: 0 }}>{model.chapters[0].narrative[0]}</p>
              {model.impact.length > 0 && (
                <div className="t-label-s muted" style={{ marginTop: 8 }}>
                  {model.impact.map((b) => `${b.basis === 'at-risk' ? 'Revenue at risk' : b.basis === 'sunk' ? 'Paid but unused' : 'Upside'} ${fmtCurrency(b.net)}`).join(' · ')}
                  {' · '}{model.actions.length} actions
                </div>
              )}
            </div>
          )}

          <div className="t-label-s faint">
            One self-contained HTML file — stylesheet and behaviour inlined, so it opens from disk with nothing
            behind it. Every figure is computed now, against the filters above; the report is a record of this
            scope rather than a live view.
          </div>
        </div>

        <div className="report-actions">
          <button className="btn btn-primary" disabled={!model} onClick={() => {
            const w = window.open('', '_blank');
            if (!w) { announce('Pop-up blocked — use Download instead'); return; }
            w.document.write(html()); w.document.close();
            announce('Report opened in a new tab');
          }}>Open the report</button>
          <button className="btn" disabled={!model} onClick={() => {
            downloadText(`${slug}-report.html`, html(), 'text/html');
            announce('Report downloaded');
          }}>Download HTML</button>
          <button className="btn" disabled={!model} onClick={() => {
            downloadText(`${slug}-report.json`, JSON.stringify(model, null, 2), 'application/json');
            announce('Report model downloaded');
          }}>Download JSON</button>
        </div>
      </aside>
    </>
  );
}
