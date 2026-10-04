import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const ms = (name: string, fallback: number) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); const n = parseFloat(v); return Number.isFinite(n) ? n : fallback; };

/** Count-up from previous value to target over m-data; digits held at final format width. */
export function useCountUp(target: number | null, delay = 0): number | null {
  const [v, setV] = useState<number | null>(target);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (target === null) { setV(null); prev.current = null; return; }
    const dur = ms('--m-data', 480);
    if (dur === 0 || reducedMotion()) { setV(target); prev.current = target; return; }
    const from = prev.current ?? 0; const start = performance.now() + delay; let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / dur));
      const e = 1 - Math.pow(1 - p, 3);
      setV(from + (target - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else prev.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delay]);
  return v;
}

/** FLIP: animate DOM children of a container between renders keyed by data-key. */
export function useFlip<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const dur = ms('--m-base', 220);
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-key]'));
    const next = new Map<string, number>();
    for (const it of items) {
      const k = it.dataset.key!; const top = it.getBoundingClientRect().top; next.set(k, top);
      const old = positions.current.get(k);
      if (old !== undefined && dur > 0 && !reducedMotion()) {
        const dy = old - top;
        if (Math.abs(dy) > 1) {
          it.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: dur, easing: 'cubic-bezier(.2,0,.38,.9)' });
        }
      }
    }
    positions.current = next;
  }, [dep]);
  return ref;
}

export function useInView<T extends HTMLElement>(rootMargin = '200px') {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el || inView) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setInView(true); io.disconnect(); } }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return { ref, inView };
}

export function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el); setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

/** Draw-in for SVG paths via stroke-dashoffset. */
export function usePathDraw(dep: unknown, duration = 480, delay = 0) {
  const ref = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    const p = ref.current; if (!p || dep === null) return;
    if (reducedMotion() || ms('--m-data', 480) === 0) { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; return; }
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`; p.style.strokeDashoffset = `${len}`;
    const a = p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
    return () => a.cancel();
  }, [dep, duration, delay]);
  return ref;
}

export function downloadText(name: string, text: string, type = 'text/csv') {
  const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
export const csvEscape = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function svgToPng(svg: SVGSVGElement, name: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const cs = getComputedStyle(document.documentElement);
  // resolve CSS variables and class typography into inline attributes so the raster matches the screen
  const src = svg.querySelectorAll<SVGElement>('*'); const dst = clone.querySelectorAll<SVGElement>('*');
  src.forEach((el, i) => { const c = getComputedStyle(el); const d = dst[i]; if (!d) return; d.setAttribute('style', `fill:${c.fill};stroke:${c.stroke};stroke-width:${c.strokeWidth};opacity:${c.opacity};font-family:${c.fontFamily};font-size:${c.fontSize};font-weight:${c.fontWeight};font-variation-settings:${c.fontVariationSettings}`); d.removeAttribute('class'); });
  clone.setAttribute('width', String(svg.clientWidth)); clone.setAttribute('height', String(svg.clientHeight));
  clone.setAttribute('style', `background:${cs.getPropertyValue('--surface-1')};font-family:${cs.getPropertyValue('--font-display')}`);
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image(); const w = svg.clientWidth * 2; const h = svg.clientHeight * 2;
  img.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d')!; g.drawImage(img, 0, 0, w, h); const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = name; a.click(); };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
}
