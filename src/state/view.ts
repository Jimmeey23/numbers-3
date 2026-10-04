import { create } from 'zustand';
import { DEFAULT_FILTERS, type Filters } from './filters';

import { isDark, isTheme, type Theme } from '../design/ramps';
export type { Theme };
export type Density = 'comfortable' | 'compact' | 'dense';
export const TAB_IDS = ['overview', 'sales', 'leads', 'acquisition', 'retention', 'classes', 'slots', 'bookings', 'attendance', 'trainers', 'payroll', 'late-cancellations', 'format-comparison', 'health'] as const;
export type TabId = typeof TAB_IDS[number];

export interface SavedView { id: string; name: string; tab: TabId; filters: Filters; density: Density; comparison: boolean; createdAt: number; preset?: boolean }

export interface Thresholds {
  deadSlotFill: number; deadSlotMinOccurrences: number; slotDeclinePp: number; waitlistMin: number; dependencyShare: number;
  conversionSigma: number; secondVisitFloor: number; leadResponseHours: number; untouchedHours: number; discountCreepPp: number;
  dormantDays: number; zeroUsageDays: number; expiryCliffShare: number; utilisationFloor: number; noShowRate: number; mixShiftPp: number; integrityVariance: number;
  riskHigh: number; matureDays: number; medianFirstMembership: number; coverageFloor: number; durationDefaultMin: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = {
  deadSlotFill: 0.2, deadSlotMinOccurrences: 8, slotDeclinePp: 0.15, waitlistMin: 3, dependencyShare: 0.6, conversionSigma: 1.5, secondVisitFloor: 0.4,
  leadResponseHours: 4, untouchedHours: 48, discountCreepPp: 0.05, dormantDays: 21, zeroUsageDays: 7, expiryCliffShare: 0.15, utilisationFloor: 0.25, noShowRate: 0.15, mixShiftPp: 0.08, integrityVariance: 0.03,
  riskHigh: 60, matureDays: 21, medianFirstMembership: 12599, coverageFloor: 0.4, durationDefaultMin: 55,
};

const PRESET_VIEWS: SavedView[] = [
  { id: 'preset-monday', name: 'Monday review', tab: 'overview', filters: { ...DEFAULT_FILTERS, preset: '30d' }, density: 'compact', comparison: true, createdAt: 0, preset: true },
  { id: 'preset-schedule', name: 'Schedule audit', tab: 'slots', filters: { ...DEFAULT_FILTERS, preset: '90d' }, density: 'dense', comparison: false, createdAt: 0, preset: true },
  { id: 'preset-trainers', name: 'Trainer one-to-ones', tab: 'trainers', filters: { ...DEFAULT_FILTERS, preset: 'quarter' }, density: 'compact', comparison: true, createdAt: 0, preset: true },
  { id: 'preset-close', name: 'Month-end close', tab: 'sales', filters: { ...DEFAULT_FILTERS, preset: 'month', compare: 'prior' }, density: 'compact', comparison: true, createdAt: 0, preset: true },
];

const ls = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

interface ViewState {
  theme: Theme; density: Density; tab: TabId; railOpen: boolean; filtersOpen: boolean; comparison: boolean; paletteOpen: boolean; settingsOpen: boolean; askOpen: boolean; reportOpen: boolean;
  ratePerSession: number; thresholds: Thresholds; savedViews: SavedView[]; dismissed: Record<string, number>; announcement: string;
  setTheme: (t: Theme) => void; setDensity: (d: Density) => void; setTab: (t: TabId) => void; toggleRail: () => void; setFiltersOpen: (o: boolean) => void;
  toggleComparison: () => void; setPaletteOpen: (o: boolean) => void; setSettingsOpen: (o: boolean) => void; setAskOpen: (o: boolean) => void; setReportOpen: (o: boolean) => void; setRate: (r: number) => void; setThresholds: (t: Partial<Thresholds>) => void;
  saveView: (v: SavedView) => void; deleteView: (id: string) => void; dismiss: (key: string) => void; announce: (s: string) => void;
}

const applyAttr = (k: string, v: string) => document.documentElement.setAttribute(k, v);
const attr = document.documentElement.getAttribute('data-theme');
const initialTheme: Theme = isTheme(attr) ? attr : 'matte';
const initialDensity = (document.documentElement.getAttribute('data-density') as Density) || 'compact';
const tabFromHash = (): TabId => { const h = window.location.hash.replace(/^#\/?/, '').split('?')[0] as TabId; return (TAB_IDS as readonly string[]).includes(h) ? h : 'overview'; };

export const useView = create<ViewState>((set) => ({
  theme: initialTheme, density: initialDensity, tab: tabFromHash(), railOpen: window.innerWidth >= 1600, filtersOpen: false, comparison: false, paletteOpen: false, settingsOpen: false, askOpen: false, reportOpen: false,
  ratePerSession: ls('floor.rate', 1200), thresholds: { ...DEFAULT_THRESHOLDS, ...ls('floor.thresholds', {}) },
  savedViews: [...PRESET_VIEWS, ...ls<SavedView[]>('floor.views', [])], dismissed: ls('floor.dismissed', {}), announcement: '',
  /* `data-mode` rides alongside `data-theme`: the chrome rules that care only whether the
     material is dark or light are written against the mode, so a new theme needs no new CSS. */
  setTheme: (theme) => { applyAttr('data-theme', theme); applyAttr('data-mode', isDark(theme) ? 'dark' : 'light'); localStorage.setItem('floor.theme', theme); set({ theme }); },
  setDensity: (density) => { applyAttr('data-density', density); localStorage.setItem('floor.density', density); set({ density }); },
  setTab: (tab) => set({ tab }),
  toggleRail: () => set((s) => ({ railOpen: !s.railOpen })),
  setFiltersOpen: (filtersOpen) => set({ filtersOpen }),
  toggleComparison: () => set((s) => ({ comparison: !s.comparison })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setAskOpen: (askOpen) => set({ askOpen }),
  setReportOpen: (reportOpen) => set({ reportOpen }),
  setRate: (ratePerSession) => { save('floor.rate', ratePerSession); set({ ratePerSession }); },
  setThresholds: (t) => set((s) => { const thresholds = { ...s.thresholds, ...t }; save('floor.thresholds', thresholds); return { thresholds }; }),
  saveView: (v) => set((s) => { const savedViews = [...s.savedViews.filter((x) => x.id !== v.id), v]; save('floor.views', savedViews.filter((x) => !x.preset)); return { savedViews }; }),
  deleteView: (id) => set((s) => { const savedViews = s.savedViews.filter((x) => x.id !== id); save('floor.views', savedViews.filter((x) => !x.preset)); return { savedViews }; }),
  dismiss: (key) => set((s) => { const dismissed = { ...s.dismissed, [key]: Date.now() }; save('floor.dismissed', dismissed); return { dismissed }; }),
  announce: (announcement) => set({ announcement }),
}));

/** Navigation groups, in the order an operator works through the day. */
export type TabGroup = 'Pulse' | 'Commercial' | 'Floor' | 'People' | 'Quality';

export interface TabMeta {
  id: TabId;
  label: string;
  domain: string;
  key: string;
  /** Navigation group this tab belongs to. */
  group: TabGroup;
  /** One line of orientation, shown in the page header and the command palette. */
  blurb: string;
}

export const TABS: TabMeta[] = [
  { id: 'overview', label: 'Overview', domain: 'attendance', key: '1', group: 'Pulse', blurb: 'The whole business in one screen — revenue, attendance, acquisition and retention, with what moved and why.' },
  { id: 'sales', label: 'Sales', domain: 'revenue', key: '2', group: 'Commercial', blurb: 'Revenue, average value, discounting and product mix across every payment line in scope.' },
  { id: 'leads', label: 'Leads', domain: 'people', key: '3', group: 'Commercial', blurb: 'Enquiry volume, response speed, follow-up discipline and the pipeline each source actually produces.' },
  { id: 'acquisition', label: 'Acquisition', domain: 'growth', key: '4', group: 'Commercial', blurb: 'First visits, trial conversion, second-visit return and the lifetime value of each cohort.' },
  { id: 'retention', label: 'Retention', domain: 'risk', key: '5', group: 'Commercial', blurb: 'Membership health: utilisation, dormancy, expiry concentration, churn and revenue at risk.' },
  { id: 'classes', label: 'Classes', domain: 'attendance', key: '6', group: 'Floor', blurb: 'Every class occurrence — capacity, fill, attendance and the revenue attributed to it.' },
  { id: 'slots', label: 'Slots', domain: 'attendance', key: '7', group: 'Floor', blurb: 'The recurring timetable judged as a schedule: which slots earn their place and which do not.' },
  { id: 'bookings', label: 'Bookings', domain: 'attendance', key: '8', group: 'Floor', blurb: 'Booking lifecycle, lead time, waitlist pressure, cancellation and no-show behaviour.' },
  { id: 'attendance', label: 'Attendance', domain: 'attendance', key: '9', group: 'Floor', blurb: 'Reconciled check-in grain — who came, how often, and how that visit pattern is trending.' },
  { id: 'trainers', label: 'Trainers', domain: 'people', key: '0', group: 'People', blurb: 'Trainer performance across fill, retention, conversion and commercial contribution.' },
  { id: 'payroll', label: 'Payroll', domain: 'people', key: '-', group: 'People', blurb: 'Sessions taught, customers served, cost per session and contribution per trainer month.' },
  { id: 'late-cancellations', label: 'Late cancellations', domain: 'risk', key: '', group: 'Quality', blurb: 'Late cancellation and no-show clusters by member, class, slot and trainer.' },
  { id: 'format-comparison', label: 'Format comparison', domain: 'growth', key: '', group: 'Quality', blurb: 'Formats compared like for like on demand, fill, retention and revenue per seat-hour.' },
  { id: 'health', label: 'Data health', domain: 'neutral', key: '=', group: 'Quality', blurb: 'Source reconciliation, coverage, duplicates and anything that would make a number untrustworthy.' },
];

export const TAB_GROUPS: TabGroup[] = ['Pulse', 'Commercial', 'Floor', 'People', 'Quality'];
export const tabMeta = (id: TabId): TabMeta => TABS.find((t) => t.id === id) ?? TABS[0];
