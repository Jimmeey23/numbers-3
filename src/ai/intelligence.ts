/* Tab intelligence — the single AI pass that fills every AI surface in the product.
 *
 * One "Generate with AI" press produces: an executive summary, key takeaways, per-KPI
 * commentary, per-table reads, prioritised recommendations, watch-outs, an outlook and
 * follow-up questions — plus the insight-rail signals the earlier version produced.
 * Consumers subscribe through `src/state/ai.ts`, so no surface needs its own API call.
 */
import type { TabId } from '../state/view';
import type { AISignal } from './client';
import { openAIJson, digest, readAIConfig } from './client';
import { readAIFromCloud, saveAIToCloud } from '../sync/cloud';

export type Severity = 'critical' | 'attention' | 'opportunity' | 'context';
export type Verdict = 'good' | 'watch' | 'bad' | 'neutral';

export interface AIKpiNote { metricId: string; label?: string; verdict: Verdict; note: string; driver?: string }
export interface AITableNote { title: string; summary: string; standouts?: string[]; recommendation?: string }
export interface AIRecommendation {
  title: string; rationale: string; steps: string[]; priority: 'now' | 'this-week' | 'this-month';
  owner?: string; effort?: 'low' | 'medium' | 'high'; impactINR?: number; metricId?: string; confidence?: 'high' | 'medium' | 'low';
}
export interface AIRisk { title: string; body: string; severity: Severity; earlyIndicator?: string }
export interface AIOutlook { metricId?: string; label: string; direction: 'up' | 'down' | 'flat'; expectation: string; basis: string }

export interface AITabIntelligence {
  tab: TabId; fingerprint: string; model: string; generatedAt: string; scopeLabel: string;
  headline: string;
  executiveSummary: string;
  keyTakeaways: string[];
  kpiNotes: AIKpiNote[];
  tableNotes: AITableNote[];
  recommendations: AIRecommendation[];
  risks: AIRisk[];
  outlook: AIOutlook[];
  questions: string[];
  dataCaveats: string[];
  signals: AISignal[];
}

const SYSTEM = `You are the senior operating analyst for a boutique fitness group (Barre, PowerCycle, Strength Lab studios in India; currency INR).
You are given one dashboard tab snapshot: headline KPIs with prior-period comparisons, grouped breakdowns, deterministic rule insights and the exact scope (period, locations, filters).
Analyse only what is supplied. Never invent a number, a name or a period. Quote figures exactly as they appear. If something cannot be judged from the snapshot, say so in dataCaveats instead of guessing.

Return a single JSON object with these keys:
- headline: one sentence, max 14 words, the single most important thing happening on this tab.
- executiveSummary: 3-5 sentences of plain operating prose: what changed, why it likely changed, what it means for the month.
- keyTakeaways: array of 3-6 short strings, each a standalone fact with its number.
- kpiNotes: array covering the most decision-relevant headline KPIs (one entry per KPI, max 8). Each: metricId (exactly as supplied), label, verdict one of good|watch|bad|neutral, note (max 22 words, must cite the value or the change), optional driver (the group or segment most responsible).
- tableNotes: array (max 5) reading the grouped breakdowns. Each: title (use the supplied grouping/table label), summary (2 sentences), standouts (array of short strings naming specific rows), recommendation (one sentence).
- recommendations: array of 4-7 prioritised, specific, controllable actions. Each: title (imperative, max 10 words), rationale (cites evidence), steps (2-4 concrete steps), priority now|this-week|this-month, owner (role such as Studio manager, Head trainer, Sales lead), effort low|medium|high, optional impactINR (integer rupees, only when derivable), optional metricId, confidence high|medium|low.
- risks: array (max 5) of watch-outs. Each: title, body (with evidence), severity critical|attention|opportunity|context, earlyIndicator (what to monitor weekly).
- outlook: array (max 4) of forward reads. Each: label, optional metricId, direction up|down|flat, expectation (what next period likely looks like if nothing changes), basis (the observed evidence behind it).
- questions: array of 4-6 sharp follow-up questions an operator should ask of this data next.
- dataCaveats: array (max 4) of sample-size, coverage or definition caveats that limit the reading.
- signals: array of 5-10 non-overlapping insight cards. Each: title, body (with exact evidence), action, severity critical|attention|opportunity|context, optional impactINR, entity, metricId.

Be concrete and operational. No filler, no generic best-practice advice, no restating the definitions.`;

const empty = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export async function generateTabIntelligence(
  tab: TabId, payload: unknown, scopeLabel: string, scopeMonth: string, locations: string[],
): Promise<{ intelligence: AITabIntelligence; cached: boolean }> {
  const config = readAIConfig();
  const fingerprint = await digest({ version: 1, kind: 'tab-intelligence', model: config.model, tab, payload });
  const key = `floor.ai.tab-intel.${fingerprint}`;

  const hydrate = (raw: Partial<AITabIntelligence>): AITabIntelligence => ({
    tab, fingerprint, model: config.model, scopeLabel,
    generatedAt: raw.generatedAt ?? new Date().toISOString(),
    headline: String(raw.headline ?? ''),
    executiveSummary: String(raw.executiveSummary ?? ''),
    keyTakeaways: empty<string>(raw.keyTakeaways).slice(0, 6),
    kpiNotes: empty<AIKpiNote>(raw.kpiNotes).slice(0, 8),
    tableNotes: empty<AITableNote>(raw.tableNotes).slice(0, 5),
    recommendations: empty<AIRecommendation>(raw.recommendations).slice(0, 7),
    risks: empty<AIRisk>(raw.risks).slice(0, 5),
    outlook: empty<AIOutlook>(raw.outlook).slice(0, 4),
    questions: empty<string>(raw.questions).slice(0, 6),
    dataCaveats: empty<string>(raw.dataCaveats).slice(0, 4),
    signals: empty<AISignal>(raw.signals).slice(0, 10),
  });

  try {
    const local = localStorage.getItem(key);
    if (local) return { intelligence: hydrate(JSON.parse(local) as AITabIntelligence), cached: true };
  } catch { /* cache optional */ }

  const cloud = await readAIFromCloud<AITabIntelligence>(fingerprint);
  if (cloud) {
    const intelligence = hydrate(cloud);
    try { localStorage.setItem(key, JSON.stringify(intelligence)); } catch { /* optional */ }
    return { intelligence, cached: true };
  }

  const raw = await openAIJson<Partial<AITabIntelligence>>(SYSTEM, { tab, scopeLabel, snapshot: payload });
  const intelligence = hydrate({ ...raw, generatedAt: new Date().toISOString() });
  try { localStorage.setItem(key, JSON.stringify(intelligence)); } catch { /* optional */ }
  await saveAIToCloud(fingerprint, 'intelligence', tab, scopeMonth, locations, intelligence);
  return { intelligence, cached: false };
}
