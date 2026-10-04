import type { Scope } from '../state/data';
import type { Thresholds } from '../state/view';
import { RULES, type Insight } from './rules';

const SEV_ORDER = { critical: 0, attention: 1, opportunity: 2, context: 3 };
let cache: { sig: string; out: Insight[] } | null = null;

/** Run every rule, dedupe by entity (keep the highest-impact), sort by rupee impact within severity. */
export function runRules(scope: Scope, thresholds: Thresholds): Insight[] {
  const sig = `${scope.rowsInScope}|${scope.period.start}|${scope.period.end}|${JSON.stringify(scope.filters)}|${JSON.stringify(thresholds)}|${scope.ctx.ratePerSession}`;
  if (cache && cache.sig === sig) return cache.out;
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
  cache = { sig, out };
  return out;
}

export interface ImpactSummary { basis: string; gross: number; net: number; entities: number; overlapping: number }

/** Sum impacts honestly: only within a basis, and only counting each claimed member once.
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
    // Highest-impact insight keeps a claimed member; later ones forfeit their share of it.
    const claimed = new Set<string>();
    let net = 0; let overlapping = 0;
    for (const i of [...list].sort((a, b) => b.impactINR - a.impactINR)) {
      const cs = i.claims;
      if (!cs || !cs.length) { net += i.impactINR; continue; }
      const fresh = cs.filter((c) => !claimed.has(c));
      overlapping += cs.length - fresh.length;
      net += i.impactINR * (fresh.length / cs.length);
      for (const c of fresh) claimed.add(c);
    }
    out.push({ basis, gross, net, entities: claimed.size, overlapping });
  }
  return out.sort((a, b) => b.net - a.net);
}

export const isDismissed = (dismissed: Record<string, number>, key: string) => { const t = dismissed[key]; return !!t && Date.now() - t < 30 * 864e5; };
