/* Declarative insight rules. Each returns observation → magnitude → implication → action, with rupee impact. */
import type { Scope } from '../state/data';
import type { Thresholds } from '../state/view';
import { groupRows, GROUP_KEYS, metricValues, type Row } from '../semantics/aggregations';
import { fmtCurrency, fmtDate, fmtPercent, fmtTime12 } from '../semantics/formats';
import type { TabId } from '../state/view';
import type { Transient } from '../state/filters';

export type Severity = 'critical' | 'attention' | 'opportunity' | 'context';
export type ImpactBasis = 'at-risk' | 'upside' | 'sunk' | 'none';
export interface Insight {
  key: string; rule: string; severity: Severity; entity: string; title: string; body: string; action: string;
  impactINR: number; n?: number; tab: TabId; linkFilters: Transient[];
  /** What the rupee figure means. Only like bases may be summed. */
  basis?: ImpactBasis;
  /** Member ids (or other stable keys) this insight claims, so the engine can net out overlap. */
  claims?: string[];
}
export interface Rule { id: string; label: string; tab: TabId; run: (s: Scope, t: Thresholds) => Insight[] }

const mk = (rule: string, entity: string, rest: Omit<Insight, 'key' | 'rule' | 'entity'>): Insight => ({ key: `${rule}:${entity}`, rule, entity, ...rest });
const slotLabel = (k: string) => `${k.slice(0, 3)} ${fmtTime12(k.slice(-5))}`;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a: number[]) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) : 0; };

export const RULES: Rule[] = [
  { id: 'dead_slot', label: 'Dead slot', tab: 'slots', run: (s, t) => {
    const out: Insight[] = []; const pac = metricValues(s.tables.sessions, ['rev_pac'], s.ctx).rev_pac.value ?? 0;
    for (const [k, rows] of groupRows(s.tables.sessions, { id: 'ls', label: '', accessor: (r: Row) => (r.location && r.day && r.time ? `${r.location}|${r.day} ${r.time}` : null) })) {
      if (rows.length < t.deadSlotMinOccurrences) continue; const v = metricValues(rows, ['fill_rate', 'unsold_seats', 'teaching_hours'], s.ctx); const fill = v.fill_rate.value;
      if (fill === null || fill >= t.deadSlotFill) continue; const [loc, slot] = k.split('|'); const hours = (v.teaching_hours.value ?? 0) / Math.max(1, s.period.days / 30);
      out.push(mk('dead_slot', slotLabel(slot), { severity: 'attention', tab: 'slots', title: `${slotLabel(slot)} at ${loc} is running at ${fmtPercent(fill)} fill`, body: `It has run ${rows.length} times in the period at ${fmtPercent(fill)} of capacity, leaving ${v.unsold_seats.value} seats unsold.`, action: `Cutting it frees about ${hours.toFixed(1)} teaching hours a month at ${fmtCurrency(rows.length * s.ctx.ratePerSession)} trainer cost.`, impactINR: rows.length * s.ctx.ratePerSession + (v.unsold_seats.value ?? 0) * pac * 0.2, n: rows.length, linkFilters: [{ dim: 'location', value: loc }, { dim: 'daytime', value: slot, label: slotLabel(slot) }] }));
    } return out; } },
  { id: 'slot_decline', label: 'Slot decline', tab: 'slots', run: (s, t) => {
    const out: Insight[] = []; const cutoff = new Date(s.ctx.todayTs - 56 * 864e5).toISOString().slice(0, 10); const mid = new Date(s.ctx.todayTs - 28 * 864e5).toISOString().slice(0, 10);
    for (const [k, rows] of groupRows(s.all.sessions.filter((r) => r.date && r.date >= cutoff), GROUP_KEYS.slot)) {
      const a = rows.filter((r) => r.date < mid); const b = rows.filter((r) => r.date >= mid); if (a.length < 3 || b.length < 3) continue;
      const fa = metricValues(a, ['fill_rate'], s.ctx).fill_rate.value; const fb = metricValues(b, ['fill_rate'], s.ctx).fill_rate.value; if (fa === null || fb === null || fa - fb < t.slotDeclinePp) continue;
      out.push(mk('slot_decline', slotLabel(k), { severity: 'attention', tab: 'slots', title: `${slotLabel(k)} has fallen from ${fmtPercent(fa)} to ${fmtPercent(fb)} fill`, body: `Over the last eight weeks the slot lost ${((fa - fb) * 100).toFixed(0)} points of fill across ${rows.length} occurrences.`, action: 'Check for a trainer change or a competing slot before the decline compounds.', impactINR: (fa - fb) * (metricValues(rows, ['seats'], s.ctx).seats.value ?? 0) * (metricValues(s.tables.sessions, ['rev_pac'], s.ctx).rev_pac.value ?? 0), n: rows.length, linkFilters: [{ dim: 'daytime', value: k, label: slotLabel(k) }] }));
    } return out; } },
  { id: 'waitlist', label: 'Waitlist pressure', tab: 'slots', run: (s, t) => {
    const out: Insight[] = []; const pac = metricValues(s.tables.sessions, ['rev_pac'], s.ctx).rev_pac.value ?? 0;
    for (const [k, rows] of groupRows(s.tables.sessions, GROUP_KEYS.slot)) {
      const over = rows.filter((r) => r.booked !== null && r.capacity !== null && r.booked > r.capacity); if (over.length < t.waitlistMin) continue;
      const excess = over.reduce((a, r) => a + (r.booked - r.capacity), 0); const est = Math.round((excess / rows.length) * 4.3);
      out.push(mk('waitlist', slotLabel(k), { severity: 'opportunity', tab: 'slots', title: `${slotLabel(k)} has been overbooked ${over.length} times`, body: `Bookings exceeded capacity by ${excess} seats in total across ${rows.length} occurrences.`, action: `A second class could capture about ${est} attendees a month, worth ${fmtCurrency(est * pac)}.`, impactINR: est * pac, n: rows.length, linkFilters: [{ dim: 'daytime', value: k, label: slotLabel(k) }] }));
    } return out; } },
  { id: 'dependency', label: 'Trainer dependency', tab: 'slots', run: (s, t) => {
    const out: Insight[] = [];
    for (const [k, rows] of groupRows(s.tables.sessions, GROUP_KEYS.slot)) {
      if (rows.length < 6) continue; const by = new Map<string, number>(); for (const r of rows) by.set(r.trainer ?? '?', (by.get(r.trainer ?? '?') ?? 0) + (r.checked_in ?? 0));
      const sorted = [...by.entries()].sort((a, b) => b[1] - a[1]); const tot = sorted.reduce((a, b) => a + b[1], 0); if (!tot || sorted.length < 2) continue; const share = sorted[0][1] / tot; if (share <= t.dependencyShare) continue;
      out.push(mk('dependency', sorted[0][0], { severity: 'attention', tab: 'slots', title: `${sorted[0][0]} accounts for ${fmtPercent(share)} of ${slotLabel(k)} attendance`, body: `No second trainer exceeds ${sorted[1][1]} attendees in this slot across ${rows.length} occurrences.`, action: 'Pair a second trainer into the slot now so attendance survives leave or departure.', impactINR: sorted[0][1] * (metricValues(rows, ['rev_pac'], s.ctx).rev_pac.value ?? 0) * 0.5, n: rows.length, linkFilters: [{ dim: 'daytime', value: k, label: slotLabel(k) }] }));
    } return out; } },
  { id: 'conversion_outlier', label: 'Conversion outlier', tab: 'acquisition', run: (s, t) => {
    const groups = [...groupRows(s.tables.newc.filter((r) => r.is_new), GROUP_KEYS.trainer)].map(([k, rows]) => ({ k, rows, v: metricValues(rows, ['conversion_rate'], s.ctx).conversion_rate.value })).filter((g) => g.v !== null && g.rows.length >= 20) as { k: string; rows: Row[]; v: number }[];
    if (groups.length < 3) return []; const m = mean(groups.map((g) => g.v)); const d = sd(groups.map((g) => g.v)); if (!d) return [];
    const afp = metricValues(s.tables.newc, ['avg_first_purchase'], s.ctx).avg_first_purchase.value ?? s.ctx.medianFirstMembership;
    return groups.filter((g) => Math.abs(g.v - m) > t.conversionSigma * d).map((g) => mk('conversion_outlier', g.k, { severity: g.v > m ? 'opportunity' : 'attention', tab: 'acquisition', title: `${g.k} converts ${fmtPercent(g.v)} of trials against a ${fmtPercent(m)} average`, body: `Across ${g.rows.length} first visits, ${g.k} is ${g.v > m ? 'well above' : 'well below'} the trainer average.`, action: g.v > m ? 'Route more first-timers into this trainer\'s classes.' : 'Review the trial experience in this trainer\'s classes and pair them with a strong converter.', impactINR: Math.abs(g.v - m) * g.rows.length * afp, n: g.rows.length, linkFilters: [{ dim: 'trainer', value: g.k }] }));
  } },
  { id: 'second_visit', label: 'Second-visit collapse', tab: 'acquisition', run: (s, t) => {
    const all = metricValues(s.tables.newc, ['second_visit_rate'], s.ctx).second_visit_rate.value ?? 0; const afp = metricValues(s.tables.newc, ['avg_first_purchase'], s.ctx).avg_first_purchase.value ?? s.ctx.medianFirstMembership; const out: Insight[] = [];
    const matureTs = s.ctx.todayTs - s.ctx.matureDays * 864e5;
    for (const [k, rows] of groupRows(s.tables.newc.filter((r) => r.is_new && r.ts !== null && r.ts <= matureTs), GROUP_KEYS.source)) { if (rows.length < 20) continue; const v = metricValues(rows, ['second_visit_rate', 'conversion_rate'], s.ctx); const r = v.second_visit_rate.value; if (r === null || r >= t.secondVisitFloor || r >= all) continue;
      out.push(mk('second_visit', k, { severity: 'critical', tab: 'acquisition', title: `Only ${fmtPercent(r)} of ${k} trials return for a second class`, body: `${rows.length} first visits from ${k} against a ${fmtPercent(all)} second-visit rate overall; conversion is ${fmtPercent(v.conversion_rate.value)}.`, action: 'Add a 48-hour follow-up for this source or stop paying for it.', impactINR: Math.max(0, (all - r) * rows.length * afp * 0.3), n: rows.length, linkFilters: [{ dim: 'source', value: k }] })); }
    return out; } },
  { id: 'slow_lead', label: 'Slow lead response', tab: 'leads', run: (s, t) => {
    const out: Insight[] = [];
    // Studio-wide benchmark first: fast answers vs slow answers, so the claim is measured, not asserted.
    const answered = s.tables.leads.filter((r) => r.response_hours !== null);
    const fastAll = answered.filter((r) => r.response_hours! <= 1); const slowAll = answered.filter((r) => r.response_hours! > 1);
    const frAll = fastAll.length >= 20 ? fastAll.filter((r) => r.won).length / fastAll.length : null;
    const srAll = slowAll.length >= 20 ? slowAll.filter((r) => r.won).length / slowAll.length : null;
    const lift = frAll !== null && srAll !== null && srAll > 0 ? frAll / srAll : null;
    for (const [k, rows] of groupRows(s.tables.leads, GROUP_KEYS.associate)) {
      if (rows.length < 20) continue;                     // a handful of leads cannot indict an associate
      const v = metricValues(rows, ['median_response_hours'], s.ctx); const h = v.median_response_hours.value;
      if (h === null || h <= t.leadResponseHours) continue;
      const gap = frAll !== null && srAll !== null ? Math.max(0, frAll - srAll) : 0;
      const impact = rows.length * gap * 12599;
      out.push(mk('slow_lead', k, {
        severity: impact > 50000 ? 'critical' : 'attention', tab: 'leads',
        title: `${k} answers leads in ${h.toFixed(0)} hours on median, against a ${t.leadResponseHours}-hour target`,
        body: lift ? `Across the book, leads answered within an hour convert at ${lift.toFixed(1)}× the rate of slower ones (${fmtPercent(frAll)} against ${fmtPercent(srAll)}). This associate holds ${rows.length} leads.`
                   : `This associate holds ${rows.length} leads and none were answered inside the target.`,
        action: 'Set a one-hour first-touch SLA and route overflow to whoever is fastest this week.',
        impactINR: impact, n: rows.length, linkFilters: [{ dim: 'associate', value: k }],
      }));
    }
    // Only the three worst offenders reach the rail; the rest are visible on the Leads tab.
    return out.sort((a, b) => b.impactINR - a.impactINR).slice(0, 3); } },
  { id: 'untouched', label: 'Untouched leads', tab: 'leads', run: (s) => { const v = metricValues(s.tables.leads, ['untouched_leads', 'lead_conversion_rate'], s.ctx); const n = v.untouched_leads.value ?? 0; if (!n) return []; const val = n * (v.lead_conversion_rate.value ?? 0.1) * 12599; return [mk('untouched', 'Leads', { severity: 'critical', tab: 'leads', title: `${n} leads have had no contact for more than 48 hours`, body: `At the current ${fmtPercent(v.lead_conversion_rate.value)} win rate these are worth about ${fmtCurrency(val)}.`, action: 'Work the untouched list today, newest first.', impactINR: val, n, linkFilters: [] })]; } },
  { id: 'discount_creep', label: 'Discount creep', tab: 'sales', run: (s, t) => { const a = metricValues(s.tables.sales, ['discount_rate', 'discount_value'], s.ctx); const b = metricValues(s.compare.sales, ['discount_rate'], s.ctx); if (a.discount_rate.value === null || b.discount_rate.value === null || a.discount_rate.value - b.discount_rate.value <= t.discountCreepPp) return []; return [mk('discount_creep', 'Sales', { severity: 'attention', tab: 'sales', title: `Discounting rose from ${fmtPercent(b.discount_rate.value)} to ${fmtPercent(a.discount_rate.value)}`, body: `${fmtCurrency(a.discount_value.value)} was given away in discounts this period.`, action: 'Review who is issuing codes and cap discount depth on memberships.', impactINR: a.discount_value.value ?? 0, linkFilters: [] })]; } },
  { id: 'dormant', label: 'Dormant actives', tab: 'retention', run: (s, t) => { const rows = s.tables.lapsed.filter((r) => r.active && (r.days_since_last_visit ?? 0) > t.dormantDays); if (!rows.length) return []; const val = rows.reduce((a, r) => a + (r.amount_paid ?? 0), 0); return [mk('dormant', 'Active members', { severity: 'critical', tab: 'retention', title: `${rows.length} paying members haven't visited in ${t.dormantDays} days`, body: `Their current memberships are worth ${fmtCurrency(val)} and the pattern precedes most churn.`, action: 'Call the top of the dormancy worklist today; start with the highest risk score.', impactINR: val, n: rows.length, basis: 'at-risk', claims: rows.map((r) => r.member_id).filter(Boolean) as string[], linkFilters: [{ dim: 'status', value: 'Active' }] })]; } },
  { id: 'zero_usage', label: 'Zero-usage memberships', tab: 'retention', run: (s, t) => { const rows = s.tables.lapsed.filter((r) => r.active && (r.completed ?? 0) === 0 && (r.days_elapsed ?? 0) > t.zeroUsageDays && (r.amount_paid ?? 0) > 0); if (!rows.length) return []; const val = rows.reduce((a, r) => a + (r.amount_paid ?? 0), 0); return [mk('zero_usage', 'Unused memberships', { severity: 'critical', tab: 'retention', title: `${rows.length} memberships bought and never used`, body: `Worth ${fmtCurrency(val)}; each started more than a week ago with zero completed sessions.`, action: 'Book their first class for them — a concierge booking converts most of these.', impactINR: val, n: rows.length, basis: 'sunk', claims: rows.map((r) => r.member_id).filter(Boolean) as string[], linkFilters: [] })]; } },
  { id: 'expiry_cliff', label: 'Expiry cliff', tab: 'retention', run: (s, t) => { const act = s.tables.lapsed.filter((r) => r.active); const v = metricValues(act, ['expiring_30d', 'revenue_at_risk_30d'], s.ctx); const n = v.expiring_30d.value ?? 0; if (!act.length || n / act.length <= t.expiryCliffShare) return []; const d = new Date(s.ctx.todayTs + 30 * 864e5).toISOString().slice(0, 10); return [mk('expiry_cliff', 'Renewals', { severity: 'attention', tab: 'retention', title: `${n} memberships worth ${fmtCurrency(v.revenue_at_risk_30d.value)} expire before ${fmtDate(d)}`, body: `That is ${fmtPercent(n / act.length)} of the active base ending inside 30 days.`, action: 'Run the renewal cadence now; prioritise members with high utilisation.', impactINR: v.revenue_at_risk_30d.value ?? 0, n, basis: 'at-risk', claims: act.filter((r) => r.end_ts !== null && r.end_ts >= s.ctx.todayTs && r.end_ts <= s.ctx.todayTs + 30 * 864e5).map((r) => r.member_id).filter(Boolean) as string[], linkFilters: [] })]; } },
  { id: 'utilisation_risk', label: 'Utilisation risk', tab: 'retention', run: (s, t) => { const rows = s.tables.lapsed.filter((r) => r.active && r.sessions_limit && r.duration_days && r.days_elapsed !== null && r.days_elapsed >= r.duration_days / 2 && ((r.completed ?? 0) / r.sessions_limit) < t.utilisationFloor); if (rows.length < 3) return []; const val = rows.reduce((a, r) => a + (r.liability ?? 0), 0); return [mk('utilisation_risk', 'Under-users', { severity: 'attention', tab: 'retention', title: `${rows.length} members are on pace to use less than a quarter of what they bought`, body: `They are past the midpoint of their term with ${fmtCurrency(val)} of sessions still unused.`, action: 'Send a mid-term nudge with two suggested classes each.', impactINR: val, n: rows.length, basis: 'at-risk', claims: rows.map((r) => r.member_id).filter(Boolean) as string[], linkFilters: [] })]; } },
  { id: 'first_visit_cliff', label: 'First-visit cliff', tab: 'acquisition', run: (s) => {
    // Only judge cohorts that have had 21 days to come back — otherwise last week's joiners
    // are counted as lost and the rate is meaningless.
    const mature = s.ctx.todayTs - s.ctx.matureDays * 864e5;
    const fresh = s.tables.newc.filter((r) => r.is_new && r.ts !== null && r.ts <= mature);
    if (fresh.length < 30) return [];
    const never = fresh.filter((r) => (r.visits_post_trial ?? 0) === 0).length;
    const share = never / fresh.length; if (share < 0.5) return [];
    const afp = metricValues(fresh, ['avg_first_purchase'], s.ctx).avg_first_purchase.value ?? s.ctx.medianFirstMembership;
    return [mk('first_visit_cliff', 'First visit', { severity: 'critical', tab: 'acquisition',
      title: `${fmtPercent(share)} of first-timers never come back`,
      body: `${never.toLocaleString('en-IN')} of ${fresh.length.toLocaleString('en-IN')} people whose first class was at least three weeks ago never returned. Anyone who joined more recently is excluded, so this is a settled figure.`,
      action: 'Book the second class before they leave the building, and follow up inside 48 hours.',
      impactINR: never * afp * 0.25, n: fresh.length, linkFilters: [] })];
  } },
  { id: 'renewal_ladder', label: 'Renewal ladder', tab: 'retention', run: (s) => {
    const m = new Map<string, { n: number; spend: number }>();
    for (const r of s.tables.lapsed) { if (!r.member_id) continue; const e = m.get(r.member_id) ?? { n: 0, spend: 0 }; e.n++; e.spend += r.amount_paid ?? 0; m.set(r.member_id, e); }
    if (m.size < 30) return [];
    const one = [...m.values()].filter((x) => x.n === 1); const more = [...m.values()].filter((x) => x.n > 1);
    if (!one.length || !more.length) return [];
    const avgOne = one.reduce((a, x) => a + x.spend, 0) / one.length;
    const avgMore = more.reduce((a, x) => a + x.spend, 0) / more.length;
    if (avgMore <= avgOne * 1.2) return [];
    return [mk('renewal_ladder', 'Second membership', { severity: 'opportunity', tab: 'retention',
      title: `A second membership is worth ${(avgMore / avgOne).toFixed(1)}× the first`,
      body: `${one.length.toLocaleString('en-IN')} members stopped at one membership worth ${fmtCurrency(avgOne)} on average, against ${fmtCurrency(avgMore)} for the ${more.length.toLocaleString('en-IN')} who renewed at least once.`,
      action: 'Target the one-membership group with a renewal offer before their end date.',
      impactINR: one.length * (avgMore - avgOne) * 0.1, n: m.size, linkFilters: [] })];
  } },
  { id: 'never_activated', label: 'Never activated', tab: 'retention', run: (s) => {
    const rows = s.tables.lapsed.filter((r) => r.status === 'Not Activated' && (r.amount_paid ?? 0) > 0);
    if (rows.length < 5) return [];
    const val = rows.reduce((a, r) => a + (r.amount_paid ?? 0), 0);
    return [mk('never_activated', 'Never activated', { severity: 'attention', tab: 'retention',
      title: `${rows.length} memberships were paid for but never activated`,
      body: `Worth ${fmtCurrency(val)}. These members bought and then never started the clock.`,
      action: 'Activate them manually and book the first class — the membership is already paid.',
      impactINR: val, n: rows.length, basis: 'sunk', claims: rows.map((r) => r.member_id).filter(Boolean) as string[], linkFilters: [{ dim: 'status', value: 'Not Activated' }] })];
  } },
  { id: 'discount_retention', label: 'Discount and retention', tab: 'retention', run: (s) => {
    const disc = s.tables.lapsed.filter((r) => (r.discount_value ?? 0) > 0 && (r.original_amount ?? 0) > 0);
    const full = s.tables.lapsed.filter((r) => !(r.discount_value ?? 0) && (r.amount_paid ?? 0) > 0);
    if (disc.length < 25 || full.length < 25) return [];
    const cd = metricValues(disc, ['churn_rate'], s.ctx).churn_rate.value ?? 0;
    const cf = metricValues(full, ['churn_rate'], s.ctx).churn_rate.value ?? 0;
    if (cd - cf < 0.08) return [];
    const spend = disc.reduce((a, r) => a + (r.discount_value ?? 0), 0);
    return [mk('discount_retention', 'Discounting', { severity: 'attention', tab: 'retention',
      title: `Discounted memberships churn at ${fmtPercent(cd)} against ${fmtPercent(cf)} at full price`,
      body: `${disc.length.toLocaleString('en-IN')} discounted memberships gave away ${fmtCurrency(spend)} and retained worse than the ${full.length.toLocaleString('en-IN')} sold at full price.`,
      action: 'Stop discounting to win the sale; spend the same money on onboarding the first three visits.',
      impactINR: spend, n: disc.length + full.length, linkFilters: [] })];
  } },
  { id: 'high_risk_value', label: 'High-risk value', tab: 'retention', run: (s) => {
    const rows = s.tables.lapsed.filter((r) => r.active && (r.risk_score ?? 0) >= s.ctx.riskHigh);
    if (rows.length < 5) return [];
    const val = rows.reduce((a, r) => a + (r.amount_paid ?? 0), 0);
    const contactable = rows.filter((r) => r.contactable).length;
    return [mk('high_risk_value', 'High-risk actives', { severity: 'critical', tab: 'retention',
      title: `${rows.length} active memberships worth ${fmtCurrency(val)} score ${s.ctx.riskHigh} or above on churn risk`,
      body: `${contactable} of them are contactable. Risk blends low utilisation, long absence, cancellations and poor attendance.`,
      action: 'Work the save list on the Retention tab, highest score first.',
      impactINR: val, n: rows.length, basis: 'at-risk', claims: rows.map((r) => r.member_id).filter(Boolean) as string[], linkFilters: [] })];
  } },
  { id: 'no_show_cluster', label: 'No-show cluster', tab: 'bookings', run: (s, t) => { const out: Insight[] = []; for (const [k, rows] of groupRows(s.tables.bookings, GROUP_KEYS.slot)) { if (rows.length < 10) continue; const v = metricValues(rows, ['b_no_show_rate', 'b_no_show'], s.ctx); const r = v.b_no_show_rate.value; if (r === null || r <= t.noShowRate) continue; out.push(mk('no_show_cluster', slotLabel(k), { severity: 'attention', tab: 'bookings', title: `${slotLabel(k)} loses ${fmtPercent(r)} of bookings to no-shows`, body: `${v.b_no_show.value} seats were blocked by no-shows across ${rows.length} bookings.`, action: 'Enable a waitlist and a 12-hour reminder for this slot.', impactINR: (v.b_no_show.value ?? 0) * (metricValues(s.tables.sessions, ['rev_pac'], s.ctx).rev_pac.value ?? 0), n: rows.length, linkFilters: [{ dim: 'daytime', value: k, label: slotLabel(k) }] })); } return out; } },
  { id: 'mix_shift', label: 'Revenue mix shift', tab: 'sales', run: (s, t) => { const a = metricValues(s.tables.sales, ['membership_rev_share', 'gross_revenue'], s.ctx); const b = metricValues(s.compare.sales, ['membership_rev_share'], s.ctx); if (a.membership_rev_share.value === null || b.membership_rev_share.value === null || Math.abs(a.membership_rev_share.value - b.membership_rev_share.value) <= t.mixShiftPp) return []; const up = a.membership_rev_share.value > b.membership_rev_share.value; return [mk('mix_shift', 'Revenue mix', { severity: 'context', tab: 'sales', title: `Membership revenue ${up ? 'rose' : 'fell'} from ${fmtPercent(b.membership_rev_share.value)} to ${fmtPercent(a.membership_rev_share.value)} of the total`, body: `On ${fmtCurrency(a.gross_revenue.value)} gross this period.`, action: up ? 'Recurring revenue is strengthening; protect it with renewal follow-ups.' : 'Single-class and package revenue is displacing memberships; push conversion offers.', impactINR: Math.abs(a.membership_rev_share.value - b.membership_rev_share.value) * (a.gross_revenue.value ?? 0), linkFilters: [] })]; } },
  { id: 'source_quality', label: 'Source quality gap', tab: 'acquisition', run: (s) => { const gs = [...groupRows(s.tables.newc.filter((r) => r.is_new), GROUP_KEYS.source)].map(([k, rows]) => ({ k, rows, ltv: metricValues(rows, ['avg_ltv'], s.ctx).avg_ltv.value ?? 0 })).filter((g) => g.rows.length >= 20); if (gs.length < 4) return []; const sorted = [...gs].sort((a, b) => a.ltv - b.ltv); const q = sorted[Math.floor(sorted.length / 4)].ltv; const vol = [...gs].sort((a, b) => b.rows.length - a.rows.length).slice(0, Math.ceil(gs.length / 2)); return vol.filter((g) => g.ltv <= q).map((g) => mk('source_quality', g.k, { severity: 'attention', tab: 'acquisition', title: `${g.k} produced ${g.rows.length} new clients but the lowest average LTV at ${fmtCurrency(g.ltv)}`, body: `It is a top-half source by volume and a bottom-quartile source by value.`, action: 'Shift spend from this source toward the sources ranked on total value below.', impactINR: (mean(gs.map((x) => x.ltv)) - g.ltv) * g.rows.length, n: g.rows.length, linkFilters: [{ dim: 'source', value: g.k }] })); } },
  { id: 'integrity', label: 'Data integrity', tab: 'health', run: (s, t) => { const a = metricValues(s.tables.sessions, ['attendance'], s.ctx).attendance.value ?? 0; const b = metricValues(s.tables.checkins, ['checkins'], s.ctx).checkins.value ?? 0; if (!a || !b) return []; const v = Math.abs(a - b) / Math.max(a, b); if (v <= t.integrityVariance) return []; return [mk('integrity', 'Sessions vs Checkins', { severity: 'critical', tab: 'health', title: `Attendance differs by ${fmtPercent(v)} between Sessions and Checkins`, body: `Sessions report ${a.toLocaleString('en-IN')} attendees; Checkins report ${b.toLocaleString('en-IN')} for the same period.`, action: 'Reconcile on Session ID before trusting fill-rate figures.', impactINR: 0, linkFilters: [] })]; } },
];
