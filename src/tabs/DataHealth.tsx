import { useMemo } from 'react';
import type { Scope } from '../state/data';
import { useData } from '../state/data';
import { Register, DataPanel } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { MetricCard } from '../components/MetricCard/MetricCard';
import { sheetUiUrl } from '../data/sheets.config';
import { SourceFixer } from '../components/shell/SourcePanel';
import { ENDPOINTS } from '../api/agent';
import { fmtAgo, fmtCurrency, formatValue } from '../semantics/formats';
import { metricValues } from '../semantics/aggregations';
import { useView } from '../state/view';
import { diverging, needsInvert } from '../design/ramps';
import { maxBy } from '../semantics/stats';

export function DataHealth({ scope }: { scope: Scope }) {
  const { loads, dataset: ds, load } = useData();
  const theme = useView((s) => s.theme);
  const totalRows = loads.reduce((a, l) => a + l.rows, 0);
  const completeness = useMemo(() => {
    if (!ds) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tables: { name: string; rows: any[]; keys: string[] }[] = [
      { name: 'Sessions', rows: ds.sessions, keys: ['session_id', 'trainer', 'capacity', 'checked_in', 'revenue', 'location', 'date', 'time'] },
      { name: 'Checkins', rows: ds.checkins, keys: ['member_id', 'session_id', 'email', 'paid', 'trainer', 'duration_min', 'category', 'class_no'] },
      { name: 'Sales', rows: ds.sales, keys: ['member_id', 'value', 'net', 'category', 'product', 'sold_by', 'location', 'discount_code'] },
      { name: 'New', rows: ds.newc, keys: ['member_id', 'email', 'phone', 'source', 'trainer', 'location', 'ltv', 'conversion_status'] },
      { name: 'Lapsed', rows: ds.lapsed, keys: ['member_id', 'email', 'status', 'sessions_limit', 'end_date', 'amount_paid', 'days_since_last_visit', 'location'] },
      { name: 'Payroll', rows: ds.payroll, keys: ['teacher_id', 'total_sessions', 'total_paid', 'month', 'location'] },
      { name: 'Leads', rows: ds.leads, keys: ['id', 'source_name', 'stage', 'status', 'associate'] },
    ];
    return tables.flatMap((t) => t.keys.map((k) => { let nulls = 0; let negatives = 0; let numeric = 0; let lo = Infinity; let hi = -Infinity; const seen = new Set<unknown>();
      for (const r of t.rows) { const v = r[k];
        if (v === null || v === undefined || v === '') { nulls++; continue; }
        if (seen.size < 5000) seen.add(v);
        if (typeof v === 'number') { numeric++; if (v < lo) lo = v; if (v > hi) hi = v; if (v < 0) negatives++; } }
      return { table: t.name, col: k, rows: t.rows.length, nullRate: t.rows.length ? nulls / t.rows.length : null, distinct: seen.size, distinctCapped: seen.size >= 5000, min: numeric ? lo : null, max: numeric ? hi : null, anomalies: negatives }; }));
  }, [ds]);
  const recon = useMemo(() => {
    if (!ds) return [];
    const p = (rows: { date: string | null }[]) => rows.filter((r) => r.date && r.date >= scope.period.start && r.date <= scope.period.end);
    const sessAtt = metricValues(p(ds.sessions), ['attendance'], scope.ctx).attendance.value ?? 0;
    const chkAtt = metricValues(p(ds.checkins), ['checkins'], scope.ctx).checkins.value ?? 0;
    const salesRev = metricValues(p(ds.sales), ['gross_revenue'], scope.ctx).gross_revenue.value ?? 0;
    const sessRev = metricValues(p(ds.sessions), ['revenue'], scope.ctx).revenue.value ?? 0;
    const bookRev = metricValues(p(ds.bookings), ['b_revenue'], scope.ctx).b_revenue.value ?? 0;
    const newMembers = new Set(ds.newc.map((r) => r.member_id)).size; const chkMembers = new Set(ds.checkins.map((r) => r.member_id)).size; const lapMembers = new Set(ds.lapsed.map((r) => r.member_id)).size;
    const chkInNew = [...new Set(ds.checkins.map((r) => r.member_id))].filter((m) => m && ds.newc.some((n) => n.member_id === m)).length;
    const row = (label: string, a: number, b: number, fmt: 'integer' | 'currency', note?: string) => { const v = Math.max(a, b) ? Math.abs(a - b) / Math.max(a, b) : 0; return { label, a, b, v, fmt, status: v <= 0.03 ? 'pass' : v <= 0.1 ? 'warn' : 'fail', note }; };
    return [
      row('Attendance: Sessions vs Checkins (period)', sessAtt, chkAtt, 'integer', ds.sessions[0]?.derived ? 'Sessions are derived from Checkins, so these match by construction until the Sessions sheet is shared.' : undefined),
      row('Revenue: Sales vs Sessions class revenue (period)', salesRev, sessRev, 'currency', 'Sales books at purchase; Sessions attribute at attendance. A gap is expected; a widening gap is not.'),
      row('Revenue: Sales vs Bookings (period)', salesRev, bookRev, 'currency', ds.bookings[0]?.derived ? 'Bookings derived from Checkins paid value.' : undefined),
      row('Members: New vs Checkins (distinct, all time)', newMembers, chkMembers, 'integer', 'Checkins cover a much shorter window than New.'),
      row('Members: New vs Lapsed (distinct, all time)', newMembers, lapMembers, 'integer'),
      row('Checkins members present in New', chkMembers, chkInNew, 'integer', 'Referential coverage of Checkins → New.'),
    ];
  }, [ds, scope]);
  const integrity = useMemo(() => {
    if (!ds) return [];
    const newIds = new Set(ds.newc.map((r) => r.member_id)); const sessIds = new Set(ds.sessions.map((r) => r.session_id)); const payrollNames = new Set(ds.payroll.map((r) => r.trainer)); const salesMembers = new Set(ds.sales.map((r) => r.member_id));
    const chkOrphans = ds.checkins.filter((r) => r.member_id && !newIds.has(r.member_id)).length;
    const lapOrphans = ds.lapsed.filter((r) => r.member_id && !newIds.has(r.member_id)).length;
    const salesOrphans = ds.sales.filter((r) => r.member_id && !newIds.has(r.member_id)).length;
    const trainerOrphans = [...new Set(ds.sessions.map((r) => r.trainer))].filter((t) => t && !payrollNames.has(t));
    const bookOrphans = ds.bookings.filter((r) => r.sale_id && !sessIds.has(r.sale_id)).length;
    const leadOrphans = ds.leads.filter((r) => r.member_id && !newIds.has(r.member_id)).length;
    return [
      { join: 'Checkins → New (Member ID)', total: ds.checkins.length, orphans: chkOrphans },
      { join: 'Lapsed → New (Member ID)', total: ds.lapsed.length, orphans: lapOrphans },
      { join: 'Sales → New (Member ID)', total: ds.sales.length, orphans: salesOrphans },
      { join: 'Sessions trainers → Payroll (name)', total: new Set(ds.sessions.map((r) => r.trainer)).size, orphans: trainerOrphans.length, note: trainerOrphans.slice(0, 6).join(', ') },
      { join: 'Bookings → Sessions (Session ID)', total: ds.bookings.length, orphans: ds.bookings[0]?.derived ? 0 : bookOrphans, note: ds.bookings[0]?.derived ? 'Derived; identity shared with Sessions.' : undefined },
      { join: 'Leads → New (Member ID)', total: ds.leads.length, orphans: leadOrphans },
      { join: 'Sales members → Lapsed (Member ID)', total: salesMembers.size, orphans: [...salesMembers].filter((m) => m && !ds.lapsed.some((l) => l.member_id === m)).length },
    ];
  }, [ds]);
  const dupes = useMemo(() => { if (!ds) return 0; const m = new Map<string, Set<string>>(); for (const r of ds.newc) { const k = (r.contactable && r.email ? r.email.toLowerCase() : '') || (r.phone ?? '').replace(/\D/g, ''); if (!k || !r.member_id) continue; let s = m.get(k); if (!s) { s = new Set(); m.set(k, s); } s.add(r.member_id); } let d = 0; for (const s of m.values()) if (s.size > 1) d += s.size - 1; return d; }, [ds]);
  const nullKey = completeness.length ? completeness.reduce((a, c) => a + (c.nullRate ?? 0), 0) / completeness.length : null;
  const orphanRate = integrity.length ? integrity.reduce((a, i) => a + i.orphans, 0) / Math.max(1, integrity.reduce((a, i) => a + i.total, 0)) : null;
  const maxVar = recon.length ? maxBy(recon, (r) => r.v, 0) : null;
  const blocked = loads.filter((l) => l.status === 'error' || l.status === 'empty');
  return (
    <>
      <WidgetSection tab="health" scope={scope} placement="top" />
      {blocked.length > 0 && (
        <Register title={`${blocked.length} sheet${blocked.length > 1 ? 's are' : ' is'} not loading`} index="Action required"
          subtitle="Everything below still computes from the sheets that did load, and the affected grains are rebuilt where possible — but these are the numbers you are missing." domain="risk">
          <div style={{ display: 'grid', gap: 12 }}>
            {blocked.map((l) => (
              <div key={l.key} className="panel" style={{ borderColor: 'var(--neg)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span className="t-heading-m">{l.title}</span>
                  <span className="status-pill neg">{l.status === 'empty' ? 'Empty' : 'Blocked'}</span>
                  {l.url && <span className="t-label-s faint" style={{ wordBreak: 'break-all' }}>{l.url.slice(0, 90)}…</span>}
                </div>
                <p className="t-body-s" style={{ margin: '6px 0 2px' }}>{l.error}</p>
                <p className="t-body-s muted" style={{ margin: '0 0 10px' }}>{l.hint}</p>
                <SourceFixer load={l} />
              </div>
            ))}
          </div>
        </Register>
      )}
      <Register title="Data health" subtitle="What loaded, what didn't, and whether the sheets agree with each other" domain="neutral" actions={<button className="btn btn-xs" onClick={() => load(true)}>Retry all</button>}>
        <div className="kpi-strip" style={{ ['--kpi-cols' as string]: 6 }}>
          <MetricCard metricId="sessions" labelOverride="Rows loaded" value={totalRows} variant="standard" />
          <MetricCard metricId="sessions" labelOverride="Sheets ok / derived / failed" value={loads.filter((l) => l.status === 'ok').length} benchmark={{ label: `derived ${loads.filter((l) => l.status === 'derived').length} · failed ${loads.filter((l) => l.status === 'error' || l.status === 'empty').length}`, value: null }} />
          <MetricCard metricId="fill_rate" labelOverride="Null rate on key fields" value={nullKey} />
          <MetricCard metricId="fill_rate" labelOverride="Orphaned IDs" value={orphanRate} />
          <MetricCard metricId="sessions" labelOverride="Duplicate members" value={dupes} />
          <MetricCard metricId="fill_rate" labelOverride="Max reconciliation variance" value={maxVar} alert={(maxVar ?? 0) > 0.03} />
        </div>
        <div className="t-label-s muted" style={{ marginTop: 8 }}>Last refresh {ds ? fmtAgo(ds.loadedAt) : '—'}. Cache TTL 15 minutes; Refresh in the title bar clears it.</div>
      </Register>
      <Register title="Sheet status" subtitle="Each tab is resolved by title and its header validated against the declared schema. Google silently serves the first sheet on a bad title — the schema check catches that." domain="neutral">
        <div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Tab</th><th className="t-heading-s">Status</th><th className="t-heading-s">Rows</th><th className="t-heading-s">Columns</th><th className="t-heading-s">Load</th><th className="t-heading-s">Source</th><th className="t-heading-s">Schema drift</th><th className="t-heading-s" style={{ textAlign: 'left' }}>Detail</th></tr></thead>
          <tbody>{loads.map((l) => <tr key={l.key}><td className="t-body-s">{l.title}</td><td><span className={`t-label-s pill ${l.status === 'ok' ? 'pos' : l.status === 'derived' ? 'warn' : 'neg'}`} style={{ border: '1px solid currentColor', padding: '1px 8px' }}>{l.status === 'ok' ? 'Loaded' : l.status === 'derived' ? 'Derived' : l.status === 'empty' ? 'Empty' : l.status === 'pending' ? 'Loading' : 'Failed'}</span></td><td className="t-num">{l.rows.toLocaleString('en-IN')}</td><td className="t-num">{l.columns.length || '—'}</td><td className="t-num">{l.loadMs ? `${(l.loadMs / 1000).toFixed(1)}s${l.fromCache ? ' (cache)' : ''}` : '—'}</td><td className="t-body-s"><a href={sheetUiUrl(l.spreadsheetId)} target="_blank" rel="noreferrer" className="hue">Open</a></td><td className="t-body-s">{l.missing.length ? <span className="warn" title={l.missing.join(', ')}>{l.missing.length} missing</span> : null}{l.missing.length && l.extra.length ? ' · ' : ''}{l.extra.length ? <span className="muted" title={l.extra.join(', ')}>{l.extra.length} extra</span> : null}{!l.missing.length && !l.extra.length && l.columns.length ? <span className="pos">Matches</span> : null}</td><td className="t-body-s" style={{ textAlign: 'left', whiteSpace: 'normal', maxWidth: 480 }}>{l.error && <div className="neg">{l.error}</div>}{l.hint && <div className="muted">{l.hint}</div>}</td></tr>)}</tbody></table></div>
      </Register>
      <Register title="Cross-sheet reconciliation" subtitle="Both figures, absolute variance, variance % and a verdict. This is what makes the rest of the product defensible." domain="neutral">
        <div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s" style={{ textAlign: 'left' }}>Check</th><th className="t-heading-s">A</th><th className="t-heading-s">B</th><th className="t-heading-s">Variance</th><th className="t-heading-s">Variance %</th><th className="t-heading-s">Verdict</th><th className="t-heading-s" style={{ textAlign: 'left' }}>Note</th></tr></thead>
          <tbody>{recon.map((r) => <tr key={r.label}><td className="t-body-s">{r.label}</td><td className="t-num">{r.fmt === 'currency' ? fmtCurrency(r.a) : r.a.toLocaleString('en-IN')}</td><td className="t-num">{r.fmt === 'currency' ? fmtCurrency(r.b) : r.b.toLocaleString('en-IN')}</td><td className="t-num">{r.fmt === 'currency' ? fmtCurrency(Math.abs(r.a - r.b)) : Math.abs(r.a - r.b).toLocaleString('en-IN')}</td><td className="t-num">{formatValue('percent', r.v)}</td><td><span className={`t-label-s pill ${r.status === 'pass' ? 'pos' : r.status === 'warn' ? 'warn' : 'neg'}`} style={{ border: '1px solid currentColor', padding: '1px 8px' }}>{r.status === 'pass' ? 'Pass' : r.status === 'warn' ? 'Warn' : 'Fail'}</span></td><td className="t-body-s muted" style={{ textAlign: 'left', whiteSpace: 'normal', maxWidth: 420 }}>{r.note}</td></tr>)}</tbody></table></div>
      </Register>
      <Register title="Referential integrity" subtitle="Orphan rates for each join in the query layer" domain="neutral">
        <div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s" style={{ textAlign: 'left' }}>Join</th><th className="t-heading-s">Rows</th><th className="t-heading-s">Orphans</th><th className="t-heading-s">Orphan rate</th><th className="t-heading-s" style={{ textAlign: 'left' }}>Note</th></tr></thead>
          <tbody>{integrity.map((i) => <tr key={i.join}><td className="t-body-s">{i.join}</td><td className="t-num">{i.total.toLocaleString('en-IN')}</td><td className="t-num">{i.orphans.toLocaleString('en-IN')}</td><td className={`t-num ${i.total && i.orphans / i.total > 0.1 ? 'warn' : ''}`}>{formatValue('percent', i.total ? i.orphans / i.total : null)}</td><td className="t-body-s muted" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{i.note}</td></tr>)}</tbody></table></div>
      </Register>
      <Register title="Field completeness" subtitle="Per key column: null rate (heat), distinct count, range, anomalies" domain="neutral" lazy>
        <div className="table-scroll" style={{ maxHeight: 480 }}><table className="tbl"><thead><tr><th className="t-heading-s">Sheet</th><th className="t-heading-s" style={{ textAlign: 'left' }}>Column</th><th className="t-heading-s">Rows</th><th className="t-heading-s">Null rate</th><th className="t-heading-s">Distinct</th><th className="t-heading-s">Min</th><th className="t-heading-s">Max</th><th className="t-heading-s">Negatives</th></tr></thead>
            <tbody>{completeness.map((c) => { const bg = c.nullRate === null ? undefined : diverging(theme, -c.nullRate * 2); return <tr key={c.table + c.col}><td className="t-body-s">{c.table}</td><td className="t-body-s" style={{ textAlign: 'left' }}>{c.col}</td><td className="t-num">{c.rows.toLocaleString('en-IN')}</td><td className="t-num" style={{ background: bg, color: bg && needsInvert(bg, theme) ? 'var(--heat-text-invert)' : undefined }}>{formatValue('percent', c.nullRate)}</td><td className="t-num">{c.distinctCapped ? '5,000+' : c.distinct.toLocaleString('en-IN')}</td><td className="t-num">{c.min === null ? '—' : c.min.toLocaleString('en-IN')}</td><td className="t-num">{c.max === null ? '—' : c.max.toLocaleString('en-IN')}</td><td className={`t-num ${c.anomalies ? 'warn' : ''}`}>{c.anomalies}</td></tr>; })}</tbody></table></div>
      </Register>
      <Register title="Agent and streaming API" index="Integration" domain="neutral" collapsed lazy
        subtitle="Same-origin HTTP endpoints stream normalized, PII-redacted records for every source; the in-page API exposes the live dashboard scope. Both publish schemas, formulas and provenance for agents.">
        <div className="subgrid">
          <div className="panel">
            <div className="t-heading-m" style={{ marginBottom: 8 }}>HTTP endpoints for agents and third-party apps</div>
            <pre className="api-code">{`GET /api/v1                              # discovery document
GET /api/v1/sources/sales?start=2026-04-01&end=2026-04-30
GET /api/v1/sources/visits/stream?location=Kenkere%20House
GET /api/v1/consolidated/stream?sources=sales,visits,memberships
GET /api/v1/semantic-layer?table=sales    # formulas + aggregation rules
GET /api/v1/ask?q=how%20much%20did%20Kwality%20House%20do%20in%20April%202026
GET /api/v1/report?format=json&preset=last_week&location=Kenkere%20House

# Streaming response: NDJSON schema event, record events, complete event.
# Add transport=sse for Server-Sent Events.`}</pre>
            <div className="t-label-s faint" style={{ marginTop: 8 }}>
              Records use snake_case fields, ISO dates and numeric INR. Names, email and phone are removed and IDs are pseudonymised by default.
              Each stream begins with field roles, sampled coverage, grain, null policy and a link to its metric registry.
            </div>
          </div>
          <div className="panel">
            <div className="t-heading-m" style={{ marginBottom: 8 }}>In-page live API</div>
            <pre className="api-code">{`await floor.describe()                      // the full catalogue
await floor.get('retention')                // KPIs, groups, signals for a tab
await floor.get('classes', { groupBy: 'daypart', limit: 10 })
await floor.query({ tab: 'bookings',
  metrics: ['visits','v_no_show_rate','v_lead_time'],
  groupBy: ['location','day'], sortBy: 'visits' })
await floor.insights()                      // netted rupee impact by basis
floor.push({ tab: 'retention', severity: 'critical',
  title: 'Bandra 7am is bleeding regulars',
  body: '9 of 14 regulars have not booked in 3 weeks.',
  action: 'Call them before Friday.', impactINR: 180000 })
floor.setFilters({ preset: 'month', locations: ['Kenkere House'] })
floor.export('sales', 'markdown')`}</pre>
            <div className="t-label-s faint" style={{ marginTop: 8 }}>
              Cards pushed by an agent appear in the Signal rail on that tab, marked "From an agent", and persist across reloads.
              The API is rebuilt on every filter change, so it always reflects what is on screen.
            </div>
          </div>
          <DataPanel title="Endpoints" subtitle="One per tab, with the groupings and metrics each accepts" maxHeight={420}>
            <table className="tbl">
              <thead><tr><th className="t-heading-s" style={{ textAlign: 'left' }}>Endpoint</th><th className="t-heading-s">Grain</th><th className="t-heading-s">Headline</th><th className="t-heading-s">Groupings</th><th className="t-heading-s">Metrics</th></tr></thead>
              <tbody>{ENDPOINTS.map((e) => (
                <tr key={e.tab}>
                  <td className="t-body-s"><code>floor.get('{e.tab}')</code></td>
                  <td className="t-body-s">{e.table}</td>
                  <td className="t-num">{e.headline.length}</td>
                  <td className="t-num">{e.groupBy.length}</td>
                  <td className="t-num">{e.metrics.length}</td>
                </tr>))}</tbody>
            </table>
          </DataPanel>
        </div>
      </Register>
      <Register title="Known defects register" domain="neutral">
        <div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s" style={{ textAlign: 'left' }}>Sheet · column</th><th className="t-heading-s" style={{ textAlign: 'left' }}>Defect</th><th className="t-heading-s">Rows</th><th className="t-heading-s" style={{ textAlign: 'left' }}>Impact</th><th className="t-heading-s">Status</th></tr></thead>
          <tbody>{(ds?.defects ?? []).map((d) => <tr key={d.id}><td className="t-body-s">{d.sheet} · {d.column}</td><td className="t-body-s" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{d.description}</td><td className="t-num">{d.rowsAffected.toLocaleString('en-IN')}</td><td className="t-body-s muted" style={{ textAlign: 'left', whiteSpace: 'normal', maxWidth: 480 }}>{d.impact}</td><td><span className={`t-label-s pill ${d.status === 'open' ? 'warn' : 'pos'}`} style={{ border: '1px solid currentColor', padding: '1px 8px' }}>{d.status === 'open' ? 'Open' : 'Mitigated'}</span></td></tr>)}</tbody></table></div>
      </Register>
      <WidgetSection tab="health" scope={scope} placement="bottom" />
    </>
  );
}
