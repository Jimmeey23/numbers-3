import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOverlay } from '../../state/overlays';
import { ask, defaultSuggestions, type AskResult } from '../../api/ask';
import { useScope } from '../../state/data';
import { useView } from '../../state/view';
import { addCard } from '../../api/agent';
import { ExportMenu } from '../ExportMenu';
import { WidgetBuilder } from '../Widgets/WidgetSection';
import { addWidget, type WidgetSpec } from '../../api/widgets';
import { scopeLine } from '../../api/export';
import { useAI } from '../../state/ai';
import { askAI, type AIAnswer } from '../../ai/intelligence';
import { readOpenAIKey } from '../../ai/client';
import { applyAIAction } from '../../ai/actions';
import { buildAgentApi } from '../../api/agent';
import { compactQuant, buildQuantPack } from '../../ai/analytics';

export interface Turn { id: string; role: 'you' | 'floor'; text: string; at: number; result?: AskResult; ai?: AIAnswer; aiState?: 'pending' | 'error'; aiError?: string }

const KEY = 'floor.conversation.v1';
const readTurns = (): Turn[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const writeTurns = (t: Turn[]) => { try { localStorage.setItem(KEY, JSON.stringify(t.slice(-200))); } catch { /* quota */ } };

/** The dock. A chat assistant has to be visible without hunting for it, so this sits above the
 *  canvas at all times rather than competing for room in a crowded title bar. */
export function AskDock() {
  const open = useView((s) => s.askOpen);
  const setOpen = useView((s) => s.setAskOpen);
  const [hint, setHint] = useState(() => {
    try { return !localStorage.getItem('floor.askSeen'); } catch { return true; }
  });
  if (open) return null;
  return (
    <div className="ask-dock">
      {hint && (
        <div className="ask-dock-hint">
          <div className="t-label-m">Ask anything about this data</div>
          <div className="t-label-s muted">“worst slots by fill rate”, “what is draw premium”</div>
          <button className="ask-dock-dismiss" aria-label="Dismiss"
            onClick={() => { setHint(false); try { localStorage.setItem('floor.askSeen', '1'); } catch { /* ignore */ } }}>×</button>
        </div>
      )}
      <button className="ask-dock-btn" onClick={() => { setOpen(true); setHint(false); try { localStorage.setItem('floor.askSeen', '1'); } catch { /* ignore */ } }}
        aria-label="Ask a question about your data (press A)" title="Ask a question (A)">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.7-.8L3 21l1.9-4.9A8.4 8.4 0 0 1 4 11.5a8.4 8.4 0 0 1 8.5-8.4A8.4 8.4 0 0 1 21 11.5Z"
            stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
        </svg>
        <span>Ask</span>
        <kbd className="kbd">A</kbd>
      </button>
    </div>
  );
}

export function AskPanel() {
  const open = useView((s) => s.askOpen);
  const setOpen = useView((s) => s.setAskOpen);
  const thresholds = useView((s) => s.thresholds);
  const setTab = useView((s) => s.setTab);
  const scope = useScope();
  const tab = useView((s) => s.tab);
  const intel = useAI((s) => s.byTab[tab]);
  const aiBusy = useAI((s) => s.busyTab !== null);
  const generate = useAI((s) => s.generate);
  // History is loaded once and persisted on every change, so the thread survives reloads.
  const [turns, setTurns] = useState<Turn[]>(readTurns);
  const [draft, setDraft] = useState('');
  const [histIdx, setHistIdx] = useState(-1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { writeTurns(turns); }, [turns]);
  useEffect(() => { if (open) { inputRef.current?.focus(); bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); } }, [open, turns.length]);
  useOverlay(open, useCallback(() => setOpen(false), [setOpen]));
  // The briefing can hand a question straight to the input.
  useEffect(() => {
    const h = (e: Event) => { const q = (e as CustomEvent<string>).detail; if (q) { setDraft(q); window.setTimeout(() => inputRef.current?.focus(), 60); } };
    window.addEventListener('floor:ask-prefill', h);
    return () => window.removeEventListener('floor:ask-prefill', h);
  }, []);

  const myQuestions = useMemo(() => turns.filter((t) => t.role === 'you').map((t) => t.text), [turns]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || !scope) return;
    const now = Date.now();
    let result: AskResult;
    try {
      result = ask(q, scope, thresholds);
    } catch (error) {
      // A malformed or sparsely populated source must not make the assistant appear to ignore the
      // user. Keep the turn, explain the failure, and offer useful recovery paths.
      result = {
        question: q, intent: 'help', unresolved: true, confidence: 'guess',
        answer: 'I could not finish that calculation, but your question was received.',
        detail: `The analytical engine returned: ${(error as Error).message}. Try naming the metric, period and location explicitly, or open Data health to check the source.`,
        scope: scope.period.label, suggestions: ['Revenue by location', 'Visits this month', 'What can you answer?'],
      };
    }
    const id = `f${now}`;
    setTurns((t) => [...t,
      { id: `u${now}`, role: 'you', text: q, at: now },
      { id, role: 'floor', text: result.answer, at: now + 1, result }]);
    setDraft(''); setHistIdx(-1);
    // The registry answers anything it can compute exactly. When it cannot, and a key exists,
    // the model gets the same scoped aggregates rather than the bare question.
    if ((result.unresolved || result.confidence === 'guess') && readOpenAIKey()) escalate(id, q);
  };

  /** Hand one question to the model, grounded in the current tab snapshot and quant pack. */
  const escalate = async (turnId: string, question: string) => {
    if (!scope) return;
    setTurns((t) => t.map((x) => (x.id === turnId ? { ...x, aiState: 'pending', aiError: undefined } : x)));
    try {
      const api = buildAgentApi(scope, thresholds, () => undefined);
      const quant = useAI.getState().quantByTab[tab] ?? buildQuantPack(scope, tab);
      const context = {
        tab, scopeLabel: scope.period.label,
        snapshot: api.get(tab, { limit: 20 }),
        quant: compactQuant(quant),
        deterministicAttempt: turns.find((x) => x.id === turnId)?.result ?? null,
        tabBriefing: useAI.getState().byTab[tab]?.executiveSummary ?? null,
      };
      const ai = await askAI(question, context);
      setTurns((t) => t.map((x) => (x.id === turnId ? { ...x, ai, aiState: undefined } : x)));
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === turnId ? { ...x, aiState: 'error', aiError: e instanceof Error ? e.message : 'AI answer failed.' } : x)));
    }
  };

  if (!open) return null;
  const suggestions = turns.length
    ? (turns[turns.length - 1].result?.suggestions ?? defaultSuggestions()).slice(0, 4)
    : defaultSuggestions();

  return (
    <>
      <div className="ask-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className="ask-panel slide-in" role="dialog" aria-label="Ask about your data">
        <div className="barre barre-glow" />
        <header className="ask-head">
          <div>
            <div className="t-heading-m">Ask</div>
            <div className="t-label-s muted">{scope ? `Answers are computed live for ${scope.period.label}` : 'Loading'}</div>
          </div>
          <div style={{ flex: 1 }} />
          {turns.length > 0 && (
            <>
              <ExportMenu label="Thread" payload={() => ({
                name: 'Atlas conversation',
                columns: ['When', 'Who', 'Message', 'Metric', 'Confidence'],
                rows: turns.map((t) => [new Date(t.at).toISOString(), t.role, t.text, t.result?.metricId ?? '', t.result?.confidence ?? '']),
                scopeLine: scope ? scopeLine(scope) : '',
              })} />
              <button className="btn btn-xs" onClick={() => { setTurns([]); writeTurns([]); }}>Clear</button>
            </>
          )}
          <button className="btn btn-xs" onClick={() => setOpen(false)}>Close <span className="kbd">Esc</span></button>
        </header>

        <div ref={bodyRef} className="ask-body">
          {!turns.length && (
            <div className="ask-empty">
              <div className="t-heading-s">Ask anything the registry can compute.</div>
              <p className="t-body-s muted" style={{ margin: '6px 0 0' }}>
                237 metrics across visits, sales, members, leads, trainers and payroll. Trade language works —
                “draw premium”, “no shows”, “revenue per head”, “one and done” all resolve to real definitions.
                Every answer states the number, the scope behind it, and the formula.
              </p>
            </div>
          )}
          {turns.map((t) => (t.role === 'you'
            ? <div key={t.id} className="ask-turn you"><div className="ask-bubble">{t.text}</div></div>
            : <AnswerBubble key={t.id} turn={t} onAskAI={() => escalate(t.id, turns.find((x) => x.at === t.at - 1)?.text ?? t.text)} onGo={(tab) => { setTab(tab); setOpen(false); }} onBuilt={(tab) => { setTab(tab); setOpen(false); }} onPin={(r) => {
                addCard({ tab: r.tab ?? 'overview', title: r.answer, body: r.detail, severity: 'context', source: 'manual',
                  action: r.provenance ? `${r.provenance.formula} · ${r.provenance.sources.join(', ')}` : undefined });
              }} />
          ))}
        </div>

        {intel?.questions.length ? (
          <div className="ask-suggest ask-suggest-ai">
            <span className="ask-suggest-label">✦ AI follow-ups</span>
            {intel.questions.slice(0, 4).map((q) => <button key={q} className="btn btn-xs" onClick={() => send(q)}>{q}</button>)}
          </div>
        ) : (
          <div className="ask-suggest ask-suggest-ai">
            <span className="ask-suggest-label">✦ AI</span>
            <button className="btn btn-xs" disabled={aiBusy || !scope} onClick={() => scope && generate(tab, scope, thresholds)}>
              {aiBusy ? 'Analysing…' : 'Generate AI briefing & follow-up questions for this tab'}
            </button>
          </div>
        )}
        {intel?.keyTakeaways.length ? (
          <div className="ask-ai-context">
            <b>✦ What AI already found on {tab}</b>
            <ul>{intel.keyTakeaways.slice(0, 3).map((t, i) => <li key={i}>{t}</li>)}</ul>
          </div>
        ) : null}
        <div className="ask-suggest">
          {suggestions.map((s) => <button key={s} className="btn btn-xs" onClick={() => send(s)}>{s}</button>)}
        </div>
        <form className="ask-input" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <input ref={inputRef} className="input" value={draft} placeholder="Ask about any metric, breakdown or trend…"
            aria-label="Your question" onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // ↑/↓ walk back through what you have already asked
              if (e.key === 'ArrowUp' && myQuestions.length) {
                e.preventDefault();
                const i = histIdx < 0 ? myQuestions.length - 1 : Math.max(0, histIdx - 1);
                setHistIdx(i); setDraft(myQuestions[i]);
              } else if (e.key === 'ArrowDown' && histIdx >= 0) {
                e.preventDefault();
                const i = histIdx + 1;
                if (i >= myQuestions.length) { setHistIdx(-1); setDraft(''); } else { setHistIdx(i); setDraft(myQuestions[i]); }
              }
            }} />
          <button className="btn btn-primary" type="submit" disabled={!draft.trim()}>Ask</button>
        </form>
      </aside>
    </>
  );
}

function AnswerBubble({ turn, onGo, onPin, onBuilt, onAskAI }: { turn: Turn; onGo: (tab: 'overview') => void; onPin: (r: AskResult) => void; onBuilt: (tab: 'overview') => void; onAskAI: () => void }) {
  const r = turn.result;
  const [showWork, setShowWork] = useState(false);
  const [tweaking, setTweaking] = useState(false);
  const [built, setBuilt] = useState<string | null>(null);
  const announce = useView((s) => s.announce);
  const aiBlock = (
    <>
      {turn.aiState === 'pending' && <div className="ask-ai-answer is-pending"><b>✦ Asking the model…</b><div className="travel-barre" /></div>}
      {turn.aiState === 'error' && <div className="signal-ai-error">{turn.aiError}</div>}
      {turn.ai && (
        <div className="ask-ai-answer">
          <b>✦ AI analysis</b>
          <p>{turn.ai.answer}</p>
          {turn.ai.reasoning && <p className="faint">{turn.ai.reasoning}</p>}
          {turn.ai.evidence.length > 0 && <ul className="ask-ai-evidence">{turn.ai.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {turn.ai.caveats.length > 0 && <small className="warn">{turn.ai.caveats.join(' · ')}</small>}
          {turn.ai.actions.length > 0 && (
            <div className="ai-action-row">
              {turn.ai.actions.map((a, i) => <button key={i} className="ai-action" onClick={() => announce(applyAIAction(a))}>↳ {a.label}</button>)}
            </div>
          )}
          {turn.ai.followUps.length > 0 && (
            <div className="ai-chips">{turn.ai.followUps.map((q, i) => (
              <button key={i} className="ai-chip is-button" onClick={() => window.dispatchEvent(new CustomEvent('floor:ask-prefill', { detail: q }))}>{q}</button>))}
            </div>
          )}
        </div>
      )}
    </>
  );
  if (!r) return <div className="ask-turn floor"><div className="ask-bubble">{turn.text}{aiBlock}</div></div>;
  return (
    <div className="ask-turn floor">
      <div className="ask-bubble">
        {r.unresolved && <span className="status-pill warn" style={{ marginBottom: 6, display: 'inline-flex' }}>Not in the registry</span>}
        {r.confidence === 'guess' && !r.unresolved && <span className="status-pill warn" style={{ marginBottom: 6, display: 'inline-flex' }}>Best guess</span>}
        <div className="t-body-m">{r.answer}</div>
        {r.detail && <p className="t-body-s muted" style={{ margin: '6px 0 0' }}>{r.detail}</p>}
        {!turn.ai && turn.aiState !== 'pending' && (
          <button className="ask-ai-cta" onClick={onAskAI} title="Send this question, the tab snapshot and the computed statistics to the model">✦ Go deeper with AI</button>
        )}
        {aiBlock}

        {r.table && (
          <div className="table-scroll ask-table">
            <table className="tbl">
              <thead><tr>{r.table.columns.map((c) => <th key={c} className="t-heading-s">{c}</th>)}</tr></thead>
              <tbody>{r.table.rows.slice(0, 12).map((row, i) => (
                <tr key={i}>{row.map((c, j) => <td key={j} className={j ? 't-num' : 't-body-s'}>{c ?? '—'}</td>)}</tr>))}</tbody>
            </table>
          </div>
        )}
        {r.table && r.table.rows.length > 12 && <div className="t-label-s faint" style={{ marginTop: 4 }}>{r.table.rows.length - 12} more rows — export to see them all.</div>}

        {r.buildSpec && !built && (
          <div className="ask-build">
            <div className="t-label-s faint" style={{ marginBottom: 7 }}>
              {describeSpec(r.buildSpec)} · lands on the <b>{r.buildSpec.tab}</b> tab
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-xs" onClick={() => {
                const { id, error } = addWidget(r.buildSpec!);
                if (error) { announce(error); return; }
                setBuilt(id ?? null); announce(`Added to the ${r.buildSpec!.tab} tab`);
              }}>Add it to the {r.buildSpec.tab} tab</button>
              <button className="btn btn-xs" onClick={() => setTweaking((v) => !v)}>{tweaking ? 'Hide options' : 'Change it first'}</button>
            </div>
          </div>
        )}
        {built && (
          <div className="ask-build built">
            <span className="t-body-s">Added — it will recompute every time you open the tab.</span>
            <button className="btn btn-xs" onClick={() => onBuilt((r.buildSpec!.tab ?? 'overview') as 'overview')}>Take me there</button>
          </div>
        )}
        {tweaking && r.buildSpec && !built && (
          <WidgetBuilder tab={(r.buildSpec.tab ?? 'overview') as 'overview'} seed={r.buildSpec as Partial<WidgetSpec>}
            onClose={() => setTweaking(false)} />
        )}

        <div className="ask-actions">
          <span className="t-label-s faint">{r.scope}</span>
          <div style={{ flex: 1 }} />
          {r.provenance && <button className="btn btn-xs" onClick={() => setShowWork((v) => !v)}>{showWork ? 'Hide' : 'Show'} working</button>}
          {r.tab && <button className="btn btn-xs" onClick={() => onGo(r.tab as 'overview')}>Open tab</button>}
          <button className="btn btn-xs" onClick={() => onPin(r)} title="Keep the sentence as an insight card">Pin note</button>
          {r.metricId && !r.buildSpec && (
            <button className="btn btn-xs" title="Turn this answer into a permanent widget" onClick={() => setTweaking((v) => !v)}>
              {tweaking ? 'Close builder' : 'Build widget'}
            </button>
          )}
          {r.table && <ExportMenu label="" payload={() => ({ name: r.question, columns: r.table!.columns, rows: r.table!.rows, scopeLine: r.scope })} />}
        </div>

        {tweaking && !r.buildSpec && r.metricId && (
          <WidgetBuilder tab={(r.tab ?? 'overview') as 'overview'}
            seed={{ tab: r.tab, metrics: [r.metricId], groupBy: r.dimension,
              kind: r.dimension ? (r.intent === 'rank' ? 'ranking' : 'table') : r.intent === 'trend' ? 'trend' : 'metric',
              source: 'ask' }}
            onClose={() => setTweaking(false)} />
        )}
        {showWork && r.provenance && (
          <div className="ask-work">
            <div><span className="t-label-s faint">Definition</span><div className="t-body-s">{r.provenance.label}</div></div>
            <div><span className="t-label-s faint">Formula</span><div className="t-body-s" style={{ fontFamily: 'var(--font-display)' }}>{r.provenance.formula}</div></div>
            <div><span className="t-label-s faint">Reads</span><div className="t-body-s">{r.provenance.sources.join(' · ')}</div></div>
            <div><span className="t-label-s faint">Grain</span><div className="t-body-s">{r.provenance.grain}</div></div>
            {r.provenance.coverage && <div><span className="t-label-s faint">Coverage</span><div className="t-body-s warn">{r.provenance.coverage}</div></div>}
          </div>
        )}
      </div>
    </div>
  );
}

function describeSpec(s: Partial<WidgetSpec>): string {
  const kind = s.kind === 'metric' ? 'Metric card' : s.kind === 'table' ? 'Table' : s.kind === 'trend' ? 'Trend line' : `${(s.kind ?? 'chart')[0].toUpperCase()}${(s.kind ?? 'chart').slice(1)} chart`;
  return `${kind}${s.groupBy ? ` grouped by ${s.groupBy.replace(/_/g, ' ')}` : ''}`;
}
