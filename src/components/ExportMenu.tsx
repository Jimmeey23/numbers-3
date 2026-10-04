import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverlay } from '../state/overlays';
import { FORMATS, runExport, type ExportFormat, type ExportPayload } from '../api/export';
import { useView } from '../state/view';

/** One export control, used by every chart, table and tab header. */
export function ExportMenu({ payload, label = 'Export', compact = true, extra }: { payload: () => ExportPayload; label?: string; compact?: boolean; extra?: { label: string; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const announce = useView((s) => s.announce);
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(open, useCallback(() => setOpen(false), []));
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const go = async (f: ExportFormat) => {
    setOpen(false);
    try { announce(await runExport(payload(), f)); }
    catch (e) { announce(`Export failed: ${(e as Error).message}`); }
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={`btn ${compact ? 'btn-xs' : ''}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} title="Export this view">
        ↓ {label}
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onClick={() => setOpen(false)} />
          <div className="surface menu export-menu" role="menu">
            <div className="menu-label">Download</div>
            {FORMATS.filter((f) => f.id !== 'clipboard' && f.id !== 'print').map((f) => (
              <button key={f.id} role="menuitem" className="export-item" onClick={() => go(f.id)}>
                <span className="t-label-m">{f.label}</span>
                <span className="t-label-s faint">{f.hint}</span>
              </button>
            ))}
            <div className="menu-label" style={{ marginTop: 4 }}>Other</div>
            {FORMATS.filter((f) => f.id === 'clipboard' || f.id === 'print').map((f) => (
              <button key={f.id} role="menuitem" className="export-item" onClick={() => go(f.id)}>
                <span className="t-label-m">{f.label}</span>
                <span className="t-label-s faint">{f.hint}</span>
              </button>
            ))}
            {extra?.map((x) => (
              <button key={x.label} role="menuitem" className="export-item" onClick={() => { setOpen(false); x.run(); }}>
                <span className="t-label-m">{x.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
