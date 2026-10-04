import { useMemo } from 'react';
import type { Scope } from '../state/data';
import { Register, EmptyState } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { KpiStrip, Two, useMonths, filtersLabel } from './common';
import { ChartModule, XYChart } from '../components/charts/core';
import { Sankey } from '../components/charts/special';
import { Heatmap } from '../components/charts/grids';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { RankingList } from '../components/RankingList/RankingList';
import { metricValues, rollupLevel } from '../semantics/aggregations';
import { useData } from '../state/data';
import { useFilters } from '../state/filters';
import { useView } from '../state/view';
import { fmtCurrency, formatValue } from '../semantics/formats';

const L_METRICS = ['lead_conversion_rate', 'pipeline_value', 'leads', 'response_time_hours', 'avg_touches'];

export function Leads({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const load = useData((s) => s.loads.find((l) => l.key === 'leads'));
  const addTransient = useFilters((s) => s.addTransient);
  const rows = scope.tables.leads;
  const columns: ColumnDef[] = [
    { id: 'leads', metricId: 'leads', family: 'Volume', bar: true }, { id: 'contacted_leads', metricId: 'contacted_leads', family: 'Volume' }, { id: 'response_time_hours', metricId: 'response_time_hours', family: 'Behaviour', heat: true }, { id: 'median_response_hours', metricId: 'median_response_hours', family: 'Behaviour' }, { id: 'same_day_response', metricId: 'same_day_response', family: 'Behaviour' },
    { id: 'avg_touches', metricId: 'avg_touches', family: 'Behaviour' }, { id: 'won_leads', metricId: 'won_leads', family: 'Volume' }, { id: 'lead_conversion_rate', metricId: 'lead_conversion_rate', family: 'Utilisation', heat: true }, { id: 'lost_leads', metricId: 'lost_leads', family: 'Volume' }, { id: 'time_to_convert', metricId: 'time_to_convert', family: 'Behaviour' },
    { id: 'open_leads', metricId: 'open_leads', family: 'Volume' }, { id: 'stale_leads', metricId: 'stale_leads', family: 'Behaviour' }, { id: 'pipeline_value', metricId: 'pipeline_value', family: 'Revenue' },
    { id: 'lead_ltv', metricId: 'lead_ltv', family: 'Revenue', heat: true },
    { id: 'lead_trial_rate', metricId: 'lead_trial_rate', family: 'Utilisation', heat: true },
    { id: 'lead_visits', metricId: 'lead_visits', family: 'Behaviour' },
    { id: 'untouched_leads', metricId: 'untouched_leads', family: 'Behaviour' },
  ];
  const sankey = useMemo(() => { const flows: { from: string; to: string; value: number }[] = []; const src = new Map<string, number>(); const stg = new Map<string, number>(); for (const r of rows) { const s = r.source_name ?? 'Unknown'; const st = r.stage ?? 'No stage'; const o = r.status ?? 'Open'; src.set(`${s}|${st}`, (src.get(`${s}|${st}`) ?? 0) + 1); stg.set(`${st}|${o}`, (stg.get(`${st}|${o}`) ?? 0) + 1); } for (const [k, v] of src) { const [a, b] = k.split('|'); flows.push({ from: a, to: b, value: v }); } for (const [k, v] of stg) { const [a, b] = k.split('|'); flows.push({ from: a, to: b, value: v }); } const sources = [...new Set(rows.map((r) => r.source_name ?? 'Unknown'))]; const stages = [...new Set(rows.map((r) => r.stage ?? 'No stage'))]; const outcomes = [...new Set(rows.map((r) => r.status ?? 'Open'))]; return { flows, columns: [sources, stages, outcomes] }; }, [rows]);
  const sourceNodes = useMemo(() => rollupLevel(rows, ['source'], 0, L_METRICS, scope.ctx), [rows, scope.ctx]);
  const touchCurve = useMemo(() => [0, 1, 2, 3, 4].map((t) => { const rs = rows.filter((r) => r.touches === t); return { t, n: rs.length, win: rs.length ? rs.filter((r) => r.won).length / rs.length : null }; }), [rows]);
  const respHeat = useMemo(() => { const buckets = [[0, 1, '<1h'], [1, 4, '1–4h'], [4, 24, '4–24h'], [24, 72, '1–3d'], [72, 1e9, '3d+']] as const; const cells = []; for (const s of sourceNodes.map((n) => n.key)) for (const [a, b, l] of buckets) { const rs = rows.filter((r) => r.source_name === s && r.response_hours !== null && r.response_hours >= a && r.response_hours < b); if (rs.length) cells.push({ x: l, y: s, value: rs.filter((r) => r.won).length / rs.length, n: rs.length }); } return { xs: buckets.map((b) => b[2]), cells }; }, [rows, sourceNodes]);
  const associates = useMemo(() => rollupLevel(rows, ['associate'], 0, ['leads', 'lead_conversion_rate', 'median_response_hours', 'avg_touches', 'stale_leads'], scope.ctx).sort((a, b) => b.rows.length - a.rows.length), [rows, scope.ctx]);
  const lossReasons = useMemo(() => rollupLevel(rows.filter((r) => r.lost), ['stage'], 0, ['leads'], scope.ctx).sort((a, b) => b.rows.length - a.rows.length), [rows, scope.ctx]);
  const stale = useMemo(() => rows.filter((r) => r.open && scope.ctx.todayTs - Math.max(r.created_ts ?? 0, ...r.follow_ups) > 14 * 864e5).slice(0, 40), [rows, scope.ctx.todayTs]);
  const dupes = useMemo(() => { const m = new Map<string, number>(); for (const r of rows) { const k = (r.email ?? '').toLowerCase() || (r.phone ?? '').replace(/\D/g, ''); if (k) m.set(k, (m.get(k) ?? 0) + 1); } return [...m.values()].filter((v) => v > 1).length; }, [rows]);
  const empty = !rows.length;
  return (
    <>
      <WidgetSection tab="leads" scope={scope} placement="top" />
      <Register title="Leads" subtitle={load?.status === 'empty' ? 'The Leads tab holds only a header row. Everything below renders the moment rows exist.' : 'From the Leads sheet'} domain="people">
        <KpiStrip scope={scope} table="leads" ids={['leads', 'lead_conversion_rate', 'response_time_hours', 'untouched_leads', 'touches_to_convert', 'open_leads', 'pipeline_value', 'stale_leads']} />
        {empty && <div style={{ marginTop: 16 }}><EmptyState title="No leads to analyse yet" body={`${load?.error ?? 'The sheet returned no rows in this scope.'} Once the tab has rows with ID, Created At, Source Name, Stage Name, Status and follow-up dates, this tab shows the source → stage → outcome flow, win rate by touch count, and the response-time × win-rate heatmap.`} actions={<button className="btn btn-xs" onClick={() => useView.getState().setTab('health')}>Check source in Data health</button>} /></div>}
      </Register>
      {!empty && <>
        <Register title="Source → stage → outcome" domain="people">
          <ChartModule title="Source → stage → outcome" subtitle="Every enquiry traced from where it came from, through the stage it reached, to how it ended"
            table={{ columns: ['From', 'To', 'Leads'], rows: sankey.flows.map((f) => [f.from, f.to, f.value]) }}>
            <Sankey flows={sankey.flows} columns={sankey.columns} height={Math.max(360, sankey.columns[1].length * 26)}
              columnTitles={['Source', 'Stage reached', 'Outcome']}
              onNode={(n) => { const asSource = sourceNodes.find((x) => x.key === n); if (asSource) addTransient({ dim: 'source', value: n }); else addTransient({ dim: 'stage', value: n }); }} />
          </ChartModule>
        </Register>
        <Register title="Drill down" subtitle="Channel → source → associate → lead" domain="people" id="drill-table">
          <NestedTable title="Leads" rows={rows} compareRows={scope.compare.leads} table="leads" groupKeys={['channel', 'source', 'associate', 'lead']} availableKeys={['channel', 'source', 'associate', 'lead', 'stage', 'status', 'location', 'month', 'quarter', 'response_band', 'touch_band', 'utm_source', 'utm_medium', 'utm_campaign', 'trial_status', 'contactable', 'weekpart', 'day']} columns={columns} ctx={scope.ctx} domain="people" defaultSort={{ id: 'leads', dir: 'desc' }} filtersLabel={filtersLabel(scope)} rankBy="lead_conversion_rate" leafLabel="leads" />
        </Register>
        <Register title="Sources and the touch curve" domain="people" lazy>
          <Two a={<RankingList title="Sources by" nodes={sourceNodes} metricOptions={['lead_conversion_rate', 'pipeline_value', 'response_time_hours', 'leads']} ctx={scope.ctx} table="leads" domain="people" minSample={5} sampleLabel="leads" />}
            b={<ChartModule title="Win rate by touch count" subtitle="Usually still climbing at touch 4 — the argument for extending the cadence" table={{ columns: ['Touches', 'Leads', 'Win rate'], rows: touchCurve.map((t) => [t.t, t.n, formatValue('percent', t.win)]) }}><XYChart categories={touchCurve.map((t) => `${t.t}`)} series={[{ id: 'n', label: 'Leads', color: 'var(--hue-people)', kind: 'bar', values: touchCurve.map((t) => t.n) }, { id: 'w', label: 'Win rate', color: 'var(--hue-revenue)', axis: 'right', fmt: 'percent', values: touchCurve.map((t) => t.win) }]} fmtLeft="integer" fmtRight="percent" height={240} /></ChartModule>} />
        </Register>
        <Register title="Response time × win rate, by source" subtitle="The most persuasive chart in the product for changing behaviour" domain="people" lazy>
          <ChartModule title="Win rate by response time and source"
            table={{ columns: ['Source', ...respHeat.xs], rows: sourceNodes.map((n) => [n.key, ...respHeat.xs.map((x) => { const c = respHeat.cells.find((k) => k.x === x && k.y === n.key); return c ? formatValue('percent', c.value) : null; })]) }}>
            <Heatmap xs={respHeat.xs} ys={sourceNodes.map((n) => n.key)} cells={respHeat.cells} fmt="percent" minN={3} />
          </ChartModule>
        </Register>
        <Register title="Month on month by channel" domain="people" lazy>
          <MoMTable rows={scope.all.leads} metricIds={['leads', 'lead_conversion_rate', 'response_time_hours', 'avg_touches', 'pipeline_value']} months={months} ctx={scope.ctx} domain="people" groups={rollupLevel(scope.all.leads, ['channel'], 0, ['leads'], scope.ctx).map((n) => ({ label: n.label, rows: n.rows }))} />
        </Register>
        <Register title="Associate scorecard, loss reasons, cadence audit, stale worklist, duplicates" domain="people" collapsed lazy>
          <div style={{ display: 'grid', gap: 24 }}>
            <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Associate scorecard</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Associate</th><th className="t-heading-s">Leads</th><th className="t-heading-s">Win rate</th><th className="t-heading-s">Median response</th><th className="t-heading-s">Touches</th><th className="t-heading-s">Stale</th></tr></thead><tbody>{associates.map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{n.rows.length}</td><td className="t-num">{formatValue('percent', n.values.lead_conversion_rate.value)}</td><td className="t-num">{formatValue('hours', n.values.median_response_hours.value)}</td><td className="t-num">{formatValue('decimal', n.values.avg_touches.value)}</td><td className="t-num">{n.values.stale_leads.value}</td></tr>)}</tbody></table></div></div>
            <Two a={<div><div className="t-heading-m" style={{ marginBottom: 6 }}>Loss reasons</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><tbody>{lossReasons.map((n) => <tr key={n.id}><td className="t-body-s">{n.label}</td><td className="t-num">{n.rows.length}</td></tr>)}</tbody></table></div></div>}
              b={<div><div className="t-heading-m" style={{ marginBottom: 6 }}>Follow-up cadence audit</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><tbody>{touchCurve.map((t) => <tr key={t.t}><td className="t-body-s">{t.t} touch{t.t === 1 ? '' : 'es'}</td><td className="t-num">{t.n}</td><td className="t-num">{formatValue('percent', t.n / Math.max(1, rows.length))}</td></tr>)}</tbody></table></div><div className="t-label-s faint" style={{ marginTop: 4 }}>{dupes} duplicate leads by email or phone; {rows.filter((r) => !r.email && !r.phone).length} unreachable.</div></div>} />
            <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Stale-lead worklist — open, no touch in 14 days, est. value {fmtCurrency(metricValues(stale, ['pipeline_value'], scope.ctx).pipeline_value.value)}</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Lead</th><th className="t-heading-s">Source</th><th className="t-heading-s">Associate</th><th className="t-heading-s">Stage</th><th className="t-heading-s">Touches</th></tr></thead><tbody>{stale.map((r) => <tr key={r.id}><td className="t-body-s">{r.name}</td><td className="t-body-s">{r.source_name}</td><td className="t-body-s">{r.associate}</td><td className="t-body-s">{r.stage}</td><td className="t-num">{r.touches}</td></tr>)}</tbody></table></div></div>
          </div>
        </Register>
      </>}
      <WidgetSection tab="leads" scope={scope} placement="bottom" />
    </>
  );
}
