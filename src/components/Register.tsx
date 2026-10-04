import { useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useInView } from './hooks';
import { useFooter } from '../state/footer';

interface Props {
  title: string; subtitle?: string; domain?: string; actions?: ReactNode; children: ReactNode;
  collapsed?: boolean; lazy?: boolean; id?: string; suspect?: string | null; index?: string; note?: string; hero?: boolean;
  /** The register that opens a tab. The page hero already names the tab, so this one keeps the
   *  standfirst, the caveats and the controls but drops the heading rather than saying it twice. */
  identity?: boolean;
}

/** A register: one horizontal module of the page — index, title, subtitle, actions, body.
 *
 *  `collapsed` no longer means "rendered here, shut": the register moves to the tab footer, where
 *  all the reference material for the tab is shelved together. `lazy` mounts the body when it
 *  scrolls into view, so a long tab stays responsive. */
export function Register({ title, subtitle, domain, actions, children, collapsed = false, lazy = false, id, suspect, index, note, hero = false, identity = false }: Props) {
  const { ref, inView } = useInView<HTMLElement>();
  const slotId = useId();
  const footerEl = useFooter((s) => s.el);
  const register = useFooter((s) => s.register);
  const unregister = useFooter((s) => s.unregister);
  useEffect(() => {
    if (!collapsed) return;
    register({ id: slotId, title, index });
    return () => unregister(slotId);
  }, [collapsed, slotId, title, index, register, unregister]);

  if (collapsed) {
    return footerEl ? createPortal(<FooterCard title={title} subtitle={subtitle} domain={domain} actions={actions} index={index}>{children}</FooterCard>, footerEl) : null;
  }

  const mount = !lazy || inView;
  if (identity) {
    return (
      <section ref={ref} id={id} className="register is-identity" data-domain={domain} aria-label={title}>
        {(subtitle || actions || note || suspect) && (
          <div className="identity-head">
            {subtitle && <p className="identity-lede">{subtitle}{suspect && <span className="warn-mark" title={suspect}>⚠</span>}</p>}
            {note && <span className="status-pill" style={{ color: 'var(--hue-ink)', borderColor: 'var(--hue-edge)' }}>{note}</span>}
            {actions && <div className="register-actions">{actions}</div>}
          </div>
        )}
        <div className="register-body is-identity-body">{children}</div>
      </section>
    );
  }
  return (
    <section ref={ref} id={id} className="register" data-domain={domain} data-hero={hero || undefined} aria-label={title}>
      <div className="register-head">
        <div className="register-head-text">
          <div className="register-title">
            {index && <span className="register-index">{index}</span>}
            <h2 className="t-heading-l">
              {title}{suspect && <span className="warn-mark" title={suspect}>⚠</span>}
            </h2>
            {note && <span className="status-pill" style={{ color: 'var(--hue-ink)', borderColor: 'var(--hue-edge)' }}>{note}</span>}
          </div>
          {subtitle && <div className="register-sub t-body-s">{subtitle}</div>}
        </div>
        {actions && <div className="register-actions">{actions}</div>}
      </div>
      <div className="register-body">{mount ? children : <div className="travel-barre" />}</div>
    </section>
  );
}

/** One shelf in the footer: shut by default, opens in place, body mounts only when opened. */
function FooterCard({ title, subtitle, domain, actions, index, children }: { title: string; subtitle?: string; domain?: string; actions?: ReactNode; index?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`footer-card ${open ? 'is-open' : ''}`} data-domain={domain}>
      <button type="button" className="footer-card-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="footer-card-caret" aria-hidden="true">▸</span>
        <span className="footer-card-text">
          <span className="footer-card-title">{title}</span>
          {subtitle && <span className="footer-card-sub">{subtitle}</span>}
        </span>
        {index && <span className="footer-card-index">{index}</span>}
      </button>
      {open && (
        <div className="footer-card-body">
          {actions && <div className="register-actions footer-card-actions">{actions}</div>}
          {children}
        </div>
      )}
    </section>
  );
}

export function EmptyState({ title, body, actions }: { title: string; body?: string; actions?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-mark" aria-hidden="true">◇</div>
      <div className="t-heading-m">{title}</div>
      {body && <div className="t-body-s muted empty-state-body">{body}</div>}
      {actions && <div className="empty-state-actions">{actions}</div>}
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
