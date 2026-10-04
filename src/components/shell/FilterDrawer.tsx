import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_FILTERS, resolvePeriod, useFilters, type Filters, type Preset } from '../../state/filters';
import { useData, useOptions } from '../../state/data';
import { useView } from '../../state/view';
import { fmtDate } from '../../semantics/formats';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'month', label: 'Last month' }, { id: 'mtd', label: 'Month to date' }, { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' }, { id: 'quarter', label: 'Quarter' }, { id: 'ytd', label: 'Year to date' },
  { id: '12m', label: 'Last 12 months' }, { id: 'all', label: 'All time' }, { id: 'custom', label: 'Custom' },
];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function Multi({ label, options, value, onChange }: { label: string; options: { value: string; n: number }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => (q ? options.filter((o) => o.value.toLowerCase().includes(q.toLowerCase())) : options), [options, q]);
  const all = value.length === 0;
  return (
    <div className="filter-group">
      <div className="filter-group-head">
        <span className="t-heading-s">{label}</span>
        <span className={`t-label-s ${all ? 'faint' : 'hue'}`}>{all ? 'All' : `${value.length} of ${options.length}`}</span>
        <div style={{ flex: 1 }} />
        <button className="btn-ghost t-label-s" onClick={() => onChange(options.map((o) => o.value))}>Select all</button>
        <button className="btn-ghost t-label-s" onClick={() => onChange([])}>Clear</button>
      </div>
      {options.length > 6 && <input className="input t-label-m" style={{ width: '100%', marginBottom: 4, height: 26 }} placeholder={`Search ${label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${label}`} />}
      <div className="filter-options">
        {shown.slice(0, 200).map((o) => (
          <label key={o.value} className="t-label-m filter-option" title={`${o.n.toLocaleString('en-IN')} matching rows`}>
            <input type="checkbox" checked={value.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))} />
            <span className="filter-option-label">{o.value}</span>
            <span className="faint tabular">{o.n >= 1000 ? `${(o.n / 1000).toFixed(o.n >= 10000 ? 0 : 1)}k` : o.n}</span>
          </label>
        ))}
        {!shown.length && <div className="faint t-label-s" style={{ padding: 4 }}>No match</div>}
        {shown.length > 200 && <div className="faint t-label-s" style={{ padding: 4 }}>{shown.length - 200} more — refine the search</div>}
      </div>
    </div>
  );
}

export function FilterStrip() {
  const { filters, set, reset, removeTransient, clearTransient, activeCount } = useFilters();
  const open = useView((s) => s.filtersOpen); const setOpen = useView((s) => s.setFiltersOpen);
  const ds = useData((s) => s.dataset);
  const opts = useOptions();
  const [draft, setDraft] = useState<Filters | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const f = draft ?? filters;
  const period = useMemo(() => (ds ? resolvePeriod(filters, ds.today) : null), [filters, ds]);
  const draftPeriod = useMemo(() => (ds ? resolvePeriod(f, ds.today) : null), [f, ds]);
  const count = activeCount();
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(filters);

  const close = () => { setDraft(null); setOpen(false); };
  const apply = () => { if (draft) set(draft); setDraft(null); setOpen(false); useView.getState().announce('Filters applied across every tab'); };

  // Esc closes and discards the draft; Enter applies.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); apply(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }); // re-bound each render so `draft` stays fresh

  const upd = (patch: Partial<Filters>) => setDraft({ ...f, ...patch });
  const chips = [
    period?.label,
    filters.locations.length ? `${filters.locations.length} location${filters.locations.length > 1 ? 's' : ''}` : 'All locations',
    filters.trainers.length ? `${filters.trainers.length} trainers` : null,
    filters.formats.length ? filters.formats.join(', ') : null,
    filters.sources.length ? `${filters.sources.length} sources` : null,
    filters.newVsReturning !== 'all' ? (filters.newVsReturning === 'new' ? 'New only' : 'Returning only') : null,
    filters.includeImports ? 'Imports included' : null,
    filters.compare === 'none' ? 'No comparison' : `vs ${period?.prevLabel}`,
  ].filter(Boolean) as string[];

  return (
    <div className="filter-strip">
      <div className="filter-bar" role="button" tabIndex={0} aria-expanded={open} aria-controls="filter-panel"
        onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setOpen(!open); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}>
        <span className={`caret ${open ? 'open' : ''}`} aria-hidden="true">▸</span>
        <span className="t-heading-s">Filters</span>
        <span className="filter-summary">
          {chips.map((c, i) => <span key={i} className="t-label-m summary-chip">{c}</span>)}
        </span>
        {filters.transient.length > 0 && (
          <span className="filter-transients">
            {filters.transient.map((t, i) => <span key={`${t.dim}${t.value}`} className="chip chip-transient t-label-s">{t.label ?? t.value}<button aria-label={`Remove filter ${t.value}`} onClick={() => removeTransient(i)}>×</button></span>)}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {count > 0 && <span className="t-label-s pill filter-count">{count} active</span>}
        {count > 0 && <button className="btn btn-xs" onClick={() => { reset(); clearTransient(); setDraft(null); }}>Clear all</button>}
        <button className="btn btn-xs" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit'} <span className="kbd">F</span></button>
      </div>

      {open && (
        <div id="filter-panel" ref={panelRef} className="filter-panel">
          <div className="filter-panel-body">
            <div className="filter-row">
              <div className="filter-group" style={{ minWidth: 300 }}>
                <div className="filter-group-head"><span className="t-heading-s">Period</span><span className="t-label-s faint">{draftPeriod?.label}</span></div>
                <div className="chip-row">{PRESETS.map((p) => <button key={p.id} className="btn btn-xs" aria-pressed={f.preset === p.id} onClick={() => upd({ preset: p.id })}>{p.label}</button>)}</div>
                {f.preset === 'custom' && <div style={{ display: 'flex', gap: 6, marginTop: 6 }}><input type="date" className="input" value={f.start ?? ''} onChange={(e) => upd({ start: e.target.value })} aria-label="Start date" /><input type="date" className="input" value={f.end ?? ''} onChange={(e) => upd({ end: e.target.value })} aria-label="End date" /></div>}
                {ds && <div className="t-label-s faint" style={{ marginTop: 6 }}>Data runs through {fmtDate(ds.today)}; relative periods key off that date, not the clock.</div>}
              </div>
              <div className="filter-group" style={{ minWidth: 260 }}>
                <div className="filter-group-head"><span className="t-heading-s">Compare to</span><span className="t-label-s faint">{f.compare === 'none' ? 'off' : draftPeriod?.prevLabel}</span></div>
                <div className="chip-row">{([['prior', 'Previous period'], ['yoy', 'Same period last year'], ['none', 'No comparison']] as const).map(([id, l]) => <button key={id} className="btn btn-xs" aria-pressed={f.compare === id} onClick={() => upd({ compare: id })}>{l}</button>)}</div>
                <div className="filter-group-head" style={{ marginTop: 10 }}><span className="t-heading-s">Audience</span></div>
                <div className="chip-row">{(['all', 'new', 'returning'] as const).map((id) => <button key={id} className="btn btn-xs" aria-pressed={f.newVsReturning === id} onClick={() => upd({ newVsReturning: id })}>{id === 'all' ? 'Everyone' : id === 'new' ? 'New only' : 'Returning only'}</button>)}</div>
                <label className="t-label-m" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
                  <input type="checkbox" checked={f.includeImports} onChange={(e) => upd({ includeImports: e.target.checked })} />
                  Include imported rows <span className="faint">historical backfill, ₹0</span>
                </label>
              </div>
            </div>
            <div className="filter-grid">
              <Multi label="Location" options={opts.locations} value={f.locations} onChange={(v) => upd({ locations: v })} />
              <Multi label="Trainer" options={opts.trainers} value={f.trainers} onChange={(v) => upd({ trainers: v })} />
              <Multi label="Class format" options={opts.formats} value={f.formats} onChange={(v) => upd({ formats: v })} />
              <Multi label="Membership type" options={opts.membershipTypes} value={f.membershipTypes} onChange={(v) => upd({ membershipTypes: v })} />
              <Multi label="Source" options={opts.sources} value={f.sources} onChange={(v) => upd({ sources: v })} />
              <Multi label="Day" options={DAYS.map((d) => ({ value: d, n: ds?.sessions.filter((r) => r.day === d).length ?? 0 }))} value={f.days} onChange={(v) => upd({ days: v })} />
              <Multi label="Time slot" options={['Morning', 'Afternoon', 'Evening'].map((d) => ({ value: d, n: ds?.sessions.filter((r) => r.slot === d).length ?? 0 }))} value={f.slots} onChange={(v) => upd({ slots: v })} />
            </div>
          </div>
          <div className="filter-actions">
            <button className="btn btn-primary" onClick={apply} disabled={!dirty}>{dirty ? 'Apply filters' : 'No changes'}</button>
            <button className="btn" onClick={close}>Cancel <span className="kbd">Esc</span></button>
            <button className="btn btn-ghost" onClick={() => setDraft({ ...DEFAULT_FILTERS })}>Reset to defaults</button>
            <div style={{ flex: 1 }} />
            <span className="t-label-s faint">Filters apply to every tab</span>
            <button className="btn btn-xs" onClick={() => { navigator.clipboard?.writeText(window.location.href); useView.getState().announce('Shareable link copied'); }}>Copy link</button>
          </div>
        </div>
      )}
    </div>
  );
}
