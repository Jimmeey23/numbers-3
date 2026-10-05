/* Reasoned answers to "why" questions.
 *
 * The model is given a decomposition that has already been computed (see api/evidence.ts) and
 * is asked to rank and explain it, not to measure anything. Its job is judgement — which of
 * several true movements actually accounts for the change, which are coincidental, and what
 * the data cannot settle. Everything it returns is checked back against the pack before it is
 * shown, so a figure the evidence does not contain cannot reach the operator unchallenged.
 */
import { digest, openAIJson, readAIConfig } from './client';
import type { EvidencePack } from '../api/evidence';
import { readAIFromCloud, saveAIToCloud } from '../sync/cloud';

export interface AIFactor {
  factor: string;
  evidence: string;
  /** How much of the movement this accounts for, where the decomposition supports saying. */
  contribution: string;
  confidence: 'high' | 'medium' | 'low';
}
export interface AIReasonedAnswer {
  answer: string;
  factors: AIFactor[];
  /** Movements that look related but the evidence rules out — as useful as the causes. */
  ruledOut: { factor: string; why: string }[];
  /** What this data cannot settle, and what would settle it. */
  cannotTell: string[];
  nextChecks: string[];
  confidence: 'high' | 'medium' | 'low';
  generatedAt: string;
  model: string;
}

const SYSTEM = `You are a senior operating analyst for a boutique fitness group in India. You are given one question about why a metric moved, and an evidence pack containing the arithmetic already done for you: the metric's value in both periods, a decomposition of the change across every available dimension, companion metrics over the same two windows, 14 months of history, and the deterministic alerts that fired.

Your job is judgement, not measurement. Rank what actually accounts for the movement, separate it from what merely moved alongside it, and be explicit about what the data cannot settle.

Rules you must not break:
- Use only figures present in the evidence pack. Never compute a new one, never estimate, never round into a different claim. Quote figures as the pack formats them.
- A dimension marked kind "additive" has contributions that sum to the total change; shareOfChange is a real attribution and you may say "accounts for X% of the fall".
- A dimension marked kind "mix" is a ratio. Group changes do NOT sum to the total. Compare weightBefore against weightAfter before attributing anything: a rate can fall while every group's rate rose, purely because weight moved to weaker groups. If that is what happened, say so plainly — it is a different problem with a different fix.
- A shareOfChange above 1.0 (or below -1.0) is not an error: that group moved more than the net change and others moved the opposite way, cancelling part of it. Say that explicitly rather than quoting a bare percentage over 100%.
- Correlation in companion metrics is not cause. A companion that moved in step is a lead worth naming, not a cause, unless the decomposition supports it.
- A group that disappeared or appeared between periods is frequently the whole story — check those first.
- If the sample is below the metric's floor, or coverage is partial, say the attribution is unreliable and do not rank factors as if it were not.
- The pack may contain a "premise" field: a movement the question asserted, checked against the data. If matches is false, say so in the FIRST sentence of your answer and do not attribute causes to a movement that did not happen. Correct the premise, give what actually happened, and only then discuss the real movement if there is one.
- Never attribute a movement to anything outside the data (weather, holidays, competitors, the economy) unless the pack contains it. Put those in cannotTell instead.

Return JSON with these keys:
- answer: 2 to 4 sentences, the direct answer to the question asked. Lead with the single biggest factor and the figure behind it. Plain prose, no bullets.
- factors: 1 to 5 ranked entries, each factor (short name), evidence (the specific figures from the pack), contribution (what share of the movement it accounts for, or "not separable from the rest" when the decomposition cannot say), confidence (high|medium|low).
- ruledOut: up to 3 entries, each factor and why — things a reader would reasonably suspect that the evidence does not support.
- cannotTell: up to 3 strings naming what this data cannot resolve, and what would.
- nextChecks: 2 to 4 concrete things to look at next, phrased as something a studio operator can actually do.
- confidence: your overall confidence in the attribution (high|medium|low).

Be specific and short. No preamble, no restating the question, no generic advice.`;

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(str(v)) ? (str(v) as T) : fallback;
const CONF = ['high', 'medium', 'low'] as const;

function coerce(raw: Record<string, unknown>, model: string): AIReasonedAnswer {
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    answer: str(raw.answer, 'The model returned no answer.'),
    factors: list(raw.factors).slice(0, 5).map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { factor: str(o.factor), evidence: str(o.evidence), contribution: str(o.contribution), confidence: oneOf(o.confidence, CONF, 'medium') };
    }).filter((f) => f.factor),
    ruledOut: list(raw.ruledOut).slice(0, 3).map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { factor: str(o.factor), why: str(o.why) };
    }).filter((f) => f.factor),
    cannotTell: list(raw.cannotTell).map((x) => str(x)).filter(Boolean).slice(0, 3),
    nextChecks: list(raw.nextChecks).map((x) => str(x)).filter(Boolean).slice(0, 4),
    confidence: oneOf(raw.confidence, CONF, 'medium'),
    generatedAt: new Date().toISOString(),
    model,
  };
}

/** Reasoning is cached on the evidence, not the wording — two phrasings of the same question
 *  over the same data are the same analysis and should not be paid for twice. */
export async function reasonOverEvidence(pack: EvidencePack, scopeMonth: string, locations: string[]): Promise<AIReasonedAnswer> {
  const config = readAIConfig();
  const fingerprint = await digest({ version: 1, model: config.model, kind: 'reason', metric: pack.metric.id, period: pack.period, headline: pack.headline, drivers: pack.drivers });
  const cached = await readAIFromCloud<AIReasonedAnswer>(fingerprint);
  if (cached) return cached;
  const raw = await openAIJson<Record<string, unknown>>(SYSTEM, pack);
  const answer = coerce(raw, config.model);
  await saveAIToCloud(fingerprint, 'briefing', null, scopeMonth, locations, answer);
  return answer;
}

/* ── Every answer, written by the model ───────────────────────────────────────
 *
 * The resolver stays exactly where it is, because it is what makes the numbers true: it maps
 * the question onto the registry, computes against the live scope, and produces the table and
 * the provenance. What it was bad at is language — every reply came out of a sentence template,
 * which is why it could restate a figure and call it an answer.
 *
 * So the division is: the resolver measures, the model writes. The model is handed the computed
 * facts and may not introduce a figure that is not among them. Where it has nothing to add, the
 * deterministic sentence is still there to fall back on, and it is used whenever there is no key
 * or the call fails — the dashboard must answer with or without a model.
 */
export interface AIComposedAnswer {
  answer: string;
  /** Anything the computed facts imply that the bare number does not say. */
  observations: string[];
  followUps: string[];
  /** Set when the model judges the computed facts do not actually answer what was asked. */
  caveat?: string;
  model: string;
}

const COMPOSE_SYSTEM = `You are the analyst answering an operator's question about their own boutique-fitness data, inside a dashboard. You are given the question and a "computed" object: the result the dashboard's deterministic engine produced for it — the resolved metric and its definition, the figures, any table, the scope, and the engine's own plain-text attempt at an answer.

Your job is to write the reply. The engine measures; you write.

Hard rules:
- Every figure you use must appear in the computed object. Never calculate a new one, never estimate, never extrapolate. Quote figures exactly as they are formatted there.
- Never contradict the computed figures. If the engine says a value fell, it fell.
- If the computed facts do not actually answer the question asked, say so in one clause and answer what they DO establish. Put the gap in "caveat".
- The question may rest on a false premise (a movement that did not happen, a figure that does not match). If the computed object shows that, correct it in your first sentence.
- Do not pad. No "great question", no restating the question, no generic advice, no describing what the dashboard is.
- Indian number formatting is already applied in the computed strings; reuse them verbatim rather than reformatting.
- If the sample is small or coverage partial, say what that does to the reliability of the answer.

Return JSON:
- answer: 1 to 4 sentences answering the question directly, leading with the figure that answers it. Plain prose.
- observations: 0 to 3 short strings, each something the computed facts support that the headline number alone does not say — a concentration, an offsetting movement, an outlier, a sample problem. Omit rather than pad.
- followUps: 2 to 4 questions this answer raises, each phrased so it can be typed back into this same dashboard assistant.
- caveat: optional, one sentence, only when the computed facts do not fully answer what was asked.`;

/** Compose the reply for any question, from facts the engine already computed. */
export async function composeAnswer(question: string, computed: unknown): Promise<AIComposedAnswer> {
  const config = readAIConfig();
  const raw = await openAIJson<Record<string, unknown>>(COMPOSE_SYSTEM, { question, computed });
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
  return {
    answer: str(raw.answer, 'The model returned no answer.'),
    observations: list(raw.observations).slice(0, 3),
    followUps: list(raw.followUps).slice(0, 4),
    caveat: str(raw.caveat) || undefined,
    model: config.model,
  };
}
