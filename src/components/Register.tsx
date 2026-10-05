import { useContext, useEffect, useState, type ReactNode } from 'react';
import { useInView } from './hooks';
import { useView } from '../state/view';
import { HeroGraphic } from './HeroGraphic';
import { TabExtrasContext } from './TabExtrasContext';
import { useAI, useSectionNote } from '../state/ai';

interface Props {
  title: string; subtitle?: string; domain?: string; actions?: ReactNode; children: ReactNode;
  collapsed?: boolean; lazy?: boolean; id?: string; suspect?: string | null; index?: string; note?: string; hero?: boolean; footerContent?: boolean;
}

/** A horizontal register: index, title, actions, barre, content. Lazily mounts on scroll-into-view when `lazy`. */
export function Register({ title, subtitle, domain, actions, children, collapsed = false, lazy = false, id, suspect, index, note, hero = false, footerContent = false }: Props) {
  const [open, setOpen] = useState(!collapsed);
  const { ref, inView } = useInView<HTMLElement>();
  const tab = useView((s) => s.tab);
  const extras = useContext(TabExtrasContext);
  /* Sections announce themselves so a run can be asked about the headings actually on screen,
     and so the note that comes back can be matched to the right one. */
  const registerSection = useAI((s) => s.registerSection);
  const aiNote = useSectionNote(tab, title);
  useEffect(() => registerSection(tab, title), [registerSection, tab, title]);
  const moveToFooter = collapsed && !!extras && !footerContent;
  useEffect(() => {
    if (!moveToFooter || !extras) return;
    return extras.register(id ?? title, <Register title={title} subtitle={subtitle} domain={domain} actions={actions} id={id} suspect={suspect} index={index} note={note} hero={hero} footerContent>{children}</Register>);
  }, [moveToFooter, extras, id, title, subtitle, domain, actions, suspect, index, note, hero, children]);
  const mount = !lazy || inView;
  if (moveToFooter) return null;
  return (
    <section ref={ref} id={id} className="register" data-domain={domain} data-hero={hero || undefined} aria-label={title}>
      <div className="register-head">
        <div style={{ minWidth: 0 }}>
          <div className="register-title">
            {collapsed && (
              <button className="btn-ghost" style={{ display: 'inline-flex', width: 18, height: 18, alignItems: 'center', justifyContent: 'center', marginRight: 2 }}
                onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? `Collapse ${title}` : `Expand ${title}`}>
                <span className={`caret ${open ? 'open' : ''}`}>▸</span>
              </button>
            )}
            {index && <span className="register-index">{index}</span>}
            <h2 className="t-heading-l" style={{ margin: 0 }}>{title}{suspect && <span className="warn-mark" title={suspect}>⚠</span>}</h2>
            {note && <span className="t-label-s pill" style={{ padding: '1px 8px', background: 'var(--hue-wash)', color: 'var(--hue)' }}>{note}</span>}
          </div>
          {subtitle && <div className="t-body-s muted" style={{ marginTop: 3, maxWidth: 900 }}>{subtitle}</div>}
          {aiNote && <div className="register-ai-note t-body-s"><span aria-hidden="true">✦</span>{aiNote}</div>}
        </div>
        <div className="register-actions" style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {actions}
        </div>
        <HeroGraphic tab={tab} />
      </div>
      <div className="barre" />
      {open && <div className="register-body">{mount ? children : <div className="travel-barre" />}</div>}
    </section>
  );
}

export function EmptyState({ title, body, actions }: { title: string; body?: string; actions?: ReactNode }) {
  return (
    <div className="inset" style={{ padding: '30px 24px', textAlign: 'center', border: '1px dashed var(--hairline-strong)', borderRadius: 'var(--r-m)' }}>
      <div className="t-heading-m">{title}</div>
      {body && <div className="t-body-s muted" style={{ marginTop: 6, maxWidth: 560, marginInline: 'auto' }}>{body}</div>}
      {actions && <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>{actions}</div>}
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
          {subtitle && <div className="t-label-s muted" style={{ marginTop: 2 }}>{subtitle}</div>}
        </div>
        <div style={{ flex: 1 }} />
        {actions}
      </div>
      <div className="table-scroll" style={{ maxHeight }}>{children}</div>
    </div>
  );
}
