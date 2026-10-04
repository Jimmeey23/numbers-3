/* One shelf at the foot of every tab.
 *
 * Reference tables, the tab's widgets and its agent endpoint are all reference material. They used
 * to be three separate blocks competing with the analysis above them; they are now one collapsed
 * footer with three sections, shut until asked for. */
import { useCallback } from 'react';
import { useFooter, type FooterSection } from '../../state/footer';
import type { TabId } from '../../state/view';
import type { Scope } from '../../state/data';
import { WidgetSection } from '../Widgets/WidgetSection';
import { TabEndpoint } from './TabEndpoint';
import { Icon } from './Icons';
import { useWidgets } from '../Widgets/WidgetSection';

export function TabFooter({ tab, scope }: { tab: TabId; scope: Scope }) {
  const open = useFooter((s) => s.open);
  const setOpen = useFooter((s) => s.setOpen);
  const section = useFooter((s) => s.section);
  const setSection = useFooter((s) => s.setSection);
  const slots = useFooter((s) => s.slots);
  const setEl = useFooter((s) => s.setEl);
  const widgets = useWidgets(tab, 'bottom');
  /* A stable callback ref: an inline arrow would be a new function on every render, and React
     would detach and reattach the portal target in a loop. */
  const portalRef = useCallback((node: HTMLDivElement | null) => setEl(node), [setEl]);

  const sections: { id: FooterSection; label: string; count: number | null; hint: string }[] = [
    { id: 'reference', label: 'Reference tables', count: slots.length, hint: 'Secondary breakdowns for this tab' },
    { id: 'widgets', label: 'Widgets', count: widgets.length, hint: 'Views you or an agent built here' },
    { id: 'api', label: 'Agent endpoint', count: null, hint: 'The URL that returns this tab as JSON' },
  ];

  return (
    <footer className={`tab-footer ${open ? 'is-open' : ''}`}>
      <button type="button" className="tab-footer-bar" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="tab-footer-glyph" aria-hidden="true">{Icon.collapse}</span>
        <span className="tab-footer-label">
          <span className="eyebrow">More on this tab</span>
          <span className="tab-footer-counts">
            {slots.length} reference {slots.length === 1 ? 'table' : 'tables'}
            <i>·</i>{widgets.length} {widgets.length === 1 ? 'widget' : 'widgets'}
            <i>·</i>agent endpoint
          </span>
        </span>
        <span className="tab-footer-open">{open ? 'Hide' : 'Show'}</span>
        <span className={`tab-footer-caret ${open ? 'is-open' : ''}`} aria-hidden="true">▾</span>
      </button>

      <div className="tab-footer-body" hidden={!open}>
        <nav className="tab-footer-tabs" aria-label="Footer sections">
          {sections.map((s) => (
            <button key={s.id} type="button" title={s.hint}
              className={`tab-footer-tab ${section === s.id ? 'is-active' : ''}`}
              aria-pressed={section === s.id} onClick={() => setSection(s.id)}>
              {s.label}
              {s.count !== null && <span className="tab-footer-count">{s.count}</span>}
            </button>
          ))}
        </nav>

        {/* All three panels stay mounted: the reference panel is a portal target that collapsed
            registers write into as they mount, so it cannot be conditionally rendered. */}
        <div className="tab-footer-panel" hidden={section !== 'reference'}>
          <div className="footer-cards" ref={portalRef} />
          {slots.length === 0 && <p className="t-body-s muted">This tab has no secondary tables.</p>}
        </div>
        <div className="tab-footer-panel" hidden={section !== 'widgets'}>
          <WidgetSection tab={tab} scope={scope} placement="bottom" bare />
        </div>
        <div className="tab-footer-panel" hidden={section !== 'api'}>
          <TabEndpoint tab={tab} bare />
        </div>
      </div>
    </footer>
  );
}
