import type { Scope } from '../state/data';
import type { Thresholds } from '../state/view';
import { RULES, type Insight } from './rules';

const SEV_ORDER = { critical: 0, attention: 1, opportunity: 2, context: 3 };
/* Keyed on the scope object itself, not on a row count: a refresh that replaces the data without
   changing how many rows there are must still recompute, or the rail shows yesterday's rupees. */
let cache: { scope: Scope; sig: string; out: Insight[] } | null = null;

/** Run every rule, dedupe by entity (keep the highest-impact), sort by rupee impact within severity. */
export function runRules(scope: Scope, thresholds: Thresholds): Insight[] {
  const sig = `${scope.rowsInScope}|${scope.period.start}|${scope.period.end}|${JSON.stringify(scope.filters)}|${JSON.stringify(thresholds)}|${scope.ctx.ratePerSession}`;
  if (cache && cache.scope === scope && cache.sig === sig) return cache.out;
  const scopeWithToday = scope;
  const all: Insight[] = [];
  for (const r of RULES) {
    try {
      // Cap each rule's contribution so one noisy rule cannot crowd out every other signal.
      const fired = r.run(scopeWithToday, thresholds).sort((a, b) => b.impactINR - a.impactINR);
      all.push(...fired.slice(0, 5));
    } catch (e) { console.warn('rule failed', r.id, e); }
  }
  const byEntity = new Map<string, Insight>();
  for (const i of all) { const k = `${i.tab}|${i.entity}`; const prev = byEntity.get(k); if (!prev || i.impactINR > prev.impactINR) byEntity.set(k, i); }
  const out = [...byEntity.values()].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.impactINR - a.impactINR);
  cache = { scope, sig, out };
  return out;
}

export interface ImpactSummary { basis: string; gross: number; net: number; entities: number; overlapping: number }

/** Sum impacts honestly: only within a basis, counting each claimed member once, at the largest
 *  amount any insight attributes to them.
 *  Insights that claim overlapping populations (dormancy is an input to the risk score, so the
 *  dormant and high-risk rules describe largely the same people) must not be added twice. */
export function summariseImpact(insights: Insight[]): ImpactSummary[] {
  const byBasis = new Map<string, Insight[]>();
  for (const i of insights) {
    const b = i.basis ?? 'none';
    if (b === 'none' || i.impactINR <= 0) continue;
    byBasis.set(b, [...(byBasis.get(b) ?? []), i]);
  }
  const out: ImpactSummary[] = [];
  for (const [basis, list] of byBasis) {
    const gross = list.reduce((a, i) => a + i.impactINR, 0);
    /* Policy: a member is worth, at most, the largest amount any single insight claims for them.
       Two cards describing the same dormant member do not put that member's money at risk twice,
       and the member's own value is used rather than the card's average — the old proportional
       deduction assumed every claimed member was worth the same. */
    const perMember = new Map<string, number>();
    let net = 0; let overlapping = 0;
    for (const i of list) {
      const cs = i.claims;
      if (!cs || !cs.length) { net += i.impactINR; continue; }
      for (const c of cs) {
        const prev = perMember.get(c.id);
        if (prev === undefined) perMember.set(c.id, c.value);
        else { overlapping++; if (c.value > prev) perMember.set(c.id, c.value); }
      }
    }
    for (const v of perMember.values()) net += v;
    out.push({ basis, gross, net, entities: perMember.size, overlapping });
  }
  return out.sort((a, b) => b.net - a.net);
}

export const isDismissed = (dismissed: Record<string, number>, key: string) => { const t = dismissed[key]; return !!t && Date.now() - t < 30 * 864e5; };
