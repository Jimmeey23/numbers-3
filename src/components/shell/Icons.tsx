import type { TabId } from '../../state/view';

/* A single-weight, 18px line-icon set drawn on a 24 grid. One icon per tab plus the
   handful of chrome glyphs the shell needs, so the interface never falls back to an
   emoji or a text arrow where a mark belongs. */

const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
};

export const TAB_ICONS: Record<TabId, React.ReactNode> = {
  overview: <svg {...base}><path d="M4 13h3l2.5 5 4-12 2.5 7h4" /></svg>,
  sales: <svg {...base}><path d="M12 3v18" /><path d="M16.5 7.2C15.6 6 14 5.3 12.2 5.3c-2.3 0-4 1.2-4 3 0 4.2 8 2.3 8 6.5 0 1.9-1.9 3.1-4.2 3.1-2 0-3.7-.8-4.6-2.1" /></svg>,
  leads: <svg {...base}><path d="M3 6.5 12 13l9-6.5" /><rect x="3" y="5" width="18" height="14" rx="2.5" /></svg>,
  acquisition: <svg {...base}><path d="M12 4v9" /><path d="m8.5 7.5 3.5-3.5 3.5 3.5" /><path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14" /></svg>,
  retention: <svg {...base}><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v4h-4" /><circle cx="12" cy="12" r="2.4" /></svg>,
  classes: <svg {...base}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 9.5h17" /><path d="M8 13h3M8 16h8M14 13h2" /></svg>,
  slots: <svg {...base}><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></svg>,
  bookings: <svg {...base}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /><path d="m9 14.8 2 2 4-4" /></svg>,
  attendance: <svg {...base}><path d="M4 18V7M4 18h16" /><path d="m7 14 3.5-3.5 3 3L20 7" /><circle cx="20" cy="7" r="1.4" /></svg>,
  trainers: <svg {...base}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M16.5 6.8a3 3 0 0 1 0 5.9M18 19.5c-.2-1.9-.9-3.4-2-4.4" /></svg>,
  payroll: <svg {...base}><rect x="3" y="6" width="18" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.6" /><path d="M6.5 12h.01M17.5 12h.01" /></svg>,
  'late-cancellations': <svg {...base}><circle cx="12" cy="12" r="8.2" /><path d="M12 7.5V12l2.8 1.8" /><path d="m17.8 6.2-11.6 11.6" /></svg>,
  'format-comparison': <svg {...base}><path d="M6 20V9M12 20V4M18 20v-7" /><path d="M3.5 20h17" /></svg>,
  health: <svg {...base}><path d="M3.5 12h4L10 7l4 10 2.2-5h4.3" /></svg>,
};

export const Icon = {
  search: <svg {...base} width={15} height={15}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>,
  spark: <svg {...base} width={15} height={15}><path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5 10.1 12.8 4.5 10.9 10.1 9z" /></svg>,
  report: <svg {...base} width={15} height={15}><path d="M6.5 3.5h7l4.5 4.5v12a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" /><path d="M13.5 3.5V8H18" /><path d="M9 13h6M9 16.5h4" /></svg>,
  settings: <svg {...base} width={15} height={15}><circle cx="12" cy="12" r="2.8" /><path d="M19.4 14.2a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.3a1.8 1.8 0 1 1-3.6 0v-.2a1.5 1.5 0 0 0-2.6-1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1-2.6h-.3a1.8 1.8 0 1 1 0-3.6h.2a1.5 1.5 0 0 0 1-2.6l-.1-.1A1.8 1.8 0 1 1 8.1 4.5l.1.1a1.5 1.5 0 0 0 2.6-1v-.3a1.8 1.8 0 1 1 3.6 0v.2a1.5 1.5 0 0 0 2.6 1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1 2.6h.3a1.8 1.8 0 1 1 0 3.6h-.2a1.5 1.5 0 0 0-1.3.9z" /></svg>,
  refresh: <svg {...base} width={15} height={15}><path d="M20 11.5a8 8 0 1 0-1.2 5.3" /><path d="M20 5v6h-6" /></svg>,
  export: <svg {...base} width={15} height={15}><path d="M12 15.5V4" /><path d="m8.5 7.5 3.5-3.5 3.5 3.5" /><path d="M4.5 15v4a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-4" /></svg>,
  compare: <svg {...base} width={15} height={15}><path d="M8 4v16M16 4v16" /><path d="M4 8h8M12 16h8" /></svg>,
  views: <svg {...base} width={15} height={15}><path d="m12 3.5 2.6 5.5 6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.4 9.9l6-.9z" /></svg>,
  filter: <svg {...base} width={15} height={15}><path d="M4 6h16M7 12h10M10 18h4" /></svg>,
  chevron: <svg {...base} width={14} height={14}><path d="m9 5 6 7-6 7" /></svg>,
  collapse: <svg {...base} width={14} height={14}><path d="M15 5 9 12l6 7" /></svg>,
  insight: <svg {...base} width={15} height={15}><path d="M9.3 17.5h5.4" /><path d="M10 20.5h4" /><path d="M12 3.5a6 6 0 0 0-3.4 10.9c.5.4.8 1 .8 1.6h5.2c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3.5z" /></svg>,
  ask: <svg {...base} width={16} height={16}><path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 3.5V6.5A2.5 2.5 0 0 1 7 4h10.5A2.5 2.5 0 0 1 20 6.5z" /><path d="M9.8 9.2a2.3 2.3 0 1 1 3 2.2v1.1" /><path d="M12.8 14.9h.01" /></svg>,
};
