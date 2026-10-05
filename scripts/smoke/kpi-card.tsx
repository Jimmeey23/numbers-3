/* Focused mount check for the KPI card against a seeded quant pack — the path that was looping. */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const g = globalThis as any;
g.window = dom.window; g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement; g.Element = dom.window.Element; g.Node = dom.window.Node;
g.localStorage = dom.window.localStorage; g.sessionStorage = dom.window.sessionStorage;
g.CustomEvent = dom.window.CustomEvent; g.Event = dom.window.Event; g.MutationObserver = dom.window.MutationObserver;
g.requestAnimationFrame = (cb: FrameRequestCallback) => dom.window.setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: number) => dom.window.clearTimeout(id);
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.history = dom.window.history; g.location = dom.window.location;
dom.window.Element.prototype.scrollIntoView = function () {}; dom.window.Element.prototype.scrollTo = function () {};
g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
g.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
(dom.window as any).SVGElement.prototype.getTotalLength = function () { return 100; };
(dom.window as any).Element.prototype.animate = function () { return { finished: Promise.resolve(), cancel() {}, finish() {} }; };
g.IS_REACT_ACT_ENVIRONMENT = true;

const errors: string[] = [];
const orig = console.error;
console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };

const React = await import('react');
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MetricCard } = await import('../../src/components/MetricCard/MetricCard');
const { useAI } = await import('../../src/state/ai');

useAI.setState({
  quantByTab: { overview: {
    tab: 'overview', generatedAt: new Date().toISOString(), months: 14, anomalies: [], drivers: [], concentration: [],
    correlations: [], seasonality: [], dataQuality: [], headline: 'seed',
    metrics: [{ metricId: 'visits', label: 'Visits', format: 'number', higherIsBetter: true, current: 100, currentFormatted: '100',
      previous: 80, previousFormatted: '80', changePct: 0.25, changeAbs: 20,
      series: [{ month: '2025-08', value: 80 }, { month: '2025-09', value: 90 }, { month: '2025-10', value: 100 }],
      z: 2.4, anomaly: { direction: 'spike', z: 2.4, verdict: 'good', note: 'seeded anomaly' },
      trend: { slopePerMonth: 10, r2: 0.9, direction: 'rising', months: 3, note: 'up' },
      forecast: { next: 110, low: 100, high: 120, formatted: '110', basis: 'seed' },
      pace: null, streak: { direction: 'up', months: 3 } }],
  } as never },
});

const root = createRoot(document.getElementById('root')!);
try {
  await (act as any)(async () => { root.render(React.createElement(MetricCard, { metricId: 'visits', value: 100, prev: 80 })); });
  await new Promise((r) => setTimeout(r, 400));
} catch (e) { errors.push('THROWN: ' + ((e as any)?.stack ?? String(e))); }

const html = document.getElementById('root')!.innerHTML;
const fatal = errors.filter((e) => /Maximum update depth|getSnapshot should be cached|THROWN/.test(e));
orig('--- rendered bytes:', html.length);
orig('--- shows statistical note:', html.includes('kpi-ai-note'));
orig('--- fatal errors:', fatal.length);
for (const f of fatal.slice(0, 2)) orig('   *', f.slice(0, 260));
process.exit(fatal.length ? 1 : 0);
