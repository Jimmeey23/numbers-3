/* The tab briefing — what one "Generate with AI" run produces.
 *
 * The rail used to be the only place AI output landed, which made the button feel like a
 * card generator rather than an analyst. One run now returns a whole briefing for the tab:
 * a narrative, a note against individual KPIs, a note against named sections, ranked
 * recommendations, risks, an outlook and follow-up questions. Each part is rendered where
 * the operator is already looking — on the card, under the section heading, above the tab —
 * instead of being queued in a drawer.
 *
 * It is one model call. Splitting it would cost more and let the parts contradict each other.
 */
import { digest, openAIJson, readAIConfig } from './client';
import type { AISignal } from './client';
import type { TabId } from '../state/view';
import { readAIFromCloud, saveAIToCloud } from '../sync/cloud';

export type AIVerdict = 'good' | 'watch' | 'bad' | 'neutral';
export type AIHorizon = 'today' | 'this week' | 'this month' | 'this quarter';
export type AIConfidence = 'high' | 'medium' | 'low';

export interface AIMetricNote {
  /** A metric id from the tab payload. Anything unrecognised is dropped at render time. */
  metricId: string;
  note: string;
  verdict: AIVerdict;
  driver?: string;
}
export interface AISectionNote { section: string; note: string }
export interface AIRecommendation {
  title: string; rationale: string; action: string;
  owner?: string; horizon: AIHorizon; effort: 'low' | 'medium' | 'high';
  impactINR?: number; confidence: AIConfidence; metricId?: string;
}
export interface AIRisk { title: string; body: string; severity: 'critical' | 'attention' | 'context'; mitigation?: string }
export interface AIOutlook { metricId?: string; statement: string; direction: 'up' | 'down' | 'flat'; confidence: AIConfidence }

export interface AIBriefing {
  tab: TabId;
  fingerprint: string;
  provider: 'openai';
  model: string;
  generatedAt: string;
  scopeLabel: string;
  headline: string;
  summary: string;
  whatChanged: string[];
  metricNotes: AIMetricNote[];
  sectionNotes: AISectionNote[];
  recommendations: AIRecommendation[];
  risks: AIRisk[];
  outlook: AIOutlook[];
  questions: string[];
  caveats: string[];
  signals: AISignal[];
}

const SYSTEM = `You are the senior operating analyst for a boutique fitness group in India. You are handed one dashboard tab, already scoped to a period, locations and filters, with its headline metrics (value, prior-period comparison, sample, coverage, definition), a grouped breakdown, and the deterministic rules that have already fired.

Write a briefing that a studio operator reads on the tab itself. Every claim must be traceable to a number in the payload. Never invent a figure, a trend you cannot see, or a cause the data does not support — say "the data does not show why" instead. Rupee amounts are plain integers in INR. Prefer the controllable over the observable.

Return JSON with exactly these keys:
- headline: one sentence, under 90 characters, the single most decision-relevant fact on this tab.
- summary: 2 to 4 sentences of plain narrative. No bullet markers, no restating the metric list.
- whatChanged: 2 to 5 short strings, each naming a metric, its movement with the actual figures, and whether it matters.
- metricNotes: one entry per headline metric that deserves a comment (up to 8). Each has metricId (exactly as given in the payload), note (one sentence, under 140 characters, quoting the figure), verdict (good|watch|bad|neutral), optional driver naming the group or entity behind it.
- sectionNotes: up to 6 entries, each section (copied verbatim from the payload's sections list) and note (one or two sentences on what to look for in that section given this scope). Only comment on sections the data speaks to.
- recommendations: 3 to 6 ranked, non-overlapping actions. Each has title, rationale citing evidence, action (a concrete next step someone can do), optional owner (a role such as "Studio manager" or a named salesperson/trainer present in the data), horizon (today|this week|this month|this quarter), effort (low|medium|high), optional impactINR (integer, only when the payload supports the arithmetic), confidence (high|medium|low), optional metricId.
- risks: up to 4, each title, body with evidence, severity (critical|attention|context), optional mitigation.
- outlook: up to 3 forward statements grounded in the trend actually present. Each has optional metricId, statement, direction (up|down|flat), confidence. Say so plainly when the series is too short to project.
- questions: 3 to 5 follow-up questions this briefing raises, phrased so they can be typed into a data assistant.
- caveats: up to 4 strings on low sample, partial coverage, suspect values or missing sources that limit the above. Empty array if none.
- signals: 4 to 8 non-overlapping cards for the insight rail. Each has title, body with exact evidence, action, severity (critical|attention|opportunity|context), optional impactINR, entity, metricId. These must not merely repeat the recommendations.

Be specific, concise and operational. No preamble, no encouragement, no generic best practice.`;

const CACHE_PREFIX = 'floor.ai.briefing.v1.';
export const BRIEFING_EVENT = 'floor:ai-briefing';

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback);
const arr = <T,>(v: unknown, limit: number, map: (x: Record<string, unknown>) => T | null): T[] =>
  (Array.isArray(v) ? v : []).slice(0, limit).map((x) => (x && typeof x === 'object' ? map(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null);
const strs = (v: unknown, limit: number): string[] =>
  (Array.isArray(v) ? v : []).map((x) => str(x)).filter(Boolean).slice(0, limit);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(str(v)) ? (str(v) as T) : fallback;
const money = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);

/** The model is prompted for a shape; it is not trusted to have produced one. */
function coerce(raw: Record<string, unknown>): Omit<AIBriefing, 'tab' | 'fingerprint' | 'provider' | 'model' | 'generatedAt' | 'scopeLabel'> {
  return {
    headline: str(raw.headline, 'No headline was returned.'),
    summary: str(raw.summary),
    whatChanged: strs(raw.whatChanged, 5),
    metricNotes: arr<AIMetricNote>(raw.metricNotes, 10, (x) => {
      const metricId = str(x.metricId); const note = str(x.note);
      return metricId && note ? { metricId, note, verdict: oneOf(x.verdict, ['good', 'watch', 'bad', 'neutral'] as const, 'neutral'), driver: str(x.driver) || undefined } : null;
    }),
    sectionNotes: arr<AISectionNote>(raw.sectionNotes, 8, (x) => {
      const section = str(x.section); const note = str(x.note);
      return section && note ? { section, note } : null;
    }),
    recommendations: arr<AIRecommendation>(raw.recommendations, 8, (x) => {
      const title = str(x.title);
      return title ? {
        title, rationale: str(x.rationale), action: str(x.action),
        owner: str(x.owner) || undefined,
        horizon: oneOf(x.horizon, ['today', 'this week', 'this month', 'this quarter'] as const, 'this week'),
        effort: oneOf(x.effort, ['low', 'medium', 'high'] as const, 'medium'),
        impactINR: money(x.impactINR), confidence: oneOf(x.confidence, ['high', 'medium', 'low'] as const, 'medium'),
        metricId: str(x.metricId) || undefined,
      } : null;
    }),
    risks: arr<AIRisk>(raw.risks, 5, (x) => {
      const title = str(x.title);
      return title ? { title, body: str(x.body), severity: oneOf(x.severity, ['critical', 'attention', 'context'] as const, 'attention'), mitigation: str(x.mitigation) || undefined } : null;
    }),
    outlook: arr<AIOutlook>(raw.outlook, 4, (x) => {
      const statement = str(x.statement);
      return statement ? { statement, metricId: str(x.metricId) || undefined, direction: oneOf(x.direction, ['up', 'down', 'flat'] as const, 'flat'), confidence: oneOf(x.confidence, ['high', 'medium', 'low'] as const, 'medium') } : null;
    }),
    questions: strs(raw.questions, 6),
    caveats: strs(raw.caveats, 4),
    signals: arr<AISignal>(raw.signals, 10, (x) => {
      const title = str(x.title);
      return title ? {
        title, body: str(x.body), action: str(x.action),
        severity: oneOf(x.severity, ['critical', 'attention', 'opportunity', 'context'] as const, 'context'),
        impactINR: money(x.impactINR), entity: str(x.entity) || undefined, metricId: str(x.metricId) || undefined,
      } : null;
    }),
  };
}

export function readCachedBriefing(fingerprint: string): AIBriefing | null {
  try { const raw = localStorage.getItem(CACHE_PREFIX + fingerprint); return raw ? (JSON.parse(raw) as AIBriefing) : null; } catch { return null; }
}
function cacheBriefing(briefing: AIBriefing) {
  try { localStorage.setItem(CACHE_PREFIX + briefing.fingerprint, JSON.stringify(briefing)); } catch { /* quota — the cloud copy still stands */ }
}
/** Briefings are the bulkiest thing in storage; a clear is offered next to the other caches. */
export function clearBriefingCache() {
  try { for (const key of Object.keys(localStorage)) if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key); } catch { /* ignore */ }
}

export async function briefingFingerprint(tab: TabId, payload: unknown) {
  return digest({ version: 1, model: readAIConfig().model, tab, payload });
}

export interface BriefingResult { briefing: AIBriefing; cached: boolean }

/** Resolve a briefing for this exact tab + scope, from local cache, then cloud, then the model. */
export async function generateAIBriefing(
  tab: TabId, payload: unknown, sections: string[], scopeLabel: string, scopeMonth: string, locations: string[], force = false,
): Promise<BriefingResult> {
  const config = readAIConfig();
  const fingerprint = await briefingFingerprint(tab, payload);
  if (!force) {
    const local = readCachedBriefing(fingerprint);
    if (local) return { briefing: local, cached: true };
    const remote = await readAIFromCloud<AIBriefing>(fingerprint);
    if (remote) { cacheBriefing(remote); return { briefing: remote, cached: true }; }
  }
  const raw = await openAIJson<Record<string, unknown>>(SYSTEM, { tab, scope: scopeLabel, sections, payload });
  const briefing: AIBriefing = {
    tab, fingerprint, provider: 'openai', model: config.model, generatedAt: new Date().toISOString(), scopeLabel,
    ...coerce(raw),
  };
  cacheBriefing(briefing);
  await saveAIToCloud(fingerprint, 'briefing', tab, scopeMonth, locations, briefing);
  return { briefing, cached: false };
}
