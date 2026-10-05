/* Tab intelligence — the single AI pass that fills every AI surface in the product.
 *
 * One "Generate with AI" press produces: an executive summary, key takeaways, per-KPI
 * commentary, per-table reads, root-cause hypotheses, prioritised recommendations with
 * one-click actions and a measurement plan, experiments, what-if scenarios, watch-outs, an
 * outlook and follow-up questions — plus the insight-rail signals.
 *
 * The model never sees raw rows. It sees the same scoped aggregates the operator sees, plus the
 * deterministic quant pack (anomaly z-scores, trend fits, forecasts, driver attribution,
 * concentration, correlation, seasonality, data-quality flags). Grounding it in statistics that
 * were computed locally is what turns the output from fluent description into analysis.
 */
import type { TabId } from '../state/view';
import type { AISignal } from './client';
import { openAIJson, digest, readAIConfig } from './client';
import { readAIFromCloud, saveAIToCloud } from '../sync/cloud';
import { sanitiseActions, type AIAction } from './actions';
import type { QuantPack } from './analytics';
import { compactQuant } from './analytics';

export type Severity = 'critical' | 'attention' | 'opportunity' | 'context';
export type Verdict = 'good' | 'watch' | 'bad' | 'neutral';

export interface AIKpiNote { metricId: string; label?: string; verdict: Verdict; note: string; driver?: string }
export interface AITableNote { title: string; summary: string; standouts?: string[]; recommendation?: string }
export interface AIRootCause { effect: string; hypothesis: string; evidence: string; confidence: 'high' | 'medium' | 'low'; testedBy: string }
export interface AIRecommendation {
  title: string; rationale: string; steps: string[]; priority: 'now' | 'this-week' | 'this-month';
  owner?: string; effort?: 'low' | 'medium' | 'high'; impactINR?: number; metricId?: string; confidence?: 'high' | 'medium' | 'low';
  measure?: string; risk?: string; actions?: AIAction[];
}
export interface AIExperiment { title: string; hypothesis: string; change: string; measure: string; duration: string; successCriterion: string }
export interface AIScenario { title: string; lever: string; assumption: string; estimatedImpactINR?: number; math: string; confidence: 'high' | 'medium' | 'low' }
export interface AIRisk { title: string; body: string; severity: Severity; earlyIndicator?: string }
export interface AIOutlook { metricId?: string; label: string; direction: 'up' | 'down' | 'flat'; expectation: string; basis: string }

export interface AITabIntelligence {
  tab: TabId; fingerprint: string; model: string; generatedAt: string; scopeLabel: string;
  headline: string;
  executiveSummary: string;
  keyTakeaways: string[];
  kpiNotes: AIKpiNote[];
  tableNotes: AITableNote[];
  rootCauses: AIRootCause[];
  recommendations: AIRecommendation[];
  experiments: AIExperiment[];
  scenarios: AIScenario[];
  risks: AIRisk[];
  outlook: AIOutlook[];
  questions: string[];
  dataCaveats: string[];
  actions: AIAction[];
  signals: AISignal[];
  /** The deterministic pack this generation was grounded in, kept for the radar UI. */
  quant?: QuantPack;
}

const ACTION_GRAMMAR = `An action is one of:
  {"label":"…","kind":"focus","filter":{"dim":"<group key>","value":"<exact label from the data>"},"tab":"<tab id>"}
  {"label":"…","kind":"tab","tab":"<tab id>"}
  {"label":"…","kind":"widget","tab":"<tab id>","widget":{"kind":"table|bar|column|line|area|ranking|heatmap|trend|metric","title":"…","metrics":["<metric id>"],"groupBy":"<group key>","limit":10}}
  {"label":"…","kind":"ask","question":"…"}
Only use dim/groupBy values listed in availableGroupings, metric ids listed in availableMetrics, and tab ids present in the snapshot. Use exact entity labels copied from the supplied rows. If you cannot satisfy that, omit the action.`;

const SYSTEM = `You are the senior operating analyst for a boutique fitness group (Barre, PowerCycle and Strength Lab studios in India; currency INR).
You receive one dashboard tab snapshot — headline KPIs with prior-period comparisons, grouped breakdowns, deterministic rule insights, the exact scope — and a "quant" block of locally computed statistics: robust z-scores, six-month trend fits with R², forecasts, month-to-date pace, driver attribution (who moved the number and what share of the change they own), concentration, correlation and data-quality flags.

Rules:
- The quant block is ground truth. Build the analysis on it. Quote figures exactly as supplied; never compute a new number you cannot show the arithmetic for.
- Separate movement from noise: a change inside the historical spread (|z| < 2) is noise unless a driver or a streak explains it. Say so rather than dramatising it.
- Separate correlation from causation. Root causes are hypotheses and must say how to test them.
- Prefer controllable levers (timetable, trainer allocation, pricing, follow-up cadence, capacity) over uncontrollable ones.
- Small samples and partial coverage must be stated, not smoothed over.
- No filler, no generic best practice, no restating metric definitions.

Return one JSON object:
- headline: one sentence, max 14 words — the single most important thing happening.
- executiveSummary: 3-5 sentences: what changed, what drove it, what it means for the month.
- keyTakeaways: 3-6 standalone strings, each with its number.
- kpiNotes: up to 8. Each {metricId (exact), label, verdict good|watch|bad|neutral, note (max 22 words, cites the value or change), driver (the group most responsible, optional)}.
- tableNotes: up to 5. Each {title (the supplied grouping label), summary (2 sentences), standouts (short strings naming specific rows), recommendation}.
- rootCauses: up to 4. Each {effect, hypothesis, evidence (from the quant block), confidence high|medium|low, testedBy (the specific check that would confirm it)}.
- recommendations: 4-7 prioritised, specific, controllable actions. Each {title (imperative, max 10 words), rationale (cites evidence), steps (2-4), priority now|this-week|this-month, owner (role), effort low|medium|high, impactINR (integer, only when derivable), metricId, confidence, measure (the metric and threshold that proves it worked), risk (what could go wrong), actions (0-2 action objects)}.
- experiments: up to 3. Each {title, hypothesis, change (what to vary), measure, duration, successCriterion}.
- scenarios: up to 3 what-ifs. Each {title, lever, assumption (state the % or count assumed), estimatedImpactINR, math (the arithmetic in one line, using supplied numbers), confidence}.
- risks: up to 5. Each {title, body (with evidence), severity critical|attention|opportunity|context, earlyIndicator (what to watch weekly)}.
- outlook: up to 4. Each {label, metricId, direction up|down|flat, expectation, basis}.
- questions: 4-6 sharp follow-ups worth asking of this data next.
- dataCaveats: up to 4 sample, coverage or definition limits.
- actions: 3-6 top-level one-click actions that take the operator to the evidence.
- signals: 5-10 non-overlapping insight cards. Each {title, body (exact evidence), action, severity, impactINR?, entity?, metricId?}.

${ACTION_GRAMMAR}`;

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export async function generateTabIntelligence(
  tab: TabId, payload: unknown, quant: QuantPack, scopeLabel: string, scopeMonth: string, locations: string[],
): Promise<{ intelligence: AITabIntelligence; cached: boolean }> {
  const config = readAIConfig();
  const fingerprint = await digest({ version: 2, kind: 'tab-intelligence', model: config.model, tab, payload });
  const key = `floor.ai.tab-intel.${fingerprint}`;

  const hydrate = (raw: Partial<AITabIntelligence>): AITabIntelligence => ({
    tab, fingerprint, model: config.model, scopeLabel,
    generatedAt: raw.generatedAt ?? new Date().toISOString(),
    headline: String(raw.headline ?? ''),
    executiveSummary: String(raw.executiveSummary ?? ''),
    keyTakeaways: arr<string>(raw.keyTakeaways).slice(0, 6),
    kpiNotes: arr<AIKpiNote>(raw.kpiNotes).slice(0, 8),
    tableNotes: arr<AITableNote>(raw.tableNotes).slice(0, 5),
    rootCauses: arr<AIRootCause>(raw.rootCauses).slice(0, 4),
    recommendations: arr<AIRecommendation>(raw.recommendations).slice(0, 7)
      .map((r) => ({ ...r, steps: arr<string>(r.steps), actions: sanitiseActions(r.actions) })),
    experiments: arr<AIExperiment>(raw.experiments).slice(0, 3),
    scenarios: arr<AIScenario>(raw.scenarios).slice(0, 3),
    risks: arr<AIRisk>(raw.risks).slice(0, 5),
    outlook: arr<AIOutlook>(raw.outlook).slice(0, 4),
    questions: arr<string>(raw.questions).slice(0, 6),
    dataCaveats: arr<string>(raw.dataCaveats).slice(0, 4),
    actions: sanitiseActions(raw.actions),
    signals: arr<AISignal>(raw.signals).slice(0, 10),
    quant,
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

  const raw = await openAIJson<Partial<AITabIntelligence>>(SYSTEM, { tab, scopeLabel, snapshot: payload, quant: compactQuant(quant) });
  const intelligence = hydrate({ ...raw, generatedAt: new Date().toISOString() });
  try { localStorage.setItem(key, JSON.stringify(intelligence)); } catch { /* optional */ }
  await saveAIToCloud(fingerprint, 'intelligence', tab, scopeMonth, locations, intelligence);
  return { intelligence, cached: false };
}

/* ── Whole-business synthesis ──────────────────────────────────────────────
   A tab brief cannot see that leads improved while the slots those leads book are full. This
   pass reads every tab's compact snapshot at once and is the only place cross-functional
   contradictions can be found. */
export interface AIBusinessBriefing {
  fingerprint: string; model: string; generatedAt: string; scopeLabel: string;
  headline: string;
  executiveSummary: string;
  scorecard: { area: string; tab: TabId; state: 'strong' | 'steady' | 'soft' | 'critical'; note: string }[];
  chains: { chain: string; finding: string; evidence: string; implication: string; confidence: 'high' | 'medium' | 'low' }[];
  contradictions: { finding: string; evidence: string; resolution: string }[];
  priorities: { rank: number; title: string; why: string; owner?: string; impactINR?: number; tab?: TabId; firstStep: string }[];
  watchlist: { title: string; metric: string; threshold: string; tab?: TabId }[];
  questions: string[];
}

const BUSINESS_SYSTEM = `You are the group operating analyst for a boutique fitness business in India (INR). You receive compact snapshots of every dashboard area at once — classes, slots, trainers, sales, acquisition, retention, bookings, leads, attendance, payroll — each with headline KPIs, comparisons and locally computed statistics.
Your job is the thing no single tab can do: connect them. Trace demand from lead to booking to visit to purchase to retention to trainer cost. Find where one area's gain is another's loss, and where two areas disagree about the same underlying reality.
Quote only supplied figures. Flag thin samples. Prefer controllable levers.

Return JSON:
- headline: one sentence, max 16 words.
- executiveSummary: 4-6 sentences on the state of the business this period.
- scorecard: one entry per supplied area {area, tab (the supplied tab id), state strong|steady|soft|critical, note (one sentence with a number)}.
- chains: 3-5 cross-functional findings {chain (e.g. "Leads → Bookings → Retention"), finding, evidence (figures from at least two areas), implication, confidence}.
- contradictions: up to 3 {finding, evidence, resolution (which reading to trust and why)}.
- priorities: 3-5 ranked group-level moves {rank, title, why, owner, impactINR (only if derivable), tab, firstStep}.
- watchlist: 3-5 {title, metric, threshold (the specific trigger value), tab}.
- questions: 4-6 board-level questions this data raises.`;

export async function generateBusinessBriefing(
  snapshots: { tab: TabId; title: string; snapshot: unknown; quant: unknown }[], scopeLabel: string, scopeMonth: string, locations: string[],
): Promise<{ briefing: AIBusinessBriefing; cached: boolean }> {
  const config = readAIConfig();
  const fingerprint = await digest({ version: 1, kind: 'business', model: config.model, snapshots });
  const key = `floor.ai.business.${fingerprint}`;

  const hydrate = (raw: Partial<AIBusinessBriefing>): AIBusinessBriefing => ({
    fingerprint, model: config.model, scopeLabel, generatedAt: raw.generatedAt ?? new Date().toISOString(),
    headline: String(raw.headline ?? ''),
    executiveSummary: String(raw.executiveSummary ?? ''),
    scorecard: arr<AIBusinessBriefing['scorecard'][number]>(raw.scorecard).slice(0, 14),
    chains: arr<AIBusinessBriefing['chains'][number]>(raw.chains).slice(0, 5),
    contradictions: arr<AIBusinessBriefing['contradictions'][number]>(raw.contradictions).slice(0, 3),
    priorities: arr<AIBusinessBriefing['priorities'][number]>(raw.priorities).slice(0, 5),
    watchlist: arr<AIBusinessBriefing['watchlist'][number]>(raw.watchlist).slice(0, 5),
    questions: arr<string>(raw.questions).slice(0, 6),
  });

  try { const local = localStorage.getItem(key); if (local) return { briefing: hydrate(JSON.parse(local)), cached: true }; } catch { /* optional */ }
  const cloud = await readAIFromCloud<AIBusinessBriefing>(fingerprint);
  if (cloud) { const briefing = hydrate(cloud); try { localStorage.setItem(key, JSON.stringify(briefing)); } catch { /* optional */ } return { briefing, cached: true }; }

  const raw = await openAIJson<Partial<AIBusinessBriefing>>(BUSINESS_SYSTEM, { scopeLabel, areas: snapshots });
  const briefing = hydrate({ ...raw, generatedAt: new Date().toISOString() });
  try { localStorage.setItem(key, JSON.stringify(briefing)); } catch { /* optional */ }
  await saveAIToCloud(fingerprint, 'intelligence', null, scopeMonth, locations, briefing);
  return { briefing, cached: false };
}

/* ── Ask copilot ───────────────────────────────────────────────────────────
   The deterministic resolver answers anything in the metric registry exactly. When it cannot —
   an open "why", a comparison it has no rule for — this takes over, reading the same scoped
   aggregates rather than guessing from the question alone. */
export interface AIAnswer { answer: string; reasoning: string; evidence: string[]; caveats: string[]; followUps: string[]; actions: AIAction[] }

const ASK_SYSTEM = `You are the analyst sitting next to the operator, answering a question about the dashboard they are looking at.
You get the question, the current tab snapshot (KPIs, breakdowns, scope) and the locally computed quant block, and — when the deterministic resolver produced something — its partial answer.
Answer only from the supplied figures. If the data cannot answer it, say exactly what is missing and what would answer it. Never invent a number, a name or a period.
Return JSON {answer (2-4 sentences, lead with the number), reasoning (how you got there, one short paragraph), evidence (2-5 strings, each a figure with its label), caveats (0-3), followUps (2-4 questions), actions (0-3 action objects)}.
${ACTION_GRAMMAR}`;

export async function askAI(question: string, context: unknown): Promise<AIAnswer> {
  const raw = await openAIJson<Partial<AIAnswer>>(ASK_SYSTEM, { question, context });
  return {
    answer: String(raw.answer ?? 'No answer was returned.'),
    reasoning: String(raw.reasoning ?? ''),
    evidence: arr<string>(raw.evidence).slice(0, 5),
    caveats: arr<string>(raw.caveats).slice(0, 3),
    followUps: arr<string>(raw.followUps).slice(0, 4),
    actions: sanitiseActions(raw.actions),
  };
}
