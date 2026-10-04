import type { ReportModel } from '../report/model';
import type { TabId } from '../state/view';
import { readAIFromCloud, saveAIToCloud } from '../sync/cloud';

export interface AIConfig {
  provider: 'openai'; model: string; baseUrl: string; rememberKey: boolean;
}
export interface AIReportIntelligence {
  provider: 'openai'; model: string; generatedAt: string;
  executiveSummary: string;
  crossFunctionalInsights: { headline: string; finding: string; evidence: string; recommendation: string; confidence: 'high' | 'medium' | 'low' }[];
  chapterBriefs: { chapterId: string; summary: string; implications: string[]; actions: string[] }[];
  assumptions: string[];
}
export interface AISignal {
  title: string; body: string; action: string; severity: 'critical' | 'attention' | 'opportunity' | 'context';
  impactINR?: number; entity?: string; metricId?: string;
}

const CONFIG_KEY = 'floor.ai.config.v1';
const KEY_LOCAL = 'floor.ai.openai.key';
const KEY_SESSION = 'floor.ai.openai.key.session';
export const AI_EVENT = 'floor:ai-settings';

export function readAIConfig(): AIConfig {
  try { return { provider: 'openai', model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1', rememberKey: false, ...JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') }; }
  catch { return { provider: 'openai', model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1', rememberKey: false }; }
}
export function readOpenAIKey() {
  try { return sessionStorage.getItem(KEY_SESSION) ?? localStorage.getItem(KEY_LOCAL) ?? ''; } catch { return ''; }
}
export function saveAISettings(config: AIConfig, key: string) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    if (config.rememberKey && key) localStorage.setItem(KEY_LOCAL, key); else localStorage.removeItem(KEY_LOCAL);
    if (key) sessionStorage.setItem(KEY_SESSION, key); else sessionStorage.removeItem(KEY_SESSION);
    window.dispatchEvent(new CustomEvent(AI_EVENT));
  } catch { /* storage disabled */ }
}
export function clearAIKey() {
  try { localStorage.removeItem(KEY_LOCAL); sessionStorage.removeItem(KEY_SESSION); window.dispatchEvent(new CustomEvent(AI_EVENT)); } catch { /* ignore */ }
}

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
  return JSON.stringify(v);
};
const digest = async (value: unknown) => {
  const text = stable(value); const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) { const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  let h = 2166136261; for (const b of bytes) { h ^= b; h = Math.imul(h, 16777619); } return `fallback-${(h >>> 0).toString(16)}-${bytes.length}`;
};

export async function reportFingerprint(model: ReportModel, aiModel: string) {
  return digest({ version: 3, aiModel, scope: model.meta.scopeLine, dataThrough: model.meta.dataThrough, studio: model.meta.studio,
    chapters: model.chapters.map((c) => ({ id: c.id, kpis: c.kpis.map((k) => [k.id, k.value, k.deltaValue]), tables: c.tables.map((t) => [t.title, t.rows]) })) });
}

function compactReport(model: ReportModel) {
  return {
    report: model.meta,
    chapters: model.chapters.map((c) => ({ id: c.id, title: c.title, narrative: c.narrative,
      kpis: c.kpis.map((k) => ({ id: k.id, label: k.label, value: k.formatted, previous: k.prevFormatted, change: k.delta, definition: k.definition, sample: k.sample, coverage: k.coverage })),
      tables: c.tables.map((t) => ({ title: t.title, columns: t.columns, rows: t.rows.slice(0, 12), note: t.note })) })),
    deterministicActions: model.actions, impact: model.impact,
  };
}

async function openAIJson<T>(system: string, input: unknown): Promise<T> {
  const config = readAIConfig(); const key = readOpenAIKey();
  if (!key) throw new Error('Add an OpenAI API key in Settings → AI intelligence first.');
  const base = config.baseUrl.replace(/\/$/, '');
  const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 90_000);
  let response: Response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: config.model, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }] }),
    });
  } catch (e) { if ((e as Error).name === 'AbortError') throw new Error('OpenAI did not respond within 90 seconds. Try again.'); throw e; }
  finally { window.clearTimeout(timeout); }
  const raw = await response.text();
  if (!response.ok) { let message = raw; try { message = JSON.parse(raw).error?.message ?? raw; } catch { /* text */ } throw new Error(`OpenAI ${response.status}: ${message}`); }
  const payload = JSON.parse(raw); const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned no report content.');
  const json = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(json) as T; } catch { throw new Error('OpenAI returned an invalid JSON response. Try again.'); }
}

export async function generateAIReport(model: ReportModel): Promise<AIReportIntelligence> {
  const config = readAIConfig();
  const fingerprint = await reportFingerprint(model, config.model);
  const cloudCopy = await readAIFromCloud<AIReportIntelligence>(fingerprint);
  if (cloudCopy) return cloudCopy;
  const result = await openAIJson<Omit<AIReportIntelligence, 'provider' | 'model' | 'generatedAt'>>(
    `You are a senior boutique-fitness operating analyst. Produce decision-grade intelligence only from the supplied data. Never invent a number. Reconcile cross-functional effects across sales, leads, acquisition, retention, classes, attendance and payroll. Distinguish correlation from causation. Return JSON with keys: executiveSummary (string); crossFunctionalInsights (array, max 8, each headline, finding, evidence, recommendation, confidence high|medium|low); chapterBriefs (array, each chapterId, summary, implications string[], actions string[]); assumptions string[]. Be specific, concise and operational.`,
    compactReport(model),
  );
  const intelligence: AIReportIntelligence = {
    provider: 'openai', model: config.model, generatedAt: new Date().toISOString(),
    executiveSummary: String(result.executiveSummary ?? 'No executive summary was returned.'),
    crossFunctionalInsights: Array.isArray(result.crossFunctionalInsights) ? result.crossFunctionalInsights.slice(0, 8) : [],
    chapterBriefs: Array.isArray(result.chapterBriefs) ? result.chapterBriefs : [],
    assumptions: Array.isArray(result.assumptions) ? result.assumptions : [],
  };
  await saveAIToCloud(fingerprint, 'report', null, (model.meta.scopeEnd ?? model.meta.dataThrough).slice(0, 7), model.meta.locations ?? [], intelligence);
  return intelligence;
}

export async function generateAISignals(tab: TabId, payload: unknown, scopeMonth: string, locations: string[]): Promise<{ fingerprint: string; signals: AISignal[]; cached: boolean }> {
  const config = readAIConfig();
  const fingerprint = await digest({ version: 2, model: config.model, tab, payload });
  const key = `floor.ai.signal-cache.${fingerprint}`;
  try { const cached = localStorage.getItem(key); if (cached) { const signals = JSON.parse(cached) as AISignal[]; await saveAIToCloud(fingerprint, 'signals', tab, scopeMonth, locations, signals); return { fingerprint, signals, cached: true }; } } catch { /* ignore */ }
  const cloudCopy = await readAIFromCloud<AISignal[]>(fingerprint);
  if (cloudCopy) {
    try { localStorage.setItem(key, JSON.stringify(cloudCopy)); } catch { /* local cache optional */ }
    return { fingerprint, signals: cloudCopy, cached: true };
  }
  const response = await openAIJson<{ signals: AISignal[] }>(
    `You are a senior boutique-fitness operations analyst. Analyze the supplied scoped tab snapshot. Return JSON {"signals": [...]} with 5 to 10 non-overlapping signals. Each signal must have title, body with exact evidence, action, severity critical|attention|opportunity|context, optional impactINR, entity and metricId. Do not invent facts or add generic advice. Prioritize controllable changes, anomalies, leading indicators and cross-metric contradictions.`,
    { tab, payload },
  );
  const signals = (response.signals ?? []).slice(0, 10);
  try { localStorage.setItem(key, JSON.stringify(signals)); } catch { /* cache best effort */ }
  await saveAIToCloud(fingerprint, 'signals', tab, scopeMonth, locations, signals);
  return { fingerprint, signals, cached: false };
}
