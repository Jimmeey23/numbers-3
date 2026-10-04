/* One addressable endpoint per tab.
 *
 * Every tab publishes a single URL that returns everything that tab knows — the raw rows in scope
 * and the consolidated view computed from them — as one JSON document. The URL is printed on the
 * tab itself so an agent can be pointed at it without being told how the app is built.
 *
 *   …/?api=classes&include=all&limit=1000&format=json
 *
 * Honest about the transport: this is a static single-file build with no server behind it, so the
 * endpoint is served by the app itself. A GET that executes JavaScript — a browser, Playwright, a
 * headless fetch tool, an agent with a browser — receives the JSON document. A plain `curl` gets
 * the HTML shell, because there is no origin to render it. Agents already inside the page can skip
 * the round trip entirely and call `window.floor.get(tab)`, which returns the same consolidated
 * block without the raw rows.
 */
import type { Scope } from '../state/data';
import type { TabId } from '../state/view';
import { ENDPOINTS, type AgentApi } from './agent';

export const API_PARAM = 'api';

export interface ApiRequest {
  tab: TabId;
  /** `raw` rows only, `consolidated` only, or both. */
  include: 'all' | 'raw' | 'consolidated';
  /** Rows returned in the raw block. `0` means every row in scope. */
  limit: number;
  groupBy?: string;
  format: 'json';
}

type UrlOpts = Partial<Pick<ApiRequest, 'include' | 'limit' | 'groupBy'>>;

/** Origin of whatever is serving the app, or '' when there is no document (Node, tests). */
function origin(): string {
  const loc = typeof window === 'undefined' ? undefined : (window as Window).location;
  return loc && typeof loc.origin === 'string' ? loc.origin : '';
}

function query(opts?: UrlOpts, extra?: Record<string, string>) {
  const q = new URLSearchParams({ ...extra, include: opts?.include ?? 'all', limit: String(opts?.limit ?? 1000) });
  if (opts?.groupBy) q.set('groupBy', opts.groupBy);
  return q;
}

/* Two addresses for the same payload, because the app is deployed two ways.
 *
 *   /api/v1/tabs/<tab>   — a real HTTP route, served by server/api.mts. Plain `curl` works, no
 *                          JavaScript required. This is the one to hand to an agent, and the one
 *                          the tab prints, whenever the deployment runs the Node server (or the
 *                          Vercel function that wraps it).
 *   /?api=<tab>          — the same JSON rendered by the page itself, for a purely static host
 *                          where nothing is running server-side. Needs a caller that executes
 *                          JavaScript.
 */

/** The tab's HTTP endpoint. Absolute when there is an origin to be absolute about. */
export function tabEndpointUrl(tab: TabId, opts?: UrlOpts): string {
  return `${origin()}/api/v1/tabs/${tab}?${query(opts).toString()}`;
}

/** The in-page fallback: same payload, rendered by the app, for a static deployment. */
export function tabFallbackUrl(tab: TabId, opts?: UrlOpts): string {
  const loc = typeof window === 'undefined' ? undefined : (window as Window).location;
  const base = loc ? `${loc.origin}${loc.pathname}` : '';
  return `${base}?${query(opts, { [API_PARAM]: tab, format: 'json' }).toString()}`;
}

/** Parse the current location. Returns null for an ordinary page load. */
export function readApiRequest(search = typeof window === 'undefined' ? '' : window.location.search): ApiRequest | null {
  const q = new URLSearchParams(search);
  const tab = q.get(API_PARAM);
  if (!tab) return null;
  const ep = ENDPOINTS.find((e) => e.tab === tab);
  if (!ep) return null;
  const include = q.get('include');
  const limitRaw = q.get('limit');
  const limit = limitRaw === 'all' ? 0 : Math.max(0, Number(limitRaw ?? 1000) || 1000);
  return {
    tab: ep.tab,
    include: include === 'raw' || include === 'consolidated' ? include : 'all',
    limit,
    groupBy: q.get('groupBy') ?? undefined,
    format: 'json',
  };
}

/** Everything the tab holds, under the scope the operator's filters currently describe. */
export function buildTabPayload(api: AgentApi, scope: Scope, req: ApiRequest): Record<string, unknown> {
  const ep = ENDPOINTS.find((e) => e.tab === req.tab)!;
  const rows = scope.tables[ep.table] ?? [];
  const payload: Record<string, unknown> = {
    endpoint: `/api/v1/tabs/${req.tab}?${new URLSearchParams({ include: req.include, limit: String(req.limit || 'all') }).toString()}`,
    tab: ep.tab,
    title: ep.title,
    description: ep.description,
    grain: ep.table,
    generatedAt: new Date().toISOString(),
    apiVersion: api.version,
    scope: api.scope(),
    note: 'Figures are computed under the scope above. Do not quote one without it.',
  };
  if (req.include !== 'raw') {
    payload.consolidated = api.get(req.tab, { groupBy: req.groupBy, limit: 500 });
  }
  if (req.include !== 'consolidated') {
    const slice = req.limit ? rows.slice(0, req.limit) : rows;
    payload.raw = {
      grain: ep.table,
      rowsInScope: rows.length,
      rowsReturned: slice.length,
      truncated: slice.length < rows.length,
      hint: slice.length < rows.length ? 'Add limit=all for every row in scope, or narrow the period first.' : undefined,
      fields: Object.keys(rows[0] ?? {}),
      rows: slice,
    };
  }
  return payload;
}
