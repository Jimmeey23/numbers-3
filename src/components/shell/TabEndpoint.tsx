/* The tab's own endpoint, printed on the tab.
 *
 * One URL per tab, carrying the raw rows and the consolidated view together, so an agent can be
 * handed a link rather than an explanation. It is shown rather than hidden in documentation
 * because the operator is the one who pastes it into whatever is asking.
 */
import { useMemo, useState } from 'react';
import { ENDPOINTS } from '../../api/agent';
import { tabEndpointUrl, tabFallbackUrl } from '../../api/endpoint';
import type { TabId } from '../../state/view';
import { useView } from '../../state/view';

export function TabEndpoint({ tab, bare = false }: { tab: TabId; bare?: boolean }) {
  const ep = useMemo(() => ENDPOINTS.find((e) => e.tab === tab), [tab]);
  const url = useMemo(() => tabEndpointUrl(tab), [tab]);
  const fallback = useMemo(() => tabFallbackUrl(tab), [tab]);
  const announce = useView((s) => s.announce);
  const [copied, setCopied] = useState('');
  if (!ep) return null;
  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(what); announce(`${what} copied`); window.setTimeout(() => setCopied(''), 1600); },
      () => announce('Clipboard is blocked in this browser'));
  };
  /* Collapsed by default: it is reference, and it sits at the foot of every tab. `details` keeps
     it keyboard-reachable and findable by in-page search without any state of its own. */
  const body = (
    <>
      <div className="tab-endpoint-row">
        <code className="tab-endpoint-url" title={url}>{url}</code>
        <button className="btn btn-xs" onClick={() => copy(url, 'Endpoint URL')}>{copied === 'Endpoint URL' ? 'Copied' : 'Copy URL'}</button>
        <a className="btn btn-xs" href={url} target="_blank" rel="noreferrer">Open</a>
        <button className="btn btn-xs" onClick={() => copy(`await window.atlas.get('${tab}')`, 'In-page call')}>
          {copied === 'In-page call' ? 'Copied' : 'Copy in-page call'}
        </button>
      </div>
      <p className="t-label-s faint tab-endpoint-note">
        Returns JSON: <code>scope</code>, <code>consolidated</code> (headline metrics, grouped breakdown, available
        groupings and metrics, live insights) and <code>raw</code> (the rows themselves). Query parameters:
        {' '}<code>include=all|raw|consolidated</code>, <code>limit=1000|all</code>, <code>groupBy=</code>
        {ep.groupBy.slice(0, 3).join('|')}, plus <code>start</code>, <code>end</code> and <code>location</code> to scope
        it server-side. Plain <code>curl</code> works — no JavaScript needed. The catalogue of every tab is at
        {' '}<code>/api/v1/tabs</code>.
      </p>
      <p className="t-label-s faint tab-endpoint-note">
        On a static deployment with no server running, the same payload is rendered by the page itself at
        {' '}<code className="tab-endpoint-alt">{fallback}</code> — that one needs a caller that executes JavaScript.
        An agent already inside the page should call <code>window.atlas.get('{tab}')</code>.
      </p>
    </>
  );
  if (bare) {
    return (
      <div className="tab-endpoint is-bare">
        <p className="t-body-s muted tab-endpoint-lede">{ep.title} · {ep.table} grain · raw rows and the consolidated view, under the filters now applied.</p>
        {body}
      </div>
    );
  }
  /* Collapsed by default when used on its own: it is reference, and `details` keeps it
     keyboard-reachable and findable by in-page search without any state of its own. */
  return (
    <details className="tab-endpoint">
      <summary className="tab-endpoint-head">
        <span className="eyebrow">Agent endpoint</span>
        <span className="t-label-s faint">{ep.title} · {ep.table} grain · raw rows and the consolidated view, under the filters now applied</span>
      </summary>
      {body}
    </details>
  );
}
