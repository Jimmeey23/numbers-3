import { useMemo } from 'react';
import type { Scope } from '../state/data';
import { Register } from '../components/Register';
import { WidgetSection } from '../components/Widgets/WidgetSection';
import { KpiStrip, Two, useMonths, filtersLabel, SectionEmpty } from './common';
import { ChartModule, XYChart } from '../components/charts/core';
import { Heatmap } from '../components/charts/grids';
import { NestedTable, type ColumnDef } from '../components/NestedTable/NestedTable';
import { MoMTable } from '../components/MoMTable/MoMTable';
import { RankingList } from '../components/RankingList/RankingList';
import { metricValues, rollupLevel } from '../semantics/aggregations';
import { formatColor } from '../design/ramps';
import { useView } from '../state/view';
import { fmtCurrency, fmtDate, fmtMonthShort, formatValue } from '../semantics/formats';
import { maxOf } from '../semantics/stats';

const C_METRICS = ['checkins', 'revenue_per_checkin', 'visits_per_member', 'complimentary_rate', 'c_paid'];

export function Attendance({ scope }: { scope: Scope }) {
  const months = useMonths(scope);
  const theme = useView((s) => s.theme);
  const rows = scope.tables.checkins;
  const visitCurve = useMemo(() => { const m = new Map<number, number>(); for (const r of rows) if (r.checked_in && r.class_no !== null) m.set(r.class_no, (m.get(r.class_no) ?? 0) + 1); return Array.from({ length: 15 }, (_, i) => i + 1).map((n) => ({ n, count: m.get(n) ?? 0, ret: m.get(n) ? (m.get(n + 1) ?? 0) / m.get(n)! : null })); }, [rows]);
  const columns: ColumnDef[] = [
    { id: 'checkins', metricId: 'checkins', family: 'Volume', bar: true }, { id: 'unique_attendees', metricId: 'unique_attendees', family: 'Volume' }, { id: 'visits_per_member', metricId: 'visits_per_member', family: 'Behaviour', heat: true }, { id: 'c_late_cancels', metricId: 'c_late_cancels', family: 'Behaviour' }, { id: 'c_complimentary', metricId: 'c_complimentary', family: 'Revenue' }, { id: 'complimentary_rate', metricId: 'complimentary_rate', family: 'Revenue', heat: true },
    { id: 'c_paid', metricId: 'c_paid', family: 'Revenue', bar: true }, { id: 'revenue_per_checkin', metricId: 'revenue_per_checkin', family: 'Revenue', heat: true }, { id: 'new_share', metricId: 'new_share', family: 'Behaviour' }, { id: 'class_hours', metricId: 'class_hours', family: 'Volume' }, { id: 'attendee_hours', metricId: 'attendee_hours', family: 'Volume', hidden: true }, { id: 'rev_per_attendee_hour', metricId: 'rev_per_attendee_hour', family: 'Revenue' },
    { id: 'pmix', label: 'Product mix', family: 'Revenue', mix: (rs) => { const m = new Map<string, number>(); for (const r of rs) if (r.checked_in) m.set(r.membership_type ?? 'Unknown', (m.get(r.membership_type ?? 'Unknown') ?? 0) + 1); return [...m.entries()].map(([k, v], i) => ({ label: k, value: v, color: [formatColor(theme, 'Cycle'), formatColor(theme, 'Pilates'), formatColor(theme, 'Hosted'), formatColor(theme, 'Strength'), formatColor(theme, 'Barre 57'), formatColor(theme, 'Unknown')][i % 6] })); } },
    { id: 'cmix', label: 'Category mix', family: 'Revenue', mix: (rs) => { const m = new Map<string, number>(); for (const r of rs) if (r.checked_in) m.set(r.category ?? 'Unknown', (m.get(r.category ?? 'Unknown') ?? 0) + 1); return [...m.entries()].map(([k, v], i) => ({ label: k, value: v, color: [formatColor(theme, 'Cycle'), formatColor(theme, 'Pilates'), formatColor(theme, 'Hosted'), formatColor(theme, 'Strength'), formatColor(theme, 'Barre 57'), formatColor(theme, 'Unknown')][i % 6] })); } },
    { id: 'avg_days_between_visits', metricId: 'avg_days_between_visits', family: 'Behaviour' },
  ];
  const memberNodes = useMemo(() => rollupLevel(rows, ['member'], 0, C_METRICS, scope.ctx), [rows, scope.ctx]);
  const ltvBy = useMemo(() => { const m = new Map<string, { ltv: number | null; dsl: number | null }>(); for (const r of scope.all.newc) if (r.member_id) m.set(r.member_id, { ltv: r.ltv, dsl: r.days_since_last_visit }); return m; }, [scope.all.newc]);
  const lorenz = useMemo(() => { const counts = memberNodes.map((n) => n.values.checkins.value ?? 0).sort((a, b) => a - b); const tot = counts.reduce((a, b) => a + b, 0) || 1; let acc = 0; const pts = counts.map((c, i) => { acc += c; return { x: (i + 1) / counts.length, y: acc / tot }; }); const step = Math.max(1, Math.floor(pts.length / 20)); const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1); const top20 = counts.slice(-Math.ceil(counts.length * 0.2)).reduce((a, b) => a + b, 0) / tot; return { sampled, top20 }; }, [memberNodes]);
  // Cohort month × activity month, visits per member. One pass: bucketing 149k check-ins by
  // (first-seen month, month) rather than re-filtering the whole table for every cell.
  const cohortMonth = useMemo(() => {
    const first = new Map<string, string>();
    for (const r of scope.all.checkins) {
      if (!r.checked_in || !r.member_id || !r.month) continue;
      const f = first.get(r.member_id);
      if (f === undefined || r.month < f) first.set(r.member_id, r.month);
    }
    const agg = new Map<string, { visits: number; members: Set<string> }>();
    const inWindow = new Set(months);
    for (const r of scope.all.checkins) {
      if (!r.checked_in || !r.member_id || !r.month || !inWindow.has(r.month)) continue;
      const c = first.get(r.member_id);
      if (c === undefined || !inWindow.has(c) || r.month < c) continue;
      const k = `${r.month}|${c}`;
      let e = agg.get(k); if (!e) { e = { visits: 0, members: new Set() }; agg.set(k, e); }
      e.visits++; e.members.add(r.member_id);
    }
    const cells = [];
    for (const [k, e] of agg) { const [x, y] = k.split('|'); cells.push({ x, y, value: e.visits / e.members.size, n: e.members.size, extra: `${e.members.size} members` }); }
    return cells;
  }, [scope.all.checkins, months]);
  const freq = useMemo(() => { const b = ['1', '2', '3–4', '5–8', '9–12', '13+']; const m = new Map(b.map((k) => [k, 0])); for (const n of memberNodes) { const v = n.values.checkins.value ?? 0; const k = v <= 1 ? '1' : v === 2 ? '2' : v <= 4 ? '3–4' : v <= 8 ? '5–8' : v <= 12 ? '9–12' : '13+'; m.set(k, (m.get(k) ?? 0) + 1); } return b.map((k) => ({ k, v: m.get(k) ?? 0 })); }, [memberNodes]);
  const loyalty = useMemo(() => { const byM = new Map<string, { t: Map<string, number>; l: Map<string, number>; f: Set<string>; n: number; member: typeof rows[number] }>(); for (const r of rows) { if (!r.member_id || !r.checked_in) continue; let e = byM.get(r.member_id); if (!e) { e = { t: new Map(), l: new Map(), f: new Set(), n: 0, member: r }; byM.set(r.member_id, e); } e.n++; if (r.trainer) e.t.set(r.trainer, (e.t.get(r.trainer) ?? 0) + 1); if (r.location) e.l.set(r.location, (e.l.get(r.location) ?? 0) + 1); if (r.format) e.f.add(r.format); } const regs = [...byM.values()].filter((e) => e.n >= 3); const tl = regs.filter((e) => maxOf([...e.t.values()], 0) / e.n >= 0.6).length; const ll = regs.filter((e) => maxOf([...e.l.values()], 0) / e.n >= 0.8).length; const breadth = [1, 2, 3].map((b) => { const es = regs.filter((e) => (b === 3 ? e.f.size >= 3 : e.f.size === b)); return { b: b === 3 ? '3+' : String(b), n: es.length, visits: es.length ? es.reduce((a, e) => a + e.n, 0) / es.length : null }; }); return { regs: regs.length, tl, ll, breadth }; }, [rows]);
  const dormancy = useMemo(() => { const last = new Map<string, { name: string; last: string; visits: number }>(); for (const r of scope.all.checkins) if (r.member_id && r.checked_in && r.date) { const e = last.get(r.member_id) ?? { name: r.name ?? r.member_id, last: r.date, visits: 0 }; e.visits++; if (r.date > e.last) e.last = r.date; last.set(r.member_id, e); } const activeIds = new Set(scope.all.lapsed.filter((l) => l.active).map((l) => l.member_id)); return [...last.entries()].filter(([id, e]) => activeIds.has(id) && (scope.ctx.todayTs - new Date(e.last).getTime()) / 864e5 >= 21).map(([id, e]) => ({ id, ...e, ltv: ltvBy.get(id)?.ltv ?? null, days: Math.floor((scope.ctx.todayTs - new Date(e.last).getTime()) / 864e5) })).sort((a, b) => (b.ltv ?? 0) - (a.ltv ?? 0)).slice(0, 30); }, [scope.all.checkins, scope.all.lapsed, scope.ctx.todayTs, ltvBy]);
  const reactivation = useMemo(() => { const byMember = new Map<string, string[]>(); for (const r of scope.all.checkins) if (r.member_id && r.checked_in && r.date) { let a = byMember.get(r.member_id); if (!a) { a = []; byMember.set(r.member_id, a); } a.push(r.date); } let n = 0; for (const ds of byMember.values()) { ds.sort(); for (let i = 1; i < ds.length; i++) if ((new Date(ds[i]).getTime() - new Date(ds[i - 1]).getTime()) / 864e5 >= 30 && ds[i] >= scope.period.start && ds[i] <= scope.period.end) { n++; break; } } return n; }, [scope.all.checkins, scope.period]);
  const seasonality = useMemo(() => { const s = months.map((m) => scope.all.checkins.filter((r) => r.checked_in && r.month === m).length); const mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.filter(Boolean).length); return months.map((m, i) => ({ m, v: s[i], idx: mean ? s[i] / mean : null })); }, [scope.all.checkins, months]);
  if (!rows.length) return <div style={{ paddingTop: 20 }}><SectionEmpty what="check-ins" scope={scope} /></div>;
  return (
    <>
      <WidgetSection tab="attendance" scope={scope} placement="top" />
      <Register title="Attendance" subtitle="Every check-in, with the member's lifecycle attached" domain="attendance">
        <KpiStrip scope={scope} table="checkins" ids={['checkins', 'unique_attendees', 'mau', 'visits_per_member', 'complimentary_rate', 'revenue_per_checkin', 'power_users', 'c_late_cancels']} />
      </Register>
      <Register title="The visit-number cliff" subtitle="How many members reach each visit number, and the share who make it to the next" domain="attendance">
        <ChartModule title="Visit-number drop-off" table={{ columns: ['Visit', 'Check-ins', 'Reach next'], rows: visitCurve.map((v) => [v.n, v.count, formatValue('percent', v.ret)]) }}>
          <XYChart categories={visitCurve.map((v) => `#${v.n}`)} series={[{ id: 'c', label: 'Check-ins at visit n', color: 'var(--hue-attendance)', kind: 'bar', values: visitCurve.map((v) => v.count) }, { id: 'r', label: 'Reach visit n+1', color: 'var(--hue-revenue)', axis: 'right', fmt: 'percent', values: visitCurve.map((v) => v.ret) }]} fmtLeft="integer" fmtRight="percent" height={240} />
        </ChartModule>
        <div className="t-label-s muted" style={{ marginTop: 6 }}>Class 1 → 2: {formatValue('percent', visitCurve[0]?.ret)} of first-timers in scope came back. That step is usually the steepest cliff in the business.</div>
      </Register>
      <Register title="Drill down" subtitle="Location → class → teacher → member" domain="attendance" id="drill-table">
        <NestedTable title="Attendance" rows={rows} compareRows={scope.compare.checkins} table="checkins" groupKeys={['location', 'class_name', 'trainer', 'member']} availableKeys={['location', 'class_name', 'trainer', 'member_name', 'format', 'day', 'time', 'timeslot', 'daypart', 'weekpart', 'membership_type', 'category', 'product', 'visit_band', 'outcome', 'month', 'quarter', 'year', 'session', 'slot_uid', 'spend_band']} columns={columns} ctx={scope.ctx} domain="attendance" defaultSort={{ id: 'checkins', dir: 'desc' }} filtersLabel={filtersLabel(scope)} rankBy="checkins" leafLabel="visits" />
      </Register>
      <Register title="Engagement and concentration" domain="attendance" lazy>
        <Two a={<RankingList title="Members by" nodes={memberNodes} metricOptions={['checkins', 'revenue_per_checkin', 'c_paid', 'complimentary_rate']} ctx={scope.ctx} table="checkins" domain="attendance" minSample={2} sampleLabel="visits" />}
          b={<ChartModule title="Attendance concentration (Lorenz curve)" subtitle={`Top 20% of members account for ${formatValue('percent', lorenz.top20)} of check-ins`} table={{ columns: ['Share of members', 'Share of check-ins'], rows: lorenz.sampled.map((p) => [`${(p.x * 100).toFixed(0)}%`, `${(p.y * 100).toFixed(0)}%`]) }}><XYChart categories={lorenz.sampled.map((p) => `${(p.x * 100).toFixed(0)}%`)} series={[{ id: 'l', label: 'Cumulative share of check-ins', color: 'var(--hue-attendance)', kind: 'area', values: lorenz.sampled.map((p) => p.y), fmt: 'percent' }, { id: 'e', label: 'Perfect equality', color: 'var(--text-3)', values: lorenz.sampled.map((p) => p.x), fmt: 'percent', ghost: true }]} fmtLeft="percent" height={240} /></ChartModule>} />
      </Register>
      <Register title="Member cohort × month by visits per member" domain="attendance" lazy>
        <Heatmap xs={months} ys={months} cells={cohortMonth} fmt="decimal" xLabel={fmtMonthShort} yLabel={fmtMonthShort} cellH={24} />
      </Register>
      <Register title="Month on month" domain="attendance" lazy>
        <MoMTable rows={scope.all.checkins} metricIds={['checkins', 'mau', 'visits_per_member', 'new_share', 'revenue_per_checkin', 'complimentary_rate']} months={months} ctx={scope.ctx} domain="attendance" />
      </Register>
      <Register title="Frequency, loyalty, breadth, dormancy worklist, reactivation, seasonality" domain="attendance" collapsed lazy>
        <div style={{ display: 'grid', gap: 24 }}>
          <Two a={<ChartModule title="Frequency distribution" table={{ columns: ['Visits', 'Members'], rows: freq.map((f) => [f.k, f.v]) }}><XYChart categories={freq.map((f) => f.k)} series={[{ id: 'f', label: 'Members', color: 'var(--hue-attendance)', kind: 'bar', values: freq.map((f) => f.v) }]} height={200} /></ChartModule>}
            b={<div><div className="t-heading-m" style={{ marginBottom: 6 }}>Trainer and location loyalty; format breadth</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><tbody><tr><td className="t-body-s">Regulars (3+ visits)</td><td className="t-num">{loyalty.regs}</td></tr><tr><td className="t-body-s">Loyal to one trainer (≥60% of visits)</td><td className="t-num">{formatValue('percent', loyalty.regs ? loyalty.tl / loyalty.regs : null)}</td></tr><tr><td className="t-body-s">Loyal to one location (≥80%)</td><td className="t-num">{formatValue('percent', loyalty.regs ? loyalty.ll / loyalty.regs : null)}</td></tr>{loyalty.breadth.map((b) => <tr key={b.b}><td className="t-body-s">{b.b} format{b.b === '1' ? '' : 's'} — regulars / avg visits</td><td className="t-num">{b.n} / {formatValue('decimal', b.visits)}</td></tr>)}</tbody></table></div></div>} />
          <div><div className="t-heading-m" style={{ marginBottom: 6 }}>Dormancy worklist — active membership, absent 21+ days, sorted by LTV</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><thead><tr><th className="t-heading-s">Member</th><th className="t-heading-s">Days absent</th><th className="t-heading-s">Last visit</th><th className="t-heading-s">Visits</th><th className="t-heading-s">LTV</th></tr></thead><tbody>{dormancy.map((d) => <tr key={d.id}><td className="t-body-s">{d.name}</td><td className="t-num warn">{d.days}</td><td className="t-num">{fmtDate(d.last)}</td><td className="t-num">{d.visits}</td><td className="t-num">{fmtCurrency(d.ltv)}</td></tr>)}</tbody></table></div>{!dormancy.length && <div className="muted t-body-s">Nobody with an active membership has been absent 21+ days in the check-in window.</div>}</div>
          <Two a={<div><div className="t-heading-m" style={{ marginBottom: 6 }}>Reactivation tracker</div><div className="t-display-s tabular">{reactivation}</div><div className="t-label-s muted">members returned in the period after a gap of 30+ days</div></div>}
            b={<div><div className="t-heading-m" style={{ marginBottom: 6 }}>Seasonality index — check-ins vs 13-month mean</div><div className="table-scroll" style={{ maxHeight: 400 }}><table className="tbl"><tbody>{seasonality.map((s) => <tr key={s.m}><td className="t-body-s">{fmtMonthShort(s.m)}</td><td className="t-num">{s.v}</td><td className={`t-num ${(s.idx ?? 1) >= 1 ? 'pos' : 'neg'}`}>{s.idx === null ? '—' : s.idx.toFixed(2)}</td></tr>)}</tbody></table></div></div>} />
        </div>
      </Register>
      <div className="t-label-s faint" style={{ padding: '8px 0' }}>Duration-derived figures use a 55-minute estimate: {metricValues(rows, ['class_hours'], scope.ctx).class_hours.suspect}</div>
      <WidgetSection tab="attendance" scope={scope} placement="bottom" />
    </>
  );
}
