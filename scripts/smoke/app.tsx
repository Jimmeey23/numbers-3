/* Headless mount check: renders the real app into jsdom and fails loudly on any React error,
   including the render loops a non-memoised store selector causes. */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const g = globalThis as any;
g.window = dom.window; g.document = dom.window.document; Object.defineProperty(g, "navigator", { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement; g.Element = dom.window.Element; g.Node = dom.window.Node;
g.localStorage = dom.window.localStorage; g.sessionStorage = dom.window.sessionStorage;
g.CustomEvent = dom.window.CustomEvent; g.Event = dom.window.Event; g.MutationObserver = dom.window.MutationObserver;
g.requestAnimationFrame = (cb: FrameRequestCallback) => dom.window.setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: number) => dom.window.clearTimeout(id);
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.history = dom.window.history; g.location = dom.window.location;
dom.window.Element.prototype.scrollIntoView = function () {}; dom.window.Element.prototype.scrollTo = function () {};
g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
dom.window.ResizeObserver = g.ResizeObserver;
(dom.window as any).SVGElement.prototype.getTotalLength = function () { return 100; };
(dom.window as any).Element.prototype.animate = function () { return { finished: Promise.resolve(), cancel() {}, finish() {}, onfinish: null }; };
g.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
dom.window.IntersectionObserver = g.IntersectionObserver;
g.fetch = async () => { throw new Error('offline'); };
g.IS_REACT_ACT_ENVIRONMENT = true;

const errors: string[] = [];
const origError = console.error;
console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); origError(...a); };

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: App } = await import('../../src/App');
const { act } = await import('react');

const root = createRoot(document.getElementById('root')!);
try {
  await (act as any)(async () => { root.render(React.createElement(App)); });
  await new Promise((r) => setTimeout(r, 1500));
} catch (e) {
  const err = e as any;
  if (err?.errors) for (const x of err.errors) errors.push('THROWN: ' + (x?.stack ?? String(x)));
  else errors.push('THROWN: ' + (err?.stack ?? String(err)));
}
const html = document.getElementById('root')!.innerHTML;
console.log('\n--- rendered bytes:', html.length);
console.log('--- contains titlebar:', html.includes('titlebar'));
const fatal = errors.filter((e) => /Maximum update depth|getSnapshot should be cached|THROWN|Cannot read|is not a function|undefined is not/.test(e));
console.log('--- fatal errors:', fatal.length);
for (const f of fatal.slice(0, 3)) console.log('   *', f.slice(0, 400));
process.exit(fatal.length ? 1 : 0);
