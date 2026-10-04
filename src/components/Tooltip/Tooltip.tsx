import { create } from 'zustand';
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface TipState { content: ReactNode | null; x: number; y: number; show: (c: ReactNode, x: number, y: number) => void; move: (x: number, y: number) => void; hide: () => void }
export const useTip = create<TipState>((set) => ({
  content: null, x: 0, y: 0,
  show: (content, x, y) => set({ content, x, y }),
  move: (x, y) => set({ x, y }),
  hide: () => set({ content: null }),
}));

/** Hover-intent tooltip binder: 120ms intent, follows cursor at 12px, flips at edges. */
export function useTooltip(content: () => ReactNode, deps: unknown[] = []) {
  const timer = useRef<number | null>(null);
  const { show, move, hide } = useTip.getState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, deps);
  return {
    onMouseEnter: (e: React.MouseEvent) => { const x = e.clientX; const y = e.clientY; timer.current = window.setTimeout(() => show(content(), x, y), 120); },
    onMouseMove: (e: React.MouseEvent) => { if (useTip.getState().content) move(e.clientX, e.clientY); },
    onMouseLeave: () => { if (timer.current) window.clearTimeout(timer.current); hide(); },
    onFocus: (e: React.FocusEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); show(content(), r.left + r.width / 2, r.bottom); },
    onBlur: () => hide(),
  };
}

export function TooltipLayer() {
  const { content, x, y } = useTip();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!content || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let left = x + 12; let top = y + 12;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 12;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 12;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [content, x, y]);
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">{content ? 'Tooltip shown' : ''}</div>
      {content && <div ref={ref} className="tooltip t-body-s" style={{ left: pos.left, top: pos.top }}>{content}</div>}
    </>
  );
}

/** Standard tooltip body: context → primary value → delta → share → rank → n → hint */
export function TipBody(p: { context?: string; value: string; delta?: string; deltaClass?: string; share?: string; rank?: string; n?: string; hint?: string; extra?: ReactNode }) {
  return (
    <div>
      {p.context && <div className="t-label-s muted" style={{ marginBottom: 4 }}>{p.context}</div>}
      <div className="t-display-s tabular">{p.value}</div>
      {p.delta && <div className={`t-label-m ${p.deltaClass ?? ''}`}>{p.delta}</div>}
      {p.extra}
      {(p.share || p.rank || p.n) && <div className="t-label-s muted" style={{ marginTop: 6, display: 'grid', gap: 2 }}>
        {p.share && <span>{p.share}</span>}{p.rank && <span>{p.rank}</span>}{p.n && <span>{p.n}</span>}
      </div>}
      <div className="t-label-s faint" style={{ marginTop: 6 }}>{p.hint ?? 'Click to drill'}</div>
    </div>
  );
}
