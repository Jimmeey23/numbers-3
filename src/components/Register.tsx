import { useState, type ReactNode } from 'react';
import { useInView } from './hooks';
import { useView } from '../state/view';
import { HeroGraphic } from './HeroGraphic';

interface Props {
  title: string; subtitle?: string; domain?: string; actions?: ReactNode; children: ReactNode;
  collapsed?: boolean; lazy?: boolean; id?: string; suspect?: string | null; index?: string; note?: string; hero?: boolean;
}

/** A register: a horizontal module of the page — index, title, subtitle, actions, body.
    Mounts lazily on scroll into view when `lazy`, so a long tab stays responsive. */
export function Register({ title, subtitle, domain, actions, children, collapsed = false, lazy = false, id, suspect, index, note, hero = false }: Props) {
  const [open, setOpen] = useState(!collapsed);
  const { ref, inView } = useInView<HTMLElement>();
  const tab = useView((s) => s.tab);
  const mount = !lazy || inView;
  return (
    <section ref={ref} id={id} className="register" data-domain={domain} data-hero={hero || undefined} aria-label={title}>
      <div className="register-head">
        <div style={{ minWidth: 0 }}>
          <div className="register-title">
            {collapsed && (
              <button className="icon-button" style={{ width: 24, height: 24, fontSize: 11 }}
                onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? `Collapse ${title}` : `Expand ${title}`}>
                <span className={`caret ${open ? 'open' : ''}`}>▸</span>
              </button>
            )}
            {index && <span className="register-index">{index}</span>}
            <h2 className="t-heading-l" style={{ margin: 0 }}>
              {title}{suspect && <span className="warn-mark" title={suspect}>⚠</span>}
            </h2>
            {note && <span className="status-pill" style={{ color: 'var(--hue-ink)', borderColor: 'var(--hue-edge)' }}>{note}</span>}
          </div>
          {subtitle && <div className="t-body-s muted" style={{ marginTop: 5, maxWidth: '92ch' }}>{subtitle}</div>}
        </div>
        <div className="register-actions">{actions}</div>
        <HeroGraphic tab={tab} />
      </div>
      {open && <div className="register-body">{mount ? children : <div className="travel-barre" />}</div>}
    </section>
  );
}

export function EmptyState({ title, body, actions }: { title: string; body?: string; actions?: ReactNode }) {
  return (
    <div style={{
      padding: '40px 28px', textAlign: 'center',
      border: '1px dashed var(--hairline-strong)', borderRadius: 'var(--r-xl)',
      background: 'color-mix(in oklab, var(--surface-inset) 55%, transparent)',
    }}>
      <div aria-hidden="true" style={{
        width: 38, height: 38, margin: '0 auto 12px', borderRadius: '999px',
        display: 'grid', placeItems: 'center',
        background: 'var(--hue-wash)', color: 'var(--hue-ink)', fontSize: 17,
      }}>◇</div>
      <div className="t-heading-m">{title}</div>
      {body && <div className="t-body-s muted" style={{ marginTop: 7, maxWidth: 580, marginInline: 'auto' }}>{body}</div>}
      {actions && <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

/** Secondary tables inside registers: titled, scrollable in both axes, never overflowing the page. */
export function DataPanel({ title, subtitle, actions, children, maxHeight = 380 }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; maxHeight?: number }) {
  return (
    <div>
      <div className="panel-head">
        <div style={{ minWidth: 0 }}>
          <div className="t-heading-m">{title}</div>
          {subtitle && <div className="t-label-s muted" style={{ marginTop: 3 }}>{subtitle}</div>}
        </div>
        <div style={{ flex: 1 }} />
        {actions}
      </div>
      <div className="table-scroll" style={{ maxHeight }}>{children}</div>
    </div>
  );
}
